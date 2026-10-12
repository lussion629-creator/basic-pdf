'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'Basic PDF';
app.setName(APP_NAME);

// 이전 이름(Paperline PDF)으로 쓰던 서명·설정·최근 파일을 새 데이터 폴더로 옮긴다 (처음 한 번)
(function migrateOldData() {
  try {
    const newDir = app.getPath('userData');
    const oldDir = path.join(path.dirname(newDir), 'Paperline PDF');
    if (!fs.existsSync(oldDir) || fs.existsSync(path.join(newDir, '.migrated'))) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const name of ['signatures.bin', 'recent.json', 'Local Storage']) {
      const from = path.join(oldDir, name), to = path.join(newDir, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
    }
    fs.writeFileSync(path.join(newDir, '.migrated'), 'from Paperline PDF');
  } catch {}
})();
if (process.platform === 'win32') app.setAppUserModelId('com.basicpdf.app');

let win = null;
let pendingFiles = [];
let allowClose = false;
const DEV = !app.isPackaged;

/* ---------- 보안: 파일 접근 허용 목록 ----------
   화면(렌더러) 쪽에서 임의 경로를 읽고 쓰지 못하게, 사용자가 직접 고른 파일·폴더만 허용한다. */
const norm = (p) => { try { return path.resolve(String(p)).toLowerCase(); } catch { return ''; } };
const allowRead = new Set();
const allowWrite = new Set();
const allowDirs = new Set();
const WRITE_EXT = /\.(pdf|png|txt)$/i;
const MAX_READ = 1024 * 1024 * 1024; // 1GB
const approveRead = (p) => { if (p) allowRead.add(norm(p)); };
// 개발·자동 테스트 전용 (배포본에서는 동작하지 않음)
const TEST_DIR = DEV && process.env.PL_TEST_DIR ? norm(process.env.PL_TEST_DIR) : null;
const inTestDir = (p) => !!TEST_DIR && norm(p).startsWith(TEST_DIR + path.sep);

// IPC 요청이 앱 자신의 화면에서 왔는지 확인
function trusted(e) {
  try {
    const url = e.senderFrame && e.senderFrame.url;
    return !!win && e.sender === win.webContents && typeof url === 'string' && url.startsWith('file://') && url.endsWith('/renderer/index.html');
  } catch { return false; }
}
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('허용되지 않은 요청입니다.');
    return fn(e, ...args);
  });
}
function on(channel, fn) {
  ipcMain.on(channel, (e, ...args) => { if (trusted(e)) fn(e, ...args); });
}

/* ---------- 보안: 서명은 Windows 계정으로 암호화해 저장 (DPAPI) ---------- */
const sigPath = () => path.join(app.getPath('userData'), 'signatures.bin');
function readSigs() {
  try {
    const raw = fs.readFileSync(sigPath());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.filter(validSig) : [];
  } catch { return []; }
}
function validSig(s) { return typeof s === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 4 * 1024 * 1024; }
function writeSigs(list) {
  const clean = (Array.isArray(list) ? list : []).filter(validSig).slice(0, 6);
  const json = JSON.stringify(clean);
  fs.mkdirSync(path.dirname(sigPath()), { recursive: true });
  if (!clean.length) { try { fs.unlinkSync(sigPath()); } catch {} return clean; }
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.writeFileSync(sigPath(), data);
  return clean;
}

// ---------- 최근 파일 ----------
const recentPath = () => path.join(app.getPath('userData'), 'recent.json');
function readRecent() {
  try { return JSON.parse(fs.readFileSync(recentPath(), 'utf8')).filter(r => r && r.path); } catch { return []; }
}
function addRecent(p) {
  approveRead(p);
  let list = readRecent().filter(r => r.path !== p);
  let size = 0; try { size = fs.statSync(p).size; } catch {}
  list.unshift({ path: p, name: path.basename(p), size, openedAt: Date.now() });
  list = list.slice(0, 20);
  try { fs.mkdirSync(path.dirname(recentPath()), { recursive: true }); fs.writeFileSync(recentPath(), JSON.stringify(list)); } catch {}
  return list;
}

