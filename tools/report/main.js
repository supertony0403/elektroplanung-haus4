/* Baut den Bericht für den Elektro-Fachbetrieb aus dem Datenstand von index.html auf.
 * Zustand für den Generator: window.__report = { state: 'loading' | 'ready' | 'error', … }.
 */
import { loadPlanData } from './quelle.js';
import { buildFloorPlan, buildLegend, buildScaleBar } from './grundriss.js';

window.__report = { state: 'loading' };

const TITLE = 'Elektroplanung Haus 4 – Planungsgrundlage für das Angebot';
const DISCLAIMER = 'Planungsstand des Bauherrn, keine Fachplanung. Auslegung, Querschnitte, Absicherung, Selektivität und Ausführung nach VDE/TAB durch den eingetragenen Elektrofachbetrieb. Maße aus Bestandsplänen ±20 cm, vor Ort prüfen.';
const PAGE = { w: 210, h: 297, top: 15, bottom: 14, side: 14 };   // mm; gilt für @page und die Platzberechnung der Grundrisse
const CONTENT = { w: PAGE.w - 2 * PAGE.side, h: PAGE.h - PAGE.top - PAGE.bottom };
const MM = 96 / 25.4;
/* Hinweise der Seite, die nur die 3D-Darstellung betreffen und im Angebot nichts verloren haben */
const SKIP_NOTES = [/^Ansicht\s/];
const OFFER_ITEMS = [
  ['Zählerplatz und Verteiler', 'Hauptverteiler mit Zählerplatz, Überspannungsschutz und Medienfeld; Unterverteiler je Etage, jeweils mit Bestückung und Reserve.'],
  ['Hauptleitungen', 'HV → Unterverteiler: Querschnitt, Vorsicherung/Selektivität, Leerrohre im Steigschacht.'],
  ['Stromkreise je Etage', 'KG, EG, OG und DG getrennt: Leitungen, Dosen, Schalter- und Steckdosenprogramm, Leuchtenauslässe, Rollladen- und Thermostat-Anschlüsse.'],
  ['Netzwerk', 'Cat-7-Verkabelung sternförmig, Doppeldosen, Patchpanel, Leerrohre, Messprotokoll.'],
  ['Wärmepumpen-Anschluss', 'Drehstromkreis nach Herstellerangabe, Schutzeinrichtungen, ggf. eigener Zähler.'],
  ['PV-Vorbereitung', 'Leerrohre vom HV bis unter das Dach, Erdungsleiter und Erdungsschiene.'],
  ['Stemm- und Putzarbeiten', 'Schlitze, Dosenbohrungen, Durchbrüche, Verschließen; Abgrenzung zu möglicher Eigenleistung.'],
  ['Prüfung und Dokumentation', 'Messungen, Prüfprotokoll, Stromkreisbeschriftung, Anmeldung und Inbetriebsetzung beim Netzbetreiber.'],
];

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* Gerätezahlen einer Auswahl */
function tally(devs) {
  const of = t => devs.filter(d => d.t === t);
  return {
    sd: sum(of('sd'), d => d.n), sdPos: of('sd').length, sw: sum(of('sw'), d => d.count), swPos: of('sw').length,
    li: of('li').length, liCeil: of('li').filter(d => d.mount === 'ceil').length, net: of('net').length,
    rl: of('rl').length, th: of('th').length, fa: of('fa').length, fa400: of('fa').filter(d => d.poles === 3).length, rm: of('rm').length,
  };
}

