'use strict';
/**
 * 极简 MQTT 3.1.1 over TLS，支持用户名/密码 + 客户端证书。
 * 只用于 Anycubic 局域网 broker（9883，双向 TLS）；Bambu 仍走项目原有客户端。
 */
const tls = require('tls');
const { EventEmitter } = require('events');

function pem(value, label) {
  const s = String(value || '').replace(/\\n/g, '\n').trim();
  if (!s) return undefined;
  if (s.includes('-----BEGIN')) return s;
  const body = s.replace(/\s+/g, '').match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${body.join('\n')}\n-----END ${label}-----\n`;
}

function encodeConnect({ clientId, username, password, keepalive = 60 }) {
  const parts = [];
  const fixed = Buffer.from([0x10, 0, 0, 0, 0]);
  const variable = Buffer.concat([
    Buffer.from([0x04, 0x04]),                    // MQTT 3.1.1, clean session
    Buffer.from([0x00, 0x3c]),                    // keepalive 60
    Buffer.from([0x00, 0x08]), Buffer.from(clientId.slice(0, 8), 'utf8'),
  ]);
  const payload = [];
  if (username) {
    const u = Buffer.from(username, 'utf8');
    payload.push(Buffer.from([0x00, u.length]), u);
    const p = Buffer.from(password || '', 'utf8');
    payload.push(Buffer.from([0x00, p.length]), p);
  }
  const body = Buffer.concat([variable, ...payload]);
  const out = Buffer.from(fixed);
  out.writeUInt16BE(body.length, 1);
  parts.push(out, body);
  return Buffer.concat(parts);
}

function encodeSubscribe(topic, packetId, qos = 0) {
  const t = Buffer.from(topic, 'utf8');
  const body = Buffer.concat([
    Buffer.from([packetId >> 8, packetId & 255]),
    Buffer.from([0x00, t.length]), t, Buffer.from([qos]),
  ]);
  const head = Buffer.from([0x82, 0, 0, 0, 0]);
  head.writeUInt16BE(body.length, 1);
  return Buffer.concat([head, body]);
}

function encodePublish(topic, payload, packetId = 0, qos = 0) {
  const t = Buffer.from(topic, 'utf8');
  const p = Buffer.from(payload, 'utf8');
  if (qos === 0) {
    const body = Buffer.concat([Buffer.from([0x00, t.length]), t, p]);
    const head = Buffer.from([0x30, 0, 0, 0, 0]);
    head.writeUInt16BE(body.length, 1);
    return Buffer.concat([head, body]);
  }
  const body = Buffer.concat([Buffer.from([0x00, t.length]), t, Buffer.from([packetId >> 8, packetId & 255]), p]);
  const head = Buffer.from([0x32, 0, 0, 0, 0]);
  head.writeUInt16BE(body.length, 1);
  return Buffer.concat([head, body]);
}

function encodePing() { return Buffer.from([0xc0, 0x00]); }

class AnycubicMqtt extends EventEmitter {
  constructor({ host, port = 9883, username = '', password = '', clientId = 'printshelf', cert = '', key = '', timeout = 6000 } = {}) {
    super();
    this.host = host;
    this.port = Number(port) || 9883;
    this.username = username;
    this.password = password;
    this.clientId = clientId;
    this.cert = pem(cert, 'CERTIFICATE');
    this.key = pem(key, 'PRIVATE KEY');
    this.timeout = timeout;
    this.sock = null;
    this.connected = false;
    this._pid = 1;
    this._buf = Buffer.alloc(0);
    this._subs = new Map();
    this._pingTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        if (err) { reject(err); return; }
        resolve(true);
      };
      const opts = {
        host: this.host, port: this.port, rejectUnauthorized: false,
        cert: this.cert, key: this.key, timeout: this.timeout,
      };
      try { this.sock = tls.connect(opts, () => {
        this.sock.write(encodeConnect({ clientId: this.clientId, username: this.username, password: this.password }));
      }); } catch (e) { finish(e); return; }
      this.sock.setTimeout(this.timeout);
      this.sock.on('data', (d) => this._onData(d, finish));
      this.sock.on('error', (e) => { if (!done) finish(e); this.emit('error', e); });
      this.sock.on('timeout', () => { if (!done) finish(new Error('Anycubic MQTT 连接超时')); this.close(); });
      this.sock.on('close', () => {
        this.connected = false;
        if (this._pingTimer) clearInterval(this._pingTimer);
        this.emit('close');
      });
      setTimeout(() => finish(new Error('Anycubic MQTT 没有在 6 秒内应答')), this.timeout + 500);
    });
  }

  _onData(data, finish) {
    this._buf = Buffer.concat([this._buf, data]);
    while (this._buf.length >= 2) {
      let len = 0; let mul = 1; let i = 1; let complete = true;
      for (; i < this._buf.length; i++) {
        const b = this._buf[i];
        len += (b & 127) * mul;
        mul *= 128;
        if ((b & 128) === 0) break;
        if (i > 4) { complete = false; break; }
      }
      if (!complete) return;
      const total = i + 1 + len;
      if (this._buf.length < total) return;
      const header = this._buf[0];
      const packet = this._buf.slice(i + 1, total);
      const type = header >> 4;
      const qos = (header >> 1) & 3;
      this._buf = this._buf.slice(total);
      if (type === 2) { // CONNACK
        const rc = packet[1];
        if (rc !== 0) { finish(new Error('Anycubic MQTT 认证失败（返回码 ' + rc + '）')); return; }
        this.connected = true;
        this.emit('connected');
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => { try { this.sock.write(encodePing()); } catch (_) { /* 忽略 */ } }, 30000);
        if (this._pingTimer.unref) this._pingTimer.unref();
        finish(null);
      } else if (type === 9) { // SUBACK：按 packet id 唤醒 subscribe()
        const pid = packet.length >= 2 ? packet.readUInt16BE(0) : 0;
        const granted = packet.length >= 3 ? packet.readUInt8(2) : 0x80;
        const pending = this._subs.get(pid);
        if (pending) {
          this._subs.delete(pid);
          clearTimeout(pending.timer);
          pending.resolve(granted !== 0x80);
        }
      } else if (type === 3) { // PUBLISH
        const topicLen = packet.readUInt16BE(0);
        const topic = packet.slice(2, 2 + topicLen).toString('utf8');
        let off = 2 + topicLen;
        let pid = 0;
        if (qos > 0) { pid = packet.readUInt16BE(off); off += 2; }
        const payload = packet.slice(off).toString('utf8');
        if (qos > 0) this._puback(pid);
        let json = null;
        try { json = JSON.parse(payload); } catch (_) { /* 非 JSON */ }
        this.emit('message', topic, json, payload);
      }
    }
  }

  _puback(pid) {
    try { this.sock.write(Buffer.from([0x40, 0x02, pid >> 8, pid & 255])); } catch (_) { /* 忽略 */ }
  }

  subscribe(topic) {
    return new Promise((resolve) => {
      const id = this._pid++;
      if (this._pid > 65535) this._pid = 1;
      if (!this.sock || !this.connected) { resolve(false); return; }
      const timer = setTimeout(() => {
        this._subs.delete(id);
        resolve(false);
      }, 1500);
      if (timer.unref) timer.unref();
      this._subs.set(id, { resolve, timer });
      try { this.sock.write(encodeSubscribe(topic, id, 0)); } catch (_) {
        clearTimeout(timer);
        this._subs.delete(id);
        resolve(false);
      }
    });
  }

  publish(topic, obj, qos = 0) {
    if (!this.sock || !this.connected) throw new Error('Anycubic MQTT 还没连接');
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const id = qos > 0 ? this._pid++ : 0;
    this.sock.write(encodePublish(topic, payload, id, qos));
    return true;
  }

  close() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    for (const [id, p] of this._subs) { clearTimeout(p.timer); p.resolve(false); this._subs.delete(id); }
    if (this.sock) {
      try { this.sock.write(Buffer.from([0xe0, 0x00])); } catch (_) { /* 忽略 */ }
      try { this.sock.destroy(); } catch (_) { /* 忽略 */ }
    }
    this.sock = null;
    this.connected = false;
  }
}

module.exports = AnycubicMqtt;
module.exports.encodeConnect = encodeConnect;
module.exports.encodeSubscribe = encodeSubscribe;
module.exports.encodePublish = encodePublish;
module.exports.pem = pem;
