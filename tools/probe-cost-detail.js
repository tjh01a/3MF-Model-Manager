/**
 * 走查探针：模型详情里的「耗材与成本」区块（docs/13）。
 *   node launch.js --capture=docs/screenshots/44-模型成本详情.png --ui-script=tools/probe-cost-detail.js
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

// 造一条测试耗材（若还没有）
let fid = null;
try {
  const lib = await window.shelf.filamentsList();
  let f = (lib.items || []).find((x) => x.name === '__探针耗材·成本用__');
  if (!f) f = await window.shelf.filamentCreate({
    name: '__探针耗材·成本用__', brand: 'Bambu 拓竹', type: 'PLA', color: '#ffffff', pricePerKg: 120,
  });
  fid = f.id;
} catch (e) { out.error = (e && e.message) || String(e); }

// 找一张卡片打开详情（先等网格稳定，避免拿到正在被替换的旧节点）
await waitFor(() => q('.card[data-id]'), 15000);
await sleep(300);
const card = q('.card[data-id]');
if (!card) return { ok: false, error: '没有模型卡片', ...out };
const id = card.dataset.id;
card.click();
// 等详情真的渲染出这个模型，再等成本异步填充完成（.cost-loading 消失才是真的填完）
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

// 验证分配接口能写入并重算（不弹窗，直接走 IPC）
if (fid) {
  try {
    const r = await window.shelf.modelSetFilaments(id, [{ filamentId: fid, weightG: 100 }], null);
    out.assign = { total: r && r.total, parts: r && r.parts && r.parts.length, complete: r && r.complete };
    // 还原：清掉分配并删除测试耗材，不留脏数据（截图里的成本已算完，删耗材不影响截图）
    await window.shelf.modelSetFilaments(id, [], null);
    await window.shelf.filamentRemove(fid);
  } catch (e) { out.assign = { error: (e && e.message) || String(e) }; }
}

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

const costOk = out.cost.exists && out.cost.hasSummary && out.cost.hasBig &&
  out.cost.hasAssign && out.cost.hasWeight;
const assignOk = !!(out.assign && out.assign.total === 12 && out.assign.parts === 1);
out.checks = { costOk, assignOk, positionOk: out.position.inOverviewBand };
out.ok = costOk && assignOk && out.position.inOverviewBand;
return out;
