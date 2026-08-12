import sharp from 'sharp';
import { buildSVG, FRAME_W, FRAME_H } from './creature.mjs';
const OUT = process.argv[2] || '/tmp/preview';
const ts = [-1, -0.5, 0, 0.5, 1];
const tiles = [];
for (const t of ts) {
  const buf = await sharp(Buffer.from(buildSVG(t))).png().toBuffer();
  tiles.push(await sharp(buf).resize(360).toBuffer());
}
const w = 360, h = Math.round(FRAME_H / FRAME_W * 360);
await sharp({ create: { width: w * ts.length, height: h, channels: 4, background: '#08201d' } })
  .composite(tiles.map((input, i) => ({ input, left: i * w, top: 0 })))
  .png().toFile(OUT + '.png');
console.log('ok', OUT + '.png');
