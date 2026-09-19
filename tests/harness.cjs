// 共通ハーネス: 静的サーバー、Edge(SwiftShader)起動、合成画像の投入、PNG 保存。
// 使い方: const H = require('./harness.cjs'); const {browser, page, server} = await H.open('index.html');
'use strict';
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.cjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || EDGE,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/* ページを開き、__cf.ready まで待つ。errors には pageerror と console.error が溜まる */
async function open(file, { viewport = { width: 1280, height: 900 }, contextOptions = {}, initScript = null } = {}) {
  const server = await serve();
  const browser = await launch();
  const context = await browser.newContext({ viewport, acceptDownloads: true, ...contextOptions });
  const page = await context.newPage();
  if (initScript) await page.addInitScript(initScript);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  // 外部フォントは取りに行かない(abort だと console.error になるので空応答にする)
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
  const { port } = server.address();
  await page.goto(`http://127.0.0.1:${port}/${file}`);
  await page.waitForFunction(() => window.__cf && window.__cf.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__cf.ready);
  // 描画直後の browser.close() が戻らないことがある(SwiftShader の描画待ち)。時間制限を付け、残った Edge は止める
  const close = async () => {
    const timeout = new Promise(r => setTimeout(() => r('timeout'), 8000));
    const res = await Promise.race([browser.close().then(() => 'ok').catch(() => 'error'), timeout]);
    if (res !== 'ok') killStragglers();
    server.close();
  };
  return { browser, page, server, errors, close };
}

/* Playwright が起動した Edge(プロファイルが playwright の一時ディレクトリ)だけを止める。利用者の Edge は触らない */
function killStragglers() {
  try {
    require('node:child_process').execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -match 'playwright' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { stdio: 'ignore', timeout: 20000 });
  } catch (_) {}
}
process.on('exit', killStragglers);

/* ページ内でキャンバスに描いて元画像として読み込む。draw は (ctx, W, H) => void の関数ソース文字列 */
async function loadSynthetic(page, W, H, drawSource) {
  await page.evaluate(async ({ W, H, drawSource }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    (new Function('ctx', 'W', 'H', drawSource))(ctx, W, H);
    await window.__cf.loadCanvas(c);
  }, { W, H, drawSource });
}

/* サンプル夜景を指定サイズで読み込む(JPEG にして File 経由で渡す) */
async function loadSample(page, W, H, type = 'image/png', quality) {
  await page.evaluate(async ({ W, H, type, quality }) => {
    const c = window.__cf.sample(W, H);
    const blob = await new Promise(r => c.toBlob(r, type, quality));
    c.width = c.height = 1;
    await window.__cf.loadFile(new File([blob], 'sample.' + (type === 'image/png' ? 'png' : 'jpg'), { type }));
  }, { W, H, type, quality });
}

function savePng(dataURL, name) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(dataURL.split(',')[1], 'base64'));
  return p;
}

/* ページ内で複数の dataURL を格子に並べ、ラベルを描いて 1 枚にする */
async function grid(page, items, cols, cellW, cellH) {
  return page.evaluate(async ({ items, cols, cellW, cellH }) => {
    const rows = Math.ceil(items.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cellW; c.height = rows * cellH;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < items.length; i++) {
      const img = new Image(); img.src = items[i].dataURL; await img.decode();
      const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
      const k = Math.min(cellW / img.width, cellH / img.height);
      x.drawImage(img, cx, cy, img.width * k, img.height * k);
      x.font = 'bold 22px sans-serif'; x.fillStyle = '#000'; x.fillText(items[i].label, cx + 12, cy + 30);
      x.fillStyle = '#fff'; x.fillText(items[i].label, cx + 10, cy + 28);
    }
    return c.toDataURL('image/png');
  }, { items, cols, cellW, cellH });
}

module.exports = { ROOT, OUT, serve, launch, open, loadSynthetic, loadSample, savePng, grid };