function pdfArgs(argv) {
  const list = argv.slice(1).filter(a => /\.pdf$/i.test(a) && fs.existsSync(a)).map(a => path.resolve(a));
  list.forEach(approveRead);
  return list;
}

// ---------- 단일 인스턴스 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = pdfArgs(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      files.forEach(f => win.webContents.send('open-path', f));
    }
  });
}

function send(cmd, arg) { if (win) win.webContents.send('menu', cmd, arg); }

function buildMenu() {
  const item = (label, cmd, accelerator, extra = {}) => ({ label, accelerator, click: () => send(cmd), ...extra });
  const template = [
    { label: '파일(&F)', submenu: [
      item('열기...', 'open', 'CmdOrCtrl+O'),
      item('파일 결합...', 'combine'),
      { type: 'separator' },
      item('저장', 'save', 'CmdOrCtrl+S'),
      item('다른 이름으로 저장...', 'saveAs', 'CmdOrCtrl+Shift+S'),
      { label: '내보내기', submenu: [
        item('현재 페이지를 PNG 이미지로...', 'exportPng'),
        item('모든 페이지를 PNG 이미지로...', 'exportAllPng'),
        item('텍스트(.txt)로...', 'exportText'),
      ]},
      { type: 'separator' },
      item('인쇄...', 'print', 'CmdOrCtrl+P'),
      { type: 'separator' },
      item('문서 속성...', 'properties', 'CmdOrCtrl+D'),
      { type: 'separator' },
      item('탭 닫기', 'closeTab', 'CmdOrCtrl+W'),
      { label: '끝내기', role: 'quit', accelerator: 'Alt+F4' },
    ]},
    { label: '편집(&E)', submenu: [
      item('실행 취소', 'undo', 'CmdOrCtrl+Z'),
      item('다시 실행', 'redo', 'CmdOrCtrl+Y'),
      { type: 'separator' },
      { label: '잘라내기', role: 'cut' },
      { label: '복사', role: 'copy' },
      { label: '붙여넣기', role: 'paste' },
      { label: '모두 선택', role: 'selectAll' },
      { type: 'separator' },
      item('찾기', 'find', 'CmdOrCtrl+F'),
      item('선택한 주석 삭제', 'deleteSel'),
      { type: 'separator' },
      item('환경 설정...', 'prefs', 'CmdOrCtrl+K'),
      item('개인 정보 지우기...', 'privacyClear'),
    ]},
    { label: '보기(&V)', submenu: [
      item('확대', 'zoomIn', 'CmdOrCtrl+='),
      item('축소', 'zoomOut', 'CmdOrCtrl+-'),
      item('실제 크기', 'zoom100', 'CmdOrCtrl+1'),
      item('페이지 맞춤', 'fitPage', 'CmdOrCtrl+0'),
      item('너비 맞춤', 'fitWidth', 'CmdOrCtrl+2'),
      { type: 'separator' },
      item('시계 방향 회전', 'rotateCw', 'CmdOrCtrl+Shift+='),
      item('시계 반대 방향 회전', 'rotateCcw', 'CmdOrCtrl+Shift+-'),
      { type: 'separator' },
      { label: '페이지 표시', submenu: [
        item('단일 페이지', 'layoutSingle'),
        item('연속 스크롤', 'layoutScroll'),
        item('두 페이지 보기', 'layoutSpread'),
      ]},
      item('탐색 창 표시/숨기기', 'toggleNav', 'F4'),
      item('도구 창 표시/숨기기', 'toggleTools', 'Shift+F4'),
      item('전체 화면 읽기 모드', 'readMode', 'CmdOrCtrl+H'),
      { type: 'separator' },
      item('밝게/어둡게 전환', 'toggleTheme', 'CmdOrCtrl+Shift+L'),
      item('야간 읽기 (페이지도 어둡게)', 'pageDark', 'CmdOrCtrl+Shift+N'),
      ...(DEV ? [{ label: '개발자 도구', role: 'toggleDevTools', accelerator: 'F12' }] : []),
    ]},
    { label: '도구(&T)', submenu: [
      item('페이지 구성', 'organize'),
      item('PDF 편집 (텍스트 편집)', 'tool:edittext'),
      item('서명 채우기', 'tool:sign'),
      item('페이지 번호 추가...', 'pageNumbers'),
      item('워터마크 추가...', 'watermark'),
    ]},
    { label: '도움말(&H)', submenu: [
      item('단축키', 'shortcuts', 'F1'),
      item(`${APP_NAME} 정보`, 'about'),
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f3f3f4',
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: DEV,
      spellcheck: false,
    },
  });
  buildMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.show(); });
  win.webContents.on('did-finish-load', () => {
    pendingFiles.forEach(f => win.webContents.send('open-path', f));
    pendingFiles = [];
  });
  // 새 창은 절대 열지 않는다. PDF 안의 링크는 확인을 받은 뒤 기본 브라우저로만 연다.
  win.webContents.setWindowOpenHandler(({ url }) => { confirmExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); confirmExternal(url); });
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('request-close');
  });
  win.on('closed', () => { win = null; });
}

