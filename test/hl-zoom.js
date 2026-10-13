// 강조한 뒤 확대·축소(Ctrl+휠)를 해도 형광펜이 글자 위에 그대로 보이는지 확인
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [URL, TAG] = [process.argv[2] || 'http://127.0.0.1:8765/', process.argv[3] || 'x'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 })).newPage();
  await page.goto(URL); await sleep(600);
  const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'opaque-lines.pdf')).toString('base64');
  await page.evaluate(async (b64) => { const t = await window.host.openDropped(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'o.pdf')); await window.__pl.openPath(t); window.__pl.viewer.currentScaleValue = '1.3'; }, b64);
  await sleep(1500);
  await page.evaluate(() => window.__pl.runCmd('tool:highlight')); await sleep(300);
  const box = (t) => page.evaluate((t) => { const sp = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(t)); const r = sp.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, t);
  let a = await box('분야에 걸쳐'), b = await box('분야에 따라');
  await page.mouse.move(a.x + a.w * 0.5, a.y + a.h / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + a.w * 0.5 + (b.x + b.w * 0.5 - a.x - a.w * 0.5) * i / 12, a.y + a.h / 2 + (b.y - a.y) * i / 12); await sleep(10); }
  await page.mouse.up(); await sleep(500);
  const shotAt = async (name) => { const f = await box('복잡하게'); await page.screenshot({ path: path.join(__dirname, 'shots', `hl-zoom-${TAG}-${name}.png`), clip: { x: Math.max(0, f.x - 10), y: Math.max(0, f.y - 10), width: 900, height: 150 } }); };
  await shotAt('0');
  // Ctrl+휠로 한 단계 확대: 다시 그리는 중간과 끝난 뒤
  await page.mouse.move(700, 400);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await sleep(60); await shotAt('1-during');
  await sleep(1500); await shotAt('2-after');
  const order = await page.evaluate(() => [...document.querySelector('.page').children].map(e => (e.className.baseVal ?? e.className) + (e.style.position ? '[' + e.style.position + ']' : '')).join(' | '));
  console.log('ORDER', order);
  await browser.close();
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
