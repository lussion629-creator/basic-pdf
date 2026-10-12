'use strict';
/* Basic PDF — 렌더러 */
// window.host 는 preload에서 노출됨
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const icons = (root) => { try { lucide.createIcons({ root: root || document, attrs: { 'stroke-width': 1.75 } }); } catch { lucide.createIcons(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const basename = (p) => String(p).split(/[\\/]/).pop();
const stripExt = (n) => n.replace(/\.pdf$/i, '');
const fmtSize = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtDate = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmtShort = (t) => { const d = new Date(t), now = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.toDateString() === now.toDateString() ? `오늘 ${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}월 ${d.getDate()}일`; };

const store = {
  get(k, d) { try { const v = localStorage.getItem('pl.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pl.' + k, JSON.stringify(v)); } catch {} },
};

/* ======================= 상태 ======================= */
const DRAW_TOOLS = ['ink', 'rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'stamp', 'sign', 'image', 'whiteout'];
const MARKUP_TOOLS = ['highlight', 'underline', 'strike'];
const STICKY_TOOLS = ['ink', 'rect', 'ellipse', 'line', 'arrow', 'whiteout', ...MARKUP_TOOLS];
const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];

const S = {
  tabs: [], active: null, pdf: null, docToken: 0,
  tool: 'select', sel: null, editing: null, notePop: null,
  sigArmed: null, org: null,
  opts: Object.assign({
    highlight: { color: '#ffd400', opacity: 1 },
    underline: { color: '#2f6fde', opacity: 1 },
    strike: { color: '#e0332f', opacity: 1 },
    ink: { color: '#e0332f', width: 2, opacity: 1 },
    shape: { color: '#e0332f', fill: null, width: 2, opacity: 1 },
    text: { color: '#1a1a1a', fontSize: 12, bold: false, bg: null, border: false },
    note: { color: '#ffd400' },
    stamp: { index: 0 },
    shapeKind: 'rect',
  }, store.get('opts', {})),
  prefs: Object.assign({ author: '', theme: 'system', zoom: 'auto' }, store.get('prefs', {})),
};
const saveOpts = () => store.set('opts', S.opts);
/* 서명: 앱 데이터 폴더에 Windows 계정 기준으로 암호화해 보관 (브라우저 저장소에 두지 않음) */
let sigCache = [];
const sigsList = () => sigCache;
function saveSigs(list) { sigCache = list; host.sigsSet(list).then(v => { sigCache = v; }).catch(() => toast('서명을 저장하지 못했습니다.', 'err')); }
async function loadSigs() {
  try {
    sigCache = await host.sigsGet();
    const legacy = store.get('sigs', null); // 이전 버전에서 암호화 없이 저장된 서명 옮기기
    if (Array.isArray(legacy) && legacy.length) {
      sigCache = await host.sigsSet([...sigCache, ...legacy].slice(0, 6));
      try { localStorage.removeItem('pl.sigs'); } catch {}
    }
  } catch { sigCache = []; }
}
const author = () => S.prefs.author || '사용자';
const cur = () => S.active;

/* ======================= 테마 ======================= */
function applyTheme() {
  const t = S.prefs.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function applyPageDark() {
  document.body.classList.toggle('page-dark', !!S.prefs.pageDark);
  const b = document.getElementById('pageDarkBtn');
  if (b) b.classList.toggle('on', !!S.prefs.pageDark);
}
function effectiveDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
applyTheme();

/* ======================= 공용 UI ======================= */
let toastTimer;
function toast(msg, kind = '', action) {
  if (action && host.noFolders && /폴더/.test(action.label)) action = null; // 웹: 폴더를 열 수 없음
  const t = $('#toast');
  t.className = 'toast ' + kind;
  t.innerHTML = `${ic(kind === 'err' ? 'circle-alert' : kind === 'ok' ? 'circle-check' : 'info')}<span>${esc(msg)}</span>` + (action ? `<button>${esc(action.label)}</button>` : '');
  icons(t);
  if (action) t.querySelector('button').onclick = () => { action.run(); t.hidden = true; };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3200);
}

function modal({ title, body = '', buttons = [{ label: '확인', value: true, kind: 'primary' }], wide = false, onOpen, collect }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-head"></div><div class="modal-body"></div><div class="modal-foot"></div></div>`;
    back.querySelector('.modal-head').textContent = title;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const foot = back.querySelector('.modal-foot');
    let primary = null;
    const done = (value) => {
      const data = (value !== null && collect) ? collect(back) : undefined;
      if (value !== null && data === false) return; // 검증 실패
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve({ value, data });
    };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn ${b.kind || ''} ${b.left ? 'left' : ''}`;
      btn.innerHTML = (b.icon ? ic(b.icon) : '') + esc(b.label);
      btn.onclick = () => done(b.value);
      if (b.kind === 'primary' || b.kind === 'danger') primary = primary || btn;
      foot.append(btn);
    }
    if (!buttons.length) foot.remove();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && primary && !(e.target.tagName === 'TEXTAREA') && !e.isComposing) { e.preventDefault(); e.stopPropagation(); primary.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
    $('#modalRoot').append(back);
    icons(back);
    const first = back.querySelector('input, select, textarea');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
    else if (primary) primary.focus();
    onOpen && onOpen(back, done);
  });
}
const alertBox = (title, text) => modal({ title, body: `<p>${esc(text)}</p>` });

function progressModal(title) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><div class="modal-head">${esc(title)}</div><div class="modal-body"><p class="pm-text">준비 중…</p><div class="progress"><div></div></div></div><div class="modal-foot"></div></div>`;
  $('#modalRoot').append(back);
  return {
    set(text, ratio) { back.querySelector('.pm-text').textContent = text; back.querySelector('.progress > div').style.width = `${Math.round(ratio * 100)}%`; },
    close() { back.remove(); },
  };
}

/* ======================= pdf.js 뷰어 ======================= */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
// 절대 경로로 넘긴다: 웹에서는 워커가 직접 받아 오는데, 상대 경로면 워커 위치(vendor/) 기준이 되어 찾지 못함
const absUrl = (p) => new URL(p, document.baseURI).href;
const PDFJS_OPTS = { cMapUrl: absUrl('vendor/cmaps/'), cMapPacked: true, standardFontDataUrl: absUrl('vendor/standard_fonts/'), isEvalSupported: false };
const container = $('#viewerContainer');
const viewerEl = $('#viewer');
const eventBus = new pdfjsViewer.EventBus();
const linkService = new pdfjsViewer.PDFLinkService({ eventBus, externalLinkTarget: 2 });
const findController = new pdfjsViewer.PDFFindController({ eventBus, linkService });
const viewer = new pdfjsViewer.PDFViewer({
  container, viewer: viewerEl, eventBus, linkService, findController,
  textLayerMode: 1, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE, removePageBorders: true, imageResourcesPath: 'vendor/images/',
});
linkService.setViewer(viewer);
const ScrollMode = pdfjsViewer.ScrollMode || { VERTICAL: 0, PAGE: 3 };
const SpreadMode = pdfjsViewer.SpreadMode || { NONE: 0, ODD: 1 };

function once(evt) { return new Promise(res => { const h = (e) => { eventBus.off(evt, h); res(e); }; eventBus.on(evt, h); }); }

async function openPdfjs(bytes, tab) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(), password: tab && tab.password, ...PDFJS_OPTS });
  task.onPassword = async (update, reason) => {
    const { value, data } = await modal({
      title: '암호로 보호된 문서',
      body: `<p>${reason === 2 ? '암호가 올바르지 않습니다. 다시 입력하세요.' : '이 문서를 열려면 암호가 필요합니다.'}</p><label class="field"><span>암호</span><input type="password" id="pwIn"></label>`,
      buttons: [{ label: '취소', value: null }, { label: '열기', value: true, kind: 'primary' }],
      collect: (r) => r.querySelector('#pwIn').value,
    });
    if (value) { if (tab) tab.password = data; update(data); } else { task.destroy(); }
  };
  return task.promise;
}

async function loadIntoViewer(tab, restore = true) {
  const token = ++S.docToken;
  const pdf = await openPdfjs(tab.bytes, tab);
  if (token !== S.docToken) { pdf.destroy(); return; }
  const old = S.pdf;
  S.pdf = pdf;
  tab.pageCount = pdf.numPages;
  pdf.annotationStorage.onSetModified = () => { tab.formDirty = true; setDirty(tab, true); };
  const init = once('pagesinit');
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  await init;
  const vs = restore && tab.view;
  viewer.scrollMode = vs ? vs.scrollMode : ScrollMode.VERTICAL;
  viewer.spreadMode = vs ? vs.spreadMode : SpreadMode.NONE;
  viewer.pagesRotation = vs ? vs.rotation : 0;
  viewer.currentScaleValue = vs ? vs.scale : (S.prefs.zoom || 'auto');
  if (vs) {
    viewer.currentPageNumber = Math.min(vs.page, pdf.numPages);
    if (vs.scrollTop != null) { container.scrollTop = vs.scrollTop; container.scrollLeft = vs.scrollLeft; }
  }
  if (old && old !== pdf) setTimeout(() => old.destroy(), 0);
  $('#pageTotal').textContent = `/ ${pdf.numPages}`;
  $('#pageInput').value = viewer.currentPageNumber;
  updateZoomLabel();
  buildThumbs();
  buildOutline();
  renderComments();
  refreshFind();
}

function saveViewState(tab) {
  if (!tab || !S.pdf || !viewer.pdfDocument) return;
  tab.view = {
    scale: viewer.currentScaleValue, rotation: viewer.pagesRotation, page: viewer.currentPageNumber,
    scrollTop: container.scrollTop, scrollLeft: container.scrollLeft,
    scrollMode: viewer.scrollMode, spreadMode: viewer.spreadMode,
  };
}

async function captureForms(tab) {
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('.annotationLayer')) { ae.blur(); await sleep(0); }
  if (tab && tab === S.active && S.pdf && tab.formDirty) {
    try { tab.bytes = await S.pdf.saveDocument(); tab.formDirty = false; }
    catch (e) { console.warn('양식 값 저장 실패', e); }
  }
}

/* ======================= 탭 ======================= */
let tabSeq = 0;
function newTab({ name, path = null, bytes, dirty = false }) {
  return { id: ++tabSeq, name, path, bytes, annots: {}, history: [], future: [], dirty, formDirty: false, view: null, meta: null, password: null };
}

async function openPath(p, after) {
  const existing = S.tabs.find(t => t.path && t.path.toLowerCase() === p.toLowerCase());
  if (existing) { await activateTab(existing); after && runCmd(after); return; }
  let bytes;
  try { bytes = await host.readFile(p); }
  catch (e) { toast(`파일을 열 수 없습니다: ${basename(p)}`, 'err'); return; }
  const tab = newTab({ name: basename(p), path: p, bytes });
  S.tabs.push(tab);
  const ok = await activateTab(tab);
  if (ok && after) runCmd(after);
}

async function openDialog(after) {
  const files = await host.openDialog({ multi: true });
  for (const f of files) await openPath(f, files.length === 1 ? after : null);
}

async function activateTab(tab) {
  if (S.active === tab) return true;
  if (S.org) closeOrganizer();
  commitEdit(); closeNotePop();
  if (S.active) { saveViewState(S.active); await captureForms(S.active); }
  S.active = tab; S.sel = null;
  showViewer(true);
  renderTabs();
  try {
    await loadIntoViewer(tab, true);
  } catch (e) {
    console.error(e && e.stack || e);
    const msg = /password/i.test(String(e && e.name)) ? '암호를 입력하지 않아 문서를 열지 못했습니다.' : `PDF를 읽을 수 없습니다. 파일이 손상되었거나 PDF가 아닐 수 있습니다.`;
    toast(msg, 'err');
    S.tabs = S.tabs.filter(t => t !== tab);
    S.active = null;
    goHome();
    return false;
  }
  updateChrome();
  return true;
}

function goHome() {
  if (S.org) closeOrganizer();
  commitEdit(); closeNotePop();
  if (S.active) { saveViewState(S.active); captureForms(S.active); }
  S.active = null; S.sel = null;
  showViewer(false);
  renderTabs(); renderRecent(); updateChrome();
}

function showViewer(on) {
  $('#viewerWrap').hidden = !on;
  $('#home').hidden = on;
  $('#navPanel').hidden = !on || !S.navOpen;
}

async function closeTab(tab) {
  if (tab.dirty) {
    if (S.active !== tab) await activateTab(tab);
    const r = await askSave(tab);
    if (r === 'cancel') return false;
    if (r === 'save' && !(await saveTab(tab))) return false;
  }
  const idx = S.tabs.indexOf(tab);
  S.tabs.splice(idx, 1);
  if (S.active === tab) {
    S.active = null;
    const next = S.tabs[idx] || S.tabs[idx - 1];
    if (next) await activateTab(next); else { if (S.pdf) { S.pdf.destroy(); S.pdf = null; } goHome(); }
  } else renderTabs();
  return true;
}

async function askSave(tab) {
  const { value } = await modal({
    title: '변경 사항을 저장할까요?',
    body: `<p><b>${esc(tab.name)}</b>에 저장하지 않은 변경 사항이 있습니다. 저장하지 않으면 변경 내용이 사라집니다.</p>`,
    buttons: [{ label: '저장 안 함', value: 'discard', left: true }, { label: '취소', value: 'cancel' }, { label: '저장', value: 'save', kind: 'primary' }],
  });
  return value || 'cancel';
}

function renderTabs() {
  const wrap = $('#tabs');
  wrap.innerHTML = '';
  for (const t of S.tabs) {
    const b = document.createElement('div');
    b.className = 'tab' + (t === S.active ? ' on' : '');
    b.title = t.path || t.name;
    b.innerHTML = `<span class="ticon">${ic('file-text')}</span><span class="tname"></span>${t.dirty ? '<span class="tdot" title="저장 안 됨"></span>' : ''}<button class="tclose" title="닫기 (Ctrl+W)">${ic('x')}</button>`;
    b.querySelector('.tname').textContent = t.name;
    b.addEventListener('pointerdown', (e) => { if (!e.target.closest('.tclose') && e.button === 0) activateTab(t); });
    b.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(t); });
    b.querySelector('.tclose').onclick = (e) => { e.stopPropagation(); closeTab(t); };
    wrap.append(b);
  }
  $('#homeTab').classList.toggle('on', !S.active);
  icons(wrap);
}

function setDirty(tab, v) {
  if (!tab) return;
  const was = tab.dirty;
  tab.dirty = v;
  if (was !== v) renderTabs();
  if (tab === S.active) updateTitle();
}

function updateTitle() {
  const t = S.active;
  $('#docTitle').textContent = t ? t.name + (t.dirty ? ' •' : '') : '';
  host.setTitle(t ? `${t.name}${t.dirty ? ' *' : ''} — Basic PDF` : 'Basic PDF');
}

function updateChrome() {
  const has = !!S.active;
  document.body.classList.toggle('no-doc', !has);
  $$('[data-needs-doc]').forEach(b => { b.disabled = !has; });
  updateTitle();
  updateUndoButtons();
  setTool(S.tool, true);
  applyNav();
}

function updateUndoButtons() {
  const t = S.active;
  const u = $('[data-cmd="undo"]', $('#toolbar')), r = $('[data-cmd="redo"]', $('#toolbar'));
  if (u) u.disabled = !t || !t.history.length;
  if (r) r.disabled = !t || !t.future.length;
}

