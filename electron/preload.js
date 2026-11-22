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
  'filamentPickImage', 'filamentSetImage', 'filamentsOpenDir',
  'modelCost', 'modelsCosts', 'modelSetFilaments',
  'receiptsList', 'receiptsWithModels', 'receiptsClear', 'receiptsDelete',
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

// 后端就绪信号。窗口现在先于 services.init 创建，preload 在 document-start 就监听，
// 即使消息比渲染层模块加载更早也不会丢；main.js 还会在 did-finish-load 补发一次。
let backendReady = false;
const readyWaiters = [];
ipcRenderer.on('app:ready', () => {
  backendReady = true;
  for (const fn of readyWaiters.splice(0)) fn(true);
});
shelf.whenReady = () => (backendReady
  ? Promise.resolve(true)
  : new Promise((resolve) => readyWaiters.push(resolve)));

contextBridge.exposeInMainWorld('shelf', shelf);
