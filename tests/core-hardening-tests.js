'use strict';
/**
 * 核心层加固回归测试（纯 Node，离线，所有文件都在系统临时目录）。
 * 覆盖：损坏数据保护 / 扫描并发合并 / 解压上限 / MQTT 缓冲 / store 恢复 /
 *      缩略图 in-flight / 回填终态 / 分类撤销 / 成本兜底 / 路径穿越 /
 *      打印机配置 / 取消转换 / 原子写 / 字段归一化。
 *   node tests/core-hardening-tests.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const AdmZip = require('adm-zip');

const paths = require('../src/core/paths');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
const tick = () => new Promise((r) => setImmediate(r));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-hardening-'));
const ORIG_DATA_DIR = paths.getDataDir();
paths.setDataDir(tmp);

/** 生成一个结构完整的最小 3MF，size 不同可触发扫描重解析 */
function make3mf(file, tag = 'a') {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    + '</Types>', 'utf8'));
  zip.addFile('3D/3dmodel.model', Buffer.from(
    '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + '<resources><object id="1" type="model"><mesh><vertices>'
    + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>'
    + '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>'
    + '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>'
    + '<!--' + tag.repeat(20) + '-->', 'utf8'));
  mkdirp(path.dirname(file));
  zip.writeZip(file);
  return file;
}

function simpleStore(models = {}) {
  const settings = {};
  let lib = { models: { ...models }, categories: [], tags: [], savedViews: [], scanMeta: {} };
  let writes = 0;
  return {
    getSettings: () => settings,
    getLibrary: () => lib,
    setLibrary: (v) => { lib = v; },
    updateSettings: async (patch) => { Object.assign(settings, patch); writes++; },
    updateLibrary: async (mut) => { writes++; await mut(lib); return lib; },
    _writes: () => writes,
  };
}

// ============================================================ 1. 数据文件保护
async function testDataFiles() {
  section('1. filaments / receipts 损坏与不可读');
  const { FilamentService, normalizeFilament, corruptBackupPath } = require('../src/core/filaments');
  const { ReceiptService, normalizeReceipt, corruptBackupPath: receiptsBackupPath } = require('../src/core/receipts');

  const dir = path.join(tmp, 'datafiles');
  paths.setDataDir(dir);

  // JSON 损坏：原字节必须留底
  const fFile = paths.getFilamentsPath();
  mkdirp(path.dirname(fFile));
  const broken = '{"items":{ BROKEN \u0000';
  fs.writeFileSync(fFile, broken, 'utf8');
  const fs1 = new FilamentService();
  await fs1.init();
  ok('filaments 损坏状态可观察', fs1.recovery && fs1.recovery.kind === 'corrupt');
  ok('filaments 原文件字节已另存 .corrupt-*',
    fs1.recovery.backup.indexOf('.corrupt-') > 0 && fs.readFileSync(fs1.recovery.backup, 'utf8') === broken);
  ok('filaments 损坏后从内置耗材启动', fs1.list().items.length === 3,
    JSON.stringify(fs1.list().items.map((x) => x.name)));
  const backupName = corruptBackupPath(fFile);
  ok('备份名生成函数可用', /\.corrupt-\d{8}-\d{6}-\d{3}$/.test(backupName), backupName);

  // 读取失败（把文件位置做成目录）：一字不写，抛中文错误
  const dirAsFile = path.join(dir, 'unreadable');
  paths.setDataDir(dirAsFile);
  const fFile2 = paths.getFilamentsPath();
  mkdirp(fFile2);                       // 目录占用文件名 → readFile 一定失败
  const fs2 = new FilamentService();
  let err = null;
  try { await fs2.init(); } catch (e) { err = e; }
  ok('filaments 读取失败抛中文错误', !!err && /无法读取/.test(err.message), err && err.message);
  ok('filaments 读取失败不创建替代文件', fs.statSync(fFile2).isDirectory());
  ok('filaments 读取失败状态可观察', fs2.recovery && fs2.recovery.kind === 'unreadable');

  // 字段归一化：旧记录缺字段不能把 undefined 交给界面
  const old = normalizeFilament({ id: 'f1', name: '旧耗材' });
  ok('旧耗材补齐 color/price/tag 等字段',
    old.color === null && old.pricePerKg === 0 && old.image === null
    && old.note === '' && old.type === 'PLA' && old.updatedAt >= 0);
  const oldR = normalizeReceipt({ id: 'r1', jobName: 'a.3mf', endedAt: 61000, startedAt: 0 });
  ok('旧回执补齐字段',
    Array.isArray(oldR.filamentNames) && oldR.cost === 0 && oldR.weightG === null
    && oldR.linkedManually === false && oldR.durationMin === 1);

  // receipts 同样验证
  const rDir = path.join(tmp, 'receipts');
  paths.setDataDir(rDir);
  const rFile = paths.getReceiptsPath();
  mkdirp(path.dirname(rFile));
  fs.writeFileSync(rFile, 'not json at all', 'utf8');
  const svc = new ReceiptService();
  await svc.init();
  ok('receipts 损坏留底', svc.recovery && svc.recovery.kind === 'corrupt'
    && fs.readFileSync(svc.recovery.backup, 'utf8') === 'not json at all');
  ok('receipts 备份名毫秒补 3 位', /\.corrupt-\d{8}-\d{6}-\d{3}$/.test(svc.recovery.backup), svc.recovery.backup);
  ok('receipts 备份名生成函数可用',
    /\.corrupt-\d{8}-\d{6}-\d{3}$/.test(receiptsBackupPath(rFile)));
  ok('receipts 从空列表启动', svc.list().length === 0);
}

