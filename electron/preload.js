'use strict';
/**
 * 安全桥：contextIsolation 开启，渲染层只能拿到这里白名单内的方法与事件。
 * 方法名必须与 src/renderer/js/api.js 的 METHODS 表、electron/ipc/index.js 的 handlers 完全一致。
 */
const { contextBridge, ipcRenderer } = require('electron');

const METHODS = [
  'bootstrap', 'getInfo', 'openDataDir',
  'query', 'get', 'stats', 'smartCounts', 'update', 'bulk', 'rename', 'renameFile',
  'remove', 'trash', 'relink', 'findRelinkCandidates', 'markOpened', 'setPrintStatus',
  'roulette', 'undo',
  'categories', 'categoryCreate', 'categoryUpdate', 'categoryDelete',
  'tags', 'tagCreate', 'tagUpdate', 'tagDelete', 'tagAssign',
  'views', 'viewSave', 'viewDelete',
  'scanStart', 'scanCancel', 'scanStatus',
  'folders', 'folderAdd', 'folderUpdate', 'folderRemove', 'watchRefresh',
  'drivesList',
  'thumbRegenerate', 'thumbStats', 'thumbPrune',
  'slicers', 'slicerDetect', 'slicerAdd', 'slicerUpdate', 'slicerRemove',
  'slicerSetDefault', 'slicerValidate', 'slicerOpen',
  'u1Status', 'u1Convert', 'u1Cancel', 'u1ClearCache', 'u1PresetsInvalidate',
  'u1OpenCache', 'openWith',
  'u1PresetHealth', 'u1PresetSnapshot', 'u1PresetRestore', 'u1OpenPresetBackups',
  'fileAssocReport', 'fileAssocOpenSettings', 'fileAssocRepair',
  'printersList', 'printersSnapshot', 'printerAdd', 'printerUpdate', 'printerRemove',
  'printerTest', 'printerAction', 'printersDiscover', 'cameraFrame', 'cameraDetect',
  'monitorHistory', 'monitorChart', 'monitorLatest', 'monitorStatus', 'monitorClear', 'notifyTest',
  'filamentsList', 'filamentCreate', 'filamentUpdate', 'filamentRemove', 'filamentSetDefault',
  'filamentPickImage', 'filamentSetImage', 'filamentReadImage', 'filamentSetImageData', 'filamentsOpenDir',
  'modelCost', 'modelsCosts', 'modelSetFilaments',
  'receiptsList', 'receiptsWithModels', 'receiptsClear', 'receiptsDelete', 'receiptsLinkModel',
  'receiptsAutoLink',
  'bambuCloudStatus', 'bambuCloudLogin', 'bambuCloudLoginCode', 'bambuCloudLogout', 'bambuCloudSync',
  'reveal', 'copyPath', 'openExternal',
  'classifyRun', 'classifySkipUnmatched', 'classifyUndo', 'classifyPreset',
  'settings', 'settingsUpdate',
  'pickFolder', 'pickExe', 'pickJson', 'saveJson',
  'backups', 'backup', 'restore', 'exportData', 'importData',
  'meshInspect', 'meshBlender', 'meshBlenderSet', 'meshOptimize', 'meshCancel', 'meshAddToLibrary',
  'win',
];

const EVENTS = [
  'scan:progress', 'scan:done', 'lib:changed', 'watcher:changed',
  'app:toast', 'app:error', 'app:ready', 'boot:stage',
  'mesh:progress', 'mesh:log', 'mesh:done', 'mesh:error',
  'u1:progress', 'u1:log', 'u1:cancelled',
  'printers:update', 'printers:changed', 'printers:notify',
  'receipts:changed', 'filaments:changed',
];

// 启动阶段信号早于渲染层模块加载是常态，缓存整段历史，订阅时按顺序补发，
// 这样用户能看到完整进度（starting → store → … → backend），而不只是最后一帧。
const EVENT_HISTORY = new Map();
ipcRenderer.on('boot:stage', (_event, payload) => {
  const list = EVENT_HISTORY.get('boot:stage') || [];
  list.push(payload);
  if (list.length > 12) list.shift();
  EVENT_HISTORY.set('boot:stage', list);
});

const shelf = {};
for (const name of METHODS) {
  shelf[name] = (...args) => ipcRenderer.invoke('shelf:' + name, ...args);
}

shelf.on = (channel, cb) => {
  if (!EVENTS.includes(channel) || typeof cb !== 'function') return () => {};
  const listener = (_event, payload) => {
    try { cb(payload); } catch (e) { console.error('[PrintShelf] 事件处理异常', channel, e); }
  };
  ipcRenderer.on(channel, listener);
  // 只对启动阶段这类「一次性、早发」的信号补发，避免普通事件重复投递
  if (EVENT_HISTORY.has(channel)) {
    const history = EVENT_HISTORY.get(channel).slice();
    setTimeout(() => { for (const payload of history) listener(null, payload); }, 0);
  }
  return () => ipcRenderer.removeListener(channel, listener);
};

// 后端就绪 / 失败信号。窗口先于 services.init 创建，preload 在 document-start 就监听，
// 消息比渲染层模块加载更早也不会丢；main.js 在 did-finish-load 还会补发一次。
//
// 约定（供渲染层 api.js 同步）：
//   · 成功：whenReady() resolve(true)
//   · 失败：whenReady() reject(Error)，err.name === 'PrintShelfStartupError'，
//           err.message 为已本地化的中文原因；失败态被缓存，后续调用同样立即 reject。
// 渲染层不要用 || true / catch(()=>true) 把失败吞掉，否则 bootstrap 会打到未注册的 IPC。
let readyState = 'pending'; // pending | ready | failed
let readyError = null;
const readyWaiters = [];

function resolveReady() {
  readyState = 'ready';
  readyError = null;
  for (const w of readyWaiters.splice(0)) w.resolve(true);
}

function rejectReady(payload) {
  readyState = 'failed';
  const message = (payload && payload.message) || '程序启动失败，请重新启动 PrintShelf';
  const err = new Error(message);
  err.name = 'PrintShelfStartupError';
  readyError = err;
  for (const w of readyWaiters.splice(0)) w.reject(err);
}

ipcRenderer.on('app:ready', (_event, payload) => {
  if (payload && payload.ok === false) rejectReady(payload);
  else resolveReady(); // 兼容旧主进程只发空 payload 的情况
});

shelf.whenReady = () => {
  if (readyState === 'ready') return Promise.resolve(true);
  if (readyState === 'failed') return Promise.reject(readyError);
  return new Promise((resolve, reject) => readyWaiters.push({ resolve, reject }));
};

contextBridge.exposeInMainWorld('shelf', shelf);
