// 휴대폰 너비에서 열기·도구·패널 확인
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'shots', 'qa');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL); await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'p1-home.png') });
  const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'korean-report.pdf')).toString('base64');
  await page.evaluate(async (b64) => { const t = await window.host.openDropped(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], '회의록.pdf')); await window.__pl.openPath(t); }, b64);
  await sleep(1800);
  await page.screenshot({ path: path.join(OUT, 'p2-open.png') });
  await page.evaluate(() => window.__pl.runCmd('tool:highlight')); await sleep(400);
  // 손가락으로 끌어 강조 (터치)
  const b = await page.evaluate(() => { const sp = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes('신규 고객')); const r = sp.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', b.x + 2, b.y + b.h / 2);
  for (let i = 1; i <= 10; i++) { await tp('touchMove', b.x + b.w * 0.6 * i / 10, b.y + b.h / 2); await sleep(20); }
  await tp('touchEnd'); await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'p3-highlight.png') });
  await page.click('[data-cmd="toggleNav"].narrow-only'); await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'p4-nav.png') });
  await page.click('#navThumbs .thumb'); await sleep(400);
  await page.evaluate(() => window.__pl.runCmd('toggleTools')); await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'p5-tools.png') });
  console.log('annots', JSON.stringify(await page.evaluate(() => Object.values(window.__pl.S.active.annots).flat().map(o => o.type + ':' + (o.text || '')))));
  console.log('overflowX', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
