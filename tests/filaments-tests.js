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
const { ReceiptService, normalizeJobName, looseJobName, matchModel, matchModelFuzzy } = require('../src/core/receipts');
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

    // 默认耗材：未分配耗材时按 重量 × 默认单价 估算
    const def = { id: 'f1', name: 'Bambu PLA', pricePerKg: 120, color: '#FFFFFF' };
    const withDef = cost.costOf({ meta: { weightG: 100, weightSource: 'slice_info' } }, fsLib,
      { defaultFilament: def });
    ok('默认耗材计价（100g × ¥120/kg = ¥12）', Math.abs(withDef.total - 12) < 0.01, JSON.stringify(withDef));
    ok('默认耗材来源标记 default 且 complete', withDef.source === 'default' && withDef.complete === true,
      JSON.stringify(withDef));
    ok('默认耗材明细带正确克数', withDef.parts.length === 1 && withDef.parts[0].grams === 100);
    const noWeight = cost.costOf({ meta: {} }, fsLib, { defaultFilament: def });
    ok('无重量时默认耗材也算不出', noWeight.total === 0 && noWeight.complete === false);
    const assigned = cost.costOf({
      meta: { weightG: 90.39 }, filamentLinks: [{ filamentId: 'f1', weightG: 90.39 }],
    }, fsLib, { defaultFilament: def });
    ok('已分配耗材时不被默认覆盖', assigned.source === 'assigned' && Math.abs(assigned.total - 10.85) < 0.02);

    // 有切片逐耗材用量、但耗材库里没有对应颜色/类型的耗材 → 单价 0，也要用默认耗材兜底
    const usageNoMatch = cost.costOf({
      meta: {
        weightG: 34.83,
        filamentUsages: [{ type: 'PLA', color: '#00FF80', usedG: 34.83 }],
      },
    }, fsLib, { defaultFilament: def });
    ok('用量匹配不到耗材时用默认耗材兜底（34.83g × ¥120/kg ≈ ¥4.18）',
      Math.abs(usageNoMatch.total - 4.18) < 0.02, JSON.stringify(usageNoMatch));
    ok('兜底后明细只剩默认耗材一行（不混 ¥0.00 占位行）',
      usageNoMatch.parts.length === 1 && usageNoMatch.parts[0].filamentId === 'f1');
    ok('兜底来源标记 default', usageNoMatch.source === 'default');

    // 耗材被删除后不能伪装成「未分配」，明细要明确告诉用户数据来自已删耗材
    const deletedFil = cost.costOf({
      meta: { weightG: 100 },
      filamentLinks: [{ filamentId: 'gone', weightG: 100 }],
    }, fsLib);
    ok('已删除耗材在明细中明确标注',
      deletedFil.parts.length === 1 && deletedFil.parts[0].name === '耗材已删除',
      JSON.stringify(deletedFil.parts));

    // 部分有价、部分无价时不能被默认耗材整体覆盖
    const partial = cost.costOf({
      meta: { weightG: 80, filamentUsages: [] },
      filamentLinks: [{ filamentId: 'f1', weightG: 50 }, { filamentId: 'missing', weightG: 30 }],
    }, fsLib, { defaultFilament: def });
    ok('已有真实价格时不被默认覆盖', partial.total === 6 && partial.source === 'assigned',
      JSON.stringify(partial));
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
    // 批量路径也要透传默认耗材，否则卡片仍显示 ¥??
    const def = { id: 'f1', name: 'Bambu PLA', pricePerKg: 120 };
    const batchDef = cost.costOfBatch({ m2: models.m2 }, fl, { defaultFilament: def });
    // m2 连重量都没有，默认耗材也算不出价格——断言的是「仍是 ¥??」，名称不能写成变成有价。
    ok('批量默认耗材计价：m2 仍无重量时保持 ¥??（不编造价格）',
      batchDef.m2.total === 0 && batchDef.m2.complete === false, JSON.stringify(batchDef.m2));
    const batchDefWeight = cost.costOfBatch({ m2: { id: 'm2', meta: { weightG: 50 } } }, fl, { defaultFilament: def });
    ok('批量默认耗材：50g × ¥120/kg = ¥6',
      Math.abs(batchDefWeight.m2.total - 6) < 0.01, JSON.stringify(batchDefWeight.m2));
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

    // 默认耗材
    ok('初始无默认耗材', svc.list().defaultId === null && svc.getDefault() === null);
    await svc.setDefault(a.id);
    ok('设置默认耗材', svc.list().defaultId === a.id && svc.getDefault().id === a.id);
    let rejected = false;
    try { await svc.setDefault('fil-not-exist'); } catch (_) { rejected = true; }
    ok('不存在的耗材不能设为默认', rejected);
    await svc.setDefault(null);
    ok('取消默认', svc.getDefault() === null);
    await svc.setDefault(a.id);

    // 图片：造一个假 PNG 文件
    const imgFile = path.join(tmp, 'test.png');
    fs.writeFileSync(imgFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const r = await svc.setImage(a.id, imgFile);
    ok('图片按哈希命名（24 位 hex）', /^[0-9a-f]{24}\.png$/.test(r.image), r.image);
    ok('图片文件确实落盘', fs.existsSync(path.join(paths.getFilamentImagesDir(), r.image)));
    const r2 = await svc.setImage(a.id, imgFile);
    ok('同一张图重复导入文件名不变', r2.image === r.image);

    // 扩展名会骗人：webp 改名成 .png 存进去就是破图，必须按文件头拒绝
    const fakePng = path.join(tmp, 'fake.png');
    fs.writeFileSync(fakePng, Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]));
    let fakeRejected = false;
    try { await svc.setImage(a.id, fakePng); } catch (_) { fakeRejected = true; }
    ok('改了扩展名的 webp 会被拒绝', fakeRejected);

    // 裁剪后走 setImageBuffer：JPEG 头要落成 .jpg，不能一律存 .png
    const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const rj = await svc.setImageBuffer(a.id, jpgBuf);
    ok('按文件头决定扩展名（JPEG）', /^[0-9a-f]{24}\.jpg$/.test(rj.image), rj.image);

    await svc.remove(a.id);
    ok('删除后清单为空', svc.list().items.length === 0);
    ok('删除默认耗材时清空默认指向', svc.getDefault() === null && svc.list().defaultId === null);
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

    // 分多次打印会让同一个模型出现 _plate_2 / (3) / 尾部编号等变体（用户 2026-11-24 反馈）
    ok('剥掉盘号后缀', looseJobName('沙奈朵拆(3)_plate_2') === '沙奈朵拆',
      looseJobName('沙奈朵拆(3)_plate_2'));
    ok('剥掉括号编号', looseJobName('沙奈朵拆（2）.3mf') === '沙奈朵拆', looseJobName('沙奈朵拆（2）.3mf'));
    ok('剥掉材料与时长后缀', looseJobName('组合体_PETG_6h4m.gcode') === '组合体',
      looseJobName('组合体_PETG_6h4m.gcode'));
    ok('剥掉尾部数字编号', looseJobName('灯箱草稿_3') === '灯箱草稿', looseJobName('灯箱草稿_3'));

    const plateModels = {
      a: { id: 'a', fileName: '沙奈朵拆(3).3mf', title: '沙奈朵拆(3)', status: 'ok' },
      d: { id: 'd', fileName: '沙奈朵拆_plate_4.3mf', title: '沙奈朵拆_plate_4', status: 'ok' },
      n: { id: 'n', fileName: 'No_AMS.3mf', title: 'No AMS', status: 'ok' },
    };
    ok('分盘任务自动关联到同源模型',
      (matchModelFuzzy('沙奈朵拆(3)_plate_2', plateModels).model || {}).id === 'a',
      JSON.stringify(matchModelFuzzy('沙奈朵拆(3)_plate_2', plateModels)));
    ok('同名不同盘号按原始后缀区分',
      (matchModelFuzzy('沙奈朵拆_plate_4', plateModels).model || {}).id === 'd');
    ok('无关名字不乱连', matchModelFuzzy('完全不相干的模型', plateModels).model === null);

    // 真实库里的情况：沙奈朵拆 与 沙奈朵拆(3) 同时存在，归一后都是「沙奈朵拆」。
    // 早先只卡分数差会判成「太像不敢猜」，实际按原始后缀能确定是哪一个（用户 2026-11-24 反馈）。
    const sameBase = {
      plain: { id: 'plain', fileName: '沙奈朵拆.3mf', title: '沙奈朵拆', status: 'ok' },
      three: { id: 'three', fileName: '沙奈朵拆(3).3mf', title: '沙奈朵拆(3)', status: 'ok' },
    };
    const pick = matchModelFuzzy('沙奈朵拆(3)_plate_2', sameBase);
    ok('同名基础名时按原始后缀挑对', (pick.model || {}).id === 'three' && pick.ambiguous === false,
      JSON.stringify(pick));
    // 但两条记录名字完全一样时仍要放弃，交给用户手点
    const twins = {
      t1: { id: 't1', fileName: 'benchy.3mf', title: 'benchy', status: 'ok' },
      t2: { id: 't2', fileName: 'benchy.3mf', title: 'benchy', status: 'ok' },
    };
    ok('完全同名仍然不猜', matchModelFuzzy('benchy_plate_2', twins).model === null);

    const svc0 = await new ReceiptService().init();
    await svc0.add({ jobName: '沙奈朵拆(3)_plate_2', printerId: 'p9', printerName: 'X1',
      result: 'finished', startedAt: 5000, endedAt: 65000 });
    const rec0 = svc0.list()[0];
    await svc0.linkModel(rec0.id, 'a', '沙奈朵拆(3)', { manual: false });
    const afterLink = svc0.get(rec0.id);
    ok('自动关联不标成手动', afterLink.modelId === 'a' && afterLink.linkedManually === false,
      JSON.stringify({ m: afterLink.modelId, manual: afterLink.linkedManually }));
    ok('去重能认出同一次打印',
      !!svc0.findRecentJob('p9', '沙奈朵拆(3)_plate_2', 66000));
    ok('不同打印机不算同一次',
      svc0.findRecentJob('p8', '沙奈朵拆(3)_plate_2', 66000) === null);
    await svc0.clear();

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

    // 长按编辑模式：按 id 删除选中的回执
    const a = await svc.add({ jobName: 'a.3mf', result: 'finished', endedAt: 3000 });
    const b = await svc.add({ jobName: 'b.3mf', result: 'finished', endedAt: 2000 });
    const c = await svc.add({ jobName: 'c.3mf', result: 'error', endedAt: 1000 });
    const del = await svc.delete([a.id, 'rcp-not-exist']);
    ok('按 id 删除选中的回执', del.deleted === 1 && svc.list().length === 2, JSON.stringify(del));
    ok('找不到的 id 记入 failed', del.failed.length === 1 && del.failed[0] === 'rcp-not-exist');
    ok('其余回执不受影响', svc.list().some((r) => r.id === b.id) && svc.list().some((r) => r.id === c.id));
    const s2 = svc.summary();
    ok('汇总随删除重算（成功 1 / 异常 1）', s2.prints === 1 && s2.failures === 1, JSON.stringify(s2));
    const del2 = await svc.delete([]);
    ok('空 id 列表安全返回', del2.deleted === 0 && svc.list().length === 2);

    // 手动关联 / 改绑模型
    const link = await svc.linkModel(b.id, 'm2', '卡比喷气 发布');
    const linked = svc.get(b.id);
    ok('回执可以按 id 关联模型', link.ok === true && linked.modelId === 'm2', JSON.stringify(link));
    ok('关联后保存模型名快照', linked.modelTitle === '卡比喷气 发布' && linked.linkedManually === true);
    ok('关联不改成本与用料快照', linked.cost === 0 && linked.weightG === null && linked.jobName === 'b.3mf');
    const relink = await svc.linkModel(b.id, 'm3', '另一个模型');
    ok('可以再次改绑模型', relink.ok === true && svc.get(b.id).modelId === 'm3');
    const cleared = await svc.linkModel(b.id, null, null);
    ok('可以清除关联', cleared.ok === true && svc.get(b.id).modelId === null &&
      svc.get(b.id).modelTitle === null && svc.get(b.id).linkedManually === false);
    const missing = await svc.linkModel('rcp-not-exist', 'm2', '不存在');
    ok('关联不存在的回执安全返回', missing.ok === false && svc.list().length === 2);
    await svc.clear();
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
