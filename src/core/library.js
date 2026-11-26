'use strict';
/**
 * 模型库查询与元数据服务（契约 B-2）。
 * query() 为同步方法；其余写操作返回 Promise，统一经 store.updateLibrary() 落盘。
 * 纯 Node 内置模块，禁止 require('electron')。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const C = require('./constants');
const U = require('./utils');
const { hueOfHex } = require('./nlquery');
const { isCommercial } = require('./passport');

const DAY7 = 7 * 24 * 60 * 60 * 1000;
const SMART_KEYS = [
  'all', 'favorites', 'unprinted', 'uncategorized', 'untagged', 'recent',
  'recentOpened', 'duplicates', 'missing', 'printed', 'rated',
  'broken', 'variants',
];
const SORT_FIELDS = [
  'name', 'category', 'size', 'createdAt', 'mtime', 'lastOpenedAt', 'lastPrintedAt',
  'rating', 'printCount', 'openCount',
];

/** 契约 1.2 中除 id/path/size/mtime/hash/createdAt 外可经 update() 修改的字段。 */
const UPDATABLE_FIELDS = [
  'fileName', 'title', 'ext', 'folderId', 'relativePath', 'updatedAt',
  'lastOpenedAt', 'openCount', 'lastPrintedAt', 'printCount', 'printStatus',
  'categoryId', 'tagIds', 'favorite', 'rating', 'note', 'sourceUrl', 'author',
  'thumbnail', 'thumbSource', 'status', 'missingSince', 'parseError',
  'duplicateGroup', 'duplicateOf', 'similarGroup', 'meta',
  // 13 · 成本账本：用户手填重量与耗材分配（meta 里的自动提取值走 meta 字段）
  'costWeightG', 'filamentLinks', 'costNote',
  // B · 隔离区：错误类型 / 隔离状态
  'parseErrorKind', 'quarantinedAt', 'origPath',
  // C · 智能合并：别名降级
  'aliasOf', 'aliasState', 'aliasAt',
  // A · 几何指纹：同款变体
  'variantGroup', 'variantRole', 'variantScore', 'variantScale',
  // I · 模型护照：许可 / 作者主页 / 商用判断
  'license', 'licenseUrl', 'authorUrl', 'commercialUse',
];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPrintStatus = (s) => typeof s === 'string' && Object.prototype.hasOwnProperty.call(C.PRINT_STATUS, s);

/** C：这条记录是不是某个主记录的别名（别名默认不出现在任何普通视图里）。 */
function isAlias(rec) {
  return !!(rec && rec.aliasOf);
}

/** smart 视图过滤谓词，query 与 smartCounts 共用，保证计数与列表一致。 */
function matchSmart(rec, key, now) {
  switch (key) {
    case 'all': return true;
    case 'favorites': return !!rec.favorite;
    case 'unprinted': return rec.printStatus === 'unprinted';
    case 'printed': return rec.printStatus === 'printed';
    case 'uncategorized': return !rec.categoryId;
    case 'untagged': return !Array.isArray(rec.tagIds) || rec.tagIds.length === 0;
    case 'recent': return !!rec.createdAt && (now - rec.createdAt) <= DAY7;
    case 'recentOpened': return !!rec.lastOpenedAt;
    case 'duplicates': return !!(rec.duplicateGroup || rec.duplicateOf || rec.similarGroup);
    case 'missing': return rec.status === 'missing';
    // B：解析失败 / 结构异常的坏文件（含已隔离的）；文件已不存在的那条归 missing 管
    case 'broken': return !!rec.parseErrorKind && rec.status !== 'missing';
    // A：几何指纹认出的同款变体
    case 'variants': return !!rec.variantGroup;
    case 'rated': return (Number(rec.rating) || 0) > 0;
    // I：护照里明确允许商用的
    case 'commercial': return isCommercial(rec);
    default: return true;
  }
}

/** 自适应计算新 id：按记录旧 id 反推其生成算法，保证与 scanner 写入的 id 规则一致。 */
function computeNewId(oldPath, newPath, oldId) {
  const b = U.sha1(U.pathKey(oldPath)).slice(0, 20);
  if (oldId === b) return U.sha1(U.pathKey(newPath)).slice(0, 20);
  return U.sha1(U.normalizePath(newPath)).slice(0, 20);
}

/** 重算相对监控目录的路径。 */
function recomputeRelative(rec, newAbsPath, settings) {
  const folders = (settings && Array.isArray(settings.folders)) ? settings.folders : [];
  const f = rec.folderId ? folders.find((x) => x && x.id === rec.folderId && x.path) : null;
  if (f) {
    try { return path.relative(path.resolve(f.path), newAbsPath); } catch (_) { /* 忽略 */ }
  }
  if (rec.relativePath) {
    return path.join(path.dirname(String(rec.relativePath)), path.basename(newAbsPath));
  }
  return null;
}

