'use strict';
/**
 * 通用摄像头取帧（HTTP）：快造 U1 与「自己填地址」的机器都走这里。
 *
 * 为什么单独一个文件：camera.js 是拓竹 TCP 6000 的协议实现（80 字节鉴权包、
 * 帧头解析），逻辑完全不同；混在一起会让两边都难改。
 *
 * U1 的画面来源有两条，按优先级：
 *   1) 用户在设备「编辑」里显式填的摄像头地址（快照或 MJPEG 流）
 *   2) Moonraker 配置过的 webcam（/server/webcams/list 里的 snapshot_url）
 *   3) 出厂 camera 目录里的 monitor.jpg（U1 打印时自己写的实时快照）
 *
 * 第 3 条是实测确认的（2026-11-19，U1 192.168.1.50）：
 *   /server/files/list?root=camera → monitor.jpg，JPEG 58 KB；
 *   若文件 mtime 明显落后于当前时间，说明画面是旧的，用 staleSec 如实告诉界面。
 */
const http = require('http');
const https = require('https');

const MAX_SNAPSHOT = 12 * 1024 * 1024;
// 最近一帧内容缓存：U1 的 monitor.jpg 偶尔「内容更新了但 modified 没变」，
// 只看时间戳会把实时画面误判成几小时前的旧图。用内容是否变化来定新鲜度。
const LAST_FRAME = new Map();   // key -> { buf, at }
const MAX_CACHE = 8;
// 探测失败的候选地址缓存 60 秒，避免每 1.2 秒都去撞一遍 502
const FAILED_URLS = new Map();  // url -> 失败截止时间(ms)
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

/** 从 MJPEG 流里截出第一帧完整 JPEG；纯快照则原样返回 */
function firstJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  const start = buf.indexOf(JPEG_SOI);
  if (start < 0) return null;
  const end = buf.indexOf(JPEG_EOI, start + 2);
  if (end < 0) return null;
  return buf.subarray(start, end + 2);
}

/**
 * 取一个 HTTP 地址的一帧。
 * 支持 image/jpeg 快照与 multipart/x-mixed-replace（MJPEG）：
 * MJPEG 不会结束，读到第一帧的 FFD9 就主动断开。
 */
function httpFrame(url, timeout = 8000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(String(url)); } catch (_) { return resolve({ ok: false, error: '摄像头地址格式不对：' + url }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return resolve({ ok: false, error: '摄像头地址只支持 http / https' });
    }
    const mod = u.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const req = mod.get({
      host: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      timeout,
      rejectUnauthorized: false,
      headers: { Accept: 'image/jpeg, multipart/x-mixed-replace, */*' },
    }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return done({ ok: false, error: '摄像头返回 HTTP ' + res.statusCode });
      }
      const ct = String(res.headers['content-type'] || '');
      const isMjpeg = /multipart|x-mixed-replace/i.test(ct);
      const chunks = [];
      let size = 0;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        const all = Buffer.concat(chunks);
        const jpg = isMjpeg ? firstJpeg(all) : (firstJpeg(all) || null);
        try { req.destroy(); } catch (_) { /* 已断开 */ }
        if (!jpg) return done({ ok: false, error: '这个地址返回的不是 JPEG 画面' });
        done({ ok: true, frames: [jpg], contentType: ct });
      };

      res.on('data', (c) => {
        chunks.push(c);
        size += c.length;
        if (size > MAX_SNAPSHOT) { finish(); return; }
        if (isMjpeg && Buffer.concat(chunks).indexOf(JPEG_EOI) > 2) finish();
      });
      res.on('end', finish);
      res.on('error', () => done({ ok: false, error: '摄像头连接中断' }));
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch (_) { /* 忽略 */ }
      done({ ok: false, error: '摄像头超时（' + Math.round(timeout / 1000) + ' 秒）' });
    });
    req.on('error', (e) => done({ ok: false, error: '连不上摄像头：' + e.message }));
  });
}

/** 绝对化 Moonraker 返回的相对 snapshot_url */
function resolveUrl(raw, host, port = 7125) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return 'http://' + host + ':' + port + s;
  return 'http://' + host + ':' + port + '/' + s;
}

/**
 * 快造 U1 取一帧。
 * @param {{host:string, cameraUrl?:string, port?:number}} o
 * @returns {Promise<{ok:boolean, frames?:Buffer[], staleSec?:number, source?:string, error?:string}>}
 */
