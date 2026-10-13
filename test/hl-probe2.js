// 밑줄·취소선, 회전 보기, 글자 없는 페이지, 속도 확인
// 필요한 시험용 PDF: test/fixtures/ 에 korean-report.pdf, scanned.pdf(저장소에 있음)와
//   compressed.tracemonkey-pldi-09.pdf (https://github.com/mozilla/pdf.js/raw/master/web/compressed.tracemonkey-pldi-09.pdf)
// 웹 버전을 띄운 뒤 실행: python3 -m http.server 8765 -d docs
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'shots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL); await sleep(600);
  const open = async (file) => { const b64 = fs.readFileSync(file).toString('base64'); await page.evaluate(async ([b64, n]) => { const t = await window.host.openDropped(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n)); await window.__pl.openPath(t); }, [b64, path.basename(file)]); await sleep(1500); };
  const box = (t) => page.evaluate((t) => { const sp = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(t)); const r = sp.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, t);
  const drag = async (x1, y1, x2, y2) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= 12; i++) { await page.mouse.move(x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12); await sleep(10); } await page.mouse.up(); await sleep(300); };

  await open(path.join(__dirname, 'fixtures', 'compressed.tracemonkey-pldi-09.pdf'));
  await page.evaluate(() => { window.__pl.viewer.currentScaleValue = 'page-width'; }); await sleep(1200);
  const t = await page.evaluate(() => { const t0 = performance.now(); document.querySelector('.page[data-page-number="1"]'); window.__pl.runCmd('tool:highlight'); return 0; });
  // 처음 누를 때 글자 위치 계산 시간 (가장 무거운 1페이지)
  let b = await box('Dynamic languages such as');
  const t0 = Date.now(); await page.mouse.move(b.x + 2, b.y + b.h / 2); await page.mouse.down(); await page.mouse.up(); const ms = Date.now() - t0;
  await page.evaluate(() => window.__pl.runCmd('tool:underline')); await sleep(300);
  b = await box('Dynamic languages such as'); await drag(b.x + 2, b.y + b.h / 2, b.x + b.w * 0.5, b.y + b.h / 2);
  await page.evaluate(() => window.__pl.runCmd('tool:strike')); await sleep(300);
  b = await box('pile than statically'); await drag(b.x + 2, b.y + b.h / 2, b.x + b.w * 0.5, b.y + b.h / 2);
  b = await box('Dynamic languages such as');
  await page.screenshot({ path: path.join(OUT, 'hl-after-lines.png'), clip: { x: b.x - 20, y: b.y - 30, width: 620, height: 120 } });

  // 보기 90도 회전 후 강조
  await page.evaluate(() => { window.__pl.runCmd('rotateCw'); window.__pl.runCmd('tool:highlight'); }); await sleep(1500);
  b = await box('Trace-based Just');
  await page.evaluate((t) => { [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(t)).scrollIntoView({ block: 'center', inline: 'center' }); }, 'Trace-based Just'); await sleep(500);
  b = await box('Trace-based Just');
  await drag(b.x + b.w / 2, b.y + 2, b.x + b.w / 2, b.y + b.h * 0.6);
  await page.screenshot({ path: path.join(OUT, 'hl-after-rotated.png'), clip: { x: Math.max(0, b.x - 80), y: Math.max(0, b.y - 20), width: 260, height: Math.min(700, b.h + 60) } });
  const list = await page.evaluate(() => Object.values(window.__pl.S.active.annots).flat().map(o => `${o.type}:${(o.text || '').slice(0, 40)}`));

  // 글자 없는 페이지(이미지 PDF): 영역으로 칠하기
  await open(path.join(__dirname, 'fixtures', 'scanned.pdf'));
  await page.evaluate(() => { window.__pl.runCmd('tool:highlight'); }); await sleep(600);
  const glyphs = await page.evaluate(() => document.querySelectorAll('.page[data-page-number="1"] .textLayer span').length);
  const pg = await page.evaluate(() => { const r = document.querySelector('.page[data-page-number="1"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await drag(pg.x + pg.w * 0.2, pg.y + 120, pg.x + pg.w * 0.6, pg.y + 200);
  const area = await page.evaluate(() => Object.values(window.__pl.S.active.annots).flat().map(o => `${o.type} rects=${o.rects.length} w=${Math.round(o.rects[0][2])}`));
  console.log('FIRST-CLICK ms', ms);
  console.log('PAPER', JSON.stringify(list));
  console.log('NO-TEXT page spans', glyphs, 'annots', JSON.stringify(area));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
