'use strict';
/**
 * 成本账本纯函数（13 · 耗材库与成本账本）。
 * 纯 Node、无副作用、无 IO——单测可直接喂假数据。
 *
 * 价格口径：所有耗材单价统一为「元 / kg」，每克价 = 元每kg / 1000。
 * 成本 = Σ(各耗材用量g × 该耗材每克价)。未分配 / 单价为 0 都算 incomplete。
 */

/** 合理重量区间（克）：过滤 slice_info 里自相矛盾的异常值 */
const MIN_WEIGHT_G = 0.01;
const MAX_WEIGHT_G = 5000;

/** 常见材料密度（g/cm³），只用于「体积估算」这一最弱口径，且一定标注来源 */
const DENSITY = {
  PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07,
  TPU: 1.21, PC: 1.20, PA: 1.14, PVA: 1.23,
};

function isValidWeight(w) {
  const n = Number(w);
  return Number.isFinite(n) && n > MIN_WEIGHT_G && n <= MAX_WEIGHT_G;
}

/** 元/kg -> 元/g */
function perGram(pricePerKg) {
  const p = Number(pricePerKg);
  return Number.isFinite(p) && p > 0 ? p / 1000 : 0;
}

/**
 * 从 3MF 解析出的 meta 里挑一个可信重量。
 * meta.weightG 由 model3mf.extractMeta() 填；weightSource 标记来源。
 * @param {object} meta
 * @returns {{weightG:number|null, source:string|null}}
 */
function weightFromMeta(meta) {
  const m = meta || {};
  if (isValidWeight(m.weightG)) {
    return { weightG: Number(m.weightG), source: m.weightSource || 'slice_info' };
  }
  return { weightG: null, source: null };
}

/**
 * 体积估算（最弱口径）：需要模型体积 cm³ 与材料类型。
 * meta.volumeCm3 可从 3dmodel.model 的 <object> 体积求得（若以后加）；现在只在有值时用。
 * @param {object} meta
 * @param {string} type 材料类型
 */
function estimateWeightByVolume(meta, type) {
  const v = Number((meta || {}).volumeCm3);
  const density = DENSITY[String(type || '').toUpperCase()] || DENSITY.PLA;
  if (!Number.isFinite(v) || v <= 0) return null;
  const g = v * density;
  return isValidWeight(g) ? Math.round(g * 100) / 100 : null;
}

/**
 * 计算一个模型的成本明细。
 * @param {object} rec   模型记录（reading filamentLinks / meta / weightG）
 * @param {object|Map} filaments  耗材库 { id: filament } 或 Map
 * @returns {{total:number, parts:Array, weightG:number|null, source:string, complete:boolean}}
 */
