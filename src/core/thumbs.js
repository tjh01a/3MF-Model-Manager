'use strict';
/**
 * 缩略图服务（契约 C-1）。纯 Node 实现，禁止 require('electron')。
 * 缓存目录由 paths.getThumbsDir() 决定，启动时确保存在。
 * 缓存文件名：sha1(pathKey(record.path)).slice(0,24) + 扩展名(.png/.jpg/.svg)。
 * 内嵌图保留原始字节不转码；无内嵌图或解析失败时生成自包含占位 SVG。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paths = require('./paths');
const utils = require('./utils');

// model3mf 由并行子代理实现，按契约导出 parse3mf / readThumbnail 等。
// 采用惰性 require：对方文件尚未落地时，本模块仍可被加载（解析降级为占位图）。
let _model3mf = null;
function model3mf() {
  if (!_model3mf) {
    try {
      _model3mf = require('./model3mf');
    } catch (e) {
      throw new Error('模型解析模块不可用（model3mf）：' + (e && e.message ? e.message : String(e)));
    }
  }
  return _model3mf;
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[c]);
}

/** HSL -> #rrggbb，用于按哈希生成确定性的柔和渐变色 */
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
}

/** 取模型显示名首字；取不到回退 "3MF" */
function firstGlyph(record) {
  const s = String((record && (record.title || record.fileName)) || '').trim();
  const ch = s ? Array.from(s)[0] : '';
  return ch ? ch.toUpperCase() : '3MF';
}

/** 由内嵌条目名 / mime 决定缓存扩展名：统一为 .png 或 .jpg，不转码 */
function extFor(thumbnail) {
  const ext = path.extname(String((thumbnail && thumbnail.entry) || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return '.jpg';
  if (ext === '.png') return '.png';
  const mime = String((thumbnail && thumbnail.mime) || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.png';
}

/** 原子写：先写同目录 tmp，再 rename 覆盖目标（兼容 Windows 覆盖场景） */
async function atomicWrite(target, data) {
  const tmp = target + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  try {
    await fsp.writeFile(tmp, data);
    try {
      await fsp.rename(tmp, target);
    } catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
        try { await fsp.unlink(target); } catch (_) { /* 目标不存在则忽略 */ }
        await fsp.rename(tmp, target);
      } else {
        throw e;
      }
    }
  } catch (e) {
    try { await fsp.unlink(tmp); } catch (_) { /* 清理残留 tmp */ }
    throw e;
  }
}

/** 生成漂亮且自包含的占位 SVG：渐变底 + 光晕 + 立方体线稿 + 首字/3MF */
function buildPlaceholderSvg(record, hashHex) {
  const hue = (parseInt(hashHex.slice(0, 8), 16) || 0) % 360;
  const c1 = hslToHex(hue, 18, 95);
  const c2 = hslToHex((hue + 24) % 360, 22, 86);
  const label = firstGlyph(record);
  const glyph = xmlEscape(label);
  const sub = label === '3MF' ? '' :
    '  <text x="160" y="230" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#94a3b8" letter-spacing="4">3MF</text>\n';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" role="img" aria-label="3MF 模型占位图">',
    '  <defs>',
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '      <stop offset="0" stop-color="' + c1 + '"/>',
    '      <stop offset="1" stop-color="' + c2 + '"/>',
    '    </linearGradient>',
    '    <radialGradient id="glow" cx="0.5" cy="0.34" r="0.72">',
    '      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>',
    '      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>',
    '    </radialGradient>',
    '  </defs>',
    '  <rect width="320" height="240" fill="url(#bg)"/>',
    '  <rect width="320" height="240" fill="url(#glow)"/>',
    '  <g fill="none" stroke="#64748b" stroke-opacity="0.72" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">',
    '    <polygon points="160,55 212,85 160,115 108,85" fill="#ffffff" fill-opacity="0.22"/>',
    '    <polygon points="108,85 160,115 160,175 108,145" fill="#000000" fill-opacity="0.045"/>',
    '    <polygon points="212,85 160,115 160,175 212,145" fill="#000000" fill-opacity="0.09"/>',
    '  </g>',
    '  <text x="160" y="212" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="600" fill="#475569" letter-spacing="1">' + glyph + '</text>',
    sub + '</svg>',
    '',
  ].join('\n');
}

class ThumbnailService {
  constructor({ store } = {}) {
    this.store = store || null;
    this.thumbsDir = paths.getThumbsDir();
    try {
      fs.mkdirSync(this.thumbsDir, { recursive: true });
    } catch (e) {
      console.warn('无法创建缩略图缓存目录：' + this.thumbsDir + ' · ' + (e && e.message ? e.message : String(e)));
    }
  }

  getPath(fileName) {
    return path.join(this.thumbsDir, path.basename(String(fileName || '')));
  }

  /** 缩略图是否还跟得上源文件：缩略图的 mtime 不早于源文件即视为新鲜 */
  _isThumbFresh(record) {
    try {
      const src = fs.statSync(record.path).mtimeMs;
      const th = fs.statSync(this.getPath(record.thumbnail)).mtimeMs;
      return th >= src - 1000;          // 容忍文件系统时间精度
    } catch (_) {
      return false;                      // 拿不到时间就当作过期，重抽一次更安全
    }
  }

  exists(fileName) {
    if (!fileName) return false;
    try {
      return fs.statSync(this.getPath(fileName)).isFile();
    } catch (_) {
      return false;
    }
  }