function sortValue(rec, key) {
  switch (key) {
    case 'name': return (rec.title || rec.fileName || '').toLowerCase();
    case 'size': return rec.size;
    case 'createdAt': return rec.createdAt;
    case 'mtime': return rec.mtime;
    case 'lastOpenedAt': return rec.lastOpenedAt;
    case 'lastPrintedAt': return rec.lastPrintedAt;
    case 'rating': return rec.rating;
    case 'printCount': return rec.printCount;
    case 'openCount': return rec.openCount;
    default: return rec.createdAt;
  }
}

const isNullish = (v) => v === null || v === undefined || (typeof v === 'number' && !isFinite(v));

class LibraryService {
  constructor({ store } = {}) {
    if (!store) throw new Error('LibraryService 需要传入 store 实例');
    this.store = store;
  }

  _lib() {
    const l = this.store.getLibrary();
    return (l && l.models) ? l : { models: {}, categories: [], tags: [], savedViews: [], scanMeta: {} };
  }
  _models() { return this._lib().models || {}; }
  _all() { return Object.values(this._models()); }
  _settings() { return this.store.getSettings() || {}; }

  // ---- 查询（同步） ----

  query(q = {}) {
    const Q = q || {};
    const lib = this._lib();
    const tagMap = new Map((lib.tags || []).map((t) => [t.id, t]));
    const catMap = new Map((lib.categories || []).map((c) => [c.id, c]));
    const kw = String(Q.keyword || '').trim().toLowerCase();
    const now = U.now();

    let sortBy = Q.sortBy || 'createdAt';
    if (!SORT_FIELDS.includes(sortBy)) sortBy = 'createdAt';
    let dir;
    if (Q.sortDir === 'asc' || Q.sortDir === 'desc') dir = Q.sortDir === 'asc' ? 1 : -1;
    // 名称与分类默认升序（分类按侧栏里的 order 从小到大），其余字段默认倒序
    else dir = (sortBy === 'name' || sortBy === 'category') ? 1 : -1;
    // smart=recentOpened 契约要求"按时间排"：未显式指定排序时按最近打开时间倒序。
    if (Q.smart === 'recentOpened' && !Q.sortBy) { sortBy = 'lastOpenedAt'; dir = -1; }

    const tagIds = Array.isArray(Q.tagIds) ? Q.tagIds : [];
    const printStatuses = Array.isArray(Q.printStatuses) ? Q.printStatuses : [];
    const statuses = Array.isArray(Q.statuses) ? Q.statuses : [];
    const ratingMin = Number(Q.ratingMin) || 0;

    // 文件被手动删掉的记录默认不再出现在任何普通视图里（用户要求「直接消失」），
    // 只有「失效文件」维护视图（smart=missing）或显式按 status=missing 筛选时才列出来，
    // 这样用户仍能找回误移走的文件、做重新定位或移出索引。
    const wantMissing = Q.smart === 'missing' || statuses.includes('missing');
    // B：已隔离的文件同样只在隔离区（smart=broken）或显式按 status 筛选时可见
    const wantQuarantined = Q.smart === 'broken' || statuses.includes('quarantined');

    const filtered = [];
    for (const rec of this._all()) {
      // C：别名从普通视图、搜索、统计里隐藏；详情页「副本」列表用 includeAliases 取
      if (isAlias(rec) && !Q.includeAliases) continue;
      if (!wantMissing && rec.status === 'missing') continue;
      if (!wantQuarantined && rec.status === 'quarantined') continue;
      if (Q.smart && !matchSmart(rec, Q.smart, now)) continue;
      if (statuses.length && !statuses.includes(rec.status)) continue;
      if (Q.folderId && rec.folderId !== Q.folderId) continue;
      if (Q.categoryId) {
        if (Q.categoryId === '__uncategorized__') {
          if (rec.categoryId) continue;
        } else if (rec.categoryId !== Q.categoryId) continue;
      }
      if (tagIds.length) {
        const set = new Set(Array.isArray(rec.tagIds) ? rec.tagIds : []);
        if (Q.tagMode === 'all') {
          if (!tagIds.every((t) => set.has(t))) continue;
        } else if (!tagIds.some((t) => set.has(t))) continue;
      }
      if (printStatuses.length && !printStatuses.includes(rec.printStatus)) continue;
      if (Q.favoritesOnly && !rec.favorite) continue;
      if (ratingMin > 0 && (Number(rec.rating) || 0) < ratingMin) continue;

      // F · 自然语言搜索解析出来的结构化条件
      if (Number.isFinite(Number(Q.printedFrom)) || Number.isFinite(Number(Q.printedTo))) {
        const at = Number(rec.lastPrintedAt) || 0;
        if (!at) continue;
        if (Number.isFinite(Number(Q.printedFrom)) && at < Number(Q.printedFrom)) continue;
        if (Number.isFinite(Number(Q.printedTo)) && at > Number(Q.printedTo)) continue;
      }
      if (Number.isFinite(Number(Q.createdFrom)) || Number.isFinite(Number(Q.createdTo))) {
        const at = Number(rec.createdAt) || 0;
        if (Number.isFinite(Number(Q.createdFrom)) && at < Number(Q.createdFrom)) continue;
        if (Number.isFinite(Number(Q.createdTo)) && at > Number(Q.createdTo)) continue;
      }
      if (Array.isArray(Q.colorHues) && Q.colorHues.length) {
        const colors = (rec.meta && Array.isArray(rec.meta.filamentColors)) ? rec.meta.filamentColors : [];
        const hues = colors.map(hueOfHex).filter((h) => h != null);
        const hit = Q.colorHues.some((c) => {
          const ch = Number(c && c.h);
          const tol = Number(c && c.tol) || 25;
          if (!Number.isFinite(ch)) return false;
          return hues.some((h) => { const d = Math.abs(h - ch); return Math.min(d, 360 - d) <= tol; });
        });
        if (!hit) continue;
      }
      if (Array.isArray(Q.filamentTypes) && Q.filamentTypes.length) {
        const types = []
          .concat(Array.isArray(rec.meta && rec.meta.filamentTypes) ? rec.meta.filamentTypes : [])
          .concat(Array.isArray(rec.filamentLinks) ? rec.filamentLinks.map((l) => l && l.type).filter(Boolean) : []);
        const tset = new Set(types.map((x) => String(x).toUpperCase()));
        if (!Q.filamentTypes.some((t) => tset.has(String(t).toUpperCase()))) continue;
      }
      if (Number.isFinite(Number(Q.minColors)) && Number(Q.minColors) > 0) {
        const colors = (rec.meta && Array.isArray(rec.meta.filamentColors)) ? rec.meta.filamentColors : [];
        if (colors.length < Number(Q.minColors)) continue;
      }
      if (Number.isFinite(Number(Q.colorsCount)) && Number(Q.colorsCount) > 0) {
        const colors = (rec.meta && Array.isArray(rec.meta.filamentColors)) ? rec.meta.filamentColors : [];
        if (colors.length !== Number(Q.colorsCount)) continue;
      }
      if (Number.isFinite(Number(Q.sizeMin)) && (Number(rec.size) || 0) < Number(Q.sizeMin)) continue;
      if (Number.isFinite(Number(Q.sizeMax)) && (Number(rec.size) || 0) > Number(Q.sizeMax)) continue;
      if (Q.author) {
        const a = String(rec.author || (rec.meta && rec.meta.designer) || '').toLowerCase();
        if (!a.includes(String(Q.author).toLowerCase())) continue;
      }
      if (kw) {
        const hay = [rec.title, rec.fileName, rec.note, rec.author, rec.sourceUrl]
          .map((x) => String(x == null ? '' : x)).join(' ').toLowerCase();
        let ok = hay.includes(kw);
        if (!ok && Array.isArray(rec.tagIds)) {
          for (const tid of rec.tagIds) {
            const t = tagMap.get(tid);
            if (t && String(t.name || '').toLowerCase().includes(kw)) { ok = true; break; }
          }
        }
        if (!ok && rec.categoryId) {
          const c = catMap.get(rec.categoryId);
          if (c && String(c.name || '').toLowerCase().includes(kw)) ok = true;
        }
        if (!ok) continue;
      }
      filtered.push(rec);
    }

    const total = filtered.length;

    // facets：基于过滤后、分页前的结果集统计
    const facets = { byPrintStatus: {}, byCategory: {}, byTag: {} };
    for (const rec of filtered) {
      const ps = rec.printStatus || 'unprinted';
      facets.byPrintStatus[ps] = (facets.byPrintStatus[ps] || 0) + 1;
      const cid = rec.categoryId || '__uncategorized__';
      facets.byCategory[cid] = (facets.byCategory[cid] || 0) + 1;
      if (Array.isArray(rec.tagIds)) {
        for (const tid of rec.tagIds) facets.byTag[tid] = (facets.byTag[tid] || 0) + 1;
      }
    }

    const isStr = (sortBy === 'name');
    // 按分类排列：主键是分类在侧栏里的顺序（未分类固定最后），组内按名称升序。
    // 组内不跟 sortDir 反转，否则「分类倒序」会让组内文字也倒着排，反直觉。
    const catRank = new Map((lib.categories || [])
      .map((c) => [c.id, Number.isFinite(Number(c.order)) ? Number(c.order) : 998]));
    const catRankOf = (rec) => (rec.categoryId && catRank.has(rec.categoryId) ? catRank.get(rec.categoryId) : 999);
    filtered.sort((a, b) => {
      if (sortBy === 'category') {
        const ra = catRankOf(a);
        const rb = catRankOf(b);
        // 组顺序固定按侧栏 order 升序（未分类 999 永远最后），组内也固定按名称升序：
        // 切换「升序/降序」不应该把分类顺序倒过来、更不该让未分类跑到最前，
        // 所以这里刻意不乘 dir（与上面「组内不跟 sortDir 反转」一致）。
        if (ra !== rb) return ra - rb;
        const cmp = String(a.title || a.fileName || '')
          .localeCompare(String(b.title || b.fileName || ''), 'zh-CN');
        return cmp === 0 ? String(a.id).localeCompare(String(b.id)) : cmp;
      }
      const va = sortValue(a, sortBy);
      const vb = sortValue(b, sortBy);
      const na = isNullish(va);
      const nb = isNullish(vb);
      if (na && nb) return String(a.id).localeCompare(String(b.id));
      if (na) return 1;   // null 值永远排最后（不受 asc/desc 影响）
      if (nb) return -1;
      let cmp = isStr ? String(va).localeCompare(String(vb), 'zh-CN') : (Number(va) - Number(vb));
      if (cmp === 0) return String(a.id).localeCompare(String(b.id));
      return cmp * dir;
    });

    const limit = Number(Q.limit) || 0;
    const offset = Math.max(0, Number(Q.offset) || 0);
    const items = limit > 0 ? filtered.slice(offset, offset + limit) : filtered;
    return { items, total, facets };
  }