function coverPage(data, stand) {
  const all = tally(data.devices), M = data.material.totals;
  const nym = sum(data.cableOrder.filter(k => k !== 'cat7'), k => data.material.cable[k] || 0), cat = data.material.cable.cat7 || 0;
  const withWaste = sum(Object.values(data.material.withWaste), v => v);
  const floorIds = data.floors.map(f => f.id), uvs = data.dist.filter(d => d.key !== data.floors[0].dist).map(d => d.key);
  const hasHeatPump = data.circuits.some(c => /Wärmepumpe/i.test(c.name));
  const hasPv = data.material.groups.some(g => g.rows.some(r => /PV/.test(r.label)));
  const kv = [
    ['Endstromkreise', `${data.circuits.length} (${data.floors.map(f => `${f.id} ${data.circuits.filter(c => c.floor === f.id).length}`).join(' · ')})`],
    ['Hauptleitungen / Netzwerkstränge', `${data.feeds.length} Hauptleitungen HV → UV · ${data.nets.length} Netzwerkstränge zum Patchpanel`],
    ['Verteiler', `${data.dist.length} (${data.dist.map(d => d.key).join(', ')})`],
    ['Steckdosen', `${all.sd} Einsätze an ${all.sdPos} Stellen${M.sdOut ? `, davon ${M.sdOut} außen (IP44)` : ''}`],
    ['Schalter / Dimmer', `${all.sw} Einsätze an ${all.swPos} Stellen`],
    ['Leuchtenauslässe', `${all.li} (Decke ${all.liCeil}, Wand/außen ${all.li - all.liCeil})`],
    ['LAN-Doppeldosen', `${all.net} (${all.net * 2} Anschlüsse RJ45, Cat 7)`],
    ['Rollladen-Anschlüsse', String(all.rl)],
    ['Thermostat-Anschlüsse', String(all.th)],
    ['Festanschlüsse / Geräteanschlussdosen', `${all.fa}${all.fa400 ? `, davon ${all.fa400} Drehstrom 400 V` : ''}`],
    ['Rauchwarnmelder', String(all.rm)],
    ['Leitungslänge gesamt', `${fmt(nym + cat, 0)} m berechnet (Energie ${fmt(nym, 0)} m, Cat 7 ${fmt(cat, 0)} m); mit ${Math.round(data.zone.waste * 100)} % Verschnitt und Rundung ${fmt(withWaste, 0)} m`],
  ];
  const floorRows = data.floors.map(f => {
    const t = tally(data.devices.filter(d => d.floor === f.id)), cs = data.circuits.filter(c => c.floor === f.id);
    const net = data.nets.filter(n => n.floor === f.id);
    return `<tr><td><b>${f.id}</b> ${esc(f.name)}</td><td>${esc(f.dist)}</td><td class="n">${cs.length}</td><td class="n">${t.sd}</td><td class="n">${t.sw}</td><td class="n">${t.li}</td><td class="n">${t.net}</td><td class="n">${t.rl}</td><td class="n">${t.th}</td><td class="n">${fmt(sum(cs, c => c.length), 0)}</td><td class="n">${net.length ? fmt(sum(net, n => n.length), 0) : '–'}</td></tr>`;
  }).join('');
  return `<section class="cover">
    <p class="kicker">Unterlage für den Elektro-Fachbetrieb</p>
    <h1>Elektroplanung Haus 4</h1>
    <p class="subtitle">Planungsgrundlage für das Angebot</p>
    <p class="meta">Stand: ${stand} · erzeugt aus dem Planungswerkzeug (Datenstand ${esc(data.sourceHash)})</p>
    <h3>Vorhaben</h3>
    <p>Reihenhaus „Haus 4“ mit ${data.floors.length} Geschossen (${floorIds.join(', ')}). Die Elektroinstallation wird vollständig erneuert: <b>alle Leitungen neu</b>, Bestandsleitungen werden nicht weiterverwendet.
    Verteilerkonzept: Hauptverteiler ${esc(data.floors[0].dist)} im ${data.floors[0].id} mit Zählerplatz, von dort sternförmig je eine Hauptleitung zu einem Unterverteiler je Etage (${uvs.join(', ')}); jeder Verteiler versorgt nur sein Geschoss.
    ${data.nets.length ? 'Das Netzwerk (Cat 7) läuft sternförmig zum zentralen Patchpanel im Medienfeld des Hauptverteilers. ' : ''}${hasHeatPump ? 'Vorgesehen ist ein Drehstromanschluss für eine Wärmepumpe. ' : ''}${hasPv ? 'Für eine spätere PV-Anlage werden Leerrohre bis unter das Dach vorbereitet.' : ''}</p>
    <h3>Kennzahlen</h3>
    <table class="kv"><tbody>${kv.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
    <table class="grid compact"><thead><tr><th>Geschoss</th><th>Verteiler</th><th class="n">Strom&shy;kreise</th><th class="n">Steckd.-Einsätze</th><th class="n">Schalter</th><th class="n">Leuchten</th><th class="n">LAN-Dosen</th><th class="n">Roll&shy;laden</th><th class="n">Thermo&shy;stat</th><th class="n">Leitung m</th><th class="n">Cat 7 m</th></tr></thead><tbody>${floorRows}</tbody></table>
    <p class="small">Leitung m: Endstromkreise des Geschosses ohne Hauptleitungen (${fmt(sum(data.feeds, f => f.length), 0)} m) und ohne Verschnitt. Längen sind aus der modellierten Leitungsführung berechnet und dienen der Größenordnung, nicht als Aufmaß.</p>
    <div class="disclaimer"><b>Bitte beachten:</b> ${esc(DISCLAIMER)}</div>
    <ol class="toc">
      <li>Übersicht (diese Seite)</li>
      <li>Grundrisse je Geschoss mit Geräten und Stromkreisnummern (${floorIds.join(', ')})</li>
      <li>Raumtabellen je Geschoss: Gerät, Anzahl, Höhe über OKFF, Stromkreis, Bemerkung</li>
      <li>Verteiler: Stromkreise, RCD-Gruppen, Bestückung, Hauptleitungen</li>
      <li>Material- und Massenübersicht</li>
      <li>Annahmen, offene Punkte und gewünschte Gliederung des Angebots</li>
    </ol>
  </section>`;
}

