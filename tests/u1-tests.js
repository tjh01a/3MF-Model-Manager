'use strict';
/**
 * 快造 U1 转换功能测试（纯 Node，不依赖 Electron）。
 * 运行： node tests/u1-tests.js
 *
 * 分四层：
 *   [1] 配置后处理      —— 纯函数，构造最小 3MF 验证
 *   [2] 预设继承链解析  —— 造一棵假的预设目录树（不读用户真实预设）
 *   [3] 真实端到端      —— 有快造 Orca + 样本文件时才跑
 *   [4] 打开路径        —— 临时切片软件对象 / 假 id / .cmd 分支，不启动真实程序
 *
 * 所有临时产物都在系统临时目录里，测试结束即删除，绝不碰用户文件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const { patchProjectConfig, slotCount, sourcePrinterName } = require('../src/core/u1patch');
const OrcaPresets = require('../src/core/orcapresets');
const U1Converter = require('../src/core/u1convert');
const Store = require('../src/core/store');
const Slicer = require('../src/core/slicer');
const PresetGuard = require('../src/core/presetguard');
const corePaths = require('../src/core/paths');

const {
  resolveRealSample, verifyOutput,
} = require('./u1-sample');

const ORCA_EXE = 'C:\\Program Files\\Snapmaker_Orca\\snapmaker-orca.exe';

let pass = 0, fail = 0;
const tmp = path.join(os.tmpdir(), 'printshelf-u1-test-' + process.pid);

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

/** 等一个文件出现且写满（子进程是 detached 的，主进程不等它） */
async function waitFile(p, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const s = fs.readFileSync(p, 'utf8');
      if (s.trim()) return s;
    } catch (_) { /* 还没生成 */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** 造一个只有配置、没有真实几何的最小 3MF（后处理只关心配置） */
function make3mf(outPath, config) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '<Default Extension="config" ContentType="application/vnd.ms-printing.printticket+xml"/></Types>', 'utf8'));
  zip.addFile('3D/3dmodel.model', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices>' +
    '<triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object></resources>' +
    '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>', 'utf8'));
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify(config), 'utf8'));
  mkdirp(path.dirname(outPath));
  zip.writeZip(outPath);
  return outPath;
}

function baseConfig(n) {
  const arr = (v) => new Array(n).fill(v);
  return {
    printer_settings_id: 'Bambu Lab X2D 0.4 nozzle',
    printer_model: 'Bambu Lab X2D',
    print_settings_id: '0.20mm Standard @BBL X2D (converted)',
    default_print_profile: '0.20mm Standard @BBL X2D',
    print_compatible_printers: ['Bambu Lab X2D 0.4 nozzle'],
    upward_compatible_machine: ['Bambu Lab A1 0.4 nozzle', 'Bambu Lab P2S 0.4 nozzle'],
    filament_colour: ['#000000', '#C8C8C8', '#D02727', '#FFFFFF'].slice(0, n),
    filament_type: arr('PLA'),
    filament_settings_id: arr('Bambu PLA Silk @BBL X2D 0.4 nozzle'),
    nozzle_temperature: arr('220'),
    hot_plate_temp: arr('65'),
  };
}

function readCfg(p) {
  const zip = new AdmZip(p);
  const e = zip.getEntries().find((x) => /project_settings\.config$/i.test(x.entryName));
  return JSON.parse(e.getData().toString('utf8'));
}

