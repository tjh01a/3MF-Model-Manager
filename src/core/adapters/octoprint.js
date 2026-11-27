'use strict';
/** OctoPrint REST：Anycubic Kobra 2 的 71 兼容口，以及通用 OctoPrint。 */
const path = require('path');
const { requestRaw, requestJson, uploadMultipart } = require('./http');
const { PrinterAdapter, toState, clamp, num, round1, normalizeCamera } = require('./base');
const catalog = require('../device-catalog');

class OctoPrintAdapter extends PrinterAdapter {
  constructor(config = {}) {
    super(config);
    this.apiKey = String(config.apiKey || config.accessCode || '').trim();
    this.version = '';
    this.camera = null;
  }

  _headers(extra = {}) {
    return this.apiKey ? Object.assign({ 'X-Api-Key': this.apiKey }, extra) : extra;
  }

  _req(pathname, opts = {}) {
    return requestJson({
      host: this.host, port: this.port, path: pathname,
      method: opts.method || 'GET',
      body: opts.body == null ? null : JSON.stringify(opts.body),
      headers: this._headers(opts.headers || {}),
      timeout: opts.timeout || 5000,
    });
  }

  async connect() {
    const r = await this._req('/api/version');
    if (r.status >= 400 || !r.json) throw new Error(describeHttp(r, 'OctoPrint 没有响应'));
    this.version = String(r.json.text || r.json.server || 'OctoPrint');
    this.connected = true;
    try { await this._loadCamera(); } catch (_) { /* 忽略 */ }
    return { ok: true, version: this.version };
  }

  async _loadCamera() {
    if (this.config.cameraUrl) {
      this.camera = normalizeCamera(this, this.config.cameraUrl);
      return;
    }
    const r = await this._req('/api/settings');
    const w = (r.json && r.json.webcam) || {};
    const base = `http://${this.host}:${this.port}`;
    if (w.streamUrl) {
      const u = String(w.streamUrl);
      this.camera = normalizeCamera(this, {
        streamUrl: /^http/.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u),
        snapshotUrl: w.snapshotUrl ? (/^http/.test(w.snapshotUrl) ? w.snapshotUrl : base + w.snapshotUrl) : '',
        kind: 'stream',
      });
    } else {
      // 没有配置 webcam 就如实返回空，不要编造 /webcam/ 默认地址：
      // 没装插件的机器会稳定显示一张破图，用户会误以为是 PrintShelf 的问题。
      this.camera = null;
    }
  }

  normalize(printer, job) {
    const s = this.baseStatus();
    s.online = true;
    s.adapter = 'octoprint';
    if (!s.model) s.model = this.version || 'OctoPrint';
    const p = printer || {};
    const flags = (p.state && p.state.flags) || {};
    const text = (p.state && p.state.text) || '';
    let state = toState(text);
    if (flags.printing) state = 'printing';
    else if (flags.paused || flags.pausing) state = 'paused';
    else if (flags.error) state = 'error';
    else if (flags.operational) state = 'idle';
    s.state = state;
    s.stateText = catalog.stateText(state);

    const t = p.temperature || {};
    const tool = t.tool0 || t.tool1 || {};
    const bed = t.bed || {};
    s.temps = {
      nozzle: { cur: round1(tool.actual), target: round1(tool.target) },
      bed: { cur: round1(bed.actual), target: round1(bed.target) },
      chamber: null, heads: null,
    };
    const j = job || {};
    const prog = j.progress || {};
    const pct = num(prog.completion);
    const name = (j.job && j.job.file && (j.job.file.display || j.job.file.name)) || '';
    if (name && state !== 'idle') {
      const elapsedMin = Math.round(num(prog.printTime) / 60);
      const left = num(prog.printTimeLeft);
      s.job = {
        name: String(name), percent: clamp(Math.round(pct), 0, 100),
        layer: 0, layers: 0, elapsedMin,
        remainingMin: left > 0 ? Math.round(left / 60) : 0,
      };
    }
    s.camera = this.camera;
    s.capabilities = { ...s.capabilities, sendJob: true };
    s.updatedAt = Date.now();
    s.error = flags.error ? String(text || '打印机报错') : '';
    return s;
  }

  async getStatus() {
    try {
      if (!this.connected) await this.connect();
      const [p, j] = await Promise.all([
        this._req('/api/printer'),
        this._req('/api/job').catch(() => ({ json: null, status: 0 })),
      ]);
      if (p.status >= 400 && p.status !== 409) throw new Error(describeHttp(p, '读取 OctoPrint 状态失败'));
      return this.normalize(p.json, j.json);
    } catch (e) {
      // 401 / 超时 / 主机重启后强制下一轮重新握手，否则会永久卡在旧连接上。
      this.connected = false;
      throw e;
    }
  }

  _jobCommand(command, action) {
    return this._req('/api/job', {
      method: 'POST', body: action ? { command, action } : { command },
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async pause() { if (!this.connected) await this.connect(); await this._jobCommand('pause', 'pause'); }
  async resume() { if (!this.connected) await this.connect(); await this._jobCommand('pause', 'resume'); }
  async stop() { if (!this.connected) await this.connect(); await this._jobCommand('cancel'); }

  async setTemperature(nozzle, bed) {
    if (!this.connected) await this.connect();
    const jobs = [];
    if (Number.isFinite(Number(nozzle))) {
      jobs.push(this._req('/api/printer/tool', {
        method: 'POST', body: { command: 'target', targets: { tool0: Math.max(0, Math.round(Number(nozzle))) } },
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (Number.isFinite(Number(bed))) {
      jobs.push(this._req('/api/printer/bed', {
        method: 'POST', body: { command: 'target', target: Math.max(0, Math.round(Number(bed))) },
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    await Promise.all(jobs);
  }

  async sendJob(filePath, opts = {}) {
    if (!this.connected) await this.connect();
    const name = path.basename(filePath);
    const start = opts.start !== false;
    const r = await uploadMultipart({
      host: this.host, port: this.port, path: '/api/files/local',
      filePath, fileName: name, fileField: 'file',
      fields: { select: start ? 'true' : 'false', print: start ? 'true' : 'false' },
      headers: this._headers(),
      timeout: 300000,
    });
    if (r.status >= 400) throw new Error(describeHttp(r, '上传到打印机失败'));
    return { ok: true, uploaded: name, started: start, response: r.json || null };
  }

  async getCameraStream() { return this.camera; }
}

function describeHttp(r, fallback) {
  const j = r && r.json;
  const msg = (j && (j.error || j.message)) || (r && r.status ? 'HTTP ' + r.status : '');
  return msg ? `${fallback}：${msg}` : fallback;
}

module.exports = OctoPrintAdapter;
module.exports.describeHttp = describeHttp;