/* Liefert die Grundriss-Seite und – für Räume, die im Maßstab des Geschossplans nicht lesbar zu beschriften sind – vergrößerte Details. */
function planPage(data, floor, legend, legendH, warnings) {
  const overhead = 8 + 7.5 + legendH + 3; // Überschrift, Maßstabszeile, Legende, Abstände (mm)
  const fit = { maxW: CONTENT.w, maxH: CONTENT.h - overhead };
  let plan = buildFloorPlan(data, floor, fit);
  const detailRooms = plan.crowded;
  if (detailRooms.length) plan = buildFloorPlan(data, floor, fit, { skipRooms: new Set(detailRooms) });
  plan.warnings.forEach(w => warnings.push(`Grundriss ${floor.id}: ${w}`));
  const details = detailRooms.map(id => {
    const room = data.rooms.find(r => r.id === id);
    const wM = Math.max(...room.poly.map(p => p[0])) - Math.min(...room.poly.map(p => p[0])) + 0.6;
    const scale = [10, 20, 25].find(sc => wM * 1000 / sc <= 135) || 25;
    const d = buildFloorPlan(data, floor, fit, { detailOf: id, scale });
    d.warnings.forEach(w => warnings.push(`Detail ${room.name} (${floor.id}): ${w}`));
    return `<figure class="detail">${d.svg}<figcaption><b>Detail ${esc(room.name)}</b> · Maßstab 1:${scale} · Symbole wie im Grundriss ${floor.id}</figcaption></figure>`;
  }).join('');
  const shafts = [...data.shafts.filter(s => s.floor === floor.id).map(s => s.label.replace(/\s*·\s*/, ': ')),
    ...data.fixtures.filter(f => f.floor === floor.id && f.label).map(f => f.label)];
  const html = `<section class="planpage" data-floor="${floor.id}">
    <h2>Grundriss ${floor.id} · ${esc(floor.name)}</h2>
    <div class="planwrap">${plan.svg}</div>
    <div class="plancap">${buildScaleBar(plan.scale)}<span><b>Maßstab 1:${plan.scale}</b> (A4, Druck in 100 %) · Verteiler ${esc(floor.dist)} · Raumgrenzen ${fmt(plan.sizeM[0], 2)} × ${fmt(plan.sizeM[1], 2)} m, Wandstärken nicht dargestellt · lichte Höhe ${fmt(floor.h, 2)} m${floor.roof ? ' (Dachschräge)' : ''} · Lage der Geräte ±20 cm, Höhen siehe Raumtabelle${shafts.length ? ' · ' + esc(shafts.join('; ')) : ''}</span></div>
    ${legend}
  </section>`;
  return { html, details };
}