  get(id) { return this._models()[id] || null; }
  getMany(ids) {
    const models = this._models();
    return (Array.isArray(ids) ? ids : [ids]).map((id) => models[id]).filter(Boolean);
  }

  /** C：某条主记录名下的全部别名副本（含文件已进回收站的存根） */
  aliasesOf(id) {
    const out = this._all().filter((r) => r.aliasOf === id);
    out.sort((a, b) => (Number(a.aliasAt) || 0) - (Number(b.aliasAt) || 0));
    return out;
  }

  /** C：解除别名关系，让副本重新成为独立记录。返回解除的条数。 */
  async detachAliases(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const now = U.now();
    let detached = 0;
    await this.store.updateLibrary((lib) => {
      for (const id of list) {
        const r = lib.models[id];
        if (!r || !r.aliasOf) continue;
        r.aliasOf = null;
        r.aliasState = null;
        r.aliasAt = null;
        r.updatedAt = now;
        detached++;
      }
    }, 'detachAliases');
    return { detached };
  }

  // ---- 更新 ----

  async update(id, patch) {
    const P = patch || {};
    if (P.printStatus !== undefined && !isPrintStatus(P.printStatus)) {
      throw new Error('非法的打印状态：' + P.printStatus);
    }
    let result = null;
    await this.store.updateLibrary((lib) => {
      const rec = lib.models[id];
      if (!rec) throw new Error('模型记录不存在：' + id);
      for (const k of UPDATABLE_FIELDS) {
        if (!has(P, k)) continue;
        let v = P[k];
        if (k === 'rating') v = U.clamp(v, 0, 5);
        else if (k === 'favorite') v = !!v;
        else if (Array.isArray(v)) v = v.slice();
        rec[k] = v;
        // 人工改过 categoryId 就不再是「自动分类结果」，撤销时不能清掉它（P1-8）。
        if (k === 'categoryId') {
          rec.autoClassified = false;
          delete rec.autoCategoryId;
        }
      }
      rec.updatedAt = U.now();
      result = rec;
    }, 'update');
    return result;
  }

