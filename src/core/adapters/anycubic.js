'use strict';
/**
 * Anycubic 原生局域网（Kobra 3/4/X/S1 代）：
 *   HTTP 18910 /info → 签名 POST /ctrl → AES-CBC 解出 broker 账号与设备证书
 *   MQTT over mutual TLS 9883，主题 anycubic/anycubicCloud/v1/...
 * 协议来源见 RESEARCH.md（kobra-connect / anycubic_ha_local，均标注 BETA）。
 */
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { requestJson, uploadMultipart } = require('./http');
const AnycubicMqtt = require('./anycubic-mqtt');
const { PrinterAdapter, clamp, num, round1, normalizeCamera } = require('./base');
const catalog = require('../device-catalog');

const MODEL_NAMES = {
  20024: 'Kobra 3', 20025: 'Kobra S1', 20026: 'Kobra 3 Max',
  20027: 'Kobra 3 V2', 20029: 'Kobra S1 Max', 20030: 'Kobra 4', 20031: 'Kobra X',
};
const STATE_MAP = { free: 'idle', idle: 'idle', printing: 'printing', pausing: 'busy', paused: 'paused', resuming: 'printing', stopping: 'busy', stoped: 'idle', stopped: 'idle', finish: 'finished', finished: 'finished', error: 'error' };

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }

/** 流式计算文件 md5，避免发送大 3MF 时整文件读进内存。 */
function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
    rs.on('error', reject);
  });
}