/* ======================= 최근 파일 ======================= */
async function renderRecent() {
  const list = await host.recent();
  const el = $('#recentList');
  if (!list.length) {
    const msg = host.web && !host.recentSupported ? '이 브라우저에서는 최근 파일을 기억하지 않습니다. 파일 열기나 끌어다 놓기로 문서를 여세요.' : '최근에 연 파일이 여기에 표시됩니다.';
    el.innerHTML = `<div class="empty">${ic('clock')}${msg}</div>`;
    icons(el); return;
  }
  el.innerHTML = `<div class="rrow head"><span></span><span>이름</span><span>크기</span><span>열어 본 시간</span><span></span></div>` +
    list.map((r, i) => `<div class="rrow" data-i="${i}"><span class="rfile">${ic('file-text')}</span><span class="rname"><b>${esc(r.name)}</b><small>${esc(host.web ? '이 브라우저에서 연 파일' : r.path)}</small></span><span class="rmeta">${fmtSize(r.size || 0)}</span><span class="rmeta">${fmtShort(r.openedAt)}</span><span class="ract">${host.noFolders ? '' : `<button class="ibtn" data-act="folder" title="폴더에서 보기">${ic('folder')}</button>`}<button class="ibtn" data-act="remove" title="목록에서 제거">${ic('x')}</button></span></div>`).join('');
  icons(el);
  $$('.rrow[data-i]', el).forEach(row => {
    const r = list[+row.dataset.i];
    row.ondblclick = () => openPath(r.path);
    row.onclick = (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return openPath(r.path);
      e.stopPropagation();
      if (act.dataset.act === 'folder') host.showInFolder(r.path);
      if (act.dataset.act === 'remove') host.recentRemove(r.path).then(renderRecent);
    };
  });
}

/* ======================= 주석 오버레이 ======================= */
function annotsOf(tab, pi) { return (tab.annots[pi] = tab.annots[pi] || []); }
function findObj(tab, pi, id) { return (tab.annots[pi] || []).find(o => o.id === id); }

function pageMatrix(pv) {
  const [a, b, c, d, e, f] = pv.viewport.transform;
  const v = pv.pdfPage ? pv.pdfPage.view : [0, 0, pv.viewport.viewBox[2], pv.viewport.viewBox[3]];
  return [a, b, -c, -d, a * v[0] + c * v[3] + e, b * v[0] + d * v[3] + f];
}

function ensureOverlay(pi) {
  const pv = viewer.getPageView(pi);
  if (!pv || !pv.div || !pv.viewport) return null;
  let svg = pv.div.querySelector(':scope > svg.pl-overlay');
  if (!svg) {
    svg = svgEl('svg', { class: 'pl-overlay' });
    svg.dataset.page = pi;
    svg.append(svgEl('g', { class: 'pl-root' }));
    svg.addEventListener('pointerdown', onOverlayDown);
    svg.addEventListener('dblclick', onOverlayDbl);
    pv.div.append(svg);
  }
  let hl = pv.div.querySelector(':scope > svg.pl-hl');
  if (!hl) {
    hl = svgEl('svg', { class: 'pl-hl' });
    hl.append(svgEl('g'));
    const cw = pv.div.querySelector(':scope > .canvasWrapper');
    if (cw) cw.after(hl); else pv.div.prepend(hl);
  }
  const vp = pv.viewport;
  const m = pageMatrix(pv);
  for (const s of [svg, hl]) {
    s.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
    s.setAttribute('preserveAspectRatio', 'none');
    s.firstChild.setAttribute('transform', `matrix(${m.join(' ')})`);
  }
  const g = svg.firstChild;
  svg.classList.toggle('active', DRAW_TOOLS.includes(S.tool));
  svg.classList.toggle('place', ['text', 'note', 'stamp', 'sign', 'image'].includes(S.tool));
  return { svg, g, hl: hl.firstChild, pv, scale: Math.hypot(m[0], m[1]) };
}

function drawPage(pi) {
  const tab = S.active;
  if (!tab) return;
  const ov = ensureOverlay(pi);
  if (!ov) return;
  const { g, hl, scale } = ov;
  if (S.editing && S.editing.pi === pi) {
    // 다시 그리기 전에 입력 중인 글자를 보존
    const live = g.querySelector(`.pl-obj[data-id="${S.editing.id}"] .pl-fo-text.editing`);
    const eo = findObj(tab, pi, S.editing.id);
    if (live && eo) eo.text = live.innerText.replace(/\n$/, '');
  }
  g.textContent = '';
  hl.textContent = '';
  for (const o of tab.annots[pi] || []) {
    const fresh = justAdded.has(o.id);
    if (o.type === 'highlight') { const h = ANN.renderHL(o); if (fresh) h.classList.add('pop'); hl.append(h); }
    const el = ANN.render(o, scale);
    if (fresh && ['stamp', 'note', 'image', 'signature'].includes(o.type)) el.classList.add('pop');
    g.append(el);
  }
  if (S.sel && S.sel.pi === pi) {
    const o = findObj(tab, pi, S.sel.id);
    if (o) g.append(selectionEl(o, scale));
  }
  if (S.editing && S.editing.pi === pi) attachEditor();
}

function redrawAll() {
  if (!S.active || !S.pdf) return;
  for (let i = 0; i < S.pdf.numPages; i++) {
    const pv = viewer.getPageView(i);
    if (pv && pv.div && pv.div.querySelector('svg.pl-overlay')) drawPage(i);
  }
}

function selectionEl(o, scale) {
  const g = svgEl('g', { class: 'pl-sel' });
  const s = 1 / scale, hs = 7 * s;
  const handle = (x, y, h) => svgEl('rect', { x: x - hs / 2, y: y - hs / 2, width: hs, height: hs, rx: 1.5 * s, fill: '#fff', stroke: 'var(--sel)', 'stroke-width': 1.5 * s, class: 'pl-handle', 'data-h': h });
  if (o.type === 'line' || o.type === 'arrow') {
    g.append(handle(o.x1, o.y1, 'p1'), handle(o.x2, o.y2, 'p2'));
    return g;
  }
  const b = ANN.bbox(o), pad = 3 * s;
  g.append(svgEl('rect', { x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, fill: 'none', stroke: 'var(--sel)', 'stroke-width': 1.2 * s, 'stroke-dasharray': `${4 * s} ${3 * s}` }));
  if (ANN.isBox(o) || o.type === 'ink') {
    g.append(handle(b.x - pad, b.y - pad, 'nw'), handle(b.x + b.w + pad, b.y - pad, 'ne'), handle(b.x - pad, b.y + b.h + pad, 'sw'), handle(b.x + b.w + pad, b.y + b.h + pad, 'se'));
  }
  return g;
}

function toPage(pi, clientX, clientY) {
  const ov = ensureOverlay(pi);
  const m = ov.g.getScreenCTM().inverse();
  const pt = new DOMPoint(clientX, clientY).matrixTransform(m);
  return { x: pt.x, y: pt.y, scale: ov.scale };
}

function pageSize(pi) {
  const pv = viewer.getPageView(pi);
  const v = pv.pdfPage ? pv.pdfPage.view : pv.viewport.viewBox;
  return { w: v[2] - v[0], h: v[3] - v[1] };
}

function snap(tab) { return { annots: JSON.stringify(tab.annots), bytes: tab.bytes, meta: JSON.stringify(tab.meta) }; }
function pushHistory(tab, before) {
  tab.history.push(before || snap(tab));
  if (tab.history.length > 100) tab.history.shift();
  tab.future = [];
  setDirty(tab, true);
  updateUndoButtons();
}

const justAdded = new Set();
function addObj(tab, pi, o) {
  o.id = o.id || ANN.uid();
  justAdded.add(o.id);
  setTimeout(() => justAdded.delete(o.id), 400);
  o.page = pi;
  o.author = o.author || author();
  o.created = o.created || Date.now();
  annotsOf(tab, pi).push(o);
  return o;
}

function removeObj(tab, pi, id) {
  const list = tab.annots[pi] || [];
  const i = list.findIndex(o => o.id === id);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) delete tab.annots[pi];
}

function afterChange(pi) {
  if (pi != null) drawPage(pi); else redrawAll();
  renderComments();
  renderPropbar();
  updateUndoButtons();
}

function select(pi, id) {
  const prev = S.sel;
  S.sel = id ? { pi, id } : null;
  if (prev && prev.pi !== pi) drawPage(prev.pi);
  if (pi != null) drawPage(pi);
  renderPropbar();
  renderComments(true);
}

function deleteSelected() {
  const tab = S.active;
  if (!tab || !S.sel) return;
  const { pi, id } = S.sel;
  const before = snap(tab);
  closeNotePop(true);
  removeObj(tab, pi, id);
  pushHistory(tab, before);
  S.sel = null;
  afterChange(pi);
}

/* ---------- 포인터: 오버레이 ---------- */
function dragLoop(onMove, onUp) {
  const move = (ev) => onMove(ev);
  const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onUp && onUp(ev); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onOverlayDown(e) {
  if (e.button !== 0) return;
  const tab = S.active;
  if (!tab) return;
  const svg = e.currentTarget;
  const pi = +svg.dataset.page;
  if (e.target.closest('.pl-fo-text.editing')) return; // 입력 중인 텍스트 안 클릭
  if (S.editing) commitEdit();
  closeNotePop();

  if (S.tool === 'select' || S.tool === 'edittext') {
    const handle = e.target.closest('.pl-handle');
    const objEl = e.target.closest('.pl-obj');
    if (handle && S.sel && S.sel.pi === pi) { e.preventDefault(); e.stopPropagation(); return startResize(e, pi, handle.dataset.h); }
    if (objEl) {
      e.preventDefault(); e.stopPropagation();
      const id = objEl.dataset.id;
      const obj = findObj(tab, pi, id);
      if (S.tool === 'edittext' && obj.type !== 'edittext') return;
      select(pi, id);
      return startMove(e, pi, obj);
    }
    return;
  }
  if (DRAW_TOOLS.includes(S.tool)) { e.preventDefault(); e.stopPropagation(); startCreate(e, pi); }
}

function onOverlayDbl(e) {
  const objEl = e.target.closest('.pl-obj');
  if (!objEl || !S.active) return;
  const pi = +e.currentTarget.dataset.page;
  const o = findObj(S.active, pi, objEl.dataset.id);
  if (!o) return;
  if (o.type === 'text' || o.type === 'edittext') startEdit(pi, o, false);
  if (o.type === 'note') openNotePop(pi, o);
}

function startMove(e, pi, obj) {
  const tab = S.active;
  const before = snap(tab);
  const orig = clone(obj);
  const p0 = toPage(pi, e.clientX, e.clientY);
  let moved = false;
  const sx = e.clientX, sy = e.clientY;
  dragLoop((ev) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    moved = true;
    const p = toPage(pi, ev.clientX, ev.clientY);
    const cur = clone(orig);
    ANN.move(cur, p.x - p0.x, p.y - p0.y);
    if (obj.type === 'edittext') cur.cover = orig.cover;
    Object.assign(obj, cur);
    drawPage(pi);
  }, () => {
    if (moved) { pushHistory(tab, before); afterChange(pi); }
    else if (obj.type === 'note') openNotePop(pi, obj);
  });
}

function startResize(e, pi, h) {
  const tab = S.active;
  const obj = findObj(tab, pi, S.sel.id);
  const before = snap(tab);
  const orig = clone(obj);
  const ob = ANN.bbox(orig);
  const keepAspect = ['image', 'signature', 'stamp'].includes(obj.type);
  let changed = false;
  dragLoop((ev) => {
    changed = true;
    const p = toPage(pi, ev.clientX, ev.clientY);
    const cur = clone(orig);
    if (h === 'p1' || h === 'p2') {
      let { x, y } = p;
      const ax = h === 'p1' ? orig.x2 : orig.x1, ay = h === 'p1' ? orig.y2 : orig.y1;
      if (ev.shiftKey) ({ x, y } = snap45(ax, ay, x, y));
      if (h === 'p1') { cur.x1 = x; cur.y1 = y; } else { cur.x2 = x; cur.y2 = y; }
    } else {
      let x1 = ob.x, y1 = ob.y, x2 = ob.x + ob.w, y2 = ob.y + ob.h;
      if (h.includes('w')) x1 = Math.min(p.x, x2 - 4); if (h.includes('e')) x2 = Math.max(p.x, x1 + 4);
      if (h.includes('n')) y1 = Math.min(p.y, y2 - 4); if (h.includes('s')) y2 = Math.max(p.y, y1 + 4);
      let nb = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      if (keepAspect || ev.shiftKey) {
        const ratio = ob.w / ob.h;
        const w = Math.max(nb.w, nb.h * ratio), hh = w / ratio;
        nb = { x: h.includes('w') ? x2 - w : x1, y: h.includes('n') ? y2 - hh : y1, w, h: hh };
      }
      ANN.scaleTo(cur, ob, nb);
      if (obj.type === 'edittext') cur.cover = orig.cover;
    }
    Object.assign(obj, cur);
    drawPage(pi);
  }, () => { if (changed) { pushHistory(tab, before); afterChange(pi); } });
}

function snap45(ax, ay, x, y) {
  const ang = Math.atan2(y - ay, x - ax), len = Math.hypot(x - ax, y - ay);
  const a = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  return { x: ax + len * Math.cos(a), y: ay + len * Math.sin(a) };
}

function startCreate(e, pi) {
  const tab = S.active;
  const before = snap(tab);
  const p0 = toPage(pi, e.clientX, e.clientY);
  const s = 1 / p0.scale;
  const tool = S.tool;
  const sx = e.clientX, sy = e.clientY;
  const opt = SHAPES.includes(tool) ? S.opts.shape : (S.opts[tool] || {});
  let o = null;

  if (tool === 'ink') o = addObj(tab, pi, { type: 'ink', pts: [p0.x, p0.y], color: opt.color, width: opt.width, opacity: opt.opacity });
  else if (tool === 'rect' || tool === 'ellipse') o = addObj(tab, pi, { type: tool, x: p0.x, y: p0.y, w: 0, h: 0, color: opt.color, fill: opt.fill, width: opt.width, opacity: opt.opacity });
  else if (tool === 'whiteout') o = addObj(tab, pi, { type: 'whiteout', x: p0.x, y: p0.y, w: 0, h: 0 });
  else if (tool === 'line' || tool === 'arrow') o = addObj(tab, pi, { type: tool, x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y, color: opt.color, width: opt.width, opacity: opt.opacity });
  else if (tool === 'text') o = null;
  if (o) drawPage(pi);

  let dragged = false;
  dragLoop((ev) => {
    if (!dragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    dragged = true;
    const p = toPage(pi, ev.clientX, ev.clientY);
    if (tool === 'ink') {
      const n = o.pts.length;
      if (Math.hypot(p.x - o.pts[n - 2], p.y - o.pts[n - 1]) > 0.8 * s) o.pts.push(p.x, p.y);
    } else if (['rect', 'ellipse', 'whiteout'].includes(tool) || (tool === 'text' && o)) {
      let w = p.x - p0.x, h = p.y - p0.y;
      if (ev.shiftKey && tool !== 'whiteout') { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      o.x = Math.min(p0.x, p0.x + w); o.y = Math.min(p0.y, p0.y + h); o.w = Math.abs(w); o.h = Math.abs(h);
    } else if (tool === 'line' || tool === 'arrow') {
      const q = ev.shiftKey ? snap45(p0.x, p0.y, p.x, p.y) : p;
      o.x2 = q.x; o.y2 = q.y;
    } else if (tool === 'text' && !o) {
      o = addObj(tab, pi, { type: 'text', x: p0.x, y: p0.y, w: 1, h: 1, text: '', ...pickText(S.opts.text) });
      return;
    }
    drawPage(pi);
  }, (ev) => {
    const P = toPage(pi, ev.clientX, ev.clientY);
    if (tool === 'ink') {
      if (o.pts.length === 2) o.pts.push(o.pts[0] + 0.01, o.pts[1] + 0.01);
      pushHistory(tab, before); afterChange(pi); return;
    }
    if (['rect', 'ellipse', 'whiteout'].includes(tool)) {
      if (o.w < 3 * s && o.h < 3 * s) {
        if (tool === 'whiteout') { removeObj(tab, pi, o.id); drawPage(pi); return; }
        o.x = P.x - 40; o.y = P.y - 25; o.w = 80; o.h = 50;
      }
      pushHistory(tab, before); afterChange(pi); return;
    }
    if (tool === 'line' || tool === 'arrow') {
      if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3 * s) { o.x2 = o.x1 + 80; o.y2 = o.y1; }
      pushHistory(tab, before); afterChange(pi); return;
    }
    if (tool === 'text') {
      const t = S.opts.text;
      if (!o || o.w < 12) {
        if (o) removeObj(tab, pi, o.id);
        const sz = pageSize(pi);
        const w = Math.min(200, sz.w - p0.x - 4);
        o = addObj(tab, pi, { type: 'text', x: p0.x, y: p0.y - t.fontSize * 0.6, w: Math.max(40, w), h: t.fontSize * 1.2 + 4, text: '', ...pickText(t) });
      } else o.h = Math.max(o.h, t.fontSize * 1.2 + 4);
      setTool('select');
      S.sel = { pi, id: o.id };
      startEdit(pi, o, true, before);
      return;
    }
    if (tool === 'note') {
      const n = addObj(tab, pi, { type: 'note', x: P.x - 10, y: P.y - 10, text: '', color: S.opts.note.color });
      pushHistory(tab, before);
      setTool('select');
      select(pi, n.id);
      afterChange(pi);
      openNotePop(pi, n, true);
      return;
    }
    if (tool === 'stamp') {
      const st = ANN.STAMPS[S.opts.stamp.index] || ANN.STAMPS[0];
      const h = 40, w = Math.max(110, measure(st.label, h * 0.4, 800) + 30, measure(`${author()} · ${dateText()}`, h * 0.18, 400) + 20);
      const n = addObj(tab, pi, { type: 'stamp', x: P.x - w / 2, y: P.y - h / 2, w, h, label: st.label, color: st.color, opacity: 0.9, dateText: dateText() });
      pushHistory(tab, before); setTool('select'); select(pi, n.id); afterChange(pi);
      return;
    }
    if (tool === 'sign') {
      if (!S.sigArmed) { createSignature().then(src => { if (src) { S.sigArmed = src; renderPropbar(); toast('서명을 넣을 위치를 클릭하세요.'); } }); return; }
      placeImage(pi, P, S.sigArmed, 'signature', 150, before);
      return;
    }
    if (tool === 'image') {
      pickImage().then(src => { if (src) placeImage(pi, P, src, 'image', 220, before); });
    }
  });
}

function pickText(t) { return { color: t.color, fontSize: t.fontSize, bold: t.bold, bg: t.bg, border: t.border }; }
function dateText() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
const measureCtx = document.createElement('canvas').getContext('2d');
function measure(text, size, weight = 400) { measureCtx.font = `${weight} ${size}px "Malgun Gothic", "Segoe UI", sans-serif`; return measureCtx.measureText(text).width; }

function imageSize(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 1, h: 1 }); im.src = src; });
}