async function confirmExternal(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return; // file:, javascript:, 사용자 정의 프로토콜 등은 차단
  const shown = url.length > 200 ? url.slice(0, 200) + '…' : url;
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['열기', '취소'], defaultId: 1, cancelId: 1, noLink: true,
    title: '외부 링크 열기',
    message: '문서에 들어 있는 링크를 브라우저에서 열까요?',
    detail: `${shown}\n\n믿을 수 있는 문서의 링크만 여세요. 주소가 예상과 다르면 취소하세요.`,
  });
  if (r.response === 0) shell.openExternal(u.toString());
}

// ---------- IPC ----------
handle('open-dialog', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: typeof opts.title === 'string' ? opts.title : 'PDF 열기',
    properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
    filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
  });
  if (r.canceled) return [];
  r.filePaths.forEach(approveRead);
  return r.filePaths;
});

handle('read-file', async (_e, p) => {
  if (typeof p !== 'string' || !(allowRead.has(norm(p)) || inTestDir(p))) throw new Error('직접 연 파일만 읽을 수 있습니다.');
  const st = await fs.promises.stat(p);
  if (!st.isFile() || st.size > MAX_READ) throw new Error('파일을 열 수 없습니다.');
  const buf = await fs.promises.readFile(p);
  if (/\.pdf$/i.test(p)) addRecent(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

// 끌어다 놓은 파일: 경로는 preload가 실제 File 객체에서만 얻어 온다
handle('read-dropped', async (_e, p) => {
  if (typeof p !== 'string' || !p || !/\.pdf$/i.test(p)) throw new Error('PDF 파일만 열 수 있습니다.');
  approveRead(p);
  return path.resolve(p);
});

handle('save-dialog', async (_e, opts = {}) => {
  const kind = opts.kind === 'png' ? 'png' : opts.kind === 'txt' ? 'txt' : 'pdf';
  const filters = { pdf: [{ name: 'PDF 문서', extensions: ['pdf'] }], png: [{ name: 'PNG 이미지', extensions: ['png'] }], txt: [{ name: '텍스트', extensions: ['txt'] }] }[kind];
  const r = await dialog.showSaveDialog(win, {
    title: typeof opts.title === 'string' ? opts.title : '다른 이름으로 저장',
    defaultPath: typeof opts.defaultPath === 'string' ? opts.defaultPath : undefined,
    filters,
  });
  if (r.canceled || !r.filePath) return null;
  allowWrite.add(norm(r.filePath));
  return r.filePath;
});

handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: '저장할 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  allowDirs.add(norm(r.filePaths[0]));
  return r.filePaths[0];
});

handle('write-file', async (_e, p, data) => {
  if (typeof p !== 'string' || !WRITE_EXT.test(p)) throw new Error('저장할 수 없는 파일 형식입니다.');
  const n = norm(p);
  const okDir = allowDirs.has(norm(path.dirname(p)));
  if (!allowWrite.has(n) && !okDir && !inTestDir(p)) throw new Error('직접 고른 위치에만 저장할 수 있습니다.');
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new Error('잘못된 데이터입니다.');
  const tmp = p + '.basicpdf-tmp';
  await fs.promises.writeFile(tmp, Buffer.from(data));
  await fs.promises.rename(tmp, p);
  approveRead(p);
  if (/\.pdf$/i.test(p)) addRecent(p);
  return true;
});

handle('join-path', (_e, a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || /[\\/]/.test(b) || b === '..' || b === '.') throw new Error('잘못된 파일 이름입니다.');
  return path.join(a, b);
});
handle('recent', () => readRecent().filter(r => fs.existsSync(r.path)));
handle('recent-remove', (_e, p) => {
  const list = readRecent().filter(r => r.path !== p);
  try { fs.writeFileSync(recentPath(), JSON.stringify(list)); } catch {}
  return list;
});
handle('show-in-folder', (_e, p) => {
  const n = norm(p);
  if (allowRead.has(n) || allowWrite.has(n)) shell.showItemInFolder(p);
});

