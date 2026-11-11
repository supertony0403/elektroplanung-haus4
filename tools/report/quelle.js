/* Liest den Planungsstand zur Laufzeit aus index.html.
 *
 * index.html wird in einem unsichtbaren iframe ausgeführt. Externe Skripte (three.js vom CDN, haus3d.js) und
 * Web-Schriften werden vorher entfernt: der Bericht braucht weder WebGL noch Netz, und die Seite selbst kommt
 * ohne three.js zurecht (initScene() meldet dann nur „kein WebGL“). Die Daten und Berechnungen
 * (placeDevices, routeAll, computeMaterial, Verteilerbelegung …) sind reine Funktionen des Inline-Skripts.
 * index.html wird dabei nicht verändert.
 */

const INIT_TIMEOUT_MS = 15_000;

/* Läuft IM iframe (per eval in dessen Realm) und sieht deshalb die globalen const-Bindungen der Seite.
   Darf nur Seiten-Globale und eigene Locals benutzen. Rückgabe: JSON-Text. */
function extractPlanData() {
  /* global FLOORS, ROOMS, RI, OPENINGS, FIXTURES, CHIMNEY, SHAFTS, WET, CABLES, CABLE_ORDER, CIRCUITS, NETS, FEEDS, CIRC,
     DIST_OF, RCD_NAME, protOf, DEVICES, ROUTES, SWITCH_NAME, TYPE_NAME, DEFAULT_H, ZONE, summarize, byCableList, swCount,
     computeMaterial, DIST, ROW_TE, moduleOf, ceilAt */
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const route = id => {
    const r = ROUTES[id];
    if (!r) throw new Error(`Leitungsführung für ${id} fehlt (ROUTES)`);
    return {
      length: r.length, path: r.path ?? null, junctions: r.ads.length, summary: summarize(r.devs),
      byCable: byCableList(r.byCable).map(([k, m]) => ({ k, name: CABLES[k], m })),
    };
  };
  const rcdText = c => (c.rcd ? protOf(c).slice(String(c.prot).length).replace(/^\s*·\s*/, '') : '');

  // Materialliste: die von der Seite gerenderten Tabellen übernehmen, damit Bezeichnungen und Festwerte nicht dupliziert werden
  const materialGroups = [];
  for (const kv of document.querySelectorAll('#material .kv')) {
    let group = null;
    const kids = [...kv.children];
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      if (el.classList.contains('h')) { group = { title: text(el), rows: [], notes: [] }; materialGroups.push(group); continue; }
      if (!group) throw new Error('Materialliste: Zeile ohne Überschrift');
      if (el.style.gridColumn) { group.notes.push(text(el)); continue; }
      const value = kids[i + 1];
      if (!value || !value.classList.contains('v')) throw new Error('Materialliste: Wert zu „' + text(el) + '“ fehlt');
      const br = el.querySelector('br');
      let label = text(el), sub = '';
      if (br) {
        const before = document.createRange(), after = document.createRange();
        before.setStart(el, 0); before.setEndBefore(br);
        after.setStartAfter(br); after.setEnd(el, el.childNodes.length);
        label = before.toString().replace(/\s+/g, ' ').trim(); sub = after.toString().replace(/\s+/g, ' ').trim();
      }
      group.rows.push({ label, sub, value: text(value) });
      i++;
    }
  }

  const M = computeMaterial();
  const distEls = [...document.querySelectorAll('#distPlans .dist')];
  const data = {
    title: document.title,
    floors: FLOORS.map(f => ({ id: f.id, name: f.name, h: f.h, z: f.z, roof: !!f.roof, dist: DIST_OF[f.id] })),
    rooms: ROOMS.map(r => {
      const R = RI[r.id];
      return {
        id: r.id, floor: r.floor, name: r.name, kind: r.kind || 'room', area: R.area, source: !!r.source, poly: R.nominal,
        openings: R.openings.map(o => ({ edge: o.edge, id: o.op.id, kind: o.op.kind, axis: o.op.axis, at: o.op.at, a: o.op.a, b: o.op.b })),
      };
    }),
    fixtures: FIXTURES, chimney: CHIMNEY, shafts: SHAFTS, wet: WET,
    cables: CABLES, cableOrder: CABLE_ORDER, switchNames: SWITCH_NAME, typeNames: TYPE_NAME, defaultH: DEFAULT_H,
    zone: { reserve: ZONE.reserve, reserveDist: ZONE.reserveDist, waste: ZONE.waste },
    devices: DEVICES.map(d => ({
      id: d.id, t: d.t, c: d.c, room: d.room, floor: d.floor, x: d.x, y: d.y, nx: d.nx, ny: d.ny, h: d.h, mount: d.mount,
      n: d.n, kinds: d.kinds, count: d.t === 'sw' ? swCount(d) : d.n, label: d.label, note: d.note, w: d.w ?? null, hh: d.hh ?? null,
      lights: d.lights, lightRoom: d.lightRoom, door: d.door ?? null, poles: d.c && CIRC[d.c] ? CIRC[d.c].poles ?? null : null,
      bathViolation: !!d.bathViolation, extra: !!d.extra,
    })),
    circuits: CIRCUITS.map(c => ({ id: c.id, floor: c.floor, name: c.name, prot: c.prot, rcd: c.rcd ?? null, rcdText: rcdText(c),
      cable: c.cable, cableName: CABLES[c.cable], poles: c.poles ?? null, dist: DIST_OF[c.floor], ...route(c.id) })),
    nets: NETS.map(c => ({ id: c.id, floor: c.floor, name: c.name, cable: c.cable, cableName: CABLES[c.cable], sockets: ROUTES[c.id].devs.length, ...route(c.id) })),
    feeds: FEEDS.map(c => ({ id: c.id, floor: c.floor, uv: c.uv, name: c.name, prot: c.prot, cable: c.cable, cableName: CABLES[c.cable], ...route(c.id) })),
    dist: Object.entries(DIST).map(([key, D], i) => ({
      key, title: D.title, device: D.device, minFree: D.minFree, minFreeTE: D.minFreeTE ?? null, rowTE: ROW_TE,
      note: typeof D.note === 'string' ? D.note : '',
      // Text des Medienfelds: steht je nach Stand in den Daten oder wird von der Seite erst beim Rendern gebildet
      media: typeof D.media === 'string' ? D.media : text(distEls[i] && distEls[i].querySelector('[data-row="Medien"]')),
      rows: D.rows.map(items => items.map(it => {
        const m = moduleOf(it), isSys = typeof it === 'object';
        return { label: m.label, sub: m.sub, te: m.te, sys: isSys, cid: m.cid || null, rcd: isSys && !!it.rcd, group: isSys ? it.group ?? null : null };
      })),
    })),
    material: {
      groups: materialGroups,
      totals: { sd: M.sd, sdOut: M.sdOut, liCeil: M.liCeil, liWall: M.liWall, rm: M.rm, net: M.net, fa: M.fa, rl: M.rl, th: M.th },
      cable: M.cable, withWaste: M.withWaste,
    },
    lengthNote: text(document.querySelector('#secCircuits p.small')),
    notes: [...document.querySelectorAll('#secNotes > ol > li')].map(li => ({ open: li.classList.contains('open'), html: li.innerHTML })),
  };
  if (!data.devices.length) throw new Error('DEVICES ist leer');
  if (!data.material.groups.length) throw new Error('Materialliste der Seite ist leer');
  return JSON.stringify(data);
}