function costOf(rec, filaments) {
  const r = rec || {};
  // 兼容三种入口：Map / {id:Filament} / FilamentService.list() 的 {items:[...]}。
  // 实际主进程传的是 list() 的返回，items 是数组——按对象下标取值会静默算成 0 元。
  const list = () => {
    if (filaments instanceof Map) return Array.from(filaments.values());
    if (Array.isArray(filaments)) return filaments;
    if (filaments && Array.isArray(filaments.items)) return filaments.items;
    if (filaments && typeof filaments.items === 'object') return Object.values(filaments.items);
    return Object.values(filaments || {});
  };
  const lookup = (id) => {
    if (!id) return null;
    if (filaments instanceof Map) return filaments.get(id) || null;
    if (filaments && Array.isArray(filaments.items)) return filaments.items.find((f) => f && f.id === id) || null;
    if (filaments && filaments.items && typeof filaments.items === 'object') return filaments.items[id] || null;
    return (filaments && filaments[id]) || null;
  };

  const links = Array.isArray(r.filamentLinks) ? r.filamentLinks.filter(Boolean) : [];
  const parts = [];
  let total = 0;
  let complete = links.length > 0;

  for (const link of links) {
    const f = lookup(link.filamentId);
    const grams = Number(link.weightG);
    const validG = Number.isFinite(grams) && grams > 0;
    const pg = f ? perGram(f.pricePerKg) : 0;
    const cost = validG ? grams * pg : 0;
    total += cost;
    if (!f || !pg || !validG) complete = false;
    parts.push({
      filamentId: link.filamentId,
      name: f ? f.name : '未分配耗材',
      color: f ? f.color : null,
      grams: validG ? grams : 0,
      pricePerKg: f ? Number(f.pricePerKg) || 0 : 0,
      cost: Math.round(cost * 100) / 100,
    });
  }

  // 没有分配记录时，尝试按 meta.filamentUsages + 颜色名匹配一个"建议"耗材，
  // 但只给建议不写库，complete=false，UI 会标注"估算"。
  if (!links.length) {
    const meta = r.meta || {};
    const usages = Array.isArray(meta.filamentUsages) ? meta.filamentUsages : [];
    const w = weightFromMeta(meta);
    if (usages.length && w.weightG != null) {
      const all = list();
      for (const u of usages) {
        const ug = isValidWeight(u.usedG) ? Number(u.usedG) : 0;
        if (!ug) continue;
        // 先按颜色精确匹配，再按类型匹配
        let f = all.find((x) => x && u.color && String(x.color).toLowerCase() === String(u.color).toLowerCase());
        if (!f) f = all.find((x) => x && u.type && String(x.type).toUpperCase() === String(u.type).toUpperCase());
        const pg = f ? perGram(f.pricePerKg) : 0;
        const cost = ug * pg;
        total += cost;
        parts.push({
          filamentId: f ? f.id : null,
          name: f ? f.name : (String(u.type || '未知耗材') + (u.color || '')),
          color: f ? f.color : u.color,
          grams: ug,
          pricePerKg: f ? Number(f.pricePerKg) || 0 : 0,
          cost: Math.round(cost * 100) / 100,
        });
        if (!f || !pg) complete = false;
      }
    }
  }

  const wsrc = weightFromMeta(r.meta);
  const weightG = isValidWeight(r.weightG) ? Number(r.weightG)
    : (isValidWeight(r.costWeightG) ? Number(r.costWeightG) : wsrc.weightG);

  return {
    total: Math.round(total * 100) / 100,
    parts,
    weightG,
    source: links.length ? 'assigned' : (wsrc.source || (weightG != null ? 'manual' : 'none')),
    complete: complete && parts.length > 0,
  };
}

/**
 * 批量成本（docs/14）：一次算全部模型的派生成本，返回 { id -> {total, complete, weightG} }。
 * 卡片价格走这条路径——逐卡调 modelCost 会在 153 张卡上发 153 次 IPC，首屏会被拖垮。
 * 只算不写库；filaments 只解析一次。
 * @param {object|Array} models  {id: model} 或 model 数组
 * @param {object|Map|Array} filaments 耗材库（costOf 兼容三种格式）
 */
function costOfBatch(models, filaments) {
  const out = {};
  const list = Array.isArray(models) ? models : Object.values(models || {});
  for (const rec of list) {
    if (!rec || !rec.id) continue;
    try {
      const c = costOf(rec, filaments);
      out[rec.id] = {
        total: Number(c.total) || 0,
        complete: !!c.complete,
        weightG: c.weightG != null ? Number(c.weightG) : null,
      };
    } catch (_) {
      out[rec.id] = { total: 0, complete: false, weightG: null };
    }
  }
  return out;
}

/** 格式化人民币（保留两位，整数也带 .00 更像账本） */
function yuan(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '¥0.00';
  return '¥' + v.toFixed(2);
}

module.exports = {
  MIN_WEIGHT_G, MAX_WEIGHT_G, DENSITY,
  isValidWeight, perGram, weightFromMeta, estimateWeightByVolume, costOf, costOfBatch, yuan,
};
