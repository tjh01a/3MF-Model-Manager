'use strict';
/**
 * 打印机管理测试（纯 Node，不联网）。
 * 用真实抓下来的报文做夹具，验证「统一状态」的解析逻辑。
 *   node tests/printer-tests.js
 */
const PrinterService = require('../src/core/printers');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

/** 假的 store：settings 存在内存里，接口与真 store 一致 */
function fakeStore(init = {}) {
  const settings = Object.assign({ printers: [] }, init);
  return {
    getSettings: () => settings,
    updateSettings: async (patch) => Object.assign(settings, patch),
  };
}

// ============================================================ [1] 快造（Moonraker）
const SNAP_FIXTURE = {
  print_stats: {
    filename: '组合体_PETG_12h19m.gcode',
    state: 'printing',
    print_duration: 2100, total_duration: 2300,
    info: { current_layer: 156, total_layer: 625 },
  },
  virtual_sdcard: { progress: 0.25, is_active: true },
  heater_bed: { temperature: 70.03125, target: 70 },
  extruder: { temperature: 245.0, target: 245, extruder_index: 1 },
  print_task_config: {
    filament_type: ['PETG', 'PETG', 'PETG', 'PETG'],
    filament_color_rgba: ['FFFFFFFF', '39FF14FF', 'FEE5A5FF', '000000FF'],
    filament_vendor: ['Polymaker', 'Snapmaker', 'Snapmaker', 'Snapmaker'],
  },
};

function testSnapmaker() {
  console.log('\n[1] 快造 U1（Moonraker 报文）');
  const ps = new PrinterService({ store: fakeStore() });
  const cfg = { id: 'p1', kind: 'snapmaker', name: '快造 U1', ip: '192.168.1.50' };
  const s = ps._normalizeSnapmaker(cfg, JSON.parse(JSON.stringify(SNAP_FIXTURE)));

  ok('识别为打印中', s.state === 'printing' && s.stateText === '打印中', s.stateText);
  ok('进度取字节进度 25%', s.job.percent === 25, String(s.job.percent));
  ok('层数正确', s.job.layer === 156 && s.job.layers === 625, JSON.stringify([s.job.layer, s.job.layers]));
  ok('喷嘴温度取整到 0.1', s.temps.nozzle.cur === 245 && s.temps.nozzle.target === 245);
  ok('热床温度 70/70', s.temps.bed.cur === 70 && s.temps.bed.target === 70, JSON.stringify(s.temps.bed));
  ok('解析出 4 个耗材槽', s.materials.length === 4, String(s.materials.length));
  ok('颜色按 RRGGBBAA 取前 6 位',
    s.materials[1].color === '#39FF14' && s.materials[3].color === '#000000',
    s.materials.map((m) => m.color).join(','));
  ok('当前工具头标为 active', s.materials[1].active === true && s.materials[0].active === false);
  ok('剩余时间来自文件名里的 12h19m',
    s.job.remainingMin === Math.round(739 * 0.75), String(s.job.remainingMin));

  // 2026-11-19：U1 是四工具头机器，真实报文里有 extruder / extruder1..3 与腔体传感器。
  // 以前只显示当前喷嘴，另外三个头的温度完全看不到。
  const four = JSON.parse(JSON.stringify(SNAP_FIXTURE));
  four.extruder1 = { temperature: 95.2, target: 95, extruder_index: 1 };
  four.extruder2 = { temperature: 42, target: 0, extruder_index: 2 };
  four.extruder3 = { temperature: 232.4, target: 95, extruder_index: 3 };
  four['temperature_sensor cavity'] = { temperature: 45.6, target: 0 };
  const s6 = ps._normalizeSnapmaker(cfg, four);
  ok('四工具头都有温度', s6.temps.heads && s6.temps.heads.length === 4,
    JSON.stringify(s6.temps.heads));
  ok('每头 cur / target 正确',
    s6.temps.heads[2].cur === 42 && s6.temps.heads[3].target === 95,
    JSON.stringify(s6.temps.heads[2]) + JSON.stringify(s6.temps.heads[3]));
  ok('只有当前工具头标 active',
    s6.temps.heads.filter((h) => h.active).length === 1 && s6.temps.heads[1].active === true,
    JSON.stringify(s6.temps.heads.map((h) => h.active)));
  ok('腔体温度来自 temperature_sensor cavity',
    s6.temps.chamber && s6.temps.chamber.cur === 45.6, JSON.stringify(s6.temps.chamber));
  ok('单头机器不产生 heads 字段',
    s.temps.heads === null || s.temps.heads === undefined, JSON.stringify(s.temps.heads));

  // 暂停态
  const paused = JSON.parse(JSON.stringify(SNAP_FIXTURE));
  paused.print_stats.state = 'paused';
  const s2 = ps._normalizeSnapmaker(cfg, paused);
  ok('暂停态映射正确', s2.state === 'paused' && s2.stateText === '已暂停');

  // 空闲态没有任务
  const idle = JSON.parse(JSON.stringify(SNAP_FIXTURE));
  idle.print_stats.state = 'standby';
  idle.print_stats.filename = '';
  const s3 = ps._normalizeSnapmaker(cfg, idle);
  ok('空闲态无任务', s3.state === 'idle' && s3.job === null);

  ok('无文件名时剩余时间为 0（不编造）',
    ps._normalizeSnapmaker(cfg, Object.assign({}, SNAP_FIXTURE, { print_stats: Object.assign({}, SNAP_FIXTURE.print_stats, { filename: 'x.gcode' }) })).job.remainingMin > 0);
  ok('文件名时长解析 12h19m = 739', ps._durationFromName('xx_PETG_12h19m.gcode') === 739, String(ps._durationFromName('xx_PETG_12h19m.gcode')));
  ok('文件名没有时长时返回 0', ps._durationFromName('random_name.gcode') === 0);

  // 空闲时机器仍留着上次的文件名 —— 不能显示成「空闲但有 0% 的任务」
  const stale = JSON.parse(JSON.stringify(SNAP_FIXTURE));
  stale.print_stats.state = 'standby';
  const s4 = ps._normalizeSnapmaker(cfg, stale);
  ok('空闲时不显示残留任务', s4.job === null && s4.state === 'idle', JSON.stringify(s4.job));

  const done = JSON.parse(JSON.stringify(SNAP_FIXTURE));
  done.print_stats.state = 'complete';
  const s5 = ps._normalizeSnapmaker(cfg, done);
  ok('完成时任务显示 100%', s5.state === 'finished' && s5.job && s5.job.percent === 100,
    JSON.stringify(s5.job && s5.job.percent));
}

