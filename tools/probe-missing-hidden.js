/**
 * 走查探针：源文件被删后从普通视图消失（不做「已失效」展示）
 *   node launch.js --capture=<png> --ui-script=tools/probe-missing-hidden.js
 *
 * 验证：
 *  1. 普通视图里没有 status=missing 的记录，也没有「失效」徽标
 *  2. 页头「模型总数」与列表总数一致（失效不参与计数）
 *  3. 侧栏「全部模型」徽标与列表总数一致
 *  4. 「失效文件」维护视图仍能列出这些记录（可重新定位 / 移出索引）
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
out.queryTotal = all && all.total;
out.itemsWithMissing = items.filter((m) => m && m.status === 'missing').length;

out.cardCount = qa('#content .card').length;
out.missingBadges = qa('#content .card .badge-warn').filter((b) => b.textContent.trim() === '失效').length;

// 页头统计（模型总数）
const statCells = qa('#stats-bar .stat, #stats-cells .stat');
let statTotal = null;
let statHasMissingLabel = false;
for (const c of statCells) {
  const label = (c.querySelector('.stat-label') || {}).textContent || '';
  const value = (c.querySelector('.stat-value') || {}).textContent || '';
  if (label.trim() === '模型总数') statTotal = Number(value);
  if (label.includes('失效')) statHasMissingLabel = true;
}
out.statTotal = statTotal;
out.statHasMissingLabel = statHasMissingLabel;

// 侧栏「全部模型」徽标
const allNav = q('#sidebar [data-smart="all"]');
out.sidebarAllBadge = allNav ? Number(((allNav.querySelector('.nav-count') || {}).textContent || '0')) : null;

// 2026-11-26 用户要求去掉侧栏「失效文件」入口：这里断言入口不存在，
// 同时下面的 itemsWithMissing / missingBadges 仍要保证失效记录不混进主页。
const missingNav = q('#sidebar [data-smart="missing"]');
out.missingNavExists = !!missingNav;
out.missingViewWorks = !missingNav;

// 卡片数会少于总数：内容相同的重复文件主页只显示一张（折叠），这里按同样的口径算期望值
const byGroup = new Map();
for (const m of items) {
  if (!m || !m.duplicateGroup) continue;
  byGroup.set(m.duplicateGroup, (byGroup.get(m.duplicateGroup) || 0) + 1);
}
let foldedHidden = 0;
for (const n of byGroup.values()) if (n > 1) foldedHidden += n - 1;
out.expectedCards = out.queryTotal - foldedHidden;
out.cardCountMatches = out.cardCount === out.expectedCards;
out.consistent = out.cardCountMatches &&
  (out.statTotal == null || out.statTotal === out.queryTotal) &&
  (out.sidebarAllBadge == null || out.sidebarAllBadge === out.queryTotal);
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = !out.toastErrors.length && out.itemsWithMissing === 0 && out.missingBadges === 0 &&
  !out.statHasMissingLabel && out.consistent && out.missingViewWorks;
return out;
