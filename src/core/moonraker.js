'use strict';
/**
 * 快造 U1 的 Moonraker 客户端（契约 P-2）。纯 Node，只用内置 http。
 *
 * 实测（2026-11-14，U1 @ 192.168.1.50）：
 *   Klipper 2.0.0.205 + Moonraker 默认端口 7125，局域网内**不需要认证**。
 *   状态读 /printer/objects/query，控制走 /printer/print/{pause,resume,cancel}。
 */
const http = require('http');

const DEFAULT_TIMEOUT = 4000;

function request(host, port, method, path, body, timeout = DEFAULT_TIMEOUT, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host,
      port,
      method,
      path,
      timeout,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : {},
    }, (res) => {
      let d = '';
      const chunks = [];
      if (!(opts && opts.binary)) res.setEncoding('utf8');
      res.on('data', (c) => {
        if (opts && opts.binary) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        else d += c;
      });
      res.on('end', () => {
        if (opts && opts.binary) {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) { reject(new Error('HTTP ' + res.statusCode)); return; }
          resolve({ buffer: buf, contentType: res.headers['content-type'] || '' });
          return;
        }
        let json = null;
        try { json = d ? JSON.parse(d) : null; } catch (_) { /* 非 JSON */ }
        if (res.statusCode >= 400) {
          const msg = (json && json.error && json.error.message) || ('HTTP ' + res.statusCode);
          reject(new Error(msg));
          return;
        }
        resolve(json);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('连接超时（' + host + ':' + port + '）')); });
    req.on('error', (e) => reject(new Error('无法连接打印机 ' + host + '：' + e.message)));
    if (payload) req.write(payload);
    req.end();
  });
}

/** 打印中要查的对象。extruder1..3 不存在时 Moonraker 会整条报错，所以分两批查。 */
const CORE_OBJECTS = ['print_stats', 'heater_bed', 'extruder', 'toolhead', 'virtual_sdcard', 'print_task_config', 'filament_detect'];
// host -> { list, at }：工具头探测结果缓存，避免每 3 秒多打一次 objects/list
const EXTRUDER_CACHE = new Map();

class Moonraker {
  constructor({ host, port = 7125 } = {}) {
    this.host = String(host || '');
    this.port = Number(port) || 7125;
  }

  get(path) { return request(this.host, this.port, 'GET', path); }
  getBinary(path) { return request(this.host, this.port, 'GET', path, null, 8000, { binary: true }); }
  post(path) { return request(this.host, this.port, 'POST', path, {}); }

  info() { return this.get('/printer/info'); }

  /**
   * 这台机器实际暴露了哪些工具头。U1 是 extruder + extruder1..3 四头，
   * 普通 Klipper 机只有 extruder；对象名不存在时 objects/query 会整条报错，
   * 所以必须先问 objects/list，再决定查哪些。结果按 host 缓存 10 分钟。
   */
  async extrudeNames() {
    const c = EXTRUDER_CACHE.get(this.host);
    const now = Date.now();
    if (c && now - c.at < 10 * 60 * 1000) return c.list;
    const r = await this.get('/printer/objects/list');
    const all = (r && r.result && r.result.objects) || [];
    const list = all.filter((o) => /^extruder\d*$/.test(o))
      .sort((a, b) => (a === 'extruder' ? -1 : b === 'extruder' ? 1 : a.localeCompare(b)));
    const safe = list.length ? list : ['extruder'];
    EXTRUDER_CACHE.set(this.host, { list: safe, at: now });
    return safe;
  }

  /** 拉一次状态，返回原始 status 对象（拿不到就抛） */
  async status() {
    // 多工具头 + 腔体温度都是「有就查、没有就算了」，不能因为它们让整次查询失败
    const extras = [];
    try {
      const exts = await this.extrudeNames();
      for (const e of exts) if (!CORE_OBJECTS.includes(e)) extras.push(e);
    } catch (_) { /* 连 objects/list 都失败时退回核心对象，交给下面的请求报错 */ }
    let cavity = false;
    try {
      const r = await this.get('/printer/objects/list');
      const all = (r && r.result && r.result.objects) || [];
      cavity = all.includes('temperature_sensor cavity');
    } catch (_) { /* 忽略 */ }

    const q = CORE_OBJECTS.concat(extras).join('&') + (cavity ? '&' + encodeURIComponent('temperature_sensor cavity') : '');
    const r = await this.get('/printer/objects/query?' + q);
    if (!r || !r.result || !r.result.status) throw new Error('打印机返回了意外的内容');
    return r.result.status;
  }

  /** Moonraker 里配置的摄像头（U1 出厂通常为空，用户自建 webcam 后才会有） */
  async webcams() {
    const r = await this.get('/server/webcams/list');
    return (r && r.result && r.result.webcams) || [];
  }

  /** camera 根目录的文件列表（U1 的 monitor.jpg 实时快照就在这里） */
  async cameraFiles() {
    const r = await this.get('/server/files/list?root=camera');
    return (r && r.result) || [];
  }

  /** 按路径取 camera 根目录下的文件（图片/视频） */
  fileBuffer(name) {
    const p = String(name).split('/').map(encodeURIComponent).join('/');
    return this.getBinary('/server/files/camera/' + p);
  }

  files(limit = 5) {
    return this.get('/server/files/list?root=gcodes&sort=modified&order=desc')
      .then((r) => ((r && r.result) || []).slice(0, limit));
  }

  pause() { return this.post('/printer/print/pause'); }
  resume() { return this.post('/printer/print/resume'); }
  cancel() { return this.post('/printer/print/cancel'); }
}

module.exports = Moonraker;
module.exports.request = request;