async function placeImage(pi, P, src, type, maxW, before) {
  const tab = S.active;
  const { w: nw, h: nh } = await imageSize(src);
  const sz = pageSize(pi);
  let w = Math.min(maxW, nw * 0.75, sz.w * 0.9), h = w * nh / nw;
  if (h > sz.h * 0.9) { h = sz.h * 0.9; w = h * nw / nh; }
  const n = addObj(tab, pi, { type, x: P.x - w / 2, y: P.y - h / 2, w, h, src, opacity: 1 });
  pushHistory(tab, before || snap(tab));
  setTool('select');
  select(pi, n.id);
  afterChange(pi);
}

function pickImage() {
  return new Promise((res) => {
    const inp = $('#imagePicker');
    inp.value = '';
    const done = () => {
      const f = inp.files && inp.files[0];
      if (!f) return res(null);
      const rd = new FileReader();
      rd.onload = () => res(rd.result);
      rd.onerror = () => res(null);
      rd.readAsDataURL(f);
    };
    inp.onchange = done;
    inp.click();
  });
}

/* ---------- 텍스트 편집 ---------- */
function startEdit(pi, o, isNew, before) {
  S.editing = { pi, id: o.id, before: before || snap(S.active), isNew, original: o.text };
  S.sel = { pi, id: o.id };
  drawPage(pi);
  renderPropbar();
}

function attachEditor() {
  const ed = S.editing;
  const ov = ensureOverlay(ed.pi);
  const gObj = ov.g.querySelector(`.pl-obj[data-id="${ed.id}"]`);
  const div = gObj && gObj.querySelector('.pl-fo-text');
  if (!div) return;
  const o = findObj(S.active, ed.pi, ed.id);
  div.classList.add('editing');
  div.contentEditable = 'plaintext-only';
  div.spellcheck = false;
  if (o.type === 'edittext') div.style.background = 'rgba(31,111,214,.08)';
  const fit = () => {
    if (o.type === 'text') {
      const need = Math.max(o.fontSize * 1.2 + 4, div.scrollHeight);
      if (need > o.h) { o.h = need; div.parentNode.setAttribute('height', need); }
    } else {
      const needW = div.scrollWidth, needH = div.scrollHeight;
      if (needW > o.w) { o.w = needW; div.parentNode.setAttribute('width', needW); }
      if (needH > o.h) { o.h = needH; div.parentNode.setAttribute('height', needH); }
    }
  };
  div.addEventListener('input', fit);
  div.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); div.blur(); }
    e.stopPropagation();
  });
  div.addEventListener('blur', () => setTimeout(() => { if (S.editing && S.editing.id === ed.id) commitEdit(); }, 0));
  div.addEventListener('pointerdown', (e) => e.stopPropagation());
  requestAnimationFrame(() => {
    if (!div.isConnected) return;
    div.focus();
    const r = document.createRange();
    r.selectNodeContents(div);
    if (!ed.isNew && o.type === 'text') r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
}

function commitEdit() {
  const ed = S.editing;
  if (!ed || !S.active) { S.editing = null; return; }
  S.editing = null;
  const tab = S.active;
  const o = findObj(tab, ed.pi, ed.id);
  if (!o) return;
  const ov = ensureOverlay(ed.pi);
  const div = ov && ov.g.querySelector(`.pl-obj[data-id="${ed.id}"] .pl-fo-text`);
  if (div) o.text = div.innerText.replace(/\n$/, '');
  if (o.type === 'text' && !o.text.trim()) {
    removeObj(tab, ed.pi, o.id);
    if (S.sel && S.sel.id === o.id) S.sel = null;
    if (!ed.isNew) pushHistory(tab, ed.before);
  } else if (o.text !== ed.original || ed.isNew) {
    o.modified = Date.now();
    pushHistory(tab, ed.before);
  }
  getSelection().removeAllRanges();
  afterChange(ed.pi);
}

/* PDF 편집: 기존 텍스트 클릭 → 편집 가능한 텍스트로 바꾸기 */
container.addEventListener('pointerdown', (e) => {
  if (S.tool !== 'edittext' || e.button !== 0 || !S.active) return;
  const span = e.target.closest('.textLayer span');
  if (!span || span.classList.contains('markedContent') || !span.textContent.trim() || span.classList.contains('edited')) return;
  e.preventDefault();
  e.stopPropagation();
  commitEdit();
  const pageDiv = span.closest('.page');
  const pi = +pageDiv.dataset.pageNumber - 1;
  const r = span.getBoundingClientRect();
  const corners = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => toPage(pi, x, y));
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const rotated = viewer.pagesRotation % 180 !== 0;
  const lineH = rotated ? box.w : box.h;
  const fs = Math.max(4, Math.round((lineH / 1.17) * 2) / 2);
  const color = sampleTextColor(pageDiv, r);
  const tab = S.active;
  const before = snap(tab);
  const o = addObj(tab, pi, {
    type: 'edittext', x: box.x, y: box.y + (box.h - fs * 1.2) / 2, w: box.w, h: fs * 1.2,
    cover: { x: box.x - 1, y: box.y - 0.5, w: box.w + 2, h: box.h + 1 },
    text: span.textContent, fontSize: fs, color, original: span.textContent,
  });
  span.classList.add('edited');
  startEdit(pi, o, true, before);
}, true);

function sampleTextColor(pageDiv, r) {
  try {
    const cv = pageDiv.querySelector('canvas');
    const cr = cv.getBoundingClientRect();
    const sx = cv.width / cr.width, sy = cv.height / cr.height;
    const x = Math.max(0, Math.floor((r.left - cr.left) * sx)), y = Math.max(0, Math.floor((r.top - cr.top) * sy));
    const w = Math.max(1, Math.min(cv.width - x, Math.floor(r.width * sx))), h = Math.max(1, Math.min(cv.height - y, Math.floor(r.height * sy)));
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
    let best = null, bestD = 60;
    for (let i = 0; i < d.length; i += 16) {
      const dist = 765 - (d[i] + d[i + 1] + d[i + 2]);
      if (dist > bestD) { bestD = dist; best = [d[i], d[i + 1], d[i + 2]]; }
    }
    if (best) return '#' + best.map(v => v.toString(16).padStart(2, '0')).join('');
  } catch {}
  return '#1a1a1a';
}

function markEditedSpans(pi) {
  const tab = S.active;
  if (!tab) return;
  const list = (tab.annots[pi] || []).filter(o => o.type === 'edittext');
  if (!list.length) return;
  const pv = viewer.getPageView(pi);
  const spans = pv && pv.div ? $$('.textLayer span', pv.div) : [];
  for (const sp of spans) {
    const r = sp.getBoundingClientRect();
    if (!r.width) continue;
    const c = toPage(pi, r.left + r.width / 2, r.top + r.height / 2);
    if (list.some(o => c.x >= o.cover.x && c.x <= o.cover.x + o.cover.w && c.y >= o.cover.y && c.y <= o.cover.y + o.cover.h)) sp.classList.add('edited');
  }
}

/* ---------- 텍스트 강조 / 밑줄 / 취소선 ---------- */
document.addEventListener('pointerup', () => {
  if (!MARKUP_TOOLS.includes(S.tool) || !S.active) return;
  setTimeout(applyMarkup, 0);
});

function textNodesInRange(range) {
  const out = [];
  const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.length) continue;
    if (!range.intersectsNode(n)) continue;
    if (!n.parentElement.closest('.textLayer')) continue;
    out.push(n);
  }
  if (!out.length && root.nodeType === 3) out.push(root);
  return out;
}

function applyMarkup() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return;
  const tab = S.active;
  const byPage = {};
  for (const node of textNodesInRange(range)) {
    const r = document.createRange();
    r.selectNodeContents(node);
    if (node === range.startContainer) r.setStart(node, range.startOffset);
    if (node === range.endContainer) r.setEnd(node, range.endOffset);
    const pageDiv = node.parentElement.closest('.page');
    if (!pageDiv) continue;
    const pi = +pageDiv.dataset.pageNumber - 1;
    for (const cr of r.getClientRects()) {
      if (cr.width < 0.5 || cr.height < 0.5) continue;
      const cs = [[cr.left, cr.top], [cr.right, cr.bottom]].map(([x, y]) => toPage(pi, x, y));
      const x = Math.min(cs[0].x, cs[1].x), y = Math.min(cs[0].y, cs[1].y);
      (byPage[pi] = byPage[pi] || []).push([x, y, Math.abs(cs[1].x - cs[0].x), Math.abs(cs[1].y - cs[0].y)]);
    }
  }
  const pages = Object.keys(byPage);
  if (!pages.length) return;
  const before = snap(tab);
  const opt = S.opts[S.tool];
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  for (const k of pages) {
    const rects = mergeRects(byPage[k]);
    addObj(tab, +k, { type: S.tool, rects, color: opt.color, opacity: opt.opacity, text: text.slice(0, 300) });
  }
  sel.removeAllRanges();
  pushHistory(tab, before);
  pages.forEach(k => drawPage(+k));
  renderComments(); updateUndoButtons();
}

function mergeRects(rects) {
  rects.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last) {
      const sameLine = Math.abs((last[1] + last[3] / 2) - (r[1] + r[3] / 2)) < Math.min(last[3], r[3]) * 0.5;
      const gap = r[0] - (last[0] + last[2]);
      if (sameLine && gap < Math.max(last[3], r[3]) * 0.6 && gap > -Math.max(last[2], r[2])) {
        const x1 = Math.min(last[0], r[0]), y1 = Math.min(last[1], r[1]);
        const x2 = Math.max(last[0] + last[2], r[0] + r[2]), y2 = Math.max(last[1] + last[3], r[1] + r[3]);
        out[out.length - 1] = [x1, y1, x2 - x1, y2 - y1];
        continue;
      }
    }
    out.push(r.slice());
  }
  return out;
}

/* ---------- 메모 팝업 ---------- */
function openNotePop(pi, o, isNew = false) {
  closeNotePop();
  const pop = $('#notePop');
  const ov = ensureOverlay(pi);
  const elx = ov.g.querySelector(`.pl-obj[data-id="${o.id}"]`);
  if (!elx) return;
  const r = elx.getBoundingClientRect(), wr = $('#viewerWrap').getBoundingClientRect();
  let left = r.right - wr.left + 8, top = r.top - wr.top;
  if (left + 270 > wr.width) left = r.left - wr.left - 268;
  top = clamp(top, 8, wr.height - 220);
  pop.style.left = `${Math.max(8, left)}px`; pop.style.top = `${top}px`;
  pop.style.borderTopColor = o.color || '#ffd400';
  $('#npAuthor').textContent = o.author || author();
  $('#npTime').textContent = fmtShort(o.modified || o.created);
  $('#npText').value = o.text || '';
  pop.hidden = false;
  S.notePop = { pi, id: o.id, before: isNew ? null : snap(S.active), original: o.text || '', isNew };
  setTimeout(() => $('#npText').focus(), 20);
}

function closeNotePop(discard = false) {
  const np = S.notePop;
  if (!np) return;
  S.notePop = null;
  $('#notePop').hidden = true;
  if (discard || !S.active) return;
  const o = findObj(S.active, np.pi, np.id);
  if (!o) return;
  const v = $('#npText').value;
  if (v !== np.original) {
    const before = np.before || snap(S.active);
    o.text = v; o.modified = Date.now();
    if (np.before) pushHistory(S.active, before); else setDirty(S.active, true);
    renderComments();
  }
}
$('#npDone').onclick = () => closeNotePop();
$('#npDelete').onclick = () => { const np = S.notePop; if (!np) return; S.sel = { pi: np.pi, id: np.id }; deleteSelected(); };
$('#npText').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeNotePop(); if (e.key === 'Enter' && e.ctrlKey) closeNotePop(); });
container.addEventListener('scroll', () => { if (S.notePop) closeNotePop(); }, { passive: true });

/* ---------- 손 도구 ---------- */
container.addEventListener('pointerdown', (e) => {
  if (S.tool !== 'hand' || e.button !== 0) return;
  if (e.target.closest('.annotationLayer a, .annotationLayer input, .annotationLayer textarea, .annotationLayer select')) return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY, st = container.scrollTop, sl = container.scrollLeft;
  container.classList.add('grabbing');
  dragLoop((ev) => { container.scrollTop = st - (ev.clientY - sy); container.scrollLeft = sl - (ev.clientX - sx); }, () => container.classList.remove('grabbing'));
});

/* 빈 곳 클릭 → 선택 해제 */
container.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.pl-obj, .pl-handle, .note-pop')) return;
  if (S.editing) commitEdit();
  if (S.sel && (S.tool === 'select' || S.tool === 'edittext')) {
    const pi = S.sel.pi;
    S.sel = null;
    drawPage(pi);
    renderPropbar();
    renderComments(true);
  }
});

/* ======================= 도구 / 속성 막대 ======================= */
function setTool(tool, silent) {
  if (!silent) { commitEdit(); closeNotePop(); }
  if (tool === 'shape') tool = S.opts.shapeKind || 'rect';
  if (tool !== 'select' && tool !== 'edittext' && S.sel) { const pi = S.sel.pi; S.sel = null; drawPage(pi); }
  if (tool !== 'edittext' && S.sel && S.tool === 'edittext') { const pi = S.sel.pi; S.sel = null; drawPage(pi); }
  S.tool = tool;
  if (SHAPES.includes(tool)) { S.opts.shapeKind = tool; saveOpts(); }
  $$('#rail .rbtn[data-tool]').forEach(b => {
    const t = b.dataset.tool;
    b.classList.toggle('on', t === tool || (t === 'rect' && SHAPES.includes(tool)));
  });
  const shapeBtn = $('#rail [data-shape-group]');
  if (shapeBtn) {
    const iconName = { rect: 'square', ellipse: 'circle', line: 'minus', arrow: 'move-up-right' }[S.opts.shapeKind || 'rect'];
    if (shapeBtn.dataset.icon !== iconName) { shapeBtn.innerHTML = ic(iconName); shapeBtn.dataset.icon = iconName; icons(shapeBtn); }
  }
  container.className = '';
  container.classList.add('tool-' + tool);
  if (tool === 'hand') container.classList.add('hand');
  if (tool === 'edittext') container.classList.add('edit-mode');
  if (DRAW_TOOLS.includes(tool)) container.classList.add('no-text');
  $$('svg.pl-overlay').forEach(svg => {
    svg.classList.toggle('active', DRAW_TOOLS.includes(tool));
    svg.classList.toggle('place', ['text', 'note', 'stamp', 'sign', 'image'].includes(tool));
  });
  if (tool !== 'sign') S.sigArmed = S.sigArmed && tool === 'sign' ? S.sigArmed : null;
  if (tool === 'sign' && !S.sigArmed) { const sigs = sigsList(); if (sigs.length) S.sigArmed = sigs[0]; }
  renderPropbar();
}

