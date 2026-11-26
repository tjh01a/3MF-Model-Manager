'use strict';
/**
 * 健壮性回归（纯 Node，不联网、不动用户文件）。
 * 专门补之前「一条断言都没有」的危险路径：
 *   · scanner 的并发单飞锁
 *   · renameFile 写库失败时回滚磁盘改名
 *   · store 原子写的 rename 失败回退
 *   · slicer.trash 对空/不存在路径的处理（绝不 fs.unlink）
 *   · watcher 的防抖与「扫描中让路」
 *   · printers 对未知设备/异常输入的处理
 *   npm run test:robust
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../src/core/paths');
const Store = require('../src/core/store');
const Library = require('../src/core/library');
const Thumbs = require('../src/core/thumbs');
const Scanner = require('../src/core/scanner');
const Slicer = require('../src/core/slicer');
const FolderWatcher = require('../src/core/watcher');
const PrinterService = require('../src/core/printers');

let pass = 0, fail = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-robust-'));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WORKSPACE = path.resolve(__dirname, '..', '..');

/** 样本自包含：工作区里的极简 3mf 被清理时，在临时目录合成一个等价文件。 */
function ensureSample() {
  const real = path.join(WORKSPACE, '测试A_极简格式.3mf');
  if (fs.existsSync(real)) return real;
  const AdmZip = require('adm-zip');
  const out = path.join(tmp, 'fixtures', '极简样本.3mf');
  mkdirp(path.dirname(out));
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>', 'utf8'));
  zip.addFile('3D/3dmodel.model', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<resources><object id="1" type="model"><mesh><vertices>' +
    '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>' +
    '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>' +
    '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>', 'utf8'));
  zip.writeZip(out);
  return out;
}
const SAMPLE = ensureSample();

// ============================================================ [1] 扫描并发
async function testScannerLock() {
  console.log('\n[1] scanner 并发单飞锁');
  const dataDir = path.join(tmp, 'lock');
  const modelDir = path.join(dataDir, 'models');
  mkdirp(modelDir);
  if (fs.existsSync(SAMPLE)) fs.copyFileSync(SAMPLE, path.join(modelDir, 'a.3mf'));

  paths.setDataDir(dataDir);
  const store = new Store({});
  await store.init();
  await store.updateSettings({ folders: [{ id: 'f1', path: modelDir, enabled: true, recursive: true, addedAt: 0, lastScanAt: null }] });
  const thumbs = new Thumbs({ store });
  const scanner = new Scanner({ store, thumbs });

  const first = scanner.scanAll({ force: false });
  let threw = null;
  try { await scanner.scanAll({ force: false }); } catch (e) { threw = e; }
  ok('扫描进行中再发起扫描会被拒绝', !!threw && /正在扫描/.test(threw.message), threw && threw.message);
  const r = await first;
  ok('第一次扫描正常完成', r && typeof r.added === 'number');
  ok('结束后 running 复位', scanner.getStatus().running === false);

  const again = await scanner.scanAll({ force: false });
  ok('锁释放后可以再次扫描', again && typeof again.added === 'number');
}