async function snapmakerFrame(o = {}) {
  const host = String(o.host || '');
  const port = Number(o.port) || 7125;
  if (!host) return { ok: false, error: '缺少打印机地址' };

  // 1) 用户显式填的地址优先
  if (o.cameraUrl) {
    const r = await httpFrame(o.cameraUrl);
    return r.ok ? { ok: true, frames: r.frames, source: 'url', staleSec: 0 } : r;
  }

  const Moonraker = require('./moonraker');
  const mk = new Moonraker({ host, port });

  // 2) Moonraker 里配置过的 webcam（同时认 snapshot_url 与 stream_url）
  try {
    const cams = await mk.webcams();
    const cam = cams.find((c) => c && (c.snapshot_url || c.stream_url));
    if (cam) {
      const url = resolveUrl(cam.snapshot_url || cam.stream_url, host, port);
      const r = await httpFrame(url);
      if (r.ok) return { ok: true, frames: r.frames, source: 'moonraker-webcam', staleSec: 0 };
    }
  } catch (_) { /* 没配 webcam 是常态，继续走候选地址 */ }

  // 3) 常见 mjpg-streamer 地址。U1 机器里的 /webcam/ 常被 nginx 反代到未启动的
  //    摄像头服务（502），但用户可能在固件里打开过，试试总比一直拿旧图好。
  for (const url of [
    'http://' + host + '/webcam/?action=snapshot',
    'http://' + host + '/webcam/?action=stream',
    'http://' + host + ':8080/?action=snapshot',
    'http://' + host + ':8080/?action=stream',
  ]) {
    if ((FAILED_URLS.get(url) || 0) > Date.now()) continue;
    const r = await httpFrame(url, 3500);
    if (r.ok) return { ok: true, frames: r.frames, source: 'url', staleSec: 0, url };
    FAILED_URLS.set(url, Date.now() + 60000);
  }

  // 4) camera/monitor.jpg（U1 写的静态快照，可能停更）
  try {
    const files = (await mk.cameraFiles()).filter((f) => /\.jpe?g$/i.test(String(f.path || '')));
    if (!files.length) return { ok: false, error: '打印机上没有找到摄像头画面（camera 目录为空）' };
    const preferred = files.find((f) => /monitor\.jpg$/i.test(f.path)) || files[0];
    const r = await mk.fileBuffer(preferred.path);
    const jpg = firstJpeg(r.buffer);
    if (!jpg) return { ok: false, error: '取到的文件不是 JPEG 画面' };

    const key = host + '|' + preferred.path;
    const prev = LAST_FRAME.get(key);
    const now = Date.now();
    const fileAt = Number(preferred.modified || 0) * 1000;
    const fileAtOk = fileAt > 0 && fileAt <= now + 60000;
    const first = !prev;
    const changed = !prev || !prev.buf.equals(jpg);
    LAST_FRAME.set(key, { buf: jpg, at: now });
    if (LAST_FRAME.size > MAX_CACHE) LAST_FRAME.delete(LAST_FRAME.keys().next().value);

    // 新鲜度不能只看「这次和上次字节是否一样」：
    //   · 首次抓到一张 4 小时前的黑图，若按 now 算就会显示 0 秒，用户误以为是实时；
    //   · 文件 mtime 在部分固件上不更新，但内容会变，这时又不能只信 mtime。
    // 规则：首次抓取 → 信文件 mtime；内容变了 → 信这次抓取；内容没变 → 信文件 mtime。
    let lastAt;
    if (first) lastAt = fileAtOk ? fileAt : now;
    else if (changed) lastAt = now;
    else lastAt = fileAtOk ? fileAt : prev.at;
    const ageSec = Math.max(0, Math.round((now - lastAt) / 1000));
    return {
      ok: true, frames: [jpg], source: 'moonraker-camera',
      staleSec: ageSec, static: true, path: preferred.path,
    };
  } catch (e) {
    return { ok: false, error: '取摄像头画面失败：' + ((e && e.message) || String(e)) };
  }
}

/** 检测用：间隔 gapMs 抓两张（U1 快照可能不刷新，staleSec 会告诉界面） */
async function snapmakerTwo(o = {}) {
  const gap = Math.max(1000, Number(o.gapMs) || 3000);
  const a = await snapmakerFrame(o);
  if (!a.ok) return a;
  await new Promise((r) => setTimeout(r, gap));
  const b = await snapmakerFrame(o);
  if (!b.ok) return b;
  return {
    ok: true, frames: [a.frames[0], b.frames[0]],
    staleSec: b.staleSec || 0, source: b.source, static: !!b.static,
  };
}

