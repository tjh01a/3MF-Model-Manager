/**
 * 走查探针：重量识别与卡片价格（默认耗材计价）
 *   node launch.js --capture=<png> --ui-script=tools/probe-weight-price.js
 *
 * 验证：
 *  1. 库里有多少模型带 meta.weightG（回填是否生效）
 *  2. 有重量 + 有默认耗材 → 卡片显示具体金额而不是 ¥??
 *  3. 没有重量的模型仍然是 ¥??（文件本身没切片数据，属正常）
 *  4. 详情里成本来源标注正确
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  return null;
}

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

await window.shelf.whenReady();
await waitFor(() => qa('#content .card').length > 0);

const all = await window.shelf.query({});
const items = (all && all.items) || [];
const withWeight = items.filter((m) => m && m.meta && m.meta.weightG != null);
out.totalModels = items.length;
out.withWeight = withWeight.length;
out.withLinks = items.filter((m) => m && Array.isArray(m.filamentLinks) && m.filamentLinks.length).length;

const fl = await window.shelf.filamentsList();
out.defaultFilament = fl && fl.defaultId
  ? ((fl.items || []).find((f) => f.id === fl.defaultId) || null)
  : null;
out.hasDefault = !!out.defaultFilament;

// 等成本缓存算完（首屏是异步批量取）
await sleep(1200);

// 卡片价格统计
const cards = qa('#content .card');
out.visibleCards = cards.length;
const priced = cards.filter((c) => {
  const p = c.querySelector('.card-price');
  return p && !p.classList.contains('is-unknown');
});
out.pricedCards = priced.length;
out.unknownCards = cards.length - priced.length;

// 有重量的卡（按可见卡里能对上 id 的）
const pricedIds = new Set(priced.map((c) => c.dataset.id));
out.weightedAndPriced = withWeight.filter((m) => pricedIds.has(m.id)).length;

// 打开一张有重量、且有价格的卡，检查详情来源
const target = withWeight.find((m) => pricedIds.has(m.id)) || withWeight[0];
if (target) {
  const card = cards.find((c) => c.dataset.id === target.id);
  if (card) card.click();
  await waitFor(() => q('#detail') && !q('#detail').hidden);
  await sleep(900);
  const costBox = q('#detail-cost');
  out.detailCostText = costBox ? costBox.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  out.detailHasSource = /按默认耗材估算|已分配耗材|切片文件自动提取/.test(out.detailCostText);
  out.detailHasAmount = /¥\s*\d/.test(out.detailCostText);
}

out.toastErrors = Array.from(new Set(toastErrors));
out.ok = !out.toastErrors.length && out.withWeight > 0 && out.hasDefault && out.pricedCards > 0 &&
  out.detailHasSource && out.detailHasAmount;
return out;
