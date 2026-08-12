/**
 * Сборка проекта: генерация кадров и проверка целостности.
 * node tools/build.mjs [--skip-frames]
 */
import { spawnSync } from 'node:child_process';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

const skipFrames = process.argv.includes('--skip-frames');
const FRAMES = path.resolve('public/experience/frames');
const fail = [];

if (!skipFrames) {
  const r = spawnSync(process.execPath, ['tools/generate-frames.mjs'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('  ошибка генерации кадров');
    process.exit(1);
  }
}

for (const f of ['index.html', 'styles.css', 'main.js']) {
  try {
    await stat(f);
  } catch {
    fail.push(`нет файла ${f}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(await readFile(path.join(FRAMES, 'manifest.json'), 'utf8'));
} catch (e) {
  fail.push('manifest.json не читается: ' + e.message);
}

if (manifest) {
  const files = new Set(await readdir(FRAMES));
  for (const name of [manifest.base, manifest.poster]) {
    if (!files.has(name)) fail.push(`нет ${name}`);
  }
  let missing = 0;
  for (let i = 0; i < manifest.count; i++) {
    if (!files.has(`frame_${String(i).padStart(3, '0')}.webp`)) missing++;
  }
  if (missing) fail.push(`не хватает кадров: ${missing}`);
}

// синтаксис клиентского модуля
const syn = spawnSync(process.execPath, ['--check', 'main.js'], { encoding: 'utf8' });
if (syn.status !== 0) fail.push('main.js: синтаксическая ошибка\n' + syn.stderr);

const html = await readFile('index.html', 'utf8');
for (const ref of ['styles.css', 'main.js', 'public/experience/frames/base.webp']) {
  if (!html.includes(ref)) fail.push(`index.html не ссылается на ${ref}`);
}

if (fail.length) {
  console.error('\n  СБОРКА НЕ ПРОШЛА:');
  for (const f of fail) console.error('   • ' + f);
  process.exit(1);
}

console.log(
  `\n  сборка в порядке — ${manifest.count} кадров, ` +
    `сцена ${manifest.stage.width}×${manifest.stage.height}`
);