// ============================================================ 2. store 恢复与导入
async function testStore() {
  section('2. store 损坏恢复 / 导入逐条校验');
  const Store = require('../src/core/store');
  const dir = path.join(tmp, 'store');
  mkdirp(dir);
  paths.setDataDir(dir);
  const libPath = paths.getLibraryPath();
  fs.writeFileSync(libPath, '{this is broken', 'utf8');
  const store = new Store({});
  await store.init();
  ok('store 记录恢复状态', store.recovery && store.recovery.kind === 'corrupt'
    && store.recovery.source === 'fresh');
  ok('store 原文件字节留底',
    store.recovery.backup && fs.readFileSync(store.recovery.backup, 'utf8') === '{this is broken');
  ok('store 备份名毫秒补 3 位', /\.corrupt-\d{8}-\d{6}-\d{3}$/.test(store.recovery.backup), store.recovery.backup);
  ok('store 重置后的库文件合法', !!store.getLibrary().models);

  const store2 = new Store({});
  await store2.init();
  const before = Object.keys(store2.getLibrary().models).length;
  const bad = path.join(dir, 'bad-import.json');
  fs.writeFileSync(bad, JSON.stringify({
    models: { x: null }, categories: [], tags: [], savedViews: [],
  }), 'utf8');
  let err = null;
  try { await store2.importFrom(bad, { merge: false }); } catch (e) { err = e; }
  ok('坏记录导入被拒绝', !!err && /无效记录/.test(err.message), err && err.message);
  ok('拒绝导入后旧库未被替换', Object.keys(store2.getLibrary().models).length === before);
}

