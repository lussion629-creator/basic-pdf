// 형광펜 확인용: 실제 마우스로 드래그해서 강조하고 확대 화면을 저장한다.
// 필요한 시험용 PDF: test/fixtures/ 에 korean-report.pdf, scanned.pdf(저장소에 있음)와
//   compressed.tracemonkey-pldi-09.pdf (https://github.com/mozilla/pdf.js/raw/master/web/compressed.tracemonkey-pldi-09.pdf)
// 웹 버전을 띄운 뒤 실행: python3 -m http.server 8765 -d docs
//   node test/hl-probe.js [URL] [접두어]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const TAG = process.argv[3] || 'before';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openPdf(page, file) {
  const b64 = fs.readFileSync(file).toString('base64');
  await page.evaluate(async ([b64, name]) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const t = await window.host.openDropped(new File([bytes], name, { type: 'application/pdf' }));
    await window.__pl.openPath(t);
  }, [b64, path.basename(file)]);
  await sleep(1500);
}

// 텍스트 조각(span)의 화면 좌표
async function spanBox(page, pageNo, text, scroll = true) {
  return page.evaluate(([pageNo, text, scroll]) => {
    const sp = [...document.querySelectorAll(`.page[data-page-number="${pageNo}"] .textLayer span`)].find(s => s.textContent.includes(text));
    if (!sp) return null;
    if (scroll) sp.scrollIntoView({ block: 'center' });
    const b = sp.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, [pageNo, text, scroll]);
}

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1); await page.mouse.down();
  for (let i = 1; i <= 15; i++) { await page.mouse.move(x1 + (x2 - x1) * i / 15, y1 + (y2 - y1) * i / 15); await sleep(10); }
  await page.mouse.up(); await sleep(400);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL); await sleep(800);

  // 1) 한글 보고서: 한 줄 일부, 여러 줄, 크기가 다른 줄
  await openPdf(page, path.join(__dirname, 'fixtures', 'korean-report.pdf'));
  await page.evaluate(() => { window.__pl.viewer.currentScaleValue = '1.5'; window.__pl.runCmd('tool:highlight'); });
  await sleep(900);
  let b = await spanBox(page, 1, '신규 고객'); await sleep(300); b = await spanBox(page, 1, '신규 고객');
  await drag(page, b.x + 2, b.y + b.h / 2, b.x + b.w * 0.55, b.y + b.h / 2);
  await spanBox(page, 1, '다음 달 1일'); await sleep(200);
  b = await spanBox(page, 1, '다음 달 1일', false);
  const b2 = await spanBox(page, 1, 'Response time', false);
  await drag(page, b.x + b.w * 0.3, b.y + b.h / 2, b2.x + b2.w * 0.7, b2.y + b2.h / 2);
  b = await spanBox(page, 1, '3분기 운영'); await sleep(200); b = await spanBox(page, 1, '3분기 운영', false);
  await drag(page, b.x + 2, b.y + b.h / 2, b.x + b.w - 2, b.y + b.h / 2);
  // 두 단: 왼쪽 단만
  await spanBox(page, 1, '영업팀'); await sleep(200);
  b = await spanBox(page, 1, '영업팀', false);
  const b3 = await spanBox(page, 1, '재계약률', false);
  await drag(page, b.x + 2, b.y + b.h / 2, b3.x + b3.w - 2, b3.y + b3.h / 2);
  await spanBox(page, 1, '예산은'); await sleep(200);
  b = await spanBox(page, 1, '예산은', false);
  await drag(page, b.x - 30, b.y + b.h / 2, b.x + b.w + 400, b.y + b.h / 2);
  // 두 번 눌러 단어 하나
  b = await spanBox(page, 1, '기술팀', false);
  await page.mouse.dblclick(b.x + b.w * 0.5, b.y + b.h / 2); await sleep(400);
  await page.evaluate(() => document.querySelector('.page[data-page-number="1"]').scrollIntoView({ block: 'start' })); await sleep(300);
  const pg = await page.evaluate(() => { const r = document.querySelector('.page[data-page-number="1"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.screenshot({ path: path.join(OUT, `hl-${TAG}-korean.png`), clip: { x: Math.max(0, pg.x), y: Math.max(0, pg.y), width: Math.min(pg.w, 900), height: Math.min(900 - Math.max(0, pg.y), pg.h) } });
  const k = await page.evaluate(() => Object.values(window.__pl.S.active.annots).flat().map(o => ({ t: o.type, n: o.rects && o.rects.length, text: o.text })));
  console.log('KOREAN', JSON.stringify(k));

  // 2) 실제 논문 PDF (영문, 작은 글씨, 두 단)
  await openPdf(page, path.join(__dirname, 'fixtures', 'compressed.tracemonkey-pldi-09.pdf'));
  await page.evaluate(() => { window.__pl.viewer.currentScaleValue = '2'; window.__pl.runCmd('tool:highlight'); });
  await sleep(1200);
  b = await spanBox(page, 1, 'Trace-based'); await sleep(400); b = await spanBox(page, 1, 'Trace-based', false);
  if (b) await drag(page, b.x + 2, b.y + b.h / 2, b.x + b.w - 2, b.y + b.h / 2);
  await spanBox(page, 1, 'Dynamic languages such as'); await sleep(300);
  const b4 = await spanBox(page, 1, 'Dynamic languages such as', false);
  if (b4) {
    // 문단 세 줄
    await drag(page, b4.x + 2, b4.y + b4.h / 2, b4.x + b4.w * 0.6, b4.y + b4.h * 2.6);
    await sleep(300);
    const r = await spanBox(page, 1, 'Dynamic languages such as', false);
    await page.screenshot({ path: path.join(OUT, `hl-${TAG}-paper.png`), clip: { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 160), width: 700, height: 360 } });
  }
  const t = await page.evaluate(() => Object.values(window.__pl.S.active.annots).flat().map(o => ({ t: o.type, n: o.rects && o.rects.length, text: (o.text || '').slice(0, 60) })));
  console.log('PAPER', JSON.stringify(t));
  console.log('ERRORS', JSON.stringify(errors.slice(0, 5)));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