function colorSwatches(current, onPick, allowNone = false, list = ANN.COLORS) {
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  if (allowNone) {
    const b = document.createElement('button');
    b.className = 'sw none' + (!current ? ' on' : '');
    b.title = '없음';
    b.onclick = () => onPick(null);
    wrap.append(b);
  }
  for (const c of list) {
    const b = document.createElement('button');
    b.className = 'sw' + (current && current.toLowerCase() === c ? ' on' : '');
    b.style.background = c;
    b.title = c;
    b.onclick = () => onPick(c);
    wrap.append(b);
  }
  return wrap;
}

function rangeField(label, value, min, max, step, fmt, onInput, onChange) {
  const w = document.createElement('label');
  w.className = 'pb-field';
  w.innerHTML = `<span>${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><span class="val">${fmt(value)}</span>`;
  const inp = w.querySelector('input'), val = w.querySelector('.val');
  inp.oninput = () => { val.textContent = fmt(+inp.value); onInput(+inp.value); };
  inp.onchange = () => onChange && onChange(+inp.value);
  return w;
}

function pbSep() { const d = document.createElement('div'); d.className = 'pb-sep'; return d; }
function pbLabel(iconName, text) { const d = document.createElement('div'); d.className = 'pb-label'; d.innerHTML = ic(iconName) + esc(text); return d; }
function pbBtn(iconName, text, on, onClick, title) {
  const b = document.createElement('button');
  b.className = 'pb-btn' + (on ? ' on' : '');
  b.innerHTML = (iconName ? ic(iconName) : '') + (text ? esc(text) : '');
  if (title) b.title = title;
  b.onclick = onClick;
  return b;
}

function renderPropbar() {
  const bar = $('#propbar');
  bar.innerHTML = '';
  const tab = S.active;
  if (!tab || S.org) { bar.hidden = true; return; }
  const selObj = S.sel ? findObj(tab, S.sel.pi, S.sel.id) : null;
  const tool = S.tool;

  // 속성 변경 도우미: 선택된 객체가 있으면 객체에, 없으면 도구 기본값에 반영
  let pendingBefore = null;
  const edit = (key, value, commit = true, optKey) => {
    if (selObj) {
      if (!pendingBefore) pendingBefore = snap(tab);
      selObj[key] = value;
      drawPage(S.sel.pi);
      if (commit) { pushHistory(tab, pendingBefore); pendingBefore = null; renderComments(); }
    }
    const ok = optKey || (selObj ? optKeyOf(selObj.type) : optKeyOf(tool));
    if (ok && S.opts[ok] && key in S.opts[ok]) { S.opts[ok][key] = value; saveOpts(); }
    if (commit) renderPropbar();
  };

  const type = selObj ? selObj.type : tool;
  const info = ANN.TYPES[type === 'sign' ? 'signature' : type];
  const src = selObj || S.opts[optKeyOf(tool)] || {};

  if (!selObj && (tool === 'select' || tool === 'hand')) { bar.hidden = true; return; }

  if (selObj) bar.append(pbLabel(info.icon, info.label));

  if (!selObj && SHAPES.includes(tool)) {
    for (const k of SHAPES) bar.append(pbBtn({ rect: 'square', ellipse: 'circle', line: 'minus', arrow: 'move-up-right' }[k], '', tool === k, () => setTool(k), ANN.TYPES[k].label));
    bar.append(pbSep());
  }
  if (!selObj && info && !SHAPES.includes(tool)) bar.append(pbLabel(info.icon, info.label));

  if (['highlight', 'underline', 'strike', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'note'].includes(type)) {
    bar.append(colorSwatches(src.color, (c) => edit('color', c)));
  }
  if (['ink', 'rect', 'ellipse', 'line', 'arrow'].includes(type)) {
    bar.append(pbSep());
    bar.append(rangeField('두께', src.width ?? 2, 0.5, 12, 0.5, v => `${v}pt`, v => edit('width', v, false), v => edit('width', v, true)));
  }
  if (['rect', 'ellipse'].includes(type)) {
    bar.append(pbSep());
    const f = document.createElement('div'); f.className = 'pb-field'; f.innerHTML = '<span>채우기</span>';
    f.append(colorSwatches(src.fill, (c) => edit('fill', c), true, ['#ffd400', '#ff6b6b', '#2f6fde', '#2fb36b', '#1a1a1a', '#ffffff']));
    bar.append(f);
  }
  if (['highlight', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'image', 'signature'].includes(type)) {
    bar.append(pbSep());
    bar.append(rangeField('불투명도', Math.round((src.opacity ?? 1) * 100), 10, 100, 5, v => `${v}%`, v => edit('opacity', v / 100, false), v => edit('opacity', v / 100, true)));
  }
  if (['text', 'edittext'].includes(type)) {
    bar.append(colorSwatches(src.color, (c) => edit('color', c), false, ['#1a1a1a', '#55565e', '#e0332f', '#2f6fde', '#2fb36b', '#7b5cff', '#ffffff']));
    bar.append(pbSep());
    const f = document.createElement('label'); f.className = 'pb-field';
    const sizes = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
    const fsv = src.fontSize || 12;
    if (!sizes.includes(fsv)) sizes.push(fsv), sizes.sort((a, b) => a - b);
    f.innerHTML = `<span>크기</span><select>${sizes.map(s => `<option ${s === fsv ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
    f.querySelector('select').onchange = (e) => {
      const v = +e.target.value;
      if (selObj && selObj.type === 'text') selObj.h = Math.max(selObj.h, v * 1.2 + 4);
      if (selObj && selObj.type === 'edittext') { selObj.h = v * 1.2; }
      edit('fontSize', v);
    };
    bar.append(f);
    bar.append(pbBtn('bold', '', !!src.bold, () => edit('bold', !src.bold), '굵게'));
    if (type === 'text') {
      bar.append(pbSep());
      bar.append(pbBtn('square-dashed', '', !!src.border, () => edit('border', !src.border), '테두리'));
      const f2 = document.createElement('div'); f2.className = 'pb-field'; f2.innerHTML = '<span>배경</span>';
      f2.append(colorSwatches(src.bg, (c) => edit('bg', c), true, ['#ffffff', '#fff6bf', '#e4eefc']));
      bar.append(f2);
    }
  }
  if (!selObj && tool === 'edittext') bar.append(pbSep(), hint('바꿀 텍스트를 클릭하세요. 편집한 줄은 원래 글자를 흰색으로 덮고 새 글자를 얹습니다.'));
  if (!selObj && MARKUP_TOOLS.includes(tool)) bar.append(pbSep(), hint('문서의 텍스트를 드래그하세요'));
  if (!selObj && tool === 'whiteout') bar.append(hint('가릴 영역을 드래그하세요. 화면과 인쇄물에서 가려지지만 원래 텍스트는 파일에 남습니다.'));
  if (!selObj && tool === 'image') bar.append(hint('이미지를 넣을 위치를 클릭하세요 (PNG, JPG)'));
  if (!selObj && tool === 'text') bar.append(pbSep(), hint('클릭하거나 드래그해서 상자를 만드세요'));
  if (!selObj && tool === 'note') bar.append(pbSep(), hint('메모를 붙일 위치를 클릭하세요'));

  if (!selObj && tool === 'stamp') {
    ANN.STAMPS.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'stamp-chip' + (S.opts.stamp.index === i ? ' on' : '');
      b.style.color = st.color;
      b.textContent = st.label;
      b.onclick = () => { S.opts.stamp.index = i; saveOpts(); renderPropbar(); };
      bar.append(b);
    });
  }
  if (selObj && selObj.type === 'stamp') {
    bar.append(colorSwatches(selObj.color, (c) => edit('color', c), false, ['#2f8f5b', '#1f6fd6', '#d4382c', '#7353d9', '#dc6a1c', '#1a1a1a']));
    bar.append(pbSep());
    bar.append(rangeField('불투명도', Math.round((selObj.opacity ?? 1) * 100), 10, 100, 5, v => `${v}%`, v => edit('opacity', v / 100, false), v => edit('opacity', v / 100, true)));
  }
  if (!selObj && tool === 'sign') {
    const sigs = sigsList();
    if (!sigs.length) bar.append(hint('저장된 서명이 없습니다.'));
    sigs.forEach((src, i) => {
      const b = document.createElement('button');
      b.className = 'sig-chip' + (S.sigArmed === src ? ' on' : '');
      b.innerHTML = `<img alt="서명 ${i + 1}"><span class="x" title="삭제">${ic('x')}</span>`;
      b.querySelector('img').src = src;
      b.onclick = (e) => {
        if (e.target.closest('.x')) { const list = sigsList().slice(); list.splice(i, 1); saveSigs(list); if (S.sigArmed === src) S.sigArmed = null; renderPropbar(); return; }
        S.sigArmed = src; renderPropbar();
      };
      bar.append(b);
    });
    bar.append(pbBtn('plus', '서명 만들기', false, async () => { const s = await createSignature(); if (s) { S.sigArmed = s; renderPropbar(); } }));
    if (S.sigArmed) bar.append(hint('문서를 클릭해 서명을 넣으세요'));
  }

  if (selObj) {
    bar.append(pbSep());
    if (selObj.type === 'note') bar.append(pbBtn('message-square', '메모 열기', false, () => openNotePop(S.sel.pi, selObj)));
    if (selObj.type === 'text' || selObj.type === 'edittext') bar.append(pbBtn('pencil', '편집', false, () => startEdit(S.sel.pi, selObj, false)));
    if (selObj.type === 'edittext') bar.append(pbBtn('undo-dot', '원래대로', false, () => { deleteSelected(); markEditedSpansReset(); }, '편집 취소하고 원래 텍스트 복원'));
    else bar.append(pbBtn('trash-2', '', false, deleteSelected, '삭제 (Delete)'));
  }
  bar.hidden = !bar.children.length;
  icons(bar);
}
function hint(t) { const s = document.createElement('span'); s.className = 'pb-hint'; s.textContent = t; return s; }
function optKeyOf(type) {
  if (SHAPES.includes(type)) return 'shape';
  if (type === 'edittext') return null;
  return ['highlight', 'underline', 'strike', 'ink', 'text', 'note'].includes(type) ? type : null;
}
function markEditedSpansReset() {
  $$('.textLayer span.edited').forEach(s => s.classList.remove('edited'));
  if (S.pdf) for (let i = 0; i < S.pdf.numPages; i++) markEditedSpans(i);
}