function roomTable(data, floor, details) {
  const rooms = data.rooms.filter(r => r.floor === floor.id), roomName = Object.fromEntries(data.rooms.map(r => [r.id, r]));
  let body = '';
  for (const r of rooms) {
    const devs = data.devices.filter(d => d.room === r.id);
    if (!devs.length) { body += `<tr class="first"><td><b>${esc(r.name)}</b><br><span class="small">${fmt(r.area)} m²</span></td><td colspan="5" class="muted">keine Elektroausstattung geplant</td></tr>`; continue; }
    devs.forEach((d, i) => {
      const kinds = d.t === 'sw' ? Object.entries(d.kinds || { Aus: 1 }).map(([k, n]) => `${n > 1 ? n + '× ' : ''}${data.switchNames[k] || k}`).join(' + ') : '';
      // Art nur nennen, wenn die Bezeichnung sie nicht schon enthält
      const low = d.label.toLowerCase(), typeName = data.typeNames[d.t] || d.t;
      const type = d.t === 'sw' ? (Object.keys(d.kinds || { Aus: 1 }).every(k => low.includes((data.switchNames[k] || k).toLowerCase().slice(0, 6))) && d.count === 1 ? '' : kinds)
        : d.t === 'li' ? (/leuchte|spots/.test(low) ? '' : 'Leuchtenauslass')
        : low.includes(typeName.toLowerCase().slice(0, 6)) ? '' : typeName;
      const remarks = [];
      if (d.extra) remarks.push('Ergänzung (nicht im Plan des Bauherrn).');
      if (d.note) remarks.push(esc(d.note));
      if (d.lightRoom && roomName[d.lightRoom]) remarks.push(`Schaltet die Leuchte in: ${esc(roomName[d.lightRoom].name)} (${roomName[d.lightRoom].floor}).`);
      if (d.lights) remarks.push('Wippen: ' + d.lights.map((l, j) => `${j + 1} = ${esc(l.join(' + '))}`).join(', ') + '.');
      if (d.poles === 3) remarks.push('Drehstrom 400 V.');
      const height = d.mount === 'ceil' ? `Decke ${fmt(d.h, 2)} m` : `${fmt(d.h, 2)} m`;
      body += `<tr class="${i === 0 ? 'first' : ''}"><td>${i === 0 ? `<b>${esc(r.name)}</b><br><span class="small">${fmt(r.area)} m²${r.kind === 'out' ? ' · außen' : ''}</span>` : `<span class="rep">${esc(r.name)}</span>`}</td>
        <td>${esc(d.label)}${type ? `<br><span class="small">${esc(type)}</span>` : ''}</td><td class="n">${d.count}</td><td class="n">${height}</td><td class="c"><b>${esc(d.c || '–')}</b></td><td class="small">${remarks.join(' ')}</td></tr>`;
    });
  }
  return `<section class="tablesec">
    ${details ? `<h2>Details ${floor.id} · ${esc(floor.name)}</h2><p class="sub">Räume, deren Geräte im Geschossgrundriss zu dicht liegen, vergrößert.</p><div class="details">${details}</div>` : ''}
    <h2>Raumtabelle ${floor.id} · ${esc(floor.name)}</h2>
    <p class="sub">Höhe = Mitte Gerät über Oberkante Fertigfußboden (OKFF). Anzahl: bei Steckdosen Einsätze im gemeinsamen Rahmen, bei Schaltern Wippen/Einsätze. Stromkreise aus ${esc(floor.dist)}, soweit nicht anders vermerkt.</p>
    <table class="grid rooms"><colgroup><col style="width:15%"><col style="width:27%"><col style="width:6%"><col style="width:11%"><col style="width:7%"><col></colgroup>
    <thead><tr><th>Raum</th><th>Gerät</th><th class="n">Anzahl</th><th class="n">Höhe über OKFF</th><th class="c">Strom&shy;kreis</th><th>Bemerkung</th></tr></thead><tbody>${body}</tbody></table>
  </section>`;
}

