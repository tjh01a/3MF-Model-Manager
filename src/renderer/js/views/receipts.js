'use strict';
/**
 * 已完成打印（docs/13 · 打印回执）：侧栏「已完成打印」视图的内容区。
 * 顶部是成本账本汇总，下面是按时间倒序的回执卡片。
 * 走 state.contentMode === 'receipts'，与网格 / 重复文件视图互斥。
 *
 * 交互与主页面统一（docs/18 交互与 UI/UX 白皮书）：
 *   卡片长按 480ms 进入编辑模式并选中该卡；编辑模式下单击卡片 = 切换勾选；
 *   操作条提供「全选 / 删除回执 / 完成」，Esc 或点完成退出。
 * 关键差异：这里的删除只删本机的回执记录，绝不调用模型文件的 trash。
 */
import { api, emitToast, emitRefresh } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, icon, qs, qsa } from '../utils.js';
import { confirmDialog } from '../components/modal.js';
import { enterEditMode, isEditMode, exitEditMode } from '../components/editmode.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

let mounted = false;
let loading = false;
let currentReceipts = [];

// 长按进编辑模式：参数与主页面 grid.js 完全一致
const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE = 8;
let pressTimer = null;
let pressStart = null;
let suppressClick = false;

function fmtDate(ts) {
  const n = Number(ts);
  if (!n) return '—';
  const d = new Date(n);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function fmtMin(n) {
  const v = Number(n) || 0;
  if (!v) return '—';
  const h = Math.floor(v / 60);
  return h ? h + 'h ' + (v % 60) + 'm' : v + 'm';
}

function thumb(m) {
  if (m && m.thumbnail) return 'shelf://thumbs/' + encodeURIComponent(m.thumbnail);
  return './assets/placeholder.svg';
}

function cardHtml(r) {
  const ok = r.result === 'finished';
  const m = r.model;
  const colors = (m && m.meta && m.meta.filamentColors) || [];
  const dots = colors.slice(0, 6).map((c) =>
    '<i class="rc-dot" style="background:' + esc(/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#94a3b8') + '"></i>').join('');
  const on = state.selection.has(r.id);
  return '<article class="rc-card' + (on ? ' is-selected' : '') + '" data-id="' + esc(r.id) + '" tabindex="0">' +
    '<label class="rc-check" title="选中这条回执"><input type="checkbox" class="rc-cb"' + (on ? ' checked' : '') + '></label>' +
    '<div class="rc-media"><img src="' + thumb(m) + '" alt="" loading="lazy"></div>' +
    '<div class="rc-body">' +
      '<div class="rc-title" title="' + esc(r.jobName) + '">' + esc(m ? (m.title || m.fileName) : r.jobName) + '</div>' +
      '<div class="rc-badges">' +
        '<span class="rc-result ' + (ok ? 'is-ok' : 'is-err') + '">' + (ok ? '完成' : '异常') + '</span>' +
        (m ? '' : '<span class="rc-unlinked">未关联模型</span>') +
      '</div>' +
      '<div class="rc-meta">' +
        '<span>' + icon('i-printer') + esc(r.printerName || '未知机器') + '</span>' +
        '<span>' + icon('i-clock') + fmtDate(r.endedAt) + '</span>' +
        '<span>耗时 ' + fmtMin(r.durationMin) + '</span>' +
      '</div>' +
      '<div class="rc-foot">' +
        '<span class="rc-weight">' + (r.weightG != null ? Number(r.weightG).toFixed(2) + ' g' : '—') + '</span>' +
        (dots ? '<span class="rc-dots">' + dots + '</span>' : '') +
        '<span class="rc-cost">¥' + (Number(r.cost) || 0).toFixed(2) + '</span>' +
      '</div>' +
    '</div>' +
  '</article>';
}

/** 把 state.selection 的勾选状态刷到 DOM（不整块重绘，跟主页面卡片一致） */
function syncSelectionDom() {
  const content = qs('#content');
  if (!content) return;
  for (const c of qsa('.rc-card', content)) {
    const on = state.selection.has(c.dataset.id);
    c.classList.toggle('is-selected', on);
    const cb = c.querySelector('.rc-cb');
    if (cb) cb.checked = on;
  }
}

function applySelection() {
  setState({ selection: state.selection }, 'selection');
  syncSelectionDom();
  window.dispatchEvent(new CustomEvent('shelf:selectionchange'));
}

function toggleSelect(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  applySelection();
}

function render(snapshot) {
  const content = qs('#content');
  if (!content) return;
  const data = snapshot || { items: [], summary: { prints: 0, failures: 0, totalGrams: 0, totalCost: 0 } };
  const s = data.summary || {};
  const items = data.items || [];
  // 供编辑模式判断「已全选」；同时把切视图时残留的模型 id 从选择集里裁掉
  window.__receiptsIds = items.map((r) => r.id);
  for (const id of Array.from(state.selection)) {
    if (!window.__receiptsIds.includes(id)) state.selection.delete(id);
  }

  const head =
    '<div class="rc-summary">' +
      '<div class="rc-stat"><strong>' + (s.prints || 0) + '</strong><span>成功打印</span></div>' +
      '<div class="rc-stat"><strong>' + (s.failures || 0) + '</strong><span>异常次数</span></div>' +
      '<div class="rc-stat"><strong>' + (Number(s.totalGrams) || 0).toFixed(0) + ' g</strong><span>累计用料</span></div>' +
      '<div class="rc-stat rc-stat-cost"><strong>¥' + (Number(s.totalCost) || 0).toFixed(2) + '</strong><span>累计成本</span></div>' +
      '<div class="rc-summary-act">' +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="rc-clear">' + icon('i-trash') + '清空回执</button>' +
      '</div>' +
    '</div>';

  const body = items.length
    ? '<div class="rc-grid">' + items.map(cardHtml).join('') + '</div>'
    : '<div class="rc-empty">' +
        '<div class="rc-empty-art">' + icon('i-printer') + '</div>' +
        '<strong>还没有打印回执</strong>' +
        '<span>完成一次打印后，这里会自动记录机器、用料和成本。</span>' +
      '</div>';

  content.innerHTML = head + body;
  content.className = 'content-special';
  if (isEditMode()) window.dispatchEvent(new CustomEvent('shelf:selectionchange'));
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const r = await api.receiptsWithModels(200);
    if (state.contentMode === 'receipts') {
      currentReceipts = (r && r.items) || [];
      render(r);
    }
  } catch (_) { /* api 层已 toast */ }
  finally { loading = false; }
}

/** 删除选中的回执：二次确认 + 只删记录；删完退出编辑模式并刷新 */
async function deleteSelected() {
  const ids = Array.from(state.selection);
  if (!ids.length) { emitToast('warn', '还没有选中回执'); return; }
  const picked = currentReceipts.filter((r) => ids.includes(r.id));
  // currentReceipts 为空时（例如走查注入的卡片），从 DOM 兜底拿标题，保证确认弹窗有内容
  if (!picked.length) {
    for (const id of ids) {
      const card = qsa('#content .rc-card').find((c) => c.dataset.id === id);
      if (card) {
        const title = card.querySelector('.rc-title');
        picked.push({ id, jobName: title ? title.textContent : '未命名任务', endedAt: null });
      }
    }
  }
  let ok = false;
  try {
    ok = await confirmDialog({
      title: '删除选中的回执',
      message: '确定删除选中的 ' + picked.length + ' 条打印回执吗？',
      detail: '只删除本机的回执记录，不会动模型文件或模型库；以下记录将被删除：',
      items: picked.map((r) => fmtDate(r.endedAt) + ' · ' + (r.jobName || '未命名任务')),
      danger: true,
      confirmText: '删除回执',
    });
  } catch (_) { return; }
  if (!ok) return;
  let res = null;
  try { res = await api.receiptsDelete(ids); }
  catch (e) { emitToast('error', (e && e.message) || '删除失败'); return; }
  const n = (res && res.deleted) || 0;
  if (n) emitToast('success', '已删除 ' + n + ' 条回执');
  exitEditMode();
  await refresh();
}

function clearAll() {
  (async () => {
    let yes = false;
    try {
      yes = await confirmDialog({
        title: '清空打印回执',
        message: '确定清空全部打印回执吗？',
        detail: '只删除本机的回执记录，不会动模型文件和模型库。',
        danger: true, confirmText: '清空',
      });
    } catch (_) { return; }
    if (!yes) return;
    try {
      await api.receiptsClear();
      emitToast('success', '回执已清空');
      emitRefresh('receipts');
      await refresh();
    } catch (_) { /* 已 toast */ }
  })().catch(() => {});
}

// ---------- 事件 ----------
function cancelPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  pressStart = null;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  suppressClick = false;
  const card = e.target && e.target.closest ? e.target.closest('.rc-card') : null;
  if (!card) return;
  if (e.target.closest('button, input, label, a')) return;   // 按钮/勾选框上的长按不做任何事
  if (isEditMode()) return;                                  // 已在编辑模式：直接点即勾选
  pressStart = { x: e.clientX, y: e.clientY, id: card.dataset.id, moved: false };
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (!pressStart || pressStart.moved) return;
    suppressClick = true;                                    // 吞掉松手后的 click，别重复切换勾选
    enterEditMode(pressStart.id);
  }, LONG_PRESS_MS);
}

