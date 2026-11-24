/**
 * 走查探针：卡片价格徽标（docs/14）。
 *   node launch.js --capture=docs/screenshots/45-卡片价格.png --ui-script=tools/probe-card-price.js
 *
 * 断言：
 *  1) 每张卡片的 .card-meta 行右端都有 .card-price，且该行文字左对齐、价格靠右；
 *  2) 徽标两种状态成立：算不出的显示 ¥??，算得出的显示 ¥金额（不假设库为空）；
 *  3) 批量 modelsCosts() 能一次拿全（对象，键数与模型数一致）；
 *  4) 造一条"100g × ¥120/kg"的临时分配后，对应卡片价格变成 ¥12，
 *     验证派生成本 → 缓存 → 卡片重画整条链路。
 *
 * 数据安全（P0）：写接口仅在完整快照 + finally 恢复的保护下调用。
 *  - 快照全部模型的成本、目标模型的 filamentLinks / costWeightG、耗材 id 集合；
 *  - 只创建 1 个带时间戳的临时耗材，不复用 / 不删除任何既有耗材；
 *  - finally 中还原目标模型的 filamentLinks / costWeightG、删除临时耗材；
 *  - 恢复后校验成本表与耗材 id 集合完全一致，任何不一致都让 ok=false。
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
const qa = (s) => Array.from(document.querySelectorAll(s));
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

// 等首屏卡片画出来
await waitFor(() => qa('.card[data-id]').length ? true : null, 15000);
const cards = qa('.card[data-id]');
out.cardCount = cards.length;
if (!cards.length) { out.ok = false; out.error = '没有模型卡片'; out.toastErrors = toastErrors; return out; }

// 1) 每张卡的 meta 行都有价格徽标，位置靠右
const withBadge = cards.filter((c) => {
  const meta = c.querySelector('.card-meta');
  const badge = c.querySelector('.card-price');
  return !!meta && !!badge;
});
out.badgeCount = withBadge.length;
out.badgeLayout = (() => {
  const c = withBadge[0];
  if (!c) return null;
  const meta = c.querySelector('.card-meta').getBoundingClientRect();
  const txt = c.querySelector('.card-meta-text').getBoundingClientRect();
  const badge = c.querySelector('.card-price').getBoundingClientRect();
  return {
    textLeft: Math.round(txt.left - meta.left),
    badgeRight: Math.round(meta.right - badge.right),
    inRow: badge.top >= meta.top - 2 && badge.bottom <= meta.bottom + 2,
  };
})();

// 2) 批量成本接口
try {
  const costs = await window.shelf.modelsCosts();
  out.costsIsObject = !!costs && typeof costs === 'object' && !Array.isArray(costs);
  out.costsEntries = Object.keys(costs || {}).length;
} catch (e) { out.costsError = (e && e.message) || String(e); }

// 3) 徽标两种状态都要成立
out.unknownCount = qa('.card-price.is-unknown').length;
out.unknownText = ((q('.card-price.is-unknown') || {}).textContent || '').trim();
out.knownCount = out.cardCount - out.unknownCount;
out.knownSample = ((qa('.card-price:not(.is-unknown)')[0] || {}).textContent || '').trim();

// ---- 写前快照（只读） ----
let snap = null;
try {
  const items = ((await window.shelf.query({})) || {}).items || [];
  const byId = new Map(items.map((m) => [m.id, m]));
  const target = byId.get(cards[0].dataset.id) || null;
  snap = {
    costsJson: JSON.stringify(await window.shelf.modelsCosts()),
    filamentIds: ((await window.shelf.filamentsList()).items || []).map((f) => f.id).sort(),
    targetId: target ? target.id : null,
    links: target && Array.isArray(target.filamentLinks) ? JSON.parse(JSON.stringify(target.filamentLinks)) : [],
    weightG: target ? (target.costWeightG == null ? null : target.costWeightG) : null,
  };
} catch (e) {
  out.ok = false;
  out.error = '无法读取写入前快照，放弃写入：' + ((e && e.message) || String(e));
  out.toastErrors = toastErrors;
  return out;
}
out.targetHasPriorLinks = snap.links.length > 0;

const createdIds = [];
let restoreResult = null;
async function restore() {
  const errs = [];
  try {
    if (snap.targetId) await window.shelf.modelSetFilaments(snap.targetId, snap.links, snap.weightG);
  } catch (e) { errs.push((e && e.message) || String(e)); }
  for (const id of createdIds) {
    try { await window.shelf.filamentRemove(id); } catch (e) { errs.push((e && e.message) || String(e)); }
  }
  let costsJsonNow = null;
  let filamentIdsNow = null;
  try { costsJsonNow = JSON.stringify(await window.shelf.modelsCosts()); } catch (e) { errs.push((e && e.message) || String(e)); }
  try { filamentIdsNow = ((await window.shelf.filamentsList()).items || []).map((f) => f.id).sort(); } catch (e) { errs.push((e && e.message) || String(e)); }
  const costsMatch = costsJsonNow === snap.costsJson;
  const idsMatch = JSON.stringify(filamentIdsNow) === JSON.stringify(snap.filamentIds);
  return { ok: !errs.length && costsMatch && idsMatch, costsMatch, idsMatch, errors: errs };
}

// 4) 造临时分配，验证派生成本 → 卡片重画；finally 立即还原
try {
  const created = await window.shelf.filamentCreate({
    name: '__探针耗材·卡片价·' + Date.now().toString(36) + '__', brand: 'Bambu 拓竹', type: 'PLA', color: '#ffffff', pricePerKg: 120,
  });
  const fid = created && created.id;
  if (fid) createdIds.push(fid);
  const targetId = snap.targetId;
  if (fid && targetId) {
    await window.shelf.modelSetFilaments(targetId, [{ filamentId: fid, weightG: 100 }], null);
    // filaments:changed → emitRefresh('costs') → 重新拉缓存 + 卡片重画
    await waitFor(() => {
      const el = document.querySelector('.card[data-id="' + targetId + '"] .card-price');
      return el && el.getAttribute('data-price') === '12' ? el : null;
    }, 8000);
    const badge = document.querySelector('.card[data-id="' + targetId + '"] .card-price');
    out.afterAssign = {
      text: badge ? badge.textContent.trim() : null,
      dataPrice: badge ? badge.getAttribute('data-price') : null,
      isUnknown: badge ? badge.classList.contains('is-unknown') : null,
    };
  }
} catch (e) { out.assignError = (e && e.message) || String(e); }
finally {
  restoreResult = await restore();
}

out.restored = restoreResult.ok;
out.restoreDetail = { costsMatch: restoreResult.costsMatch, idsMatch: restoreResult.idsMatch, errors: restoreResult.errors };

const badgeOk = out.cardCount > 0 && out.badgeCount === out.cardCount;
const layoutOk = !!out.badgeLayout && out.badgeLayout.inRow &&
  out.badgeLayout.textLeft >= 0 && out.badgeLayout.badgeRight >= 0;
// costs 接口会返回库里全部记录（含普通视图隐藏的 missing），因此不能要求严格等于卡片数。
const batchOk = out.costsIsObject && out.costsEntries >= out.cardCount;
const unknownOk = out.unknownCount + out.knownCount === out.cardCount
  && (out.unknownCount === 0 || out.unknownText === '¥??')
  && (out.knownCount === 0 || /^¥\d/.test(out.knownSample));
const assignOk = !!(out.afterAssign && out.afterAssign.dataPrice === '12' &&
  out.afterAssign.text === '¥12' && out.afterAssign.isUnknown === false);

out.checks = { badgeOk, layoutOk, batchOk, unknownOk, assignOk, restored: restoreResult.ok };
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = restoreResult.ok && !out.toastErrors.length && badgeOk && layoutOk && batchOk && unknownOk && assignOk;
if (!restoreResult.ok) out.error = '成本/耗材数据恢复失败，禁止判定通过';
return out;
