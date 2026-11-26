'use strict';
/**
 * 打印回执清空后的去重墓碑：清空 / 单条删除后重启，监控补录不能再把同一次打印补回来。
 * 同时保证真正重新打印一次（开始时间不同）仍然能记账。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-receipts-'));
const paths = require('../src/core/paths');
paths.setDataDir(dir);
const { ReceiptService } = require('../src/core/receipts');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

(async () => {
  const svc = await new ReceiptService().init();
  const p = { printerId: 'p1', printerName: 'X1', jobName: '打印徽章.u1.3mf', result: 'finished', startedAt: 1000, endedAt: 61000 };
  const rec = await svc.add(p);
  ok('先落一条回执', svc.list().length === 1);

  console.log('\n[1. 清空后重启，旧任务不能再补录]');
  await svc.clear();
  ok('当前列表已空', svc.list().length === 0);
  const raw = JSON.parse(fs.readFileSync(paths.getReceiptsPath(), 'utf8'));
  ok('清空后仍保留任务墓碑', Array.isArray(raw.seenJobs) && raw.seenJobs.length === 1
    && raw.seenJobs[0].p === 'p1' && raw.seenJobs[0].n === p.jobName, JSON.stringify(raw.seenJobs));
  const svc2 = await new ReceiptService().init();
  ok('重启后列表仍为空', svc2.list().length === 0, svc2.list().length);
  const hit = svc2.findRecentJob('p1', p.jobName, 200000, 6 * 3600 * 1000, 1000);
  ok('补录去重能认出清空前的那次打印', !!hit && hit.seen === true, JSON.stringify(hit));
  ok('不会因为清空就重新记账', svc2.get(rec.id) === null);

  console.log('\n[2. 真正重打一次仍要能记]');
  const fresh = svc2.findRecentJob('p1', p.jobName, 3600000, 6 * 3600 * 1000, 3600000);
  ok('开始时间相差一小时 → 当成新打印', fresh === null, JSON.stringify(fresh));
  await svc2.add({ printerId: 'p1', printerName: 'X1', jobName: p.jobName, result: 'finished', startedAt: 3600000, endedAt: 3660000 });
  ok('新打印正常落回执', svc2.list().length === 1 && svc2.list()[0].startedAt === 3600000);

  console.log('\n[3. 单条删除也留墓碑]');
  const id = svc2.list()[0].id;
  await svc2.delete([id]);
  ok('删除后列表为空', svc2.list().length === 0);
  const svc3 = await new ReceiptService().init();
  ok('重启后删除的那条不会复活', svc3.list().length === 0);
  ok('删除的回执也能被去重拦住',
    !!svc3.findRecentJob('p1', p.jobName, 4000000, 6 * 3600 * 1000, 3600000));

  console.log('\n[4. 墓碑有上限，不会无限长大]');
  for (let i = 0; i < 520; i++) {
    await svc3.add({ printerId: 'p2', printerName: 'Y', jobName: 'j' + i, result: 'finished', startedAt: 500000 + i * 1000, endedAt: 501000 + i * 1000 });
  }
  const raw3 = JSON.parse(fs.readFileSync(paths.getReceiptsPath(), 'utf8'));
  ok('seenJobs 最多 500 条', raw3.seenJobs.length <= 500, raw3.seenJobs.length);

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 临时目录，尽力清理 */ }
  console.log('\n' + '='.repeat(56));
  console.log('  回执清空去重测试：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('='.repeat(56));
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('测试异常：', e);
  process.exitCode = 1;
});
