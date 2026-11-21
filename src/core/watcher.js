'use strict';
/**
 * A-4 · 目录监视（chokidar）
 * 纯 Node，禁止 electron。监听 settings.folders 中 enabled 且存在的目录下
 * 所有层级的 .3mf 文件（大小写不敏感）；800ms 防抖合并事件。
 *  - add/change -> scanner.scanFolder(folder) 增量扫描
 *  - unlink     -> store.updateLibrary 标记 status='missing'
 *  - 任意变更   -> onChanged(type, path) 回调，并在批次结束发一次 'changed' 总通知
 * 忽略 data/ 与 IGNORE_DIRS 及 settings.scan.excludeDirs。
 */
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const utils = require('./utils');
const { IGNORE_DIRS } = require('./constants');

function isUnder(p, root) {
  const a = utils.pathKey(p);
  const b = utils.pathKey(root);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/** 归一化 excludeDir 项：同时支持「目录名」与「绝对路径」两种写法 */
function normExclude(s) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return null;
  const isPathLike = /[\\/]/.test(raw) || /^[a-zA-Z]:/.test(raw);
  return {
    name: raw.replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase(),
    path: isPathLike ? utils.normalizePath(raw).toLowerCase() : null,
  };
}

class FolderWatcher {
  constructor({ store, scanner, onChanged } = {}) {
    if (!store) throw new Error('FolderWatcher 初始化失败：缺少 store 依赖');
    if (!scanner) throw new Error('FolderWatcher 初始化失败：缺少 scanner 依赖');
    this.store = store;
    this.scanner = scanner;
    this.onChanged = typeof onChanged === 'function' ? onChanged : null;
    this._watcher = null;
    this._folders = [];
    this._running = false;
    this._timer = null;
    this._pending = new Map(); // path -> 'add'|'change'|'unlink'
  }

  /** 依据当前 settings 建立监听 */
  start() { this._rebuild(); }

  /** 目录配置变化后重建监听 */
  refresh() { this._rebuild(); }

  isRunning() { return !!(this._running && this._watcher); }

  /** 停止并 await chokidar.close() */
  async stop() {
    clearTimeout(this._timer);
    this._timer = null;
    this._pending.clear();
    this._running = false;
    this._folders = [];
    const w = this._watcher;
    this._watcher = null;
    if (w) {
      try { await w.close(); } catch (_) { /* 关闭异常忽略 */ }
    }
  }

  _exists(dirPath) {
    if (!dirPath) return false;
    try { return fs.statSync(dirPath).isDirectory(); } catch (_) { return false; }
  }

  _closeWatcher() {
    const w = this._watcher;
    this._watcher = null;
    if (w) {
      const p = w.close();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  /** chokidar ignored：只放行监控根之下、不含忽略目录段的路径 */
  _makeIgnored(roots, excludeDirs) {
    const ignoreSet = new Set(IGNORE_DIRS.map((s) => String(s).toLowerCase()));
    const ex = (excludeDirs || []).map(normExclude).filter(Boolean);
    const rootsN = roots.map((r) => utils.normalizePath(r).toLowerCase());
    return (p) => {
      const norm = utils.normalizePath(p).toLowerCase();
      let rel = norm;
      for (const rn of rootsN) {
        if (norm === rn) return false;                      // 监控根本身放行
        if (norm.startsWith(rn + path.sep)) { rel = norm.slice(rn.length + 1); break; }
      }
      for (const seg of rel.split(path.sep)) {
        if (ignoreSet.has(seg)) return true;               // IGNORE_DIRS（含 data/）
        for (const e of ex) {
          if (e.name === seg) return true;
          if (e.path && (e.path === norm || norm.startsWith(e.path + path.sep))) return true;
        }
      }
      return false;
    };
  }

  _rebuild() {
    this._closeWatcher();
    clearTimeout(this._timer);
    this._timer = null;
    this._pending.clear();

    const settings = (typeof this.store.getSettings === 'function' && this.store.getSettings()) || {};
    const folders = (settings.folders || [])
      .filter((f) => f && f.enabled !== false && this._exists(f.path));
    this._folders = folders.slice();
    if (!folders.length) { this._running = false; return; }

    const roots = folders.map((f) => utils.normalizePath(f.path));
    const scan = settings.scan || {};
    const watcher = chokidar.watch(roots, {
      ignoreInitial: true,        // 已存在文件不触发 add
      followSymlinks: false,
      persistent: true,
      depth: Number(scan.maxDepth) || 12,
      ignored: this._makeIgnored(roots, scan.excludeDirs || []),
    });
    watcher.on('add', (p) => this._queue('add', p));
    watcher.on('change', (p) => this._queue('change', p));
    watcher.on('unlink', (p) => this._queue('unlink', p));
    watcher.on('error', () => { /* 监听错误不外抛，避免进程崩溃 */ });
    this._watcher = watcher;
    this._running = true;
  }

  /** 事件入队 + 800ms 防抖；只关心 .3mf（大小写不敏感） */
  _queue(type, filePath) {
    if (!/\.3mf$/i.test(filePath || '')) return;
    const key = utils.normalizePath(filePath);
    this._pending.set(key, type);   // 同路径以最后一次事件为准
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._flush().catch(() => {}); }, 800);
  }

