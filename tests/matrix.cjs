// 条件3(画像): サンプル夜景で 強さ 30/60/90 × 光を拾う明るさ 60/80 の 6 枚を 2×3 に並べる。
// 使い方: node tests/matrix.cjs [index.html|legacy/cross-filter-v0.html]
'use strict';
const H = require('./harness.cjs');

(async () => {
  const file = process.argv[2] || 'index.html';
  const { page, errors, close } = await H.open(file);
  try {
    const version = await page.evaluate(() => window.__cf.version);
    const items = [];
    for (const thr of [60, 80]) for (const gain of [30, 60, 90]) {
      await page.evaluate(({ gain, thr }) => window.__cf.set({ gain, thr }), { gain, thr });
      items.push({ label: `強さ ${gain} / 明るさ ${thr}`, dataURL: await page.evaluate(() => window.__cf.snapshot()) });
    }
    const out = H.savePng(await H.grid(page, items, 3, 720, 480), `matrix_${version}.png`);
    console.log(`[matrix] ${version}: ${out}`);
    if (errors.length) { console.log('errors:', errors); process.exitCode = 1; }
  } finally { await close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
