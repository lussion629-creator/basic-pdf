'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('host', {
  openDialog: (opts) => ipcRenderer.invoke('open-dialog', opts),
  saveDialog: (opts) => ipcRenderer.invoke('save-dialog', opts),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  writeFile: (p, data) => ipcRenderer.invoke('write-file', p, data),
  joinPath: (a, b) => ipcRenderer.invoke('join-path', a, b),
  recent: () => ipcRenderer.invoke('recent'),
  recentRemove: (p) => ipcRenderer.invoke('recent-remove', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  systemFont: () => ipcRenderer.invoke('system-font'),
  print: () => ipcRenderer.invoke('print'),
  appInfo: () => ipcRenderer.invoke('app-info'),
  setTitle: (t) => ipcRenderer.send('set-title', t),
  setFullscreen: (v) => ipcRenderer.send('set-fullscreen', v),
  confirmClose: () => ipcRenderer.send('confirm-close'),
  // 끌어다 놓은 실제 파일에서만 경로를 얻는다 (화면 코드가 임의 경로를 지어낼 수 없음)
  openDropped: async (file) => {
    let p = '';
    try { p = webUtils.getPathForFile(file); } catch {}
    if (!p) return null;
    return ipcRenderer.invoke('read-dropped', p);
  },
  sigsGet: () => ipcRenderer.invoke('sigs-get'),
  sigsSet: (list) => ipcRenderer.invoke('sigs-set', list),
  privacyClear: () => ipcRenderer.invoke('privacy-clear'),
  secureInfo: () => ipcRenderer.invoke('secure-info'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd, arg) => fn(cmd, arg)),
  onOpenPath: (fn) => ipcRenderer.on('open-path', (_e, p) => fn(p)),
  onRequestClose: (fn) => ipcRenderer.on('request-close', () => fn()),
});