// ============================================================ [6] 床居中补偿
function testRecenter() {
  console.log('\n[6] 床居中补偿（A1 mini 180 → U1 270）');
  const { applyBedRecenter, recenterDelta } = require('../src/core/u1bedshift');
  const A1M = ['0x0', '180x0', '180x180', '0x180'];
  const U1 = ['0.5x1', '270.5x1', '270.5x271', '0.5x271'];

  const d = recenterDelta(A1M, U1);
  ok('每轴补 45 mm', d.dx === 45 && d.dy === 45, JSON.stringify(d));
  ok('同尺寸床不补', recenterDelta(U1, U1).dx === 0 && recenterDelta(U1, U1).dy === 0);

  const src = path.join(tmp, 'recenter-in.3mf');
  const zip = new AdmZip();
  zip.addFile('3D/3dmodel.model', Buffer.from(
    '<?xml version="1.0"?><model><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 60.5 100 -2"/></build></model>', 'utf8'));
  zip.addFile('Metadata/model_settings.config', Buffer.from(
    '<?xml version="1.0"?><config><assemble><assemble_item object_id="1" instance_id="0" ' +
    'transform="1 0 0 0 1 0 0 0 1 60.5 100 -2" offset="0 0 0"/></assemble></config>', 'utf8'));
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({ printable_area: U1 }), 'utf8'));
  zip.writeZip(src);

  const r = applyBedRecenter(fs.readFileSync(src), { srcArea: A1M, dstArea: U1 });
  ok('两个坐标源都改', r.report.applied && r.report.models === 2, JSON.stringify(r.report));
  const z2 = new AdmZip(r.buffer);
  const model = z2.readAsText('3D/3dmodel.model');
  const ms = z2.readAsText('Metadata/model_settings.config');
  ok('build item 平移 +45', model.includes('105.5 145 -2'), model.match(/transform="([^"]*)"/)[1]);
  ok('assemble 平移 +45', ms.includes('105.5 145 -2'), ms.match(/transform="([^"]*)"/)[1]);
  ok('z 轴不动', model.includes('-2') && !model.includes('43'));

  const same = applyBedRecenter(fs.readFileSync(src), { srcArea: U1, dstArea: U1 });
  ok('同尺寸床原样返回', same.report.applied === false && same.buffer.equals(fs.readFileSync(src)));
}

