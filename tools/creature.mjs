/**
 * CREATURE — процедурный рендер персонажа в SVG.
 *
 * Персонаж описывается один раз (детерминированный seed), а каждый кадр —
 * это проекция одной и той же геометрии при другом угле поворота головы.
 * Благодаря этому перья, маска, клюв, глаза и амулеты не «плавают»
 * и не деформируются между кадрами: меняется только ракурс.
 */

export const FRAME_W = 900;
export const FRAME_H = 1100;

/** Максимальный поворот головы влево/вправо, радианы. */
const YAW_MAX = 0.92;

const HEAD = { x: 450, y: 402, r: 178 };
const BODY = { x: 448, y: 742, rx: 208, ry: 196 };

const C = {
  featherCore: '#05090a',
  featherMid: '#0b1413',
  featherEdge: '#132220',
  rim: '#8ff0d2',
  rimSoft: '#3f8f7d',
  maskLit: '#efe9db',
  maskMid: '#cfc7b4',
  maskShade: '#8d8878',
  beak: '#d8d0bc',
  beakShade: '#7d7768',
  eye: '#04070a',
  cord: '#3b352c',
  brass: '#c9a253',
  brassDark: '#7d6430',
  glass: '#63b9a6',
};

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Точка на сфере головы: долгота lon (0 — прямо на зрителя), широта lat.
 * Возвращает экранные координаты и глубину z (>0 — обращено к зрителю).
 */
function sph(lon, lat, r, yaw) {
  const a = lon + yaw;
  const cl = Math.cos(lat);
  return {
    x: HEAD.x + r * cl * Math.sin(a),
    y: HEAD.y - r * Math.sin(lat),
    z: r * cl * Math.cos(a),
  };
}

/** Перо: каплевидная форма от основания к кончику. */
function feather(bx, by, tx, ty, width, bend) {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const mx = (bx + tx) / 2 + px * bend;
  const my = (by + ty) / 2 + py * bend;
  const w = width / 2;
  return (
    `M${n(bx + px * w)} ${n(by + py * w)}` +
    `Q${n(mx + px * w * 0.55)} ${n(my + py * w * 0.55)} ${n(tx)} ${n(ty)}` +
    `Q${n(mx - px * w * 0.55)} ${n(my - py * w * 0.55)} ${n(bx - px * w)} ${n(by - py * w)}Z`
  );
}

/** Тонкий волосок: открытая кривая. */
function hair(bx, by, tx, ty, bend) {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  return (
    `M${n(bx)} ${n(by)}Q${n((bx + tx) / 2 + px * bend)} ${n((by + ty) / 2 + py * bend)} ${n(tx)} ${n(ty)}`
  );
}

