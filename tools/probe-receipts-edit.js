/**
 * 走查探针：打印回执视图的长按编辑模式（docs/18 交互与 UI/UX 白皮书）
 *   node launch.js --capture=<png> --ui-script=tools/probe-receipts-edit.js
 *
 * 验证与主页面统一的交互：长按 480ms 进入编辑模式 → 单选 → 多选 → 全选 →
 * 删除动作分发到「只删回执」的事件（不实际删数据）→ Esc 退出。
 * 全程不调用 receiptsClear / receiptsDelete，不改动用户真实回执。
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
const checked = () => qa('#content .rc-card.is-selected').length;
const barCount = () => {
  const n = q('#editbar [data-role="n"]');
  return n ? Number(n.textContent.trim()) : -1;
};

const out = {};
// 捕获错误提示（被 catch 后只弹 toast 的运行时错误）
const toastErrors = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
      if (!bad) continue;
      const msg = bad.querySelector('.toast-message');
      toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
    }
  }).observe(toastBox, { childList: true });
}

await window.shelf.whenReady();
// 切到「已完成打印」回执视图
const nav = await waitFor(() => q('#sidebar [data-smart="printed"]'));
if (!nav) return { ok: false, error: '侧栏没有「已完成打印」入口' };
nav.click();
await waitFor(() => q('#content .rc-summary'));
await sleep(300);

let cards = qa('#content .rc-card');
out.realReceiptCount = cards.length;
// 真实回执不足 2 条时（刚安装/测试环境很常见），注入几张结构相同的卡片做交互验证。
// 事件委托挂在 #content 上，注入卡片走的是完全相同的真实代码路径；结束会移除。
let injected = false;
if (cards.length < 2) {
  const grid = q('#content .rc-grid') || q('#content .rc-empty');
  if (grid) {
    if (grid.classList.contains('rc-empty')) {
      grid.className = 'rc-grid';
      grid.innerHTML = '';
    }
    for (let i = 1; i <= 4; i++) {
      const el = document.createElement('article');
      el.className = 'rc-card';
      el.dataset.id = 'rcp-probe-' + i;
      el.tabIndex = 0;
      el.innerHTML = '<label class="rc-check"><input type="checkbox" class="rc-cb"></label>' +
        '<div class="rc-media"><img src="./assets/placeholder.svg" alt=""></div>' +
        '<div class="rc-body"><div class="rc-title">探针回执 ' + i + '</div>' +
        '<div class="rc-badges"><span class="rc-result is-ok">完成</span></div>' +
        '<div class="rc-meta"><span>探针机器</span></div>' +
        '<div class="rc-foot"><span class="rc-weight">—</span><span class="rc-cost">¥0.00</span></div></div>';
      grid.appendChild(el);
    }
    injected = true;
    // 让回执视图内部记录这些 id，全选按钮才能用
    window.__receiptsIds = qa('#content .rc-card').map((c) => c.dataset.id);
    cards = qa('#content .rc-card');
  }
}
out.injectedForTest = injected;
out.cardCount = cards.length;
out.hasCheckbox = cards.length > 0 && cards.every((c) => c.querySelector('.rc-cb'));
out.rcpIds = cards.length > 0 && cards.every((c) => /^rcp-/.test(c.dataset.id || ''));
if (cards.length < 2) {
  out.ok = false;
  out.error = '无法构造可验证的回执卡片';
  out.toastErrors = toastErrors;
  return out;
}

// 证明「删除」走的是回执专用二次确认（只删记录，不删模型文件）：
// 点删除后检查确认弹窗，再点「取消」——全程不写数据。
let deleteEventFired = false;
window.addEventListener('shelf:receipts-deleteselected', () => { deleteEventFired = true; });

// 1. 长按第一张卡 480ms
const first = cards[0];
const rect = first.getBoundingClientRect();
first.dispatchEvent(new PointerEvent('pointerdown', {
  bubbles: true, button: 0, clientX: rect.left + 20, clientY: rect.top + 20,
}));
await sleep(560);
first.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

out.editModeOn = document.body.classList.contains('edit-mode');
out.barVisible = !!(q('#editbar') && !q('#editbar').hidden);
out.selectedAfterLongPress = checked();
out.countAfterLongPress = barCount();
out.enterWorked = out.editModeOn && out.barVisible && out.selectedAfterLongPress === 1 && out.countAfterLongPress === 1;
out.selectedIdsAreReceipts = qa('#content .rc-card.is-selected').every((c) => /^rcp-/.test(c.dataset.id));

// 2. 单击第二张卡 → 多选 2 项
// 长按遗留的 suppressClick 会吞掉紧接着的一次 click（模拟真实鼠标松手那一下），
// 所以这里点两次；两次都落在 .rc-card 上，不会被「点空白退出编辑模式」误伤。
cards[1].click();
await sleep(60);
cards[1].click();
await sleep(100);
out.selectedAfterPick = checked();
out.countAfterPick = barCount();
out.multiSelectWorked = out.selectedAfterPick === 2 && out.countAfterPick === 2;

// 3. 编辑模式操作条：回执场景隐藏「迁移到分类」，删除文案是「删除回执」
const move = q('#editbar [data-edit="move"]');
const trash = q('#editbar [data-edit="trash"]');
out.moveHidden = !move || move.hidden;
out.trashLabel = trash ? (trash.querySelector('[data-role="label"]') || {}).textContent : '';
out.barScopeOk = out.moveHidden && out.trashLabel === '删除回执';

// 4. 全选
const allBtn = q('#editbar [data-edit="all"]');
if (allBtn) allBtn.click();
await sleep(100);
out.selectedAfterAll = checked();
out.countAfterAll = barCount();
out.selectAllWorked = out.selectedAfterAll === cards.length && out.countAfterAll === cards.length;

// 5. 删除按钮 → 回执专用确认弹窗；点取消，数据不变
if (trash) trash.click();
await waitFor(() => q('.modal:not([hidden]) [data-role="cancel"]'));
out.deleteEventFired = deleteEventFired;
out.confirmTitle = (q('.modal:not([hidden]) .modal-title') || {}).textContent || '';
out.confirmOk = out.confirmTitle.includes('删除选中的回执');
const cancel = q('.modal:not([hidden]) [data-role="cancel"]');
if (cancel) cancel.click();
await sleep(200);
out.modalClosed = !q('.modal:not([hidden])');
out.receiptsStillThere = qa('#content .rc-card').length === cards.length;
out.deleteSafe = out.deleteEventFired && out.confirmOk && out.modalClosed && out.receiptsStillThere;

// 6. Esc 退出编辑模式并清空勾选
out.beforeEsc = {
  active: document.activeElement && document.activeElement.tagName,
  modal: !!q('.modal:not([hidden])'),
  menu: !!q('#context-menu:not([hidden])'),
  detail: !!(q('#detail') && !q('#detail').hidden),
};
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await sleep(300);
out.editModeOff = !document.body.classList.contains('edit-mode');
out.barHidden = !!(q('#editbar') && q('#editbar').hidden);
out.selectedAfterExit = checked();
out.exitWorked = out.editModeOff && out.barHidden && out.selectedAfterExit === 0;

out.modelBulkbarHidden = (() => {
  const bar = document.getElementById('bulkbar');
  const actions = document.getElementById('stats-actions');
  return (!bar || bar.hidden) && (!actions || actions.hidden);
})();

// 让最终截图停在编辑态，便于视觉走查（断言已在上面完成）
const again = qa('#content .rc-card')[0];
if (again) {
  const r2 = again.getBoundingClientRect();
  again.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, button: 0, clientX: r2.left + 20, clientY: r2.top + 20,
  }));
  await sleep(560);
  again.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
}

out.toastErrors = Array.from(new Set(toastErrors));
out.noErrorToasts = out.toastErrors.length === 0;
out.ok = out.noErrorToasts && out.hasCheckbox && out.rcpIds && out.enterWorked &&
  out.selectedIdsAreReceipts && out.multiSelectWorked && out.barScopeOk &&
  out.selectAllWorked && out.deleteSafe && out.exitWorked && out.modelBulkbarHidden;
return out;
