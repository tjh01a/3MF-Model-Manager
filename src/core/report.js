'use strict';
/**
 * I · 周报（docs/22 I）：纯函数，输入模型 + 回执 + 时间，输出可渲染的聚合。
 * 不做截图、不碰 Electron；截图在 services 里用隐藏窗口做（可选）。
 */

const DAY = 24 * 3600 * 1000;

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

function weekRange(now, offset) {
  const n = Number(offset) || 0;
  const thisWeek = startOfDay(now);
  const wd = (new Date(thisWeek).getDay() + 6) % 7;    // 周一 = 0
  const start = thisWeek - wd * DAY + n * 7 * DAY;
  return { from: start, to: start + 7 * DAY - 1 };
}

function inRange(t, from, to) { const v = Number(t) || 0; return v >= from && v <= to; }

function buildWeekly({ models, receipts, categories, now, weekOffset } = {}) {
  const range = weekRange(now || Date.now(), weekOffset);
  const recs = Array.isArray(receipts) ? receipts : [];
  const list = Array.isArray(models) ? models : [];
  const weekReceipts = recs.filter((r) => inRange(r.endedAt || r.createdAt, range.from, range.to));
  const finished = weekReceipts.filter((r) => r.result === 'finished');
  const failed = weekReceipts.filter((r) => r.result === 'failed');

  const newModels = list.filter((m) => inRange(m.createdAt, range.from, range.to));
  const printedModels = new Set(finished.map((r) => r.modelId).filter(Boolean));
  const filamentG = finished.reduce((s, r) => s + (Number(r.weightG) || 0), 0);
  const cost = finished.reduce((s, r) => s + (Number(r.cost) || 0), 0);

  // 每天：打印次数 / 成功 / 失败 / 新增模型
  const days = [];
  for (let i = 0; i < 7; i++) {
    const from = range.from + i * DAY;
    const to = from + DAY - 1;
    const d = new Date(from);
    days.push({
      date: from,
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      prints: weekReceipts.filter((r) => inRange(r.endedAt || r.createdAt, from, to)).length,
      finished: finished.filter((r) => inRange(r.endedAt || r.createdAt, from, to)).length,
      failed: failed.filter((r) => inRange(r.endedAt || r.createdAt, from, to)).length,
      added: newModels.filter((m) => inRange(m.createdAt, from, to)).length,
    });
  }

  // Top 模型：本周打印次数最多
  const byModel = new Map();
  for (const r of finished) {
    if (!r.modelId) continue;
    const cur = byModel.get(r.modelId) || { id: r.modelId, name: r.modelTitle || r.jobName || r.modelId, prints: 0, grams: 0, cost: 0 };
    cur.prints++; cur.grams += Number(r.weightG) || 0; cur.cost += Number(r.cost) || 0;
    byModel.set(r.modelId, cur);
  }
  const topModels = [...byModel.values()].sort((a, b) => b.prints - a.prints || b.grams - a.grams).slice(0, 5);

  // 分类分布（本周打印的模型）
  const catMap = new Map((categories || []).map((c) => [c.id, c.name]));
  const catCount = new Map();
  for (const m of list) {
    if (!printedModels.has(m.id)) continue;
    const name = catMap.get(m.categoryId) || '未分类';
    catCount.set(name, (catCount.get(name) || 0) + 1);
  }
  const byCategory = [...catCount.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const successRate = weekReceipts.length ? Math.round((finished.length / weekReceipts.length) * 100) : null;

  return {
    from: range.from,
    to: range.to,
    label: new Date(range.from).toLocaleDateString() + ' - ' + new Date(range.to).toLocaleDateString(),
    totals: {
      receipts: weekReceipts.length,
      finished: finished.length,
      failed: failed.length,
      successRate,
      newModels: newModels.length,
      printedModels: printedModels.size,
      filamentG: Math.round(filamentG * 10) / 10,
      cost: Math.round(cost * 100) / 100,
    },
    days,
    topModels,
    byCategory,
    empty: weekReceipts.length === 0 && newModels.length === 0,
  };
}

module.exports = { buildWeekly, weekRange, startOfDay };
