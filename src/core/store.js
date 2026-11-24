'use strict';
/**
 * 本地持久化层：library.json / settings.json 的读写、原子写、备份、导入导出。
 * 纯 Node 内置模块，禁止 require('electron')。
 * 所有写操作经串行队列，避免并发互相覆盖；原子写采用 tmp + rename（Windows 失败回退 copy+unlink）。
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const paths = require('./paths');
const C = require('./constants');
const U = require('./utils');

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/** 校验库结构：models 必须是对象，categories/tags/savedViews 必须是数组。 */
function isValidLibrary(lib) {
  return !!lib && typeof lib === 'object' && !Array.isArray(lib)
    && !!lib.models && typeof lib.models === 'object' && !Array.isArray(lib.models)
    && Array.isArray(lib.categories)
    && Array.isArray(lib.tags)
    && Array.isArray(lib.savedViews);
}

/**
 * 以 base 为底用 patch 覆盖：数组整体替换（folders/slicers 等）；
 * 对象逐键合并（ui/scan/data 等）；标量直接覆盖。用于补齐 DEFAULT_SETTINGS 缺失字段。
 */
function mergeSettings(base, patch) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out[k] = v;
    } else if (v && typeof v === 'object'
      && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = Object.assign({}, base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function tsStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 损坏文件留底：原 library.json 一个字节都不能丢。 */
function corruptBackupPath(file) {
  const d = new Date();
  // 毫秒固定 3 位：否则 -57 会排在 -570 前后错位，备份名也不再定宽。
  const ms = (n) => String(n).padStart(3, '0');
  const stamp = tsStamp(d) + '-' + ms(d.getMilliseconds());
  return `${file}.corrupt-${stamp}`;
}

/**
 * 逐条基本结构校验。原来的 isValidLibrary 只看四个容器是不是对象/数组，
 * 一个 {models:{bad:null}} 的「合法空库」能借 merge:false 把几万条索引顶掉。
 */
function validateLibraryRecords(lib) {
  const errors = [];
  for (const [id, rec] of Object.entries((lib && lib.models) || {})) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      errors.push('模型 ' + id + ' 不是对象');
    } else if ((rec.id != null && String(rec.id) !== String(id))
      || typeof rec.path !== 'string' || !rec.path.trim()) {
      errors.push('模型 ' + id + ' 缺少合法的 id/path');
    }
    if (errors.length >= 3) break;
  }
  for (const key of ['categories', 'tags', 'savedViews']) {
    for (const item of (lib && lib[key]) || []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.id !== 'string' || !item.id) {
        errors.push(key + ' 中存在缺少 id 的条目');
        break;
      }
    }
  }
  return errors;
}

/** 合并导入记录时只补齐本地为空的字段，保留本地已有的人工字段。 */
function mergeIncoming(local, incoming) {
  for (const k of Object.keys(incoming || {})) {
    const lv = local[k];
    if (lv === undefined || lv === null || lv === '') {
      const iv = incoming[k];
      if (iv !== undefined && iv !== null) local[k] = iv;
    }
  }
}

function mergeEntityArray(localArr, incomingArr) {
  const ids = new Set(localArr.map((x) => x && x.id));
  for (const item of (incomingArr || [])) {
    if (item && item.id && !ids.has(item.id)) {
      localArr.push(item);
      ids.add(item.id);
    }
  }
}

class Store extends EventEmitter {
  constructor({ dataDir } = {}) {
    super();
    // 传 dataDir 时自行解析私有路径，不污染 paths 模块的全局状态；不传则完全走 paths 模块。
    this._dataDir = dataDir ? path.resolve(String(dataDir)) : null;
    this._library = null;
    this._settings = null;
    this._initialized = false;
    this._writeQueue = Promise.resolve();
    this._saveTimer = null;
    this._saveWaiters = [];
    // 损坏恢复的可观察状态：界面/测试可读取，也可以用 store.on('recovery') 订阅。
    this.recovery = null;
  }

  // ---- 路径与基础设施 ----

  _paths() {
    if (this._dataDir) {
      const d = this._dataDir;
      return {
        library: path.join(d, 'library.json'),
        settings: path.join(d, 'settings.json'),
        thumbs: path.join(d, 'thumbs'),
        backups: path.join(d, 'backups'),
        logs: path.join(d, 'logs'),
      };
    }
    return {
      library: paths.getLibraryPath(),
      settings: paths.getSettingsPath(),
      thumbs: paths.getThumbsDir(),
      backups: paths.getBackupDir(),
      logs: paths.getLogDir(),
    };
  }

