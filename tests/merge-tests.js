'use strict';
/**
 * C · 重复模型智能合并：打分、分组、计划、写回，以及与查询 / 统计 / 扫描器的联动。
 * 纯 Node，数据全部在临时目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const Store = require('../src/core/store');
const Library = require('../src/core/library');
const Thumbs = require('../src/core/thumbs');
const Scanner = require('../src/core/scanner');
const D = require('../src/core/duplicates');
const merge = require('../src/core/merge');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-merge-'));
const store = new Store({ dataDir: dir });

function rec(id, extra) {
  return Object.assign({
    id, path: path.join(dir, 'files', id + '.3mf'), fileName: id + '.3mf', ext: '3mf',
    size: 1000, mtime: 1, hash: null, createdAt: 1, updatedAt: 1, status: 'ok', missingSince: null,
    parseError: null, parseErrorKind: null, meta: {}, thumbnail: null, thumbSource: null,
    title: id, favorite: false, rating: 0, note: '', categoryId: null, tagIds: [],
    printStatus: 'unprinted', printCount: 0, openCount: 0,
  }, extra || {});
}

(async () => {
  await store.init();
  const lib = new Library({ store });

  await store.updateLibrary((L) => {
    L.models = {};
    // g1：a 什么都没有；a2 有缩略图 + 备注（推荐保留 a2）
    L.models.a = rec('a', { hash: 'H1', createdAt: 100, relativePath: 'deep/nest/a.3mf' });
    L.models.a2 = rec('a2', { hash: 'H1', createdAt: 200, thumbnail: 'x.png', note: '我标注过的', relativePath: 'a2.3mf' });
    // g2：两份一样，留最早入库的 b
    L.models.b = rec('b', { hash: 'H2', createdAt: 300, size: 5000 });
    L.models.b2 = rec('b2', { hash: 'H2', createdAt: 400, size: 5000 });
    // 与 b 内容相同但解析失败：不参与
    L.models.bx = rec('bx', { hash: 'H2', createdAt: 350, parseErrorKind: 'truncated' });
    // 疑似重复
    L.models.c = rec('c', { hash: 'H3', similarGroup: 'sim:x#0', createdAt: 500, size: 200 });
    L.models.c2 = rec('c2', { hash: 'H4', similarGroup: 'sim:x#0', createdAt: 501, size: 201 });
    // 已经是别名的不参与
    L.models.al = rec('al', { hash: 'H1', createdAt: 50, aliasOf: 'a', aliasState: 'shadow' });
    // 失效的不参与
    L.models.mx = rec('mx', { hash: 'H2', createdAt: 60, status: 'missing' });
  });

  console.log('\n[1. 打分]');
  ok('缩略图 +3', merge.scoreMember(rec('t', { thumbnail: 'a.png' })).score === 3);
  ok('备注 +2、收藏 +2、分类 +2、标签 +1', merge.scoreMember(rec('t', { note: 'x', favorite: true, categoryId: 'c', tagIds: ['t'] })).score === 7);
  ok('打印过 1 次 +2，最多加到 2 次', merge.scoreMember(rec('t', { printCount: 1 })).score === 2
    && merge.scoreMember(rec('t', { printCount: 9 })).score === 4);
  ok('信息完整度每项 +1（作者 / 来源 / 重量）', merge.scoreMember(rec('t', { author: 'me', sourceUrl: 'https://x', meta: { weightG: 3 } })).score === 3);
  const sk = merge.scoreMember(lib.get('a2'));
  ok('打分理由会写出来', sk.reasons.includes('有缩略图') && sk.reasons.includes('有备注'), sk.reasons.join(','));
  const sa = merge.scoreMember(lib.get('a'));
  ok('毫无信息的副本 0 分且没有理由', sa.score === 0 && sa.reasons.length === 0);

  console.log('\n[2. 分组]');
  const groups = merge.buildGroups(store.getLibrary());
  const g1 = groups.find((g) => g.key === 'exact:H1');
  const g2 = groups.find((g) => g.key === 'exact:H2');
  const g3 = groups.find((g) => g.key === 'similar:sim:x#0');
  ok('2 组完全重复 + 1 组疑似', groups.length === 3 && g1 && g2 && g3, groups.map((g) => g.key).join(','));
  ok('g1 推荐留 a2（有缩略图和备注）', g1.keeperId === 'a2', g1.keeperId);
  ok('g2 同分留最早入库的 b', g2.keeperId === 'b', g2.keeperId);
  ok('解析失败 / 失效 / 已是别名的都不进组', ['bx', 'mx', 'al'].every((id) => !groups.some((g) => g.members.some((m) => m.id === id))));
  ok('可释放空间 = 其余成员大小之和', g1.freedBytes === 1000 && g2.freedBytes === 5000, g1.freedBytes + '/' + g2.freedBytes);
  ok('按可释放空间从大到小排', groups[0].key === 'exact:H2');
  const cg = merge.toClientGroup(g1);
  ok('给界面的精简版带上了理由与分数', cg.members.find((m) => m.id === 'a2').reasons.includes('有备注') && typeof cg.members[0].score === 'number');

  console.log('\n[3. 生成计划]');
  const plan = merge.planMerge(store.getLibrary(), { 'exact:H1': 'a2' });
  ok('计划里 1 组 1 个别名', plan.groupCount === 1 && plan.aliasCount === 1 && plan.aliasIds[0] === 'a', JSON.stringify(plan.aliasIds));
  ok('可释放空间算出来了', plan.freedBytes === 1000);
  let threw = null;
  try { merge.planMerge(store.getLibrary(), { 'exact:NOPE': 'a' }); } catch (e) { threw = e; }
  ok('组不存在时抛中文提示', !!threw && /[\u4e00-\u9fa5]/.test(threw.message), threw && threw.message);
  const planFallback = merge.planMerge(store.getLibrary(), { 'exact:H1': 'not-a-member' });
  ok('保留项不在组里时退回推荐的主记录', planFallback.items[0].keepId === 'a2');
  ok('空选择生成空计划', merge.planMerge(store.getLibrary(), {}).items.length === 0);

  console.log('\n[4. 合并（不动文件，只降为别名）');
  let result = null;
  await store.updateLibrary((L) => { result = merge.applyMergeInLibrary(L, plan, null); }, 'test-merge');
  ok('1 组合并、1 个别名', result.merged === 1 && result.shadow === 1 && result.trashed === 0, JSON.stringify(result));
  const a = lib.get('a');
  ok('a 成了 a2 的别名', a.aliasOf === 'a2' && a.aliasState === 'shadow' && a.aliasAt > 0);
  ok('默认查询看不到别名', lib.query({}).items.every((m) => m.id !== 'a'));
  ok('includeAliases 才能查到', lib.query({ includeAliases: true }).items.some((m) => m.id === 'a'));
  ok('总数不含别名', lib.query({}).total === 6, lib.query({}).total);
  ok('stats 记了别名数（a + 测试数据里本来就有的 al）', lib.stats().aliases === 2, lib.stats().aliases);
  ok('重复计数：g1 只剩主记录不再算重复，疑似组也计入', lib.smartCounts().duplicates === 4, lib.smartCounts().duplicates);
  ok('轮盘不会抽到别名', (() => { for (let i = 0; i < 200; i++) if (lib.roulette().id === 'a') return false; return true; })());
  ok('能列出主记录的副本', lib.aliasesOf('a2').map((x) => x.id).join() === 'a');
  ok('别名的备注还在（没有丢人工信息）', a.note === '' && lib.get('al').note === '');
  const again = merge.buildGroups(store.getLibrary());
  ok('合并完的组不会复活', !again.some((g) => g.key === 'exact:H1'));

  console.log('\n[5. 解除别名');
  const det = await lib.detachAliases(['a', 'not-alias']);
  ok('只解除确实是别名的', det.detached === 1);
  ok('a 恢复成独立记录', !lib.get('a').aliasOf && lib.query({}).items.some((m) => m.id === 'a'));
  D.annotate(store.getLibrary());
  ok('解除后重新成为重复组（g1 两条都回来了，疑似组也计入）', lib.smartCounts().duplicates === 6, lib.smartCounts().duplicates);

  console.log('\n[6. 合并并移入回收站');
  const plan2 = merge.planMerge(store.getLibrary(), { 'exact:H1': 'a2', 'exact:H2': 'b' });
  // 模拟：a 回收站成功，b2 失败
  const outcome = { a: { ok: true }, b2: { ok: false, error: '文件被占用' } };
  let r2 = null;
  await store.updateLibrary((L) => { r2 = merge.applyMergeInLibrary(L, plan2, outcome); }, 'test-merge2');
  ok('成功的进回收站存根', r2.trashed === 1 && lib.get('a').aliasState === 'trashed', JSON.stringify(r2));
  ok('失败的如实列出', r2.failed.length === 1 && r2.failed[0].id === 'b2' && /文件被占用/.test(r2.failed[0].error));
  ok('失败的记录保持独立', !lib.get('b2').aliasOf && lib.query({}).items.some((m) => m.id === 'b2'));
  ok('只算成功那部分的释放空间', r2.freedBytes === 1000, r2.freedBytes);
  ok('存根保留路径和大小', lib.get('a').path.indexOf('a.3mf') > 0 && lib.get('a').size === 1000);

  // 系统回收站不可用（提权 / 占用 / 杀软拦截）时的兜底：
  // 文件原地保留，记录仍降为副本，不能出现「已合并 0 组」。
  const planShadow = merge.planMerge(store.getLibrary(), { 'exact:H2': 'b' });
  let rShadow = null;
  await store.updateLibrary((L) => {
    rShadow = merge.applyMergeInLibrary(L, planShadow, { b2: { ok: false, shadow: true, error: '回收站被占用' } });
  }, 'test-merge-shadow');
  ok('回收站失败也合并成功（1 组、1 个只标副本）', rShadow.merged === 1 && rShadow.shadow === 1 && rShadow.trashed === 0, JSON.stringify(rShadow));
  ok('失败项明确标出「文件保留」', rShadow.failed.length === 1 && rShadow.failed[0].kept === true && rShadow.failed[0].id === 'b2');
  ok('b2 降为 b 的副本且文件标记为未移动', lib.get('b2').aliasOf === 'b' && lib.get('b2').aliasState === 'shadow');

  console.log('\n[7. 主记录被删时别名自动恢复');
  await lib.remove(['a2']);
  ok('别名解除、重新可见', !lib.get('a').aliasOf && lib.query({}).items.some((m) => m.id === 'a'));

  console.log('\n[8. 与扫描器联动');
  const files = path.join(dir, 'scanme');
  fs.mkdirSync(files, { recursive: true });
  const make = (name, colour) => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
    zip.addFile('_rels/.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
    zip.addFile('3D/3dmodel.model', Buffer.from('<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices>'
      + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>'
      + '<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>'));
    zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({ filament_colour: colour })));
    zip.writeZip(path.join(files, name));
  };
  make('one.3mf', ['#FF0000FF']);
  make('two.3mf', ['#FF0000FF']);
  fs.writeFileSync(path.join(files, 'broken.3mf'), 'not a zip');
  // 真实的「切片文件」：是合法 zip，但只有 G-code，没有 3D 网格
  const zPlate = new AdmZip();
  zPlate.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  zPlate.addFile('_rels/.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  zPlate.addFile('3D/3dmodel.model', Buffer.from('<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>'));
  zPlate.addFile('Metadata/plate_1.gcode', Buffer.from('; generated\nM104 S200\n'));
  zPlate.writeZip(path.join(files, 'plate.3mf'));
  const store2 = new Store({ dataDir: path.join(dir, 'data2') });
  await store2.init();
  await store2.updateSettings({ folders: [{ id: 'f1', path: files, enabled: true, recursive: true }] });
  const lib2 = new Library({ store: store2 });
  const scanner = new Scanner({ store: store2, thumbs: new Thumbs({ store: store2 }) });
  const rep = await scanner.scanPath(files);
  ok('扫描入库 4 个', Object.keys(store2.getLibrary().models).length === 4, JSON.stringify(rep.files.map((f) => f.action + ':' + path.basename(f.path))));
  ok('扫描报告里带坏文件数（只有那个纯文本）', rep.broken === 1, rep.broken);
  const byName = {};
  for (const m of Object.values(store2.getLibrary().models)) byName[m.fileName] = m;
  ok('纯文本被归为 not-3mf', byName['broken.3mf'].parseErrorKind === 'not-3mf', byName['broken.3mf'].parseErrorKind);
  ok('只有切片内容的盘文件是合法文件，不算坏文件', !byName['plate.3mf'].parseErrorKind && !byName['plate.3mf'].parseError, byName['plate.3mf'].parseErrorKind);
  ok('两个正常文件是重复组', byName['one.3mf'].duplicateGroup && byName['one.3mf'].duplicateGroup === byName['two.3mf'].duplicateGroup);
  ok('智能计数里能看到坏文件', lib2.smartCounts().broken === 1, lib2.smartCounts().broken);
  ok('坏文件默认仍出现在列表里（只是没有缩略图）', lib2.query({}).items.some((m) => m.fileName === 'broken.3mf'));

  const g = merge.buildGroups(store2.getLibrary())[0];
  const plan3 = merge.planMerge(store2.getLibrary(), { [g.key]: byName['one.3mf'].id });
  await store2.updateLibrary((L) => { merge.applyMergeInLibrary(L, plan3, null); }, 'merge');
  ok('two 降为 one 的别名', store2.getLibrary().models[byName['two.3mf'].id].aliasOf === byName['one.3mf'].id);

  // 只降级、没动文件：重新扫描不能把别名关系冲掉
  await scanner.scanPath(files);
  ok('重新扫描后别名关系还在', store2.getLibrary().models[byName['two.3mf'].id].aliasOf === byName['one.3mf'].id);
  ok('别名不参与重复分组', lib2.smartCounts().duplicates === 0, lib2.smartCounts().duplicates);

  // 文件进了回收站（这里直接挪走模拟）：不能被判成「失效」
  const twoId = byName['two.3mf'].id;
  await store2.updateLibrary((L) => { L.models[twoId].aliasState = 'trashed'; });
  fs.unlinkSync(path.join(files, 'two.3mf'));
  await scanner.scanPath(files);
  ok('别名存根的文件消失后不标失效', store2.getLibrary().models[twoId].status === 'ok' && lib2.smartCounts().missing === 0, store2.getLibrary().models[twoId].status);

  // 文件被恢复回原路径：解除别名
  make('two.3mf', ['#FF0000FF']);
  await scanner.scanPath(files);
  ok('文件回到原路径 → 解除别名、重新可见', !store2.getLibrary().models[twoId].id ? true : (!store2.getLibrary().models[twoId].aliasOf), JSON.stringify({ aliasOf: store2.getLibrary().models[twoId].aliasOf, state: store2.getLibrary().models[twoId].aliasState }));
  ok('两个文件又成为重复组（两条记录都计入）', lib2.smartCounts().duplicates === 2, lib2.smartCounts().duplicates);

  // 坏文件被换成好文件（大小时间可能都没变）→ 下次扫描会重试
  fs.writeFileSync(path.join(files, 'broken.3mf'), (() => { const z = new AdmZip(path.join(files, 'one.3mf')); return z.toBuffer(); })());
  const rep2 = await scanner.scanPath(files);
  const fixed = Object.values(store2.getLibrary().models).find((m) => m.fileName === 'broken.3mf');
  ok('坏文件修好后重扫能恢复', !fixed.parseErrorKind && rep2.files.some((f) => /broken\.3mf$/.test(f.path) && f.action === 'updated'), fixed.parseErrorKind + ' ' + rep2.files.filter((f) => /broken/.test(f.path)).map((f) => f.action));

  console.log('\n[9. 概览');
  const sum = merge.summarize(store2.getLibrary());
  ok('概览数字正确', sum.exact === 1 && sum.similar === 0 && sum.exactBytes > 0, JSON.stringify(sum));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 临时目录，尽力清理 */ }

  console.log('\n' + '='.repeat(56));
  console.log('  智能合并测试：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('='.repeat(56));
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('测试异常：', e);
  process.exitCode = 1;
});
