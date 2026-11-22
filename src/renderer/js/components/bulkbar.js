'use strict';
/**
 * 批量操作浮条：依据 state.selection 显示，按钮完成分类/标签/状态/收藏/打开/移出索引/删除/清空。
 * 同时负责顶部统计条右侧「删除勾选 · 取消勾选」的显隐与计数（同一个 selection 状态）。
 * 所有写操作前压入快照到 state.undoStack，成功后 Toast 带"撤销"逆向恢复。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state } from '../state.js';
import { confirmDialog, selectDialog } from './modal.js';
import { openModelsWithChoice } from './openwith.js';

// constants.js 为 CommonJS，渲染层不可 import，按冻结值内联
const PRINT_STATUS = {
  unprinted: { label: '未打印', color: '#94a3b8' },
  queued:    { label: '待打印', color: '#f59e0b' },
  printing:  { label: '打印中', color: '#3b82f6' },
  printed:   { label: '已完成', color: '#10b981' },
  failed:    { label: '失败',   color: '#ef4444' },
};
const PRINT_STATUS_ORDER = ['unprinted', 'queued', 'printing', 'printed', 'failed'];

function selectedIds() {
  return state.selection ? Array.from(state.selection) : [];
}
function findItem(id) {
  return (state.items || []).find((m) => m && m.id === id) || null;
}

// 快照：记录每个 id 操作前的相关字段原值，供撤销时逆向恢复
function takeSnapshot(list, fields) {
  const before = {};
  for (const id of list) {
    const m = findItem(id);
    if (!m) continue;
    const snap = {};
    for (const f of fields) snap[f] = Array.isArray(m[f]) ? m[f].slice() : m[f];
    before[id] = snap;
  }
  return { ids: list.slice(), before, fields };
}

// 逐 id 用 update 恢复原字段值（不同模型原值可能不同，故不走 bulk）
async function restoreSnapshot(snap) {
  for (const id of snap.ids) {
    const b = snap.before[id];
    if (!b) continue;
    try { await api.update(id, b); } catch (_) { /* api 层已统一 toast */ }
  }
}

async function runBulk(list, fields, doPatch, opts = {}) {
  if (!list.length) return;
  if (!Array.isArray(state.undoStack)) state.undoStack = [];
  const snap = takeSnapshot(list, fields);
  state.undoStack.push(snap);
  try {
    await doPatch();
    const restore = opts.remove
      ? async () => { await api.undo(); }          // 移出索引用后端 undo 恢复记录
      : async () => { await restoreSnapshot(snap); };
    emitToast('success', '已更新 ' + list.length + ' 个模型', {
      actionLabel: '撤销',
      action: async () => {
        try { await restore(); }
        catch (e) { emitToast('error', (e && e.message) || '撤销失败'); }
        emitRefresh('undo');
      },
    });
    emitRefresh('bulk');
  } catch (e) {
    const i = state.undoStack.indexOf(snap);
    if (i >= 0) state.undoStack.splice(i, 1);
    emitToast('error', (e && e.message) || '操作失败');
  }
}

async function setCategory() {
  const list = selectedIds();
  if (!list.length) return;
  const options = [{ value: null, label: '不分类', icon: 'i-folder-open', color: '#94a3b8' }]
    .concat((state.categories || []).map((c) => ({
      value: c.id, label: c.name, icon: c.icon || 'i-folder', color: c.color,
    })));
  const r = await selectDialog({ title: '设置分类', message: '为选中的模型指定分类', options, mode: 'single' });
  if (r === undefined) return;                    // 取消；null 表示"不分类"
  await runBulk(list, ['categoryId'], () => api.bulk(list, { categoryId: r }));
}

async function addTags() {
  const list = selectedIds();
  if (!list.length) return;
  const options = (state.tags || []).map((t) => ({ value: t.id, label: t.name, icon: 'i-tag', color: t.color }));
  const r = await selectDialog({
    title: '添加标签', message: '可多选；选择"无 / 清除全部"将清空所选模型的标签',
    options, mode: 'multi', confirmText: '添加',
  });
  if (r === undefined) return;
  if (!r.length) {
    await runBulk(list, ['tagIds'], () => api.tagAssign(list, [], 'set'));
    return;
  }
  await runBulk(list, ['tagIds'], () => api.tagAssign(list, r, 'add'));
}

async function setStatus() {
  const list = selectedIds();
  if (!list.length) return;
  const options = PRINT_STATUS_ORDER.map((k) => ({
    value: k, label: PRINT_STATUS[k].label, icon: 'i-printer', color: PRINT_STATUS[k].color,
  }));
  const r = await selectDialog({ title: '设置打印状态', options, mode: 'single' });
  if (r === undefined) return;
  await runBulk(list, ['printStatus'], () => api.setPrintStatus(list, r));
}

