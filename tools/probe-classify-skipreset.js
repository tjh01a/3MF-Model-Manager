/**
 * 走查探针：设置 → 自动分类的「恢复提醒」按钮（docs/15）。
 * 验证三件事：跳过名单非空时按钮出现且文案带数量；点击弹二次确认；确认后名单清空。
 *   node launch.js --capture=data/reg/probe-skipreset.png --ui-script=tools/probe-classify-skipreset.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const out = {};

try {
  // 1. 造一份假的跳过名单（不碰真实模型）
  await window.shelf.settingsUpdate({ classify: { skippedIds: ['fake-a', 'fake-b'] } });
  await sleep(250);

  // 2. 打开设置 → 自动分类
  const btn = await waitFor(() => q('#btn-settings'), 15000);
  if (!btn) return { ok: false, error: '找不到设置按钮' };
  btn.click();
  const tab = await waitFor(() => q('#settings-panel [data-tab="classify"]'), 8000);
  if (!tab) return { ok: false, error: '找不到自动分类 tab' };
  tab.click();

  // 分类区依赖 settings 异步加载，等按钮真正渲染出来
  const reset = await waitFor(() => q('[data-act="classify-skip-reset"]'), 8000);
  out.hasReset = !!reset;
  out.hint = ((document.body.textContent || '').match(/已跳过 \d+ 个模型的分类提醒/) || [''])[0];
  out.hintOk = /已跳过 2 个/.test(out.hint);

  // 3. 点「恢复提醒」→ 应弹二次确认 → 确认后清空
  if (reset) {
    reset.click();
    const okBtn = await waitFor(() => q('[data-role="ok"]'), 5000);
    out.confirmShown = !!okBtn;
    if (okBtn) okBtn.click();
    await sleep(1200);
  }
  const s = await window.shelf.settings();
  out.skippedAfter = ((s.classify && s.classify.skippedIds) || []).length;
  out.cleared = out.skippedAfter === 0;

  // 4. 收尾：关掉设置面板，确保名单确实为空
  const close = q('#settings-close');
  if (close) close.click();
  await window.shelf.settingsUpdate({ classify: { skippedIds: [] } });
} catch (e) {
  out.error = (e && e.message) || String(e);
}

out.ok = !out.error && out.hasReset && out.hintOk && out.confirmShown && out.cleared;
return out;