  _ensureDirs() {
    if (this._dataDir) {
      const p = this._paths();
      for (const d of [this._dataDir, p.thumbs, p.backups, p.logs]) {
        try { fs.mkdirSync(d, { recursive: true }); } catch (_) { /* 只读环境忽略 */ }
      }
    } else {
      paths.ensureDirs();
    }
  }

  _ensureReady() {
    if (!this._initialized) throw new Error('存储尚未初始化，请先调用 init()');
  }

  _emitError(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    // EventEmitter 在没有任何 'error' 监听器时会把 emit 变成 throw，这里吞掉以免中断主流程。
    try { this.emit('error', e); } catch (_) { /* 忽略 */ }
  }

  /** 记录并广播恢复状态；无监听器也不影响启动 */
  _setRecovery(info) {
    this.recovery = info;
    try { this.emit('recovery', info); } catch (_) { /* 忽略 */ }
    this._emitError(new Error(info.message));
  }

  /** 把损坏的原文件原样留底；留底失败就中止，绝不拿空库覆盖它。 */
  _preserveCorrupt(file) {
    const backup = corruptBackupPath(file);
    try { fs.copyFileSync(file, backup); }
    catch (e) { throw new Error('库文件已损坏，但无法另存备份（' + e.message + '）：' + file); }
    return backup;
  }

  /**
   * 返回 {exists:false} | {exists:true, corrupt:true} | {exists:true, unreadable:true, code}
   *                     | {exists:true, value}
   *
   * 关键区分：**读不出来 ≠ 内容坏了**。
   * 杀软扫描、索引器、网络盘断线都会让 readFileSync 抛 EACCES/EBUSY，
   * 以前一律当成 corrupt 去「从备份恢复 / 重置默认库」，等于把用户几万个模型索引覆盖成空库。
   * 这类错误必须上抛，宁可启动失败也不能写坏数据。
   */
  _readJson(file) {
    let txt;
    try {
      txt = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return { exists: false };
      return { exists: true, unreadable: true, code: (e && e.code) || 'EUNKNOWN' };
    }
    // 手工编辑过的 JSON 常带 UTF-8 BOM，JSON.parse 会直接失败 —— 先剥掉
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
    try {
      return { exists: true, value: JSON.parse(txt) };
    } catch (_) {
      return { exists: true, corrupt: true };
    }
  }

  /** 读 JSON，遇到「文件被占用」这类瞬时错误先重试几次（杀软扫描通常几十毫秒就过去） */
  async _readJsonRetry(file, tries = 3) {
    let r = this._readJson(file);
    for (let i = 1; i < tries && r.unreadable; i++) {
      await new Promise((res) => setTimeout(res, 150));
      r = this._readJson(file);
    }
    return r;
  }

  /** 同步原子写：写 <file>.tmp → rename 覆盖目标；Windows 失败回退 copy+unlink。 */
  _atomicWrite(file, obj) {
    const tmp = file + '.tmp';
    const data = JSON.stringify(obj, null, 2);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
    try {
      fs.writeFileSync(tmp, data, 'utf8');
    } catch (e) {
      throw new Error('写入临时文件失败：' + tmp + ' · ' + e.message);
    }
    try {
      fs.renameSync(tmp, file);
    } catch (_) {
      try {
        fs.copyFileSync(tmp, file);
        try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
      } catch (e2) {
        throw new Error('写入文件失败：' + file + ' · ' + e2.message);
      }
    }
  }

