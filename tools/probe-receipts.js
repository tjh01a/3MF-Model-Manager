/**
 * 走查探针：侧栏「已完成打印」→ 打印回执视图（docs/13）。
 *   node launch.js --capture=docs/screenshots/43-完成打印回执.png --ui-script=tools/probe-receipts.js
 *
 * 完全只读：不调用 receiptsClear / receiptsCreate / filamentCreate 等任何写接口，
 * 不造测试回执、不改真实数据。仅用库里已有的真实回执验证视图结构与账本行为：
 *   - 汇总区 4 个统计块、清空按钮、网格或空态；
 *   - 回执时间按中文账本格式「几月几日 时:分 打印完成/失败」显示；
 *   - 每条回执都有「关联模型 / 更换关联」按钮；
 *   - 卡片数 > 0（没有真实回执无法验证，返回 ok:false 并说明，绝不写数据）。
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

// 只读读取真实回执数量（不写、不清理）
let realReceiptCount = 0;
try {
  const before = await window.shelf.receiptsWithModels(200);
  realReceiptCount = (before && before.items) ? before.items.length : 0;
} catch (e) { out.readError = (e && e.message) || String(e); }
out.realReceiptCount = realReceiptCount;

// 点侧栏「已完成打印」
const nav = await waitFor(() => q('#sidebar [data-smart="printed"]'), 15000);
if (!nav) { out.ok = false; out.error = '侧栏没有「已完成打印」入口'; out.toastErrors = toastErrors; return out; }
nav.click();
await waitFor(() => q('#content .rc-summary') ? true : null, 10000);
await sleep(500);

out.view = {
  mode: (window.__shelfState && window.__shelfState.contentMode) || null,
  hasSummary: !!q('#content .rc-summary'),
  statCount: qa('#content .rc-stat').length,
  hasClear: !!q('[data-act="rc-clear"]'),
  hasGridOrEmpty: !!(q('#content .rc-grid') || q('#content .rc-empty')),
  cardCount: qa('#content .rc-card').length,
  title: (q('#view-title') || {}).textContent,
};
out.summaryText = (q('#content .rc-summary') || {}).textContent?.replace(/\s+/g, ' ').trim();

// 账本行为断言（docs/13）：中文时间格式 + 关联按钮存在
const cards = qa('#content .rc-card');
const metaTexts = cards.map((c) => ((c.querySelector('.rc-meta') || {}).textContent || '').replace(/\s+/g, ' ').trim());
out.timeTexts = metaTexts;
// 「几月几日 时:分 打印完成/失败」
const TIME_RE = /\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}\s+(打印完成|打印失败)/;
out.timeFormattedCount = metaTexts.filter((t) => TIME_RE.test(t)).length;
out.hasLinkButtons = cards.length > 0 && cards.every((c) => !!c.querySelector('[data-act="rc-link"]'));
out.cardCount = cards.length;

// 没有真实回执：无法验证账本行为，明确返回失败，绝不写数据
if (out.cardCount === 0) {
  out.ok = false;
  out.error = '当前库没有真实打印回执，无法验证回执视图的账本行为；请完成一次打印后重跑（本探针只读，不会造数据）';
  out.checks = { hasRealReceipts: false };
  out.toastErrors = Array.from(new Set(toastErrors));
  return out;
}

const viewOk = out.view.hasSummary && out.view.statCount === 4 && out.view.hasClear && out.view.hasGridOrEmpty;
const timeOk = out.timeFormattedCount === out.cardCount;
const ledgerOk = out.hasLinkButtons && out.cardCount > 0;
out.checks = {
  hasRealReceipts: realReceiptCount > 0,
  viewOk, timeOk,
  hasLinkButtons: out.hasLinkButtons,
  cardCountPositive: out.cardCount > 0,
};
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = !out.toastErrors.length && viewOk && timeOk && ledgerOk && !out.readError;
return out;
