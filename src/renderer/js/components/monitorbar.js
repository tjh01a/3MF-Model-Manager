'use strict';
import { t as tr } from '../i18n.js';

/**
 * 主界面常驻打印监控条（设置 → 打印监控 可开关）。
 *
 * 数据源与设备面板完全一致：主进程每 3 秒（快造轮询）/ 每次 MQTT report（拓竹）
 * 推 'printers:update'，这里按卡片增量更新，不改整条 DOM，鼠标悬停不会被打断。
 * 监控条不自己采样，曲线数据由主进程 core/monitor.js 在后台持续记录。
 */
import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, icon } from '../utils.js';
import { openSettings } from '../views/settings.js';
import { openMonitorChart } from './monitorchart.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

let mounted = false;
let snap = [];
let configured = [];
let paintQueued = false;
let noteTimer = null;
// P0：监控条默认只保留一行摘要，展开后才显示横向卡片。大量设备时不会把
// 模型网格整体往下推。状态保存在内存，不写设置，避免升级后行为突变。
let collapsed = true;
const diag = { pushes: 0, renders: 0, cards: 0, enabled: true, lastNote: null };

function fmtMin(min) {
  const n = Number(min) || 0;
  if (n <= 0) return '—';
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return h ? h + 'h ' + m + 'm' : m + 'm';
}

function deg(t) {
  if (!t) return '';
  return Math.round(t.cur || 0) + '/' + Math.round(t.target || 0) + '°';
}

const STATE_CLS = {
  printing: 's-printing', paused: 's-paused', idle: 's-idle', finished: 's-done',
  preparing: 's-busy', error: 's-err', offline: 's-off', connecting: 's-off',
};

/** 只有这些字段变了才重画卡片；温度没动时连 DOM 都不碰 */
function sigOf(p) {
  return JSON.stringify([
    p.name, p.state, p.stateText, p.online, p.error,
    p.job && p.job.name, p.job && p.job.percent, p.job && p.job.remainingMin,
    p.temps && p.temps.nozzle && p.temps.nozzle.cur, p.temps && p.temps.nozzle && p.temps.nozzle.target,
    p.temps && p.temps.bed && p.temps.bed.cur, p.temps && p.temps.bed && p.temps.bed.target,
  ]);
}

function cardHtml(p) {
  const j = p.job;
  const pct = j ? Math.max(0, Math.min(100, Number(j.percent) || 0)) : 0;
  const t = p.temps || {};
  const cls = STATE_CLS[p.state] || 's-idle';
  const bits = [
    j ? '<b>' + Math.round(pct) + '%</b>' : '',
    t.nozzle ? tr('<span>喷嘴 ') + esc(deg(t.nozzle)) + '</span>' : '',
    t.bed ? tr('<span>热床 ') + esc(deg(t.bed)) + '</span>' : '',
    j && j.remainingMin ? tr('<span>剩余 ') + esc(fmtMin(j.remainingMin)) + '</span>' : '',
  ].filter(Boolean).join('');
  return '<div class="mon-card ' + cls + '" data-id="' + esc(p.id) + '" data-sig="' + esc(sigOf(p)) + '" ' +
      tr('title="点开设备面板看完整状态">') +
    '<div class="mon-head">' +
      '<span class="mon-name">' + esc(p.name || tr('打印机')) + '</span>' +
      '<span class="mon-state">' + esc(p.stateText || '—') + '</span>' +
    '</div>' +
    (j
      ? '<div class="mon-bar"><i style="width:' + pct + '%"></i></div>'
      : '<div class="mon-bar is-idle"><i style="width:0"></i></div>') +
    '<div class="mon-meta">' + (bits || '<span class="muted">' + esc(p.online ? tr('空闲中') : (p.error || tr('离线'))) + '</span>') + '</div>' +
    '<div class="mon-tools">' +
      '<button type="button" class="mon-chart" data-mon-act="chart" data-id="' + esc(p.id) + '" ' +
        'data-name="' + esc(p.name || tr('打印机')) + tr('" title="看这台机器的温度与进度曲线">') +
        icon('i-layers') + tr('曲线</button>') +
    '</div>' +
  '</div>';
}

function isEnabled() {
  const ui = (state.settings && state.settings.ui) || {};
  return ui.monitorBar !== false;
}

function mergeStatus(p) {
  if (!p || !p.id) return;
  const i = snap.findIndex((x) => x.id === p.id);
  if (i >= 0) snap[i] = Object.assign({}, snap[i], p);
  else snap.push(Object.assign({}, p));
}

/** 列表按「配置顺序」排，没配置的推送不显示；已配置但还没推状态的补一条离线占位 */
function visibleList() {
  const byId = new Map(snap.map((p) => [p.id, p]));
  const list = configured.map((c) => byId.get(c.id) || {
    id: c.id, name: c.name, kind: c.kind, model: c.model || '',
    online: false, state: 'offline', stateText: tr('离线'), job: null, temps: {}, error: '',
  });
  return list;
}

