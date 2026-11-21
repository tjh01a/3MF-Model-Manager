'use strict';
/**
 * 卡片上「用切片软件打开」按钮的悬停选择层。
 *
 * 为什么不用纯 CSS 下拉：卡片里的 .card-media 有 overflow:hidden（用来裁图片圆角），
 * 下拉菜单在卡片内部一定会被裁掉。所以这里做成挂到 body 上的 fixed 浮层，
 * 位置按按钮的 getBoundingClientRect() 实时算，空间不够就往上翻。
 */

let pop = null;
let hideTimer = null;
let currentIds = [];
let currentPick = null;
let anchorEl = null;

const WIDTH = 272;

function build() {
  const el = document.createElement('div');
  el.className = 'qpop';
  el.setAttribute('role', 'menu');
  el.innerHTML =
    '<button type="button" class="qpop-item" role="menuitem" data-pick="bambu">' +
      '<span class="qpop-ic has-app"><img class="qpop-app" alt="" src="./assets/slicers/bambu-studio.png"></span>' +
      '<span class="qpop-body"><strong>用拓竹打开 3mf</strong>' +
      '<small>原文件直接打开，不做转换</small></span>' +
    '</button>' +
    '<button type="button" class="qpop-item" role="menuitem" data-pick="orca-official-direct">' +
      '<span class="qpop-ic has-app"><img class="qpop-app" alt="" src="./assets/slicers/orcaslicer.png"></span>' +
      '<span class="qpop-body"><strong>用官方 Orca 打开 3mf</strong>' +
      '<small>原文件直接打开，不做转换</small></span>' +
    '</button>' +
    '<button type="button" class="qpop-item" role="menuitem" data-pick="snapmaker">' +
      '<span class="qpop-ic has-app"><img class="qpop-app" alt="" src="./assets/slicers/snapmaker-orca.svg"></span>' +
      '<span class="qpop-body"><strong>用 Orca 打开 3mf（快造 U1）</strong>' +
      '<small>先转为 U1 工程，再用快造 Orca 打开</small></span>' +
    '</button>' +
    '<button type="button" class="qpop-item" role="menuitem" data-pick="orca-official">' +
      '<span class="qpop-ic has-app"><img class="qpop-app" alt="" src="./assets/slicers/orcaslicer.png"></span>' +
      '<span class="qpop-body"><strong>转换后用官方 Orca 打开</strong>' +
      '<small>先用快造 U1 工具转换，再交给官方 Orca</small></span>' +
    '</button>';
  document.body.appendChild(el);

  el.addEventListener('mouseenter', cancelHide);
  el.addEventListener('mouseleave', () => hideSoon());
  el.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-pick]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const pick = btn.dataset.pick;
    const fn = currentPick;
    close();
    if (typeof fn === 'function') fn(pick);
  });
  return el;
}


function place() {
  if (!pop || !anchorEl || !anchorEl.isConnected) return;
  const r = anchorEl.getBoundingClientRect();
  const margin = 8;
  let left = r.left + r.width / 2 - WIDTH / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - WIDTH - margin));
  const below = window.innerHeight - r.bottom;
  const flip = below < 260 && r.top > 260;
  pop.style.left = Math.round(left) + 'px';
  if (flip) {
    pop.style.top = 'auto';
    pop.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px';
  } else {
    pop.style.bottom = 'auto';
    pop.style.top = Math.round(r.bottom + 8) + 'px';
  }
}

/** 显示选择层。ids 为本次要打开（可能是多选）的模型，onPick 收到 'bambu' | 'snapmaker' */
export function showQuickOpen(anchor, ids, onPick) {
  cancelHide();
  anchorEl = anchor;
  currentIds = Array.isArray(ids) ? ids.slice() : [];
  currentPick = onPick;
  if (!pop || !pop.isConnected) pop = build();
  // 同一个按钮上鼠标划过内部子元素会反复触发 mouseover，这里只重算位置，不重放动画
  if (pop.classList.contains('qpop-in') && anchorEl === anchor) { place(); return; }
  // 多选时把数量标出来，避免用户以为只打开一张
  const sub = pop.querySelector('[data-pick="bambu"] small');
  if (sub) {
    sub.textContent = currentIds.length > 1
      ? '原文件直接打开，不做转换（' + currentIds.length + ' 个）'
      : '原文件直接打开，不做转换';
  }
  pop.classList.add('qpop-in');
  place();
  // 卡片快捷条是从底部滑上来的（transform 动画 0.2s），刚 hover 时量到的位置会偏，
  // 动画结束后再校一次，避免浮层和按钮错开十几像素。
  setTimeout(() => { if (anchorEl === anchor) place(); }, 220);
}

export function hideSoon(delay = 160) {
  cancelHide();
  hideTimer = setTimeout(close, delay);
}

export function cancelHide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

export function close() {
  cancelHide();
  anchorEl = null;
  currentPick = null;
  if (pop) {
    pop.classList.remove('qpop-in');
    // 保留节点复用，只做淡出；1 秒后如果还没被再次打开就移除引用
    const el = pop;
    setTimeout(() => { if (pop === el && !el.classList.contains('qpop-in')) el.remove(); }, 200);
  }
}

export function isQuickOpenOpen() {
  return !!(pop && pop.isConnected && pop.classList.contains('qpop-in'));
}

/** 当前浮层里包含这个节点吗（判断鼠标是否移进了菜单） */
export function quickOpenContains(node) {
  return !!(pop && node && pop.contains(node));
}

export function mountQuickOpen() {
  // 滚动/缩放后按钮位置变了：直接关掉，避免浮层停在半空
  const onMove = () => { if (isQuickOpenOpen()) close(); };
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
  document.addEventListener('click', (e) => {
    if (!isQuickOpenOpen()) return;
    if (pop && pop.contains(e.target)) return;
    if (anchorEl && anchorEl.contains(e.target)) return;
    close();
  }, true);
}

