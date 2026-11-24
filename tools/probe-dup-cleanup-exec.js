/**
 * 走查探针（会真的执行一次清理）：验证「一键清除 · 每组留 1 个」的保留规则与删除范围。
 *   PRINTSHELF_DATA_DIR=data/audit-dup node launch.js \
 *     --capture=data/audit-probes2/probe-dup-cleanup-exec.png \
 *     --ui-script=tools/probe-dup-cleanup-exec.js
 *
 * 只能在 tools/probe-tmp/make-dup-fixture.js 生成的临时库上跑：
 * 它会真的把多余副本移入系统回收站（可恢复），绝不要在真实库上执行。
 *
 * 期望（fixture 设计）：
 *  - g1：a-copy 有备注+评分 → 保留 a-copy，删 a
 *  - g2：两个都没有人工信息 → 保留最早入库的 b，删 b-copy
 *  - 清理后：模型总数 2、重复组 0、剩下的 id 是 probe-a-copy 与 probe-b
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
async function waitFor(fn, ms = 20000) {
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
await waitFor(() => q('#content .card, #content .special-head'));

const before = await window.shelf.query({});
out.beforeTotal = before && before.total;

const nav = q('#sidebar [data-smart="duplicates"]');
out.navExists = !!nav;
if (nav) nav.click();
await waitFor(() => q('#content [data-act="sp-clean-all"]'));
await sleep(250);

const btn = q('#content [data-act="sp-clean-all"]');
out.buttonLabel = btn ? String(btn.textContent || '').replace(/\s+/g, ' ').trim() : '';
if (!btn) {
  out.ok = false;
  out.error = '重复视图没有出现「一键清除」按钮';
  out.toastErrors = Array.from(new Set(toastErrors));
  return out;
}

btn.click();
const dlg = await waitFor(() => q('.modal-backdrop .modal'));
out.dialogShown = !!dlg;
out.dialogText = dlg ? String((dlg.querySelector('.modal-body') || {}).textContent || '').replace(/\s+/g, ' ').trim() : '';
// 规则应体现在清单里：g1 保留带备注的 a-copy
out.dialogKeepsAnnotated = out.dialogText.includes('a-copy.3mf');
out.dialogKeepsEarliest = out.dialogText.includes('b.3mf');

const okBtn = dlg ? dlg.querySelector('.modal-foot [data-role="ok"]') : null;
out.okButtonExists = !!okBtn;
if (okBtn) okBtn.click();

await waitFor(() => !q('.modal-backdrop .modal'));
await sleep(1200);

const after = await window.shelf.query({});
const ids = ((after && after.items) || []).map((m) => m.id).sort();
out.afterTotal = after && after.total;
out.afterIds = ids;
out.keptAnnotatedCopy = ids.includes('probe-a-copy') && !ids.includes('probe-a');
out.keptEarliest = ids.includes('probe-b') && !ids.includes('probe-b-copy');

const counts = await window.shelf.smartCounts();
out.dupCountAfter = counts && typeof counts.duplicates === 'number' ? counts.duplicates : null;
out.toasts = toasts;
out.successToast = toasts.some((t) => /已清理/.test(t));
out.toastErrors = Array.from(new Set(toastErrors));

out.ok = out.navExists && out.dialogShown && out.okButtonExists &&
  out.dialogKeepsAnnotated && out.dialogKeepsEarliest &&
  out.afterTotal === 2 && out.keptAnnotatedCopy && out.keptEarliest &&
  out.successToast && !out.toastErrors.length;
return out;