/* ---------- 서명 만들기 ---------- */
async function createSignature() {
  let mode = 'draw';
  let strokes = [];
  let imgData = null;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="seg" style="align-self:flex-start"><button data-m="draw" class="on">그리기</button><button data-m="type">입력</button><button data-m="image">이미지</button></div>
    <div data-pane="draw"><div class="sig-pad-wrap"><canvas id="sigPad"></canvas><div class="baseline"></div><button class="btn small ghost clear">지우기</button></div></div>
    <div data-pane="type" hidden><label class="field"><span>이름</span><input type="text" id="sigName" value="${esc(S.prefs.author)}" placeholder="서명할 이름"></label>
      <label class="field"><span>글꼴</span><select id="sigFont"><option value='"Segoe Script", "Brush Script MT", cursive'>필기체 (영문)</option><option value='"Gungsuh", "Batang", serif'>궁서</option><option value='"Malgun Gothic", sans-serif'>맑은 고딕</option></select></label>
      <div class="sig-type-preview" id="sigPrev"></div></div>
    <div data-pane="image" hidden><p>서명이 담긴 PNG나 JPG 이미지를 고르세요. 흰 배경은 자동으로 투명하게 처리합니다.</p><button class="btn" id="sigPick">${ic('upload')}이미지 선택</button><div class="sig-type-preview" id="sigImgPrev" style="margin-top:12px"></div></div>
    <label class="pb-field" style="gap:8px"><span>색상</span><span id="sigColors"></span></label>`;
  let color = '#1a1a1a';
  const result = await modal({
    title: '서명 만들기', body, wide: true,
    buttons: [{ label: '취소', value: null }, { label: '서명 저장', value: true, kind: 'primary' }],
    onOpen: (root) => {
      const cv = root.querySelector('#sigPad');
      const ctx = cv.getContext('2d');
      const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * 2; cv.height = r.height * 2; redraw(); };
      const redraw = () => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = 5;
        for (const s of strokes) { ctx.beginPath(); s.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
      };
      setTimeout(fit, 20);
      cv.addEventListener('pointerdown', (e) => {
        const r = cv.getBoundingClientRect();
        const pt = (ev) => [(ev.clientX - r.left) * 2, (ev.clientY - r.top) * 2];
        const s = [pt(e)]; strokes.push(s);
        dragLoop((ev) => { s.push(pt(ev)); redraw(); }, () => redraw());
      });
      root.querySelector('.clear').onclick = () => { strokes = []; redraw(); };
      const prev = root.querySelector('#sigPrev');
      const upd = () => { prev.style.fontFamily = root.querySelector('#sigFont').value; prev.style.color = color; prev.textContent = root.querySelector('#sigName').value || '서명'; };
      root.querySelector('#sigName').oninput = upd; root.querySelector('#sigFont').onchange = upd; upd();
      $$('.seg button', root).forEach(b => b.onclick = () => {
        mode = b.dataset.m;
        $$('.seg button', root).forEach(x => x.classList.toggle('on', x === b));
        $$('[data-pane]', root).forEach(p => p.hidden = p.dataset.pane !== mode);
        if (mode === 'draw') setTimeout(fit, 10);
      });
      root.querySelector('#sigPick').onclick = async () => {
        const src = await pickImage();
        if (!src) return;
        imgData = await whiteToAlpha(src);
        const p = root.querySelector('#sigImgPrev');
        p.innerHTML = `<img style="max-height:110px;max-width:100%">`; p.firstChild.src = imgData;
      };
      const cw = root.querySelector('#sigColors');
      const paint = () => { cw.innerHTML = ''; cw.append(colorSwatches(color, (c) => { color = c; paint(); redraw(); upd(); }, false, ['#1a1a1a', '#1f3f99', '#2f6fde', '#c4312b'])); };
      paint();
    },
    collect: (root) => {
      if (mode === 'draw') {
        if (!strokes.length) { toast('서명을 그려 주세요.'); return false; }
        return trimCanvas(root.querySelector('#sigPad'));
      }
      if (mode === 'type') {
        const name = root.querySelector('#sigName').value.trim();
        if (!name) { toast('이름을 입력하세요.'); return false; }
        const font = root.querySelector('#sigFont').value;
        const c = document.createElement('canvas'); c.width = 1400; c.height = 300;
        const x = c.getContext('2d'); x.font = `110px ${font}`; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(name, 30, 150);
        return trimCanvas(c);
      }
      if (!imgData) { toast('이미지를 선택하세요.'); return false; }
      return imgData;
    },
  });
  if (!result.value || !result.data) return null;
  saveSigs([result.data, ...sigsList()].slice(0, 6));
  return result.data;
}

function trimCanvas(cv) {
  const ctx = cv.getContext('2d');
  const { width: w, height: h } = cv;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x1 = w, y1 = h, x2 = 0, y2 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  if (x2 < x1) return null;
  const pad = 8;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(w - 1, x2 + pad); y2 = Math.min(h - 1, y2 + pad);
  const out = document.createElement('canvas'); out.width = x2 - x1 + 1; out.height = y2 - y1 + 1;
  out.getContext('2d').drawImage(cv, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function whiteToAlpha(src) {
  const im = new Image(); im.src = src; await im.decode();
  const c = document.createElement('canvas'); const sc = Math.min(1, 1200 / im.naturalWidth);
  c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
  const id = x.getImageData(0, 0, c.width, c.height); const d = id.data;
  for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 225) d[i + 3] = 0; else if (l > 180) d[i + 3] = Math.round(d[i + 3] * (225 - l) / 45); }
  x.putImageData(id, 0, 0);
  return trimCanvas(c) || c.toDataURL('image/png');
}

/* ======================= 실행 취소 ======================= */
async function undo() {
  const tab = S.active;
  if (!tab) return;
  if (S.editing) { commitEdit(); }
  const s = tab.history.pop();
  if (!s) return;
  tab.future.push(snap(tab));
  await restore(tab, s);
}
async function redo() {
  const tab = S.active;
  if (!tab) return;
  const s = tab.future.pop();
  if (!s) return;
  tab.history.push(snap(tab));
  await restore(tab, s);
}
async function restore(tab, s) {
  const bytesChanged = s.bytes !== tab.bytes;
  tab.annots = JSON.parse(s.annots);
  tab.meta = JSON.parse(s.meta);
  tab.bytes = s.bytes;
  S.sel = null; closeNotePop(true);
  setDirty(tab, true);
  if (bytesChanged) { tab.formDirty = false; saveViewState(tab); await loadIntoViewer(tab, true); }
  else { redrawAll(); markEditedSpansReset(); }
  renderComments(); renderPropbar(); updateUndoButtons();
}

/* ======================= 저장 ======================= */
async function buildOutput(tab) {
  await captureForms(tab);
  const annots = {};
  for (const k of Object.keys(tab.annots)) if (tab.annots[k] && tab.annots[k].length) annots[k] = tab.annots[k];
  try {
    return await OPS.flatten(tab.bytes, annots, tab.meta);
  } catch (e) {
    if (!OPS.isEncryptedError(e)) throw e;
    const { value } = await modal({
      title: '보안 설정이 있는 문서',
      body: `<p>이 PDF에는 편집 제한(암호화)이 걸려 있어 원본 구조를 그대로 저장할 수 없습니다.</p><p>각 페이지를 고해상도 이미지로 바꿔 새 PDF로 저장할 수 있습니다. 이 경우 텍스트 선택과 검색이 되지 않습니다.</p>`,
      buttons: [{ label: '취소', value: null }, { label: '이미지 PDF로 저장', value: true, kind: 'primary' }],
    });
    if (!value) return null;
    const rebuilt = await rasterRebuild(S.pdf);
    return OPS.flatten(rebuilt, annots, tab.meta);
  }
}

async function rasterRebuild(pdf) {
  const pm = progressModal('이미지 PDF 만드는 중');
  const imgs = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      pm.set(`${i} / ${pdf.numPages} 페이지`, i / pdf.numPages);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2, rotation: 0 });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, annotationStorage: pdf.annotationStorage }).promise;
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
      imgs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: page.view[2] - page.view[0], h: page.view[3] - page.view[1], rot: page.rotate });
    }
    const bytes = await OPS.fromImages(imgs);
    const doc = await PDFLib.PDFDocument.load(bytes);
    doc.getPages().forEach((p, i) => p.setRotation(PDFLib.degrees(imgs[i].rot || 0)));
    return doc.save();
  } finally { pm.close(); }
}

async function saveTab(tab, saveAs = false) {
  if (!tab) return false;
  commitEdit(); closeNotePop();
  let path = tab.path;
  if (!path || saveAs) {
    path = await host.saveDialog({ defaultPath: tab.path || stripExt(tab.name) + '.pdf' });
    if (!path) return false;
  }
  let bytes;
  try { bytes = await buildOutput(tab); }
  catch (e) { console.error(e); toast('저장 파일을 만들지 못했습니다: ' + (e.message || e), 'err'); return false; }
  if (!bytes) return false;
  try { await host.writeFile(path, bytes); }
  catch (e) { toast('파일을 쓸 수 없습니다. 다른 프로그램에서 열려 있는지 확인하세요.', 'err'); return false; }
  tab.path = path; tab.name = basename(path);
  setDirty(tab, false);
  renderTabs(); updateTitle();
  toast(`저장했습니다: ${tab.name}`, 'ok', { label: '폴더 열기', run: () => host.showInFolder(path) });
  return true;
}

/* ======================= 탐색 패널 ======================= */
S.navOpen = store.get('navOpen', true);
S.navTab = 'thumbs';
function openNav(which) {
  if (!S.active) return;
  if (S.navOpen && S.navTab === which && which) { S.navOpen = false; }
  else { S.navOpen = true; if (which) S.navTab = which; }
  store.set('navOpen', S.navOpen);
  applyNav();
}
function applyNav() {
  $('#navPanel').hidden = !S.navOpen || !S.active;
  $$('#navSeg button').forEach(b => b.classList.toggle('on', b.dataset.nav === S.navTab));
  $('#navThumbs').hidden = S.navTab !== 'thumbs';
  $('#navOutline').hidden = S.navTab !== 'outline';
  $('#navComments').hidden = S.navTab !== 'comments';
  $$('#navRail [data-navopen]').forEach(b => b.classList.toggle('on', S.navOpen && b.dataset.navopen === S.navTab));
}
$$('#navSeg button').forEach(b => b.onclick = () => { S.navTab = b.dataset.nav; applyNav(); });
$$('#navRail [data-navopen]').forEach(b => b.onclick = () => openNav(b.dataset.navopen));

let thumbObserver = null;
function buildThumbs() {
  const wrap = $('#navThumbs');
  wrap.innerHTML = '';
  if (thumbObserver) thumbObserver.disconnect();
  const pdf = S.pdf;
  if (!pdf) return;
  const token = S.docToken;
  const W = 132;
  const pv0 = viewer.getPageView(0);
  const ratio0 = pv0 ? pv0.viewport.height / pv0.viewport.width : 1.414;
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      thumbObserver.unobserve(el);
      renderThumb(pdf, +el.dataset.i, W, el.querySelector('.tframe'), token);
    }
  }, { root: wrap, rootMargin: '300px 0px' });
  for (let i = 0; i < pdf.numPages; i++) {
    const t = document.createElement('button');
    t.className = 'thumb' + (i === viewer.currentPageNumber - 1 ? ' on' : '');
    t.dataset.i = i;
    t.innerHTML = `<div class="tframe" style="width:${W}px;height:${Math.round(W * ratio0)}px"></div><span class="tnum">${i + 1}</span>`;
    t.onclick = () => { viewer.currentPageNumber = i + 1; };
    wrap.append(t);
    thumbObserver.observe(t);
  }
}

async function renderThumb(pdf, i, W, frame, token, rotExtra = viewer.pagesRotation) {
  try {
    const page = await pdf.getPage(i + 1);
    if (token != null && token !== S.docToken) return;
    const vp1 = page.getViewport({ scale: 1, rotation: (page.rotate + rotExtra) % 360 });
    const scale = W / vp1.width;
    const vp = page.getViewport({ scale: scale * 2, rotation: (page.rotate + rotExtra) % 360 });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    cv.style.width = `${W}px`; cv.style.height = `${Math.round(vp.height / 2)}px`;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    frame.style.height = `${Math.round(vp.height / 2)}px`;
    frame.innerHTML = '';
    frame.append(cv);
  } catch (e) { /* 문서가 닫힌 경우 무시 */ }
}

function syncThumbSel() {
  const n = viewer.currentPageNumber - 1;
  $$('#navThumbs .thumb').forEach((t, i) => t.classList.toggle('on', i === n));
  const on = $('#navThumbs .thumb.on');
  if (on && !$('#navThumbs').hidden) on.scrollIntoView({ block: 'nearest' });
}

async function buildOutline() {
  const wrap = $('#navOutline');
  wrap.innerHTML = '';
  const pdf = S.pdf;
  let outline = null;
  try { outline = await pdf.getOutline(); } catch {}
  if (pdf !== S.pdf) return;
  if (!outline || !outline.length) {
    wrap.innerHTML = `<div class="empty">${ic('bookmark')}이 문서에는 책갈피가 없습니다.</div>`;
    icons(wrap); return;
  }
  const build = (items, depth) => {
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'ol-item' + (depth === 0 && it.items.length && items.length < 12 ? ' open' : '');
      const hasKids = it.items && it.items.length;
      row.innerHTML = `<button class="ol-toggle">${hasKids ? ic('chevron-right') : ''}</button><div style="flex:1;min-width:0"><button class="ol-link"></button><div class="ol-children"></div></div>`;
      const link = row.querySelector('.ol-link');
      link.textContent = it.title;
      if (it.bold) link.style.fontWeight = '700';
      if (it.italic) link.style.fontStyle = 'italic';
      link.onclick = () => {
        if (it.dest) linkService.goToDestination(it.dest);
        else if (it.url) linkService.addLinkAttributes ? window.open(it.url) : null;
      };
      const kids = row.querySelector('.ol-children');
      if (hasKids) {
        kids.append(build(it.items, depth + 1));
        kids.hidden = !row.classList.contains('open');
        row.querySelector('.ol-toggle').onclick = () => { row.classList.toggle('open'); kids.hidden = !row.classList.contains('open'); };
      }
      frag.append(row);
    }
    return frag;
  };
  wrap.append(build(outline, 0));
  icons(wrap);
}

function renderComments(onlySel) {
  const wrap = $('#navComments');
  const tab = S.active;
  const all = [];
  if (tab) for (const k of Object.keys(tab.annots)) for (const o of tab.annots[k]) all.push({ pi: +k, o });
  $('#cmtCount').textContent = all.length || '';
  if (onlySel) {
    $$('.cm-item', wrap).forEach(it => it.classList.toggle('on', !!S.sel && it.dataset.id === S.sel.id));
    return;
  }
  if (!all.length) {
    wrap.innerHTML = `<div class="empty">${ic('messages-square')}아직 주석이 없습니다.<br>왼쪽 도구로 강조, 메모, 그리기를 추가하세요.</div>`;
    icons(wrap); return;
  }
  all.sort((a, b) => (a.pi - b.pi) || (ANN.bbox(a.o).y - ANN.bbox(b.o).y));
  let html = '', last = -1;
  for (const { pi, o } of all) {
    if (pi !== last) { html += `<div class="cm-page">${pi + 1}페이지</div>`; last = pi; }
    const t = ANN.TYPES[o.type] || { label: o.type, icon: 'circle' };
    const color = o.color && o.type !== 'text' && o.type !== 'edittext' ? o.color : 'var(--fg-2)';
    const desc = ANN.describe(o);
    html += `<div class="cm-item ${S.sel && S.sel.id === o.id ? 'on' : ''}" data-id="${o.id}" data-pi="${pi}">
      <span class="cm-ic" style="color:${esc(color)}">${ic(t.icon)}</span>
      <div class="cm-body"><div class="cm-meta"><b>${esc(o.author || '')}</b><span>${fmtShort(o.modified || o.created)}</span></div>
      <div class="cm-text">${esc(t.label)}${desc ? ' — ' + esc(desc) : ''}</div></div>
      <button class="ibtn cm-del" title="삭제">${ic('trash-2')}</button></div>`;
  }
  wrap.innerHTML = html;
  icons(wrap);
  $$('.cm-item', wrap).forEach(it => {
    it.onclick = (e) => {
      const pi = +it.dataset.pi, id = it.dataset.id;
      if (e.target.closest('.cm-del')) { S.sel = { pi, id }; deleteSelected(); return; }
      goToObj(pi, id);
    };
  });
}

function goToObj(pi, id) {
  const tab = S.active;
  const o = findObj(tab, pi, id);
  if (!o) return;
  if (!['select', 'edittext'].includes(S.tool)) setTool('select');
  const pv = viewer.getPageView(pi);
  const v = pv.pdfPage ? pv.pdfPage.view : [0, 0, 0, pv.viewport.viewBox[3]];
  const b = ANN.bbox(o);
  viewer.scrollPageIntoView({ pageNumber: pi + 1, destArray: [null, { name: 'XYZ' }, v[0] + Math.max(0, b.x - 40), v[3] - Math.max(0, b.y - 60), null] });
  setTimeout(() => select(pi, id), 60);
}

/* ======================= 찾기 ======================= */
function openFind() {
  if (!S.active) return;
  $('#findbar').hidden = false;
  const inp = $('#findInput');
  inp.focus(); inp.select();
  if (inp.value) doFind('again', false);
}
function closeFind() {
  $('#findbar').hidden = true;
  eventBus.dispatch('findbarclose', { source: null });
  container.focus();
}
function doFind(type, prev) {
  const q = $('#findInput').value;
  if (!q) { $('#findCount').textContent = ''; eventBus.dispatch('findbarclose', { source: null }); return; }
  eventBus.dispatch('find', { source: null, type, query: q, caseSensitive: $('#findCase').checked, entireWord: $('#findWord').checked, highlightAll: true, findPrevious: prev, matchDiacritics: false });
}
function refreshFind() { if (!$('#findbar').hidden && $('#findInput').value) setTimeout(() => doFind('', false), 300); }
$('#findInput').addEventListener('input', () => doFind('', false));
$('#findInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doFind('again', e.shiftKey); }
  if (e.key === 'Escape') closeFind();
});
$('#findCase').onchange = () => doFind('casesensitivitychange', false);
$('#findWord').onchange = () => doFind('entirewordchange', false);
$('#findNext').onclick = () => doFind('again', false);
$('#findPrev').onclick = () => doFind('again', true);
$('#findClose').onclick = closeFind;
eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
  const { current, total } = matchesCount || {};
  $('#findCount').textContent = total ? `${current} / ${total}` : '';
});
eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
  if (state === 1) $('#findCount').textContent = '결과 없음';
  else if (matchesCount && matchesCount.total) $('#findCount').textContent = `${matchesCount.current} / ${matchesCount.total}`;
});

/* ======================= 페이지 이동·확대 ======================= */
eventBus.on('pagechanging', ({ pageNumber }) => { $('#pageInput').value = pageNumber; syncThumbSel(); });
eventBus.on('scalechanging', updateZoomLabel);
eventBus.on('pagerendered', ({ pageNumber }) => drawPage(pageNumber - 1));
eventBus.on('textlayerrendered', ({ pageNumber }) => markEditedSpans(pageNumber - 1));
eventBus.on('rotationchanging', () => { buildThumbs(); });
function updateZoomLabel() { $('#zoomBtn').textContent = `${Math.round((viewer.currentScale || 1) * 100)}%`; }
$('#pageInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { const n = parseInt(e.target.value, 10); if (n >= 1 && S.pdf && n <= S.pdf.numPages) viewer.currentPageNumber = n; else e.target.value = viewer.currentPageNumber; container.focus(); }
});
$('#pageInput').addEventListener('focus', (e) => e.target.select());

function zoomStep(dir) {
  const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4];
  const c = viewer.currentScale;
  let next = dir > 0 ? steps.find(s => s > c + 0.001) : [...steps].reverse().find(s => s < c - 0.001);
  if (next) viewer.currentScaleValue = String(next);
}
container.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !S.active) return;
  e.preventDefault();
  zoomStep(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

function toggleMenu(btn, menu) {
  const open = menu.hidden;
  $$('.menu').forEach(m => m.hidden = true);
  menu.hidden = !open;
  if (open) {
    const close = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { menu.hidden = true; document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }
}
$('#zoomBtn').onclick = () => toggleMenu($('#zoomBtn'), $('#zoomMenu'));
$$('#zoomMenu [data-zoom]').forEach(b => b.onclick = () => { viewer.currentScaleValue = b.dataset.zoom; $('#zoomMenu').hidden = true; });
function syncThemeMenu() {
  $$('#themeMenu [data-cmd]').forEach(b => b.classList.toggle('on',
    (b.dataset.cmd === 'themeLight' && S.prefs.theme === 'light') || (b.dataset.cmd === 'themeDark' && S.prefs.theme === 'dark') ||
    (b.dataset.cmd === 'themeSystem' && (!S.prefs.theme || S.prefs.theme === 'system')) || (b.dataset.cmd === 'pageDark' && !!S.prefs.pageDark)));
  const btn = $('#themeBtn');
  if (btn) { const name = effectiveDark() ? 'moon' : 'sun'; if (btn.dataset.icon !== name) { btn.dataset.icon = name; btn.firstElementChild.outerHTML = ic(name); icons(btn); } }
}
$('#themeBtn').onclick = () => { syncThemeMenu(); toggleMenu($('#themeBtn'), $('#themeMenu')); };
$('#themeMenu').addEventListener('click', (e) => { if (e.target.closest('[data-cmd]')) setTimeout(() => { $('#themeMenu').hidden = true; }, 0); });
$('#layoutBtn').onclick = () => {
  $$('#layoutMenu [data-cmd]').forEach(b => b.classList.toggle('on',
    (b.dataset.cmd === 'layoutSingle' && viewer.scrollMode === ScrollMode.PAGE) ||
    (b.dataset.cmd === 'layoutScroll' && viewer.scrollMode !== ScrollMode.PAGE && viewer.spreadMode === SpreadMode.NONE) ||
    (b.dataset.cmd === 'layoutSpread' && viewer.spreadMode !== SpreadMode.NONE)));
  toggleMenu($('#layoutBtn'), $('#layoutMenu'));
};

/* ======================= 페이지 구성 ======================= */
let orgSeq = 0;
let orgObserver = null;
function openOrganizer() {
  const tab = S.active;
  if (!tab || !S.pdf) return;
  commitEdit(); closeNotePop();
  const n = S.pdf.numPages;
  S.org = { entries: [], sel: new Set(), extBytes: {}, extDocs: {}, anchor: null, changed: false };
  for (let i = 0; i < n; i++) S.org.entries.push({ key: ++orgSeq, src: i, rot: 0 });
  $('#organizer').hidden = false;
  $('#viewerWrap').hidden = true;
  $('#propbar').hidden = true;
  const size = store.get('orgSize', 160);
  $('#orgSize').value = size;
  $('#orgGrid').style.setProperty('--og', size + 'px');
  renderOrganizer();
}

function closeOrganizer() {
  if (!S.org) return;
  for (const d of Object.values(S.org.extDocs)) d.destroy();
  S.org = null;
  if (orgObserver) orgObserver.disconnect();
  $('#organizer').hidden = true;
  $('#orgGrid').innerHTML = '';
  if (S.active) $('#viewerWrap').hidden = false;
  renderPropbar();
}

function pageDocFor(e) {
  if (e.src != null) return { pdf: S.pdf, index: e.src };
  if (e.ext) return { pdf: S.org.extDocs[e.ext.key], index: e.ext.index };
  return null;
}

function renderOrganizer() {
  const O = S.org;
  const grid = $('#orgGrid');
  grid.innerHTML = '';
  if (orgObserver) orgObserver.disconnect();
  const W = +$('#orgSize').value;
  orgObserver = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      orgObserver.unobserve(en.target);
      const e = O.entries.find(x => x.key === +en.target.dataset.key);
      if (e) drawOrgThumb(e, en.target.querySelector('.og-page'), W);
    }
  }, { root: grid, rootMargin: '400px 0px' });
  O.entries.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = 'og-card' + (O.sel.has(e.key) ? ' on' : '');
    card.draggable = true;
    card.dataset.key = e.key;
    const tag = e.blank ? '빈 페이지' : e.ext ? '삽입됨' : (e.src !== i ? `원래 ${e.src + 1}` : '');
    card.innerHTML = `<div class="og-frame"><div class="og-page" style="width:${W * 0.75}px;height:${W * 0.97}px;transform:rotate(${e.rot}deg)"></div></div>
      <div class="og-tools"><button class="ibtn" data-a="l" title="왼쪽 회전">${ic('rotate-ccw')}</button><button class="ibtn" data-a="r" title="오른쪽 회전">${ic('rotate-cw')}</button><button class="ibtn" data-a="d" title="삭제">${ic('trash-2')}</button></div>
      <span class="og-num">${i + 1}</span>${tag ? `<span class="og-tag">${tag}</span>` : ''}`;
    card.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-a]');
      if (a) {
        ev.stopPropagation();
        if (a.dataset.a === 'l') rotateEntries([e], -90);
        if (a.dataset.a === 'r') rotateEntries([e], 90);
        if (a.dataset.a === 'd') deleteEntries([e]);
        return;
      }
      orgSelect(e, ev);
    });
    card.addEventListener('dblclick', () => { if (e.src != null) { const t = e.src; applyOrganizer().then(() => { if (!S.org) viewer.currentPageNumber = Math.min(t + 1, S.pdf.numPages); }); } });
    card.addEventListener('dragstart', (ev) => {
      if (!O.sel.has(e.key)) { O.sel = new Set([e.key]); $$('.og-card').forEach(c => c.classList.toggle('on', +c.dataset.key === e.key)); }
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/x-org', '1');
      setTimeout(() => $$('.og-card.on').forEach(c => c.classList.add('dragging')), 0);
    });
    card.addEventListener('dragend', () => $$('.og-card').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after')));
    card.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer.types.includes('text/x-org')) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      const after = ev.clientX > r.left + r.width / 2;
      $$('.og-card').forEach(c => c.classList.remove('drop-before', 'drop-after'));
      card.classList.add(after ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('drop', (ev) => {
      if (!ev.dataTransfer.types.includes('text/x-org')) return;
      ev.preventDefault(); ev.stopPropagation();
      const r = card.getBoundingClientRect();
      const after = ev.clientX > r.left + r.width / 2;
      moveSelectedTo(e.key, after);
    });
    grid.append(card);
    orgObserver.observe(card);
  });
  icons(grid);
  $('#orgCount').textContent = `${O.entries.length}페이지` + (O.sel.size ? ` · ${O.sel.size}개 선택` : '');
}

async function drawOrgThumb(e, box, W) {
  if (e.blank) {
    const [w, h] = e.blank;
    const s = Math.min(W * 0.95 / w, W * 1.25 / h);
    box.style.width = `${w * s}px`; box.style.height = `${h * s}px`;
    return;
  }
  const d = pageDocFor(e);
  if (!d || !d.pdf) return;
  try {
    const page = await d.pdf.getPage(d.index + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const s = Math.min(W * 0.95 / vp1.width, W * 1.25 / vp1.height);
    const vp = page.getViewport({ scale: s * 1.6 });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    box.style.width = `${vp.width / 1.6}px`; box.style.height = `${vp.height / 1.6}px`;
    cv.style.width = '100%'; cv.style.height = '100%';
    box.innerHTML = ''; box.append(cv);
  } catch {}
}

function orgSelect(e, ev) {
  const O = S.org;
  const keys = O.entries.map(x => x.key);
  if (ev.shiftKey && O.anchor != null) {
    const a = keys.indexOf(O.anchor), b = keys.indexOf(e.key);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (!ev.ctrlKey) O.sel.clear();
    for (let i = lo; i <= hi; i++) O.sel.add(keys[i]);
  } else if (ev.ctrlKey || ev.metaKey) {
    O.sel.has(e.key) ? O.sel.delete(e.key) : O.sel.add(e.key);
    O.anchor = e.key;
  } else { O.sel = new Set([e.key]); O.anchor = e.key; }
  $$('.og-card').forEach(c => c.classList.toggle('on', O.sel.has(+c.dataset.key)));
  $('#orgCount').textContent = `${O.entries.length}페이지` + (O.sel.size ? ` · ${O.sel.size}개 선택` : '');
}

function selectedEntries() { return S.org.entries.filter(e => S.org.sel.has(e.key)); }

function rotateEntries(list, d) {
  list.forEach(e => { e.rot = (e.rot + d + 360) % 360; });
  S.org.changed = true;
  list.forEach(e => { const c = $(`.og-card[data-key="${e.key}"] .og-page`); if (c) c.style.transform = `rotate(${e.rot}deg)`; });
}
function deleteEntries(list) {
  const O = S.org;
  if (list.length >= O.entries.length) { toast('모든 페이지를 삭제할 수는 없습니다.', 'err'); return; }
  const keys = new Set(list.map(e => e.key));
  O.entries = O.entries.filter(e => !keys.has(e.key));
  keys.forEach(k => O.sel.delete(k));
  O.changed = true;
  renderOrganizer();
}
function moveSelectedTo(targetKey, after) {
  const O = S.org;
  if (O.sel.has(targetKey)) return;
  const moving = O.entries.filter(e => O.sel.has(e.key));
  const rest = O.entries.filter(e => !O.sel.has(e.key));
  let idx = rest.findIndex(e => e.key === targetKey);
  if (after) idx++;
  rest.splice(idx, 0, ...moving);
  O.entries = rest;
  O.changed = true;
  renderOrganizer();
}
function insertIndex() {
  const O = S.org;
  const idxs = O.entries.map((e, i) => O.sel.has(e.key) ? i : -1).filter(i => i >= 0);
  return idxs.length ? Math.max(...idxs) + 1 : O.entries.length;
}

async function orgAction(a) {
  const O = S.org;
  if (!O) return;
  const sel = selectedEntries();
  const needSel = () => { if (!sel.length) { toast('먼저 페이지를 선택하세요.'); return false; } return true; };
  switch (a) {
    case 'rotl': if (needSel()) rotateEntries(sel, -90); break;
    case 'rotr': if (needSel()) rotateEntries(sel, 90); break;
    case 'delete': if (needSel()) deleteEntries(sel); break;
    case 'blank': {
      const at = insertIndex();
      const ref = O.entries[Math.max(0, at - 1)];
      let size = [595.28, 841.89];
      const d = ref && pageDocFor(ref);
      if (d) { try { const p = await d.pdf.getPage(d.index + 1); const vp = p.getViewport({ scale: 1 }); size = [vp.width, vp.height]; } catch {} }
      else if (ref && ref.blank) size = ref.blank;
      const e = { key: ++orgSeq, blank: size, rot: 0 };
      O.entries.splice(at, 0, e);
      O.sel = new Set([e.key]); O.changed = true;
      renderOrganizer();
      break;
    }
    case 'insert': {
      const files = await host.openDialog({ title: '삽입할 PDF 선택', multi: true });
      if (!files.length || !S.org) return;
      let at = insertIndex();
      const added = [];
      for (const f of files) {
        try {
          const bytes = await host.readFile(f);
          const key = 'x' + (++orgSeq);
          const pdf = await openPdfjs(bytes);
          O.extBytes[key] = bytes; O.extDocs[key] = pdf;
          for (let i = 0; i < pdf.numPages; i++) { const e = { key: ++orgSeq, ext: { key, index: i }, rot: 0 }; O.entries.splice(at++, 0, e); added.push(e.key); }
        } catch (e) { toast(`${basename(f)}을(를) 열 수 없습니다.`, 'err'); }
      }
      O.sel = new Set(added); O.changed = true;
      renderOrganizer();
      if (added.length) toast(`${added.length}개 페이지를 삽입했습니다.`, 'ok');
      break;
    }
    case 'extract': {
      if (!needSel()) return;
      const path = await host.saveDialog({ title: '추출한 페이지 저장', defaultPath: `${stripExt(S.active.name)}_추출.pdf` });
      if (!path) return;
      try {
        await captureForms(S.active);
        const bytes = await OPS.reorganize(S.active.bytes, sel.map(toOpEntry), O.extBytes);
        await host.writeFile(path, bytes);
        toast(`${sel.length}개 페이지를 추출했습니다.`, 'ok', { label: '열기', run: () => openPath(path) });
      } catch (e) { reportPdfError(e); }
      break;
    }
    case 'split': {
      const total = O.entries.length;
      const { value, data } = await modal({
        title: '문서 분할',
        body: `<p>현재 순서의 ${total}페이지를 여러 파일로 나눕니다.</p>
          <label class="field"><span>몇 페이지씩 나눌까요?</span><input type="number" id="spN" min="1" max="${total}" value="${Math.max(1, Math.ceil(total / 2))}"></label>`,
        buttons: [{ label: '취소', value: null }, { label: '폴더 선택 후 분할', value: true, kind: 'primary' }],
        collect: (r) => { const n = parseInt(r.querySelector('#spN').value, 10); if (!(n >= 1)) { toast('1 이상의 숫자를 입력하세요.'); return false; } return n; },
      });
      if (!value) return;
      const folder = await host.chooseFolder();
      if (!folder) return;
      try {
        await captureForms(S.active);
        const base = stripExt(S.active.name);
        let part = 0;
        for (let i = 0; i < total; i += data) {
          part++;
          const bytes = await OPS.reorganize(S.active.bytes, O.entries.slice(i, i + data).map(toOpEntry), O.extBytes);
          await host.writeFile(await host.joinPath(folder, `${base}_${part}.pdf`), bytes);
        }
        toast(`${part}개 파일로 분할했습니다.`, 'ok', { label: '폴더 열기', run: async () => host.showInFolder(await host.joinPath(folder, `${base}_1.pdf`)) });
      } catch (e) { reportPdfError(e); }
      break;
    }
    case 'cancel': closeOrganizer(); break;
    case 'apply': await applyOrganizer(); break;
  }
}
function toOpEntry(e) { return e.src != null ? { src: e.src, rot: e.rot } : e.blank ? { blank: e.blank, rot: e.rot } : { ext: e.ext, rot: e.rot }; }

async function applyOrganizer() {
  const O = S.org, tab = S.active;
  if (!O) return;
  const identity = O.entries.length === S.pdf.numPages && O.entries.every((e, i) => e.src === i && !e.rot);
  if (identity) { closeOrganizer(); return; }
  try {
    await captureForms(tab);
    const before = snap(tab);
    const bytes = await OPS.reorganize(tab.bytes, O.entries.map(toOpEntry), O.extBytes);
    const remapped = {};
    O.entries.forEach((e, ni) => { if (e.src != null && tab.annots[e.src]) remapped[ni] = tab.annots[e.src].map(o => ({ ...o, page: ni })); });
    tab.bytes = bytes; tab.annots = remapped;
    pushHistory(tab, before);
    closeOrganizer();
    saveViewState(tab);
    await loadIntoViewer(tab, true);
    toast('페이지 구성을 적용했습니다. 저장하면 파일에 반영됩니다.', 'ok');
  } catch (e) { reportPdfError(e); }
}

function reportPdfError(e) {
  console.error(e);
  if (OPS.isEncryptedError(e)) toast('편집 제한이 걸린 PDF라 이 작업을 할 수 없습니다.', 'err');
  else toast('작업을 완료하지 못했습니다: ' + (e.message || e), 'err');
}

$$('[data-org]').forEach(b => b.onclick = () => orgAction(b.dataset.org));
$('#orgSize').oninput = (e) => { $('#orgGrid').style.setProperty('--og', e.target.value + 'px'); };
$('#orgSize').onchange = (e) => { store.set('orgSize', +e.target.value); if (S.org) renderOrganizer(); };
$('#orgGrid').addEventListener('click', (e) => { if (e.target === $('#orgGrid') && S.org) { S.org.sel.clear(); $$('.og-card').forEach(c => c.classList.remove('on')); $('#orgCount').textContent = `${S.org.entries.length}페이지`; } });

/* ======================= 문서 단위 도구 ======================= */
async function applyBytesChange(fn, okMsg) {
  const tab = S.active;
  commitEdit();
  try {
    await captureForms(tab);
    const before = snap(tab);
    const bytes = await fn(tab.bytes);
    tab.bytes = bytes;
    pushHistory(tab, before);
    saveViewState(tab);
    await loadIntoViewer(tab, true);
    if (okMsg) toast(okMsg, 'ok');
  } catch (e) { reportPdfError(e); }
}

async function combineFiles() {
  const files = await host.openDialog({ title: '결합할 PDF 선택', multi: true });
  if (!files.length) return;
  let order = files.slice();
  const listHtml = () => order.map((f, i) => `<div class="rrow" style="grid-template-columns:28px minmax(0,1fr) auto" data-i="${i}"><span class="rfile">${ic('file-text')}</span><span class="rname"><b>${esc(basename(f))}</b><small>${esc(f)}</small></span><span style="display:flex;gap:2px"><button class="ibtn" data-m="up" title="위로">${ic('chevron-up')}</button><button class="ibtn" data-m="down" title="아래로">${ic('chevron-down')}</button><button class="ibtn" data-m="del" title="빼기">${ic('x')}</button></span></div>`).join('');
  const { value } = await modal({
    title: '파일 결합', wide: true,
    body: `<p>순서를 확인한 뒤 결합하세요. 결과는 새 탭에서 열립니다.</p><div class="recent-table" id="cbList"></div><button class="btn small" id="cbAdd" style="align-self:flex-start">${ic('plus')}파일 추가</button>`,
    buttons: [{ label: '취소', value: null }, { label: '결합', value: true, kind: 'primary' }],
    onOpen: (root) => {
      const list = root.querySelector('#cbList');
      const paint = () => { list.innerHTML = listHtml(); icons(list); };
      list.onclick = (e) => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const i = +b.closest('[data-i]').dataset.i;
        if (b.dataset.m === 'up' && i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
        if (b.dataset.m === 'down' && i < order.length - 1) [order[i + 1], order[i]] = [order[i], order[i + 1]];
        if (b.dataset.m === 'del') order.splice(i, 1);
        paint();
      };
      root.querySelector('#cbAdd').onclick = async () => { const more = await host.openDialog({ multi: true }); order.push(...more); paint(); };
      paint();
    },
  });
  if (!value || !order.length) return;
  const pm = progressModal('파일 결합 중');
  try {
    const list = [];
    for (let i = 0; i < order.length; i++) { pm.set(basename(order[i]), (i + 1) / (order.length + 1)); list.push(await host.readFile(order[i])); }
    const bytes = await OPS.merge(list);
    pm.close();
    const tab = newTab({ name: '결합된 문서.pdf', bytes, dirty: true });
    S.tabs.push(tab);
    await activateTab(tab);
    toast(`${order.length}개 파일을 결합했습니다. 저장해서 파일로 남기세요.`, 'ok');
  } catch (e) { pm.close(); reportPdfError(e); }
}

async function pageNumbersDlg() {
  const n = S.pdf.numPages;
  const { value, data } = await modal({
    title: '페이지 번호 추가',
    body: `<div class="field-row"><label class="field"><span>위치</span><select id="pnPos"><option value="bc">아래 가운데</option><option value="br">아래 오른쪽</option><option value="bl">아래 왼쪽</option><option value="tc">위 가운데</option><option value="tr">위 오른쪽</option><option value="tl">위 왼쪽</option></select></label>
      <label class="field"><span>형식</span><select id="pnFmt"><option value="{n}">1</option><option value="{n} / {t}">1 / ${n}</option><option value="- {n} -">- 1 -</option><option value="{n}쪽">1쪽</option><option value="Page {n}">Page 1</option></select></label></div>
      <div class="field-row"><label class="field"><span>시작 번호</span><input type="number" id="pnStart" value="1" min="0"></label><label class="field"><span>글자 크기 (pt)</span><input type="number" id="pnSize" value="10" min="5" max="48"></label></div>
      <div class="field-row"><label class="field"><span>적용 시작 페이지</span><input type="number" id="pnFrom" value="1" min="1" max="${n}"></label><label class="field"><span>적용 끝 페이지</span><input type="number" id="pnTo" value="${n}" min="1" max="${n}"></label></div>`,
    buttons: [{ label: '취소', value: null }, { label: '추가', value: true, kind: 'primary' }],
    collect: (r) => ({ position: r.querySelector('#pnPos').value, format: r.querySelector('#pnFmt').value, start: +r.querySelector('#pnStart').value || 1, size: +r.querySelector('#pnSize').value || 10, from: +r.querySelector('#pnFrom').value || 1, to: +r.querySelector('#pnTo').value || n }),
  });
  if (!value) return;
  await applyBytesChange((b) => OPS.pageNumbers(b, data), '페이지 번호를 추가했습니다.');
}

async function watermarkDlg() {
  let color = '#d4382c';
  const { value, data } = await modal({
    title: '워터마크 추가',
    body: `<label class="field"><span>문구</span><input type="text" id="wmText" value="대외비"></label>
      <div class="field-row"><label class="field"><span>글자 크기 (pt)</span><input type="number" id="wmSize" value="72" min="8" max="300"></label>
      <label class="field"><span>방향</span><select id="wmAng"><option value="45">대각선</option><option value="0">가로</option></select></label></div>
      <label class="field"><span>불투명도 <b id="wmOpV">25%</b></span><input type="range" id="wmOp" min="5" max="100" value="25"></label>
      <div class="field"><span>색상</span><div id="wmColors"></div></div>`,
    buttons: [{ label: '취소', value: null }, { label: '모든 페이지에 추가', value: true, kind: 'primary' }],
    onOpen: (root) => {
      const op = root.querySelector('#wmOp'); op.oninput = () => root.querySelector('#wmOpV').textContent = op.value + '%';
      const cw = root.querySelector('#wmColors');
      const paint = () => { cw.innerHTML = ''; cw.append(colorSwatches(color, (c) => { color = c; paint(); }, false, ['#d4382c', '#1f6fd6', '#2f8f5b', '#7353d9', '#6c6d75', '#1a1a1a'])); };
      paint();
    },
    collect: (r) => {
      const text = r.querySelector('#wmText').value.trim();
      if (!text) { toast('문구를 입력하세요.'); return false; }
      return { text, size: +r.querySelector('#wmSize').value || 72, angle: +r.querySelector('#wmAng').value, opacity: +r.querySelector('#wmOp').value / 100, color, fit: true };
    },
  });
  if (!value) return;
  await applyBytesChange((b) => OPS.watermark(b, data), '워터마크를 추가했습니다.');
}

async function renderOutputDoc(tab) {
  const bytes = await buildOutput(tab);
  if (!bytes) return null;
  return openPdfjs(bytes, tab);
}

async function exportImages(all) {
  const tab = S.active;
  const { value, data } = await modal({
    title: '이미지로 내보내기',
    body: `<div class="field-row"><label class="field"><span>범위</span><select id="exR"><option value="cur" ${all ? '' : 'selected'}>현재 페이지 (${viewer.currentPageNumber})</option><option value="all" ${all ? 'selected' : ''}>모든 페이지 (${S.pdf.numPages})</option></select></label>
      <label class="field"><span>해상도</span><select id="exD"><option value="96">96 dpi (화면)</option><option value="150" selected>150 dpi</option><option value="200">200 dpi</option><option value="300">300 dpi (인쇄)</option></select></label></div><p>주석과 서명이 포함된 상태로 PNG를 만듭니다.</p>`,
    buttons: [{ label: '취소', value: null }, { label: '내보내기', value: true, kind: 'primary' }],
    collect: (r) => ({ all: r.querySelector('#exR').value === 'all', dpi: +r.querySelector('#exD').value }),
  });
  if (!value) return;
  const base = stripExt(tab.name);
  let target;
  if (data.all) { target = await host.chooseFolder(); if (!target) return; }
  else { target = await host.saveDialog({ title: 'PNG로 저장', defaultPath: `${base}_${viewer.currentPageNumber}.png`, kind: 'png' }); if (!target) return; }
  const pm = progressModal('이미지 만드는 중');
  let doc;
  try {
    doc = await renderOutputDoc(tab);
    if (!doc) return;
    const pages = data.all ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [viewer.currentPageNumber];
    let firstPath = null;
    for (let k = 0; k < pages.length; k++) {
      pm.set(`${pages[k]} / ${doc.numPages} 페이지`, (k + 1) / pages.length);
      const blob = await pageToBlob(doc, pages[k], data.dpi / 72, 'image/png');
      const path = data.all ? await host.joinPath(target, `${base}_${String(pages[k]).padStart(String(doc.numPages).length, '0')}.png`) : target;
      firstPath = firstPath || path;
      await host.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    }
    toast(`${pages.length}개 이미지를 저장했습니다.`, 'ok', { label: '폴더 열기', run: () => host.showInFolder(firstPath) });
  } catch (e) { reportPdfError(e); }
  finally { pm.close(); if (doc) doc.destroy(); }
}

async function pageToBlob(doc, n, scale, type, quality, autoRotate) {
  const page = await doc.getPage(n);
  let rot = page.rotate;
  let vp = page.getViewport({ scale, rotation: rot });
  if (autoRotate && vp.width > vp.height) { rot = (rot + 90) % 360; vp = page.getViewport({ scale, rotation: rot }); }
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
  const blob = await new Promise(r => cv.toBlob(r, type, quality));
  cv.width = cv.height = 0;
  return blob;
}

async function exportText() {
  const tab = S.active;
  const path = await host.saveDialog({ title: '텍스트로 저장', defaultPath: `${stripExt(tab.name)}.txt`, kind: 'txt' });
  if (!path) return;
  const pm = progressModal('텍스트 추출 중');
  try {
    const out = [];
    for (let i = 1; i <= S.pdf.numPages; i++) {
      pm.set(`${i} / ${S.pdf.numPages} 페이지`, i / S.pdf.numPages);
      const page = await S.pdf.getPage(i);
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) { s += it.str; if (it.hasEOL) s += '\n'; }
      out.push(`──── ${i} 페이지 ────\n${s.trim()}\n`);
    }
    await host.writeFile(path, new TextEncoder().encode('﻿' + out.join('\n')));
    toast('텍스트를 저장했습니다.', 'ok', { label: '폴더 열기', run: () => host.showInFolder(path) });
  } catch (e) { reportPdfError(e); }
  finally { pm.close(); }
}

async function printDoc() {
  const tab = S.active;
  if (!tab) return;
  commitEdit();
  const pm = progressModal('인쇄 준비 중');
  const pc = $('#printContainer');
  const urls = [];
  let doc;
  try {
    doc = await renderOutputDoc(tab);
    if (!doc) return;
    pc.innerHTML = '';
    for (let i = 1; i <= doc.numPages; i++) {
      pm.set(`${i} / ${doc.numPages} 페이지`, i / doc.numPages);
      const blob = await pageToBlob(doc, i, 150 / 72, 'image/jpeg', 0.92, true);
      const url = URL.createObjectURL(blob); urls.push(url);
      const d = document.createElement('div'); d.className = 'pp';
      const img = new Image(); img.src = url; await img.decode();
      d.append(img); pc.append(d);
    }
    pm.close();
    await sleep(50);
    const r = await host.print();
    if (!r.ok && r.reason && !/cancel/i.test(r.reason)) toast('인쇄하지 못했습니다: ' + r.reason, 'err');
  } catch (e) { reportPdfError(e); }
  finally { pm.close(); pc.innerHTML = ''; urls.forEach(u => URL.revokeObjectURL(u)); if (doc) doc.destroy(); }
}

async function propertiesDlg() {
  const tab = S.active;
  const pdf = S.pdf;
  let info = {}, meta = {};
  try { const m = await pdf.getMetadata(); info = m.info || {}; meta = m; } catch {}
  const d = (s) => { if (!s) return '—'; try { const o = pdfjsLib.PDFDateString.toDateObject(s); return o ? fmtDate(o) : s; } catch { return s; } };
  const page = await pdf.getPage(viewer.currentPageNumber);
  const [x0, y0, x1, y1] = page.view;
  const mm = (pt) => (pt / 72 * 25.4).toFixed(0);
  const cur = tab.meta || {};
  const val = (k, d0) => esc(cur[k] != null ? cur[k] : (d0 || ''));
  const { value, data } = await modal({
    title: '문서 속성', wide: true,
    body: `<div class="field-row"><label class="field"><span>제목</span><input type="text" id="mTitle" value="${val('title', info.Title)}"></label><label class="field"><span>작성자</span><input type="text" id="mAuthor" value="${val('author', info.Author)}"></label></div>
      <div class="field-row"><label class="field"><span>주제</span><input type="text" id="mSubject" value="${val('subject', info.Subject)}"></label><label class="field"><span>키워드</span><input type="text" id="mKeys" value="${val('keywords', info.Keywords)}"></label></div>
      <dl class="kv">
        <dt>파일</dt><dd>${esc(tab.path || '(저장되지 않음)')}</dd>
        <dt>파일 크기</dt><dd>${fmtSize(tab.bytes.length)}</dd>
        <dt>페이지 수</dt><dd>${pdf.numPages}</dd>
        <dt>페이지 크기</dt><dd>${mm(x1 - x0)} × ${mm(y1 - y0)} mm (${(x1 - x0).toFixed(0)} × ${(y1 - y0).toFixed(0)} pt, ${viewer.currentPageNumber}페이지)</dd>
        <dt>PDF 버전</dt><dd>${esc(info.PDFFormatVersion || '—')}</dd>
        <dt>만든 날짜</dt><dd>${esc(d(info.CreationDate))}</dd>
        <dt>수정한 날짜</dt><dd>${esc(d(info.ModDate))}</dd>
        <dt>작성 프로그램</dt><dd>${esc(info.Creator || '—')}</dd>
        <dt>PDF 변환</dt><dd>${esc(info.Producer || '—')}</dd>
        <dt>빠른 웹 보기</dt><dd>${info.IsLinearized ? '예' : '아니요'}</dd>
        <dt>양식 필드</dt><dd>${info.IsAcroFormPresent ? '있음' : '없음'}</dd>
        <dt>보안</dt><dd>${info.EncryptFilterName ? '암호화됨 (' + esc(info.EncryptFilterName) + ')' : '없음'}</dd>
      </dl>`,
    buttons: [{ label: '닫기', value: null }, { label: '정보 변경', value: true, kind: 'primary' }],
    collect: (r) => ({ title: r.querySelector('#mTitle').value, author: r.querySelector('#mAuthor').value, subject: r.querySelector('#mSubject').value, keywords: r.querySelector('#mKeys').value }),
  });
  if (!value) return;
  const before = snap(tab);
  tab.meta = data;
  pushHistory(tab, before);
  toast('문서 정보를 바꿨습니다. 저장하면 파일에 반영됩니다.', 'ok');
}

async function prefsDlg() {
  const { value, data } = await modal({
    title: '환경 설정',
    body: `<label class="field"><span>작성자 이름 (주석·스탬프에 표시)</span><input type="text" id="pAuthor" value="${esc(S.prefs.author)}" placeholder="사용자"></label>
      <div class="field-row"><label class="field"><span>테마</span><select id="pTheme"><option value="system">시스템 설정 따르기</option><option value="light">밝게</option><option value="dark">어둡게</option></select></label>
      <label class="field"><span>야간 읽기</span><select id="pPageDark"><option value="0">페이지는 원래 색</option><option value="1">페이지도 어둡게</option></select></label></div>
      <div class="field-row"><label class="field"><span>문서를 열 때 배율</span><select id="pZoom"><option value="auto">자동</option><option value="page-width">너비 맞춤</option><option value="page-fit">페이지 맞춤</option><option value="1">100%</option></select></label><span></span></div>
      <p style="font-size:12px;color:var(--fg-3)">${host.web ? '서명은 이 브라우저 안에만 암호화해 보관하고, 서버로 전송하지 않습니다.' : '서명은 이 PC의 Windows 계정으로 암호화해 보관하고, 외부로 전송하지 않습니다.'} 편집 메뉴 → 개인 정보 지우기에서 한 번에 지울 수 있습니다.</p>`,
    buttons: [{ label: '취소', value: null }, { label: '저장', value: true, kind: 'primary' }],
    onOpen: (r) => { r.querySelector('#pTheme').value = S.prefs.theme; r.querySelector('#pZoom').value = S.prefs.zoom; r.querySelector('#pPageDark').value = S.prefs.pageDark ? '1' : '0'; },
    collect: (r) => ({ author: r.querySelector('#pAuthor').value.trim(), theme: r.querySelector('#pTheme').value, zoom: r.querySelector('#pZoom').value, pageDark: r.querySelector('#pPageDark').value === '1' }),
  });
  if (!value) return;
  S.prefs = data; store.set('prefs', S.prefs); applyTheme(); applyPageDark(); syncThemeMenu();
  toast('설정을 저장했습니다.', 'ok');
}

async function privacyDlg() {
  const info = await host.secureInfo().catch(() => ({ encrypted: false }));
  const { value } = await modal({
    title: '개인 정보 지우기',
    body: `<p>이 PC에 남아 있는 다음 정보를 지웁니다. 열려 있는 문서와 PDF 파일 자체는 그대로입니다.</p>
      <dl class="kv"><dt>저장된 서명</dt><dd>${sigsList().length}개 ${info.encrypted ? '(' + esc(info.how || 'Windows 계정으로 암호화되어 있음') + ')' : ''}</dd><dt>최근 파일 목록</dt><dd>파일 이름과 위치</dd><dt>작성자 이름</dt><dd>${esc(S.prefs.author || '(없음)')}</dd></dl>`,
    buttons: [{ label: '취소', value: null }, { label: '모두 지우기', value: true, kind: 'danger' }],
  });
  if (!value) return;
  await host.privacyClear();
  sigCache = []; S.sigArmed = null;
  S.prefs.author = ''; store.set('prefs', S.prefs);
  try { localStorage.removeItem('pl.sigs'); } catch {}
  renderRecent(); renderPropbar();
  toast('서명, 최근 파일 목록, 작성자 이름을 지웠습니다.', 'ok');
}

function shortcutsDlg() {
  const rows = [
    ['파일 열기', 'Ctrl+O'], ['저장 / 다른 이름으로 저장', 'Ctrl+S / Ctrl+Shift+S'], ['인쇄', 'Ctrl+P'], ['찾기', 'Ctrl+F'],
    ['실행 취소 / 다시 실행', 'Ctrl+Z / Ctrl+Y'], ['확대 / 축소', 'Ctrl+= / Ctrl+-  (Ctrl+휠)'], ['실제 크기 / 페이지 맞춤 / 너비 맞춤', 'Ctrl+1 / Ctrl+0 / Ctrl+2'],
    ['선택 도구 / 손 도구', 'V / H'], ['강조 / 펜 / 텍스트 상자 / 메모', 'U / P / T / N'], ['선택한 주석 삭제', 'Delete'], ['선택한 주석 이동', '방향키 (Shift: 10pt)'],
    ['다음 / 이전 페이지', 'PageDown / PageUp'], ['탭 전환 / 닫기', 'Ctrl+Tab / Ctrl+W'], ['읽기 모드', 'Ctrl+H (끝내기: Esc)'], ['탐색 창 / 도구 창', 'F4 / Shift+F4'],
    ['직선·정사각형 맞춤', '그릴 때 Shift'], ['밝게/어둡게 전환', 'Ctrl+Shift+L'], ['야간 읽기 (페이지도 어둡게)', 'Ctrl+Shift+N'],
  ];
  const shown = host.web ? rows.filter(([n]) => !/탭 전환|야간 읽기/.test(n)) : rows;
  modal({ title: '단축키', wide: true, body: `<div class="shortcut-grid">${shown.map(([a, b]) => `<span>${esc(a)}</span><span>${b.split(' / ').map(k => `<kbd>${esc(k)}</kbd>`).join(' / ')}</span>`).join('')}</div>`, buttons: [{ label: '닫기', value: true, kind: 'primary' }] });
}

async function aboutDlg() {
  const i = await host.appInfo();
  const rows = host.web
    ? `<dt>버전</dt><dd>${esc(i.version)} (웹)</dd><dt>처리 방식</dt><dd>모든 작업이 브라우저 안에서 처리되며 파일을 서버로 보내지 않습니다.</dd><dt>데스크톱 앱</dt><dd><a href="${esc(host.repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(host.repoUrl.replace('https://', ''))}</a></dd>`
    : `<dt>버전</dt><dd>${esc(i.version)}</dd><dt>Electron</dt><dd>${esc(i.electron)}</dd><dt>Chromium</dt><dd>${esc(i.chrome)}</dd>`;
  modal({
    title: 'Basic PDF',
    body: `<p>PDF를 읽고, 주석을 달고, 서명하고, 페이지를 정리하는 ${host.web ? '웹' : '데스크톱'} 앱입니다.</p>
      <dl class="kv">${rows}<dt>사용한 라이브러리</dt><dd>PDF.js 3.11, pdf-lib 1.17, Lucide 아이콘</dd></dl>
      <p style="font-size:12px;color:var(--fg-3)">Adobe 및 Acrobat과 관련 없는 독립 프로그램입니다.</p>`,
    buttons: [{ label: '닫기', value: true, kind: 'primary' }],
  });
}

