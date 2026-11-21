'use strict';
/**
 * 已完成打印（docs/13 · 打印回执）：侧栏「已完成打印」视图的内容区。
 * 顶部是成本账本汇总，下面是按时间倒序的回执卡片。
 * 走 state.contentMode === 'receipts'，与网格 / 重复文件视图互斥。
 */
import { api, emitToast, emitRefresh } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, icon, qs } from '../utils.js';
import { confirmDialog } from '../components/modal.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

let mounted = false;
let loading = false;

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
  return '<article class="rc-card">' +
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

function render(snapshot) {
  const content = qs('#content');
  if (!content) return;
  const data = snapshot || { items: [], summary: { prints: 0, failures: 0, totalGrams: 0, totalCost: 0 } };
  const s = data.summary || {};
  const items = data.items || [];

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
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const r = await api.receiptsWithModels(200);
    if (state.contentMode === 'receipts') render(r);
  } catch (_) { /* api 层已 toast */ }
  finally { loading = false; }
}

function onClick(e) {
  const content = qs('#content');
  if (!content || !content.contains(e.target)) return;
  if (state.contentMode !== 'receipts') return;
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node || node.dataset.act !== 'rc-clear') return;
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

export function mountReceipts() {
  if (mounted) return;
  mounted = true;
  const content = qs('#content');
  if (content) content.addEventListener('click', onClick);
  window.addEventListener('receipts:changed', () => {
    if (state.contentMode === 'receipts') refresh();
  });
}

export function renderReceipts() {
  setState({ contentMode: 'receipts' });
  render(null);
  refresh();
}
