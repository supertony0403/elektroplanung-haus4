/* Grundriss je Geschoss als maßstäbliches SVG (Einheit: mm auf dem Papier).
 * Eingabe ist ausschließlich der Datenstand aus quelle.js; hier stehen nur Zeichenregeln.
 *
 * Zeichenregeln:
 *  - Raumgrenzen als Wandlinien, Öffnungen ausgespart (Wandstärken sind in den Daten nicht enthalten).
 *  - Wandgeräte stehen an ihrer Wandstelle und zeigen in den Raum. Liegen mehrere an derselben Stelle
 *    (verschiedene Höhen), werden sie entlang der Wand nebeneinander geschoben; passt das nicht,
 *    wird das Symbol herausgezogen und mit einer Hinweislinie an die Wandstelle gebunden.
 *  - Die Stromkreisnummer steht in Verlängerung des Symbols; bei Platzmangel weicht sie aus.
 */

const FONT = '"Liberation Sans", Arial, Helvetica, sans-serif';
const STROKE = 0.28;          // Symbol-Linienstärke
const LABEL_FS = 2.25;        // Stromkreisnummer
const SCALES = [50, 75, 100, 125, 150, 200];
const OUT_MARGIN_M = 0.6;     // Außenbereiche (Kelleraußentreppe) höchstens so weit über das Haus hinaus zeichnen

const r2 = v => +v.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDe = (v, d = 1) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(str, fs, bold = false) {
  measureCtx.font = `${bold ? 700 : 400} 100px ${FONT}`;
  return measureCtx.measureText(str).width * fs / 100;
}

function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const boxInPoly = (poly, b, tol = 0.05) => [[b.x0 + tol, b.y0 + tol], [b.x1 - tol, b.y0 + tol], [b.x1 - tol, b.y1 - tol], [b.x0 + tol, b.y1 - tol],
  [(b.x0 + b.x1) / 2, b.y0 + tol], [(b.x0 + b.x1) / 2, b.y1 - tol], [b.x0 + tol, (b.y0 + b.y1) / 2], [b.x1 - tol, (b.y0 + b.y1) / 2]]
  .every(([x, y]) => pointInPoly(poly, x, y));
const boxesOverlap = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/* ---------- Symbole ----------
   Lokales Koordinatensystem: Ursprung an der Wand, a entlang der Wand, b in den Raum hinein (mm). */
class Pen {
  constructor(origin, U, N) { this.o = origin; this.U = U; this.N = N; this.out = []; }
  pt(a, b) { return [this.o[0] + a * this.U[0] + b * this.N[0], this.o[1] + a * this.U[1] + b * this.N[1]]; }
  line(pts, w = STROKE) {
    this.out.push(`<polyline points="${pts.map(([a, b]) => this.pt(a, b).map(r2).join(',')).join(' ')}" fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  poly(pts, fill = '#000') {
    this.out.push(`<polygon points="${pts.map(([a, b]) => this.pt(a, b).map(r2).join(',')).join(' ')}" fill="${fill}" stroke="#000" stroke-width="${STROKE}" stroke-linejoin="round"/>`);
  }
  circle(a, b, r, fill = '#fff') {
    const [x, y] = this.pt(a, b);
    this.out.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill}" stroke="#000" stroke-width="${STROKE}"/>`);
  }
  text(a, b, str, fs = 2.0) {
    const [x, y] = this.pt(a, b);
    this.out.push(`<text x="${r2(x)}" y="${r2(y)}" font-size="${fs}" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(str)}</text>`);
  }
  box(a0, a1, b0, b1, fill = '#fff') { this.poly([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], fill); }
  bounds(halfW, depth, pad = 0.15) {
    const c = [this.pt(-halfW - pad, -pad), this.pt(halfW + pad, -pad), this.pt(halfW + pad, depth + pad), this.pt(-halfW - pad, depth + pad)];
    return { x0: Math.min(...c.map(p => p[0])), x1: Math.max(...c.map(p => p[0])), y0: Math.min(...c.map(p => p[1])), y1: Math.max(...c.map(p => p[1])) };
  }
}
const arc = (ca, cb, r, t0, t1, n = 14) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (t0 + (t1 - t0) * i / n) * Math.PI / 180;
  return [ca + r * Math.cos(t), cb + r * Math.sin(t)];
});

