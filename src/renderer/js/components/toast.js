'use strict';
/** Toast：订阅 shelf:toast，支持 4 色图标、撤销动作、2.5s 自动消失、hover 暂停、最多 4 条堆叠。 */
import { escapeHtml, icon } from '../utils.js';

const ICONS = {
  success: 'i-check-circle', info: 'i-info', warn: 'i-warning', error: 'i-alert',
};
const MAX = 4;
const DEFAULT_DURATION = 2500;

let container = null;
let listening = false;

function onToastEvent(e) {
  const d = (e && e.detail) || {};
  toast({
    type: d.type || 'info',
    message: d.message || '',
    actionLabel: d.actionLabel,
    action: d.action,
    duration: d.duration,
  });
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('shelf:toast', onToastEvent);
}

export function mountToast() {
  container = document.getElementById('toast-container');
  listen();
}

// 顶层幂等注册，保证 mount 之前的极早期提示也不丢失
listen();

export function toast({ type = 'info', message = '', actionLabel = '', action = null, duration = DEFAULT_DURATION } = {}) {
  const root = container || document.getElementById('toast-container');
  if (!root) return;
  const kind = ICONS[type] ? type : 'info';
  while (root.children.length >= MAX) root.removeChild(root.firstElementChild);

  const el = document.createElement('div');
  el.className = 'toast toast-' + kind;
  el.setAttribute('role', 'status');
  el.innerHTML = icon(ICONS[kind], 'ico toast-icon') +
    '<span class="toast-message">' + escapeHtml(message) + '</span>';

  let actionBtn = null;
  if (actionLabel && typeof action === 'function') {
    actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action';
    actionBtn.textContent = actionLabel;
    el.appendChild(actionBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.innerHTML = icon('i-close', 'ico');
  el.appendChild(closeBtn);
  root.appendChild(el);

  const dur = Number(duration);
  let remaining = isNaN(dur) ? DEFAULT_DURATION : dur;
  let timer = null;
  let startedAt = 0;

  function dismiss() {
    if (timer) { clearTimeout(timer); timer = null; }
    el.classList.add('toast-leaving');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
  }
  function start() {
    if (remaining <= 0 || timer) return;
    startedAt = Date.now();
    timer = setTimeout(dismiss, remaining);
  }
  function pause() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      remaining -= (Date.now() - startedAt);
      if (remaining < 0) remaining = 0;
    }
  }
  function resume() {
    if (!timer && remaining > 0) start();
  }

  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  closeBtn.addEventListener('click', dismiss);
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      try {
        const r = action();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) { /* 动作异常由 api 层统一提示 */ }
      dismiss();
    });
  }
  start();
}

export function toastSuccess(msg) { return toast({ type: 'success', message: msg }); }
export function toastError(msg) { return toast({ type: 'error', message: msg }); }
