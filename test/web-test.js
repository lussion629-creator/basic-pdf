// 웹 버전 테스트 (Playwright + Chromium)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const _log = console.log; console.log = (...a) => fs.writeSync(1, a.join(' ') + '\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ko-KR' });
  // 파일 선택 API가 없는 브라우저(파이어폭스·사파리)와 같은 경로를 시험
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; delete window.showDirectoryPicker; });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('crash', () => console.log('PAGE CRASH')); page.on('close', () => console.log('PAGE CLOSE')); page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV', f.url().slice(0, 80)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('request', r => { if (!r.url().startsWith(URL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()); });

  await page.goto(URL);
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'web-01-home.png') });

  // 파일 열기 (끌어다 놓기와 같은 경로)
  const b64 = fs.readFileSync(path.join(__dirname, 'sample.pdf')).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const f = new File([bytes], '사업계획서.pdf', { type: 'application/pdf' });
    const t = await window.host.openDropped(f);
    await window.__pl.openPath(t);
  }, b64);
  await sleep(1500);
  await page.evaluate(() => { window.__pl.viewer.currentScaleValue = 'page-fit'; });
  await sleep(800);
  const pg = await page.evaluate(() => { const b = document.querySelector('.page[data-page-number="1"]').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });

  console.log('STEP open ok');
  // 강조
  await page.waitForFunction(() => [...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].some(s => s.textContent.includes('매출 목표')), null, { timeout: 15000 });
  await page.evaluate(() => window.__pl.runCmd('tool:highlight'));
  const r = await page.evaluate(() => { const sp = [...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(s => s.textContent.includes('매출 목표')); const b = sp.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + 2, r.y + r.h / 2); await page.mouse.down(); await page.mouse.move(r.x + r.w * 0.6, r.y + r.h / 2, { steps: 10 }); await page.mouse.up();
  await sleep(200);
  console.log('STEP highlight');
  // 텍스트 상자 (한글)
  await page.evaluate(() => window.__pl.runCmd('tool:text'));
  await page.mouse.click(pg.x + pg.w * 0.55, pg.y + pg.h * 0.62);
  await page.keyboard.type('웹에서 검토함 - 김서연');
  await page.mouse.click(pg.x + 30, pg.y + pg.h * 0.95);
  console.log('STEP text');
  // 스탬프
  await page.evaluate(() => window.__pl.runCmd('tool:stamp'));
  await page.mouse.click(pg.x + pg.w * 0.78, pg.y + pg.h * 0.12);
  console.log('STEP stamp');
  // 펜
  await page.evaluate(() => window.__pl.runCmd('tool:ink'));
  await page.mouse.move(pg.x + pg.w * 0.6, pg.y + pg.h * 0.5); await page.mouse.down();
  for (let i = 0; i < 25; i++) await page.mouse.move(pg.x + pg.w * (0.6 + i * 0.01), pg.y + pg.h * (0.5 + Math.sin(i / 3) * 0.02));
  await page.mouse.up();
  console.log('STEP ink');
  // 서명 (그려서 만들기)
  await page.evaluate(() => window.__pl.runCmd('tool:sign'));
  await sleep(200);
  await page.click('text=서명 만들기');
  await sleep(300);
  const pad = await page.locator('#sigPad').boundingBox();
  await page.mouse.move(pad.x + 40, pad.y + 120); await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(pad.x + 40 + i * 12, pad.y + 120 - Math.sin(i / 2.5) * 40);
  await page.mouse.up();
  await page.click('text=서명 저장');
  await sleep(300);
  await page.mouse.click(pg.x + pg.w * 0.3, pg.y + pg.h * 0.8);
  await sleep(300);
  await page.evaluate(() => window.__pl.runCmd('tool:select'));
  await page.mouse.click(pg.x + 30, pg.y + pg.h * 0.97);
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'web-02-annotated.png') });

  console.log('STEP sign');
  // 웹 메뉴 열어 보기
  await page.click('#webMenuBtn');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'web-03-menu.png') });
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);

  console.log('STEP menu');
  // 저장 (Ctrl+S → 다운로드)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.keyboard.press('Control+s')]);
  const saved = path.join(__dirname, 'web-out.pdf');
  await dl.saveAs(saved);
  console.log('download', dl.suggestedFilename(), fs.statSync(saved).size);

  console.log('STEP save', page.isClosed());
  await sleep(1500);
  console.log('alive', page.isClosed());
  // 전체 PNG 내보내기 → zip 하나로
  page.evaluate(() => { window.__pl.runCmd('exportAllPng'); });
  await page.waitForSelector('.modal .btn.primary');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('.modal .btn.primary')]);
  console.log('zip', dl2.suggestedFilename(), fs.statSync(await dl2.path()).size);

  console.log('STEP zip');
  // 서명이 암호화되어 저장됐는지
  const sig = await page.evaluate(async () => {
    const raw = localStorage.getItem('bp.sigs.enc');
    return { stored: !!raw, plainLeak: !!raw && raw.includes('data:image'), reloaded: (await window.host.sigsGet()).length };
  });
  console.log('SIG', JSON.stringify(sig));

  // 보안: 외부 접속 차단·임의 파일 읽기 차단
  const sec = await page.evaluate(async () => {
    const r = {};
    try { await fetch('https://example.com'); r.network = 'ALLOWED'; } catch { r.network = 'blocked'; }
    try { await window.host.readFile('o999/x.pdf'); r.read = 'ALLOWED'; } catch { r.read = 'blocked'; }
    try { await window.host.writeFile('d1/evil.exe', new Uint8Array([1])); r.exe = 'ALLOWED'; } catch { r.exe = 'blocked'; }
    return r;
  });
  console.log('SECURITY', JSON.stringify(sec), 'external requests:', requests.length);

  // 다크 모드 + 휴대폰 너비
  await page.evaluate(() => window.__pl.runCmd('themeDark'));
  await page.setViewportSize({ width: 820, height: 900 });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'web-04-dark-narrow.png') });

  console.log('ERRORS', errors.length, JSON.stringify(errors.filter(e => !/example\.com/.test(e)).slice(0, 8)));
  await browser.close();
})().catch(e => { console.error('TEST FAIL', e); process.exit(1); });
