'use strict';
/**
 * 大图灯箱：显示模型缩略图、名称/序号/大小/状态。
 * 键盘仅在 state.lightbox.open 时响应，避免与 app.js 的全局快捷键冲突。
 */
import { api } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, fmtBytes } from '../utils.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
// constants.js 为 CommonJS，按冻结值内联打印状态标签
const PRINT_STATUS = {
  unprinted: { label: '未打印' }, queued: { label: '待打印' }, printing: { label: '打印中' },
  printed: { label: '已完成' }, failed: { label: '失败' },
};

let mounted = false;
const el = (id) => document.getElementById(id);
const itemById = (id) => (state.items || []).find((m) => m && m.id === id) || null;

async function render() {
  const lb = state.lightbox || { open: false, ids: [], index: 0 };
  const ids = lb.ids || [];
  if (!ids.length) return;
  const n = ids.length;
  const idx = ((lb.index % n) + n) % n;
  const id = ids[idx];

  let m = itemById(id);
  if (!m) { try { m = await api.get(id); } catch (_) { /* 取不到时走占位 */ } }

  const img = el('lightbox-img');
  if (img) img.src = m && m.thumbnail ? 'shelf://thumbs/' + m.thumbnail : 'assets/placeholder.svg';

  const cap = el('lightbox-caption');
  if (cap) {
    const name = m ? (m.title || m.fileName || id) : id;
    const size = m && m.size != null ? fmtBytes(m.size) : '—';
    const status = m && PRINT_STATUS[m.printStatus]
      ? PRINT_STATUS[m.printStatus].label
      : (m && m.status ? m.status : '');
    cap.innerHTML =
      '<span class="lb-name">' + esc(name) + '</span>' +
      '<span class="lb-index">' + (idx + 1) + ' / ' + n + '</span>' +
      '<span class="lb-meta">' + esc(size) + (status ? ' · ' + esc(status) : '') + '</span>';
  }
}

function onKey(e) {
  if (!state.lightbox || !state.lightbox.open) return;   // 关闭时完全不干预
  const k = e.key;
  if (k !== 'Escape' && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
  e.preventDefault();
  e.stopImmediatePropagation();                          // 灯箱打开时独占这三个键
  if (k === 'Escape') closeLightbox();
  else if (k === 'ArrowLeft') lightboxStep(-1);
  else lightboxStep(1);
}

export function mountLightbox() {
  if (mounted) return;
  mounted = true;
  const bind = (id, fn) => { const e = el(id); if (e) e.addEventListener('click', fn); };
  bind('lightbox-close', () => closeLightbox());
  bind('lightbox-prev', () => lightboxStep(-1));
  bind('lightbox-next', () => lightboxStep(1));
  const box = el('lightbox');
  if (box) box.addEventListener('click', (e) => { if (e.target === box) closeLightbox(); });
  // 捕获阶段：仅在灯箱打开时对 Esc / 左右键生效
  window.addEventListener('keydown', onKey, true);
}

export function openLightbox(ids, index) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  if (!list.length) return;
  const i = Number.isFinite(index) ? Math.max(0, Math.min(list.length - 1, index)) : 0;
  setState({ lightbox: { open: true, ids: list, index: i } });
  const box = el('lightbox');
  if (box) box.hidden = false;
  render();
}

export function closeLightbox() {
  const cur = state.lightbox || {};
  setState({ lightbox: { open: false, ids: cur.ids || [], index: cur.index || 0 } });
  const box = el('lightbox');
  if (box) box.hidden = true;
  const img = el('lightbox-img');
  if (img) img.removeAttribute('src');
}

export function isLightboxOpen() {
  const box = el('lightbox');
  return !!(state.lightbox && state.lightbox.open) && !!box && !box.hidden;
}

export function lightboxStep(delta) {
  const lb = state.lightbox;
  if (!lb || !lb.open || !lb.ids || !lb.ids.length) return;
  const n = lb.ids.length;
  const idx = (((lb.index + delta) % n) + n) % n;      // 循环切换
  setState({ lightbox: { open: true, ids: lb.ids.slice(), index: idx } });
  render();
}
