/**
 * 走查探针：回执「自动关联」——名字大致匹配（分盘/分批后缀会被忽略）。
 *   node tools/make-receipt-fixture.js
 *   PRINTSHELF_DATA_DIR=data/audit-receipt node launch.js \
 *     --capture=data/probe.png --ui-script=tools/probe-receipts-autolink.js
 *
 * 只在该夹具目录上跑：它会真的写 receipts.json（把 modelId 关联上）。
 * 夹具设计：2 条应匹配成功、1 条不该乱连。
 *
 * 验证：
 *  1. 未关联时出现「自动关联（3）」
 *  2. 点击后 2 条匹配上、1 条留空，toast 报「已自动关联 2 条」
 *  3. 匹配结果分别是 沙奈朵拆(3) / 组合体，且和「名字相近但不同」的模型不串
 *  4. linkedManually 保持 false（自动关联不是用户手点）
 *  5. 全程 toastErrors 为空
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
const toastErrors = [];
const toasts = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!n || n.nodeType !== 1) continue;
      const t = n.classList && n.classList.contains('toast') ? n : n.querySelector('.toast');
      if (t) {
        const msg = t.querySelector('.toast-message');
        toasts.push((msg ? msg.textContent : '').trim());
      }
      const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
      if (bad) {
        const msg = bad.querySelector('.toast-message');
        toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
      }
    }
  }).observe(toastBox, { childList: true });
}

await window.shelf.whenReady();
await waitFor(() => q('#sidebar [data-smart="printed"]'));

// 进入「已完成打印」（回执视图）
const nav = q('#sidebar [data-smart="printed"]');
out.navExists = !!nav;
if (nav) nav.click();
await waitFor(() => q('#content .rc-card'));
await sleep(300);

out.cardCount = qa('#content .rc-card').length;
const btn = q('#content [data-act="rc-autolink"]');
out.buttonExists = !!btn;
out.buttonLabel = btn ? String(btn.textContent || '').replace(/\s+/g, ' ').trim() : '';
const mCount = /（(\d+)）/.exec(out.buttonLabel);
out.buttonCount = mCount ? Number(mCount[1]) : null;

if (!btn) {
  out.ok = false;
  out.error = '未关联回执存在时没有出现「自动关联」按钮';
  out.toastErrors = Array.from(new Set(toastErrors));
  return out;
}

btn.click();
await waitFor(() => toasts.some((t) => /自动关联|没有可以/.test(t)), 12000);
await sleep(900);

const list = await window.shelf.receiptsList();
const byName = {};
for (const r of (list && list.items) || []) byName[r.jobName] = r;
out.sanaLinkedTo = (byName['沙奈朵拆(3)_plate_2'] || {}).modelTitle || null;
out.zutiLinkedTo = (byName['组合体_PETG_6h4m.gcode'] || {}).modelTitle || null;
out.unmatchedStaysEmpty = !(byName['厨房收纳盒_v3_plate_1'] || {}).modelId;
out.noManualFlag = ((list && list.items) || [])
  .filter((r) => r.modelId).every((r) => r.linkedManually === false);

const btnAfter = q('#content [data-act="rc-autolink"]');
out.remainingButtonLabel = btnAfter ? String(btnAfter.textContent || '').replace(/\s+/g, ' ').trim() : '';
out.buttonShowsRemaining = /（1）/.test(out.remainingButtonLabel);

out.toasts = toasts;
out.successToast = toasts.some((t) => /已自动关联 2 条/.test(t));
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = out.navExists && out.buttonExists && out.buttonCount === 3 &&
  out.sanaLinkedTo === '沙奈朵拆(3)' && out.zutiLinkedTo === '组合体' &&
  out.unmatchedStaysEmpty && out.noManualFlag && out.successToast &&
  out.buttonShowsRemaining && !out.toastErrors.length;
return out;
