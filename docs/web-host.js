'use strict';
/* Basic PDF — 웹 버전 호스트 계층
   데스크톱(Electron)에서 메인 프로세스가 하던 일을 브라우저 기능으로 대신한다.
   - 파일 열기/저장: File System Access API(크롬·엣지) → 없으면 파일 선택창 + 다운로드
   - 서명: 이 브라우저 안에서만 AES-GCM으로 암호화해 보관 (키는 꺼낼 수 없는 형태로 IndexedDB에 보관)
   - 한글 글꼴: 함께 배포하는 Noto Sans KR(한글 부분)을 사용
   - 서버로 아무것도 보내지 않는다. 모든 처리는 브라우저 안에서 끝난다. */
(function () {
  const VERSION = '1.0.0';
  const REPO_URL = 'https://github.com/lussion629-creator/basic-pdf';
  const inArtifact = !!(window.claude && typeof window.claude.use === 'function');
  const hasOpenPicker = typeof window.showOpenFilePicker === 'function' && !inArtifact && window.top === window;
  const hasSavePicker = typeof window.showSaveFilePicker === 'function' && !inArtifact && window.top === window;
  const hasDirPicker = typeof window.showDirectoryPicker === 'function' && !inArtifact && window.top === window;

  let seq = 0;
  const files = new Map();   // token → { file?: File, handle?: FileSystemFileHandle, bytes?: Uint8Array }
  const dirs = new Map();    // token → { handle?: FileSystemDirectoryHandle, zip?: {name, entries, timer} }
  const baseName = (p) => String(p || '').split(/[\\/]/).pop();
  const tokenFor = (kind, name) => `${kind}${++seq}/${baseName(name) || '문서.pdf'}`;

  /* ---------- IndexedDB (최근 파일 핸들, 서명 암호화 키) ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('basic-pdf', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('recent', { keyPath: 'id' }); r.result.createObjectStore('keys'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, mode);
      const st = tx.objectStore(store);
      const req = fn(st);
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }

  async function rememberRecent(handle, size) {
    if (!handle) return;
    try {
      const all = (await idb('recent', 'readonly', st => st.getAll())) || [];
      for (const r of all) {
        if (r.handle && (await r.handle.isSameEntry(handle).catch(() => false))) await idb('recent', 'readwrite', st => st.delete(r.id));
      }
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await idb('recent', 'readwrite', st => st.put({ id, name: handle.name, size: size || 0, openedAt: Date.now(), handle }));
      const fresh = ((await idb('recent', 'readonly', st => st.getAll())) || []).sort((a, b) => b.openedAt - a.openedAt);
      for (const r of fresh.slice(20)) await idb('recent', 'readwrite', st => st.delete(r.id));
    } catch {}
  }

  /* ---------- 서명 암호화 ---------- */
  const SIG_KEY = 'bp.sigs.enc';
  async function sigKey() {
    let key = await idb('keys', 'readonly', st => st.get('sig')).catch(() => null);
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idb('keys', 'readwrite', st => st.put(key, 'sig'));
    }
    return key;
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const validSig = (s) => typeof s === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 4 * 1024 * 1024;
  const cryptoOK = !!(window.crypto && crypto.subtle && window.isSecureContext && window.indexedDB);

  /* ---------- 다운로드 ---------- */
  let downloadsCap = null;
  if (inArtifact) window.claude.use('downloads').then(d => { downloadsCap = d; }).catch(() => {});
  async function download(name, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime(name) });
    if (inArtifact) {
      const d = downloadsCap || (await window.claude.use('downloads').catch(() => null));
      if (!d) throw new Error('이 화면에서는 파일을 내려받을 수 없습니다.');
      try { await d.save({ filename: name, data: blob }); return true; }
      catch (e) { if (e && e.code === 'declined') return false; throw new Error((e && e.message) || '내려받지 못했습니다.'); }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  function mime(name) {
    if (/\.pdf$/i.test(name)) return 'application/pdf';
    if (/\.png$/i.test(name)) return 'image/png';
    if (/\.txt$/i.test(name)) return 'text/plain;charset=utf-8';
    if (/\.zip$/i.test(name)) return 'application/zip';
    return 'application/octet-stream';
  }

  /* ---------- 파일 선택 (input 대체) ---------- */
  function pickWithInput(multi) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.multiple = !!multi;
      inp.style.display = 'none';
      let done = false;
      const finish = (list) => { if (done) return; done = true; inp.remove(); resolve(list); };
      inp.onchange = () => finish(Array.from(inp.files || []));
      inp.addEventListener('cancel', () => finish([]));
      document.body.append(inp);
      inp.click();
    });
  }

  const WRITE_EXT = /\.(pdf|png|txt)$/i;
  let menuHandler = null;

  window.host = {
    web: true,
    inArtifact,
    noFolders: true,
    recentSupported: hasOpenPicker,
    repoUrl: REPO_URL,

    async openDialog(opts = {}) {
      if (hasOpenPicker) {
        try {
          const hs = await window.showOpenFilePicker({ multiple: !!opts.multi, types: [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }], excludeAcceptAllOption: true });
          return hs.map(h => { const t = tokenFor('h', h.name); files.set(t, { handle: h }); return t; });
        } catch (e) { if (e && e.name === 'AbortError') return []; }
      }
      const list = await pickWithInput(opts.multi);
      return list.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf').map(f => { const t = tokenFor('o', f.name); files.set(t, { file: f }); return t; });
    },

    async readFile(p) {
      const e = files.get(p);
      if (!e) throw new Error('직접 연 파일만 읽을 수 있습니다.');
      if (e.bytes) return e.bytes.slice();
      let file = e.file;
      if (!file && e.handle) {
        if (e.handle.queryPermission && (await e.handle.queryPermission({ mode: 'read' })) !== 'granted') {
          if ((await e.handle.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('파일을 읽을 권한이 없습니다.');
        }
        file = await e.handle.getFile();
        rememberRecent(e.handle, file.size);
      }
      if (!file) throw new Error('파일을 읽을 수 없습니다.');
      if (file.size > 1024 * 1024 * 1024) throw new Error('파일이 너무 큽니다.');
      return new Uint8Array(await file.arrayBuffer());
    },

    async openDropped(file) {
      if (!file || !/\.pdf$/i.test(file.name)) return null;
      const t = tokenFor('o', file.name);
      files.set(t, { file });
      return t;
    },

    async saveDialog(opts = {}) {
      const kind = opts.kind === 'png' ? 'png' : opts.kind === 'txt' ? 'txt' : 'pdf';
      let name = baseName(opts.defaultPath) || `문서.${kind}`;
      if (!new RegExp(`\\.${kind}$`, 'i').test(name)) name = name.replace(/\.[^.]*$/, '') + '.' + kind;
      if (hasSavePicker) {
        const types = { pdf: { description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }, png: { description: 'PNG 이미지', accept: { 'image/png': ['.png'] } }, txt: { description: '텍스트', accept: { 'text/plain': ['.txt'] } } }[kind];
        try {
          const h = await window.showSaveFilePicker({ suggestedName: name, types: [types] });
          const t = tokenFor('s', h.name);
          files.set(t, { handle: h });
          return t;
        } catch (e) { if (e && e.name === 'AbortError') return null; }
      }
      const t = tokenFor('d', name);
      files.set(t, {});
      return t;
    },

    async chooseFolder() {
      if (hasDirPicker) {
        try {
          const h = await window.showDirectoryPicker({ mode: 'readwrite' });
          const t = `f${++seq}`;
          dirs.set(t, { handle: h });
          return t;
        } catch (e) { if (e && e.name === 'AbortError') return null; }
      }
      const t = `z${++seq}`;
      dirs.set(t, { zip: { entries: {}, timer: null, name: 'Basic PDF 내보내기.zip' } });
      return t;
    },

    async joinPath(a, b) {
      if (typeof b !== 'string' || /[\\/]/.test(b) || b === '.' || b === '..') throw new Error('잘못된 파일 이름입니다.');
      return `${a}/${b}`;
    },

    async writeFile(p, data) {
      if (typeof p !== 'string' || !WRITE_EXT.test(p)) throw new Error('저장할 수 없는 파일 형식입니다.');
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const name = baseName(p);
      const folder = p.slice(0, p.length - name.length - 1);
      if (dirs.has(folder)) {
        const d = dirs.get(folder);
        if (d.handle) {
          const fh = await d.handle.getFileHandle(name, { create: true });
          const w = await fh.createWritable(); await w.write(bytes); await w.close();
          const t = folder + '/' + name; files.set(t, { handle: fh });
          return true;
        }
        // 폴더를 고를 수 없는 브라우저: 모아서 zip 하나로 내려받기
        const z = d.zip;
        z.entries[name] = bytes;
        files.set(p, { bytes });
        clearTimeout(z.timer);
        z.timer = setTimeout(async () => {
          const out = window.fflate.zipSync(z.entries, { level: 0 });
          z.entries = {};
          try { await download(z.name, out); } catch (e) { console.error(e); }
        }, 700);
        return true;
      }
      const e = files.get(p);
      if (!e) throw new Error('직접 고른 위치에만 저장할 수 있습니다.');
      if (e.handle && e.handle.createWritable) {
        try {
          if (e.handle.queryPermission && (await e.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
            if ((await e.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('denied');
          }
          const w = await e.handle.createWritable(); await w.write(bytes); await w.close();
          rememberRecent(e.handle, bytes.length);
          return true;
        } catch (err) { /* 쓰기 권한이 없으면 내려받기로 대신 */ }
      }
      const ok = await download(name, bytes);
      if (!ok) throw new Error('내려받기를 취소했습니다.');
      e.bytes = bytes; // 다시 열 수 있게 메모리에 보관
      return true;
    },

    async recent() {
      if (!hasOpenPicker) return [];
      try {
        const all = ((await idb('recent', 'readonly', st => st.getAll())) || []).sort((a, b) => b.openedAt - a.openedAt);
        return all.map(r => {
          const t = `h${r.id}/${r.name}`;
          files.set(t, { handle: r.handle });
          return { path: t, name: r.name, size: r.size, openedAt: r.openedAt, id: r.id };
        });
      } catch { return []; }
    },
    async recentRemove(p) {
      const m = /^h(r[^/]+)\//.exec(p);
      if (m) await idb('recent', 'readwrite', st => st.delete(m[1])).catch(() => {});
      return this.recent();
    },
    showInFolder() {},

    async systemFont() {
      try {
        const r = await fetch('fonts/NotoSansKR-Hangul.ttf');
        if (!r.ok) return null;
        return { name: 'NotoSansKR-Hangul.ttf', data: new Uint8Array(await r.arrayBuffer()), bold: null };
      } catch { return null; }
    },

    async print() {
      if (inArtifact) return { ok: false, reason: '이 화면에서는 인쇄할 수 없습니다. PDF로 저장한 뒤 인쇄하세요.' };
      window.print();
      return { ok: true };
    },

    async appInfo() { return { version: VERSION, electron: '', chrome: '', platform: 'web' }; },
    setTitle(t) { if (typeof t === 'string') document.title = t.slice(0, 300); },
    setFullscreen(v) {
      try {
        if (v && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        if (!v && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch {}
    },
    confirmClose() {},

    async sigsGet() {
      try {
        const raw = localStorage.getItem(SIG_KEY);
        if (!raw) return [];
        const { iv, ct } = JSON.parse(raw);
        const key = await sigKey();
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
        const list = JSON.parse(new TextDecoder().decode(pt));
        return Array.isArray(list) ? list.filter(validSig) : [];
      } catch { return []; }
    },
    async sigsSet(list) {
      const clean = (Array.isArray(list) ? list : []).filter(validSig).slice(0, 6);
      if (!clean.length) { try { localStorage.removeItem(SIG_KEY); } catch {} return clean; }
      if (!cryptoOK) return clean; // 암호화할 수 없는 환경에서는 저장하지 않고 이번 사용에만 쓴다
      const key = await sigKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(clean))));
      try { localStorage.setItem(SIG_KEY, JSON.stringify({ iv: b64(iv), ct: b64(ct) })); } catch {}
      return clean;
    },
    async privacyClear() {
      try { localStorage.removeItem(SIG_KEY); } catch {}
      try { await idb('recent', 'readwrite', st => st.clear()); } catch {}
      try { await idb('keys', 'readwrite', st => st.clear()); } catch {}
      return true;
    },
    async secureInfo() { return { encrypted: cryptoOK, how: '이 브라우저 안에서 암호화되어 있음' }; },

    onMenu(fn) { menuHandler = fn; },
    onOpenPath() {},
    onRequestClose() {},
  };

  /* ---------- 단축키 (데스크톱 메뉴의 단축키를 대신함) ---------- */
  const KEYS = {
    'ctrl+o': 'open', 'ctrl+s': 'save', 'ctrl+shift+s': 'saveAs', 'ctrl+p': 'print', 'ctrl+f': 'find', 'ctrl+d': 'properties', 'ctrl+k': 'prefs',
    'ctrl+z': 'undo', 'ctrl+y': 'redo', 'ctrl+shift+z': 'redo',
    'ctrl+=': 'zoomIn', 'ctrl++': 'zoomIn', 'ctrl+-': 'zoomOut', 'ctrl+0': 'fitPage', 'ctrl+1': 'zoom100', 'ctrl+2': 'fitWidth',
    'ctrl+shift+=': 'rotateCw', 'ctrl+shift++': 'rotateCw', 'ctrl+shift+-': 'rotateCcw', 'ctrl+shift+_': 'rotateCcw',
    'ctrl+h': 'readMode', 'ctrl+shift+l': 'toggleTheme', 'f4': 'toggleNav', 'shift+f4': 'toggleTools', 'f1': 'shortcuts',
  };
  window.addEventListener('keydown', (e) => {
    if (!menuHandler) return;
    if (document.getElementById('modalRoot')?.children.length) return;
    const k = (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + (e.altKey ? 'alt+' : '') + e.key.toLowerCase();
    const cmd = KEYS[k];
    if (!cmd) return;
    const a = document.activeElement;
    const editable = a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName));
    if (editable && ['ctrl+z', 'ctrl+y', 'ctrl+shift+z'].includes(k)) return; // 입력 칸에서는 브라우저 기본 실행 취소
    e.preventDefault();
    menuHandler(cmd);
  }, true);

  /* ---------- 웹 메뉴 버튼 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('webMenuBtn');
    const menu = document.getElementById('webMenu');
    if (!btn || !menu) return;
    if (inArtifact) menu.querySelectorAll('[data-cmd="print"]').forEach(b => b.remove());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.menu').forEach(m => { if (m !== menu) m.hidden = true; });
      menu.hidden = !menu.hidden;
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('[data-cmd], a')) menu.hidden = true; });
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) menu.hidden = true; }, true);
  });
})();
