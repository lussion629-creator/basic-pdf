// 웹 버전 전체 기능 점검: 실제 마우스·키보드로 하나씩 써 보고 화면을 남긴다.
// 필요한 시험용 PDF: test/fixtures/ 에 korean-report.pdf, scanned.pdf(저장소에 있음)와
//   compressed.tracemonkey-pldi-09.pdf (https://github.com/mozilla/pdf.js/raw/master/web/compressed.tracemonkey-pldi-09.pdf)
// 웹 버전을 띄운 뒤 실행: python3 -m http.server 8765 -d docs
//   node test/qa-web.js [URL]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'shots', 'qa');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => fs.writeSync(1, a.join(' ') + '\n');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ko-KR' });
  // 파일 선택 API가 없는 브라우저와 같은 경로(내려받기 저장)를 시험
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; delete window.showDirectoryPicker; });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(URL) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  const shot = async (name, clip) => { await sleep(350); await page.screenshot({ path: path.join(OUT, name + '.png'), ...(clip ? { clip } : {}) }); log('shot', name); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const cmd = (c) => ev((c) => { window.__pl.runCmd(c); }, c);
  const state = () => ev(() => Object.values(window.__pl.S.active.annots).flat().map(o => o.type + (o.text ? ':' + o.text.slice(0, 24) : '')));
  const pageBox = (n = 1) => ev((n) => { const r = document.querySelector(`.page[data-page-number="${n}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, n);
  const spanBox = (t) => ev((t) => { const sp = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(t)); if (!sp) return null; const r = sp.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, t);
  const drag = async (x1, y1, x2, y2, steps = 12) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); await sleep(12); } await page.mouse.up(); await sleep(250); };
  const click = async (x, y) => { await page.mouse.click(x, y); await sleep(250); };
  const openFile = async (file) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), cmd('open')]);
    await fc.setFiles(file);
    await sleep(1800);
  };

  // 1. 시작 화면
  log('goto'); await page.goto(URL, { timeout: 20000 }); log('loaded'); await sleep(900);
  await shot('01-home');

  // 2. 파일 열기 (파일 선택창)
  await openFile(path.join(FIX, 'korean-report.pdf'));
  await ev(() => { window.__pl.viewer.currentScaleValue = 'page-width'; }); await sleep(900);
  await shot('02-opened');

  // 3. PDF 편집: 기존 줄을 눌러 고치기
  await cmd('tool:edittext'); await sleep(300);
  let b = await spanBox('고객센터 인력은');
  await click(b.x + 20, b.y + b.h / 2);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(' (11월부터)');
  await page.keyboard.press('Escape'); await sleep(300);
  await cmd('tool:select');
  b = await spanBox('신규 고객');
  await shot('03-edittext', { x: b.x - 20, y: b.y - 20, width: 900, height: 110 });

  // 4. 텍스트 상자 (페이지 전체가 보이게)
  await ev(() => { window.__pl.viewer.currentScaleValue = 'page-fit'; }); await sleep(900);
  await cmd('tool:text'); await sleep(300);
  let pg = await pageBox();
  await click(pg.x + pg.w * 0.55, pg.y + pg.h * 0.62);
  await page.keyboard.type('검토 의견: 일정 확인 필요');
  await click(pg.x + 30, pg.y + pg.h * 0.95);

  // 5. 메모
  await cmd('tool:note');
  await click(pg.x + pg.w * 0.9, pg.y + pg.h * 0.2);
  await page.keyboard.type('담당자 이름 다시 확인');
  await click(pg.x + 30, pg.y + pg.h * 0.95);

  // 6. 펜, 도형, 화살표
  await cmd('tool:ink');
  await page.mouse.move(pg.x + pg.w * 0.15, pg.y + pg.h * 0.75); await page.mouse.down();
  for (let i = 0; i <= 30; i++) { await page.mouse.move(pg.x + pg.w * (0.15 + i * 0.01), pg.y + pg.h * (0.75 + Math.sin(i / 4) * 0.015)); await sleep(8); }
  await page.mouse.up(); await sleep(200);
  await cmd('tool:rect');
  await drag(pg.x + pg.w * 0.55, pg.y + pg.h * 0.7, pg.x + pg.w * 0.85, pg.y + pg.h * 0.78);
  await cmd('tool:ellipse');
  await drag(pg.x + pg.w * 0.6, pg.y + pg.h * 0.8, pg.x + pg.w * 0.8, pg.y + pg.h * 0.86);
  await cmd('tool:arrow');
  await drag(pg.x + pg.w * 0.5, pg.y + pg.h * 0.9, pg.x + pg.w * 0.7, pg.y + pg.h * 0.87);

  // 7. 스탬프 (속성 막대가 생긴 뒤 위치를 다시 잰다)
  await cmd('tool:stamp'); await sleep(500);
  pg = await pageBox();
  await click(pg.x + pg.w * 0.78, pg.y + pg.h * 0.09);

  // 8. 서명 만들기(그리기) 후 넣기
  await cmd('tool:sign'); await sleep(300);
  const make = page.locator('#propbar .pb-btn', { hasText: '서명 만들기' });
  if (await make.count()) {
    await make.click(); await sleep(400);
    const pad = await page.locator('#sigPad').boundingBox();
    await page.mouse.move(pad.x + 40, pad.y + 120); await page.mouse.down();
    for (let i = 0; i <= 40; i++) { await page.mouse.move(pad.x + 40 + i * 9, pad.y + 110 + Math.sin(i / 3) * 30); await sleep(6); }
    await page.mouse.up();
    await shot('04-signature-dialog');
    await page.locator('.modal-foot .btn.primary').click(); await sleep(400);
  }
  pg = await pageBox();
  await click(pg.x + pg.w * 0.3, pg.y + pg.h * 0.88);
  await sleep(900); // 서명이 놓이고 선택 도구로 돌아갈 때까지

  // 9. 이미지 넣기
  await cmd('tool:image'); await sleep(500);
  pg = await pageBox();
  log('IMG-DEBUG', JSON.stringify(await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return { tool: window.__pl.S.tool, el: e.tagName + '.' + (e.className.baseVal ?? e.className), modals: document.getElementById('modalRoot').children.length }; }, [pg.x + pg.w * 0.82, pg.y + pg.h * 0.5])));
  await ev(() => { const o = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { console.log('INPUT-CLICK ' + this.id + ' ' + window.__pl.S.tool); return o.call(this); }; window.addEventListener('pointerup', () => console.log('PUP tool=' + window.__pl.S.tool), true); });
  page.on('console', m => { if (/INPUT-CLICK|PUP/.test(m.text())) log(m.text()); });
  const [ifc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), click(pg.x + pg.w * 0.82, pg.y + pg.h * 0.5)]);
  await ifc.setFiles(path.join(__dirname, '..', 'build', 'icon.png')); await sleep(700);

  // 10. 화이트아웃
  await cmd('tool:whiteout');
  b = await spanBox('작성: 운영팀');
  await drag(b.x - 2, b.y - 2, b.x + b.w + 2, b.y + b.h + 2);

  // 11. 강조·밑줄
  await cmd('tool:highlight');
  b = await spanBox('예산은');
  await drag(b.x - 10, b.y + b.h / 2, b.x + b.w * 0.6, b.y + b.h / 2);
  await cmd('tool:underline');
  b = await spanBox('Response time');
  await drag(b.x + 2, b.y + b.h / 2, b.x + b.w - 2, b.y + b.h / 2);
  await cmd('tool:select');
  await shot('05-annotated');
  log('ANNOTS', JSON.stringify(await state()));

  // 12. 선택해서 옮기기·크기 바꾸기, 삭제, 실행 취소/다시 실행
  const st = await ev(() => { const o = Object.values(window.__pl.S.active.annots).flat().find(o => o.type === 'stamp'); const r = document.querySelector(`.pl-obj[data-id="${o.id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, id: o.id }; });
  await click(st.x + st.w / 2, st.y + st.h / 2);
  await drag(st.x + st.w / 2, st.y + st.h / 2, st.x + st.w / 2 - 60, st.y + st.h / 2 + 30);
  const hs = await ev(() => { const h = document.querySelector('.pl-handle[data-h="se"]'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (hs) await drag(hs.x, hs.y, hs.x + 40, hs.y + 15);
  await shot('06-selected', { x: st.x - 200, y: st.y - 60, width: 500, height: 220 });
  const before = (await state()).length;
  await page.keyboard.press('Delete'); await sleep(200);
  const afterDel = (await state()).length;
  await page.keyboard.press('Control+z'); await sleep(300);
  const afterUndo = (await state()).length;
  await page.keyboard.press('Control+y'); await sleep(300);
  const afterRedo = (await state()).length;
  await page.keyboard.press('Control+z'); await sleep(300);
  log('DELETE/UNDO/REDO', before, afterDel, afterUndo, afterRedo);

  // 13. 찾기
  await page.keyboard.press('Control+f'); await sleep(200);
  await page.keyboard.type('고객'); await sleep(900);
  await page.keyboard.press('Enter'); await sleep(400);
  const findCount = await ev(() => document.getElementById('findCount').textContent);
  log('FIND', findCount);
  await shot('07-find');
  await page.keyboard.press('Escape');

  // 14. 주석 목록
  await ev(() => document.querySelector('[data-nav="comments"]').click()); await sleep(300);
  await shot('08-comments');

  // 15. 저장 (내려받기) → 다시 열어 확인
  const [dl] = await Promise.all([page.waitForEvent('download'), cmd('saveAs')]);
  const saved = path.join(OUT, 'saved.pdf');
  await dl.saveAs(saved);
  log('SAVED', dl.suggestedFilename(), fs.statSync(saved).size);
  await openFile(saved);
  await ev(() => { window.__pl.viewer.currentScaleValue = 'page-width'; }); await sleep(1200);
  await ev(() => document.querySelector('[data-nav="comments"]').click()); await sleep(800);
  log('REOPENED comments', await ev(() => document.getElementById('cmtCount').textContent), JSON.stringify(await ev(() => [...document.querySelectorAll('#navComments .cm-text')].map(e => e.textContent))));
  await shot('09-reopened');

  // 16. 페이지 구성 (논문 PDF): 회전, 삭제, 끌어서 순서 바꾸기, 빈 페이지
  await openFile(path.join(FIX, 'compressed.tracemonkey-pldi-09.pdf'));
  await cmd('organize'); await sleep(1500);
  const cards = page.locator('.og-card');
  log('ORG cards', await cards.count());
  await cards.nth(1).click(); await page.locator('[data-org="rotr"]').click();
  await cards.nth(3).click(); await page.locator('[data-org="delete"]').click(); await sleep(300);
  const c0 = await page.locator('.og-card').nth(0).boundingBox(), c2 = await page.locator('.og-card').nth(2).boundingBox();
  await page.locator('.og-card').nth(0).dragTo(page.locator('.og-card').nth(2), { targetPosition: { x: c2.width - 10, y: c2.height / 2 } }); await sleep(400);
  await page.locator('.og-card').nth(0).click(); await page.locator('[data-org="blank"]').click(); await sleep(400);
  await shot('10-organize');
  const order = await ev(() => window.__pl.S.org.entries.map(e => e.blank ? 'B' : e.src + 1 + (e.rot ? 'r' : '')).join(','));
  log('ORG ORDER', order);
  await page.locator('[data-org="apply"]').click(); await sleep(2000);
  log('PAGES AFTER', await ev(() => window.__pl.S.pdf.numPages));

  // 17. 페이지 번호·워터마크 (대화상자를 실제로 채워서)
  await cmd('pageNumbers'); await sleep(400);
  await page.selectOption('#pnFmt', '{n} / {t}');
  await shot('11-pagenum-dialog');
  await page.locator('.modal-foot .btn.primary').click(); await sleep(1800);
  await cmd('watermark'); await sleep(400);
  await page.fill('#wmText', '사내 한정');
  await page.locator('.modal-foot .btn.primary').click(); await sleep(1800);
  await ev(() => { window.__pl.viewer.currentScaleValue = 'page-fit'; window.__pl.viewer.currentPageNumber = 1; }); await sleep(1200);
  await shot('12-pagenum-watermark');

  // 18. 보기: 두 페이지, 회전, 확대 메뉴
  await cmd('layoutSpread'); await sleep(1200);
  await shot('13-spread');
  await cmd('layoutScroll');

  // 19. 내보내기 (PNG, 텍스트)
  const [png] = await Promise.all([page.waitForEvent('download'), (async () => { await cmd('exportPng'); await sleep(400); await page.locator('.modal-foot .btn.primary').click(); })()]);
  log('PNG', png.suggestedFilename());
  const [txt] = await Promise.all([page.waitForEvent('download'), cmd('exportText')]);
  const txtPath = path.join(OUT, 'export.txt'); await txt.saveAs(txtPath);
  log('TXT', txt.suggestedFilename(), fs.readFileSync(txtPath, 'utf8').slice(0, 60).replace(/\s+/g, ' '));

  // 20. 문서 속성·환경 설정·단축키·정보
  await cmd('properties'); await sleep(500); await shot('14-properties'); await page.keyboard.press('Escape');
  await cmd('prefs'); await sleep(400); await shot('15-prefs'); await page.keyboard.press('Escape');
  await cmd('shortcuts'); await sleep(400); await shot('16-shortcuts'); await page.keyboard.press('Escape');

  // 21. 파일 결합
  const [cfc] = await Promise.all([page.waitForEvent('filechooser'), cmd('combine')]);
  await cfc.setFiles([path.join(FIX, 'korean-report.pdf'), path.join(FIX, 'scanned.pdf')]); await sleep(600);
  await shot('17-combine');
  await page.locator('.modal-foot .btn.primary').click(); await sleep(2000);
  log('COMBINED pages', await ev(() => window.__pl.S.pdf.numPages), await ev(() => window.__pl.S.active.name));

  // 22. 어두운 테마 + 야간 읽기
  await cmd('themeDark'); await cmd('pageDark'); await sleep(800);
  await shot('18-dark-night');
  await cmd('pageDark'); await cmd('themeLight');

  // 23. 휴대폰 너비
  await page.setViewportSize({ width: 412, height: 860 }); await sleep(900);
  await shot('19-phone');
  await ev(() => window.__pl.runCmd('tool:highlight')); await sleep(300);
  await shot('20-phone-tool');
  await page.setViewportSize({ width: 1440, height: 900 }); await sleep(600);

  // 24. 탭 닫기 (저장 안 함 확인 창)
  await cmd('closeTab'); await sleep(500);
  await shot('21-close-dialog');
  await page.keyboard.press('Escape');

  log('EXTERNAL', JSON.stringify(external));
  log('ERRORS', JSON.stringify(errors.slice(0, 10)));
  await browser.close();
})().catch(e => { log('FAIL', e.stack || e); process.exit(1); }).finally(() => process.exit(0));
