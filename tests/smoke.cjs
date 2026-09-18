// 条件1・6: 390×844 で開き、エラーなしに 初期表示 → 6000×4000 JPEG 読み込み → 書き出し。横スクロール無し、ヘッダー 1 行。
'use strict';
const H = require('./harness.cjs');

(async () => {
  const file = process.argv[2] || 'index.html';
  const { page, errors, close } = await H.open(file, { viewport: { width: 390, height: 844 } });
  let ok = true;
  const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };
  try {
    // 条件6: レイアウト
    const L = await page.evaluate(() => {
      const h1 = document.querySelector('.brand h1'), act = document.querySelector('.bar-actions');
      const hr = h1.getBoundingClientRect(), ar = act.getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, h1H: hr.height, h1Font: parseFloat(getComputedStyle(h1).fontSize),
        h1Top: hr.top, actTop: ar.top, actRight: ar.right, h1Right: hr.right, actLeft: ar.left };
    });
    check(L.sw <= 390, `横スクロール無し (scrollWidth=${L.sw})`);
    check(L.h1H < L.h1Font * 1.6, `見出しが折り返していない (h=${L.h1H.toFixed(1)}, font=${L.h1Font})`);
    check(Math.abs(L.h1Top - L.actTop) < 8 || (L.actTop < L.h1Top + L.h1H), `見出しとボタンが同じ行 (h1Top=${L.h1Top.toFixed(1)}, actTop=${L.actTop.toFixed(1)})`);
    check(L.actRight <= 390 && L.actLeft >= L.h1Right, `ボタンが画面内で見出しの右 (h1Right=${L.h1Right.toFixed(1)}, act=${L.actLeft.toFixed(1)}..${L.actRight.toFixed(1)})`);
    H.savePng(await page.screenshot({ fullPage: false }).then(b => 'data:image/png;base64,' + b.toString('base64')), 'smoke_390.png');

    // 条件1: 6000×4000 JPEG を読み込んで書き出す
    await H.loadSample(page, 6000, 4000, 'image/jpeg', 0.92);
    const st = await page.evaluate(() => document.getElementById('status').textContent);
    check(/6000×4000/.test(st), `読み込み表示 "${st}"`);
    const t0 = Date.now();
    const ex = await page.evaluate(() => window.__cf.export({ format: 'jpeg' }).then(r => ({ width: r.width, height: r.height, bytes: r.dataURL.length })));
    check(ex.width === 4899 && ex.height === 3266, `書き出し ${ex.width}×${ex.height} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${(ex.bytes * 0.75 / 1e6).toFixed(1)}MB)`);
    // 保存ダイアログ(共有ボタンは環境依存なので表示有無だけ記録)
    await page.click('#save');
    await page.waitForSelector('dialog[open]', { timeout: 120000 });
    const dlg = await page.evaluate(() => ({ share: !document.getElementById('resShare').hidden, link: document.getElementById('resLink').download }));
    check(/_cross4\.jpg$/.test(dlg.link), `保存ダイアログ (ファイル名 ${dlg.link}, 共有ボタン ${dlg.share ? '表示' : '非表示'})`);
    H.savePng(await page.screenshot().then(b => 'data:image/png;base64,' + b.toString('base64')), 'smoke_dialog.png');
    check(errors.length === 0, `コンソールエラー ${errors.length} 件 ${errors.join(' | ')}`);
  } finally { await close(); }
  console.log(ok ? '[smoke] PASS' : '[smoke] FAIL');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
