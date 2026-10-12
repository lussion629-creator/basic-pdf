// 웹 버전 빌드: app/renderer 를 바탕으로 브라우저용 파일을 만든다.
//   node build/build-web.js            → docs/ (GitHub Pages용)
//   node build/build-web.js --artifact → dist/web-artifact/ (claude.ai 웹 페이지용)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'renderer');
const artifact = process.argv.includes('--artifact');
const OUT = artifact ? path.join(ROOT, 'dist', 'web-artifact') : path.join(ROOT, 'docs');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1) 렌더러 파일 복사
for (const f of ['app.js', 'annots.js', 'pdfops.js', 'styles.css']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
fs.cpSync(path.join(SRC, 'vendor'), path.join(OUT, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'web', 'web-host.js'), path.join(OUT, 'web-host.js'));
fs.copyFileSync(path.join(ROOT, 'node_modules', 'fflate', 'umd', 'index.js'), path.join(OUT, 'vendor', 'fflate.min.js'));
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'web', 'fonts', 'NotoSansKR-Hangul.ttf'), path.join(OUT, 'fonts', 'NotoSansKR-Hangul.ttf'));
fs.copyFileSync(path.join(ROOT, 'web', 'fonts', 'OFL.txt'), path.join(OUT, 'fonts', 'OFL.txt'));
fs.copyFileSync(path.join(ROOT, 'build', 'icon.png'), path.join(OUT, 'icon.png'));

// 2) index.html 고치기
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// 웹 메뉴 (데스크톱의 메뉴 막대를 대신함)
const webMenu = `
      <div class="dropdown">
        <button class="tbtn has-caret" id="webMenuBtn" title="메뉴"><i data-lucide="menu"></i><i data-lucide="chevron-down" class="caret"></i></button>
        <div class="menu right" id="webMenu" hidden>
          <button data-cmd="open"><i data-lucide="folder-open"></i>열기</button>
          <button data-cmd="combine"><i data-lucide="files"></i>파일 결합</button>
          <button data-cmd="save" data-needs-doc><i data-lucide="save"></i>저장</button>
          <button data-cmd="saveAs" data-needs-doc><i data-lucide="download"></i>다른 이름으로 저장</button>
          <button data-cmd="print" data-needs-doc><i data-lucide="printer"></i>인쇄</button>
          <button data-cmd="closeTab" data-needs-doc><i data-lucide="x"></i>탭 닫기</button>
          <hr>
          <button data-cmd="exportPng" data-needs-doc><i data-lucide="image-down"></i>현재 페이지를 PNG로</button>
          <button data-cmd="exportAllPng" data-needs-doc><i data-lucide="images"></i>모든 페이지를 PNG로</button>
          <button data-cmd="exportText" data-needs-doc><i data-lucide="file-text"></i>텍스트(.txt)로</button>
          <hr>
          <button data-cmd="organize" data-needs-doc><i data-lucide="layout-grid"></i>페이지 구성</button>
          <button data-cmd="pageNumbers" data-needs-doc><i data-lucide="hash"></i>페이지 번호 추가</button>
          <button data-cmd="watermark" data-needs-doc><i data-lucide="droplet"></i>워터마크 추가</button>
          <button data-cmd="properties" data-needs-doc><i data-lucide="info"></i>문서 속성</button>
          <hr>
          <button data-cmd="prefs"><i data-lucide="settings"></i>환경 설정</button>
          <button data-cmd="privacyClear"><i data-lucide="shield-check"></i>개인 정보 지우기</button>
          <button data-cmd="shortcuts"><i data-lucide="keyboard"></i>단축키</button>
          <button data-cmd="about"><i data-lucide="circle-help"></i>Basic PDF 정보</button>
          <a class="menu-link" href="https://github.com/lussion629-creator/basic-pdf" target="_blank" rel="noopener noreferrer"><i data-lucide="monitor-down"></i>Windows 앱 받기</a>
        </div>
      </div>`;
const anchor = '<button class="btn primary small" data-cmd="saveAs" data-needs-doc>';
if (!html.includes(anchor)) throw new Error('메뉴를 넣을 위치를 찾지 못했습니다.');
html = html.replace(anchor, webMenu.trim() + '\n      ' + anchor);

// 스크립트: web-host 를 가장 먼저
html = html.replace('<script src="vendor/pdf.min.js"></script>', '<script src="web-host.js"></script>\n<script src="vendor/fflate.min.js"></script>\n<script src="vendor/pdf.min.js"></script>');
html = html.replace('<title>Basic PDF</title>', '<title>Basic PDF</title>\n<meta name="description" content="브라우저에서 바로 쓰는 PDF 리더·편집기. 파일은 서버로 전송되지 않습니다.">\n<link rel="icon" href="icon.png">');

const extraCss = `
<style>
.menu .menu-link { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 6px; color: inherit; text-decoration: none; white-space: nowrap; }
.menu .menu-link:hover { background: var(--hover); }
.menu .menu-link svg { width: 16px; height: 16px; color: var(--fg-2); }
.menu button:disabled { opacity: .4; pointer-events: none; }
#webMenu { max-height: calc(100vh - 110px); overflow-y: auto; }
@media (max-width: 760px) { .tb-title { display: none; } .tb-group.right .btn.primary { display: none; } }
</style>`;

if (artifact) {
  // claude.ai 웹 페이지: 문서 골격(html/head/body)은 게시할 때 씌워지므로 내용만 남긴다
  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  const headClean = head
    .replace(/<meta charset[^>]*>\s*/i, '')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
  html = headClean.trim() + extraCss + '\n<style>html, body { height: 100%; } body { margin: 0; }</style>\n' + body.trim() + '\n';
} else {
  html = html.replace('</head>', extraCss + '\n</head>');
  // GitHub Pages: 외부 접속을 모두 막는 CSP 유지 (글꼴은 같은 사이트에서 읽음)
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);
if (!artifact) fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// 3) 확인
const must = ['index.html', 'web-host.js', 'app.js', 'vendor/pdf.worker.min.js', 'vendor/fflate.min.js', 'fonts/NotoSansKR-Hangul.ttf'];
for (const m of must) if (!fs.existsSync(path.join(OUT, m))) throw new Error('빠진 파일: ' + m);
let count = 0, size = 0;
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else { count++; size += s.size; } } })(OUT);
console.log(`웹 버전 → ${path.relative(ROOT, OUT)} (${count}개 파일, ${(size / 1048576).toFixed(1)} MB)`);