// ---------------------------------------------------------------------------
// U1 主动抓拍：解决「monitor.jpg 停更导致黑图」的根本办法
//
// 固件源码（Snapmaker/u1-klipper 的 extras/timelapse.py）里有一条 G-code：
//   TIMELAPSE_TAKE_FRAME DEBUG=1
// 它会通过 MQTT 调 camera.take_a_photo，让摄像头服务**当场拍一张**，写到
//   /userdata/gcodes/pictures/pic_<YYYYMMDD_HHMMSS>.jpg
// 这张文件能用 Moonraker 的 /server/files/gcodes/pictures/... 读到，读完再删掉。
//
// 实测（2026-11-19，U1 192.168.1.50）：
//   POST /printer/gcode/script {"script":"TIMELAPSE_TAKE_FRAME DEBUG=1"} → ok
//   约 500ms 后 pic_20261119_145747.jpg 出现，89 KB 的当帧 JPEG；DELETE 可清除。
// 这条路径不启动延时摄影、不改打印机设置，也不会暂停当前打印。
// ---------------------------------------------------------------------------

const LIVE = new Map();        // host:port -> { buf, at }，节流用
const LIVE_MIN_MS = 15000;     // 15 秒最多拍一张，避免长期占用打印机 eMMC
const LIVE_WAIT_MS = 1100;     // 摄像头服务通常在 500ms 内回包，留足余量

function stamp(d, utc) {
  const p = (n) => String(n).padStart(2, '0');
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utc ? d.getUTCDate() : d.getDate();
  const h = utc ? d.getUTCHours() : d.getHours();
  const mi = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  return String(y) + p(mo) + p(day) + '_' + p(h) + p(mi) + p(s);
}

/**
 * 主动抓一张 U1 的实时画面。失败时返回 ok:false，调用方再退回静态快照。
 * 节流期间返回上一张并带上真实年龄，界面不会突然跳回那张旧黑图。
 */
async function snapmakerLiveFrame(o = {}) {
  const host = String(o.host || '');
  const port = Number(o.port) || 7125;
  if (!host) return { ok: false, error: '缺少打印机地址' };
  const key = host + ':' + port;
  const now = Date.now();
  const prev = LIVE.get(key);

  if (prev && now - prev.at < LIVE_MIN_MS) {
    return {
      ok: true, frames: [prev.buf], source: 'u1-live',
      staleSec: Math.max(0, Math.round((now - prev.at) / 1000)), cached: true,
    };
  }

  try {
    const Moonraker = require('./moonraker');
    const base = '/server/files/gcodes/';
    await Moonraker.request(host, port, 'POST', '/printer/gcode/script',
      { script: 'TIMELAPSE_TAKE_FRAME DEBUG=1' }, 8000);
    await new Promise((r) => setTimeout(r, LIVE_WAIT_MS));

    // 文件名用打印机本地时间生成；实测这台机器的 TZ 是 UTC。
    // 为兼容时钟偏差 / 其它时区，UTC 与本机时区各试前后几秒。
    const at = new Date();
    const names = [];
    for (let delta = -2; delta <= 3; delta++) {
      const t = new Date(at.getTime() + delta * 1000);
      names.push('pictures/pic_' + stamp(t, true) + '.jpg');
      names.push('pictures/pic_' + stamp(t, false) + '.jpg');
    }

    for (const name of names) {
      let buf = null;
      try {
        const r = await Moonraker.request(host, port, 'GET', base + name, null, 5000, { binary: true });
        buf = firstJpeg(r.buffer);
      } catch (_) { /* 这个秒没有文件，继续试下一个 */ }
      if (!buf) continue;
      // 抓完就删，别在打印机上攒调试照片；等删除完成再返回，便于测试与确认
      await Moonraker.request(host, port, 'DELETE', base + name, null, 5000).catch(() => {});
      LIVE.set(key, { buf, at: Date.now() });
      if (LIVE.size > 8) LIVE.delete(LIVE.keys().next().value);
      return { ok: true, frames: [buf], source: 'u1-live', staleSec: 0, path: name };
    }
    return { ok: false, error: '打印机摄像头没有返回新照片' };
  } catch (e) {
    return { ok: false, error: '主动抓拍失败：' + ((e && e.message) || String(e)) };
  }
}

/** 检测用：两张实时画面，间隔 gapMs */
async function snapmakerLiveTwo(o = {}) {
  const gap = Math.max(1000, Number(o.gapMs) || 3000);
  const a = await snapmakerLiveFrame(o);
  if (!a.ok) return a;
  await new Promise((r) => setTimeout(r, gap));
  // 节流窗口内第二张会命中缓存；强制清掉缓存再抓，保证两张真有时间差
  LIVE.delete(String(o.host || '') + ':' + (Number(o.port) || 7125));
  const b = await snapmakerLiveFrame(o);
  if (!b.ok) return b;
  return { ok: true, frames: [a.frames[0], b.frames[0]], staleSec: 0, source: 'u1-live' };
}

module.exports = {
  httpFrame, snapmakerFrame, snapmakerTwo, firstJpeg, resolveUrl,
  snapmakerLiveFrame, snapmakerLiveTwo,
};
