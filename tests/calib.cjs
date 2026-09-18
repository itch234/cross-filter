// tauScale の較正: 既定値での白点の可視長(40/255 しきい値)を v0 と v1(tauScale 候補)で測る
'use strict';
const H = require('./harness.cjs');
const W = 1440, HGT = 960, CX = 720, CY = 480;
const DRAW = `ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  const g2 = ctx.createRadialGradient(${CX},${CY},3,${CX},${CY},4); g2.addColorStop(0,'#fff'); g2.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(${CX},${CY},4,0,7); ctx.fill();`;

async function measure(page) {
  const RW = 700, RH = 41;
  const px = await page.evaluate(({ x, y, w, h }) => window.__cf.readPixels(x, y, w, h), { x: CX, y: CY - (RH >> 1), w: RW, h: RH });
  const maxc = r => { const i = ((RH >> 1) * RW + r) * 4; return Math.max(px[i], px[i + 1], px[i + 2]); };
  const at = t => { for (let r = 4; r < RW; r++) if (maxc(r) < t) return r; return RW; };
  return { vis40: at(40), vis100: at(100), vis5: at(5) };
}

(async () => {
  for (const file of ['legacy/cross-filter-v0.html', 'index.html']) {
    const { page, close } = await H.open(file);
    try {
      const version = await page.evaluate(() => window.__cf.version);
      await H.loadSynthetic(page, W, HGT, DRAW);
      const defaults = version === 'v0' ? { gain: 45 } : { gain: 60 };
      await page.evaluate(d => window.__cf.set({ angle: 0, points: 4, length: 40, thr: 80, iso: 70, color: 60, disp: 35, glow: 20, tail: 50, ...d }), defaults);
      if (version === 'v0') {
        console.log(`v0 defaults(gain45): ${JSON.stringify(await measure(page))}`);
      } else {
        for (const ts of [0.45, 0.55, 0.65, 0.75]) {
          await page.evaluate(ts => { window.__cf.tune.tauScale = ts; window.__cf.render(); }, ts);
          console.log(`v1 defaults(gain60) tauScale=${ts}: ${JSON.stringify(await measure(page))}`);
        }
      }
    } finally { await close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
