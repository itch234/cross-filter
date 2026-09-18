// 条件2・3(数値): 黒地に白点 1 個の合成画像で光条の断面プロファイルを測る。
// 使い方: node tests/profile.cjs [index.html|legacy/cross-filter-v0.html] [--fast]
//   出力: test-results/profile_<version>.csv と要約表。判定: 強さ 90 で 白帯長/可視長 <= 0.20
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const H = require('./harness.cjs');

const W = 1440, HGT = 960, CX = 720, CY = 480;
// 白点(半径 3px、縁 1px の勾配)。halo=true なら周囲に半径 15px・ピーク 0.3 のにじみを足す(街灯相当、I0≈3 の代理)
const DRAW = halo => `
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ${halo ? `{ const g = ctx.createRadialGradient(${CX},${CY},0,${CX},${CY},15); g.addColorStop(0,'rgba(255,255,255,0.3)'); g.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(${CX}-15,${CY}-15,30,30); }` : ''}
  const g2 = ctx.createRadialGradient(${CX},${CY},3,${CX},${CY},4); g2.addColorStop(0,'#fff'); g2.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(${CX},${CY},4,0,7); ctx.fill();
`;

function analyze(px, w, h) {
  // px: RGBA、w×h の領域(x0=CX, y 中心 = CY)。軸上 = 行 h/2、右方向 r = 0..w-1
  const row = r => { const i = ((h >> 1) * w + r) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const maxc = r => Math.max(...row(r));
  const satW = r => { let n = 0; for (let y = 0; y < h; y++) { const i = (y * w + r) * 4; if (Math.max(px[i], px[i + 1], px[i + 2]) >= 248) n++; } return n; };
  // 可視長: 軸上の値が 40/255(線形で約 0.02)を下回る最初の r。5/255 は線形 0.0002 で目に見えない
  let vis = w; for (let r = 4; r < w; r++) if (maxc(r) < 40) { vis = r; break; }
  let sat = 0; for (let r = 0; r < w; r++) if (satW(r) > 0) sat = r;
  return { axis: r => row(r), satW, vis, sat };
}

(async () => {
  const file = process.argv[2] || 'index.html';
  const { page, errors, close } = await H.open(file);
  const lines = ['version,case,gain,r,R,G,B,satWidth'];
  const summary = [];
  try {
    const version = await page.evaluate(() => window.__cf.version);
    for (const halo of [false, true]) {
      await H.loadSynthetic(page, W, HGT, DRAW(halo));
      for (const gain of [30, 60, 90]) {
        await page.evaluate(g => window.__cf.set({ angle: 0, points: 4, gain: g }), gain);
        const RW = 700, RH = 41;
        const px = await page.evaluate(({ x, y, w, h }) => window.__cf.readPixels(x, y, w, h), { x: CX, y: CY - (RH >> 1), w: RW, h: RH });
        const a = analyze(px, RW, RH);
        for (let r = 0; r < RW; r++) { const [R, G, B] = a.axis(r); lines.push(`${version},${halo ? 'lamp' : 'point'},${gain},${r},${R},${G},${B},${a.satW(r)}`); }
        const ds = [0, 5, 10, 20, 30, 40, 60, 80, 120, 160, 240];
        summary.push({ version, case: halo ? 'lamp' : 'point', gain, vis: a.vis, sat: a.sat, ratio: +(a.sat / a.vis).toFixed(2),
          axis: ds.map(r => a.axis(r)[1]).join(' '), satW: ds.map(r => a.satW(r)).join(' ') });
      }
    }
    const csv = path.join(H.OUT, `profile_${version}.csv`);
    fs.writeFileSync(csv, lines.join('\n'));
    console.log(`[profile] ${version} -> ${csv}`);
    console.log('r = 0 5 10 20 30 40 60 80 120 160 240');
    for (const s of summary) {
      console.log(`${s.version} ${s.case.padEnd(5)} gain=${s.gain}  visible=${String(s.vis).padStart(3)}px  whiteBand=${String(s.sat).padStart(3)}px  ratio=${s.ratio}${s.gain === 90 ? (s.ratio <= 0.2 ? '  PASS' : '  FAIL(>0.20)') : ''}`);
      console.log(`   axisG: ${s.axis}`);
      console.log(`   satW : ${s.satW}`);
    }
    fs.writeFileSync(path.join(H.OUT, `profile_${version}.json`), JSON.stringify(summary, null, 1));
    if (errors.length) { console.log('errors:', errors); process.exitCode = 1; }
  } finally { await close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
