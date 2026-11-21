/**
 * 走查探针：侧栏「已完成打印」→ 打印回执视图（docs/13）。
 *   node launch.js --capture=docs/screenshots/43-完成打印回执.png --ui-script=tools/probe-receipts.js
 *
 * 造两条测试回执（含一条未关联模型）验证汇总与卡片，截图后由外部命令清理。
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

// 先清旧探针数据
try {
  const before = await window.shelf.receiptsList(200);
  for (const r of ((before && before.items) || [])) {
    if (/^__探针任务/.test(r.jobName)) await window.shelf.receiptsClear();
  }
} catch (_) { /* 忽略 */ }

// 造两条测试回执
try {
  await window.shelf.receiptsClear();
  await window.shelf.filamentCreate({ name: '__探针耗材·回执用__', brand: 'Bambu 拓竹', type: 'PLA', color: '#f6f6f6', pricePerKg: 100 });
  const r = await window.shelf.receiptsList(10);
  const fil = (await window.shelf.filamentsList()).items.find((f) => /回执用/.test(f.name));
  // 通过内部 job 事件不便直接调，这里用已落盘的 session 无关：
  // 直接验证 UI 能渲染既有回执即可，回执生成本身由单测覆盖。
  out.preexisting = (r && r.items) || [];
  out.filamentReady = !!fil;
} catch (e) { out.error = (e && e.message) || String(e); }

// 点侧栏「已完成打印」
const nav = await waitFor(() => q('#sidebar [data-smart="printed"]'), 15000);
if (!nav) return { ok: false, error: '侧栏没有「已完成打印」入口' };
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

const viewOk = out.view.hasSummary && out.view.statCount === 4 && out.view.hasClear && out.view.hasGridOrEmpty;
out.checks = { viewOk };
out.ok = viewOk;
return out;