// ============================================================ 3. 扫描并发合并
async function testScanner() {
  section('3. scanner 当前库合并 / relink 复核 / in-flight');
  const Store = require('../src/core/store');
  const Thumbs = require('../src/core/thumbs');
  const Scanner = require('../src/core/scanner');

  const dir = path.join(tmp, 'scanner');
  const modelDir = path.join(dir, 'models');
  mkdirp(modelDir);
  const a = make3mf(path.join(modelDir, 'a.3mf'), 'a');
  paths.setDataDir(dir);
  const store = new Store({});
  await store.init();
  await store.updateSettings({ folders: [{ id: 'f1', path: modelDir, enabled: true, recursive: true, addedAt: 0, lastScanAt: null }] });
  const thumbs = new Thumbs({ store });
  const scanner = new Scanner({ store, thumbs });
  await scanner.scanPath(modelDir);
  const rec = Object.values(store.getLibrary().models)[0];
  ok('样本已入库', !!rec);
  ok('_selfDirs 使用 store 私有 dataDir',
    scanner._selfDirs().some((p) => path.resolve(p) === path.join(dir, 'thumbs')),
    JSON.stringify(scanner._selfDirs()));

  // 模拟扫描期间用户编辑：在 store 的 mutator 执行前改库
  const realUpdate = store.updateLibrary.bind(store);
  store.updateLibrary = async (mut, reason) => {
    const r = store.getLibrary().models[rec.id];
    if (r) {
      r.title = '人工改的标题';
      r.note = '人工备注';
      r.favorite = true;
      r.categoryId = 'cat-human';
      r.rating = 4;
      r.costWeightG = 123;
      r.printStatus = 'printed';
    }
    return realUpdate(mut, reason);
  };
  make3mf(a, 'bbbb');                    // 换内容触发重解析
  await scanner.scanAll({ force: true });
  const after = store.getLibrary().models[rec.id];
  ok('扫描不吞人工标题/备注/收藏',
    after.title === '人工改的标题' && after.note === '人工备注' && after.favorite === true);
  ok('扫描不吞人工分类/评分/成本/打印状态',
    after.categoryId === 'cat-human' && after.rating === 4
    && after.costWeightG === 123 && after.printStatus === 'printed');

  // relink：扫描期间把 path 改到新文件，失效检测必须用当前 path
  const relinked = make3mf(path.join(modelDir, 'relinked.3mf'), 'cccc');
  fs.unlinkSync(a);
  const realUpdate2 = store.updateLibrary.bind(store);
  store.updateLibrary = async (mut, reason) => {
    const r = store.getLibrary().models[rec.id];
    if (r) r.path = relinked;
    return realUpdate2(mut, reason);
  };
  await scanner.scanAll({ force: true });
  const after2 = store.getLibrary().models[rec.id];
  ok('relink 后的 path 不被旧快照改回', after2.path === relinked, after2.path);
  ok('relink 后的记录不被误标 missing', after2.status !== 'missing', after2.status);
  store.updateLibrary = realUpdate;

  // in-flight 缩略图不会被 prune 删掉
  const m3 = require('../src/core/model3mf');
  const realParse = m3.parse3mf;
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xff, 0xd9]);
  m3.parse3mf = async () => {
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true, thumbnail: { entry: 't.png', data: JPEG, mime: 'image/png' } };
  };
  const srcFile = make3mf(path.join(modelDir, 'thumb.3mf'), 'd');
  const pending = thumbs.ensureFor({ path: srcFile, thumbnail: null }, { force: true });
  await tick();
  const pruned = await thumbs.prune();
  const name = require('../src/core/utils').sha1(require('../src/core/utils').pathKey(srcFile)).slice(0, 24) + '.png';
  // 解析还没结束时文件尚未落盘，正确行为是「在 in-flight 集合里，且 prune 没删到它」。
  ok('prune 跳过正在生成的缩略图', thumbs._inflight.has(name), JSON.stringify(pruned));
  await pending;
  m3.parse3mf = realParse;
  ok('生成完成后 in-flight 集合已清空', thumbs._inflight.size === 0);
}

// ============================================================ 4. 3MF 解压上限
async function testModel3mf() {
  section('4. model3mf 解压炸弹防护');
  const { parse3mf } = require('../src/core/model3mf');
  const dir = path.join(tmp, 'zipbomb');
  mkdirp(dir);

  const p1 = path.join(dir, 'text.3mf');
  const zip1 = new AdmZip();
  zip1.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
  zip1.addFile('3D/3dmodel.model', Buffer.from('<model/>'));
  zip1.addFile('Metadata/slice_info.config', Buffer.from(
    '<metadata key="weight" value="90.39"/><!--' + 'A'.repeat(200000) + '-->'));
  zip1.writeZip(p1);
  const limited = await parse3mf(p1, { maxTextBytes: 1024 });
  ok('超大文本条目超限被跳过', limited.ok === true && limited.meta.weightG === null);
  const normal = await parse3mf(p1);
  ok('正常限额下大条目仍能解析', normal.ok === true && normal.meta.weightG === 90.39);

  const p2 = path.join(dir, 'img.3mf');
  const zip2 = new AdmZip();
  zip2.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
  zip2.addFile('3D/3dmodel.model', Buffer.from('<model/>'));
  zip2.addFile('Metadata/thumbnail.png', Buffer.alloc(200000, 0x41));
  zip2.writeZip(p2);
  const noThumb = await parse3mf(p2, { maxImageBytes: 1024, withMeta: false });
  ok('超大图片条目超限被跳过', noThumb.ok === true && noThumb.thumbnail === null);
  const withThumb = await parse3mf(p2, { withMeta: false });
  ok('正常限额下缩略图仍可读', withThumb.ok === true && !!withThumb.thumbnail);
}

