/**
 * 走查探针：设备卡片按钮文案清楚 + 危险操作二级验证。
 *   node launch.js --capture=out.png --ui-script=tools/probe-device-labels.js
 *
 * 安全：只点「取消打印」弹开确认框后立刻点「不取消，返回」，不会真的取消任务。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(150);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const out = { checks: {} };

q('#btn-devices').click();
const panel = await waitFor(() => { const p = q('#devices-panel'); return p && !p.hidden ? p : null; }, 8000);
if (!panel) return { ok: false, error: '设备面板没打开' };
const card = await waitFor(() => {
  const cards = qa('#devices-panel .dev-card');
  return cards.find((c) => /快造|Snapmaker/i.test((c.querySelector('.dev-name') || {}).textContent || '')) || null;
}, 12000);
if (!card) return { ok: false, error: '没有快造 U1 卡片' };
const id = card.dataset.id;
const pick = (act) => q('#devices-panel .dev-card[data-id="' + id + '"] [data-act="' + act + '"]');

// ---- 1. 文案：操作对象写在按钮上 ----
const cmdBtns = qa('#devices-panel .dev-card[data-id="' + id + '"] [data-act="dev-cmd"]');
out.buttons = cmdBtns.map((b) => ({
  cmd: b.dataset.cmd,
  text: (b.textContent || '').trim(),
  title: b.getAttribute('title') || '',
}));
const camBtn = pick('dev-cam');
const removeBtn = pick('dev-remove');
out.cam = { text: (camBtn.textContent || '').trim(), title: camBtn.getAttribute('title') || '' };
out.remove = { text: (removeBtn.textContent || '').trim(), title: removeBtn.getAttribute('title') || '' };

const stopBtn = cmdBtns.find((b) => b.dataset.cmd === 'stop');
const pauseBtn = cmdBtns.find((b) => b.dataset.cmd === 'pause');
out.checks.stopLabelClear = !!stopBtn && /取消打印/.test(stopBtn.textContent || '') &&
  /取消/.test(stopBtn.getAttribute('title') || '') && /摄像头/.test(stopBtn.getAttribute('title') || '');
out.checks.pauseLabelClear = !pauseBtn || (/暂停打印/.test(pauseBtn.textContent || '') &&
  /保留|继续/.test(pauseBtn.getAttribute('title') || ''));
out.checks.camLabelClear = /关闭预览|查看摄像头/.test(out.cam.text) &&
  /不影响/.test(out.cam.title);
out.checks.removeLabelClear = /移除设备/.test(out.remove.text) && /本机|PrintShelf/.test(out.remove.title);

// ---- 2. 取消打印：第一道确认要说清后果，取消按钮不能只写「取消」 ----
if (stopBtn) {
  stopBtn.click();
  const modal = await waitFor(() => {
    const ms = qa('.modal');
    return ms.find((m) => /取消打印/.test((m.querySelector('.modal-title') || {}).textContent || '')) || null;
  }, 5000);
  if (modal) {
    out.stopDialog = {
      title: (modal.querySelector('.modal-title') || {}).textContent || '',
      message: (modal.querySelector('.modal-message') || {}).textContent || '',
      detail: (modal.querySelector('.modal-detail') || {}).textContent || '',
      confirm: (modal.querySelector('[data-role="ok"]') || {}).textContent || '',
      cancel: (modal.querySelector('[data-role="cancel"]') || {}).textContent || '',
    };
    out.checks.stopDialogClear = /不可恢复|作废/.test(out.stopDialog.title + out.stopDialog.detail) &&
      /不取消|返回/.test(out.stopDialog.cancel) &&
      /摄像头/.test(out.stopDialog.detail);
    // 安全退出：点「不取消，返回」，绝不进入第二道输入确认
    const cancel = modal.querySelector('[data-role="cancel"]');
    if (cancel) cancel.click();
    await waitFor(() => !qa('.modal').length, 3000);
    out.checks.stopDialogCancelled = !qa('.modal').some((m) => /再次确认/.test(m.textContent || ''));
  } else {
    out.checks.stopDialogClear = false;
    out.checks.stopDialogCancelled = false;
  }
}

// ---- 3. 暂停：确认框说明「暂停的是打印任务」 ----
if (pauseBtn) {
  const fresh = pauseBtn.isConnected ? pauseBtn : await waitFor(() => pick('pause'), 5000);
  out.pauseClick = { found: !!fresh, text: fresh ? (fresh.textContent || '').trim() : '' };
  if (fresh) fresh.click();
  const modal = await waitFor(() => {
    const ms = qa('.modal');
    return ms.find((m) => /暂停打印/.test((m.querySelector('.modal-title') || {}).textContent || '')) || null;
  }, 5000);
  if (modal) {
    out.pauseDialog = {
      title: (modal.querySelector('.modal-title') || {}).textContent || '',
      detail: (modal.querySelector('.modal-detail') || {}).textContent || '',
      cancel: (modal.querySelector('[data-role="cancel"]') || {}).textContent || '',
    };
    out.checks.pauseDialogClear = /打印任务|继续打印/.test(out.pauseDialog.detail) && /不暂停|返回/.test(out.pauseDialog.cancel);
    const cancel = modal.querySelector('[data-role="cancel"]');
    if (cancel) cancel.click();
  } else {
    out.checks.pauseDialogClear = false;
  }
}

out.ok = Object.values(out.checks).every(Boolean);
const close = q('#devices-close');
if (close) close.click();
return out;
