// 실제 문서처럼 만든 PDF에서 사용자가 한 것과 같은 동작으로 형광펜을 칠해 본다.
//   node test/hl-real.js URL 파일 접두어
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [URL, FILE, TAG] = [process.argv[2] || 'http://127.0.0.1:8765/', process.argv[3] || 'office-wide.pdf', process.argv[4] || 'x'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(URL); await sleep(600);
  const b64 = fs.readFileSync(path.join(__dirname, 'fixtures', FILE)).toString('base64');
  await page.evaluate(async ([b64, n]) => { const t = await window.host.openDropped(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n)); await window.__pl.openPath(t); window.__pl.viewer.currentScaleValue = '1.6'; }, [b64, FILE]);
  await sleep(1800);
  await page.evaluate(() => window.__pl.runCmd('tool:highlight')); await sleep(400);
  // 글자 위치: 줄 단위가 아니라 실제 글자 상자로 찾는다
  const charBox = (t, k = 0) => page.evaluate(([t, k]) => {
    for (const sp of document.querySelectorAll('.textLayer span')) {
      const node = [...sp.childNodes].find(n => n.nodeType === 3); if (!node) continue;
      const i = node.textContent.indexOf(t); if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + k); r.setEnd(node, i + k + 1);
      const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, [t, k]);
  const spans = await page.evaluate(() => [...document.querySelectorAll('.textLayer span')].slice(0, 6).map(s => { const r = s.getBoundingClientRect(); return `${JSON.stringify(s.textContent.slice(0, 12))} top=${r.top.toFixed(0)} h=${r.height.toFixed(0)} w=${r.width.toFixed(0)} fs=${getComputedStyle(s).fontSize} tf=${s.style.transform}`; }));
  console.log(spans.join('\n'));
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 14; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 14, a.y + (b.y - a.y) * i / 14); await sleep(12); } await page.mouse.up(); await sleep(400); };
  // 1) 단어 두 개를 각각 끌어서
  let a = await charBox('훨씬'), b = await charBox('훨씬', 1); await drag({ x: a.x - 6, y: a.y }, { x: b.x + 6, y: b.y });
  a = await charBox('총체적인'), b = await charBox('총체적인', 3); await drag({ x: a.x - 6, y: a.y }, { x: b.x + 6, y: b.y });
  // 2) "가는"부터 "수"까지 여러 줄
  a = await charBox('정치가는', 2); b = await charBox('말할 수', 3);
  await drag({ x: a.x - 5, y: a.y }, { x: b.x + 5, y: b.y });
  const res = await page.evaluate(() => Object.values(window.__pl.S.active.annots).flat().map(o => ({ n: o.rects.length, h: o.rects.map(r => r[3].toFixed(1)).join(','), text: (o.text || '').slice(0, 40) })));
  console.log(JSON.stringify(res));
  const pg = await page.evaluate(() => { const r = document.querySelector('.page').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const t = await charBox('복잡하게');
  await page.screenshot({ path: path.join(__dirname, 'shots', `hl-real-${TAG}.png`), clip: { x: Math.max(0, t.x - 40), y: Math.max(0, t.y - 40), width: 900, height: 330 } });
  await browser.close();
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