  _folderFor(p) {
    let best = null;
    const norm = utils.normalizePath(p);
    for (const f of this._folders) {
      const root = utils.normalizePath(f.path);
      if (isUnder(norm, root) && (!best || root.length > best.root.length)) best = { folder: f, root };
    }
    return best ? best.folder : null;
  }

  _fire(type, p) {
    if (!this.onChanged) return;
    try { this.onChanged(type, p); } catch (_) { /* 回调异常不影响监听 */ }
  }

  async _flush() {
    clearTimeout(this._timer);
    this._timer = null;
    const batch = this._pending;
    this._pending = new Map();
    if (!batch.size) return;

    const rescan = new Map();      // folderId -> folder（防抖后每目录仅一次扫描）
    const unlinkKeys = new Set();
    for (const [p, type] of batch) {
      this._fire(type, p);         // 具体变更类型回调
      if (type === 'unlink') {
        unlinkKeys.add(utils.pathKey(p));
      } else {
        const folder = this._folderFor(p);
        if (folder) rescan.set(String(folder.id), folder);
      }
    }

    // add/change -> 增量扫描。若此刻正在手动扫描，把这批推迟一轮再处理，
    // 不要硬闯（scanner 有单飞锁，硬闯只会抛错并丢掉这批变更）。
    if (this.scanner.getStatus && this.scanner.getStatus().running) {
      for (const [p2, t2] of batch) if (!this._pending.has(p2)) this._pending.set(p2, t2);
      clearTimeout(this._timer);
      this._timer = setTimeout(() => { this._flush().catch(() => {}); }, 1200);
      return;
    }
    for (const folder of rescan.values()) {
      try { await this.scanner.scanFolder(folder); } catch (_) { /* 单目录失败不中断 */ }
    }

    // unlink -> 通过 store.updateLibrary 标记 missing（保留全部字段，不删除）
    if (unlinkKeys.size) {
      const now = utils.now();
      try {
        await this.store.updateLibrary((lib) => {
          const models = lib.models || (lib.models = {});
          for (const r of Object.values(models)) {
            if (r && r.path && r.status !== 'missing' && unlinkKeys.has(utils.pathKey(r.path))) {
              r.status = 'missing';
              r.missingSince = now;
              r.updatedAt = now;
            }
          }
        });
      } catch (_) { /* 写库失败不中断 */ }
    }

    // 库变更总通知（契约：发 'changed'）
    this._fire('changed', null);
  }
}

// 双兼容导出：既支持 const FolderWatcher = require('./watcher')，也支持 const { FolderWatcher } = require('./watcher')
module.exports = FolderWatcher;
module.exports.FolderWatcher = FolderWatcher;
