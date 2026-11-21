'use strict';
/**
 * 通用弹窗：确认 / 输入 / 选择。
 * 采用栈式管理，支持堆叠、Esc 与遮罩关闭、焦点陷阱，且任一关闭路径都会 resolve Promise。
 */
import { escapeHtml, icon } from '../utils.js';

// 统一转义包装：escapeHtml 可能对 null 不友好，这里先归一为字符串
const esc = (v) => escapeHtml(v == null ? '' : String(v));

const stack = [];          // 每项 { backdrop, modal, resolve, defaultValue, settled, prevFocus }
let globalBound = false;

function modalRoot() {
  let r = document.getElementById('modal-root');
  if (!r) {
    r = document.createElement('div');
    r.id = 'modal-root';
    document.body.appendChild(r);
  }
  return r;
}

// 可聚焦元素（排除禁用 / 隐藏 / tabindex=-1）
function focusables(modal) {
  return Array.from(
    modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1' && el.getClientRects().length > 0);
}

// 捕获阶段接管键盘：仅在有弹窗时生效，避免与 app.js 的全局快捷键/逐层关闭互相踩踏
function onKeydown(e) {
  if (!stack.length) return;                 // 无弹窗时完全不干预
  const top = stack[stack.length - 1];
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeEntry(top, top.defaultValue);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const list = focusables(top.modal);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    let next;
    if (e.shiftKey) next = i <= 0 ? list.length - 1 : i - 1;
    else next = i < 0 || i >= list.length - 1 ? 0 : i + 1;
    list[next].focus();
  }
}

function bindGlobal() {
  if (globalBound) return;
  globalBound = true;
  window.addEventListener('keydown', onKeydown, true);
}

// 只显示最上层；每次开/关都重新聚焦当前顶层
function syncStack() {
  const top = stack.length - 1;
  stack.forEach((e, i) => { e.backdrop.style.display = i === top ? '' : 'none'; });
  if (top >= 0) {
    const entry = stack[top];
    // 优先聚焦输入框，否则聚焦弹窗本体：避免默认焦点落在关闭按钮上、出现一圈很扎眼的焦点框
    const field = entry.modal.querySelector('input:not([type="checkbox"]), textarea');
    const target = field || entry.modal;
    try { target.focus({ preventScroll: true }); } catch (_) { /* 忽略不支持 focus 的情况 */ }
  }
}

function closeEntry(entry, value) {
  if (!entry || entry.settled) return;
  entry.settled = true;
  const idx = stack.indexOf(entry);
  if (idx >= 0) stack.splice(idx, 1);
  const prevFocus = entry.prevFocus;
  entry.backdrop.remove();
  syncStack();
  if (!stack.length && prevFocus && document.contains(prevFocus)) {
    try { prevFocus.focus(); } catch (_) { /* 元素可能已失焦，忽略 */ }
  }
  try { entry.resolve(value); } catch (_) { /* resolve 不应抛错，保险 */ }
}

/**
 * 创建弹窗骨架，返回 { entry, modal, promise }。
 * defaultValue：Esc / 遮罩 / 关闭按钮 / closeAllModals 时的默认 resolve 值。
 */
function createShell({ title, body, foot, defaultValue, width }) {
  bindGlobal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.tabIndex = -1;               // 允许聚焦弹窗本身，让默认焦点不落在关闭按钮上
  // .modal 的 CSS 是 width:min(480px,100%)，只改 maxWidth 不会变宽
  // （曲线 / 检测结果 / 未匹配分类表单的 width 参数以前全都白传了）。
  // 显式给 width，再用 maxWidth:100% 保证窄窗口下不溢出 backdrop 的 24px 内边距。
  if (width) {
    modal.style.width = width;
    modal.style.maxWidth = '100%';
  }
  modal.innerHTML =
    '<div class="modal-head">' +
      '<h3 class="modal-title">' + esc(title || '') + '</h3>' +
      '<button type="button" class="icon-btn modal-close" data-role="x" aria-label="关闭">' + icon('i-close') + '</button>' +
    '</div>' +
    '<div class="modal-body">' + body + '</div>' +
    '<div class="modal-foot">' + foot + '</div>';
  backdrop.appendChild(modal);
  modalRoot().appendChild(backdrop);

  const entry = {
    backdrop, modal, defaultValue, settled: false,
    prevFocus: document.activeElement, resolve: null,
  };
  const promise = new Promise((res) => { entry.resolve = res; });

  modal.querySelector('[data-role="x"]')
    ?.addEventListener('click', () => closeEntry(entry, defaultValue));
  // 仅点击遮罩本身（非弹窗内容）且为最上层时关闭
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && stack[stack.length - 1] === entry) {
      closeEntry(entry, defaultValue);
    }
  });

  stack.push(entry);
  syncStack();
  return { entry, modal, promise };
}

