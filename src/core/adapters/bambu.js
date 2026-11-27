'use strict';
/**
 * Bambu 适配器：复用项目已实测的 BambuMqtt；新增隐式 FTPS 上传与 project_file 启动。
 * 协议细节见 RESEARCH.md。状态路径仍由 PrinterService 的既有通道负责，本类用于
 * 统一接口、发送任务和单测；不改变已上线的云/局域网双通道逻辑。
 */
const path = require('path');
const fs = require('fs');
const BambuMqtt = require('../bambu-mqtt');
const { PrinterAdapter, clamp, num, round1 } = require('./base');
const catalog = require('../device-catalog');

const STATE_MAP = { IDLE: 'idle', PREPARE: 'preparing', RUNNING: 'printing', PAUSE: 'paused', FINISH: 'finished', FAILED: 'error', SLICING: 'preparing' };

class BambuAdapter extends PrinterAdapter {
  constructor(config = {}) {
    super(config);
    this.client = null;
    this.state = {};
    this.lastReportAt = 0;
  }

  async connect() {
    if (this.client && this.client.connected) return { ok: true };
    if (!this.config.serial) throw new Error('缺少拓竹序列号');
    if (!this.config.accessCode) throw new Error('缺少访问码');
    const c = new BambuMqtt({
      host: this.host, serial: this.config.serial,
      accessCode: this.config.accessCode, timeout: 6000,
    });
    c.on('report', ({ data }) => {
      this.state = deepMerge(this.state, data);
      this.lastReportAt = Date.now();
      this.emit('update', this.normalize());
    });
    c.on('error', (e) => this.emit('error', e));
    this.client = c;
    c.connect();
    await new Promise((resolve, reject) => {
      let done = false;
      const ok = () => { if (done) return; done = true; clearTimeout(t); resolve(true); };
      const bad = (e) => { if (done) return; done = true; clearTimeout(t); reject(e); };
      const t = setTimeout(() => bad(new Error('拓竹 MQTT 6 秒内没有完成认证')), 6500);
      c.once('connected', ok);
      c.once('error', bad);
    });
    this.connected = true;
    return { ok: true, serial: this.config.serial };
  }

  normalize() {
    const s = this.baseStatus();
    s.online = true;
    s.adapter = 'bambu';
    const st = this.state || {};
    const pr = st.print || {};
    const state = STATE_MAP[String(pr.gcode_state || '').toUpperCase()] || 'idle';
    s.state = state;
    s.stateText = catalog.stateText(state === 'preparing' ? 'busy' : state);
    s.model = this.config.model || pr.machine_name || 'Bambu Lab';
    let percent = clamp(num(pr.mc_percent), 0, 100);
    if (state === 'finished') percent = 100;
    const jobName = pr.subtask_name || pr.gcode_file;
    if (jobName && state !== 'idle') {
      s.job = {
        name: String(jobName), percent: Math.round(percent),
        layer: num(pr.layer_num), layers: num(pr.total_layer_num),
        elapsedMin: 0, remainingMin: num(pr.mc_remaining_time),
      };
    }
    s.temps = {
      nozzle: { cur: round1(pr.nozzle_temper), target: round1(pr.nozzle_target_temper) },
      bed: { cur: round1(pr.bed_temper), target: round1(pr.bed_target_temper) },
      chamber: pr.chamber_temper != null ? { cur: round1(pr.chamber_temper), target: 0 } : null,
      heads: null,
    };
    const amsRoot = pr.ams || st.ams || {};
    const trays = ((amsRoot.ams && amsRoot.ams[0] && amsRoot.ams[0].tray) || []);
    const trayNow = amsRoot.tray_now != null ? num(amsRoot.tray_now) : -1;
    s.materials = trays.filter((t) => t && t.tray_type).map((t) => ({
      slot: num(t.id) + 1, type: String(t.tray_type || '—'), vendor: String(t.tray_sub_brands || ''),
      color: argbToHex(t.tray_color), active: trayNow === num(t.id),
    }));
    s.fan = Array.isArray(pr.cooling_fan_speed) ? num(pr.cooling_fan_speed[0]) : null;
    s.speed = pr.spd_lvl != null ? num(pr.spd_lvl) : null;
    s.camera = { kind: 'frame', snapshotUrl: '', streamUrl: '' };
    s.updatedAt = Date.now();
    s.error = '';
    return s;
  }

  async getStatus() {
    if (!this.client || !this.client.connected) await this.connect();
    if (Date.now() - this.lastReportAt > 15000) this.client.pushAll();
    if (!this.lastReportAt) await new Promise((r) => setTimeout(r, 800));
    return this.normalize();
  }

  _command(cmd) {
    if (!this.client || !this.client.connected) throw new Error('拓竹 MQTT 还没连接');
    return this.client.command(cmd);
  }
  async pause() { return this._command('pause'); }
  async resume() { return this._command('resume'); }
  async stop() { return this._command('stop'); }

  _gcode(line) {
    if (!this.client || !this.client.connected) throw new Error('拓竹 MQTT 还没连接');
    return this.client.publish({ print: { sequence_id: String(Date.now()), command: 'gcode_line', param: line } });
  }

  async setTemperature(nozzle, bed) {
    if (!this.client || !this.client.connected) await this.connect();
    if (Number.isFinite(Number(nozzle))) this._gcode('M104 S' + Math.max(0, Math.round(Number(nozzle))));
    if (Number.isFinite(Number(bed))) this._gcode('M140 S' + Math.max(0, Math.round(Number(bed))));
  }

  async sendJob(filePath, opts = {}) {
    if (!this.client || !this.client.connected) await this.connect();
    if (!/\.3mf$/i.test(filePath)) throw new Error('拓竹发送任务只支持切片后的 .3mf 文件');
    const name = path.basename(filePath);
    let Client;
    try { ({ Client } = require('basic-ftp')); } catch (_) { throw new Error('缺少 basic-ftp，无法上传到拓竹'); }
    const c = new Client(30000);
    try {
      await c.access({
        host: this.host, port: 990, user: 'bblp', password: this.config.accessCode,
        secure: 'implicit', secureOptions: { rejectUnauthorized: false },
      });
      await c.uploadFrom(filePath, name);
    } finally {
      try { c.close(); } catch (_) { /* 忽略 */ }
    }
    if (opts.start === false) return { ok: true, uploaded: name, started: false };
    this._startProject(name);
    return { ok: true, uploaded: name, started: true };
  }

  _startProject(name) {
    const seq = String(Date.now());
    this.client.publish({
      print: {
        sequence_id: seq, command: 'project_file',
        param: 'Metadata/plate_1.gcode', subtask_name: name,
        url: 'ftp:///' + name, file: name, md5: '',
        profile_id: '0', project_id: '0', task_id: '0',
        use_ams: false, bed_type: 'auto', timelapse: false,
        flow_calibration: false, ams_mapping: [0],
        ams_mapping2: [{ ams_id: 0, slot_id: 0 }],
      },
    });
  }

  async getCameraStream() { return { kind: 'frame' }; }

  async disconnect() {
    if (this.client) { try { this.client.close(); } catch (_) { /* 忽略 */ } }
    this.client = null; this.connected = false;
  }
}

function deepMerge(a, b) {
  if (!a || typeof a !== 'object') return b;
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function argbToHex(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  const r = (n >>> 16) & 255;
  const g = (n >>> 8) & 255;
  const b = n & 255;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

module.exports = BambuAdapter;
module.exports.deepMerge = deepMerge;