function ensureCollapseButton(bar) {
  let btn = bar.querySelector('.mon-collapse');
  if (btn) return btn;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mon-collapse';
  btn.dataset.monAct = 'collapse';
  btn.setAttribute('aria-label', '展开或收起打印监控');
  const head = bar.querySelector('.mon-headbar');
  if (head) head.appendChild(btn);
  return btn;
}

function applyCollapsed(bar) {
  const btn = ensureCollapseButton(bar);
  bar.classList.toggle('is-collapsed', collapsed);
  if (!btn) return;
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.textContent = collapsed ? tr('展开') : tr('收起');
  btn.title = collapsed ? tr('展开打印监控卡片') : tr('收起打印监控卡片');
}

function paint() {
  paintQueued = false;
  const bar = document.getElementById('monitor-bar');
  if (!bar) return;
  const on = isEnabled();
  diag.enabled = on;
  if (!on || !configured.length) {
    bar.hidden = true;
    diag.cards = 0;
    return;
  }
  bar.hidden = false;
  applyCollapsed(bar);
  const listEl = bar.querySelector('.mon-list');
  if (!listEl) return;
  const list = visibleList();
  const existing = new Map(Array.from(listEl.children).map((el) => [el.dataset.id, el]));
  const ids = new Set(list.map((p) => p.id));
  for (const [id, el] of existing) if (!ids.has(id)) el.remove();
  let changed = 0;
  for (const p of list) {
    const s = sigOf(p);
    const cur = existing.get(p.id);
    if (cur && cur.dataset.sig === s) continue;
    if (cur) cur.outerHTML = cardHtml(p);
    else listEl.insertAdjacentHTML('beforeend', cardHtml(p));
    changed++;
  }
  const count = bar.querySelector('.mon-count');
  if (count) count.textContent = list.length + tr(' 台');
  const printing = list.filter((p) => p.state === 'printing').length;
  const live = bar.querySelector('.mon-live');
  if (live) live.textContent = printing ? printing + tr(' 台打印中') : tr('暂无打印任务');
  diag.cards = list.length;
  if (changed) diag.renders++;
}

function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  setTimeout(paint, 30);   // 一秒内多次 MQTT report 合并成一次
}

async function refresh() {
  try {
    const [list, s] = await Promise.all([api.printersList(), api.printersSnapshot()]);
    configured = (list || []).filter((p) => p && p.enabled !== false);
    snap = Array.isArray(s) ? s.slice() : [];
  } catch (_) {
    // 离线/首次启动时 api 层已提示，这里保留上一帧，不要清空整条
  }
  schedulePaint();
}

function showNote(n) {
  const bar = document.getElementById('monitor-bar');
  if (!bar) return;
  const note = bar.querySelector('.mon-note');
  if (!note) return;
  note.textContent = (n && (n.body || n.title)) || '';
  note.hidden = false;
  note.className = 'mon-note ' + (n && n.kind === 'error' ? 'is-error' : (n && n.kind === 'paused' ? 'is-warn' : 'is-ok'));
  diag.lastNote = (n && n.kind) || null;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note.hidden = true; }, 9000);
}

function onClick(e) {
  const bar = document.getElementById('monitor-bar');
  if (!bar || !bar.contains(e.target)) return;
  const node = e.target.closest ? e.target.closest('[data-mon-act]') : null;
  if (node) {
    e.stopPropagation();
    const act = node.dataset.monAct;
    if (act === 'chart') openMonitorChart(node.dataset.id, node.dataset.name);
    else if (act === 'settings') openSettings('monitor');
    else if (act === 'collapse') {
      collapsed = !collapsed;
      const bar = document.getElementById('monitor-bar');
      if (bar) applyCollapsed(bar);
    } else if (act === 'chart-first') {
      // 不传 printerId = 取全部设备里最近一次有记录的打印。
      // 以前写死「第一台」，而第一台常常是空闲/已完成、压根没有采样点，
      // 点「看曲线」永远落在空态上。
      openMonitorChart('', tr('最近一次打印'));
    }
    return;
  }
  if (e.target.closest && e.target.closest('.mon-card')) {
    const btn = document.getElementById('btn-devices');
    if (btn) btn.click();
  }
}

export function mountMonitorBar() {
  if (mounted) return;
  mounted = true;
  if (typeof window !== 'undefined') window.__printshelfMonitor = diag;
  const bar = document.getElementById('monitor-bar');
  if (bar) bar.addEventListener('click', onClick);
  window.addEventListener('printers:update', (e) => {
    diag.pushes++;
    mergeStatus(e && e.detail);
    schedulePaint();
  });
  window.addEventListener('printers:changed', () => { refresh(); });
  window.addEventListener('printers:notify', (e) => { showNote(e && e.detail); schedulePaint(); });
  // 设置页改了「监控条」开关 / 采样开关后会发 settings 刷新；这里跟着立刻显隐
  window.addEventListener('shelf:refresh', () => { schedulePaint(); });
  refresh();
  // 推送万一丢了（MQTT 长时间静默），20 秒兜底重拉一次快照
  setInterval(() => { if (isEnabled() && configured.length) refresh(); }, 20000);
}