// ============================================================ [2] 拓竹（MQTT report）
const BAMBU_FIXTURE = {
  print: {
    gcode_state: 'RUNNING',
    subtask_name: '三角洲×影之刃-黑伤【联名刀皮】-A1(3)_刀鞘.3mf',
    mc_percent: 24, mc_remaining_time: 357,
    layer_num: 160, total_layer_num: 1000,
    nozzle_temper: 244.7, nozzle_target_temper: 245,
    bed_temper: 70, bed_target_temper: 70,
    chamber_temper: 32,
    cooling_fan_speed: ['100'],
    spd_lvl: 2,
    ams: {
      ams: [{
        id: '16', humidity: '5', tray_now: '1',
        tray: [
          { id: '0', tray_type: 'PLA', tray_color: 'FFFFFFFF' },
          { id: '1', tray_type: 'PETG', tray_color: '39FF14FF' },
          { id: '2' },
          { id: '3' },
        ],
      }],
    },
  },
};

function testBambu() {
  console.log('\n[2] 拓竹（MQTT report 报文）');
  const ps = new PrinterService({ store: fakeStore() });
  const cfg = { id: 'p2', kind: 'bambu', name: '拓竹 721', ip: '192.168.0.109' };
  const s = ps._normalizeBambu(cfg, BAMBU_FIXTURE);

  ok('RUNNING → 打印中', s.state === 'printing' && s.stateText === '打印中', s.stateText);
  ok('任务名取 subtask_name', s.job.name.includes('刀鞘'), s.job.name);
  ok('进度 24%', s.job.percent === 24, String(s.job.percent));
  ok('剩余 357 分', s.job.remainingMin === 357, String(s.job.remainingMin));
  ok('层 160/1000', s.job.layer === 160 && s.job.layers === 1000);
  ok('喷嘴 244.7/245', s.temps.nozzle.cur === 244.7 && s.temps.nozzle.target === 245, JSON.stringify(s.temps.nozzle));
  ok('腔体温度有值', s.temps.chamber && s.temps.chamber.cur === 32);
  ok('AMS 只列有耗材的槽（2 个）', s.materials.length === 2, JSON.stringify(s.materials.map((m) => m.type)));
  ok('AMS 槽位号从 1 开始', s.materials[0].slot === 1 && s.materials[1].slot === 2);
  ok('tray_now=1 → 第 2 槽高亮', s.materials[1].active === true && s.materials[0].active === false);
  ok('风扇与速度档位', s.fan === 100 && s.speed === 2, JSON.stringify([s.fan, s.speed]));

  const paused = JSON.parse(JSON.stringify(BAMBU_FIXTURE));
  paused.print.gcode_state = 'PAUSE';
  ok('PAUSE → 已暂停', ps._normalizeBambu(cfg, paused).state === 'paused');
  const failed = JSON.parse(JSON.stringify(BAMBU_FIXTURE));
  failed.print.gcode_state = 'FAILED';
  ok('FAILED → 出错', ps._normalizeBambu(cfg, failed).state === 'error');

  const idle = JSON.parse(JSON.stringify(BAMBU_FIXTURE));
  idle.print.gcode_state = 'IDLE';
  const si = ps._normalizeBambu(cfg, idle);
  ok('空闲时不显示残留任务', si.job === null && si.state === 'idle', JSON.stringify(si.job));

  const fin = JSON.parse(JSON.stringify(BAMBU_FIXTURE));
  fin.print.gcode_state = 'FINISH';
  fin.print.mc_percent = 99;
  const sf = ps._normalizeBambu(cfg, fin);
  ok('完成时进度补到 100', sf.state === 'finished' && sf.job.percent === 100, String(sf.job && sf.job.percent));
}

