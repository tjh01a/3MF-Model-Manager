'use strict';
/**
 * 端到端冒烟测试：跑完整业务流程（扫描 / 检索 / 批量 / 失效 / 重命名 / 备份 / 导入导出）。
 * 运行：npm run smoke
 *
 * 样本自包含：在系统临时目录里合成 42 个 3mf 作为扫描根（含一组内容重复、文件名带「测试」）。
 * 以前直接扫用户工作区，文件一被清理就集体失败；现在测试不再依赖外部文件内容。
 * 所有索引、缓存、备份、模型同样只写临时目录，绝不碰用户真实数据。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const paths = require('../src/core/paths');
const U = require('../src/core/utils');
const Services = require('../electron/services');

let SAMPLE = null;   // 指向临时扫描根里一个合成 3mf，供 [4] 的副本 / 重命名用例使用

/** 造 42 个可解析的 3mf：前两个字节完全相同（触发重复识别），其余各不相同。 */
function buildScanRoot(tmp) {
  const AdmZip = require('adm-zip');
  const dir = path.join(tmp, 'scan-root');
  fs.mkdirSync(dir, { recursive: true });
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64');
  const types = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '<Relationship Target="/Thumbnails/thumbnail.png" Id="rel1" ' +
    'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>' +
    '</Relationships>';

  const make = (out, mark) => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(types, 'utf8'));
    zip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
    zip.addFile('3D/3dmodel.model', Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' + mark +
      '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<resources><object id="1" type="model"><mesh><vertices>' +
      '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>' +
      '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>' +
      '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>', 'utf8'));
    zip.addFile('Thumbnails/thumbnail.png', PNG);
    zip.writeZip(out);
  };

  const name = (i) => path.join(dir, '测试模型_' + String(i).padStart(2, '0') + '.3mf');
  make(name(1), '');
  fs.copyFileSync(name(1), name(2));   // 内容一致 → 一定会产生重复组
  for (let i = 3; i <= 42; i++) make(name(i), '<!-- sample ' + i + ' -->');
  return dir;
}

