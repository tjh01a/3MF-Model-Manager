'use strict';
/**
 * 设备适配器与发现层的最小验证。
 * 不起真实打印机：用本地 HTTP mock 复现各品牌已知响应，验证解析、状态机与命令路径。
 *   node tests/device-adapter-tests.js
 */
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalog = require('../src/core/device-catalog');
const { mergeRecords, parseServiceName, parseSsdp } = require('../src/core/discovery');
const MoonrakerAdapter = require('../src/core/adapters/moonraker');
const OctoPrintAdapter = require('../src/core/adapters/octoprint');
const FlashForgeAdapter = require('../src/core/adapters/flashforge');
const BambuAdapter = require('../src/core/adapters/bambu');
const AnycubicAdapter = require('../src/core/adapters/anycubic');
const { decryptInfo } = require('../src/core/adapters/anycubic');

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
async function okAsync(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

function serve(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      const pathname = req.url.split('?')[0];
      const handler = routes[pathname];
      const out = typeof handler === 'function' ? handler(req, body) : handler;
      if (out == null) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }));
  });
}

(async () => {
  console.log('[1] 品牌注册与 BETA 规则');
  ok('五家品牌都已注册', () => {
    for (const k of ['anycubic', 'creality', 'bambu', 'snapmaker', 'flashforge']) {
      assert.ok(catalog.BRANDS[k], k + ' 未注册');
      assert.ok(catalog.BRANDS[k].defaultPort > 0);
    }
  });
  ok('仅 Anycubic / Creality / FlashForge 标 BETA', () => {
    assert.strictEqual(catalog.isBeta('anycubic'), true);
    assert.strictEqual(catalog.isBeta('creality'), true);
    assert.strictEqual(catalog.isBeta('flashforge'), true);
    assert.strictEqual(catalog.isBeta('bambu'), false);
    assert.strictEqual(catalog.isBeta('snapmaker'), false);
  });
  ok('BETA 说明文字符合要求', () => {
    assert.ok(catalog.BETA_NOTE.includes('未经过实机验证'));
    assert.ok(catalog.BETA_NOTE.includes('公开资料'));
  });
  ok('从服务名推断品牌', () => {
    assert.strictEqual(catalog.inferBrand('Snapmaker U1._moonraker._tcp.local'), 'snapmaker');
    assert.strictEqual(catalog.inferBrand('Creality K1 Max'), 'creality');
  });

  console.log('\n[2] 协议发现：mDNS / SSDP / 合并去重');
  ok('解析 mDNS 服务实例名', () => {
    const r = parseServiceName('Snapmaker U1._moonraker._tcp.local');
    assert.strictEqual(r.instance, 'Snapmaker U1');
    assert.strictEqual(r.service, '_moonraker._tcp');
  });
  ok('解析 Bambu SSDP 头', () => {
    const r = parseSsdp('HTTP/1.1 200 OK\r\nST: urn:bambulab-com:device:3dprinter:1\r\nUSN: 01S00C123456789\r\nLocation: 192.168.1.77\r\n\r\n');
    assert.strictEqual(r.st, 'urn:bambulab-com:device:3dprinter:1');
    assert.strictEqual(r.usn, '01S00C123456789');
    assert.strictEqual(r.location, '192.168.1.77');
  });
  ok('同 IP 多来源合并成一条，来源去重', () => {
    const list = mergeRecords([
      { host: '192.168.1.50', kind: 'creality', sources: ['mdns'], confidence: 'medium', port: 7125 },
      { host: '192.168.1.50', kind: 'creality', sources: ['port'], confidence: 'high', port: 7125, firmware: 'v1.3' },
      { host: '192.168.1.51', kind: 'unknown', sources: ['ssdp'], confidence: 'low' },
    ]);
    assert.strictEqual(list.length, 2);
    const c = list.find((x) => x.host === '192.168.1.50');
    assert.strictEqual(c.confidence, 'high');
    assert.deepStrictEqual(c.sources.sort(), ['mdns', 'port']);
    assert.strictEqual(c.firmware, 'v1.3');
  });
  ok('Bambu 缺访问码时不允许自动连接', () => {
    const r = mergeRecords([{ host: '192.168.1.60', kind: 'bambu', sources: ['ssdp'], confidence: 'high', port: 8883 }])[0];
    assert.strictEqual(r.autoConnect, false);
  });

  console.log('\n[3] Moonraker（快造 / 创想 K 系列）');
  const mk = await serve({
    '/server/info': { result: { hostname: 'Snapmaker U1', software_version: 'v0.12.0' } },
    '/printer/info': { result: { hostname: 'Snapmaker U1', software_version: 'v0.12.0' } },
    '/server/webcams/list': { result: [] },
    '/printer/objects/list': { result: { objects: ['extruder', 'heater_bed', 'print_stats'] } },
    '/printer/objects/query': { result: { status: {
      print_stats: { state: 'printing', filename: 'cube_2h10m.gcode', print_duration: 1800, total_duration: 9000 },
      virtual_sdcard: { progress: 0.42, is_active: true },
      extruder: { temperature: 214.4, target: 215 },
      heater_bed: { temperature: 60.2, target: 60 },
      fan: { speed: 0.65 },
      gcode_move: { speed_factor: 1.25 },
    } } },
    '/printer/print/pause': { result: 'ok' },
    '/printer/print/resume': { result: 'ok' },
    '/printer/print/cancel': { result: 'ok' },
    '/printer/gcode/script': { result: 'ok' },
    '/server/files/upload': { result: { item: { path: 'cube.gcode' } } },
  });
  const mkA = new MoonrakerAdapter({ id: 'mk1', kind: 'snapmaker', ip: '127.0.0.1', port: mk.port, name: 'U1' });
  await okAsync('连接并归一化打印中状态', async () => {
    const st = await mkA.getStatus();
    assert.strictEqual(st.online, true);
    assert.strictEqual(st.state, 'printing');
    assert.strictEqual(st.stateText, '打印中');
    assert.strictEqual(st.job.percent, 42);
    assert.strictEqual(st.job.remainingMin, 75); // 文件名 2h10m × 58%
    assert.strictEqual(st.temps.nozzle.cur, 214.4);
    assert.strictEqual(st.temps.bed.cur, 60.2);
    assert.strictEqual(st.fan, 65);
    assert.strictEqual(st.speed, 125);
    assert.strictEqual(st.beta, false);
  });
  await okAsync('暂停 / 继续 / 停止命中正确 URL', async () => {
    await mkA.pause();
    await mkA.resume();
    await mkA.stop();
    const paths = mk.seen.map((x) => x.url.split('?')[0]);
    assert.ok(paths.includes('/printer/print/pause'));
    assert.ok(paths.includes('/printer/print/resume'));
    assert.ok(paths.includes('/printer/print/cancel'));
  });
  await okAsync('温度设定下发 M104/M140', async () => {
    await mkA.setTemperature(220, 65);
    const post = mk.seen.filter((x) => x.url === '/printer/gcode/script').pop();
    assert.ok(post);
    assert.ok(post.body.includes('M104 S220'));
    assert.ok(post.body.includes('M140 S65'));
  });
  await okAsync('上传 gcode 并带 print=true', async () => {
    const f = path.join(os.tmpdir(), 'printshelf-device-test.gcode');
    fs.writeFileSync(f, 'G28\nG1 X10 Y10\n');
    try {
      const r = await mkA.sendJob(f, { start: true });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.started, true);
      const post = mk.seen.filter((x) => x.url === '/server/files/upload').pop();
      assert.ok(post, '没有发出上传请求');
      assert.ok(post.body.includes('printshelf-device-test.gcode'));
      assert.ok(post.body.includes('name="print"') && post.body.includes('true'));
    } finally { try { fs.unlinkSync(f); } catch (_) { /* 忽略 */ } }
  });
  await okAsync('Creality K1 使用同一适配器时带 BETA', async () => {
    const a = new MoonrakerAdapter({ id: 'cr1', kind: 'creality', ip: '127.0.0.1', port: mk.port });
    const st = await a.getStatus();
    assert.strictEqual(st.beta, true);
    assert.strictEqual(st.brandLabel, '创想三维 Creality');
  });
  mk.server.close();

  console.log('\n[4] OctoPrint / Anycubic Kobra 2 兼容口');
  const op = await serve({
    '/api/version': { text: 'OctoPrint 1.9.3', server: '1.9.3' },
    '/api/settings': { webcam: {} },
    '/api/printer': {
      state: { text: 'Printing', flags: { printing: true, operational: true, paused: false, error: false } },
      temperature: { tool0: { actual: 209.4, target: 210 }, bed: { actual: 59.8, target: 60 } },
    },
    '/api/job': { job: { file: { display: 'kobra-test.gcode', name: 'kobra-test.gcode' } }, progress: { completion: 37.5, printTime: 1200, printTimeLeft: 2400 } },
    '/api/job_pause': { ok: true },
    '/api/printer/tool': { ok: true },
    '/api/printer/bed': { ok: true },
  });
  const opA = new OctoPrintAdapter({ id: 'op1', kind: 'anycubic', adapter: 'octoprint', ip: '127.0.0.1', port: op.port, name: 'Kobra 2' });
  await okAsync('连接并归一化，Job 字段映射到统一结构', async () => {
    const st = await opA.getStatus();
    assert.strictEqual(st.state, 'printing');
    assert.strictEqual(st.job.percent, 38);
    assert.strictEqual(st.job.name, 'kobra-test.gcode');
    assert.strictEqual(st.job.remainingMin, 40);
    assert.strictEqual(st.temps.nozzle.cur, 209.4);
    assert.strictEqual(st.beta, true);
  });
  await okAsync('暂停命令体为 pause/pause', async () => {
    await opA.pause();
    const post = op.seen.filter((x) => x.method === 'POST' && x.url === '/api/job').pop();
    const body = JSON.parse(post.body);
    assert.strictEqual(body.command, 'pause');
    assert.strictEqual(body.action, 'pause');
  });
  await okAsync('温度目标分别写到 tool0 与 bed', async () => {
    await opA.setTemperature(215, 62);
    const tool = JSON.parse(op.seen.filter((x) => x.url === '/api/printer/tool').pop().body);
    const bed = JSON.parse(op.seen.filter((x) => x.url === '/api/printer/bed').pop().body);
    assert.strictEqual(tool.targets.tool0, 215);
    assert.strictEqual(bed.target, 62);
  });
  op.server.close();

  console.log('\n[5] FlashForge HTTP');
  const ff = await serve({
    '/detail': {
      code: 0,
      detail: {
        pid: '23', name: 'Adventurer 5M', status: 'printing', printFileName: 'benchy.gcode',
        printProgress: 0.55, printLayer: 120, targetPrintLayer: 220,
        printDuration: 900, estimatedTime: 1500,
        rightTemp: 229.6, rightTargetTemp: 230, platTemp: 64.2, platTargetTemp: 65,
        coolingFanSpeed: 80, currentPrintSpeed: 150, errorCode: '',
      },
    },
    '/control': { code: 0 },
    '/uploadGcode': { code: 0 },
  });
  const ffA = new FlashForgeAdapter({ id: 'ff1', kind: 'flashforge', ip: '127.0.0.1', port: ff.port, serial: 'SN123', accessCode: 'CHECK' });
  await okAsync('连接、型号识别与状态归一化', async () => {
    const st = await ffA.getStatus();
    assert.strictEqual(st.state, 'printing');
    assert.strictEqual(st.model, 'Adventurer 5M');
    assert.strictEqual(st.job.percent, 55);
    assert.strictEqual(st.job.remainingMin, 25);
    assert.strictEqual(st.temps.nozzle.cur, 229.6);
    assert.strictEqual(st.fan, 80);
    assert.strictEqual(st.beta, true);
  });
  await okAsync('暂停 / 继续 / 停止使用 jobCtl_cmd', async () => {
    await ffA.pause();
    await ffA.resume();
    await ffA.stop();
    const bodies = ff.seen.filter((x) => x.url === '/control').map((x) => JSON.parse(x.body));
    assert.deepStrictEqual(bodies.map((b) => b.payload.args.action), ['pause', 'continue', 'cancel']);
    assert.ok(bodies.every((b) => b.serialNumber === 'SN123' && b.checkCode === 'CHECK'));
  });
  await okAsync('温度设定走 temperatureCtl_cmd 的 rightNozzle/platform', async () => {
    await ffA.setTemperature(235, 70);
    const b = JSON.parse(ff.seen.filter((x) => x.url === '/control').pop().body);
    assert.strictEqual(b.payload.args.rightNozzle, 235);
    assert.strictEqual(b.payload.args.platform, 70);
  });
  ff.server.close();

  console.log('\n[6] Anycubic 原生 MQTT 报文解密');
  ok('AES-128-CBC 固定向量可还原 broker 参数', () => {
    const token = 'abcdefghijklmnop0123456789ABCDEF';
    const localToken = '0123456789abcdef';
    const plain = { broker: 'mqtts://192.168.1.88:9883', username: 'dev', password: 'p', deviceId: 'D1' };
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(token.slice(16, 32)), Buffer.from(localToken));
    const enc = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]).toString('base64');
    assert.deepStrictEqual(decryptInfo(enc, token, localToken), plain);
  });
  ok('Kobra 3 状态报文映射进度 / 温度 / 风扇', () => {
    const a = new AnycubicAdapter({ id: 'ac1', kind: 'anycubic', ip: '192.168.1.90', port: 18910 });
    a.cache = {
      info: {
        state: 'printing', printerName: 'Kobra 3', model: 'Kobra 3',
        project: { state: 'printing', filename: 'part.gcode', progress: 44, remain_time: 35, print_time: 12, current_layer: 30, total_layers: 80 },
        temp: { curr_nozzle_temp: 221.2, target_nozzle_temp: 225, curr_hotbed_temp: 61.1, target_hotbed_temp: 60, curr_chamber_temp: 32 },
      },
      temp: { curr_nozzle_temp: 223.4, target_nozzle_temp: 225, curr_hotbed_temp: 62.2, target_hotbed_temp: 60 },
      fan: { fan_speed_pct: 77 },
      print: { progress: 44, remain_time: 35, print_time: 12, filename: 'part.gcode', current_layer: 30, total_layers: 80 },
    };
    const st = a.normalize();
    assert.strictEqual(st.state, 'printing');
    assert.strictEqual(st.job.percent, 44);
    assert.strictEqual(st.job.remainingMin, 35);
    assert.strictEqual(st.temps.nozzle.cur, 223.4);
    assert.strictEqual(st.temps.nozzle.target, 225);
    assert.strictEqual(st.temps.chamber.cur, 32);
    assert.strictEqual(st.fan, 77);
    assert.strictEqual(st.beta, true);
  });

  console.log('\n[7] Bambu 状态归一化（沿用已实测的 MQTT 通道）');
  ok('RUNNING 报文映射进度 / 温度 / 风扇', () => {
    const a = new BambuAdapter({ id: 'bb1', kind: 'bambu', ip: '192.168.1.9', serial: 'S1', accessCode: '12345678' });
    a.state = { print: {
      gcode_state: 'RUNNING', subtask_name: 'gear.3mf', mc_percent: 63, mc_remaining_time: 88,
      layer_num: 40, total_layer_num: 120, nozzle_temper: 219.5, nozzle_target_temper: 220,
      bed_temper: 55, bed_target_temper: 55, cooling_fan_speed: ['70'], machine_name: 'P1S',
    } };
    const st = a.normalize();
    assert.strictEqual(st.state, 'printing');
    assert.strictEqual(st.job.name, 'gear.3mf');
    assert.strictEqual(st.job.percent, 63);
    assert.strictEqual(st.job.remainingMin, 88);
    assert.strictEqual(st.temps.nozzle.cur, 219.5);
    assert.strictEqual(st.fan, 70);
    assert.strictEqual(st.beta, false);
  });

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