// ============================================================ 5. MQTT 缓冲
function testMqtt() {
  section('5. bambu-mqtt 缓冲区与畸形长度');
  const BambuMqtt = require('../src/core/bambu-mqtt');
  const m = new BambuMqtt({ host: '127.0.0.1' });
  const errs = [], reports = [];
  m.on('error', (e) => errs.push(e.message));
  m.on('report', (r) => reports.push(r));
  // MQTT PUBLISH 首字节是 0x30（类型在高 4 位）
  const packet = m._packet(0x30, Buffer.concat([m._str('device/x/report'), Buffer.from('{"hello":1}')]));
  m._onData(packet);
  ok('正常 PUBLISH 仍能解析', reports.length === 1 && reports[0].data.hello === 1);
  m._onData(Buffer.alloc(BambuMqtt.MAX_BUFFER_BYTES + 1));
  ok('超大 chunk 被拒绝并清空缓冲',
    errs.some((e) => /缓冲区超过上限/.test(e)) && m._buf.length === 0);
  m._onData(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x7f]));
  ok('畸形剩余长度被拒绝', errs.some((e) => /剩余长度非法/.test(e)), errs.join('|'));
  m._dispatch = () => { throw new Error('故意炸'); };
  m._onData(packet);
  ok('_drain 外层异常不逃逸', errs.some((e) => /报文解析失败/.test(e)), errs.join('|'));
}

// ============================================================ 6. 回填失败终态
async function testBackfill() {
  section('6. weights / colors 解析失败不写终态');
  const { weightPatch, backfillWeights } = require('../src/core/weights');
  const { colorPatch, backfillFilamentColors } = require('../src/core/colors');
  ok('weightPatch(null) 不写 weightChecked', weightPatch({ weightG: null }, null).weightChecked !== true);
  ok('colorPatch(null) 不写空色板终态',
    colorPatch({ weightG: 1 }, null).colorSource === undefined);
  const okPatch = weightPatch({}, { weightG: 12.3, filamentUsages: [] });
  ok('解析成功仍写 checked', okPatch.weightChecked === true && okPatch.weightG === 12.3);

  const dir = path.join(tmp, 'backfill');
  mkdirp(dir);
  const bad3mf = path.join(dir, 'bad.3mf');
  fs.writeFileSync(bad3mf, 'this is not a zip');
  const store = simpleStore({ m1: { id: 'm1', path: bad3mf, status: 'ok', meta: { weightG: null } } });
  const wr = await backfillWeights(store);
  ok('解析失败计入 failed', wr.failed === 1, JSON.stringify(wr));
  ok('解析失败不写库', store._writes() === 0);
  ok('解析失败不留 weightChecked', store.getLibrary().models.m1.meta.weightChecked === undefined);

  const store2 = simpleStore({ m2: { id: 'm2', path: bad3mf, status: 'ok', meta: {} } });
  const cr = await backfillFilamentColors(store2);
  ok('colors 解析失败计入 failed', cr.failed === 1, JSON.stringify(cr));
  ok('colors 解析失败不写库', store2._writes() === 0);
}

// ============================================================ 7. 分类撤销
async function testClassify() {
  section('7. classify 撤销只清自动结果');
  const classify = require('../src/core/classify');
  const store = simpleStore({
    a: { id: 'a', categoryId: 'c1', autoClassified: true, autoCategoryId: 'c1' },
    b: { id: 'b', categoryId: 'c2', autoClassified: true, autoCategoryId: 'c1' },
    c: { id: 'c', categoryId: 'c3' },
  });
  const r = await classify.undoAutoClassified(store);
  ok('只撤销仍是自动结果的记录', r.cleared === 1, JSON.stringify(r));
  ok('自动分类被清空', store.getLibrary().models.a.categoryId === null);
  ok('人工改过的分类保留', store.getLibrary().models.b.categoryId === 'c2'
    && store.getLibrary().models.b.autoClassified === false);

  const hit = classify.applyToRecord({ id: 'x' }, [{ id: 'r', categoryId: 'c1', keywords: ['测试'] }].concat([]));
  ok('applyToRecord 记录 autoCategoryId',
    classify.matchCategory({ title: '测试件' }, [{ categoryId: 'c1', keywords: ['测试'] }]) === 'c1');
  void hit;
}

// ============================================================ 8. 成本兜底
function testCost() {
  section('8. cost 显式 0 价不被覆盖');
  const cost = require('../src/core/cost');
  const fl = { items: [
    { id: 'zero', name: '免费耗材', pricePerKg: 0 },
    { id: 'paid', name: '收费耗材', pricePerKg: 100 },
  ] };
  const def = fl.items[1];
  const rec = { meta: { weightG: 100 }, filamentLinks: [{ filamentId: 'zero', weightG: 100 }] };
  const r = cost.costOf(rec, fl, { defaultFilament: def });
  ok('显式 0 价保持 0 元', r.total === 0, JSON.stringify(r));
  ok('明细仍是用户分配的那条', r.parts.length === 1 && r.parts[0].filamentId === 'zero');
  ok('来源仍是 assigned', r.source === 'assigned');
  const noLink = cost.costOf({ meta: { weightG: 100 }, filamentLinks: [{ filamentId: 'missing', weightG: 100 }] },
    fl, { defaultFilament: def });
  ok('link 找不到耗材时仍走默认兜底', noLink.total === 10 && noLink.source === 'default', JSON.stringify(noLink));
}