  /** 把所有写任务串成一条链；链本身永远 fulfilled，真实结果/错误返回给调用者。 */
  _enqueue(task) {
    const run = this._writeQueue.then(() => task());
    this._writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  _normalizeLibrary(lib) {
    if (!Number.isFinite(lib.schemaVersion)) lib.schemaVersion = 1;
    if (!Number.isFinite(lib.updatedAt)) lib.updatedAt = 0;
    if (!lib.scanMeta || typeof lib.scanMeta !== 'object' || Array.isArray(lib.scanMeta)) lib.scanMeta = {};
    return lib;
  }

  _freshLibrary() {
    const lib = deepClone(C.DEFAULT_LIBRARY);
    lib.updatedAt = U.now();
    lib.categories = C.DEFAULT_CATEGORIES.map((c, i) => ({
      id: U.uid('cat'),
      name: c.name,
      color: c.color,
      icon: c.icon,
      order: i,
      createdAt: U.now(),
    }));
    return lib;
  }

  _recoverFromBackups() {
    const dir = this._paths().backups;
    for (const b of this.listBackups()) {
      const r = this._readJson(path.join(dir, b.name));
      if (r.exists && !r.corrupt && isValidLibrary(r.value)) {
        return this._normalizeLibrary(r.value);
      }
    }
    return null;
  }

  // ---- 初始化 ----

  async init() {
    this._ensureDirs();
    const p = this._paths();

    // settings：合并 DEFAULT_SETTINGS 补齐缺失字段
    const sread = await this._readJsonRetry(p.settings);
    if (sread.unreadable) {
      throw new Error('设置文件无法读取（可能被杀毒软件或其它程序占用，错误码 ' + sread.code
        + '）：' + p.settings + '。为免覆盖你的配置，本次不做任何写入，请稍后重试。');
    }
    const rawSettings = (sread.exists && !sread.corrupt && sread.value
      && typeof sread.value === 'object' && !Array.isArray(sread.value)) ? sread.value : {};
    this._settings = mergeSettings(deepClone(C.DEFAULT_SETTINGS), rawSettings);
    if (!sread.exists || sread.corrupt
      || JSON.stringify(rawSettings) !== JSON.stringify(this._settings)) {
      this._atomicWrite(p.settings, this._settings);
    }

    // library：缺失用默认；损坏先尝试从最新备份恢复，仍失败用默认并 emit 'error'
    const lread = await this._readJsonRetry(p.library);
    if (lread.unreadable) {
      throw new Error('模型库文件无法读取（可能被杀毒软件或其它程序占用，错误码 ' + lread.code
        + '）：' + p.library + '。为免覆盖你的数据，本次不做任何写入，请稍后重试。');
    }
    if (!lread.exists) {
      this._library = this._freshLibrary();
      this._atomicWrite(p.library, this._library);
    } else if (lread.corrupt || !isValidLibrary(lread.value)) {
      // 无论有没有可用备份，先把损坏的原文件留底，绝不静默覆盖（P0-5）。
      const backup = this._preserveCorrupt(p.library);
      const recovered = this._recoverFromBackups();
      if (recovered) {
        this._library = recovered;
        this._atomicWrite(p.library, this._library);
        this._setRecovery({
          kind: 'corrupt', source: 'backup', file: p.library, backup, at: U.now(),
          message: '库文件已损坏，已从最近的备份恢复；原文件已另存为 ' + backup,
        });
      } else {
        this._library = this._freshLibrary();
        this._atomicWrite(p.library, this._library);
        this._setRecovery({
          kind: 'corrupt', source: 'fresh', file: p.library, backup, at: U.now(),
          message: '库文件已损坏且没有可用的备份，已重置为默认库；原文件已另存为 ' + backup,
        });
      }
    } else {
      this._library = this._normalizeLibrary(lread.value);
    }

    this._initialized = true;
  }

  // ---- 读取 ----

  getLibrary() { return this._library; }
  getSettings() { return this._settings; }

  // ---- 写入 ----

  async updateLibrary(mutator, reason = 'update') {
    this._ensureReady();
    return this._enqueue(async () => {
      // 自动备份在队列任务内以同步方式执行，不进入写队列，避免与自身死锁。
      if (this._shouldAutoBackup()) {
        try { this._doBackup('auto'); } catch (e) { this._emitError(e); }
      }
      if (typeof mutator === 'function') {
        await mutator(this._library);
      }
      this._library.updatedAt = U.now();
      this._atomicWrite(this._paths().library, this._library);
      this.emit('change', { reason });
      return this._library;
    });
  }

  async updateSettings(patch) {
    this._ensureReady();
    return this._enqueue(() => {
      this._settings = mergeSettings(this._settings, patch || {});
      this._settings.updatedAt = U.now();
      this._atomicWrite(this._paths().settings, this._settings);
      const snapshot = this._settings;
      this.emit('settings', snapshot);
      return snapshot;
    });
  }

  /** 显式落盘：200ms 防抖合并，但每个返回的 Promise 都在真正落盘后才 resolve。 */
  saveLibrary() {
    return new Promise((resolve, reject) => {
      this._saveWaiters.push({ resolve, reject });
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        const waiters = this._saveWaiters;
        this._saveWaiters = [];
        this._enqueue(() => {
          this._atomicWrite(this._paths().library, this._library);
        }).then(
          () => { for (const w of waiters) w.resolve(); },
          (e) => { for (const w of waiters) w.reject(e); }
        );
      }, 200);
    });
  }

  // ---- 备份 ----

  _shouldAutoBackup() {
    const last = (this._settings && this._settings.data && this._settings.data.lastBackupAt) || 0;
    return (U.now() - last) > 10 * 60 * 1000;
  }

  /** 同步执行备份（不进入写队列）；公开 backup() 负责把它放进队列。 */
  _doBackup(reason) {
    if (!this._settings) this._settings = deepClone(C.DEFAULT_SETTINGS);
    const p = this._paths();
    try { fs.mkdirSync(p.backups, { recursive: true }); } catch (_) { /* 忽略 */ }
    if (!fs.existsSync(p.library)) this._atomicWrite(p.library, this._library || this._freshLibrary());

    const safeReason = U.safeFileName(String(reason || 'manual')).replace(/\s+/g, '-') || 'manual';
    const stamp = tsStamp(new Date());
    let name = `library-${stamp}-${safeReason}.json`;
    let target = path.join(p.backups, name);
    if (fs.existsSync(target)) {
      let i = 2;
      do {
        name = `library-${stamp}-${safeReason}-${i}.json`;
        target = path.join(p.backups, name);
        i++;
      } while (fs.existsSync(target));
    }
    fs.copyFileSync(p.library, target);

    if (!this._settings.data || typeof this._settings.data !== 'object') this._settings.data = {};
    this._settings.data.lastBackupAt = U.now();
    this._settings.updatedAt = U.now();
    try { this._atomicWrite(p.settings, this._settings); } catch (_) { /* 备份时间落盘失败不影响备份本身 */ }

    const keep = U.clamp(Number(this._settings.data.backupKeep) || 10, 1, 1000);
    this._rotateBackups(keep);
    return name;
  }

  _rotateBackups(keep) {
    const dir = this._paths().backups;
    const list = this.listBackups();
    for (let i = keep; i < list.length; i++) {
      try { fs.unlinkSync(path.join(dir, list[i].name)); } catch (_) { /* 忽略 */ }
    }
  }

  async backup(reason = 'manual') {
    this._ensureReady();
    return this._enqueue(() => this._doBackup(reason));
  }

  listBackups() {
    const dir = this._paths().backups;
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    const out = [];
    for (const name of names) {
      if (!/^library-.*\.json$/i.test(name) || /\.tmp$/i.test(name)) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        if (!st.isFile()) continue;
        out.push({ name, size: st.size, mtime: st.mtimeMs });
      } catch (_) { /* 忽略 */ }
    }
    out.sort((a, b) => (b.mtime - a.mtime) || b.name.localeCompare(a.name));
    return out;
  }

  async restoreBackup(name) {
    this._ensureReady();
    return this._enqueue(() => {
      const dir = this._paths().backups;
      const file = path.join(dir, path.basename(String(name))); // 防目录穿越
      const r = this._readJson(file);
      if (!r.exists || r.corrupt || !isValidLibrary(r.value)) {
        throw new Error('备份文件无效或不存在：' + name);
      }
      // 恢复前先备份当前（内容已读入内存，轮转删掉该备份文件也不影响本次恢复）
      try { this._doBackup('before-restore'); } catch (_) { /* 忽略 */ }
      this._library = this._normalizeLibrary(r.value);
      this._atomicWrite(this._paths().library, this._library);
      this.emit('change', { reason: 'restore' });
    });
  }

  // ---- 导入导出 ----

  async exportTo(targetPath) {
    this._ensureReady();
    return this._enqueue(() => {
      const dest = path.resolve(String(targetPath));
      try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (_) { /* 忽略 */ }
      this._atomicWrite(dest, this._library);
      return dest;
    });
  }

  async importFrom(sourcePath, { merge = true } = {}) {
    this._ensureReady();
    return this._enqueue(() => {
      const src = path.resolve(String(sourcePath));
      const r = this._readJson(src);
      if (!r.exists || r.corrupt || !isValidLibrary(r.value)) {
        throw new Error('导入文件无效或不存在：' + src);
      }
      // 顶层容器合法不代表每条记录合法：merge:false 会整库替换，必须先逐条体检。
      const errors = validateLibraryRecords(r.value);
      if (errors.length) {
        throw new Error('导入文件包含无效记录，已拒绝导入：' + errors.join('；'));
      }
      const incoming = this._normalizeLibrary(r.value);
      let imported = 0;
      if (!merge) {
        this._library = incoming;
        imported = Object.keys(incoming.models).length;
      } else {
        for (const [id, rec] of Object.entries(incoming.models)) {
          if (!this._library.models[id]) {
            this._library.models[id] = rec;
            imported++;
          } else {
            mergeIncoming(this._library.models[id], rec);
          }
        }
        mergeEntityArray(this._library.categories, incoming.categories);
        mergeEntityArray(this._library.tags, incoming.tags);
        mergeEntityArray(this._library.savedViews, incoming.savedViews);
      }
      this._library.updatedAt = U.now();
      this._atomicWrite(this._paths().library, this._library);
      this.emit('change', { reason: 'import' });
      return { imported };
    });
  }
}

module.exports = Store;
module.exports.Store = Store;
