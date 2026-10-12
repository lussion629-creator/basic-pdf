// 테스트 하네스: 실제 앱을 띄우고 마우스/키보드 입력으로 기능을 확인한 뒤 화면을 저장한다.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
process.env.PL_FONT = process.env.PL_FONT || path.join(__dirname, 'KoreanTest.ttf');
process.env.PL_TEST_DIR = __dirname;
app.commandLine.appendSwitch('force-device-scale-factor', '1');
require('../app/main.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let win;
const errors = [];

async function js(code) { return win.webContents.executeJavaScript(`(async()=>{ ${code} })()`); }
async function shot(name) { await sleep(400); const img = await win.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('shot', name); }
function mouse(type, x, y, extra = {}) { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra }); }
async function drag(x1, y1, x2, y2, steps = 12) {
  mouse('mouseDown', x1, y1); await sleep(30);
  for (let i = 1; i <= steps; i++) { mouse('mouseMove', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); await sleep(15); }
  mouse('mouseUp', x2, y2); await sleep(150);
}
async function click(x, y) { mouse('mouseDown', x, y); await sleep(30); mouse('mouseUp', x, y); await sleep(200); }
async function type(text) { for (const ch of text) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(10); } }
async function key(k, mods = []) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); await sleep(150); }

app.on('browser-window-created', (_e, w) => {
  win = w;
  w.setSize(1440, 920);
  w.webContents.on('console-message', (_ev, level, msg) => { if (level >= 2) { errors.push(msg); console.log('[console]', msg); } });
  w.webContents.once('did-finish-load', () => main().catch(e => { console.error('TEST FAIL', e); app.exit(1); }));
});