// ============================================================ [2] 重命名回滚
async function testRenameRollback() {
  console.log('\n[2] renameFile 写库失败要回滚磁盘改名');
  const dataDir = path.join(tmp, 'rename');
  const modelDir = path.join(dataDir, 'models');
  mkdirp(modelDir);
  const src = path.join(modelDir, '原名.3mf');
  fs.copyFileSync(SAMPLE, src);

  paths.setDataDir(dataDir);
  const store = new Store({});
  await store.init();
  await store.updateSettings({ folders: [{ id: 'f1', path: modelDir, enabled: true, recursive: true, addedAt: 0, lastScanAt: null }] });
  const thumbs = new Thumbs({ store });
  const scanner = new Scanner({ store, thumbs });
  await scanner.scanAll({ force: false });
  const lib = new Library({ store });

  const rec = Object.values(store.getLibrary().models).find((m) => m.path === src);
  ok('样本已入库', !!rec);

  // 让写库必然失败，模拟磁盘满/记录被并发删除
  const realUpdate = store.updateLibrary.bind(store);
  store.updateLibrary = async () => { throw new Error('模拟写库失败'); };
  let threw = null;
  try { await lib.renameFile(rec.id, '新名字'); } catch (e) { threw = e; }
  store.updateLibrary = realUpdate;

  ok('写库失败会抛错', !!threw && /模拟写库失败/.test(threw.message), threw && threw.message);
  ok('磁盘文件名已回滚', fs.existsSync(src), src);
  ok('没有留下改过名的新文件', !fs.existsSync(path.join(modelDir, '新名字.3mf')));
  const after = lib.get(rec.id);
  ok('库里仍指向原路径', after && after.path === src, after && after.path);
}

// ============================================================ [3] 原子写回退
async function testAtomicFallback() {
  console.log('\n[3] store 原子写：rename 失败要走 copy 回退');
  const dataDir = path.join(tmp, 'atomic');
  mkdirp(dataDir);
  paths.setDataDir(dataDir);
  const store = new Store({});
  await store.init();

  const libPath = paths.getLibraryPath();
  ok('初始化已生成 library.json', fs.existsSync(libPath));

  // 让 renameSync 抛 EPERM（Windows 上杀软占用时的真实表现），验证回退分支仍能写成功
  const realRename = fs.renameSync;
  let renameTried = 0;
  fs.renameSync = function () { renameTried++; const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; };
  let threw = null;
  try {
    await store.updateLibrary((lib) => { lib.models.__probe = { id: '__probe', path: 'x.3mf' }; }, 'atomic-test');
  } catch (e) { threw = e; }
  fs.renameSync = realRename;

  ok('确实尝试过 rename', renameTried > 0, String(renameTried));
  ok('rename 失败不抛给调用方（已回退）', threw === null, threw && threw.message);
  const raw = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  ok('数据仍然落盘', !!(raw.models && raw.models.__probe), Object.keys(raw.models || {}).join(','));
  ok('没有残留 .tmp 文件', !fs.existsSync(libPath + '.tmp'));
}

// ============================================================ [4] 回收站边界
async function testTrashGuards() {
  console.log('\n[4] trash：空路径/不存在的文件不得触碰磁盘');
  const dataDir = path.join(tmp, 'trash');
  mkdirp(dataDir);
  paths.setDataDir(dataDir);
  const store = new Store({});
  await store.init();
  const slicer = new Slicer({ store });

  const r = await slicer.trash(['', path.join(tmp, 'not-exist.3mf')]);
  ok('两条都进 failed', r.failed.length === 2, JSON.stringify(r.failed));
  ok('空路径给中文原因', /路径为空/.test(r.failed[0].error), r.failed[0].error);
  ok('不存在给中文原因', /不存在/.test(r.failed[1].error), r.failed[1].error);
  ok('没有任何文件被删除', r.ok.length === 0);
}

