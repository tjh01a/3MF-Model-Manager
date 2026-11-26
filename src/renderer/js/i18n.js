'use strict';
/**
 * 渲染层国际化（docs/21）。
 *
 * 约定：
 *  - 源码里的「中文原文」就是 key：t('未打印')。新增界面文案先写中文，
 *    再把英文补进 src/renderer/locales/en-US.js；没补之前英文界面会显示原文，
 *    但绝不会报错或白屏。
 *  - 静态 HTML 用 data-i18n / data-i18n-title / data-i18n-placeholder /
 *    data-i18n-aria 标记；applyStaticI18n() 在语言切换后重新应用一遍。
 *  - 主进程抛回来的错误文案可能拼了路径、数字等动态内容，精确 key 命中不了；
 *    t() 会用「短语词典」按长度从长到短替换其中的中文片段，保住路径和数字。
 *  - 只翻译明确经过 t() 的文本；模型标题、标签、备注等用户数据绝不自动改写。
 */
import zh from '../locales/zh-CN.js';
import en from '../locales/en-US.js';

const ZH = 'zh-CN';
const EN = 'en-US';
const STORAGE_KEY = 'printshelf-language';

function storedLanguage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_KEY);
    return v === EN || v === ZH ? v : null;
  } catch (_) { return null; }
}

// 模块求值时就生效：菜单/预设等模块顶层的 tr('原文') 需要用正确语言初始化。
// 后端 settings 是权威来源，bootstrap 里再校准一次；localStorage 只负责首帧不闪中文。
let lang = storedLanguage() || ZH;
if (typeof document !== 'undefined' && document.documentElement) {
  // 静态 HTML 写死 zh-CN；-English 用户重载后必须在模块求值时就纠正，
  // 否则 assistive tech 会按中文朗读界面。
  document.documentElement.lang = lang;
  document.documentElement.dataset.language = lang;
}

const listeners = new Set();
const missing = new Set();
const phraseCache = new Map();
let phraseTable = null;

export function getLanguage() { return lang; }
export function isEnglish() { return lang === EN; }
export function supportedLanguages() { return [ZH, EN]; }

export function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 只接受受支持的语言码，未知值回中文，避免脏设置把界面变成半英文。 */
export function setLanguage(next) {
  const value = next === EN ? EN : ZH;
  const changed = value !== lang;
  lang = value;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value); } catch (_) { /* 隐私模式忽略 */ }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = value;
    document.documentElement.dataset.language = value;
  }
  if (changed) {
    applyStaticI18n();
    for (const fn of Array.from(listeners)) {
      try { fn(value); } catch (e) { console.error('[i18n] 语言切换回调异常', e); }
    }
  }
  return lang;
}

/** 精确短语表：只收纯文本短语，HTML 片段和代码不参与兜底替换。 */
function getPhraseTable() {
  if (phraseTable) return phraseTable;
  const items = [];
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== 'string' || !v) continue;
    if (!/[\u3400-\u9fff]/.test(k)) continue;   // 语义 key 不参与
    if (k.length > 140 || k.length < 2) continue;
    if (/[<>{}$\\`]/.test(k)) continue;         // 模板/HTML/代码不参与
    items.push([k, v]);
  }
  items.sort((a, b) => b[0].length - a[0].length);
  phraseTable = items;
  return phraseTable;
}

function phraseTranslate(text) {
  if (!/[\u3400-\u9fff]/.test(text)) return text;
  if (phraseCache.has(text)) return phraseCache.get(text);
  let out = text;
  for (const [from, to] of getPhraseTable()) {
    if (out.indexOf(from) < 0) continue;
    out = out.split(from).join(to);
  }
  phraseCache.set(text, out);
  return out;
}

function interpolate(text, params) {
  if (!params || typeof params !== 'object') return text;
  return text.replace(/\{(\w+)\}/g, (m, key) =>
    (params[key] == null ? m : String(params[key])));
}

/**
 * 翻译一段 UI 文案。
 * @param {string} key 中文原文，或语义 key（如 language.label）
 * @param {object} [params] {name} 占位符参数
 */
export function t(key, params) {
  const raw = key == null ? '' : String(key);
  if (!raw) return raw;
  let out = raw;
  if (lang === ZH) {
    const zhHit = zh[raw];
    out = typeof zhHit === 'string' ? zhHit : raw;
  } else {
    let hit = en[raw];
    if (hit == null) {
      // 语义 key 先走中文包，再查英文包
      const zhHit = zh[raw];
      if (typeof zhHit === 'string') hit = en[zhHit];
    }
    if (typeof hit === 'string') out = hit;
    else {
      if (typeof key === 'string' && !/[\u3400-\u9fff]/.test(key)) missing.add(key);
      out = phraseTranslate(raw);
    }
  }
  return interpolate(out, params);
}

/** 开发诊断：当前语言包缺失的语义 key / 未翻译原文。 */
export function missingKeys() { return Array.from(missing).sort(); }

/** 给 static HTML 节点打的语言标记。自变量就是节点上的原始中文。 */
const ATTRS = [
  ['data-i18n', 'textContent'],
  ['data-i18n-title', 'title'],
  ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-aria', 'aria-label'],
];

export function applyStaticI18n(root) {
  const scope = root && root.querySelectorAll ? root : (typeof document !== 'undefined' ? document : null);
  if (!scope) return;
  for (const [attr, prop] of ATTRS) {
    const nodes = scope.querySelectorAll('[' + attr + ']');
    for (const node of nodes) {
      const key = node.getAttribute(attr);
      if (key == null) continue;
      if (prop === 'textContent') node.textContent = t(key);
      else node.setAttribute(prop, t(key));
    }
  }
}

/** 当前 MakerWorld 站点：auto 跟随界面语言，zh → cn，en → global。 */
export function makerWorldRegionOf(settings) {
  const raw = (settings && settings.ui && settings.ui.makerWorldRegion) || 'auto';
  if (raw === 'cn' || raw === 'global') return raw;
  return lang === EN ? 'global' : 'cn';
}
