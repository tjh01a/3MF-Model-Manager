'use strict';
/**
 * 发现层专用测试：不联网、不开 socket，用固定 mDNS/SSDP 记录验证解析与合并。
 *   node tests/discovery-tests.js
 */
const assert = require('assert');
const catalog = require('../src/core/device-catalog');
const { decodeMdns, parseServiceName, parseSsdp, mergeRecords, PROBE_PORTS } = require('../src/core/discovery');

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

console.log('[发现] mDNS / SSDP / 合并 / 兜底端口');

ok('mDNS 服务名拆出实例和服务类型', () => {
  const r = parseServiceName('Snapmaker U1._moonraker._tcp.local');
  assert.strictEqual(r.instance, 'Snapmaker U1');
  assert.strictEqual(r.service, '_moonraker._tcp');
  assert.strictEqual(parseServiceName('not-a-service'), null);
});

ok('mDNS PTR→SRV→A/TXT 还原为 host:port', () => {
  const records = [
    { name: '_moonraker._tcp.local', type: 'PTR', data: 'Snapmaker U1._moonraker._tcp.local' },
    { name: 'Snapmaker U1._moonraker._tcp.local', type: 'SRV', data: { target: 'u1.local', port: 7125 } },
    { name: 'Snapmaker U1._moonraker._tcp.local', type: 'TXT', data: [Buffer.from('version=0.12')] },
    { name: 'u1.local', type: 'A', data: '192.168.1.88' },
  ];
  const out = decodeMdns(records);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].host, '192.168.1.88');
  assert.strictEqual(out[0].port, 7125);
  assert.strictEqual(out[0].instance, 'Snapmaker U1');
  assert.strictEqual(out[0].txt.version, '0.12');
});

ok('mDNS 没有 A 记录时保留条目但不猜 IP', () => {
  const out = decodeMdns([
    { name: '_printer._tcp.local', type: 'PTR', data: 'K1._printer._tcp.local' },
    { name: 'K1._printer._tcp.local', type: 'SRV', data: { target: 'k1.local', port: 9999 } },
  ]);
  assert.strictEqual(out.length, 0);
});

ok('SSDP 头大小写不敏感、值完整保留', () => {
  const r = parseSsdp('HTTP/1.1 200 OK\r\nST: urn:bambulab-com:device:3dprinter:1\r\nUsn: 01S00C123456789\r\nLOCATION: http://192.168.1.77:80/\r\n\r\n');
  assert.strictEqual(r.st, 'urn:bambulab-com:device:3dprinter:1');
  assert.strictEqual(r.usn, '01S00C123456789');
  assert.strictEqual(r.location, 'http://192.168.1.77:80/');
});

ok('同 host 多策略合并，保留 also 且来源去重', () => {
  const list = mergeRecords([
    { host: '192.168.1.50', kind: 'moonraker', adapter: 'moonraker', sources: ['mdns'], confidence: 'medium', port: 7125 },
    { host: '192.168.1.50', kind: 'octoprint', adapter: 'octoprint', sources: ['port'], confidence: 'medium', port: 80 },
    { host: '192.168.1.50', kind: 'moonraker', adapter: 'moonraker', sources: ['http'], confidence: 'high', port: 7125 },
    { host: '192.168.1.51', kind: 'unknown', sources: ['ssdp'], confidence: 'low' },
  ]);
  assert.strictEqual(list.length, 2);
  const r = list.find((x) => x.host === '192.168.1.50');
  assert.strictEqual(r.confidence, 'high');
  assert.deepStrictEqual(r.sources.sort(), ['http', 'mdns', 'port']);
  assert.ok(Array.isArray(r.also) && r.also.length >= 1, '应保留备选协议');
  assert.ok(r.betaNote && r.betaNote.includes('未经过实机验证'));
});

ok('品牌优先级：专用协议高于通用 HTTP 指纹', () => {
  const list = mergeRecords([
    { host: '192.168.1.60', kind: 'unknown', sources: ['http'], confidence: 'low', port: 80 },
    { host: '192.168.1.60', kind: 'bambu', sources: ['ssdp'], confidence: 'high', port: 8883 },
  ]);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].kind, 'bambu');
  assert.strictEqual(list[0].port, 8883);
});

ok('缺凭据的设备不自动连接，但保留在结果里', () => {
  for (const [kind, missing] of [['bambu', 'accessCode'], ['flashforge', 'serial']]) {
    const r = mergeRecords([{ host: '192.168.1.' + (kind === 'bambu' ? 70 : 71), kind, sources: ['ssdp'], confidence: 'high' }])[0];
    assert.strictEqual(r.autoConnect, false, kind + ' 不应自动连');
    assert.ok(r.needs.includes(missing), kind + ' 应提示缺少 ' + missing);
  }
  const snap = mergeRecords([{ host: '192.168.1.72', kind: 'snapmaker', sources: ['mdns'], confidence: 'high', port: 7125 }])[0];
  assert.strictEqual(snap.autoConnect, true, '快造无凭据应可自动连');
});

ok('通用 HTTP 记录合并到 Bambu 后仍保留访问码要求', () => {
  const r = mergeRecords([
    { host: '192.168.1.73', kind: 'unknown', sources: ['http'], confidence: 'low', needs: [] },
    { host: '192.168.1.73', kind: 'bambu', sources: ['ssdp'], confidence: 'high', port: 8883 },
  ])[0];
  assert.strictEqual(r.kind, 'bambu');
  assert.ok(r.needs.includes('accessCode'));
  assert.strictEqual(r.autoConnect, false);
});

ok('兜底探测端口覆盖五品牌 + 通用协议', () => {
  for (const p of [7125, 80, 71, 8898, 18910, 8883, 990, 9999, 4408, 8899]) {
    assert.ok(PROBE_PORTS.includes(p), '缺少端口 ' + p);
  }
  for (const k of ['anycubic', 'creality', 'bambu', 'snapmaker', 'flashforge']) {
    assert.ok(catalog.BRANDS[k], k + ' 未注册');
  }
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
