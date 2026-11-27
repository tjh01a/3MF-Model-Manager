'use strict';
/** Moonraker / Klipper：快造 U1、Creality K1/K2、任何开放 7125 的 Klipper 机。 */
const path = require('path');
const Moonraker = require('../moonraker');
const { PrinterAdapter, toState, clamp, num, round1, normalizeCamera } = require('./base');
const catalog = require('../device-catalog');

function durationFromName(name) {
  const s = String(name || '');
  const m = /(?:^|[_-])(\d{1,2})h(\d{1,2})m(?:[_-]|$)/i.exec(s) || /(\d{1,2})h(\d{1,2})m/i.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

class MoonrakerAdapter extends PrinterAdapter {
  constructor(config = {}) {
    super(config);
    this.client = null;
    this.camera = null;
    this.modelName = '';
  }

  async connect() {
    const ports = Array.from(new Set([this.port, 7125].filter(Boolean)));
    let lastErr = null;
    for (const port of ports) {
      const mk = new Moonraker({ host: this.host, port });
      try {
        const info = await mk.info();
        this.client = mk;
        this.port = port;
        const r = (info && info.result) || {};
        this.modelName = String(r.hostname || '');
        this.connected = true;
        try { await this._loadCamera(); } catch (_) { /* 没摄像头不影响连接 */ }
        return { ok: true, hostname: this.modelName, version: r.software_version || '' };
      } catch (e) { lastErr = e; }
    }
    this.connected = false;
    throw lastErr || new Error('没有找到 Moonraker 服务');
  }

  async _loadCamera() {
    if (!this.client) return;
    const r = await this.client.webcams();
    const first = Array.isArray(r) && r[0];
    if (!first) { this.camera = null; return; }
    const base = `http://${this.host}:${this.port}`;
    const abs = (u) => {
      const s = String(u || '');
      if (!s) return '';
      return /^https?:/i.test(s) ? s : base + (s.startsWith('/') ? s : '/' + s);
    };
    this.camera = normalizeCamera(this, {
      streamUrl: abs(first.stream_url || first.url),
      snapshotUrl: abs(first.snapshot_url),
      kind: 'stream',
    });
  }

  _state(st) {
    const ps = (st && st.print_stats) || {};
    let state = toState(ps.state);
    if (state === 'idle' && ps.state === 'complete') state = 'finished';
    return { state, ps };
  }

  normalize(st) {
    const s = this.baseStatus();
    s.online = true;
    s.adapter = 'moonraker';
    if (this.kind === 'moonraker' && s.model === '') s.model = this.modelName || 'Klipper';
    const { state, ps } = this._state(st);
    s.state = state;
    s.stateText = catalog.stateText(state);
    const vs = st.virtual_sdcard || {};
    const info = ps.info || {};
    const cfgT = st.print_task_config || {};
    const ex = st.extruder || {};
    const bed = st.heater_bed || {};

    let prog = clamp(num(vs.progress), 0, 1);
    if (num(info.total_layer) > 0) prog = Math.max(prog, clamp(num(info.current_layer) / num(info.total_layer), 0, 1));
    if (state === 'idle') prog = 0;
    if (state === 'finished') prog = 1;

    let totalMin = durationFromName(ps.filename);
    if (!totalMin && num(ps.total_duration) > 60) totalMin = Math.round(num(ps.total_duration) / 60);
    const elapsedMin = Math.round(num(ps.print_duration) / 60);
    let remainingMin = 0;
    if (state === 'printing' || state === 'paused') {
      if (totalMin > 0 && prog > 0) remainingMin = Math.max(0, Math.round(totalMin * (1 - prog)));
      else if (prog >= 0.02) remainingMin = Math.round(elapsedMin * (1 - prog) / prog);
      if (remainingMin > 60 * 72) remainingMin = 0;
    }
    if (ps.filename && state !== 'idle') {
      s.job = {
        name: String(ps.filename), percent: clamp(Math.round(prog * 100), 0, 100),
        layer: num(info.current_layer), layers: num(info.total_layer),
        elapsedMin, remainingMin,
      };
    }

    const heads = [];
    for (let i = 0; i < 8; i++) {
      const key = i === 0 ? 'extruder' : 'extruder' + i;
      const e = st[key];
      if (!e || e.temperature == null) continue;
      heads.push({ index: i, cur: round1(e.temperature), target: round1(e.target), active: i === num(ex.extruder_index) });
    }
    const cavity = st['temperature_sensor cavity'];
    s.temps = {
      nozzle: { cur: round1(ex.temperature), target: round1(ex.target) },
      bed: { cur: round1(bed.temperature), target: round1(bed.target) },
      chamber: cavity ? { cur: round1(cavity.temperature), target: 0 } : null,
      heads: heads.length > 1 ? heads : null,
    };

    const fan = st.fan || null;
    s.fan = fan && fan.speed != null ? Math.round(clamp(num(fan.speed) * 100, 0, 100)) : null;
    const speedFactor = st.gcode_move && st.gcode_move.speed_factor;
    s.speed = speedFactor != null ? Math.round(clamp(num(speedFactor) * 100, 1, 500)) : null;

    const types = Array.isArray(cfgT.filament_type) ? cfgT.filament_type : [];
    const colors = Array.isArray(cfgT.filament_color_rgba) ? cfgT.filament_color_rgba : [];
    s.materials = types.map((t, i) => ({
      slot: i + 1, type: String(t || '—'), color: argbToHex(colors[i]), active: i === num(ex.extruder_index),
    }));
    s.camera = this.camera;
    s.updatedAt = Date.now();
    s.error = '';
    return s;
  }

  async getStatus() {
    try {
      if (!this.client) await this.connect();
      return this.normalize(await this.client.status());
    } catch (e) {
      // 打印机重启/换 IP 后旧 client 会一直失败；清掉它，下一轮重新探测端口。
      this.client = null;
      this.connected = false;
      throw e;
    }
  }

  async pause() { if (!this.client || !this.connected) await this.connect(); return this.client.pause(); }
  async resume() { if (!this.client || !this.connected) await this.connect(); return this.client.resume(); }
  async stop() { if (!this.client || !this.connected) await this.connect(); return this.client.cancel(); }
  async setTemperature(nozzle, bed) {
    if (!this.client || !this.connected) await this.connect();
    return this.client.setTemperature(nozzle, bed);
  }
  async sendJob(filePath, opts = {}) {
    if (!this.client || !this.connected) await this.connect();
    const name = path.basename(filePath);
    const start = opts.start !== false;
    const r = await this.client.upload(filePath, name, start);
    if (!start) return { ok: true, uploaded: name, started: false };
    return { ok: true, uploaded: name, started: true, response: r && r.json ? r.json : null };
  }
  async getCameraStream() { return this.camera; }
}

function argbToHex(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const a = ((n >>> 24) & 255) / 255;
  const r = (n >>> 16) & 255;
  const g = (n >>> 8) & 255;
  const b = n & 255;
  if (a <= 0) return '';
  return '#' + [r, g, b].map((x) => Math.round(x * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join('');
}

module.exports = MoonrakerAdapter;
module.exports.durationFromName = durationFromName;
