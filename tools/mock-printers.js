'use strict';
/**
 * 走查用假打印机：不接真机也能看到设备卡片 / 监控台的真实数据层级。
 *   node tools/mock-printers.js
 * 固定端口避免探针脚本还要互相传参：
 *   17125 Snapmaker Moonraker（打印中）
 *   14408 Creality Moonraker（暂停）
 *   18071 Anycubic Kobra 2 / OctoPrint（空闲）
 *   18898 FlashForge 5M（打印中）
 */
const http = require('http');

function serve(port, routes) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = req.url.split('?')[0];
      const out = typeof routes[p] === 'function' ? routes[p](req, body) : routes[p];
      if (out == null) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(port, '0.0.0.0');
  return server;
}

function moonraker(hostname, progress, state, filename, layer, total) {
  return {
    '/printer/info': { result: { hostname, software_version: 'v0.12.0-mock' } },
    '/server/webcams/list': { result: { webcams: [] } },
    '/printer/objects/list': { result: { objects: ['extruder', 'heater_bed', 'print_stats'] } },
    '/printer/objects/query': { result: { status: {
      print_stats: { state, filename, print_duration: 2400, total_duration: 9000 },
      virtual_sdcard: { progress, is_active: state !== 'complete' },
      extruder: { temperature: 218.4, target: 220 },
      heater_bed: { temperature: 61.2, target: 60 },
      fan: { speed: 0.72 },
      gcode_move: { speed_factor: 1 },
    } } },
    '/printer/print/pause': { result: 'ok' },
    '/printer/print/resume': { result: 'ok' },
    '/printer/print/cancel': { result: 'ok' },
    '/printer/gcode/script': { result: 'ok' },
    '/server/files/upload': { result: { item: { path: 'mock.gcode' } } },
  };
}

const S1 = serve(17125, moonraker('Snapmaker U1', 0.58, 'printing', 'gearbox_4h20m.gcode', 210, 360));
const K1 = serve(14408, moonraker('Creality K1 Max', 0.31, 'paused', 'bracket_1h50m.gcode', 88, 290));

const OP = serve(18071, {
  '/api/version': { text: 'OctoPrint 1.9.3-mock', server: '1.9.3' },
  '/api/settings': { webcam: {} },
  '/api/printer': {
    state: { text: 'Operational', flags: { printing: false, operational: true, paused: false, error: false } },
    temperature: { tool0: { actual: 28.4, target: 0 }, bed: { actual: 27.1, target: 0 } },
  },
  '/api/job': { job: { file: null }, progress: { completion: null, printTime: null, printTimeLeft: null } },
  '/api/printer/tool': { ok: true },
  '/api/printer/bed': { ok: true },
});

const FF = serve(18898, {
  '/detail': { code: 0, detail: {
    pid: '23', name: 'Adventurer 5M', status: 'printing', printFileName: 'housing_2h05m.gcode',
    printProgress: 0.42, printLayer: 96, targetPrintLayer: 228, printDuration: 3000, estimatedTime: 4200,
    rightTemp: 231.6, rightTargetTemp: 232, platTemp: 66.2, platTargetTemp: 65,
    coolingFanSpeed: 88, currentPrintSpeed: 180,
  } },
  '/control': { code: 0 },
  '/uploadGcode': { code: 0 },
});

console.log('mock printers: 17125 snapmaker / 14408 creality / 18071 octoprint / 18898 flashforge');
process.on('SIGTERM', () => { S1.close(); K1.close(); OP.close(); FF.close(); process.exit(0); });
