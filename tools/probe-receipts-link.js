/**
 * 走查探针：打印回执账本化展示与「关联模型」入口。
 *   node launch.js --capture=<png> --ui-script=tools/probe-receipts-link.js
 *
 * 验证：
 *  1. 回执时间显示为「几月几日 时:分 打印完成/失败」
 *  2. 每条回执有关联 / 更换关联按钮，点击后打开可搜索的模型选择器
 *  3. 搜索能过滤模型，取消不写数据、不进编辑模式
 * 全程只打开再关闭弹窗，不调用 receiptsLinkModel，不改动真实回执。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
async function waitFor(fn, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(100);
  }
  return null;
}

const out = {};
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
const before = JSON.stringify(await window.shelf.receiptsWithModels(200));

const nav = await waitFor(() => q('#sidebar [data-smart="printed"]'));
if (!nav) { out.ok = false; out.error = '没有「已完成打印」入口'; return out; }
nav.click();
await waitFor(() => q('#content .rc-summary'));
await sleep(300);

const cards = qa('#content .rc-card');
out.cardCount = cards.length;
if (!cards.length) {
  out.ok = false;
  out.error = '没有真实回执可验证（关联选择器用真实回执进入，避免写数据）';
  out.toastErrors = toastErrors;
  return out;
}

const card = cards[0];
const metaText = (card.querySelector('.rc-meta') || {}).textContent || '';
out.timeText = metaText.trim();
out.timeLikeLedger = /\d+月\d+日\s+\d{1,2}:\d{2}\s+(打印完成|打印失败)/.test(out.timeText);

const linkBtn = card.querySelector('[data-act="rc-link"]');
out.hasLinkButton = !!linkBtn;
out.linkLabel = linkBtn ? linkBtn.textContent.trim() : '';
if (!linkBtn) {
  out.ok = false;
  out.error = '回执卡片没有「关联模型 / 更换关联」按钮';
  out.toastErrors = toastErrors;
  return out;
}

linkBtn.click();
const picker = await waitFor(() => q('.modal .rc-picker'));
out.pickerOpened = !!picker;
if (picker) {
  const input = picker.querySelector('[data-role="q"]');
  const rows = Array.from(picker.querySelectorAll('.rc-pick[data-id]'));
  out.pickerRows = rows.length;
  out.hasSearch = !!input;

  if (input && rows.length) {
    const label = (rows[0].querySelector('strong') || {}).textContent || '';
    const token = label.trim().split(/\s+/)[0].slice(0, 4);
    input.value = token;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    out.searchToken = token;
    out.visibleAfterSearch = rows.filter((r) => !r.hidden).length;
    out.searchWorks = out.visibleAfterSearch > 0 && out.visibleAfterSearch <= rows.length;
  }

  const cancel = q('.modal [data-role="cancel"]');
  if (cancel) cancel.click();
  await waitFor(() => !q('.modal .rc-picker'));
}
out.pickerClosed = !q('.modal .rc-picker');
out.stayedOutOfEditMode = !document.body.classList.contains('edit-mode');

await sleep(200);
out.dataUnchanged = JSON.stringify(await window.shelf.receiptsWithModels(200)) === before;
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = out.timeLikeLedger && out.hasLinkButton && out.pickerOpened && out.pickerClosed &&
  out.hasSearch && out.pickerRows > 0 && out.searchWorks && out.stayedOutOfEditMode &&
  out.dataUnchanged && out.toastErrors.length === 0;
return out;