function onPointerMove(e) {
  if (!pressStart || pressStart.moved) return;
  if (Math.abs(e.clientX - pressStart.x) > MOVE_TOLERANCE ||
      Math.abs(e.clientY - pressStart.y) > MOVE_TOLERANCE) {
    pressStart.moved = true;
    cancelPress();
  }
}

function onPointerUp() { cancelPress(); }

function onClick(e) {
  const content = qs('#content');
  if (!content || !content.contains(e.target)) return;
  if (state.contentMode !== 'receipts') return;
  if (suppressClick) { suppressClick = false; return; }
  // 勾选框交给 change 事件，避免点一次切两次
  if (e.target.closest && e.target.closest('.rc-check')) return;
  const card = e.target.closest ? e.target.closest('.rc-card') : null;
  if (card && isEditMode()) { toggleSelect(card.dataset.id); return; }
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node || node.dataset.act !== 'rc-clear') return;
  clearAll();
}

function onChange(e) {
  if (state.contentMode !== 'receipts') return;
  if (!e.target.classList || !e.target.classList.contains('rc-cb')) return;
  const card = e.target.closest('.rc-card');
  if (card) toggleSelect(card.dataset.id);
}

export function mountReceipts() {
  if (mounted) return;
  mounted = true;
  const content = qs('#content');
  if (content) {
    content.addEventListener('click', onClick);
    content.addEventListener('change', onChange);
    content.addEventListener('pointerdown', onPointerDown);
    content.addEventListener('pointermove', onPointerMove);
    content.addEventListener('pointerup', onPointerUp);
    content.addEventListener('pointercancel', onPointerUp);
    content.addEventListener('pointerleave', onPointerUp);
  }
  window.addEventListener('receipts:changed', () => {
    if (state.contentMode === 'receipts') refresh();
  });
  // 与主页面共用编辑模式操作条：这几个事件由 editmode.js 派发
  window.addEventListener('shelf:selectall', () => {
    if (state.contentMode !== 'receipts') return;
    state.selection.clear();
    // 从当前 DOM 的卡片读取，保证和屏幕上看到的完全一致
    for (const c of qsa('#content .rc-card')) if (c.dataset.id) state.selection.add(c.dataset.id);
    applySelection();
  });
  window.addEventListener('shelf:selectionclear', () => {
    if (state.contentMode !== 'receipts') return;
    state.selection.clear();
    syncSelectionDom();
  });
  window.addEventListener('shelf:receipts-deleteselected', () => {
    if (state.contentMode !== 'receipts') return;
    Promise.resolve(deleteSelected()).catch((e) => emitToast('error', (e && e.message) || '删除失败'));
  });
  window.addEventListener('shelf:editpick', () => {
    if (state.contentMode === 'receipts') syncSelectionDom();
  });
}

export function renderReceipts() {
  setState({ contentMode: 'receipts' });
  render(null);
  refresh();
}
