#!/usr/bin/env node
// Local-only: never uploads archive media or changes the input files.
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const source = resolve(process.argv[2] ?? '.convex/local/default/convex_local_storage/files');
const output = resolve(process.argv[3] ?? '.convex/preview-benchmark');
await mkdir(output, { recursive: true });
sharp.concurrency(1);
const candidates = [];
for (const name of (await readdir(source)).sort()) {
  const path = join(source, name);
  const info = await stat(path);
  if (!info.isFile() || info.size < 100_000 || info.size > 25 * 1024 * 1024) continue;
  try {
    const m = await sharp(path, { limitInputPixels: 80_000_000 }).metadata();
    // Avoid recompressing existing WebP derivatives for the comparison.
    if (['jpeg', 'png'].includes(m.format) && Math.max(m.width, m.height) >= 1000)
      candidates.push({ path, bytes: info.size, width: m.width, height: m.height, format: m.format });
  } catch { /* Unsupported files are not benchmark inputs. */ }
  if (candidates.length >= 120) break;
}
candidates.sort((a, b) => a.bytes - b.bytes);
const samples = Array.from({ length: Math.min(12, candidates.length) }, (_, i) =>
  candidates[Math.round(i * (candidates.length - 1) / Math.max(1, Math.min(12, candidates.length) - 1))]);
if (!samples.length) throw new Error('No suitable JPEG/PNG input samples.');
const recipes = [
  { name: 'current-preview', size: 1600, format: 'webp', quality: 82 },
  { name: 'compact-preview', size: 1600, format: 'webp', quality: 68 },
  { name: 'avif-preview', size: 1600, format: 'avif', quality: 55 },
  { name: 'current-thumb', size: 384, format: 'webp', quality: 76 },
  { name: 'compact-thumb', size: 384, format: 'webp', quality: 62 },
  { name: 'avif-thumb', size: 384, format: 'avif', quality: 50 },
];
const results = [];
for (const [index, input] of samples.entries()) {
  const original = await readFile(input.path);
  const row = { sample: index + 1, ...input, variants: [] };
  for (const recipe of recipes) {
    const started = performance.now();
    const pipeline = sharp(original).rotate().resize({ width: recipe.size, height: recipe.size, fit: 'inside', withoutEnlargement: true });
    const encoded = await (recipe.format === 'avif'
      ? pipeline.avif({ quality: recipe.quality, effort: 4, chromaSubsampling: '4:4:4' })
      : pipeline.webp({ quality: recipe.quality, effort: 4, smartSubsample: true })).toBuffer();
    const ms = performance.now() - started;
    const file = `${index + 1}-${recipe.name}.${recipe.format}`;
    await writeFile(join(output, file), encoded);
    row.variants.push({ ...recipe, file, bytes: encoded.length, ms: Math.round(ms) });
  }
  results.push(row);
  console.log(`Sample ${index + 1}/${samples.length} encoded`);
}
const totals = recipes.map(r => {
  const variants = results.map(s => s.variants.find(v => v.name === r.name));
  return { name: r.name, bytes: variants.reduce((n, v) => n + v.bytes, 0), encodeMs: variants.reduce((n, v) => n + v.ms, 0) };
});
await writeFile(join(output, 'results.json'), JSON.stringify({ samplePool: candidates.length, results, totals }, null, 2));
await writeFile(join(output, 'compare.html'), `<!doctype html><meta charset="utf-8"><title>Local preview comparison</title><style>body{background:#222;color:white;font:16px system-ui}section{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}img{max-width:100%;background:#ddd}figure{margin:0 0 30px}small{display:block}</style><h1>Local preview comparison</h1><p>Columns: existing WebP, compact WebP, AVIF. Click images for full size.</p>${results.map(r => `<h2>Sample ${r.sample}: ${r.width} × ${r.height}, ${Math.round(r.bytes/1024)} KiB input</h2><section>${r.variants.map(v => `<figure><a href="${v.file}"><img src="${v.file}"></a><figcaption>${v.name}<small>${(v.bytes/1024).toFixed(1)} KiB; ${v.ms} ms encode</small></figcaption></figure>`).join('')}</section>`).join('')}`);
console.log(JSON.stringify(totals));