function footButtons(confirmText, danger, hasOk, cancelText = '取消') {
  const okClass = danger ? 'btn btn-danger danger' : 'btn btn-primary';
  return (
    '<button type="button" class="btn btn-ghost" data-role="cancel">' + esc(cancelText) + '</button>' +
    (hasOk ? '<button type="button" class="' + okClass + '" data-role="ok">' + esc(confirmText) + '</button>' : '')
  );
}

/** 二次确认弹窗 -> Promise<Boolean>；items 为完整路径/名称列表，渲染为可滚动等宽列表
 *  cancelText 可写成「返回，不执行」之类，避免用户把「取消」误读成取消打印/取消预览。 */
export function confirmDialog({
  title = '确认操作', message = '', detail = '', items = [], danger = false,
  confirmText = '确定', cancelText = '取消',
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const itemsHtml = list.length
    ? '<div class="modal-items">' + list.map((it) => '<div class="modal-item">' + esc(it) + '</div>').join('') + '</div>'
    : '';
  const detailHtml = detail ? '<p class="modal-detail">' + esc(detail) + '</p>' : '';
  const body = '<p class="modal-message">' + esc(message) + '</p>' + detailHtml + itemsHtml;
  const { entry, modal, promise } = createShell({
    title, body, foot: footButtons(confirmText || '确定', danger, true, cancelText || '取消'), defaultValue: false,
  });
  modal.querySelector('[data-role="cancel"]').addEventListener('click', () => closeEntry(entry, false));
  modal.querySelector('[data-role="ok"]').addEventListener('click', () => closeEntry(entry, true));
  return promise;
}

/**
 * 自定义内容弹窗：调用方自己给 body/foot 的 HTML，onMount 里绑事件。
 * close(value) 结束并 resolve value；Esc / 遮罩 resolve null。
 */
export function customDialog({ title = '', body = '', foot = '', width, onMount } = {}) {
  const { entry, modal, promise } = createShell({ title, body, foot, defaultValue: null, width });
  if (typeof onMount === 'function') {
    onMount(modal, (value) => closeEntry(entry, value));
  }
  return promise;
}

/** 单行输入弹窗 -> Promise<String|null>；Enter 确认、Esc 取消、自动聚焦并选中 */
export function promptDialog({ title = '输入', label = '', value = '', placeholder = '', confirmText = '确定' } = {}) {
  const body =
    '<label class="field">' +
      (label ? '<span class="field-label">' + esc(label) + '</span>' : '') +
      '<input type="text" class="input" data-role="input" value="' + esc(value) +
        '" placeholder="' + esc(placeholder || '') + '" autocomplete="off" spellcheck="false">' +
    '</label>';
  const { entry, modal, promise } = createShell({
    title, body, foot: footButtons(confirmText || '确定', false, true), defaultValue: null,
  });
  const input = modal.querySelector('[data-role="input"]');
  const submit = () => closeEntry(entry, input.value);
  modal.querySelector('[data-role="cancel"]').addEventListener('click', () => closeEntry(entry, null));
  modal.querySelector('[data-role="ok"]').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 16);
  return promise;
}

/**
 * 选择弹窗 -> Promise<any>。
 * 单选：点击某项即 resolve(该项 value)；取消 resolve(undefined)。value 可为任意类型（含 null）。
 * 多选：勾选后确认 resolve(value[])；"无/清除" resolve([])；取消 resolve(undefined)。
 */
