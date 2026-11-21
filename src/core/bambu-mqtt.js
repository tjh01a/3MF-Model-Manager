'use strict';
/**
 * 拓竹局域网 MQTT 客户端（契约 P-1）。纯 Node，只用内置 tls 模块。
 *
 * 为什么手搓而不是引 mqtt 包：
 *   我们只需要 CONNECT / SUBSCRIBE / PUBLISH 三种包、QoS 0、不重连、不持久化。
 *   引入 mqtt 包会带上 ws / 各种传输与重连逻辑，还多一个第三方依赖 ——
 *   这个项目一直保持「零运行时依赖」除了 adm-zip / chokidar。
 *
 * 协议要点（实测 2026-11-14，3DP-26A-721）：
 *   - TLS 8883，证书是打印机自签的，CN 就是序列号 → rejectUnauthorized 必须关
 *   - 用户名固定 `bblp`，密码是屏幕上的「访问码」（8 位十六进制）
 *   - 订阅 `device/<序列号>/report`，发布到 `device/<序列号>/request`
 *   - 连上后不会自动推全量，要发 {"pushing":{"command":"pushall"}} 才吐完整状态
 */
const tls = require('tls');
const { EventEmitter } = require('events');

class BambuMqtt extends EventEmitter {
  constructor({ host, serial, accessCode, username, password, clientId, timeout = 6000 } = {}) {
    super();
    this.host = String(host || '');
    this.serial = String(serial || '');
    this.accessCode = String(accessCode || '');
    // 局域网固定 bblp + 访问码；云端是 u_<uid> + accessToken。不传就走局域网默认值。
    this.username = String(username || 'bblp');
    this.password = String(password != null ? password : (accessCode || ''));
    this.clientId = String(clientId || ('ps-' + process.pid + '-' + Date.now()));
    this.timeout = timeout;
    this._sock = null;
    this._buf = Buffer.alloc(0);
    this._pid = 1;
    this.connected = false;
    this._closed = false;
    this._keepAlive = null;
  }

  connect() {
    if (this._sock) return this;
    const sock = tls.connect({
      host: this.host,
      port: 8883,
      rejectUnauthorized: false,   // 打印机是自签证书，认 CN 就够
      timeout: this.timeout,
    }, () => {
      this._sock = sock;
      this._write(this._connectPacket());
    });
    this._sock = sock;
    sock.on('data', (c) => { this._buf = Buffer.concat([this._buf, c]); this._drain(); });
    sock.on('close', () => {
      this.connected = false;
      this._stopKeepAlive();
      if (!this._closed) this.emit('disconnect', { reason: 'closed' });
    });
    sock.on('error', (e) => {
      this.connected = false;
      this._stopKeepAlive();
      if (!this._closed) this.emit('error', e);
    });
    sock.on('timeout', () => {
      this.emit('error', new Error('连接打印机超时'));
      try { sock.destroy(); } catch (_) { /* 已结束 */ }
    });
    return this;
  }

  close() {
    this._closed = true;
    this._stopKeepAlive();
    try { this._sock && this._sock.end(); } catch (_) { /* 忽略 */ }
    try { this._sock && this._sock.destroy(); } catch (_) { /* 忽略 */ }
    this._sock = null;
  }

  /** 让打印机把当前完整状态再吐一遍 */
  pushAll() {
    return this.publish({ pushing: { sequence_id: String(this._pid++), command: 'pushall' } });
  }

  publish(obj) {
    if (!this.connected) return false;
    return this._write(this._publishPacket('device/' + this.serial + '/request', obj));
  }

  /** 暂停 / 继续 / 停止 —— 与 Bambu Studio 发的是同一种命令 */
  command(cmd) {
    return this.publish({ print: { sequence_id: String(this._pid++), command: cmd } });
  }

  // ---------------------------------------------------------------- 内部

  _write(buf) {
    try {
      this._sock.write(buf);
      return true;
    } catch (_) { return false; }
  }

