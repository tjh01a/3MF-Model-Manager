'use strict';
/**
 * A-2 · 目录扫描器（增量索引）
 * 纯 Node，禁止 electron。所有库写入统一走 store.updateLibrary()，本模块不直接落盘。
 */
const { EventEmitter } = require('events');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const utils = require('./utils');
const corePaths = require('./paths');
const { IGNORE_DIRS, MAX_FILE_SIZE } = require('./constants');
const { parse3mf } = require('./model3mf');
const duplicates = require('./duplicates');
const classify = require('./classify');
const quarantine = require('./quarantine');
const { brokenKindOf } = quarantine;

const DEFAULT_OPTIONS = {
  concurrency: 4,
  excludeDirs: [],
  maxDepth: 12,
  hashEnabled: true,
  parseMeta: true,
};

/**
 * 扫描只负责「磁盘事实 + 自动派生字段」。人工字段必须来自写回瞬间的当前库记录，
 * 否则长扫描开始时拍下的旧快照会整条覆盖用户在扫描期间的编辑（P0-2）。
 */
const HUMAN_FIELDS = [
  'title', 'categoryId', 'tagIds', 'favorite', 'rating', 'note',
  'sourceUrl', 'sourceUrlAuto', 'sourceUrls', 'author', 'printStatus',
  'openCount', 'lastOpenedAt', 'printCount', 'lastPrintedAt',
  'filamentLinks', 'costWeightG', 'costNote', 'autoClassified', 'autoCategoryId',
];

/**
 * 用当前记录为底，只覆盖本次扫描真正重新算过的技术字段。
 * current 为 null 时（扫描期间新增的文件）直接用新记录。
 */
function mergeScannedRecord(current, scanned) {
  if (!current) return { ...scanned };
  const merged = { ...current };
  for (const [k, v] of Object.entries(scanned)) {
    if (HUMAN_FIELDS.includes(k)) continue;
    merged[k] = v;
  }
  // createdAt 属于记录身份，任何情况下都不被扫描改写
  if (current.createdAt != null) merged.createdAt = current.createdAt;
  // 解析失败时新记录的 meta 是空壳，绝不能顶掉原有的重量/色板等派生数据（P1-7）
  if (scanned.__parseOk === false) {
    for (const k of ['meta', 'thumbSource', 'thumbnail', 'parseError']) {
      if (Object.prototype.hasOwnProperty.call(current, k)) merged[k] = current[k];
      else delete merged[k];
    }
  }
  delete merged.__parseOk;
  return merged;
}