const SW_C = 1.55, SW_R = 0.8, SW_LEVER = 1.25;
function lever(p, deg, end = 'flag') {
  const t = deg * Math.PI / 180, d = [Math.cos(t), Math.sin(t)];
  const s = [d[0] * SW_R, SW_C + d[1] * SW_R], e = [d[0] * (SW_R + SW_LEVER), SW_C + d[1] * (SW_R + SW_LEVER)];
  p.line([s, e]);
  const q = d[0] * d[1] > 0 ? [d[1], -d[0]] : [-d[1], d[0]]; // Fähnchen spiegelbildlich, nie über die Wandlinie hinaus
  if (end === 'flag') p.line([e, [e[0] + q[0] * 0.65, e[1] + q[1] * 0.65]]);
  if (end === 'arrow') p.poly([[e[0] + d[0] * 0.55, e[1] + d[1] * 0.55], [e[0] + q[0] * 0.45, e[1] + q[1] * 0.45], [e[0] - q[0] * 0.45, e[1] - q[1] * 0.45]]);
}
const SWITCH_DRAW = {
  Aus: p => lever(p, 45),
  Wechsel: p => { lever(p, 45); lever(p, 225); },
  Serie: p => { lever(p, 45); lever(p, 135); },
  SerieWechsel: p => { lever(p, 45); lever(p, 135); lever(p, 225); },
  Kreuz: p => { for (const a of [45, 135, 225, 315]) lever(p, a, 'none'); },
  Dimmer: p => lever(p, 45, 'arrow'),
  Kontroll: p => { lever(p, 45); p.line([[-0.45, SW_C - 0.45], [0.45, SW_C + 0.45]], 0.2); p.line([[-0.45, SW_C + 0.45], [0.45, SW_C - 0.45]], 0.2); },
  Taster: p => p.circle(0, SW_C, 0.32, '#000'),
};
function switchSymbol(kind) {
  return {
    halfW: 1.95, depth: 3.05,
    draw(p) { p.line([[0, 0], [0, SW_C - SW_R]]); p.circle(0, SW_C, SW_R); (SWITCH_DRAW[kind] || SWITCH_DRAW.Aus)(p); },
  };
}
const boxed = (letter, half = 1.4) => ({
  halfW: half, depth: 0.5 + 2 * half,
  draw(p) { p.line([[0, 0], [0, 0.5]]); p.box(-half, half, 0.5, 0.5 + 2 * half); p.text(0, 0.5 + half, letter); },
});
const SYMBOLS = {
  sd: { halfW: 1.5, depth: 2.5, draw(p) { p.line([[0, 0], [0, 1.0]]); p.line([[-1.15, 1.0], [1.15, 1.0]]); p.line(arc(0, 2.5, 1.5, 180, 360)); } },
  'li:wall': { halfW: 1.3, depth: 3.1, draw(p) {
    p.box(-1.3, 1.3, 0, 0.35, '#000'); p.line([[0, 0.35], [0, 0.5]]); p.circle(0, 1.8, 1.3);
    p.line([[-0.92, 0.88], [0.92, 2.72]]); p.line([[-0.92, 2.72], [0.92, 0.88]]);
  } },
  net: { halfW: 1.3, depth: 3.1, draw(p) { p.line([[0, 0], [0, 0.5]]); p.box(-1.3, 1.3, 0.5, 3.1); p.poly([[-1.3, 0.5], [1.3, 3.1], [-1.3, 3.1]]); } },
  fa: { halfW: 1.15, depth: 2.8, draw(p) { p.line([[0, 0], [0, 0.5]]); p.box(-1.15, 1.15, 0.5, 2.8, '#000'); } },
  rl: boxed('R'),
  th: boxed('T'),
  kl: { halfW: 1.3, depth: 2.75, draw(p) { p.line([[0, 0], [0, 0.7]]); p.poly([...arc(0, 0.7, 1.3, 0, 180), [-1.3, 0.7]]); p.circle(0, 2.4, 0.3, '#000'); } },
  pas: { halfW: 2.0, depth: 1.6, draw(p) { p.line([[0, 0], [0, 0.5]]); p.box(-2.0, 2.0, 0.5, 1.6); for (const a of [-1.2, 0, 1.2]) p.circle(a, 1.05, 0.2, '#000'); } },
  // an der Decke: Mittelpunkt im Ursprung
  'li:ceil': { r: 1.6, draw(p) { p.circle(0, 0, 1.6); p.line([[-1.13, -1.13], [1.13, 1.13]]); p.line([[-1.13, 1.13], [1.13, -1.13]]); } },
  rm: { r: 1.5, draw(p) { p.circle(0, 0, 1.5); p.circle(0, 0, 0.55, '#000'); } },
};
const firstKind = d => Object.keys(d.kinds || { Aus: 1 })[0];
function symbolOf(d, k) {
  if (d.t === 'uv') {
    const half = Math.max(1.6, (d.w || 0.4) * k / 2);
    return { halfW: half, depth: 2.2, draw(p) { p.box(-half, half, 0, 2.2, '#000'); } };
  }
  if (d.t === 'sw') return switchSymbol(firstKind(d));
  if (d.t === 'li') return d.mount === 'ceil' ? SYMBOLS['li:ceil'] : SYMBOLS['li:wall'];
  return SYMBOLS[d.t] || SYMBOLS.fa;
}

function labelParts(d) {
  if (d.t === 'uv') return [{ t: d.id, bold: true }];
  if (d.t === 'pas') return [{ t: 'PAS', bold: false }];
  if (!d.c) return null;
  const parts = [];
  if (d.count > 1) parts.push({ t: `${d.count}× `, bold: false });
  parts.push({ t: d.c, bold: true });
  if (d.t === 'fa' && d.poles === 3) parts.push({ t: ' 400 V', bold: false });
  return parts;
}
const partsWidth = (parts, fs) => parts.reduce((w, p) => w + textWidth(p.t, fs, p.bold), 0);
function textSvg(x, y, parts, fs, vertical) {
  const spans = parts.map(p => `<tspan font-weight="${p.bold ? 700 : 400}">${esc(p.t)}</tspan>`).join('');
  return `<text x="${r2(x)}" y="${r2(y)}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" class="halo" style="white-space:pre"${vertical ? ` transform="rotate(-90 ${r2(x)} ${r2(y)})"` : ''}>${spans}</text>`;
}

/* ---------- Legende ---------- */
function legendIcon(sym, wall) {
  const p = new Pen(wall ? [0, 0.4] : [0, 2.3], [1, 0], [0, 1]);
  sym.draw(p);
  const wallLine = wall ? '<line x1="-2.6" y1="0.4" x2="2.6" y2="0.4" stroke="#000" stroke-width="0.6"/>' : '';
  return `<svg class="ico" viewBox="-2.8 0 5.6 4.6" width="5.6mm" height="4.6mm" font-family='${FONT}' aria-hidden="true">${wallLine}${p.out.join('')}</svg>`;
}
const lineIcon = inner => `<svg class="ico" viewBox="0 0 5.6 4.6" width="5.6mm" height="4.6mm" aria-hidden="true">${inner}</svg>`;

