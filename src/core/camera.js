'use strict';
/**
 * 拓竹 A1 / A1 mini / P1P / P1S 的机内摄像头（TCP 6000，「Bambu Tunnel」协议）。
 * 纯 Node，只用内置 tls，不引入依赖。
 *
 * 协议（实测 2026-11-15，A1 系列 3DP-26A-721）：
 *   1. TLS 连接 6000（证书自签，rejectUnauthorized 必须关）
 *   2. 发 80 字节鉴权包：
 *        [0:4]   0x40            payload 长度 64
 *        [4:8]   0x3000          消息类型
 *        [8:16]  0
 *        [16:48] "bblp"          用户名，补齐 32 字节
 *        [48:80] access code     访问码，补齐 32 字节
 *      ⚠️ 用户名在前、访问码在后。写反了打印机会直接关连接，且不报错。
 *   3. 之后打印机持续推帧：16 字节头 + JPEG
 *        头 [0:3] = payload 长度（24 位小端），其余字节未用
 *        payload 以 FFD8 开头、FFD9 结尾
 *   4. 第一帧常常是缓冲里的旧画面（空闲久了可能是几分钟前的），可以用 skipFirst 丢掉；
 *      但实测 A1 约 3 秒才推一帧，「取两帧」时跳首帧会在超时前只剩半帧，
 *      所以默认**不跳**，由调用方自己权衡（见 _captureSeries 的 pushFrame）。
 *   5. **同一时间只接受一个连接**：并发时第二个连接只收到 16 字节帧头就没了，
 *      所以所有取帧都走下面的 enqueue() 串行队列 + 400ms 冷却。
 *
 * X1 / X2D / H2 系列走 RTSP 322，不在这里；A1 的 322 端口是关的。
 */
const tls = require('tls');

const DEFAULT_PORT = 6000;
const AUTH_BYTES = 80;
const HEADER_BYTES = 16;
const MAX_FRAME = 8 * 1024 * 1024;
const COOLDOWN_MS = 400;
// 只在排查协议时开启：设环境变量 CAM_DEBUG=1 才会打印帧长/帧头日志，正常运行零输出。
const DEBUG = !!process.env.CAM_DEBUG;

/** 80 字节鉴权包。公开导出便于单测校验字节布局。 */
function buildAuthPacket(accessCode) {
  const b = Buffer.alloc(AUTH_BYTES);
  b.writeUInt32LE(0x40, 0);
  b.writeUInt32LE(0x3000, 4);
  b.write('bblp', 16, 4, 'ascii');
  b.write(String(accessCode == null ? '' : accessCode), 48, 8, 'ascii');
  return b;
}

function isJpeg(buf) {
  return !!buf && buf.length > 4
    && buf[0] === 0xff && buf[1] === 0xd8
    && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
}

/**
 * 连一次，按时间点取若干帧。
 * @param {Object} o
 * @param {string} o.host       打印机 IP
 * @param {string} o.accessCode 屏幕上的访问码
 * @param {number} [o.count]    取几帧，默认 1
 * @param {number} [o.gapMs]    帧间隔，默认 0（连续取）
 * @param {number} [o.timeout]  整段超时，默认 12s
 */
