'use strict';
/**
 * I · 周报 / 成就 / 护照单测（docs/22 I）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildWeekly, weekRange } = require('../src/core/report');
const { Achievements } = require('../src/core/achievements');
const passport = require('../src/core/passport');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际 ' + JSON.stringify(a) + '）'); }

const NOW = new Date('2026-11-26T15:00:00+08:00').getTime();
const H = 3600 * 1000, D = 24 * H;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-i-'));

(async () => {
  console.log('\n[1] 周报时间范围（周一起算）');
  const wr = weekRange(NOW, 0);
  const start = new Date(wr.from);
  eq(start.getDay(), 1, '本周从周一开始');
  eq(new Date(wr.from).getDate(), 23, '2026-11-26 所在周从 11/23 开始');
  const prev = weekRange(NOW, -1);
  ok(prev.to < wr.from, '上一周在本周之前');

  console.log('\n[2] 周报聚合');
  const models = [
    { id: 'm1', title: '盒子', categoryId: 'c1', size: 100, createdAt: NOW - 2 * D, lastPrintedAt: NOW - D },
    { id: 'm2', title: '支架', categoryId: 'c2', size: 200, createdAt: NOW - 40 * D },
    { id: 'm3', title: '旧件', categoryId: 'c1', size: 300, createdAt: NOW - 60 * D },
  ];
  const receipts = [
    { id: 'r1', modelId: 'm1', modelTitle: '盒子', result: 'finished', endedAt: NOW - D, weightG: 120, cost: 12 },
    { id: 'r2', modelId: 'm1', modelTitle: '盒子', result: 'finished', endedAt: NOW - 2 * H, weightG: 80, cost: 8 },
    { id: 'r3', modelId: 'm2', modelTitle: '支架', result: 'failed', endedAt: NOW - 3 * H, weightG: 50, cost: 5 },
    { id: 'r4', modelId: 'm1', modelTitle: '盒子', result: 'finished', endedAt: NOW - 10 * D, weightG: 999 },
  ];
  const cats = [{ id: 'c1', name: '收纳' }, { id: 'c2', name: '工具' }];
  const w = buildWeekly({ models, receipts, categories: cats, now: NOW, weekOffset: 0 });
  eq(w.totals.receipts, 3, '本周回执 3 条');
  eq(w.totals.finished, 2, '成功 2');
  eq(w.totals.failed, 1, '失败 1');
  eq(w.totals.filamentG, 200, '用料只算成功：120+80');
  eq(w.totals.cost, 20, '成本只算成功：12+8');
  eq(w.totals.newModels, 1, '本周新增 1');
  eq(w.topModels[0].prints, 2, 'Top1 打印 2 次');
  eq(w.days.length, 7, '七天柱状');
  ok(w.days.some((d) => d.prints > 0), '有柱子');
  ok(w.byCategory.some((c) => c.name === '收纳'), '分类分布');

  console.log('\n[3] 成就：解锁一次、第二次不再 newly');
  const file = path.join(tmp, 'achievements.json');
  const ach = new Achievements(file);
  const ctx = { models: Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i })), receipts: Array.from({ length: 2 }, () => ({ result: 'finished' })) };
  const a1 = await ach.evaluate(ctx);
  ok(a1.newly.some((x) => x.id === 'first-model'), '首次解锁第一件作品');
  ok(a1.newly.some((x) => x.id === 'ten-models'), '10 个模型解锁');
  ok(!a1.newly.some((x) => x.id === 'fifty-models'), '50 个未解锁');
  eq(a1.unlockedCount, 3, '解锁 3 个（first/ten/first-print）');
  const a2 = await ach.evaluate(ctx);
  eq(a2.newly.length, 0, '重复计算不再 newly');
  const ach2 = new Achievements(file);
  const a3 = await ach2.evaluate(ctx);
  ok(a3.items.find((x) => x.id === 'first-model').unlockedAt, '解锁时间已落盘');

  console.log('\n[4] 护照：许可归一 / 商用判断 / CSV');
  eq(passport.findPreset('CC BY-NC').commercial, false, 'CC BY-NC 禁止商用');
  eq(passport.findPreset('CC BY').commercial, true, 'CC BY 允许商用');
  eq(passport.findPreset('CC BY-SA 4.0').id, 'cc-by-sa', '带版本号的 CC BY-SA 仍能识别');
  eq(passport.findPreset('CC BY-NC 4.0').id, 'cc-by-nc', '带版本号且禁止商用的不会被 CC BY 抢先匹配');
  eq(passport.findPreset('CC BY-NC-ND 4.0'), null, '组合许可（NC-ND）不臆断为单一预设');
  const nc = passport.normalizeLicense({ license: 'cc-by-nc', author: '小明' });
  eq(nc.commercial, false, 'NC 归一后禁止商用');
  eq(nc.commercialLabel, '禁止商用', '中文标签');
  eq(passport.normalizeLicense({}).commercial, null, '未标注 = 未知，不臆断');
  eq(passport.normalizeLicense({ commercialUse: true }).commercial, true, '手填 commercialUse 优先');
  const csv = passport.passportCsv([
    { title: '盒子', fileName: 'box.3mf', license: 'cc-by', author: '小明', categoryId: 'c1', printCount: 2 },
    { title: '支架', fileName: 'stand.3mf', license: 'cc-by-nc' },
  ], cats);
  ok(csv.startsWith('\ufeff'), 'CSV 带 BOM');
  ok(/可否商用/.test(csv), 'CSV 有商用列');
  ok(/允许商用/.test(csv) && /禁止商用/.test(csv), '两种判断都在');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n────────────────────────────');
  console.log('周报/成就/护照测试：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { failures.forEach((f) => console.log('  · ' + f)); process.exit(1); }
})();