/** 判断 p 是否位于 root 之下（含相等），Windows 大小写不敏感 */
function isUnder(p, root) {
  const a = utils.pathKey(p);
  const b = utils.pathKey(root);
  if (!a || !b) return false;
  if (a === b) return true;
  const prefix = b.endsWith(path.sep) ? b : b + path.sep;
  return a.startsWith(prefix);
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

class Scanner extends EventEmitter {
  constructor({ store, thumbs, shapeIndex = null, options = {} } = {}) {
    super();
    if (!store) throw new Error('Scanner 初始化失败：缺少 store 依赖');
    if (!thumbs) throw new Error('Scanner 初始化失败：缺少 thumbs 依赖');
    this.store = store;
    this.thumbs = thumbs;
    // A：几何指纹索引；有就在每轮扫描后顺手重算「同款变体」分组
    this.shapeIndex = shapeIndex;
    // 只保存显式注入项，运行时再与 settings.scan / 默认值合并
    this.options = { ...(options || {}) };
    this._status = { running: false, phase: 'idle', current: 0, total: 0, message: '', startedAt: null };
    this._cancelRequested = false;
    this._lastProgressAt = 0;
  }

  /**
   * 本工具自己写的目录（缩略图 / 备份 / 日志 / 快造转换缓存）。
   * 这些目录里不会有用户的模型，扫进来只会污染库。
   */
  _selfDirs() {
    // 优先用 store 自己的 dataDir（Store 可以私有目录运行，不污染全局 paths）。
    // 只看全局 paths 会把私有数据目录漏掉，把自己的缓存当模型扫进库（P1-17）。
    let dataDir = null;
    const s = this.store;
    if (s && typeof s._paths === 'function') {
      try {
        const p = s._paths();
        if (p && p.thumbs) dataDir = path.dirname(p.thumbs);
      } catch (_) { /* 回退到全局 */ }
    }
    if (!dataDir && s && typeof s.dataDir === 'string') dataDir = s.dataDir;
    if (!dataDir && typeof s?.getDataDir === 'function') {
      try { dataDir = s.getDataDir(); } catch (_) { /* 忽略 */ }
    }
    if (!dataDir) dataDir = corePaths.getDataDir();
    if (!dataDir) return [];
    return ['thumbs', 'backups', 'logs', 'u1-cache', 'quarantine']
      .map((n) => path.join(dataDir, n));
  }

  /** 合并优先级：DEFAULT < settings.scan < 构造注入 options（便于测试覆盖） */
  _effectiveOptions() {
    const settings = (typeof this.store.getSettings === 'function' && this.store.getSettings()) || {};
    const scan = settings.scan || {};
    return { ...DEFAULT_OPTIONS, ...scan, ...this.options };
  }

  getStatus() {
    return { ...this._status };
  }

  cancel() {
    if (this._status.running) {
      this._cancelRequested = true;
      this._status.message = '正在取消扫描…';
    }
  }

  /** 进度事件内部节流 ≤ 20 次/秒；开始/结束用 force 强制推送 */
  _emitProgress(phase, current, total, message, force = false) {
    const t = Date.now();
    this._status.phase = phase;
    this._status.current = current;
    this._status.total = total;
    this._status.message = message || '';
    if (!force && t - this._lastProgressAt < 50) return;
    this._lastProgressAt = t;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    this.emit('progress', { phase, current, total, message: this._status.message, percent });
  }

  /** 扫描 settings.folders 中 enabled 的目录（可按 folderIds 过滤） */
  async scanAll({ folderIds, force = false } = {}) {
    const settings = (typeof this.store.getSettings === 'function' && this.store.getSettings()) || {};
    let folders = (settings.folders || []).filter((f) => f && f.enabled !== false);
    if (Array.isArray(folderIds) && folderIds.length) {
      const ids = new Set(folderIds.map(String));
      folders = folders.filter((f) => ids.has(String(f.id)));
    }
    return this._run(folders, !!force);
  }

  /** 扫描单个 Folder 对象 */
  async scanFolder(folder) {
    if (!folder || !folder.path) throw new Error('扫描目录无效：缺少 path');
    return this._run([folder], false);
  }

  /** 便于测试：直接扫一个路径 */
  async scanPath(dirPath) {
    if (!dirPath) throw new Error('扫描路径为空');
    const folder = {
      id: null,
      path: utils.normalizePath(dirPath),
      enabled: true,
      recursive: true,
      addedAt: 0,
      lastScanAt: null,
    };
    return this._run([folder], false);
  }

  /** 扫描主流程 */
  async _run(folders, force) {
    // 单飞锁：同一时刻只允许一个扫描。手动扫描与 watcher 触发很容易撞车，
    // 两个流程同时跑会互相覆盖 _status/_cancelRequested，还会重复计数。
    if (this._status && this._status.running) {
      throw new Error('正在扫描中，请等本次扫描结束再试');
    }
    const startedAt = Date.now();
    // 预设词库自动分类：整轮扫描共用一份规则，避免每个文件都重建一次
    const autoCfg = classify.configOf(this.store.getSettings());
    const autoCategories = (this.store.getLibrary() || {}).categories || [];
    const autoRules = (autoCfg.enabled && autoCfg.onScan)
      ? classify.resolveRules(autoCfg.rules, autoCategories, (this.store.getSettings().ui || {}).language)
      : [];
    // 规则可能指向一个刚被删掉的分类。批量分类（classify.js）会校验 liveIds，
    // 扫描时的即时分类以前没有，会把不存在的 categoryId 写进新记录。
    const autoLiveIds = new Set(autoCategories.map((c) => c.id));
    const report = {
      added: 0, updated: 0, unchanged: 0, missing: 0, removed: 0, failed: 0,
      duration: 0, files: [], duplicateGroups: 0, autoClassified: 0,
    };

    this._cancelRequested = false;
    this._lastProgressAt = 0;
    this._status = {
      running: true, phase: 'collect', current: 0, total: 0,
      message: '正在枚举文件…', startedAt,
    };
    const opts = this._effectiveOptions();
    let progressCurrent = 0;
    let total = 0;
    const bump = (phase, message) => {
      progressCurrent++;
      this._emitProgress(phase, progressCurrent, total, message);
    };

    try {
      // ---- 现有库快照（只读，用于增量判断） ----
      const lib = (typeof this.store.getLibrary === 'function' && this.store.getLibrary()) || { models: {} };
      const existingByPath = new Map();
      for (const r of Object.values(lib.models || {})) {
        if (r && r.path) existingByPath.set(utils.pathKey(r.path), r);
      }

      // ---- 1. 递归枚举 .3mf ----
      const ignoreSet = new Set(IGNORE_DIRS.map((s) => String(s).toLowerCase()));
      // 自己的产物目录必须排掉：用户很可能把整个项目目录设成监控文件夹（数据目录就在里面），
      // 不排除的话缩略图/备份/转换缓存会被当成模型入库，每转换一次就多一条重复条目。
      const excludeList = (opts.excludeDirs || []).concat(this._selfDirs())
        .map(normExclude).filter(Boolean);
      const shouldIgnoreDir = (name, fullPath) => {
        const nl = String(name).toLowerCase();
        if (ignoreSet.has(nl)) return true;
        const fl = utils.normalizePath(fullPath).toLowerCase();
        for (const ex of excludeList) {
          if (ex.name === nl) return true;
          if (ex.path && (ex.path === fl || fl.startsWith(ex.path + path.sep))) return true;
        }
        return false;
      };

      const diskFiles = [];       // { path, name }
      const scannedDirs = [];     // { root }
      const walk = async (dir, depth, limit) => {
        if (this._cancelRequested) return;
        let dirents;
        try {
          dirents = await fsp.readdir(dir, { withFileTypes: true });
        } catch (e) {
          report.failed++;
          report.files.push({
            path: dir, action: 'failed',
            error: '读取目录失败：' + dir + '（' + (e && e.message ? e.message : String(e)) + '）',
          });
          return;
        }
        for (const de of dirents) {
          if (this._cancelRequested) return;
          const full = path.join(dir, de.name);
          if (de.isSymbolicLink()) continue;               // 不跟随符号链接
          if (de.isDirectory()) {
            if (shouldIgnoreDir(de.name, full)) continue;
            if (depth < limit) await walk(full, depth + 1, limit);
            continue;
          }
          if (!de.isFile()) continue;
          if (!/\.3mf$/i.test(de.name)) continue;         // 只收 .3mf，大小写不敏感
          diskFiles.push({ path: full, name: de.name });
        }
      };

      for (const folder of folders) {
        if (this._cancelRequested) break;
        const root = utils.normalizePath(folder.path);
        scannedDirs.push({ root });
        const limit = folder.recursive === false ? 0 : (Number(opts.maxDepth) || DEFAULT_OPTIONS.maxDepth);
        await walk(root, 0, limit);
      }

      total = diskFiles.length;
      this._emitProgress('collect', 0, total, '正在枚举文件…', true);

      // ---- 2. stat + 大小过滤 + 增量判断（收集 toProcess） ----
      const diskPathKeys = new Set();  // 本次磁盘上确实存在的 .3mf
      const diskRecords = [];
      const folderCounts = new Map();  // folderId -> fileCount
      const toProcess = [];

      // 归属 folder：取最长匹配前缀
      const folderFor = (filePath) => {
        let best = null;
        for (const f of folders) {
          const root = utils.normalizePath(f.path);
          if (isUnder(filePath, root) && (!best || root.length > best.root.length)) {
            best = { folder: f, root };
          }
        }
        return best;
      };

      for (let i = 0; i < diskFiles.length; i++) {
        if (this._cancelRequested) break;
        const item = diskFiles[i];
        const pk = utils.pathKey(item.path);
        diskPathKeys.add(pk);

        let st;
        try {
          st = await fsp.stat(item.path);
        } catch (e) {
          report.failed++;
          report.files.push({
            path: item.path, action: 'failed',
            error: '读取文件信息失败：' + item.path + '（' + (e && e.message ? e.message : String(e)) + '）',
          });
          bump('scan', '读取文件信息失败');
          continue;
        }

        if (st.size === 0) {
          report.failed++;
          report.files.push({ path: item.path, action: 'skipped', error: '跳过空文件（0 字节）：' + item.path });
          bump('scan', '跳过空文件');
          continue;
        }
        if (st.size > MAX_FILE_SIZE) {
          report.failed++;
          report.files.push({
            path: item.path, action: 'skipped',
            error: '文件超过 500MB，跳过解析：' + item.path + '（' + utils.formatBytes(st.size) + '）',
          });
          bump('scan', '跳过大文件');
          continue;
        }

        const owner = folderFor(item.path);
        const folderId = owner && owner.folder.id != null ? owner.folder.id : null;
        const rec = {
          path: item.path,
          name: item.name,
          size: st.size,
          mtime: Math.round(st.mtimeMs),
          folderId,
          relativePath: owner ? path.relative(owner.root, item.path) : null,
        };
        diskRecords.push(rec);
        if (folderId != null) folderCounts.set(folderId, (folderCounts.get(folderId) || 0) + 1);

        const prev = existingByPath.get(pk);
        // 解析失败过的文件即使大小/时间没变也重试：用户可能已经手动替换过内容
        const unchanged = !force && prev && prev.status === 'ok'
          && prev.size === rec.size && prev.mtime === rec.mtime && !prev.parseError;
        if (unchanged) {
          report.unchanged++;
          report.files.push({ path: item.path, action: 'unchanged' });
          bump('scan', '未变化：' + item.name);
        } else {
          toProcess.push({ ...rec, prev: prev || null });
        }
      }

      // ---- 3. 并发限流解析新增/变更文件 ----
      const worker = async (item) => {
        if (this._cancelRequested) return { cancelled: true, item };
        try {
          const parseResult = await parse3mf(item.path, {
            withThumbnail: true,
            withMeta: opts.parseMeta !== false,
          });

          let hash = null;
          if (opts.hashEnabled) {
            try { hash = await utils.hashFile(item.path); } catch (_) { hash = null; }
          }

          const prev = item.prev;
          const now = utils.now();
          const fileName = path.basename(item.path);
          const pk = utils.pathKey(item.path);
          const id = utils.sha1(pk).slice(0, 20);

          const brokenKind = brokenKindOf(parseResult, item.path);

          // 基于旧记录展开，保留全部人工字段；写回时还会跟当前库再合并一次。
          const record = {
            ...(prev || {}),
            __parseOk: parseResult.ok === true,   // 非持久化标记：失败结果不能写终态
            id,
            path: item.path,
            fileName,
            ext: '3mf',
            folderId: item.folderId,
            relativePath: item.relativePath,
            size: item.size,
            mtime: item.mtime,
            hash,
            createdAt: prev && prev.createdAt ? prev.createdAt : now,
            updatedAt: now,
            status: 'ok',                    // 磁盘文件恢复时置回 ok
            missingSince: null,
            parseError: parseResult.ok
              ? (brokenKind ? (quarantine.BROKEN_MESSAGES[brokenKind] || '文件结构异常') : null)
              : (parseResult.error || '解析 3MF 失败'),
            parseErrorKind: brokenKind,
            meta: parseResult.meta,
            thumbSource: parseResult.thumbnail ? parseResult.thumbnail.entry : null,
          };
          // C：文件进了回收站的别名存根，如今文件又出现在原路径 → 当作恢复，解除别名。
          // 必须显式写成 null：写回时会以「当前库里的记录」为底叠加，只 delete 的话旧值会被留下来。
          if (prev && prev.aliasState === 'trashed') {
            record.aliasOf = null;
            record.aliasState = null;
            record.aliasAt = null;
          }
          // 只有解析成功才代表「确实没有重量」；解析失败写终态会让回填永久跳过（P1-7）。
          if (parseResult.ok === true && record.meta && record.meta.weightG == null) {
            record.meta.weightChecked = true;
          }
          const defaultTitle = utils.baseName(fileName);
          if (!prev || record.title == null || record.title === '') record.title = defaultTitle;
          // 新增记录的默认字段兜底
          if (record.lastOpenedAt === undefined) record.lastOpenedAt = null;
          if (record.openCount === undefined) record.openCount = 0;
          if (record.lastPrintedAt === undefined) record.lastPrintedAt = null;
          if (record.printCount === undefined) record.printCount = 0;
          if (!record.printStatus) record.printStatus = 'unprinted';
          if (record.categoryId === undefined) record.categoryId = null;
          // 预设词库自动分类：只填空值，人工分过的、已有分类的一律不动
          if (!record.categoryId && autoRules.length) {
            try {
              const hit = classify.applyToRecord(record, autoRules);
              if (hit && autoLiveIds.has(hit)) report.autoClassified++;
              else if (hit) {
                // 命中了已删除的分类：回滚成未分类，别把孤儿 id 写进库
                record.categoryId = null;
                record.autoClassified = false;
                delete record.autoCategoryId;
              }
            } catch (_) { /* 分类失败不影响入库 */ }
          }
          if (!Array.isArray(record.tagIds)) record.tagIds = [];
          if (record.favorite === undefined) record.favorite = false;
          if (record.rating === undefined) record.rating = 0;
          if (record.note === undefined) record.note = '';
          if (record.sourceUrl === undefined) record.sourceUrl = '';
          // 来源网页：从 3MF 项目信息里读，只在空值时填，绝不覆盖用户手填的
          if (!record.sourceUrl && record.meta && record.meta.sourceUrl) {
            record.sourceUrl = record.meta.sourceUrl;
            // 与 backfillSourceUrls 保持同一契约：自动写入的值带标记，
            // 以后收紧「作品页」判定规则时才能安全地清理它，不会误删用户手填的链接。
            record.sourceUrlAuto = true;
          }
          if (record.author === undefined) record.author = '';
          if (!Object.prototype.hasOwnProperty.call(record, 'thumbnail')) record.thumbnail = null;
          // 重复标记统一交给 duplicates.annotate 重算
          record.duplicateGroup = null;
          record.duplicateOf = null;
          record.similarGroup = null;

          // 缩略图：复用 parseResult 避免二次解压
          let thumbFile = null;
          try {
            thumbFile = await this.thumbs.ensureFor(record, { force, parseResult });
          } catch (_) { thumbFile = null; }
          // 失败时保留上一轮已生成的缩略图，别因为一次磁盘抖动把封面清空
          record.thumbnail = thumbFile || (prev && prev.thumbnail) || null;

          return { ok: true, action: prev ? 'updated' : 'added', record, item };
        } catch (e) {
          return {
            ok: false, action: 'failed', item,
            error: '解析文件失败：' + item.path + '（' + (e && e.message ? e.message : String(e)) + '）',
          };
        }
      };

      const results = await utils.mapLimit(
        toProcess,
        Math.max(1, Number(opts.concurrency) || DEFAULT_OPTIONS.concurrency),
        async (item) => {
          const r = await worker(item);
          bump('parse', '正在解析：' + (item.name || ''));
          return r;
        }
      );

      const records = [];
      for (const res of results) {
        if (!res.ok) {
          report.failed++;
          report.files.push({
            path: '(解析任务)', action: 'failed',
            error: '解析任务异常：' + (res.error && res.error.message ? res.error.message : String(res.error)),
          });
          continue;
        }
        const r = res.value;
        if (!r || r.cancelled) continue;
        if (!r.ok) {
          report.failed++;
          report.files.push({ path: r.item.path, action: 'failed', error: r.error || '解析失败' });
          continue;
        }
        records.push(r.record);
        report.files.push({ path: r.item.path, action: r.action });
      }

      // ---- 4/5. 写回：所有判断都在 mutator 内基于「当前库」重做 ----
      // 长扫描期间用户可能改标题、重新定位（relink）甚至删记录；开始前拍下的
      // lib 快照只用于增量筛选，绝不能拿它整条覆盖写回（P0-2）。
      const nowMs = utils.now();
      let added = 0, updated = 0;
      // 缩略图已落盘但引用要等这次写库才生效，期间同样避开 prune（P1-6）。
      const inFlightThumbs = (this.thumbs && this.thumbs._inflight instanceof Set)
        ? records.map((r) => r.thumbnail).filter(Boolean) : [];
      for (const n of inFlightThumbs) this.thumbs._inflight.add(n);
      await this.store.updateLibrary(async (target) => {
        const models = target.models || (target.models = {});
        for (const rec of records) {
          const current = models[rec.id];
          // 路径被用户改过（relink）：这份解析结果已经过时，直接放弃，别把路径改回去。
          if (current && current.path
            && utils.pathKey(current.path) !== utils.pathKey(rec.path)) continue;
          models[rec.id] = mergeScannedRecord(current, rec);
          if (current) updated++; else added++;
        }

        // 失效检测：用当前记录的最新 path 复核，而不是旧快照里的 path。
        // scan.dropMissing（默认 true）：文件被删掉就直接移出库，不再留在「失效文件」里。
        // 关掉这个开关则退回旧行为：标 missing、保留备注与打印记录，等用户重新定位。
        const scanCfg = ((this.store.getSettings && this.store.getSettings()) || {}).scan || {};
        const dropMissing = scanCfg.dropMissing !== false;
        const removedIds = [];
        for (const r of Object.values(models)) {
          if (!r || !r.path || r.status === 'missing') continue;
          if (r.status === 'quarantined') continue;           // B：隔离区里的文件不归这里管
          if (r.aliasState === 'trashed') continue;           // C：文件已进回收站的别名存根
          if (diskPathKeys.has(utils.pathKey(r.path))) continue;
          if (!scannedDirs.some((sd) => isUnder(r.path, sd.root))) continue;
          let stillExists = false;
          try { await fsp.stat(r.path); stillExists = true; } catch (_) { stillExists = false; }
          if (stillExists) continue;
          if (dropMissing) {
            delete models[r.id];
            removedIds.push(r.id);
            report.removed++;
            report.files.push({ path: r.path, action: 'removed' });
            continue;
          }
          r.status = 'missing';
          r.missingSince = nowMs;
          r.updatedAt = nowMs;
          report.missing++;
          report.files.push({ path: r.path, action: 'missing' });
        }
        // 顺手清掉这些模型在几何指纹索引里的条目，别让已删除的记录继续参与同款分组
        if (removedIds.length && this.shapeIndex && typeof this.shapeIndex.remove === 'function') {
          try { this.shapeIndex.remove(removedIds); } catch (_) { /* 索引清理失败不影响扫描 */ }
        }

        if (!target.scanMeta) target.scanMeta = {};
        for (const [fid, cnt] of folderCounts) {
          target.scanMeta[fid] = { lastScanAt: nowMs, fileCount: cnt };
        }
        const dup = duplicates.annotate(target);
        report.duplicateGroups = dup.groups;
        report.broken = Object.values(models).filter((r) => r && r.parseErrorKind && !r.aliasOf && r.status !== 'missing').length;
        // A：同款变体改由 services 在缩略图就绪后按缩略图重算；
        // 扫描阶段不再写几何指纹分组，避免把完全不同的模型按「形状相近」误聚。
        // 实际写入条数以 mutator 内的结果为准，报告不要虚报。
        report.added = added;
        report.updated = updated;
      }).finally(() => {
        for (const n of inFlightThumbs) this.thumbs._inflight.delete(n);
      });

      // ---- 6. 收尾 ----
      report.duration = Date.now() - startedAt;
      this._status.running = false;
      this._status.phase = this._cancelRequested ? 'cancelled' : 'done';
      this._status.message = this._cancelRequested ? '扫描已取消' : '扫描完成';
      this._emitProgress('done', progressCurrent, total, this._status.message, true);
      this.emit('done', report);
      return report;
    } catch (e) {
      let err = (e instanceof Error) ? e : new Error(String(e));
      if (!/[\u4e00-\u9fa5]/.test(err.message)) err = new Error('扫描失败：' + err.message);
      this._status.running = false;
      this._status.phase = 'error';
      this._status.message = err.message;
      // EventEmitter 的 'error' 无监听器会抛出，这里做保护，绝不外抛
      if (this.listenerCount('error') > 0) this.emit('error', err);
      report.failed++;
      report.files.push({ path: '', action: 'failed', error: err.message });
      report.duration = Date.now() - startedAt;
      this.emit('done', report);
      return report;
    }
  }
}

// 双兼容导出：既支持 const Scanner = require('./scanner')，也支持 const { Scanner } = require('./scanner')
module.exports = Scanner;
module.exports.Scanner = Scanner;
