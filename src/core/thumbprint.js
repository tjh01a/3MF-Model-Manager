'use strict';
/**
 * A · 同款变体（按缩略图比对，2026-11-26 改）
 *
 * 用户对同一个模型复制、放大缩小、换颜色后重新导出，文件名和 3MF 哈希都会变，
 * 但模型自带的缩略图不会变（3MF 里是同一张图片字节）。所以同款变体只认
 * 「缩略图字节完全相同」：
 *   - 不再用 9×8 dHash。宽高缩小到 9×8 后，深色背景 + 中间一个亮物体的完全
 *     不同模型会撞成同一个指纹（实测把肥鱼GTA、Lumina、奶龙、月高达聚到一起）。
 *   - 每组的基准是最早入库的那条；
 *   - 没有缩略图、占位 SVG、失效/隔离/解析失败、已经是副本的记录不参与；
 *   - 内容哈希完全相同或文件名/体积高度相似的文件归「重复文件」管，这里不再重复列。
 *
 * 纯 Node：只做分组与写记录，缩略图字节的 SHA-1 由调用方算好传进来。
 */

const BASE_TIME = (r) => Number(r && r.createdAt) || 0;

function isPlaceholder(rec) {
  return /\.svg$/i.test(String((rec && rec.thumbnail) || ''));
}

/** 能参与同款变体分组的记录 */
function eligible(rec) {
  if (!rec || !rec.id || rec.aliasOf) return false;
  if (rec.status === 'missing' || rec.status === 'quarantined') return false;
  if (rec.parseErrorKind) return false;
  if (!rec.thumbnail || isPlaceholder(rec)) return false;
  // 重复文件视图已经负责这些；同款变体只处理「文件不同、缩略图相同」
  if (rec.duplicateGroup || rec.similarGroup) return false;
  return true;
}

/** 清掉全部变体标记（保留函数给迁移/关闭功能时用） */
function clear(lib) {
  for (const r of Object.values((lib && lib.models) || {})) {
    if (!r) continue;
    r.variantGroup = null;
    r.variantRole = null;
    r.variantScore = null;
    r.variantScale = null;
  }
}

/**
 * 按缩略图字节指纹重算同款变体，就地把 variantGroup / variantRole / variantScore 写回记录。
 * @param {Object} lib library（含 models）
 * @param {Object|Map} hashes  { [modelId]: 缩略图字节 SHA-1 十六进制 } 或 Map
 * @returns {{groups:Number, members:Number, checked:Number}}
 */
function annotate(lib, hashes) {
  const models = (lib && lib.models) || {};
  const get = hashes instanceof Map
    ? (id) => hashes.get(id)
    : (id) => (hashes ? hashes[id] : null);

  clear(lib);

  const cands = [];
  for (const r of Object.values(models)) {
    if (!eligible(r)) continue;
    const h = String(get(r.id) || '').toLowerCase();
    if (h.length !== 40) continue;          // 没算出来 / 读图失败：不参与，绝不让空指纹互相成组
    cands.push({ rec: r, h });
  }
  if (cands.length < 2) return { groups: 0, members: 0, checked: cands.length };

  // 基准优先最早入库，结果可复现
  cands.sort((a, b) => BASE_TIME(a.rec) - BASE_TIME(b.rec)
    || String(a.rec.id).localeCompare(String(b.rec.id)));

  let groups = 0;
  let members = 0;
  const used = new Set();
  for (let i = 0; i < cands.length; i++) {
    const base = cands[i];
    if (used.has(base.rec.id)) continue;
    const list = [];
    for (let j = i + 1; j < cands.length; j++) {
      const other = cands[j];
      if (used.has(other.rec.id)) continue;
      // 只认同字节；不做相似度阈值，避免 9×8 缩略图的碰撞把不同模型聚在一起
      if (base.h === other.h) list.push(other);
    }
    if (!list.length) continue;

    groups++;
    members += 1 + list.length;
    const key = 'thumb:' + base.h.slice(0, 12);
    base.rec.variantGroup = key;
    base.rec.variantRole = 'base';
    base.rec.variantScore = 1;
    base.rec.variantScale = null;
    used.add(base.rec.id);
    for (const it of list) {
      it.rec.variantGroup = key;
      it.rec.variantRole = 'same';
      it.rec.variantScore = 1;
      it.rec.variantScale = null;
      used.add(it.rec.id);
    }
  }
  return { groups, members, checked: cands.length };
}

module.exports = { annotate, clear, eligible };