// ============================================================ [1] 配置后处理
function testPatch() {
  console.log('\n[1] 配置后处理');
  const src = path.join(tmp, 'patch-in.3mf');
  make3mf(src, baseConfig(4));
  const bytes = fs.readFileSync(src);

  const r = patchProjectConfig(bytes, {
    filamentPreset: '拓竹petg',
    filamentValues: {
      filament_type: ['PETG', 'PETG', 'PETG', 'PETG'],
      nozzle_temperature: ['245', '245', '245', '245'],
    },
    processPreset: '拓竹基础参数0.2',
    processValues: { layer_height: ['0.2', '0.2', '0.2', '0.2'] },
  });

  const out = path.join(tmp, 'patch-out.3mf');
  fs.writeFileSync(out, r.buffer);
  const cfg = readCfg(out);

  ok('输出仍是合法 zip 且含配置', !!cfg);
  ok('打印机兼容列表被改写为 U1',
    JSON.stringify(cfg.print_compatible_printers) === JSON.stringify(['Snapmaker U1 (0.4 nozzle)']),
    JSON.stringify(cfg.print_compatible_printers));
  ok('upward_compatible_machine 被清空',
    Array.isArray(cfg.upward_compatible_machine) && cfg.upward_compatible_machine.length === 0);
  ok('耗材预设名写入 4 槽',
    Array.isArray(cfg.filament_settings_id) && cfg.filament_settings_id.length === 4 &&
    cfg.filament_settings_id.every((x) => x === '拓竹petg'), JSON.stringify(cfg.filament_settings_id));
  ok('进程预设名写入', cfg.print_settings_id === '拓竹基础参数0.2' && cfg.default_print_profile === '拓竹基础参数0.2');
  ok('耗材参数合并生效（PETG/245）',
    cfg.filament_type.every((x) => x === 'PETG') && cfg.nozzle_temperature.every((x) => x === '245'));
  ok('进程参数合并生效（0.2）', Array.isArray(cfg.layer_height) && cfg.layer_height.every((x) => x === '0.2'));
  ok('报告记录了改写前的值', r.report.compatBefore && r.report.compatBefore[0] === 'Bambu Lab X2D 0.4 nozzle');
  ok('未改动的键保持原样', cfg.printer_model === 'Bambu Lab X2D');

  // 不传预设时也必须修兼容性——这正是网页版翻车的地方
  const r2 = patchProjectConfig(bytes, {});
  const out2 = path.join(tmp, 'patch-out2.3mf');
  fs.writeFileSync(out2, r2.buffer);
  const cfg2 = readCfg(out2);
  ok('即使不指定预设也修正兼容性',
    JSON.stringify(cfg2.print_compatible_printers) === JSON.stringify(['Snapmaker U1 (0.4 nozzle)']));
  ok('不指定预设时不改耗材名', cfg2.filament_settings_id[0] === 'Bambu PLA Silk @BBL X2D 0.4 nozzle');

  ok('槽位数按 filament_colour 推断', slotCount(baseConfig(3)) === 3);
  ok('无 filament_colour 时兜底 4', slotCount({}) === 4);

  // 源身份识别：决定「本来就是快造文件」时不必再转
  const bambuCfg = baseConfig(4);
  const u1Cfg = Object.assign(baseConfig(4), {
    printer_settings_id: 'Snapmaker U1 (0.4 nozzle)',
    printer_model: 'Snapmaker U1',
  });
  const pB = make3mf(path.join(tmp, 'id-bambu.3mf'), bambuCfg);
  const pU = make3mf(path.join(tmp, 'id-u1.3mf'), u1Cfg);
  ok('识别拓竹源身份', sourcePrinterName(pB) === 'Bambu Lab X2D 0.4 nozzle', String(sourcePrinterName(pB)));
  ok('识别快造源身份', sourcePrinterName(pU) === 'Snapmaker U1 (0.4 nozzle)', String(sourcePrinterName(pU)));

  const Cv = new U1Converter({ store: { getSettings: () => ({}) } });
  ok('拓竹文件判为需要转换', Cv.isAlreadyU1(pB) === false);
  ok('快造文件判为无需转换', Cv.isAlreadyU1(pU) === true);
  ok('非 3MF / 坏文件不误判', Cv.isAlreadyU1(path.join(tmp, 'nope.3mf')) === false);

  // 没有配置文件的包不应崩
  const noCfg = path.join(tmp, 'nocfg.3mf');
  const z = new AdmZip();
  z.addFile('3D/3dmodel.model', Buffer.from('<model/>', 'utf8'));
  z.writeZip(noCfg);
  const r3 = patchProjectConfig(fs.readFileSync(noCfg), {});
  ok('缺配置文件时安全返回', r3.report.patched === false);
}

