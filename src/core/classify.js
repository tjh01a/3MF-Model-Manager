'use strict';
/**
 * 预设词库自动分类（见 docs/12-预设词库自动分类-调研与计划书.md）。
 *
 * 纯 Node、无 IO 依赖：匹配是同步字符串操作，扫描 worker 里可以直接调。
 * 三条硬规则：
 *   1. 只处理 categoryId 为空的记录，绝不覆盖人工分类；
 *   2. 不命中就保持未分类，不做「兜底塞进某个分类」；
 *   3. 规则顺序就是优先级，第一条命中即止。
 */
const { now } = require('./utils');

/** 关键词少于 2 个字符会被忽略：单字（刀/鱼/画）误伤太大 */
const MIN_KW_LEN = 2;

/**
 * 预设词库。categoryNames 是「可接受的分类名」的候选列表：
 * 用户可能把「唱片与音频」改成「唱片/绘画」，按名字从前往后找第一个存在的分类。
 * 匹配不到该分类时，这条规则先跳过（不报错），用户新建同名分类后可用「恢复预设」补上。
 */
const DEFAULT_RULES = [
  {
    id: 'rule_test',
    categoryNames: ['测试校准', '测试', '校准'],
    keywords: [
      '测试', '校准', '试打', '首层', '收缩率', '拼接测试', '圆底测试', '测试条',
      'benchy', 'flow', 'tolerance', 'temp tower', '温度塔', '校准块', 'test',
    ],
  },
  {
    id: 'rule_part',
    categoryNames: ['备件维修', '备件', '维修'],
    keywords: [
      '备件', '维修', '替换件', '喷嘴', '热床', '皮带', '风扇', '主板', '喷头',
      '导轨', '拖链', '刮条', '顶置安装', 'ams', 'a2l',
    ],
  },
  {
    id: 'rule_func',
    categoryNames: ['功能件', '功能', '工具'],
    keywords: [
      '支架', '收纳', '托盘', '挂钩', '卡扣', '理线', '外壳', '盒子', '架子',
      '固定件', '废料', '安装件', '改装', '配件', '铲刀', '刀架', '笔筒',
      'mount', 'holder', 'stand', 'bracket',
    ],
  },
  {
    id: 'rule_disc',
    categoryNames: ['唱片/绘画', '唱片与音频', '唱片', '绘画'],
    keywords: [
      '唱片', 'record', 'vinyl', 'disc', '黑胶', 'melody', '音频', '音乐',
      'lumina', 'ocarina', '陶笛', '版画', '绘画',
    ],
  },
  {
    id: 'rule_deco',
    categoryNames: ['摆件装饰', '摆件', '装饰'],
    keywords: [
      '手办', '模型', '雕像', '摆件', '装饰', '面具', '头盔', '刀柄', '刀刃', '刀身',
      '黑伤', '虫箭', '钥匙扣', '挂件', '生肖', '立牌', '皇冠', '高达', '机器人',
      '鹦鹉', '猫头鹰', '蜘蛛侠', '初音', '伊布', '肥鱼', '娃娃', '人像', '胸像',
      'excalibur', 'venom', '毒液', 'miku', 'bowser', '库巴', '凌波丽', '银狼',
      '炮姐', '雷米埃尔', '十二生肖', 'helmet', '徽章', '甲台', '展示台',
    ],
  },
];

/** 关键词清洗：去空、去重、转小写不在这里做（匹配时统一小写） */
function cleanKeywords(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const k = String(raw == null ? '' : raw).trim();
    if (k.length < MIN_KW_LEN) continue;
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(k);
  }
  return out;
}

/** 清洗用户存的规则：id/categoryId/keywords 三件套，非法项丢弃 */
function normalizeRules(rules) {
  const out = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || typeof r !== 'object') continue;
    const categoryId = r.categoryId ? String(r.categoryId) : '';
    if (!categoryId) continue;
    out.push({
      id: r.id ? String(r.id) : 'rule_' + out.length,
      categoryId,
      keywords: cleanKeywords(r.keywords),
    });
  }
  return out;
}

