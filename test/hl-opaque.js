// 줄마다 흰 배경이 깔린 PDF(한글·워드 변환본에 흔함)에서 형광펜이 글자 위에 보이는지 확인
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const TAG = process.argv[3] || 'x';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(URL); await sleep(600);
  const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'opaque-lines.pdf')).toString('base64');
  await page.evaluate(async (b64) => { const t = await window.host.openDropped(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'opaque.pdf')); await window.__pl.openPath(t); window.__pl.viewer.currentScaleValue = '1.5'; window.__pl.runCmd('tool:highlight'); }, b64);
  await sleep(1800);
  const box = (t) => page.evaluate((t) => { const sp = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(t)); const r = sp.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, t);
  const drag = async (x1, y1, x2, y2) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= 12; i++) { await page.mouse.move(x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12); await sleep(10); } await page.mouse.up(); await sleep(400); };
  let a = await box('복잡하게');
  await page.mouse.dblclick(a.x + a.w * 0.40, a.y + a.h / 2); await sleep(400);
  a = await box('분야에 걸쳐'); const b = await box('분야에 따라');
  await drag(a.x + a.w * 0.6, a.y + a.h / 2, b.x + b.w * 0.6, b.y + b.h / 2);
  if (process.env.FLOAT) await page.evaluate(() => document.querySelectorAll('.canvasWrapper').forEach(c => { c.style.position = 'absolute'; }));
  await sleep(200);
  const f = await box('복잡하게');
  await page.screenshot({ path: path.join(__dirname, 'shots', `hl-opaque-${TAG}.png`), clip: { x: f.x - 10, y: f.y - 12, width: f.w + 30, height: 130 } });
  // 강조 영역 한가운데 화면 색을 직접 읽어 노란색인지 확인
  const px = await page.evaluate(() => {
    const o = Object.values(window.__pl.S.active.annots).flat().find(o => o.type === 'highlight' && o.rects.length > 1);
    return o ? o.rects.length : 0;
  });
  const shot = await page.screenshot({ clip: { x: b.x + 10, y: b.y + b.h / 2 - 1, width: 2, height: 2 } });
  console.log('rects', px, 'pixel png bytes', shot.length);
  await browser.close();
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