// ============================================================ [2] 预设继承链
function testPresets() {
  console.log('\n[2] 预设继承链解析');
  const fakeOrca = path.join(tmp, 'FakeOrca');
  const sysFil = path.join(fakeOrca, 'resources', 'profiles', 'Snapmaker', 'filament');
  const sysProc = path.join(fakeOrca, 'resources', 'profiles', 'Snapmaker', 'process');
  mkdirp(sysFil);
  mkdirp(sysProc);
  fs.writeFileSync(path.join(fakeOrca, 'snapmaker-orca.exe'), '');

  const w = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1), 'utf8');
  w(path.join(sysFil, 'fdm_filament_common.json'),
    { name: 'fdm_filament_common', filament_density: ['1.24'] });
  w(path.join(sysFil, 'Snapmaker PETG HF.json'), {
    name: 'Snapmaker PETG HF',
    inherits: 'fdm_filament_common',
    filament_type: ['PETG'],
    filament_flow_support: ['standard', 'high_flow'],
    nozzle_temperature: ['245', '255'],
    filament_max_volumetric_speed: ['20', '30'],
    filament_flow_ratio: ['0.95', '0.98'],
    hot_plate_temp: ['70'],
  });
  w(path.join(sysProc, '0.20 Standard @U1.json'),
    { name: '0.20 Standard @U1', layer_height: '0.2', sparse_infill_density: '15%' });

  const appData = path.join(tmp, 'FakeAppData');
  const userFil = path.join(appData, 'Snapmaker_Orca', 'user', 'default', 'filament');
  const userProc = path.join(appData, 'Snapmaker_Orca', 'user', 'default', 'process');
  mkdirp(userFil);
  mkdirp(userProc);
  w(path.join(userFil, '拓竹petg.json'),
    { name: '拓竹petg', inherits: 'Snapmaker PETG HF', from: 'User', filament_flow_ratio: ['0.94', '0.955'] });
  w(path.join(userProc, '拓竹基础参数0.2.json'),
    { name: '拓竹基础参数0.2', inherits: '0.20 Standard @U1', from: 'User', layer_height: '0.24' });

  const oldAppData = process.env.APPDATA;
  process.env.APPDATA = appData;
  try {
    const store = {
      getSettings: () => ({ slicers: [{ name: '快造 Orca', exePath: path.join(fakeOrca, 'snapmaker-orca.exe'), enabled: true }] }),
    };
    const P = new OrcaPresets({ store });

    ok('能定位到（假的）安装目录', P.installDir() === fakeOrca, P.installDir());
    const fils = P.list('filament');
    ok('列出用户耗材预设', fils.some((x) => x.name === '拓竹petg'), JSON.stringify(fils.map((x) => x.name)));
    ok('列表不含系统预设', !fils.some((x) => x.name === 'Snapmaker PETG HF'));

    const flat = P.resolve('filament', '拓竹petg');
    ok('继承链解析到祖父层', flat && flat.filament_density && flat.filament_density[0] === '1.24');
    ok('子覆盖父（流量 0.94/0.955）',
      flat && JSON.stringify(flat.filament_flow_ratio) === JSON.stringify(['0.94', '0.955']));
    ok('保留 inherits 供展示', flat && flat.inherits === 'Snapmaker PETG HF');

    const slots = P.toSlotValues('filament', '拓竹petg', 4);
    ok('按 4 槽展开', slots && slots.filament_type.length === 4);
    ok('变体数组取标准流量而非高流量',
      slots && slots.filament_flow_ratio.every((x) => x === '0.94'), JSON.stringify(slots && slots.filament_flow_ratio));
    ok('温度取 standard 变体（245 而非 255）',
      slots && slots.nozzle_temperature.every((x) => x === '245'), JSON.stringify(slots && slots.nozzle_temperature));
    ok('单值数组广播到所有槽', slots && slots.hot_plate_temp.every((x) => x === '70'));
    ok('元信息键被排除',
      slots && !('inherits' in slots) && !('from' in slots) && !('name' in slots) && !('filament_flow_support' in slots));

    const sum = P.summary('filament', '拓竹petg');
    ok('摘要给出材料/温度', sum && sum.material === 'PETG' && sum.nozzle === '245' && sum.bed === '70', JSON.stringify(sum));

    const proc = P.toSlotValues('process', '拓竹基础参数0.2', 4);
    ok('进程预设继承并覆盖',
      proc && proc.layer_height.every((x) => x === '0.24') && proc.sparse_infill_density.every((x) => x === '15%'),
      JSON.stringify(proc && { lh: proc.layer_height, d: proc.sparse_infill_density }));

    ok('解析不存在的预设返回 null', P.resolve('filament', '不存在的预设') === null);

    // ---- 带 BOM 的系统预设：实测 0.20mm Standard @Snapmaker U1 就是 BOM 开头，
    //      旧实现 JSON.parse 失败后直接 continue，导致预设静默消失、子预设全成孤儿。
    const bomPath = path.join(sysProc, '0.20mm Standard @Snapmaker U1 (0.4 nozzle).json');
    fs.writeFileSync(bomPath, '\ufeff' + JSON.stringify({
      name: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', layer_height: '0.2', wall_loops: '2',
    }), 'utf8');
    w(path.join(userProc, '带BOM父级的预设.json'), {
      name: '带BOM父级的预设', inherits: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', from: 'User',
    });
    const P2 = new OrcaPresets({ store });   // 新实例，避开索引缓存
    const ch = P2.chain('process', '带BOM父级的预设');
    ok('BOM 开头的系统预设也能被索引', ch.missing.length === 0, JSON.stringify(ch));
    const bomFlat = P2.resolve('process', '带BOM父级的预设');
    ok('能继承到 BOM 父级的参数', bomFlat && bomFlat.wall_loops === '2', JSON.stringify(bomFlat && bomFlat.wall_loops));

    // ---- 原版 OrcaSlicer 的预设不能被读进来（本机曾同时装着两个，同名会打架）
    const orcaUser = path.join(appData, 'OrcaSlicer', 'user', 'default', 'filament');
    mkdirp(orcaUser);
    w(path.join(orcaUser, '拓竹petg.json'),
      { name: '拓竹petg', inherits: 'fdm_filament_common', from: 'User', nozzle_temperature: ['999'] });
    const P3 = new OrcaPresets({ store });
    const roots = P3.userRoots();
    ok('有快造目录时完全忽略 OrcaSlicer',
      roots.length > 0 && roots.every((r) => !/OrcaSlicer/i.test(r)), JSON.stringify(roots));
    const petg = P3.resolve('filament', '拓竹petg');
    ok('同名预设不会被原版 Orca 覆盖',
      petg && String(petg.nozzle_temperature[0]) === '245', JSON.stringify(petg && petg.nozzle_temperature));
  } finally {
    process.env.APPDATA = oldAppData;
  }
}

