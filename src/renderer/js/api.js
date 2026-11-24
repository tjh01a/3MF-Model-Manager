'use strict';
/** window.shelf 薄封装：统一错误 Toast、主进程事件转渲染层 window 自定义事件。 */

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

/**
 * ipcRenderer.invoke 的 reject 会被 Electron 包成
 *   Error invoking remote method 'shelf:xxx': Error: <真正的中文消息>
 * 直接弹给用户很难看，这里把前缀剥掉，只留业务自己的话。
 */
// 底层英文错误给人话。顺序要紧：先剥掉 Electron 的远程调用前缀，再逐条匹配。
const FRIENDLY_RULES = [
  [/No handler registered/i, '后端功能尚未注册，请稍后重试或重启应用'],
  [/EPERM|EACCES/i, '没有权限执行此操作，请检查文件或目录权限'],
  [/ENOENT/i, '找不到指定的文件或目录'],
  [/ENOTDIR/i, '路径中有不是目录的部分，请检查路径是否正确'],
  [/EEXIST/i, '同名文件或记录已存在'],
  [/ETIMEDOUT|\btimeout\b/i, '连接超时，请稍后重试'],
  [/ECONNREFUSED|ECONNRESET/i, '本地服务未连接或连接被中断'],
  [/Object has been destroyed/i, '窗口已关闭，操作已取消'],
];
function friendlyMessage(err) {
  const raw = (err && err.message) || String(err || '');
  const m = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]*)$/.exec(raw);
  const text = (m ? m[1] : raw).trim();
  for (const [re, msg] of FRIENDLY_RULES) if (re.test(text)) return msg;
  return text || '操作失败';
}

const OFFLINE_MSG = '请在 PrintShelf 桌面应用中打开';

function noop() {}

// 轻量调用计数：性能走查用来证明「纯 UI 刷新不发查库 IPC」。
// 不能靠打桩 window.shelf —— contextBridge 暴露的对象是冻结的，赋值会被静默忽略。
const ipcStat = { bootstrap: 0, query: 0, stats: 0, smartCounts: 0 };
if (typeof window !== 'undefined') window.__printshelfIpc = ipcStat;

function buildApi() {
  const shelf = (typeof window !== 'undefined' && window.shelf) ? window.shelf : null;
  const proxy = {};
  for (const name of METHODS) {
    proxy[name] = function (...args) {
      if (Object.prototype.hasOwnProperty.call(ipcStat, name)) ipcStat[name]++;
      let base;
      if (!shelf || typeof shelf[name] !== 'function') {
        // 浏览器直接打开调试时仍可用，返回 rejected Promise 并给出中文提示，不让页面白屏
        base = Promise.reject(new Error(OFFLINE_MSG));
      } else {
        try {
          base = Promise.resolve(shelf[name](...args));
        } catch (err) {
          base = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      // 统一错误提示后 rethrow：业务代码可 try/catch 也可直接 await
      const guarded = base.catch((err) => {
        emitToast('error', friendlyMessage(err));
        throw err;
      });
      // 附加空消费者，避免 fire-and-forget 调用产生未处理的 rejection（不影响调用方 await 拿到错误）
      guarded.catch(noop);
      return guarded;
    };
  }
  return proxy;
}

export const api = buildApi();

/** 订阅主进程事件，返回取消订阅函数 */
export function on(channel, cb) {
  const shelf = (typeof window !== 'undefined') ? window.shelf : null;
  if (shelf && typeof shelf.on === 'function' && typeof cb === 'function') {
    try {
      const off = shelf.on(channel, cb);
      return typeof off === 'function' ? off : noop;
    } catch (_) { return noop; }
  }
  return noop;
}

/**
 * 等后端（服务 + IPC handler）就绪。窗口先创建、后端后初始化，
 * 没有这道闸门时 mountDevices / bootstrap 会在 handler 注册前发请求。
 *
 * 返回 Promise<{ok, reason, message}>，明确区分三种结果：
 *   ok:true               服务与 IPC handler 就绪
 *   ok:false, reason:'failed'   whenReady reject 或返回 {ok:false}（preload 读 app:ready payload.ok）
 *   ok:false, reason:'timeout' 8 秒兜底仍未收到就绪信号
 * 没有 window.shelf（浏览器直接调试）按 ok:true 处理，保留空库预览不白屏。
 * 永不 reject：调用方只需判断 status.ok。
 */
const READY_TIMEOUT_MS = 8000;
function normalizeReady(v) {
  if (v === true) return { ok: true, reason: 'ready' };
  if (v === false) return { ok: false, reason: 'failed', message: '后端启动失败' };
  if (v && typeof v === 'object') {
    if (v.ok === false) {
      return { ok: false, reason: 'failed', message: v.message || v.reason || '后端启动失败' };
    }
    return { ok: true, reason: 'ready' };
  }
  return { ok: false, reason: 'failed', message: '后端就绪状态无法识别' };
}
export function whenBackendReady() {
  const s = (typeof window !== 'undefined') ? window.shelf : null;
  let wait;
  if (!s || typeof s.whenReady !== 'function') {
    wait = Promise.resolve({ ok: true, reason: 'offline' });
  } else {
    try {
      wait = Promise.resolve(s.whenReady()).then(normalizeReady, (err) => ({
        ok: false, reason: 'failed', message: friendlyMessage(err),
      }));
    } catch (err) {
      wait = Promise.resolve({ ok: false, reason: 'failed', message: friendlyMessage(err) });
    }
  }
  return Promise.race([
    wait,
    new Promise((resolve) => setTimeout(() => resolve({
      ok: false, reason: 'timeout',
      message: '连接本地服务超时，请确认 PrintShelf 桌面应用已正常启动',
    }), READY_TIMEOUT_MS)),
  ]).then((status) => {
    // 诊断字段：走查探针据此确认启动闸门走了哪条路径
    if (typeof window !== 'undefined') {
      window.__printshelfBackendReady = { status, at: Date.now() };
    }
    return status;
  });
}

export function emitRefresh(reason = 'refresh') {
  window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason } }));
}