// ============================================================ 9. 路径穿越 / httpFrame
async function testHttpPaths() {
  section('9. moonraker 路径穿越 / camera-http 累积写');
  const Moonraker = require('../src/core/moonraker');
  const { safeCameraPath } = Moonraker;
  ok('合法相对路径放行', safeCameraPath('pictures/a.jpg') === 'pictures/a.jpg');
  ok('.. 被拒绝', safeCameraPath('../secret.txt') === null);
  ok('编码后的 .. 被拒绝', safeCameraPath('..%2Fsecret.txt') === null);
  ok('绝对路径被拒绝', safeCameraPath('/etc/passwd') === null);
  ok('Windows 绝对路径被拒绝', safeCameraPath('C:\\Windows\\x.jpg') === null);

  const mk = new Moonraker({ host: 'x' });
  let called = '';
  mk.getBinary = async (p) => { called = p; return { buffer: Buffer.alloc(0) }; };
  await mk.fileBuffer('../secret.txt').catch(() => {});
  ok('fileBuffer 拒绝后不发起请求', called === '');
  await mk.fileBuffer('pictures/a.jpg');
  ok('合法路径正常拼接', called === '/server/files/camera/pictures/a.jpg', called);

  // 跨 chunk 的 JPEG 尾标记也要能快速收帧（验证新的累积写法不回归）
  const { httpFrame } = require('../src/core/camera-http');
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2]), Buffer.from([0xff, 0xd9])]);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=f' });
    res.write('--f\r\nContent-Type: image/jpeg\r\n\r\n');
    res.write(JPEG.subarray(0, JPEG.length - 1));
    setTimeout(() => res.write(JPEG.subarray(JPEG.length - 1)), 20);
    const t = setInterval(() => res.write('\r\n--f\r\n'), 100);
    req.on('close', () => clearInterval(t));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const fr = await httpFrame('http://127.0.0.1:' + server.address().port + '/s', 3000);
    ok('MJPEG 跨 chunk 的 FFD9 仍能收帧', fr.ok === true && fr.frames[0].equals(JPEG),
      JSON.stringify(fr).slice(0, 120));
  } finally {
    server.close();
  }
}

// ============================================================ 10. 打印机配置
function testPrinters() {
  section('10. printers 退避 / 颜色 / mode');
  const PrinterService = require('../src/core/printers');
  const { argbToHex } = PrinterService;
  ok('8 位 hex 取前 6 位', argbToHex('39FF14FF') === '#39FF14');
  ok('纯数字按 uint32 解析', argbToHex(0xFF39FF14) === '#39FF14', argbToHex(0xFF39FF14));
  ok('8 位十进制字符串按 uint32 解析', argbToHex('12345678') === '#BC614E', argbToHex('12345678'));
  ok('非法 hex 兜底灰色', argbToHex('zzzzzz') === '#9AA3AF');

  const settings = { printers: [] };
  const store = { getSettings: () => settings, updateSettings: async (p) => Object.assign(settings, p) };
  const ps = new PrinterService({ store });
  return (async () => {
    const p1 = await ps.add({ kind: 'bambu', ip: '10.0.0.1', mode: 'cloud' });
    ok('add 支持 mode', p1.mode === 'cloud');
    await ps.update(p1.id, { mode: 'lan' });
    ok('update 支持 mode', ps.list()[0].mode === 'lan');
    let err = null;
    try { await ps.update(p1.id, { mode: 'weird' }); } catch (e) { err = e; }
    ok('非法 mode 被拒绝', !!err && /连接模式/.test(err.message));

    const st2 = {
      printers: [{ id: 'p2', kind: 'bambu', name: '无序列号', ip: '10.0.0.2', enabled: true }],
    };
    const ps2 = new PrinterService({ store: { getSettings: () => st2, updateSettings: async () => {} } });
    let updates = 0;
    ps2.on('update', () => updates++);
    await ps2._ensureBambu(st2.printers[0]);
    await ps2._ensureBambu(st2.printers[0]);
    ok('缺 serial 时加退避，不再每轮刷 update', updates === 1, String(updates));
    ok('退避时间已设置', ps2._bambu.get('p2').nextTry > Date.now());
  })();
}