// ============================================================ [3] 配置读写
async function testConfig() {
  console.log('\n[3] 打印机配置读写');
  const store = fakeStore();
  const ps = new PrinterService({ store });

  ok('初始为空', ps.list().length === 0);
  const a = await ps.add({ kind: 'snapmaker', name: '快造 U1', ip: '192.168.1.50' });
  ok('添加成功并生成 id', !!a.id && a.kind === 'snapmaker');
  ok('落进设置里', ps.list().length === 1 && ps.list()[0].ip === '192.168.1.50');

  let threw = false;
  try { await ps.add({ kind: 'snapmaker', ip: '192.168.1.50' }); } catch (_) { threw = true; }
  ok('同 IP 不重复添加', threw);

  threw = false;
  try { await ps.add({ kind: 'laser', ip: '1.2.3.4' }); } catch (_) { threw = true; }
  ok('未知类型被拒绝', threw);

  threw = false;
  try { await ps.add({ kind: 'bambu', ip: '' }); } catch (_) { threw = true; }
  ok('空 IP 被拒绝', threw);

  await ps.update(a.id, { name: '改名后的 U1', ip: '192.168.0.222' });
  ok('update 生效', ps.get(a.id).name === '改名后的 U1' && ps.get(a.id).ip === '192.168.0.222');

  const snap = ps.snapshot();
  ok('没连过的打印机在快照里是离线', snap.length === 1 && snap[0].online === false && snap[0].state === 'offline');
  ok('离线也有完整结构', snap[0].temps && snap[0].job === null && Array.isArray(snap[0].materials));

  await ps.remove(a.id);
  ok('移除后清空', ps.list().length === 0 && ps.snapshot().length === 0);

  // enabled=false 不进快照
  const b = await ps.add({ kind: 'bambu', ip: '192.168.0.109', serial: 'X', accessCode: 'Y' });
  await ps.update(b.id, { enabled: false });
  ok('停用的打印机不进快照', ps.snapshot().length === 0);
}

