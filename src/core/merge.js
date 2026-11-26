'use strict';
/**
 * C · 重复模型智能合并（纯 Node，无 Electron 依赖）。
 *
 * 概念：
 *   - 一组重复里挑一条当「主记录」，其余降为「别名」（aliasOf 指向主记录）。
 *   - 别名从普通网格 / 搜索 / 统计 / 轮盘里隐藏，挂在主记录详情页的「副本」里。
 *   - 别名的文件可以移入回收站；记录保留为存根（aliasState = 'trashed'），路径、大小、备注都在。
 *
 * 本模块只负责：打分、分组、生成计划、把结果写进 library 对象。
 * 「移入回收站」是 Electron / 系统调用，由调用方完成后再把结果传进来（见 applyMergeInLibrary）。
 * 本模块不碰磁盘上的模型文件。
 */
const U = require('./utils');
const duplicates = require('./duplicates');

function isAlias(rec) {
  return !!(rec && rec.aliasOf);
}

/** 能不能参与合并：别名本身、失效 / 隔离 / 解析失败的记录都不行 */
function eligible(rec) {
  if (!rec || isAlias(rec)) return false;
  if (!rec.path) return false;
  if (rec.status === 'missing' || rec.status === 'quarantined') return false;
  if (rec.parseErrorKind) return false;
  return true;
}

/**
 * 主记录打分。理由会原样显示在界面上，所以每一条都要能说清楚「为什么留它」。
 * 返回 { score, reasons: String[] }
 */
function scoreMember(rec) {
  const reasons = [];
  let score = 0;
  if (!rec) return { score: -1, reasons };
  const meta = rec.meta || {};

  if (rec.thumbnail) { score += 3; reasons.push('有缩略图'); }

  let rich = 0;
  const fileBase = U.baseName(String(rec.fileName || ''));
  if (rec.title && String(rec.title).trim() && String(rec.title).trim() !== fileBase) rich++;
  if (rec.author && String(rec.author).trim()) rich++;
  if (rec.sourceUrl || (rec.sourceUrls && Object.keys(rec.sourceUrls).length)) rich++;
  if (meta.weightG != null) rich++;
  if (rich) { score += rich; reasons.push('信息更完整'); }

  const prints = Number(rec.printCount) || 0;
  if (prints > 0) { score += 2 * Math.min(prints, 2); reasons.push('打印过 ' + prints + ' 次'); }
  if (rec.favorite) { score += 2; reasons.push('已收藏'); }
  if (rec.note && String(rec.note).trim()) { score += 2; reasons.push('有备注'); }
  if (rec.categoryId) { score += 2; reasons.push('有分类'); }
  if (Array.isArray(rec.tagIds) && rec.tagIds.length) { score += 1; reasons.push('有标签'); }
  return { score, reasons };
}

