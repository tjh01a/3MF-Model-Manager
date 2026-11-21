/**
 * 快造预设诊断（只读）：列出用户预设、继承链断点、备份状态、.3mf 关联。
 *   node tools/preset-report.js
 *   node tools/preset-report.js --backup   顺带打一份快照
 */
const path = require('path');
const Store = require('../src/core/store');
const OrcaPresets = require('../src/core/orcapresets');
const PresetGuard = require('../src/core/presetguard');

(async () => {
  const store = new Store({});
  await store.init();
  const presets = new OrcaPresets({ store });
  const guard = new PresetGuard({ store, presets });

  const roots = presets.userRoots();
  console.log('用户预设目录：');
  if (!roots.length) console.log('  (没找到，快造可能没装或没建过预设)');
  roots.forEach((r) => console.log('  ' + r));

  const h = guard.health();
  console.log('\n预设数量：耗材 %d / 工艺 %d / 机型 %d',
    h.counts.filament, h.counts.process, h.counts.machine);

  console.log('\n明细：');
  for (const p of h.presets) {
    const flag = p.ok ? '✓' : '✗';
    console.log('  %s [%s] %s%s%s', flag, p.kind, p.name,
      p.inherits ? '  ← 继承 ' + p.inherits : '  (无继承)',
      p.ok ? '' : '   ⚠ 断链：' + p.missing.join('、'));
  }

  if (h.broken.length) {
    console.log('\n⚠ %d 个预设在快造里会看不到（继承链断了）', h.broken.length);
  }
  for (const f of h.foreign) {
    console.log('\n其它程序的预设目录（不会被读取）：%s → %d 个', f.app, f.presets);
  }

  const latest = guard.latest();
  console.log('\n备份：%s', latest ? latest.id + '（' + latest.reason + '，' + latest.files + ' 文件，' + latest.bytes + ' 字节）' : '还没有备份');

  if (process.argv.includes('--backup')) {
    const r = guard.snapshot({ reason: '手动备份', force: true });
    console.log('已备份：%s（%d 个文件）', r ? r.id : '无内容，跳过', r ? r.files : 0);
  }
})().catch((e) => { console.error('失败：', e.message); process.exitCode = 1; });
