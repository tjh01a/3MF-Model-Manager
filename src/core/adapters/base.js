'use strict';
/** 统一 PrinterAdapter 接口与状态骨架。所有品牌适配器都返回同一份 status。 */
const { EventEmitter } = require('events');
const catalog = require('../device-catalog');

class PrinterAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config || {};
    this.id = this.config.id || '';
    this.kind = catalog.normalizeKind(this.config.kind);
    this.host = String(this.config.ip || this.config.host || '').trim();
    this.port = Number(this.config.port) || (catalog.brandOf(this.kind) || {}).defaultPort || 0;
    this.connected = false;
  }

  get beta() { return catalog.isBeta(this.kind); }
  get capabilities() { return catalog.capabilitiesOf(this.kind); }

  async connect() { this.connected = true; return true; }
  async disconnect() { this.connected = false; }
  async getStatus() { throw new Error('该适配器没有实现 getStatus'); }
  async pause() { throw new Error('该设备不支持暂停'); }
  async resume() { throw new Error('该设备不支持继续'); }
  async stop() { throw new Error('该设备不支持停止'); }
  async setTemperature() { throw new Error('该设备不支持温度设定'); }
  async sendJob() { throw new Error('该设备不支持发送任务'); }
  async getCameraStream() { return null; }

  baseStatus(patch = {}) {
    const p = this.config;
    const brand = catalog.brandOf(this.kind);
    return {
      id: this.id, kind: this.kind, brand: this.kind,
      brandLabel: brand ? brand.label : (p.brandLabel || '未知设备'),
      adapter: String(p.adapter || (brand ? brand.adapter : this.kind)),
      beta: this.beta,
      betaNote: this.beta ? catalog.BETA_NOTE : '',
      name: p.name || (brand ? brand.label : this.host),
      model: p.model || '',
      ip: this.host,
      online: false, state: 'offline', stateText: catalog.stateText('offline'),
      job: null,
      temps: { nozzle: { cur: 0, target: 0 }, bed: { cur: 0, target: 0 }, chamber: null, heads: null },
      fan: null, speed: null, materials: [],
      camera: null,
      capabilities: this.capabilities,
      updatedAt: 0, error: '',
    };
  }

  offline(error = '') {
    const s = this.baseStatus();
    s.error = String(error || '');
    s.updatedAt = Date.now();
    return s;
  }
}

function toState(raw) {
  const s = String(raw || '').toLowerCase();
  if (/print/.test(s) && !/pause/.test(s)) return 'printing';
  if (/pause/.test(s)) return 'paused';
  if (/complete|finish|done/.test(s)) return 'finished';
  if (/error|fail|abort/.test(s)) return 'error';
  if (/busy|calibrat|heating|homing|loading|unloading/.test(s)) return 'busy';
  if (/idle|ready|standby|free|operational/.test(s)) return 'idle';
  return 'idle';
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function round1(v) { return Math.round(num(v) * 10) / 10; }

function normalizeCamera(base, raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return { streamUrl: raw, snapshotUrl: raw, kind: /mjpg|stream|flv|mjpeg/i.test(raw) ? 'stream' : 'image' };
  return {
    streamUrl: String(raw.streamUrl || raw.url || ''),
    snapshotUrl: String(raw.snapshotUrl || ''),
    kind: String(raw.kind || 'stream'),
  };
}

module.exports = { PrinterAdapter, toState, clamp, num, round1, normalizeCamera };
