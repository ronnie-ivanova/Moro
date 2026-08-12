/**
 * Генерация ассетов персонажа.
 *
 *   node tools/generate-frames.mjs [--count=240] [--scale=0.8] [--quality=62]
 *
 * Персонаж собирается из двух слоёв:
 *   base.webp        — неподвижный корпус, оперение, лапы и шнурок с амулетами;
 *   frame_NNN.webp   — только голова, N кадров поворота.
 *
 * Кадр 0 — голова повёрнута максимально влево, последний — максимально вправо,
 * центральный кадр — взгляд прямо на зрителя. Такое разделение экономит вес
 * (голова занимает меньшую площадь) и позволяет держать кадры крупнее.
 */
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  buildBaseSVG,
  buildHeadSVG,
  buildSVG,
  FRAME_W,
  FRAME_H,
  HEAD_BOX,
} from './creature.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const COUNT = Number(args.count ?? 240);
const SCALE = Number(args.scale ?? 0.8);
const QUALITY = Number(args.quality ?? 62);
const OUT_DIR = path.resolve('public/experience/frames');
const CONCURRENCY = 8;

const px = (v) => Math.round(v * SCALE);

/** Лёгкое размытие снимает «пиксельную крошку» с тонких перьев и сильно улучшает сжатие. */
function encode(svgString, w, h) {
  return sharp(Buffer.from(svgString), { density: 96 })
    .resize(w, h, { fit: 'fill' })
    .blur(0.7)
    .webp({ quality: QUALITY, alphaQuality: 55, effort: 6 })
    .toBuffer();
}

async function main() {
  if (existsSync(OUT_DIR)) {
    for (const f of await readdir(OUT_DIR)) await rm(path.join(OUT_DIR, f));
  }
  await mkdir(OUT_DIR, { recursive: true });

  const started = Date.now();
  let total = 0;

  const base = await encode(buildBaseSVG(), px(FRAME_W), px(FRAME_H));
  await writeFile(path.join(OUT_DIR, 'base.webp'), base);
  total += base.length;

  // Постер: полный кадр «смотрит прямо», показывается до загрузки секвенции.
  const poster = await encode(buildSVG(0), px(FRAME_W * 0.55), px(FRAME_H * 0.55));
  await writeFile(path.join(OUT_DIR, 'poster.webp'), poster);
  total += poster.length;

  let done = 0;
  const queue = Array.from({ length: COUNT }, (_, i) => i);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = queue.shift();
        if (i === undefined) return;
        const t = COUNT === 1 ? 0 : (i / (COUNT - 1)) * 2 - 1;
        const buf = await encode(buildHeadSVG(t), px(HEAD_BOX.w), px(HEAD_BOX.h));
        await writeFile(
          path.join(OUT_DIR, `frame_${String(i).padStart(3, '0')}.webp`),
          buf
        );
        total += buf.length;
        done++;
        if (done % 24 === 0 || done === COUNT) {
          process.stdout.write(`\r  кадров: ${done}/${COUNT}`);
        }
      }
    })
  );

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        count: COUNT,
        centerFrame: Math.floor((COUNT - 1) / 2),
        pattern: 'frame_%03d.webp',
        base: 'base.webp',
        poster: 'poster.webp',
        stage: { width: px(FRAME_W), height: px(FRAME_H) },
        head: {
          x: px(HEAD_BOX.x),
          y: px(HEAD_BOX.y),
          width: px(HEAD_BOX.w),
          height: px(HEAD_BOX.h),
        },
        generatedBy: 'tools/generate-frames.mjs',
      },
      null,
      2
    ) + '\n'
  );

  console.log(
    `\n  готово: ${COUNT} кадров + base + poster, ` +
      `${(total / 1024 / 1024).toFixed(2)} МБ, ` +
      `${((Date.now() - started) / 1000).toFixed(1)} с`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