function sandboxedSource(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="preconnect"]').forEach(el => el.remove());
  if (!doc.querySelector('script')) throw new Error('enthält kein Inline-Skript mit Plandaten');
  const probe = doc.createElement('script');
  probe.textContent = 'window.__initErrors = [];' +
    'addEventListener("error", e => __initErrors.push(e.message || "Skriptfehler"));' +
    'addEventListener("unhandledrejection", e => __initErrors.push(String((e.reason && e.reason.message) || e.reason)));';
  doc.head.prepend(probe);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

async function sha256Short(textValue) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(textValue));
  return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Lädt die Quelle, führt sie isoliert aus und liefert den Datenstand als einfaches Objekt (ohne Bezug zum iframe). */
export async function loadPlanData(sourceUrl) {
  const res = await fetch(sourceUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Quelle ${sourceUrl} nicht ladbar (HTTP ${res.status})`);
  const html = await res.text();
  let srcdoc;
  try { srcdoc = sandboxedSource(html); } catch (e) { throw new Error(`Quelle ${sourceUrl}: ${e.message}`); }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;border:0;visibility:hidden';
  const loaded = new Promise(r => frame.addEventListener('load', r, { once: true }));
  frame.srcdoc = srcdoc;
  document.body.append(frame);
  try {
    await loaded;
    const win = frame.contentWindow;
    const ready = 'typeof ROUTES === "object" && typeof CIRCUITS === "object" && typeof DEVICES === "object" && DEVICES.length > 0 && ' +
      'Object.keys(ROUTES).length === CIRCUITS.length + NETS.length + FEEDS.length && !!document.querySelector("#material .kv")';
    const deadline = performance.now() + INIT_TIMEOUT_MS;
    for (;;) {
      const errors = win.__initErrors || [];
      if (errors.length) throw new Error(`Quelle ${sourceUrl}: Fehler beim Ausführen – ${errors[0]}`);
      let ok = false;
      try { ok = win.eval(ready); } catch { ok = false; }
      if (ok) break;
      if (performance.now() > deadline) throw new Error(`Quelle ${sourceUrl}: Plandaten wurden nicht aufgebaut (DEVICES/ROUTES fehlen oder sind unvollständig)`);
      await new Promise(r => setTimeout(r, 50));
    }
    let json;
    try { json = win.eval(`(${extractPlanData.toString()})()`); } catch (e) { throw new Error(`Quelle ${sourceUrl}: Daten nicht lesbar – ${e.message}`); }
    const data = JSON.parse(json);
    data.sourceHash = await sha256Short(html);
    return data;
  } finally {
    frame.remove();
  }
}
