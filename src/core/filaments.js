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
  return { schemaVersion: 2, updatedAt: Date.now(), items: {}, defaultId: null, builtinSeeded: false };
}

/** 同名+同品牌+同类型视为同一条内置耗材，避免给老用户重复塞一份。 */
function filamentSignature(rec) {
  const s = (v) => String(v == null ? '' : v).trim().toLowerCase();
  return [s(rec && rec.brand), s(rec && rec.name), s(rec && rec.type)].join('|');
}

/** 读取随程序分发的通用耗材；资源缺失或损坏时静默跳过，不影响启动。 */
function loadBuiltinFilaments() {
  const file = path.join(paths.getBuiltinFilamentsDir(), 'filaments.json');
  try {
    // 启动阶段只读一次，同步足够；资源缺失/损坏都不该挡住程序启动。
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      items: Array.isArray(j && j.items) ? j.items : [],
      defaultId: (j && j.defaultId) || null,
    };
  } catch (_) {
    return { items: [], defaultId: null };
  }
}

/** 旧版本写入的记录可能缺字段；list/get 统一补齐，避免渲染层读到 undefined。 */
function normalizeFilament(rec) {
  const r = (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : {};
  const t = Number.isFinite(Number(r.updatedAt)) ? Number(r.updatedAt) : 0;
  return {
    ...r,
    id: r.id == null ? '' : String(r.id),
    name: typeof r.name === 'string' ? r.name : '',
    brand: typeof r.brand === 'string' ? r.brand : '其他 / 自定义',
    type: typeof r.type === 'string' ? r.type : 'PLA',
    color: normalizeColor(r.color),
    pricePerKg: normalizePrice(r.pricePerKg),
    image: typeof r.image === 'string' ? r.image : null,
    note: typeof r.note === 'string' ? r.note : '',
    params: typeof r.params === 'string' ? r.params : '',
    isPreset: !!r.isPreset,
    createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : t,
    updatedAt: t,
  };
}

/** 按文件头判断真实图片格式；不是 PNG/JPEG 返回 null。 */
function sniffImageExt(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  return null;
}

/** 损坏文件另存备份名：绝不覆盖原始数据，方便用户事后找回。 */
function corruptBackupPath(file) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  // 毫秒必须补到 3 位：补不齐时 "...-57" 会和 "...-570" 排错序，备份名也不再定宽
  const ms = (n) => String(n).padStart(3, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms(d.getMilliseconds())}`;
  return `${file}.corrupt-${stamp}`;
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
    this.recovery = null;   // 损坏/不可读的可观察状态，便于界面提示与测试断言
  }

  _file() { return paths.getFilamentsPath(); }
  _imgDir() { return paths.getFilamentImagesDir(); }

  async init() {
    paths.ensureDirs();
    const file = this._file();
    let raw = null;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (e) {
      // 第一次启动没有文件是正常情况，直接建一份空库；其它读取失败绝不写文件。
      if (e && e.code === 'ENOENT') {
        this.recovery = { kind: 'missing', file };
        this._data = emptyData();
        await this._flush();
        await this._seedBuiltinFilaments();
        return this;
      }
      this.recovery = { kind: 'unreadable', file, code: (e && e.code) || 'EUNKNOWN' };
      throw new Error('耗材库文件无法读取（可能被其它程序占用，错误码 '
        + ((e && e.code) || 'EUNKNOWN') + '）：' + file + '。为避免覆盖你的数据，本次不做任何写入。');
    }
    let j = null;
    try {
      j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch (_) {
      // 内容损坏：先把原始字节另存为 .corrupt-*，再从空数据启动；原文件字节绝不覆写。
      const backup = corruptBackupPath(file);
      try { await fsp.copyFile(file, backup); }
      catch (e) { throw new Error('耗材库文件已损坏，且无法另存备份（' + (e && e.message ? e.message : String(e)) + '）：' + file); }
      this.recovery = { kind: 'corrupt', file, backup };
      this._data = emptyData();
      await this._flush();
      await this._seedBuiltinFilaments();
      return this;
    }
    if (j && j.items && typeof j.items === 'object' && !Array.isArray(j.items)) {
      this._data = j;
      // 旧数据缺字段时只补内存结构；原文件保留到下一次正常写入才更新。
      for (const [id, rec] of Object.entries(this._data.items)) {
        this._data.items[id] = normalizeFilament(rec);
      }
    } else {
      // 结构不对按损坏处理：同样先留底，不直接覆盖。
      const backup = corruptBackupPath(file);
      try { await fsp.copyFile(file, backup); }
      catch (e) { throw new Error('耗材库文件结构无效，且无法另存备份（' + (e && e.message ? e.message : String(e)) + '）：' + file); }
      this.recovery = { kind: 'invalid-structure', file, backup };
      this._data = emptyData();
      await this._flush();
    }
    await this._seedBuiltinFilaments();
    return this;
  }

  async _flush() {
    this._data.updatedAt = Date.now();
    await atomicWrite(this._file(), JSON.stringify(this._data, null, 2));
  }

  /**
   * 首次启动写入随程序分发的通用耗材。
   * 老用户按「品牌+名称+类型」去重，绝不覆盖已有记录、价格或备注；
   * 只有真正新增了条目才额外落盘一次。
   */
  async _seedBuiltinFilaments() {
    const builtin = loadBuiltinFilaments();
    if (!builtin.items.length) return 0;

    const d = this._data || emptyData();
    if (!d.items || typeof d.items !== 'object' || Array.isArray(d.items)) d.items = {};
    this._data = d;

    const seen = new Set(Object.values(d.items).map(filamentSignature).filter(Boolean));
    const now = Date.now();
    let added = 0;

    for (const raw of builtin.items) {
      const rec = normalizeFilament(raw);
      if (!rec.id || !rec.name) continue;
      const sig = filamentSignature(rec);
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);

      // 图片随包放在 resources/builtin-filaments/，复制一份到用户数据目录；
      // 文件名沿用内容哈希，和手动导入的图片共用同一套缓存规则。
      if (rec.image && /^[0-9a-f]{24}\.(png|jpe?g)$/i.test(rec.image)) {
        try {
          const base = path.basename(rec.image);
          const src = path.join(paths.getBuiltinFilamentsDir(), base);
          const dst = path.join(this._imgDir(), base);
          if (!fs.existsSync(dst) && fs.existsSync(src)) {
            await atomicWrite(dst, await fsp.readFile(src));
          }
        } catch (_) { /* 图片缺失不阻断耗材库启动 */ }
      }

      rec.createdAt = now + added;
      rec.updatedAt = now + added;
      d.items[rec.id] = rec;
      added++;
    }

    if (added > 0 && !d.defaultId && builtin.defaultId && d.items[builtin.defaultId]) {
      d.defaultId = builtin.defaultId;
    }
    if (!d.builtinSeeded || added > 0) {
      d.builtinSeeded = true;
      d.schemaVersion = Math.max(Number(d.schemaVersion) || 0, 2);
      await this._flush();
    }
    return added;
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
    // 旧库记录即使绕过 init 注入，也在读出口补齐字段（P0-16）。
    const items = Object.values((this._data && this._data.items) || {}).map(normalizeFilament);
    return {
      items: items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      presets: PRESETS,
      brands: BRANDS,
      types: TYPES,
      defaultId: (this._data && this._data.defaultId) || null,
    };
  }

  get(id) {
    const rec = ((this._data && this._data.items) || {})[id];
    return rec ? normalizeFilament(rec) : null;
  }

  /** 默认耗材：未分配耗材的模型按它的单价估算成本。传 null 取消默认。 */
  async setDefault(id) {
    if (id != null && id !== '' && !this.get(id)) throw new Error('找不到这个耗材');
    const value = (id == null || id === '') ? null : String(id);
    await this._mutate((d) => { d.defaultId = value; });
    return { ok: true, defaultId: value };
  }

  getDefault() {
    const id = (this._data && this._data.defaultId) || null;
    return id ? (this.get(id) || null) : null;
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
      params: String(data.params == null ? '' : data.params).slice(0, 2000),
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
      if (Object.prototype.hasOwnProperty.call(p, 'params')) rec.params = String(p.params == null ? '' : p.params).slice(0, 2000);
      rec.updatedAt = Date.now();
      return rec;
    });
  }

  async remove(id) {
    await this._mutate((d) => {
      delete d.items[id];
      // 删掉的是默认耗材时，默认指向一并清空，避免悬空 id
      if (d.defaultId === id) d.defaultId = null;
    });
    // 图片不立即删：可能有其它耗材引用同一哈希；留给 data 管理页统一清理
    return { ok: true };
  }

  /**
   * 从本地图片文件导入，按内容哈希命名后落盘。返回引用名。
   * 只接受真正的 PNG / JPEG：扩展名可以骗人（把 webp 改名成 .png 就存成 .png，
   * 浏览器按 image/png 解码必然失败，又变回「图片显示不出来」）。
   */
  async setImage(id, filePath) {
    const src = String(filePath || '');
    if (!src) throw new Error('没有选择图片');
    const buf = await fsp.readFile(src);
    return this.setImageBuffer(id, buf);
  }

  /** 直接落一段图片字节（用于裁剪 / 缩放后重新编码的结果）。 */
  async setImageBuffer(id, buf) {
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
    if (!data.length) throw new Error('图片为空');
    if (data.length > 8 * 1024 * 1024) throw new Error('图片超过 8MB，请先裁切或压缩');
    const ext = sniffImageExt(data);
    if (!ext) throw new Error('只支持 PNG / JPG 图片');
    const hash = U.sha1(data).slice(0, 24);
    const name = hash + ext;
    const target = path.join(this._imgDir(), name);
    if (!fs.existsSync(target)) await atomicWrite(target, data);
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
  normalizeColor, normalizePrice, normalizeFilament, corruptBackupPath, emptyData, sniffImageExt,
};