/** Legende für alle Geräte- und Schalterarten, die im Datenstand vorkommen. */
export function buildLegend(data) {
  const has = t => data.devices.some(d => d.t === t);
  const items = [];
  const add = (icon, label) => items.push(`<span class="leg">${icon}<span>${esc(label)}</span></span>`);
  if (has('sd')) add(legendIcon(SYMBOLS.sd, true), 'Steckdose (3× = 3-fach)');
  const kinds = [...new Set(data.devices.filter(d => d.t === 'sw').map(firstKind))];
  for (const kind of kinds) add(legendIcon(switchSymbol(kind), true), data.switchNames[kind] || kind);
  if (data.devices.some(d => d.t === 'li' && d.mount === 'ceil')) add(legendIcon(SYMBOLS['li:ceil'], false), 'Leuchte Decke');
  if (data.devices.some(d => d.t === 'li' && d.mount !== 'ceil')) add(legendIcon(SYMBOLS['li:wall'], true), 'Leuchte Wand');
  if (has('net')) add(legendIcon(SYMBOLS.net, true), 'LAN-Doppeldose');
  if (has('fa')) add(legendIcon(SYMBOLS.fa, true), 'Festanschluss');
  if (has('rl')) add(legendIcon(SYMBOLS.rl, true), 'Rollladen');
  if (has('th')) add(legendIcon(SYMBOLS.th, true), 'Thermostat');
  if (has('rm')) add(legendIcon(SYMBOLS.rm, false), data.typeNames.rm);
  if (has('kl')) add(legendIcon(SYMBOLS.kl, true), 'Klingel/Sprechstelle');
  if (has('pas')) add(legendIcon(SYMBOLS.pas, true), 'Potentialausgleich');
  if (has('uv')) add(legendIcon({ draw: p => p.box(-2.2, 2.2, 0, 2.2, '#000') }, true), 'Verteiler');
  add(lineIcon('<path d="M0.3 2.3h1M4.3 2.3h1" stroke="#000" stroke-width="0.6"/><path d="M1.3 1.85h3M1.3 2.75h3M1.3 1.7v1.2M4.3 1.7v1.2" stroke="#000" stroke-width="0.2" fill="none"/>'), 'Fenster');
  add(lineIcon('<path d="M0.3 2.3h1M4.3 2.3h1" stroke="#000" stroke-width="0.6"/><path d="M1.3 1.7v1.2M4.3 1.7v1.2" stroke="#000" stroke-width="0.2"/>'), 'Tür / Durchgang');
  add(lineIcon('<rect x="0.5" y="0.9" width="4.6" height="2.8" fill="none" stroke="#000" stroke-width="0.2" stroke-dasharray="0.8 0.5"/>'), 'Schutzbereich 2');
  add(lineIcon('<rect x="1.2" y="1" width="3.2" height="2.6" fill="#bbb" stroke="#000" stroke-width="0.2"/>'), 'Steigschacht');
  add(lineIcon('<path d="M1 1h3.6v2.6H1zM1 1l3.6 2.6M1 3.6L4.6 1" fill="none" stroke="#000" stroke-width="0.2"/>'), 'Schornstein');
  add(lineIcon('<circle cx="1" cy="2.3" r="0.4"/><path d="M1 2.3L5 1.2" stroke="#000" stroke-width="0.15"/>'), 'herausgezogen, Punkt = Wandstelle');
  return `<div class="legend">${items.join('')}</div>`;
}

/* ---------- Grundriss ---------- */
function relax(items, lo, hi, gap) {
  // items: nach Wunschlage sortiert; schiebt überlappende Symbole entlang der Wand auseinander
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < items.length; i++) {
      const a = items[i], b = items[i + 1], need = a.half + b.half + gap - (b.pos - a.pos);
      if (need > 1e-4) { a.pos -= need / 2; b.pos += need / 2; moved = true; }
    }
    for (const it of items) {
      const c = Math.min(Math.max(it.pos, lo + it.half), hi - it.half);
      if (Math.abs(c - it.pos) > 1e-4) { it.pos = c; moved = true; }
    }
    if (!moved) break;
  }
}

/**
 * @param data  Datenstand aus quelle.js
 * @param floor Eintrag aus data.floors
 * @param fit   { maxW, maxH } verfügbare Zeichenfläche in mm
 * @returns {{ svg: string, scale: number, width: number, height: number, sizeM: [number, number], warnings: string[], crowded: string[] }}
 *          crowded: Räume, die in diesem Maßstab nicht sauber zu beschriften sind (Kandidaten für ein Detail)
 */
