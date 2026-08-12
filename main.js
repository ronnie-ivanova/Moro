/* ==========================================================================
   CREATURE — Interactive Observation
   Секвенция кадров на canvas + слежение за курсором с инерцией.
   ========================================================================== */

const BASE_PATH = 'public/experience/frames/';

/** Запасные параметры на случай, если manifest.json недоступен (например, file://). */
const FALLBACK_MANIFEST = {
  count: 240,
  centerFrame: 119,
  base: 'base.webp',
  poster: 'poster.webp',
  stage: { width: 720, height: 880 },
  head: { x: 100, y: 0, width: 520, height: 552 },
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;

const dom = {
  body: document.body,
  boot: document.getElementById('boot'),
  bootPercent: document.getElementById('boot-percent'),
  bootBar: document.getElementById('boot-bar'),
  bootHint: document.getElementById('boot-hint'),
  cursor: document.getElementById('cursor'),
  canvas: document.getElementById('creature-canvas'),
  catch: document.getElementById('catch'),
};

const ctx = dom.canvas.getContext('2d', { alpha: true });

/* --------------------------------------------------------------------------
   Загрузка ассетов
   -------------------------------------------------------------------------- */

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function frameName(i) {
  return `frame_${String(i).padStart(3, '0')}.webp`;
}

async function readManifest() {
  try {
    const res = await fetch(BASE_PATH + 'manifest.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error(res.status);
    return { ...FALLBACK_MANIFEST, ...(await res.json()) };
  } catch {
    return FALLBACK_MANIFEST;
  }
}

const state = {
  manifest: FALLBACK_MANIFEST,
  base: null,
  frames: [],
  ready: false,
  /** нормализованное положение взгляда: -1 — влево, 1 — вправо */
  target: 0,
  current: 0,
  drawn: -1,
  /** «поймать взгляд» — существо смотрит прямо на зрителя */
  lockedUntil: 0,
  lastInput: performance.now(),
};

/** Ближайший уже загруженный кадр — секвенция догружается фоном. */
function nearestFrame(i) {
  const { frames } = state;
  if (frames[i]) return frames[i];
  for (let d = 1; d < frames.length; d++) {
    if (frames[i - d]) return frames[i - d];
    if (frames[i + d]) return frames[i + d];
  }
  return null;
}

/* --------------------------------------------------------------------------
   Отрисовка
   -------------------------------------------------------------------------- */

let canvasW = 0;
let canvasH = 0;

function resizeCanvas() {
  const rect = dom.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (w === canvasW && h === canvasH) return;
  canvasW = dom.canvas.width = w;
  canvasH = dom.canvas.height = h;
  state.drawn = -1;
}

function draw(index) {
  const { manifest, base } = state;
  if (!canvasW) return;
  const sx = canvasW / manifest.stage.width;
  const sy = canvasH / manifest.stage.height;

  ctx.clearRect(0, 0, canvasW, canvasH);
  if (base) ctx.drawImage(base, 0, 0, canvasW, canvasH);

  const head = nearestFrame(index);
  if (head) {
    ctx.drawImage(
      head,
      manifest.head.x * sx,
      manifest.head.y * sy,
      manifest.head.width * sx,
      manifest.head.height * sy
    );
  }
  state.drawn = index;
}

function frameIndexFor(t) {
  const count = state.manifest.count;
  const clamped = Math.max(-1, Math.min(1, t));
  return Math.round(((clamped + 1) / 2) * (count - 1));
}

/* --------------------------------------------------------------------------
   Цикл наблюдения
   -------------------------------------------------------------------------- */

function tick(now) {
  if (!state.ready) return;

  const locked = now < state.lockedUntil;
  const goal = locked ? 0 : state.target;
  // Захват взгляда — медленный и намеренный; обычное слежение — живое.
  const k = reduceMotion ? 1 : locked ? 0.05 : 0.11;
  state.current += (goal - state.current) * k;

  // Едва заметное «дыхание», когда пользователь замер: существо остаётся живым.
  let sway = 0;
  if (!reduceMotion && !locked && now - state.lastInput > 1400) {
    const age = Math.min((now - state.lastInput - 1400) / 2200, 1);
    sway = Math.sin(now / 2600) * 0.035 * age;
  }

  const index = frameIndexFor(state.current + sway);
  if (index !== state.drawn) draw(index);

  requestAnimationFrame(tick);
}

/* --------------------------------------------------------------------------
   Ввод
   -------------------------------------------------------------------------- */

function setTargetFromX(x) {
  state.target = (x / window.innerWidth) * 2 - 1;
  state.lastInput = performance.now();
}

function bindInput() {
  window.addEventListener(
    'pointermove',
    (e) => {
      setTargetFromX(e.clientX);
      if (finePointer) moveCursor(e.clientX, e.clientY);
    },
    { passive: true }
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches[0]) setTargetFromX(e.touches[0].clientX);
    },
    { passive: true }
  );

  window.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches[0]) setTargetFromX(e.touches[0].clientX);
    },
    { passive: true }
  );

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);

  dom.catch.addEventListener('click', () => {
    state.lockedUntil = performance.now() + (reduceMotion ? 300 : 2100);
    dom.catch.classList.add('is-busy');
    window.setTimeout(
      () => dom.catch.classList.remove('is-busy'),
      reduceMotion ? 300 : 2100
    );
  });
}

