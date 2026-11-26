'use strict';
import { t as tr } from '../i18n.js';

/**
 * 温度 / 进度曲线弹窗。
 *
 * 坐标计算在 src/core/monitor.js 的 buildChartModel()（纯函数、有单测），
 * 主进程通过 shelf:monitorChart 把「session 列表 + 选中 session + 画图模型」一起给过来，
 * 这里只负责把它套进 SVG 外壳。渲染层不复制任何缩放逻辑，避免出现两套算法。
 */
import { api } from '../api.js';
import { customDialog } from './modal.js';
import { escapeHtml } from '../utils.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

function hm(ts) {
  const d = new Date(Number(ts) || 0);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function fullDate(ts) {
  const d = new Date(Number(ts) || 0);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 把 core 算好的模型画成一张 SVG（不依赖任何图表库，CSP 只允许 script-src 'self'） */
function chartSvg(m) {
  const axis = '#94a3b8';
  const gridColor = 'rgba(100,116,139,.18)';
  const grid = m.grid.map((g) =>
    '<line x1="' + m.plot.x + '" y1="' + g.y + '" x2="' + (m.plot.x + m.plot.w) + '" y2="' + g.y +
      '" stroke="' + gridColor + '" stroke-width="1"/>' +
    '<text x="' + (m.plot.x - 7) + '" y="' + (g.y + 4) + '" text-anchor="end" font-size="10" fill="' + axis + '">' + g.tempLabel + '</text>' +
    '<text x="' + (m.plot.x + m.plot.w + 7) + '" y="' + (g.y + 4) + '" text-anchor="start" font-size="10" fill="' + axis + '">' + g.pctLabel + '%</text>'
  ).join('');
  const ticks = m.ticks.map((t) =>
    '<line x1="' + t.x + '" y1="' + m.plot.y + '" x2="' + t.x + '" y2="' + (m.plot.y + m.plot.h) +
      '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="2 4"/>' +
    '<text x="' + t.x + '" y="' + (m.plot.y + m.plot.h + 17) + '" text-anchor="middle" font-size="10" fill="' + axis + '">' + hm(t.t) + '</text>'
  ).join('');
  const paths = m.series.filter((s) => s.path).map((s) =>
    '<path d="' + s.path + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.dashed ? 1.4 : 2) + '"' +
      (s.dashed ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>'
  ).join('');
  // 才采到一两个点时画不出线，把末端圆点放大一点，至少能看见「已经记上了」
  const r = (m.series[0] && m.series[0].points.length < 3) ? 4.5 : 3;
  const dots = m.series.filter((s) => !s.dashed && s.points.length).map((s) => {
    const c = s.points[s.points.length - 1];
    return '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + r + '" fill="' + s.color + '"/>';
  }).join('');
  return '<svg class="mc-svg" viewBox="0 0 ' + m.width + ' ' + m.height + '" role="img" ' +
    tr('aria-label="喷嘴温度、热床温度与打印进度随时间变化的曲线">') +
    '<rect x="' + m.plot.x + '" y="' + m.plot.y + '" width="' + m.plot.w + '" height="' + m.plot.h +
      '" fill="none" stroke="' + gridColor + '"/>' +
    grid + ticks + paths + dots +
    '<text x="' + (m.plot.x - 7) + '" y="' + (m.plot.y - 4) + '" text-anchor="end" font-size="10" fill="' + axis + '">℃</text>' +
    '</svg>';
}

function legendHtml(model) {
  return '<div class="mc-legend">' + (model.series || []).map((s) =>
    '<span class="mc-lg"><i style="background:' + s.color + (s.dashed ? ';opacity:.6' : '') + '"></i>' +
      esc(s.label) + (s.last == null ? '' : '<b>' + Math.round(s.last * 10) / 10 + (s.key === 'progress' ? '%' : '°') + '</b>') +
    '</span>').join('') + '</div>';
}

function statsHtml(data) {
  const s = (data.model && data.model.stats) || {};
  const cells = [
    [tr('采样点'), (s.count || 0) + tr(' 个')],
    [tr('已记录'), (s.durationMin || 0) + tr(' 分钟')],
    [tr('喷嘴峰值'), (s.nozzleMax || 0) + ' ℃'],
    [tr('热床峰值'), (s.bedMax || 0) + ' ℃'],
    [tr('最后进度'), Math.round(s.percent || 0) + '%'],
  ];
  return '<div class="mc-stats">' + cells.map((c) =>
    '<div class="mc-stat"><span>' + esc(c[1]) + '</span><small>' + esc(c[0]) + '</small></div>').join('') + '</div>';
}

function bodyHtml(data) {
  if (!data || !data.session || !data.model || data.model.empty) {
    return tr('<div class="mc-empty"><p>这台打印机还没有采样数据。</p>') +
      tr('<p class="hint">开始打印后，PrintShelf 会按设置里的间隔自动记录喷嘴 / 热床温度与进度，') +
      tr('不用一直开着设备面板。可以在「设置 → 打印监控」里调整间隔或清空历史。</p></div>');
  }
  const list = data.sessions || [];
  const options = list.map((s) =>
    '<option value="' + esc(s.id) + '"' + (s.id === data.session.id ? ' selected' : '') + '>' +
      // 下拉可能混合多台机器的任务，必须带设备名，否则两台 A1 的曲线分不清
      esc(fullDate(s.startedAt) + ' · ' + (s.printerName || tr('打印机')) + ' · ' +
        s.jobName + ' · ' + s.points + tr(' 点')) + '</option>').join('');
  return '<div class="mc-top">' +
      tr('<label class="mc-pick">打印任务 <select class="select" id="mc-session">') + options + '</select></label>' +
      '<span class="mc-state">' + (data.session.endedAt ? tr('已结束') : tr('进行中')) + '</span>' +
    '</div>' +
    '<div class="mc-chart">' + chartSvg(data.model) + '</div>' +
    legendHtml(data.model) +
    statsHtml(data) +
    '<p class="hint mc-hint">' +
      (data.model.stats.count < 3
        ? tr('<strong>才刚开始记录（') + data.model.stats.count + tr(' 个点），打印进行中会按设置里的间隔持续补上。</strong> ')
        : '') +
      tr('左轴是温度（℃），右轴是进度（%）。虚线是喷嘴目标温度，') +
      tr('实线突然下探往往意味着开仓、断料或掉温；进度长时间不动而温度仍在高位，值得去看一眼。</p>');
}

/**
 * 打开曲线弹窗。
 * @param {string} printerId   为空 = 全部设备（取最近一次打印）
 * @param {string} printerName 只用于标题
 */
export async function openMonitorChart(printerId, printerName) {
  const id = printerId || '';
  let data;
  try {
    data = await api.monitorChart(id, null);
  } catch (_) {
    return;   // api.js 已经统一弹错误 toast
  }
  const diag = (window.__printshelfMonitorChart = window.__printshelfMonitorChart || { opened: 0, sessions: 0, points: 0 });
  diag.opened++;
  diag.sessions = (data && data.sessions && data.sessions.length) || 0;
  diag.points = (data && data.model && data.model.stats && data.model.stats.count) || 0;

  customDialog({
    title: tr('温度与进度曲线') + (printerName ? ' · ' + printerName : ''),
    body: '<div id="mc-body">' + bodyHtml(data) + '</div>',
    foot: tr('<button type="button" class="btn btn-ghost" data-mc-close>关闭</button>'),
    width: '860px',
    onMount(modal, close) {
      const btn = modal.querySelector('[data-mc-close]');
      if (btn) btn.addEventListener('click', () => close(null));
      // 切换任务时只重画弹窗内容，不重新开关弹窗（避免遮罩闪一下）
      modal.addEventListener('change', async (e) => {
        if (!e.target || e.target.id !== 'mc-session') return;
        try {
          const next = await api.monitorChart(id, e.target.value);
          const body = modal.querySelector('#mc-body');
          if (body) body.innerHTML = bodyHtml(next);
          diag.points = (next && next.model && next.model.stats && next.model.stats.count) || 0;
        } catch (_) { /* api.js 已提示 */ }
      });
    },
  });
}