// ============================================================ [5] 预设保护
/**
 * 快造默认不同步用户预设（Snapmaker_Orca.conf 里 sync_user_preset=false），
 * 本机 user/default 那份就是唯一的一份。这里验证快照 / 恢复 / 体检都不出错。
 */
async function testGuard() {
  console.log('\n[5] 预设保护（快照 / 恢复 / 体检）');

  const base = path.join(tmp, 'guard');
  const fakeOrca = path.join(base, 'FakeOrca');
  const sysFil = path.join(fakeOrca, 'resources', 'profiles', 'Snapmaker', 'filament');
  const sysProc = path.join(fakeOrca, 'resources', 'profiles', 'Snapmaker', 'process');
  mkdirp(sysFil);
  mkdirp(sysProc);
  fs.writeFileSync(path.join(fakeOrca, 'snapmaker-orca.exe'), '');

  const appData = path.join(base, 'AppData');
  const root = path.join(appData, 'Snapmaker_Orca', 'user', 'default');
  const userFil = path.join(root, 'filament');
  const userProc = path.join(root, 'process');
  mkdirp(userFil);
  mkdirp(userProc);

  const w = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1), 'utf8');
  w(path.join(sysFil, '基础耗材.json'), { name: '基础耗材', filament_type: ['PETG'] });
  w(path.join(sysFil, '基础工艺.json'), { name: '基础工艺', layer_height: '0.2' });
  w(path.join(userFil, '我的耗材.json'), { name: '我的耗材', inherits: '基础耗材', from: 'User' });
  w(path.join(userFil, '我的耗材.info'), 'sync_info = create\nbase_id = X1\n');
  w(path.join(userProc, '断链工艺.json'), { name: '断链工艺', inherits: '不存在的父级', from: 'User' });

  const oldAppData = process.env.APPDATA;
  const oldData = corePaths.getDataDir();
  process.env.APPDATA = appData;
  corePaths.setDataDir(path.join(base, 'data'));
  try {
    const store = {
      getSettings: () => ({ slicers: [{ name: '快造 Orca', exePath: path.join(fakeOrca, 'snapmaker-orca.exe'), enabled: true }] }),
    };
    const P = new OrcaPresets({ store });
    const G = new PresetGuard({ store, presets: P });

    const h = G.health();
    ok('体检统计到 2 个耗材/工艺', h.counts.total === 2, JSON.stringify(h.counts));
    ok('能识别断链预设', h.broken.length === 1 && h.broken[0].name === '断链工艺',
      JSON.stringify(h.broken.map((b) => b.name)));
    ok('健康预设不误报', h.presets.find((p) => p.name === '我的耗材').ok === true);

    const s1 = G.snapshot({ reason: 'test' });
    ok('能打快照', !!s1 && s1.files === 2 && !s1.skipped, JSON.stringify(s1 && s1.files));
    ok('快照文件落盘', fs.existsSync(path.join(s1.dir, 'files', 'filament', '我的耗材.json')));
    const s2 = G.snapshot({ reason: 'test' });
    ok('内容没变不重复打快照', s2.skipped === true, String(s2.skipped));

    // 模拟「预设丢了」
    fs.unlinkSync(path.join(userFil, '我的耗材.json'));
    fs.unlinkSync(path.join(userFil, '我的耗材.info'));
    ok('删掉后体检数量变少', G.counts().filament === 0, String(G.counts().filament));

    const r = G.restore(s1.id);
    ok('恢复成功', r.ok === true, JSON.stringify(r.failed));
    ok('恢复回 1 个耗材', G.counts().filament === 1, String(G.counts().filament));
    ok('内容正确', JSON.parse(fs.readFileSync(path.join(userFil, '我的耗材.json'), 'utf8')).name === '我的耗材');
    ok('.info 也恢复了', fs.existsSync(path.join(userFil, '我的耗材.info')));
    ok('恢复前自动留了后路', !!r.safetySnapshot, String(r.safetySnapshot));

    // 恢复不能删除现有文件
    w(path.join(userFil, '恢复后新建的.json'), { name: '恢复后新建的', from: 'User' });
    G.restore(s1.id);
    ok('恢复不删除现有预设', fs.existsSync(path.join(userFil, '恢复后新建的.json')));

    // 数量变少时的提示
    fs.unlinkSync(path.join(userFil, '恢复后新建的.json'));
    const auto = G.autoSnapshot();
    ok('数量变少会给提示', !!auto.delta && /少了/.test(auto.message || ''), auto.message || '(无提示)');
  } finally {
    process.env.APPDATA = oldAppData;
    corePaths.setDataDir(oldData);
  }
}

