// Edge + SwiftShader で WebGL2 が取れるかの最小プローブ(段階ごとに時刻を出す)
'use strict';
const { chromium } = require('playwright-core');
const t0 = Date.now(), log = m => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${m}`);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    timeout: 60000,
  });
  log('launched ' + browser.version());
  const page = await browser.newPage();
  log('page');
  await page.goto('about:blank');
  const info = await page.evaluate(() => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      float: !!gl.getExtension('EXT_color_buffer_float'), half: !!gl.getExtension('EXT_color_buffer_half_float') };
  });
  log(JSON.stringify(info));
  await browser.close(); log('closed');
})().catch(e => { log('ERR ' + e.message); process.exit(1); });
