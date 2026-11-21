'use strict';
/**
 * 耗材库服务（13 · 耗材库与成本账本）。纯 Node，禁止 require('electron')。
 *
 * 数据：data/filaments.json（用户确认不进 library 备份机制）
 * 图片：data/filament-img/<sha1(内容).slice(0,24)>.<ext>，shelf://filaments/<file> 引用
 *
 * 关键约定：
 *  - 图片按内容哈希命名：换图 = 换文件名，否则 immutable 缓存会让浏览器一直显示旧图。
 *  - 颜色写库前一律归一为 /^#[0-9a-fA-F]{6}$/，否则置 null（防外部 JSON 注入 CSS）。
 *  - 单价统一 元/kg，>=0；0 视为未知。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const paths = require('./paths');
const U = require('./utils');

const HEX = /^#[0-9a-fA-F]{6}$/;
const TYPES = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PVA', '支撑', '其他'];
const BRANDS = ['Bambu 拓竹', 'eSUN 易生', 'Snapmaker 快造', 'Creality 创想三维', 'Polymaker', 'Anycubic', '其他 / 自定义'];

/**
 * 预设名字库：只放主流品牌（用户 2026-11-16 确认）。
 * 来源：拓竹官方耗材指南 41 系列 + eSUN 官网常见系列 + 本机切片软件高频预设。
 * 单价留空（0），由用户自己填——不联网抓价格（明确不做）。
 */