/* ======================= 명령 ======================= */
function inEditable() {
  const a = document.activeElement;
  return a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName));
}

async function runCmd(cmd) {
  if (cmd.startsWith('tool:')) { if (S.active) { if (S.org) closeOrganizer(); setTool(cmd.slice(5)); } return; }
  const tab = S.active;
  const needDoc = () => !!tab && !!S.pdf;
  switch (cmd) {
    case 'open': return openDialog();
    case 'combine': return combineFiles();
    case 'save': return needDoc() && saveTab(tab);
    case 'saveAs': return needDoc() && saveTab(tab, true);
    case 'print': return needDoc() && printDoc();
    case 'exportPng': return needDoc() && exportImages(false);
    case 'exportAllPng': return needDoc() && exportImages(true);
    case 'exportText': return needDoc() && exportText();
    case 'properties': return needDoc() && propertiesDlg();
    case 'closeTab': return tab && closeTab(tab);
    case 'undo': if (inEditable()) return document.execCommand('undo'); return undo();
    case 'redo': if (inEditable()) return document.execCommand('redo'); return redo();
    case 'find': return openFind();
    case 'deleteSel': return deleteSelected();
    case 'zoomIn': return needDoc() && zoomStep(1);
    case 'zoomOut': return needDoc() && zoomStep(-1);
    case 'zoom100': if (needDoc()) viewer.currentScaleValue = '1'; return;
    case 'fitPage': if (needDoc()) viewer.currentScaleValue = 'page-fit'; return;
    case 'fitWidth': if (needDoc()) viewer.currentScaleValue = 'page-width'; return;
    case 'rotateCw': if (needDoc()) viewer.pagesRotation = (viewer.pagesRotation + 90) % 360; return;
    case 'rotateCcw': if (needDoc()) viewer.pagesRotation = (viewer.pagesRotation + 270) % 360; return;
    case 'prevPage': if (needDoc()) viewer.previousPage(); return;
    case 'nextPage': if (needDoc()) viewer.nextPage(); return;
    case 'layoutSingle': if (needDoc()) { viewer.spreadMode = SpreadMode.NONE; viewer.scrollMode = ScrollMode.PAGE; } $('#layoutMenu').hidden = true; return;
    case 'layoutScroll': if (needDoc()) { viewer.scrollMode = ScrollMode.VERTICAL; viewer.spreadMode = SpreadMode.NONE; } $('#layoutMenu').hidden = true; return;
    case 'layoutSpread': if (needDoc()) { viewer.scrollMode = ScrollMode.VERTICAL; viewer.spreadMode = SpreadMode.ODD; } $('#layoutMenu').hidden = true; return;
    case 'toggleNav': return openNav(S.navOpen ? S.navTab : S.navTab);
    case 'toggleTools': { const p = $('#toolsPanel'); p.hidden = !p.hidden; store.set('toolsOpen', !p.hidden); setTimeout(() => S.pdf && viewer.update(), 0); return; }
    case 'readMode': return setReadMode(!document.body.classList.contains('read-mode'));
    case 'toggleTheme': S.prefs.theme = effectiveDark() ? 'light' : 'dark'; store.set('prefs', S.prefs); applyTheme(); syncThemeMenu(); return;
    case 'themeLight': S.prefs.theme = 'light'; store.set('prefs', S.prefs); applyTheme(); syncThemeMenu(); return;
    case 'themeDark': S.prefs.theme = 'dark'; store.set('prefs', S.prefs); applyTheme(); syncThemeMenu(); return;
    case 'themeSystem': S.prefs.theme = 'system'; store.set('prefs', S.prefs); applyTheme(); syncThemeMenu(); return;
    case 'pageDark': S.prefs.pageDark = !S.prefs.pageDark; store.set('prefs', S.prefs); applyPageDark(); syncThemeMenu(); return;
    case 'organize': if (needDoc()) openOrganizer(); return;
    case 'pageNumbers': return needDoc() && pageNumbersDlg();
    case 'watermark': return needDoc() && watermarkDlg();
    case 'shortcuts': return shortcutsDlg();
    case 'about': return aboutDlg();
    case 'prefs': return prefsDlg();
    case 'privacyClear': return privacyDlg();
  }
}

