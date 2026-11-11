#!/usr/bin/env node
/* Erzeugt das PDF für den Elektro-Fachbetrieb aus den Plandaten in index.html.
 *
 *   node tools/elektriker-pdf.mjs [Ausgabepfad] [--quelle <index.html>] [--daten <JSON-Pfad>]
 *
 * Ablauf: lokaler HTTP-Server (nur 127.0.0.1) für das Repo → Chrome headless lädt tools/report.html,
 * das die Daten zur Laufzeit aus index.html liest und den Bericht aufbaut → sobald die Seite
 * „bereit“ meldet, druckt Chrome sie über das DevTools-Protokoll als PDF.
 * Keine npm-Abhängigkeiten; gebraucht werden nur Node ≥ 20 und Chrome/Chromium.
 * Bei jedem Fehler: Exit-Code ≠ 0 und es wird keine PDF-Datei geschrieben.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { mkdtemp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(homedir(), 'Documents', 'Elektroplan-Haus4-fuer-Elektriker.pdf');
const READY_TIMEOUT_MS = 45_000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

class Abbruch extends Error {}

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, quelle: join(REPO, 'index.html'), daten: null };
  let outSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = name => {
      if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
      if (i + 1 >= argv.length) throw new Abbruch(`Option --${name} braucht einen Wert.`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') { opts.help = true; }
    else if (a === '--quelle' || a.startsWith('--quelle=')) opts.quelle = resolve(REPO, value('quelle'));
    else if (a === '--daten' || a.startsWith('--daten=')) opts.daten = resolve(value('daten'));
    else if (a.startsWith('-')) throw new Abbruch(`Unbekannte Option: ${a}`);
    else if (!outSet) { opts.out = resolve(a); outSet = true; }
    else throw new Abbruch(`Überzähliges Argument: ${a}`);
  }
  return opts;
}

function findChrome() {
  const fromEnv = process.env.CHROME_BIN;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Abbruch(`CHROME_BIN zeigt auf eine fehlende Datei: ${fromEnv}`);
    return fromEnv;
  }
  const fixed = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const pw = join(homedir(), '.cache', 'ms-playwright');
  const fromPlaywright = existsSync(pw)
    ? readdirSync(pw).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
      .flatMap(n => ['chrome-linux64', 'chrome-linux'].map(d => join(pw, n, d, 'chrome')))
    : [];
  const hit = [...fixed, ...fromPlaywright].find(p => existsSync(p));
  if (!hit) throw new Abbruch('Kein Chrome/Chromium gefunden. Pfad über die Umgebungsvariable CHROME_BIN angeben.');
  return hit;
}

/* Statischer Server für das Repo, nur lesend und nur auf der Loopback-Adresse. */
const SOURCE_ROUTE = '/__quelle.html';
function startServer(root, sourceFile) {
  const server = createServer(async (req, res) => {
    const fail = (code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Nur GET');
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return fail(400, 'Ungültiger Pfad'); }
    // Die Quelle der Plandaten hat eine feste Adresse; sie darf auch außerhalb des Repos liegen (z. B. ein gesicherter Stand)
    const file = rel === SOURCE_ROUTE ? sourceFile : normalize(join(root, rel));
    if (rel !== SOURCE_ROUTE && file !== root && !file.startsWith(root + sep)) return fail(403, 'Außerhalb des Repos');
    if (rel !== SOURCE_ROUTE && file.split(sep).some(part => part.startsWith('.git'))) return fail(403, 'Gesperrt');
    try {
      const st = await stat(file);
      if (!st.isFile()) return fail(404, 'Nicht gefunden');
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch { fail(404, 'Nicht gefunden'); }
  });
  return new Promise((ok, err) => {
    server.once('error', err);
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

/* Chrome über --remote-debugging-pipe steuern: JSON-Nachrichten, mit NUL getrennt, auf fd 3 (hin) und fd 4 (zurück). */
function launchChrome(bin, workDir) {
  // TMPDIR zeigt in das eigene Arbeitsverzeichnis, damit Chrome nichts außerhalb davon ablegt
  const child = spawn(bin, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(workDir, 'profil')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: workDir } });
  const [, , stderr, toChrome, fromChrome] = child.stdio;
  let errTail = '';
  stderr.on('data', d => { errTail = (errTail + d).slice(-2000); });
  toChrome.on('error', () => {}); // EPIPE beim Beenden ist erwartbar

  let nextId = 0, buffer = Buffer.alloc(0), closed = null;
  const pending = new Map(), listeners = new Set();
  const failAll = why => { closed = why; for (const p of pending.values()) p.reject(new Abbruch(why)); pending.clear(); };
  fromChrome.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let end; (end = buffer.indexOf(0)) !== -1;) {
      const msg = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      buffer = buffer.subarray(end + 1);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.reject(new Abbruch(`Chrome meldet bei ${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
      } else if (msg.method) for (const fn of listeners) fn(msg);
    }
  });
  child.on('error', e => failAll(`Chrome ließ sich nicht starten: ${e.message}`));
  child.on('exit', (code, signal) => failAll(`Chrome wurde unerwartet beendet (Code ${code ?? signal}). ${errTail.trim().split('\n').slice(-3).join(' | ')}`));

  const send = (method, params = {}, sessionId) => new Promise((resolveMsg, reject) => {
    if (closed) return reject(new Abbruch(closed));
    const id = ++nextId;
    pending.set(id, { resolve: resolveMsg, reject, method });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    const gone = new Promise(r => child.once('exit', r));
    send('Browser.close').catch(() => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000); // nur der eigene Kindprozess, über seine PID
    await gone; clearTimeout(timer);
  };
  return { pid: child.pid, send, stop, onEvent: fn => listeners.add(fn) };
}

/* Arbeitsverzeichnis für Chrome-Profil und Chrome-Temp; wird am Ende gelöscht.
   Chrome legt darin einen Unix-Socket an, dessen Pfad höchstens ~100 Zeichen lang sein darf. */
async function makeWorkDir() {
  const base = tmpdir().length <= 60 ? tmpdir() : '/tmp';
  return mkdtemp(join(base, 'elektriker-pdf-'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function renderPdf(chrome, url) {
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => chrome.send(method, params, sessionId);
  const pageErrors = [];
  chrome.onEvent(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d.exception?.description?.split('\n')[0] || d.text);
    }
  });
  await page('Page.enable');
  await page('Runtime.enable');
  const nav = await page('Page.navigate', { url });
  if (nav.errorText) throw new Abbruch(`Berichtsseite nicht ladbar: ${nav.errorText}`);

  // Nicht auf Zeit vertrauen: die Berichtsseite setzt window.__report erst, wenn alles gerendert ist (oder ein Fehler vorliegt).
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let report = null;
  while (Date.now() < deadline) {
    const { result } = await page('Runtime.evaluate', { expression: 'JSON.stringify(window.__report || null)', returnByValue: true });
    report = result.value ? JSON.parse(result.value) : null;
    if (report && report.state !== 'loading') break;
    await sleep(150);
  }
  if (!report || report.state === 'loading') {
    throw new Abbruch(`Bericht wurde nicht fertig (Zeitlimit ${READY_TIMEOUT_MS / 1000} s).${pageErrors.length ? ' Fehler der Seite: ' + pageErrors.join(' | ') : ''}`);
  }
  if (report.state !== 'ready') throw new Abbruch(`Bericht konnte nicht aufgebaut werden: ${report.message || 'unbekannter Fehler'}`);

  const pdf = await page('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  const bytes = Buffer.from(pdf.data, 'base64');
  if (bytes.length < 20_000 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Abbruch('Chrome hat kein gültiges PDF geliefert.');
  return { bytes, report };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Aufruf: node tools/elektriker-pdf.mjs [Ausgabepfad] [--quelle <index.html>] [--daten <JSON-Pfad>]\n' +
      `  Ausgabepfad  Standard: ${DEFAULT_OUT}\n` +
      '  --quelle     Quelle der Plandaten, relativ zum Repo oder absolut (Standard: index.html)\n' +
      '  --daten      schreibt zusätzlich den ausgelesenen Datenstand als JSON (für Stichproben)');
    return;
  }
  const chromeBin = findChrome();
  let server, chrome, workDir;
  const tmpOut = `${opts.out}.${process.pid}.tmp`;
  try {
    if (!existsSync(opts.quelle)) throw new Abbruch(`Quelle nicht gefunden: ${opts.quelle}`);
    server = await startServer(REPO, opts.quelle);
    const base = `http://127.0.0.1:${server.address().port}`;
    workDir = await makeWorkDir();
    chrome = launchChrome(chromeBin, workDir);
    const url = `${base}/tools/report.html?quelle=${encodeURIComponent(SOURCE_ROUTE)}`;
    const { bytes, report } = await renderPdf(chrome, url);

    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(tmpOut, bytes);
    await rename(tmpOut, opts.out); // erst die fertige Datei erscheint unter dem Zielnamen
    if (opts.daten) await writeFile(opts.daten, JSON.stringify(report.data, null, 1));

    const s = report.stats;
    console.log(`PDF geschrieben: ${opts.out} (${Math.round(bytes.length / 1024)} KB)`);
    console.log(`Stand ${s.stand} · Quelle ${opts.quelle} (SHA-256 ${s.hash}) · ${s.circuits} Stromkreise · ${s.sockets} Steckdosen-Einsätze · ${s.devices} Geräte`);
    for (const w of report.warnings) console.log(`Hinweis: ${w}`);
  } finally {
    if (chrome) await chrome.stop();
    if (server) { server.closeAllConnections?.(); await new Promise(r => server.close(r)); }
    if (workDir) await rm(workDir, { recursive: true, force: true, maxRetries: 3 });
    await rm(tmpOut, { force: true });
  }
}

main().catch(e => {
  console.error(`FEHLER: ${e instanceof Abbruch ? e.message : e.stack || e}`);
  console.error('Es wurde kein PDF geschrieben.');
  process.exitCode = 1;
});
