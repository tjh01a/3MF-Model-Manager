'use strict';
import { t as tr } from '../i18n.js';

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
import { confirmDialog, customDialog } from '../components/modal.js';
import { showWeeklyReport } from '../components/weekly-report.js';
import { enterEditMode, isEditMode, exitEditMode } from '../components/editmode.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

let mounted = false;
let loading = false;
let refreshQueued = false;
// 保留上一轮有效数据：刷新时绝不先画空列表/空态再画真内容
let currentReceipts = [];
let currentSummary = { prints: 0, failures: 0, totalGrams: 0, totalCost: 0 };

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

/** 回执按「几月几日 时:分 打印完成/失败」显示，像账本一样一眼看到什么时候打印的 */
function fmtPrintTime(ts, result) {
  const n = Number(ts);
  if (!n) return '—';
  const d = new Date(n);
  const p = (x) => String(x).padStart(2, '0');
  const verb = result === 'error' ? tr('打印失败') : tr('打印完成');
  return (d.getMonth() + 1) + tr('月') + d.getDate() + tr('日 ') + p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + verb;
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
  const linkedTitle = (m && (m.title || m.fileName)) || r.modelTitle || r.jobName;
  const colors = (m && m.meta && m.meta.filamentColors) || [];
  const dots = colors.slice(0, 6).map((c) =>
    '<i class="rc-dot" style="background:' + esc(/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#94a3b8') + '"></i>').join('');
  const on = state.selection.has(r.id);
  return '<article class="rc-card' + (on ? ' is-selected' : '') + '" data-id="' + esc(r.id) + '" tabindex="0">' +
    tr('<label class="rc-check" title="选中这条回执"><input type="checkbox" class="rc-cb"') + (on ? ' checked' : '') + '></label>' +
    '<div class="rc-media"><img src="' + thumb(m) + '" alt="" loading="lazy"></div>' +
    '<div class="rc-body">' +
      tr('<div class="rc-title" title="原任务：') + esc(r.jobName) + '">' + esc(linkedTitle) + '</div>' +
      '<div class="rc-badges">' +
        '<span class="rc-result ' + (ok ? 'is-ok' : 'is-err') + '">' + (ok ? tr('完成') : tr('异常')) + '</span>' +
        '<button type="button" class="rc-link' + (m ? ' is-linked' : '') + '" data-act="rc-link" ' +
          'title="' + (m ? tr('更换这条回执关联的模型') : tr('把这条回执关联到模型库里的模型')) + '">' +
          icon('i-link') + (m ? tr('更换关联') : tr('关联模型')) + '</button>' +
      '</div>' +
      '<div class="rc-meta">' +
        '<span>' + icon('i-printer') + esc(r.printerName || tr('未知机器')) + '</span>' +
        '<span>' + icon('i-clock') + esc(fmtPrintTime(r.endedAt, r.result)) + '</span>' +
        tr('<span>耗时 ') + fmtMin(r.durationMin) + '</span>' +
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
  // snapshot 为 null 只是「先沿用缓存、稍后异步拉新数据」，不是「真的没有回执」。
  // 旧版在这里画了一个空列表，于是切视图/完整刷新都会先闪一下「还没有打印回执」，
  // 并把 __receiptsIds 清空，连带把已经勾选的回执裁掉。
  const hasFresh = !!(snapshot && Array.isArray(snapshot.items));
  if (hasFresh) {
    currentReceipts = snapshot.items;
    currentSummary = snapshot.summary || currentSummary;
  }
  const items = currentReceipts;
  const s = currentSummary;
  const unlinkedCount = items.filter((r) => r && !r.modelId).length;
  window.__receiptsIds = items.map((r) => r.id);
  // 只有拿到确定快照才裁剪选择集；沿用缓存时绝不因为「暂时 items=[]」清掉勾选
  if (hasFresh) {
    for (const id of Array.from(state.selection)) {
      if (!window.__receiptsIds.includes(id)) state.selection.delete(id);
    }
  }
  if (typeof window !== 'undefined') {
    const d = (window.__printshelfReceipts = window.__printshelfReceipts || {});
    d.renders = (d.renders || 0) + 1;
    d.lastSource = hasFresh ? 'snapshot' : 'cache';
    d.lastCount = items.length;
  }

  const head =
    '<div class="rc-summary">' +
      '<div class="rc-stat"><strong>' + (s.prints || 0) + tr('</strong><span>成功打印</span></div>') +
      '<div class="rc-stat"><strong>' + (s.failures || 0) + tr('</strong><span>异常次数</span></div>') +
      '<div class="rc-stat"><strong>' + (Number(s.totalGrams) || 0).toFixed(0) + tr(' g</strong><span>累计用料</span></div>') +
      '<div class="rc-stat rc-stat-cost"><strong>¥' + (Number(s.totalCost) || 0).toFixed(2) + tr('</strong><span>累计成本</span></div>') +
      '<div class="rc-summary-act">' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="rc-weekly">' + icon('i-clock') + tr('本周周报') + '</button>' +
        (unlinkedCount
          ? '<button type="button" class="btn btn-sm btn-ghost" data-act="rc-autolink" ' +
            tr('title="按名字自动关联到模型库（分多次打印的后缀会自动忽略）">') +
            icon('i-link') + tr('自动关联（') + unlinkedCount + '）</button>'
          : '') +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="rc-clear">' + icon('i-trash') + tr('清空回执</button>') +
      '</div>' +
    '</div>';

  const body = items.length
    ? '<div class="rc-grid">' + items.map(cardHtml).join('') + '</div>'
    : '<div class="rc-empty">' +
        '<div class="rc-empty-art">' + icon('i-printer') + '</div>' +
        tr('<strong>还没有打印回执</strong>') +
        tr('<span>完成一次打印后，这里会自动记录机器、用料和成本。</span>') +
      '</div>';

  content.innerHTML = head + body;
  content.className = 'content-special';
  if (isEditMode()) window.dispatchEvent(new CustomEvent('shelf:selectionchange'));
  // 工具栏的「共 N 条回执」要等异步数据到位后才知道，这里通知它补刷一次
  window.dispatchEvent(new CustomEvent('shelf:receipts-rendered'));
}

async function refresh() {
  // 快速切走再切回来时，上一轮刷新可能还在飞：排队补一次，别丢掉最新数据
  if (loading) { refreshQueued = true; return; }
  loading = true;
  try {
    const r = await api.receiptsWithModels(200);
    if (state.contentMode === 'receipts') render(r);
  } catch (_) { /* api 层已 toast */ }
  finally {
    loading = false;
    if (refreshQueued) {
      refreshQueued = false;
      refresh();
    }
  }
}

/** 手动把回执关联到模型库里的模型（或清除关联），不改成本快照、不碰模型文件 */
async function openLinkPicker(id) {
  const rec = currentReceipts.find((r) => r && r.id === id);
  if (!rec) { emitToast('warn', tr('找不到这条回执')); return; }

  let models = [];
  try {
    const r = await api.query({});
    models = (r && r.items) || [];
  } catch (_) { return; }   // api 层已经 toast

  const CLEAR = '__clear__';
  const rows = models.map((m) => {
    const label = m.title || m.fileName || tr('未命名模型');
    const key = [label, m.fileName, m.note].filter(Boolean).join(' ').toLowerCase();
    const current = rec.modelId && m.id === rec.modelId;
    return '<button type="button" class="rc-pick' + (current ? ' is-current' : '') + '" ' +
      'data-id="' + esc(m.id) + '" data-key="' + esc(key) + '">' +
        '<img src="' + thumb(m) + '" alt="">' +
        '<span class="rc-pick-main"><strong>' + esc(label) + '</strong>' +
          '<small>' + esc(m.fileName || '') + (current ? tr(' · 当前关联') : '') + '</small></span>' +
        (current ? tr('<span class="rc-pick-tag">当前</span>') : '') +
      '</button>';
  }).join('');

  const body =
    tr('<p class="modal-message">选择这条回执对应的模型。原任务名、用料和成本是打印时的快照，不会改动。</p>') +
    '<div class="rc-picker">' +
      '<div class="rc-picker-search">' + icon('i-search') +
        tr('<input type="text" class="input" data-role="q" placeholder="搜索模型名称、文件名或备注…" ') +
          'autocomplete="off" spellcheck="false">' +
      '</div>' +
      '<div class="rc-pick-list">' +
        (rec.modelId ? '<button type="button" class="rc-pick rc-pick-clear" data-id="' + CLEAR + tr('">清除关联（恢复显示原任务名）</button>') : '') +
        (rows || tr('<div class="picker-empty">模型库还是空的，先扫描一些模型吧</div>')) +
      '</div>' +
    '</div>';

  const picked = await customDialog({
    title: tr('关联模型'),
    body,
    width: '620px',
    foot: tr('<button type="button" class="btn btn-ghost" data-role="cancel">取消</button>'),
    onMount(modal, close) {
      const qEl = modal.querySelector('[data-role="q"]');
      const items = Array.from(modal.querySelectorAll('.rc-pick[data-id]'));
      if (qEl) {
        qEl.addEventListener('input', () => {
          const tokens = qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
          items.forEach((el) => {
            const key = el.dataset.key || '';
            el.hidden = tokens.length > 0 && !tokens.every((t) => key.includes(t));
          });
        });
        setTimeout(() => { try { qEl.focus(); } catch (_) {} }, 16);
      }
      items.forEach((el) => el.addEventListener('click', () => close(el.dataset.id)));
      const cancel = modal.querySelector('[data-role="cancel"]');
      if (cancel) cancel.addEventListener('click', () => close(null));
    },
  });

  if (picked === null || picked === undefined || picked === false) return;
  const modelId = picked === CLEAR ? null : String(picked);
  try {
    const result = await api.receiptsLinkModel(id, modelId);
    if (!result || !result.ok) { emitToast('warn', tr('这条回执已经不存在了')); return; }
    emitToast('success', modelId ? tr('已更新关联模型') : tr('已清除关联'));
    // 不再先清空缓存：那会让关联后先闪一次空态。render(r) 会原子替换成新数据。
    await refresh();
  } catch (e) {
    emitToast('error', (e && e.message) || tr('关联失败'));
  }
}

/** 删除选中的回执：二次确认 + 只删记录；删完退出编辑模式并刷新 */
async function deleteSelected() {
  const ids = Array.from(state.selection);
  if (!ids.length) { emitToast('warn', tr('还没有选中回执')); return; }
  const picked = currentReceipts.filter((r) => ids.includes(r.id));
  // currentReceipts 为空时（例如走查注入的卡片），从 DOM 兜底拿标题，保证确认弹窗有内容
  if (!picked.length) {
    for (const id of ids) {
      const card = qsa('#content .rc-card').find((c) => c.dataset.id === id);
      if (card) {
        const title = card.querySelector('.rc-title');
        picked.push({ id, jobName: title ? title.textContent : tr('未命名任务'), endedAt: null });
      }
    }
  }
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('删除选中的回执'),
      message: tr('确定删除选中的 ') + picked.length + tr(' 条打印回执吗？'),
      detail: tr('只删除本机的回执记录，不会动模型文件或模型库；以下记录将被删除：'),
      items: picked.map((r) => fmtDate(r.endedAt) + ' · ' + (r.jobName || tr('未命名任务'))),
      danger: true,
      confirmText: tr('删除回执'),
    });
  } catch (_) { return; }
  if (!ok) return;
  let res = null;
  try { res = await api.receiptsDelete(ids); }
  catch (e) { emitToast('error', (e && e.message) || tr('删除失败')); return; }
  const n = (res && res.deleted) || 0;
  if (n) emitToast('success', tr('已删除 ') + n + tr(' 条回执'));
  exitEditMode();
  await refresh();
}