handle('sigs-get', () => readSigs());
handle('sigs-set', (_e, list) => writeSigs(list));
handle('privacy-clear', () => {
  writeSigs([]);
  try { fs.unlinkSync(recentPath()); } catch {}
  allowRead.clear();
  return true;
});
handle('secure-info', () => ({ encrypted: safeStorage.isEncryptionAvailable() }));

handle('system-font', async () => {
  // 한글을 PDF에 넣기 위한 시스템 글꼴 (Windows: 맑은 고딕)
  const candidates = [
    'C:\\Windows\\Fonts\\malgun.ttf',
    'C:\\Windows\\Fonts\\NanumGothic.ttf',
    'C:\\Windows\\Fonts\\gulim.ttc',
    '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];
  const boldOf = {
    'malgun.ttf': 'C:\\Windows\\Fonts\\malgunbd.ttf',
    'NanumGothic.ttf': 'C:\\Windows\\Fonts\\NanumGothicBold.ttf',
    'DejaVuSans.ttf': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  };
  if (DEV && process.env.PL_FONT) candidates.unshift(process.env.PL_FONT);
  for (const c of candidates) {
    if (c.endsWith('.ttc')) continue;
    try {
      const b = await fs.promises.readFile(c);
      const name = path.basename(c);
      let bold = null;
      if (boldOf[name]) { try { bold = new Uint8Array(await fs.promises.readFile(boldOf[name])); } catch {} }
      return { name, data: new Uint8Array(b), bold };
    } catch {}
  }
  return null;
});

handle('print', async () => {
  return new Promise((resolve) => {
    win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, reason }));
  });
});

on('set-title', (_e, t) => { if (win && typeof t === 'string') win.setTitle(t.slice(0, 300)); });
on('set-fullscreen', (_e, v) => { if (win) win.setFullScreen(!!v); });
on('confirm-close', () => { allowClose = true; if (win) win.close(); });
handle('app-info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform }));

/* ---------- 보안: 세션·웹 콘텐츠 잠금 ---------- */
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

function lockSession() {
  const ses = session.defaultSession;
  // 카메라·마이크·위치·알림 등 모든 권한 요청 거부
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // 오프라인 앱: 어떤 외부 네트워크 요청도 내보내지 않음 (PDF 안의 원격 리소스 포함)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_d, cb) => cb({ cancel: true }));
  ses.on('will-download', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  lockSession();
  readRecent().forEach(r => approveRead(r.path));
  pendingFiles = pdfArgs(process.argv);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