// ============================================================ [3] 真实端到端
async function testReal() {
  console.log('\n[3] 真实端到端（需要快造 Orca + 样本文件）');
  const hasOrca = fs.existsSync(ORCA_EXE);
  const sample = resolveRealSample();
  const hasSample = !!sample;
  if (!hasOrca || !hasSample) {
    console.log('  · 跳过：' + (!hasOrca ? '未找到快造 Orca ' : '') + (!hasSample ? '未找到样本文件' : ''));
    return;
  }
  console.log('  · 样本：' + sample);

  // 耗材预设优先用用户配置的「拓竹petg」；本机没有就退到任意一个可用预设，
  // 都没有就只验证「不阻断转换 + 写名字」。避免因为换机器就整段跳过。
  const probeStore = { getSettings: () => ({ slicers: [], u1: { filamentPreset: '' } }) };
  let presetNames = [];
  try { presetNames = new U1Converter({ store: probeStore }).listFilamentPresets().map((p) => p.name); } catch (_) {}
  const presetName = presetNames.includes('拓竹petg') ? '拓竹petg' : (presetNames[0] || '');

  const store = {
    getSettings: () => ({
      slicers: [{ name: '快造 Orca', exePath: ORCA_EXE, enabled: true, isDefault: true }],
      u1: { openWith: 'ask', filamentPreset: presetName, processPreset: '', cacheKeepDays: 30 },
    }),
  };
  const C = new U1Converter({ store });
  ok('缓存目录在数据目录下', C.cacheDir().includes('u1-cache'));

  const before = fs.statSync(sample);
  const r = await C.convert(sample, { force: true });

  ok('真实转换产出文件', fs.existsSync(r.outPath), r.outPath);
  ok('产物体积合理', r.report && r.report.outputBytes > 1024 * 1024, String(r.report && r.report.outputBytes));
  ok('目标机器是 U1', r.report && r.report.printerTo === 'Snapmaker U1 (0.4 nozzle)', String(r.report && r.report.printerTo));
  ok('转换不改源文件（转换期间）',
    r.report && Math.abs(Number(r.report.sourceBytes) - before.size) < 1, String(r.report && r.report.sourceBytes));

  const cfg = readCfg(r.outPath);
  ok('产物声明 U1 兼容',
    JSON.stringify(cfg.print_compatible_printers) === JSON.stringify(['Snapmaker U1 (0.4 nozzle)']),
    JSON.stringify(cfg.print_compatible_printers));

  if (presetName) {
    ok('产物耗材指向所选预设（' + presetName + '）',
      Array.isArray(cfg.filament_settings_id) && cfg.filament_settings_id.every((x) => x === presetName),
      JSON.stringify(cfg.filament_settings_id));
    ok('预设参数已合并进产物',
      !!(r.report && r.report.patch && r.report.patch.mergedFilamentKeys > 0),
      JSON.stringify(r.report && r.report.patch));
    // 合并后机型/槽位数必须仍是 4 个工具头
    ok('四个工具头都在', Array.isArray(cfg.nozzle_diameter) && cfg.nozzle_diameter.length === 4,
      JSON.stringify(cfg.nozzle_diameter));
  } else {
    ok('没有可用预设时不阻断转换', fs.existsSync(r.outPath));
  }

  // 关键：机器/床/兼容列表/几何/源文件的完整结构校验（与命令行工具同一套判定）
  const v = verifyOutput(r.outPath, sample);
  ok('产物结构校验全通过（U1 机型 / 270 床 / 兼容列表 / 几何完整 / 源文件未动）',
    v.ok === true, JSON.stringify(v.checks));
  ok('产物没有残留 Bambu 机型', !!(v.checks && v.checks.noBambuResidue), String(v.printer && v.printer.model));

  const after = fs.statSync(sample);
  ok('源文件未被修改', before.mtimeMs === after.mtimeMs && before.size === after.size);

  const again = await C.convert(sample);
  ok('二次转换命中缓存', again.cached === true && again.outPath === r.outPath, String(again.cached));
  ok('缓存统计有计数', C.cacheStats().count >= 1);
}

