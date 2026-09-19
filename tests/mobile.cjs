// スマホ相当(390×844、タッチ有効)での保存と長押しの確認。
// 共有 API はスタブにして、呼ばれ方(ファイル・title の有無)と、拒否されたときにダイアログへ回るかを見る。
// 実機の iPhone の共有メニューや長押しジェスチャーそのものは再現できない。
'use strict';
const H = require('./harness.cjs');

const STUB = () => {
  window.__share = { mode: 'ok', calls: [] };
  const share = async data => {
    const f = data && data.files && data.files[0];
    window.__share.calls.push({ n: data.files.length, name: f && f.name, type: f && f.type, title: 'title' in data, text: 'text' in data });
    if (window.__share.mode === 'ok') return;
    throw new DOMException('stub', window.__share.mode === 'abort' ? 'AbortError' : 'NotAllowedError');
  };
  Object.defineProperty(Navigator.prototype, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(Navigator.prototype, 'canShare', { value: d => !!(d && d.files && d.files.length), configurable: true, writable: true });
};

(async () => {
  const { page, errors, close } = await H.open('index.html', {
    viewport: { width: 390, height: 844 },
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    initScript: STUB,
  });
  let ok = true;
  const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };
  const cdp = await page.context().newCDPSession(page);
  const center = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  const pixelSum = () => page.evaluate(() => { const d = window.__cf.readPixels(0, 0, 1440, 960); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s; });
  try {
    check(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'タッチ端末として判定される (pointer: coarse)');

    // 1. 長押し: ボタンと写真の両方。1.5 秒押し続けても元の写真のまま、離すと戻る
    const base = await pixelSum();
    for (const sel of ['#hold', '#frame']) {
      const p = await center(sel);
      await touch('touchStart', p);
      await page.waitForTimeout(1500);
      const during = await page.evaluate(() => ({ holding: window.__cf.holding(), mark: document.getElementById('frame').classList.contains('holding') }));
      const sumDuring = await pixelSum();
      await touch('touchEnd');
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => window.__cf.holding());
      const sumAfter = await pixelSum();
      check(during.holding && during.mark && sumDuring < base * 0.97, `${sel} 長押し 1.5 秒: 元の写真を表示中 (目印 ${during.mark}, 明るさ合計 ${(sumDuring / base * 100).toFixed(1)}%)`);
      check(!after && Math.abs(sumAfter - base) / base < 0.001, `${sel} 指を離すと加工後に戻る`);
    }

    // 2. 保存: 共有メニューが直接開く(ダイアログは出ない)。ファイルは JPEG 1 枚、title なし
    await page.tap('#save');
    await page.waitForFunction(() => window.__share.calls.length === 1 && !document.getElementById('save').disabled, null, { timeout: 120000 });
    const c1 = await page.evaluate(() => ({ call: window.__share.calls[0], dialog: document.getElementById('result').open, status: document.getElementById('status').textContent }));
    check(!c1.dialog && c1.call.n === 1 && c1.call.type === 'image/jpeg' && /_cross4\.jpg$/.test(c1.call.name) && !c1.call.title && !c1.call.text,
      `「保存する」で共有メニューが直接開く (${JSON.stringify(c1.call)}, ダイアログ ${c1.dialog}, "${c1.status}")`);

    // 3. 共有が拒否されたとき(書き出しに時間がかかり操作の有効期限が切れた想定): ダイアログの「写真に保存」から開き直せる
    await page.evaluate(() => { window.__share.mode = 'notallowed'; });
    await page.tap('#save');
    await page.waitForSelector('dialog[open]', { timeout: 120000 });
    const d = await page.evaluate(() => {
      const S = document.getElementById('resShare'), L = document.getElementById('resLink'), acts = [...document.getElementById('resActions').children];
      return { share: S.textContent, sharePrimary: S.classList.contains('primary'), shareLast: acts[acts.length - 1] === S, link: L.textContent, hint: !document.getElementById('resHint').hidden };
    });
    check(d.share === '写真に保存' && d.sharePrimary && d.shareLast && d.link === 'ファイルに保存' && d.hint, `拒否時はダイアログ: 主ボタン「${d.share}」、副「${d.link}」、説明あり`);
    H.savePng(await page.screenshot().then(b => 'data:image/png;base64,' + b.toString('base64')), 'mobile_dialog.png');
    await page.evaluate(() => { window.__share.mode = 'ok'; });
    await page.tap('#resShare');
    await page.waitForFunction(() => !document.getElementById('result').open, null, { timeout: 10000 });
    check(await page.evaluate(() => window.__share.calls.length === 3), '「写真に保存」で共有メニューが開き、ダイアログが閉じる');

    // 4. 共有メニューを閉じた(キャンセル)ときはダイアログを出さない
    await page.evaluate(() => { window.__share.mode = 'abort'; });
    await page.tap('#save');
    await page.waitForFunction(() => window.__share.calls.length === 4 && !document.getElementById('save').disabled, null, { timeout: 120000 });
    const c4 = await page.evaluate(() => ({ dialog: document.getElementById('result').open, status: document.getElementById('status').textContent }));
    check(!c4.dialog && /やめました/.test(c4.status), `キャンセル時はダイアログなし ("${c4.status}")`);
    check(errors.length === 0, `コンソールエラー ${errors.length} 件 ${errors.join(' | ')}`);
  } finally { await close(); }
  console.log(ok ? '[mobile] PASS' : '[mobile] FAIL');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
