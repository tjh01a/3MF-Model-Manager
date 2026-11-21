/**
 * 走查探针：「没匹配上分类」弹窗的「全部跳过」记忆（docs/15）。
 *   node launch.js --capture=docs/screenshots/48-全部跳过记忆.png --ui-script=tools/probe-classify-skip.js
 *
 * 验证：
 *  1) 手动触发弹窗（capture 模式不会自动弹），点「全部跳过」；
 *  2) 跳过后 settings.classify.skippedIds 非空，且包含本次展示的全部 id；
 *  3) 再调 classifyRun()，unmatched 不再含这些 id（模拟下次启动不再弹）；
 *  4) 还原跳过名单，不留脏数据（用户的跳过记录保持原样）。
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
const out = {};

// 记下原始 skippedIds，结束时还原
let originalSkipped = [];
try {
  const s = await window.shelf.settings();
  originalSkipped = ((s && s.classify && s.classify.skippedIds) || []).slice();
} catch (e) { out.settingsError = (e && e.message) || String(e); }
out.originalCount = originalSkipped.length;

// 拿当前真实 unmatched（只读）
let run = null;
try { run = await window.shelf.classifyRun(); }
catch (e) { out.runError = (e && e.message) || String(e); }
const unmatched = (run && Array.isArray(run.unmatched)) ? run.unmatched : [];
out.unmatchedBefore = unmatched.length;

if (!unmatched.length) {
  // 没有未匹配项时用假数据验证 UI，但跳过记录会污染真实设置——直接跳过并说明
  out.ok = false;
  out.error = '当前库没有未匹配模型，无法验证；请在有未分类模型时重跑';
  return out;
}

// 手动弹窗（capture 模式不会自动弹）
try { window.__printshelfPromptUnmatched(unmatched); } catch (e) { out.promptError = (e && e.message) || String(e); }
const modal = await waitFor(() => q('.modal [data-cp-skip]') ? q('.modal') : null, 8000);
out.modalShown = !!modal;
out.rows = modal ? modal.querySelectorAll('[data-cp-row]').length : 0;

if (modal) {
  const skipBtn = modal.querySelector('[data-cp-skip]');
  if (skipBtn) skipBtn.click();
  await sleep(700);

  // 读回设置，确认跳过已落盘
  let after = null;
  try { after = await window.shelf.settings(); } catch (_) {}
  const skipped = ((after && after.classify && after.classify.skippedIds) || []);
  out.skippedAfter = skipped.length;
  const shownIds = unmatched.map((x) => x.id);
  out.coversShown = shownIds.every((id) => skipped.includes(id));
  out.coversAll = await (async () => {
    try {
      // 核心口径：全部未匹配都记下（不只弹窗展示的 20 条）
      const r2 = await window.shelf.classifyRun();
      return (r2 && Array.isArray(r2.unmatched) && r2.unmatched.length === 0);
    } catch (_) { return false; }
  })();

  const r3 = await window.shelf.classifyRun().catch(() => null);
  out.unmatchedAfter = r3 && Array.isArray(r3.unmatched) ? r3.unmatched.length : -1;

  // 还原：把原始 skippedIds 写回
  try { await window.shelf.settingsUpdate({ classify: { skippedIds: originalSkipped } }); }
  catch (_) { out.restoreError = true; }
  out.restored = await (async () => {
    try {
      const s2 = await window.shelf.settings();
      const cur = ((s2 && s2.classify && s2.classify.skippedIds) || []);
      return cur.length === originalSkipped.length && cur.every((x, i) => x === originalSkipped[i]);
    } catch (_) { return false; }
  })();

  // 边界：Esc / 点 X 随手关掉弹窗，不该记跳过。再弹一次，直接按 Escape。
  try { window.__printshelfPromptUnmatched(unmatched); } catch (_) {}
  const modal2 = await waitFor(() => q('.modal [data-cp-skip]') ? q('.modal') : null, 8000);
  if (modal2) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(600);
    const s3 = await window.shelf.settings().catch(() => null);
    const cur = ((s3 && s3.classify && s3.classify.skippedIds) || []);
    out.escNoSkip = cur.length === originalSkipped.length;
  } else out.escNoSkip = false;
}

const uiOk = out.modalShown && out.rows === unmatched.length;
const persistOk = out.skippedAfter > out.originalCount && out.coversShown && out.coversAll;
const silentOk = out.unmatchedAfter === 0;
out.checks = { uiOk, persistOk, silentOk,
  restoredOk: out.restored === true, escNoSkip: out.escNoSkip === true };
out.ok = uiOk && persistOk && silentOk && out.restored === true && out.escNoSkip === true;
return out;
