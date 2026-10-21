/* Literature page. Behind the centre column, one swarm per study database, one dot per paper it covers (34,741 dots).
   Hover a swarm: citation tooltip + the hypotheses that cite it are underlined. Hover a hypothesis: its source swarms light up.
   Click a swarm: it gathers into a sunflower (same scale for every study) and its card opens. Every card has a #hash.
   Ways back: ✕, Esc, a click on the background, the browser's back button.
   Data comes from #lit-data, written by hw3/build_lit.py (sealed unless built with --unsealed). */
(() => {
'use strict';

const DATA = JSON.parse(document.getElementById('lit-data').textContent);
const STUDIES = DATA.studies;
const BY = Object.fromEntries(STUDIES.map(s => [s.slug, s]));
const ORDER = STUDIES.map(s => s.slug);
const SWARMS = DATA.swarms;
const NTOT = SWARMS.reduce((a, s) => a + s.n, 0);
const NMAX = Math.max(...SWARMS.map(s => s.n));
const HYPS = DATA.hyps;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
const forceReduce = /[?&]motion=reduce\b/.test(location.search);   // QA: literature.html?motion=reduce behaves as if the system asked for reduced motion
let reduced = reducedMQ.matches || forceReduce;
const body = document.body, main = $('#centre'), card = $('#card'), scrim = $('#scrim'), tip = $('#tip'), gcap = $('#gcap');
const labelsEl = $('#labels'), barEl = $('.bar'), colEl = $('.col');

/* ---------------- swarm state ---------------- */
const SHORT_UNIT = { ml: 'notices' };
const HOME_WIDE = { fs: ['L', .21], tr: ['L', .45], ml: ['L', .72], vn: ['R', .26], cp: ['R', .52], gz: ['R', .77] };
const HOME_NARROW = { ml: [.22, .38], fs: [.20, .86], tr: [.50, .12], cp: [.84, .12], vn: [.66, .50], gz: [.78, .86] };
const S = SWARMS.map((sw, i) => {
  const r = rng(41 + i * 977);
  return {
    sw, i, id: sw.id, n: sw.n, studies: sw.studies,
    hx: 0, hy: 0, x: 0, y: 0, cx: 0, cy: 0, R: 20, Rt: 10, fr: 20,
    ax: 0, ay: 0, wx: 2 * Math.PI / (70 + r() * 50), wy: 2 * Math.PI / (85 + r() * 55), px: r() * 6.28, py: r() * 6.28,
    rot0: r() * 6.28, rotW: (r() < .5 ? -1 : 1) * 2 * Math.PI / (300 + r() * 200), rot: 0,
    col: null, colT: null, g: 0, tw: null, el: null, lw: 0, lh: 0
  };
});
const SBY = Object.fromEntries(S.map(s => [s.id, s]));
const swarmOf = slug => SBY[BY[slug].swarm];

let PAL = {};
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const hex = v => { const h = cs.getPropertyValue(v).trim().replace('#', ''); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16) / 255); };
  PAL = { rest: hex('--pend'), ink: hex('--ink'), paper: hex('--paper') };
}
readPalette();
const C_REST = () => [...PAL.rest, .62], C_ON = () => [...PAL.ink, .9], C_FADE = () => [...PAL.rest, .14], C_GATHER = () => [...PAL.ink, 1];
S.forEach(s => { s.col = C_REST(); s.colT = C_REST(); });

/* ---------------- interaction state ---------------- */
const state = { card: null, hover: null, tipSwarm: null, tipTouch: false, litSwarms: new Set(), opener: null, pendingH: null, lastPointer: 'mouse', hypLit: null };

/* ---------------- labels (the focusable handles) ---------------- */
const labelBtn = {};
S.forEach(s => {
  const g = document.createElement('div');
  g.className = 'sl';
  s.studies.forEach(slug => {
    const st = BY[slug];
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = st.label;
    b.dataset.study = slug;
    b.setAttribute('aria-label', `${st.label}: ${s.sw.n_label} ${s.sw.what}. Open the study card`);
    labelBtn[slug] = b;
    g.appendChild(b);
  });
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = `${s.sw.n_label} ${SHORT_UNIT[s.id] || 'papers'}`;
  n.setAttribute('aria-hidden', 'true');
  g.appendChild(n);
  labelsEl.appendChild(g);
  s.el = g;
});