/** 按当前分类表把预设词库落成 categoryId（首次使用 / 恢复预设时调） */
function presetRules(categories) {
  const byName = new Map();
  for (const c of Array.isArray(categories) ? categories : []) {
    const n = String(c && c.name != null ? c.name : '').trim();
    if (n && !byName.has(n)) byName.set(n, c.id);
  }
  const out = [];
  for (const r of DEFAULT_RULES) {
    const names = Array.isArray(r.categoryNames) ? r.categoryNames : [];
    const hitName = names.find((n) => byName.has(n));
    if (!hitName) continue;              // 该分类不存在，这条规则先不用
    out.push({ id: r.id, categoryId: byName.get(hitName), keywords: r.keywords.slice() });
  }
  return out;
}

/** 实际生效的规则：用户存了就用用户的，没存过就用预设 */
function resolveRules(rawRules, categories) {
  const normalized = normalizeRules(rawRules);
  return normalized.length ? normalized : presetRules(categories);
}

/** 配置补齐默认值（settings.classify 可能是空对象） */
function configOf(settings) {
  const c = (settings && settings.classify) || {};
  return {
    enabled: c.enabled !== false,
    onScan: c.onScan !== false,
    onStartup: c.onStartup !== false,
    rules: Array.isArray(c.rules) ? c.rules : [],
    lastRunAt: Number(c.lastRunAt) || 0,
    lastRunStat: c.lastRunStat || null,
    promptUnmatched: c.promptUnmatched !== false,
    // 用户在「没匹配上分类」弹窗里点过「全部跳过」的模型 id。
    // 这些模型不再进 unmatched，避免每次启动反复提醒同几张卡（docs/15）。
    skippedIds: Array.isArray(c.skippedIds) ? c.skippedIds.filter((x) => typeof x === 'string') : [],
  };
}

/** 跳过上限：库才几百张卡，留足够余量的同时防止 settings.json 无限膨胀 */
const MAX_SKIPPED = 500;

/**
 * 把一批 id 并入「已跳过」名单（去重、截断、保持插入顺序）。
 * 纯函数，供 IPC 调用与单测直接使用。
 */
function mergeSkippedIds(prev, ids) {
  const cur = Array.isArray(prev) ? prev.filter((x) => typeof x === 'string') : [];
  const set = new Set(cur);
  for (const id of (Array.isArray(ids) ? ids : [])) {
    if (typeof id === 'string' && id) set.add(id);
  }
  return Array.from(set).slice(-MAX_SKIPPED);
}

/** 取路径里最后两级的目录名（跳过文件名）；盘符和用户目录太长，容易误伤 */
function dirsOf(p) {
  const parts = String(p == null ? '' : p).split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(Math.max(0, parts.length - 3), parts.length - 1).join(' ');
}

/** 可匹配文本：标题/文件名/目录/作者/备注/来源 + 3MF 内部对象名 */
function buildHaystack(rec) {
  if (!rec || typeof rec !== 'object') return '';
  const bits = [
    rec.title, rec.fileName, rec.author, rec.note, rec.sourceUrl,
    dirsOf(rec.relativePath), dirsOf(rec.path),
  ];
  const meta = rec.meta || {};
  if (Array.isArray(meta.objNames)) bits.push(meta.objNames.join(' '));
  return bits
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x))
    .join(' ')
    .toLowerCase();
}

/** 命中第一条规则就返回它的 categoryId；都没命中返回 null */
function matchCategory(rec, rules) {
  if (!rec || !Array.isArray(rules) || !rules.length) return null;
  const hay = buildHaystack(rec);
  if (!hay) return null;
  for (const r of rules) {
    if (!r || !r.categoryId) continue;
    const kws = Array.isArray(r.keywords) ? r.keywords : [];
    for (const kw of kws) {
      const k = String(kw == null ? '' : kw).trim().toLowerCase();
      if (k.length < MIN_KW_LEN) continue;
      if (hay.includes(k)) return r.categoryId;
    }
  }
  return null;
}

/**
 * 对单条记录就地分类。返回命中的 categoryId 或 null。
 * 已有 categoryId 的记录一律不动。
 */