async function main() {
  await sleep(800);
  await js(`window.addEventListener('error',e=>console.error('ERR '+(e.error&&e.error.stack))); window.addEventListener('unhandledrejection',e=>console.error('REJ '+(e.reason&&e.reason.stack))); return 1;`);
  await shot('01-home');
  await js(`await window.__pl.openPath(${JSON.stringify(path.join(__dirname, 'sample.pdf'))}); return 1;`);
  await sleep(1500);
  await shot('02-opened');

  // 텍스트 강조: 첫 줄 문장 드래그
  await js(`window.__pl.runCmd('tool:highlight'); return 1;`);
  let r = await js(`const sp=[...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].filter(s=>s.textContent.includes('매출 목표'))[0]; const b=sp.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};`);
  await drag(r.x + 2, r.y + r.h / 2, r.x + r.w * 0.6, r.y + r.h / 2);
  // 밑줄
  await js(`window.__pl.runCmd('tool:underline'); return 1;`);
  r = await js(`const sp=[...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].filter(s=>s.textContent.includes('quarterly'))[0]; const b=sp.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};`);
  await drag(r.x + 2, r.y + r.h / 2, r.x + r.w - 2, r.y + r.h / 2);

  await js(`window.__pl.viewer.currentScaleValue='page-fit'; return 1;`); await sleep(900);
  // 페이지 1 위치 정보
  const pg = await js(`const b=document.querySelector('.page[data-page-number="1"]').getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};`);
  // 펜
  await js(`window.__pl.runCmd('tool:ink'); return 1;`);
  mouse('mouseDown', pg.x + pg.w * 0.62, pg.y + pg.h * 0.5);
  for (let i = 0; i < 30; i++) { mouse('mouseMove', pg.x + pg.w * (0.62 + i * 0.008), pg.y + pg.h * (0.5 + Math.sin(i / 3) * 0.02)); await sleep(10); }
  mouse('mouseUp', pg.x + pg.w * 0.86, pg.y + pg.h * 0.5); await sleep(200);
  // 화살표
  await js(`window.__pl.runCmd('tool:arrow'); return 1;`);
  await drag(pg.x + pg.w * 0.55, pg.y + pg.h * 0.62, pg.x + pg.w * 0.75, pg.y + pg.h * 0.56);
  // 사각형
  await js(`window.__pl.runCmd('tool:rect'); return 1;`);
  await drag(pg.x + pg.w * 0.6, pg.y + pg.h * 0.66, pg.x + pg.w * 0.9, pg.y + pg.h * 0.74);
  // 텍스트 상자 (한글)
  await js(`window.__pl.runCmd('tool:text'); return 1;`);
  await click(pg.x + pg.w * 0.6, pg.y + pg.h * 0.8);
  await type('검토 완료 - 홍길동');
  await click(pg.x + 20, pg.y + pg.h * 0.95); // 바깥 클릭으로 확정
  // 스탬프
  await js(`window.__pl.runCmd('tool:stamp'); return 1;`);
  await click(pg.x + pg.w * 0.78, pg.y + pg.h * 0.12);
  // 메모
  await js(`window.__pl.runCmd('tool:note'); return 1;`);
  await click(pg.x + pg.w * 0.92, pg.y + pg.h * 0.3);
  await type('이 수치 다시 확인 부탁드립니다.');
  await js(`document.querySelector('#npDone').click(); return 1;`);
  await sleep(200);
  // PDF 텍스트 편집: '9월 30일' 줄 클릭 후 내용 바꾸기
  await js(`window.__pl.runCmd('tool:edittext'); return 1;`);
  r = await js(`const sp=[...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].filter(s=>s.textContent.includes('9월 30일'))[0]; const b=sp.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};`);
  await click(r.x + 10, r.y + r.h / 2);
  await type('각 부서는 10월 15일까지 세부 실행안을 제출해야 한다.');
  await key('Escape');
  await js(`window.__pl.runCmd('tool:select'); return 1;`);
  // 양식 채우기
  r = await js(`const i=document.querySelector('.annotationLayer input[type=text]'); if(!i) return null; const b=i.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};`);
  if (r) { await click(r.x + 10, r.y + r.h / 2); await type('김서연'); }
  await js(`window.__pl.runCmd('tool:select'); document.getElementById('viewerContainer').focus(); return 1;`);
  // 주석 패널
  await js(`document.querySelector('[data-nav="comments"]').click(); return 1;`);
  await shot('03-annotated');

  // 선택 & 속성 막대
  await js(`window.__pl.runCmd('tool:select'); return 1;`);
  const st = await js(`const g=document.querySelector('.pl-obj[data-id]'); const list=Object.values(window.__pl.S.active.annots).flat(); const s=list.find(o=>o.type==='stamp'); const el=document.querySelector('.pl-obj[data-id="'+s.id+'"]'); const b=el.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height};`);
  await click(st.x + st.w / 2, st.y + st.h / 2);
  await shot('04-selected');

  const summary = await js(`const S=window.__pl.S; return Object.values(S.active.annots).flat().map(o=>o.type+(o.text?':'+o.text.slice(0,20):''));`);
  console.log('annots', JSON.stringify(summary));

  // 저장 결과 PDF 만들기
  const out = path.join(__dirname, 'out.pdf');
  await js(`const b = await window.__pl.buildOutput(window.__pl.S.active); await window.host.writeFile(${JSON.stringify(out)}, b); return b.length;`);
  console.log('saved', fs.statSync(out).size);

  // 저장본을 다시 열어 렌더링 확인
  await js(`await window.__pl.openPath(${JSON.stringify(out)}); return 1;`);
  await sleep(1500);
  await js(`document.querySelector('[data-nav="thumbs"]').click(); return 1;`);
  await shot('05-reopened');

  // 페이지 구성
  await js(`window.__pl.runCmd('organize'); return 1;`);
  await sleep(1200);
  await shot('06-organize');
  // 3번째 선택 후 회전, 5번째 삭제, 첫 페이지를 맨 뒤로 이동하는 대신 버튼으로 적용
  await js(`const cards=[...document.querySelectorAll('.og-card')]; cards[2].click(); document.querySelector('[data-org="rotr"]').click(); cards[4].click(); document.querySelector('[data-org="delete"]').click(); return 1;`);
  await sleep(300);
  await js(`await (async()=>{ document.querySelector('[data-org="apply"]').click(); })(); return 1;`);
  await sleep(1800);
  const pc = await js(`return window.__pl.S.pdf.numPages;`);
  console.log('pages after organize', pc);

  // 워터마크 & 페이지 번호 (OPS 직접 호출)
  await js(`const t=window.__pl.S.active; t.bytes = await window.OPS.pageNumbers(t.bytes,{position:'bc',format:'{n} / {t}',start:1,size:10}); t.bytes = await window.OPS.watermark(t.bytes,{text:'대외비',size:72,angle:45,opacity:.2,color:'#d4382c',fit:true}); await window.__pl.S.active && 1; return 1;`);
  await js(`await window.__pl.reload(); return 1;`);
  await sleep(800);
  await js(`window.__pl.viewer.currentScaleValue='page-fit'; window.__pl.runCmd('layoutSpread'); return 1;`);
  await sleep(1200);
  await shot('07-watermark-spread');

  // 다크 테마
  await js(`window.__pl.runCmd('themeDark'); window.__pl.runCmd('pageDark'); window.__pl.runCmd('layoutScroll'); window.__pl.runCmd('tool:sign'); document.getElementById('themeBtn').click(); return 1;`);
  await sleep(800);
  await shot('08-dark');
  await js(`window.__pl.runCmd('pageNumbers'); return 1;`);
  await sleep(500);
  await shot('09-dialog');
  await key('Escape');
  await js(`document.getElementById('themeMenu').hidden=true; window.__pl.runCmd('pageDark'); window.__pl.runCmd('themeLight'); window.__pl.runCmd('toggleTools'); window.__pl.runCmd('find'); document.getElementById('findInput').value='예산'; document.getElementById('findInput').dispatchEvent(new Event('input')); return 1;`);
  await sleep(1200);
  await shot('10-tools-find');

  const sec = await js(`
    const r = {};
    try { await window.host.readFile('/etc/passwd'); r.readOutside = 'ALLOWED'; } catch (e) { r.readOutside = 'blocked'; }
    try { await window.host.writeFile('/tmp/evil.pdf', new Uint8Array([1])); r.writeOutside = 'ALLOWED'; } catch (e) { r.writeOutside = 'blocked'; }
    try { await window.host.writeFile(${JSON.stringify(path.join(__dirname, 'x.exe'))}, new Uint8Array([1])); r.writeExe = 'ALLOWED'; } catch (e) { r.writeExe = 'blocked'; }
    try { await fetch('https://example.com'); r.network = 'ALLOWED'; } catch (e) { r.network = 'blocked'; }
    r.require = typeof require; r.process = typeof process;
    await window.host.sigsSet(['data:image/png;base64,iVBORw0KGgo=']); r.sigs = (await window.host.sigsGet()).length;
    try { await window.host.sigsSet(['javascript:alert(1)']); r.badSig = (await window.host.sigsGet()).length; } catch { r.badSig = 'err'; }
    return r;`);
  console.log('SECURITY', JSON.stringify(sec), 'windows', require('electron').BrowserWindow.getAllWindows().length);
  await js(`window.__pl.runCmd('about'); return 1;`); await sleep(500); await shot('11-about'); console.log('TITLE', await js(`return document.title;`), win.getTitle());
  console.log('ERRORS', errors.length, JSON.stringify(errors.slice(0, 10)));
  app.exit(0);
}
