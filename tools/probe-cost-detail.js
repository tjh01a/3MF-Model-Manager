/**
 * 走查探针：模型详情里的「耗材与成本」区块（docs/13）。
 *   node launch.js --capture=docs/screenshots/44-模型成本详情.png --ui-script=tools/probe-cost-detail.js
 *
 * 数据安全（P0）：写接口仅在完整快照 + finally 恢复的保护下调用。
 *  - 快照全部模型成本、目标模型 filamentLinks / costWeightG、耗材 id 集合；
 *  - 只创建 1 个带时间戳的临时耗材，不复用 / 不删除任何既有耗材；
 *  - finally 还原目标分配并删除临时耗材，校验成本表与耗材集合一致，失败让 ok=false。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(step || 120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const out = {};

// 被 catch 后只弹红字、不进 window.onerror 的运行时错误，视为探针失败
const toastErrors = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!n || n.nodeType !== 1) continue;
      const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
      if (!bad) continue;
      const msg = bad.querySelector('.toast-message');
      toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
    }
  }).observe(toastBox, { childList: true });
}

// 找一张卡片打开详情（先等网格稳定，避免拿到正在被替换的旧节点）
await waitFor(() => q('.card[data-id]'), 15000);
await sleep(300);
const card = q('.card[data-id]');
if (!card) { out.ok = false; out.error = '没有模型卡片'; out.toastErrors = toastErrors; return out; }
const id = card.dataset.id;
card.click();
await waitFor(() => (q('#detail-body') && q('#detail-cost')) ? true : null, 8000);
await waitFor(() => (q('#detail-cost .cost-loading') ? null : true), 8000);
await sleep(200);

out.cost = {
  exists: !!q('#detail-cost'),
  hasSummary: !!q('#detail-cost .cost-summary'),
  hasBig: !!q('#detail-cost .cost-big'),
  hasAssign: !!q('[data-act="cost-assign"]'),
  hasWeight: !!q('[data-act="cost-weight"]'),
  metaText: ((q('#detail-cost .cost-meta') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  bigText: ((q('#detail-cost .cost-big') || {}).textContent || '').trim(),
};

// docs/14：成本区块已前移到详情上部概览带（统计块之后、备注之前），不再埋在底部
const sections = Array.from(document.querySelectorAll('#detail-body .detail-section'));
const costIdx = sections.findIndex((s) => s.id === 'detail-cost');
const noteIdx = sections.findIndex((s) => s.querySelector('[data-field="note"]'));
const fileInfoIdx = sections.findIndex((s) =>
  (s.querySelector('.section-title') || {}).textContent === '文件信息');
out.position = {
  costIdx, noteIdx, fileInfoIdx,
  inOverviewBand: costIdx >= 0 && noteIdx >= 0 && costIdx < noteIdx &&
    fileInfoIdx >= 0 && costIdx < fileInfoIdx,
};

// ---- 写前快照（只读） ----
let snap = null;
try {
  const items = ((await window.shelf.query({})) || {}).items || [];
  const target = items.find((m) => m && m.id === id) || null;
  snap = {
    costsJson: JSON.stringify(await window.shelf.modelsCosts()),
    filamentIds: ((await window.shelf.filamentsList()).items || []).map((f) => f.id).sort(),
    links: target && Array.isArray(target.filamentLinks) ? JSON.parse(JSON.stringify(target.filamentLinks)) : [],
    weightG: target ? (target.costWeightG == null ? null : target.costWeightG) : null,
  };
} catch (e) {
  out.ok = false;
  out.error = '无法读取写入前快照，放弃写入：' + ((e && e.message) || String(e));
  out.toastErrors = toastErrors;
  return out;
}

const createdIds = [];
let restoreResult = null;
async function restore() {
  const errs = [];
  try { await window.shelf.modelSetFilaments(id, snap.links, snap.weightG); } catch (e) { errs.push((e && e.message) || String(e)); }
  for (const fid of createdIds) {
    try { await window.shelf.filamentRemove(fid); } catch (e) { errs.push((e && e.message) || String(e)); }
  }
  let costsJsonNow = null;
  let filamentIdsNow = null;
  try { costsJsonNow = JSON.stringify(await window.shelf.modelsCosts()); } catch (e) { errs.push((e && e.message) || String(e)); }
  try { filamentIdsNow = ((await window.shelf.filamentsList()).items || []).map((f) => f.id).sort(); } catch (e) { errs.push((e && e.message) || String(e)); }
  const costsMatch = costsJsonNow === snap.costsJson;
  const idsMatch = JSON.stringify(filamentIdsNow) === JSON.stringify(snap.filamentIds);
  return { ok: !errs.length && costsMatch && idsMatch, costsMatch, idsMatch, errors: errs };
}

// 验证分配接口能写入并重算（不弹窗，直接走 IPC）；finally 立即还原
try {
  const created = await window.shelf.filamentCreate({
    name: '__探针耗材·成本用·' + Date.now().toString(36) + '__', brand: 'Bambu 拓竹', type: 'PLA', color: '#ffffff', pricePerKg: 120,
  });
  const fid = created && created.id;
  if (fid) createdIds.push(fid);
  if (fid) {
    const r = await window.shelf.modelSetFilaments(id, [{ filamentId: fid, weightG: 100 }], null);
    out.assign = { total: r && r.total, parts: r && r.parts && r.parts.length, complete: r && r.complete };
  }
} catch (e) { out.assign = { error: (e && e.message) || String(e) }; }
finally {
  restoreResult = await restore();
}

out.restored = restoreResult.ok;
out.restoreDetail = { costsMatch: restoreResult.costsMatch, idsMatch: restoreResult.idsMatch, errors: restoreResult.errors };

const costOk = out.cost.exists && out.cost.hasSummary && out.cost.hasBig &&
  out.cost.hasAssign && out.cost.hasWeight;
const assignOk = !!(out.assign && out.assign.total === 12 && out.assign.parts === 1);
out.checks = { costOk, assignOk, positionOk: out.position.inOverviewBand, restored: restoreResult.ok };
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = restoreResult.ok && !out.toastErrors.length && costOk && assignOk && out.position.inOverviewBand;
if (!restoreResult.ok) out.error = '成本/耗材数据恢复失败，禁止判定通过';
return out;
