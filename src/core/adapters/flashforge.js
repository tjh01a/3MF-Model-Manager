'use strict';
/** FlashForge 现代 HTTP API（Adventurer 5M / 5M Pro / AD5X，端口 8898）。 */
const fs = require('fs');
const path = require('path');
const { requestJson, uploadMultipart } = require('./http');
const { PrinterAdapter, toState, clamp, num, round1, normalizeCamera } = require('./base');
const catalog = require('../device-catalog');

const PID_MODEL = { 35: 'Adventurer 5M', 36: 'Adventurer 5M Pro', 38: 'AD5X' };

class FlashForgeAdapter extends PrinterAdapter {
  constructor(config = {}) {
    super(config);
    this.serial = String(config.serial || '').trim();
    this.checkCode = String(config.checkCode || config.accessCode || '').trim();
    this.detail = null;
    this.pid = 0;
    this.camera = null;
  }

  _authBody(extra = {}) {
    return Object.assign({ serialNumber: this.serial, checkCode: this.checkCode }, extra);
  }

  async _post(pathname, body) {
    const r = await requestJson({
      host: this.host, port: this.port || 8898, path: pathname, method: 'POST',
      body: JSON.stringify(body || {}),
      headers: { 'Content-Type': 'application/json' },
      timeout: 6000,
    });
    if (r.status >= 400) throw new Error(`闪铸接口 HTTP ${r.status}`);
    const j = r.json || {};
    if (j.code !== 0) throw new Error(ffError(j));
    return j;
  }

  async connect() {
    if (!this.serial || !this.checkCode) throw new Error('闪铸需要填写机身序列号和校验码（check code）');
    if (!this.port) this.port = 8898;
    const j = await this._post('/detail', this._authBody());
    this.detail = j.detail || {};
    this.pid = parseInt(this.detail.pid, 16);
    if (!Number.isFinite(this.pid)) this.pid = Number(this.detail.pid) || 0;
    this.modelName = PID_MODEL[this.pid] || this.detail.name || 'FlashForge';
    this.connected = true;
    this.camera = this.detail.cameraStreamUrl
      ? normalizeCamera(this, { streamUrl: this.detail.cameraStreamUrl, snapshotUrl: this.detail.cameraStreamUrl, kind: 'stream' })
      : null;
    return { ok: true, model: this.modelName };
  }

  normalize(d) {
    const s = this.baseStatus();
    s.online = true;
    s.adapter = 'flashforge';
    if (!s.model) s.model = this.modelName || '';
    const raw = String(d.status || '').toLowerCase();
    let state = toState(raw);
    if (raw === 'pause') state = 'paused';
    if (raw === 'ready') state = 'idle';
    if (raw === 'pausing') state = 'busy';
    s.state = state;
    s.stateText = catalog.stateText(state);
    const pct = Math.round(num(d.printProgress) * 100);
    if (d.printFileName && state !== 'idle') {
      s.job = {
        name: String(d.printFileName), percent: clamp(pct, 0, 100),
        layer: num(d.printLayer), layers: num(d.targetPrintLayer),
        elapsedMin: Math.round(num(d.printDuration) / 60),
        remainingMin: Math.round(num(d.estimatedTime) / 60),
      };
    } else if (state === 'finished') {
      s.job = null;
    }
    s.temps = {
      nozzle: { cur: round1(d.rightTemp), target: round1(d.rightTargetTemp) },
      bed: { cur: round1(d.platTemp), target: round1(d.platTargetTemp) },
      chamber: d.chamberTemp != null ? { cur: round1(d.chamberTemp), target: round1(d.chamberTargetTemp) } : null,
      heads: null,
    };
    s.fan = d.coolingFanSpeed != null ? Math.round(num(d.coolingFanSpeed)) : null;
    s.speed = d.currentPrintSpeed != null ? Math.round(num(d.currentPrintSpeed)) : null;
    s.camera = this.camera;
    s.updatedAt = Date.now();
    s.error = d.errorCode ? String(d.errorCode) : '';
    return s;
  }

  async getStatus() {
    try {
      if (!this.connected) await this.connect();
      const j = await this._post('/detail', this._authBody());
      this.detail = j.detail || this.detail;
      return this.normalize(this.detail);
    } catch (e) {
      // 校验码错/打印机重启都会走到这里；下一轮重新 connect，用户改了配置也能恢复。
      this.connected = false;
      throw e;
    }
  }

  async _job(action) {
    if (!this.connected) await this.connect();
    return this._post('/control', this._authBody({
      payload: { cmd: 'jobCtl_cmd', args: { jobID: '', action } },
    }));
  }
  async pause() { return this._job('pause'); }
  async resume() { return this._job('continue'); }
  async stop() { return this._job('cancel'); }

  async setTemperature(nozzle, bed) {
    if (!this.connected) await this.connect();
    const args = { leftNozzle: -200, platform: -200, chamber: -200 };
    if (Number.isFinite(Number(nozzle))) args.rightNozzle = Math.max(0, Math.round(Number(nozzle)));
    if (Number.isFinite(Number(bed))) args.platform = Math.max(0, Math.round(Number(bed)));
    return this._post('/control', this._authBody({ payload: { cmd: 'temperatureCtl_cmd', args } }));
  }

  async sendJob(filePath, opts = {}) {
    if (!this.connected) await this.connect();
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const start = opts.start !== false;
    const r = await uploadMultipart({
      host: this.host, port: this.port || 8898, path: '/uploadGcode',
      filePath, fileName: name, fileField: 'gcodeFile',
      headers: {
        serialNumber: this.serial, checkCode: this.checkCode,
        fileSize: String(stat.size), printNow: start ? 'true' : 'false',
        levelingBeforePrint: 'true', flowCalibration: 'false', useMatlStation: 'false', gcodeToolCnt: '0',
      },
      timeout: 600000,
    });
    if (r.status >= 400) throw new Error(`闪铸上传 HTTP ${r.status}`);
    const j = r.json || {};
    if (j.code !== 0) throw new Error(ffError(j));
    return { ok: true, uploaded: name, started: start, response: j };
  }

  async getCameraStream() { return this.camera; }
}

function ffError(j) {
  const code = j && j.code;
  const msg = (j && j.message) || '未知错误';
  if (code === 1 && /SN/i.test(msg)) return '闪铸序列号不匹配，请检查机身序列号';
  if (code === 1) return '闪铸校验码不匹配，请在打印机屏幕查看 check code';
  if (code === 2) return '打印机正在忙，等当前任务结束后再发送';
  return `闪铸返回错误（${code}）：${msg}`;
}

module.exports = FlashForgeAdapter;
module.exports.PID_MODEL = PID_MODEL;
module.exports.ffError = ffError;
