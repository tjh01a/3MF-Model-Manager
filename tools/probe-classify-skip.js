/**
 * 走查探针：「没匹配上分类」弹窗的「全部跳过」记忆（docs/15）。
 *   node launch.js --capture=docs/screenshots/48-全部跳过记忆.png --ui-script=tools/probe-classify-skip.js
 *
 * 验证：
 *  1) 手动触发弹窗（capture 模式不会自动弹），点「全部跳过」；
 *  2) 跳过后 settings.classify.skippedIds 非空，且包含本次展示的全部 id；
 *  3) 这些 id 已进入「不再提醒」名单（只读核验，不再调用会写库的 classifyRun）；
 *  4) 还原跳过名单，用户的真实记录保持原样，恢复失败让 ok=false。
 *
 * 数据安全（P0）：
 *  - 不调用 classifyRun()：该 IPC 以 force:true 运行，可能真的给模型写入分类，
 *    属于无法安全恢复的写操作，改用只读方式核验「不再提醒」状态；
 *  - 弹窗用的 unmatched 数组由 query({}) 的未分类模型只读构造，不写库；
 *  - 点「全部跳过」只写 settings.classify.skippedIds，写前快照、finally 精确还原。
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

const readSkipped = async () => {
  try {
    const s = await window.shelf.settings();
    return ((s && s.classify && s.classify.skippedIds) || []).slice();
  } catch (e) { out.settingsError = (e && e.message) || String(e); return null; }
};

// 写前快照（只读）
const originalSkipped = await readSkipped();
if (originalSkipped === null) {
  out.ok = false; out.error = '无法读取原始跳过名单，放弃写入'; out.toastErrors = toastErrors; return out;
}
out.originalCount = originalSkipped.length;

// 只读构造 unmatched：库里的未分类模型（用于弹窗展示；真正跳过名单由服务端按规则算）
let unmatched = [];
try {
  const items = ((await window.shelf.query({})) || {}).items || [];
  unmatched = items.filter((m) => m && !m.categoryId).slice(0, 20)
    .map((m) => ({ id: m.id, title: m.title || m.fileName || m.id, thumbnail: m.thumbnail || null }));
} catch (e) { out.queryError = (e && e.message) || String(e); }
out.unmatchedBefore = unmatched.length;

if (!unmatched.length) {
  out.ok = false;
  out.error = '当前库没有未分类模型，无法验证「全部跳过」；请在有未分类模型时重跑（本探针不调用会写库的 classifyRun）';
  out.toastErrors = toastErrors;
  return out;
}

let restoreResult = null;
async function restore() {
  const errs = [];
  try { await window.shelf.settingsUpdate({ classify: { skippedIds: originalSkipped } }); }
  catch (e) { errs.push((e && e.message) || String(e)); }
  const cur = await readSkipped();
  const ok = !errs.length && !!cur && cur.length === originalSkipped.length &&
    cur.every((x, i) => x === originalSkipped[i]);
  return { ok, errors: errs, current: cur };
}

try {
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
    const skipped = (await readSkipped()) || [];
    out.skippedAfter = skipped.length;
    const shownIds = unmatched.map((x) => x.id);
    out.coversShown = shownIds.every((id) => skipped.includes(id));
    // 已经全部跳过过时，点击「全部跳过」是幂等的（人数不增加也正常），不算失败。
    out.alreadySkipped = out.coversShown && out.skippedAfter === out.originalCount;

    // 「下次不再提醒」的只读核验：跳过名单已包含全部展示 id，
    // 这正是 classifyUncategorized 生成 unmatched 时剔除它们的依据（docs/15）。
    // 不再调用 classifyRun()（force:true 会写库，无法安全恢复）。
    out.silentBySkipList = out.coversShown;
    out.unmatchedAfter = '未调用 classifyRun（只读探针）';

    // 边界：Esc / 点 X 随手关掉弹窗，不该记跳过。再弹一次，直接按 Escape。
    try { window.__printshelfPromptUnmatched(unmatched); } catch (_) {}
    const modal2 = await waitFor(() => q('.modal [data-cp-skip]') ? q('.modal') : null, 8000);
    if (modal2) {
      const beforeEsc = (await readSkipped()) || [];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(600);
      const afterEsc = (await readSkipped()) || [];
      out.escNoSkip = JSON.stringify(beforeEsc) === JSON.stringify(afterEsc);
    } else out.escNoSkip = false;
  }
} finally {
  restoreResult = await restore();
}

out.restored = restoreResult.ok;
out.restoreErrors = restoreResult.errors;

const uiOk = out.modalShown && out.rows === unmatched.length;
const persistOk = (out.skippedAfter >= out.originalCount) && out.coversShown;
out.checks = {
  uiOk, persistOk, silentBySkipList: !!out.silentBySkipList,
  restoredOk: restoreResult.ok, escNoSkip: out.escNoSkip === true,
};
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = restoreResult.ok && !out.toastErrors.length && uiOk && persistOk &&
  !!out.silentBySkipList && out.escNoSkip === true;
if (!restoreResult.ok) out.error = '跳过名单恢复失败，禁止判定通过';
return out;
