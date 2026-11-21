'use strict';
/** 与业务无关的通用工具。纯 Node，无 Electron 依赖。 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha1(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}
function sha1Buffer(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

function hashFile(filePath, { algo = 'sha1' } = {}) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (c) => h.update(c));
    stream.on('end', () => resolve(h.digest('hex')));
    stream.on('error', (e) => reject(new Error('读取文件失败：' + filePath + ' · ' + e.message)));
  });
}

function now() { return Date.now(); }

function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

/** 统一为 Windows/Unix 可比较的绝对路径 */
function normalizePath(p) {
  if (!p) return '';
  let s = path.resolve(String(p).replace(/^file:\/\//i, ''));
  s = s.replace(/[\\/]+/g, path.sep);
  // 去掉尾部斜杠（根目录除外）
  if (s.length > 3 && s.endsWith(path.sep)) s = s.slice(0, -1);
  return s;
}

/** 生成稳定 id 用的键；Windows 大小写不敏感 */
function pathKey(p) {
  const n = normalizePath(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function safeFileName(name) {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180);
  return s || '未命名';
}

function baseName(p) { return path.basename(String(p), path.extname(String(p))); }
function extName(p) { return path.extname(String(p)).toLowerCase(); }

/** 归一化文件名，用于"疑似重复"判定 */
function similarNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.(3mf|stl|obj)$/i, '')
    .replace(/[\s_\-.]+/g, '')
    .replace(/[（(【\[]?\s*(副本|copy|复制|\d+)\s*[)）】\]]?$/gi, '')
    .replace(/[_-]?v?\d{1,3}$/i, '')
    .replace(/_?\d{8,}$/g, '');
}

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function clamp(n, min, max) { return Math.min(max, Math.max(min, Number(n) || 0)); }

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1, x = v;
  do { x /= 1024; i++; } while (x >= 1024 && i < units.length - 1);
  return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + ' ' + units[i];
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatRelative(ts) {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 0) return formatDate(ts);
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
  if (diff < 2 * 86400e3) return '昨天';
  if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
  return formatDate(ts);
}

function debounce(fn, ms = 200) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function withTimeout(promise, ms = 15000, label = '操作') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/** 简易并发限流器 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = { ok: true, value: await worker(items[i], i) }; }
      catch (e) { results[i] = { ok: false, error: e }; }
    }
  }));
  return results;
}

module.exports = {
  sha1, sha1Buffer, hashFile, now, uid, normalizePath, pathKey,
  safeFileName, baseName, extName, similarNameKey, escapeRegExp, clamp,
  formatBytes, formatDate, formatRelative, debounce, withTimeout, mapLimit,
};