/* --------------------------------------------------------------------------
   Курсор
   -------------------------------------------------------------------------- */

const cursor = { x: 0, y: 0, rx: 0, ry: 0, started: false };

function moveCursor(x, y) {
  cursor.x = x;
  cursor.y = y;
  if (!cursor.started) {
    cursor.rx = x;
    cursor.ry = y;
    cursor.started = true;
    dom.cursor.classList.add('is-on');
    cursorLoop();
  }
}

function cursorLoop() {
  cursor.rx += (cursor.x - cursor.rx) * (reduceMotion ? 1 : 0.22);
  cursor.ry += (cursor.y - cursor.ry) * (reduceMotion ? 1 : 0.22);
  dom.cursor.style.transform = `translate3d(${cursor.rx}px, ${cursor.ry}px, 0)`;
  requestAnimationFrame(cursorLoop);
}

function bindCursor() {
  if (!finePointer || reduceMotion) return;
  const hot = document.querySelectorAll('button, a, [data-cursor]');
  hot.forEach((el) => {
    el.addEventListener('mouseenter', () => dom.cursor.classList.add('is-wide'));
    el.addEventListener('mouseleave', () => dom.cursor.classList.remove('is-wide'));
  });
  document.addEventListener('mouseleave', () => dom.cursor.classList.remove('is-on'));
  document.addEventListener('mouseenter', () => {
    if (cursor.started) dom.cursor.classList.add('is-on');
  });
}

/* --------------------------------------------------------------------------
   Старт
   -------------------------------------------------------------------------- */

function setProgress(p) {
  const v = Math.round(Math.max(0, Math.min(100, p)));
  dom.bootPercent.textContent = String(v);
  dom.bootBar.style.width = v + '%';
}

/** Приоритетная выборка: редкая сетка кадров, чтобы стать интерактивными быстро. */
function priorityIndices(count) {
  const step = 6;
  const set = new Set([0, count - 1, Math.floor((count - 1) / 2)]);
  for (let i = 0; i < count; i += step) set.add(i);
  return [...set].sort((a, b) => a - b);
}

async function loadRest(indices) {
  for (const i of indices) {
    if (state.frames[i]) continue;
    state.frames[i] = await loadImage(BASE_PATH + frameName(i));
    state.drawn = -1;
  }
  dom.bootHint.textContent = 'СЕКВЕНЦИЯ ЗАГРУЖЕНА';
}

async function boot() {
  const manifest = await readManifest();
  state.manifest = manifest;
  state.frames = new Array(manifest.count).fill(null);

  resizeCanvas();
  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(dom.canvas);
  }

  const priority = priorityIndices(manifest.count);
  const totalSteps = priority.length + 1;
  let done = 0;
  const step = () => setProgress((++done / totalSteps) * 100);

  state.base = await loadImage(BASE_PATH + manifest.base);
  step();
  dom.bootHint.textContent = 'ЗАГРУЗКА СЕКВЕНЦИИ';

  // Приоритетные кадры — по 6 параллельно, чтобы прогресс шёл ровно.
  const queue = [...priority];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const i = queue.shift();
        if (i === undefined) return;
        state.frames[i] = await loadImage(BASE_PATH + frameName(i));
        step();
      }
    })
  );

  setProgress(100);
  state.ready = true;
  state.current = 0;
  draw(frameIndexFor(0));

  await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 380));
  dom.boot.classList.add('is-done');
  dom.body.classList.remove('is-loading');
  dom.body.classList.add('is-ready');

  requestAnimationFrame(tick);

  // Остальные кадры догружаются фоном — слежение уже работает.
  const rest = [];
  for (let i = 0; i < manifest.count; i++) if (!state.frames[i]) rest.push(i);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(() => loadRest(rest));
}

bindInput();
bindCursor();
boot();
