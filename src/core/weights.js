'use strict';
/**
 * 旧库重量回填。
 *
 * 背景：3MF 解析层新增「切片重量」之后，已经入库的模型不会因为升级而自动拥有
 * meta.weightG —— 增量扫描只看 size + mtime，文件没变就整条跳过（scanner.js
 * 的 unchanged 分支），于是旧记录永远停在「没有重量」，卡片一直显示 ¥??。
 * 实测本机 184 个模型里有 28 个 3MF 的 slice_info.config 带 weight，库里却只有 3 个。
 *
 * 设计约束（与 colors.js 保持一致）：
 *  1. 只重解析「没重量且没被标记 checked」的记录；磁盘文件不在的跳过。
 *  2. withThumbnail:false —— 不解压 PNG，单文件实测几毫秒。
 *  3. 每 12 条让出事件循环，10 秒总预算；超预算写回已解析部分，下次启动继续。
 *  4. 收集完一次性 updateLibrary()，只触发一次 lib:changed / 一次界面刷新。
 *  5. 解析后无论有没有重量都写 weightChecked:true，避免每次启动重试无数据的文件。
 *  6. 只合并重量相关字段：withThumbnail:false 下其它字段可能降级，整体替换会打坏。
 *
 * 纯 Node，禁止 require('electron')。
 */
const fs = require('fs');
const { parse3mf } = require('./model3mf');

const YIELD_EVERY = 12;
const MAX_PARSE_MS = 10000;
const WEIGHT_KEYS = ['weightG', 'weightSource', 'filamentUsages'];

const yieldTick = () => new Promise((resolve) => setImmediate(resolve));

/** 由旧 meta + 新解析结果生成合并后的 meta（导出便于单测） */
function weightPatch(oldMeta, freshMeta) {
  const patch = { weightChecked: true };
  for (const k of WEIGHT_KEYS) {
    if (k === 'filamentUsages') {
      patch[k] = Array.isArray(freshMeta && freshMeta[k]) ? freshMeta[k] : [];
    } else {
      patch[k] = freshMeta && freshMeta[k] != null ? freshMeta[k] : null;
    }
  }
  return { ...(oldMeta || {}), ...patch };
}

/** 这条记录是否值得重新解析（导出便于单测） */
function needsWeightParse(rec) {
  if (!rec || !rec.path) return false;
  if (rec.status === 'missing') return false;
  if (!/\.3mf$/i.test(String(rec.path))) return false;
  const meta = rec.meta || {};
  if (meta.weightG != null) return false;       // 已经有重量
  if (meta.weightChecked === true) return false; // 已确认过这文件没有重量
  return true;
}

/**
 * @param {Object} store Store 实例（需要 getLibrary / updateLibrary）
 * @param {{limit?:Number, maxMs?:Number}} [options]
 * @returns {Promise<{scanned:Number, updated:Number, failed:Number, skipped:Number, truncated:Boolean, duration:Number, error?:String}>}
 */
async function backfillWeights(store, options = {}) {
  const out = { scanned: 0, updated: 0, failed: 0, skipped: 0, truncated: false, duration: 0 };
  const startedAt = Date.now();
  if (!store || typeof store.getLibrary !== 'function' || typeof store.updateLibrary !== 'function') {
    return out;
  }

  let all;
  try { all = Object.values((store.getLibrary() || {}).models || {}); }
  catch (_) { return out; }

  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : Infinity;
  const targets = [];
  for (const r of all) {
    if (!needsWeightParse(r)) { out.skipped++; continue; }
    if (!fs.existsSync(r.path)) { out.skipped++; continue; }
    if (targets.length >= limit) break;
    targets.push(r);
  }
  if (!targets.length) { out.duration = Date.now() - startedAt; return out; }

  const patches = [];
  const budgetMs = Number.isFinite(options.maxMs) ? Math.max(0, options.maxMs) : MAX_PARSE_MS;
  for (let i = 0; i < targets.length; i++) {
    if (Date.now() - startedAt > budgetMs) { out.truncated = true; break; }
    const r = targets[i];
    let fresh = null;
    try {
      const res = await parse3mf(r.path, { withThumbnail: false, withMeta: true });
      if (res && res.ok && res.meta) fresh = res.meta;
    } catch (_) { /* 单文件失败只降级 */ }
    if (!fresh) out.failed++;
    patches.push({ id: r.id, meta: weightPatch(r.meta, fresh), got: !!(fresh && fresh.weightG != null) });
    out.scanned++;
    if ((i + 1) % YIELD_EVERY === 0) await yieldTick();
  }

  try {
    await store.updateLibrary((target) => {
      for (const p of patches) {
        const rec = target.models && target.models[p.id];
        if (!rec) continue;
        // 并发写入可能已经抢先补过，别用旧结果覆盖新数据
        if (rec.meta && rec.meta.weightG != null) continue;
        rec.meta = p.meta;
        out.updated++;
      }
    }, 'weights-backfill');
  } catch (e) {
    out.failed += patches.length;
    out.error = (e && e.message) || String(e);
    // 回填失败只影响成本显示，绝不影响启动
  }
  out.duration = Date.now() - startedAt;
  return out;
}

module.exports = { backfillWeights, weightPatch, needsWeightParse, WEIGHT_KEYS };
