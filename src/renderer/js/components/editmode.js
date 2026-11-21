'use strict';
/**
 * 编辑模式（Steam 库式多选）。
 *
 * 约定：
 *   - 卡片上按住 480ms 不动即进入编辑模式，并选中按下的那张；
 *   - 编辑模式下单击卡片 = 切换选中，单击快捷按钮仍然生效；
 *   - 顶部浮出操作条：全选 / 迁移到分类 / 删除 / 完成；
 *   - 退出方式：点「完成」、按 Esc、点空白处。
 *
 * 这里只管「模式 + 操作条」，选择集仍然是 state.selection，渲染反馈由 views/grid.js 负责。
 */
import { state, setState, subscribe } from '../state.js';
import { qs, icon } from '../utils.js';
import { bulkSetCategory, bulkTrashSelection } from './bulkbar.js';
import { emitToast } from '../api.js';

let bar = null;
let hinted = false;   // 本次会话只提示一次操作方式，避免每次长按都弹

export function isEditMode() {
  return !!state.editMode;
}

function ensureBar() {
  if (bar && bar.isConnected) return bar;
  bar = document.createElement('div');
  bar.id = 'editbar';
  bar.className = 'editbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '编辑模式');
  bar.hidden = true;
  bar.innerHTML =
    '<span class="editbar-badge">' + icon('i-edit') + '编辑模式</span>' +
    '<span class="editbar-count">已选 <strong data-role="n">0</strong> 项</span>' +
    '<span class="editbar-sep"></span>' +
    '<button type="button" class="editbar-btn" data-edit="all" title="全选当前结果 (Ctrl+A)">全选</button>' +
    '<button type="button" class="editbar-btn" data-edit="move" title="把选中的模型迁移到一个分类">' +
      icon('i-folder') + '迁移到分类</button>' +
    '<button type="button" class="editbar-btn danger" data-edit="trash" title="移入系统回收站">' +
      icon('i-trash') + '删除</button>' +
    '<button type="button" class="editbar-btn primary" data-edit="done" title="退出编辑模式 (Esc)">完成</button>';
  document.body.appendChild(bar);
  bar.addEventListener('click', onClick);
  return bar;
}

function onClick(e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-edit]') : null;
  if (!btn) return;
  const act = btn.dataset.edit;
  if (act === 'done') { exitEditMode(); return; }
  if (act === 'all') { window.dispatchEvent(new CustomEvent('shelf:selectall')); return; }
  if (act === 'move') { Promise.resolve(bulkSetCategory()).catch(() => {}); return; }
  if (act === 'trash') { Promise.resolve(bulkTrashSelection()).catch(() => {}); return; }
}

function syncCount() {
  if (!bar) return;
  const n = state.selection ? state.selection.size : 0;
  const el = bar.querySelector('[data-role="n"]');
  if (el) el.textContent = String(n);
  const all = bar.querySelector('[data-edit="all"]');
  if (all) all.disabled = n > 0 && n === (state.items || []).length;
}

export function enterEditMode(anchorId) {
  if (state.editMode) return;
  ensureBar();
  setState({ editMode: true }, 'editmode');
  document.body.classList.add('edit-mode');
  if (bar) bar.hidden = false;
  // 长按那一张先选中：进入模式后立刻能看到「已选 1 项」，不用再点一次
  if (anchorId) {
    state.selection.clear();
    state.selection.add(anchorId);
    setState({ selection: state.selection }, 'selection');
    window.dispatchEvent(new CustomEvent('shelf:editpick', { detail: { id: anchorId } }));
  }
  syncCount();
  if (!hinted) {
    hinted = true;
    emitToast('info', '已进入编辑模式：点缩略图多选，拖到左侧分类即可迁移', { duration: 3200 });
  }
}

export function exitEditMode({ keepSelection = false } = {}) {
  if (!state.editMode) return;
  setState({ editMode: false }, 'editmode');
  document.body.classList.remove('edit-mode');
  if (bar) bar.hidden = true;
  if (!keepSelection) window.dispatchEvent(new CustomEvent('shelf:selectionclear'));
}

export function mountEditMode() {
  subscribe((s) => {
    if (!s.editMode) return;
    syncCount();
  });
  // 选择集被外部改掉（全选 / 清空 / 筛选裁剪）时计数也要跟上
  window.addEventListener('shelf:selectionclear', () => { if (state.editMode) syncCount(); });
  window.addEventListener('shelf:selectionchange', () => { if (state.editMode) syncCount(); });
}

/** 供 grid.js 在 applySelection 后调用，保证计数与 DOM 同步 */
export function syncEditBar() {
  if (state.editMode) syncCount();
}
