'use strict';
/**
 * 13 · 耗材库 / 成本账本 / 打印回执 的单元测试。
 * 纯内存 + 系统临时目录，不碰真实库、不启 Electron。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../src/core/paths');
const cost = require('../src/core/cost');
const { FilamentService, normalizeColor, normalizePrice, PRESETS, TYPES } = require('../src/core/filaments');
const { ReceiptService, normalizeJobName, matchModel } = require('../src/core/receipts');
const { parse3mf } = require('../src/core/model3mf');
const { PrinterMonitor } = require('../src/core/monitor');
const { EventEmitter } = require('events');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-filaments-'));
paths.setDataDir(tmp);

(async () => {
  section('1. 成本纯函数');
  {
    const fsLib = { f1: { id: 'f1', name: 'Bambu PLA', pricePerKg: 120, color: '#FFFFFF' } };
    const r = cost.costOf({
      meta: { weightG: 90.39, weightSource: 'slice_info' },
      filamentLinks: [{ filamentId: 'f1', weightG: 90.39 }],
    }, fsLib);
    ok('元/kg 换算正确（90.39g × ¥120/kg ≈ ¥10.85）', Math.abs(r.total - 10.85) < 0.02, String(r.total));
    ok('分配后 complete=true', r.complete === true);
    ok('明细带名字与克数', r.parts.length === 1 && r.parts[0].grams === 90.39);

    const none = cost.costOf({ meta: {} }, fsLib);
    ok('无数据时 complete=false 且总价 0', none.complete === false && none.total === 0);
    const bad = cost.costOf({ meta: { weightG: 99999 } }, fsLib);
    ok('异常重量被过滤（>5000g）', bad.weightG == null);
    ok('人民币格式化', cost.yuan(10.855) === '¥10.86', cost.yuan(10.855));
    ok('体积估算用 PLA 密度', Math.abs(cost.estimateWeightByVolume({ volumeCm3: 100 }, 'PLA') - 124) < 0.01);
    // FilamentService.list() 返回的是 {items:[...]}，不是 {id:...}——曾静默算成 0 元
    const asList = cost.costOf({
      filamentLinks: [{ filamentId: 'f1', weightG: 100 }],
    }, { items: [{ id: 'f1', name: 'Bambu PLA', pricePerKg: 120 }] });
    ok('兼容 filamentsList() 的 {items:数组} 格式（100g × ¥120/kg = ¥12）',
      asList.total === 12 && asList.parts[0].name === 'Bambu PLA', JSON.stringify(asList));
  }

  section('1b. 批量成本（卡片价格数据源 docs/14）');
  {
    const fl = { items: [{ id: 'f1', name: 'Bambu PLA', pricePerKg: 120, color: '#FFFFFF' }] };
    const models = {
      m1: { id: 'm1', filamentLinks: [{ filamentId: 'f1', weightG: 100 }] },   // ¥12
      m2: { id: 'm2', meta: {} },                                             // 算不出
      m3: { id: 'm3', filamentLinks: [{ filamentId: 'f1', weightG: 50 }] },    // ¥6
    };
    const batch = cost.costOfBatch(models, fl);
    ok('一次返回全部模型的派生成本', Object.keys(batch).length === 3, JSON.stringify(Object.keys(batch)));
    ok('m1 = ¥12 且 complete', batch.m1.total === 12 && batch.m1.complete === true, JSON.stringify(batch.m1));
    ok('m2 算不出 → total 0 / complete false（卡片显示 ¥??）',
      batch.m2.total === 0 && batch.m2.complete === false, JSON.stringify(batch.m2));
    ok('m3 = ¥6', batch.m3.total === 6, JSON.stringify(batch.m3));
    const arrBatch = cost.costOfBatch([models.m1, models.m3], fl);
    ok('数组入参同样支持', arrBatch.m1.total === 12 && arrBatch.m3.total === 6, JSON.stringify(arrBatch));
    ok('空库不抛错', Object.keys(cost.costOfBatch(null, fl)).length === 0);
  }

  section('2. 3MF 重量提取（真实样本）');
  {
    const real = 'C:/Users/10104/Downloads/0.6圆底拼接测试.3mf';
    if (fs.existsSync(real)) {
      const p = await parse3mf(real);
      ok('真实样本解析成功', p.ok === true);
      ok('提取到切片重量 90.39g', p.meta.weightG === 90.39, String(p.meta.weightG));
      ok('来源是 slice_info', p.meta.weightSource === 'slice_info', String(p.meta.weightSource));
      ok('提取到逐耗材用量', p.meta.filamentUsages.length >= 1 &&
        Math.abs(p.meta.filamentUsages[0].usedG - 90.39) < 0.01,
        JSON.stringify(p.meta.filamentUsages));
      ok('耗材类型是 PETG', p.meta.filamentUsages[0].type === 'PETG');
    } else {
      console.log('  (跳过：本机样本不存在)');
    }
    const noSlice = 'C:/Users/10104/Downloads/10_Harry+Potters+Eule_Bambu-P1S.3mf';
    if (fs.existsSync(noSlice)) {
      const p = await parse3mf(noSlice);
      ok('无切片数据的文件 weightG 为 null 而不是报错', p.ok === true && p.meta.weightG == null);
    }
  }

  section('3. 耗材库 CRUD 与图片');
  {
    const svc = await new FilamentService().init();
    const list0 = svc.list();
    ok('预设只放主流品牌', list0.presets.length > 40 && list0.presets.length < 100 &&
      list0.presets.every((p) => /Bambu|eSUN|Snapmaker|Creality|Polymaker|Anycubic/.test(p.brand)),
      String(list0.presets.length));
    ok('品牌/类型表齐备', list0.brands.length >= 6 && list0.types.includes('PLA') && list0.types.includes('PETG'));

    const a = await svc.create({ name: '我的 PLA', type: 'PLA', color: '#FF0099', pricePerKg: 88.8 });
    ok('新建耗材', !!a.id && a.pricePerKg === 88.8);
    const b = await svc.update(a.id, { name: '我的 PLA 改', pricePerKg: 99, color: 'red' });
    ok('更新名称与价格', b.name === '我的 PLA 改' && b.pricePerKg === 99);
    ok('非法颜色被拒绝（不进 CSS）', b.color === null, String(b.color));
    ok('清单按更新时间倒序返回一条', svc.list().items.length === 1);

    // 图片：造一个假 PNG 文件
    const imgFile = path.join(tmp, 'test.png');
    fs.writeFileSync(imgFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const r = await svc.setImage(a.id, imgFile);
    ok('图片按哈希命名（24 位 hex）', /^[0-9a-f]{24}\.png$/.test(r.image), r.image);
    ok('图片文件确实落盘', fs.existsSync(path.join(paths.getFilamentImagesDir(), r.image)));
    const r2 = await svc.setImage(a.id, imgFile);
    ok('同一张图重复导入文件名不变', r2.image === r.image);

    await svc.remove(a.id);
    ok('删除后清单为空', svc.list().items.length === 0);
    ok('颜色归一化工具', normalizeColor('#ABCDEF') === '#abcdef' && normalizeColor('xyz') === null);
    ok('价格归一化（非负、两位）', normalizePrice(12.345) === 12.35 && normalizePrice(-1) === 0);
  }

  section('4. 打印回执与文件名匹配');
  {
    ok('去扩展名 / 去 U1 后缀后按小写比对',
      normalizeJobName('C:/x/大肥鱼_U1_26df024b.3mf') === '大肥鱼',
      normalizeJobName('C:/x/大肥鱼_U1_26df024b.3mf'));
    const models = {
      m1: { id: 'm1', fileName: 'benchy.3mf', status: 'ok' },
      m2: { id: 'm2', fileName: 'vase.3mf', status: 'ok' },
    };
    ok('精确匹配单个模型', (matchModel('benchy.gcode', models) || {}).id === 'm1');
    ok('匹配不到返回 null', matchModel('unknown.3mf', models) === null);
    ok('同名多份时不猜（返回 null）',
      matchModel('benchy.3mf', { m1: models.m1, m3: { id: 'm3', fileName: 'benchy.3mf', status: 'ok' } }) === null);

    const svc = await new ReceiptService().init();
    await svc.add({ jobName: 'benchy.3mf', printerId: 'p1', printerName: 'A1', result: 'finished',
      startedAt: 1000, endedAt: 61000, modelId: 'm1', weightG: 90.39, cost: 10.85, filamentNames: ['Bambu PLA'] });
    await svc.add({ jobName: 'bad.gcode', printerId: 'p1', printerName: 'A1', result: 'error',
      startedAt: 2000, endedAt: 3000, filamentNames: [] });
    const all = svc.list();
    ok('两条回执都在', all.length === 2);
    ok('耗时按分钟计算', all.find((r) => r.result === 'finished').durationMin === 1);
    const s = svc.summary();
    ok('汇总只算成功打印', s.prints === 1 && s.failures === 1 && s.totalGrams === 90.39 && s.totalCost === 10.85,
      JSON.stringify(s));
    await svc.clear();
    ok('清空后为空', svc.list().length === 0);
  }

  section('5. monitor 终态 → 回执事件（不受通知开关影响）');
  {
    let T = 1700000000000;
    const mkMon = (settings) => new PrinterMonitor({
      store: { getSettings: () => settings || {} }, dataDir: path.join(tmp, 'mon' + Math.random().toString(36).slice(2, 7)),
      now: () => T,
    });
    const s = (over) => Object.assign({
      id: 'p1', name: 'A1', online: true, state: 'printing', stateText: '打印中',
      job: { name: 'benchy.3mf', percent: 10 },
      temps: { nozzle: { cur: 220, target: 220 }, bed: { cur: 60, target: 60 } },
    }, over || {});

    // 通知全关，也必须有 job 事件，否则关通知的用户就没有回执
    const m = mkMon({ notify: { enabled: false }, monitor: { enabled: false } });
    const jobs = [];
    m.on('job', (j) => jobs.push(j));
    const notifies = [];
    m.on('notify', (n) => notifies.push(n));
    m.start();
    m.onStatus(s());                                        // 首次 printing，建立 lastState
    T += 60000;
    m.onStatus(s({ state: 'finished', stateText: '完成', job: { name: 'benchy.3mf', percent: 100 } }));
    ok('通知关闭时仍发 job 事件', jobs.length === 1 && jobs[0].result === 'finished', JSON.stringify(jobs));
    ok('通知关闭时不发 notify 事件', notifies.length === 0);
    ok('job 带打印机 id / 任务名 / 起止时间', jobs[0].printerId === 'p1' &&
      jobs[0].jobName === 'benchy.3mf' && jobs[0].startedAt > 0 && jobs[0].at >= jobs[0].startedAt);

    T += 1000;
    m.onStatus(s({ state: 'idle', job: null }));
    T += 1000;
    m.onStatus(s({ state: 'printing', job: { name: 'bad.3mf', percent: 1 } }));
    T += 1000;
    m.onStatus(s({ state: 'error', stateText: '异常', job: { name: 'bad.3mf', percent: 30 } }));
    ok('失败也发 job 事件', jobs.length === 2 && jobs[1].result === 'error');
    T += 1000;
    m.onStatus(s({ state: 'idle', job: null }));
    T += 1000;
    m.onStatus(s({ state: 'printing', job: { name: 'paused.3mf', percent: 5 } }));
    T += 1000;
    m.onStatus(s({ state: 'paused', stateText: '暂停', job: { name: 'paused.3mf', percent: 5 } }));
    ok('暂停不发回执事件', jobs.length === 2, String(jobs.length));
    m.stop();
  }

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
})();
