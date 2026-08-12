/**
 * Быстрый превью-лист персонажа: пять ракурсов в один PNG.
 * node tools/preview.mjs [выходной-файл.png]
 */
import sharp from 'sharp';
import { buildSVG, FRAME_W, FRAME_H } from './creature.mjs';

const OUT = process.argv[2] || 'preview.png';
const TS = [-1, -0.5, 0, 0.5, 1];
const TILE = 360;
const H = Math.round((FRAME_H / FRAME_W) * TILE);

const tiles = [];
for (const t of TS) {
  tiles.push(await sharp(Buffer.from(buildSVG(t))).resize(TILE).png().toBuffer());
}

await sharp({
  create: { width: TILE * TS.length, height: H, channels: 4, background: '#08201d' },
})
  .composite(tiles.map((input, i) => ({ input, left: i * TILE, top: 0 })))
  .png()
  .toFile(OUT);

console.log('  превью: ' + OUT);
