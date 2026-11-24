/**
 * 走查探针：失效/离线打印机可移除 + 一键整理入口。
 *   node launch.js --ui-script=tools/probe-devices-cleanup.js
 *
 * 验证：
 *  1. 卡片来自 snapshot、且不在 printersList 里的离线设备，点「移除设备」也能弹确认框
 *  2. 「移除失效设备」会列出离线设备并二次确认
 *  3. 工具栏有「一键整理设备」「移除失效设备」入口
 * 全程点「取消」，不调用写入接口；只在渲染层内存里注入一台假离线设备。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
async function waitFor(fn, ms = 10000) {
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
const before = JSON.stringify(await window.shelf.printersList());

const btn = await waitFor(() => q('#btn-devices'));
if (!btn) { out.ok = false; out.error = '找不到设备按钮'; return out; }
btn.click();
const panel = await waitFor(() => {
  const p = q('#devices-panel');
  return p && !p.hidden ? p : null;
}, 5000);
if (!panel) { out.ok = false; out.error = '设备面板没打开'; return out; }

out.hasTidyButton = !!panel.querySelector('[data-act="dev-tidy"]');
out.hasRemoveOfflineButton = !!panel.querySelector('[data-act="dev-remove-offline"]');

// 注入一台「只存在于 snapshot」的离线设备：这正是旧版点移除没反应的场景。
const fakeId = 'probe-offline-' + Date.now().toString(36);
window.dispatchEvent(new CustomEvent('printers:update', {
  detail: {
    id: fakeId, kind: 'snapmaker', name: '探针离线机', model: 'Snapmaker U1',
    ip: '192.0.2.250', via: 'lan', online: false, state: 'offline', stateText: '离线',
    job: null, temps: { nozzle: { cur: 0, target: 0 }, bed: { cur: 0, target: 0 }, chamber: null },
    materials: [], fan: null, speed: null, updatedAt: 0, error: '探针：设备离线',
  },
}));

const fakeCard = await waitFor(() => panel.querySelector('.dev-card[data-id="' + fakeId + '"]'));
out.fakeCardRendered = !!fakeCard;
if (!fakeCard) {
  out.ok = false;
  out.error = '注入的离线设备没有渲染成卡片';
  out.toastErrors = Array.from(new Set(toastErrors));
  return out;
}

// 单卡移除：旧版在这里直接 return，根本不弹窗。
const singleBtn = fakeCard.querySelector('[data-act="dev-remove"]');
if (singleBtn) singleBtn.click();
const singleModal = await waitFor(() => {
  const m = q('.modal-backdrop .modal');
  return m && /移除设备/.test((m.querySelector('.modal-title') || {}).textContent || '') ? m : null;
}, 4000);
out.singleRemoveDialog = !!singleModal;
out.singleRemoveShowsTarget = !!singleModal &&
  (singleModal.textContent.includes('探针离线机') || singleModal.textContent.includes(fakeId));
const singleCancel = singleModal && singleModal.querySelector('[data-role="cancel"]');
if (singleCancel) singleCancel.click();
await waitFor(() => !q('.modal-backdrop .modal'), 3000);

// 批量移除：确认清单里要能看见这台离线设备。
const offlineBtn = panel.querySelector('[data-act="dev-remove-offline"]');
if (offlineBtn) offlineBtn.click();
const batchModal = await waitFor(() => {
  const m = q('.modal-backdrop .modal');
  return m && /移除失效设备/.test((m.querySelector('.modal-title') || {}).textContent || '') ? m : null;
}, 4000);
out.batchRemoveDialog = !!batchModal;
out.batchRemoveListsTarget = !!batchModal &&
  (batchModal.textContent.includes('探针离线机') || batchModal.textContent.includes(fakeId));
const batchCancel = batchModal && batchModal.querySelector('[data-role="cancel"]');
if (batchCancel) batchCancel.click();
await waitFor(() => !q('.modal-backdrop .modal'), 3000);

await sleep(200);
out.dataUnchanged = JSON.stringify(await window.shelf.printersList()) === before;
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = out.hasTidyButton && out.hasRemoveOfflineButton && out.fakeCardRendered &&
  out.singleRemoveDialog && out.singleRemoveShowsTarget &&
  out.batchRemoveDialog && out.batchRemoveListsTarget &&
  out.dataUnchanged && out.toastErrors.length === 0;
return out;
