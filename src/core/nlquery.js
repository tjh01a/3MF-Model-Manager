'use strict';
/**
 * F · 自然语言搜索（docs/22 F）。
 * 完全本地、确定性、可解释：只做词表 + 规则，不调用任何在线服务。
 * parseNL(text, { lang, now, categories, tags }) -> { query, chips, leftover, unrecognized }
 *
 * query 只包含「识别出来的条件」；leftover 是没认出来的原文，调用方回落成关键字。
 */

const MONTH = 30 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfMonth(t) { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addMonths(t, n) { const d = new Date(t); d.setMonth(d.getMonth() + n); return d.getTime(); }
function startOfWeek(t) {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  const wd = (d.getDay() + 6) % 7;          // 周一为一周起点
  d.setDate(d.getDate() - wd);
  return d.getTime();
}
function endOfDay(t) { return startOfDay(t) + DAY - 1; }

const COLOR_WORDS = [
  { words: ['红色', '红', 'red'], h: 0, tol: 22 },
  { words: ['橙色', '橙', 'orange'], h: 30, tol: 18 },
  { words: ['黄色', '黄', 'yellow'], h: 55, tol: 18 },
  { words: ['绿色', '绿', 'green'], h: 120, tol: 30 },
  { words: ['青色', '青', 'cyan', 'teal'], h: 180, tol: 22 },
  { words: ['深蓝', 'navy'], h: 230, tol: 15 },
  { words: ['天蓝', 'sky blue'], h: 200, tol: 15 },
  { words: ['蓝色', '蓝', 'blue'], h: 220, tol: 28 },
  { words: ['紫色', '紫', 'purple', 'violet'], h: 280, tol: 30 },
  { words: ['粉色', '粉', 'pink'], h: 335, tol: 18 },
  { words: ['棕色', '棕', 'brown'], h: 25, tol: 12 },
  { words: ['金色', '金', 'gold'], h: 45, tol: 10 },
  { words: ['银色', '银', 'silver'], h: 210, tol: 10 },
];
const OBJ_WORDS = [
  '收纳盒', '收纳', '支架', '摆件', '手办', '测试件', '花瓶', '笔筒', '挂钩', '底座', '外壳', '钥匙扣', '灯罩', '模型',
  'holder', 'box', 'stand', 'figure', 'benchy', 'vase', 'planter', 'hook', 'case', 'model', 'print',
];
const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PVA'];

function hueOfHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return null;                 // 灰/黑/白没有色相
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function normalizeText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function matchesWord(text, w) {
  if (!w) return false;
  if (/^[a-z ]+$/i.test(w)) {
    const re = new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
    return re.test(text);
  }
  return text.includes(w);
}

/** 从文本里吃掉一个词，返回剩余文本；用于 leftover 计算 */
function eat(text, w) {
  if (!w) return text;
  try {
    if (/^[a-z ]+$/i.test(w)) return text.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    return text.split(w).join(' ');
  } catch (_) { return text; }
}

function parseNL(input, opts) {
  const o = opts || {};
  const now = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now();
  const raw = normalizeText(input);
  let text = raw;
  const query = {};
  const chips = [];

  const add = (key, label, value) => {
    query[key] = value;
    chips.push({ type: key, label });
  };

  // ---- 时间（打印 / 入库） ----
  const timeRules = [
    { re: /上个月|last month/i, from: startOfMonth(addMonths(now, -1)), to: startOfMonth(now) - 1, label: '上个月', field: 'printed' },
    { re: /本月|这个月|this month/i, from: startOfMonth(now), to: now, label: '本月', field: 'printed' },
    { re: /上周|上个星期|last week/i, from: startOfWeek(now) - 7 * DAY, to: startOfWeek(now) - 1, label: '上周', field: 'printed' },
    { re: /本周|这周|this week/i, from: startOfWeek(now), to: now, label: '本周', field: 'printed' },
    { re: /最近\s*7\s*天|最近一周|past 7 days|last 7 days/i, from: now - 7 * DAY, to: now, label: '最近 7 天', field: 'printed' },
    { re: /最近\s*30\s*天|最近一个月|past 30 days|last 30 days/i, from: now - 30 * DAY, to: now, label: '最近 30 天', field: 'printed' },
    { re: /今年|this year/i, from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: now, label: '今年', field: 'printed' },
    { re: /去年|last year/i, from: new Date(new Date(now).getFullYear() - 1, 0, 1).getTime(), to: new Date(new Date(now).getFullYear() - 1, 11, 31, 23, 59, 59, 999).getTime(), label: '去年', field: 'printed' },
    { re: /最近添加的|最近入库|recently added/i, from: now - 7 * DAY, to: now, label: '最近添加', field: 'created' },
  ];
  for (const r of timeRules) {
    if (!r.re.test(text)) continue;
    text = text.replace(r.re, ' ');
    if (r.field === 'printed') {
      add('printedFrom', '打印时间：' + r.label, r.from);
      query.printedTo = r.to;
      chips.push({ type: 'printedTo', label: '至 ' + new Date(r.to).toLocaleDateString() });
    } else {
      add('createdFrom', '入库：' + r.label, r.from);
      query.createdTo = r.to;
      chips.push({ type: 'createdTo', label: '至 ' + new Date(r.to).toLocaleDateString() });
    }
  }

  // ---- 打印状态 ----
  if (/没有打印过|没有打印|没打印过|没打印|未打印|unprinted|not printed/i.test(text)) {
    text = text.replace(/没有打印过|没有打印|没打印过|没打印|未打印|unprinted|not printed/ig, ' ');
    add('printStatuses', '未打印', ['unprinted']);
  } else if (/打印过的|打印过|已打印|printed/i.test(text)) {
    text = text.replace(/打印过的|打印过|已打印|printed/ig, ' ');
    add('printStatuses', '已打印', ['printed']);
  }

  // ---- 收藏 / 评分 ----
  if (/收藏|favorite|favourites|favorites/i.test(text)) {
    text = text.replace(/收藏|favorite|favourites|favorites/ig, ' ');
    add('favoritesOnly', '已收藏', true);
  }
  const stars = /([一二三四五1-5])\s*(?:星|stars?)/i.exec(text);
  if (stars) {
    text = text.replace(stars[0], ' ');
    const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }[stars[1]] || Number(stars[1]);
    add('ratingMin', '评分 ≥ ' + cn, Math.min(5, cn));
  }

  // ---- 材质 ----
  for (const m of MATERIALS) {
    if (new RegExp('\\b' + m + '\\b', 'i').test(text)) {
      text = text.replace(new RegExp('\\b' + m + '\\b', 'ig'), ' ');
      add('filamentTypes', '材质：' + m, [m]);
      break;
    }
  }

  // ---- 颜色数量 ----
  const cnColorCount = /(单色|双色|两色|三色|四色|五色|多色)/.exec(text);
  const enColorCount = /(\d+)\s*(?:colors?|colour)/i.exec(text);
  if (cnColorCount || enColorCount) {
    const map = { 单色: 1, 双色: 2, 两色: 2, 三色: 3, 四色: 4, 五色: 5, 多色: 2 };
    const n = enColorCount ? Number(enColorCount[1]) : map[cnColorCount[1]];
    text = text.replace((cnColorCount || enColorCount)[0], ' ');
    if (n >= 2) add('minColors', n + ' 色以上', n);
    else add('colorsCount', '单色', 1);
  }

  // ---- 文件大小 ----
  const sizeRe = /(?:大于|大于等于|超过|bigger than|larger than|more than|大于)\s*(\d+(?:\.\d+)?)\s*(mb|gb|兆|吉)?|(\d+(?:\.\d+)?)\s*(mb|gb|兆|吉)\s*(?:以上|以上|以上)/i;
  const sizeM = sizeRe.exec(text);
  if (sizeM) {
    const n = Number(sizeM[1] || sizeM[3]);
    const unit = String(sizeM[2] || sizeM[4] || 'mb').toLowerCase();
    if (Number.isFinite(n) && n > 0) {
      const bytes = n * (/gb|吉/.test(unit) ? 1024 : 1) * 1024 * 1024;
      text = text.replace(sizeM[0], ' ');
      add('sizeMin', '大于 ' + n + ' MB', bytes);
    }
  }
  const sizeLt = /(?:小于|小于等于|不到|smaller than|less than)\s*(\d+(?:\.\d+)?)\s*(mb|gb|兆|吉)?/i.exec(text);
  if (sizeLt) {
    const n = Number(sizeLt[1]);
    const unit = String(sizeLt[2] || 'mb').toLowerCase();
    if (Number.isFinite(n) && n > 0) {
      text = text.replace(sizeLt[0], ' ');
      add('sizeMax', '小于 ' + n + ' MB', n * (/gb|吉/.test(unit) ? 1024 : 1) * 1024 * 1024);
    }
  }

  // ---- 理工视图 ----
  if (/有重复的|重复的|duplicates?/i.test(text)) {
    text = text.replace(/有重复的|重复的|duplicates?/ig, ' ');
    add('smart', '重复文件', 'duplicates');
  } else if (/失效的|找不到的|missing/i.test(text)) {
    text = text.replace(/失效的|找不到的|missing/ig, ' ');
    add('smart', '失效文件', 'missing');
  }

  // ---- 颜色 ----
  for (const c of COLOR_WORDS) {
    const hit = c.words.find((w) => matchesWord(text, w));
    if (!hit) continue;
    text = eat(text, hit);
    const arr = query.colorHues || [];
    arr.push({ h: c.h, tol: c.tol });
    query.colorHues = arr;
    chips.push({ type: 'colorHues', label: '颜色：' + hit });
    break;
  }

  // ---- 分类 / 标签（按名称模糊匹配） ----
  const cats = Array.isArray(o.categories) ? o.categories : [];
  for (const c of cats) {
    const name = String((c && c.name) || '').trim();
    if (!name || name.length < 2) continue;
    if (!text.includes(name)) continue;
    text = text.split(name).join(' ');
    add('categoryId', '分类：' + name, c.id);
    break;
  }
  const tags = Array.isArray(o.tags) ? o.tags : [];
  for (const g of tags) {
    const name = String((g && g.name) || '').trim();
    if (!name || name.length < 2) continue;
    // 中文没有词边界：要求整词命中（空格/标点分隔）或显式「标签 XX」，避免「测试」吃掉「测试件」
    const tokens = text.split(/[\s，,。、;；:：]+/);
    const tagged = new RegExp('标签[：:]?\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|tagged\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
    if (!tagged && !tokens.includes(name)) continue;
    text = text.split(name).join(' ');
    add('tagIds', '标签：' + name, [g.id]);
    break;
  }

  // ---- 作者 ----
  const authorM = /作者(?:是)?[：:]?\s*([^\s，,。的]+)|by\s+([a-z0-9_\-.]{2,})/i.exec(text);
  if (authorM) {
    const name = (authorM[1] || authorM[2] || '').trim();
    if (name) {
      text = text.replace(authorM[0], ' ');
      add('author', '作者：' + name, name);
    }
  }

  // ---- 物料类词（复用自动分类词库的常见词） ----
  const kwWords = OBJ_WORDS.filter((w) => matchesWord(text, w));
  if (kwWords.length) {
    for (const w of kwWords) text = eat(text, w);
    const kw = kwWords.join(' ').trim();
    add('keyword', '关键词：' + kw, kw);
  }

  // ---- 剩余文本：没认出来的回落为关键字 ----
  const leftover = text.replace(/[，。、,.;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    query,
    chips,
    leftover,
    used: chips.length > 0,
    text: raw,
  };
}

module.exports = { parseNL, hueOfHex, COLOR_WORDS, OBJ_WORDS, MATERIALS, startOfDay, startOfWeek, startOfMonth };
