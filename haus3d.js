/* =====================================================================
   haus3d.js – Modus „Echt“: realistische 3D-Ansicht von Haus 4
   Wird NACH dem Hauptskript von index.html geladen und nutzt dessen Daten
   (ROOMS/RI, OPENINGS, DEVICES, ROUTES, FIXTURES, ROOF, CHIMNEY, TUB …) und
   Zustände (G, S, W). Alles, was hier gebaut wird, entsteht einmal beim ersten
   Umschalten auf „Echt“ und bleibt danach bestehen (kein Neubau beim Moduswechsel).

   ANNAHMEN (stehen auch im Abschnitt „Hinweise“ der Seite)
   - Wände: Raumgrenzen aus den Plandaten. Wo zwei Räume ohne Lücke aneinander-
     stoßen (EG/OG), wird eine 12-cm-Wand mittig auf die Grenze gesetzt, zu
     Terrasse/Loggia 24 cm. Außen- und Trennwände (EG/OG) 24 cm nach außen,
     KG-Außenwände bis zur EG-Fassade, DG-Kniestock 24 cm.
   - Fenster/Türen: Lage und Höhen aus OPENINGS. Türen EG–DG lichte Höhe 2,01 m,
     KG 1,85 m (Plandaten). Dachfenster aus dem Dachumriss des Plans (2× Gartenseite).
   - Gelände 20 cm unter EG-Fußboden; Kellerfenster mit Lichtschacht.
   - Himmelsrichtung unbekannt: Garten (y = 0) als Südseite angenommen.
   - Satteldach 35° aus ROOF, Ziegel rotbraun, Überstand ca. 36 cm, Schornstein
     an der Planposition; Nachbarhäuser 3 und 5 gespiegelt, vereinfacht.
   - KG-Wendeltreppe: im Plan r = 0,95 m bei (1,20 | 7,15). Damit wäre der Antritt
     der EG-Treppe nicht begehbar; hier r = 0,78 m bei (1,45 | 6,85).
   - Schornstein in EG/OG: in Küche bzw. Kinderzimmer als verkleideter Zug im
     Hochschrank bzw. Kleiderschrank; die Gerätedosen dahinter bleiben in der
     Röntgenansicht sichtbar.
   - Möblierung frei angenommen, an den geplanten Dosen ausgerichtet.
   - Schalter → Leuchten: gleicher Stromkreis im selben Raum, Sonderfälle über die
     Beschriftung (Treppe, Loggia, Terrasse, Öllager …).
   ===================================================================== */