function clearAll() {
  (async () => {
    let yes = false;
    try {
      yes = await confirmDialog({
        title: tr('清空打印回执'),
        message: tr('确定清空全部打印回执吗？'),
        detail: tr('只删除本机的回执记录，不会动模型文件和模型库。'),
        danger: true, confirmText: tr('清空'),
      });
    } catch (_) { return; }
    if (!yes) return;
    try {
      await api.receiptsClear();
      emitToast('success', tr('回执已清空'));
      emitRefresh('receipts');
      await refresh();
    } catch (_) { /* 已 toast */ }
  })().catch(() => {});
}

/**
 * 给未关联的回执补做自动关联。名字大致匹配即可：
 * 「沙奈朵拆(3)_plate_2」这种分盘/分批后缀会被忽略，匹配到「沙奈朵拆(3)」。
 * 只写关联字段，不动成本与用料快照。
 */
function autoLink() {
  (async () => {
    try {
      const r = await api.receiptsAutoLink();
      const linked = (r && r.linked) || 0;
      const amb = (r && r.ambiguous) || 0;
      if (linked) {
        emitToast('success', tr('已自动关联 ') + linked + tr(' 条回执')
          + (amb ? '，' + amb + tr(' 条名字太像没敢猜') : ''));
      } else {
        emitToast('info', amb
          ? tr('有 ') + amb + tr(' 条名字太接近，没敢自动关联，请手动选')
          : tr('没有可以自动关联的回执'));
      }
      emitRefresh('receipts');
      await refresh();
    } catch (_) { /* api 层已 toast */ }
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
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  // 「关联模型」是单条回执的操作，编辑模式下仍按勾选处理，避免误点改绑
  if (node && node.dataset.act === 'rc-link' && !isEditMode()) {
    if (card && card.dataset.id) openLinkPicker(card.dataset.id);
    return;
  }
  if (card && isEditMode()) { toggleSelect(card.dataset.id); return; }
  if (!node) return;
  if (node.dataset.act === 'rc-weekly') { showWeeklyReport(0); return; }
  if (node.dataset.act === 'rc-autolink') { autoLink(); return; }
  if (node.dataset.act !== 'rc-clear') return;
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
    Promise.resolve(deleteSelected()).catch((e) => emitToast('error', (e && e.message) || tr('删除失败')));
  });
  window.addEventListener('shelf:editpick', () => {
    if (state.contentMode === 'receipts') syncSelectionDom();
  });
}

/** 供工具栏显示「共 N 条回执」：回执数量与模型总数是两套口径，不能混用 */
export function receiptsCount() {
  return Array.isArray(currentReceipts) ? currentReceipts.length : 0;
}

export function renderReceipts() {
  setState({ contentMode: 'receipts' });
  // 刚进入回执视图时只清掉从模型视图带过来的模型 id（它们的格式不是 rcp-…），
  // 避免 Delete 把它们当回执删；回执勾选本身保留，后续刷新也不会被裁掉。
  for (const id of Array.from(state.selection)) {
    if (!String(id).startsWith('rcp-')) state.selection.delete(id);
  }
  render(null);   // 沿用缓存渲染，真正的数据由下面的 refresh 原子替换
  refresh();
}
