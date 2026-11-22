'use strict';
/**
 * 核心层单元测试（纯 Node，无需 Electron / 无需显示）。
 * 运行：npm test
 * 所有数据写入系统临时目录，绝不触碰用户的真实索引。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const paths = require('../src/core/paths');
const U = require('../src/core/utils');
const C = require('../src/core/constants');
const M = require('../src/core/model3mf');
const Colors = require('../src/core/colors');
const D = require('../src/core/duplicates');
const Store = require('../src/core/store');
const Library = require('../src/core/library');
const Thumbs = require('../src/core/thumbs');
const Scanner = require('../src/core/scanner');
const Slicer = require('../src/core/slicer');

const WORKSPACE = path.resolve(__dirname, '..', '..');
const SAMPLE = {
  normal: path.join(WORKSPACE, '测试.3mf'),
  bambu: path.join(WORKSPACE, '测试B_拓竹原生格式.3mf'),
  minimal: path.join(WORKSPACE, '测试A_极简格式.3mf'),
};

/**
 * 单元测试必须自包含：工作区里的三个真实 .3mf 样本随时可能被清理掉，
 * 缺任意一个就在临时目录里合成等价样本（带 / 不带内嵌缩略图），
 * 保证 [2] 解析、[6] 缩略图、[7] 扫描这些用例始终跑得到，而不是靠 existsSync 跳过。
 * 合成文件只放进系统临时目录，绝不写回用户工作区。
 */
function ensureSamples(tmp) {
  const keys = ['normal', 'bambu', 'minimal'];
  if (keys.every((k) => fs.existsSync(SAMPLE[k]))) return;
  const AdmZip = require('adm-zip');
  const dir = path.join(tmp, 'samples');
  fs.mkdirSync(dir, { recursive: true });

  // 1x1 透明 PNG。parse3mf / thumbs 只搬运条目字节、不做解码，足够覆盖「有内嵌图」路径。
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64');
  const types = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/></Types>';
  const model = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<resources><object id="1" type="model"><mesh><vertices>' +
    '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>' +
    '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>' +
    '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>';

  const make = (out, thumbName) => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(types, 'utf8'));
    const relThumb = thumbName
      ? '<Relationship Target="/' + thumbName + '" Id="rel1" ' +
        'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>'
      : '';
    zip.addFile('_rels/.rels', Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
      'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
      relThumb + '</Relationships>', 'utf8'));
    zip.addFile('3D/3dmodel.model', Buffer.from(model, 'utf8'));
    if (thumbName) zip.addFile(thumbName, PNG);
    zip.writeZip(out);
    return out;
  };

  const fallback = {
    normal: path.join(dir, 'normal.3mf'),
    bambu: path.join(dir, 'bambu.3mf'),
    minimal: path.join(dir, 'minimal.3mf'),
  };
  make(fallback.normal, 'Thumbnails/thumbnail.png');
  make(fallback.bambu, 'Metadata/plate_1.png');
  make(fallback.minimal, null);
  Object.assign(SAMPLE, fallback);
  console.log('  · 工作区 .3mf 样本不齐全，已改用临时目录里的合成样本');
}

/**
 * 合成带拓竹颜色元数据的 3MF（只写临时目录）。
 * project_settings.config 提供槽位色，model_settings.config 提供每个零件的 extruder 槽位。
 */