function distSection(data, warnings) {
  const roomOf = Object.fromEntries(data.rooms.map(r => [r.id, r]));
  let html = `<section class="tablesec"><h2>Verteiler</h2>
    <p class="sub">Je Geschoss ein Verteiler. Belegung in Teilungseinheiten (TE) aus dem Planungswerkzeug; Bemessung, Selektivität und endgültige Bestückung legt der Fachbetrieb fest.</p>`;
  for (const D of data.dist) {
    const dev = data.devices.find(d => d.id === D.device), room = dev ? roomOf[dev.room] : null;
    const circuits = data.circuits.filter(c => c.dist === D.key);
    const placed = new Set(D.rows.flat().filter(m => !m.sys).map(m => m.cid));
    const missing = circuits.filter(c => !placed.has(c.id)).map(c => c.id), foreign = [...placed].filter(id => !circuits.some(c => c.id === id));
    if (missing.length) warnings.push(`Verteiler ${D.key}: Stromkreis(e) ${missing.join(', ')} fehlen in der Belegung`);
    if (foreign.length) warnings.push(`Verteiler ${D.key}: Belegung enthält fremde Kreise ${foreign.join(', ')}`);
    const rcdMods = D.rows.flat().filter(m => m.rcd);
    const rcdCell = c => {
      if (!c.rcd) return '–';
      const name = c.rcdText || String(c.rcd);
      const mod = rcdMods.find(m => (m.group !== null ? String(m.group) === String(c.rcd) : name.startsWith(m.label)));
      return `${esc(name)}${mod ? `<br><span class="small">${esc(mod.sub)}</span>` : ''}`;
    };
    const cRows = circuits.map(c => {
      const extra = c.byCable.filter(b => b.k !== c.cable);
      return `<tr><td class="c"><b>${c.id}</b></td><td>${esc(c.name)}</td><td>${rcdCell(c)}</td><td>${esc(c.prot)}</td>
        <td>${esc(c.cableName)}${extra.length ? `<br><span class="small">Schalterltg.: ${extra.map(b => `${esc(b.name)} ${fmt(b.m)} m`).join(', ')}</span>` : ''}</td>
        <td class="small">${esc(c.summary)}</td><td class="n">${fmt(c.length)} m</td></tr>`;
    }).join('');
    let used = 0;
    const railRows = D.rows.map((mods, i) => {
      const te = sum(mods, m => m.te); used += te;
      if (te > D.rowTE) warnings.push(`Verteiler ${D.key}, Reihe ${i + 1}: ${te} TE belegt, Reihe hat ${D.rowTE} TE`);
      return `<tr><td class="c">${i + 1}</td><td>${mods.map(m => `<span class="mod"><b>${esc(m.label)}</b> ${esc(m.sub)} <span class="small">(${m.te} TE)</span></span>`).join(' · ')}</td><td class="n">${te}</td><td class="n">${D.rowTE - te}</td></tr>`;
    }).join('');
    const cap = D.rows.length * D.rowTE, free = cap - used, ok = free / cap >= D.minFree && (!D.minFreeTE || free >= D.minFreeTE);
    const spd = D.rows.flat().filter(m => m.label === 'SPD').map(m => m.sub);
    const feed = data.feeds.find(f => f.uv === D.key);
    const facts = [
      dev && room ? `<b>Lage:</b> ${esc(room.name)} (${room.floor}), Mitte ${fmt(dev.h, 2)} m über OKFF${dev.w && dev.hh ? `, Platzbedarf im Modell ca. ${fmt(dev.w, 2)} × ${fmt(dev.hh, 2)} m` : ''}. ${esc(dev.note)}` : '',
      feed ? `<b>Einspeisung:</b> ${esc(feed.name)}, ${esc(feed.cableName)}, ${esc(feed.prot)}; Leitungsweg ${fmt(feed.path)} m, mit Anschlussreserve ${fmt(feed.length)} m.` : '',
      `<b>Reserve:</b> ${cap} TE in ${D.rows.length} Reihen, belegt ${used} TE, frei ${free} TE = ${Math.round(free / cap * 100)} % (Vorgabe mindestens ${Math.round(D.minFree * 100)} %${D.minFreeTE ? ` und ${D.minFreeTE} freie Plätze` : ''}: ${ok ? 'erfüllt' : 'NICHT erfüllt'}).`,
      `<b>Überspannungsschutz (SPD):</b> ${spd.length ? esc(spd.join(', ')) : 'in diesem Verteiler nicht vorgesehen'}.`,
      D.media ? `<b>Medienfeld:</b> ${esc(D.media.replace(/^Medienfeld:\s*/, ''))}` : '',
      D.note ? `<b>Hinweis:</b> ${esc(D.note)}` : '',
    ].filter(Boolean);
    if (!ok) warnings.push(`Verteiler ${D.key}: Reserve-Vorgabe nicht erfüllt`);
    html += `<div class="dist"><h3>${esc(D.title)}</h3>
      <table class="grid"><colgroup><col style="width:6%"><col style="width:21%"><col style="width:21%"><col style="width:11%"><col style="width:15%"><col><col style="width:9%"></colgroup>
      <thead><tr><th class="c">Kreis</th><th>Bezeichnung</th><th>RCD-Gruppe</th><th>Absicherung</th><th>Leitung</th><th>Auslässe</th><th class="n">Leitungs&shy;länge</th></tr></thead>
      <tbody>${cRows}</tbody><tfoot><tr><td colspan="6">Summe ${circuits.length} Stromkreise (ohne Verschnitt)</td><td class="n">${fmt(sum(circuits, c => c.length))} m</td></tr></tfoot></table>
      <table class="grid rails"><colgroup><col style="width:7%"><col><col style="width:8%"><col style="width:8%"></colgroup>
      <thead><tr><th class="c">Reihe</th><th>Bestückung (${D.rowTE} TE je Reihe)</th><th class="n">belegt</th><th class="n">frei</th></tr></thead><tbody>${railRows}</tbody></table>
      <ul class="facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul></div>`;
  }
  const feedRows = data.feeds.map(f => `<tr><td class="c"><b>${f.id}</b></td><td>${esc(f.name)}</td><td>${esc(f.prot)}</td><td>${esc(f.cableName)}</td><td class="n">${fmt(f.path)} m</td><td class="n">${fmt(f.length)} m</td></tr>`).join('');
  const netRows = data.nets.map(n => `<tr><td class="c"><b>${n.id}</b></td><td>${esc(n.name)}</td><td class="n">${n.sockets}</td><td>${esc(n.cableName)}, 2 Leitungen je Doppeldose</td><td class="n">${fmt(n.path)} m</td><td class="n">${fmt(n.length)} m</td></tr>`).join('');
  html += `<div class="dist"><h3>Hauptleitungen HV → Unterverteiler</h3>
    <table class="grid"><thead><tr><th class="c">Nr.</th><th>Bezeichnung</th><th>Absicherung</th><th>Leitung (Annahme)</th><th class="n">Leitungsweg</th><th class="n">Länge mit Anschlussreserve</th></tr></thead><tbody>${feedRows}</tbody></table>
    <h3>Netzwerk</h3>
    <table class="grid"><thead><tr><th class="c">Nr.</th><th>Bezeichnung</th><th class="n">Doppel&shy;dosen</th><th>Leitung</th><th class="n">Summe der Wege</th><th class="n">Leitungslänge</th></tr></thead><tbody>${netRows}</tbody></table>
    ${data.lengthNote ? `<p class="small"><b>Zur Längenberechnung:</b> ${esc(data.lengthNote)}</p>` : ''}</div></section>`;
  return html;
}