"use strict";
window.H3 = (() => { try {
  if (typeof THREE === 'undefined') return null;
  const T = THREE;

  /* ---------- Konstanten ---------- */
  const CS = 0.01;                                         // Rasterweite für den Wandaufbau (1 cm)
  const HOUSE = { x0: -0.24, x1: 7.25, y0: -0.24, y1: 10.84 };
  const DG_Y = [1.13, 9.84];                               // Kniestock außen
  const GROUND = -0.20;
  const SLAB = 0.25;
  const DOOR_H = { KG: 1.85, EG: 2.01, OG: 2.01, DG: 2.01 };
  const CUT = 1.35;                                        // Schnitthöhe über FFB
  const KEEP_OUT = { EG: [4.17, 7.01, -0.30, 0.0], OG: [4.07, 7.01, -0.30, 0.0] };   // offene Front Terrasse/Loggia
  const SPIRAL = { cx: 1.45, cy: 6.85, r: 0.78, pole: 0.05, turn: 1.25, steps: 13 };
  const KG_OUT_STAIR = { x0: 0.30, x1: 1.54, yBottom: -0.95, yTop: -3.75, steps: 12 };
  const ROOF_T = 0.30 / Math.cos(35 * Math.PI / 180);      // Dachaufbau senkrecht gemessen
  const EAVE = { a: -0.60, b: 11.20 };
  const ROW = { x0: -7.49, x1: 14.50 };                    // Reihe Haus 3 – 5
  const ROOF_WINDOWS = [[1.3, 2.3], [4.6, 5.6]].map(([x0, x1]) => ({ x0, x1, y0: 1.6, y1: 2.6 }));
  const TILE_H = { og_bad: 2.0, og_abst: 2.0, og_wasch: 1.2, eg_wc: 1.2, dg_wc: 1.2 };
  const FLOOR_MAT = {
    kg_hobby: 'screed', kg_keller: 'screed', kg_flur: 'screed', kg_heiz: 'screed', kg_oel: 'screed', kg_wasch: 'tileKG', kg_aussen: 'concrete',
    eg_wohnen: 'parquet', eg_terr: 'pavers', eg_diele: 'tileFloor', eg_wc: 'tileFloor', eg_wind: 'tileFloor', eg_kueche: 'tileFloor',
    og_eltern: 'parquet', og_loggia: 'tileOut', og_kindg: 'parquet', og_abst: 'tileBath', og_flur: 'parquet', og_bad: 'tileBath', og_wasch: 'tileBath', og_kinde: 'parquet',
    dg_kl: 'parquet', dg_kr: 'parquet', dg_flur: 'parquet', dg_trep: 'parquet', dg_wc: 'tileBath', dg_trock: 'screed',
  };
  const E = {
    on: false, built: false, failed: false, scene: null, mats: {}, tex: {}, floors: {}, groups: {},
    quality: null, day: true, lampsOn: 0, hiddenIds: new Set(), xray: false, explode: 0, layers: { roof: true, devices: true, net: true },
    gate: {}, lamps: [], lampById: {}, switches: [], pool: [], poolN: 0, uLightRoom: null, cutPlane: null,
    wallPick: {}, devPos: {}, targets: {}, inst: [], intro: null, time: 0, dirtyLights: true, frames: [],
    colE: null, surfaces: null, furnBoxes: {}, hidden: [], lastLightKey: '',
  };
  const isMobile = () => window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;

  /* ---------- kleine Helfer ---------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function vnoise(w, h, cells, octaves, seed) {
    const out = new Float32Array(w * h), r = rng(seed);
    let amp = 1, tot = 0;
    for (let o = 0; o < octaves; o++) {
      const cx = cells << o, cy = Math.max(1, Math.round(cells * h / w)) << o, lat = new Float32Array(cx * cy);
      for (let i = 0; i < lat.length; i++) lat[i] = r();
      for (let y = 0; y < h; y++) {
        const fy = y / h * cy, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty), y0 = (iy % cy) * cx, y1 = ((iy + 1) % cy) * cx;
        for (let x = 0; x < w; x++) {
          const fx = x / w * cx, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx), x0 = ix % cx, x1 = (ix + 1) % cx;
          const a = lat[y0 + x0], b = lat[y0 + x1], top = a + (b - a) * sx, c = lat[y1 + x0], d = lat[y1 + x1];
          out[y * w + x] += amp * (top + (c + (d - c) * sx - top) * sy);
        }
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  /* Pixel-Maler: fn(x, y, i) → [r,g,b] (0…255); zusätzlich optional Höhenwert für die Bump-Map */
  function paint(w, h, fn, withBump) {
    const c = mkCanvas(w, h), b = withBump ? mkCanvas(w, h) : null;
    const cx = c.getContext('2d'), ci = cx.createImageData(w, h), cd = ci.data;
    const bx = b && b.getContext('2d'), bi = b && bx.createImageData(w, h), bd = bi && bi.data;
    const px = [0, 0, 0, 0];
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      fn(x, y, i, px);
      const k = i * 4;
      cd[k] = px[0]; cd[k + 1] = px[1]; cd[k + 2] = px[2]; cd[k + 3] = 255;
      if (bd) { const v = Math.max(0, Math.min(255, px[3] * 255)); bd[k] = bd[k + 1] = bd[k + 2] = v; bd[k + 3] = 255; }
    }
    cx.putImageData(ci, 0, 0);
    if (bx) bx.putImageData(bi, 0, 0);
    return { c, b };
  }

  /* ---------- prozedurale Texturen (Canvas) ---------- */
  function texFrom(canvas, world, srgb) {
    const t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(1 / world[0], 1 / world[1]);
    if (srgb) t.encoding = T.sRGBEncoding;
    t.anisotropy = E.quality === 'hi' ? Math.min(8, G.renderer.capabilities.getMaxAnisotropy()) : 2;
    return t;
  }
  function makeTextures() {
    const hi = E.quality === 'hi', S1 = hi ? 1024 : 512, S2 = hi ? 512 : 256;
    const X = {};
    const add = (name, res, world, bumpToo) => {
      X[name] = { map: texFrom(res.c, world, true), bump: res.b ? texFrom(res.b, world, false) : null };
      if (bumpToo && !res.b) X[name].bump = X[name].map;
    };
    // Innenputz, warmes Weiß mit feiner Körnung
    { const n = vnoise(S2, S2, 16, 4, 11), f = vnoise(S2, S2, 64, 2, 12);
      add('plaster', paint(S2, S2, (x, y, i, p) => { const v = 0.965 + (n[i] - 0.5) * 0.05 + (f[i] - 0.5) * 0.03; p[0] = 240 * v; p[1] = 235 * v; p[2] = 226 * v; p[3] = 0.5 + (f[i] - 0.5) * 0.9 + (n[i] - 0.5) * 0.3; }, true), [1.6, 1.6]); }
    // Fassade: Reibeputz
    { const n = vnoise(S2, S2, 8, 4, 21), g = vnoise(S2, S2, 128, 1, 22), r = rng(23);
      add('facade', paint(S2, S2, (x, y, i, p) => { const sp = r() < 0.08 ? -0.06 : 0; const v = 0.93 + (n[i] - 0.5) * 0.06 + (g[i] - 0.5) * 0.08 + sp; p[0] = 236 * v; p[1] = 229 * v; p[2] = 214 * v; p[3] = 0.5 + (g[i] - 0.5) * 1.4 + sp * 4; }, true), [1.2, 1.2]); }
    // Sockel / Beton
    { const n = vnoise(S2, S2, 6, 5, 31), g = vnoise(S2, S2, 96, 1, 32), r = rng(33);
      add('sockel', paint(S2, S2, (x, y, i, p) => { const pore = r() < 0.012 ? -0.25 : 0; const v = 0.62 + (n[i] - 0.5) * 0.12 + (g[i] - 0.5) * 0.06 + pore; p[0] = 205 * v; p[1] = 202 * v; p[2] = 196 * v; p[3] = 0.5 + (g[i] - 0.5) + pore * 2; }, true), [1.5, 1.5]);
      add('concrete', paint(S2, S2, (x, y, i, p) => { const pore = r() < 0.01 ? -0.2 : 0; const v = 0.72 + (n[i] - 0.5) * 0.16 + (g[i] - 0.5) * 0.05 + pore; p[0] = 200 * v; p[1] = 198 * v; p[2] = 192 * v; p[3] = 0.5 + (g[i] - 0.5) * 0.8 + pore * 2; }, true), [2.0, 2.0]); }
    // Estrich (KG), leicht fleckig, versiegelt
    { const n = vnoise(S2, S2, 4, 5, 41), g = vnoise(S2, S2, 80, 1, 42);
      add('screed', paint(S2, S2, (x, y, i, p) => { const v = 0.70 + (n[i] - 0.5) * 0.22 + (g[i] - 0.5) * 0.05; p[0] = 196 * v; p[1] = 192 * v; p[2] = 184 * v; p[3] = 0.5 + (g[i] - 0.5) * 0.6; }, true), [3, 3]); }
    // Eichenparkett (Schiffsboden 20 × 120 cm, versetzt)
    X.parquet = woodTex(S1, true, 51); X.oak = woodTex(S2, false, 52);
    // Fliesen
    X.tileFloor = tileTex(S2, 2.4, 0.6, 0.6, 0.003, [176, 170, 160], 0.06, [148, 142, 134], 61, 0);
    X.tileKG = tileTex(S2, 1.2, 0.3, 0.3, 0.004, [168, 160, 150], 0.08, [120, 116, 110], 62, 0);
    X.tileBath = tileTex(S2, 2.4, 0.6, 0.6, 0.003, [196, 194, 188], 0.035, [168, 166, 160], 63, 0);
    X.tileWall = tileTex(S2, 1.2, 0.6, 0.3, 0.0025, [238, 238, 234], 0.02, [204, 204, 198], 64, 0);
    X.splash = tileTex(S2, 0.6, 0.15, 0.075, 0.002, [240, 240, 236], 0.025, [196, 196, 190], 65, 0.5);
    X.tileOut = tileTex(S2, 2.4, 0.4, 0.4, 0.004, [150, 140, 128], 0.08, [110, 104, 96], 66, 0);
    X.pavers = tileTex(S2, 2.4, 0.4, 0.4, 0.006, [178, 172, 160], 0.07, [116, 112, 104], 67, 0);
    X.sidewalk = tileTex(S2, 1.2, 0.2, 0.1, 0.004, [150, 148, 144], 0.09, [96, 94, 90], 68, 0.5);
    // Asphalt
    { const n = vnoise(S2, S2, 8, 4, 71), r = rng(72);
      add('asphalt', paint(S2, S2, (x, y, i, p) => { const s = r(); const v = 0.30 + (n[i] - 0.5) * 0.08 + (s < 0.05 ? 0.12 : s > 0.97 ? -0.08 : 0); p[0] = 120 * v + 8; p[1] = 120 * v + 8; p[2] = 124 * v + 8; p[3] = 0.5 + (s - 0.5) * 0.5; }, true), [3, 3]); }
    // Rasen
    { const n = vnoise(S2, S2, 6, 5, 81), g = vnoise(S2, S2, 128, 1, 82);
      add('lawn', paint(S2, S2, (x, y, i, p) => { const v = 0.55 + (n[i] - 0.5) * 0.35 + (g[i] - 0.5) * 0.45; p[0] = 60 * v + 18; p[1] = 112 * v + 28; p[2] = 36 * v + 12; p[3] = g[i]; }, true), [2.5, 2.5]); }
    // Laub (Hecke, Baumkronen)
    { const n = vnoise(S2, S2, 10, 4, 91), g = vnoise(S2, S2, 96, 1, 92);
      add('leaves', paint(S2, S2, (x, y, i, p) => { const v = 0.45 + (n[i] - 0.5) * 0.4 + (g[i] - 0.5) * 0.7; p[0] = 44 * v + 10; p[1] = 92 * v + 20; p[2] = 38 * v + 10; p[3] = g[i]; }, true), [1.2, 1.2]); }
    // Dachziegel (Pfanne, rotbraun)
    X.roof = roofTex(S2, 101);
    // Klinker für den Schornstein
    X.brick = tileTex(S2, 0.96, 0.24, 0.0713, 0.011, [140, 72, 52], 0.14, [170, 162, 150], 111, 0.5);
    // Stoff (Sofa, Bett)
    { const n = vnoise(S2, S2, 64, 2, 121);
      add('fabric', paint(S2, S2, (x, y, i, p) => { const w = ((x >> 1) + (y >> 1)) & 1 ? 0.04 : -0.04; const v = 0.92 + (n[i] - 0.5) * 0.12 + w; p[0] = 255 * v; p[1] = 255 * v; p[2] = 255 * v; p[3] = 0.5 + w * 6; }, true), [0.25, 0.25]); }
    // Rinde
    { const n = vnoise(S2 / 2, S2 / 2, 6, 4, 131);
      add('bark', paint(S2 / 2, S2 / 2, (x, y, i, p) => { const s = 0.5 + 0.5 * Math.sin(x / (S2 / 2) * 40 + n[i] * 10); const v = 0.35 + s * 0.25 + (n[i] - 0.5) * 0.2; p[0] = 110 * v; p[1] = 90 * v; p[2] = 72 * v; p[3] = s; }, true), [0.6, 1.5]); }
    E.tex = X;
  }
  function woodTex(S, joints, seed) {
    const n = vnoise(S, S, 6, 4, seed), f = vnoise(S, S, 48, 2, seed + 1), r = rng(seed + 2);
    const rows = 12, plankL = 0.5, offs = [], tones = [];
    for (let k = 0; k < rows * 3; k++) { offs.push(r()); tones.push(0.84 + r() * 0.26); }
    const res = paint(S, S, (x, y, i, p) => {
      const u = x / S, v = y / S, row = Math.floor(v * rows), lv = v * rows - row;
      const sh = offs[row], seg = Math.floor(u / plankL + sh), tone = joints ? tones[(row * 3 + seg) % tones.length] : 0.95 + (n[i] - 0.5) * 0.1;
      const grain = 0.5 + 0.5 * Math.sin((lv * 9 + n[i] * 7 + f[i] * 0.6) * Math.PI * 2);
      let k = tone * (0.86 + grain * 0.12 + (f[i] - 0.5) * 0.08);
      let hgt = 0.55 + grain * 0.08;
      if (joints) {
        const du = Math.abs(((u / plankL + sh) % 1 + 1) % 1), edge = Math.min(lv, 1 - lv) * S / rows, butt = Math.min(du, 1 - du) * S * plankL;
        if (edge < 0.9 || butt < 0.9) { k *= 0.55; hgt = 0.15; }
      }
      p[0] = Math.min(255, 182 * k); p[1] = Math.min(255, 132 * k); p[2] = Math.min(255, 84 * k); p[3] = hgt;
    }, true);
    const world = joints ? [2.4, 2.4] : [1.2, 1.2];
    return { map: texFrom(res.c, world, true), bump: texFrom(res.b, world, false) };
  }
  /* Fliesen: Texturkachel world×world m, Fliese tw×th m, Fuge g m, Versatz off (0…1) */
  function tileTex(S, world, tw, th, g, base, vari, grout, seed, off) {
    const n = vnoise(S, S, 12, 3, seed), r = rng(seed + 1), cols = Math.round(world / tw), rows = Math.round(world / th), tone = [];
    for (let k = 0; k < cols * rows; k++) tone.push(1 + (r() - 0.5) * 2 * vari);
    const gp = g / world * S;
    const res = paint(S, S, (x, y, i, p) => {
      const fy = y / S * rows, row = Math.floor(fy), fx = x / S * cols + (row % 2 ? off * 1 : 0), col = Math.floor(fx) % cols;
      const ex = Math.min(fx - Math.floor(fx), 1 - (fx - Math.floor(fx))) * S / cols, ey = Math.min(fy - row, 1 - (fy - row)) * S / rows;
      if (ex < gp || ey < gp) { const v = 0.97 + (n[i] - 0.5) * 0.1; p[0] = grout[0] * v; p[1] = grout[1] * v; p[2] = grout[2] * v; p[3] = 0.2; return; }
      const t = tone[(row * cols + col) % tone.length], bev = Math.min(1, Math.min(ex, ey) / (gp * 1.6 + 1));
      const v = t * (0.97 + (n[i] - 0.5) * 0.06) * (0.93 + 0.07 * bev);
      p[0] = Math.min(255, base[0] * v); p[1] = Math.min(255, base[1] * v); p[2] = Math.min(255, base[2] * v); p[3] = 0.55 + 0.3 * bev;
    }, true);
    return { map: texFrom(res.c, [world, world], true), bump: texFrom(res.b, [world, world], false) };
  }
  function roofTex(S, seed) {
    const n = vnoise(S, S, 8, 4, seed), r = rng(seed + 1), cols = 4, rows = 4, tone = [];
    for (let k = 0; k < cols * rows; k++) tone.push(0.8 + r() * 0.35);
    const res = paint(S, S, (x, y, i, p) => {
      const fy = y / S * rows, row = Math.floor(fy), ly = fy - row, fx = x / S * cols + (row % 2) * 0.5, col = Math.floor(fx) % cols, lx = fx - Math.floor(fx);
      const wave = 0.5 + 0.5 * Math.cos(lx * Math.PI * 2);                    // Pfannenprofil
      const shade = ly > 0.86 ? 0.45 : 0.78 + 0.22 * (1 - ly);              // Überdeckung unten dunkel
      const v = tone[(row * cols + col) % tone.length] * shade * (0.82 + wave * 0.22) * (0.94 + (n[i] - 0.5) * 0.16);
      p[0] = Math.min(255, 150 * v); p[1] = Math.min(255, 66 * v); p[2] = Math.min(255, 46 * v); p[3] = ly > 0.86 ? 0.1 : 0.35 + wave * 0.5;
    }, true);
    return { map: texFrom(res.c, [1.2, 1.32], true), bump: texFrom(res.b, [1.2, 1.32], false) };
  }

  /* ---------- Materialien ----------
     Alle Hausmaterialien bekommen: Schnittebene (Clipping), Raum-Licht-Tor
     (Lampen leuchten nur in ihrem Raum, kein Licht durch Wände) und optional
     dunkle Schnittflächen (Rückseiten = „Poché“). */
  /* Includes sind in onBeforeCompile noch nicht aufgelöst: den Baustein selbst einsetzen */
  const LFB = T.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometry, directLight );',
    'getPointLightInfo( pointLight, geometry, directLight );\n\t\tdirectLight.color *= lightGate( uLightRoom[ i ] );');
  if (LFB === T.ShaderChunk.lights_fragment_begin) throw new Error('lights_fragment_begin: Licht-Tor greift nicht');
  function patchMaterial(m, opts = {}) {
    const poche = !!opts.poche;
    m.onBeforeCompile = sh => {
      sh.uniforms.uLightRoom = E.uLightRoom;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRoom;\nvarying float vRoom;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoom = aRoom;');
      let fs = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vRoom;
#if NUM_POINT_LIGHTS > 0
uniform float uLightRoom[ NUM_POINT_LIGHTS ];
float lightGate( float lr ) { return ( lr < -0.5 || abs( lr - floor( vRoom + 0.5 ) ) < 0.5 ) ? 1.0 : 0.0; }
#endif`)
        .replace('#include <lights_fragment_begin>', LFB);
      if (poche) fs = fs.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tif ( !gl_FrontFacing ) gl_FragColor = vec4( 0.16, 0.145, 0.13, 1.0 );');
      sh.fragmentShader = fs;
    };
    m.customProgramCacheKey = () => 'h3' + (poche ? 'p' : '');
    if (opts.clip !== false) { m.clippingPlanes = [E.cutPlane]; m.clipShadows = true; }
    return m;
  }
  function std(name, o, opts = {}) {
    const t = o.tex ? E.tex[o.tex] : null;
    const m = new T.MeshStandardMaterial({
      color: o.color ?? 0xffffff, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0,
      map: t ? t.map : null, bumpMap: t && o.bump !== 0 ? t.bump : null, bumpScale: o.bump ?? 0.002,
      side: o.side ?? T.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1, envMapIntensity: o.env ?? 1, flatShading: !!o.flat,
    });
    m.userData.envBase = o.env ?? 1;
    m.userData.interior = !!opts.interior;
    patchMaterial(m, opts);
    E.mats[name] = m;
    return m;
  }
  function makeMaterials() {
    E.uLightRoom = { value: new Float32Array(Math.max(1, E.poolN)).fill(-2) };
    E.cutPlane = new T.Plane(new T.Vector3(0, -1, 0), 1000);
    const I = { interior: true }, W = { interior: true, poche: true }, X = { clip: false };
    // Wände/Decken
    std('plaster', { tex: 'plaster', color: 0xffffff, rough: 0.93, bump: 0.0012, side: T.DoubleSide, env: 0.55 }, W);
    std('ceiling', { tex: 'plaster', color: 0xfbf9f5, rough: 0.95, bump: 0.0008, env: 0.5 }, I);
    std('tileWall', { tex: 'tileWall', rough: 0.18, bump: 0.0015, side: T.DoubleSide, env: 0.8 }, W);
    std('splash', { tex: 'splash', rough: 0.15, bump: 0.0015, side: T.DoubleSide, env: 0.8 }, W);
    std('facade', { tex: 'facade', rough: 0.95, bump: 0.003, side: T.DoubleSide, env: 0.9 }, { poche: true });
    std('sockel', { tex: 'sockel', rough: 0.95, bump: 0.003, side: T.DoubleSide, env: 0.8 }, { poche: true });
    std('cap', { color: 0x3a3532, rough: 1, env: 0.3 }, {});
    // Böden
    std('parquet', { tex: 'parquet', rough: 0.42, bump: 0.0018, env: 0.7 }, I);
    std('screed', { tex: 'screed', rough: 0.7, bump: 0.001, env: 0.6 }, I);
    std('tileFloor', { tex: 'tileFloor', rough: 0.35, bump: 0.0015, env: 0.7 }, I);
    std('tileKG', { tex: 'tileKG', rough: 0.5, bump: 0.0015, env: 0.6 }, I);
    std('tileBath', { tex: 'tileBath', rough: 0.25, bump: 0.0015, env: 0.75 }, I);
    std('tileOut', { tex: 'tileOut', rough: 0.6, bump: 0.002, env: 0.9 }, {});
    std('pavers', { tex: 'pavers', rough: 0.85, bump: 0.003, env: 0.9 }, {});
    std('concrete', { tex: 'concrete', rough: 0.9, bump: 0.003, env: 0.9 }, {});
    // Holz, Lack, Metall, Glas
    std('oak', { tex: 'oak', rough: 0.45, bump: 0.0012, env: 0.7 }, I);
    std('lacquer', { color: 0xf4f3ef, rough: 0.32, env: 0.8 }, I);
    std('greyDoor', { color: 0x9aa0a4, rough: 0.45, metal: 0.2, env: 0.8 }, I);
    std('frontDoor', { color: 0x2f3337, rough: 0.35, metal: 0.25, env: 0.9 }, {});
    std('steel', { color: 0xc9ccd0, rough: 0.28, metal: 1, env: 1 }, I);
    std('darkMetal', { color: 0x3b3e42, rough: 0.45, metal: 0.6, env: 0.9 }, {});
    std('winFrame', { color: 0xf6f6f3, rough: 0.35, env: 0.9 }, {});
    std('glass', { color: 0xb8d4dc, rough: 0.03, transparent: true, opacity: 0.2, depthWrite: false, env: 1.2 }, {});
    std('glassDark', { color: 0x1e262d, rough: 0.06, metal: 0.4, env: 1.1 }, X);
    std('sill', { color: 0xe9e5dd, rough: 0.25, env: 0.8 }, I);
    std('alu', { color: 0x9da2a6, rough: 0.35, metal: 0.9, env: 0.9 }, {});
    // Einrichtung
    std('fabric', { tex: 'fabric', color: 0x8f949a, rough: 0.95, bump: 0.0015, env: 0.5 }, I);
    std('fabricWarm', { tex: 'fabric', color: 0xc9bca8, rough: 0.95, bump: 0.0015, env: 0.5 }, I);
    std('fabricBlue', { tex: 'fabric', color: 0x5d7389, rough: 0.95, bump: 0.0015, env: 0.5 }, I);
    std('linen', { tex: 'fabric', color: 0xf1eee8, rough: 0.9, bump: 0.001, env: 0.5 }, I);
    std('rug', { tex: 'fabric', color: 0xb9ad9a, rough: 1, bump: 0.002, env: 0.4 }, I);
    std('cabinet', { color: 0xf2f1ec, rough: 0.4, env: 0.7 }, I);
    std('cabinetGrey', { color: 0x6c7176, rough: 0.45, env: 0.7 }, I);
    std('worktop', { color: 0x3b3936, rough: 0.3, env: 0.9 }, I);
    std('ceramic', { color: 0xfbfbfa, rough: 0.08, env: 1 }, I);
    std('chrome', { color: 0xe5e7ea, rough: 0.12, metal: 1, env: 1.2 }, I);
    std('mirror', { color: 0xdde3e6, rough: 0.02, metal: 1, env: 1.4 }, I);
    std('black', { color: 0x16181a, rough: 0.4, env: 0.8 }, I);
    std('screen', { color: 0x0b0d10, rough: 0.12, metal: 0.2, env: 1 }, I);
    std('plastic', { color: 0xf3f2ee, rough: 0.38, env: 0.7 }, I);
    std('plasticGrey', { color: 0xb8b9b6, rough: 0.5, env: 0.6 }, I);
    std('tankPE', { color: 0xd8cfa0, rough: 0.6, transparent: false, env: 0.6 }, I);
    std('plant', { tex: 'leaves', color: 0x9fbf7f, rough: 0.9, bump: 0.003, env: 0.5 }, I);
    std('terracotta', { color: 0xa4593d, rough: 0.85, env: 0.6 }, {});
    // Außen
    std('roof', { tex: 'roof', rough: 0.72, bump: 0.006, env: 0.8 }, X);
    std('roofIn', { tex: 'plaster', color: 0xfbf9f5, rough: 0.95, env: 0.5 }, I);
    std('brick', { tex: 'brick', rough: 0.9, bump: 0.004, env: 0.7 }, X);
    std('lawn', { tex: 'lawn', rough: 1, bump: 0.004, env: 0.6 }, X);
    std('leaves', { tex: 'leaves', rough: 0.95, bump: 0.006, env: 0.55 }, X);
    std('bark', { tex: 'bark', rough: 0.95, bump: 0.006, env: 0.5 }, X);
    std('asphalt', { tex: 'asphalt', rough: 0.95, bump: 0.002, env: 0.6 }, X);
    std('sidewalk', { tex: 'sidewalk', rough: 0.9, bump: 0.003, env: 0.7 }, X);
    std('pavers2', { tex: 'pavers', rough: 0.85, bump: 0.003, env: 0.8 }, X);
    std('nb3', { tex: 'facade', color: 0xe7dcc6, rough: 0.95, bump: 0.003, env: 0.85 }, X);
    std('nb5', { tex: 'facade', color: 0xd4d8d8, rough: 0.95, bump: 0.003, env: 0.85 }, X);
    std('nbFar', { tex: 'facade', color: 0xcbc3b6, rough: 0.95, bump: 0.002, env: 0.8 }, X);
    std('sockelX', { tex: 'sockel', rough: 0.95, bump: 0.003, env: 0.8 }, X);
    std('concreteX', { tex: 'concrete', rough: 0.9, bump: 0.003, env: 0.9 }, X);
    std('glassDarkRoof', { color: 0x9fb6c4, rough: 0.04, transparent: true, opacity: 0.35, depthWrite: false, env: 1.3 }, X);
    std('winFrameX', { color: 0xf3f3f0, rough: 0.35, env: 0.9 }, X);
    std('alu2', { color: 0x8e9398, rough: 0.35, metal: 0.9, env: 0.9 }, X);
    std('gutter', { color: 0x6d6f70, rough: 0.35, metal: 0.8, env: 0.9 }, X);
    std('roofX', { tex: 'roof', rough: 0.72, bump: 0.006, env: 0.8 }, X);
    // Elektro
    std('elec', { color: 0xf7f6f2, rough: 0.3, env: 0.8 }, I);
    std('elecDark', { color: 0x232527, rough: 0.6, env: 0.4 }, I);
    std('elecMetal', { color: 0xb9bcbf, rough: 0.3, metal: 1, env: 1 }, I);
    std('elecRed', { color: 0xc8322a, rough: 0.35, env: 0.7 }, I);
    std('ledOrange', { color: 0xffa040, emissive: 0xff7a1a, ei: 1.2, rough: 0.4 }, I);
    std('cabinetSteel', { color: 0xe6e6e2, rough: 0.45, metal: 0.3, env: 0.8 }, I);
    std('lampBody', { color: 0xf2f0ea, rough: 0.4, env: 0.8 }, I);
    std('lampDark', { color: 0x2b2d2f, rough: 0.4, metal: 0.5, env: 0.8 }, I);
    std('lampOff', { color: 0xf4f1ea, rough: 0.35, transparent: false, env: 0.7 }, I);
    E.mats.lampOn = new T.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: true });
    E.mats.lampOn.color.multiplyScalar(4.5);
    E.mats.lampOn.clippingPlanes = [E.cutPlane];
    E.mats.streetOn = new T.MeshBasicMaterial({ color: new T.Color(0xfff1d6).multiplyScalar(4.5) });
    std('streetOff', { color: 0xf4f1ea, rough: 0.35, env: 0.7 }, { clip: false });
  }

  /* ---------- Geometrie-Puffer: je Material und Gruppe ein Mesh ---------- */
  class Buf {
    constructor() { this.p = []; this.n = []; this.u = []; this.r = []; }
    get empty() { return this.p.length === 0; }
  }
  const BUFS = new Map();       // key "gruppe|material" → Buf
  function buf(group, mat) { const k = group + '|' + mat; let b = BUFS.get(k); if (!b) { b = new Buf(); BUFS.set(k, b); } return b; }
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3();
  /* Viereck in three-Koordinaten (X, Y=Höhe, Z); Reihenfolge wird an die Normale angepasst */
  function face(b, P, N, U, room) {
    _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
    _b.set(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
    _c.crossVectors(_a, _b);
    if (_c.x * N[0] + _c.y * N[1] + _c.z * N[2] < 0) { P = [P[0], P[3], P[2], P[1]]; U = [U[0], U[3], U[2], U[1]]; }
    for (const i of [0, 1, 2, 0, 2, 3]) { b.p.push(P[i][0], P[i][1], P[i][2]); b.n.push(N[0], N[1], N[2]); b.u.push(U[i][0], U[i][1]); b.r.push(room); }
  }
  /* Plan-Koordinaten (x, y, z nach oben) → three [X, Y, Z] */
  const pt = (x, y, z) => [x, z, y];
  /* senkrechte Fläche an einer Linie: entlang 'x' (y fest) oder 'y' (x fest); n = +1/-1 Blickrichtung */
  function vface(b, axis, c, s0, s1, z00, z01, z10, z11, n, room) {
    // z0* unten, z1* oben; *0 bei s0, *1 bei s1
    if (axis === 'x') face(b, [pt(s0, c, z00), pt(s1, c, z01), pt(s1, c, z11), pt(s0, c, z10)], [0, 0, n], [[s0, z00], [s1, z01], [s1, z11], [s0, z10]], room);
    else face(b, [pt(c, s0, z00), pt(c, s1, z01), pt(c, s1, z11), pt(c, s0, z10)], [n, 0, 0], [[s0, z00], [s1, z01], [s1, z11], [s0, z10]], room);
  }
  function hface(b, x0, x1, y0, y1, z, up, room) {
    face(b, [pt(x0, y0, z), pt(x1, y0, z), pt(x1, y1, z), pt(x0, y1, z)], [0, up ? 1 : -1, 0], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], room);
  }
  function box(b, x0, x1, y0, y1, z0, z1, room, skip = '') {
    if (!skip.includes('b')) hface(b, x0, x1, y0, y1, z0, false, room);
    if (!skip.includes('t')) hface(b, x0, x1, y0, y1, z1, true, room);
    if (!skip.includes('n')) vface(b, 'x', y0, x0, x1, z0, z0, z1, z1, -1, room);
    if (!skip.includes('s')) vface(b, 'x', y1, x0, x1, z0, z0, z1, z1, 1, room);
    if (!skip.includes('w')) vface(b, 'y', x0, y0, y1, z0, z0, z1, z1, -1, room);
    if (!skip.includes('e')) vface(b, 'y', x1, y0, y1, z0, z0, z1, z1, 1, room);
  }
  const _m4 = new T.Matrix4(), _n3 = new T.Matrix3(), _v = new T.Vector3();
  /* beliebige three-Geometrie (lokal) mit Matrix in den Puffer übernehmen; UV aus Geometrie oder planar */
  function addGeo(b, geo, matrix, room, uvScale = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    _n3.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix); b.p.push(_v.x, _v.y, _v.z);
      const px = _v.x, py = _v.y, pz = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize(); b.n.push(_v.x, _v.y, _v.z);
      if (U && uvScale > 0) b.u.push(U.getX(i) * uvScale, U.getY(i) * uvScale);
      else { const ax = Math.abs(_v.x), ay = Math.abs(_v.y); b.u.push(ay > ax && ay > Math.abs(_v.z) ? px : ax > Math.abs(_v.z) ? pz : px, ay > ax && ay > Math.abs(_v.z) ? pz : py); }
      b.r.push(room);
    }
    if (g !== geo) g.dispose();
  }
  /* Matrix aus Plan-Position (x, y, z unten) + Drehung um die Hochachse + Skalierung */
  function M(x, y, z, rot = 0, sx = 1, sy = 1, sz = 1) {
    return new T.Matrix4().compose(new T.Vector3(x, z, y), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rot), new T.Vector3(sx, sy, sz));
  }
  function flush(groupObj, groupKey, opts = {}) {
    for (const [k, b] of BUFS) {
      const [g, mat] = k.split('|');
      if (g !== groupKey || b.empty) continue;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(b.p, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2));
      geo.setAttribute('aRoom', new T.Float32BufferAttribute(b.r, 1));
      geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, E.mats[mat]);
      mesh.castShadow = opts.cast !== false && !['glass', 'lampOn', 'cap'].includes(mat);
      mesh.receiveShadow = true;
      mesh.name = k;
      groupObj.add(mesh);
      BUFS.delete(k);
    }
  }

  /* ---------- Raum-Licht-Tore ---------- */
  function buildGates() {
    let n = 1;
    for (const R of Object.values(RI)) {
      if (R.room.kind === 'out') { E.gate[R.id] = 0; continue; }
      if (E.gate[R.id] == null) E.gate[R.id] = n++;
      // offene Durchgänge (ohne Wand) teilen sich das Tor
      for (const o of R.openings.filter(q => q.op.kind === 'open')) {
        for (const P of Object.values(RI)) if (P !== R && P.openings.some(q => q.op === o.op)) E.gate[P.id] = E.gate[R.id];
      }
    }
  }
  const gateOf = rid => (rid && E.gate[rid] != null ? E.gate[rid] : 0);

  /* =====================================================================
     WÄNDE über ein 1-cm-Raster je Geschoss
     Zelle: Raum (Label), Wand (Profil) oder Luft. Seitenflächen entstehen an
     jedem Übergang Wand → Luft und werden entlang der Linie zusammengefasst.
     ===================================================================== */
  function floorRooms(fid) { return Object.values(RI).filter(R => R.floor === fid); }
  function ceilH(fid, y) { const f = FLOOR[fid]; return f.roof ? Math.min(f.h, roofH(y)) : f.h; }
  function buildWallGrid(fid) {
    const f = FLOOR[fid], rect = fid === 'DG' ? [HOUSE.x0, HOUSE.x1, DG_Y[0], DG_Y[1]] : [HOUSE.x0, HOUSE.x1, HOUSE.y0, HOUSE.y1];
    const X0 = rect[0] - 0.05, Y0 = rect[2] - 0.05, NX = Math.ceil((rect[1] + 0.05 - X0) / CS), NY = Math.ceil((rect[3] + 0.05 - Y0) / CS);
    const N = NX * NY, L = new Int16Array(N).fill(-1), Wl = new Uint8Array(N), OP = new Int16Array(N).fill(-1);
    const rooms = floorRooms(fid), isOut = rooms.map(R => R.room.kind === 'out');
    const cx = i => X0 + (i + 0.5) * CS, cy = j => Y0 + (j + 0.5) * CS;
    // Räume rastern (Zeilenschnitte)
    rooms.forEach((R, ri) => {
      const P = R.nominal;
      for (let j = 0; j < NY; j++) {
        const y = cy(j), xs = [];
        for (let k = 0; k < P.length; k++) {
          const a = P[k], b = P[(k + 1) % P.length];
          if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil((xs[k] - X0) / CS - 0.5)), i1 = Math.min(NX - 1, Math.floor((xs[k + 1] - X0) / CS - 0.5));
          for (let i = i0; i <= i1; i++) L[j * NX + i] = ri;
        }
      }
    });
    // Wand = innerhalb der Gebäudehülle und in keinem Raum
    const ko = KEEP_OUT[fid];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = cx(i), y = cy(j), k = j * NX + i;
      if (x < rect[0] || x > rect[1] || y < rect[2] || y > rect[3] || L[k] >= 0) continue;
      if (ko && x > ko[0] && x < ko[1] && y > ko[2] && y < ko[3]) continue;
      Wl[k] = 1;
    }
    // zu dünne Wände zwischen zwei Räumen beidseitig auf Mindeststärke bringen
    const thick = (a, b) => (isOut[a] || isOut[b] ? 24 : 12);
    const widen = (get, set, len, count) => {
      for (let line = 0; line < count; line++) {
        let last = -1, lastPos = -1;
        for (let p = 0; p < len; p++) {
          const lab = get(line, p);
          if (lab < 0) continue;
          if (last >= 0 && lab !== last && !(isOut[last] && isOut[lab])) {
            const gap = p - lastPos - 1, need = thick(last, lab) - gap;
            if (need > 0) {
              const a = Math.ceil(need / 2), bb = need - a;
              for (let q = lastPos - a + 1; q <= lastPos; q++) if (q >= 0) set(line, q);
              for (let q = p; q < p + bb && q < len; q++) set(line, q);
            }
          }
          last = lab; lastPos = p;
        }
      }
    };
    const extra = new Uint8Array(N);
    widen((j, i) => L[j * NX + i], (j, i) => { extra[j * NX + i] = 1; }, NX, NY);
    widen((i, j) => L[j * NX + i], (i, j) => { extra[j * NX + i] = 1; }, NY, NX);
    for (let k = 0; k < N; k++) if (extra[k]) Wl[k] = 1;
    // Öffnungen quer durch die Wand stanzen
    const ops = OPENINGS.filter(o => o.floor === fid), opInfo = [];
    ops.forEach((op, oi) => {
      const info = { op, oi, w0: Infinity, w1: -Infinity, a: op.a, b: op.b, cells: 0 };
      if (op.axis === 'y') {
        const jc = Math.round((op.at - Y0) / CS - 0.5);
        for (let i = Math.ceil((op.a - X0) / CS - 0.5); i <= Math.floor((op.b - X0) / CS - 0.5); i++) {
          let j0 = jc; for (let d = 0; d <= 4 && !Wl[j0 * NX + i]; d++) j0 = Wl[(jc - d) * NX + i] ? jc - d : Wl[(jc + d) * NX + i] ? jc + d : j0;
          if (!Wl[j0 * NX + i]) continue;
          let lo = j0, hi = j0;
          while (lo - 1 >= 0 && Wl[(lo - 1) * NX + i] && jc - lo < 80) lo--;
          while (hi + 1 < NY && Wl[(hi + 1) * NX + i] && hi - jc < 80) hi++;
          for (let j = lo; j <= hi; j++) { OP[j * NX + i] = oi; info.cells++; }
          info.w0 = Math.min(info.w0, Y0 + lo * CS); info.w1 = Math.max(info.w1, Y0 + (hi + 1) * CS);
        }
      } else {
        const ic = Math.round((op.at - X0) / CS - 0.5);
        for (let j = Math.ceil((op.a - Y0) / CS - 0.5); j <= Math.floor((op.b - Y0) / CS - 0.5); j++) {
          let i0 = ic; for (let d = 0; d <= 4 && !Wl[j * NX + i0]; d++) i0 = Wl[j * NX + ic - d] ? ic - d : Wl[j * NX + ic + d] ? ic + d : i0;
          if (!Wl[j * NX + i0]) continue;
          let lo = i0, hi = i0;
          while (lo - 1 >= 0 && Wl[j * NX + lo - 1] && ic - lo < 80) lo--;
          while (hi + 1 < NX && Wl[j * NX + hi + 1] && hi - ic < 80) hi++;
          for (let i = lo; i <= hi; i++) { OP[j * NX + i] = oi; info.cells++; }
          info.w0 = Math.min(info.w0, X0 + lo * CS); info.w1 = Math.max(info.w1, X0 + (hi + 1) * CS);
        }
      }
      opInfo.push(info);
    });
    const dh = DOOR_H[fid];
    const prof = ops.map(op => (op.kind === 'win' ? [[0, op.z0], [op.z1, null]] : op.kind === 'door' ? [[dh, null]] : []));
    const cell = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NY ? -3 : !Wl[j * NX + i] ? -1 : OP[j * NX + i] >= 0 ? OP[j * NX + i] : -2);
    return { fid, f, X0, Y0, NX, NY, L, Wl, OP, rooms, isOut, ops, opInfo, prof, cell, dh, rect };
  }
  /* massive Intervalle einer Zelle (Typ -2 = Vollwand, ≥0 = Öffnung) bei Deckenhöhe H */
  function solids(Gd, t, H) {
    if (t === -1 || t === -3) return [];
    if (t === -2) return [[0, H]];
    return Gd.prof[t].map(([a, b]) => [a, b == null ? H : Math.min(b, H)]).filter(([a, b]) => b - a > 0.005);
  }
  function subtract(A, B) {
    let out = A.map(x => x.slice());
    for (const [b0, b1] of B) out = out.flatMap(([a0, a1]) => (b1 <= a0 || b0 >= a1 ? [[a0, a1]] : [[a0, Math.min(a1, b0)], [Math.max(a0, b1), a1]].filter(([p, q]) => q - p > 0.005)));
    return out;
  }
  /* Art der Luftseite: Raum / Laibung / außen */
  function airClass(Gd, i, j, t, fromI, fromJ) {
    const fid = Gd.fid;
    if (t >= 0) {                                       // Luft in einer Öffnung → Laibung
      const info = Gd.opInfo[t], op = info.op, across = op.axis === 'y' ? Gd.Y0 + (j + 0.5) * CS : Gd.X0 + (i + 0.5) * CS;
      const sideA = sideOf(Gd, info, -1), sideB = sideOf(Gd, info, 1);
      const nearA = across - info.w0 < info.w1 - across;
      const rid = nearA ? sideA : sideB, other = nearA ? sideB : sideA;
      if (rid === null && other !== null && op.kind !== 'open') {      // äußere Laibung: bis zur Rahmenebene Fassade
        const outDir = sideA === null ? -1 : 1, fp = framePlane(info, outDir);
        const outer = outDir < 0 ? across < fp : across > fp;
        return { kind: outer ? 'ext' : 'room', rid: outer ? null : other, reveal: true };
      }
      if (rid !== null && Gd.isOut[Gd.rooms.findIndex(R => R.id === rid)]) {
        const fp = framePlane(info, sideA === rid ? -1 : 1);
        const outer = sideA === rid ? across < fp : across > fp;
        return { kind: outer ? 'ext' : 'room', rid: outer ? rid : other, reveal: true };
      }
      return { kind: rid ? 'room' : 'ext', rid: rid || other, reveal: true };
    }
    if (t === -1) {
      const lab = Gd.L[j * Gd.NX + i];
      if (lab >= 0) return Gd.isOut[lab] ? { kind: 'ext', rid: Gd.rooms[lab].id } : { kind: 'room', rid: Gd.rooms[lab].id };
    }
    return { kind: 'ext', rid: null };
  }
  /* Raum auf einer Seite einer Öffnung (−1: Richtung w0, +1: Richtung w1), null = außen */
  function sideOf(Gd, info, dir) {
    if (info['side' + dir] !== undefined) return info['side' + dir];
    const op = info.op, mid = (op.a + op.b) / 2, c = dir < 0 ? info.w0 - 0.03 : info.w1 + 0.03;
    const x = op.axis === 'y' ? mid : c, y = op.axis === 'y' ? c : mid;
    const R = Gd.rooms.find(r => pointInPoly(r.nominal, x, y));
    info['side' + dir] = R ? R.id : null;
    return info['side' + dir];
  }
  /* Rahmenebene: 1/3 der Laibungstiefe von außen, höchstens 10 cm (outDir: Richtung nach außen) */
  function framePlane(info, outDir) {
    const d = Math.min(0.10, (info.w1 - info.w0) * 0.33);
    return outDir < 0 ? info.w0 + d : info.w1 - d;
  }
  /* Materialaufteilung einer Wandfläche in der Höhe */
  function wallMats(Gd, cls, z0, z1, axis, c, s, n) {
    const fid = Gd.fid, out = [];
    if (cls.kind === 'ext') {
      const zs = FLOOR[fid].z, sk = 0.3 - zs;                          // Sockel bis 30 cm über EG-FFB (weltweit)
      if (fid === 'KG') return [[z0, z1, 'sockel']];
      if (fid === 'EG' && z0 < sk) { out.push([z0, Math.min(z1, sk), 'sockel']); if (z1 > sk) out.push([sk, z1, 'facade']); return out; }
      return [[z0, z1, 'facade']];
    }
    const rid = cls.rid, th = TILE_H[rid];
    if (th && !cls.reveal) return z1 <= th ? [[z0, z1, 'tileWall']] : z0 >= th ? [[z0, z1, 'plaster']] : [[z0, th, 'tileWall'], [th, z1, 'plaster']];
    if (rid === 'eg_kueche' && !cls.reveal && splashAt(axis, c, s, n)) {
      const parts = [[z0, Math.min(z1, 0.92), 'plaster'], [Math.max(z0, 0.92), Math.min(z1, 1.48), 'splash'], [Math.max(z0, 1.48), z1, 'plaster']];
      return parts.filter(([a, b]) => b - a > 0.005);
    }
    return [[z0, z1, 'plaster']];
  }
  /* Fliesenspiegel Küche: Ostwand (x≈7) y 6,30…10,6 und Straßenwand (y≈10,6) x 4,6…7 */
  function splashAt(axis, c, s, n) {
    if (axis === 'y' && n < 0 && c > 6.85 && s > 6.3 && s < 10.6) return true;
    if (axis === 'x' && n < 0 && c > 10.4 && s > 4.6 && s < 7.0) return true;
    return false;
  }
  /* Seitenflächen erzeugen (beide Rasterrichtungen), gleiche Signatur entlang der Linie zusammenfassen */
  function emitWalls(Gd, grp) {
    const { NX, NY, X0, Y0, fid } = Gd, rf = FLOOR[fid].roof;
    const Hy = y => ceilH(fid, y);
    const breaks = rf ? [ROOF.yA + (FLOOR.DG.h - ROOF.knee) / ROOF.slope, ROOF.ridgeY, ROOF.yB - (FLOOR.DG.h - ROOF.knee) / ROOF.slope] : [];
    const skirt = [];
    // Linien mit festem x (Grenze zwischen Spalte i und i+1), laufen in y
    const runLine = (axis, c, count, get, coordOf) => {
      let cur = new Map();
      const close = (key, r, sEnd) => {
        const s0 = r.s0, s1 = sEnd;
        for (const [z0, z1t, mat, n, gate, base] of r.pieces) {
          const b = buf(grp, mat);
          const top0 = z1t < 0 ? Hy(axis === 'y' ? s0 : c) : z1t, top1 = z1t < 0 ? Hy(axis === 'y' ? s1 : c) : z1t;
          vface(b, axis, c, s0, s1, z0, z0, top0, top1, n, gate);
          if (base && z0 < 0.001) skirt.push({ axis, c, s0, s1, n, gate, tile: mat === 'tileWall' });
        }
      };
      for (let p = 0; p <= count; p++) {
        const sig = p < count ? get(p) : null, next = new Map();
        if (sig) for (const pc of sig) {
          const key = pc.key, s = coordOf(p);
          const r = cur.get(key);
          if (r && !(rf && axis === 'y' && breaks.some(bk => bk > r.s0 + 1e-6 && bk <= s + 1e-6 && Math.abs(bk - s) < CS))) { next.set(key, r); cur.delete(key); }
          else next.set(key, { s0: s, pieces: pc.pieces });
        }
        for (const [key, r] of cur) close(key, r, coordOf(p));
        cur = next;
      }
    };
    const sideSig = (ti, tj, ai, aj, bi, bj, n, axis, c, s) => {
      const ta = Gd.cell(ai, aj), tb = Gd.cell(bi, bj);
      if (ta === tb || ta === -1 || ta === -3) return null;
      const H = Hy(axis === 'y' ? s : c);
      const ex = subtract(solids(Gd, ta, H), solids(Gd, tb, H));
      if (!ex.length) return null;
      const cls = airClass(Gd, bi, bj, tb === -2 ? -1 : tb === -3 ? -3 : tb, ai, aj);
      const gate = cls.kind === 'room' ? gateOf(cls.rid) : (cls.rid ? gateOf(cls.rid) : 0);
      const pieces = [];
      for (const [z0, z1] of ex) {
        const full = Math.abs(z1 - H) < 0.003;
        for (const [m0, m1, mat] of wallMats(Gd, cls, z0, z1, axis, c, s, n)) {
          const zt = full && Math.abs(m1 - z1) < 1e-6 && rf ? -1 : m1;
          pieces.push([m0, zt, mat, n, gate, cls.kind === 'room' && !cls.reveal && tb === -1]);
        }
      }
      const kitchen = cls.rid === 'eg_kueche' && splashAt(axis, c, s, n) ? 1 : 0;
      return { key: pieces.map(q => q.join(',')).join(';') + '|' + kitchen, pieces };
    };
    for (let i = 0; i < NX - 1; i++) {
      const c = X0 + (i + 1) * CS;
      runLine('y', c, NY, j => {
        const s = Y0 + (j + 0.5) * CS, out = [];
        const A = sideSig(0, 0, i, j, i + 1, j, 1, 'y', c, s); if (A) out.push(A);
        const B = sideSig(0, 0, i + 1, j, i, j, -1, 'y', c, s); if (B) out.push({ key: 'B' + B.key, pieces: B.pieces });
        return out;
      }, j => Y0 + j * CS);
    }
    for (let j = 0; j < NY - 1; j++) {
      const c = Y0 + (j + 1) * CS;
      runLine('x', c, NX, i => {
        const s = X0 + (i + 0.5) * CS, out = [];
        const A = sideSig(0, 0, i, j, i, j + 1, 1, 'x', c, s); if (A) out.push(A);
        const B = sideSig(0, 0, i, j + 1, i, j, -1, 'x', c, s); if (B) out.push({ key: 'B' + B.key, pieces: B.pieces });
        return out;
      }, i => X0 + i * CS);
    }
    // Sockelleisten (Holz weiß bzw. Fliesensockel)
    for (const k of skirt) {
      if (k.s1 - k.s0 < 0.04) continue;
      const b = buf(grp, k.tile ? 'tileWall' : 'lacquer'), d = 0.012 * k.n, h = k.tile ? 0.0 : 0.06;
      if (!h) continue;
      if (k.axis === 'y') box(b, Math.min(k.c, k.c + d), Math.max(k.c, k.c + d), k.s0, k.s1, 0, h, k.gate, 'b');
      else box(b, k.s0, k.s1, Math.min(k.c, k.c + d), Math.max(k.c, k.c + d), 0, h, k.gate, 'b');
    }
    emitOpeningFaces(Gd, grp);
    emitCaps(Gd, grp);
  }
  /* Sturz-Unterseiten und Brüstungsoberseiten der Öffnungen */
  function emitOpeningFaces(Gd, grp) {
    for (const info of Gd.opInfo) {
      if (!info.cells) continue;
      const op = info.op, horizontal = [];
      if (op.kind === 'win') horizontal.push([op.z0, true], [op.z1, false]);
      if (op.kind === 'door') horizontal.push([Gd.dh, false]);
      const sA = sideOf(Gd, info, -1), sB = sideOf(Gd, info, 1);
      const extA = sA === null || Gd.isOut[Gd.rooms.findIndex(R => R.id === sA)], extB = sB === null || Gd.isOut[Gd.rooms.findIndex(R => R.id === sB)];
      for (const [z, up] of horizontal) {
        // in zwei Tiefenbereiche teilen: außen (Fassade) bis zur Rahmenebene, innen Putz
        let cuts = [[info.w0, info.w1, extA && extB ? 'facade' : 'plaster', sA || sB]];
        if (extA !== extB) {
          const fp = framePlane(info, extA ? -1 : 1);
          cuts = extA ? [[info.w0, fp, 'facade', sA], [fp, info.w1, 'plaster', sB]] : [[info.w0, fp, 'plaster', sA], [fp, info.w1, 'facade', sB]];
        }
        for (const [w0, w1, mat, rid] of cuts) {
          const b = buf(grp, mat), g = gateOf(rid);
          if (op.axis === 'y') hface(b, op.a, op.b, w0, w1, z, up, g); else hface(b, w0, w1, op.a, op.b, z, up, g);
        }
      }
    }
  }
  /* Wandoberseiten (sichtbar beim Auseinanderziehen) als zusammengefasste Rechtecke */
  function emitCaps(Gd, grp) {
    if (FLOOR[Gd.fid].roof) return;
    const { NX, NY, X0, Y0 } = Gd, done = new Uint8Array(NX * NY), H = FLOOR[Gd.fid].h, b = buf(grp, 'cap');
    const solidTop = k => Gd.Wl[k] && !(Gd.OP[k] >= 0 && Gd.ops[Gd.OP[k]].kind === 'open');
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (done[k] || !solidTop(k)) continue;
      let w = 1; while (i + w < NX && !done[k + w] && solidTop(k + w)) w++;
      let h = 1;
      outer: while (j + h < NY) { for (let q = 0; q < w; q++) { const kk = (j + h) * NX + i + q; if (done[kk] || !solidTop(kk)) break outer; } h++; }
      for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) done[(j + r) * NX + i + q] = 1;
      hface(b, X0 + i * CS, X0 + (i + w) * CS, Y0 + j * CS, Y0 + (j + h) * CS, H, true, 0);
    }
  }
  /* Gerät auf die echte Wandoberfläche setzen (vom Raum aus entlang der Normale suchen) */
  function deviceSurfaces(Gd) {
    const { NX, NY, X0, Y0 } = Gd;
    for (const d of DEVICES.filter(q => q.floor === Gd.fid)) {
      if (d.mount === 'ceil') { E.devPos[d.id] = { x: d.x, y: d.y, z: d.h, nx: 0, ny: 0, ceil: true }; continue; }
      const outside = /außen/i.test(d.label) && !(RI[d.room].room.kind === 'out');
      // vom Gerät in die Wand hinein bis zur ersten Wandzelle, dann (innen) zurück zur Oberfläche
      let x = d.x, y = d.y;
      const cellAt = (px, py) => { const i = Math.floor((px - X0) / CS), j = Math.floor((py - Y0) / CS); return i < 0 || j < 0 || i >= NX || j >= NY ? 0 : Gd.Wl[j * NX + i]; };
      let t = -0.06;
      while (t < 0.2 && cellAt(d.x + d.nx * t, d.y + d.ny * t)) t += 0.005;     // Wand ragt in den Raum: Oberfläche weiter innen
      let surf = t;
      if (t <= -0.059) {                                                       // Gerät steht vor der Wand: Oberfläche suchen
        let u = 0; while (u > -0.5 && !cellAt(d.x - d.nx * (-u), d.y - d.ny * (-u))) u -= 0.005; surf = u;
      }
      x = d.x + d.nx * surf; y = d.y + d.ny * surf;
      let nx = d.nx, ny = d.ny;
      if (outside) {                                                           // Außenleuchte/Klingel: auf die Außenseite durch die Wand
        let u = 0.01; while (u < 1.2 && cellAt(x - nx * u, y - ny * u)) u += 0.005;
        x -= nx * u; y -= ny * u; nx = -nx; ny = -ny;
      }
      E.devPos[d.id] = { x, y, z: d.h, nx, ny, ceil: false, outside };
    }
  }

  /* =====================================================================
     TREPPEN (Geometrie für Darstellung und Begehung)
     ===================================================================== */
  function straightStairs() {
    return FIXTURES.filter(f => f.type === 'straight').map(fx => {
      const i = FLOORS.findIndex(f => f.id === fx.floor), to = FLOORS[i + 1].id, rise = FLOOR[to].z - FLOOR[fx.floor].z;
      return { kind: 'straight', from: fx.floor, to, x0: fx.x0, x1: fx.x1, y0: fx.y0, y1: fx.y1, steps: fx.steps, dir: fx.dir, rise, z0: FLOOR[fx.floor].z };
    });
  }
  /* Höhe der Lauflinie (Welt) an Punkt y einer geraden Treppe */
  const straightH = (s, y) => s.z0 + s.rise * clamp(s.dir < 0 ? (s.y1 - y) / (s.y1 - s.y0) : (y - s.y0) / (s.y1 - s.y0), 0, 1);
  /* Löcher in Geschossdecken: über jeder Treppe so weit, dass man aufrecht hinaufkommt */
  function slabHoles(fid) {
    const holes = [];
    for (const s of straightStairs()) if (s.to === fid) {
      // Kopfhöhe 2,0 m: Loch dort, wo die Lauflinie höher als (Decke unten − 2,0) liegt
      const need = FLOOR[fid].z - SLAB - 2.0 - s.z0, t = clamp(need / s.rise, 0, 1);
      const yEdge = s.dir < 0 ? s.y1 - t * (s.y1 - s.y0) : s.y0 + t * (s.y1 - s.y0);
      holes.push({ type: 'rect', x0: s.x0, x1: s.x1, y0: s.dir < 0 ? s.y0 : yEdge, y1: s.dir < 0 ? yEdge : s.y1 });
    }
    if (fid === 'EG') holes.push({ type: 'circle', cx: SPIRAL.cx, cy: SPIRAL.cy, r: SPIRAL.r });
    return holes;
  }
  function holeShape(h, clipRect) {
    const p = new T.Path();
    if (h.type === 'circle') { p.absarc(h.cx, h.cy, h.r, 0, Math.PI * 2, true); return p; }
    let { x0, x1, y0, y1 } = h;
    if (clipRect) { x0 = Math.max(x0, clipRect[0] + 0.01); x1 = Math.min(x1, clipRect[1] - 0.01); y0 = Math.max(y0, clipRect[2] + 0.01); y1 = Math.min(y1, clipRect[3] - 0.01); }
    p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0);
    return p;
  }
  const bboxOf = P => [Math.min(...P.map(p => p[0])), Math.max(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[1]))];
  function holeInside(h, R) {
    const bb = bboxOf(R.nominal);
    if (h.type === 'circle') return pointInPoly(R.nominal, h.cx, h.cy);
    const cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
    return pointInPoly(R.nominal, cx, cy) && h.x1 > bb[0] && h.x0 < bb[1];
  }
  /* waagerechte Raumfläche (Boden oder Decke) mit Löchern */
  function roomPlane(b, R, z, up, holes) {
    const shape = new T.Shape(R.nominal.map(([x, y]) => new T.Vector2(x, y)));
    const bb = bboxOf(R.nominal);
    for (const h of holes) if (holeInside(h, R)) shape.holes.push(holeShape(h, bb));
    const g = new T.ShapeGeometry(shape, 24);
    const P = g.attributes.position, idx = g.index.array, gate = gateOf(R.id);
    for (let k = 0; k < idx.length; k += 3) {
      const tri = [idx[k], idx[k + 1], idx[k + 2]];
      if (up) tri.reverse();                                   // (x,y) → (X,Z) dreht den Umlaufsinn: ohne Umkehr zeigt die Fläche nach unten
      for (const v of tri) { const x = P.getX(v), y = P.getY(v); b.p.push(x, z, y); b.n.push(0, up ? 1 : -1, 0); b.u.push(x, y); b.r.push(gate); }
    }
    g.dispose();
  }
  /* gerade Treppe: Eichenstufen, weiße Setzstufen und Wangen, Handlauf mit Stäben */
  function buildStraight(s, grp) {
    const n = s.steps, run = (s.y1 - s.y0) / n, rise = s.rise / n, gate = gateOf(Object.values(RI).find(R => R.floor === s.from && pointInPoly(R.nominal, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2)).id);
    const oak = buf(grp, 'oak'), white = buf(grp, 'lacquer'), steel = buf(grp, 'steel');
    for (let k = 0; k < n; k++) {
      const zt = (k + 1) * rise;                              // Oberkante Stufe k (lokal zur Startebene)
      const ya = s.dir < 0 ? s.y1 - (k + 1) * run : s.y0 + k * run, yb = ya + run;
      const nose = 0.03, y0 = s.dir < 0 ? ya - nose : ya, y1 = s.dir < 0 ? yb : yb + nose;
      if (k < n - 1) box(oak, s.x0 + 0.04, s.x1 - 0.04, y0, y1, zt - 0.04, zt, gate);
      const yr = s.dir < 0 ? yb - 0.01 : ya + 0.01;          // Setzstufe an der Vorderkante
      box(white, s.x0 + 0.04, s.x1 - 0.04, Math.min(yr, yr + 0.02 * -s.dir), Math.max(yr, yr + 0.02 * -s.dir), k * rise, zt - 0.04, gate);
    }
    // Wangen (schräge Bretter) als Vierecke mit Dicke
    for (const [xa, xb] of [[s.x0, s.x0 + 0.04], [s.x1 - 0.04, s.x1]]) {
      const yl = s.dir < 0 ? s.y1 + 0.02 : s.y0 - 0.02, yh = s.dir < 0 ? s.y0 - 0.02 : s.y1 + 0.02;
      const zl0 = -0.02, zh0 = s.rise - 0.32, zl1 = 0.3, zh1 = s.rise + 0.02;
      for (const [x, nn] of [[xa, -1], [xb, 1]]) vface(white, 'y', x, Math.min(yl, yh), Math.max(yl, yh), yl < yh ? zl0 : zh0, yl < yh ? zh0 : zl0, yl < yh ? zl1 : zh1, yl < yh ? zh1 : zl1, nn, gate);
      // Ober- und Unterkante
      const pts = (z0l, z0h) => [pt(xa, yl, z0l), pt(xb, yl, z0l), pt(xb, yh, z0h), pt(xa, yh, z0h)];
      face(white, pts(zl1, zh1), [0, 1, 0], [[0, 0], [0.04, 0], [0.04, 3], [0, 3]], gate);
      face(white, pts(zl0, zh0), [0, -1, 0], [[0, 0], [0.04, 0], [0.04, 3], [0, 3]], gate);
    }
    // Handlauf auf der offenen Seite + Stäbe, an der Wandseite Handlauf auf Haltern
    const hx = s.x1 - 0.02, hh = 0.9, steps = [];
    for (let k = 0; k <= n; k++) { const y = s.dir < 0 ? s.y1 - k * run : s.y0 + k * run; steps.push([y, k * rise]); }
    const cyl = new T.CylinderGeometry(0.022, 0.022, 1, 10, 1, false);
    const rail = (x, off, mat) => {
      const [ya, za] = steps[0], [yb, zb] = steps[n], dy = yb - ya, dz = zb - za, L = Math.hypot(dy, dz);
      const m = new T.Matrix4().compose(new T.Vector3(x, (za + zb) / 2 + off, (ya + yb) / 2), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(0, dz / L, dy / L)), new T.Vector3(1, L + 0.1, 1));
      addGeo(mat, cyl, m, gate, 0);
    };
    rail(hx, hh, oak);
    rail(s.x0 + 0.07, hh, steel);
    const bar = new T.BoxGeometry(0.018, 1, 0.018);
    for (let k = 0; k < n; k++) for (const f of [0.25, 0.75]) {
      const y = lerp(steps[k][0], steps[k + 1][0], f), z = steps[k + 1][1];
      addGeo(white, bar, M(hx, y, z + hh / 2 - 0.02, 0, 1, hh - 0.04, 1), gate, 0);
    }
    cyl.dispose(); bar.dispose();
  }
  /* Wendeltreppe KG → EG */
  function spiralH(phi) { return FLOOR.KG.z + (FLOOR.EG.z - FLOOR.KG.z) * clamp(phi / (SPIRAL.turn * Math.PI * 2), 0, 1); }
  function buildSpiral(grp) {
    const sp = SPIRAL, n = sp.steps, rise = (FLOOR.EG.z - FLOOR.KG.z) / n, dphi = sp.turn * Math.PI * 2 / n, gate = gateOf('kg_flur');
    const oak = buf(grp, 'oak'), steel = buf(grp, 'darkMetal'), zb = 0;
    for (let k = 0; k < n - 1; k++) {
      const a0 = k * dphi - 0.04, a1 = (k + 1) * dphi + 0.06, z = zb + (k + 1) * rise;   // Stufe k endet auf Höhe k+1
      const shape = new T.Shape();
      shape.moveTo(Math.cos(a0) * sp.pole, Math.sin(a0) * sp.pole);
      for (let q = 0; q <= 8; q++) { const a = lerp(a0, a1, q / 8); shape.lineTo(Math.cos(a) * sp.r, Math.sin(a) * sp.r); }
      shape.lineTo(Math.cos(a1) * sp.pole, Math.sin(a1) * sp.pole);
      const g = new T.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false });
      g.rotateX(Math.PI / 2);                                   // Extrusion nach unten, Shape-y → three-Z
      addGeo(oak, g, new T.Matrix4().makeTranslation(sp.cx, z, sp.cy), gate, 0);
      g.dispose();
      // Geländerstab an der Außenkante
      const am = (a0 + a1) / 2, bx = sp.cx + Math.cos(am) * (sp.r - 0.03), by = sp.cy + Math.sin(am) * (sp.r - 0.03);
      const bar = new T.CylinderGeometry(0.008, 0.008, 0.9, 6);
      addGeo(steel, bar, M(bx, by, z + 0.45), gate, 0); bar.dispose();
    }
    const pole = new T.CylinderGeometry(sp.pole, sp.pole, FLOOR.EG.z - FLOOR.KG.z + 1.0, 14);
    addGeo(steel, pole, M(sp.cx, sp.cy, (FLOOR.EG.z - FLOOR.KG.z + 1.0) / 2), gate, 0); pole.dispose();
    // Handlauf als Wendel
    const total = sp.turn * Math.PI * 2 - dphi;
    const curve = new T.Curve(); curve.getPoint = (t, target = new T.Vector3()) => { const a = t * total, z = spiralH(a + dphi * 0.5) + rise + 0.9; return target.set(sp.cx + Math.cos(a) * (sp.r - 0.03), z, sp.cy + Math.sin(a) * (sp.r - 0.03)); };
    const tube = new T.TubeGeometry(curve, 90, 0.022, 8, false);
    addGeo(buf(grp, 'oak'), tube, new T.Matrix4(), gate, 0); tube.dispose();
    // Geländer um das Treppenauge im EG (offene Seite = Austritt)
    const eg = buf('EG', 'steel'), gateEG = gateOf('eg_diele'), seg = 28;
    const exitA = sp.turn * Math.PI * 2 % (Math.PI * 2);
    for (let q = 0; q < seg; q++) {
      const a = q / seg * Math.PI * 2, rel = Math.atan2(Math.sin(a - exitA), Math.cos(a - exitA));
      if (rel > -1.3 && rel < 0.35) continue;                   // Austritt (gegen den Uhrzeigersinn vor dem Ende) offen lassen
      const x = sp.cx + Math.cos(a) * (sp.r + 0.06), y = sp.cy + Math.sin(a) * (sp.r + 0.06);
      const bar = new T.CylinderGeometry(0.009, 0.009, 0.9, 6); addGeo(eg, bar, M(x, y, 0.45), gateEG, 0); bar.dispose();
      const a2 = (q + 1) / seg * Math.PI * 2, rel2 = Math.atan2(Math.sin(a2 - exitA), Math.cos(a2 - exitA));
      if (rel2 > -1.3 && rel2 < 0.35) continue;
      const x2 = sp.cx + Math.cos(a2) * (sp.r + 0.06), y2 = sp.cy + Math.sin(a2) * (sp.r + 0.06), L = Math.hypot(x2 - x, y2 - y);
      const tr = new T.BoxGeometry(0.035, 0.035, L + 0.01);
      addGeo(buf('EG', 'oak'), tr, new T.Matrix4().compose(new T.Vector3((x + x2) / 2, 0.92, (y + y2) / 2), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(x2 - x, y2 - y)), new T.Vector3(1, 1, 1)), gateEG, 0);
      tr.dispose();
    }
  }
  /* Kelleraußentreppe: Betonstufen zwischen Stützwänden, Geländer oben */
  function buildOutStair(grp) {
    const s = KG_OUT_STAIR, n = s.steps, run = (s.yBottom - s.yTop) / n, top = GROUND - FLOOR.KG.z, base = 0, rise = (top - base) / n;
    const c = buf(grp, 'concrete');
    for (let k = 0; k < n; k++) {
      const y1 = s.yBottom - k * run, y0 = y1 - run;
      box(c, 0.24, 1.6, y0, y1, base, base + (k + 1) * rise, 0, 'b');
    }
    // Stützwände links/rechts und am Kopf, bis Gelände
    box(c, 0.04, 0.24, -3.95, -0.24, base, top + 0.05, 0, 'b');
    box(c, 1.6, 1.8, -3.95, -0.24, base, top + 0.05, 0, 'b');
    box(c, 0.04, 1.8, -3.95, -3.8, base, top + 0.05, 0, 'b');
    // Podest unten
    hface(c, 0.24, 1.6, s.yBottom, -0.24, base + 0.002, true, 0);
    const st = buf('EXT', 'darkMetal');
    for (const x of [0.12, 1.7]) {
      const r = new T.BoxGeometry(0.03, 0.03, 3.7); addGeo(st, r, M(x, -2.05, GROUND + 0.95), 0, 0); r.dispose();
      for (let y = -3.85; y <= -0.3; y += 0.12) { const b = new T.BoxGeometry(0.015, 0.9, 0.015); addGeo(st, b, M(x, y, GROUND + 0.5), 0, 0); b.dispose(); }
    }
  }

  /* =====================================================================
     TÜREN UND FENSTER
     ===================================================================== */
  function doorSpec(op, Gd) {
    const owners = Object.values(RI).filter(R => R.floor === op.floor && R.openings.some(o => o.op === op));
    const exitOwner = owners.find(R => R.room.exit === op.id);
    let into = exitOwner && exitOwner.room.kind !== 'out' ? exitOwner : owners.find(R => R.room.kind !== 'out');
    if (op.id === 'egd_wk') into = RI.eg_kueche;
    if (op.id === 'egd_haus') into = RI.eg_wind;
    if (op.id === 'ogd_ab') into = RI.og_flur;          // Dusche: Tür schlägt in den Flur auf
    const other = owners.find(R => R !== into) || null;
    const outdoor = !other || other.room.kind === 'out';
    const glazed = outdoor && other && other.room.kind === 'out' && op.floor !== 'KG';
    // Scharnier gegenüber dem Lichtschalter (Schalter sitzt auf der Schlossseite)
    const sw = DEVICES.find(d => d.t === 'sw' && d.room === into.id && d.door === op.id);
    let hingeLo;
    if (sw) hingeLo = (op.axis === 'y' ? sw.x : sw.y) > (op.a + op.b) / 2;
    else {
      const e = into.loop.edges.find(q => (op.axis === 'y' ? Math.abs(q.a[1] - q.b[1]) < 1e-6 : Math.abs(q.a[0] - q.b[0]) < 1e-6) && Math.abs((op.axis === 'y' ? q.a[1] : q.a[0]) - op.at) < 0.35);
      const lo = e ? Math.min(op.axis === 'y' ? e.a[0] : e.a[1], op.axis === 'y' ? e.b[0] : e.b[1]) : op.a - 1, hi = e ? Math.max(op.axis === 'y' ? e.a[0] : e.a[1], op.axis === 'y' ? e.b[0] : e.b[1]) : op.b + 1;
      hingeLo = op.a - lo < hi - op.b;
    }
    return { into, other, outdoor, glazed, hingeLo };
  }
  function buildDoors(Gd, grp) {
    const fid = Gd.fid, dh = Gd.dh;
    for (const info of Gd.opInfo) {
      const op = info.op;
      if (op.kind !== 'door' || !info.cells) continue;
      const sp = doorSpec(op, Gd), gate = gateOf(sp.into.id), w0 = info.w0, w1 = info.w1, depth = w1 - w0;
      // Richtung in den Raum „into“ (entlang der Querachse)
      const midA = (op.a + op.b) / 2, probe = op.axis === 'y' ? [midA, w1 + 0.05] : [w1 + 0.05, midA];
      const intoPos = pointInPoly(sp.into.nominal, probe[0], probe[1]) ? 1 : -1;
      const faceIn = intoPos > 0 ? w1 : w0;                    // Wandoberfläche im Raum „into“
      const kgSteel = fid === 'KG' && !sp.outdoor;
      const frameMat = sp.glazed ? 'winFrame' : op.id === 'egd_haus' ? 'frontDoor' : kgSteel || op.id === 'kgd_aussen' ? 'greyDoor' : 'lacquer';
      const fb = buf(grp, frameMat);
      const A = (s, c, z0, z1, s1, c1) => (op.axis === 'y' ? box(fb, Math.min(s, s1), Math.max(s, s1), Math.min(c, c1), Math.max(c, c1), z0, z1, gate) : box(fb, Math.min(c, c1), Math.max(c, c1), Math.min(s, s1), Math.max(s, s1), z0, z1, gate));
      // Futter (Laibungsbekleidung) und Bekleidungen beidseitig
      const jt = 0.02, bw = sp.outdoor ? 0.0 : 0.065;
      A(op.a, w0, 0, dh, op.a + jt, w1); A(op.b - jt, w0, 0, dh, op.b, w1); A(op.a, w0, dh - jt, dh, op.b, w1);
      if (bw) for (const c of [w0, w1]) {
        const o = c === w0 ? -0.012 : 0.012;
        A(op.a - bw, c, 0, dh + bw, op.a, c + o); A(op.b, c, 0, dh + bw, op.b + bw, c + o); A(op.a - bw, c, dh, dh + bw, op.b + bw, c + o);
      }
      // Türblatt
      const W = op.b - op.a - 2 * jt - 0.006, H = dh - jt - 0.012, th = sp.glazed ? 0.07 : 0.042;
      const hingeS = sp.hingeLo ? op.a + jt + 0.003 : op.b - jt - 0.003;
      const hingeC = faceIn - intoPos * 0.004;
      const ang = (op.id === 'egd_haus' || op.id === 'kgd_aussen' ? 72 : sp.glazed ? 78 : 88 + (op.id.length % 3) * 4) * Math.PI / 180;
      // lokales Blatt: Breite entlang +u ab Scharnier, Dicke in Richtung des Raums
      const u = sp.hingeLo ? 1 : -1;
      const leafMat = sp.glazed ? 'winFrame' : op.id === 'egd_haus' ? 'frontDoor' : kgSteel || op.id === 'kgd_aussen' ? 'greyDoor' : 'lacquer';
      const leafGroup = new T.Group();
      leafGroup.userData.door = op.id;
      const lb = new Buf();
      const addLeafBox = (b, s0, s1, t0, t1, z0, z1) => box(b, s0, s1, t0, t1, z0, z1, gate);
      if (sp.glazed) {
        const fw = 0.075;
        addLeafBox(lb, 0, W, 0, th, 0, fw); addLeafBox(lb, 0, W, 0, th, H - fw, H);
        addLeafBox(lb, 0, fw, 0, th, fw, H - fw); addLeafBox(lb, W - fw, W, 0, th, fw, H - fw);
      } else addLeafBox(lb, 0, W, 0, th, 0, H);
      const gb = sp.glazed || op.id === 'egd_haus' ? new Buf() : null;
      if (sp.glazed) for (const nz of [1, -1]) face(gb, [pt(0.075, th / 2, 0.075), pt(W - 0.075, th / 2, 0.075), pt(W - 0.075, th / 2, H - 0.075), pt(0.075, th / 2, H - 0.075)], [0, 0, nz], [[0, 0], [1, 0], [1, 1], [0, 1]], gate);
      if (op.id === 'egd_haus') {                               // Haustür: senkrechter Glasstreifen
        face(gb, [pt(W - 0.32, -0.002, 0.35), pt(W - 0.2, -0.002, 0.35), pt(W - 0.2, -0.002, H - 0.35), pt(W - 0.32, -0.002, H - 0.35)], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], gate);
        face(gb, [pt(W - 0.32, th + 0.002, 0.35), pt(W - 0.2, th + 0.002, 0.35), pt(W - 0.2, th + 0.002, H - 0.35), pt(W - 0.32, th + 0.002, H - 0.35)], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], gate);
      }
      // Drücker beidseitig (Rosette + Hebel), Haustür außen Stoßgriff
      const hb = new Buf(), hz = 1.05, hs = W - 0.07;
      for (const [t, sgn] of [[-0.0, -1], [th, 1]]) {
        const ros = new T.CylinderGeometry(0.026, 0.026, 0.01, 16); ros.rotateX(Math.PI / 2);
        addGeo(hb, ros, new T.Matrix4().makeTranslation(hs, hz, t + sgn * 0.005), gate, 0); ros.dispose();
        if (op.id === 'egd_haus' && sgn < 0) {
          const bar = new T.CylinderGeometry(0.014, 0.014, 1.2, 12); addGeo(hb, bar, new T.Matrix4().makeTranslation(hs, 1.1, t - 0.07), gate, 0); bar.dispose();
          for (const z of [0.6, 1.6]) { const st = new T.BoxGeometry(0.02, 0.02, 0.07); addGeo(hb, st, new T.Matrix4().makeTranslation(hs, z, t - 0.035), gate, 0); st.dispose(); }
          continue;
        }
        const neck = new T.CylinderGeometry(0.009, 0.009, 0.055, 10); neck.rotateX(Math.PI / 2);
        addGeo(hb, neck, new T.Matrix4().makeTranslation(hs, hz, t + sgn * 0.03), gate, 0); neck.dispose();
        const lever = new T.CylinderGeometry(0.0095, 0.0095, 0.13, 10); lever.rotateZ(Math.PI / 2);
        addGeo(hb, lever, new T.Matrix4().makeTranslation(hs - 0.06, hz, t + sgn * 0.058), gate, 0); lever.dispose();
      }
      const mk = (b, mat) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2)); g.setAttribute('aRoom', new T.Float32BufferAttribute(b.r, 1)); const m = new T.Mesh(g, E.mats[mat]); m.castShadow = mat !== 'glass'; m.receiveShadow = true; leafGroup.add(m); };
      mk(lb, leafMat); if (gb) mk(gb, 'glass'); mk(hb, 'steel');
      // Blatt geöffnet: lokale x-Achse = Richtung Scharnier → Schloss, um „ang“ in den Raum gedreht
      const Av = op.axis === 'y' ? [u, 0] : [0, u], Iv = op.axis === 'y' ? [0, intoPos] : [intoPos, 0];
      const dx = Av[0] * Math.cos(ang) + Iv[0] * Math.sin(ang), dy = Av[1] * Math.cos(ang) + Iv[1] * Math.sin(ang);
      const basis = new T.Matrix4().makeBasis(new T.Vector3(dx, 0, dy), new T.Vector3(0, 1, 0), new T.Vector3(-dy, 0, dx));
      const hx = op.axis === 'y' ? hingeS : hingeC, hy = op.axis === 'y' ? hingeC : hingeS;
      // Dicke liegt auf der Seite +Z_lokal; zur Wand hin verschieben, damit das Blatt neben der Zarge steht
      basis.setPosition(hx - (-dy) * 0.0, 0.006, hy - dx * 0.0);
      leafGroup.applyMatrix4(basis);
      E.floors[fid].add(leafGroup);
    }
  }
  /* Fenster: Blendrahmen, Flügel (je nach Breite 1–3), Glas, Fensterbänke innen und außen */
  function buildWindows(Gd, grp) {
    for (const info of Gd.opInfo) {
      const op = info.op;
      if (op.kind !== 'win' || !info.cells) continue;
      const sA = sideOf(Gd, info, -1), sB = sideOf(Gd, info, 1);
      const outA = sA === null || (RI[sA] && RI[sA].room.kind === 'out'), outDir = outA ? -1 : 1;
      const inside = outA ? sB : sA, gate = gateOf(inside);
      const fp = framePlane(info, outDir), d = 0.068, c0 = outDir < 0 ? fp : fp - d, c1 = c0 + d;
      const wf = buf(grp, 'winFrame'), gl = buf(grp, 'glass');
      const A = (s0, s1, t0, t1, z0, z1, b = wf) => (op.axis === 'y' ? box(b, s0, s1, t0, t1, z0, z1, gate) : box(b, t0, t1, s0, s1, z0, z1, gate));
      const a = op.a, bb = op.b, z0 = op.z0, z1 = op.z1, fw = 0.06;
      A(a, bb, c0, c1, z0, z0 + fw); A(a, bb, c0, c1, z1 - fw, z1); A(a, a + fw, c0, c1, z0, z1); A(bb - fw, bb, c0, c1, z0, z1);
      const width = bb - a, nS = width > 2.3 ? 3 : width > 1.25 ? 2 : 1, sw = (width - 2 * fw) / nS;
      for (let k = 0; k < nS; k++) {
        const s0 = a + fw + k * sw, s1 = s0 + sw, sf = 0.055, ci0 = c0 + 0.008, ci1 = c1 - 0.004;
        A(s0, s1, ci0, ci1, z0 + fw, z0 + fw + sf); A(s0, s1, ci0, ci1, z1 - fw - sf, z1 - fw);
        A(s0, s0 + sf, ci0, ci1, z0 + fw, z1 - fw); A(s1 - sf, s1, ci0, ci1, z0 + fw, z1 - fw);
        const gc = (ci0 + ci1) / 2;
        if (op.axis === 'y') { vface(gl, 'x', gc, s0 + sf, s1 - sf, z0 + fw + sf, z0 + fw + sf, z1 - fw - sf, z1 - fw - sf, 1, gate); vface(gl, 'x', gc, s0 + sf, s1 - sf, z0 + fw + sf, z0 + fw + sf, z1 - fw - sf, z1 - fw - sf, -1, gate); }
        else { vface(gl, 'y', gc, s0 + sf, s1 - sf, z0 + fw + sf, z0 + fw + sf, z1 - fw - sf, z1 - fw - sf, 1, gate); vface(gl, 'y', gc, s0 + sf, s1 - sf, z0 + fw + sf, z0 + fw + sf, z1 - fw - sf, z1 - fw - sf, -1, gate); }
        // Griff (Olive) innen
        const hs = k % 2 ? s0 + 0.035 : s1 - 0.035, hc = outDir < 0 ? ci1 + 0.012 : ci0 - 0.012, hz = (z0 + z1) / 2;
        const ol = new T.BoxGeometry(0.018, 0.12, 0.018);
        addGeo(buf(grp, 'steel'), ol, op.axis === 'y' ? M(hs, hc, hz - 0.06) : M(hc, hs, hz - 0.06), gate, 0); ol.dispose();
      }
      if (nS > 1) for (let k = 1; k < nS; k++) { const s = a + fw + k * sw; A(s - 0.02, s + 0.02, c0, c1, z0, z1); }
      // Fensterbank innen (Werkstein, 2 cm) und außen (Alu)
      const inFace = outDir < 0 ? info.w1 : info.w0, outFace = outDir < 0 ? info.w0 : info.w1;
      if (z0 > 0.05) {
        const t0 = outDir < 0 ? c1 : inFace - 0.03 * 1, t1 = outDir < 0 ? inFace + 0.03 : c0;
        A(a - 0.03, bb + 0.03, Math.min(t0, t1), Math.max(t0, t1), z0 - 0.02, z0, buf(grp, 'sill'));
        const o0 = outDir < 0 ? outFace - 0.045 : c1, o1 = outDir < 0 ? c0 : outFace + 0.045;
        A(a - 0.02, bb + 0.02, Math.min(o0, o1), Math.max(o0, o1), z0 - 0.035, z0 - 0.015, buf(grp, 'alu'));
      }
    }
  }

  /* =====================================================================
     GESCHOSS: Böden, Decken, Deckenränder
     ===================================================================== */
  function buildFloorSurfaces(fid, grp) {
    const f = FLOOR[fid], holesHere = slabHoles(fid);
    const idx = FLOORS.findIndex(q => q.id === fid), above = FLOORS[idx + 1];
    const holesAbove = above ? slabHoles(above.id) : [];
    for (const R of floorRooms(fid)) {
      roomPlane(buf(grp, FLOOR_MAT[R.id] || 'screed'), R, 0.001, true, holesHere);
      if (f.roof) continue;
      // Decke: Innenräume weiß; Außenräume (Terrasse/Loggia/Kellertreppe) nur unter der Decke darüber
      if (R.room.kind === 'out') {
        const bb = bboxOf(R.nominal), x0 = Math.max(bb[0], HOUSE.x0), x1 = Math.min(bb[1], HOUSE.x1), y0 = Math.max(bb[2], HOUSE.y0), y1 = Math.min(bb[3], HOUSE.y1);
        if (x1 > x0 && y1 > y0) hface(buf(grp, 'facade'), x0, x1, y0, y1, f.h, false, 0);
        continue;
      }
      roomPlane(buf(grp, 'ceiling'), R, f.h, false, holesAbove);
    }
    // Deckenrand (Stirnseite) der Decke UNTER diesem Geschoss: −0,25…0 an der Gebäudehülle
    const rect = [HOUSE.x0, HOUSE.x1, HOUSE.y0, HOUSE.y1], mat = fid === 'EG' || fid === 'KG' ? 'sockel' : 'facade', b = buf(grp, mat);
    if (fid !== 'KG') {
      vface(b, 'x', rect[2], rect[0], rect[1], -SLAB, -SLAB, 0, 0, -1, 0);
      vface(b, 'x', rect[3], rect[0], rect[1], -SLAB, -SLAB, 0, 0, 1, 0);
      vface(b, 'y', rect[0], rect[2], rect[3], -SLAB, -SLAB, 0, 0, -1, 0);
      vface(b, 'y', rect[1], rect[2], rect[3], -SLAB, -SLAB, 0, 0, 1, 0);
    }
    // Wandungen der Treppenaugen
    for (const h of holesHere) {
      const pb = buf(grp, 'plaster'), g = gateOf(Object.values(RI).find(R => R.floor === fid && pointInPoly(R.nominal, h.type === 'circle' ? h.cx : (h.x0 + h.x1) / 2, h.type === 'circle' ? h.cy : (h.y0 + h.y1) / 2))?.id);
      if (h.type === 'circle') {
        const cyl = new T.CylinderGeometry(h.r, h.r, SLAB, 40, 1, true);
        cyl.scale(-1, 1, 1);
        addGeo(pb, cyl, M(h.cx, h.cy, -SLAB / 2), g, 0); cyl.dispose();
      } else {
        const x0 = Math.max(h.x0, 0.0), x1 = h.x1, y0 = h.y0, y1 = h.y1;
        vface(pb, 'x', y0, x0, x1, -SLAB, -SLAB, 0, 0, 1, g); vface(pb, 'x', y1, x0, x1, -SLAB, -SLAB, 0, 0, -1, g);
        vface(pb, 'y', x1, y0, y1, -SLAB, -SLAB, 0, 0, -1, g);
        // Absturzsicherung am Treppenauge (offene Längsseite)
        const st = buf(grp, 'steel'), oak = buf(grp, 'oak');
        const L = y1 - y0, rail = new T.BoxGeometry(0.045, 0.045, L);
        addGeo(oak, rail, M(x1 + 0.03, (y0 + y1) / 2, 0.92), g, 0); rail.dispose();
        for (let y = y0 + 0.06; y < y1; y += 0.12) { const bar = new T.BoxGeometry(0.018, 0.9, 0.018); addGeo(st, bar, M(x1 + 0.03, y, 0.45), g, 0); bar.dispose(); }
        const r2 = new T.BoxGeometry(x1 - Math.max(x0, 0.24), 0.045, 0.045);
        const yEnd = Math.abs(y1 - 8.3) < 0.1 || y1 > 8 ? y1 : y0;
        if (fid === 'DG') { addGeo(oak, r2, M((Math.max(x0, 0.24) + x1) / 2, yEnd + 0.03, 0.92), g, 0); for (let x = Math.max(x0, 0.24) + 0.06; x < x1; x += 0.12) { const bar = new T.BoxGeometry(0.018, 0.9, 0.018); addGeo(st, bar, M(x, yEnd + 0.03, 0.45), g, 0); bar.dispose(); } }
        r2.dispose();
      }
    }
  }
  /* DG: Dachschrägen innen + Kehlbalkendecke je Raum, mit Dachfenster-Laibungen */
  function buildDGCeilings(grp) {
    const f = FLOOR.DG, ya = ROOF.yA + (f.h - ROOF.knee) / ROOF.slope, yb = ROOF.yB - (f.h - ROOF.knee) / ROOF.slope;
    for (const R of floorRooms('DG')) {
      const [x0, x1, y0, y1] = bboxOf(R.nominal), g = gateOf(R.id), b = buf('DG', 'roofIn');
      const segs = [[y0, Math.min(y1, ya)], [Math.max(y0, ya), Math.min(y1, yb)], [Math.max(y0, yb), y1]].filter(([p, q]) => q - p > 0.005);
      for (const [p, q] of segs) {
        const zp = ceilH('DG', p), zq = ceilH('DG', q), dz = zq - zp, dy = q - p, L = Math.hypot(dy, dz);
        const N = [0, -dy / L, -dz / L];                                         // nach unten/innen
        // Dachfenster aussparen (nur Gartenseite im Bereich der Schräge)
        const wins = ROOF_WINDOWS.filter(w => w.x1 > x0 && w.x0 < x1 && w.y0 >= p - 1e-6 && w.y1 <= q + 1e-6);
        const xs = [x0, ...wins.flatMap(w => [w.x0, w.x1]), x1].sort((m, n) => m - n);
        for (let k = 0; k + 1 < xs.length; k++) {
          const xa = xs[k], xb = xs[k + 1], w = wins.find(v => v.x0 >= xa - 1e-6 && v.x1 <= xb + 1e-6);
          const strip = (ya2, yb2) => { const za = ceilH('DG', ya2), zb = ceilH('DG', yb2); face(b, [pt(xa, ya2, za), pt(xb, ya2, za), pt(xb, yb2, zb), pt(xa, yb2, zb)], N, [[xa, ya2 * 1.22], [xb, ya2 * 1.22], [xb, yb2 * 1.22], [xa, yb2 * 1.22]], g); };
          if (w) { strip(p, w.y0); strip(w.y1, q); } else strip(p, q);
        }
      }
      // Laibungen der Dachfenster (Futter senkrecht zur Schräge vereinfacht senkrecht)
      for (const w of ROOF_WINDOWS) {
        if (!(w.x1 > x0 && w.x0 < x1 && w.y0 > y0 && w.y1 < y1)) continue;
        const zi0 = ceilH('DG', w.y0), zi1 = ceilH('DG', w.y1), zo0 = roofH(w.y0) + ROOF_T, zo1 = roofH(w.y1) + ROOF_T;
        vface(b, 'y', w.x0, w.y0, w.y1, zi0, zi1, zo0, zo1, 1, g); vface(b, 'y', w.x1, w.y0, w.y1, zi0, zi1, zo0, zo1, -1, g);
        vface(b, 'x', w.y0, w.x0, w.x1, zi0, zi0, zo0, zo0, 1, g); vface(b, 'x', w.y1, w.x0, w.x1, zi1, zi1, zo1, zo1, -1, g);
      }
    }
  }

  /* =====================================================================
     AUSSEN: Dach, Schornstein, Nachbarn, Gelände
     ===================================================================== */
  const roofOut = y => FLOOR.DG.z + roofH(y) + ROOF_T;
  const roofIn = y => FLOOR.DG.z + roofH(y);
  function buildRoof(grp) {
    const x0 = ROW.x0 - 0.3, x1 = ROW.x1 + 0.3, yr = ROOF.ridgeY, rt = buf(grp, 'roofX');
    const slope = (ya, yb, gateHoles) => {
      // Dachfläche in Streifen, Dachfenster unseres Hauses ausgespart
      const za = roofOut(ya), zb = roofOut(yb), dy = yb - ya, dz = zb - za, L = Math.hypot(dy, dz), N = [0, Math.abs(dy) / L, -Math.sign(dy) * dz / L * Math.sign(dy) * -1];
      const n = new T.Vector3(0, dy, -dz).normalize(); if (n.y < 0) n.negate();
      const xs = [x0, x1], holes = gateHoles ? ROOF_WINDOWS : [];
      holes.forEach(w => xs.push(w.x0, w.x1)); xs.sort((p, q) => p - q);
      const v = y => (Math.hypot(y - ya, roofOut(y) - za)) * Math.sign(yb - ya);
      for (let k = 0; k + 1 < xs.length; k++) {
        const xa = xs[k], xb = xs[k + 1], w = holes.find(q => q.x0 >= xa - 1e-6 && q.x1 <= xb + 1e-6);
        const strip = (p, q) => face(rt, [pt(xa, p, roofOut(p)), pt(xb, p, roofOut(p)), pt(xb, q, roofOut(q)), pt(xa, q, roofOut(q))], [n.x, n.y, n.z], [[xa, v(p)], [xb, v(p)], [xb, v(q)], [xa, v(q)]], 0);
        if (w) { strip(ya, w.y0); strip(w.y1, yb); } else strip(ya, yb);
      }
      // Unterseite (Dachüberstand), nur außerhalb der Fassade sichtbar
      const ui = buf(grp, 'winFrameX');
      const yo = ya < yr ? HOUSE.y0 : HOUSE.y1;
      face(ui, [pt(x0, ya, roofIn(ya)), pt(x1, ya, roofIn(ya)), pt(x1, yo, roofIn(yo)), pt(x0, yo, roofIn(yo))], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
      // Traufbrett (Stirn)
      vface(ui, 'x', ya, x0, x1, roofIn(ya) - 0.02, roofIn(ya) - 0.02, roofOut(ya), roofOut(ya), ya < yr ? -1 : 1, 0);
    };
    slope(EAVE.a, yr, true); slope(EAVE.b, yr, false);
    // Ortgang an beiden Reihenenden: Giebeldreieck + Ortgangbrett
    const gm = buf(grp, 'nb3'), gm2 = buf(grp, 'nb5');
    for (const [x, m, nn] of [[ROW.x0, gm, -1], [ROW.x1, gm2, 1]]) {
      const zt = FLOOR.DG.z - SLAB;
      face(m, [pt(x, HOUSE.y0, zt), pt(x, HOUSE.y1, zt), pt(x, HOUSE.y1, roofIn(HOUSE.y1)), pt(x, HOUSE.y0, roofIn(HOUSE.y0))], [nn, 0, 0], [[HOUSE.y0, zt], [HOUSE.y1, zt], [HOUSE.y1, 6], [HOUSE.y0, 6]], 0);
      face(m, [pt(x, HOUSE.y0, roofIn(HOUSE.y0)), pt(x, HOUSE.y1, roofIn(HOUSE.y1)), pt(x, yr, roofIn(yr)), pt(x, yr, roofIn(yr))], [nn, 0, 0], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], 0);
      const xb = x + nn * 0.3, ob = buf(grp, 'winFrameX');
      for (const [p, q] of [[EAVE.a, yr], [yr, EAVE.b]]) {
        face(ob, [pt(xb, p, roofIn(p) - 0.05), pt(xb, q, roofIn(q) - 0.05), pt(xb, q, roofOut(q) + 0.04), pt(xb, p, roofOut(p) + 0.04)], [nn, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
        face(ob, [pt(xb - nn * 0.03, p, roofOut(p) + 0.04), pt(xb, p, roofOut(p) + 0.04), pt(xb, q, roofOut(q) + 0.04), pt(xb - nn * 0.03, q, roofOut(q) + 0.04)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
      }
      // Überstand-Unterseite an den Giebeln
      face(ob, [pt(x, EAVE.a, roofIn(EAVE.a)), pt(xb, EAVE.a, roofIn(EAVE.a)), pt(xb, yr, roofIn(yr)), pt(x, yr, roofIn(yr))], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
      face(ob, [pt(x, yr, roofIn(yr)), pt(xb, yr, roofIn(yr)), pt(xb, EAVE.b, roofIn(EAVE.b)), pt(x, EAVE.b, roofIn(EAVE.b))], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
    }
    // Firstziegel
    const ridge = new T.CylinderGeometry(0.11, 0.11, x1 - x0, 12, 1, false, 0, Math.PI);
    ridge.rotateZ(Math.PI / 2);
    addGeo(rt, ridge, new T.Matrix4().makeTranslation((x0 + x1) / 2, roofOut(yr) - 0.03, yr), 0, 0); ridge.dispose();
    // Dachrinnen und Fallrohre
    const gut = buf(grp, 'gutter');
    for (const ye of [EAVE.a, EAVE.b]) {
      const g = new T.CylinderGeometry(0.07, 0.07, x1 - x0, 12, 1, true, Math.PI / 2, Math.PI); g.rotateZ(Math.PI / 2);
      const s = ye < yr ? -1 : 1;
      addGeo(gut, g, new T.Matrix4().makeTranslation((x0 + x1) / 2, roofOut(ye) - 0.05, ye + s * 0.06), 0, 0); g.dispose();
      for (const xp of [-0.12, 7.13]) {
        const yy = ye < yr ? HOUSE.y0 - 0.06 : HOUSE.y1 + 0.06, h = roofOut(ye) - GROUND - 0.1;
        const p = new T.CylinderGeometry(0.05, 0.05, h, 10); addGeo(gut, p, M(xp, yy, GROUND + h / 2), 0, 0); p.dispose();
      }
    }
    // Dachfenster (Rahmen + Glas, bündig in der Fläche)
    const fr = buf(grp, 'darkMetal'), gl = buf(grp, 'glassDarkRoof');
    for (const w of ROOF_WINDOWS) {
      const z0 = roofOut(w.y0), z1 = roofOut(w.y1), n = new T.Vector3(0, 1, (z1 - z0) / (w.y1 - w.y0) * 0).normalize();
      const o = 0.05, rim = 0.06;
      for (const [xa, xb, ya, yb] of [[w.x0 - rim, w.x1 + rim, w.y0 - rim, w.y0], [w.x0 - rim, w.x1 + rim, w.y1, w.y1 + rim], [w.x0 - rim, w.x0, w.y0, w.y1], [w.x1, w.x1 + rim, w.y0, w.y1]]) {
        face(fr, [pt(xa, ya, roofOut(ya) + o), pt(xb, ya, roofOut(ya) + o), pt(xb, yb, roofOut(yb) + o), pt(xa, yb, roofOut(yb) + o)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0);
        vface(fr, 'x', ya, xa, xb, roofOut(ya), roofOut(ya), roofOut(ya) + o, roofOut(ya) + o, -1, 0);
      }
      face(gl, [pt(w.x0, w.y0, z0 + o - 0.01), pt(w.x1, w.y0, z0 + o - 0.01), pt(w.x1, w.y1, z1 + o - 0.01), pt(w.x0, w.y1, z1 + o - 0.01)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], gateOf(w.x0 < 3.4 ? 'dg_kl' : 'dg_kr'));
      face(gl, [pt(w.x0, w.y0, z0 + o - 0.012), pt(w.x1, w.y0, z0 + o - 0.012), pt(w.x1, w.y1, z1 + o - 0.012), pt(w.x0, w.y1, z1 + o - 0.012)], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], gateOf(w.x0 < 3.4 ? 'dg_kl' : 'dg_kr'));
    }
    // Schornstein über Dach
    const ch = CHIMNEY, zTop = roofOut(ROOF.ridgeY) + 0.55, br = buf(grp, 'brick');
    box(br, ch.x0, ch.x1, ch.y0, ch.y1, roofIn(ch.y1) - 0.1, zTop, 0, 'b');
    box(buf(grp, 'concreteX'), ch.x0 - 0.05, ch.x1 + 0.05, ch.y0 - 0.05, ch.y1 + 0.05, zTop, zTop + 0.06, 0);
  }
  /* Schornsteinzug im Haus (verputzt), Öltank, Heizkessel */
  function buildChimneyInside(fid, grp) {
    const ch = CHIMNEY, f = FLOOR[fid], g = gateOf(Object.values(RI).find(R => R.floor === fid && pointInPoly(R.nominal, (ch.x0 + ch.x1) / 2, (ch.y0 + ch.y1) / 2))?.id);
    const top = f.roof ? roofH((ch.y0 + ch.y1) / 2) + ROOF_T : f.h;
    box(buf(fid, fid === 'DG' && g ? 'tileWall' : 'plaster'), ch.x0, ch.x1, ch.y0, ch.y1, 0, f.roof ? Math.min(f.h, top) : f.h, g, 'bt');
  }
  /* Nachbarhaus als gespiegeltes Volumen mit Fensterflächen */
  function buildNeighbor(grp, mirrorX, mat) {
    const mx = x => 2 * mirrorX - x, b = buf(grp, mat), sk = buf(grp, 'sockelX'), gl = buf(grp, 'glassDark'), fr = buf(grp, 'winFrameX');
    const xa = Math.min(mx(HOUSE.x0), mx(HOUSE.x1)), xb = Math.max(mx(HOUSE.x0), mx(HOUSE.x1));
    const zTop = FLOOR.DG.z, rx0 = Math.min(mx(4.17), mx(7.01)), rx1 = Math.max(mx(4.17), mx(7.01));
    // Garten- und Straßenfassade mit Rücksprung (Terrasse/Loggia)
    const recess = 1.17, endWall = mirrorX < 3;                 // Haus 3: Rücksprung am Reihenende, Haus 5: an unserer Trennwand
    vface(b, 'x', HOUSE.y1, xa, xb, GROUND, GROUND, zTop, zTop, 1, 0);
    const front = [[xa, rx0], [rx1, xb]].filter(([p, q]) => q - p > 0.01);
    for (const [p, q] of front) vface(b, 'x', HOUSE.y0, p, q, GROUND, GROUND, zTop, zTop, -1, 0);
    vface(b, 'x', recess, rx0, rx1, GROUND, GROUND, zTop, zTop, -1, 0);
    vface(b, 'y', rx1, HOUSE.y0, recess, GROUND, GROUND, zTop, zTop, -1, 0);
    if (endWall) vface(b, 'y', rx0, HOUSE.y0, recess, GROUND, GROUND, zTop, zTop, 1, 0);
    // Seitenwand am Reihenende (Giebelseite bis Traufe)
    if (endWall) vface(b, 'y', xa, HOUSE.y0, HOUSE.y1, GROUND, GROUND, zTop, zTop, -1, 0);
    else vface(b, 'y', xb, HOUSE.y0, HOUSE.y1, GROUND, GROUND, zTop, zTop, 1, 0);
    // Decke über Terrasse / Brüstung Loggia
    hface(b, rx0, rx1, HOUSE.y0, recess, FLOOR.EG.h, false, 0);
    box(b, rx0, rx1, HOUSE.y0, HOUSE.y0 + 0.24, FLOOR.OG.z - SLAB, FLOOR.OG.z + 1.0, 0, 'b');
    hface(b, rx0, rx1, HOUSE.y0, recess, FLOOR.OG.h + FLOOR.OG.z, false, 0);
    hface(sk, rx0, rx1, HOUSE.y0, recess, FLOOR.EG.z - 0.02, true, 0);
    hface(sk, rx0, rx1, HOUSE.y0, recess, FLOOR.OG.z + 0.01, true, 0);
    // Sockelstreifen
    vface(sk, 'x', HOUSE.y1 + 0.005, xa, xb, GROUND, GROUND, 0.3, 0.3, 1, 0);
    for (const [p, q] of front) vface(sk, 'x', HOUSE.y0 - 0.005, p, q, GROUND, GROUND, 0.3, 0.3, -1, 0);
    // Fenster und Türen gespiegelt aus unseren Daten
    for (const op of OPENINGS.filter(o => (o.floor === 'EG' || o.floor === 'OG') && o.axis === 'y' && (o.kind === 'win' || o.id === 'egd_haus' || o.id === 'egd_terr'))) {
      const fz = FLOOR[op.floor].z, z0 = fz + (op.kind === 'win' ? op.z0 : 0), z1 = fz + (op.kind === 'win' ? op.z1 : 2.01);
      const a = Math.min(mx(op.a), mx(op.b)), c = Math.max(mx(op.a), mx(op.b));
      let y = op.at <= 0.01 ? HOUSE.y0 - 0.006 : op.at >= 10.5 ? HOUSE.y1 + 0.006 : recess - 0.006;
      const n = y > 5 ? 1 : -1;
      vface(gl, 'x', y + n * 0.002, a, c, z0, z0, z1, z1, n, 0);
      vface(fr, 'x', y + n * 0.004, a - 0.05, a, z0, z0, z1, z1, n, 0); vface(fr, 'x', y + n * 0.004, c, c + 0.05, z0, z0, z1, z1, n, 0);
      vface(fr, 'x', y + n * 0.004, a, c, z1, z1, z1 + 0.05, z1 + 0.05, n, 0); vface(fr, 'x', y + n * 0.004, a, c, z0 - 0.05, z0 - 0.05, z0, z0, n, 0);
      if (c - a > 1.3) vface(fr, 'x', y + n * 0.004, (a + c) / 2 - 0.03, (a + c) / 2 + 0.03, z0, z0, z1, z1, n, 0);
    }
  }
  /* Rechteck minus Rechtecke → Liste disjunkter Rechtecke (Koordinatenraster) */
  function rectMinus(o, holes) {
    const xs = [...new Set([o[0], o[1], ...holes.flatMap(h => [h[0], h[1]])])].filter(v => v >= o[0] && v <= o[1]).sort((a, b) => a - b);
    const ys = [...new Set([o[2], o[3], ...holes.flatMap(h => [h[2], h[3]])])].filter(v => v >= o[2] && v <= o[3]).sort((a, b) => a - b);
    const out = [];
    for (let j = 0; j + 1 < ys.length; j++) {
      let run = null;
      for (let i = 0; i + 1 < xs.length; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
        const free = !holes.some(h => cx > h[0] && cx < h[1] && cy > h[2] && cy < h[3]);
        if (free) { if (run) run[1] = xs[i + 1]; else run = [xs[i], xs[i + 1], ys[j], ys[j + 1]]; }
        else if (run) { out.push(run); run = null; }
      }
      if (run) out.push(run);
    }
    return out;
  }
  function buildGround(grp) {
    const lawn = buf(grp, 'lawn'), pav = buf(grp, 'pavers2'), side = buf(grp, 'sidewalk'), asph = buf(grp, 'asphalt'), cc = buf(grp, 'concreteX');
    const G0 = GROUND;
    // eigener Garten: Rasen ohne Terrasse, Kelleraußentreppe, Lichtschacht und Trittweg
    const TER = [3.3, 7.13, -3.4, HOUSE.y0], PIT = [0.04, 1.8, -3.95, HOUSE.y0], WELL1 = [1.84, 3.36, -1.11, HOUSE.y0], PATH = [0.04, 3.3, -4.3, -3.95];
    const lawnRects = (outer, holes) => rectMinus(outer, holes).forEach(([a, c, d, e]) => hface(lawn, a, c, d, e, G0, true, 0));
    lawnRects([-0.12, 7.13, -12.0, HOUSE.y0], [TER, PIT, WELL1, PATH]);
    lawnRects([ROW.x0, -0.12, -12.0, HOUSE.y0], [[-7.13, -3.3, -3.4, HOUSE.y0]]);
    lawnRects([7.13, ROW.x1, -12.0, HOUSE.y0], [[7.13, 10.96, -3.4, HOUSE.y0]]);
    hface(pav, PATH[0], PATH[1], PATH[2], PATH[3], G0 + 0.012, true, 0);
    // Terrassenplatten (eigene + Nachbarn), leicht erhöht
    hface(pav, TER[0], TER[1], TER[2], TER[3], G0 + 0.03, true, 0);
    box(cc, TER[0] - 0.04, TER[0], TER[2] - 0.04, TER[3], G0 - 0.05, G0 + 0.04, 0, 'b'); box(cc, TER[0] - 0.04, TER[1], TER[2] - 0.04, TER[2], G0 - 0.05, G0 + 0.04, 0, 'b');
    hface(pav, -7.13, -3.3, -3.4, HOUSE.y0, G0 + 0.03, true, 0); hface(pav, 7.13, 10.96, -3.4, HOUSE.y0, G0 + 0.03, true, 0);
    // Lichtschacht 1 (Kellerfenster kgw1) + Gitterrost; Lichtschacht 2 liegt unter der Terrasse
    for (const [a, b] of [[1.9, 3.3], [4.7, 5.9]]) {
      const yo = -1.05, zb = FLOOR.KG.z + 1.25;
      box(cc, a - 0.06, a, yo, HOUSE.y0, zb, G0 + 0.05, 0, 'b'); box(cc, b, b + 0.06, yo, HOUSE.y0, zb, G0 + 0.05, 0, 'b');
      box(cc, a - 0.06, b + 0.06, yo - 0.06, yo, zb, G0 + 0.05, 0, 'b'); hface(cc, a, b, yo, HOUSE.y0, zb, true, 0);
      const gr = buf(grp, 'darkMetal');
      for (let x = a + 0.03; x < b; x += 0.03) { const bar = new T.BoxGeometry(0.004, 0.03, -yo + HOUSE.y0); addGeo(gr, bar, M(x, (yo + HOUSE.y0) / 2, G0 + 0.035), 0, 0); bar.dispose(); }
      for (let y = yo + 0.1; y < HOUSE.y0; y += 0.1) { const bar = new T.BoxGeometry(b - a, 0.03, 0.004); addGeo(gr, bar, M((a + b) / 2, y, G0 + 0.035), 0, 0); bar.dispose(); }
    }
    // Vorgarten, Zuweg, Gehweg, Straße
    const yF = 13.5;
    const paths = [[2.55, 3.65], [2 * -0.12 - 3.65, 2 * -0.12 - 2.55], [2 * 7.13 - 3.65, 2 * 7.13 - 2.55]];
    lawnRects([ROW.x0, ROW.x1, HOUSE.y1, yF], [...paths.map(([a, c]) => [a, c, HOUSE.y1, yF]), [1.34, 2.66, HOUSE.y1, HOUSE.y1 + 0.86], [2.4, 3.8, HOUSE.y1, HOUSE.y1 + 1.0]]);
    for (const [a, c] of paths) hface(pav, a, c, HOUSE.y1, yF, G0 + 0.01, true, 0);
    { const a = 1.4, c = 2.6, yo = HOUSE.y1 + 0.8, zb = FLOOR.KG.z + 1.25;
      box(cc, a - 0.06, a, HOUSE.y1, yo, zb, G0 + 0.05, 0, 'b'); box(cc, c, c + 0.06, HOUSE.y1, yo, zb, G0 + 0.05, 0, 'b'); box(cc, a - 0.06, c + 0.06, yo, yo + 0.06, zb, G0 + 0.05, 0, 'b'); hface(cc, a, c, HOUSE.y1, yo, zb, true, 0);
      const gr = buf(grp, 'darkMetal'); for (let x = a + 0.03; x < c; x += 0.03) { const bar = new T.BoxGeometry(0.004, 0.03, 0.8); addGeo(gr, bar, M(x, HOUSE.y1 + 0.4, G0 + 0.035), 0, 0); bar.dispose(); } }
    // Eingangspodest mit Stufe
    box(cc, 2.4, 3.8, HOUSE.y1, HOUSE.y1 + 1.0, G0, -0.005, 0, 'b');
    // Gehweg (Bordstein), Straße, gegenüber
    const X0 = -45, X1 = 55;
    hface(side, X0, X1, yF, 15.6, G0 + 0.02, true, 0);
    box(cc, X0, X1, 15.6, 15.75, -0.32, G0 + 0.02, 0, 'b');
    hface(asph, X0, X1, 15.75, 22.25, -0.32, true, 0);
    box(cc, X0, X1, 22.25, 22.4, -0.32, G0 + 0.02, 0, 'b');
    hface(side, X0, X1, 22.4, 24.5, G0 + 0.02, true, 0);
    // Fahrbahnmarkierung (Mittellinie gestrichelt)
    const mk = buf(grp, 'winFrameX');
    for (let x = X0; x < X1; x += 6) hface(mk, x, x + 3, 18.95, 19.05, -0.318, true, 0);
    // Umgebungsrasen (vier Flächen um die Grundstücke)
    const filler = [[-60, ROW.x0, -40, yF], [ROW.x1, 70, -40, yF], [ROW.x0, ROW.x1, -40, -12.6], [-60, 70, 24.5, 70]];
    for (const [a, c, d, e] of filler) hface(lawn, a, c, d, e, G0 - 0.004, true, 0);
    // Rasen unter den Nachbarhäusern (falls sie ausgeblendet sind) und Erdreich unter allem
    hface(lawn, ROW.x0, HOUSE.x0, HOUSE.y0, HOUSE.y1, G0, true, 0); hface(lawn, HOUSE.x1, ROW.x1, HOUSE.y0, HOUSE.y1, G0, true, 0);
    hface(buf(grp, 'sockel'), -60, 70, -40, 70, FLOOR.KG.z - SLAB - 0.05, true, 0);
  }
  /* stilisierte Bäume, Hecken, Sträucher; Häuser gegenüber */
  /* Verformung aus der Position (gleiche Ecke → gleiche Verschiebung, keine Risse) */
  const lump = (x, y, z, seed) => Math.sin(x * 5.1 + seed) * Math.sin(y * 4.3 + seed * 1.7) * Math.sin(z * 4.7 + seed * 0.6) + 0.5 * Math.sin(x * 11.3 + y * 7.9 + z * 9.1 + seed);
  function blob(radius, seed, squash = 0.85) {
    let g = new T.IcosahedronGeometry(radius, 3);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = T.BufferGeometryUtils.mergeVertices(g);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), f = 1 + 0.16 * lump(x / radius, y / radius, z / radius, seed);
      P.setXYZ(i, x * f, y * f * squash, z * f);
    }
    g.computeVertexNormals();
    const uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) { uv[2 * i] = Math.atan2(P.getZ(i), P.getX(i)) * radius; uv[2 * i + 1] = P.getY(i); }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return g;
  }
  function buildGreen(grp) {
    const leaves = buf(grp, 'leaves'), bark = buf(grp, 'bark'), r = rng(7);
    const crown = (x, y, z, s) => {
      for (let k = 0; k < 4; k++) {
        const g = blob(s * (0.5 + r() * 0.28), r() * 10);
        addGeo(leaves, g, M(x + (r() - 0.5) * s * 0.9, y + (r() - 0.5) * s * 0.9, z + (r() - 0.3) * s * 0.6), 0, 1); g.dispose();
      }
    };
    const tree = (x, y, h, s) => {
      const t = new T.CylinderGeometry(0.07 * s, 0.11 * s, h, 9); addGeo(bark, t, M(x, y, GROUND + h / 2), 0, 1); t.dispose();
      crown(x, y, GROUND + h + s * 0.5, s * 1.1);
    };
    tree(6.0, -9.6, 2.0, 1.3);                     // Apfelbaum im eigenen Garten
    tree(-5.2, -10.2, 2.6, 1.6); tree(12.0, -9.0, 2.2, 1.4);
    for (let x = -30; x <= 45; x += 13) tree(x + 3, 15.0, 3.2, 1.9);   // Straßenbäume
    // Hecken: Grundstücksgrenzen hinten und seitlich im Garten
    const hedge = (x0, x1, y0, y1, h) => {
      let g = new T.BoxGeometry(x1 - x0, h, y1 - y0, Math.max(1, Math.round((x1 - x0) * 4)), 4, Math.max(1, Math.round((y1 - y0) * 4)));
      g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = T.BufferGeometryUtils.mergeVertices(g);
      const P = g.attributes.position, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), f = 0.05 * lump(x + cx, y, z + cy, 3); P.setXYZ(i, x * (1 + f * 0.6) + f * 0.3, y > -h / 2 + 0.01 ? y + f : y, z * (1 + f * 0.6) + f * 0.3); }
      g.computeVertexNormals();
      addGeo(leaves, g, M(cx, cy, GROUND + h / 2), 0, -1); g.dispose();
    };
    hedge(ROW.x0, ROW.x1, -12.6, -12.0, 1.8);
    hedge(-0.32, 0.08, -12.0, -3.6, 1.4); hedge(6.93, 7.33, -12.0, -3.6, 1.4);
    // niedrige Hecke im Vorgarten
    hedge(-0.3, 2.3, HOUSE.y1 + 2.0, HOUSE.y1 + 2.35, 0.7); hedge(3.9, 6.95, HOUSE.y1 + 2.0, HOUSE.y1 + 2.35, 0.7);
    // Sträucher
    for (const [x, y, s] of [[6.4, -4.2, 0.6], [0.7, -5.2, 0.5], [5.2, HOUSE.y1 + 1.0, 0.45], [0.8, HOUSE.y1 + 1.2, 0.5]]) crown(x, y, GROUND + s * 0.6, s);
    // Häuser gegenüber (einfache Reihe mit Dächern)
    const fb = buf(grp, 'nbFar'), rf = buf(grp, 'roofX'), gd = buf(grp, 'glassDark');
    for (let k = -3; k <= 4; k++) {
      const x0 = k * 7.5 - 4, x1 = x0 + 7.2, y0 = 27, y1 = 36.5, zt = 5.5;
      box(fb, x0, x1, y0, y1, GROUND, zt, 0, 'b');
      const ym = (y0 + y1) / 2, zr = zt + 3.0;
      face(rf, [pt(x0 - 0.1, y0 - 0.5, zt - 0.3), pt(x1 + 0.1, y0 - 0.5, zt - 0.3), pt(x1 + 0.1, ym, zr), pt(x0 - 0.1, ym, zr)], [0, 1, -0.5], [[x0, 0], [x1, 0], [x1, 5.5], [x0, 5.5]], 0);
      face(rf, [pt(x0 - 0.1, ym, zr), pt(x1 + 0.1, ym, zr), pt(x1 + 0.1, y1 + 0.5, zt - 0.3), pt(x0 - 0.1, y1 + 0.5, zt - 0.3)], [0, 1, 0.5], [[x0, 0], [x1, 0], [x1, 5.5], [x0, 5.5]], 0);
      for (const zz of [0.9, 3.7]) for (const xx of [0.8, 3.0, 5.2]) vface(gd, 'x', y0 - 0.01, x0 + xx, x0 + xx + 1.3, zz, zz, zz + 1.25, zz + 1.25, -1, 0);
      const gab = buf(grp, 'nbFar');
      face(gab, [pt(x0, y0, zt), pt(x0, y1, zt), pt(x0, ym, zr), pt(x0, ym, zr)], [-1, 0, 0], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], 0);
      face(gab, [pt(x1, y0, zt), pt(x1, y1, zt), pt(x1, ym, zr), pt(x1, ym, zr)], [1, 0, 0], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], 0);
    }
    // Hausnummer, Vordach und Briefkasten am Eingang
    const dm = buf('EXT', 'darkMetal'), gl = buf('EXT', 'glass');
    box(dm, 2.45, 3.75, HOUSE.y1, HOUSE.y1 + 0.9, 2.42, 2.46, 0);
    hface(gl, 2.47, 3.73, HOUSE.y1 + 0.02, HOUSE.y1 + 0.88, 2.465, true, 0);
    box(dm, 2.0, 2.32, HOUSE.y1, HOUSE.y1 + 0.1, 1.05, 1.4, 0);
  }

  /* =====================================================================
     EINRICHTUNG (frei angenommen, an den geplanten Dosen ausgerichtet)
     Koordinaten = Plan-Meter; „f“ = Front zeigt nach N/S/W/E (N = kleines y)
     ===================================================================== */
  const FRONT = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  function furnish(fid, grp) {
    const fb = [];                       // Kollisionsrechtecke großer Möbel
    const B = (mat) => buf(grp, mat);
    let gate = 0;
    const bx = (mat, x0, x1, y0, y1, z0, z1, skip = 'b') => box(B(mat), x0, x1, y0, y1, z0, z1, gate, skip);
    const cyl = (mat, x, y, z0, h, r, seg = 16, r2) => { const g = new T.CylinderGeometry(r2 ?? r, r, h, seg); addGeo(B(mat), g, M(x, y, z0 + h / 2), gate, 0); g.dispose(); };
    const handle = (x0, x1, y0, y1, z0, z1, f) => {           // Griffstange vor einer Front
      const [nx, ny] = FRONT[f], hx = (x0 + x1) / 2, hy = (y0 + y1) / 2, w = nx ? 0.012 : 0.12, d = ny ? 0.012 : 0.12;
      const px = nx > 0 ? x1 + 0.012 : nx < 0 ? x0 - 0.012 : hx, py = ny > 0 ? y1 + 0.012 : ny < 0 ? y0 - 0.012 : hy;
      bx('steel', px - w / 2, px + w / 2, py - d / 2, py + d / 2, z1 - 0.06, z1 - 0.045);
    };
    /* Schrank mit Fronten (Fugen als dunkle Linien), Griffe */
    const cabinet = (x0, x1, y0, y1, z0, z1, f, mat = 'cabinet', doors = 0) => {
      bx(mat, x0, x1, y0, y1, z0, z1);
      const [nx, ny] = FRONT[f], len = nx ? y1 - y0 : x1 - x0, n = doors || Math.max(1, Math.round(len / 0.6));
      for (let k = 1; k < n; k++) {
        const s = (nx ? y0 : x0) + len * k / n;
        if (nx) bx('black', nx > 0 ? x1 : x0 - 0.002, nx > 0 ? x1 + 0.002 : x0, s - 0.002, s + 0.002, z0 + 0.01, z1 - 0.01);
        else bx('black', s - 0.002, s + 0.002, ny > 0 ? y1 : y0 - 0.002, ny > 0 ? y1 + 0.002 : y0, z0 + 0.01, z1 - 0.01);
      }
      for (let k = 0; k < n; k++) {
        const a = (nx ? y0 : x0) + len * k / n, b = a + len / n, m = (a + b) / 2;
        if (nx) handle(x0, x1, m - 0.06, m + 0.06, z0, z1, f); else handle(m - 0.06, m + 0.06, y0, y1, z0, z1, f);
      }
    };
    const bed = (x0, x1, y0, y1, head, duvet = 'fabricWarm') => {
      bx('oak', x0, x1, y0, y1, 0.0, 0.32);
      const [hx, hy] = FRONT[head];
      const inset = 0.03, mx0 = x0 + inset, mx1 = x1 - inset, my0 = y0 + inset, my1 = y1 - inset;
      bx('linen', mx0, mx1, my0, my1, 0.32, 0.52);
      // Kopfteil
      if (hx) bx('oak', hx < 0 ? x0 - 0.04 : x1, hx < 0 ? x0 : x1 + 0.04, y0, y1, 0, 0.9); else bx('oak', x0, x1, hy < 0 ? y0 - 0.04 : y1, hy < 0 ? y0 : y1 + 0.04, 0, 0.9);
      // Decke (zwei Drittel) und Kissen
      const L = hx ? x1 - x0 : y1 - y0, dl = L * 0.68;
      if (hx) { const a = hx < 0 ? x1 - dl : x0, b = hx < 0 ? x1 + 0.01 : x0 + dl; bx(duvet, a, b, my0 - 0.02, my1 + 0.02, 0.5, 0.6); }
      else { const a = hy < 0 ? y1 - dl : y0, b = hy < 0 ? y1 + 0.01 : y0 + dl; bx(duvet, mx0 - 0.02, mx1 + 0.02, a, b, 0.5, 0.6); }
      const W = hx ? y1 - y0 : x1 - x0, np = W > 1.2 ? 2 : 1;
      for (let k = 0; k < np; k++) {
        const c = (hx ? y0 : x0) + W * (k + 0.5) / np;
        if (hx) { const a = hx < 0 ? x0 + 0.05 : x1 - 0.45; bx('linen', a, a + 0.4, c - 0.3 / np * 1.6, c + 0.3 / np * 1.6, 0.52, 0.66); }
        else { const a = hy < 0 ? y0 + 0.05 : y1 - 0.45; bx('linen', c - 0.3 / np * 1.6, c + 0.3 / np * 1.6, a, a + 0.4, 0.52, 0.66); }
      }
      fb.push([x0, x1, y0, y1, 0.9]);
    };
    const table = (x0, x1, y0, y1, h = 0.75, top = 'oak', chairs = []) => {
      bx(top, x0, x1, y0, y1, h - 0.035, h, '');
      for (const [x, y] of [[x0 + 0.05, y0 + 0.05], [x1 - 0.05, y0 + 0.05], [x0 + 0.05, y1 - 0.05], [x1 - 0.05, y1 - 0.05]]) bx('darkMetal', x - 0.02, x + 0.02, y - 0.02, y + 0.02, 0, h - 0.035);
      for (const [x, y, f] of chairs) chair(x, y, f);
    };
    const chair = (x, y, f) => {           // f: Blickrichtung der sitzenden Person
      const [nx, ny] = FRONT[f], s = 0.22;
      bx('oak', x - s, x + s, y - s, y + s, 0.44, 0.47, '');
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx('darkMetal', x + dx * (s - 0.03) - 0.012, x + dx * (s - 0.03) + 0.012, y + dy * (s - 0.03) - 0.012, y + dy * (s - 0.03) + 0.012, 0, 0.44);
      const bxp = x - nx * s, byp = y - ny * s;
      if (nx) bx('oak', bxp - 0.015, bxp + 0.015, y - s, y + s, 0.47, 0.88, ''); else bx('oak', x - s, x + s, byp - 0.015, byp + 0.015, 0.47, 0.88, '');
    };
    const sofa = (x0, x1, y0, y1, f, mat = 'fabric') => {
      const [nx, ny] = FRONT[f];
      bx(mat, x0, x1, y0, y1, 0.08, 0.42);
      bx('darkMetal', x0 + 0.05, x1 - 0.05, y0 + 0.05, y1 - 0.05, 0, 0.08);
      // Rückenlehne an der Gegenseite der Front, Armlehnen an den Enden
      if (nx) { const a = nx < 0 ? x1 - 0.22 : x0; bx(mat, a, a + 0.22, y0, y1, 0.42, 0.82); bx(mat, x0, x1, y0, y0 + 0.2, 0.42, 0.62); bx(mat, x0, x1, y1 - 0.2, y1, 0.42, 0.62); }
      else { const a = ny < 0 ? y1 - 0.22 : y0; bx(mat, x0, x1, a, a + 0.22, 0.42, 0.82); bx(mat, x0, x0 + 0.2, y0, y1, 0.42, 0.62); bx(mat, x1 - 0.2, x1, y0, y1, 0.42, 0.62); }
      // Kissen
      const L = nx ? y1 - y0 : x1 - x0, n = Math.max(1, Math.round(L / 0.8));
      for (let k = 0; k < n; k++) { const a = (nx ? y0 + 0.2 : x0 + 0.2) + (L - 0.4) * k / n, b = a + (L - 0.4) / n - 0.02; if (nx) bx(mat, nx < 0 ? x0 + 0.05 : x0 + 0.22, nx < 0 ? x1 - 0.22 : x1 - 0.05, a, b, 0.42, 0.5); else bx(mat, a, b, ny < 0 ? y0 + 0.05 : y0 + 0.22, ny < 0 ? y1 - 0.22 : y1 - 0.05, 0.42, 0.5); }
      fb.push([x0, x1, y0, y1, 0.82]);
    };
    const shelf = (x0, x1, y0, y1, h, levels = 5, mat = 'oak', fill = true) => {
      const r = rng(Math.round(x0 * 100 + y0 * 7));
      for (const [a, b, c, d] of [[x0, x0 + 0.02, y0, y1], [x1 - 0.02, x1, y0, y1]].concat(x1 - x0 > y1 - y0 ? [] : [])) bx(mat, a, b, c, d, 0, h);
      if (y1 - y0 > x1 - x0) { bx(mat, x0, x1, y0, y0 + 0.02, 0, h); bx(mat, x0, x1, y1 - 0.02, y1, 0, h); }
      for (let k = 0; k < levels; k++) {
        const z = 0.06 + (h - 0.08) * k / (levels - 1);
        bx(mat, x0, x1, y0, y1, z, z + 0.022, '');
        if (!fill || k === levels - 1) continue;
        // Kisten/Ordner
        const along = x1 - x0 > y1 - y0, L = along ? x1 - x0 : y1 - y0;
        for (let s = 0.05; s < L - 0.2; s += 0.22 + r() * 0.12) {
          if (r() < 0.3) continue;
          const w = 0.14 + r() * 0.12, hh = 0.14 + r() * Math.min(0.22, (h - 0.1) / levels - 0.08), m = r() < 0.5 ? 'plasticGrey' : r() < 0.5 ? 'cabinetGrey' : 'fabricWarm';
          if (along) bx(m, x0 + s, x0 + s + w, y0 + 0.03, y1 - 0.03, z + 0.022, z + 0.022 + hh);
          else bx(m, x0 + 0.03, x1 - 0.03, y0 + s, y0 + s + w, z + 0.022, z + 0.022 + hh);
        }
      }
    };
    const rug = (x0, x1, y0, y1, mat = 'rug') => bx(mat, x0, x1, y0, y1, 0.001, 0.011, 'b');
    const plant = (x, y, s = 1) => { cyl('terracotta', x, y, 0, 0.32 * s, 0.17 * s, 14, 0.2 * s); const g = new T.IcosahedronGeometry(0.32 * s, 1); addGeo(B('plant'), g, M(x, y, 0.32 * s + 0.28 * s), gate, -1); g.dispose(); };
    const machine = (x0, x1, y0, y1, f, kind) => {     // Waschmaschine / Trockner
      bx('plastic', x0, x1, y0, y1, 0, 0.85);
      const [nx, ny] = FRONT[f], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const d = new T.CylinderGeometry(0.17, 0.17, 0.03, 28); d.rotateX(Math.PI / 2);
      if (ny) d.rotateY(0); else d.rotateY(Math.PI / 2);
      const px = nx ? (nx > 0 ? x1 + 0.012 : x0 - 0.012) : cx, py = ny ? (ny > 0 ? y1 + 0.012 : y0 - 0.012) : cy;
      addGeo(B(kind === 'dryer' ? 'plasticGrey' : 'chrome'), d, M(px, py, 0.45), gate, 0); d.dispose();
      const g2 = new T.CylinderGeometry(0.13, 0.13, 0.035, 24); g2.rotateX(Math.PI / 2); if (!ny) g2.rotateY(Math.PI / 2);
      addGeo(B('screen'), g2, M(px + nx * 0.004, py + ny * 0.004, 0.45), gate, 0); g2.dispose();
      if (nx) bx('screen', nx > 0 ? x1 : x0 - 0.004, nx > 0 ? x1 + 0.004 : x0, cy - 0.15, cy + 0.15, 0.74, 0.8); else bx('screen', cx - 0.15, cx + 0.15, ny > 0 ? y1 : y0 - 0.004, ny > 0 ? y1 + 0.004 : y0, 0.74, 0.8);
      fb.push([x0, x1, y0, y1, 0.86]);
    };
    const wc = (x, y, f) => {                           // wandhängendes WC, f = Blickrichtung (vom Spülkasten weg)
      const [nx, ny] = FRONT[f], g = new T.CylinderGeometry(0.18, 0.15, 0.36, 20); g.scale(1, 1, 1.45);
      if (nx) g.rotateY(Math.PI / 2);
      addGeo(B('ceramic'), g, M(x + nx * 0.27, y + ny * 0.27, 0.22), gate, 0); g.dispose();
      const s = new T.CylinderGeometry(0.19, 0.19, 0.03, 20); s.scale(1, 1, 1.45); if (nx) s.rotateY(Math.PI / 2);
      addGeo(B('plastic'), s, M(x + nx * 0.27, y + ny * 0.27, 0.415), gate, 0); s.dispose();
      // Drückerplatte
      if (nx) bx('chrome', x - 0.004, x + 0.004, y - 0.12, y + 0.12, 0.95, 1.1); else bx('chrome', x - 0.12, x + 0.12, y - 0.004, y + 0.004, 0.95, 1.1);
    };
    const basin = (x0, x1, y0, y1, f, z = 0.85, cab = true) => {
      if (cab) cabinet(x0, x1, y0, y1, 0.3, z - 0.05, f, 'cabinetGrey', 2);
      bx('ceramic', x0 - 0.01, x1 + 0.01, y0 - 0.01, y1 + 0.01, z - 0.05, z, '');
      const [nx, ny] = FRONT[f], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, wx = nx ? 0 : (x1 - x0) * 0.32, wy = ny ? 0 : (y1 - y0) * 0.32;
      const g = new T.CylinderGeometry(Math.max(wx, wy) || 0.18, (Math.max(wx, wy) || 0.18) * 0.85, 0.02, 24); g.scale(1, 1, 0.75);
      if (nx) g.rotateY(Math.PI / 2);
      addGeo(B('plasticGrey'), g, M(cx + nx * 0.03, cy + ny * 0.03, z + 0.001), gate, 0); g.dispose();
      // Armatur hinten
      cyl('chrome', cx - nx * ((x1 - x0) / 2 - 0.08), cy - ny * ((y1 - y0) / 2 - 0.08), z, 0.18, 0.018, 10);
      const sp = new T.BoxGeometry(nx ? 0.12 : 0.025, 0.025, nx ? 0.025 : 0.12);
      addGeo(B('chrome'), sp, M(cx - nx * ((x1 - x0) / 2 - 0.14), cy - ny * ((y1 - y0) / 2 - 0.14), z + 0.16), gate, 0); sp.dispose();
    };
    const mirror = (x0, x1, y0, y1, z0, z1) => bx('mirror', x0, x1, y0, y1, z0, z1, '');
    const desk = (x0, x1, y0, y1, f) => {
      bx('oak', x0, x1, y0, y1, 0.72, 0.75, '');
      for (const [x, y] of [[x0 + 0.03, y0 + 0.03], [x1 - 0.03, y0 + 0.03], [x0 + 0.03, y1 - 0.03], [x1 - 0.03, y1 - 0.03]]) bx('lacquer', x - 0.02, x + 0.02, y - 0.02, y + 0.02, 0, 0.72);
      const [nx, ny] = FRONT[f], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // Bildschirm + Lampe
      const sx = cx - nx * ((x1 - x0) / 2 - 0.12), sy = cy - ny * ((y1 - y0) / 2 - 0.12);
      if (nx) bx('screen', sx - 0.015, sx + 0.015, sy - 0.27, sy + 0.27, 0.86, 1.18, ''); else bx('screen', sx - 0.27, sx + 0.27, sy - 0.015, sy + 0.015, 0.86, 1.18, '');
      cyl('darkMetal', sx, sy, 0.75, 0.11, 0.02, 8);
      chair(cx + nx * ((x1 - x0) / 2 + 0.2), cy + ny * ((y1 - y0) / 2 + 0.2), f === 'E' ? 'W' : f === 'W' ? 'E' : f === 'N' ? 'S' : 'N');
    };

    const R = id => { gate = gateOf(id); };
    switch (fid) {
      case 'KG':
        R('kg_hobby');
        bx('oak', 3.27, 3.875, 2.6, 4.4, 0.86, 0.9, '');
        for (const y of [2.65, 4.35]) for (const x of [3.31, 3.83]) bx('darkMetal', x - 0.02, x + 0.02, y - 0.02, y + 0.02, 0, 0.86);
        bx('oak', 3.3, 3.875, 2.65, 4.35, 0.18, 0.2, '');
        bx('cabinetGrey', 3.855, 3.875, 2.7, 4.3, 1.15, 1.85, '');       // Lochwand
        shelf(0.24, 0.62, 1.95, 3.1, 1.8, 5, 'oak');
        table(1.3, 2.5, 1.1, 1.9, 0.76, 'oak', [[1.9, 2.15, 'N']]);
        rug(1.0, 2.8, 0.9, 2.4);
        fb.push([3.27, 3.875, 2.6, 4.4, 0], [0.24, 0.62, 1.95, 3.1, 1.8]);
        R('kg_keller');
        shelf(6.37, 6.77, 0.5, 5.0, 2.0, 5, 'oak');
        shelf(3.99, 4.39, 0.6, 3.6, 2.0, 5, 'oak');
        bx('plastic', 5.1, 5.85, 4.95, 5.6, 0, 0.85); bx('plasticGrey', 5.1, 5.85, 4.95, 5.6, 0.85, 0.88, '');
        fb.push([6.37, 6.77, 0.5, 5.0, 2.0], [3.99, 4.39, 0.6, 3.6, 2.0], [5.1, 5.85, 4.95, 5.6, 0.88]);
        R('kg_heiz');
        bx('plastic', 5.95, 6.6, 6.25, 6.9, 0, 1.25); bx('screen', 6.1, 6.45, 6.21, 6.25, 0.3, 0.55, '');   // Wärmepumpen-Innengerät mit Bedienfeld
        bx('plasticGrey', 6.02, 6.53, 6.21, 6.25, 0.95, 1.18, '');
        cyl('darkMetal', 6.27, 6.4, 1.25, 0.55, 0.075, 14);
        bx('darkMetal', 6.2, 6.34, 6.15, 6.47, 1.68, 1.82, '');
        cyl('plastic', 5.55, 7.4, 0, 1.45, 0.25, 24);
        for (const [x, y] of [[5.62, 7.25], [5.48, 7.25]]) cyl('chrome', x, y, 1.45, 0.6, 0.016, 8);
        fb.push([5.95, 6.6, 6.25, 6.9, 1.25], [5.3, 5.8, 7.15, 7.65, 1.45]);
        R('kg_oel');
        bx('darkMetal', 4.35, 6.45, 8.15, 9.65, 0, 0.12);
        for (let k = 0; k < 3; k++) { const x0 = 4.42 + k * 0.67; bx('tankPE', x0, x0 + 0.6, 8.2, 9.6, 0.12, 1.5); bx('plasticGrey', x0 + 0.24, x0 + 0.36, 8.8, 9.0, 1.5, 1.58); }
        for (const z of [1.62]) bx('chrome', 4.6, 6.2, 8.88, 8.92, z, z + 0.04, '');
        R('kg_wasch');
        machine(0.3, 0.9, 9.35, 9.95, 'N', 'wm'); machine(0.95, 1.55, 9.35, 9.95, 'N', 'dryer');
        bx('oak', 0.3, 1.55, 9.55, 9.95, 1.62, 1.645, '');
        cabinet(3.27, 3.87, 8.8, 9.9, 0, 0.86, 'W', 'cabinetGrey', 2); bx('worktop', 3.25, 3.87, 8.78, 9.92, 0.86, 0.9, '');
        bx('steel', 3.38, 3.8, 9.1, 9.5, 0.9, 0.905, ''); cyl('chrome', 3.78, 9.3, 0.9, 0.25, 0.016, 8);
        fb.push([3.27, 3.87, 8.8, 9.9, 0.9]);
        break;
      case 'EG':
        R('eg_wohnen');
        rug(1.05, 3.3, 1.25, 3.7);
        sofa(2.55, 3.45, 1.25, 3.65, 'W', 'fabric');
        table(1.45, 2.15, 2.0, 2.9, 0.4, 'oak');
        bx('lacquer', 0.0, 0.42, 1.45, 3.25, 0.42, 0.78, ''); bx('screen', 0.0, 0.045, 1.75, 2.95, 1.0, 1.68, '');
        sofa(0.25, 1.05, 3.9, 4.65, 'E', 'fabricWarm');
        plant(0.35, 0.45, 1.1);
        table(5.05, 5.95, 2.8, 4.4, 0.75, 'oak', [[4.8, 3.2, 'E'], [4.8, 4.0, 'E'], [6.2, 3.2, 'W'], [6.2, 4.0, 'W'], [5.5, 2.55, 'S'], [5.5, 4.65, 'N']]);
        bx('lacquer', 6.6, 7.01, 2.6, 4.3, 0.42, 0.86, ''); plant(6.72, 5.2, 1.2);
        for (const y of [2.98, 3.9]) bx('oak', 6.62, 6.62 + 0.38, y, y + 0.02, 0.43, 0.85, '');
        R('eg_terr');
        table(5.55, 6.35, 0.3, 0.95, 0.74, 'darkMetal', [[5.95, 0.12, 'S'], [5.95, 1.13, 'N']]);
        plant(4.4, 0.35, 0.9);
        R('eg_diele');
        bx('oak', 1.19, 1.55, 9.2, 10.2, 0.42, 0.46, ''); bx('lacquer', 1.19, 1.55, 9.2, 10.2, 0, 0.42);
        bx('oak', 1.19, 1.22, 9.1, 10.3, 1.55, 1.75, '');
        for (let y = 9.25; y < 10.25; y += 0.2) bx('steel', 1.22, 1.3, y - 0.01, y + 0.01, 1.6, 1.62, '');
        bx('fabricBlue', 1.22, 1.36, 9.4, 9.75, 0.95, 1.6, '');
        mirror(2.41, 2.42, 9.2, 9.8, 1.0, 1.9);
        fb.push([1.19, 1.55, 9.2, 10.2, 0.46]);
        R('eg_wind');
        bx('rug', 2.7, 3.5, 9.85, 10.45, 0.001, 0.014, 'b');
        R('eg_wc');
        bx('tileWall', 0.12, 1.07, 10.42, 10.6, 0, 1.1, 'b'); wc(0.56, 10.42, 'N');
        basin(0.79, 1.07, 9.15, 9.55, 'W', 0.85, false); mirror(1.06, 1.07, 9.15, 9.55, 1.15, 1.6);
        R('eg_kueche');
        // Hochschrank mit Mikrowellennische + Kühlschrank (umbaut den Schornsteinzug)
        cabinet(5.75, 6.38, 5.66, 6.3, 0.1, 0.95, 'S', 'cabinet', 1); cabinet(5.75, 6.38, 5.66, 6.3, 1.38, 2.2, 'S', 'cabinet', 1);
        bx('cabinet', 5.75, 5.77, 5.66, 6.3, 0.95, 1.38); bx('cabinet', 6.36, 6.38, 5.66, 6.3, 0.95, 1.38);
        bx('steel', 5.8, 6.33, 5.9, 6.28, 0.97, 1.27, ''); bx('screen', 5.85, 6.15, 6.28, 6.285, 1.0, 1.24, '');
        cabinet(6.38, 7.01, 5.66, 6.3, 0.1, 2.2, 'S', 'cabinet', 1); bx('black', 6.38, 7.01, 6.3, 6.302, 0.88, 0.89, '');
        bx('black', 5.75, 7.01, 5.66, 6.28, 0, 0.1);
        // Zeile Ost + Süd
        bx('black', 6.45, 7.01, 6.3, 10.6, 0, 0.1); bx('black', 4.6, 6.45, 10.04, 10.6, 0, 0.1);
        cabinet(6.41, 7.01, 6.3, 8.35, 0.1, 0.87, 'W'); cabinet(6.41, 7.01, 8.95, 10.6, 0.1, 0.87, 'W');
        cabinet(4.6, 5.15, 10.0, 10.6, 0.1, 0.87, 'S' === 'S' ? 'N' : 'N');
        cabinet(6.41, 7.01, 8.35, 8.95, 0.1, 0.12, 'W', 'cabinet', 1);
        bx('steel', 6.41, 7.01, 8.35, 8.95, 0.12, 0.85); bx('screen', 6.405, 6.41, 8.4, 8.9, 0.25, 0.7, ''); bx('chrome', 6.38, 6.395, 8.42, 8.88, 0.76, 0.78, '');
        bx('plastic', 5.75, 6.41, 10.0, 10.6, 0.1, 0.87); bx('chrome', 5.8, 6.36, 9.985, 10.0, 0.8, 0.815, '');
        cabinet(5.15, 5.75, 10.0, 10.6, 0.1, 0.87, 'N', 'cabinet', 1);
        bx('worktop', 6.38, 7.01, 6.3, 10.6, 0.87, 0.91, ''); bx('worktop', 4.6, 6.38, 9.98, 10.6, 0.87, 0.91, '');
        bx('screen', 6.46, 6.97, 8.38, 8.92, 0.91, 0.915, '');
        bx('steel', 5.2, 5.7, 10.08, 10.48, 0.905, 0.912, ''); cyl('chrome', 5.45, 10.52, 0.91, 0.3, 0.018, 10);
        bx('chrome', 5.43, 5.47, 10.32, 10.52, 1.18, 1.2, '');
        cabinet(6.66, 7.01, 6.3, 8.25, 1.52, 2.2, 'W'); cabinet(6.66, 7.01, 9.05, 10.0, 1.52, 2.2, 'W');
        bx('steel', 6.5, 7.01, 8.35, 8.95, 1.55, 1.62); bx('steel', 6.88, 6.98, 8.75, 8.88, 1.62, 2.5);
        table(4.25, 5.05, 8.8, 9.8, 0.75, 'oak', [[4.65, 8.55, 'S'], [4.65, 10.05 - 0.02, 'N']]);
        fb.push([5.75, 7.01, 5.66, 6.3, 2.2], [6.38, 7.01, 6.3, 10.6, 0.91], [4.6, 7.01, 9.98, 10.6, 0.91]);
        break;
      case 'OG':
        R('og_eltern');
        cabinet(0.0, 0.62, 0.15, 2.35, 0, 2.2, 'E', 'cabinet', 4);
        // Bett mit dem Kopfteil an der Ostwand: beide Bettseiten haben Wandfläche für Steckdosen und Wechselschalter
        bed(1.85, 3.85, 1.9, 3.5, 'E', 'fabricWarm');
        bx('oak', 3.49, 3.89, 1.42, 1.84, 0.34, 0.5, ''); bx('oak', 3.49, 3.89, 3.56, 3.98, 0.34, 0.5, '');
        for (const y of [1.63, 3.77]) { for (const x of [3.53, 3.85]) bx('darkMetal', x - 0.015, x + 0.015, y - 0.015, y + 0.015, 0, 0.34); cyl('lampBody', 3.7, y, 0.5, 0.32, 0.07, 12, 0.1); }
        rug(0.9, 1.9, 1.9, 3.5); plant(3.6, 0.5, 0.8);
        fb.push([0, 0.62, 0.15, 2.35, 2.2]);
        R('og_loggia');
        chair(5.0, 0.6, 'N'); chair(5.8, 0.6, 'N'); plant(6.7, 0.35, 0.9); plant(4.4, 0.3, 0.7);
        R('og_kindg');
        desk(6.33, 6.98, 2.5, 4.1, 'W');                                 // Büro 2: Schreibtisch an der Ostwand
        cabinet(4.01, 4.56, 3.25, 4.2, 0, 1.9, 'E', 'cabinet', 2);
        shelf(6.2, 6.95, 4.9, 5.5, 1.9, 5, 'lacquer');
        rug(4.9, 6.0, 2.3, 4.6, 'fabricBlue');
        fb.push([4.01, 4.56, 3.25, 4.2, 1.9]);
        R('og_kinde');
        desk(6.33, 6.98, 7.6, 9.2, 'W');                                 // Büro 1: Schreibtisch an der Ostwand
        cabinet(5.3, 7.01, 5.66, 6.3, 0, 2.2, 'S', 'cabinet', 3);
        rug(4.9, 5.9, 7.0, 9.4);
        fb.push([5.3, 7.01, 5.66, 6.3, 2.2]);
        R('og_abst');                                                     // separate Dusche: Duschwanne im Westen, Waschtisch an der Flurwand
        bx('ceramic', 0.0, 0.9, 4.56, 5.44, 0, 0.06);
        bx('tileWall', 0.06, 0.84, 4.62, 5.38, 0.06, 0.065, '');
        bx('chrome', 0.0, 0.03, 4.98, 5.02, 1.0, 2.05, ''); bx('chrome', 0.0, 0.18, 4.93, 5.07, 2.05, 2.08, '');
        bx('glass', 0.9, 0.91, 4.56, 5.2, 0.06, 2.0, '');
        basin(1.08, 1.5, 5.14, 5.44, 'N', 0.86, false); mirror(1.1, 1.95, 5.43, 5.44, 1.35, 1.85);
        for (let z = 0.6; z < 1.5; z += 0.1) bx('chrome', 1.35, 1.85, 4.56, 4.575, z, z + 0.02, '');
        R('og_bad');
        bx('ceramic', 0.0, 0.85, 8.39, 10.6, 0, 0.56);
        bx('ceramic', 0.08, 0.77, 8.47, 10.52, 0.3, 0.565, '');
        bx('tileWall', 0.12, 0.73, 8.6, 10.4, 0.302, 0.31, ''); bx('chrome', 0.38, 0.46, 10.48, 10.56, 0.6, 0.72, '');
        bx('tileWall', 0.9, 1.46, 8.39, 8.55, 0, 1.1, 'b'); wc(1.18, 8.55, 'S');
        basin(1.2, 1.8, 10.08, 10.6, 'N', 0.86, true);
        cabinet(1.2, 1.8, 10.45, 10.6, 1.35, 2.0, 'N', 'mirror', 2);
        for (let z = 0.45; z < 1.6; z += 0.1) bx('chrome', 2.09, 2.11, 9.35, 9.95, z, z + 0.02, '');
        bx('chrome', 2.1, 2.13, 9.35, 9.37, 0.4, 1.62, ''); bx('chrome', 2.1, 2.13, 9.93, 9.95, 0.4, 1.62, '');
        rug(1.0, 1.6, 9.0, 9.7, 'linen');
        fb.push([0, 0.85, 8.39, 10.6, 0.56]);
        R('og_wasch');
        cabinet(3.34, 3.89, 9.0, 9.95, 0.1, 0.86, 'W', 'cabinetGrey', 2); bx('worktop', 3.32, 3.89, 8.98, 10.56, 0.86, 0.9, '');
        bx('ceramic', 3.4, 3.8, 9.15, 9.5, 0.9, 0.96, ''); cyl('chrome', 3.83, 9.32, 0.9, 0.22, 0.016, 8);
        cabinet(3.34, 3.89, 9.97, 10.55, 0.1, 0.86, 'W', 'cabinetGrey', 1);
        mirror(3.88, 3.89, 8.95, 9.45, 1.35, 1.95);
        fb.push([3.32, 3.89, 8.98, 10.56, 0.9]);
        break;
      case 'DG':
        R('dg_kl');
        cabinet(0.27, 0.87, 3.0, 4.8, 0, 2.0, 'E', 'cabinet', 3);          // Ankleide: Schrankwand statt Bett
        cabinet(0.3, 1.4, 4.85, 5.36, 0, 2.0, 'N', 'cabinet', 2);
        mirror(3.33, 3.34, 3.5, 4.1, 0.3, 1.9);
        rug(1.3, 2.5, 2.6, 4.3, 'fabricWarm');
        R('dg_kr');
        bed(4.73, 6.73, 2.7, 4.3, 'E', 'fabricWarm');                      // Schlafzimmer DG: Doppelbett, Kopfteil an der Ostwand
        cabinet(5.4, 6.7, 4.85, 5.36, 0, 2.0, 'N', 'cabinet', 2);
        rug(4.4, 5.6, 2.6, 4.3, 'fabricBlue');
        fb.push([0.3, 1.4, 4.85, 5.36, 2.0], [5.4, 6.7, 4.85, 5.36, 2.0], [0.27, 0.87, 3.0, 4.8, 2.0]);
        R('dg_wc');
        bx('tileWall', 5.45, 6.05, 7.12, 7.29, 0, 1.1, 'b'); wc(5.75, 7.12, 'N');
        basin(6.47, 6.77, 6.25, 6.62, 'W', 0.85, false); mirror(6.76, 6.77, 6.25, 6.62, 1.15, 1.6);
        R('dg_trock');
        for (const x of [4.05, 5.95]) bx('steel', x - 0.015, x + 0.015, 8.4, 8.43, 0, 1.45, '');
        for (let k = 0; k < 6; k++) bx('plasticGrey', 4.05, 5.95, 8.36 + k * 0.02, 8.368 + k * 0.02, 1.44 - k * 0.0, 1.45);
        for (const [x, c] of [[4.3, 'linen'], [4.7, 'fabricBlue'], [5.25, 'fabricWarm'], [5.65, 'linen']]) bx(c, x - 0.15, x + 0.15, 8.37, 8.4, 0.85, 1.44, '');
        bx('plasticGrey', 3.2, 3.6, 9.0, 9.35, 0, 0.35);
        break;
    }
    E.furnBoxes[fid] = fb;
  }

  /* =====================================================================
     ELEKTRO: Geräte als InstancedMesh (je Geschoss, Bauteil und Material)
     Lokales Gerätesystem: x entlang der Wand, y nach oben, z aus der Wand
     ===================================================================== */
  const PART = {};                                  // name → { geo, mat }
  const GANG = 0.071;                               // Rastermaß Mehrfachrahmen
  function roundedRect(w, h, r, holes = []) {
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    for (const [cx, cy, rr] of holes) { const p = new T.Path(); p.absarc(cx, cy, rr, 0, Math.PI * 2, true); s.holes.push(p); }
    return s;
  }
  function frameGeo(n, holes) {
    const w = 0.08 + (n - 1) * GANG, hs = holes ? Array.from({ length: n }, (_, k) => [(k - (n - 1) / 2) * GANG, 0, 0.0205]) : [];
    const g = new T.ExtrudeGeometry(roundedRect(w, 0.08, 0.008, hs), { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0022, bevelSegments: 2, curveSegments: 10 });
    return g;
  }
  function makeParts() {
    const P = (name, geo, mat) => { PART[name] = { geo, mat }; };
    for (const n of [1, 2, 3, 4, 5]) P('sdFrame' + n, frameGeo(n, true), 'elec');
    for (const n of [1, 2, 3]) P('swFrame' + n, frameGeo(n, false), 'elec');
    // Schuko-Einsatz (je Gang): Vertiefung, Boden, Kontaktbuchsen, Schutzkontakte
    { const t = new T.CylinderGeometry(0.0205, 0.0205, 0.016, 28, 1, true); t.rotateX(Math.PI / 2); t.translate(0, 0, -0.002); t.scale(-1, 1, 1); P('sdRecess', t, 'elec'); }
    { const d = new T.CircleGeometry(0.0205, 28); d.translate(0, 0, -0.0095); P('sdBottom', d, 'plasticGrey'); }
    { const parts = [-0.0095, 0.0095].map(x => { const c = new T.CylinderGeometry(0.0026, 0.0026, 0.004, 10); c.rotateX(Math.PI / 2); c.translate(x, 0, -0.0078); return c; }); P('sdPins', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); parts.forEach(g => g.dispose()); }
    { const parts = [-1, 1].map(s => { const b = new T.BoxGeometry(0.009, 0.003, 0.012); b.translate(0, s * 0.0185, -0.003); return b; }); P('sdClips', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecMetal'); parts.forEach(g => g.dispose()); }
    // Wippen
    { const g = new T.BoxGeometry(0.054, 0.054, 0.006, 1, 1, 1); g.translate(0, 0, 0.0095); P('rocker', g, 'elec'); }
    { const g = new T.BoxGeometry(0.0262, 0.054, 0.006); g.translate(0, 0, 0.0095); P('rockerHalf', g, 'elec'); }
    { const g = new T.BoxGeometry(0.054, 0.054, 0.006); g.translate(0, 0, 0.0095); P('rockerRed', g, 'elecRed'); }
    { const g = new T.BoxGeometry(0.0008, 0.054, 0.0068); g.translate(0, 0, 0.0095); P('rockerGap', g, 'elecDark'); }
    // Markierungen: Wechsel ↕ (zwei kurze Striche), Kreuz ×, Kontroll-LED, Taster-Glocke
    { const parts = [0.017, -0.017].map(y => { const b = new T.BoxGeometry(0.006, 0.0012, 0.0004); b.translate(0, y, 0.0127); return b; }); P('markWechsel', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); parts.forEach(g => g.dispose()); }
    { const parts = [Math.PI / 4, -Math.PI / 4].map(a => { const b = new T.BoxGeometry(0.009, 0.0012, 0.0004); b.rotateZ(a); b.translate(0, 0.018, 0.0127); return b; }); P('markKreuz', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); parts.forEach(g => g.dispose()); }
    { const b = new T.BoxGeometry(0.008, 0.004, 0.002); b.translate(0, 0.019, 0.0128); P('led', b, 'ledOrange'); }
    // Dimmer: Drehknopf; Rollladen-Bedienstelle: Wippe mit Pfeilen auf/ab; Raumthermostat: Gehäuse mit Anzeige
    { const c = new T.CylinderGeometry(0.017, 0.019, 0.012, 24); c.rotateX(Math.PI / 2); c.translate(0, 0, 0.0185); P('dimKnob', c, 'elec'); }
    { const b = new T.BoxGeometry(0.0014, 0.008, 0.0006); b.translate(0, 0.011, 0.0248); P('dimMark', b, 'elecDark'); }
    { const g = new T.BoxGeometry(0.054, 0.0262, 0.006); g.translate(0, 0, 0.0095); P('rockerHalfH', g, 'elec'); }
    { const g = new T.BoxGeometry(0.054, 0.0008, 0.0068); g.translate(0, 0, 0.0095); P('rockerGapH', g, 'elecDark'); }
    { const parts = [1, -1].map(sg => { const t = new T.CylinderGeometry(0.0001, 0.005, 0.006, 3); t.rotateX(sg > 0 ? 0 : Math.PI); t.scale(1, 1, 0.08); t.translate(0, sg * 0.0137, 0.0127); return t; }); P('rlArrows', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); }
    { const g = new T.BoxGeometry(0.078, 0.078, 0.016); g.translate(0, 0, 0.008); P('thBody', g, 'elec'); }
    { const g = new T.BoxGeometry(0.038, 0.022, 0.001); g.translate(0, 0.012, 0.0165); P('thDisplay', g, 'screen'); }
    { const c = new T.CylinderGeometry(0.011, 0.011, 0.004, 20); c.rotateX(Math.PI / 2); c.translate(0, -0.018, 0.018); P('thKnob', c, 'plasticGrey'); }
    // Netzwerkdose: Einsatzplatte + 2 RJ45 (schräg), Beschriftungsfeld
    { const g = new T.BoxGeometry(0.052, 0.052, 0.004); g.translate(0, 0, 0.008); P('netPlate', g, 'elec'); }
    { const parts = [-0.012, 0.012].map(x => { const b = new T.BoxGeometry(0.0125, 0.011, 0.004); b.rotateX(-0.35); b.translate(x, -0.004, 0.0105); return b; }); P('netJack', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); parts.forEach(g => g.dispose()); }
    { const b = new T.BoxGeometry(0.03, 0.007, 0.001); b.translate(0, 0.016, 0.0102); P('netLabel', b, 'plasticGrey'); }
    // Geräteanschlussdose: Abdeckung + Kabelauslass
    { const g = frameGeo(1, false); P('faPlate', g, 'elec'); }
    { const c = new T.CylinderGeometry(0.008, 0.009, 0.006, 14); c.rotateX(Math.PI / 2); c.translate(0, -0.02, 0.011); P('faGland', c, 'elecDark'); }
    // Lüfter: runde Blende mit Lamellen
    { const c = new T.CylinderGeometry(0.075, 0.078, 0.018, 32); c.rotateX(Math.PI / 2); c.translate(0, 0, 0.009); P('fanPlate', c, 'elec'); }
    { const parts = [-0.03, -0.015, 0, 0.015, 0.03].map(y => { const b = new T.BoxGeometry(0.09 - Math.abs(y) * 1.4, 0.004, 0.002); b.translate(0, y, 0.0185); return b; }); P('fanSlots', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); parts.forEach(g => g.dispose()); }
    // Rauchwarnmelder (Decke): Scheibe + rote LED
    { const c = new T.CylinderGeometry(0.05, 0.052, 0.036, 28); c.rotateX(Math.PI / 2); c.translate(0, 0, 0.018); P('rmBody', c, 'elec'); }
    { const parts = [0.016, 0.024, 0.032].map(r => { const t = new T.TorusGeometry(r, 0.0011, 4, 28); t.translate(0, 0, 0.0362); return t; }); P('rmRings', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'plasticGrey'); parts.forEach(g => g.dispose()); }
    { const b = new T.SphereGeometry(0.003, 8, 6); b.translate(0.03, 0, 0.035); P('rmLed', b, 'elecRed'); }
    // Sprechstelle innen / Klingeltaster außen
    { const g = new T.BoxGeometry(0.1, 0.2, 0.024); g.translate(0, 0, 0.012); P('klBody', g, 'elec'); }
    { const parts = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const s = new T.CylinderGeometry(0.0022, 0.0022, 0.002, 6); s.rotateX(Math.PI / 2); s.translate(-0.018 + c * 0.012, 0.05 - r * 0.012, 0.0245); parts.push(s); } P('klGrille', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecDark'); parts.forEach(g => g.dispose()); }
    { const g = new T.BoxGeometry(0.06, 0.03, 0.006); g.translate(0, -0.05, 0.026); P('klButton', g, 'plasticGrey'); }
    { const g = new T.BoxGeometry(0.075, 0.15, 0.012); g.translate(0, 0, 0.006); P('ktPlate', g, 'steel'); }
    { const c = new T.CylinderGeometry(0.011, 0.011, 0.006, 18); c.rotateX(Math.PI / 2); c.translate(0, -0.03, 0.014); P('ktButton', c, 'chrome'); }
    { const g = new T.BoxGeometry(0.055, 0.022, 0.002); g.translate(0, 0.035, 0.0125); P('ktName', g, 'plastic'); }
    // Potentialausgleichsschiene
    { const g = new T.BoxGeometry(0.26, 0.06, 0.05); g.translate(0, 0, 0.025); P('pasBody', g, 'plasticGrey'); }
    { const parts = []; for (let k = 0; k < 7; k++) { const c = new T.CylinderGeometry(0.006, 0.006, 0.01, 8); c.rotateX(Math.PI / 2); c.translate(-0.105 + k * 0.035, 0, 0.053); parts.push(c); } P('pasScrews', T.BufferGeometryUtils.mergeBufferGeometries(parts), 'elecMetal'); parts.forEach(g => g.dispose()); }
  }
  /* Gerätematrix aus Wandlage (lokales z = Wandnormale) bzw. Deckenlage (lokales z = nach unten) */
  function devMatrix(p, z, along = 0, up = 0) {
    const m = new T.Matrix4();
    if (p.ceil) {
      m.makeBasis(new T.Vector3(1, 0, 0), new T.Vector3(0, 0, 1), new T.Vector3(0, -1, 0));
      m.setPosition(p.x + along, z, p.y + up);
      return m;
    }
    const X = new T.Vector3(p.ny, 0, -p.nx), Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(p.nx, 0, p.ny);
    m.makeBasis(X, Y, Z);
    m.setPosition(p.x + X.x * along, z + up, p.y + X.z * along);
    return m;
  }
  function gangsOf(d) {
    if (d.t !== 'sw') return [];
    const out = [];
    for (const [k, n] of Object.entries(d.kinds || { Aus: 1 })) for (let i = 0; i < n; i++) out.push(k);
    return out;
  }
  function buildDevices() {
    const inst = {};                                     // "fid|layer|part" → [{m, gate, d}]
    const put = (fid, layer, part, m, gate, d) => { const k = fid + '|' + layer + '|' + part; (inst[k] = inst[k] || []).push({ m, gate, d }); };
    for (const d of DEVICES) {
      const p = E.devPos[d.id];
      if (!p) continue;
      const fid = d.floor, gate = gateOf(p.outside ? null : d.room), layer = d.t === 'net' ? 'net' : 'dev';
      const z = p.ceil ? FLOOR[fid].roof ? ceilH(fid, d.y) : FLOOR[fid].h : d.h;
      const P = (part, along = 0, up = 0) => put(fid, layer, part, devMatrix(p, z, along, up), gate, d);
      switch (d.t) {
        case 'sd': {
          const n = Math.min(5, d.n);                         // Mehrfachrahmen bis 5-fach in einer Reihe
          P('sdFrame' + n);
          for (let k = 0; k < n; k++) { const a = (k - (n - 1) / 2) * GANG; P('sdRecess', a); P('sdBottom', a); P('sdPins', a); P('sdClips', a); }
          break;
        }
        case 'sw': {
          const g = gangsOf(d), n = Math.min(3, g.length);
          P('swFrame' + n);
          g.slice(0, 3).forEach((kind, k) => {
            const a = (k - (n - 1) / 2) * GANG;
            if (kind === 'Serie' || kind === 'SerieWechsel') { P('rockerHalf', a - 0.0137); P('rockerHalf', a + 0.0137); P('rockerGap', a); if (kind === 'SerieWechsel') { P('markWechsel', a - 0.0137); P('markWechsel', a + 0.0137); } }
            else if (kind === 'Notschalter') P('rockerRed', a);
            else if (kind === 'Dimmer') { P('netPlate', a); P('dimKnob', a); P('dimMark', a); }
            else { P('rocker', a); if (kind === 'Wechsel') P('markWechsel', a); if (kind === 'Kreuz') P('markKreuz', a); }
            if (kind === 'Kontroll') P('led', a);
          });
          break;
        }
        case 'net': P('swFrame1'); P('netPlate'); P('netJack'); P('netLabel'); break;
        case 'fa':
          if (/Lüfter/.test(d.label)) { P('fanPlate'); P('fanSlots'); }
          else { P('faPlate'); P('faGland'); }
          break;
        case 'rl': P('swFrame1'); P('rockerHalfH', 0, 0.0137); P('rockerHalfH', 0, -0.0137); P('rockerGapH'); P('rlArrows'); break;
        case 'th': P('thBody'); P('thDisplay'); P('thKnob'); break;
        case 'rm': P('rmBody'); P('rmRings'); P('rmLed'); break;
        case 'kl':
          if (/außen/i.test(d.label)) { P('ktPlate'); P('ktButton'); P('ktName'); } else { P('klBody'); P('klGrille'); P('klButton'); }
          break;
        case 'pas': P('pasBody'); P('pasScrews'); break;
        case 'uv': buildCabinet(d, p); break;
        default: break;
      }
    }
    for (const [k, list] of Object.entries(inst)) {
      const [fid, layer, part] = k.split('|'), def = PART[part];
      const geo = def.geo.clone();                        // eigenes aRoom-Attribut je InstancedMesh
      const mesh = new T.InstancedMesh(geo, E.mats[def.mat], list.length);
      const rooms = new Float32Array(list.length);
      list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); rooms[i] = it.gate; });
      geo.setAttribute('aRoom', new T.InstancedBufferAttribute(rooms, 1));
      mesh.userData.devs = list.map(it => it.d);
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      E.floors[fid].userData[layer === 'net' ? 'net' : 'dev'].add(mesh);
    }
  }
  /* Hauptverteiler mit Zählerplatz (Aufputz) bzw. Unterverteiler je Geschoss (Unterputz) mit Tür, Griff, Lüftungsschlitzen */
  function buildCabinet(d, p) {
    const grp = d.floor, gate = gateOf(d.room), w = d.w, h = d.hh, dep = d.id === 'HV' ? 0.21 : 0.02;
    const zc = d.h, b = buf(grp, 'cabinetSteel'), dk = buf(grp, 'darkMetal');
    const X = [p.ny, -p.nx], N = [p.nx, p.ny];
    const at = (a, n) => [p.x + X[0] * a + N[0] * n, p.y + X[1] * a + N[1] * n];
    const quadBox = (a0, a1, n0, n1, z0, z1, bb) => {
      const c = [at(a0, n0), at(a1, n0), at(a1, n1), at(a0, n1)], xs = c.map(q => q[0]), ys = c.map(q => q[1]);
      box(bb, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), z0, z1, gate);
    };
    quadBox(-w / 2, w / 2, 0, dep, zc - h / 2, zc + h / 2, b);
    // Türfuge + Griff + Schlitze
    quadBox(-0.002, 0.002, dep, dep + 0.002, zc - h / 2 + 0.03, zc + h / 2 - 0.03, dk);
    quadBox(w / 2 - 0.07, w / 2 - 0.05, dep, dep + 0.02, zc - 0.06, zc + 0.06, dk);
    if (d.id === 'HV') quadBox(-w / 2 + 0.06, w / 2 - 0.06, dep, dep + 0.002, zc + h / 2 - 0.14, zc + h / 2 - 0.12, dk);
    for (let k = 0; k < 6; k++) quadBox(-w / 2 + 0.08, -w / 2 + Math.min(0.3, w / 2 - 0.02), dep, dep + 0.002, zc - h / 2 + 0.06 + k * 0.02, zc - h / 2 + 0.067 + k * 0.02, dk);
    // Warnschild (gelb) oben links
    quadBox(-w / 2 + 0.06, -w / 2 + 0.12, dep, dep + 0.002, zc + h / 2 - 0.12, zc + h / 2 - 0.07, buf(grp, 'ledOrange'));
  }

  /* ---------- Leuchten: Typ aus Raum und Lage, Leuchtkörper an/aus ---------- */
  function lampType(d) {
    const r = d.room, l = d.label;
    if (d.mount !== 'ceil') return /Spiegel/.test(l) ? 'bar' : /Unterbau/.test(l) ? 'strip' : /Lese/.test(l) ? 'sconce' : 'lantern';
    if (/Spots/.test(l)) return 'spots';
    if (/Essen/.test(l)) return 'pendant';
    if (/Wohnen/.test(l)) return 'drumL';
    if (r === 'dg_trock') return 'bulb';
    if (d.floor === 'KG' && r !== 'kg_flur') return 'batten';
    if (/bad|wc|kueche|wasch|og_abst/.test(r)) return 'disc';
    if (/flur|diele|wind|trep/.test(r)) return 'globe';
    return 'drum';
  }
  const LUM_SCALE = 0.022;                          // Lumen → Szenen-Einheiten (Sonne ≈ 4)
  const LUMEN = { pendant: 900, drumL: 1500, drum: 1100, disc: 1000, globe: 750, batten: 1900, strip: 380, sconce: 450, lantern: 420, bulb: 800, spots: 1300, bar: 420 };
  function buildLamps() {
    const onParts = {};
    const diff = (fid, kind, geo, m) => { const k = fid + '|' + kind; if (onParts[k]) geo.dispose(); (onParts[k] = onParts[k] || { geo, list: [] }).list.push(m); };
    for (const d of DEVICES.filter(q => q.t === 'li')) {
      const p = E.devPos[d.id], fid = d.floor, type = lampType(d), gate = gateOf(p.outside ? null : d.room), grp = fid;
      const zc = p.ceil ? (FLOOR[fid].roof ? ceilH(fid, d.y) : FLOOR[fid].h) : d.h;
      const B = mat => buf(grp, mat);
      let lightPos, dkey;
      const lamp = { id: d.id, d, room: d.room, fid, gate, type, on: false, lumen: LUMEN[type], parts: [] };
      const addDiff = (geo, m) => { const k = type + (geo.userData.v || ''); lamp.parts.push({ key: fid + '|' + k, idx: (onParts[fid + '|' + k]?.list.length || 0) }); diff(fid, k, geo, m); };
      switch (type) {
        case 'pendant': {
          const zb = 1.62;
          { const c = new T.CylinderGeometry(0.002, 0.002, zc - zb - 0.2, 4); addGeo(B('lampDark'), c, M(p.x, p.y, zb + 0.2 + (zc - zb - 0.2) / 2), gate, 0); c.dispose(); }
          { const c = new T.CylinderGeometry(0.05, 0.05, 0.02, 16); addGeo(B('lampDark'), c, M(p.x, p.y, zc - 0.02), gate, 0); c.dispose(); }
          { const s = new T.CylinderGeometry(0.03, 0.2, 0.2, 28, 1, true); addGeo(B('lampDark'), s, M(p.x, p.y, zb + 0.1), gate, 0); const s2 = s.clone(); s2.scale(-1, 1, 1); s.dispose(); s2.dispose(); }
          { const c = new T.CircleGeometry(0.19, 28); c.rotateX(Math.PI / 2); c.userData.v = 'a'; addDiff(c, M(p.x, p.y, zb + 0.005)); }
          lightPos = [p.x, p.y, zb - 0.05];
          break;
        }
        case 'drumL': case 'drum': {
          const r = type === 'drumL' ? 0.27 : 0.2, h = type === 'drumL' ? 0.11 : 0.16;
          { const c = new T.CylinderGeometry(r, r, h, 36, 1, true); addGeo(B('fabricWarm'), c, M(p.x, p.y, zc - h / 2 - 0.02), gate, 0); c.dispose(); }
          { const c = new T.CylinderGeometry(0.04, 0.04, 0.02, 16); addGeo(B('lampBody'), c, M(p.x, p.y, zc - 0.01), gate, 0); c.dispose(); }
          { const c = new T.CircleGeometry(r - 0.005, 32); c.rotateX(Math.PI / 2); c.userData.v = type; addDiff(c, M(p.x, p.y, zc - h - 0.015)); }
          lightPos = [p.x, p.y, zc - h - 0.1];
          break;
        }
        case 'disc': {
          { const c = new T.CylinderGeometry(0.17, 0.17, 0.045, 32); addGeo(B('lampBody'), c, M(p.x, p.y, zc - 0.0225), gate, 0); c.dispose(); }
          { const c = new T.CylinderGeometry(0.15, 0.15, 0.012, 32); c.userData.v = 'd'; addDiff(c, M(p.x, p.y, zc - 0.05)); }
          lightPos = [p.x, p.y, zc - 0.25];
          break;
        }
        case 'globe': {
          { const c = new T.CylinderGeometry(0.06, 0.06, 0.03, 16); addGeo(B('lampBody'), c, M(p.x, p.y, zc - 0.015), gate, 0); c.dispose(); }
          { const s = new T.SphereGeometry(0.13, 24, 16); s.userData.v = 'g'; addDiff(s, M(p.x, p.y, zc - 0.16)); }
          lightPos = [p.x, p.y, zc - 0.3];
          break;
        }
        case 'batten': {
          const zb = Math.min(zc, FLOOR[fid].h) - 0.1;
          { const g = new T.BoxGeometry(1.25, 0.04, 0.1); addGeo(B('plasticGrey'), g, M(p.x, p.y, zb + 0.075), gate, 0); g.dispose(); }
          { const g = new T.CylinderGeometry(0.055, 0.055, 1.2, 16, 1, false, Math.PI / 2, Math.PI); g.rotateZ(Math.PI / 2); g.userData.v = 'b'; addDiff(g, M(p.x, p.y, zb + 0.055)); }
          lightPos = [p.x, p.y, zb - 0.1];
          break;
        }
        case 'bulb': {
          { const c = new T.CylinderGeometry(0.03, 0.025, 0.06, 12); addGeo(B('lampBody'), c, M(p.x, p.y, zc - 0.03), gate, 0); c.dispose(); }
          { const s = new T.SphereGeometry(0.035, 16, 12); s.userData.v = 'u'; addDiff(s, M(p.x, p.y, zc - 0.09)); }
          lightPos = [p.x, p.y, zc - 0.15];
          break;
        }
        case 'spots': {                                     // LED-Einbauspots: Reihe aus drei Spots um den Auslass
          for (const k of [-1, 0, 1]) {
            const sx = p.x, sy = p.y + k * 0.75;
            { const c = new T.CylinderGeometry(0.048, 0.048, 0.006, 20); addGeo(B('lampBody'), c, M(sx, sy, zc - 0.003), gate, 0); c.dispose(); }
            { const c = new T.CylinderGeometry(0.036, 0.036, 0.004, 20); c.userData.v = 'p'; addDiff(c, M(sx, sy, zc - 0.008)); }
          }
          lightPos = [p.x, p.y, zc - 0.2];
          break;
        }
        case 'bar': {                                       // Spiegelleuchte: waagerechtes Lichtband an der Wand
          const m = devMatrix(p, zc);
          { const g = new T.BoxGeometry(0.46, 0.035, 0.05); g.translate(0, 0, 0.025); addGeo(B('chrome'), g, m, gate, 0); g.dispose(); }
          { const g = new T.BoxGeometry(0.42, 0.012, 0.03); g.translate(0, -0.022, 0.03); g.userData.v = 'r'; addDiff(g, m); }
          lightPos = [p.x + p.nx * 0.25, p.y + p.ny * 0.25, zc - 0.1];
          break;
        }
        case 'strip': {                                     // unter dem Oberschrank (Küche Ostwand)
          { const g = new T.BoxGeometry(0.02, 0.012, 1.8); g.userData.v = 's'; addDiff(g, M(6.8, 7.3, 1.512)); }
          lightPos = [6.6, 7.3, 1.4];
          break;
        }
        case 'sconce': case 'lantern': {
          const X = [p.ny, -p.nx], N = [p.nx, p.ny];
          const m = devMatrix(p, zc);
          const body = type === 'sconce' ? new T.CylinderGeometry(0.09, 0.07, 0.18, 24, 1, true) : new T.BoxGeometry(0.12, 0.22, 0.12);
          body.translate(0, 0, type === 'sconce' ? 0.11 : 0.08);
          addGeo(B(type === 'sconce' ? 'fabricWarm' : 'lampDark'), body, m, gate, 0); body.dispose();
          const back = new T.BoxGeometry(0.08, 0.12, 0.02); back.translate(0, 0, 0.01); addGeo(B('lampDark'), back, m, gate, 0); back.dispose();
          const g = type === 'sconce' ? new T.CircleGeometry(0.07, 24) : new T.BoxGeometry(0.1, 0.16, 0.1);
          if (type === 'sconce') { g.rotateX(Math.PI / 2); g.translate(0, -0.088, 0.11); } else g.translate(0, -0.01, 0.08);
          g.userData.v = type[0];
          addDiff(g, m);
          lightPos = [p.x + N[0] * 0.2, p.y + N[1] * 0.2, zc - 0.05];
          break;
        }
      }
      lamp.pos = new T.Vector3(lightPos[0], lightPos[2], lightPos[1]);     // lokal im Geschoss
      E.lamps.push(lamp); E.lampById[d.id] = lamp;
    }
    // Leuchtkörper: je Geometrie zwei InstancedMeshes (an/aus); umschalten = Matrix auf Null skalieren
    E.diffusers = [];
    const zero = new T.Matrix4().makeScale(0, 0, 0);
    for (const [k, v] of Object.entries(onParts)) {
      const fid = k.split('|')[0];
      const mOn = new T.InstancedMesh(v.geo, E.mats.lampOn, v.list.length), mOff = new T.InstancedMesh(v.geo, E.mats.lampOff, v.list.length);
      v.list.forEach((m, i) => { mOn.setMatrixAt(i, zero); mOff.setMatrixAt(i, m); });
      v.geo.setAttribute('aRoom', new T.InstancedBufferAttribute(new Float32Array(v.list.length), 1));
      mOn.castShadow = mOff.castShadow = false; mOn.frustumCulled = mOff.frustumCulled = false;
      E.floors[fid].userData.lamps.add(mOn, mOff);
      E.diffusers.push({ key: k, mOn, mOff, mats: v.list });
    }
    E.diffByKey = Object.fromEntries(E.diffusers.map(x => [x.key, x]));
    // Raum-Tore der Leuchtkörper (aus) – für die Lichtsteuerung im Shader
    for (const lamp of E.lamps) for (const pr of lamp.parts) { const df = E.diffByKey[pr.key]; df.mOff.geometry.attributes.aRoom.array[pr.idx] = lamp.gate; }
    // Schalter → Leuchten: je Wippe ein Kanal (Lage im Rahmen, zugeordnete Leuchten)
    for (const sw of DEVICES.filter(d => d.t === 'sw')) {
      const l = sw.label, by = rid => E.lamps.filter(x => x.room === rid);
      let all = E.lamps.filter(x => x.d.c === sw.c && x.room === sw.room);
      if (sw.lightRoom) {                                // Schalter sitzt in einem anderen Raum als seine Leuchte(n)
        all = by(sw.lightRoom).filter(x => x.d.c === sw.c);
        if (!all.length) console.warn('Schalter', sw.id, l, 'findet keine Leuchte in', sw.lightRoom);
      }
      const gangs = gangsOf(sw), n = Math.min(3, gangs.length), chans = [];
      gangs.slice(0, 3).forEach((kind, k) => {
        const a0 = (k - (n - 1) / 2) * GANG;
        const gang = n > 1 ? `${k + 1}. Rahmen ` : '';
        if (kind === 'Serie' || kind === 'SerieWechsel') chans.push({ at: a0 - 0.0137, side: gang + 'links' }, { at: a0 + 0.0137, side: gang + 'rechts' });
        else chans.push({ at: a0, side: gang ? gang.trim() : '' });
      });
      if (sw.lights) {                                   // Zuordnung je Wippe aus den Gerätedaten
        chans.forEach((c, i) => { c.lamps = (sw.lights[i] || []).map(lab => by(sw.room).find(x => x.d.label === lab)).filter(Boolean); });
        if (sw.lights.flat().some(lab => !by(sw.room).some(x => x.d.label === lab))) console.warn('Schalter', sw.id, 'nennt unbekannte Leuchte');
      } else {
        chans.forEach((c, i) => { c.lamps = i === 0 ? all : []; });   // eine Wippe schaltet alles
        if (chans.length > 1) chans.forEach(c => { c.lamps = all; });
      }
      E.switches.push({ d: sw, chans, lamps: [...new Set(chans.flatMap(c => c.lamps))] });
    }
  }
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  function setLamp(lamp, on) {
    if (lamp.on === on) return;
    lamp.on = on; E.lampsOn += on ? 1 : -1;
    for (const pr of lamp.parts) {
      const df = E.diffByKey[pr.key], m = df.mats[pr.idx];
      df.mOn.setMatrixAt(pr.idx, on ? m : ZERO); df.mOff.setMatrixAt(pr.idx, on ? ZERO : m);
      df.mOn.instanceMatrix.needsUpdate = df.mOff.instanceMatrix.needsUpdate = true;
    }
    E.dirtyLights = true;
  }
  /* Wippe unter dem Bildpunkt ndc (−1…1) bestimmen: nächster Punkt des Sehstrahls am Schalter, entlang der Wand */
  const _ndc = new T.Vector2(), _cp = new T.Vector3(), _dp = new T.Vector3();
  function chanAt(sw, ndc) {
    if (sw.chans.length < 2 || !ndc) return 0;
    const p = E.devPos[sw.d.id], g = E.floors[sw.d.floor];
    const rc = E.rc || (E.rc = new T.Raycaster());
    _ndc.set(ndc.x, ndc.y); rc.setFromCamera(_ndc, G.camera);
    _dp.set(p.x, g.position.y + sw.d.h, p.y);
    rc.ray.closestPointToPoint(_dp, _cp);
    const along = (_cp.x - _dp.x) * p.ny + (_cp.z - _dp.z) * -p.nx;   // lokales x = (ny, −nx)
    let best = 0;
    sw.chans.forEach((c, i) => { if (Math.abs(c.at - along) < Math.abs(sw.chans[best].at - along)) best = i; });
    return best;
  }
  /* Schalter betätigen: Leuchten der getroffenen Wippe gemeinsam um (Wechselschaltung: gleicher Zustand) */
  function toggleSwitch(d, ndc) {
    const sw = E.switches.find(s => s.d === d);
    if (!sw) return null;
    const ch = sw.chans[chanAt(sw, ndc)];
    if (!ch || !ch.lamps.length) return null;
    const on = !ch.lamps.some(l => l.on);
    ch.lamps.forEach(l => setLamp(l, on));
    requestRender();
    return on;
  }
  function toggleLamp(d) { const l = E.lampById[d.id]; if (!l) return null; setLamp(l, !l.on); requestRender(); return l.on; }
  function disposeParts() { for (const k of Object.keys(PART)) { PART[k].geo.dispose(); delete PART[k]; } }

  /* =====================================================================
     RÖNTGENBLICK: Leitungen leuchtend in der Wand (pulsierend)
     ===================================================================== */
  function cableMaterial() {
    const m = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPush: { value: 0 }, uHl: { value: -1 }, uAlpha: { value: 1 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aCid; attribute float aAlong;
        uniform float uPush; varying vec3 vColor; varying float vCid; varying float vAlong;
        #include <clipping_planes_pars_vertex>
        void main() {
          vColor = aColor; vCid = aCid; vAlong = aAlong;
          vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
          mvPosition.xyz += normalize( -mvPosition.xyz ) * uPush;
          gl_Position = projectionMatrix * mvPosition;
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: `
        uniform float uTime; uniform float uHl; uniform float uAlpha;
        varying vec3 vColor; varying float vCid; varying float vAlong;
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          float dim = ( uHl < -0.5 || abs( vCid - uHl ) < 0.5 ) ? 1.0 : 0.1;
          float pulse = 0.65 + 0.35 * sin( uTime * 2.4 - vAlong * 2.2 );
          gl_FragColor = vec4( vColor * ( 0.7 + 1.1 * pulse ) * dim, uAlpha * ( 0.55 + 0.45 * dim ) );
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, clipping: true, toneMapped: false,
    });
    m.clippingPlanes = [E.cutPlane];
    return m;
  }
  E.cidIndex = {};
  function buildCables() {
    E.cableMat = cableMaterial();
    const ids = Object.keys(ROUTES); ids.forEach((id, i) => { E.cidIndex[id] = i; });
    const per = {}, risers = { p: [], c: [], i: [], a: [] };
    const r = 0.0085, sides = 4;
    const prism = (acc, a, b, col, ci, along0) => {
      const d = new T.Vector3().subVectors(b, a), L = d.length(); if (L < 1e-4) return along0;
      d.divideScalar(L);
      const u = new T.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0)).normalize(), v = new T.Vector3().crossVectors(d, u);
      const A = a.clone().addScaledVector(d, -r), Bv = b.clone().addScaledVector(d, r);
      for (let k = 0; k < sides; k++) {
        const t0 = k / sides * Math.PI * 2, t1 = (k + 1) / sides * Math.PI * 2;
        const o0 = u.clone().multiplyScalar(Math.cos(t0) * r).addScaledVector(v, Math.sin(t0) * r), o1 = u.clone().multiplyScalar(Math.cos(t1) * r).addScaledVector(v, Math.sin(t1) * r);
        const q = [A.clone().add(o0), Bv.clone().add(o0), Bv.clone().add(o1), A.clone().add(o1)];
        const al = [along0, along0 + L, along0 + L, along0];
        for (const i of [0, 1, 2, 0, 2, 3]) { acc.p.push(q[i].x, q[i].y, q[i].z); acc.c.push(col.r, col.g, col.b); acc.i.push(ci); acc.a.push(al[i]); }
      }
      return along0 + L;
    };
    for (const [cid, R] of Object.entries(ROUTES)) {
      const col = new T.Color(circuitHex(cid)), ci = E.cidIndex[cid];
      col.offsetHSL(0, 0.15, 0.08);
      for (const poly of R.polys) {
        let along = 0;
        for (let k = 1; k < poly.length; k++) {
          const a = poly[k - 1], b = poly[k];
          if (a.f === b.f) { const acc = per[a.f] = per[a.f] || { p: [], c: [], i: [], a: [] }; along = prism(acc, new T.Vector3(a.x, a.z, a.y), new T.Vector3(b.x, b.z, b.y), col, ci, along); }
          else along = prism(risers, new T.Vector3(a.x, FLOOR[a.f].z + a.z, a.y), new T.Vector3(b.x, FLOOR[b.f].z + b.z, b.y), col, ci, along);
        }
      }
      for (const q of R.ads) {                                       // Abzweigdosen als kleine leuchtende Würfel
        const acc = per[q.f] = per[q.f] || { p: [], c: [], i: [], a: [] }, s = 0.035;
        const g = new T.BoxGeometry(s, s, s).toNonIndexed(), P = g.attributes.position;
        for (let k = 0; k < P.count; k++) { acc.p.push(P.getX(k) + q.x, P.getY(k) + q.z, P.getZ(k) + q.y); acc.c.push(col.r, col.g, col.b); acc.i.push(ci); acc.a.push(0); }
        g.dispose();
      }
    }
    const mk = acc => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(acc.p, 3)); g.setAttribute('aColor', new T.Float32BufferAttribute(acc.c, 3)); g.setAttribute('aCid', new T.Float32BufferAttribute(acc.i, 1)); g.setAttribute('aAlong', new T.Float32BufferAttribute(acc.a, 1)); const m = new T.Mesh(g, E.cableMat); m.renderOrder = 10; m.frustumCulled = false; return m; };
    for (const [fid, acc] of Object.entries(per)) { const m = mk(acc); m.visible = false; E.floors[fid].userData.cables.add(m); }
    E.risers = mk(risers); E.risers.visible = false; E.scene.add(E.risers);
  }
  function recolorCables() {
    if (!E.built) return;
    const ids = Object.keys(ROUTES);
    const upd = mesh => {
      const ci = mesh.geometry.attributes.aCid, co = mesh.geometry.attributes.aColor, cache = {};
      for (let k = 0; k < ci.count; k++) {
        const id = ids[ci.getX(k)], c = cache[id] || (cache[id] = new T.Color(circuitHex(id)).offsetHSL(0, 0.15, 0.08));
        co.setXYZ(k, c.r, c.g, c.b);
      }
      co.needsUpdate = true;
    };
    for (const f of FLOORS) E.floors[f.id].userData.cables.children.forEach(upd);
    upd(E.risers);
  }

  /* =====================================================================
     SZENE, LICHT, QUALITÄT
     ===================================================================== */
  const SUN_DIR = new T.Vector3(0.62, 0.6, -0.5).normalize();      // Garten = Süd, Nachmittag (Streiflicht)
  function poolSize() { return E.quality === 'hi' ? 6 : 2; }
  function buildLightsPool() {
    if (E.poolGroup) { E.poolGroup.children.slice().forEach(l => E.poolGroup.remove(l)); }
    else { E.poolGroup = new T.Group(); E.scene.add(E.poolGroup); }
    E.poolN = poolSize();
    E.pool = [];
    for (let i = 0; i < E.poolN; i++) {
      const l = new T.PointLight(0xffd6a8, 0, 0, 2);
      l.castShadow = false;
      E.poolGroup.add(l); E.pool.push(l);
    }
    E.uLightRoom.value = new Float32Array(E.poolN).fill(-2);
    E.dirtyLights = true;
  }
  function applyQuality() {
    const hi = E.quality === 'hi', R = G.renderer;
    R.setPixelRatio(Math.min(hi ? 2 : 1.5, window.devicePixelRatio || 1) * (isMobile() && hi ? 0.75 : 1));
    const host = R.domElement.parentElement; if (host) R.setSize(host.clientWidth, host.clientHeight, false);
    const ms = hi ? 2048 : 1024;
    if (E.sun.shadow.mapSize.x !== ms) { E.sun.shadow.mapSize.set(ms, ms); if (E.sun.shadow.map) { E.sun.shadow.map.dispose(); E.sun.shadow.map = null; } }
    if (E.poolN !== poolSize()) buildLightsPool();
    const an = hi ? Math.min(8, R.capabilities.getMaxAnisotropy()) : 2, texs = new Set();
    for (const m of Object.values(E.mats)) { if (m.map) texs.add(m.map); if (m.bumpMap) texs.add(m.bumpMap); }
    for (const t of texs) if (t.anisotropy !== an) { t.anisotropy = an; t.needsUpdate = true; }
    requestRender();
  }
  function buildSceneBase() {
    const S0 = new T.Scene();
    E.scene = S0;
    const pm = new T.PMREMGenerator(G.renderer);
    const env = new T.RoomEnvironment();
    E.envTex = pm.fromScene(env, 0.04).texture;
    env.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pm.dispose();
    S0.environment = E.envTex;
    E.sky = new T.Sky(); E.sky.scale.setScalar(450);
    const u = E.sky.material.uniforms;
    u.turbidity.value = 5.5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
    S0.add(E.sky);
    E.hemi = new T.HemisphereLight(0xc7dcff, 0xa49580, 0.32); S0.add(E.hemi);
    E.sun = new T.DirectionalLight(0xfff0dc, 3.2);
    E.sun.castShadow = true;
    const sc = E.sun.shadow.camera; sc.left = -19; sc.right = 19; sc.top = 19; sc.bottom = -19; sc.near = 1; sc.far = 80;
    E.sun.shadow.bias = -0.0004; E.sun.shadow.normalBias = 0.025;
    E.sun.shadow.mapSize.set(2048, 2048);
    E.sunTarget = new T.Object3D(); E.sunTarget.position.set(3.5, 0, 2.5); S0.add(E.sunTarget); E.sun.target = E.sunTarget;
    E.sun.position.copy(E.sunTarget.position).addScaledVector(SUN_DIR, 40);
    S0.add(E.sun);
  }
  function setDay(day) {
    E.day = day;
    const u = E.sky.material.uniforms;
    if (day) {
      E.sun.color.set(0xfff0dc); E.sun.intensity = 4.2; E.sun.position.copy(E.sunTarget.position).addScaledVector(SUN_DIR, 40);
      E.hemi.intensity = 0.32; E.sky.visible = true; E.scene.background = null;
      u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
    } else {
      const moon = new T.Vector3(0.35, 0.8, 0.5).normalize();
      E.sun.color.set(0x8fa8ff); E.sun.intensity = 0.16; E.sun.position.copy(E.sunTarget.position).addScaledVector(moon, 40);
      E.hemi.intensity = 0.025; E.sky.visible = false; E.scene.background = new T.Color(0x070b16);
    }
    for (const m of Object.values(E.mats)) {
      if (!('envMapIntensity' in m)) continue;
      const base = m.userData.envBase ?? 1, inner = m.userData.interior ? 3.4 : 1;
      m.envMapIntensity = base * inner * (day ? 0.16 : 0.02);
    }
    if (E.street) E.street.forEach(o => { o.material = day ? E.mats.streetOff : E.mats.streetOn; });
    E.dirtyLights = true;
    requestRender();
  }
  /* Lichtbudget: nur eingeschaltete Leuchten im aktuellen und angrenzenden Raum (Begehung)
     bzw. die zur Kamera nächsten (Außenansicht) bekommen ein echtes Punktlicht */
  const _wp = new T.Vector3();
  function adjRooms(rid) {
    if (!rid) return new Set();
    if (!E._adj) {
      E._adj = {};
      for (const R of Object.values(RI)) {
        const s = new Set([R.id]);
        for (const o of R.openings) if (o.op.kind !== 'win') for (const P of Object.values(RI)) if (P !== R && P.floor === R.floor && P.openings.some(q => q.op === o.op)) s.add(P.id);
        E._adj[R.id] = s;
      }
    }
    return E._adj[rid] || new Set([rid]);
  }
  const CAND = [], byPri = (a, b) => a.pri - b.pri || a.d - b.d;
  function assignLights() {
    const cam = G.camera.position, walkRoom = W.active && W.room ? W.room.id : null;
    const adj = walkRoom ? adjRooms(walkRoom) : null;
    let n = 0;
    for (const l of E.lamps) {
      if (!l.on) continue;
      const grp = E.floors[l.fid];
      if (!grp.visible) continue;
      let pri = 1;
      if (adj) { if (l.room === walkRoom) pri = 0; else if (!adj.has(l.room)) continue; }
      else if (S.floor !== 'ALL' && l.fid !== S.floor) continue;
      const c = CAND[n] || (CAND[n] = { l: null, pri: 0, d: 0, x: 0, y: 0, z: 0 });
      c.l = l; c.pri = pri; c.x = l.pos.x; c.y = l.pos.y + grp.position.y; c.z = l.pos.z;
      c.d = (c.x - cam.x) ** 2 + (c.y - cam.y) ** 2 + (c.z - cam.z) ** 2;
      n++;
    }
    for (let i = 1; i < n; i++) {                       // Einfügesortierung der ersten n (Objekte bleiben erhalten)
      const c = CAND[i]; let j = i - 1;
      while (j >= 0 && byPri(CAND[j], c) > 0) { CAND[j + 1] = CAND[j]; j--; }
      CAND[j + 1] = c;
    }
    for (let i = 0; i < E.poolN; i++) {
      const L = E.pool[i], c = i < n ? CAND[i] : null;
      if (c) { L.position.set(c.x, c.y, c.z); L.power = c.l.lumen * LUM_SCALE; E.uLightRoom.value[i] = c.l.gate; }
      else { L.intensity = 0; E.uLightRoom.value[i] = -2; }
    }
    E.dirtyLights = false;
  }

  /* ---------- Sichtbarkeit, Schnitt, Explosion ---------- */
  function applyVisibility() {
    if (!E.built) return;
    const walk = W.active, all = walk || S.floor === 'ALL', idx = all ? 99 : FLOORS.findIndex(f => f.id === S.floor);
    const ex = walk ? 0 : E.explode;
    FLOORS.forEach((f, i) => {
      const g = E.floors[f.id];
      g.visible = all || i <= idx;
      g.position.y = f.z + (all ? i * ex : 0);
      g.userData.dev.visible = E.layers.devices;
      g.userData.net.visible = E.layers.net;
      g.userData.cables.children.forEach(m => { m.visible = E.xray; });
    });
    E.risers.visible = E.xray && ex === 0 && all;
    E.roof.visible = all && (walk || E.layers.roof);
    E.nb.visible = all;                                   // im Schnitt nur Haus 4
    E.roof.position.y = all ? 4 * ex : 0;
    E.cutPlane.constant = all ? 1000 : FLOOR[S.floor].z + CUT;
    E.cableMat.depthTest = walk;
    E.cableMat.uniforms.uPush.value = walk ? 0.07 : 0;
    E.dirtyLights = true;
    requestRender();
  }
  function applyHighlight() {
    if (!E.built) return;
    const hl = S.pinned || S.hl;
    E.cableMat.uniforms.uHl.value = hl && E.cidIndex[hl] != null ? E.cidIndex[hl] : -1;
    requestRender();
  }

  /* ---------- Ansichten und Kamerafahrt ---------- */
  /* bei Hochformat Kamera zurücknehmen, damit das ganze Haus ins Bild passt */
  function fitAspect(v) {
    const a = G.camera.aspect || 1.5, k = Math.max(1, 1.15 / a);
    if (k > 1) v.pos.sub(v.target).multiplyScalar(k).add(v.target);
    return v;
  }
  function viewFor(kind) { return fitAspect(viewForRaw(kind)); }
  function viewForRaw(kind) {
    if (kind === 'top') {
      const f = S.floor === 'ALL' ? null : FLOOR[S.floor], y0 = f ? f.z : 0;
      return { pos: new T.Vector3(3.5, y0 + 17, 5.2), target: new T.Vector3(3.5, y0, 5.0) };
    }
    if (S.floor !== 'ALL') {
      const f = FLOOR[S.floor];
      return { pos: new T.Vector3(-2.6, f.z + 9.5, -5.8), target: new T.Vector3(3.5, f.z + 0.6, 5.0) };
    }
    return { pos: new T.Vector3(-3.8, 7.6, -18.5), target: new T.Vector3(3.6, 2.8, 3.6) };
  }
  function setView(kind) {
    if (E.intro) { E.intro = null; G.controls.enabled = !W.active; const c = $('introCard'); if (c) c.hidden = true; }
    const v = viewFor(kind || 'iso');
    G.camera.fov = 40; G.camera.updateProjectionMatrix();
    G.controls.target.copy(v.target); G.camera.position.copy(v.pos);
    G.controls.update();
    requestRender();
  }
  function startIntro() {
    const end = viewFor('iso');
    if (reduceMotion) { setView('iso'); showIntroCard(true); return; }
    const pts = [new T.Vector3(-26, 22, -38), new T.Vector3(-12, 12, -26), new T.Vector3(4, 7.5, -19), end.pos.clone()];
    const tgs = [new T.Vector3(3.5, 1.5, 4), new T.Vector3(3.5, 2.6, 3.5), new T.Vector3(3.5, 3.0, 3.2), end.target.clone()];
    E.intro = { t0: null, dur: 6.5, path: new T.CatmullRomCurve3(pts), tg: new T.CatmullRomCurve3(tgs), end };
    G.controls.enabled = false;
    showIntroCard(true);
    requestRender();
  }
  function stepIntro(now) {
    const it = E.intro;
    if (it.t0 == null) it.t0 = now;
    const t = Math.min(1, (now - it.t0) / 1000 / it.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    it.path.getPointAt(e, G.camera.position); G.camera.lookAt(it.tg.getPointAt(e, _wp));
    if (t >= 1) endIntro();
  }
  function endIntro() {
    if (!E.intro) return;
    const v = E.intro.end; E.intro = null;
    G.camera.position.copy(v.pos); G.controls.target.copy(v.target); G.controls.enabled = !W.active; G.controls.update();
    const c = $('introCard'); if (c) c.classList.add('intro-done');
    requestRender();
  }
  function showIntroCard(on) { const c = $('introCard'); if (c) { c.hidden = !on; c.classList.remove('intro-done'); } }

  /* ---------- Auswahl per Klick (Außenansicht) ---------- */
  function pickOrbit(ndc) {
    const rc = E.rc || (E.rc = new T.Raycaster());
    rc.setFromCamera(ndc, G.camera);
    const occ = [];
    for (const f of FLOORS) { const g = E.floors[f.id]; if (g.visible) occ.push(...g.userData.occ); }
    if (E.roof.visible) occ.push(...E.roof.children);
    const hits = rc.intersectObjects(occ, false);
    const cut = E.cutPlane.constant;
    const hit = hits.find(h => h.point.y <= cut + 1e-3);
    const wall = hit ? hit.distance : Infinity, ray = rc.ray;
    let best = null, bt = Infinity;
    for (const f of FLOORS) {
      const g = E.floors[f.id]; if (!g.visible) continue;
      for (const it of E.targets[f.id].devs) {
        if (it.d.t === 'net' ? !E.layers.net : !E.layers.devices) continue;
        if (!E.xray && E.hiddenIds.has(it.d.id)) continue;          // hinter Einbaugeräten nur im Röntgenblick
        _wp.copy(it.lp); _wp.y += g.position.y;
        if (_wp.y > cut + 0.02) continue;
        const t = _wp.clone().sub(ray.origin).dot(ray.direction);
        if (t <= 0 || t > wall + 0.03 || t >= bt) continue;
        const rr = Math.max(it.r, t * 0.012);
        if (ray.distanceSqToPoint(_wp) > rr * rr) continue;
        bt = t; best = it.d;
      }
    }
    if (best) return { dev: best };
    if (hit) {
      // Raum am Trefferpunkt (Geschoss nach Höhe)
      for (const f of FLOORS.slice().reverse()) {
        const g = E.floors[f.id]; if (!g.visible) continue;
        if (hit.point.y >= g.position.y - 0.3) {
          const R = floorRooms(f.id).find(r => pointInPoly(r.nominal, hit.point.x, hit.point.z));
          if (R) return { room: R.id };
          break;
        }
      }
    }
    return null;
  }

  /* =====================================================================
     BEGEHUNG „ECHT“: Kollision, Tragflächen (Böden + Treppen), Ziele
     ===================================================================== */
  const STEP_UP = 0.36, STEP_DN = 0.4;
  function buildSurfaces() {
    const st = straightStairs().map(s => ({ ...s, id: 'st_' + s.from }));
    const spiral = { kind: 'spiral', id: 'sp_KG', from: 'KG', to: 'EG', ...SPIRAL };
    const outS = { kind: 'out', id: 'out_KG', from: 'KG', to: 'KG', ...KG_OUT_STAIR };
    const holes = {};
    for (const f of FLOORS) {
      const h = slabHoles(f.id).slice();
      for (const s of st) if (s.from === f.id) h.push({ type: 'rect', x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1 });
      if (f.id === 'KG') { h.push({ type: 'circle', cx: SPIRAL.cx, cy: SPIRAL.cy, r: SPIRAL.r }); h.push({ type: 'rect', x0: 0.2, x1: 1.65, y0: -4.0, y1: KG_OUT_STAIR.yBottom }); }
      holes[f.id] = h;
    }
    E.surfaces = { stairs: [...st, spiral, outS], holes };
  }
  function inHole(h, x, y) { return h.type === 'circle' ? Math.hypot(x - h.cx, y - h.cy) < h.r : x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1; }
  function floorAt(fid, x, y) {
    if (!W.col[fid]) return false;
    if (!walkInside(W.col[fid], x, y)) return false;          // wie im Plan: 15 cm Toleranz (Türschwellen in Wandlücken)
    for (const h of E.surfaces.holes[fid]) if (inHole(h, x, y)) return false;
    return true;
  }
  function nearer(best, z, zf) { return best === null || Math.abs(z - zf) < Math.abs(best - zf) ? z : best; }
  function stairZ(s, x, y, zf) {
    if (s.kind === 'straight') { if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return null; return straightH(s, y); }
    if (s.kind === 'out') { if (x < s.x0 || x > s.x1 || y < s.yTop || y > s.yBottom) return null; return FLOOR.KG.z + (s.yBottom - y) / (s.yBottom - s.yTop) * (GROUND - FLOOR.KG.z); }
    const dx = x - s.cx, dy = y - s.cy, r = Math.hypot(dx, dy);
    if (r > s.r || r < s.pole) return null;
    const th = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2), max = s.turn * Math.PI * 2;
    let best = null;
    if (th <= max) best = nearer(best, spiralH(th), zf);
    if (th + Math.PI * 2 <= max) best = nearer(best, spiralH(th + Math.PI * 2), zf);
    return best;
  }
  /* Tragfläche unter (x,y) nahe der Fußhöhe zf → { z, ctx } oder null */
  const SUP = { z: 0, ctx: '', stair: null };
  function support(x, y, zf, out = SUP) {
    let found = false, bd = Infinity;
    for (const f of FLOORS) {
      const d = f.z - zf; if (d > STEP_UP || d < -STEP_DN) continue;
      if (Math.abs(d) < bd && floorAt(f.id, x, y)) { bd = Math.abs(d); found = true; out.z = f.z; out.ctx = f.id; out.stair = null; }
    }
    for (const s of E.surfaces.stairs) {
      const z = stairZ(s, x, y, zf); if (z == null) continue;
      const d = z - zf; if (d > STEP_UP || d < -STEP_DN || Math.abs(d) >= bd) continue;
      bd = Math.abs(d); found = true;
      out.z = z; out.ctx = s.to !== s.from && z > (FLOOR[s.from].z + FLOOR[s.to].z) / 2 ? s.to : s.from; out.stair = s;
    }
    return found ? out : null;
  }
  function buildCollisionEcht(fid) {
    const C = buildWalkCollision(fid);
    // Treppen sind jetzt Tragflächen: Treppen-Hindernisse der Plan-Kollision entfernen
    const segs = [], keep = [];
    const isStairBox = b => FIXTURES.some(fx => fx.floor === fid && fx.type === 'straight' && Math.abs(b[0] - fx.x0) < 1e-6 && Math.abs(b[1] - fx.x1) < 1e-6);
    for (let i = 0; i < C.segs.length; i += 4) segs.push([C.segs[i], C.segs[i + 1], C.segs[i + 2], C.segs[i + 3]]);
    const stairBoxes = C.boxes.filter(isStairBox);
    const onBox = (s, b) => { const xs = [s[0], s[2]], ys = [s[1], s[3]]; return xs.every(x => x >= b[0] - 1e-6 && x <= b[1] + 1e-6) && ys.every(y => y >= b[2] - 1e-6 && y <= b[3] + 1e-6) && (Math.abs(s[0] - s[2]) < 1e-9 ? (Math.abs(s[0] - b[0]) < 1e-6 || Math.abs(s[0] - b[1]) < 1e-6) : (Math.abs(s[1] - b[2]) < 1e-6 || Math.abs(s[1] - b[3]) < 1e-6)); };
    const wallSegs = C.wallSegs;
    segs.forEach((s, i) => { if (i < wallSegs || !stairBoxes.some(b => onBox(s, b))) keep.push(s); });
    const boxes = C.boxes.filter(b => !isStairBox(b));
    const add = (x0, x1, y0, y1) => { boxes.push([x0, x1, y0, y1]); keep.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]); };
    for (const b of E.furnBoxes[fid] || []) add(...b);
    const circles = [];
    if (fid === 'KG' || fid === 'EG') circles.push([SPIRAL.cx, SPIRAL.cy, SPIRAL.pole + 0.02]);
    return { fid, segs: Float64Array.from(keep.flat()), wallSegs, circles, boxes, rooms: C.rooms };
  }
  /* ein Schritt im Echt-Modus: 2D-Kollision im Geschoss-Kontext + Tragfläche */
  const SP = new Float64Array(2);
  /* Schritt prüfen; Ergebnis in „out“ (wird wiederverwendet), null wenn nicht begehbar */
  function tryStep(st, x, y, out = {}) {
    const C = W.col[st.ctx];
    SP[0] = x; SP[1] = y;
    walkResolve(C, SP);
    const mx = SP[0] - st.x, my = SP[1] - st.y;
    if (mx * mx + my * my < 1e-10 || mx * mx + my * my > 0.04) return null;
    const sup = support(SP[0], SP[1], st.zf);
    if (!sup) return null;
    const C2 = W.col[sup.ctx];
    if (walkClearance(C, SP[0], SP[1]) < WALK.radius - 0.01 || !walkInside(C2, SP[0], SP[1])) return null;
    out.x = SP[0]; out.y = SP[1]; out.zf = sup.z; out.ctx = sup.ctx; out.stair = sup.stair;
    return out;
  }
  const ST = { x: 0, y: 0, zf: 0, ctx: '' }, RES = {}, EYE_ROOM = { floor: 'EG' };
  const SLIDE = [40, -40, 80, -80, 90, -90].map(g => [Math.cos(g * Math.PI / 180), Math.sin(g * Math.PI / 180), Math.abs(g) === 40 ? 0.8 : 0.6]);
  function walkMove(dx, dy) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.08));
    dx /= n; dy /= n;
    for (let k = 0; k < n; k++) {
      ST.x = W.x; ST.y = W.y; ST.zf = W.zf; ST.ctx = W.floor;
      let r = tryStep(ST, W.x + dx, W.y + dy, RES) || tryStep(ST, W.x + dx, W.y, RES) || tryStep(ST, W.x, W.y + dy, RES);
      // Gleiten: Richtung um ±40°/±80° drehen (z. B. oben an der Treppe Richtung Podest)
      for (let q = 0; !r && q < SLIDE.length; q++) {
        const c = SLIDE[q][0], sn = SLIDE[q][1], k = SLIDE[q][2];
        r = tryStep(ST, W.x + (dx * c - dy * sn) * k, W.y + (dx * sn + dy * c) * k, RES);
      }
      if (!r) break;
      W.x = r.x; W.y = r.y; W.zf = r.zf; W.onStair = r.stair;
      if (r.ctx !== W.floor) walkSetFloor(r.ctx);
    }
  }
  /* Augenhöhe: auf Böden unter der Decke (Dachschräge), auf Treppen frei */
  function walkEye() {
    if (W.onStair) return WALK.eye;
    EYE_ROOM.floor = W.floor;
    return clamp(ceilAt(EYE_ROOM, W.x, W.y) - 0.12, 0.7, WALK.eye);
  }
  function buildTargets(fid) {
    const z = FLOOR[fid].z, T0 = buildWalkTargets(fid);
    for (const it of T0.devs) {
      const p = E.devPos[it.d.id]; if (!p) continue;
      const lz = p.ceil ? (FLOOR[fid].roof ? ceilH(fid, it.d.y) : FLOOR[fid].h) - 0.03 : it.d.h;
      it.lp = new T.Vector3(p.x + p.nx * 0.012, lz, p.y + p.ny * 0.012);
      it.p = new T.Vector3(it.lp.x, z + lz, it.lp.z);
      if (it.d.t === 'li') { const L = E.lampById[it.d.id]; if (L) { it.lp.copy(L.pos); it.p.set(L.pos.x, z + L.pos.y + 0.05, L.pos.z); it.r = Math.max(it.r, 0.16); } }
    }
    return T0;
  }
  function prepareWalk() {
    if (E.walkReady) return;
    const save = W.col;
    E.colE = {}; E.targetsWalk = {};
    for (const f of FLOORS) { E.colE[f.id] = buildCollisionEcht(f.id); }
    W.col = E.colE;
    E.walkReady = true;
    W.col = save;
  }
  /* Erreichbarkeit: Breitensuche über echte Schritte (inkl. Treppen) vom Hauseingang */
  function reachTest() {
    prepareWalk();
    const save = { col: W.col, stairs: W.stairs, x: W.x, y: W.y, zf: W.zf, floor: W.floor };
    W.col = E.colE;
    if (!E.entrance) { const e = W.echt; W.echt = true; E.entrance = walkEntrance(); W.echt = e; }
    const start = E.entrance;
    const q = [{ x: start.x, y: start.y, zf: FLOOR.EG.z, ctx: 'EG' }], seen = new Set(), rooms = new Set(), floorsSeen = new Set();
    const key = s => `${Math.round(s.x * 20)},${Math.round(s.y * 20)},${Math.round(s.zf * 10)}`;
    seen.add(key(q[0]));
    const dirs = []; for (let k = 0; k < 8; k++) dirs.push([Math.cos(k * Math.PI / 4) * 0.05, Math.sin(k * Math.PI / 4) * 0.05]);
    let steps = 0;
    while (q.length && steps < 900000) {
      const s = q.shift(); steps++;
      for (const R of W.col[s.ctx].rooms) if (pointInPoly(R.nominal, s.x, s.y)) rooms.add(R.id);
      floorsSeen.add(s.ctx);
      for (const [dx, dy] of dirs) {
        let cur = s, ok = true;
        for (let k = 0; k < 2 && ok; k++) { const r = tryStep(cur, cur.x + dx / 2, cur.y + dy / 2); if (!r) ok = false; else cur = r; }
        if (!ok) continue;
        const kk = key(cur); if (seen.has(kk)) continue; seen.add(kk); q.push(cur);
      }
    }
    Object.assign(W, { col: save.col, stairs: save.stairs, x: save.x, y: save.y, zf: save.zf, floor: save.floor });
    const all = Object.keys(RI);
    return { reached: rooms.size, total: all.length, missing: all.filter(r => !rooms.has(r)), floors: [...floorsSeen], states: seen.size };
  }

  /* =====================================================================
     AUFBAU
     ===================================================================== */
  const OCC = new Set(['plaster', 'tileWall', 'splash', 'facade', 'sockel', 'ceiling', 'roofIn', 'parquet', 'screed', 'tileFloor', 'tileKG', 'tileBath', 'tileOut', 'pavers', 'concrete', 'cap']);
  function build() {
    const t0 = performance.now();
    E.quality = E.quality || (isMobile() ? 'lo' : 'hi');
    E.poolN = poolSize();
    makeTextures(); makeMaterials(); buildSceneBase(); buildLightsPool(); buildGates(); makeParts();
    for (const f of FLOORS) {
      const g = new T.Group();
      g.name = 'floor-' + f.id;
      g.userData = { dev: new T.Group(), net: new T.Group(), lamps: new T.Group(), cables: new T.Group(), occ: [] };
      g.add(g.userData.dev, g.userData.net, g.userData.lamps, g.userData.cables);
      E.floors[f.id] = g; E.scene.add(g);
    }
    for (const f of FLOORS) {
      const Gd = buildWallGrid(f.id);
      emitWalls(Gd, f.id);
      deviceSurfaces(Gd);
      buildDoors(Gd, f.id);
      buildWindows(Gd, f.id);
      buildFloorSurfaces(f.id, f.id);
      if (f.roof) buildDGCeilings(f.id);
      buildChimneyInside(f.id, f.id);
      furnish(f.id, f.id);
    }
    for (const s of straightStairs()) buildStraight(s, s.from);
    buildSpiral('KG'); buildOutStair('KG');
    // Loggia-Brüstung (gemauert, 1,0 m)
    box(buf('OG', 'facade'), 4.07, 7.01, HOUSE.y0, 0.0, 0, 1.0, 0, 'b');
    box(buf('OG', 'sill'), 4.05, 7.01, HOUSE.y0 - 0.02, 0.02, 1.0, 1.04, 0);
    buildLamps();
    buildDevices();
    disposeParts();
    for (const f of FLOORS) flush(E.floors[f.id], f.id);
    E.roof = new T.Group(); buildRoof('ROOF'); flush(E.roof, 'ROOF'); E.scene.add(E.roof);
    E.ext = new T.Group(); buildGround('EXT'); buildGreen('EXT');
    buildNeighbor('NB', -0.12, 'nb3'); buildNeighbor('NB', 7.13, 'nb5');
    flush(E.ext, 'EXT'); E.scene.add(E.ext);
    E.nb = new T.Group(); flush(E.nb, 'NB'); E.scene.add(E.nb);
    // Straßenlaternen (Leuchtkopf hell bei Nacht)
    E.street = [];
    for (let x = -27; x <= 45; x += 24) {
      const post = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, 4.6, 10), E.mats.darkMetal); post.position.set(x, GROUND + 2.3, 15.3); post.castShadow = true;
      const head = new T.Mesh(new T.BoxGeometry(0.5, 0.08, 0.22), E.mats.streetOff); head.position.set(x, GROUND + 4.55, 15.55);
      E.ext.add(post, head); E.street.push(head);
    }
    for (const f of FLOORS) {
      const g = E.floors[f.id];
      g.traverse(o => { if (o.isMesh && !o.isInstancedMesh && OCC.has(o.name.split('|')[1])) g.userData.occ.push(o); });
      E.targets[f.id] = buildTargets(f.id);
    }
    buildCables();
    buildSurfaces();
    E.built = true;
    setDay(E.day);
    E.buildMs = Math.round(performance.now() - t0);
    E.hidden = checkFurnitureVsDevices();
    return E.buildMs;
  }
  /* Kontrolle: welche Dose steht hinter einem großen Möbel? (gewollt nur bei Geräten hinter Einbaugeräten) */
  function checkFurnitureVsDevices() {
    const out = [];
    for (const d of DEVICES) {
      if (['li', 'rm', 'uv', 'pas'].includes(d.t)) continue;
      const p = E.devPos[d.id]; if (!p || p.ceil || p.outside) continue;
      for (const b of E.furnBoxes[d.floor] || []) {
        const px = p.x + p.nx * 0.03, py = p.y + p.ny * 0.03;
        const top = b[4] ?? 2.2;
        if (d.h - 0.04 < top && px > b[0] - 0.01 && px < b[1] + 0.01 && py > b[2] - 0.01 && py < b[3] + 0.01) { out.push(`${d.label} (${RI[d.room].room.name})`); E.hiddenIds.add(d.id); break; }
      }
    }
    return out;
  }

  /* =====================================================================
     MODUS, RENDERN
     ===================================================================== */
  function applyRenderer(on) {
    const R = G.renderer;
    if (!on) {
      endIntro();
      if (E.sun && E.sun.shadow.map) { E.sun.shadow.map.dispose(); E.sun.shadow.map = null; }
      R.shadowMap.autoUpdate = true;
      G.camera.fov = 35; G.camera.updateProjectionMatrix();
    }
    R.physicallyCorrectLights = on;
    R.outputEncoding = on ? T.sRGBEncoding : T.LinearEncoding;
    R.toneMapping = on ? T.ACESFilmicToneMapping : T.NoToneMapping;
    R.toneMappingExposure = on ? (E.day ? 0.82 : 1.05) : 1;
    R.shadowMap.enabled = on;
    R.shadowMap.type = T.PCFSoftShadowMap;
    if (on) { R.shadowMap.autoUpdate = false; R.shadowMap.needsUpdate = true; }
    R.localClippingEnabled = on;
    G.camera.near = on ? 0.03 : 0.05; G.camera.far = on ? 700 : 200; G.camera.updateProjectionMatrix();
    if (on) applyQuality();
    else { R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); const h = R.domElement.parentElement; if (h) R.setSize(h.clientWidth, h.clientHeight, false); }
  }
  function setMode(on) {
    if (on && !E.built) {
      try { build(); }
      catch (err) {
        console.error('Echt-Modus konnte nicht gebaut werden:', err); E.failed = true;
        for (const t of Object.values(E.tex)) { t.map && t.map.dispose(); t.bump && t.bump.dispose(); }
        for (const m of Object.values(E.mats)) m.dispose();
        if (E.envTex) E.envTex.dispose();
        return false;
      }
    }
    E.on = on;
    applyRenderer(on);
    if (on) { applyVisibility(); applyHighlight(); }
    requestRender();
    return true;
  }
  let lastNow = 0, frI = 0, xrayTimer = 0;
  const FR = new Float32Array(240);
  function render(now) {
    let busy = false;
    if (E.intro) { stepIntro(now); busy = true; }
    if (E.xray && !reduceMotion) {                      // Puls mit ~20 fps, falls sonst nichts läuft
      E.cableMat.uniforms.uTime.value = now / 1000;
      if (!busy && !xrayTimer) xrayTimer = setTimeout(() => { xrayTimer = 0; if (E.on && E.xray) requestRender(); }, 50);
    }
    if (E.dirtyLights || E.lampsOn > 0) assignLights();
    if (E.shadowDirty) { G.renderer.shadowMap.needsUpdate = true; E.shadowDirty = false; }
    G.camera.updateMatrixWorld();
    G.renderer.render(E.scene, G.camera);
    if (lastNow) { FR[frI % FR.length] = now - lastNow; frI++; }
    lastNow = busy ? now : 0;
    return busy;
  }
  const markShadows = () => { E.shadowDirty = true; };

  return {
    get on() { return E.on; }, get built() { return E.built; }, get failed() { return E.failed; },
    get day() { return E.day; }, get xray() { return E.xray; }, get quality() { return E.quality; },
    get explode() { return E.explode; }, get layers() { return E.layers; }, get hidden() { return E.hidden; },
    state: E,
    setMode, render, setView, startIntro, endIntro, pick: pickOrbit, toggleSwitch, toggleLamp,
    applyVisibility() { applyVisibility(); markShadows(); }, applyHighlight,
    setDay(v) { setDay(v); G.renderer.toneMappingExposure = v ? 0.82 : 1.05; markShadows(); },
    setXray(v) { E.xray = v; applyVisibility(); },
    setQuality(q) { E.quality = q; if (E.built) { applyQuality(); markShadows(); } },
    setExplode(v) { E.explode = v; applyVisibility(); markShadows(); },
    setLayer(k, v) { E.layers[k] = v; applyVisibility(); markShadows(); },
    lampsOn() { return E.lamps.filter(l => l.on).map(l => l.id); },
    setLampsOn(ids) { for (const l of E.lamps) setLamp(l, ids.includes(l.id)); requestRender(); },
    switchLamps(d) { const s = E.switches.find(x => x.d === d); return s ? s.lamps : []; },
    switchChannels(d) { const s = E.switches.find(x => x.d === d); return s ? s.chans : []; },
    isHidden(d) { return E.hiddenIds.has(d.id); },
    recolor: recolorCables,
    fps() { const n = Math.min(frI, FR.length); if (n < 10) return null; let t = 0; for (let i = 0; i < n; i++) t += FR[i]; return Math.round(1000 / (t / n) * 10) / 10; },
    resetFps() { frI = 0; lastNow = 0; },
    walk: { prepare: prepareWalk, move: walkMove, eye: walkEye, floorAt, support, col: () => E.colE, targets: fid => E.targets[fid], occ: fid => E.floors[fid].userData.occ, setEntrance(p) { E.entrance = p; } },
    reachTest,
  };
} catch (err) { console.error('haus3d.js konnte nicht initialisiert werden:', err); return null; } })();