function setReadMode(on) {
  if (!S.active && on) return;
  document.body.classList.toggle('read-mode', on);
  host.setFullscreen(on);
  if (on) { setTool('select'); toast('읽기 모드입니다. Esc를 누르면 돌아갑니다.'); }
  setTimeout(() => { if (S.pdf) { viewer.update(); if (typeof viewer.currentScaleValue === 'string' && /page|auto/.test(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue; } }, 300);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b && !b.disabled) {
    const after = b.dataset.after;
    if (b.dataset.cmd === 'open' && after) { openDialog(after); return; }
    runCmd(b.dataset.cmd);
  }
  const t = e.target.closest('#rail [data-tool]');
  if (t && S.active) {
    if (S.org) closeOrganizer();
    const tool = t.dataset.tool;
    if (tool === 'rect') setTool(SHAPES.includes(S.tool) ? 'select' : S.opts.shapeKind || 'rect');
    else setTool(S.tool === tool && tool !== 'select' ? 'select' : tool);
  }
});
$('#homeTab').onclick = () => goHome();

host.onMenu((cmd) => runCmd(cmd));
host.onOpenPath((p) => openPath(p));

document.addEventListener('keydown', (e) => {
  if ($('#modalRoot').children.length) return;
  const editable = inEditable();
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (!S.tabs.length) return;
    const i = S.tabs.indexOf(S.active);
    const n = e.shiftKey ? (i <= 0 ? S.tabs.length - 1 : i - 1) : (i + 1) % S.tabs.length;
    activateTab(S.tabs[n]);
    return;
  }
  if (e.key === 'Escape') {
    if (document.body.classList.contains('read-mode')) return setReadMode(false);
    if (!$('#findbar').hidden && document.activeElement === $('#findInput')) return closeFind();
    if (S.org) return;
    if (S.sel) { const pi = S.sel.pi; S.sel = null; drawPage(pi); renderPropbar(); renderComments(true); return; }
    if (S.tool !== 'select') setTool('select');
    return;
  }
  if (editable || e.ctrlKey || e.metaKey || e.altKey) {
    if (S.org && e.ctrlKey && e.key.toLowerCase() === 'a' && !editable) { e.preventDefault(); S.org.sel = new Set(S.org.entries.map(x => x.key)); renderOrganizer(); }
    return;
  }
  if (S.org) {
    if (e.key === 'Delete') orgAction('delete');
    return;
  }
  if (!S.active) return;
  const k = e.key.toLowerCase();
  if (k === 'delete' || k === 'backspace') { if (S.sel) { e.preventDefault(); deleteSelected(); } return; }
  if (S.sel && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
    e.preventDefault();
    const tab = S.active, o = findObj(tab, S.sel.pi, S.sel.id);
    const d = e.shiftKey ? 10 : 1;
    const before = snap(tab);
    ANN.move(o, k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    pushHistory(tab, before);
    drawPage(S.sel.pi);
    return;
  }
  const map = { v: 'select', h: 'hand', u: 'highlight', p: 'ink', t: 'text', n: 'note', e: 'edittext' };
  if (map[k]) { e.preventDefault(); setTool(map[k]); return; }
  if (S.pdf && viewer.scrollMode === ScrollMode.PAGE && (k === 'arrowright' || k === 'arrowdown')) { viewer.nextPage(); e.preventDefault(); }
  if (S.pdf && viewer.scrollMode === ScrollMode.PAGE && (k === 'arrowleft' || k === 'arrowup')) { viewer.previousPage(); e.preventDefault(); }
});