/** 分高者留；同分留路径最短的（在监控目录里更靠前），再留最早入库的，最后按 id 保证可复现 */
function compareMembers(a, b) {
  const d = scoreMember(b).score - scoreMember(a).score;
  if (d) return d;
  const la = String(a.relativePath || a.path || '').length;
  const lb = String(b.relativePath || b.path || '').length;
  if (la !== lb) return la - lb;
  const ca = Number(a.createdAt) || 0;
  const cb = Number(b.createdAt) || 0;
  if (ca !== cb) return ca - cb;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function groupKey(kind, id) {
  return kind + ':' + id;
}

/**
 * 列出当前库里可合并的组。
 *   exact   —— 内容哈希完全相同（duplicateGroup）
 *   similar —— 文件名与体积相近（similarGroup）
 *   variant —— 几何指纹认出的同款变体（variantGroup，A 功能产出）
 */
function buildGroups(library, { kinds } = {}) {
  const want = Array.isArray(kinds) && kinds.length ? kinds : ['exact', 'similar', 'variant'];
  const all = Object.values((library && library.models) || {}).filter(eligible);
  const byKey = new Map();
  const fieldOf = { exact: 'hash', similar: 'similarGroup', variant: 'variantGroup' };
  const labelOf = { exact: 'exact', similar: 'similar', variant: 'variant' };

  for (const kind of want) {
    const field = fieldOf[kind];
    if (!field) continue;
    const buckets = new Map();
    for (const rec of all) {
      const id = rec[field];
      if (!id) continue;
      if (!buckets.has(id)) buckets.set(id, []);
      buckets.get(id).push(rec);
    }
    for (const [id, members] of buckets) {
      if (members.length < 2) continue;
      members.sort(compareMembers);
      const keeper = members[0];
      const sk = scoreMember(keeper);
      const rest = members.slice(1);
      byKey.set(groupKey(kind, id), {
        key: groupKey(kind, id),
        kind,
        kindLabel: labelOf[kind],
        members,
        keeperId: keeper.id,
        keeperReasons: sk.reasons,
        keeperScore: sk.score,
        freedBytes: rest.reduce((s, m) => s + (Number(m.size) || 0), 0),
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.freedBytes - a.freedBytes);
}

/** 给 IPC 用的精简版：只带界面需要的字段 */
function toClientGroup(g) {
  return {
    key: g.key,
    kind: g.kind,
    keeperId: g.keeperId,
    keeperReasons: g.keeperReasons,
    freedBytes: g.freedBytes,
    members: g.members.map((m) => {
      const s = scoreMember(m);
      return {
        id: m.id,
        fileName: m.fileName || '',
        title: m.title || '',
        path: m.path || '',
        size: m.size,
        createdAt: m.createdAt,
        thumbnail: m.thumbnail || null,
        printCount: Number(m.printCount) || 0,
        printStatus: m.printStatus || 'unprinted',
        note: m.note ? String(m.note).slice(0, 80) : '',
        favorite: !!m.favorite,
        score: s.score,
        reasons: s.reasons,
        variantRole: m.variantRole || null,
        variantScore: m.variantScore == null ? null : m.variantScore,
        variantScale: m.variantScale == null ? null : m.variantScale,
      };
    }),
  };
}

/**
 * 生成合并计划（纯函数，不写库）。
 * @param library  当前库
 * @param selection { [groupKey]: keepId }  每组保留哪条；没给或给错就用推荐的主记录
 * @returns {{ items, aliasIds, keepIds, groupCount, aliasCount, freedBytes }}
 */
function planMerge(library, selection) {
  const groups = new Map(buildGroups(library).map((g) => [g.key, g]));
  const items = [];
  const aliasIds = [];
  const keepIds = [];
  let freedBytes = 0;
  for (const [key, keepId] of Object.entries(selection || {})) {
    const g = groups.get(key);
    if (!g) throw new Error('这一组已经处理过了，列表将自动刷新');
    const keep = g.members.find((m) => m.id === keepId) || g.members.find((m) => m.id === g.keeperId);
    if (!keep) throw new Error('找不到要保留的那一条');
    const aliases = g.members.filter((m) => m.id !== keep.id);
    if (!aliases.length) continue;
    items.push({
      key,
      kind: g.kind,
      keepId: keep.id,
      keepPath: keep.path,
      aliases: aliases.map((a) => ({ id: a.id, path: a.path, size: Number(a.size) || 0, fileName: a.fileName || '' })),
    });
    keepIds.push(keep.id);
    for (const a of aliases) {
      aliasIds.push(a.id);
      freedBytes += Number(a.size) || 0;
    }
  }
  return { items, aliasIds, keepIds, groupCount: items.length, aliasCount: aliasIds.length, freedBytes };
}

/**
 * 把计划写进 library（在 store.updateLibrary 的 mutator 里调用）。
 * @param plan        planMerge 的返回值
 * @param outcome     null = 不动文件，只降为别名；否则是 { [aliasId]: {ok, error?} } —— 回收站结果
 */
function applyMergeInLibrary(lib, plan, outcome) {
  const now = U.now();
  const models = (lib && lib.models) || {};
  let merged = 0;
  let shadow = 0;
  let trashed = 0;
  let freedBytes = 0;
  const failed = [];
  const skipped = [];

  for (const item of plan.items) {
    const primary = models[item.keepId];
    if (!primary) { skipped.push(item.keepId); continue; }
    let touched = 0;
    for (const a of item.aliases) {
      const r = models[a.id];
      // 已经是别名的不重复处理；主记录自己不能变成别名
      if (!r || isAlias(r) || r.id === item.keepId) continue;
      if (outcome) {
        const res = outcome[a.id];
        if (!res || !res.ok) {
          failed.push({ id: a.id, path: a.path, error: (res && res.error) || '移入回收站失败' });
          continue;
        }
      }
      r.aliasOf = item.keepId;
      r.aliasAt = now;
      r.aliasState = outcome ? 'trashed' : 'shadow';
      r.updatedAt = now;
      // 分组标记交给 duplicates.annotate 重算（别名不参与分组）
      r.duplicateGroup = null;
      r.duplicateOf = null;
      r.similarGroup = null;
      if (outcome) { trashed++; freedBytes += Number(r.size) || 0; }
      else shadow++;
      touched++;
    }
    if (touched) merged++;
  }

  if (merged) duplicates.annotate(lib);
  return { merged, shadow, trashed, freedBytes, failed, skipped };
}

/** 当前库的合并概览：多少组、能释放多少 */
function summarize(library) {
  const groups = buildGroups(library);
  const out = { exact: 0, similar: 0, variant: 0, exactBytes: 0 };
  for (const g of groups) {
    out[g.kind]++;
    if (g.kind === 'exact') out.exactBytes += g.freedBytes;
  }
  return out;
}

module.exports = {
  isAlias, eligible, scoreMember, compareMembers, buildGroups, toClientGroup,
  planMerge, applyMergeInLibrary, summarize, groupKey,
};