const PRESETS = [
  // Bambu 拓竹（官方耗材指南）
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Basic', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Matte', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Pure', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Translucent', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Tough+', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Silk / Silk+', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Wood', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Glow', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Metal', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Sparkle', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Marble', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Galaxy', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA-CF', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Aero', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PLA Lite', type: 'PLA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PETG Basic', type: 'PETG' },
  { brand: 'Bambu 拓竹', name: 'Bambu PETG HF', type: 'PETG' },
  { brand: 'Bambu 拓竹', name: 'Bambu PETG Translucent', type: 'PETG' },
  { brand: 'Bambu 拓竹', name: 'Bambu PETG-CF', type: 'PETG' },
  { brand: 'Bambu 拓竹', name: 'Bambu ABS', type: 'ABS' },
  { brand: 'Bambu 拓竹', name: 'Bambu ABS-GF', type: 'ABS' },
  { brand: 'Bambu 拓竹', name: 'Bambu ASA', type: 'ASA' },
  { brand: 'Bambu 拓竹', name: 'Bambu ASA Aero', type: 'ASA' },
  { brand: 'Bambu 拓竹', name: 'Bambu ASA-CF', type: 'ASA' },
  { brand: 'Bambu 拓竹', name: 'Bambu TPU for AMS', type: 'TPU' },
  { brand: 'Bambu 拓竹', name: 'Bambu TPU 95A HF', type: 'TPU' },
  { brand: 'Bambu 拓竹', name: 'Bambu TPU 90A', type: 'TPU' },
  { brand: 'Bambu 拓竹', name: 'Bambu TPU 85A', type: 'TPU' },
  { brand: 'Bambu 拓竹', name: 'Bambu PC', type: 'PC' },
  { brand: 'Bambu 拓竹', name: 'Bambu PC FR', type: 'PC' },
  { brand: 'Bambu 拓竹', name: 'Bambu PA6-CF', type: 'PA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PA6-GF', type: 'PA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PAHT-CF', type: 'PA' },
  { brand: 'Bambu 拓竹', name: 'Bambu PVA', type: 'PVA' },
  { brand: 'Bambu 拓竹', name: 'Bambu Support for PLA', type: '支撑' },
  { brand: 'Bambu 拓竹', name: 'Bambu Support for PLA/PETG', type: '支撑' },
  { brand: 'Bambu 拓竹', name: 'Bambu Support for ABS', type: '支撑' },
  // eSUN 易生
  { brand: 'eSUN 易生', name: 'eSUN PLA-Basic', type: 'PLA' },
  { brand: 'eSUN 易生', name: 'eSUN PLA+', type: 'PLA' },
  { brand: 'eSUN 易生', name: 'eSUN PLA-HF', type: 'PLA' },
  { brand: 'eSUN 易生', name: 'eSUN PLA-Matte', type: 'PLA' },
  { brand: 'eSUN 易生', name: 'eSUN PLA-Silk', type: 'PLA' },
  { brand: 'eSUN 易生', name: 'eSUN PETG+', type: 'PETG' },
  { brand: 'eSUN 易生', name: 'eSUN PETG-Matte', type: 'PETG' },
  { brand: 'eSUN 易生', name: 'eSUN ABS+', type: 'ABS' },
  { brand: 'eSUN 易生', name: 'eSUN TPU 95A', type: 'TPU' },
  // 快造 / 创想 / Polymaker / Anycubic（本机预设中的主流名字）
  { brand: 'Snapmaker 快造', name: 'Snapmaker PLA', type: 'PLA' },
  { brand: 'Snapmaker 快造', name: 'Snapmaker PETG', type: 'PETG' },
  { brand: 'Snapmaker 快造', name: 'Snapmaker ABS', type: 'ABS' },
  { brand: 'Snapmaker 快造', name: 'Snapmaker TPU', type: 'TPU' },
  { brand: 'Creality 创想三维', name: 'Creality Ender PLA', type: 'PLA' },
  { brand: 'Creality 创想三维', name: 'Creality Hyper PLA', type: 'PLA' },
  { brand: 'Creality 创想三维', name: 'Creality PETG', type: 'PETG' },
  { brand: 'Creality 创想三维', name: 'Creality CR-PETG', type: 'PETG' },
  { brand: 'Polymaker', name: 'Polymaker PolyLite PLA', type: 'PLA' },
  { brand: 'Polymaker', name: 'Polymaker PolyTerra PLA', type: 'PLA' },
  { brand: 'Polymaker', name: 'Polymaker PolyLite PETG', type: 'PETG' },
  { brand: 'Polymaker', name: 'Polymaker PolyMax PLA', type: 'PLA' },
  { brand: 'Anycubic', name: 'Anycubic PLA', type: 'PLA' },
  { brand: 'Anycubic', name: 'Anycubic PLA Matte', type: 'PLA' },
  { brand: 'Anycubic', name: 'Anycubic PETG', type: 'PETG' },
  { brand: 'Anycubic', name: 'Anycubic TPU', type: 'TPU' },
];

function emptyData() {
  return { schemaVersion: 1, updatedAt: Date.now(), items: {} };
}

function normalizeColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  return HEX.test(s) ? s.toLowerCase() : null;
}

function normalizePrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function safeName(s) {
  return String(s == null ? '' : s).trim().slice(0, 120);
}

function newId() {
  return 'fil-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

async function atomicWrite(target, data) {
  const tmp = target + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  try {
    await fsp.writeFile(tmp, data);
    try { await fsp.rename(tmp, target); }
    catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
        try { await fsp.unlink(target); } catch (_) { /* 目标不存在 */ }
        await fsp.rename(tmp, target);
      } else throw e;
    }
  } catch (e) {
    try { await fsp.unlink(tmp); } catch (_) { /* 清理 */ }
    throw e;
  }
}

class FilamentService {
  constructor() {
    this._data = null;
    this._queue = Promise.resolve();
  }

  _file() { return paths.getFilamentsPath(); }
  _imgDir() { return paths.getFilamentImagesDir(); }