export function buildFloorPlan(data, floor, fit, opts = {}) {
  // opts.skipRooms: Räume, deren Geräte hier fehlen (sie bekommen ein Detail); opts.detailOf + opts.scale: Detail eines Raums
  const detail = opts.detailOf || null, skip = opts.skipRooms || new Set(), uid = detail ? `${floor.id}-detail-${detail}` : floor.id;
  const rooms = data.rooms.filter(r => r.floor === floor.id);
  const devices = data.devices.filter(d => d.floor === floor.id && (detail ? d.room === detail : !skip.has(d.room)));
  const warnings = [], score = new Map(); // Raum → Platznot (herausgezogenes Symbol 1, Beschriftung ohne Platz 2)
  const bump = (id, n) => score.set(id, (score.get(id) || 0) + n);
  const indoor = rooms.filter(r => r.kind !== 'out');
  const ext = (list, i, fn) => fn(...list.flatMap(r => r.poly.map(p => p[i])));
  const house = { x0: ext(indoor, 0, Math.min), x1: ext(indoor, 0, Math.max), y0: ext(indoor, 1, Math.min), y1: ext(indoor, 1, Math.max) };
  let view = {
    x0: Math.max(ext(rooms, 0, Math.min), house.x0 - OUT_MARGIN_M), x1: Math.min(ext(rooms, 0, Math.max), house.x1 + OUT_MARGIN_M),
    y0: Math.max(ext(rooms, 1, Math.min), house.y0 - OUT_MARGIN_M), y1: Math.min(ext(rooms, 1, Math.max), house.y1 + OUT_MARGIN_M),
  };
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  if (detail) {
    const one = [roomById[detail]], m = 0.3;
    view = { x0: ext(one, 0, Math.min) - m, x1: ext(one, 0, Math.max) + m, y0: ext(one, 1, Math.min) - m, y1: ext(one, 1, Math.max) + m };
  }
  const insideAnyRoom = (x, y) => rooms.some(r => pointInPoly(r.poly, x, y));

  // Wandgeräte ihrer Raumkante zuordnen (in Metern)
  const edgesOf = r => r.poly.map((a, i) => {
    const b = r.poly[(i + 1) % r.poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const U = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return { i, a, b, len, U, N: [-U[1], U[0]] };
  });
  const roomEdges = Object.fromEntries(rooms.map(r => [r.id, edgesOf(r)]));
  const wallItems = [], ceilItems = [];
  for (const d of devices) {
    const room = roomById[d.room];
    if (d.mount === 'ceil') { ceilItems.push({ d, room }); continue; }
    let best = null;
    for (const e of roomEdges[d.room]) {
      if (e.N[0] * d.nx + e.N[1] * d.ny < 0.9) continue;
      const t = (d.x - e.a[0]) * e.U[0] + (d.y - e.a[1]) * e.U[1];
      const dist = Math.abs((d.x - e.a[0]) * e.N[0] + (d.y - e.a[1]) * e.N[1]);
      if (t < -0.02 || t > e.len + 0.02 || dist > 0.1) continue;
      if (!best || dist < best.dist) best = { e, t, dist };
    }
    if (!best) throw new Error(`Gerät „${d.label}“ (${room.name}) liegt an keiner Wand seines Raums`);
    // Außengeräte, die einem Innenraum zugeordnet sind (z. B. Außenleuchte am Eingang), auf die Außenseite zeichnen
    const wx = best.e.a[0] + best.e.U[0] * best.t, wy = best.e.a[1] + best.e.U[1] * best.t;
    const outside = room.kind !== 'out' && /außen/i.test(d.label) && !insideAnyRoom(wx - best.e.N[0] * 0.4, wy - best.e.N[1] * 0.4);
    wallItems.push({ d, room, edge: best.e, t: best.t, outside });
  }

  // Maßstab und Ränder
  const sideHasOutside = side => wallItems.some(w => w.outside && (
    side === 'top' ? w.edge.N[1] > 0.5 && Math.abs(w.edge.a[1] - house.y0) < 0.05 :
    side === 'bottom' ? w.edge.N[1] < -0.5 && Math.abs(w.edge.a[1] - house.y1) < 0.05 :
    side === 'left' ? w.edge.N[0] > 0.5 && Math.abs(w.edge.a[0] - house.x0) < 0.05 :
    w.edge.N[0] < -0.5 && Math.abs(w.edge.a[0] - house.x1) < 0.05));
  const pad = detail ? { top: 1, bottom: 1, left: 1, right: 1 } : {
    top: 5 + (sideHasOutside('top') ? 6 : 0), bottom: 5 + (sideHasOutside('bottom') ? 6 : 0),
    left: 4 + (sideHasOutside('left') ? 7 : 0), right: 4 + (sideHasOutside('right') ? 7 : 0),
  };
  const wM = view.x1 - view.x0, hM = view.y1 - view.y0;
  const scale = opts.scale || SCALES.find(s => wM * 1000 / s + pad.left + pad.right <= fit.maxW && hM * 1000 / s + pad.top + pad.bottom <= fit.maxH) || SCALES[SCALES.length - 1];
  const k = 1000 / scale; // mm je Meter
  const W = wM * k + pad.left + pad.right, H = hM * k + pad.top + pad.bottom;
  const X = x => pad.left + (x - view.x0) * k, Y = y => pad.top + (y - view.y0) * k;
  const polyMm = Object.fromEntries(rooms.map(r => [r.id, r.poly.map(([x, y]) => [X(x), Y(y)])]));

  const layers = { under: [], walls: [], symbols: [], leaders: [], labels: [] };
  const occ = []; // belegte Flächen: kind sym | label | fix
  const hits = (box, kinds, pad2 = 0.2) => occ.filter(o => kinds.includes(o.kind) && boxesOverlap(box, o, pad2));
  const inView = b => b.x0 >= 0.3 && b.y0 >= 0.3 && b.x1 <= W - 0.3 && b.y1 <= H - 0.3;

  // --- Außenbereiche, Einbauten ---
  layers.under.push(`<defs><clipPath id="clip-${uid}"><rect x="0" y="0" width="${r2(W)}" height="${r2(H)}"/></clipPath></defs>`);
  for (const r of rooms.filter(q => q.kind === 'out')) {
    layers.under.push(`<polygon points="${polyMm[r.id].map(p => p.map(r2).join(',')).join(' ')}" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="1.4 0.9" clip-path="url(#clip-${uid})"/>`);
  }
  const rectMm = (q, style) => `<rect x="${r2(X(q.x0))}" y="${r2(Y(q.y0))}" width="${r2((q.x1 - q.x0) * k)}" height="${r2((q.y1 - q.y0) * k)}" ${style}/>`;
  const fixBox = q => ({ kind: 'fix', x0: X(q.x0), x1: X(q.x1), y0: Y(q.y0), y1: Y(q.y1) });
  const GRAY = 'stroke="#666" stroke-width="0.18" fill="none"';
  const fixtureLabels = []; // { text, box } – nach den Geräten platziert
  for (const fx of data.fixtures.filter(q => q.floor === floor.id)) {
    if (fx.type === 'straight') {
      layers.under.push(rectMm(fx, GRAY));
      const run = (fx.y1 - fx.y0) / fx.steps;
      for (let s = 1; s < fx.steps; s++) layers.under.push(`<line x1="${r2(X(fx.x0))}" x2="${r2(X(fx.x1))}" y1="${r2(Y(fx.y0 + s * run))}" y2="${r2(Y(fx.y0 + s * run))}" ${GRAY}/>`);
      const xm = X((fx.x0 + fx.x1) / 2), from = fx.dir < 0 ? Y(fx.y1) - 1.5 : Y(fx.y0) + 1.5, to = fx.dir < 0 ? Y(fx.y0) + 1.5 : Y(fx.y1) - 1.5, tip = Math.sign(to - from);
      layers.under.push(`<path d="M${r2(xm)} ${r2(from)}V${r2(to)}M${r2(xm - 1)} ${r2(to - tip * 1.6)}L${r2(xm)} ${r2(to)}L${r2(xm + 1)} ${r2(to - tip * 1.6)}" stroke="#444" stroke-width="0.25" fill="none"/>`);
      occ.push(fixBox(fx));
    } else if (fx.type === 'spiral') {
      const cx = X(fx.cx), cy = Y(fx.cy), R = fx.r * k, n = fx.steps || 0;
      layers.under.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R)}" ${GRAY}${n ? '' : ' stroke-dasharray="1 0.8"'}/>`);
      for (let s = 0; s <= n && n; s++) {
        const t = (fx.from + fx.turn * s / n) * 2 * Math.PI;
        layers.under.push(`<line x1="${r2(cx + Math.cos(t) * R * 0.15)}" y1="${r2(cy + Math.sin(t) * R * 0.15)}" x2="${r2(cx + Math.cos(t) * R)}" y2="${r2(cy + Math.sin(t) * R)}" ${GRAY}/>`);
      }
      occ.push({ kind: 'fix', x0: cx - R, x1: cx + R, y0: cy - R, y1: cy + R });
    } else if (fx.type === 'box') {
      layers.under.push(rectMm(fx, 'stroke="#444" stroke-width="0.25" fill="none"'));
      if (fx.label) fixtureLabels.push({ text: fx.label, area: fixBox(fx) });
    }
  }
  if (data.chimney) {
    const c = data.chimney, x0 = X(c.x0), x1 = X(c.x1), y0 = Y(c.y0), y1 = Y(c.y1);
    layers.under.push(`<path d="M${r2(x0)} ${r2(y0)}H${r2(x1)}V${r2(y1)}H${r2(x0)}ZM${r2(x0)} ${r2(y0)}L${r2(x1)} ${r2(y1)}M${r2(x0)} ${r2(y1)}L${r2(x1)} ${r2(y0)}" stroke="#000" stroke-width="0.2" fill="#fff"/>`);
    occ.push(fixBox(c));
  }
  for (const sh of data.shafts.filter(q => q.floor === floor.id)) {
    layers.under.push(rectMm(sh, 'fill="#bbb" stroke="#000" stroke-width="0.2"'));
    occ.push({ ...fixBox(sh), kind: 'sym' });
  }
  for (const wet of data.wet.filter(q => q.floor === floor.id)) {
    const z = wet.zone2, room = roomById[wet.room];
    layers.under.push(`<clipPath id="clip-${uid}-wet-${wet.room}"><polygon points="${polyMm[room.id].map(p => p.map(r2).join(',')).join(' ')}"/></clipPath>`);
    layers.under.push(rectMm({ x0: wet.x0 - z, x1: wet.x1 + z, y0: wet.y0 - z, y1: wet.y1 + z }, `fill="none" stroke="#000" stroke-width="0.2" stroke-dasharray="1 0.7" clip-path="url(#clip-${uid}-wet-${wet.room})"`));
    layers.under.push(rectMm(wet, 'stroke="#444" stroke-width="0.25" fill="#f1f1f1"'));
    fixtureLabels.push({ text: wet.what, area: fixBox(wet) });
    occ.push(fixBox(wet));
  }

  // --- Wände und Öffnungen ---
  for (const r of rooms) {
    const out = r.kind === 'out';
    for (const e of roomEdges[r.id]) {
      const ops = r.openings.filter(o => o.edge === e.i).map(o => {
        const ti = v => (o.axis === 'y' ? (v - e.a[0]) * e.U[0] : (v - e.a[1]) * e.U[1]);
        return { kind: o.kind, lo: Math.max(0, Math.min(ti(o.a), ti(o.b))), hi: Math.min(e.len, Math.max(ti(o.a), ti(o.b))) };
      }).filter(o => o.hi > o.lo).sort((p, q) => p.lo - q.lo);
      e.openings = ops;
      const P = t => [X(e.a[0] + e.U[0] * t), Y(e.a[1] + e.U[1] * t)];
      const seg = (t0, t1, style) => { const [x1, y1] = P(t0), [x2, y2] = P(t1); return `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" ${style}/>`; };
      const off = (t, n) => { const [x, y] = P(t); return [x + e.N[0] * n, y + e.N[1] * n]; };
      const tick = (t, n) => { const a = off(t, -n), b = off(t, n); return `<line x1="${r2(a[0])}" y1="${r2(a[1])}" x2="${r2(b[0])}" y2="${r2(b[1])}" stroke="#000" stroke-width="0.2"/>`; };
      if (!out) {
        let cur = 0;
        for (const o of [...ops, { lo: e.len, hi: e.len }]) {
          if (o.lo - cur > 1e-6) layers.walls.push(seg(cur, o.lo, 'stroke="#000" stroke-width="0.6" stroke-linecap="square"'));
          cur = Math.max(cur, o.hi);
        }
      }
      for (const o of ops) {
        if (out) continue; // die Öffnung zeichnet der angrenzende Innenraum
        if (o.kind === 'win') {
          for (const n of [-0.45, 0.45]) { const a = off(o.lo, n), b = off(o.hi, n); layers.walls.push(`<line x1="${r2(a[0])}" y1="${r2(a[1])}" x2="${r2(b[0])}" y2="${r2(b[1])}" stroke="#000" stroke-width="0.2"/>`); }
          layers.walls.push(tick(o.lo, 0.45), tick(o.hi, 0.45));
        } else {
          layers.walls.push(tick(o.lo, 0.7), tick(o.hi, 0.7));
          if (o.kind === 'open') layers.walls.push(seg(o.lo, o.hi, 'stroke="#000" stroke-width="0.18" stroke-dasharray="0.6 0.6"'));
        }
      }
    }
  }

  // --- Wandgeräte entlang der Wand entzerren ---
  const GAP = 0.45, CORNER = 1.3; // mm
  const groups = new Map();
  for (const w of wallItems) {
    w.sym = symbolOf(w.d, k);
    const key = `${w.room.id}|${w.edge.i}|${w.outside}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const pulled = [];
  for (const list of groups.values()) {
    const e = list[0].edge, lenMm = e.len * k;
    // freie Wandabschnitte in mm (Öffnungen ausgespart)
    const free = [];
    let cur = CORNER;
    for (const o of [...e.openings, { lo: e.len, hi: e.len }]) {
      const end = Math.min(o.lo * k - 0.3, lenMm - CORNER);
      if (end - cur > 0.5) free.push([cur, end]);
      cur = Math.max(cur, o.hi * k + 0.3);
    }
    if (!free.length) free.push([0, lenMm]);
    const bySection = new Map();
    for (const w of list) {
      const pos = w.t * k;
      const sec = free.reduce((b, s) => {
        const dist = pos < s[0] ? s[0] - pos : pos > s[1] ? pos - s[1] : 0;
        return !b || dist < b.dist ? { s, dist } : b;
      }, null).s;
      if (!bySection.has(sec)) bySection.set(sec, []);
      bySection.get(sec).push({ w, pos, want: pos, half: w.sym.halfW });
    }
    for (const [[lo, hi], items] of bySection) {
      items.sort((a, b) => a.pos - b.pos);
      // was nicht nebeneinander passt, wird herausgezogen (das breiteste zuerst an der Wand lassen wäre willkürlich: Datenreihenfolge)
      let need = items.reduce((s, it) => s + 2 * it.half + GAP, -GAP);
      while (items.length > 1 && need > hi - lo) {
        const it = items.pop();
        need -= 2 * it.half + GAP;
        pulled.push(it.w); it.w.pulled = true; bump(it.w.room.id, 1); it.w.pos = Math.min(Math.max(it.want, lo), hi);
      }
      relax(items, Math.min(lo, hi - 2 * items[0].half), hi, GAP);
      for (const it of items) it.w.pos = it.pos;
    }
  }
  const frameOf = w => {
    const tm = w.pos / k, N = w.outside ? [-w.edge.N[0], -w.edge.N[1]] : w.edge.N;
    return { o: [X(w.edge.a[0] + w.edge.U[0] * tm), Y(w.edge.a[1] + w.edge.U[1] * tm)], U: w.edge.U, N };
  };
  const drawWall = w => {
    const pen = new Pen(w.frame.o, w.frame.U, w.frame.N);
    w.sym.draw(pen);
    w.pen = pen; w.box = pen.bounds(w.sym.halfW, w.sym.depth);
    layers.symbols.push(...pen.out);
    occ.push({ kind: 'sym', ...w.box });
  };
  for (const w of wallItems.filter(q => !q.pulled)) { w.frame = frameOf(w); drawWall(w); }

  // --- Deckengeräte ---
  for (const c of ceilItems) {
    c.sym = symbolOf(c.d, k);
    c.center = [X(c.d.x), Y(c.d.y)];
    const pen = new Pen(c.center, [1, 0], [0, 1]);
    c.sym.draw(pen);
    const r = c.sym.r + 0.15;
    c.box = { x0: c.center[0] - r, x1: c.center[0] + r, y0: c.center[1] - r, y1: c.center[1] + r };
    layers.symbols.push(...pen.out);
    occ.push({ kind: 'sym', ...c.box });
  }

  // --- herausgezogene Symbole: nächster freier Platz im Raum, Hinweislinie zur Wandstelle ---
  for (const w of pulled) {
    const base = frameOf(w), poly = polyMm[w.room.id];
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    let best = null;
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs) - 1; x += 0.7) {
      for (let y = Math.min(...ys) + 1; y < Math.max(...ys) - 1; y += 0.7) {
        const box = new Pen([x, y], base.U, base.N).bounds(w.sym.halfW + 0.6, w.sym.depth + 7, 0.6); // Platz für Symbol samt Nummer
        if (!boxInPoly(poly, box) || hits(box, ['sym', 'label', 'fix']).length) continue;
        const dist = Math.hypot(x - base.o[0], y - base.o[1]);
        if (!best || dist < best.dist) best = { x, y, dist };
      }
    }
    if (!best) { warnings.push(`${w.room.name}: „${w.d.label}“ ließ sich nicht überlappungsfrei zeichnen`); w.frame = base; drawWall(w); continue; }
    w.frame = { o: [best.x, best.y], U: base.U, N: base.N };
    drawWall(w);
    layers.leaders.push(`<circle cx="${r2(base.o[0])}" cy="${r2(base.o[1])}" r="0.4"/><line x1="${r2(base.o[0])}" y1="${r2(base.o[1])}" x2="${r2(best.x)}" y2="${r2(best.y)}" stroke="#000" stroke-width="0.15"/>`);
  }

  // sehr kleine Räume mit vielen Geräten sind im Geschossmaßstab nie gut lesbar
  for (const r of rooms) if (r.area <= 3 && devices.filter(d => d.room === r.id).length >= 5) bump(r.id, 2);
  // Seitenbeschriftung oben/unten freihalten
  if (!detail) for (const y of [1.9, H - 1.9]) occ.push({ kind: 'label', x0: pad.left + wM * k / 2 - 32, x1: pad.left + wM * k / 2 + 32, y0: y - 1.6, y1: y + 1.6 });

  // --- Stromkreisnummern ---
  let unresolved = 0;
  const place = (cands, roomPoly, kinds = ['sym', 'label']) => {
    let fallback = null;
    for (const c of cands) {
      const ok = inView(c.box) && (!roomPoly || boxInPoly(roomPoly, c.box, 0.1));
      const h = hits(c.box, kinds);
      if (ok && !h.length) return c;
      const cost = h.reduce((s, o) => s + overlapArea(c.box, o), 0) + (ok ? 0 : 1000);
      if (!fallback || cost < fallback.cost) fallback = { ...c, cost };
    }
    unresolved++;
    return fallback;
  };
  const emitLabel = (c, parts, fs) => {
    layers.labels.push(textSvg((c.box.x0 + c.box.x1) / 2, (c.box.y0 + c.box.y1) / 2, parts, fs, c.vertical));
    occ.push({ kind: 'label', ...c.box });
    if (c.leader) layers.leaders.push(`<line x1="${r2(c.leader[0][0])}" y1="${r2(c.leader[0][1])}" x2="${r2(c.leader[1][0])}" y2="${r2(c.leader[1][1])}" stroke="#000" stroke-width="0.15"/>`);
  };
  const order = wallItems.slice().sort((a, b) => (a.room.id + a.edge.i).localeCompare(b.room.id + b.edge.i) || a.pos - b.pos);
  for (const w of order) {
    const parts = labelParts(w.d);
    if (!parts) continue;
    const fs = w.d.t === 'uv' ? 2.7 : LABEL_FS, L = partsWidth(parts, fs) + 0.3, Hh = fs * 1.05;
    const pen = new Pen(w.frame.o, w.frame.U, w.frame.N), depth = w.sym.depth, half = w.sym.halfW, b0 = depth + 0.5;
    const normalHorizontal = Math.abs(w.frame.N[0]) > 0.5;
    const local = (a0, a1, bA, bB, vertical, leaderTo) => {
      const p = [pen.pt(a0, bA), pen.pt(a1, bB)];
      const box = { x0: Math.min(p[0][0], p[1][0]), x1: Math.max(p[0][0], p[1][0]), y0: Math.min(p[0][1], p[1][1]), y1: Math.max(p[0][1], p[1][1]) };
      return { box, vertical, leader: leaderTo ? [pen.pt(0, depth), pen.pt(...leaderTo)] : null };
    };
    const along = (a, b, leader = a !== 0 || b > b0 + 0.1) => local(a - Hh / 2, a + Hh / 2, b, b + L, !normalHorizontal, leader ? [a, b] : null);
    const across = (a, b) => local(a - L / 2, a + L / 2, b, b + Hh, normalHorizontal, Math.abs(a) > half ? [a, b] : null);
    const beside = half + Hh / 2 + 0.35;
    const cands = [
      along(0, b0), along(0, b0 + 1.4), along(0, b0 + 2.8),
      along(beside, 0.4, false), along(-beside, 0.4, false),
      across(0, b0), across(L / 2 - half, b0), across(half - L / 2, b0),
      along(0, b0 + 4.2), along(0, b0 + 5.6),
      along(Hh + 0.4, b0), along(-Hh - 0.4, b0), along(2 * Hh + 0.8, b0), along(-2 * Hh - 0.8, b0),
      across(0, b0 + Hh + 0.3), across(L / 2 + half + 0.4, 0.4), across(-L / 2 - half - 0.4, 0.4),
    ];
    for (const c of cands.filter(q => q.leader && q.leader[1])) if (Math.hypot(c.leader[0][0] - c.leader[1][0], c.leader[0][1] - c.leader[1][1]) < 0.8) c.leader = null;
    const chosen = place(cands, w.outside ? null : polyMm[w.room.id]);
    if (chosen.cost !== undefined) bump(w.room.id, 2);
    emitLabel(chosen, parts, fs);
  }
  for (const c of ceilItems) {
    const parts = labelParts(c.d);
    if (!parts) continue;
    const L = partsWidth(parts, LABEL_FS) + 0.3, Hh = LABEL_FS * 1.05, r = c.sym.r + 0.4, [cx, cy] = c.center;
    const at = (x, y) => ({ box: { x0: x - L / 2, x1: x + L / 2, y0: y - Hh / 2, y1: y + Hh / 2 }, vertical: false });
    const dx = r + L / 2, dy = r + Hh / 2;
    const cands = [at(cx + dx, cy), at(cx - dx, cy), at(cx, cy + dy), at(cx, cy - dy),
      at(cx + dx, cy + dy * 0.8), at(cx + dx, cy - dy * 0.8), at(cx - dx, cy + dy * 0.8), at(cx - dx, cy - dy * 0.8), at(cx + dx + 2, cy), at(cx - dx - 2, cy)];
    const chosen = place(cands, polyMm[c.room.id]);
    if (chosen.cost !== undefined) bump(c.room.id, 2);
    emitLabel(chosen, parts, LABEL_FS);
  }

  // --- Beschriftung der Einbauten (Öltank, Wanne …) ---
  const visible = b => (b.x0 + b.x1) / 2 > 2 && (b.x0 + b.x1) / 2 < W - 2 && (b.y0 + b.y1) / 2 > 2 && (b.y0 + b.y1) / 2 < H - 2;
  for (const f of fixtureLabels.filter(q => visible(q.area))) {
    // lange Bezeichnungen auf den Kern kürzen; der volle Text steht in der Zeile unter dem Grundriss
    const a = f.area, fs = 2.0, fits = t => textWidth(t, fs) + 0.4 <= Math.max(a.x1 - a.x0, a.y1 - a.y0) - 0.6;
    if (!fits(f.text)) f.text = f.text.split(/\s*[(·–,]/)[0].trim();
    const L = textWidth(f.text, fs) + 0.4, vertical = L > a.x1 - a.x0 - 0.6 && a.y1 - a.y0 > a.x1 - a.x0;
    const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2, w = vertical ? fs * 1.1 : L, h = vertical ? L : fs * 1.1;
    const cands = [0, -3, 3, -6, 6, -9, 9].flatMap(d => (vertical ? [[cx, cy + d]] : [[cx, cy + d], [cx + d, cy]]))
      .map(([x, y]) => ({ box: { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 }, vertical }));
    const c = place(cands, null);
    layers.labels.push(`<text x="${r2((c.box.x0 + c.box.x1) / 2)}" y="${r2((c.box.y0 + c.box.y1) / 2)}" font-size="${fs}" fill="#333" font-style="italic" text-anchor="middle" dominant-baseline="central" class="halo"${vertical ? ` transform="rotate(-90 ${r2((c.box.x0 + c.box.x1) / 2)} ${r2((c.box.y0 + c.box.y1) / 2)})"` : ''}>${esc(f.text)}</text>`);
    occ.push({ kind: 'label', ...c.box });
  }
  for (const sh of data.shafts.filter(q => q.floor === floor.id && visible(fixBox(q)))) {
    const fs = 2.0, txt = sh.label.split('·')[0].trim(), L = textWidth(txt, fs) + 0.4, h = fs * 1.1, b = fixBox(sh), cy = (b.y0 + b.y1) / 2;
    const at = (x, y) => ({ box: { x0: x - L / 2, x1: x + L / 2, y0: y - h / 2, y1: y + h / 2 }, vertical: false });
    const c = place([at(b.x0 - L / 2 - 0.6, cy), at(b.x1 + L / 2 + 0.6, cy), at(b.x0 - L / 2 - 0.6, b.y1 + h), at(b.x0 - L / 2 - 0.6, b.y0 - h), at(b.x0 - L / 2 - 4, cy + 3)], null);
    layers.labels.push(`<text x="${r2((c.box.x0 + c.box.x1) / 2)}" y="${r2((c.box.y0 + c.box.y1) / 2)}" font-size="${fs}" fill="#333" font-style="italic" text-anchor="middle" dominant-baseline="central" class="halo">${esc(txt)}</text>`);
    occ.push({ kind: 'label', ...c.box });
  }

  // --- Raumnamen mit Fläche ---
  for (const r of rooms.filter(q => !detail || q.id === detail)) {
    const poly = polyMm[r.id], out = r.kind === 'out';
    const vis = poly.map(([x, y]) => [Math.min(Math.max(x, 0.6), W - 0.6), Math.min(Math.max(y, 0.6), H - 0.6)]);
    const bx0 = Math.min(...vis.map(p => p[0])), bx1 = Math.max(...vis.map(p => p[0])), by0 = Math.min(...vis.map(p => p[1])), by1 = Math.max(...vis.map(p => p[1]));
    const areaTxt = skip.has(r.id) ? 'siehe Detail' : `${fmtDe(r.area, 1)} m²`;
    const split = (() => {
      const m = r.name.match(/^(.{3,}?[/ ])(\(?.{3,})$/);
      return m ? [m[1].trim(), m[2].trim()] : null;
    })();
    const variants = [];
    for (const fs of [2.7, 2.3, 2.0]) {
      variants.push({ fs, lines: [r.name], area: true });
      if (split) variants.push({ fs, lines: split, area: true });
    }
    variants.push({ fs: 2.0, lines: [r.name], area: false });
    if (split) variants.push({ fs: 2.0, lines: split, area: false });
    const cxm = (bx0 + bx1) / 2, cym = (by0 + by1) / 2;
    let chosen = null;
    for (const strict of [true, false]) {
      for (const v of variants) {
        const fsA = v.fs * 0.82, lh = v.fs * 1.18;
        const w = Math.max(...v.lines.map(l => textWidth(l, v.fs, true)), v.area ? textWidth(areaTxt, fsA) : 0) + 0.6;
        const h = v.lines.length * lh + (v.area ? fsA * 1.2 : 0);
        if (w > bx1 - bx0 - 0.8 || h > by1 - by0 - 0.8) continue;
        let best = null;
        for (let x = bx0 + w / 2 + 0.5; x <= bx1 - w / 2 - 0.5; x += 1) {
          for (let y = by0 + h / 2 + 0.5; y <= by1 - h / 2 - 0.5; y += 1) {
            const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
            if (!boxInPoly(poly, box, 0.2) || !inView(box) || hits(box, strict ? ['sym', 'label', 'fix'] : ['sym', 'label'], 0.5).length) continue;
            const dist = Math.hypot(x - cxm, (y - cym) * 1.3);
            if (!best || dist < best.dist) best = { box, dist };
          }
        }
        if (best) { chosen = { ...best, v, lh, fsA }; break; }
      }
      if (chosen) break;
    }
    if (!chosen) { warnings.push(`Raumname „${r.name}“ hat im Grundriss keinen freien Platz gefunden`); continue; }
    const { box, v, lh, fsA } = chosen, x = (box.x0 + box.x1) / 2;
    v.lines.forEach((line, i) => layers.labels.push(`<text x="${r2(x)}" y="${r2(box.y0 + lh * (i + 0.5))}" font-size="${v.fs}" font-weight="700" text-anchor="middle" dominant-baseline="central" class="halo"${out ? ' font-style="italic"' : ''}>${esc(line)}</text>`));
    if (v.area) layers.labels.push(`<text x="${r2(x)}" y="${r2(box.y0 + v.lines.length * lh + fsA * 0.6)}" font-size="${r2(fsA)}" text-anchor="middle" dominant-baseline="central" class="halo">${esc(areaTxt)}</text>`);
    occ.push({ kind: 'label', ...box });
  }

  // --- Orientierung ---
  const side = (txt, y) => `<text x="${r2(pad.left + wM * k / 2)}" y="${r2(y)}" font-size="2.4" letter-spacing="0.3" text-anchor="middle" dominant-baseline="central" fill="#333">${esc(txt)}</text>`;
  const top = detail ? '' : side('▲ GARTENSEITE', 1.9), bottom = detail ? '' : side('▼ EINGANGSSEITE (STRASSE)', H - 1.9);
  if (unresolved) warnings.push(`${unresolved} Beschriftung(en) ohne freien Platz (überlappen etwas)`);

  const svg = `<svg class="plan" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(W)} ${r2(H)}" width="${r2(W)}mm" height="${r2(H)}mm" font-family='${FONT}' role="img" aria-label="Grundriss ${esc(floor.name)} mit Elektroausstattung">
