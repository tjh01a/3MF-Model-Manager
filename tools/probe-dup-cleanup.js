/**
 * 走查探针：重复文件「一键清除（每组留一个）」
 *   PRINTSHELF_DATA_DIR=data/audit-shadow node launch.js \
 *     --capture=data/audit-probes2/probe-dup-cleanup.png --ui-script=tools/probe-dup-cleanup.js
 *
 * 数据安全（P0）：本探针**只点开确认框再取消**，绝不确认执行，
 * 不调用 api.trash / api.remove，不会移动或删除任何磁盘文件。
 *
 * 验证：
 *  1. 重复视图顶部出现「一键清除 · 每组留 1 个（N）」，N 与独立计算的冗余数一致
 *  2. 点击后弹出确认框，标题/说明包含组数与文件数，且列出「保留哪个」
 *  3. 取消后库里的重复组数量不变（确认框没写数据）
 *  4. 全程没有 error toast
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

// 与页面同一口径独立算一遍：只统计磁盘还在的副本，疑似重复不算
function planOf(items) {
  const map = new Map();
  for (const m of items) {
    if (!m || !m.duplicateGroup) continue;
    if (m.status === 'missing' || m.status === 'error') continue;
    if (!map.has(m.duplicateGroup)) map.set(m.duplicateGroup, []);
    map.get(m.duplicateGroup).push(m);
  }
  let groups = 0;
  let extras = 0;
  for (const g of map.values()) {
    if (g.length < 2) continue;
    groups += 1;
    extras += g.length - 1;
  }
  return { groups, extras };
}

await window.shelf.whenReady();
await waitFor(() => qa('#content .card').length > 0);

const before = await window.shelf.query({});
const beforePlan = planOf((before && before.items) || []);
out.expectedGroups = beforePlan.groups;
out.expectedExtras = beforePlan.extras;

// 进入「重复文件」视图
const nav = q('#sidebar [data-smart="duplicates"]');
out.navExists = !!nav;
if (nav) nav.click();
await waitFor(() => q('#content .special-head'));
await sleep(300);

const btn = q('#content [data-act="sp-clean-all"]');
out.buttonExists = !!btn;
out.buttonLabel = btn ? String(btn.textContent || '').replace(/\s+/g, ' ').trim() : '';
const mCount = /（(\d+)）/.exec(out.buttonLabel);
out.labelCount = mCount ? Number(mCount[1]) : null;

if (!btn) {
  // 没有可清理的重复时不应该出现按钮；此时这条走查没有可验行为，明确说明而不是假绿
  out.skipped = '当前库没有可一键清除的重复组';
  out.ok = out.expectedExtras === 0 && !toastErrors.length;
  out.toastErrors = Array.from(new Set(toastErrors));
  return out;
}

// 点开确认框（不确认）
btn.click();
const dlg = await waitFor(() => q('.modal-backdrop .modal'));
out.dialogShown = !!dlg;
out.dialogTitle = dlg ? String((dlg.querySelector('.modal-title') || {}).textContent || '').trim() : '';
out.dialogText = dlg ? String((dlg.querySelector('.modal-body') || {}).textContent || '').replace(/\s+/g, ' ').trim() : '';
out.dialogMentionsGroups = out.dialogText.includes(String(out.expectedGroups));
out.dialogMentionsFiles = out.dialogText.includes(String(out.expectedExtras));
out.dialogShowsKeepRule = out.dialogText.includes('保留');
out.dialogMentionsSimilarExcluded = out.dialogText.includes('疑似');
out.dialogHasList = !!(dlg && dlg.querySelector('.modal-body .modal-items .modal-item'));

// 取消：确认框 resolve(false)，cleanupAll 直接 return，不写任何数据
const cancel = dlg ? dlg.querySelector('.modal-foot [data-role="cancel"]') : null;
out.cancelExists = !!cancel;
if (cancel) cancel.click();
await sleep(500);

const after = await window.shelf.query({});
const afterPlan = planOf((after && after.items) || []);
out.groupsUnchanged = afterPlan.groups === beforePlan.groups;
out.extrasUnchanged = afterPlan.extras === beforePlan.extras;
out.modalClosed = !q('.modal-backdrop .modal');

out.toastErrors = Array.from(new Set(toastErrors));
out.ok = out.navExists && out.buttonExists &&
  out.labelCount === out.expectedExtras &&
  out.dialogShown && out.dialogMentionsGroups && out.dialogMentionsFiles &&
  out.dialogShowsKeepRule && out.dialogMentionsSimilarExcluded &&
  out.cancelExists && out.groupsUnchanged && out.extrasUnchanged &&
  out.modalClosed && !out.toastErrors.length;
return out;