function materialSection(data) {
  const groups = data.material.groups.map(g => `<div class="matgroup"><table class="grid"><thead><tr><th>${esc(g.title)}</th><th class="n">Menge</th></tr></thead>
    <tbody>${g.rows.map(r => `<tr><td>${esc(r.label)}${r.sub ? `<br><span class="small">${esc(r.sub)}</span>` : ''}</td><td class="n"><b>${esc(r.value)}</b></td></tr>`).join('')}</tbody></table>
    ${g.notes.map(n => `<p class="small">${esc(n)}</p>`).join('')}</div>`).join('');
  return `<section class="tablesec"><h2>Material- und Massenübersicht</h2>
    <p class="sub">Mengen aus den Berechnungen des Planungswerkzeugs (Leitungsführung nach Installationszonen). Richtwerte für die Kalkulation, kein Aufmaß.</p>
    <div class="matcols">${groups}</div></section>`;
}

/* Hinweistexte der Seite übernehmen; nur harmlose Auszeichnung bleibt erhalten */
function cleanNote(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const keep = new Set(['STRONG', 'B', 'EM', 'I', 'BR', 'UL', 'OL', 'LI']);
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      walk(child);
      if (!keep.has(child.tagName)) child.replaceWith(...child.childNodes);
      else for (const a of [...child.attributes]) child.removeAttribute(a.name);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML.replace(/(<br>\s*)+$/i, '').trim();
}
function notesSection(data) {
  const notes = data.notes.map(n => ({ ...n, html: cleanNote(n.html) }))
    .filter(n => !SKIP_NOTES.some(rx => rx.test(n.html.replace(/<[^>]+>/g, ''))));
  const general = notes.filter(n => !n.open), open = notes.filter(n => n.open);
  return `<section class="tablesec notes"><h2>Annahmen und offene Punkte</h2>
    <p class="sub">Aus dem Planungswerkzeug übernommen, als Grundlage für das Gespräch. „Infokarte“ meint dort die Detailanzeige eines Geräts; die Angaben stehen hier in der Spalte „Bemerkung“ der Raumtabellen.</p>
    <h3>Annahmen und Hinweise der Planung</h3>
    <ol>${general.map(n => `<li>${n.html}</li>`).join('')}</ol>
    ${open.map(n => `<div class="openbox">${n.html}</div>`).join('')}
    <h3>Bitte im Angebot ausweisen</h3>
    <ol class="offer">${OFFER_ITEMS.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ol>
  </section>`;
}