export function emitToast(type, message, opts) {
  const detail = Object.assign(
    { type: type || 'info', message: message == null ? '' : message },
    opts || {}
  );
  window.dispatchEvent(new CustomEvent('shelf:toast', { detail }));
}

// 启动订阅：主进程事件 → 渲染层 window 事件
// 分阶段启动信号：boot.js 排队展示，让「加载一会 → 后台加载一会 → 进软件」看得见
on('boot:stage', (p) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shelf:bootstage', { detail: p || {} }));
  }
});

on('lib:changed', (p) => emitRefresh((p && p.reason) || 'lib:changed'));

on('scan:progress', (p) => {
  window.dispatchEvent(new CustomEvent('shelf:scanprogress', { detail: p || {} }));
});

on('scan:done', (report) => {
  const r = report || {};
  const parts = [];
  if (r.added) parts.push('新增 ' + r.added);
  if (r.updated) parts.push('更新 ' + r.updated);
  if (r.missing) parts.push('失效 ' + r.missing);
  if (r.failed) parts.push('失败 ' + r.failed);
  emitToast('success', parts.length ? '扫描完成：' + parts.join('、') : '扫描完成，没有变化');
  emitRefresh('scan:done');
  // 随进度事件下发 done 标记，通知 app.js 收起进度条
  window.dispatchEvent(new CustomEvent('shelf:scanprogress', { detail: { done: true, report: r } }));
});

on('app:toast', (p) => {
  const d = p || {};
  emitToast(d.type || 'info', d.message || '', d);
});

// 目录监视：以前主进程在推、preload 也放行，但渲染层没人订阅（tools/check-ipc-contract.js 抓出来的）。
// 具体 add/change/unlink 只转成 window 事件；批次末尾的 'changed' 再兜底刷一次界面，
// 这样即使 store 的 lib:changed 漏掉，新增/删除的 3MF 也会出现在列表里，且一个批次只刷一次。
on('watcher:changed', (p) => {
  const d = p || {};
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('watcher:changed', { detail: d }));
  if (d.type === 'changed') emitRefresh('watcher');
});

// 模型优化：主进程事件 → 渲染层 window 自定义事件（components/meshopt.js 监听）
for (const ch of ['mesh:progress', 'mesh:log', 'mesh:done', 'mesh:error']) {
  on(ch, (p) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ch, { detail: p || {} }));
    }
  });
}

// 打印机状态推送（设备页靠它实时刷新，不再只依赖手动刷新）
for (const ch of ['printers:update', 'printers:changed']) {
  on(ch, (p) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ch, { detail: p || {} }));
    }
  });
}

// 打印完成 / 异常通知：主进程已经弹过系统通知，这里补一条应用内 toast。
// 关掉「系统通知」之后这条路仍然在，用户不会彻底收不到提醒。
on('printers:notify', (p) => {
  const n = p || {};
  if (typeof window === 'undefined') return;
  const type = n.kind === 'error' ? 'error' : (n.kind === 'paused' ? 'warn' : 'success');
  emitToast(type, n.body || n.title || '打印状态变化', { duration: 8000 });
  window.dispatchEvent(new CustomEvent('printers:notify', { detail: n }));
});

// 打印回执 / 耗材库：新回执落盘、耗材变动后，刷新对应界面
for (const ch of ['receipts:changed', 'filaments:changed']) {
  on(ch, (p) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ch, { detail: p || {} }));
    }
  });
}

// 快造 U1 转换：进度 / 日志 / 取消
for (const ch of ['u1:progress', 'u1:log', 'u1:cancelled']) {
  on(ch, (p) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ch, { detail: p || {} }));
    }
  });
}

on('app:error', (p) => {
  const d = p || {};
  emitToast('error', d.message || '发生未知错误');
});