  async init() {
    paths.ensureDirs();
    const file = this._file();
    try {
      const txt = await fsp.readFile(file, 'utf8');
      const j = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);
      if (j && j.items && typeof j.items === 'object') this._data = j;
      else this._data = emptyData();
    } catch (_) {
      this._data = emptyData();
      await this._flush();
    }
    return this;
  }

  async _flush() {
    this._data.updatedAt = Date.now();
    await atomicWrite(this._file(), JSON.stringify(this._data, null, 2));
  }

  _mutate(fn) {
    const job = this._queue.then(async () => {
      const r = await fn(this._data);
      await this._flush();
      return r;
    });
    this._queue = job.catch(() => {});
    return job;
  }

  list() {
    const items = Object.values((this._data && this._data.items) || {});
    return {
      items: items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      presets: PRESETS,
      brands: BRANDS,
      types: TYPES,
    };
  }

  get(id) {
    return ((this._data && this._data.items) || {})[id] || null;
  }

  async create(data) {
    const name = safeName(data && data.name);
    if (!name) throw new Error('耗材名称不能为空');
    const id = newId();
    const t = Date.now();
    const rec = {
      id,
      name,
      brand: safeName(data.brand) || '其他 / 自定义',
      type: TYPES.includes(data.type) ? data.type : 'PLA',
      color: normalizeColor(data.color),
      pricePerKg: normalizePrice(data.pricePerKg),
      image: null,
      note: String(data.note == null ? '' : data.note).slice(0, 2000),
      isPreset: !!data.isPreset,
      createdAt: t, updatedAt: t,
    };
    await this._mutate((d) => { d.items[id] = rec; });
    return rec;
  }

  async update(id, patch) {
    const p = patch || {};
    return this._mutate((d) => {
      const rec = d.items[id];
      if (!rec) throw new Error('找不到这个耗材');
      if (Object.prototype.hasOwnProperty.call(p, 'name')) {
        const n = safeName(p.name);
        if (!n) throw new Error('耗材名称不能为空');
        rec.name = n;
      }
      if (Object.prototype.hasOwnProperty.call(p, 'brand')) rec.brand = safeName(p.brand) || '其他 / 自定义';
      if (Object.prototype.hasOwnProperty.call(p, 'type')) rec.type = TYPES.includes(p.type) ? p.type : '其他';
      if (Object.prototype.hasOwnProperty.call(p, 'color')) rec.color = normalizeColor(p.color);
      if (Object.prototype.hasOwnProperty.call(p, 'pricePerKg')) rec.pricePerKg = normalizePrice(p.pricePerKg);
      if (Object.prototype.hasOwnProperty.call(p, 'note')) rec.note = String(p.note == null ? '' : p.note).slice(0, 2000);
      rec.updatedAt = Date.now();
      return rec;
    });
  }

  async remove(id) {
    await this._mutate((d) => { delete d.items[id]; });
    // 图片不立即删：可能有其它耗材引用同一哈希；留给 data 管理页统一清理
    return { ok: true };
  }

  /** 从本地图片文件导入，按内容哈希命名后落盘。返回引用名。 */
  async setImage(id, filePath) {
    const src = String(filePath || '');
    if (!src) throw new Error('没有选择图片');
    const buf = await fsp.readFile(src);
    if (!buf.length || buf.length > 8 * 1024 * 1024) throw new Error('图片为空或超过 8MB');
    const ext = /\.jpe?g$/i.test(src) ? '.jpg' : /\.png$/i.test(src) ? '.png' : '.png';
    const hash = U.sha1(buf).slice(0, 24);
    const name = hash + ext;
    const target = path.join(this._imgDir(), name);
    if (!fs.existsSync(target)) await atomicWrite(target, buf);
    await this._mutate((d) => {
      const rec = d.items[id];
      if (!rec) throw new Error('找不到这个耗材');
      rec.image = name;
      rec.updatedAt = Date.now();
    });
    return { image: name };
  }

  imagePath(name) {
    const base = path.basename(String(name || ''));
    if (!base || base === '.' || base === '..') return null;
    return path.join(this._imgDir(), base);
  }
}

module.exports = {
  FilamentService, PRESETS, TYPES, BRANDS, HEX,
  normalizeColor, normalizePrice, emptyData,
};
