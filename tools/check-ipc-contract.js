'use strict';
/**
 * IPC 契约一致性哨兵。
 *
 * preload.js 的 METHODS 白名单、renderer/api.js 的 METHODS、ipc/index.js 的 handlers
 * 三处必须一一对应；事件白名单 EVENTS 也必须和 api.js 的转发对应。
 * 以前手工同步漏过一个方法时，症状是「界面点了没反应、控制台报 method not found」，
 * 很难从现象倒查。这里做成可复跑的一步，挂在 npm run selftest 末尾。
 *
 *   node tools/check-ipc-contract.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function listBlock(src, name) {
  const start = src.indexOf('const ' + name + ' = [');
  if (start < 0) throw new Error('找不到 ' + name + ' 数组');
  const end = src.indexOf('];', start);
  if (end < 0) throw new Error(name + ' 数组没有结束');
  return Array.from(src.slice(start, end).matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function handlerKeys(src) {
  const start = src.indexOf('const handlers = {');
  const end = src.indexOf('\n  };', start);
  if (start < 0 || end < 0) throw new Error('找不到 handlers 对象');
  // 只取 4 空格缩进的顶层键；嵌套对象字面量缩进更深，不会被误抓
  return Array.from(src.slice(start, end).matchAll(/^    ([A-Za-z0-9_]+)\s*:/gm)).map((m) => m[1]);
}

/**
 * 静态扫描主进程「实际发给渲染层」的 channel。
 * 以前只比名称集合，main.js / services.js 里 webContents.send / emitToRenderer
 * 发出但 preload EVENTS 没放行的 channel 不会被发现（渲染层订阅了也收不到）。
 * 这里只抓字符串字面量；bridgeEvents 里的变量 channel 由 services 侧的
 * emitToRenderer 字面量覆盖，不会漏。
 */
function sentChannels(...srcs) {
  const out = new Set();
  for (const src of srcs) {
    for (const m of src.matchAll(/\bwebContents\.send\(\s*['"]([\w:.\-]+)['"]/g)) out.add(m[1]);
    for (const m of src.matchAll(/\bemitToRenderer\(\s*['"]([\w:.\-]+)['"]/g)) out.add(m[1]);
  }
  return Array.from(out).sort();
}

const preload = read('electron/preload.js');
const api = read('src/renderer/js/api.js');
const ipc = read('electron/ipc/index.js');
const main = read('electron/main.js');
const services = read('electron/services.js');

const preMethods = listBlock(preload, 'METHODS');
const apiMethods = listBlock(api, 'METHODS');
const handlers = handlerKeys(ipc);
const events = listBlock(preload, 'EVENTS');
// api.js 里显式订阅的 channel（含循环数组里的字符串）
const forwarded = new Set(Array.from(api.matchAll(/on\('([^']+)'/g)).map((m) => m[1]));
for (const m of api.matchAll(/for \(const ch of \[([^\]]+)\]\)/g)) {
  for (const q of m[1].matchAll(/'([^']+)'/g)) forwarded.add(q[1]);
}

let bad = 0;
function check(label, missing, extra) {
  if (!missing.length && !extra.length) {
    console.log('  ✓ ' + label);
    return;
  }
  bad++;
  console.log('  ✗ ' + label);
  if (missing.length) console.log('      缺失：' + missing.join(', '));
  if (extra.length) console.log('      多出：' + extra.join(', '));
}
const diff = (a, b) => [a.filter((x) => !b.includes(x)), b.filter((x) => !a.includes(x))];

console.log('\n[IPC 契约]');
check('preload METHODS ↔ ipc handlers', ...diff(preMethods, handlers));
check('api METHODS ↔ preload METHODS', ...diff(apiMethods, preMethods));
// app:ready 由 preload 自己消费（whenReady），不需要 api.js 再转发
const needForward = events.filter((e) => e !== 'app:ready');
check('preload EVENTS ↔ api 转发', ...diff(needForward, Array.from(forwarded)));
// 主进程实际发送的 channel 必须都在 preload EVENTS 白名单里
const sent = sentChannels(main, services, ipc);
check('主进程 send/emit channel ⊂ preload EVENTS', sent.filter((c) => !events.includes(c)), []);
console.log('  方法 ' + handlers.length + ' 个 · 事件 ' + events.length + ' 个 · 主进程发送 ' + sent.length + ' 个 channel');
console.log(bad ? '\n  契约不一致，请同步三处白名单。' : '\n  契约一致。');
if (bad) process.exitCode = 1;
