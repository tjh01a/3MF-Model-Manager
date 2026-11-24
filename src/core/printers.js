'use strict';
/**
 * 打印机管理（契约 P-3）：把「快造 U1」和「拓竹」合并成一套统一模型。
 * 纯 Node，禁止 require('electron')。
 *
 * 为什么能合并：两台机器的局域网协议都是开放的，而且都已经实测跑通
 *   · 快造 U1   Klipper + Moonraker，http://<ip>:7125，免认证，读 objects/query
 *   · 拓竹      局域网 MQTT/TLS 8883，用户 bblp + 屏幕访问码，订阅 device/<sn>/report
 * 我们不去模拟切片软件，只做「同一张卡片上看见两台机器在干什么」。
 *
 * 统一后的状态（normalize 的输出）：
 *   { id, kind, name, model, ip, online, state, stateText,
 *     job:{name,percent,layer,layers,remainingMin,elapsedMin},
 *     temps:{nozzle:{cur,target},bed:{cur,target},chamber:{...}|null},
 *     materials:[{slot,type,color,active}], fan, speed, updatedAt }
 */
const { EventEmitter } = require('events');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');

const BambuMqtt = require('./bambu-mqtt');
const Moonraker = require('./moonraker');

const POLL_MS_DEFAULT = 3000;
const BAMBU_BACKOFF_MS = 3000;      // 断线重连起点，失败逐次翻倍，最多 30 秒
const BAMBU_HEAL_MS = 300000;       // 连不上时自动找「同序列号的新 IP」的节流：5 分钟内不重复扫
const BAMBU_HEAL_MAX = 6;           // 每个打印机每次运行最多扫 6 轮，避免云端模式时一直刷局域网
const BAMBU_LAN_RETRY_MS = 300000;  // 双通道：走云端时每 5 分钟偷偷试一次局域网，恢复了就切回来
// 配置不完整（缺 serial / accessCode）时不能每 3 秒刷一次离线提示与界面更新。
const CONFIG_BACKOFF_MS = 5000;     // 起点 5 秒，逐次翻倍，最多 2 分钟
const CONFIG_BACKOFF_MAX = 120000;
const PRINTER_MODES = ['lan', 'cloud', 'auto'];

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeDeep(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round1 = (v) => Math.round(num(v) * 10) / 10;

/**
 * 颜色归一化 → "#RRGGBB"。
 * 固件给两种写法：8 位十六进制 "39FF14FF" 是 RRGGBBAA（取前 6 位）；
 * 十进制整数（含纯数字字符串）是 AARRGGBB 的 uint32（取低 24 位）。
 * 老代码先看长度再看数字，8 位十进制被当成 hex 截断，非法 hex 也会被误收（P1-12）。
 */
function argbToHex(v) {
  if (v == null || v === '') return '#9AA3AF';
  const raw = String(v).trim().replace(/^#/, '');
  if (!raw) return '#9AA3AF';
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return '#9AA3AF';
    return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  }
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return '#' + raw.slice(0, 6).toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw.toUpperCase();
  return '#9AA3AF';
}

class PrinterService extends EventEmitter {
  constructor({ store, cloud } = {}) {
    super();
    if (!store) throw new Error('PrinterService 初始化失败：缺少 store');
    this.store = store;
    this.cloud = cloud || null;   // BambuCloud 实例：云端通道的 token 来源
    this._bambu = new Map();   // id -> { client, state, connectedAt, lastError }
    this._cache = new Map();   // id -> normalized status
    this._timer = null;
    this._ticking = false;
    this._moonFail = new Map();
    this._healAt = new Map();  // id -> 上次自动找 IP 的时间戳
    this.intervalMs = POLL_MS_DEFAULT;
  }

  // ------------------------------------------------------------------ 配置

  list() {
    const s = (this.store.getSettings && this.store.getSettings()) || {};
    return Array.isArray(s.printers) ? s.printers.map((p) => ({ ...p })) : [];
  }

  get(id) {
    return this.list().find((p) => p.id === id) || null;
  }

  async _write(list) {
    await this.store.updateSettings({ printers: list });
  }

  async add({ kind, name, ip, serial = '', accessCode = '', model = '', cameraUrl = '', mode = 'auto' } = {}) {
    if (!kind || !['bambu', 'snapmaker'].includes(kind)) throw new Error('未知的打印机类型：' + kind);
    const netMode = PRINTER_MODES.includes(mode) ? mode : 'auto';
    const host = String(ip || '').trim();
    if (!host) throw new Error('请填写打印机 IP');
    const list = this.list();
    if (list.some((p) => p.ip === host)) throw new Error('这台打印机已经添加过了：' + host);
    const item = {
      id: 'pr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind,
      name: String(name || (kind === 'bambu' ? '拓竹打印机' : '快造 U1')).trim(),
      ip: host,
      serial: String(serial || '').trim(),
      accessCode: String(accessCode || '').trim(),
      // 可选的摄像头地址（快照或 MJPEG）。留空则用机型自带的取帧方式。
      cameraUrl: String(cameraUrl || '').trim(),
      model: String(model || '').trim(),
      // 拓竹连接通道：lan / cloud / auto（默认自动：局域网优先，失败切云端）
      mode: netMode,
      enabled: true,
    };
    list.push(item);
    await this._write(list);
    this.emit('changed', { type: 'add', id: item.id });
    return item;
  }

  async update(id, patch = {}) {
    const list = this.list();
    const cur = list.find((p) => p.id === id);
    if (!cur) throw new Error('找不到这台打印机');
    for (const k of ['name', 'ip', 'serial', 'accessCode', 'model', 'cameraUrl']) {
      if (k in patch && patch[k] != null) cur[k] = String(patch[k]).trim();
    }
    if ('enabled' in patch) cur.enabled = !!patch.enabled;
    if ('mode' in patch) {
      const m = String(patch.mode || '').trim();
      if (!PRINTER_MODES.includes(m)) throw new Error('非法的连接模式：' + patch.mode);
      cur.mode = m;
    }
    await this._write(list);
    this._dropConnection(id);
    this.emit('changed', { type: 'update', id });
    return cur;
  }

  async remove(id) {
    const list = this.list().filter((p) => p.id !== id);
    await this._write(list);
    this._dropConnection(id);
    this._cache.delete(id);
    this.emit('changed', { type: 'remove', id });
    return true;
  }

  // ------------------------------------------------------------------ 状态

  /** 缓存的统一状态（给渲染层随时取） */
  snapshot() {
    return this.list().filter((p) => p.enabled !== false).map((p) => {
      const c = this._cache.get(p.id);
      return c || this._offline(p);
    });
  }

  _offline(p, via = 'lan') {
    return {
      id: p.id, kind: p.kind, name: p.name, model: p.model || '', ip: p.ip,
      via,
      online: false, state: 'offline', stateText: '离线',
      job: null,
      temps: { nozzle: { cur: 0, target: 0 }, bed: { cur: 0, target: 0 }, chamber: null },
      materials: [], fan: null, speed: null, updatedAt: 0, error: '',
    };
  }

  /** 全部断开重连（拓竹账号登录/退出后调用） */
  reload() {
    for (const ent of this._bambu.values()) {
      try { ent.client && ent.client.close(); } catch (_) { /* 忽略 */ }
    }
    this._bambu.clear();
    this._cache.clear();
    this.tick().catch(() => {});
  }

  start(intervalMs) {
    if (intervalMs) this.intervalMs = clamp(Number(intervalMs) || POLL_MS_DEFAULT, 1000, 30000);
    if (this._timer) return;
    const tick = () => { this.tick().catch(() => {}); };
    this._timer = setInterval(tick, this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    tick();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    for (const id of Array.from(this._bambu.keys())) this._dropConnection(id);
  }

  /** 跑一轮：快造走 HTTP 轮询，拓竹保持长连接（断了就重连） */
  async tick() {
    if (this._ticking) return;
    this._ticking = true;
    try {
      const list = this.list().filter((p) => p.enabled !== false);
      await Promise.all(list.map((p) => (p.kind === 'bambu' ? this._ensureBambu(p) : this._pollMoonraker(p))));
    } finally {
      this._ticking = false;
    }
  }

  // ------------------------------------------------------------------ 快造

  async _pollMoonraker(p) {
    const mk = new Moonraker({ host: p.ip });
    try {
      const st = await mk.status();
      const fails = (this._moonFail.get(p.id) || 0);
      void fails;
      this._moonFail.delete(p.id);
      this._cache.set(p.id, this._normalizeSnapmaker(p, st));
      this.emit('update', this._cache.get(p.id));
    } catch (e) {
      const n = (this._moonFail.get(p.id) || 0) + 1;
      this._moonFail.set(p.id, n);
      // 偶发超时不立刻判离线，连续两次才算
      if (n >= 2) {
        const off = this._offline(p);
        off.error = e.message;
        this._cache.set(p.id, off);
        this.emit('update', off);
      }
    }
  }

  _normalizeSnapmaker(p, st) {
    const ps = st.print_stats || {};
    const vs = st.virtual_sdcard || {};
    const info = ps.info || {};
    const bed = st.heater_bed || {};
    const ex = st.extruder || {};
    const cfgT = st.print_task_config || {};

    const stateMap = {
      standby: 'idle', printing: 'printing', paused: 'paused',
      complete: 'finished', cancelled: 'idle', error: 'error',
    };
    const state = stateMap[ps.state] || 'idle';

    // 进度：优先字节进度；有些 gcode 不带 M73 时它很粗，再用层数交叉校验取较大值
    let prog = clamp(num(vs.progress), 0, 1);
    if (info.total_layer > 0) {
      const byLayer = clamp(num(info.current_layer) / num(info.total_layer), 0, 1);
      prog = Math.max(prog, byLayer);
    }
    if (state === 'idle') prog = 0;
    if (state === 'finished') prog = 1;
    const percent = Math.round(prog * 100);
    const elapsedMin = Math.round(num(ps.print_duration) / 60);

    // 剩余时间：Klipper 不直接给 ETA，顺序是
    //   ① 文件名里带时长（快造导出的名字形如 xxx_PETG_12h19m）→ 用总时长 × (1-进度)
    //   ② 进度够大时用已打印时间反推
    //   ③ 都不行就留 0，界面显示「—」，不编造数字
    let totalMin = this._durationFromName(ps.filename);
    if (!totalMin) {
      const td = num(ps.total_duration);
      if (td > 60) totalMin = Math.round(td / 60);
    }
    let remainingMin = 0;
    if (state === 'printing' || state === 'paused') {
      if (totalMin > 0 && prog > 0) remainingMin = Math.max(0, Math.round(totalMin * (1 - prog)));
      else if (prog >= 0.02) remainingMin = Math.round(elapsedMin * (1 - prog) / prog);
      if (remainingMin > 60 * 72) remainingMin = 0;   // 明显不合理的估算就不显示
    }

    const types = Array.isArray(cfgT.filament_type) ? cfgT.filament_type : [];
    const colors = Array.isArray(cfgT.filament_color_rgba) ? cfgT.filament_color_rgba : [];
    const vendors = Array.isArray(cfgT.filament_vendor) ? cfgT.filament_vendor : [];
    const activeIdx = num(ex.extruder_index);
    const materials = types.map((t, i) => ({
      slot: i + 1,
      type: String(t || '—'),
      vendor: String(vendors[i] || ''),
      color: argbToHex(colors[i]),
      active: activeIdx === i,
    }));

    // 四工具头温度：U1 暴露 extruder / extruder1..3，每路都有自己的 temperature/target。
    // 只显示当前喷嘴会让另外三个头的状态完全不可见（用户明确要求每个头都要有温度）。
    const heads = [];
    for (let i = 0; i < 4; i++) {
      const key = i === 0 ? 'extruder' : 'extruder' + i;
      const e = st[key];
      if (!e || e.temperature == null) continue;
      // 用键位序（extruder=0, extruder1=1…）当显示编号：实测个别固件里
      // extruder.extruder_index 与对象名不一致（夹具里就是 1），按字段取会导致两个头同时高亮。
      heads.push({
        index: i,
        cur: round1(e.temperature),
        target: round1(e.target),
        active: i === activeIdx,
      });
    }
    const cavity = st['temperature_sensor cavity'] || null;

    return {
      id: p.id, kind: 'snapmaker', name: p.name,
      model: p.model || 'Snapmaker U1', ip: p.ip,
      online: true, state, stateText: this._stateText(state),
      job: (ps.filename && this._jobVisible(state)) ? {
        name: ps.filename, percent: clamp(percent, 0, 100),
        layer: num(info.current_layer), layers: num(info.total_layer),
        elapsedMin, remainingMin,
      } : null,
      temps: {
        // nozzle 仍保留「当前活跃头」，兼容旧界面与监控采样；多头的完整列表在 heads
        nozzle: { cur: round1(ex.temperature), target: round1(ex.target) },
        bed: { cur: round1(bed.temperature), target: round1(bed.target) },
        chamber: cavity ? { cur: round1(cavity.temperature), target: 0 } : null,
        heads: heads.length > 1 ? heads : null,
      },
      materials, fan: null, speed: null,
      updatedAt: Date.now(), error: '',
    };
  }

  /** 从 gcode 文件名里读时长，例如 xxx_PETG_12h19m.gcode → 739 */
  _durationFromName(name) {
    const m = /(\d+)\s*h\s*(\d+)\s*m/i.exec(String(name || ''));
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const m2 = /(\d+)\s*m\s*(\d+)\s*s/i.exec(String(name || ''));
    if (m2) return Number(m2[1]) + Math.round(Number(m2[2]) / 60);
    return 0;
  }

  // ------------------------------------------------------------------ 拓竹

  /**
   * 决定这台拓竹走哪条通道。
   *   mode 'auto'（默认）：局域网优先；局域网失败切云端；走云端时每 5 分钟试一次局域网，恢复就切回。
   *   mode 'lan'：只走局域网（不想让账号 token 参与的场合）。
   *   mode 'cloud'：只走云端。
   * 返回 'lan' / 'cloud'；null 表示云端必要但没登录。
   */
  _pickChannel(p, ent) {
    const mode = p.mode || 'auto';
    const cloudOk = !!(this.cloud && this.cloud.status().loggedIn && !this.cloud.status().expired);
    if (mode === 'cloud') return cloudOk ? 'cloud' : null;
    if (mode === 'lan') return 'lan';
    if (!cloudOk) return 'lan';
    if (ent.channel === 'cloud') {
      if (Date.now() - (ent.lastLanProbe || 0) > BAMBU_LAN_RETRY_MS) {
        ent.lastLanProbe = Date.now();
        this._probe(p.ip, 8883, 1500).then((ok) => {
          if (ok && ent.channel === 'cloud') {
            ent.channel = 'lan';
            ent.nextTry = 0;      // 下个 tick 自动用局域网重连
          }
        }).catch(() => {});
      }
      return 'cloud';
    }
    return 'lan';
  }

  /** 云端连接参数；不可用返回 { error } */
  _cloudConn() {
    if (!this.cloud) return { error: '云端通道未启用' };
    const st = this.cloud.status();
    if (!st.loggedIn) return { error: '拓竹账号未登录：点设备页右上角「拓竹账号」登录后自动走云端' };
    if (st.expired) return { error: '拓竹登录已过期：请重新登录拓竹账号' };
    return { host: this.cloud.mqttHost(), username: 'u_' + st.uid, password: this.cloud.token() };
  }

  async _ensureBambu(p) {
    let ent = this._bambu.get(p.id);
    if (!ent) {
      ent = { client: null, state: {}, connectedAt: 0, fails: 0, nextTry: 0, lastError: '',
        channel: 'lan', lastLanProbe: 0 };
      this._bambu.set(p.id, ent);
    }
    if (ent.client) return;                     // 已连着，靠推送即可
    if (Date.now() < ent.nextTry) return;       // 退避期内不重连，避免把打印机连接数打满
    // 配置缺项是可预期的静态状态：必须退避，否则每 3 秒发一次 update 事件刷界面。
    const missing = !p.serial ? '缺少打印机序列号'
      : (p.mode !== 'cloud' && !p.accessCode
        ? '缺少访问码：在打印机屏幕上查看，或登录拓竹账号自动获取' : null);
    if (missing) {
      ent.fails = (ent.fails || 0) + 1;
      ent.nextTry = Date.now() + Math.min(CONFIG_BACKOFF_MAX, CONFIG_BACKOFF_MS * Math.pow(2, ent.fails - 1));
      const off = this._offline(p);
      off.error = missing;
      this._cache.set(p.id, off);
      this.emit('update', off);
      return;
    }

    const mode = p.mode || 'auto';
    const chan = this._pickChannel(p, ent);
    if (!chan) {
      const off = this._offline(p, 'cloud');
      off.state = 'connecting';
      off.stateText = '连接中';
      off.error = '云端通道需要先登录拓竹账号（设备页右上角「拓竹账号」）';
      this._cache.set(p.id, off);
      this.emit('update', off);
      ent.nextTry = Date.now() + 60000;
      return;
    }

    let host = p.ip;
    let username = 'bblp';
    let password = p.accessCode;
    let via = 'lan';
    if (chan === 'cloud') {
      const cc = this._cloudConn();
      if (!cc || cc.error) {
        const off = this._offline(p, 'cloud');
        off.state = 'connecting';
        off.stateText = '连接中';
        off.error = (cc && cc.error) || '云端通道不可用';
        this._cache.set(p.id, off);
        this.emit('update', off);
        ent.nextTry = Date.now() + 60000;
        return;
      }
      host = cc.host;
      username = cc.username;
      password = cc.password;
      via = 'cloud';
    }

    const client = new BambuMqtt({ host, serial: p.serial, accessCode: p.accessCode, username, password });
    ent.client = client;
    ent.channel = via;
    client.on('connected', () => {
      ent.connectedAt = Date.now();
      ent.lastError = '';
      ent.fails = 0;
      ent.nextTry = 0;
    });
    client.on('report', ({ data }) => {
      ent.state = mergeDeep(ent.state, data);
      const norm = this._normalizeBambu(p, ent.state);
      norm.via = via;
      this._cache.set(p.id, norm);
      this.emit('update', norm);
    });
    client.on('error', (e) => {
      const text = this._bambuErrorText(e, p, via);
      ent.lastError = text;
      ent.client = null;
      ent.fails = (ent.fails || 0) + 1;
      ent.nextTry = Date.now() + Math.min(30000, BAMBU_BACKOFF_MS * Math.pow(2, ent.fails - 1));
      const off = this._offline(p, via);
      off.error = text;
      // 首次启动给两次重试的宽限显示「连接中」；再连不上就明确标「离线」，
      // 否则打印机换了 IP / 没开局域网模式时，卡片会永远停在连接中，看着像还在努力。
      if (!ent.connectedAt && ent.fails < 2) { off.state = 'connecting'; off.stateText = '连接中'; }

      // 双通道切换：局域网失败且有云端 → 3 秒后直接走云；云端失败 → 回退局域网。
      // 这样打印机换 IP / 没开局域网模式 / 云端抖动，都不需要人工干预。
      const canCloud = !!(this.cloud && this.cloud.status().loggedIn && !this.cloud.status().expired);
      if (via === 'lan' && mode !== 'lan' && this._isNetError(e) && canCloud) {
        ent.channel = 'cloud';
        ent.nextTry = Date.now() + 3000;
        off.via = 'cloud';
        off.error = '局域网连不上（' + text + '），已自动切到云端通道';
      } else if (via === 'cloud' && mode === 'auto' && p.ip && this._isNetError(e)) {
        ent.channel = 'lan';
        ent.nextTry = Date.now() + 15000;
        off.via = 'lan';
        off.error = '云端连不上（' + text + '），稍后回退局域网直连';
      }

      this._cache.set(p.id, off);
      this.emit('update', off);
      // IP 被 DHCP 换掉是最常见的原因：只在局域网通道下扫网段纠正
      if (via === 'lan' && this._isNetError(e)) this._healBambuIp(p).catch(() => {});
    });
    client.on('disconnect', () => {
      ent.client = null;
      ent.fails = (ent.fails || 0) + 1;
      ent.nextTry = Date.now() + Math.min(30000, BAMBU_BACKOFF_MS * Math.pow(2, ent.fails - 1));
      if (ent.connectedAt) {
        const off = this._offline(p);
        off.error = '与打印机断开，正在重连…';
        off.state = 'connecting';
        off.stateText = '连接中';
        this._cache.set(p.id, off);
        this.emit('update', off);
      }
    });
    client.connect();
  }

  _normalizeBambu(p, st) {
    const pr = st.print || {};
    const stateMap = {
      IDLE: 'idle', PREPARE: 'preparing', RUNNING: 'printing',
      PAUSE: 'paused', FINISH: 'finished', FAILED: 'error', SLICING: 'preparing',
    };
    const state = stateMap[pr.gcode_state] || 'idle';
    let percent = clamp(num(pr.mc_percent), 0, 100);
    if (state === 'finished') percent = 100;

    // 实测：AMS 数据在 print.ams 里面，不在顶层；两种位置都兜一下
    const amsRoot = pr.ams || st.ams || {};
    const amsArr = amsRoot.ams || [];
    const trays = amsArr[0] && Array.isArray(amsArr[0].tray) ? amsArr[0].tray : [];
    // 当前在用的槽：不同固件把它放在 ams / ams[0] / 每个 tray 上（255 表示外挂料盘）
    let trayNow = amsRoot.tray_now != null ? num(amsRoot.tray_now)
      : (amsArr[0] && amsArr[0].tray_now != null ? num(amsArr[0].tray_now) : -1);
    if (trayNow < 0) {
      const marked = trays.findIndex((t) => t && String(t.tray_now) === '1');
      if (marked >= 0) trayNow = marked;
    }
    const materials = trays
      .filter((t) => t && t.tray_type)
      .map((t) => ({
        slot: num(t.id) + 1,
        type: String(t.tray_type || '—'),
        vendor: String(t.tray_sub_brands || ''),
        color: argbToHex(t.tray_color),
        active: trayNow === num(t.id),
      }));

    const jobName = pr.subtask_name || pr.gcode_file;
    return {
      id: p.id, kind: 'bambu', name: p.name,
      model: p.model || pr.machine_name || 'Bambu Lab', ip: p.ip,
      online: true, state, stateText: this._stateText(state),
      job: (jobName && this._jobVisible(state)) ? {
        name: jobName, percent: Math.round(percent),
        layer: num(pr.layer_num), layers: num(pr.total_layer_num),
        elapsedMin: 0, remainingMin: num(pr.mc_remaining_time),
      } : null,
      temps: {
        nozzle: { cur: round1(pr.nozzle_temper), target: round1(pr.nozzle_target_temper) },
        bed: { cur: round1(pr.bed_temper), target: round1(pr.bed_target_temper) },
        chamber: pr.chamber_temper != null ? { cur: round1(pr.chamber_temper), target: 0 } : null,
      },
      materials,
      fan: Array.isArray(pr.cooling_fan_speed) ? num(pr.cooling_fan_speed[0]) : null,
      speed: pr.spd_lvl != null ? num(pr.spd_lvl) : null,
      updatedAt: Date.now(), error: '',
    };
  }

  /**
   * 任务区块要不要显示。
   * 打印机在空闲时仍会留着上一次的文件名（快造 print_stats.filename、拓竹 subtask_name），
   * 直接显示就会变成「空闲中，但有个 0% 的任务」—— 判断「还在不在打印」时很误导。
   */
  _jobVisible(state) {
    return state === 'printing' || state === 'paused' || state === 'preparing' || state === 'finished';
  }

  _stateText(state) {
    return ({
      idle: '空闲', printing: '打印中', paused: '已暂停', preparing: '准备中',
      finished: '已完成', error: '出错', offline: '离线',
    })[state] || state;
  }

  _dropConnection(id) {
    const ent = this._bambu.get(id);
    if (ent && ent.client) { try { ent.client.close(); } catch (_) { /* 忽略 */ } }
    this._bambu.delete(id);
  }

  // ------------------------------------------------------------------ 控制

  /** @param {'pause'|'resume'|'stop'} cmd */
  async action(id, cmd) {
    const p = this.get(id);
    if (!p) throw new Error('找不到这台打印机');
    const map = { pause: 'pause', resume: 'resume', stop: 'stop' };
    if (!map[cmd]) throw new Error('不支持的操作：' + cmd);

    if (p.kind === 'snapmaker') {
      const mk = new Moonraker({ host: p.ip });
      if (cmd === 'pause') await mk.pause();
      else if (cmd === 'resume') await mk.resume();
      else await mk.cancel();
      setTimeout(() => { this._pollMoonraker(p).catch(() => {}); }, 800);
      return { ok: true };
    }

    const ent = this._bambu.get(p.id);
    if (!ent || !ent.client || !ent.client.connected) throw new Error('还没有连上这台打印机');
    ent.client.command(cmd === 'stop' ? 'stop' : cmd);
    return { ok: true };
  }

  /** 单台测试连接，返回可读结论 */
  async test(id) {
    const p = this.get(id);
    if (!p) throw new Error('找不到这台打印机');
    if (p.kind === 'snapmaker') {
      const mk = new Moonraker({ host: p.ip });
      const info = await mk.info();
      const st = info && info.result || {};
      return { ok: true, message: '连接成功 · ' + (st.hostname || p.ip) + ' · 固件 ' + (st.software_version || '—') };
    }
    return await new Promise((resolve) => {
      const client = new BambuMqtt({ host: p.ip, serial: p.serial, accessCode: p.accessCode, timeout: 5000 });
      let settled = false;
      const done = (r) => { if (settled) return; settled = true; try { client.close(); } catch (_) {} resolve(r); };
      client.on('connected', () => done({ ok: true, message: '认证通过，打印机在线' }));
      client.on('error', (e) => done({ ok: false, message: e.message }));
      setTimeout(() => done({ ok: false, message: '5 秒内没有响应，检查 IP 与局域网模式' }), 6000);
      client.connect();
    });
  }

  // ------------------------------------------------------------------ 发现

  /** 本机 IPv4 网段，例如 192.168.0 */
  _subnet() {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const a of ifs[name] || []) {
        if (a.family === 'IPv4' && !a.internal) {
          return a.address.split('.').slice(0, 3).join('.');
        }
      }
    }
    return '';
  }

  _probe(host, port, timeout = 420) {
    return new Promise((resolve) => {
      const s = new net.Socket();
      let done = false;
      const finish = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
      s.setTimeout(timeout);
      s.once('connect', () => finish(true));
      s.once('timeout', () => finish(false));
      s.once('error', () => finish(false));
      s.connect(port, host);
    });
  }

  /** 网络类错误：值得去扫一遍局域网看 IP 是不是变了 */
  _isNetError(e) {
    const c = (e && e.code) || '';
    return ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET'].includes(c)
      || /超时/.test((e && e.message) || '');
  }

  /**
   * 把底层错误翻成人话。用户看到的「connect ECONNREFUSED 192.168.1.101:8883」
   * 既不知道是什么意思，也不知道该动哪里。
   */
  _bambuErrorText(e, p, via = 'lan') {
    const code = (e && e.code) || '';
    const ip = (p && p.ip) || '';
    if (via === 'cloud') {
      // 云端通道的错误与打印机 IP 无关
      if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') {
        const host = this.cloud ? this.cloud.mqttHost() : 'cn.mqtt.bambulab.com';
        return '拓竹云 MQTT 连不上（' + host + '），稍后自动重试';
      }
      if (/认证失败/.test((e && e.message) || '')) {
        return '云端认证失败：账号 token 可能已过期，请重新登录拓竹账号';
      }
      return (e && e.message) || '云端连接失败';
    }
    if (code === 'ECONNREFUSED') {
      return '连不上 ' + ip + '：这个地址上没有局域网服务。多半是打印机换了 IP，'
        + '或者它现在走的是「云端模式」。处理：在打印机屏幕开启「局域网模式（LAN Only）」，'
        + '或点设备页「拓竹账号」登录改走云端通道';
    }
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
      return '打印机不在线（网络不可达）：' + ip + '。确认打印机已开机且与本机在同一网段；'
        + '若机器只连云端，可点设备页「拓竹账号」登录改走云端通道';
    }
    if (code === 'ETIMEDOUT' || /超时/.test((e && e.message) || '')) {
      return '连接 ' + ip + ' 超时：打印机可能休眠，或未开启『局域网模式』。'
        + '也可点设备页「拓竹账号」改走云端通道';
    }
    if (code === 'ECONNRESET') return '打印机断开了连接：' + ip;
    return (e && e.message) || '连接失败';
  }

  /** 按序列号在本网段找打印机（拓竹证书 CN = 序列号），返回新 IP 或空串 */
  async _findBambuBySerial(serial) {
    if (!serial) return '';
    const subnet = this._subnet();
    if (!subnet) return '';
    const hosts = [];
    for (let i = 1; i <= 254; i++) hosts.push(subnet + '.' + i);
    const cands = [];
    let idx = 0;
    await Promise.all(Array.from({ length: 32 }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= hosts.length) return;
        const h = hosts[i];
        if (await this._probe(h, 8883, 400)) cands.push(h);
      }
    }));
    const want = String(serial).toUpperCase();
    for (const h of cands) {
      const cn = await this._bambuSerial(h, 4000);
      if (cn && cn.toUpperCase() === want) return h;
    }
    return '';
  }

  /** 连不上时尝试自动纠正 IP（DHCP 换地址是很常见的事） */
  async _healBambuIp(p) {
    if (!p || !p.serial) return;
    const last = this._healAt.get(p.id) || 0;
    if (Date.now() - last < BAMBU_HEAL_MS) return;
    const tries = (this._healAt.get(p.id + ':n') || 0) + 1;
    if (tries > BAMBU_HEAL_MAX) return;
    this._healAt.set(p.id, Date.now());
    this._healAt.set(p.id + ':n', tries);
    const ip = await this._findBambuBySerial(p.serial);
    if (!ip || ip === p.ip) return;
    try {
      await this.update(p.id, { ip });
      const st = this._offline({ ...p, ip });
      st.state = 'connecting';
      st.stateText = '连接中';
      st.error = '打印机 IP 已变化，已自动从 ' + p.ip + ' 更新为 ' + ip + '，正在重连…';
      this._cache.set(p.id, st);
      this.emit('update', st);
    } catch (_) { /* 写设置失败就维持原状 */ }
  }

  /** 拓竹的证书 CN 就是序列号，顺手把序列号带回来 */
  _bambuSerial(host, timeout = 4000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      const sock = tls.connect({ host, port: 8883, rejectUnauthorized: false, timeout }, () => {
        const c = sock.getPeerCertificate() || {};
        const cn = (c.subject && c.subject.CN) || '';
        try { sock.destroy(); } catch (_) {}
        finish(/^[0-9A-Z]{12,20}$/i.test(cn) ? cn : '');
      });
      sock.on('error', () => finish(''));
      sock.on('timeout', () => { try { sock.destroy(); } catch (_) {} finish(''); });
      setTimeout(() => finish(''), timeout + 300);
    });
  }

  /** 从 Bambu Studio 自己的配置里取访问码（用户不用手抄） */
  _bambuAccessCode(serial) {
    const cands = [];
    if (process.env.APPDATA) {
      cands.push(path.join(process.env.APPDATA, 'BambuStudio', 'BambuStudio.conf'));
      cands.push(path.join(process.env.APPDATA, 'BambuStudioInternal', 'BambuStudio.conf'));
    }
    for (const f of cands) {
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      // 形如 "access_code": { "<序列号>": "<8 位访问码>" }
      const i = txt.indexOf('"access_code"');
      if (i < 0) continue;
      const seg = txt.slice(i, i + 2000);
      const m = new RegExp('"' + serial + '"\\s*:\\s*"([0-9a-fA-F]{6,12})"').exec(seg);
      if (m) return m[1];
    }
    return '';
  }

  /**
   * 扫本网段找打印机。只探测两个特征端口：
   *   7125 → Moonraker（快造 U1 等 Klipper 机器）
   *   8883 → 拓竹局域网 MQTT
   * 254 个地址、并发 48、单个 420ms，整轮 2~4 秒。
   */
  async discover({ timeout = 420, concurrency = 48 } = {}) {
    const subnet = this._subnet();
    if (!subnet) throw new Error('没有找到局域网地址，请检查网络连接');
    const hosts = [];
    for (let i = 1; i <= 254; i++) hosts.push(subnet + '.' + i);

    const found = [];
    let idx = 0;
    const worker = async () => {
      for (;;) {
        const i = idx++;
        if (i >= hosts.length) return;
        const host = hosts[i];
        const [mk, bb] = await Promise.all([this._probe(host, 7125, timeout), this._probe(host, 8883, timeout)]);
        if (mk) {
          let name = 'Klipper 打印机';
          try {
            const info = await new Moonraker({ host }).info();
            name = (info && info.result && info.result.hostname) || name;
          } catch (_) { /* 用默认名 */ }
          found.push({ kind: 'snapmaker', ip: host, name: '快造 ' + name, serial: '', accessCode: '', model: 'Snapmaker U1' });
        }
        if (bb) {
          const serial = await this._bambuSerial(host);
          found.push({
            kind: 'bambu', ip: host,
            name: '拓竹 ' + (serial ? serial.slice(-3) : ''),
            serial, accessCode: serial ? this._bambuAccessCode(serial) : '',
            model: 'Bambu Lab',
          });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    const known = new Set(this.list().map((p) => p.ip));
    return found.map((f) => Object.assign(f, { added: known.has(f.ip) }));
  }
}

module.exports = PrinterService;
module.exports.argbToHex = argbToHex;
module.exports.PRINTER_MODES = PRINTER_MODES;