export function selectDialog({ title = '请选择', message = '', options = [], mode = 'single', confirmText = '确定' } = {}) {
  const isMulti = mode === 'multi';
  const opts = Array.isArray(options) ? options : [];
  const defaultValue = undefined;
  const rowHtml = (o, i) => {
    const dot = o.color ? '<span class="opt-dot" style="background:' + esc(o.color) + '"></span>' : '';
    const ico = o.icon ? icon(o.icon) : '';
    const box = isMulti ? '<span class="opt-check" data-role="box"></span>' : '';
    return '<button type="button" class="select-opt" data-i="' + i + '">' + box + dot + ico +
      '<span class="opt-label">' + esc(o.label) + '</span></button>';
  };
  const clearRow = isMulti
    ? '<button type="button" class="select-opt select-clear" data-role="clear">' +
        '<span class="opt-check" data-role="box"></span>' +
        '<span class="opt-label">无 / 清除全部</span></button>'
    : '';
  const rows = opts.map(rowHtml).join('') || '<div class="empty">暂无可选项</div>';
  const msg = message ? '<p class="modal-message">' + esc(message) + '</p>' : '';
  const body = msg + '<div class="select-list' + (isMulti ? ' is-multi' : '') + '">' + clearRow + rows + '</div>';
  const { entry, modal, promise } = createShell({
    title, body, foot: footButtons(confirmText || '确定', false, isMulti), defaultValue,
  });

  modal.querySelector('[data-role="cancel"]').addEventListener('click', () => closeEntry(entry, defaultValue));
  const listEl = modal.querySelector('.select-list');

  if (!isMulti) {
    // 单选：点击即返回，保留原始 value 类型
    listEl.querySelectorAll('.select-opt[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const o = opts[Number(btn.dataset.i)];
        closeEntry(entry, o ? o.value : undefined);
      });
    });
    return promise;
  }

  // 多选状态
  const selected = new Set();      // 存 option 索引
  let clearSelected = false;      // 是否选中"无/清除"
  const clearBtn = listEl.querySelector('[data-role="clear"]');

  const paint = () => {
    listEl.querySelectorAll('.select-opt[data-i]').forEach((btn) => {
      btn.classList.toggle('is-selected', selected.has(Number(btn.dataset.i)));
    });
    if (clearBtn) clearBtn.classList.toggle('is-selected', clearSelected);
  };
  listEl.querySelectorAll('.select-opt[data-i]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      clearSelected = false;      // 勾选具体项即取消"清除"
      paint();
    });
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearSelected = !clearSelected;
      if (clearSelected) selected.clear();
      paint();
    });
  }
  modal.querySelector('[data-role="ok"]').addEventListener('click', () => {
    const values = clearSelected ? [] : Array.from(selected).map((i) => opts[i].value);
    closeEntry(entry, values);
  });
  paint();
  return promise;
}

/**
 * 可搜索的多选列表弹窗 -> Promise<string[]|undefined>。
 * options: [{ value, label, hint }]；selected 为已选 value 数组；取消返回 undefined。
 * 用于「把模型加入某个分类」这类需要在长列表里挑条目的场景。
 */
