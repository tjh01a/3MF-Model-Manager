'use strict';
/**
 * 摄像头取帧测试（纯 Node，本地起 HTTP 服务，不碰真机）。
 *   node tests/camera-tests.js
 *
 * 覆盖：
 *   · firstJpeg 能从 multipart 里截出完整帧
 *   · httpFrame 支持 image/jpeg 快照
 *   · httpFrame 支持 MJPEG（连接不结束，也必须在第一帧后返回）
 *   · 非 JPEG / 404 有可读错误
 *   · snapmakerFrame 在填了 cameraUrl 时走 URL（source=url）
 */
const http = require('http');
const {
  firstJpeg, httpFrame, snapmakerFrame, resolveUrl, snapmakerLiveFrame,
} = require('../src/core/camera-http');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

// 一个结构合法的最小 JPEG（SOI ... EOI），只要能被 firstJpeg 认出来即可
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF-printshelf-test', 'ascii'),
  Buffer.from([0xff, 0xd9]),
]);

function startServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/snap.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': JPEG.length });
      res.end(JPEG);
      return;
    }
    if (url === '/stream.mjpg') {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      const push = () => {
        res.write('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + JPEG.length + '\r\n\r\n');
        res.write(JPEG);
        res.write('\r\n');
      };
      push();
      // 故意不结束：真实的 MJPEG 就是长连接
      const t = setInterval(push, 800);
      req.on('close', () => clearInterval(t));
      return;
    }
    if (url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>not a camera</html>');
      return;
    }
    res.writeHead(404);
    res.end('nope');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  console.log('\n[1] 协议解析');
  const wrapped = Buffer.concat([
    Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'),
    JPEG,
    Buffer.from('\r\n--frame--'),
  ]);
  ok('firstJpeg 从 multipart 截出第一帧', firstJpeg(wrapped) && firstJpeg(wrapped).equals(JPEG));
  ok('firstJpeg 对非 JPEG 返回 null', firstJpeg(Buffer.from('hello')) === null);
  ok('resolveUrl 相对路径补成绝对地址',
    resolveUrl('/webcam/?action=snapshot', '192.168.0.9') === 'http://192.168.0.9:7125/webcam/?action=snapshot');
  ok('resolveUrl 绝对地址原样返回',
    resolveUrl('http://10.0.0.2:8080/a.jpg', '192.168.0.9') === 'http://10.0.0.2:8080/a.jpg');

  const { server, port } = await startServer();
  const base = 'http://127.0.0.1:' + port;
  try {
    console.log('\n[2] HTTP 取帧');
    const snap = await httpFrame(base + '/snap.jpg', 4000);
    ok('快照：ok 且拿到 1 帧', snap.ok && snap.frames.length === 1, JSON.stringify(snap).slice(0, 120));
    ok('快照：内容与源一致', snap.ok && snap.frames[0].equals(JPEG));

    const t0 = Date.now();
    const stream = await httpFrame(base + '/stream.mjpg', 4000);
    const ms = Date.now() - t0;
    ok('MJPEG：连接不结束也能返回', stream.ok && stream.frames.length === 1, JSON.stringify(stream).slice(0, 120));
    ok('MJPEG：第一帧就返回（不等超时）', ms < 2500, ms + 'ms');

    const notCam = await httpFrame(base + '/page', 3000);
    ok('非 JPEG 地址给出可读错误', !notCam.ok && /不是 JPEG/.test(notCam.error || ''), notCam.error);

    const missing = await httpFrame(base + '/missing', 3000);
    ok('404 说明是 HTTP 错误', !missing.ok && /HTTP 404/.test(missing.error || ''), missing.error);

    console.log('\n[3] 快造取帧入口');
    const viaUrl = await snapmakerFrame({ host: '127.0.0.1', cameraUrl: base + '/snap.jpg' });
    ok('填了 cameraUrl 就走 URL', viaUrl.ok && viaUrl.source === 'url', JSON.stringify(viaUrl).slice(0, 120));

    const bad = await snapmakerFrame({ host: '', cameraUrl: base + '/snap.jpg' });
    ok('缺地址时给出中文错误', !bad.ok && /缺少打印机地址/.test(bad.error || ''), bad.error);

    console.log('\n[4] U1 静态快照的新鲜度判定');
    // 模拟一台 monitor.jpg 停更 2 小时的 U1：旧图不能被当成「刚刚拍的实时画面」
    const state = {
      modified: Math.floor(Date.now() / 1000) - 7200,
      jpg: JPEG,
    };
    const fakeMk = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/server/webcams/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: { webcams: [] } }));
      } else if (url === '/server/files/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: [{ path: 'monitor.jpg', modified: state.modified, size: state.jpg.length }] }));
      } else if (url === '/server/files/camera/monitor.jpg') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': state.jpg.length });
        res.end(state.jpg);
      } else {
        res.writeHead(404); res.end('nope');
      }
    });
    await new Promise((r) => fakeMk.listen(0, '127.0.0.1', r));
    try {
      const mkPort = fakeMk.address().port;
      const opts = { host: '127.0.0.1', port: mkPort };
      const old = await snapmakerFrame(opts);
      ok('首次抓到旧图：标为静态快照', old.ok && old.static === true, JSON.stringify(old).slice(0, 140));
      ok('首次抓到旧图：staleSec 按文件时间算', old.ok && old.staleSec > 7000, 'staleSec=' + (old && old.staleSec));

      const again = await snapmakerFrame(opts);
      ok('同一张旧图再抓：staleSec 不会归零',
        again.ok && again.staleSec > 7000, 'staleSec=' + (again && again.staleSec));

      state.jpg = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
        Buffer.from('JFIF-printshelf-test-2', 'ascii'),
        Buffer.from([0xff, 0xd9]),
      ]);
      const fresh = await snapmakerFrame(opts);
      ok('内容变了：按刚拍到算新鲜', fresh.ok && fresh.static === true && fresh.staleSec < 5,
        'staleSec=' + (fresh && fresh.staleSec));
    } finally {
      await new Promise((r) => fakeMk.close(r));
    }

    console.log('\n[5] U1 主动抓拍（G-code → 即时照片）');
    let gcode = '', deleted = 0, served = 0;
    const liveMk = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (req.method === 'POST' && url === '/printer/gcode/script') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          gcode = body;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: 'ok' }));
        });
      } else if (req.method === 'GET' && /^\/server\/files\/gcodes\/pictures\/pic_.*\.jpg$/.test(url)) {
        served++;
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': JPEG.length });
        res.end(JPEG);
      } else if (req.method === 'DELETE' && /^\/server\/files\/gcodes\/pictures\//.test(url)) {
        deleted++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: { action: 'delete_file' } }));
      } else {
        res.writeHead(404); res.end('nope');
      }
    });
    await new Promise((r) => liveMk.listen(0, '127.0.0.1', r));
    try {
      const livePort = liveMk.address().port;
      const t0 = Date.now();
      const shot = await snapmakerLiveFrame({ host: '127.0.0.1', port: livePort });
      ok('主动抓拍返回实时画面', shot.ok && shot.source === 'u1-live' && shot.frames[0].equals(JPEG),
        JSON.stringify(shot).slice(0, 140));
      ok('发了 TIMELAPSE_TAKE_FRAME DEBUG=1', /TIMELAPSE_TAKE_FRAME DEBUG=1/.test(gcode), gcode);
      ok('抓完把临时照片删掉', deleted === 1, 'deleted=' + deleted);
      ok('抓拍耗时合理（<5 秒）', Date.now() - t0 < 5000, (Date.now() - t0) + 'ms');

      const cached = await snapmakerLiveFrame({ host: '127.0.0.1', port: livePort });
      ok('节流窗口内复用上一张', cached.ok && cached.cached === true && served === 1,
        JSON.stringify(cached).slice(0, 140));
    } finally {
      await new Promise((r) => liveMk.close(r));
    }
  } finally {
    server.close();
  }

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