function pageStyle(stand) {
  const q = s => `"${s.replace(/"/g, '\\"')}"`;
  const style = document.createElement('style');
  const box = 'font: 7.5pt "Liberation Sans", Arial, Helvetica, sans-serif; color: #444; white-space: nowrap;';
  const head = `${box} vertical-align: bottom; padding-bottom: 2.5mm;`, foot = `${box} vertical-align: top; padding-top: 2.5mm;`;
  style.textContent = `@page { size: A4; margin: ${PAGE.top}mm ${PAGE.side}mm ${PAGE.bottom}mm ${PAGE.side}mm;
    @top-left { content: ${q(TITLE)}; ${head} }
    @top-right { content: ${q('Stand ' + stand)}; ${head} }
    @bottom-left { content: "Planungsstand des Bauherrn, keine Fachplanung"; ${foot} }
    @bottom-right { content: "Seite " counter(page) " von " counter(pages); ${foot} }
  }
  #report { width: ${CONTENT.w - 0.6}mm; }`;
  document.head.append(style);
}

function crossChecks(data, warnings) {
  const circuitIds = new Set([...data.circuits, ...data.nets, ...data.feeds].map(c => c.id));
  const unknown = data.devices.filter(d => d.c && !circuitIds.has(d.c));
  if (unknown.length) warnings.push(`Geräte mit unbekanntem Stromkreis: ${unknown.map(d => `${d.label} (${d.c})`).join(', ')}`);
  const empty = data.circuits.filter(c => !data.devices.some(d => d.c === c.id));
  if (empty.length) warnings.push(`Stromkreise ohne Gerät: ${empty.map(c => c.id).join(', ')}`);
  const sd = sum(data.devices.filter(d => d.t === 'sd'), d => d.n);
  if (sd !== data.material.totals.sd) warnings.push(`Steckdosen-Einsätze: Geräteliste ${sd}, Materialliste ${data.material.totals.sd}`);
  const viol = data.devices.filter(d => d.bathViolation);
  if (viol.length) warnings.push(`Geräte im Schutzbereich 2: ${viol.map(d => d.label).join(', ')}`);
  const cross = data.devices.filter(d => d.c && data.circuits.some(c => c.id === d.c && c.floor !== d.floor));
  if (cross.length) warnings.push(`Geräte an einem Stromkreis eines anderen Geschosses (in der Raumtabelle vermerkt): ${cross.map(d => `${d.label} [${d.floor} → ${d.c}]`).join('; ')}`);
}