  async bulk(ids, patch = {}) {
    const list = Array.isArray(ids) ? ids : [ids];
    const P = Object.assign({}, patch);
    const appendTags = P.__appendTags; delete P.__appendTags;
    const removeTags = P.__removeTags; delete P.__removeTags;
    if (P.printStatus !== undefined && !isPrintStatus(P.printStatus)) {
      throw new Error('非法的打印状态：' + P.printStatus);
    }
    const changed = [];
    await this.store.updateLibrary((lib) => {
      const now = U.now();
      for (const id of list) {
        const rec = lib.models[id];
        if (!rec) continue;
        for (const k of UPDATABLE_FIELDS) {
          if (!has(P, k)) continue;
          let v = P[k];
          if (k === 'rating') v = U.clamp(v, 0, 5);
          else if (k === 'favorite') v = !!v;
          else if (Array.isArray(v)) v = v.slice();
          rec[k] = v;
          if (k === 'categoryId') {
            rec.autoClassified = false;
            delete rec.autoCategoryId;
          }
        }
        if ((appendTags && appendTags.length) || (removeTags && removeTags.length)) {
          const set = new Set(Array.isArray(rec.tagIds) ? rec.tagIds : []);
          for (const t of (appendTags || [])) set.add(t);
          for (const t of (removeTags || [])) set.delete(t);
          rec.tagIds = Array.from(set);
        }
        rec.updatedAt = now;
        changed.push(id);
      }
    }, 'bulk');
    return { updated: changed.length, ids: changed };
  }