  _connectPacket() {
    const vh = Buffer.concat([
      this._str('MQTT'),
      Buffer.from([4, 0xc2]),          // 3.1.1 / 用户名+密码+clean session
      Buffer.from([0x00, 0x3c]),       // keepalive 60s
    ]);
    return this._packet(0x10, Buffer.concat([
      vh,
      this._str(this.clientId),
      this._str(this.username),
      this._str(this.password),
    ]));
  }

  _subscribePacket() {
    const id = this._pid++;
    return this._packet(0x82, Buffer.concat([
      Buffer.from([id >> 8, id & 0xff]),
      this._str('device/' + this.serial + '/report'),
      Buffer.from([0x00]),             // QoS 0
    ]));
  }

  _publishPacket(topic, obj) {
    return this._packet(0x30, Buffer.concat([
      this._str(topic),
      Buffer.from(JSON.stringify(obj), 'utf8'),
    ]));
  }

  _str(s) {
    const b = Buffer.from(String(s), 'utf8');
    const l = Buffer.alloc(2);
    l.writeUInt16BE(b.length);
    return Buffer.concat([l, b]);
  }

  _packet(type, payload) {
    return Buffer.concat([Buffer.from([type]), this._varLen(payload.length), payload]);
  }

  _varLen(n) {
    const out = [];
    do {
      let d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 0x80;
      out.push(d);
    } while (n > 0);
    return Buffer.from(out);
  }

  /** 从缓冲区里逐包取出并分发 */
  _drain() {
    for (;;) {
      if (this._buf.length < 2) return;
      const type = this._buf[0] >> 4;
      let mul = 1, len = 0, p = 1;
      for (;;) {
        if (p >= this._buf.length) return;         // 半包头
        const d = this._buf[p++];
        len += (d & 0x7f) * mul;
        mul *= 128;
        if (!(d & 0x80)) break;
      }
      if (p + len > this._buf.length) return;      // 半包体，等下一次
      const body = this._buf.slice(p, p + len);
      this._buf = this._buf.slice(p + len);

      // 单包解析失败只影响这一包：绝不能让异常冒到 socket 'data' 回调里打崩主进程
      try {
        this._dispatch(type, body);
      } catch (e) {
        this.emit('error', new Error('打印机报文解析失败：' + (e && e.message ? e.message : String(e))));
      }
    }
  }

  _dispatch(type, body) {
    if (type === 2) {                              // CONNACK
      const code = body.length > 1 ? body[1] : 0xff;
      if (code !== 0) {
        // 文案保持中性：局域网可能是访问码错/没开局域网模式，云端可能是 token 过期
        this.emit('error', new Error('打印机拒绝连接（认证失败），返回码 ' + code));
        this.close();
        return;
      }
      this.connected = true;
      this._startKeepAlive();
      this._write(this._subscribePacket());
      this.emit('connected', { host: this.host, serial: this.serial });
    } else if (type === 9) {                       // SUBACK
      this.emit('subscribed', {});
      this.pushAll();
    } else if (type === 3) {                       // PUBLISH
      if (body.length < 2) return;                 // 畸形短包：直接丢弃，不能 readUInt16BE 越界
      const tlen = body.readUInt16BE(0);
      if (body.length < 2 + tlen) return;          // 主题长度不合法
      const topic = body.slice(2, 2 + tlen).toString('utf8');
      const text = body.slice(2 + tlen).toString('utf8');
      let obj;
      try { obj = JSON.parse(text); } catch (_) { return; }
      this.emit('report', { topic, data: obj });
    }
  }

  /** 自己发 PINGREQ，长连接才不会因为 60s 空闲被踢 */
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAlive = setInterval(() => {
      if (!this._sock) return;
      this._write(Buffer.from([0xc0, 0x00]));
    }, 25000);
    if (this._keepAlive.unref) this._keepAlive.unref();
  }

  _stopKeepAlive() {
    if (this._keepAlive) { clearInterval(this._keepAlive); this._keepAlive = null; }
  }
}

module.exports = BambuMqtt;