export function pickerDialog({
  title = '选择条目', message = '', options = [], selected = [],
  placeholder = '输入关键词筛选…', confirmText = '确定', emptyText = '没有可选项',
} = {}) {
  const opts = Array.isArray(options) ? options : [];
  const pre = new Set((Array.isArray(selected) ? selected : []).map(String));
  const rows = opts.map((o, i) => {
    const key = (String(o.value) + ' ' + (o.label || '') + ' ' + (o.hint || '')).toLowerCase();
    return '<label class="picker-row" data-i="' + i + '" data-key="' + esc(key) + '">' +
      '<input type="checkbox" class="picker-cb" data-i="' + i + '"' + (pre.has(String(o.value)) ? ' checked' : '') + '>' +
      '<span class="picker-main">' +
        '<span class="picker-label">' + esc(o.label) + '</span>' +
        (o.hint ? '<span class="picker-hint">' + esc(o.hint) + '</span>' : '') +
      '</span></label>';
  }).join('');
  const body =
    (message ? '<p class="modal-message">' + esc(message) + '</p>' : '') +
    '<div class="picker">' +
      '<div class="picker-search">' + icon('i-search') +
        '<input type="text" class="input" data-role="q" placeholder="' + esc(placeholder) + '" autocomplete="off" spellcheck="false">' +
      '</div>' +
      '<div class="picker-list" data-role="list">' + (rows || '<div class="picker-empty">' + esc(emptyText) + '</div>') + '</div>' +
      '<div class="picker-bar">' +
        '<span class="picker-count" data-role="count">已选 0 项</span>' +
        '<span class="picker-bar-spacer"></span>' +
        '<button type="button" class="text-btn" data-role="all">全选</button>' +
        '<button type="button" class="text-btn" data-role="none">清空</button>' +
      '</div>' +
    '</div>';
  const { entry, modal, promise } = createShell({
    title, body, foot: footButtons(confirmText || '确定', false, true), defaultValue: undefined,
  });

  const listEl = modal.querySelector('[data-role="list"]');
  const qEl = modal.querySelector('[data-role="q"]');
  const countEl = modal.querySelector('[data-role="count"]');
  const boxes = Array.from(listEl.querySelectorAll('.picker-cb'));
  const rowsEls = Array.from(listEl.querySelectorAll('.picker-row'));

  const count = () => {
    const n = boxes.filter((b) => b.checked).length;
    if (countEl) countEl.textContent = '已选 ' + n + ' 项';
  };
  // 只对当前可见（未被搜索隐藏）的行生效
  const visibleBoxes = () => rowsEls
    .filter((r) => !r.hidden)
    .map((r) => r.querySelector('.picker-cb'))
    .filter(Boolean);

  listEl.addEventListener('change', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('picker-cb')) count();
  });
  if (qEl) {
    qEl.addEventListener('input', () => {
      const tokens = qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      rowsEls.forEach((r) => {
        const key = r.dataset.key || '';
        r.hidden = tokens.length > 0 && !tokens.every((t) => key.includes(t));
      });
    });
    setTimeout(() => { try { qEl.focus(); } catch (_) {} }, 16);
  }
  const allBtn = modal.querySelector('[data-role="all"]');
  const noneBtn = modal.querySelector('[data-role="none"]');
  if (allBtn) allBtn.addEventListener('click', () => { visibleBoxes().forEach((b) => { b.checked = true; }); count(); });
  if (noneBtn) noneBtn.addEventListener('click', () => { boxes.forEach((b) => { b.checked = false; }); count(); });

  modal.querySelector('[data-role="cancel"]').addEventListener('click', () => closeEntry(entry, undefined));
  modal.querySelector('[data-role="ok"]').addEventListener('click', () => {
    const values = opts.filter((_, i) => boxes[i] && boxes[i].checked).map((o) => String(o.value));
    closeEntry(entry, values);
  });
  count();
  return promise;
}

/**
 * 名称 + 标识色 的单步弹窗 -> Promise<{value,color}|null>。
 * 对应 Steam「添加收藏库」那种一步到位的排版：输入名字、点个颜色、回车即可。
 */
export function nameColorDialog({
  title = '新建', label = '名称', value = '', placeholder = '',
  colors = [], color = '', confirmText = '创建', colorLabel = '标识色',
} = {}) {
  const palette = Array.isArray(colors) && colors.length ? colors : ['#4f46e5'];
  const body =
    '<label class="field">' +
      '<span class="field-label">' + esc(label) + '</span>' +
      '<input type="text" class="input" data-role="input" value="' + esc(value) +
        '" placeholder="' + esc(placeholder || '') + '" autocomplete="off" spellcheck="false">' +
    '</label>' +
    '<div class="field">' +
      '<span class="field-label">' + esc(colorLabel) + '</span>' +
      '<div class="color-row" data-role="colors">' +
        palette.map((c) => '<button type="button" class="color-dot" data-color="' + esc(c) +
          '" style="--dot-color:' + esc(c) + '" aria-label="' + esc(c) + '"></button>').join('') +
      '</div>' +
    '</div>';
  const { entry, modal, promise } = createShell({
    title, body, foot: footButtons(confirmText || '创建', false, true), defaultValue: null,
  });
  const input = modal.querySelector('[data-role="input"]');
  const dots = Array.from(modal.querySelectorAll('.color-dot'));
  let picked = color && palette.indexOf(color) >= 0 ? color : palette[0];
  const paint = () => dots.forEach((d) => d.classList.toggle('is-on', d.dataset.color === picked));
  dots.forEach((d) => d.addEventListener('click', () => { picked = d.dataset.color; paint(); }));
  paint();

  const submit = () => {
    const v = String(input.value || '').trim();
    if (!v) { input.focus(); return; }
    closeEntry(entry, { value: v, color: picked });
  };
  modal.querySelector('[data-role="cancel"]').addEventListener('click', () => closeEntry(entry, null));
  modal.querySelector('[data-role="ok"]').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 16);
  return promise;
}

/** 关闭所有弹窗：按栈顺序以各自默认值 resolve，杜绝悬挂 Promise */
export function closeAllModals() {
  while (stack.length) {
    const e = stack[stack.length - 1];
    closeEntry(e, e.defaultValue);
  }
}

export function isModalOpen() {
  return stack.length > 0;
}