  async rename(id, newTitle) {
    return this.update(id, { title: String(newTitle) });
  }

  async renameFile(id, newBaseName) {
    const models = this._models();
    const rec = models[id];
    if (!rec) throw new Error('模型记录不存在：' + id);

    let base = U.safeFileName(String(newBaseName)).replace(/\.3mf$/i, '');
    base = U.safeFileName(base);
    const finalName = base + '.3mf';
    const oldPath = rec.path;
    const newPath = path.join(path.dirname(String(oldPath)), finalName);
    const sameFile = U.normalizePath(newPath).toLowerCase() === U.normalizePath(oldPath).toLowerCase();
    const newId = sameFile ? id : computeNewId(oldPath, newPath, id);

    let renamed = false;      // 磁盘是否已经改过名（写库失败时要回滚）
    if (!sameFile) {
      // 绝不覆盖已存在的其它文件
      if (fs.existsSync(newPath)) throw new Error('目标文件已存在，拒绝覆盖：' + newPath);
      if (newId !== id && models[newId]) {
        throw new Error('重命名后的记录标识与现有记录冲突：' + newId);
      }
      try {
        fs.renameSync(oldPath, newPath);
      } catch (e) {
        throw new Error('重命名文件失败：' + oldPath + ' → ' + newPath + ' · ' + e.message);
      }
      renamed = true;
    }

    const settings = this._settings();
    let result = null;
    try {
      await this.store.updateLibrary((lib) => {
        const r = lib.models[id];
        if (!r) throw new Error('模型记录不存在：' + id);
        const now = U.now();
        r.path = newPath;
        r.fileName = finalName;
        r.ext = '3mf';
        r.relativePath = recomputeRelative(r, newPath, settings);
        r.updatedAt = now;
        if (newId !== id) {
          r.id = newId;
          delete lib.models[id];
          lib.models[newId] = r;
          for (const other of Object.values(lib.models)) {
            if (other.duplicateOf === id) other.duplicateOf = newId;
            if (other.aliasOf === id) other.aliasOf = newId;
          }
        }
        result = r;
      }, 'renameFile');
    } catch (e) {
      // 写库失败（磁盘满 / 记录被并发删掉）：把磁盘上的名字改回去，别让文件成为孤儿
      if (renamed) {
        try { fs.renameSync(newPath, oldPath); } catch (_) { /* 回滚失败只能如实报错 */ }
      }
      throw e;
    }
    return result;
  }

  async remove(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const set = new Set(list);
    let removed = 0;
    await this.store.updateLibrary((lib) => {
      for (const id of list) {
        if (lib.models[id]) { delete lib.models[id]; removed++; }
      }
      for (const r of Object.values(lib.models)) {
        if (r.duplicateOf && set.has(r.duplicateOf)) r.duplicateOf = null;
        // C：主记录没了，它的别名要恢复成独立记录，否则会永远藏在库里看不到
        if (r.aliasOf && set.has(r.aliasOf)) {
          r.aliasOf = null;
          r.aliasState = null;
          r.aliasAt = null;
          r.updatedAt = U.now();
        }
      }
    }, 'remove');
    return { removed };
  }

  async relink(id, newPath) {
    const target = U.normalizePath(newPath);
    if (U.extName(target) !== '.3mf') {
      throw new Error('重新定位失败：目标文件不是 .3mf 格式：' + target);
    }
    let st;
    try { st = fs.statSync(target); }
    catch (_) { throw new Error('重新定位失败：文件不存在：' + target); }
    if (!st.isFile()) throw new Error('重新定位失败：目标不是文件：' + target);

    const settings = this._settings();
    let result = null;
    await this.store.updateLibrary((lib) => {
      const r = lib.models[id];
      if (!r) throw new Error('模型记录不存在：' + id);
      r.path = target;
      r.fileName = path.basename(target);
      r.size = st.size;
      r.mtime = st.mtimeMs;
      r.status = 'ok';
      r.missingSince = null;
      r.parseError = null;
      r.parseErrorKind = null;
      r.quarantinedAt = null;
      delete r.origPath;
      r.relativePath = recomputeRelative(r, target, settings);
      r.updatedAt = U.now();
      result = r;
    }, 'relink');
    return result;
  }