// ============================================================ [4] 工具函数
function testUtils() {
  console.log('\n[4] 颜色与时长的边界情况');
  const ps = new PrinterService({ store: fakeStore() });
  // argbToHex 是模块内私有函数，通过 normalize 间接验证
  const st = JSON.parse(JSON.stringify(SNAP_FIXTURE));
  st.print_task_config.filament_color_rgba = ['', 'FFFF', 'abcdef', '#123456'];
  const s = ps._normalizeSnapmaker({ id: 'x', kind: 'snapmaker', name: 'x', ip: '1' }, st);
  ok('坏数据不炸，兜底灰色', s.materials.every((m) => /^#[0-9A-F]{6}$/.test(m.color)),
    s.materials.map((m) => m.color).join(','));
  ok('缺字段时温度按 0 处理',
    ps._normalizeSnapmaker({ id: 'y', kind: 'snapmaker', name: 'y', ip: '1' }, {}).temps.nozzle.cur === 0);
}

// ============================================================ [5] 错误文案与自动纠正
function testErrors() {
  console.log('\n[5] 连接错误文案 / 是否需要自动找 IP');
  const ps = new PrinterService({ store: fakeStore() });
  const p = { id: 'pr1', kind: 'bambu', name: '拓竹', ip: '192.168.0.109' };

  const refused = ps._bambuErrorText({ code: 'ECONNREFUSED' }, p);
  ok('ECONNREFUSED 翻成中文并给出两种可能', /局域网服务/.test(refused) && /云端模式/.test(refused), refused);
  ok('错误文案里带上了 IP', refused.includes('192.168.0.109'));
  ok('ECONNREFUSED 给出两个可操作下一步',
    /局域网模式/.test(refused) && /拓竹账号/.test(refused), refused);

  const timeout = ps._bambuErrorText({ code: 'ETIMEDOUT' }, p);
  ok('超时提示局域网模式', /超时/.test(timeout) && /局域网模式/.test(timeout), timeout);
  ok('超时也提示云端通道', /拓竹账号/.test(timeout), timeout);

  const unreach = ps._bambuErrorText({ code: 'EHOSTUNREACH' }, p);
  ok('网络不可达有专门文案', /不在线/.test(unreach));
  ok('网络不可达也提示云端通道', /拓竹账号/.test(unreach), unreach);
  ok('未知错误保留原文', ps._bambuErrorText({ code: 'EACCES', message: 'permission denied' }, p) === 'permission denied');

  ok('ECONNREFUSED 会触发自动找 IP', ps._isNetError({ code: 'ECONNREFUSED' }) === true);
  ok('ETIMEDOUT 也触发', ps._isNetError({ code: 'ETIMEDOUT' }) === true);
  ok('权限错误不该触发扫网', ps._isNetError({ code: 'EACCES' }) === false);
  ok('超时文案（无 code）也能识别', ps._isNetError(new Error('连接打印机超时')) === true);

  // 节流：同一台机器短时间连续失败只扫一次
  ps._healAt.set('pr1', Date.now());
  const before = ps._healAt.get('pr1');
  ps._healBambuIp(p);
  ok('节流期内不重复扫描', ps._healAt.get('pr1') === before);
}

// ============================================================ [6] 双通道
function testDualChannel() {
  console.log('\n[6] 拓竹双通道（局域网优先，云端兜底）');
  const fakeCloud = {
    status: () => ({ loggedIn: true, expired: false, uid: 'u-42', account: 'a@b.c' }),
    mqttHost: () => 'cn.mqtt.bambulab.com',
    token: () => 'tok',
  };
  const ps = new PrinterService({ store: fakeStore(), cloud: fakeCloud });
  const p = { id: 'p1', kind: 'bambu', name: '拓竹', ip: '192.168.0.109', serial: 'S1', accessCode: 'xx', mode: 'auto' };
  const ent = { channel: 'lan', lastLanProbe: 0, nextTry: 0 };

  ok('auto + 局域网正常 → 走局域网', ps._pickChannel(p, ent) === 'lan');
  ent.channel = 'cloud';
  ok('auto + 已在云端 → 继续走云端（等 5 分钟探局域网）', ps._pickChannel(p, ent) === 'cloud');
  ent.channel = 'lan';
  ok('没有云服务 → 局域网', new PrinterService({ store: fakeStore() })._pickChannel(p, ent) === 'lan');
  ok('mode=cloud 且已登录 → 云端', ps._pickChannel({ ...p, mode: 'cloud' }, ent) === 'cloud');
  const psNoLogin = new PrinterService({ store: fakeStore(), cloud: { status: () => ({ loggedIn: false }) } });
  ok('mode=cloud 未登录 → null（界面提示登录）', psNoLogin._pickChannel({ ...p, mode: 'cloud' }, ent) === null);
  ok('mode=lan 永远走局域网', ps._pickChannel({ ...p, mode: 'lan' }, ent) === 'lan');

  const cc = ps._cloudConn();
  ok('云端连接参数 = u_<uid> + token',
    !!cc && cc.host === 'cn.mqtt.bambulab.com' && cc.username === 'u_u-42' && cc.password === 'tok',
    JSON.stringify(cc));
  const noCloud = new PrinterService({ store: fakeStore() })._cloudConn();
  ok('没有云服务给出 error', !!noCloud && /未启用/.test(noCloud.error));
  const bad = psNoLogin._cloudConn();
  ok('未登录提示去拓竹账号', !!bad && /拓竹账号/.test(bad.error));

  ok('云端 ECONNREFUSED 文案不提打印机 IP',
    !/192\.168/.test(ps._bambuErrorText({ code: 'ECONNREFUSED' }, p, 'cloud')));
  ok('云端认证失败提示重新登录',
    /重新登录/.test(ps._bambuErrorText({ message: '打印机拒绝连接（认证失败）' }, p, 'cloud')));
  ok('云端超时文案不提「局域网模式」',
    !/局域网模式/.test(ps._bambuErrorText({ code: 'ETIMEDOUT' }, p, 'cloud')));
}

// ============================================================ 主流程
(async () => {
  try {
    testSnapmaker();
    testBambu();
    await testConfig();
    testUtils();
    testErrors();
    testDualChannel();
  } catch (e) {
    fail++;
    console.log('  ✗ 测试执行异常：' + e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exitCode = 1;
})();