/** Catmull-Rom интерполяция профиля маски: [lat, halfLon]. */
function resample(profile, steps) {
  const out = [];
  const p = (i) => profile[clamp(i, 0, profile.length - 1)];
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const v = [];
      for (let k = 0; k < 2; k++) {
        v[k] =
          0.5 *
          (2 * p1[k] +
            (-p0[k] + p2[k]) * t +
            (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
            (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      }
      out.push(v);
    }
  }
  out.push(profile[profile.length - 1]);
  return out;
}

/** Профиль маски: сверху узкий лоб, широкая скуловая часть, сужение к клюву. */
const MASK_PROFILE = resample(
  [
    [1.02, 0.06],
    [0.92, 0.34],
    [0.72, 0.56],
    [0.46, 0.70],
    [0.16, 0.76],
    [-0.14, 0.74],
    [-0.42, 0.62],
    [-0.66, 0.42],
    [-0.84, 0.22],
    [-0.95, 0.07],
  ],
  9
);

/** Полуширина маски (в долготе) на заданной широте. */
function maskHalfLon(lat) {
  const P = MASK_PROFILE;
  if (lat >= P[0][0] || lat <= P[P.length - 1][0]) return 0;
  for (let i = 0; i < P.length - 1; i++) {
    if (lat <= P[i][0] && lat >= P[i + 1][0]) {
      const t = (P[i][0] - lat) / (P[i][0] - P[i + 1][0] || 1);
      return lerp(P[i][1], P[i + 1][1], t);
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Постоянная «анатомия» — считается один раз                          */
/* ------------------------------------------------------------------ */

const rnd = mulberry32(20260211);

/** Перья корпуса: длинные, растрёпанные, по всему объёму тела. */
const BODY_PLUMES = (() => {
  const out = [];
  for (let i = 0; i < 460; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd());
    const ex = Math.cos(a) * BODY.rx * rr;
    const ey = Math.sin(a) * BODY.ry * rr;
    const bx = BODY.x + ex;
    const by = BODY.y + ey;
    const edge = rr;
    // Перья свисают вниз и наружу
    const dir = Math.atan2(ey * 1.15 + BODY.ry * 0.55, ex) + (rnd() - 0.5) * 0.5;
    const len = lerp(40, 128, rnd() * rnd() + edge * 0.4);
    out.push({
      bx,
      by,
      tx: bx + Math.cos(dir) * len,
      ty: by + Math.sin(dir) * len,
      w: lerp(7, 20, rnd()),
      bend: (rnd() - 0.5) * 26,
      edge,
      depth: rnd(),
    });
  }
  out.sort((p, q) => p.edge - q.edge);
  return out;
})();

/** Тонкие волоски по силуэту тела. */
const BODY_HAIRS = (() => {
  const out = [];
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const bx = BODY.x + Math.cos(a) * BODY.rx * 0.94;
    const by = BODY.y + Math.sin(a) * BODY.ry * 0.94;
    const dir = a + (rnd() - 0.5) * 0.8;
    const len = lerp(26, 96, rnd() * rnd());
    out.push({
      bx,
      by,
      tx: bx + Math.cos(dir) * len,
      ty: by + Math.sin(dir) * len,
      bend: (rnd() - 0.5) * 34,
      op: lerp(0.18, 0.6, rnd()),
      wRight: Math.cos(a) > 0.15,
    });
  }
  return out;
})();

/** Перья головы — в локальных сферических координатах, поэтому вращаются вместе с головой. */
const HEAD_PLUMES = (() => {
  const out = [];
  for (let i = 0; i < 520; i++) {
    const lon = (rnd() - 0.5) * Math.PI * 2;
    const lat = Math.asin(rnd() * 2 - 1) * 0.98;
    // Лицевая зона остаётся открытой — там маска
    const edgeOfMask = Math.abs(lon) - maskHalfLon(lat);
    if (edgeOfMask < 0.05) continue;
    // у самой кромки маски — только мелкий пух, чтобы не «откусывать» лицо
    const fringe = clamp(edgeOfMask / 0.34, 0.24, 1);
    const up = clamp((lat + 0.4) / 1.6, 0, 1);
    out.push({
      lon,
      lat,
      len: lerp(34, 122, rnd() * rnd() + up * 0.35) * fringe,
      w: lerp(8, 21, rnd()) * (0.45 + 0.55 * fringe),
      bend: (rnd() - 0.5) * 22,
      out: lerp(1.0, 1.14, rnd()),
      rise: lerp(-0.1, 0.75, rnd() * rnd() + up * 0.4),
      shade: rnd(),
    });
  }
  return out;
})();

/** Торчащие волоски на макушке. */
const HEAD_HAIRS = (() => {
  const out = [];
  for (let i = 0; i < 150; i++) {
    const lon = (rnd() - 0.5) * 3.0;
    const lat = lerp(0.98, 1.56, rnd() * rnd());
    out.push({
      lon,
      lat,
      len: lerp(54, 176, rnd() * rnd()),
      bend: (rnd() - 0.5) * 40,
      rise: lerp(0.55, 1.1, rnd()),
      op: lerp(0.3, 0.85, rnd()),
    });
  }
  return out;
})();

/** Амулеты на шнурке. */
const CHARMS = [
  { t: 0.1, kind: 'bell', s: 1.0 },
  { t: 0.22, kind: 'vial', s: 0.95 },
  { t: 0.33, kind: 'rune', s: 0.9 },
  { t: 0.45, kind: 'bell', s: 1.16 },
  { t: 0.56, kind: 'bead', s: 1.0 },
  { t: 0.67, kind: 'vial', s: 1.08 },
  { t: 0.79, kind: 'bell', s: 0.92 },
  { t: 0.9, kind: 'rune', s: 1.0 },
];

/* ------------------------------------------------------------------ */
/* Рендер частей                                                       */
/* ------------------------------------------------------------------ */

function renderBody() {
  let back = '';
  let front = '';

  for (const p of BODY_PLUMES) {
    const lit = (p.bx - BODY.x) / BODY.rx;
    const light = clamp((lit + 0.35) / 1.2, 0, 1);
    const fill = p.edge > 0.72 ? C.featherEdge : p.edge > 0.4 ? C.featherMid : C.featherCore;
    const op = lerp(0.55, 1, p.depth);
    const d = feather(p.bx, p.by, p.tx, p.ty, p.w, p.bend);
    const el = `<path d="${d}" fill="${fill}" opacity="${n(op)}"/>`;
    if (p.edge > 0.62) front += el;
    else back += el;
    if (light > 0.55 && p.edge > 0.45) {
      front += `<path d="${d}" fill="${C.rimSoft}" opacity="${n((light - 0.55) * 0.65)}"/>`;
    }
  }

  let hairs = '';
  for (const h of BODY_HAIRS) {
    const col = h.wRight ? C.rimSoft : C.featherEdge;
    hairs += `<path d="${hair(h.bx, h.by, h.tx, h.ty, h.bend)}" fill="none" stroke="${col}" stroke-width="${n(
      lerp(1, 2.4, h.op)
    )}" stroke-linecap="round" opacity="${n(h.op * (h.wRight ? 0.5 : 1))}"/>`;
  }

  return `
  <g id="body">
    ${hairs}
    <ellipse cx="${BODY.x}" cy="${BODY.y}" rx="${BODY.rx}" ry="${BODY.ry}" fill="url(#bodyGrad)" filter="url(#soft)"/>
    ${back}
    ${front}
    <ellipse cx="${BODY.x + 132}" cy="${BODY.y - 46}" rx="150" ry="210" fill="url(#bodyRim)" opacity="0.55"/>
    <ellipse cx="${BODY.x - 118}" cy="${BODY.y + 26}" rx="190" ry="240" fill="url(#bodyShade)" opacity="0.85"/>
  </g>`;
}

function renderFeet() {
  const y = BODY.y + BODY.ry - 4;
  const foot = (cx, flip) => {
    const s = flip ? -1 : 1;
    return `
    <g transform="translate(${n(cx)} ${n(y)})">
      <path d="M0 0 L${n(-3 * s)} 52" stroke="#1b2624" stroke-width="14" stroke-linecap="round" fill="none"/>
      <path d="M${n(-3 * s)} 52 L${n(-30 * s)} 66" stroke="#1b2624" stroke-width="9" stroke-linecap="round" fill="none"/>
      <path d="M${n(-3 * s)} 52 L${n(6 * s)} 70" stroke="#1b2624" stroke-width="9" stroke-linecap="round" fill="none"/>
      <path d="M${n(-3 * s)} 52 L${n(34 * s)} 62" stroke="#1b2624" stroke-width="8" stroke-linecap="round" fill="none"/>
      <path d="M${n(-3 * s)} 52 L${n(-30 * s)} 66" stroke="${C.rim}" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.4"/>
    </g>`;
  };
  return `<g id="feet" opacity="0.95">${foot(BODY.x - 66, false)}${foot(BODY.x + 74, true)}</g>`;
}

function renderCord() {
  const drift = 0;
  const x0 = BODY.x - 168 + drift * 0.4;
  const x1 = BODY.x + 172 + drift * 0.4;
  const y0 = BODY.y - 150;
  const sag = BODY.y - 24;
  const cx = (x0 + x1) / 2 + drift;

  const at = (t) => {
    const mt = 1 - t;
    return {
      x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
      y: mt * mt * y0 + 2 * mt * t * sag + t * t * y0,
    };
  };

  let charms = '';
  for (const c of CHARMS) {
    const p = at(c.t);
    const tilt = (c.t - 0.5) * 26 + drift * 0.25;
    const g = (inner) =>
      `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n(tilt)}) scale(${n(c.s)})">${inner}</g>`;
    if (c.kind === 'bell') {
      charms += g(
        `<path d="M0 2 L0 9" stroke="${C.brassDark}" stroke-width="2"/>` +
          `<path d="M-11 26 C-11 12 -7 9 0 9 C7 9 11 12 11 26 Z" fill="url(#brassGrad)"/>` +
          `<rect x="-12.5" y="25" width="25" height="4.5" rx="2" fill="${C.brassDark}"/>` +
          `<circle cx="0" cy="32" r="3.4" fill="${C.brass}" opacity="0.9"/>` +
          `<path d="M-6 14 C-6 12 -3 11 -1 11" stroke="#f3e2b4" stroke-width="1.6" fill="none" opacity="0.75"/>`
      );
    } else if (c.kind === 'vial') {
      charms += g(
        `<rect x="-6" y="10" width="12" height="7" rx="2" fill="#6b5535"/>` +
          `<path d="M-8 17 L8 17 L10 34 C10 39 -10 39 -10 34 Z" fill="url(#glassGrad)" opacity="0.92"/>` +
          `<path d="M-5 22 L-5 33" stroke="#d8fff2" stroke-width="1.8" opacity="0.55"/>` +
          `<path d="M-8 29 L10 29 L10 34 C10 39 -10 39 -10 34 Z" fill="#2e6c60" opacity="0.75"/>`
      );
    } else if (c.kind === 'rune') {
      charms += g(
        `<path d="M0 8 L11 22 L0 38 L-11 22 Z" fill="url(#brassGrad)" opacity="0.95"/>` +
          `<path d="M0 16 L0 30 M-5 22 L5 22" stroke="#2a2115" stroke-width="1.8" opacity="0.8"/>`
      );
    } else {
      charms += g(
        `<circle cx="0" cy="18" r="8.5" fill="#3d4a46"/>` +
          `<circle cx="-3" cy="15" r="2.6" fill="#9fd8c8" opacity="0.6"/>`
      );
    }
  }

  return `
  <g id="cord">
    <path d="M${n(x0)} ${n(y0)} Q${n(cx)} ${n(sag)} ${n(x1)} ${n(y0)}" fill="none" stroke="${C.cord}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M${n(x0)} ${n(y0)} Q${n(cx)} ${n(sag)} ${n(x1)} ${n(y0)}" fill="none" stroke="#6d6252" stroke-width="1" opacity="0.5"/>
    ${charms}
  </g>`;
}

function renderHead(yaw) {
  const R = HEAD.r;
  const dx = Math.sin(yaw) * 15;
  const dy = -Math.abs(Math.sin(yaw)) * 6;
  const roll = Math.sin(yaw) * 4;

  /* --- перья головы: задний и передний слой --- */
  let back = '';
  let front = '';
  for (const p of HEAD_PLUMES) {
    const b = sph(p.lon, p.lat, R * 0.96, yaw);
    const o = sph(p.lon, p.lat, R * p.out, yaw);
    const ux = o.x - b.x;
    const uy = o.y - b.y;
    const ul = Math.hypot(ux, uy) || 1;
    const scale = 0.55 + 0.45 * clamp((b.z / R + 1) / 2, 0, 1);
    const tx = b.x + (ux / ul) * p.len * scale;
    const ty = b.y + (uy / ul) * p.len * scale - p.rise * p.len * 0.45;
    const d = feather(b.x, b.y, tx, ty, p.w * (0.6 + 0.4 * scale), p.bend);
    const lit = clamp((b.x - HEAD.x) / R, -1, 1);
    const fill = p.shade > 0.72 ? C.featherEdge : p.shade > 0.35 ? C.featherMid : C.featherCore;
    if (b.z >= 0) {
      front += `<path d="${d}" fill="${fill}" opacity="${n(lerp(0.75, 1, p.shade))}"/>`;
      if (lit > 0.5) front += `<path d="${d}" fill="${C.rimSoft}" opacity="${n((lit - 0.5) * 0.45)}"/>`;
    } else {
      back += `<path d="${d}" fill="${C.featherCore}" opacity="0.95"/>`;
      if (lit > 0.55) back += `<path d="${d}" fill="${C.rimSoft}" opacity="${n((lit - 0.55) * 0.5)}"/>`;
    }
  }

  let hairs = '';
  for (const h of HEAD_HAIRS) {
    const b = sph(h.lon, h.lat, R * 0.98, yaw);
    const o = sph(h.lon, h.lat, R * 1.1, yaw);
    const ux = o.x - b.x;
    const uy = o.y - b.y;
    const ul = Math.hypot(ux, uy) || 1;
    const tx = b.x + (ux / ul) * h.len * 0.5;
    const ty = b.y + (uy / ul) * h.len * 0.5 - h.rise * h.len;
    const lit = clamp((b.x - HEAD.x) / R, -1, 1);
    const col = lit > 0.62 ? C.rimSoft : C.featherEdge;
    hairs += `<path d="${hair(b.x, b.y, tx, ty, h.bend)}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round" opacity="${n(
      h.op * (lit > 0.62 ? 0.55 : 1)
    )}"/>`;
  }

  /* --- маска: «шапочка» на сфере, честно сокращается при повороте --- */
  const right = MASK_PROFILE.map(([lat, hl]) => sph(hl, lat, R * 1.015, yaw));
  const left = MASK_PROFILE.map(([lat, hl]) => sph(-hl, lat, R * 1.015, yaw)).reverse();
  const maskPath =
    'M' + [...right, ...left].map((p) => `${n(p.x)} ${n(p.y)}`).join('L') + 'Z';

  /* --- клюв: узкий, растёт из нижней части маски вперёд и вниз --- */
  const beakBaseL = sph(-0.17, -0.44, R * 1.02, yaw);
  const beakBaseR = sph(0.17, -0.44, R * 1.02, yaw);
  const beakTop = sph(0, -0.34, R * 1.05, yaw);
  const tip = sph(0, -1.3, R * 1.5, yaw);
  const midL = sph(-0.115, -0.9, R * 1.24, yaw);
  const midR = sph(0.115, -0.9, R * 1.24, yaw);
  const beakPath =
    `M${n(beakBaseL.x)} ${n(beakBaseL.y)}` +
    `Q${n(midL.x)} ${n(midL.y)} ${n(tip.x)} ${n(tip.y)}` +
    `Q${n(midR.x)} ${n(midR.y)} ${n(beakBaseR.x)} ${n(beakBaseR.y)}` +
    `Q${n(beakTop.x)} ${n(beakTop.y)} ${n(beakBaseL.x)} ${n(beakBaseL.y)}Z`;
  const ridge =
    `M${n(beakTop.x)} ${n(beakTop.y)}Q${n(lerp(beakTop.x, tip.x, 0.55))} ${n(
      lerp(beakTop.y, tip.y, 0.5)
    )} ${n(tip.x)} ${n(tip.y)}`;

  /* --- ноздря --- */
  const nostril = sph(0.02, -0.5, R * 1.06, yaw);

  /* --- глаза: крупные глянцевые сферы --- */
  const eyeR = R * 0.265;
  const eyes = [-0.44, 0.44]
    .map((lon) => {
      const p = sph(lon, 0.2, R * 0.99, yaw);
      const depth = clamp(p.z / R, 0, 1);
      const r = eyeR * (0.82 + 0.18 * depth);
      const sq = 0.72 + 0.28 * depth; // перспективное сжатие у края
      return `
      <g transform="translate(${n(p.x)} ${n(p.y)})">
        <ellipse rx="${n(r * sq + 4)}" ry="${n(r + 4)}" fill="#0a0f0d" opacity="0.55"/>
        <ellipse rx="${n(r * sq)}" ry="${n(r)}" fill="url(#eyeGrad)"/>
        <ellipse cx="${n(-r * sq * 0.32)}" cy="${n(-r * 0.38)}" rx="${n(r * sq * 0.26)}" ry="${n(
        r * 0.2
      )}" fill="#ffffff" opacity="0.88" transform="rotate(-20)"/>
        <circle cx="${n(r * sq * 0.3)}" cy="${n(-r * 0.52)}" r="${n(r * 0.085)}" fill="#ffffff" opacity="0.7"/>
        <ellipse cx="${n(r * sq * 0.3)}" cy="${n(r * 0.5)}" rx="${n(r * sq * 0.32)}" ry="${n(
        r * 0.18
      )}" fill="${C.rim}" opacity="0.2" transform="rotate(12)"/>
      </g>`;
    })
    .join('');

  return `
  <g id="head" transform="translate(${n(dx)} ${n(dy)}) rotate(${n(roll)} ${HEAD.x} ${HEAD.y})">
    <clipPath id="maskClip"><path d="${maskPath}"/></clipPath>
    ${back}
    <circle cx="${HEAD.x}" cy="${HEAD.y}" r="${n(R * 1.01)}" fill="url(#headGrad)" filter="url(#soft)"/>
    <path d="${maskPath}" fill="url(#maskGrad)"/>
    <g clip-path="url(#maskClip)">
      <path d="${maskPath}" fill="none" stroke="#3b3a33" stroke-width="26" opacity="0.5" filter="url(#soft)"/>
      <ellipse cx="${n(HEAD.x + Math.sin(yaw) * R * 0.5)}" cy="${n(HEAD.y - R * 0.1)}" rx="${n(
    R * 0.5
  )}" ry="${n(R * 0.62)}" fill="#fffaf0" opacity="0.16" filter="url(#soft)"/>
    </g>
    <path d="${beakPath}" fill="url(#beakGrad)"/>
    <path d="${ridge}" fill="none" stroke="${C.beakShade}" stroke-width="1.4" opacity="0.65"/>
    <path d="${`M${n(lerp(midL.x, tip.x, 0.45))} ${n(lerp(midL.y, tip.y, 0.45))}L${n(tip.x)} ${n(
      tip.y
    )}L${n(lerp(midR.x, tip.x, 0.45))} ${n(lerp(midR.y, tip.y, 0.45))}Z`}" fill="#4c4638" opacity="0.6"/>
    <circle cx="${n(nostril.x)}" cy="${n(nostril.y)}" r="2.4" fill="#5b5648" opacity="0.85"/>
    ${eyes}
    ${front}
    ${hairs}
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Кадры                                                               */
/* ------------------------------------------------------------------ */

/** Область кадра головы внутри общей системы координат персонажа. */
export const HEAD_BOX = { x: 125, y: 0, w: 650, h: 690 };

const DEFS = `
  <defs>
    <radialGradient id="bodyGrad" cx="0.66" cy="0.32" r="0.85">
      <stop offset="0" stop-color="#16211f"/>
      <stop offset="0.55" stop-color="#0a1211"/>
      <stop offset="1" stop-color="#030605"/>
    </radialGradient>
    <radialGradient id="bodyRim" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.rimSoft}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${C.rimSoft}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="headGrad" cx="0.68" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#18241f"/>
      <stop offset="0.6" stop-color="#0a1211"/>
      <stop offset="1" stop-color="#030605"/>
    </radialGradient>
    <linearGradient id="maskGrad" x1="0" y1="0" x2="1" y2="0.25">
      <stop offset="0" stop-color="${C.maskShade}"/>
      <stop offset="0.45" stop-color="${C.maskMid}"/>
      <stop offset="1" stop-color="${C.maskLit}"/>
    </linearGradient>
    <linearGradient id="beakGrad" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="${C.beakShade}"/>
      <stop offset="0.55" stop-color="${C.beak}"/>
      <stop offset="1" stop-color="${C.maskLit}"/>
    </linearGradient>
    <radialGradient id="eyeGrad" cx="0.36" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#1d2a2c"/>
      <stop offset="0.45" stop-color="${C.eye}"/>
      <stop offset="1" stop-color="#000000"/>
    </radialGradient>
    <linearGradient id="brassGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0d79a"/>
      <stop offset="0.5" stop-color="${C.brass}"/>
      <stop offset="1" stop-color="${C.brassDark}"/>
    </linearGradient>
    <linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a8ede0"/>
      <stop offset="1" stop-color="${C.glass}"/>
    </linearGradient>
    <radialGradient id="bodyShade" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000000" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
    <clipPath id="headClip">
      <circle cx="${HEAD.x}" cy="${HEAD.y}" r="${n(HEAD.r * 1.04)}"/>
    </clipPath>
  </defs>
`;

function svg(width, height, viewBox, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">
${DEFS}
${body}
</svg>`;
}

/** Неподвижный слой: лапы, корпус, оперение, шнурок с амулетами. */
export function buildBaseSVG() {
  return svg(
    FRAME_W,
    FRAME_H,
    `0 0 ${FRAME_W} ${FRAME_H}`,
    `<g id="creature-base">${renderFeet()}${renderBody()}${renderCord()}</g>`
  );
}

/**
 * Кадр головы.
 * @param {number} t — от -1 (смотрит влево) до 1 (смотрит вправо), 0 — прямо на зрителя.
 */
export function buildHeadSVG(t) {
  const yaw = clamp(t, -1, 1) * YAW_MAX;
  return svg(
    HEAD_BOX.w,
    HEAD_BOX.h,
    `${HEAD_BOX.x} ${HEAD_BOX.y} ${HEAD_BOX.w} ${HEAD_BOX.h}`,
    renderHead(yaw)
  );
}

/** Полный кадр целиком — используется для превью и постера. */
export function buildSVG(t) {
  const yaw = clamp(t, -1, 1) * YAW_MAX;
  return svg(
    FRAME_W,
    FRAME_H,
    `0 0 ${FRAME_W} ${FRAME_H}`,
    `<g id="creature">${renderFeet()}${renderBody()}${renderCord()}${renderHead(yaw)}</g>`
  );
}

export { YAW_MAX };
