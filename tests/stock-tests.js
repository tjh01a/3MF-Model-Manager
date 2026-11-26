'use strict';
/**
 * D · 耗材库存单测（docs/22 D）
 * 纯 Node，临时目录，不碰真实 data/。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Stock, stockOf, shoppingOf, normalizeStockFields } = require('../src/core/stock');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; failures.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际 ' + JSON.stringify(a) + '）'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-stock-'));
const file = path.join(tmp, 'stock-log.json');

/** 最小 filaments 替身：items 可读、update 可写 */
function makeFilaments(rows) {
  const items = rows.map((r) => ({ id: r.id, name: r.name || r.id, brand: r.brand || 'B', type: r.type || 'PLA', color: r.color || '#112233', pricePerKg: 100, ...r }));
  return {
    items,
    get: (id) => items.find((x) => x.id === id) || null,
    list: () => ({ items }),
    update: async (id, patch) => {
      const i = items.find((x) => x.id === id);
      if (!i) throw new Error('找不到这个耗材');
      Object.assign(i, patch);
      return i;
    },
  };
}

(async () => {
  console.log('\n[1] 字段归一化');
  eq(normalizeStockFields({}).stockG, null, '未设置 stockG = null（不管理）');
  eq(normalizeStockFields({}).fullG, 1000, '默认整卷 1000g');
  eq(normalizeStockFields({}).lowG, 100, '默认阈值 10%');
  const s1 = stockOf({ stockG: 50, fullG: 500, lowG: 60 });
  ok(s1.managed && s1.low, '50/500、阈值 60 → 偏低');
  eq(s1.percent, 10, '进度 10%');
  ok(shoppingOf({ id: 'a', name: 'A', stockG: 20, fullG: 1000, lowG: 100 }).suggestSpools >= 1);

  console.log('\n[2] 回执扣减 / 幂等 / 钳到 0');
  const f2 = makeFilaments([
    { id: 'f1', stockG: 100, lowG: 20, fullG: 1000 },
    { id: 'f2', stockG: null },
    { id: 'f3', stockG: 30, lowG: 50, fullG: 1000 },
  ]);
  const st = new Stock({ filaments: f2, file });
  const receipt = { id: 'r1', jobName: 'job', modelTitle: 'M' };
  const r1 = await st.deductReceipt(receipt, [
    { filamentId: 'f1', grams: 60 },
    { filamentId: 'f2', grams: 100 },
    { filamentId: 'f1', grams: 10 },        // 同一回执同耗材只扣一次
    { filamentId: 'nope', grams: 5 },
  ]);
  eq(f2.get('f1').stockG, 40, '只扣一次：100 - 60');
  eq(f2.get('f2').stockG, null, '不管理库存的不动');
  ok(r1.skipped.some((x) => x.reason === 'already'), '重复扣减被跳过');
  const r2 = await st.deductReceipt({ id: 'r1' }, [{ filamentId: 'f1', grams: 60 }]);
  eq(f2.get('f1').stockG, 40, '同一回执再扣一次仍不动');
  ok(r2.deducted.length === 0);
  const r3 = await st.deductReceipt({ id: 'r2' }, [{ filamentId: 'f3', grams: 100 }]);
  eq(f2.get('f3').stockG, 0, '扣到负数钳到 0');
  ok(r3.deducted[0].clamped, '标记 clamped，提示称重');
  const clampLog = st.log()[0];
  eq(clampLog.deltaG, -30, '流水只记实际扣掉的 30g，不虚记 100g');
  await st.undo(clampLog.id);
  eq(f2.get('f3').stockG, 30, '撤销后回到扣减前的 30g');

  console.log('\n[3] 手动调整 / 撤销');
  const a = await st.adjust({ filamentId: 'f1', stockG: 500, addSpools: 2 });
  eq(f2.get('f1').stockG, 500, '称重写入');
  eq(f2.get('f1').spools, 2, '+2 卷备用');
  const undo = await st.undo(a.entry.id);
  eq(f2.get('f1').stockG, 40, '撤销称重回到 40');
  eq(f2.get('f1').spools, 0, '撤销备用卷');
  ok(!!undo.status, '返回最新库存状态');
  try {
    await st.undo(a.entry.id);
    ok(false, '同一笔流水不能重复撤销');
  } catch (e) {
    ok(/已经撤销过/.test(e.message), '同一笔流水不能重复撤销');
  }

  console.log('\n[4] 低库存 / 采购清单 / CSV');
  const low = st.lowList();
  ok(low.some((x) => x.id === 'f3') && !low.some((x) => x.id === 'f1'), '只列低于阈值的');
  const shop = st.shoppingList();
  ok(shop.some((x) => x.id === 'f3'), '采购清单包含 f3');
  ok(shop.every((x) => x.suggestSpools >= 1), '建议购买量至少 1 卷');
  const csv = st.shoppingCsv();
  ok(csv.startsWith('\ufeff'), 'CSV 带 BOM，Excel 不乱码');
  ok(/建议购买\(卷\)/.test(csv), 'CSV 有表头');

  console.log('\n[5] 流水持久化 + 重新加载');
  const st2 = new Stock({ filaments: f2, file });
  ok(st2.log().length >= 4, '流水已落盘：' + st2.log().length);
  ok(st2.has('r1', 'f1'), '幂等标记落盘后仍有效');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n────────────────────────────');
  console.log('库存测试：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { failures.forEach((f) => console.log('  · ' + f)); process.exit(1); }
})();