function _captureSeries(o = {}) {
  const host = String(o.host || '');
  const accessCode = String(o.accessCode || '');
  const port = Number(o.port) || DEFAULT_PORT;
  const count = Math.max(1, Math.min(6, Number(o.count) || 1));
  const gapMs = Math.max(0, Number(o.gapMs) || 0);
  // 帧率低（实测约 3 秒一帧）：单帧给 12 秒，两帧给 16 秒
  const timeout = Math.max(3000, Number(o.timeout) || (count > 1 ? 16000 : 12000));
  const skipFirst = o.skipFirst === true;

  return new Promise((resolve) => {
    if (!host) return resolve({ ok: false, error: '缺少打印机地址' });
    if (!accessCode) return resolve({ ok: false, error: '缺少访问码' });

    const frames = [];
    let buf = Buffer.alloc(0);
    let needHeader = true;
    let payloadSize = 0;
    let chunks = [];
    let skipped = 0;         // 只跳第一帧（缓冲区里的旧画面）
    let dropUntil = 0;       // 间隔取帧窗口
    let settled = false;
    let sock = null;
    let timer = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch (_) { /* 已关闭 */ }
      if (err) resolve({ ok: false, error: err });
      else resolve({ ok: true, frames });
    };

    const pushFrame = (jpg) => {
      if (DEBUG) console.log('[cam] frame', jpg.length, 'jpeg=', isJpeg(jpg), 'skipFirst=', skipFirst, 'have=', frames.length);
      if (!isJpeg(jpg)) return;
      // 默认**不跳**第一帧：实测这台约 3 秒才推一帧，跳掉它 12 秒内就只剩半帧。
      // 需要「跳过缓冲旧图」的调用方显式传 skipFirst。
      if (skipFirst && skipped === 0) { skipped = 1; return; }
      if (Date.now() < dropUntil) return;
      frames.push(jpg);
      if (frames.length >= count) return finish();
      dropUntil = Date.now() + gapMs;
    };

    const onData = (d) => {
      if (DEBUG) console.log('[cam] d', d.length, 'flowing=', sock.readableFlowing, 'paused=', sock.isPaused && sock.isPaused());
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (settled) return;
        if (needHeader) {
          if (buf.length < HEADER_BYTES) return;
          payloadSize = buf.readUIntLE(0, 3);
          buf = buf.subarray(HEADER_BYTES);
          needHeader = false;
          chunks = [];
          if (DEBUG) console.log('[cam] hdr', payloadSize);
          if (payloadSize <= 0 || payloadSize > MAX_FRAME) {
            return finish('摄像头返回了异常帧长度');
          }
        }
        let got = 0;
        for (const c of chunks) got += c.length;
        const remain = payloadSize - got;
        if (buf.length < remain) {
          if (buf.length) chunks.push(buf);
          buf = Buffer.alloc(0);
          return;
        }
        chunks.push(buf.subarray(0, remain));
        buf = buf.subarray(remain);
        const jpg = Buffer.concat(chunks);
        needHeader = true;
        chunks = [];
        pushFrame(jpg);
      }
    };

    try {
      sock = tls.connect({ host, port, rejectUnauthorized: false });
    } catch (e) {
      return resolve({ ok: false, error: '无法连接摄像头端口' });
    }

    timer = setTimeout(() => finish('摄像头超时（可能是访问码错误，或该机型不支持局域网取流）'), timeout);

    sock.on('secureConnect', () => {
      if (DEBUG) console.log('[cam] secure');
      try { sock.write(buildAuthPacket(accessCode)); } catch (_) { finish('发送鉴权失败'); }
    });

    sock.on('data', onData);

    sock.on('error', (e) => {
      const code = e && e.code;
      if (code === 'ECONNREFUSED') return finish('摄像头端口未开放（该机型可能不支持局域网取流）');
      if (code === 'EHOSTUNREACH' || code === 'ETIMEDOUT') return finish('打印机连不上');
      finish('摄像头连接中断');
    });

    sock.on('close', () => {
      if (!settled) finish(frames.length ? null : '摄像头没有返回画面');
    });
  });
}

/**
 * 打印机 6000 端口同一时间只接受一个连接，上一个断开后还要等它释放。
 * 实时预览（2 秒一张）和「检测」很容易撞在一起，所以全部走单一队列 + 400ms 冷却。
 */
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  const cooldown = () => new Promise((r) => setTimeout(r, COOLDOWN_MS));
  chain = run.then(cooldown, cooldown);
  return run;
}

function captureSeries(o = {}) {
  return enqueue(() => _captureSeries(o));
}

function captureFrame(o = {}) {
  return captureSeries(Object.assign({}, o, { count: 1, gapMs: 0 }));
}

/**
 * 抓两帧，供「打印机检测」使用。函数默认间隔 5 秒；
 * IPC 的 cameraDetect 显式传 gapMs: 3000，因为摄像头约 3 秒一帧，
 * 按 5 秒间隔两帧要 10~14 秒，按钮的 10 秒倒计时会显得卡住。
 */
function captureTwo(o = {}) {
  return captureSeries(Object.assign({ count: 2, gapMs: 5000 }, o));
}

// HTTP 取帧（快造 U1 / 自填地址）放在 camera-http.js，这里统一转出，
// 调用方只需要 require('../src/core/camera') 一个入口。
const httpCam = require('./camera-http');

module.exports = {
  buildAuthPacket, isJpeg, captureSeries, captureFrame, captureTwo, DEFAULT_PORT,
  httpFrame: httpCam.httpFrame,
  snapmakerFrame: httpCam.snapmakerFrame,
  snapmakerTwo: httpCam.snapmakerTwo,
  snapmakerLiveFrame: httpCam.snapmakerLiveFrame,
  snapmakerLiveTwo: httpCam.snapmakerLiveTwo,
  firstJpeg: httpCam.firstJpeg,
};