<g>${layers.under.join('')}</g><g clip-path="url(#clip-${uid})"><g>${layers.walls.join('')}</g><g>${layers.leaders.join('')}</g><g>${layers.symbols.join('')}</g><g>${layers.labels.join('')}</g></g>${top}${bottom}</svg>`;
  return { svg, scale, width: W, height: H, sizeM: [house.x1 - house.x0, house.y1 - house.y0], warnings, crowded: [...score].filter(([, n]) => n >= 2).map(([id]) => id) };
}

/** Maßstabsleiste in echter Papiergröße. */
export function buildScaleBar(scale) {
  const k = 1000 / scale, meters = scale <= 50 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5], last = meters[meters.length - 1];
  const cells = meters.slice(0, -1).map((m, i) => `<rect x="${r2(m * k)}" y="0" width="${r2((meters[i + 1] - m) * k)}" height="1.4" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.15"/>`).join('');
  const nums = meters.map(m => `<text x="${r2(m * k)}" y="4" font-size="2.2" text-anchor="middle">${m}</text>`).join('');
  return `<svg class="scalebar" viewBox="-3 -0.2 ${r2(last * k + 10)} 5" width="${r2(last * k + 10)}mm" height="5mm" font-family='${FONT}' aria-label="Maßstabsleiste">${cells}${nums}<text x="${r2(last * k + 2.2)}" y="4" font-size="2.2">m</text></svg>`;
}
