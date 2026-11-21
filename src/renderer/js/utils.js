'use strict';
/** 渲染层纯函数：转义、图标、格式化、DOM helper。constants.js 为 CommonJS，渲染层不可 import。 */

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 返回 sprite 图标字符串；name 可带或不带 i- 前缀 */
export function icon(name, cls = 'ico') {
  const raw = String(name == null ? '' : name);
  const id = raw.startsWith('i-') ? raw : 'i-' + raw;
  return '<svg class="' + escapeHtml(cls) + '"><use href="#' + escapeHtml(id) + '"/></svg>';
}

export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  const num = i === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return num + ' ' + units[i];
}

export function fmtDate(ts) {
  if (!ts) return '从未';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export function fmtRelative(ts) {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 0) return fmtDate(ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 7) return day + ' 天前';
  return fmtDate(ts);
}

export function debounce(fn, ms = 200) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
  };
}

export function qs(sel, root = document) {
  return root ? root.querySelector(sel) : null;
}

export function qsa(sel, root = document) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

export function clamp(n, a, b) {
  const v = Number(n);
  return Math.min(Math.max(isNaN(v) ? a : v, a), b);
}

/** 中文语境：数字 + 量词拼接，如 plural(3, '个对象') -> "3 个对象" */
export function plural(n, unit = '') {
  const v = (n == null || isNaN(n)) ? 0 : n;
  return unit ? v + ' ' + unit : String(v);
}
