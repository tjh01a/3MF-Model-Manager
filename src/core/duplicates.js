'use strict';
/**
 * A-3 · 重复与疑似重复识别
 * 纯 Node，无 Electron 依赖。全部就地写回 library.models 中的记录引用，不重新创建对象。
 */
const utils = require('./utils');

/**
 * 归一化入参为记录数组。兼容：
 *  - 记录数组
 *  - models 对象 map（ { [id]: record } ）
 *  - 完整 library（含 .models）
 */
function asModelList(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter((r) => r && typeof r === 'object');
  if (typeof input === 'object') {
    const src = (input.models && typeof input.models === 'object' && !Array.isArray(input.models))
      ? input.models
      : input;
    return Object.values(src).filter((r) => r && typeof r === 'object');
  }
  return [];
}

/** A-3：hash -> ids[]，仅保留 length>1 的组；无 hash 的记录不参与分组 */
function computeHashGroups(models) {
  const groups = new Map();
  for (const r of asModelList(models)) {
    const h = r.hash;
    if (!h || typeof h !== 'string') continue;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(r.id);
  }
  for (const [k, ids] of groups) {
    if (ids.length < 2) groups.delete(k);
  }
  return groups;
}

/** A-3：归一化名相同 + size 差 <2% 的疑似重复组 */
function findSimilar(models) {
  const list = asModelList(models);
  const byName = new Map();
  for (const r of list) {
    const name = r.fileName || r.title || '';
    const key = utils.similarNameKey(name);
    if (!key) continue; // 归一化后为空的名字跳过，避免误聚一堆无关文件
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }

  const out = [];
  for (const [key, arr] of byName) {
    if (arr.length < 2) continue;
    // 按 size 升序聚类：相邻两条 size 差 <= 较大者的 2% 归为同一簇
    const sorted = arr.slice().sort((a, b) => (Number(a.size) || 0) - (Number(b.size) || 0));
    let seq = 0;
    let cluster = [sorted[0]];
    const flush = () => {
      if (cluster.length >= 2) {
        out.push({
          key: 'sim:' + key + '#' + seq,
          ids: cluster.map((r) => r.id),
          reason: '文件名相似且大小相差不超过 2%',
        });
        seq++;
      }
    };
    for (let i = 1; i < sorted.length; i++) {
      const prev = cluster[cluster.length - 1];
      const cur = sorted[i];
      const a = Number(prev.size) || 0;
      const b = Number(cur.size) || 0;
      if (Math.abs(a - b) <= Math.max(a, b) * 0.02) {
        cluster.push(cur);
      } else {
        flush();
        cluster = [cur];
      }
    }
    flush();
  }
  return out;
}

/**
 * A-3：就地写回 duplicateGroup / duplicateOf / similarGroup 并返回统计。
 * 重要：先清空全部旧标记，再基于当前库重新计算，避免残留脏分组。
 * @returns { groups:Number, affected:String[], similar:Number }
 */
function annotate(library) {
  const list = asModelList(library);
  const byId = new Map();
  for (const r of list) byId.set(r.id, r);

  // 1. 清空旧标记
  for (const r of list) {
    r.duplicateGroup = null;
    r.duplicateOf = null;
    r.similarGroup = null;
  }

  const affected = new Set();

  // 2. 内容 hash 重复组
  const groups = computeHashGroups(list);
  for (const [hash, ids] of groups) {
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      r.duplicateGroup = hash;
      r.duplicateOf = ids.find((x) => x !== id) || null;
      affected.add(id);
    }
  }

  // 3. 疑似重复组（仅提示，与重复组可共存）
  const sims = findSimilar(list);
  for (const g of sims) {
    for (const id of g.ids) {
      const r = byId.get(id);
      if (!r) continue;
      r.similarGroup = g.key;
      affected.add(id);
    }
  }

  return { groups: groups.size, affected: Array.from(affected), similar: sims.length };
}

module.exports = { computeHashGroups, findSimilar, annotate };