async function setFavorite() {
  const list = selectedIds();
  if (!list.length) return;
  await runBulk(list, ['favorite'], () => api.bulk(list, { favorite: true }));
}

async function bulkOpen() {
  const list = selectedIds();
  if (!list.length) return;
  await openModelsWithChoice(list);
}

async function bulkRemove() {
  const list = selectedIds();
  if (!list.length) return;
  const paths = list.map((id) => {
    const m = findItem(id);
    return m ? (m.path || m.fileName || id) : id;
  });
  const ok = await confirmDialog({
    title: '移出索引',
    message: '确定把选中的 ' + list.length + ' 个模型移出索引吗？磁盘文件不会被删除。',
    detail: '以下路径将从模型库移除：',
    items: paths,
    danger: true,
    confirmText: '移出索引',
  });
  if (!ok) return;
  await runBulk(list, [], async () => { await api.remove(list); }, { remove: true });
  state.selection.clear();
  syncBulkbar();
}

async function bulkTrash() {
  const list = selectedIds();
  if (!list.length) return;
  const paths = list.map((id) => {
    const m = findItem(id);
    return m ? (m.path || m.fileName || id) : id;
  });
  let ok = false;
  try {
    ok = await confirmDialog({
      title: '删除到回收站',
      message: '确定删除选中的 ' + list.length + ' 个文件吗？文件会被移入系统回收站，之后可以从回收站还原。',
      detail: '以下文件将被移入回收站：',
      items: paths,
      danger: true,
      confirmText: '移入回收站',
    });
  } catch (_) { return; }
  if (!ok) return;
  let res = null;
  try { res = await api.trash(list); }
  catch (e) { emitToast('error', (e && e.message) || '删除失败'); return; }
  const done = (res && res.ok) || [];
  const failed = (res && res.failed) || [];
  state.selection.clear();
  syncBulkbar();
  if (failed.length) {
    emitToast(failed.length === list.length ? 'error' : 'warn',
      failed.length + ' 个文件删除失败：' + ((failed[0] && failed[0].error) || '未知原因'));
  }
  if (done.length) emitToast('success', '已删除 ' + done.length + ' 个文件（可在回收站还原）');
  emitRefresh('trash');
}

function clearSelection() {
  state.selection.clear();
  syncBulkbar();
  emitRefresh('selection');
}

// 编辑模式（components/editmode.js）复用同一套动作，避免两处各写一遍批量逻辑
export function bulkSetCategory() { return setCategory(); }
export function bulkTrashSelection() { return bulkTrash(); }
export function bulkClearSelection() { return clearSelection(); }

export function syncBulkbar() {
  const n = state.selection ? state.selection.size : 0;
  // 打印回执视图的 selection 存的是回执 id，绝不能显示这里的「模型批量操作」，
  // 否则用户点该条的「删除」会去删模型文件。回执有自己的编辑模式操作条。
  const receiptsMode = state.contentMode === 'receipts';
  const bar = document.getElementById('bulkbar');
  if (bar) {
    const count = document.getElementById('bulk-count');
    if (count) count.textContent = String(n);
    bar.hidden = n === 0 || receiptsMode;
  }
  // 顶部统计条右侧的批量删除区：勾选后浮出，取消勾选即隐藏（对应截图里的空白位）
  const actions = document.getElementById('stats-actions');
  if (actions) actions.hidden = n === 0 || receiptsMode;
  const picked = document.getElementById('stats-selected');
  if (picked) picked.textContent = String(n);
  const del = document.getElementById('btn-bulk-delete');
  if (del) del.disabled = n === 0;
}

export function hideBulkbar() {
  const bar = document.getElementById('bulkbar');
  if (bar) bar.hidden = true;
}

export function mountBulkbar() {
  const map = {
    'bulk-category': setCategory,
    'bulk-tag': addTags,
    'bulk-status': setStatus,
    'bulk-fav': setFavorite,
    'bulk-open': bulkOpen,
    'bulk-remove': bulkRemove,
    'bulk-delete': bulkTrash,
    'bulk-clear': clearSelection,
    // 统计条右侧的「删除勾选 / 取消勾选」
    'btn-bulk-delete': bulkTrash,
    'btn-bulk-deselect': clearSelection,
  };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      Promise.resolve(map[id]()).catch((e) => emitToast('error', (e && e.message) || '操作失败'));
    });
  });
}