function applyToRecord(rec, rules) {
  if (!rec || rec.categoryId) return null;
  const hit = matchCategory(rec, rules);
  if (!hit) return null;
  rec.categoryId = hit;
  rec.autoClassified = true;
  // 记住「自动分到的是哪一类」：撤销时只认仍是这条自动结果的记录，
  // 用户后来手动改过分类的不能被 undo 清掉（P1-8）。
  rec.autoCategoryId = hit;
  return hit;
}

/**
 * 批量给未分类记录分类。整批只写一次库；没有未分类时直接返回、不写盘。
 * options.force = true 时忽略总开关（设置页「立即分类」用它）。
 */
async function classifyUncategorized(store, options = {}) {
  if (!store || typeof store.getSettings !== 'function') {
    return { scanned: 0, assigned: 0, skipped: 0, pending: 0, byCategory: {}, error: 'store 不可用' };
  }
  const cfg = configOf(store.getSettings());
  if (cfg.enabled === false && options.force !== true) {
    return { scanned: 0, assigned: 0, skipped: 0, pending: 0, byCategory: {}, disabled: true };
  }
  const lib = typeof store.getLibrary === 'function' ? (store.getLibrary() || {}) : {};
  const categories = Array.isArray(lib.categories) ? lib.categories : [];
  const rules = resolveRules(cfg.rules, categories);
  // unmatched：一次都没匹配上的记录（最多 20 条），启动后由渲染层弹窗提示用户
  const stat = {
    scanned: 0, assigned: 0, skipped: 0, pending: 0,
    byCategory: {}, ranAt: 0, unmatched: [],
  };
  if (!rules.length) return Object.assign(stat, { error: '没有可用规则' });

  // 先只读统计，避免「没有未分类也写一次库」
  const models = lib.models || {};
  for (const rec of Object.values(models)) {
    stat.scanned++;
    if (rec && rec.categoryId) stat.skipped++;
    else if (rec) stat.pending++;
  }
  if (!stat.pending) {
    stat.ranAt = now();
    return stat;
  }

  // 干跑一遍：一条都匹配不上就别写库。否则库里只要留着一个永远匹配不上的
  // 未分类文件，每次启动都会白写一次 library.json。
  const liveIds = new Set(categories.map((c) => c.id));
  // docs/15：用户点「全部跳过」记下的 id 不再进弹窗。注意只过滤 unmatched
  // （提示列表），不影响真正的分类逻辑——用户之后加了关键词仍能把它们分好。
  const skipped = new Set(cfg.skippedIds);
  let wouldAssign = 0;
  for (const rec of Object.values(models)) {
    if (!rec || rec.categoryId) continue;
    const hit = matchCategory(rec, rules);
    if (hit && liveIds.has(hit)) wouldAssign++;
    else if (stat.unmatched.length < 20 && !skipped.has(rec.id)) {
      stat.unmatched.push({
        id: rec.id,
        title: rec.title || rec.fileName || rec.id,
        thumbnail: rec.thumbnail || null,
      });
    }
  }
  if (!wouldAssign) {
    stat.ranAt = now();
    return stat;
  }

  await store.updateLibrary((target) => {
    const cats = Array.isArray(target.categories) ? target.categories : [];
    const live = resolveRules(cfg.rules, cats);
    const ids = new Set(cats.map((c) => c.id));
    for (const rec of Object.values(target.models || {})) {
      if (!rec) continue;
      // 分类可能刚被删掉，命中一个不存在的 id 就不要写
      const hit = applyToRecord(rec, live);
      if (hit && ids.has(hit)) {
        stat.assigned++;
        stat.byCategory[hit] = (stat.byCategory[hit] || 0) + 1;
      } else if (hit) {
        rec.categoryId = null;
        rec.autoClassified = false;
      }
    }
  }, 'classify');

  // pending 是「本轮开始时还没分类的数量」，写库后要把这一轮分掉的扣掉，
  // 否则设置页/探针读到的 pending 会比实际剩余多。
  stat.pending = Math.max(0, stat.pending - stat.assigned);
  stat.ranAt = now();
  // 记一笔「上次跑了什么」，设置页要展示；只在真的分到东西时写，避免每次启动都写 settings
  if (stat.assigned > 0) {
    try {
      await store.updateSettings({
        classify: {
          lastRunAt: stat.ranAt,
          lastRunStat: { scanned: stat.scanned, assigned: stat.assigned, skipped: stat.skipped },
        },
      });
    } catch (_) { /* 记录失败不影响分类结果 */ }
  }
  return stat;
}