  /**
   * 确保 record 有可用缩略图，返回缓存文件名；异常一律吞掉并返回 null，保证扫描不中断。
   * @param {Object} record ModelRecord
   * @param {{force?:Boolean, parseResult?:Object|null}} opts parseResult 由 scanner 传入以避免二次解压
   * @returns {Promise<String|null>}
   */
  async ensureFor(record, { force = false, parseResult = null } = {}) {
    try {
      if (!record || !record.path) {
        console.warn('缩略图生成跳过：记录缺少 path 字段');
        return null;
      }
      // 二次启动不重复抽取的关键：已有缓存且非强制，直接复用。
      // 判断「缓存是否过期」用文件时间戳比对：源文件比缩略图新，就说明内容换过了，
      // 必须重抽 —— 否则替换过的模型会一直显示上一版的预览图。
      // （不用记录里的字段，避免给 library.json 加新字段、也避免升级后全量重抽。）
      const freshThumb = this._isThumbFresh(record);
      if (!force && record.thumbnail && this.exists(record.thumbnail) && freshThumb) {
        return record.thumbnail;
      }
      // 源文件不存在 / 不可读：不抛给调用方
      if (!fs.existsSync(record.path)) {
        console.warn('源文件不存在，跳过缩略图生成：' + record.path);
        return null;
      }

      const hashHex = utils.sha1(utils.pathKey(record.path)).slice(0, 24);

      let pr = parseResult;
      if (!pr) {
        try {
          pr = await model3mf().parse3mf(record.path, { withThumbnail: true, withMeta: false });
        } catch (e) {
          // 解析失败（含解析模块暂不可用）降级为占位图，而非中断调用方
          console.warn('解析 3MF 失败，改用占位图：' + record.path + ' · ' + (e && e.message ? e.message : String(e)));
          pr = null;
        }
      }

      const thumb = pr && pr.ok !== false ? pr.thumbnail : null;
      const data = thumb && thumb.data;
      if (data && data.length > 0) {
        const fileName = hashHex + extFor(thumb);
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        await atomicWrite(this.getPath(fileName), buf);
        return fileName;
      }

      // 无内嵌图 / 解析失败：生成占位 SVG
      const fileName = hashHex + '.svg';
      await atomicWrite(this.getPath(fileName), Buffer.from(buildPlaceholderSvg(record, hashHex), 'utf8'));
      return fileName;
    } catch (e) {
      // 文件无权限、写盘失败等：不抛给调用方，保证扫描循环继续
      console.warn('生成缩略图失败：' + (record && record.path ? record.path : '未知记录') +
        ' · ' + (e && e.message ? e.message : String(e)));
      return null;
    }
  }

  /**
   * 批量重生成，并把新的 thumbnail 文件名一次性写回记录（单次 updateLibrary）。
   * @returns {Promise<{done:Number, failed:Number}>}
   */
  async regenerate(ids, { force = true } = {}) {
    let done = 0;
    let failed = 0;
    const list = Array.isArray(ids) ? ids : [];
    const lib = this.store && typeof this.store.getLibrary === 'function' ? this.store.getLibrary() : null;
    const models = (lib && lib.models) || {};
    const updates = [];

    for (const id of list) {
      const rec = models[id];
      if (!rec) { failed++; continue; }
      let name = null;
      try {
        name = await this.ensureFor(rec, { force });
      } catch (_) {
        name = null; // ensureFor 已保证不抛，双保险
      }
      if (name) {
        done++;
        updates.push({ id, name });
      } else {
        failed++;
      }
    }

    // 一次批量写，避免逐条落盘
    if (updates.length && this.store && typeof this.store.updateLibrary === 'function') {
      try {
        await this.store.updateLibrary((l) => {
          const ms = l && l.models ? l.models : {};
          for (const u of updates) {
            if (ms[u.id]) ms[u.id].thumbnail = u.name;
          }
        });
      } catch (e) {
        console.warn('批量写回缩略图文件名失败：' + (e && e.message ? e.message : String(e)));
        failed += updates.length;
        done -= updates.length;
      }
    }
    return { done, failed };
  }

  /** 删除不被任何 model.thumbnail 引用的缓存文件；不删除目录本身 */
  async prune() {
    let removed = 0;
    const refs = new Set();
    try {
      const lib = this.store && typeof this.store.getLibrary === 'function' ? this.store.getLibrary() : null;
      const models = (lib && lib.models) || {};
      for (const m of Object.values(models)) {
        if (m && m.thumbnail) refs.add(String(m.thumbnail));
      }
      const entries = await fsp.readdir(this.thumbsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue; // 跳过目录
        if (refs.has(ent.name)) continue;
        try {
          await fsp.unlink(path.join(this.thumbsDir, ent.name));
          removed++;
        } catch (e) {
          console.warn('删除孤立缩略图失败：' + ent.name + ' · ' + (e && e.message ? e.message : String(e)));
        }
      }
    } catch (e) {
      console.warn('清理缩略图缓存失败：' + (e && e.message ? e.message : String(e)));
    }
    return { removed };
  }

  /** 统计缓存文件数与总字节数（同步） */
  stats() {
    let count = 0;
    let bytes = 0;
    try {
      const entries = fs.readdirSync(this.thumbsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        try {
          bytes += fs.statSync(path.join(this.thumbsDir, ent.name)).size;
          count++;
        } catch (_) { /* 文件在统计间被移除 */ }
      }
    } catch (_) { /* 缓存目录不存在 */ }
    return { count, bytes };
  }
}

// 兼容两种引用方式：解构 { ThumbnailService } 与直接 require 得到 class
module.exports = ThumbnailService;
module.exports.ThumbnailService = ThumbnailService;
