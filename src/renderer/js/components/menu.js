'use strict';
/**
 * 右键 / 更多菜单：在 #context-menu 内渲染 [{label,icon,action,danger,divider}]，
 * 自动视口边界翻转，点击项先关闭再执行 action（可为 async）。
 */
import { escapeHtml, icon } from '../utils.js';
import { emitToast } from '../api.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
// 兼容带 / 不带 i- 前缀的图标名，最终输出统一为 i-xxx
const iconName = (n) => !n ? 'i-circle' : (String(n).startsWith('i-') ? String(n) : 'i-' + n);

let mounted = false;
let open = false;
let currentItems = [];

function menuEl() {
  let el = document.getElementById('context-menu');
  if (!el) {
    el = document.createElement('div');
    el.id = 'context-menu';
    el.className = 'context-menu';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function onDocClick(e) {
  if (!open) return;
  // 菜单内部点击交给项委托处理，避免重复关闭
  if (e.target && e.target.closest && e.target.closest('#context-menu')) return;
  closeMenu();
}
function onScroll() { if (open) closeMenu(); }
function onResize() { if (open) closeMenu(); }
function onKey(e) {
  if (open && e.key === 'Escape') closeMenu();
}

// 菜单项事件委托：先关闭，再执行 action
function onMenuClick(e) {
  const btn = e.target && e.target.closest ? e.target.closest('.menu-item[data-i]') : null;
  if (!btn || !menuEl().contains(btn)) return;
  const idx = Number(btn.dataset.i);
  const item = currentItems[idx];
  closeMenu();
  if (!item || typeof item.action !== 'function') return;
  try {
    const r = item.action();
    if (r && typeof r.catch === 'function') {
      r.catch((err) => emitToast('error', (err && err.message) || '操作失败'));
    }
  } catch (err) {
    emitToast('error', (err && err.message) || '操作失败');
  }
}

export function mountMenu() {
  if (mounted) return;
  mounted = true;
  const el = menuEl();
  el.addEventListener('click', onMenuClick);
  document.addEventListener('click', onDocClick);
  // true = 捕获，任意容器滚动都关闭菜单
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
}

export function openMenu(x, y, items) {
  const el = menuEl();
  currentItems = Array.isArray(items) ? items : [];

  const html = currentItems.map((it, i) => {
    if (!it) return '';
    if (it.divider) return '<div class="menu-divider"></div>';
    return '<button type="button" class="menu-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' +
      icon(iconName(it.icon)) + '<span class="menu-label">' + esc(it.label || '') + '</span></button>';
  }).join('');
  el.innerHTML = html || '<div class="menu-empty">无可用操作</div>';
  el.hidden = false;
  open = true;

  // 先按传入坐标摆放并测量，再做视口边界翻转与夹取
  const px = Number.isFinite(x) ? x : 0;
  const py = Number.isFinite(y) ? y : 0;
  el.style.left = px + 'px';
  el.style.top = py + 'px';
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let nx = px;
  let ny = py;
  if (px + w > vw - 4) nx = px - w;            // 右侧溢出：向左翻转
  if (py + h > vh - 4) ny = py - h;            // 下方溢出：向上翻转
  nx = Math.min(Math.max(4, nx), Math.max(4, vw - w - 4));
  ny = Math.min(Math.max(4, ny), Math.max(4, vh - h - 4));
  el.style.left = nx + 'px';
  el.style.top = ny + 'px';
}

export function closeMenu() {
  const el = menuEl();
  open = false;
  currentItems = [];
  el.hidden = true;
  el.innerHTML = '';
}

export function isMenuOpen() {
  return open && !menuEl().hidden;
}