async function build() {
  const source = new URLSearchParams(location.search).get('quelle') || '/index.html';
  const data = await loadPlanData(source);
  const stand = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const warnings = [];
  pageStyle(stand);
  const root = document.getElementById('report');

  // Höhe der Legende messen, damit der Grundriss den Rest der Seite nutzen kann
  const legend = buildLegend(data);
  root.innerHTML = legend;
  await document.fonts.ready;
  const legendH = root.firstElementChild.getBoundingClientRect().height / MM;

  const parts = [coverPage(data, stand)];
  for (const floor of data.floors) {
    const page = planPage(data, floor, legend, legendH, warnings);
    parts.push(page.html, roomTable(data, floor, page.details));
  }
  parts.push(distSection(data, warnings), materialSection(data), notesSection(data));
  root.innerHTML = parts.join('\n');
  crossChecks(data, warnings);

  await document.fonts.ready;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const el of root.querySelectorAll('.planpage, .cover')) {
    const h = el.getBoundingClientRect().height / MM;
    if (h > CONTENT.h + 0.5) warnings.push(`${el.dataset.floor ? 'Grundriss ' + el.dataset.floor : 'Deckblatt'} ist ${fmt(h - CONTENT.h)} mm zu hoch für eine Seite`);
  }
  if (!root.querySelector('svg.plan') || root.querySelectorAll('table tbody tr').length < 20) throw new Error('Bericht ist unvollständig (Grundrisse oder Tabellen fehlen)');

  document.title = TITLE;
  const all = tally(data.devices);
  window.__report = {
    state: 'ready', warnings, data,
    stats: { stand, hash: data.sourceHash, circuits: data.circuits.length, sockets: all.sd, devices: data.devices.length },
  };
}

build().catch(e => {
  console.error(e);
  document.title = 'FEHLER – Bericht nicht aufgebaut';
  document.getElementById('report').textContent = '';
  window.__report = { state: 'error', message: e && e.message ? e.message : String(e) };
});