let pass = 0, fail = 0;
const failures = [];
const summary = {};
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || '值不相等'}：期望 ${b}，实际 ${a}`); }
async function t(name, fn) {
  try { await fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; failures.push(name + ' → ' + e.message); console.log('  \u2717 ' + name + ' → ' + e.message); }
}
function group(n) { console.log('\n' + n); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-e2e-'));
  paths.setDataDir(tmp);
  const scanRoot = buildScanRoot(tmp);
  SAMPLE = path.join(scanRoot, '测试模型_01.3mf');
  const svc = new Services();
  const lib = () => svc.library;
  const store = () => svc.store;

  group('[1] 启动与真实目录扫描');
  await t('Services 初始化（不启动目录监视）', async () => {
    await svc.init({ autoWatch: false });
    ok(svc.initialized);
    ok(fs.existsSync(paths.getLibraryPath()));
    // 默认 scan.dropMissing=true 会把删掉的文件直接移出库；本套要验证 missing → 重新定位的旧流程，
    // 所以显式关掉。默认模式的覆盖在 tests/run-tests.js「文件消失（默认模式）」里。
    await svc.store.updateSettings({ scan: { dropMissing: false } });
  });
  await t('添加自包含样本目录为监控目录', async () => {
    const f = await svc.folderAdd(scanRoot);
    ok(f.id && f.enabled && f.recursive);
  });
  await t('全量扫描：全部 3mf 入库、零失败', async () => {
    const r = await svc.scanner.scanAll({ force: false });
    summary.scan = {
      added: r.added, updated: r.updated, missing: r.missing,
      failed: r.failed, duplicateGroups: r.duplicateGroups, durationMs: r.duration,
    };
    ok(r.added >= 40, '扫描到的模型过少：' + r.added + '（期望 ≥40）');
    eq(r.failed, 0, '不应有解析失败');
    ok(r.duration < 60000, '扫描耗时异常');
    console.log(`    扫描 ${r.added} 个模型，用时 ${r.duration} ms，重复组 ${r.duplicateGroups}`);
  });
  await t('缩略图全部落盘（含无图占位）', () => {
    const s = svc.thumbs.stats();
    summary.thumbs = s;
    eq(s.count, lib().stats().total, '缩略图数应等于模型数');
    ok(s.bytes > 0);
  });
  await t('重复识别生效且只标记不删除', () => {
    const s = lib().stats();
    summary.duplicates = s.duplicates;
    ok(s.duplicates >= 1, '未识别出重复文件');
    const total = s.total;
    ok(total >= 40, '重复识别不应删除记录');
  });
  await t('bootstrap 聚合数据完整', () => {
    const b = svc.bootstrap();
    for (const k of ['version', 'dataDir', 'info', 'settings', 'categories', 'tags',
      'views', 'stats', 'smartCounts', 'folders', 'slicers', 'backups']) {
      ok(k in b, '缺少字段 ' + k);
    }
    eq(b.folders.length, 1);
    eq(b.stats.total, lib().stats().total);
  });

  group('[2] 搜索 / 筛选 / 排序 / 智能视图');
  await t('关键字命中文件名', () => {
    const r = lib().query({ keyword: '测试' });
    ok(r.total >= 1, '未搜到含"测试"的模型');
    summary.keywordHits = r.total;
  });
  await t('多条件组合筛选', () => {
    const r = lib().query({ printStatuses: ['unprinted'], ratingMin: 0, smart: 'all' });
    ok(r.total >= 1);
    ok(r.facets && typeof r.facets.byPrintStatus === 'object', '缺少 facets');
  });
  await t('8 种排序字段均可用且结果数一致', () => {
    const fields = ['name', 'size', 'createdAt', 'mtime', 'lastOpenedAt',
      'lastPrintedAt', 'rating', 'printCount'];
    const total = lib().stats().total;
    for (const f of fields) {
      const r = lib().query({ sortBy: f, sortDir: 'desc' });
      eq(r.total, total, f + ' 排序改变了结果数');
      ok(Array.isArray(r.items));
    }
  });
  await t('分页与智能视图计数', () => {
    const r = lib().query({ limit: 5, offset: 0 });
    ok(r.items.length <= 5);
    ok(r.total >= 40, 'total 应为分页前总数');
    const counts = lib().smartCounts();
    ok(typeof counts.all === 'number' && counts.all >= 40);
  });

  group('[3] 分类 / 标签 / 批量 / 元数据');
  let catId, tagId, pickedIds;
  await t('新建分类与标签', async () => {
    catId = (await lib().categoryCreate({ name: 'E2E 分类', color: '#4f46e5' })).id;
    tagId = (await lib().tagCreate({ name: 'E2E 标签', color: '#10b981' })).id;
    ok(catId && tagId);
  });
  await t('批量归类 + 加标签', async () => {
    pickedIds = lib().query({ limit: 3 }).items.map((m) => m.id);
    const r = await lib().bulk(pickedIds, { categoryId: catId });
    eq(r.updated, 3);
    await lib().tagAssign(pickedIds, [tagId], 'add');
    const r2 = lib().query({ categoryId: catId });
    eq(r2.total, 3);
    eq(lib().query({ tagIds: [tagId] }).total, 3);
  });
  await t('备注 / 收藏 / 评分 / 打印状态 / 最近使用', async () => {
    const id = pickedIds[0];
    await lib().update(id, { note: '这是端到端测试备注', favorite: true, rating: 4 });
    await lib().setPrintStatus([id], 'printed');
    await lib().markOpened(id);
    const m = lib().get(id);
    eq(m.note, '这是端到端测试备注');
    eq(m.favorite, true); eq(m.rating, 4);
    eq(m.printStatus, 'printed'); eq(m.printCount, 1);
    ok(m.lastOpenedAt > 0 && m.openCount >= 1, '最近使用未记录');
    summary.metadata = { id, printStatus: m.printStatus, openCount: m.openCount, printCount: m.printCount };
  });
  await t('按备注内容可搜到模型', () => {
    eq(lib().query({ keyword: '端到端测试备注' }).total, 1);
  });
  await t('保存视图并还原查询', async () => {
    const q = { keyword: '测试', smart: 'all' };
    const v = await lib().viewSave({ name: 'E2E 视图', query: q });
    eq(lib().views().length, 1);
    const r = lib().query(v.query);
    ok(r.total >= 1);
    await lib().viewDelete(v.id);
  });
  await t('批量操作可撤销（snapshot → undo）', async () => {
    const id = pickedIds[1];
    const before = lib().get(id).favorite;
    svc.snapshot([id]);
    await lib().update(id, { favorite: !before });
    eq(lib().get(id).favorite, !before);
    const r = await svc.undo();
    eq(r.ok, true);
    eq(lib().get(id).favorite, before, '撤销未还原');
  });
  await t('打印轮盘返回未打印模型', () => {
    const r = lib().roulette();
    ok(r === null || typeof r.id === 'string');
  });

  group('[4] 失效检测 / 重新定位 / 磁盘重命名（仅临时副本）');
  const sandbox = path.join(tmp, 'sandbox');
  await t('准备临时副本目录并入库', async () => {
    fs.mkdirSync(sandbox, { recursive: true });
    fs.copyFileSync(SAMPLE, path.join(sandbox, '副本A.3mf'));
    fs.copyFileSync(SAMPLE, path.join(sandbox, '副本B.3mf'));
    await svc.folderAdd(sandbox);
    const r = await svc.scanner.scanAll({ force: false });
    ok(r.added >= 2, '副本未入库');
  });
  let movedId, movedPath;
  await t('文件移走 → 标记 missing，元数据保留', async () => {
    const rec = Object.values(store().getLibrary().models)
      .find((m) => m.path === path.join(sandbox, '副本A.3mf'));
    ok(rec, '找不到副本A记录');
    movedId = rec.id; movedPath = rec.path;
    await lib().update(movedId, { note: '别丢我', favorite: true });
    fs.renameSync(movedPath, movedPath + '.moved');
    const r = await svc.scanner.scanAll({ force: false });
    ok(r.missing >= 1, '未检测到失效');
    const now = lib().get(movedId);
    eq(now.status, 'missing');
    eq(now.note, '别丢我'); eq(now.favorite, true);
    ok(now.missingSince > 0);
    ok(lib().query({ smart: 'missing' }).total >= 1, '失效视图应能筛出');
  });
  await t('重新定位 → 恢复 ok 且不丢元数据', async () => {
    const candidates = await lib().findRelinkCandidates(movedId);
    fs.renameSync(movedPath + '.moved', movedPath);
    const r = await lib().relink(movedId, movedPath);
    eq(r.status, 'ok');
    eq(r.note, '别丢我');
    ok(Array.isArray(candidates));
  });
  await t('磁盘重命名 → 路径更新、元数据不丢、原文件消失', async () => {
    const rec = Object.values(store().getLibrary().models)
      .find((m) => m.path === path.join(sandbox, '副本B.3mf'));
    ok(rec, '找不到副本B记录');
    await lib().update(rec.id, { note: '重命名保留', rating: 3 });
    const oldPath = String(rec.path);   // rec 是库内对象引用，重命名后会被就地更新
    const oldId = String(rec.id);
    const newName = 'E2E改名_' + Date.now().toString(36);
    const r = await lib().renameFile(oldId, newName);
    ok(r.path.endsWith(newName + '.3mf'), '新路径不正确：' + r.path);
    ok(fs.existsSync(r.path), '磁盘上找不到新文件');
    ok(!fs.existsSync(oldPath), '原路径文件应已不存在');
    eq(r.note, '重命名保留'); eq(r.rating, 3);
  });
  await t('重命名冲突时不覆盖已有文件', async () => {
    const all = Object.values(store().getLibrary().models)
      .filter((m) => m.path.startsWith(sandbox) && fs.existsSync(m.path));
    if (all.length < 2) return;
    const other = path.basename(all[1].path, '.3mf');
    let threw = false;
    try { await lib().renameFile(all[0].id, other); } catch (_) { threw = true; }
    ok(threw, '应拒绝覆盖');
    ok(fs.existsSync(all[1].path), '目标文件不应被破坏');
  });

  group('[5] 缓存 / 备份 / 导出 / 切片软件');
  await t('增量扫描：未变化文件跳过解析', async () => {
    const r = await svc.scanner.scanAll({ force: false });
    eq(r.added, 0);
    ok(r.unchanged >= 40, '增量应跳过大部分文件：' + r.unchanged);
    summary.incremental = { added: r.added, unchanged: r.unchanged };
  });
  await t('缩略图重生成 / 清理 / 统计', async () => {
    const ids = lib().query({ limit: 2 }).items.map((m) => m.id);
    const r = await svc.thumbRegenerate(ids, true);
    eq(r.done, 2); eq(r.failed, 0);
    const p = await svc.thumbs.prune();
    ok(typeof p.removed === 'number');
    ok(svc.thumbs.stats().count > 0);
  });
  await t('备份 → 修改 → 恢复', async () => {
    const name = await store().backup('e2e');
    ok(name && svc.bootstrap().backups.length >= 1);
    const id = pickedIds[2];
    const before = lib().get(id).note || '';
    await lib().update(id, { note: '临时改动' });
    await store().restoreBackup(name);
    eq(lib().get(id).note, before, '恢复后备注应回到备份状态');
  });
  await t('导出 JSON 再合并导入', async () => {
    const p = path.join(tmp, 'e2e-export.json');
    await lib().exportJson(p);
    ok(fs.statSync(p).size > 100, '导出文件过小');
    const before = lib().stats().total;
    const r = await lib().importJson(p, true);
    ok(typeof r.imported === 'number');
    eq(lib().stats().total, before, '幂等合并导入不应重复计数');
  });
  await t('切片软件自动探测与路径校验', async () => {
    const found = await svc.slicer.detect();
    summary.slicersDetected = found.map((s) => s.name + ' → ' + s.exePath);
    ok(Array.isArray(found));
    ok(found.length >= 1, '本机应至少探测到一个切片软件');
    for (const s of found) ok(fs.existsSync(s.exePath), '探测路径不存在：' + s.exePath);
    eq(svc.slicer.validate(process.execPath).ok, true, '真实 exe 应通过校验');
  });
  await t('配置切片软件后列表与默认项持久化', async () => {
    const s = await svc.slicer.add({ name: '测试切片器', exePath: process.execPath, args: '', setDefault: true });
    eq(svc.slicer.list().length, 1);
    eq(svc.slicer.list()[0].isDefault, true);
    await svc.slicer.remove(s.id);
    eq(svc.slicer.list().length, 0);
  });
  await t('scanStatus / getInfo / 目录与切片软件配置持久化', () => {
    const st = svc.scanStatus();
    eq(st.running, false);
    const info = svc.getInfo();
    ok(info.dataDir && info.version && info.platform);
    ok(typeof svc.refreshWatch === 'function');
    ok(svc.folders().length >= 2, '监控目录配置应已持久化');
    ok(Array.isArray(svc.bootstrap().slicers));
    summary.dataDir = info.dataDir;
  });

  group('[6] 收尾');
  await t('最终统计与数据一致性', () => {
    const s = lib().stats();
    summary.final = {
      total: s.total, totalSize: s.totalSize, favorites: s.favorites,
      printed: s.printed, missing: s.missing, duplicates: s.duplicates,
      thumbs: svc.thumbs.stats().count,
      libraryBytes: fs.statSync(paths.getLibraryPath()).size,
    };
    ok(s.total >= 40);
    ok(fs.statSync(paths.getLibraryPath()).size > 100);
    console.log('    ' + JSON.stringify(summary.final));
  });

  console.log('\n' + '='.repeat(60));
  console.log(`端到端冒烟：${pass} 通过 / ${fail} 失败`);
  if (failures.length) { console.log('\n失败明细：'); failures.forEach((f) => console.log('  - ' + f)); }
  console.log('\n汇总：\n' + JSON.stringify(summary, null, 2));
  console.log('='.repeat(60));

  try { await svc.shutdown(); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟脚本自身异常：', e);
  process.exit(1);
});
