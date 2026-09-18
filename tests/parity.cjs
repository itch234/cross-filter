// 条件4・5: プレビュー(1440)と書き出しの一致、光源のない領域が元画像と一致。
'use strict';
const H = require('./harness.cjs');

(async () => {
  const file = process.argv[2] || 'index.html';
  const { page, errors, close } = await H.open(file);
  let ok = true;
  const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };
  try {
    await H.loadSample(page, 6000, 4000, 'image/png');
    await page.evaluate(() => window.__cf.set({ angle: 0, points: 4 }));   // 光条を水平にして軸上を測りやすくする
    const preview = await page.evaluate(() => window.__cf.snapshot());
    const ex = await page.evaluate(() => window.__cf.export({ format: 'png' }));
    check(ex.width === 4899 && ex.height === 3266, `書き出し ${ex.width}×${ex.height}`);

    // 条件4: 書き出しを 1440 に縮小し、右端の街灯(サンプル座標 x=0.5+640/1440·W, y≈horizon-270/1440·H)の周辺を比較
    const R = await page.evaluate(async ({ preview, exdata }) => {
      const load = async d => { const i = new Image(); i.src = d; await i.decode(); return i; };
      const pi = await load(preview), ei = await load(exdata);
      const W = pi.width, Hh = pi.height;
      const draw = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = Hh; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, Hh); return x; };
      const pc = draw(pi), ec = draw(ei);
      const srcC = window.__cf.sample(W, Hh), sc = srcC.getContext('2d');   // 同じ大きさの元画像。「足された光」= 出力 − 元画像
      // 街灯の位置: drawSample の i=8 側 +1: px = W*0.5 + (40+640)*S, py = horizon-(20+250)*S+30*S, S=W/1440
      const S = W / 1440, cx = Math.round(W * 0.5 + 680 * S), cy = Math.round(Hh * 0.62 - 270 * S + 30 * S);
      const row = (ctx, y) => ctx.getImageData(0, y, W, 1).data;
      const sr = row(sc, cy);
      const axis = (ctx, dir) => { const d = row(ctx, cy); const out = []; for (let r = 0; r < 700; r++) { const x = cx + dir * r; if (x < 0 || x >= W) break; const k = x * 4; out.push(Math.max(0, Math.max(d[k] - sr[k], d[k + 1] - sr[k + 1], d[k + 2] - sr[k + 2]))); } return out; };
      const cross = (a, t) => { for (let r = 6; r < a.length; r++) if (a[r] < t) return r; return a.length; };
      const stats = a => ({ vis: cross(a, 100), vis40: cross(a, 40), peak: Math.max(...a.slice(0, 40)), at: [10, 20, 40, 80].map(r => a[r]) });
      const pa = stats(axis(pc, -1)), ea = stats(axis(ec, -1));   // 左向きの光条
      srcC.width = srcC.height = 1;
      // 並べた画像(街灯周囲 200×200 を 3 倍)
      const c = document.createElement('canvas'); c.width = 1240; c.height = 640; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(pc.canvas, cx - 100, cy - 100, 200, 200, 10, 30, 600, 600);
      x.drawImage(ec.canvas, cx - 100, cy - 100, 200, 200, 630, 30, 600, 600);
      x.font = 'bold 20px sans-serif'; x.fillStyle = '#fff'; x.fillText('プレビュー 1440', 10, 22); x.fillText('書き出し → 1440 に縮小', 630, 22);
      return { pa, ea, side: c.toDataURL('image/png'), cx, cy };
    }, { preview, exdata: ex.dataURL });
    H.savePng(R.side, 'parity_side_by_side.png');
    const lenDiff = Math.abs(R.pa.vis - R.ea.vis) / Math.max(R.pa.vis, 1);
    check(lenDiff <= 0.1, `光条の長さ(足された光が 100/255 を下回る r) プレビュー ${R.pa.vis}px / 書き出し ${R.ea.vis}px (差 ${(lenDiff * 100).toFixed(1)}%)。参考: 40/255 では ${R.pa.vis40}px / ${R.ea.vis40}px(裾は傾きが浅く数値差 2/255 で数十 px 動く)`);
    const md = Math.max(...R.pa.at.map((v, i) => Math.abs(v - R.ea.at[i])));
    check(md <= 8, `足された光の断面 r=10,20,40,80: プレビュー [${R.pa.at}] / 書き出し [${R.ea.at}] (最大差 ${md})`);

    // 条件5: 光源のない 3 領域で、書き出し(PNG)と元画像(同サイズに rasterize)を比較。JPEG 0.95 も参考値
    const exj = await page.evaluate(() => window.__cf.export({ format: 'jpeg' }));
    const D = await page.evaluate(async ({ png, jpg }) => {
      const load = async d => { const i = new Image(); i.src = d; await i.decode(); return i; };
      const pi = await load(png), ji = await load(jpg);
      const W = pi.width, Hh = pi.height;
      const src = window.__cf.sample(6000, 4000);
      const draw = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = Hh; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, Hh); return x; };
      const sc = draw(src), pc = draw(pi), jc = draw(ji);
      src.width = src.height = 1;
      // 角度 0 なので光条は水平・垂直。街灯の真上(左端 x≈0.03W)は縦の光条の裾が届くので、上端は中央(街灯の間)を見る
      const regions = { '左下の路面': [Math.round(W * 0.04), Math.round(Hh * 0.9)], '右下の路面': [Math.round(W * 0.93), Math.round(Hh * 0.9)], '上端中央の空': [Math.round(W * 0.5) - 32, Math.round(Hh * 0.03)] };
      const out = {};
      for (const [name, [x0, y0]] of Object.entries(regions)) {
        const a = sc.getImageData(x0, y0, 64, 64).data, b = pc.getImageData(x0, y0, 64, 64).data, j = jc.getImageData(x0, y0, 64, 64).data;
        let maxd = 0, sumj = 0, n = 0;
        for (let i = 0; i < a.length; i++) { if (i % 4 === 3) continue; maxd = Math.max(maxd, Math.abs(a[i] - b[i])); sumj += Math.abs(a[i] - j[i]); n++; }
        out[name] = { maxPng: maxd, meanJpg: +(sumj / n).toFixed(2) };
      }
      return out;
    }, { png: ex.dataURL, jpg: exj.dataURL });
    for (const [name, v] of Object.entries(D)) check(v.maxPng === 0, `${name}: PNG 最大差 ${v.maxPng} / JPEG 平均差 ${v.meanJpg}`);
    check(errors.length === 0, `コンソールエラー ${errors.length} 件`);
  } finally { await close(); }
  console.log(ok ? '[parity] PASS' : '[parity] FAIL');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