// ============================================================ [5] watcher 防抖与让路
async function testWatcher() {
  console.log('\n[5] watcher：防抖后调用扫描；扫描中则让路');
  const dataDir = path.join(tmp, 'watch');
  const watchDir = path.join(dataDir, 'watched');
  mkdirp(watchDir);
  paths.setDataDir(dataDir);
  const store = new Store({});
  await store.init();
  await store.updateSettings({ folders: [{ id: 'f1', path: watchDir, enabled: true, recursive: true, addedAt: 0, lastScanAt: null }] });

  const calls = [];
  let fakeRunning = false;
  const fakeScanner = {
    getStatus: () => ({ running: fakeRunning }),
    scanFolder: async (folder) => { calls.push(folder.path); },
  };
  const watcher = new FolderWatcher({ store, scanner: fakeScanner, onChanged: () => {} });
  watcher.start();
  await sleep(600);   // 等 chokidar ready

  fs.writeFileSync(path.join(watchDir, 'x.3mf'), 'x');
  await sleep(1300);  // 防抖 800ms + 余量
  ok('文件新增触发了扫描', calls.length >= 1, JSON.stringify(calls));

  // 扫描中：不应硬闯
  fakeRunning = true;
  const before = calls.length;
  fs.writeFileSync(path.join(watchDir, 'y.3mf'), 'y');
  await sleep(1300);
  ok('扫描进行中时不调用 scanFolder', calls.length === before, String(calls.length - before));

  // 删除文件：默认直接移出库；关掉 dropMissing 则标 missing
  fakeRunning = false;   // 上一段模拟了「扫描中让路」，这里要放行
  const gonePath = path.join(watchDir, 'gone.3mf');
  fs.writeFileSync(gonePath, 'gone');
  await store.updateLibrary((lib) => {
    lib.models.gone = { id: 'gone', path: gonePath, status: 'ok', meta: {} };
  });
  await sleep(500);          // 让 chokidar 先看见这个文件，否则 add+unlink 可能并成一次
  fs.unlinkSync(gonePath);
  await sleep(1400);
  ok('unlink 后记录直接移出库', !store.getLibrary().models.gone);

  const keepPath = path.join(watchDir, 'keep.3mf');
  fs.writeFileSync(keepPath, 'keep');
  await store.updateSettings({ scan: { dropMissing: false } });
  await store.updateLibrary((lib) => {
    lib.models.keep = { id: 'keep', path: keepPath, status: 'ok', meta: {} };
  });
  await sleep(500);
  fs.unlinkSync(keepPath);
  await sleep(1400);
  const kept = store.getLibrary().models.keep;
  ok('dropMissing=false 时 unlink 标 missing 且保留记录', kept && kept.status === 'missing', kept && kept.status);
  await store.updateSettings({ scan: { dropMissing: true } });

  await watcher.stop();
  ok('stop 后不再运行', watcher.isRunning() === false);
}

// ============================================================ [6] 打印机边界
async function testPrinters() {
  console.log('\n[6] printers：未知设备与坏输入');
  const dataDir = path.join(tmp, 'printer');
  mkdirp(dataDir);
  paths.setDataDir(dataDir);
  const store = new Store({});
  await store.init();
  const ps = new PrinterService({ store });

  let threw = null;
  try { await ps.action('不存在', 'pause'); } catch (e) { threw = e; }
  ok('操作未知设备给中文错误', !!threw && /找不到这台打印机/.test(threw.message), threw && threw.message);

  threw = null;
  try { await ps.add({ kind: 'snapmaker', ip: '192.168.0.1' }); } catch (_) { /* 正常 */ }
  const p = ps.list()[0];
  threw = null;
  try { await ps.action(p.id, 'explode'); } catch (e) { threw = e; }
  ok('不支持的动作被拒绝', !!threw && /不支持的操作/.test(threw.message), threw && threw.message);

  // 离线设备的快照结构必须完整（界面直接渲染，缺字段会白屏）
  const snap = ps.snapshot()[0];
  ok('离线快照字段完整',
    snap && snap.state === 'offline' && snap.temps && snap.job === null && Array.isArray(snap.materials),
    JSON.stringify(snap && Object.keys(snap)));

  // stop 之后不应再有定时器把状态改回在线
  ps.stop();
  ok('stop 幂等', (ps.stop(), true));
}

// ============================================================ 主流程
(async () => {
  const prev = paths.getDataDir();
  try {
    await testScannerLock();
    await testRenameRollback();
    await testAtomicFallback();
    await testTrashGuards();
    await testWatcher();
    await testPrinters();
  } catch (e) {
    fail++;
    console.log('  ✗ 测试执行异常：' + e.message);
    console.log((e.stack || '').split('\n').slice(0, 5).join('\n'));
  } finally {
    paths.setDataDir(prev);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exitCode = 1;
})();