  /** 同步：在监控目录下按文件名 / similarNameKey + 近似大小找候选，最多 8 条。 */
  async findRelinkCandidates(id) {
    const rec = this._models()[id];
    if (!rec) return [];
    const settings = this._settings();
    const folders = Array.isArray(settings.folders) ? settings.folders : [];
    const scan = settings.scan || {};
    const maxDepth = Number.isFinite(scan.maxDepth) ? scan.maxDepth : 12;
    const ignore = new Set([
      ...(C.IGNORE_DIRS || []), ...(scan.excludeDirs || []),
    ].map((s) => String(s).toLowerCase()));

    const exact = String(rec.fileName || '').toLowerCase();
    const key = U.similarNameKey(rec.fileName);
    const size = Number(rec.size) || 0;
    const selfKey = U.normalizePath(rec.path).toLowerCase();
    const seen = new Set();
    const hits = [];
    let visited = 0;

    const consider = (full, name, stat) => {
      const nk = U.normalizePath(full).toLowerCase();
      if (nk === selfKey || seen.has(nk)) return;
      if (!(stat.size > 0 && stat.size <= (C.MAX_FILE_SIZE || 500 * 1024 * 1024))) return;
      const low = name.toLowerCase();
      const ckey = U.similarNameKey(name);
      const nearSize = size > 0 && Math.abs(stat.size - size) / size < 0.02;
      let score = 0;
      if (low === exact) score = 3;
      else if (key && ckey === key) score = 2;
      else if (key && ckey && (ckey.includes(key) || key.includes(ckey))) score = 1;
      if (nearSize) score += 1;
      if (score >= 2) {
        seen.add(nk);
        hits.push({ path: full, score });
      }
    };

    // 以前这里是同步递归 readdirSync+statSync，跑在主进程上，两三万个条目会把界面卡住好几秒。
    // 改成异步遍历 + 2.5 秒预算 + 深度上限，超时先返回已找到的候选，用户还能手动指定。
    const startedAt = Date.now();
    const BUDGET_MS = 2500;
    const depthCap = Math.min(maxDepth, 4);

    const walk = async (dir, depth) => {
      if (depth > depthCap || visited > 20000 || hits.length >= 24) return;
      if (Date.now() - startedAt > BUDGET_MS) return;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch (_) { return; }
      for (const e of entries) {
        if (visited++ > 20000) return;
        if (Date.now() - startedAt > BUDGET_MS) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (ignore.has(e.name.toLowerCase())) continue;
          await walk(full, depth + 1);
        } else if (e.isFile()) {
          if (U.extName(e.name) !== '.3mf') continue;
          let stat;
          try { stat = await fsp.stat(full); } catch (_) { continue; }
          consider(full, e.name, stat);
        }
      }
    };

