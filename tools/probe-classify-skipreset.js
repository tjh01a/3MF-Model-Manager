/**
 * 走查探针：设置 → 自动分类的「恢复提醒」按钮（docs/15）。
 * 验证三件事：跳过名单非空时按钮出现且文案带数量；点击弹二次确认；确认后名单清空。
 *   node launch.js --capture=data/reg/probe-skipreset.png --ui-script=tools/probe-classify-skipreset.js
 *
 * 数据安全（P0）：写接口仅在完整快照 + finally 恢复的保护下调用。
 *  - 只写 settings.classify.skippedIds（不改模型、不调用 classifyRun）；
 *  - 写前快照用户真实的跳过名单，finally 精确还原并校验，恢复失败让 ok=false。
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

// 等后端和首屏 settings 加载完再快照/写入，否则真实名单会在稍后 bootstrap 时盖回来。
await window.shelf.whenReady();
await sleep(1200);

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

let restoreResult = null;
async function restore() {
  const errs = [];
  try { await window.shelf.settingsUpdate({ classify: { skippedIds: originalSkipped } }); }
  catch (e) { errs.push((e && e.message) || String(e)); }
  const cur = await readSkipped();
  const ok = !errs.length && !!cur && cur.length === originalSkipped.length &&
    cur.every((x, i) => x === originalSkipped[i]);
  return { ok, errors: errs };
}

// 有真实跳过名单就直接用它验证，避免写入与启动期自动分类互相覆盖；空库才造两条假名单。
const expectedSkipped = originalSkipped.length > 0 ? originalSkipped.length : 2;

try {
  // 1. 仅在真实名单为空时造一份假的跳过名单（写前已快照）
  if (originalSkipped.length === 0) {
    await window.shelf.settingsUpdate({ classify: { skippedIds: ['fake-a', 'fake-b'] } });
    await sleep(250);
  }

  // 2. 打开设置 → 自动分类
  const btn = await waitFor(() => q('#btn-settings'), 15000);
  if (!btn) { out.error = '找不到设置按钮'; }
  else {
    btn.click();
    const tab = await waitFor(() => q('#settings-panel [data-tab="classify"]'), 8000);
    if (!tab) out.error = '找不到自动分类 tab';
    else {
      tab.click();
      // 分类区依赖 settings 异步加载，等按钮真正渲染出来
      const reset = await waitFor(() => q('[data-act="classify-skip-reset"]'), 8000);
      out.hasReset = !!reset;
      out.hint = ((document.body.textContent || '').match(/已跳过 \d+ 个模型的分类提醒/) || [''])[0];
      out.hintOk = new RegExp('已跳过 ' + expectedSkipped + ' 个模型的分类提醒').test(out.hint);

      // 3. 点「恢复提醒」→ 应弹二次确认 → 确认后清空
      if (reset) {
        reset.click();
        const okBtn = await waitFor(() => q('[data-role="ok"]'), 5000);
        out.confirmShown = !!okBtn;
        if (okBtn) okBtn.click();
        await sleep(1200);
      }
      const s = await window.shelf.settings();
      out.skippedAfter = ((s && s.classify && s.classify.skippedIds) || []).length;
      out.cleared = out.skippedAfter === 0;

      // 4. 收尾：关掉设置面板
      const close = q('#settings-close');
      if (close) close.click();
    }
  }
} catch (e) {
  out.error = (e && e.message) || String(e);
}
finally {
  // 无论断言成败或中途异常，都先恢复用户真实名单
  restoreResult = await restore();
}

out.restored = restoreResult.ok;
out.restoreErrors = restoreResult.errors;
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = !out.error && restoreResult.ok && !out.toastErrors.length &&
  out.hasReset && out.hintOk && out.confirmShown && out.cleared;
if (!restoreResult.ok) out.error = '跳过名单恢复失败，禁止判定通过';
return out;