/* ---------- 끌어다 놓기 ---------- */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropOverlay').hidden = false; } });
window.addEventListener('dragleave', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dragDepth = 0; $('#dropOverlay').hidden = true;
  const files = Array.from(e.dataTransfer.files).filter(f => /\.pdf$/i.test(f.name));
  if (!files.length) { toast('PDF 파일만 열 수 있습니다.', 'err'); return; }
  for (const f of files) {
    const p = await host.openDropped(f).catch(() => null);
    if (p) await openPath(p);
    else { const bytes = new Uint8Array(await f.arrayBuffer()); const tab = newTab({ name: f.name, bytes }); S.tabs.push(tab); await activateTab(tab); }
  }
});

/* ---------- 창 닫기 ---------- */
host.onRequestClose(async () => {
  commitEdit(); closeNotePop();
  for (const t of S.tabs.slice()) {
    if (!t.dirty) continue;
    await activateTab(t);
    const r = await askSave(t);
    if (r === 'cancel') return;
    if (r === 'save' && !(await saveTab(t))) return;
  }
  host.confirmClose();
});

/* ======================= 툴팁 ======================= */
const TIP_KEYS = {
  open: 'Ctrl+O', save: 'Ctrl+S', print: 'Ctrl+P', undo: 'Ctrl+Z', redo: 'Ctrl+Y', find: 'Ctrl+F', properties: 'Ctrl+D',
  saveAs: 'Ctrl+Shift+S', toggleTools: 'Shift+F4', toggleNav: 'F4',
  'tool:select': 'V', 'tool:hand': 'H', 'tool:highlight': 'U', 'tool:ink': 'P', 'tool:text': 'T', 'tool:note': 'N', 'tool:edittext': 'E',
};
const tipEl = document.createElement('div');
tipEl.className = 'tip';
document.body.append(tipEl);
let tipTimer = null, tipFor = null;
function hideTip() { clearTimeout(tipTimer); tipTimer = null; tipFor = null; tipEl.classList.remove('show'); }
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest('[title], [data-tip]');
  if (!t || t === tipFor) return;
  if (t.hasAttribute('title')) { t.dataset.tip = t.getAttribute('title'); t.removeAttribute('title'); }
  hideTip();
  tipFor = t;
  tipTimer = setTimeout(() => {
    if (!tipFor || !tipFor.isConnected) return;
    const raw = tipFor.dataset.tip || '';
    const m = /^(.*?)\s*\(([^()]*(?:Ctrl|Shift|F\d|Delete|Esc|[A-Z])[^()]*)\)$/.exec(raw);
    const key = tipFor.dataset.tool ? TIP_KEYS['tool:' + tipFor.dataset.tool] : TIP_KEYS[tipFor.dataset.cmd];
    const label = m ? m[1] : raw, k = m ? m[2] : key;
    tipEl.innerHTML = esc(label) + (k ? `<kbd>${esc(k)}</kbd>` : '');
    const r = tipFor.getBoundingClientRect();
    const side = tipFor.closest('#rail') ? 'right' : tipFor.closest('#navRail') ? 'left' : 'below';
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x, y;
    if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2 - th / 2; }
    else if (side === 'left') { x = r.left - tw - 10; y = r.top + r.height / 2 - th / 2; }
    else { x = r.left + r.width / 2 - tw / 2; y = r.bottom + 8; if (y + th > innerHeight - 4) y = r.top - th - 8; }
    tipEl.style.left = `${clamp(x, 4, innerWidth - tw - 4)}px`;
    tipEl.style.top = `${clamp(y, 4, innerHeight - th - 4)}px`;
    tipEl.classList.add('show');
  }, 450);
});
document.addEventListener('pointerout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('pointerdown', hideTip, true);
document.addEventListener('wheel', hideTip, { passive: true, capture: true });

/* ======================= 웹 전용 ======================= */
if (host.web) {
  window.addEventListener('beforeunload', (e) => { if (S.tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('read-mode')) setReadMode(false); });
  document.body.classList.add('is-web');
}

/* ======================= 시작 ======================= */
icons();
loadSigs();
if (!store.get('toolsOpen', false)) $('#toolsPanel').hidden = true;
applyNav();
renderTabs();
renderRecent();
updateChrome();
setTool('select', true);
applyPageDark();
syncThemeMenu();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); syncThemeMenu(); });
window.__pl = { S, viewer, eventBus, runCmd, openPath, OPS, buildOutput, reload: async () => { saveViewState(S.active); await loadIntoViewer(S.active, true); } };