    for (const f of folders) {
      if (f && f.path) await walk(path.resolve(f.path), 0);
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, 8).map((h) => h.path);
  }

  async markOpened(id) {
    let result = null;
    await this.store.updateLibrary((lib) => {
      const r = lib.models[id];
      if (!r) throw new Error('模型记录不存在：' + id);
      const now = U.now();
      r.lastOpenedAt = now;
      r.openCount = (Number(r.openCount) || 0) + 1;
      r.updatedAt = now;
      result = r;
    }, 'markOpened');
    return result;
  }

  async setPrintStatus(ids, status) {
    if (!isPrintStatus(status)) throw new Error('非法的打印状态：' + status);
    const list = Array.isArray(ids) ? ids : [ids];
    let updated = 0;
    await this.store.updateLibrary((lib) => {
      const now = U.now();
      for (const id of list) {
        const r = lib.models[id];
        if (!r) continue;
        // 只有状态实际变为 printed 才计一次打印，重复设置保持幂等。
        if (status === 'printed' && r.printStatus !== 'printed') {
          r.printCount = (Number(r.printCount) || 0) + 1;
          r.lastPrintedAt = now;
        }
        r.printStatus = status;
        r.updatedAt = now;
        updated++;
      }
    }, 'setPrintStatus');
    return { updated };
  }

  // ---- 分类 ----

  categories() { return (this._lib().categories || []).slice(); }

  async categoryCreate({ name, color, icon } = {}) {
    const n = String(name || '').trim();
    if (!n) throw new Error('分类名称不能为空');
    const cat = {
      id: U.uid('cat'), name: n, color: color || null, icon: icon || 'i-folder',
      order: 0, createdAt: U.now(),
    };
    await this.store.updateLibrary((lib) => {
      if (!Array.isArray(lib.categories)) lib.categories = [];
      cat.order = lib.categories.length;
      if (!cat.color) {
        const palette = (C.CATEGORY_COLORS && C.CATEGORY_COLORS.length) ? C.CATEGORY_COLORS : ['#4f46e5'];
        cat.color = palette[cat.order % palette.length];
      }
      lib.categories.push(cat);
    }, 'categoryCreate');
    return cat;
  }

  async categoryUpdate(id, patch = {}) {
    let result = null;
    await this.store.updateLibrary((lib) => {
      const c = (lib.categories || []).find((x) => x.id === id);
      if (!c) throw new Error('分类不存在：' + id);
      for (const k of ['name', 'color', 'icon', 'order']) {
        if (has(patch, k)) c[k] = patch[k];
      }
      result = c;
    }, 'categoryUpdate');
    return result;
  }

  async categoryDelete(id, moveTo = null) {
    await this.store.updateLibrary((lib) => {
      const arr = lib.categories || [];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error('分类不存在：' + id);
      let target = moveTo;
      if (target === id) target = null;
      if (target != null && !arr.some((x) => x.id === target && x.id !== id)) {
        throw new Error('目标分类不存在：' + target);
      }
      arr.splice(idx, 1);
      for (const r of Object.values(lib.models || {})) {
        if (r.categoryId === id) {
          r.categoryId = target;
          // 分类被删后这条记录已不是原自动结果，撤销不能再动它。
          r.autoClassified = false;
          delete r.autoCategoryId;
        }
      }
    }, 'categoryDelete');
  }

  // ---- 标签 ----

  tags() { return (this._lib().tags || []).slice(); }

  async tagCreate({ name, color } = {}) {
    const n = String(name || '').trim();
    if (!n) throw new Error('标签名称不能为空');
    const lower = n.toLowerCase();
    const exist = (this._lib().tags || []).find((t) => String(t.name || '').toLowerCase() === lower);
    if (exist) return exist;

    const tag = { id: U.uid('tag'), name: n, color: color || null, createdAt: U.now() };
    await this.store.updateLibrary((lib) => {
      if (!Array.isArray(lib.tags)) lib.tags = [];
      const again = lib.tags.find((t) => String(t.name || '').toLowerCase() === lower);
      if (again) { Object.assign(tag, again); return; }
      if (!tag.color) {
        const palette = (C.DEFAULT_TAG_COLORS && C.DEFAULT_TAG_COLORS.length) ? C.DEFAULT_TAG_COLORS : ['#64748b'];
        tag.color = palette[lib.tags.length % palette.length];
      }
      lib.tags.push(tag);
    }, 'tagCreate');
    return tag;
  }

  async tagUpdate(id, patch = {}) {
    let result = null;
    await this.store.updateLibrary((lib) => {
      const t = (lib.tags || []).find((x) => x.id === id);
      if (!t) throw new Error('标签不存在：' + id);
      for (const k of ['name', 'color']) {
        if (has(patch, k)) t[k] = patch[k];
      }
      result = t;
    }, 'tagUpdate');
    return result;
  }

  async tagDelete(id) {
    await this.store.updateLibrary((lib) => {
      const arr = lib.tags || [];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error('标签不存在：' + id);
      arr.splice(idx, 1);
      for (const r of Object.values(lib.models || {})) {
        if (Array.isArray(r.tagIds) && r.tagIds.includes(id)) {
          r.tagIds = r.tagIds.filter((t) => t !== id);
        }
      }
    }, 'tagDelete');
  }

  async tagAssign(ids, tagIds, mode = 'add') {
    if (!['add', 'remove', 'set'].includes(mode)) {
      throw new Error('非法的标签操作模式：' + mode);
    }
    const idList = Array.isArray(ids) ? ids : [ids];
    const tags = Array.isArray(tagIds) ? tagIds : [tagIds];
    let updated = 0;
    await this.store.updateLibrary((lib) => {
      const now = U.now();
      for (const id of idList) {
        const r = lib.models[id];
        if (!r) continue;
        const cur = Array.isArray(r.tagIds) ? r.tagIds : [];
        let next;
        if (mode === 'set') next = tags.slice();
        else if (mode === 'remove') next = cur.filter((t) => !tags.includes(t));
        else { const set = new Set(cur); for (const t of tags) set.add(t); next = Array.from(set); }
        r.tagIds = next;
        r.updatedAt = now;
        updated++;
      }
    }, 'tagAssign');
    return { updated };
  }

  // ---- 视图 ----

  views() { return (this._lib().savedViews || []).slice(); }

  async viewSave({ name, query } = {}) {
    const n = String(name || '').trim();
    if (!n) throw new Error('视图名称不能为空');
    const view = { id: U.uid('view'), name: n, query: query || {}, createdAt: U.now() };
    await this.store.updateLibrary((lib) => {
      if (!Array.isArray(lib.savedViews)) lib.savedViews = [];
      lib.savedViews.push(view);
    }, 'viewSave');
    return view;
  }

  async viewDelete(id) {
    await this.store.updateLibrary((lib) => {
      const arr = lib.savedViews || [];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error('视图不存在：' + id);
      arr.splice(idx, 1);
    }, 'viewDelete');
  }

  // ---- 统计 ----

  stats() {
    const now = U.now();
    const s = {
      total: 0, totalSize: 0,
      byPrintStatus: {}, byCategory: {}, byTag: {}, byStatus: {},
      favorites: 0, printed: 0, unprinted: 0, missing: 0, duplicates: 0,
      recentAdded: 0, recentOpened: 0, thumbnails: 0,
      quarantined: 0, broken: 0, aliases: 0,
    };
    const dupSizes = this._dupGroupSizes();
    const simSizes = this._groupSizes('similarGroup');
    const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
    for (const r of this._all()) {
      // 失效记录只用于「失效文件」维护视图的计数，不进入模型总数 / 占用空间 /
      // 分类计数，否则页头写 184、列表只有 161，看起来像 bug。
      if (r.status === 'missing') {
        s.missing++;
        bump(s.byStatus, 'missing');
        continue;
      }
      // B：已隔离的文件同样不进总数 / 占用空间，只在隔离区里计数
      if (r.status === 'quarantined') {
        s.quarantined++;
        bump(s.byStatus, 'quarantined');
        continue;
      }
      // C：别名挂在主记录下面，不单独计数
      if (isAlias(r)) { s.aliases++; continue; }
      if (r.parseErrorKind) s.broken++;
      s.total++;
      s.totalSize += Number(r.size) || 0;
      bump(s.byPrintStatus, r.printStatus || 'unprinted');
      bump(s.byCategory, r.categoryId || '__uncategorized__');
      bump(s.byStatus, r.status || 'ok');
      if (Array.isArray(r.tagIds)) for (const t of r.tagIds) bump(s.byTag, t);
      if (r.favorite) s.favorites++;
      if (r.printStatus === 'printed') s.printed++;
      if (r.printStatus === 'unprinted') s.unprinted++;
      if (r.duplicateOf || (r.duplicateGroup && dupSizes.get(r.duplicateGroup) > 1)
        || (r.similarGroup && simSizes.get(r.similarGroup) > 1)) s.duplicates++;
      if (r.createdAt && (now - r.createdAt) <= DAY7) s.recentAdded++;
      if (r.lastOpenedAt && (now - r.lastOpenedAt) <= DAY7) s.recentOpened++;
      if (r.thumbnail) s.thumbnails++;
    }
    return s;
  }

  smartCounts() {
    const out = {};
    for (const k of SMART_KEYS) out[k] = 0;
    const now = U.now();
    const dupSizes = this._dupGroupSizes();
    const simSizes = this._groupSizes('similarGroup');
    for (const r of this._all()) {
      // 与 query 保持一致：失效 / 已隔离记录只计入各自视图，其它徽标不能比列表多；
      // 别名（C）在任何视图里都不计数
      const isMissing = r.status === 'missing';
      const isQuarantined = r.status === 'quarantined';
      const hidden = isMissing || isQuarantined || isAlias(r);
      for (const k of SMART_KEYS) {
        if (k === 'duplicates') continue;   // 单独算：要按「组内 ≥2」判定
        if (isMissing && k !== 'missing') continue;
        if (isQuarantined && k !== 'broken') continue;
        if (isAlias(r)) continue;
        if (matchSmart(r, k, now)) out[k]++;
      }
      // 一键清除后留下的那份仍带旧分组标记；只按标记计数会让徽标一直是 N 而列表是空的。
      if (!hidden && (r.duplicateOf || (r.duplicateGroup && dupSizes.get(r.duplicateGroup) > 1)
        || (r.similarGroup && simSizes.get(r.similarGroup) > 1))) {
        out.duplicates++;
      }
    }
    return out;
  }

  /** 各重复组当前的文件数：判断「还是不是重复」不能只看记录上有没有分组标记 */
  _dupGroupSizes() {
    return this._groupSizes('duplicateGroup');
  }

  /** 任意分组字段的当前成员数（排除别名，避免空组残留把徽标撑大） */
  _groupSizes(field) {
    const sizes = new Map();
    for (const r of this._all()) {
      const k = r && r[field];
      if (!k || isAlias(r)) continue;
      sizes.set(k, (sizes.get(k) || 0) + 1);
    }
    return sizes;
  }

  roulette() {
    const pool = this._all().filter((r) => (r.printStatus === 'unprinted' || r.printStatus === 'queued')
      && !isAlias(r) && r.status !== 'missing' && r.status !== 'quarantined');
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---- 导入导出（委托 store） ----

  async exportJson(targetPath) { return this.store.exportTo(targetPath); }
  async importJson(sourcePath, merge = true) { return this.store.importFrom(sourcePath, { merge }); }
}

module.exports = LibraryService;
module.exports.LibraryService = LibraryService;
