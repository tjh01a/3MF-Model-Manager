'use strict';
/**
 * G · 以图搜图单测（docs/22 G）
 * dHash 是纯函数；索引用临时文件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ImageHashIndex, dhashFromGray, grayFromBitmap, hamming } = require('../src/core/imghash');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际 ' + JSON.stringify(a) + '）'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-imghash-'));
const file = path.join(tmp, 'img-hash.json');

function makeGray(variant) {
  const g = new Uint8Array(72);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    if (variant === 'flat') g[y * 9 + x] = 128;
    else if (variant === 'h') g[y * 9 + x] = x * 28;
    else if (variant === 'v') g[y * 9 + x] = y * 32;
    else g[y * 9 + x] = (x + y) % 2 ? 255 : 0;
  }
  return g;
}

(async () => {
  console.log('\n[1] dHash 基本性质');
  const h1 = dhashFromGray(makeGray('h'));
  ok(/^[0-9a-f]{16}$/.test(h1), '输出 16 位十六进制（64bit）');
  eq(hamming(h1, h1), 0, '同图距离 0');
  const flat = dhashFromGray(makeGray('flat'));
  eq(flat, 'ffffffffffffffff', '纯色：左 >= 右，全 1');
  const inv = dhashFromGray(makeGray('inv'));
  ok(hamming(h1, inv) > 0, '不同图距离大于 0');
  ok(hamming('bad', h1) === 64, '非法长度视为最远');

  console.log('\n[2] 位图转灰度');
  // 2×1 的纯红：BGRA 与 RGBA 两种通道序都应得到相近灰度
  const bgra = new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255]);   // B=0,G=0,R=255
  const rgba = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]);
  const gb = grayFromBitmap(bgra, 2, 1, { channels: 4, order: 'bgra' });
  const gr = grayFromBitmap(rgba, 2, 1, { channels: 4, order: 'rgba' });
  ok(Math.abs(gb[0] - gr[0]) <= 1, 'BGRA/RGBA 灰度一致（容差 1）');
  ok(gb[0] > 70, '红色亮度合理：' + gb[0]);

  console.log('\n[3] 索引：写入 / 查询 / 删除 / 持久化');
  const idx = new ImageHashIndex(file);
  await idx.set('a', h1);
  await idx.set('b', dhashFromGray(makeGray('v')));
  await idx.set('c', '0000000000000000');
  eq(idx.size(), 3, '三条');
  const near = idx.nearest(h1, 10, 12);
  eq(near[0].id, 'a', '查询自己排第一');
  eq(near[0].distance, 0, '距离 0');
  ok(near.every((x) => x.distance <= 12), '阈值过滤生效');
  const limited = idx.nearest(h1, 1, 64);
  eq(limited.length, 1, 'limit 生效');
  await idx.prune(['a', 'b']);
  ok(!idx.has('c'), 'prune 删掉无效 id');
  await idx.flush();

  const idx2 = new ImageHashIndex(file);
  ok(idx2.has('a') && idx2.has('b') && !idx2.has('c'), '重新加载后索引保持');
  await idx2.remove(['a']);
  eq(idx2.size(), 1, 'remove 生效');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n────────────────────────────');
  console.log('以图搜图测试：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { failures.forEach((f) => console.log('  · ' + f)); process.exit(1); }
})();

