/**
 * 走查探针：重复文件 / 失效文件两个特殊视图的卡片样式（2026-11-19 类名契约修复）。
 * duplicates.js 输出 .dup-item/.dup-items/.dup-group-head 与 .missing-main，
 * 而 CSS 原本只认 .dup-member/.dup-members/.dup-group-title → 卡片完全没有边框与内边距。
 *   node launch.js --capture=data/reg/special.png --ui-script=tools/probe-special-views.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
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

async function openSmart(key) {
  const btn = await waitFor(() => q('#sidebar [data-smart="' + key + '"]'), 8000);
  if (!btn) return false;
  btn.click();
  await sleep(900);
  return true;
}

// ---- 重复文件 ----
out.dupNav = await openSmart('duplicates');
const dup = q('.dup-item');
out.dup = { nav: out.dupNav, hasItem: !!dup };
if (dup) {
  const cs = getComputedStyle(dup);
  const box = dup.getBoundingClientRect();
  const parent = dup.parentElement.getBoundingClientRect();
  out.dup.style = {
    display: cs.display,
    padding: cs.padding,
    borderWidth: cs.borderTopWidth,
    radius: cs.borderRadius,
  };
  out.dup.layout = {
    w: Math.round(box.width),
    insideParent: box.right <= parent.right + 1,
  };
  out.dup.styled = cs.borderTopWidth !== '0px' && parseFloat(cs.paddingLeft) > 0 && cs.display === 'flex';
  out.dup.items = document.querySelectorAll('.dup-item').length;
  out.dup.hasHead = !!q('.dup-group-head');
  const head = q('.dup-group-head');
  out.dup.headStyled = head ? getComputedStyle(head).display === 'flex' : false;
}

// ---- 失效文件 ----
out.missingNav = await openSmart('missing');
const mi = q('.missing-item');
out.missing = { nav: out.missingNav, hasItem: !!mi };
if (mi) {
  const main = q('.missing-item .missing-main');
  const box = mi.getBoundingClientRect();
  const parent = mi.parentElement.getBoundingClientRect();
  out.missing.layout = {
    hasMain: !!main,
    mainGrow: main ? getComputedStyle(main).flexGrow : null,
    insideParent: box.right <= parent.right + 1,
  };
  out.missing.styled = !!main && getComputedStyle(main).display === 'flex';
} else {
  // 没有失效文件是正常状态：只要有空状态文案就算通过
  out.missing.empty = ((q('#content') || {}).textContent || '').length > 0;
}

const dupOk = !!out.dup.hasItem ? (out.dup.styled && out.dup.layout.insideParent && out.dup.headStyled) : true;
const missOk = !!out.missing.hasItem ? (out.missing.styled && out.missing.layout.insideParent) : true;
out.checks = { dupOk, missOk };
out.toastErrors = Array.from(new Set(toastErrors));
out.ok = !out.toastErrors.length && dupOk && missOk;

// 回到全部模型，别把用户留在特殊视图
await openSmart('all');
return out;