/**
 * 收集当前所有「未分类 + 一个词都没匹配上」的模型 id。
 * 弹窗只展示前 20 条，但「全部跳过」要记下全部——否则下次启动把后面没展示过的
 * 又弹出来，用户会觉得「点了全部跳过怎么还弹」。
 */
function collectUnmatchedIds(store) {
  const cfg = configOf(store && typeof store.getSettings === 'function' ? store.getSettings() : null);
  const lib = typeof store.getLibrary === 'function' ? (store.getLibrary() || {}) : {};
  const categories = Array.isArray(lib.categories) ? lib.categories : [];
  const rules = resolveRules(cfg.rules, categories);
  if (!rules.length) return [];
  const liveIds = new Set(categories.map((c) => c.id));
  const out = [];
  for (const rec of Object.values(lib.models || {})) {
    if (!rec || rec.categoryId) continue;
    const hit = matchCategory(rec, rules);
    if (!(hit && liveIds.has(hit))) out.push(rec.id);
  }
  return out;
}

/**
 * 把用户在「没匹配上」弹窗里点过「全部跳过」的模型记进设置。
 * 之后 classifyUncategorized 生成 unmatched 时会剔除这些 id，重启不再反复提醒。
 *
 * ids 是弹窗本次展示的那批（防御用）；真正记录的是 collectUnmatchedIds() 算出的
 * **全部**未匹配模型，避免弹窗 20 条截断导致下一批继续弹出。
 * @returns {Promise<{skippedIds:string[], count:number, added:number}>}
 */
async function skipUnmatched(store, ids) {
  const cfg = configOf(store && typeof store.getSettings === 'function' ? store.getSettings() : null);
  const all = collectUnmatchedIds(store);
  const before = new Set(cfg.skippedIds);
  const skippedIds = mergeSkippedIds(cfg.skippedIds, all.concat(Array.isArray(ids) ? ids : []));
  if (typeof store.updateSettings === 'function') {
    await store.updateSettings({ classify: { skippedIds } });
  }
  return {
    skippedIds,
    count: skippedIds.length,
    added: skippedIds.filter((x) => !before.has(x)).length,
  };
}

/** 撤销仍是「自动分类原结果」的分类；人工后来改过的分类一律不碰（P1-8） */
async function undoAutoClassified(store) {
  let cleared = 0;
  if (!store || typeof store.updateLibrary !== 'function') return { cleared };
  const lib = typeof store.getLibrary === 'function' ? (store.getLibrary() || {}) : {};
  const has = Object.values(lib.models || {}).some((r) => r && r.autoClassified);
  if (!has) return { cleared };
  await store.updateLibrary((target) => {
    for (const rec of Object.values(target.models || {})) {
      if (!rec || !rec.autoClassified) continue;
      // autoCategoryId 缺失的老记录按「仍是自动结果」处理；有值但已不一致说明被人工改过。
      if (rec.autoCategoryId && rec.categoryId !== rec.autoCategoryId) {
        // 人工改过就清掉自动标记，避免下次撤销再碰这条；分类本身保留。
        rec.autoClassified = false;
        delete rec.autoCategoryId;
        continue;
      }
      rec.categoryId = null;
      rec.autoClassified = false;
      delete rec.autoCategoryId;
      cleared++;
    }
  }, 'classify-undo');
  return { cleared };
}

module.exports = {
  DEFAULT_RULES,
  MIN_KW_LEN,
  cleanKeywords,
  normalizeRules,
  presetRules,
  resolveRules,
  configOf,
  MAX_SKIPPED,
  mergeSkippedIds,
  buildHaystack,
  matchCategory,
  applyToRecord,
  classifyUncategorized,
  collectUnmatchedIds,
  skipUnmatched,
  undoAutoClassified,
};