function decryptInfo(infoB64, token, localToken) {
  const key = Buffer.from(String(token).slice(16, 32), 'utf8');
  const iv = Buffer.from(String(localToken).slice(0, 16).padEnd(16, '\0'), 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const padded = Buffer.concat([decipher.update(Buffer.from(infoB64, 'base64')), decipher.final()]);
  return JSON.parse(padded.toString('utf8'));
}

function _httpJson(host, port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host, port, method, path: pathname, timeout: 8000,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (_) { /* 非 JSON */ }
        if (res.statusCode >= 400) { reject(new Error('Anycubic HTTP ' + res.statusCode)); return; }
        if (!json) { reject(new Error('Anycubic 返回了非 JSON 内容')); return; }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Anycubic 握手超时')));
    req.on('error', (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}

class AnycubicHandshake {
  constructor(host) { this.host = String(host || ''); }

  async run() {
    const info = await _httpJson(this.host, 18910, 'GET', '/info');
    if (String(info.ctrlType || '').toLowerCase() === 'cloud') {
      throw new Error('打印机处于云模式，请在打印机上开启 LAN Mode 后重试');
    }
    const token = String(info.token || '');
    const ctrlUrl = String(info.ctrlInfoUrl || '');
    const modelId = String(info.modelId || '');
    if (!token || !ctrlUrl || !modelId) throw new Error('这台 Anycubic 不支持 18910 局域网握手');
    const ts = Date.now();
    const nonce = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'abcdef';
    const did = crypto.randomBytes(16).toString('hex').toUpperCase().slice(0, 32);
    const sign = md5(md5(token.slice(0, 16)) + String(ts) + nonce);
    let u;
    try { u = new URL(ctrlUrl); } catch (_) { u = null; }
    const pathname = u ? u.pathname + (u.search ? u.search + '&' : '?') : ctrlUrl;
    const qs = `ts=${ts}&nonce=${nonce}&sign=${sign}&did=${did}`;
    const finalPath = pathname.includes('?') ? pathname + qs : pathname + '?' + qs;
    const ctrl = await _httpJson(this.host, 18910, 'POST', finalPath);
    if (Number(ctrl.code) !== 200) throw new Error('Anycubic /ctrl 失败：' + (ctrl.message || ctrl.code));
    const data = decryptInfo(ctrl.data.info, token, ctrl.data.token);
    const broker = new URL(String(data.broker || ''));
    return {
      host: broker.hostname || this.host,
      port: Number(broker.port) || 9883,
      username: String(data.username || ''),
      password: String(data.password || ''),
      deviceId: String(data.deviceId || did),
      modelId,
      serial: String(info.cn || ''),
      modelName: String(info.modelName || MODEL_NAMES[modelId] || ''),
      cert: String(data.devicecrt || ''),
      key: String(data.devicepk || ''),
      mac: String(info.usn || '').match(/([0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5})/)?.[1] || '',
      fileUploadUrl: String(info.fileUploadurl || ''),
    };
  }
}

class AnycubicAdapter extends PrinterAdapter {
  constructor(config = {}) {
    super(config);
    this.hs = null;
    this.mqtt = null;
    this.cache = {};       // info / print / tempature / fan / file
    this.modelId = '';
    this.did = '';
    this.infoRaw = null;
    this.camera = null;
    this.uploadUrl = '';
  }

  get baseTopic() {
    return `anycubic/anycubicCloud/v1/slicer/printer/${this.modelId}/${this.did}`;
  }

  _reportTopic(type) {
    return `anycubic/anycubicCloud/v1/printer/public/${this.modelId}/${this.did}/${type}/report`;
  }

  async connect() {
    if (this.mqtt && this.mqtt.connected) return { ok: true };
    this.hs = await new AnycubicHandshake(this.host).run();
    this.modelId = this.hs.modelId;
    this.did = this.hs.deviceId;
    this.uploadUrl = this.hs.fileUploadUrl;
    this.port = 9883;
    const client = new AnycubicMqtt({
      host: this.hs.host, port: this.hs.port, username: this.hs.username,
      password: this.hs.password, clientId: 'printshelf' + this.did.slice(-6),
      cert: this.hs.cert, key: this.hs.key, timeout: 8000,
    });
    client.on('message', (topic, json, raw) => this._onMessage(topic, json, raw));
    client.on('error', (e) => this.emit('error', e));
    await client.connect();
    this.mqtt = client;
    this.connected = true;
    await client.subscribe(`anycubic/anycubicCloud/v1/printer/public/${this.modelId}/${this.did}/#`);
    this.query('info');
    this.query('print');
    this.query('tempature');
    return { ok: true, model: this.hs.modelName };
  }

  _onMessage(topic, json) {
    if (!json) return;
    if (/\/info\/report/.test(topic)) {
      this.infoRaw = json;
      const data = json.data || {};
      this.cache.info = data;
      if (data.urls && data.urls.fileUploadurl) this.uploadUrl = data.urls.fileUploadurl;
      if (data.urls && data.urls.rtspUrl) {
        const u = String(data.urls.rtspUrl);
        this.camera = normalizeCamera(this, { streamUrl: u, kind: /flv|rtsp/i.test(u) ? 'flv' : 'image' });
      }
    } else if (/\/print\/report/.test(topic)) {
      if (json.data && typeof json.data.progress !== 'undefined') this.cache.print = json.data;
      if (json.state && /pause|stop|error|print|finish/i.test(String(json.state))) {
        this.cache.phase = String(json.state);
        if (json.code && Number(json.code) !== 200) this.cache.reason = String(json.msg || json.code || '');
      }
    } else if (/\/tempature\/report/.test(topic)) {
      this.cache.temp = json.data || {};
    } else if (/\/fan\/report/.test(topic)) {
      this.cache.fan = json.data || {};
    }
  }

  query(type) {
    if (!this.mqtt || !this.mqtt.connected) return;
    const payload = {
      type, action: 'query', timestamp: Date.now(), msgid: crypto.randomUUID(), data: null,
    };
    try { this.mqtt.publish(`${this.baseTopic}/${type}`, payload, 0); } catch (_) { /* 下一轮再发 */ }
  }

  normalize() {
    const s = this.baseStatus();
    s.online = true;
    s.adapter = 'anycubic';
    const info = this.cache.info || {};
    const proj = info.project || info.last_project || {};
    const temp = info.temp || {};
    const t2 = this.cache.temp || {};
    const fan2 = this.cache.fan || {};
    const rawState = String(info.state || '').toLowerCase();
    const projState = String(proj.state || this.cache.phase || '').toLowerCase();
    const pause = Number(proj.pause);
    let state = STATE_MAP[projState] || STATE_MAP[rawState] || 'idle';
    if (projState === 'paused') state = 'paused';
    else if (pause === 1) state = 'paused';
    else if (rawState === 'free') state = 'idle';
    s.state = state;
    s.stateText = catalog.stateText(state);
    s.model = String(info.model || this.hs?.modelName || MODEL_NAMES[this.modelId] || this.config.model || 'Anycubic');
    s.name = String(info.printerName || this.config.name || s.name);
    s.serial = this.hs?.serial || this.config.serial || '';

    const nCur = num(t2.curr_nozzle_temp ?? temp.curr_nozzle_temp);
    const nTar = num(t2.target_nozzle_temp ?? temp.target_nozzle_temp);
    const bCur = num(t2.curr_hotbed_temp ?? temp.curr_hotbed_temp);
    const bTar = num(t2.target_hotbed_temp ?? temp.target_hotbed_temp);
    const cCur = t2.curr_chamber_temp ?? temp.curr_chamber_temp;
    s.temps = {
      nozzle: { cur: round1(nCur), target: round1(nTar) },
      bed: { cur: round1(bCur), target: round1(bTar) },
      chamber: cCur != null ? { cur: round1(cCur), target: round1(temp.target_chamber_temp) } : null,
      heads: null,
    };
    const progData = this.cache.print || {};
    const progress = num(progData.progress ?? proj.progress);
    const remainMin = num(progData.remain_time ?? proj.remain_time);
    const elapsedMin = num(progData.print_time ?? proj.print_time);
    const fname = String(progData.filename || proj.filename || '');
    if (fname && state !== 'idle' && state !== 'finished') {
      s.job = {
        name: fname.split('/').pop(), percent: clamp(Math.round(progress), 0, 100),
        layer: num(progData.current_layer ?? proj.curr_layer),
        layers: num(progData.total_layers ?? proj.total_layers),
        elapsedMin: Math.round(elapsedMin), remainingMin: Math.round(remainMin),
      };
    }
    s.fan = (fan2.fan_speed_pct ?? info.fan_speed_pct) != null
      ? Math.round(clamp(num(fan2.fan_speed_pct ?? info.fan_speed_pct), 0, 100)) : null;
    s.speed = info.print_speed_mode != null ? { mode: num(info.print_speed_mode), text: ['静音', '标准', '运动'][num(info.print_speed_mode) - 1] || '' } : null;
    s.camera = this.camera;
    s.updatedAt = Date.now();
    s.error = String(this.cache.reason || '');
    return s;
  }

  async getStatus() {
    if (!this.lengthConnected()) await this.connect();
    if (!this.cache.info) {
      this.query('info');
      await new Promise((r) => setTimeout(r, 900));
    }
    return this.normalize();
  }

  lengthConnected() { return !!(this.mqtt && this.mqtt.connected); }

  _cmd(type, action, data) {
    if (!this.mqtt || !this.mqtt.connected) throw new Error('Anycubic 还没连接');
    this.mqtt.publish(`${this.baseTopic}/${type}`, {
      type, action, timestamp: Date.now(), msgid: crypto.randomUUID(), data,
    }, 0);
  }

  async pause() { if (!this.lengthConnected()) await this.connect(); this._cmd('print', 'pause', { taskid: '-1' }); }
  async resume() { if (!this.lengthConnected()) await this.connect(); this._cmd('print', 'resume', { taskid: '-1' }); }
  async stop() { if (!this.lengthConnected()) await this.connect(); this._cmd('print', 'stop', { taskid: '-1' }); }

  async setTemperature(nozzle, bed) {
    if (!this.lengthConnected()) await this.connect();
    const settings = {};
    if (Number.isFinite(Number(nozzle))) settings.target_nozzle_temp = Math.max(0, Math.round(Number(nozzle)));
    if (Number.isFinite(Number(bed))) settings.target_hotbed_temp = Math.max(0, Math.round(Number(bed)));
    this._cmd('print', 'update', { taskid: '-1', settings });
  }

  async _uploadTarget(host) {
    if (this.uploadUrl) return this._buildUrl(host, this.uploadUrl);
    const info = await _httpJson(host, 18910, 'GET', '/info');
    if (String(info.ctrlType || '').toLowerCase() === 'cloud') throw new Error('打印机处于云模式');
    this.uploadUrl = String(info.fileUploadurl || '');
    if (!this.uploadUrl) throw new Error('打印机没有返回上传地址');
    return this._buildUrl(host, this.uploadUrl);
  }

  _buildUrl(host, supplied) {
    const s = String(supplied || '').trim();
    // 有些固件只返回 /upload 相对路径，不能拿 new URL 直接解析。
    if (s.startsWith('/')) return { host, port: 18910, path: s };
    let u;
    try { u = new URL(s); } catch (_) { throw new Error('打印机返回的上传地址不合法'); }
    return {
      host: u.hostname || host,
      port: Number(u.port) || 18910,
      path: u.pathname + (u.search || ''),
    };
  }

  async sendJob(filePath, opts = {}) {
    if (!this.lengthConnected()) await this.connect();
    const target = await this._uploadTarget(this.host);
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const r = await uploadMultipart({
      host: target.host, port: target.port, path: target.path,
      filePath, fileName: name, fileField: 'gcode',
      fields: { filename: name },
      headers: { 'X-File-Length': String(stat.size) },
      timeout: 900000,
    });
    if (r.status != null && r.status !== 200) throw new Error(`Anycubic 上传 HTTP ${r.status}`);
    const j = r.json || {};
    if (j.code != null && ![0, 200].includes(Number(j.code))) {
      throw new Error('Anycubic 上传被拒绝：' + (j.message || j.code));
    }
    const kept = String((j.data && j.data.gcode) || name);
    if (opts.start === false) return { ok: true, uploaded: kept, started: false };
    const digest = await md5File(filePath);
    const taskid = String(Date.now());
    const startPayload = {
      type: 'print', action: 'start', timestamp: Date.now(), msgid: crypto.randomUUID(),
      data: {
        taskid, filename: kept, filepath: '/', filetype: 1, filesize: stat.size, md5: digest,
        ams_settings: { use_ams: false },
        task_settings: { auto_leveling: 0, vibration_compensation: 0, flow_calibration: 0, timelapse: { status: 0 }, ai_settings: { status: 0 }, dry_mode: 0 },
      },
    };
    this.mqtt.publish(`${this.baseTopic}/print`, startPayload, 0);
    return { ok: true, uploaded: kept, started: true };
  }

  async getCameraStream() { return this.camera; }

  async disconnect() {
    if (this.mqtt) { try { this.mqtt.close(); } catch (_) { /* 忽略 */ } }
    this.mqtt = null; this.connected = false;
  }
}

module.exports = AnycubicAdapter;
module.exports.AnycubicHandshake = AnycubicHandshake;
module.exports.decryptInfo = decryptInfo;
module.exports.MODEL_NAMES = MODEL_NAMES;