// ============================================================ [4] 打开路径
/**
 * 用户报过的 bug：点「用快造 U1 打开」弹出
 *   「切片软件不可运行：…\C:\Program Files\Snapmaker_Orca」
 * 根因：detect() 每调用一次都现造随机 id，拿这个 id 回设置里查必然查不到；
 * 设置里又一个切片软件都没配时，几乎所有打开路径都会掉进这个坑。
 * 这里把它钉成回归测试——临时对象必须能用，假 id 必须给中文提示且不夹带路径。
 */
async function testOpenPath() {
  console.log('\n[4] 切片软件打开路径（不启动真实程序）');

  const dir = path.join(tmp, 'openpath');
  mkdirp(dir);

  // 一个含空格 + 中文的模型路径：验证它作为一个完整参数到达，不被 shell 拆开
  const modelPath = path.join(dir, '模型 带空格.3mf');
  fs.writeFileSync(modelPath, 'dummy');
  const dumper = path.join(dir, 'dump.js');
  fs.writeFileSync(dumper,
    'require("fs").writeFileSync(process.env.DUMP_TO, JSON.stringify(process.argv.slice(2)));', 'utf8');

  // 用独立的 store，不碰用户真实设置
  corePaths.setDataDir(path.join(dir, 'data'));
  const store = new Store({});
  await store.init();
  const slicer = new Slicer({ store });

  const argOf = (marker, ms = 4000) => waitFile(marker, ms);
  const launchArgs = (marker) => JSON.parse(fs.readFileSync(marker, 'utf8'));

  // ---- ① 临时对象：探测到但还没写进设置的切片软件
  let marker = path.join(dir, 'm1.txt');
  process.env.DUMP_TO = marker;
  const transient = {
    id: 'sl_transient_' + Date.now(),   // 故意造一个设置里绝对没有的 id
    name: '临时切片软件',
    exePath: process.execPath,
    args: '"' + dumper + '"',
    enabled: true,
    isDefault: false,
    __transient: true,
  };
  const r1 = await slicer.openPaths([modelPath], { slicer: transient });
  ok('临时对象（未写进设置）也能打开', r1.launched.length === 1 && r1.failed.length === 0,
    JSON.stringify(r1.failed));
  ok('回传的 slicerName 用临时对象的名字', r1.slicerName === '临时切片软件', String(r1.slicerName));
  ok('参数确实被传出去', !!(await argOf(marker)));
  ok('含空格/中文的路径作为单个参数到达', launchArgs(marker)[0] === modelPath,
    JSON.stringify(launchArgs(marker)));

  // ---- ② 设置里已有软件，却传了一个不存在的 id —— 必须给出可读中文，且不夹带安装路径
  const saved = await slicer.add({ name: '假切片', exePath: process.execPath, args: '"' + dumper + '"', setDefault: true });
  ok('add 之后设置里有 1 个切片软件', slicer.list().length === 1, String(slicer.list().length));
  let err = null;
  try { await slicer.open(['whatever'], { slicerId: 'sl_根本不存在' }); } catch (e) { err = e; }
  ok('不存在的 id → 中文错误', !!err && /未找到指定的切片软件/.test(err.message), err && err.message);
  ok('错误里不回显 exe 安装路径', !!err && !/[A-Za-z]:\\/.test(err.message), err && err.message);

  // ---- ③ .cmd 必须能启动（Node 20 起禁止直接 spawn .bat/.cmd，要过 cmd.exe）
  marker = path.join(dir, 'm2.txt');
  process.env.DUMP_TO = marker;
  const shim = path.join(dir, 'shim.cmd');
  fs.writeFileSync(shim, '@echo off\r\n"' + process.execPath + '" "' + dumper + '" %*\r\n', 'utf8');
  const r3 = await slicer.openPaths([modelPath], {
    slicer: { id: 'sl_cmd', name: '批处理外壳', exePath: shim, args: '' },
  });
  ok('.cmd 切片软件不再 EINVAL', r3.launched.length === 1 && r3.failed.length === 0, JSON.stringify(r3.failed));
  ok('.cmd 也把路径原样转交', !!(await argOf(marker)) && launchArgs(marker)[0] === modelPath,
    fs.existsSync(marker) ? JSON.stringify(launchArgs(marker)) : '没生成标记文件');

  // ---- ④ 一个都没有时仍然给「请先在设置中添加」
  await slicer.remove(saved.id);
  ok('remove 后设置清空', slicer.list().length === 0, String(slicer.list().length));
  let err2 = null;
  try { await slicer.openPaths([modelPath], {}); } catch (e) { err2 = e; }
  ok('零配置 → 提示去设置里添加', !!err2 && /尚未配置切片软件/.test(err2.message), err2 && err2.message);
}

// ============================================================ 主流程
(async () => {
  // 立刻把数据目录指到临时目录：testReal 会真实转换并产出 50MB+ 缓存，
  // 不隔离就会写进用户的 data/u1-cache（本文件开头承诺「绝不碰用户文件」）。
  const prevDataDir = corePaths.getDataDir();
  corePaths.setDataDir(path.join(tmp, 'data'));
  try {
    testPatch();
    testRecenter();
    testPresets();
    await testReal();
    await testOpenPath();
    await testGuard();
  } catch (e) {
    fail++;
    console.log('  ✗ 测试执行异常：' + e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  corePaths.setDataDir(prevDataDir);
  rmrf(tmp);
  if (fail > 0) process.exitCode = 1;
})();
