'use strict';
import { t as tr } from '../i18n.js';

/**
 * I · 打印周报（docs/22 I）。
 * 入口在「打印回执 · 成本账本」页，设置页不再重复放按钮。
 */
import { api } from '../api.js';
import { escapeHtml } from '../utils.js';
import { customDialog } from './modal.js';

export async function showWeeklyReport(weekOffset) {
  let r;
  try { r = await api.weeklyReport(Number(weekOffset) || 0); } catch (_) { return; }
  const t = r.totals || {};
  const max = Math.max(1, ...(r.days || []).map((x) => x.prints || 0));
  const bars = (r.days || []).map((d) => {
    const h = Math.round(((d.prints || 0) / max) * 100);
    return '<div class="wk-day"><span class="wk-bar-wrap"><span class="wk-bar" style="height:' + h + '%"></span></span>' +
      '<span class="wk-day-label">' + escapeHtml(d.label) + '</span>' +
      '<span class="wk-day-num">' + (d.prints || 0) + '</span></div>';
  }).join('');
  const top = (r.topModels || []).length
    ? '<ol class="wk-top">' + r.topModels.map((m) => '<li><span>' + escapeHtml(m.name) + '</span>' +
      tr('打印 ') + m.prints + tr(' 次 · ') + Math.round(m.grams) + ' g · ¥' + Number(m.cost || 0).toFixed(2) + '</li>').join('') + '</ol>'
    : tr('<p class="muted">本周还没有完成的打印</p>');
  customDialog({
    title: tr('本周周报') + ' · ' + r.label,
    body: '<div class="wk-grid">' +
      '<div class="wk-kpi"><b>' + (t.finished || 0) + '</b><span>' + tr('完成打印') + '</span></div>' +
      '<div class="wk-kpi"><b>' + (t.successRate == null ? '—' : t.successRate + '%') + '</b><span>' + tr('成功率') + '</span></div>' +
      '<div class="wk-kpi"><b>' + (t.newModels || 0) + '</b><span>' + tr('新增模型') + '</span></div>' +
      '<div class="wk-kpi"><b>' + Math.round(t.filamentG || 0) + ' g</b><span>' + tr('用料') + '</span></div>' +
      '<div class="wk-kpi"><b>¥' + Number(t.cost || 0).toFixed(2) + '</b><span>' + tr('估算成本') + '</span></div>' +
      '<div class="wk-kpi"><b>' + (t.failed || 0) + '</b><span>' + tr('失败') + '</span></div>' +
      '</div><div class="wk-chart">' + bars + '</div><h4>' + tr('本周最常打印') + '</h4>' + top,
  });
}