function makeColorSample(dir, name, opts = {}) {
  const AdmZip = require('adm-zip');
  fs.mkdirSync(dir, { recursive: true });
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>', 'utf8'));
  zip.addFile('3D/3dmodel.model', Buffer.from(
    '<?xml version="1.0"?><model unit="millimeter"><resources>' +
    '<object id="1"><mesh/></object></resources><build><item objectid="1"/></build></model>', 'utf8'));
  const project = opts.rawProject !== undefined ? opts.rawProject : JSON.stringify({
    printer_model: 'Bambu Lab P1S',
    filament_colour: opts.colors || [],
    filament_type: opts.types || [],
  });
  zip.addFile('Metadata/project_settings.config', Buffer.from(project, 'utf8'));
  if (!opts.omitModelSettings) {
    const xml = '<?xml version="1.0"?><config>' +
      (opts.extruders || []).map((n, i) => '<object id="' + (i + 1) +
        '"><metadata key="name" value="part' + (i + 1) + '"/>' +
        '<metadata key="extruder" value="' + n + '"/></object>').join('') +
      '</config>';
    zip.addFile('Metadata/model_settings.config', Buffer.from(xml, 'utf8'));
  }
  const out = path.join(dir, name);
  zip.writeZip(out);
  return out;
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || '值不相等'}：期望 ${b}，实际 ${a}`); }
async function t(name, fn) {
  try { await fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; failures.push(name + ' → ' + e.message); console.log('  \u2717 ' + name + ' → ' + e.message); }
}
function group(name) { console.log('\n' + name); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-unit-'));
  paths.setDataDir(tmp);
  ensureSamples(tmp);   // 工作区样本被清理时自动合成，保证下面的用例不会集体退化成失败
  const modelDir = path.join(tmp, 'models');
  fs.mkdirSync(modelDir, { recursive: true });

  let store, lib, thumbs, scanner, slicer;
  let scanReport;

  // ---------------------------------------------------------------- 工具
  group('[1] 基础工具 utils / constants');
  await t('formatBytes 各量级', () => {
    eq(U.formatBytes(512), '512 B');
    eq(U.formatBytes(2048), '2.00 KB');
    ok(U.formatBytes(3 * 1024 * 1024).includes('MB'));
  });
  await t('pathKey 在 Windows 下大小写不敏感', () => {
    eq(U.pathKey('D:/Models/A.3mf'), U.pathKey('d:\\models\\a.3mf'));
  });
  await t('safeFileName 过滤非法字符', () => {
    const s = U.safeFileName('  a/b:c*?  ');
    ok(s.length > 0, '结果不应为空');
    ok(!/[\\/:*?"|<>]/.test(s), '仍含非法字符：' + s);
  });
  await t('similarNameKey 归一化副本名', () => {
    eq(U.similarNameKey('模型_1'), U.similarNameKey('模型 (1)'));
  });
  await t('mapLimit 并发限流且保留顺序', async () => {
    const r = await U.mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    eq(r.map((x) => x.value).join(','), '2,4,6,8,10');
  });
  await t('PRINT_STATUS 状态链闭合', () => {
    for (const k of Object.keys(C.PRINT_STATUS)) ok(C.PRINT_STATUS[C.PRINT_STATUS[k].next], k + ' 的 next 无效');
  });

  // ---------------------------------------------------------------- 3MF 解析
  group('[2] 3MF 解析 model3mf');
  await t('标准/拓竹样本能抽出缩略图与元数据', async () => {
    for (const key of ['normal', 'bambu']) {
      if (!fs.existsSync(SAMPLE[key])) continue;
      const r = await M.parse3mf(SAMPLE[key]);
      ok(r.ok, key + ' 解析失败：' + r.error);
      ok(r.thumbnail && r.thumbnail.data.length > 0, key + ' 未抽到缩略图');
      ok(r.meta.objectCount >= 1, key + ' 未统计到对象');
    }
  });
  await t('极简格式无内嵌图时优雅降级', async () => {
    const r = await M.parse3mf(SAMPLE.minimal);
    ok(r.ok, '解析失败：' + r.error);
    eq(r.thumbnail, null, '极简格式不应有缩略图');
    ok(r.meta.hasThumbnail === false, 'hasThumbnail 应为 false');
  });
  await t('pickThumbnailEntry 四级回退链', () => {
    const rels = '<Relationships><Relationship Target="/Thumbnails/thumbnail.png" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/></Relationships>';
    eq(M.pickThumbnailEntry(['Thumbnails/thumbnail.png', 'Metadata/plate_1.png'], rels), 'Thumbnails/thumbnail.png');
    eq(M.pickThumbnailEntry(['Metadata/plate_1.png', 'Metadata/top_1.png'], ''), 'Metadata/plate_1.png');
    eq(M.pickThumbnailEntry(['3D/3dmodel.model'], ''), null);
  });
  await t('parseRels 解析关系文件且 zip-slip 安全', () => {
    const r = M.parseRels('<Relationships><Relationship Target="/Metadata/plate_1.png" Type="x"/></Relationships>');
    eq(r.length, 1); eq(r[0].target, '/Metadata/plate_1.png');
    const evil = M.pickThumbnailEntry(['../evil.png'], '<Relationships><Relationship Target="../evil.png" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/></Relationships>');
    ok(evil === null || !String(evil).includes('..'), '不应返回目录穿越条目：' + evil);
  });
  await t('损坏/不存在文件返回 ok:false 而非抛异常', async () => {
    const bad = path.join(tmp, 'broken.3mf');
    fs.writeFileSync(bad, 'not a zip');
    const r = await M.parse3mf(bad);
    eq(r.ok, false);
    ok(typeof r.error === 'string' && r.error.length > 0, '应有中文错误');
    const r2 = await M.parse3mf(path.join(tmp, 'nope.3mf'));
    eq(r2.ok, false);
  });

  // ---- 耗材颜色色板：卡片「不用点进去就能看到颜色」的数据来源 ----
  await t('normalizeColor 归一化并拒绝不安全色值', () => {
    eq(M.normalizeColor('#EAECEB'), '#EAECEB');
    eq(M.normalizeColor('#fff'), '#FFFFFF');
    eq(M.normalizeColor('#FF8040AA'), '#FF8040');
    eq(M.normalizeColor('0xFF8040'), '#FF8040');
    eq(M.normalizeColor('16711680'), '#FF0000');
    eq(M.normalizeColor(''), null);
    eq(M.normalizeColor('javascript:alert(1)'), null);
    eq(M.normalizeColor('extruder_colour'), null);
  });
  await t('按零件 extruder 映射实际使用的槽位色', async () => {
    const f = makeColorSample(path.join(tmp, 'colors'), 'mapped.3mf', {
      colors: ['#FFFFFF', '#000000', '#FF0000', '#00FF00'],
      types: ['PLA', 'ABS', 'PETG', 'TPU'],
      extruders: [1, 3, 3],
    });
    const r = await M.parse3mf(f, { withThumbnail: false });
    ok(r.ok, '解析失败：' + r.error);
    eq(JSON.stringify(r.meta.filamentColors), JSON.stringify(['#FFFFFF', '#FF0000']));
    eq(JSON.stringify(r.meta.filamentTypes), JSON.stringify(['PLA', 'PETG']));
    eq(r.meta.colorSource, 'objects');
    eq(r.meta.hasMultiColor, true);
  });
  await t('缺零件映射时退回全部配置色并标 project', async () => {
    const f = makeColorSample(path.join(tmp, 'colors'), 'nomap.3mf', {
      colors: ['#FFFFFF', '#DC143C', '#FFE600'],
      types: ['PLA', 'PETG', 'ABS'],
      omitModelSettings: true,
    });
    const r = await M.parse3mf(f, { withThumbnail: false });
    ok(r.ok);
    eq(JSON.stringify(r.meta.filamentColors), JSON.stringify(['#FFFFFF', '#DC143C', '#FFE600']));
    eq(r.meta.colorSource, 'project');
  });
  await t('extruder=0 归到槽位 1，越界与非法色值安全跳过', async () => {
    const f = makeColorSample(path.join(tmp, 'colors'), 'edge.3mf', {
      colors: ['#FFFFFF', 'javascript:alert(1)', ''],
      types: ['PLA', 'ABS', 'PETG'],
      extruders: [0, 2, 99],
    });
    const r = await M.parse3mf(f, { withThumbnail: false });
    ok(r.ok);
    eq(JSON.stringify(r.meta.filamentColors), JSON.stringify(['#FFFFFF']));
    eq(r.meta.colorSource, 'objects');
  });
  await t('同一颜色被多个槽位使用时只显示一个圆点', async () => {
    const f = makeColorSample(path.join(tmp, 'colors'), 'dedup.3mf', {
      colors: ['#FFFFFF', '#FFFFFF', '#000000'],
      types: ['PLA', 'ABS', 'PETG'],
      extruders: [1, 2, 3],
    });
    const r = await M.parse3mf(f, { withThumbnail: false });
    eq(JSON.stringify(r.meta.filamentColors), JSON.stringify(['#FFFFFF', '#000000']));
    eq(JSON.stringify(r.meta.filamentTypes), JSON.stringify(['PLA', 'PETG']));
  });
  await t('畸形 project_settings.config 不抛异常且色板为空', async () => {
    const f = makeColorSample(path.join(tmp, 'colors'), 'badmeta.3mf', { rawProject: '{not json' });
    const r = await M.parse3mf(f, { withThumbnail: false });
    ok(r.ok, '单条目失败不应拖垮整个解析');
    eq(JSON.stringify(r.meta.filamentColors), '[]');
    eq(r.meta.colorSource, 'none');
  });
  await t('colorPatch 只合并颜色字段，不覆盖已有 meta', () => {
    const old = { objectCount: 36, hasThumbnail: true, title: 'x', hasMultiColor: false };
    const fresh = {
      filamentColors: ['#FFFFFF', '#FF0000'], filamentTypes: ['PLA', 'ABS'],
      colorSource: 'objects', hasMultiColor: true, hasThumbnail: false, objectCount: 0,
    };
    const merged = Colors.colorPatch(old, fresh);
    eq(merged.objectCount, 36, '不能覆盖已有对象数');
    eq(merged.hasThumbnail, true, 'withThumbnail:false 的降级值不能写回');
    eq(merged.title, 'x');
    eq(merged.hasMultiColor, true, '成功解析要校准多色标记');
    eq(JSON.stringify(merged.filamentColors), JSON.stringify(['#FFFFFF', '#FF0000']));
    const failed = Colors.colorPatch(old, null);
    eq(JSON.stringify(failed.filamentColors), '[]');
    eq(failed.colorSource, 'none');
    eq(failed.hasMultiColor, false, '解析失败不改写旧判断');
  });
  await t('backfillFilamentColors 只补缺字段、幂等且只写一次库', async () => {
    const f = makeColorSample(path.join(tmp, 'colors'), 'backfill.3mf', {
      colors: ['#FFFFFF', '#FF0000'], types: ['PLA', 'ABS'], extruders: [1, 2],
    });
    const mock = {
      writes: 0, lastReason: null,
      lib: { models: {
        a: { id: 'a', path: f, status: 'ok', meta: { objectCount: 7, hasThumbnail: true } },
        b: { id: 'b', path: f, status: 'ok',
          meta: { filamentColors: ['#123456'], filamentTypes: ['PLA'], colorSource: 'objects' } },
        c: { id: 'c', path: path.join(tmp, 'nope.3mf'), status: 'ok', meta: {} },
        d: { id: 'd', path: f, status: 'missing', meta: {} },
      } },
      getLibrary() { return this.lib; },
      async updateLibrary(fn, reason) {
        this.writes++; this.lastReason = reason;
        await fn(this.lib);
      },
    };
    const r1 = await Colors.backfillFilamentColors(mock);
    eq(r1.scanned, 1, '只有 a 需要解析');
    eq(r1.updated, 1);
    eq(r1.failed, 0);
    eq(mock.writes, 1, '只能有一次写库 / 一次界面刷新');
    eq(mock.lastReason, 'colors-backfill');
    eq(mock.lib.models.a.meta.objectCount, 7, '已有 meta 必须保留');
    eq(mock.lib.models.a.meta.hasThumbnail, true);
    ok(mock.lib.models.a.meta.filamentColors.length > 0, '应补出颜色');
    const r2 = await Colors.backfillFilamentColors(mock);
    eq(r2.scanned, 0, '第二次应全部跳过');
    eq(mock.writes, 1, '第二次不应写库');
  });

  // ---------------------------------------------------------------- 存储
  group('[3] 本地数据保存 store');
  await t('init 建立目录、默认设置与默认分类', async () => {
    store = new Store({});
    await store.init();
    ok(fs.existsSync(paths.getLibraryPath()), 'library.json 未创建');
    ok(fs.existsSync(paths.getSettingsPath()), 'settings.json 未创建');
    eq(store.getSettings().ui.view, 'grid');
    ok(store.getLibrary().categories.length >= 4, '默认分类未生成');
  });
  await t('updateLibrary 原子写入并落盘', async () => {
    await store.updateLibrary((l) => { l.models.x1 = { id: 'x1', title: '测试' }; });
    const raw = JSON.parse(fs.readFileSync(paths.getLibraryPath(), 'utf8'));
    eq(raw.models.x1.title, '测试');
  });
  await t('updateSettings 深合并而非覆盖', async () => {
    await store.updateSettings({ ui: { theme: 'dark' } });
    const s = store.getSettings();
    eq(s.ui.theme, 'dark'); eq(s.ui.view, 'grid');
  });
  await t('backup / listBackups / restoreBackup 回退生效', async () => {
    const name = await store.backup('unit');
    ok(name && fs.existsSync(path.join(paths.getBackupDir(), name)), '备份文件未生成');
    await store.updateLibrary((l) => { l.models.x1.title = '已改'; });
    ok(store.listBackups().length >= 1);
    await store.restoreBackup(name);
    eq(store.getLibrary().models.x1.title, '测试', '恢复后应回到备份时状态');
  });
  await t('exportTo / importFrom 往返', async () => {
    const p = path.join(tmp, 'export.json');
    await store.exportTo(p);
    ok(fs.existsSync(p) && fs.statSync(p).size > 10);
    const before = Object.keys(store.getLibrary().models).length;
    await store.updateLibrary((l) => { delete l.models.x1; });
    const r = await store.importFrom(p, { merge: true });
    ok(typeof r.imported === 'number');
    eq(Object.keys(store.getLibrary().models).length, before, '合并导入后记录数应还原');
  });
  await t('库文件损坏时从备份自动恢复', async () => {
    await store.backup('测试用备份');                  // 恢复的前提：至少有一份备份
    const beforeIds = Object.keys(store.getLibrary().models);
    ok(beforeIds.length > 0, '备份前库里应有记录');
    fs.writeFileSync(paths.getLibraryPath(), '{ broken json');
    const s2 = new Store({});
    await s2.init();
    const afterIds = Object.keys(s2.getLibrary().models);
    // 必须证明「真的从备份恢复了」，而不是退回空默认库
    ok(afterIds.length > 0, '恢复后不应是空库');
    ok(beforeIds.every((id) => afterIds.includes(id)), '备份里的 ' + beforeIds.length + ' 条记录应全部回来');
    store = s2; // 后续用恢复后的实例
  });

  // ---------------------------------------------------------------- 检索
  group('[4] 分类检索 library');
  lib = new Library({ store });

  const mk = (id, extra = {}) => ({
    id, path: path.join(modelDir, id + '.3mf'), fileName: id + '.3mf', title: id,
    size: 1000, mtime: Date.now(), hash: 'h' + id, createdAt: Date.now() - 1000,
    updatedAt: Date.now(), printStatus: 'unprinted', categoryId: null, tagIds: [],
    favorite: false, rating: 0, note: '', status: 'ok', openCount: 0, printCount: 0,
    meta: {}, ...extra,
  });

  await t('query 关键字 / 多条件 / 排序 / 分页', async () => {
    await store.updateLibrary((l) => {
      l.models = {};
      l.models.a = mk('a', { title: '齿轮', note: '功能件', tagIds: ['t1'], rating: 5, size: 3000 });
      l.models.b = mk('b', { title: '小熊', note: '摆件', categoryId: 'c1', size: 1000, createdAt: Date.now() - 50000 });
      l.models.c = mk('c', { title: '校准 cube', printStatus: 'printed', size: 2000 });
    });
    eq(lib.query({ keyword: '齿轮' }).total, 1, '关键字搜索');
    eq(lib.query({ keyword: '功能件' }).total, 1, '备注也应被搜索');
    eq(lib.query({ smart: 'printed' }).total, 1, '智能视图 已完成');
    eq(lib.query({ smart: 'uncategorized' }).total, 2, '智能视图 未分类');
    eq(lib.query({ favoritesOnly: true }).total, 0);
    eq(lib.query({ ratingMin: 5 }).total, 1);
    eq(lib.query({ tagIds: ['t1'] }).total, 1);
    eq(lib.query({ printStatuses: ['unprinted'] }).total, 2);
    const sorted = lib.query({ sortBy: 'size', sortDir: 'desc' });
    eq(sorted.items[0].id, 'a', '按大小降序');
    eq(lib.query({ limit: 2 }).items.length, 2, '分页');
    eq(lib.query({ limit: 2 }).total, 3, 'total 应为分页前数量');
  });

  await t('失效文件从普通视图消失，仅维护视图可见', async () => {
    // 用一份临时快照，测完还原，避免影响后续用例
    const saved = {};
    await store.updateLibrary((l) => {
      for (const k of Object.keys(l.models)) saved[k] = l.models[k];
      l.models.gone = mk('gone', { title: '已删文件', status: 'missing', missingSince: Date.now() });
    });
    const beforeTotal = 3;
    // 普通视图 / 搜索都不应出现已失效记录
    eq(lib.query({}).total, beforeTotal, '全部模型不含失效记录');
    eq(lib.query({ keyword: '已删文件' }).total, 0, '搜索也搜不到失效记录');
    // 维护视图仍能看到，供重新定位 / 移出索引
    eq(lib.query({ smart: 'missing' }).total, 1, '失效文件视图仍列出');
    eq(lib.query({ statuses: ['missing'] }).total, 1, '显式按 status 筛选仍可查');
    // 统计：总数不含失效，但 missing 计数保留
    const st = lib.stats();
    eq(st.total, beforeTotal, '统计总数不含失效记录');
    eq(st.missing, 1, 'missing 计数仍保留');
    const counts = lib.smartCounts();
    eq(counts.missing, 1, '侧栏失效文件徽标仍有数字');
    eq(counts.all, beforeTotal, '侧栏全部模型计数与列表一致');
    // 还原
    await store.updateLibrary((l) => { l.models = saved; });
  });
  await t('update / bulk 白名单与批量', async () => {
    await lib.update('a', { note: '已改', rating: 9, favorite: true });
    eq(lib.get('a').note, '已改');
    eq(lib.get('a').rating, 5, 'rating 应被限制到 5');
    const r = await lib.bulk(['b', 'c'], { favorite: true });
    eq(r.updated, 2);
    eq(lib.query({ favoritesOnly: true }).total, 3);
  });
  await t('非法打印状态抛中文错误', async () => {
    let threw = false;
    try { await lib.update('a', { printStatus: 'nonsense' }); } catch (e) { threw = true; ok(/[\u4e00-\u9fa5]/.test(e.message)); }
    ok(threw, '应抛错');
  });
  await t('分类 / 标签 / 视图 CRUD', async () => {
    const cat = await lib.categoryCreate({ name: '测试分类', color: '#123456' });
    const tag = await lib.tagCreate({ name: '多色' });
    eq((await lib.tagCreate({ name: '多色' })).id, tag.id, '同名标签应幂等');
    await lib.tagAssign(['a'], [tag.id], 'add');
    ok(lib.get('a').tagIds.includes(tag.id));
    await lib.tagDelete(tag.id);
    ok(!lib.get('a').tagIds.includes(tag.id), '删标签应清理模型对该标签的引用');
    ok(lib.get('a').tagIds.includes('t1'), '不应误删其它标签');
    await lib.categoryDelete(cat.id);
    const v = await lib.viewSave({ name: '我的视图', query: { keyword: 'x' } });
    eq(lib.views().length, 1);
    await lib.viewDelete(v.id);
    eq(lib.views().length, 0);
  });
  await t('打印状态推进与计数幂等', async () => {
    await lib.setPrintStatus(['a'], 'printed');
    eq(lib.get('a').printCount, 1);
    await lib.setPrintStatus(['a'], 'printed');
    eq(lib.get('a').printCount, 1, '重复设置不应虚增次数');
  });
  await t('stats / smartCounts / roulette 口径', () => {
    const s = lib.stats();
    eq(s.total, 3);
    ok(s.totalSize >= 6000);
    ok(typeof s.byPrintStatus === 'object');
    eq(lib.smartCounts().all, 3);
    const r = lib.roulette();
    ok(r === null || typeof r.id === 'string');
  });
  await t('remove 只删索引不碰磁盘', async () => {
    const r = await lib.remove(['c']);
    eq(r.removed, 1);
    ok(!lib.get('c'));
  });

  // ---------------------------------------------------------------- 去重
  group('[5] 重复识别 duplicates');
  await t('computeHashGroups 仅返回多条目组', () => {
    const m = [mk('x', { hash: 'same' }), mk('y', { hash: 'same' }), mk('z', { hash: 'diff' })];
    const g = D.computeHashGroups(m);
    eq(g.size, 1); eq(g.get('same').length, 2);
  });
  await t('annotate 写回 duplicateGroup / duplicateOf', () => {
    const l = { models: { x: mk('x', { hash: 'same' }), y: mk('y', { hash: 'same' }), z: mk('z', { hash: 'd' }) } };
    const r = D.annotate(l);
    eq(r.groups, 1);
    ok(l.models.x.duplicateGroup && l.models.y.duplicateGroup);
    ok(!l.models.z.duplicateGroup);
  });
  await t('findSimilar 识别改名副本', () => {
    const r = D.findSimilar([mk('模型'), mk('模型_1')]);
    ok(Array.isArray(r) && r.length >= 1, '应找到疑似重复');
  });

  // ---------------------------------------------------------------- 缩略图
  group('[6] 缩略图缓存 thumbs');
  thumbs = new Thumbs({ store });
  await t('有内嵌图 → 生成 .png 缓存', async () => {
    if (!fs.existsSync(SAMPLE.bambu)) return;
    const rec = mk('thumb1', { path: SAMPLE.bambu });
    const name = await thumbs.ensureFor(rec, {});
    ok(name && name.endsWith('.png'), '应返回 png 文件名，实际 ' + name);
    ok(thumbs.exists(name) && fs.statSync(thumbs.getPath(name)).size > 0);
  });
  await t('无内嵌图 → 生成自包含 svg 占位图', async () => {
    const rec = mk('thumb2', { path: SAMPLE.minimal });
    const name = await thumbs.ensureFor(rec, {});
    ok(name && name.endsWith('.svg'), '应返回 svg 占位图，实际 ' + name);
    const txt = fs.readFileSync(thumbs.getPath(name), 'utf8');
    ok(txt.includes('<svg') && txt.includes('xmlns'), '占位图不是自包含 SVG');
  });
  await t('二次调用直接命中缓存不重复抽取', async () => {
    const rec = mk('thumb1', { path: SAMPLE.bambu });
    const a = await thumbs.ensureFor(rec, {});
    rec.thumbnail = a; // 模拟索引里已缓存文件名
    const before = thumbs.stats().count;
    const b = await thumbs.ensureFor(rec, {});
    eq(a, b); eq(thumbs.stats().count, before);
  });
  await t('prune 清理无引用缓存', async () => {
    const orphan = path.join(paths.getThumbsDir(), 'orphan.png');
    fs.writeFileSync(orphan, 'x');
    const r = await thumbs.prune();
    ok(r.removed >= 1, '应删除孤立文件');
    ok(!fs.existsSync(orphan));
  });

  // ---------------------------------------------------------------- 扫描
  group('[7] 目录扫描 scanner');
  scanner = new Scanner({ store, thumbs });

  await t('准备三种真实 3mf 样本', () => {
    for (const [k, src] of Object.entries({ one: SAMPLE.normal, two: SAMPLE.bambu, three: SAMPLE.minimal })) {
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(modelDir, k + '.3mf'));
    }
    ok(fs.readdirSync(modelDir).filter((f) => f.endsWith('.3mf')).length >= 2);
  });
  await t('scanAll 全量入库 + 缩略图 + 去重', async () => {
    await store.updateSettings({ folders: [{ id: 'f1', path: modelDir, enabled: true, recursive: true, addedAt: 0, lastScanAt: null }] });
    scanReport = await scanner.scanAll({ force: false });
    ok(scanReport.added >= 2, '新增数异常：' + scanReport.added);
    eq(scanReport.failed, 0, '不应有解析失败');
    const total = lib.stats().total;
    ok(total >= scanReport.added, '库内总数应包含新增');
    ok(thumbs.stats().count >= scanReport.added, '缩略图应落盘');
  });
  await t('增量扫描：size+mtime 未变则跳过', async () => {
    const r = await scanner.scanAll({ force: false });
    eq(r.added, 0);
    ok(r.unchanged >= 2, '应有 unchanged：' + r.unchanged);
  });
  await t('force 扫描强制重解析', async () => {
    const r = await scanner.scanAll({ force: true });
    ok(r.updated >= 2, 'force 应触发更新：' + r.updated);
  });
  await t('文件消失 → 标记 missing 且保留人工字段', async () => {
    const target = fs.readdirSync(modelDir).find((f) => f.endsWith('.3mf'));
    const full = path.join(modelDir, target);
    const before = Object.values(store.getLibrary().models).find((m) => U.pathKey(m.path) === U.pathKey(full));
    ok(before, '应能在索引中找到该文件');
    await lib.update(before.id, { note: '重要备注' });
    fs.renameSync(full, full + '.bak');
    const r = await scanner.scanAll({ force: false });
    ok(r.missing >= 1, '应检测到失效：' + r.missing);
    const rec = lib.get(before.id);
    eq(rec.status, 'missing');
    eq(rec.note, '重要备注', '失效不应丢备注');
    fs.renameSync(full + '.bak', full);
  });
  await t('cancel：运行中才置取消标记，空闲时无副作用', () => {
    ok(scanner.getStatus().running === false, '此刻不应在扫描');
    scanner.cancel();                                   // 空闲时调用应当是空操作
    ok(scanner._cancelRequested === false, '空闲时不应置取消标记');
    scanner._status.running = true;                     // 白盒：模拟扫描进行中
    try {
      scanner.cancel();
      ok(scanner._cancelRequested === true, '运行中应置取消标记');
      ok(/取消/.test(scanner.getStatus().message), '状态文案应说明正在取消：' + scanner.getStatus().message);
    } finally {
      scanner._status.running = false;
      scanner._cancelRequested = false;
      scanner._status.message = '';
    }
  });
  await t('不扫描自己的产物目录（thumbs/backups/u1-cache）', async () => {
    // 用户把整个项目目录设成监控文件夹时，数据目录就在里面 —— 不能把自己的缓存当模型
    const cacheDir = path.join(paths.getDataDir(), 'u1-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const fake = path.join(cacheDir, '某模型_U1_deadbeef.3mf');
    fs.copyFileSync(SAMPLE.minimal, fake);
    // 关键：必须把「数据目录本身」设成扫描根。否则缓存目录只是扫描根的兄弟，
    // 本来就走不到，这条断言恒真（这就是它原先形同虚设的原因）。
    const prevFolders = store.getSettings().folders;
    await store.updateSettings({ folders: [{ id: 'f-data', path: paths.getDataDir(), enabled: true, recursive: true, addedAt: 0, lastScanAt: null }] });
    try {
      await scanner.scanAll({ force: false });
      const hit = Object.values(store.getLibrary().models).find((m) => m.path === fake);
      ok(!hit, 'u1-cache 里的文件不应被索引');
      const thumbsHit = Object.values(store.getLibrary().models)
        .find((m) => m.path.startsWith(path.join(paths.getDataDir(), 'thumbs')));
      ok(!thumbsHit, 'thumbs 目录不应被索引');
    } finally {
      await store.updateSettings({ folders: prevFolders });
      try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  // ---------------------------------------------------------------- 重命名 / 重定位
  group('[8] 重命名与失效重定位');
  await t('renameFile 改磁盘名且保留元数据', async () => {
    const all = Object.values(store.getLibrary().models).filter((m) => m.path.startsWith(modelDir) && fs.existsSync(m.path));
    if (!all.length) return;
    const rec = all[0];
    await lib.update(rec.id, { note: '保留我', favorite: true, rating: 4 });
    const newName = 'renamed_' + Date.now().toString(36);
    const r = await lib.renameFile(rec.id, newName);
    ok(r.path.endsWith(newName + '.3mf'), '路径未更新：' + r.path);
    ok(fs.existsSync(r.path), '磁盘文件不存在');
    eq(r.note, '保留我'); eq(r.favorite, true); eq(r.rating, 4);
  });
  await t('renameFile 目标已存在时拒绝覆盖', async () => {
    const all = Object.values(store.getLibrary().models).filter((m) => m.path.startsWith(modelDir) && fs.existsSync(m.path));
    if (all.length < 2) return;
    const other = path.basename(all[1].path, '.3mf');
    let threw = false;
    try { await lib.renameFile(all[0].id, other); } catch (e) { threw = true; ok(/[\u4e00-\u9fa5]/.test(e.message)); }
    ok(threw, '应拒绝覆盖');
  });
  await t('findRelinkCandidates 能找到同名候选', async () => {
    const rec = Object.values(store.getLibrary().models).find((m) => m.path.startsWith(modelDir));
    if (!rec) return;
    const r = await lib.findRelinkCandidates(rec.id);
    ok(Array.isArray(r), '应返回数组');
  });

  // ---------------------------------------------------------------- 切片软件
  group('[9] 切片软件联动 slicer');
  slicer = new Slicer({ store });
  await t('detect 返回本机候选数组', async () => {
    const r = await slicer.detect();
    ok(Array.isArray(r), '应返回数组');
    for (const s of r) { ok(s.name && s.exePath, '候选项字段不完整'); }
    console.log('    本机探测到 ' + r.length + ' 个：' + r.map((x) => x.name).join(' / '));
  });
  await t('validate 拒绝不存在的路径并给中文原因', () => {
    const r = slicer.validate(path.join(tmp, 'no-such.exe'));
    eq(r.ok, false); ok(/[\u4e00-\u9fa5]/.test(r.reason || ''), '原因应为中文');
    eq(slicer.validate(process.execPath).ok, true, 'node.exe 应通过校验');
  });
  await t('add / setDefault / remove 配置持久化', async () => {
    const s = await slicer.add({ name: '测试切片', exePath: process.execPath, args: '', setDefault: true });
    ok(s.id && s.isDefault);
    eq(slicer.list().length, 1);
    await slicer.remove(s.id);
    eq(slicer.list().length, 0);
  });
  await t('validate 把安装目录纠正成目录里的 exe', () => {
    const dir = path.join(tmp, 'fake-install');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'unins000.exe'), '');
    fs.writeFileSync(path.join(dir, 'snapmaker-orca.exe'), '');
    const r = slicer.validate(dir);
    eq(r.ok, true, '目录应被接受');
    eq(r.fixed, true, '应标记为已纠正');
    eq(path.basename(r.exePath), 'snapmaker-orca.exe', '要选切片软件本体，不能选卸载器');
  });
  await t('validate 对没有 exe 的目录给可读原因', () => {
    const dir = path.join(tmp, 'empty-install');
    fs.mkdirSync(dir, { recursive: true });
    const r = slicer.validate(dir);
    eq(r.ok, false, '应拒绝');
    ok(/这是文件夹/.test(r.reason || ''), '原因应说明是文件夹：' + r.reason);
  });
  await t('add 传文件夹时存进去的是 exe 路径', async () => {
    const dir = path.join(tmp, 'fake-install');
    const s = await slicer.add({ name: '按目录添加', exePath: dir });
    eq(path.basename(s.exePath), 'snapmaker-orca.exe', '存的不应是目录');
    ok(!!s.autoFixedPath, '应回传纠正后的路径');
    // 启动时也用纠正后的路径（设置里存了目录的老数据也能救回来）
    await slicer.update(s.id, { exePath: dir });
    eq(path.basename(slicer.list()[0].exePath), 'snapmaker-orca.exe', 'update 也要纠正');
    await slicer.remove(s.id);
    eq(slicer.list().length, 0);
  });
  await t('未配置软件时 open 给出可读中文错误', async () => {
    let threw = false;
    try { await slicer.open(['whatever'], {}); }
    catch (e) { threw = true; ok(/[\u4e00-\u9fa5]/.test(e.message), '应为中文错误'); }
    ok(threw, '应抛错');
  });

  // ---------------------------------------------------------------- 收尾
  console.log('\n' + '='.repeat(58));
  console.log(`单元测试：${pass} 通过 / ${fail} 失败`);
  if (failures.length) { console.log('\n失败明细：'); failures.forEach((f) => console.log('  - ' + f)); }
  console.log('='.repeat(58));
  try { await store.saveLibrary(); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本自身异常：', e);
  process.exit(1);
});
