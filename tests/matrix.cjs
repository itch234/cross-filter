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
    // v1 以降: シャープさ 0/50/100(強さ 60・明るさ 80)。街灯周辺を拡大して並べる
    const hasSharp = await page.evaluate(() => 'sharp' in window.__cf.params());
    if (hasSharp) {
      const zoom = [];
      for (const sharp of [0, 50, 100]) {
        await page.evaluate(s => window.__cf.set({ gain: 60, thr: 80, sharp: s }), sharp);
        const d = await page.evaluate(() => {
          const v = document.getElementById('view'), c = document.createElement('canvas'); c.width = 720; c.height = 480;
          const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
          x.drawImage(v, Math.round(v.width * 0.5 + 640 * v.width / 1440) - 180, Math.round(v.height * 0.62 - 240 * v.width / 1440) - 120, 360, 240, 0, 0, 720, 480);
          return c.toDataURL('image/png');
        });
        zoom.push({ label: `シャープさ ${sharp}(2倍拡大)`, dataURL: d });
      }
      await page.evaluate(() => window.__cf.set({ sharp: 50 }));
      const out2 = H.savePng(await H.grid(page, zoom, 3, 720, 480), `matrix_sharp_${version}.png`);
      console.log(`[matrix] sharp: ${out2}`);
    }
    // v1.2 以降: 光学フィルター箱。なし / ミスト / ハレーション / アナモルフィック / 全部(クロスは強さ 60 のまま)
    const hasFx = await page.evaluate(() => 'mist' in window.__cf.params());
    if (hasFx) {
      const fx = [];
      const cases = [['フィルターなし(クロスのみ)', {}], ['ブラックミスト 40', { mist: 40 }], ['ハレーション 60', { hal: 60 }],
                     ['アナモルフィック 60', { ana: 60 }], ['3 つ重ねがけ', { mist: 40, hal: 60, ana: 60 }], ['ミスト 40・クロスなし', { mist: 40, gain: 0 }]];
      for (const [label, p] of cases) {
        await page.evaluate(p => window.__cf.set({ gain: 60, thr: 80, mist: 0, hal: 0, ana: 0, ...p }), p);
        fx.push({ label, dataURL: await page.evaluate(() => window.__cf.snapshot()) });
      }
      await page.evaluate(() => window.__cf.set({ gain: 60, mist: 0, hal: 0, ana: 0 }));
      const out3 = H.savePng(await H.grid(page, fx, 3, 720, 480), `matrix_fx_${version}.png`);
      console.log(`[matrix] fx: ${out3}`);
    }
    if (errors.length) { console.log('errors:', errors); process.exitCode = 1; }
  } finally { await close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