/* ---------------- WebGL ---------------- */
const canvas = $('#gl');
const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true, alpha: true });
let loc = null;
if (gl) {
  const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(x)); return x; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `
attribute vec2 a_loose; attribute vec2 a_tight; attribute vec4 a_ph; attribute float a_sw;
uniform vec2 u_res; uniform float u_dpr; uniform float u_t; uniform float u_wander; uniform vec2 u_size;
uniform vec4 u_geo[${S.length}]; uniform vec4 u_gat[${S.length}]; uniform vec4 u_col[${S.length}];
varying vec4 v_col; varying float v_ps;
void main(){
  int i = int(a_sw + 0.5);
  vec4 geo = u_geo[i]; vec4 gat = u_gat[i];
  float c = cos(geo.w), s = sin(geo.w);
  vec2 lp = vec2(c * a_loose.x - s * a_loose.y, s * a_loose.x + c * a_loose.y) * geo.z;
  vec2 wob = u_wander * (0.45 + 0.55 * min(length(a_loose), 1.2)) * vec2(sin(u_t * a_ph.z + a_ph.x), cos(u_t * a_ph.w + a_ph.y));
  vec2 p0 = geo.xy + lp + wob;
  vec2 p1 = gat.xy + a_tight * gat.z;
  float g = clamp(gat.w * 1.3 - length(a_tight) * 0.3, 0.0, 1.0);
  g = g * g * (3.0 - 2.0 * g);
  vec2 p = mix(p0, p1, g);
  vec2 cl = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(cl.x, -cl.y, 0.0, 1.0);
  v_ps = max(1.0, mix(u_size.x, u_size.y, g) * u_dpr);
  gl_PointSize = v_ps;
  v_col = u_col[i];
}`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
precision mediump float; varying vec4 v_col; varying float v_ps;
void main(){
  float r = length(gl_PointCoord - 0.5) * v_ps;
  float a = v_col.a * clamp(v_ps * 0.5 - r + 0.5, 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(v_col.rgb * a, a);
}`));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = n => gl.getUniformLocation(prog, n);
  loc = { res: U('u_res'), dpr: U('u_dpr'), t: U('u_t'), wander: U('u_wander'), size: U('u_size'), geo: U('u_geo'), gat: U('u_gat'), col: U('u_col') };

  // one dot per paper. Loose: a jittered sunflower (uniform density, soft edge). Tight: the exact sunflower.
  // Dot i of a swarm sits at the same rank in both, so gathering is a calm contraction, inner dots first.
  const aLoose = new Float32Array(NTOT * 2), aTight = new Float32Array(NTOT * 2), aPh = new Float32Array(NTOT * 4), aSw = new Float32Array(NTOT);
  const GA = Math.PI * (3 - Math.sqrt(5));
  let o = 0;
  S.forEach((s, si) => {
    const r = rng(1009 + si * 7919);
    for (let i = 0; i < s.n; i++, o++) {
      const th = i * GA, rt = Math.sqrt((i + .5) / s.n);
      aTight[2 * o] = rt * Math.cos(th); aTight[2 * o + 1] = rt * Math.sin(th);
      const rl = Math.sqrt(clamp((i + r()) / s.n, 0, 1)) * (1 + .09 * gauss(r));
      const tl = th + (r() - .5) * 2.2;
      aLoose[2 * o] = rl * Math.cos(tl); aLoose[2 * o + 1] = rl * Math.sin(tl);
      aPh[4 * o] = r() * 6.283; aPh[4 * o + 1] = r() * 6.283;
      aPh[4 * o + 2] = 2 * Math.PI / (9 + r() * 14); aPh[4 * o + 3] = 2 * Math.PI / (9 + r() * 14);
      aSw[o] = si;
    }
  });
  const buf = (arr, name, n) => { const l = gl.getAttribLocation(prog, name); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0); };
  buf(aLoose, 'a_loose', 2); buf(aTight, 'a_tight', 2); buf(aPh, 'a_ph', 4); buf(aSw, 'a_sw', 1);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
} else {
  console.warn('WebGL unavailable: the swarms are not drawn; the study names still open the cards.');
}

/* ---------------- layout ---------------- */
let VW = innerWidth, VH = innerHeight, DPR = Math.min(2, devicePixelRatio || 1), wide = true, barB = 52, panelH = 0;
let sizeLoose = 1.6, sizeTight = 2.2, wander = 2.4, textL = 0, textR = 0;
const stage = { gx: 0, gy: 0, cT: 1, cardLeft: 0, cardW: 520 };

function layout() {
  VW = innerWidth; VH = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
  wide = VW >= 900;
  barB = barEl.getBoundingClientRect().bottom;
  panelH = wide ? 0 : Math.round(clamp(VH * .34, 170, 330));
  document.documentElement.style.setProperty('--panel-h', panelH + 'px');
  canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR);
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);

  let k, a;
  if (wide) {
    const cr = colEl.getBoundingClientRect();
    const padX = parseFloat(getComputedStyle(colEl).paddingLeft) || 0;
    textL = cr.left + padX; textR = cr.right - padX;
    const mL = textL, mR = VW - textR, H = VH - barB;
    a = (mL + mR) * H * .40 / NTOT;
    k = Math.sqrt(a / Math.PI);
    k = clamp(k, .45, Math.min(.34 * H, .62 * Math.max(mL, mR)) / Math.sqrt(NMAX));
    a = Math.PI * k * k;
    S.forEach(s => {
      s.R = k * Math.sqrt(s.n);
      const thr = 36, small = s.R < thr;
      s.fr = Math.max(s.R, 30) + (small ? 16 : 0);
      const [side, fy] = HOME_WIDE[s.id];
      const m = side === 'L' ? mL : mR, x0 = side === 'L' ? 0 : textR;
      s.bx = [x0 + Math.min(s.fr * .6, m / 2), x0 + Math.max(m - s.fr * .8, m / 2)];
      if (side === 'R') s.bx = [x0 + Math.min(s.fr * .8, m / 2), x0 + Math.max(m - s.fr * .6, m / 2)];
      s.by = [barB + s.fr * .6, VH - s.fr * .5];
      s.x = x0 + m / 2; s.y = barB + fy * H; s.x0 = s.x; s.y0 = s.y;
    });
    relax(22);
    stage.cardW = clamp(VW * .42, 440, 560);
    const gap = 56, slot = Math.max(160, Math.min(VH - barB - 120, VW - stage.cardW - gap - 96, 600));
    const left0 = (VW - (slot + gap + stage.cardW)) / 2;
    stage.gx = left0 + slot / 2; stage.gy = barB + (VH - barB) / 2 - 14;
    stage.cardLeft = left0 + slot + gap;
    stage.cT = (slot / 2) / Math.sqrt(NMAX);
    wander = 2.6;
  } else {
    textL = 0; textR = 0;
    a = VW * panelH * .25 / NTOT;
    k = Math.sqrt(a / Math.PI);
    k = clamp(k, .3, Math.min(.42 * panelH, .28 * VW) / Math.sqrt(NMAX));
    a = Math.PI * k * k;
    // phones: each swarm plus its label is a box; boxes are pushed apart so no two labels collide
    S.forEach(s => {
      s.R = k * Math.sqrt(s.n);
      s.el.style.transform = 'none';
      const lw = s.el.offsetWidth, lh = s.el.offsetHeight, inside = s.R >= 26;
      s.hw = Math.max(s.R, lw / 2) + 3;
      s.ht = inside ? Math.max(s.R, lh / 2) + 3 : s.R + 3;
      s.hb = inside ? s.ht : s.R + 5 + lh;
      const [fx, fy] = HOME_NARROW[s.id];
      s.x = fx * VW; s.y = barB + fy * panelH; s.x0 = s.x; s.y0 = s.y;
    });
    relaxBoxes(12);
    stage.gx = VW / 2; stage.gy = barB + panelH / 2;
    stage.cT = Math.max(.3, (Math.min(panelH, VW) / 2 - 18) / Math.sqrt(NMAX));
    wander = 1.3;
  }
  sizeLoose = clamp(Math.sqrt(a) * .62, 1, 2.2);
  sizeTight = clamp(Math.sqrt(Math.PI) * stage.cT * .62, 1, 3);
  S.forEach(s => {
    s.hx = s.x; s.hy = s.y;
    s.ax = reduced ? 0 : (wide ? Math.min(16, 5 + s.R * .05) : 3); s.ay = reduced ? 0 : (wide ? Math.min(14, 4 + s.R * .045) : 3);
    s.Rt = stage.cT * Math.sqrt(s.n);
    s.el.style.left = '0px'; s.el.style.top = '0px';
    s.lw = s.el.offsetWidth; s.lh = s.el.offsetHeight;
  });
  if (state.card) placeCard();
}

function relax(pad) {
  for (let it = 0; it < 360; it++) {
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const A = S[i], B = S[j];
      let dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || .01, min = A.fr + B.fr + pad;
      if (d < min) {
        const push = (min - d), wa = B.fr / (A.fr + B.fr), wb = A.fr / (A.fr + B.fr);
        dx /= d; dy /= d;
        A.x -= dx * push * wa * .5; A.y -= dy * push * wa * .5;
        B.x += dx * push * wb * .5; B.y += dy * push * wb * .5;
      }
    }
    S.forEach(s => {
      s.x += (s.x0 - s.x) * .02; s.y += (s.y0 - s.y) * .02;
      s.x = s.bx[0] <= s.bx[1] ? clamp(s.x, s.bx[0], s.bx[1]) : (s.bx[0] + s.bx[1]) / 2;
      s.y = s.by[0] <= s.by[1] ? clamp(s.y, s.by[0], s.by[1]) : (s.by[0] + s.by[1]) / 2;
    });
  }
}

function relaxBoxes(pad) {
  const top = barB, bot = barB + panelH;
  for (let it = 0; it < 500; it++) {
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const A = S[i], B = S[j];
      const ox = Math.min(A.x + A.hw, B.x + B.hw) - Math.max(A.x - A.hw, B.x - B.hw) + pad;
      const oy = Math.min(A.y + A.hb, B.y + B.hb) - Math.max(A.y - A.ht, B.y - B.ht) + pad;
      if (ox <= 0 || oy <= 0) continue;
      const wa = B.hw * B.ht / (A.hw * A.ht + B.hw * B.ht), wb = 1 - wa;   // the smaller box moves more
      if (ox < oy) { const d = B.x >= A.x ? 1 : -1; A.x -= d * ox * wa * .5; B.x += d * ox * wb * .5; }
      else { const d = B.y >= A.y ? 1 : -1; A.y -= d * oy * wa * .5; B.y += d * oy * wb * .5; }
    }
    S.forEach(s => {
      if (it < 300) { s.x += (s.x0 - s.x) * .01; s.y += (s.y0 - s.y) * .01; }   // the last passes only separate
      s.x = s.hw * 2 < VW ? clamp(s.x, s.hw, VW - s.hw) : VW / 2;
      s.y = s.ht + s.hb < panelH ? clamp(s.y, top + s.ht, bot - s.hb) : (top + bot) / 2;
    });
  }
}

/* ---------------- animation loop (runs only while something moves) ---------------- */
let t = 0, last = 0, running = false;
const perf = { n: 0, sum: 0, worst: 0 };
window.__litPerf = perf;   // frame timing and state, read during QA
perf.state = () => ({ hover: state.hover && state.hover.id, tip: state.tipSwarm && state.tipSwarm.id, lit: [...state.litSwarms].map(s => s.id),
  card: state.card, swarms: S.map(s => ({ id: s.id, x: +s.cx.toFixed(1), y: +s.cy.toFixed(1), R: +s.R.toFixed(1), g: +s.g.toFixed(3), rot: +s.rot.toFixed(4), col: s.col.map(v => +v.toFixed(2)), colT: s.colT.map(v => +v.toFixed(2)) })) });

function frame(now) {
  if (step(now)) requestAnimationFrame(frame); else { running = false; last = 0; }
}
function step(now) {
  const dtRaw = last ? Math.max(0, now - last) : 16.7;
  const dt = Math.min(.05, dtRaw / 1000);
  last = now;
  const drifting = !reduced && !state.card;
  if (drifting) { t += dt; perf.n++; perf.sum += dtRaw; perf.worst = Math.max(perf.worst, dtRaw); }
  let busy = drifting;
  const kCol = 1 - Math.exp(-Math.min(1, dtRaw / 1000) / .09);   // real elapsed time: slow frames must not slow the fade
  S.forEach(s => {
    s.cx = s.hx + s.ax * Math.sin(t * s.wx + s.px);
    s.cy = s.hy + s.ay * Math.sin(t * s.wy + s.py);
    s.rot = s.rot0 + (reduced ? 0 : t * s.rotW);
    if (s.tw) {
      const q = reduced ? 1 : clamp((now - s.tw.t0) / s.tw.dur, 0, 1);
      s.g = s.tw.from + (s.tw.to - s.tw.from) * ease(q);
      if (q >= 1) s.tw = null; else busy = true;
    }
    for (let c = 0; c < 4; c++) {
      const d = s.colT[c] - s.col[c];
      if (Math.abs(d) > .003) { s.col[c] += d * kCol; busy = true; } else s.col[c] = s.colT[c];
    }
  });
  draw();
  placeLabels();
  placeGcap();
  return busy;
}
function kick() { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } }
// QA: cost of one drift frame (JS + GPU, all dots), measured without relying on the display's refresh
// QA: advance the animation by `ms` of synthetic time in 16 ms steps (works even when the browser pauses frames)
perf.tick = (ms = 1000) => { let now = performance.now(); last = now; for (let k = 0; k < ms / 16; k++) { now += 16; step(now); } return perf.state(); };
perf.bench = (frames = 120) => {
  const px = new Uint8Array(4);
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) { t += 1 / 60; S.forEach(s => { s.cx = s.hx + s.ax * Math.sin(t * s.wx + s.px); s.cy = s.hy + s.ay * Math.sin(t * s.wy + s.py); s.rot = s.rot0 + t * s.rotW; }); draw(); placeLabels(); if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  return { msPerFrame: +((performance.now() - t0) / frames).toFixed(3), dots: NTOT };
};

const GEO = new Float32Array(S.length * 4), GAT = new Float32Array(S.length * 4), COL = new Float32Array(S.length * 4);
function draw() {
  if (!gl) return;
  S.forEach((s, i) => {
    GEO.set([s.cx, s.cy, s.R, s.rot], i * 4);
    GAT.set([stage.gx, stage.gy, s.Rt, s.g], i * 4);
    COL.set(s.col, i * 4);
  });
  gl.disable(gl.SCISSOR_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!wide) { gl.enable(gl.SCISSOR_TEST); gl.scissor(0, Math.round((VH - barB - panelH) * DPR), canvas.width, Math.round(panelH * DPR)); }
  gl.uniform2f(loc.res, VW, VH); gl.uniform1f(loc.dpr, DPR); gl.uniform1f(loc.t, t);
  gl.uniform1f(loc.wander, reduced ? 0 : wander); gl.uniform2f(loc.size, sizeLoose, sizeTight);
  gl.uniform4fv(loc.geo, GEO); gl.uniform4fv(loc.gat, GAT); gl.uniform4fv(loc.col, COL);
  gl.drawArrays(gl.POINTS, 0, NTOT);
}

/* the card's swarm caption stays attached to its swarm: it follows the swarm while it gathers and shows once it has arrived */
function placeGcap() {
  if (!state.card || !wide) return;
  const s = swarmOf(state.card), g = clamp(s.g, 0, 1);
  const x = s.cx + (stage.gx - s.cx) * g, y = s.cy + (stage.gy - s.cy) * g, r = s.R + (s.Rt - s.R) * g;
  gcap.style.left = x + 'px'; gcap.style.top = (y + r + 16) + 'px';
  gcap.classList.toggle('on', g > .9);
}
function placeLabels() {
  if (state.card) return;
  const top = barB + 2, bottom = wide ? VH - 2 : barB + panelH - 2;
  S.forEach(s => {
    const inside = s.R >= (wide ? 36 : 26);
    let x = s.cx - s.lw / 2, y = inside ? s.cy - s.lh / 2 : s.cy + s.R + 3;
    x = clamp(x, 4, VW - s.lw - 4); y = clamp(y, top, bottom - s.lh);
    s.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  });
}

/* ---------------- colour states ---------------- */
function recolour() {
  S.forEach(s => {
    let c;
    if (state.card) c = swarmOf(state.card) === s ? C_GATHER() : C_FADE();
    else if (state.hover === s || state.tipSwarm === s || state.litSwarms.has(s)) c = C_ON();
    else c = C_REST();
    s.colT = c;
    s.el.classList.toggle('on', !state.card && (state.hover === s || state.tipSwarm === s || state.litSwarms.has(s)));
  });
  kick();
}

/* ---------------- linking: swarm -> hypotheses, hypothesis -> swarms ---------------- */
const hypEls = $$('.hyp');
const citeLinks = () => $$('a.cite');
function markCited(s) {
  const slugs = s ? new Set(s.studies) : new Set();
  hypEls.forEach(h => h.classList.toggle('cited', (h.dataset.cites || '').split(' ').some(x => slugs.has(x))));
  citeLinks().forEach(a => a.classList.toggle('on', slugs.has(a.dataset.study)));
}
function setHover(s) {
  if (state.hover === s) return;
  state.hover = s;
  markCited(s || state.tipSwarm);
  body.style.cursor = s ? 'pointer' : '';
  recolour();
}
function lightStudies(slugs) {
  state.litSwarms = new Set(slugs.map(sl => swarmOf(sl)));
  recolour();
}

hypEls.forEach(h => {
  const cites = () => (h.dataset.cites || '').split(' ').filter(Boolean);
  h.addEventListener('mouseenter', () => { if (state.lastPointer !== 'touch') { h.classList.add('lit'); lightStudies(cites()); } });
  h.addEventListener('mouseleave', () => { if (state.lastPointer !== 'touch') { h.classList.remove('lit'); lightStudies([]); } });
  h.addEventListener('click', e => {
    if (state.lastPointer !== 'touch' || e.target.closest('a')) return;
    const on = state.hypLit !== h;
    hypEls.forEach(x => x.classList.remove('lit'));
    state.hypLit = on ? h : null;
    if (on) h.classList.add('lit');
    lightStudies(on ? cites() : []);
  });
});
/* a #h1-#h6 link (from the report or a card): centre the hypothesis, highlight it and light its studies for a while */
function showHyp(h) {
  h.setAttribute('tabindex', '-1');
  h.scrollIntoView({ block: 'center', behavior: 'auto' });
  h.focus({ preventScroll: true });
  h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
  hypEls.forEach(x => x.classList.remove('lit')); h.classList.add('lit'); state.hypLit = h;
  lightStudies((h.dataset.cites || '').split(' ').filter(Boolean));
  clearTimeout(showHyp.t);
  showHyp.t = setTimeout(() => { if (state.hypLit === h && !h.matches(':hover')) { h.classList.remove('lit'); state.hypLit = null; lightStudies([]); } }, 4000);
}
document.addEventListener('mouseover', e => {
  const a = e.target.closest && e.target.closest('a.cite');
  if (a && state.lastPointer !== 'touch' && !state.card) lightStudies([a.dataset.study]);
});
document.addEventListener('mouseout', e => {
  const a = e.target.closest && e.target.closest('a.cite');
  if (a && !(e.relatedTarget && a.contains(e.relatedTarget)) && !state.card) {
    const h = a.closest('.hyp');
    lightStudies(h && h.matches(':hover') ? (h.dataset.cites || '').split(' ').filter(Boolean) : []);
  }
});
document.addEventListener('focusin', e => {
  const a = e.target.closest && e.target.closest('a.cite');
  if (a && !state.card) lightStudies([a.dataset.study]);
});
document.addEventListener('focusout', e => {
  const a = e.target.closest && e.target.closest('a.cite');
  if (a && !state.card) lightStudies([]);
});

/* ---------------- tooltip ---------------- */
function feedsOf(s) {
  const hs = new Set();
  s.studies.forEach(sl => BY[sl].feeds.forEach(h => hs.add(h)));
  return HYPS.map(h => h.id).filter(h => hs.has(h));
}
function contextOf(s) {
  const c = s.studies.map(sl => BY[sl].context).filter(Boolean);
  return c.length ? 'Context for the ' + esc(c[0]) : 'Feeds no hypothesis';
}
function tipHTML(s, touch) {
  const studies = s.studies.map(sl => BY[sl]);
  const feeds = feedsOf(s);
  const verb = touch ? 'Tap again' : 'Click';
  const hint = studies.length > 1
    ? `${verb} to open ${esc(studies[0].label)}; ${esc(studies[1].label)} is linked from its card, or ${touch ? 'tap' : 'click'} its name.`
    : `${verb} to open the study.`;
  return `<div class="tn">${esc(s.sw.n_label)} ${esc(s.sw.what)}, one dot each</div>` +
    studies.map(st => `<p class="tc"><b>${esc(st.authors)} (${esc(st.year)}).</b> ${st.title_html} <i>${st.journal_html}</i>.</p>`).join('') +
    `<div class="tf">${feeds.length ? 'Feeds ' + feeds.map(h => h.toUpperCase()).join(' · ') : contextOf(s)}</div>` +
    `<div class="th">${hint}</div>`;
}
function showTip(s, x, y, touch) {
  state.tipSwarm = s; state.tipTouch = !!touch;
  tip.innerHTML = tipHTML(s, touch);
  tip.hidden = false;
  moveTip(x, y);
  markCited(s);
  recolour();
}
function hoverTip(s, x, y) {
  if (state.tipSwarm !== s || state.tipTouch) showTip(s, x, y, false); else moveTip(x, y);
}
function moveTip(x, y) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let lx = x + 18, ly = y + 18;
  if (lx + w > VW - 8) lx = x - w - 18;
  if (ly + h > VH - 8) ly = y - h - 18;
  tip.style.transform = `translate(${Math.round(clamp(lx, 8, VW - w - 8))}px,${Math.round(clamp(ly, barB + 6, VH - h - 8))}px)`;
}
function hideTip() {
  if (!state.tipSwarm && tip.hidden) return;
  state.tipSwarm = null; state.tipTouch = false;
  tip.hidden = true;
  markCited(state.hover);
  recolour();
}

/* ---------------- hit testing ---------------- */
function swarmAt(x, y) {
  if (state.card) return null;
  if (wide && x > textL - 8 && x < textR + 8) return null;
  if (!wide && (y < barB || y > barB + panelH)) return null;
  let best = null, bd = Infinity;
  S.forEach(s => {
    const d = Math.hypot(x - s.cx, y - s.cy), r = Math.max(s.R * 1.04, wide ? 20 : 16);
    if (d <= r && d / r < bd) { bd = d / r; best = s; }
  });
  return best;
}
const onText = el => !!(el && el.closest && el.closest('.blk p, .blk li, .blk h1, .blk h2, .blk a, .bar, .sl button, .lcard, .tip'));

addEventListener('pointerdown', e => { state.lastPointer = e.pointerType || 'mouse'; }, true);
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  state.lastPointer = e.pointerType || 'mouse';
  if (state.card) return;
  const lab = e.target.closest && e.target.closest('.sl button');
  if (lab) { const s = swarmOf(lab.dataset.study); setHover(s); hoverTip(s, e.clientX, e.clientY); return; }
  const s = onText(e.target) ? null : swarmAt(e.clientX, e.clientY);
  setHover(s);
  if (s) hoverTip(s, e.clientX, e.clientY);
  else if (state.tipSwarm && !state.tipTouch) hideTip();
}, { passive: true });
document.addEventListener('mouseleave', () => { if (state.lastPointer !== 'touch') { setHover(null); hideTip(); } });

document.addEventListener('click', e => {
  if (state.card) return;          // the scrim and the card handle clicks while a card is open
  if (e.target.closest('.sl button')) return;
  const touch = state.lastPointer === 'touch';
  if (onText(e.target)) { if (touch && state.tipSwarm && !e.target.closest('.tip')) hideTip(); return; }
  const s = swarmAt(e.clientX, e.clientY);
  if (!s) { if (state.tipSwarm) hideTip(); return; }
  if (touch && state.tipSwarm !== s) { showTip(s, s.cx, s.cy + Math.min(s.R, 40), true); return; }
  openFromUI(s.studies[0], labelBtn[s.studies[0]]);
});

Object.entries(labelBtn).forEach(([slug, b]) => {
  b.addEventListener('click', () => {
    const s = swarmOf(slug);
    if (state.lastPointer === 'touch' && state.tipSwarm !== s) {
      const r = b.getBoundingClientRect();
      showTip(s, r.left, r.bottom, true);
      return;
    }
    openFromUI(slug, b);
  });
  b.addEventListener('focus', () => {
    if (state.card || !b.matches(':focus-visible')) return;
    const s = swarmOf(slug), r = b.getBoundingClientRect();
    showTip(s, r.left, r.bottom, false);
  });
  b.addEventListener('blur', () => { if (!state.card && state.lastPointer !== 'touch') hideTip(); });
});

/* ---------------- the card ---------------- */
function pairHTML(p) {
  const w = v => clamp(v / p.max * 100, 0, 100).toFixed(2);
  const theirs = `<div class="prow theirs"><span class="who">${esc(p.who)}</span><span class="track">` +
    `<i class="bar${p.lower_bound ? ' lb' : ''}" style="width:${w(p.theirs)}%"></i>` +
    `<b class="val" style="left:calc(${w(p.theirs)}% + ${p.lower_bound ? 14 : 0}px)">${esc(p.theirs_txt)}</b></span></div>`;
  const ours = p.sealed
    ? `<div class="prow ours sealed"><span class="who">Our data</span><span class="track"><span class="seal">${esc(p.seal_text)}</span></span></div>`
    : `<div class="prow ours"><span class="who">Our data</span><span class="track"><i class="bar" style="width:${w(p.ours)}%"></i>` +
      `<b class="val" style="left:${w(p.ours)}%">${esc(p.ours_txt)}</b></span></div>`;
  return `<div class="pair"><h4>${esc(p.label)}</h4>${theirs}${ours}<p class="def">${esc(p.note)}</p></div>`;
}
function cardHTML(slug) {
  const s = BY[slug], i = ORDER.indexOf(slug), n = ORDER.length;
  const prev = BY[ORDER[(i - 1 + n) % n]], next = BY[ORDER[(i + 1) % n]];
  const sw = SBY[s.swarm].sw;
  const links = [`<a href="${esc(s.url)}" target="_blank" rel="noopener">Read it at ${esc(s.url_host)} ↗</a>`];
  if (s.doi) links.push(`<a href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)} ↗</a>`);
  const feeds = s.feeds.length
    ? `Feeds ${s.feeds.map(h => `<a href="#${h}" data-h="${h}">${h.toUpperCase()}</a>`).join(' ')}`
    : (s.context ? `Context for the ${esc(s.context)}` : 'Feeds no hypothesis');
  return `<div class="ctop"><span>Study ${i + 1} of ${n}</span>` +
    `<button class="x" type="button" data-close aria-label="Close the card and return to the page">✕</button></div>` +
    `<h2 id="card-title">${s.heading_html}</h2>` +
    `<p class="cit">${s.cite_html}</p>` +
    `<p class="lnk">${links.join('')}</p>` +
    (s.access_html ? `<p class="acc">${s.access_html}</p>` : '') +
    (s.same ? `<p class="same">${esc(sw.n_label)} papers, the same database as <a href="#${s.same}" data-go="${s.same}">${esc(BY[s.same].label)}</a> →</p>` : '') +
    `<p class="same ncap">${esc(sw.caption)}</p>` +
    `<div class="entry">${s.entry_placeholder ? `<p class="tbd">Text to come · ~${s.entry_target} words</p>` : s.entry_html}</div>` +
    `<p class="feeds">${feeds}</p>` +
    (s.pairs.length ? `<h3>Their number, next to ours</h3>` + s.pairs.map(pairHTML).join('') : '') +
    `<div class="nav"><button type="button" data-go="${prev.slug}" aria-label="Previous study: ${esc(prev.label)}"><span class="ar">‹</span> <span>${esc(prev.label)}</span></button>` +
    `<span class="pos">${i + 1} / ${n}</span>` +
    `<button type="button" data-go="${next.slug}" aria-label="Next study: ${esc(next.label)}"><span>${esc(next.label)}</span> <span class="ar">›</span></button></div>`;
}
function placeCard() {
  if (wide) {
    card.style.setProperty('--card-w', stage.cardW + 'px');
    card.style.left = stage.cardLeft + 'px';
    const h = card.offsetHeight;
    card.style.top = Math.max(barB + 20, barB + (VH - barB - h) / 2) + 'px';
    placeGcap();
  } else {
    card.style.left = ''; card.style.top = '';
  }
}
function gather(s, to) {
  s.tw = { from: s.g, to, t0: performance.now(), dur: to > s.g ? 950 : 700 };
}
function showCard(slug) {
  const s = BY[slug], prevSlug = state.card;
  const sw = swarmOf(slug);
  state.card = slug;
  hideTip(); setHover(null);
  hypEls.forEach(x => x.classList.remove('lit', 'cited'));
  state.litSwarms.clear(); state.hypLit = null;
  body.classList.add('carded');
  main.inert = true; labelsEl.inert = true;
  S.forEach(x => x.el.classList.add('off'));
  if (prevSlug && swarmOf(prevSlug) !== sw) gather(swarmOf(prevSlug), 0);
  if (sw.g < 1 || sw.tw) gather(sw, 1);
  const fill = () => {
    card.innerHTML = cardHTML(slug);
    card.setAttribute('aria-label', s.label);
    card.hidden = false; scrim.hidden = false;
    gcap.innerHTML = esc(sw.sw.caption) + '<br>Same scale on every card.';
    gcap.classList.toggle('on', wide && sw.g > .9);
    placeCard();
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
  };
  if (prevSlug && !reduced) {
    card.classList.add('swap');
    setTimeout(() => { fill(); card.classList.remove('swap'); }, 140);
  } else fill();
  recolour();
}
function hideCard() {
  const slug = state.card;
  if (!slug) return;
  state.card = null;
  card.hidden = true; scrim.hidden = true; card.innerHTML = '';
  gcap.classList.remove('on');
  body.classList.remove('carded');
  main.inert = false; labelsEl.inert = false;
  S.forEach(x => x.el.classList.remove('off'));
  gather(swarmOf(slug), 0);
  recolour();
  if (state.pendingH) {
    const h = document.getElementById(state.pendingH);
    state.pendingH = null;
    if (h) showHyp(h);
  } else {
    const b = (state.opener && document.contains(state.opener)) ? state.opener : labelBtn[slug];
    if (b) b.focus({ preventScroll: true });
  }
  state.opener = null;
}
card.setAttribute('tabindex', '-1');

/* ---------------- routing: one #hash per card; back, ✕, Esc and the background all return to the centre ---------------- */
const SLUGS = new Set(ORDER);
const hashSlug = () => { const h = decodeURIComponent(location.hash.slice(1)); return SLUGS.has(h) ? h : null; };
const bare = () => location.pathname + location.search;
function openFromUI(slug, opener) {
  if (opener) state.opener = opener;
  if (state.card) history.replaceState({ card: slug }, '', '#' + slug);
  else history.pushState({ card: slug }, '', '#' + slug);
  showCard(slug);
}
function closeFromUI() {
  if (!state.card) return;
  if (history.state && history.state.card) history.back();      // the popstate handler hides the card
  else { history.replaceState(null, '', bare()); hideCard(); }
}
function sync() {
  const s = hashSlug();
  if (s) { if (state.card !== s) showCard(s); }
  else {
    if (state.card) hideCard();
    const m = /^#(h[1-6])$/.exec(location.hash);
    if (m) { const h = document.getElementById(m[1]); if (h) showHyp(h); }
  }
}
addEventListener('popstate', sync);
addEventListener('hashchange', sync);

scrim.addEventListener('click', closeFromUI);
card.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) { closeFromUI(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); openFromUI(go.dataset.go); return; }
  const h = e.target.closest('a[data-h]');
  if (h) { e.preventDefault(); state.pendingH = h.dataset.h; closeFromUI(); }
});
document.addEventListener('click', e => {
  const a = e.target.closest('a.cite');
  if (!a || state.card) return;
  e.preventDefault();
  openFromUI(a.dataset.study, a);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.card) { e.preventDefault(); closeFromUI(); }
    else if (state.tipSwarm) hideTip();
    return;
  }
  if (!state.card) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const i = ORDER.indexOf(state.card), n = ORDER.length;
    openFromUI(ORDER[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]);
    e.preventDefault();
  } else if (e.key === 'Tab') {      // keep focus inside the open card
    const f = $$('a[href], button:not([disabled])', card);
    if (!f.length) return;
    const first = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  }
});

/* ---------------- start ---------------- */
function onReduce() {
  reduced = reducedMQ.matches || forceReduce;
  S.forEach(s => { s.ax = reduced ? 0 : (wide ? Math.min(16, 5 + s.R * .05) : 3); s.ay = reduced ? 0 : (wide ? Math.min(14, 4 + s.R * .045) : 3); });
  kick();
}
reducedMQ.addEventListener ? reducedMQ.addEventListener('change', onReduce) : reducedMQ.addListener(onReduce);
let rz = 0;
addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { layout(); step(performance.now()); kick(); }); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); step(performance.now()); kick(); });
$('#howto').textContent = matchMedia('(hover: none)').matches
  ? 'Each cloud of dots is one study, one dot per paper it covers. Tap a cloud for its citation and tap again to open it; tap a hypothesis to light up the studies it rests on.'
  : 'Each cloud of dots is one study, one dot per paper it covers. Hover a cloud for its citation and click to open it; hover a hypothesis to light up the studies it rests on.';

layout();
step(performance.now());   // first paint and label positions right away, not on the first animation frame
last = 0;
const first = hashSlug();
if (first) {          // a deep link: put the centre under the card in history, so back returns to the centre
  history.replaceState(null, '', bare());
  history.pushState({ card: first }, '', '#' + first);
  showCard(first);
} else sync();
kick();
})();
