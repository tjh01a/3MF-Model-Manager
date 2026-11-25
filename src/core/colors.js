'use strict';
/**
 * 旧库耗材颜色回填。
 *
 * 背景：3MF 解析层新增 meta.filamentColors 之后，已经入库的模型不会因为升级而
 * 自动拥有这个字段。用户看到的还是「没有色板」，必须补一次数据。
 *
 * 设计约束：
 *  1. 只重解析缺字段、磁盘文件仍在的记录；已经补过的绝不重复解析。
 *  2. withThumbnail:false —— 不解压 PNG，单文件实测 2~13ms。
 *  3. 每 12 条让出一次事件循环，并有 8 秒总预算；超预算只写回已解析部分，剩余记录下次启动继续。
 *  4. 所有结果收集完一次性 updateLibrary()，因此只触发一次 lib:changed / 一次界面刷新。
 *  5. 解析失败不写终态：原来写空数组当「已处理」，坏一次就永久跳过（P1-7）。
 *  6. 只合并三个颜色字段：withThumbnail:false 下 hasThumbnail / objectCount 会降级，
 *     整体替换 meta 会把已有数据打坏。
 *
 * 纯 Node，禁止 require('electron')。
 */
const fs = require('fs');
const { parse3mf } = require('./model3mf');

const YIELD_EVERY = 12;
// 超大库不能让后台回填一直占着主进程；超预算就写回已解析的部分，剩下的下次启动继续。
const MAX_PARSE_MS = 8000;
const COLOR_KEYS = ['filamentColors', 'filamentTypes', 'colorSource', 'filamentFaceCounts'];

const yieldTick = () => new Promise((resolve) => setImmediate(resolve));

/** 色板、逐色克数或面数估算至少有一种，就算「已补过」。 */
function hasColorMeta(meta) {
  if (!meta || !Array.isArray(meta.filamentColors)) return false;
  if (Array.isArray(meta.filamentUsages) && meta.filamentUsages.length) return true;
  return Array.isArray(meta.filamentFaceCounts);
}

/** 由旧 meta + 新解析结果生成合并后的 meta（导出便于单测）。 */
function colorPatch(oldMeta, freshMeta) {
  // 解析失败：原样返回，绝不能把「无颜色」写成终态。
  if (!freshMeta) return { ...(oldMeta || {}) };
  const patch = {};
  for (const k of COLOR_KEYS) {
    patch[k] = freshMeta && freshMeta[k] != null
      ? freshMeta[k]
      : (k === 'colorSource' ? 'none' : []);
  }
  // 解析成功时顺带把多色标记校准到新口径，避免「色板 5 色但 hasMultiColor=false」。
  // 解析失败则保留旧值，不拿 false 覆盖已有判断。
  if (freshMeta && Array.isArray(freshMeta.filamentColors)) {
    patch.hasMultiColor = !!freshMeta.hasMultiColor;
  }
  return { ...(oldMeta || {}), ...patch };
}

/**
 * @param {Object} store Store 实例（需要 getLibrary / updateLibrary）
 * @param {{limit?:Number, maxMs?:Number}} [options]
 * @returns {Promise<{scanned:Number, updated:Number, failed:Number, skipped:Number, truncated:Boolean, duration:Number, error?:String}>}
 */
async function backfillFilamentColors(store, options = {}) {
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
    if (!r || !r.path || r.status === 'missing' || !/\.3mf$/i.test(String(r.path))) {
      out.skipped++; continue;
    }
    if (!fs.existsSync(r.path)) { out.skipped++; continue; }
    if (hasColorMeta(r.meta)) { out.skipped++; continue; }
    if (targets.length >= limit) break;
    targets.push(r);
  }
  if (!targets.length) { out.duration = Date.now() - startedAt; return out; }

  const patches = [];
  const budgetMs = Number.isFinite(options.maxMs)
    ? Math.max(0, options.maxMs) : MAX_PARSE_MS;
  for (let i = 0; i < targets.length; i++) {
    if (Date.now() - startedAt > budgetMs) { out.truncated = true; break; }
    const r = targets[i];
    let fresh = null;
    try {
      const res = await parse3mf(r.path, { withThumbnail: false, withMeta: true });
      if (res && res.ok && res.meta) fresh = res.meta;
    } catch (_) { /* 单文件失败只降级 */ }
    out.scanned++;
    if (!fresh) {
      out.failed++;   // 失败不进 patches，下次启动继续尝试
      continue;
    }
    patches.push({ id: r.id, meta: colorPatch(r.meta, fresh) });
    if ((i + 1) % YIELD_EVERY === 0) await yieldTick();
  }

  if (!patches.length) {
    // 全失败时一次库写入都不做，留待下次启动重试。
    out.duration = Date.now() - startedAt;
    return out;
  }
  try {
    await store.updateLibrary((target) => {
      for (const p of patches) {
        const rec = target.models && target.models[p.id];
        if (!rec) continue;
        // 并发写入可能已经抢先补过，别用旧结果覆盖新数据
        if (hasColorMeta(rec.meta)) continue;
        rec.meta = p.meta;
        out.updated++;
      }
    }, 'colors-backfill');
  } catch (e) {
    out.failed += patches.length;
    out.error = (e && e.message) || String(e);
    // 回填失败只影响色板，绝不影响启动
  }
  out.duration = Date.now() - startedAt;
  return out;
}

module.exports = { backfillFilamentColors, colorPatch, COLOR_KEYS };