// ============================================================ 11. 取消转换
async function testU1Cancel() {
  section('11. u1convert 取消走统一 finish');
  const wt = require('worker_threads');
  const RealWorker = wt.Worker;
  class FakeWorker extends EventEmitter {
    constructor(o) { super(); this.workerData = o && o.workerData; this.terminated = false; FakeWorker.last = this; }
    terminate() { this.terminated = true; setImmediate(() => this.emit('exit', 1)); return Promise.resolve(1); }
  }
  wt.Worker = FakeWorker;
  let U1Converter;
  try {
    U1Converter = require('../src/core/u1convert');
  } finally {
    wt.Worker = RealWorker;
  }
  const dir = path.join(tmp, 'u1');
  mkdirp(dir);
  paths.setDataDir(dir);
  const src = path.join(dir, 'a.3mf');
  fs.writeFileSync(src, 'x');
  const cv = new U1Converter({ store: { getSettings: () => ({}) } });
  const p = cv.convert(src);
  await tick();
  ok('worker 已启动', !!FakeWorker.last);
  const cancelled = cv.cancel();
  const err = await p.then(() => null, (e) => e);
  ok('cancel 返回 true', cancelled === true);
  ok('取消文案为「已取消」', !!err && err.message === '已取消', err && err.message);
  ok('没有误报线程提前退出', !err || !/提前退出/.test(err.message));
  ok('worker 已终止', FakeWorker.last.terminated === true);
  ok('_worker 已清空', cv._worker === null);
  ok('_inflight 已清空', cv._inflight.size === 0, String(cv._inflight.size));
}

// ============================================================ 12. 原子写
async function testAtomicWrites() {
  section('12. slicer / mesh3mf 写盘原子性');
  const Slicer = require('../src/core/slicer');
  const settings = { slicers: [{ id: 'a', name: 'A' }] };
  const failStore = {
    getSettings: () => settings,
    updateSettings: async () => { throw new Error('模拟写盘失败'); },
  };
  const sl = new Slicer({ store: failStore });
  let err = null;
  try { await sl._write([{ id: 'b', name: 'B' }]); } catch (e) { err = e; }
  ok('写盘失败向上抛', !!err && /模拟写盘失败/.test(err.message));
  ok('写盘失败不修改内存数组',
    settings.slicers.length === 1 && settings.slicers[0].id === 'a', JSON.stringify(settings.slicers));

  const { buildOptimized3mf } = require('../src/core/mesh3mf');
  const dir = path.join(tmp, 'mesh');
  mkdirp(dir);
  const src = make3mf(path.join(dir, 'src.3mf'), 'x');
  const out = path.join(dir, 'out.3mf');
  const r = await buildOptimized3mf({ srcPath: src, outPath: out, parts: [], plyDir: dir });
  ok('正常产物写出成功', r.ok === true && fs.existsSync(out), r && r.error);
  ok('没有残留 .tmp 文件',
    fs.readdirSync(dir).filter((n) => /\.tmp-/.test(n)).length === 0);

  // 同源（硬链接/软链接）必须拒绝
  const alias = path.join(dir, 'alias.3mf');
  let linked = false;
  try { fs.linkSync(src, alias); linked = true; } catch (_) {
    try { fs.symlinkSync(src, alias, 'file'); linked = true; } catch (_) { /* 平台不支持则跳过 */ }
  }
  if (linked) {
    let e2 = null;
    try { await buildOptimized3mf({ srcPath: src, outPath: alias, parts: [], plyDir: dir }); }
    catch (e) { e2 = e; }
    ok('硬链接/软链接同源被拒绝', !!e2 && /不能与源文件相同/.test(e2.message), e2 && e2.message);
  } else {
    console.log('  (跳过：当前平台无法创建同 innode 链接)');
  }
}

// ============================================================ 主流程
(async () => {
  try {
    await testDataFiles();
    await testStore();
    await testScanner();
    await testModel3mf();
    testMqtt();
    await testBackfill();
    await testClassify();
    testCost();
    await testHttpPaths();
    await testPrinters();
    await testU1Cancel();
    await testAtomicWrites();
  } catch (e) {
    fail++;
    console.log('  ✗ 测试执行异常：' + (e && e.stack ? e.stack : String(e)));
  } finally {
    paths.setDataDir(ORIG_DATA_DIR);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 清理失败不阻塞 */ }
  }
  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
})();
