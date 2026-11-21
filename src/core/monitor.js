'use strict';
/**
 * 打印监控核心：温度/进度采样（曲线）+ 完成与异常的状态转移判定。
 *
 * 纯 Node，禁止 require('electron')。系统通知由主进程监听 'notify' 事件后发出，
 * 渲染层则通过 IPC 读这里的 session 数据画曲线。这样同一份逻辑既能跑在应用里，
 * 也能在 tests/monitor-tests.js 里用假时钟直接单测。
 *
 * 数据来源只有 PrinterService 的 'update' 推送（统一状态，见 printers.js 顶部契约）：
 *   · 快造 U1 每 3 秒轮询一次
 *   · 拓竹 MQTT 每次 report 推一次（可能 1 秒好几次，所以必须按 intervalSec 节流）
 *
 * 落盘：data/monitor/history.json，tmp + rename 原子写。一次打印 = 一个 session，
 * 最多保留 keepSessions 个、每个最多 MAX_POINTS 个点，数据 100% 留在本机。
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const cpaths = require('./paths');

const MAX_POINTS = 1800;             // 15 秒采样 ≈ 7.5 小时，够覆盖绝大多数打印
const DEFAULT_KEEP_SESSIONS = 24;
const FLUSH_EVERY_POINTS = 12;
const FLUSH_MIN_MS = 30000;
const NOTIFY_COOLDOWN_MS = 60000;    // 同类型、不同任务的通知至少隔 1 分钟，防 MQTT 抖动刷屏
const ACTIVE_STATES = new Set(['printing', 'paused', 'preparing']);

const DEFAULT_MONITOR = { enabled: true, intervalSec: 15, keepSessions: DEFAULT_KEEP_SESSIONS };
const DEFAULT_NOTIFY = {
  enabled: true, onFinished: true, onError: true, onPaused: true, system: true,
};

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round1(n) { return Math.round(n * 10) / 10; }

function safeText(v, fallback) {
  const s = String(v == null ? '' : v).trim();
  return s || fallback;
}

class PrinterMonitor extends EventEmitter {
  /**
   * @param {Object} o
   * @param {Object} [o.store]      Store 实例，读 monitor / notify 配置
   * @param {string} [o.dataDir]    历史文件目录（测试注入）
   * @param {Function} [o.now]      时钟（测试注入）
   * @param {EventEmitter} [o.printers] PrinterService；不传则由调用方自己调 onStatus
   */
  constructor(o = {}) {
    super();
    this.store = o.store || null;
    this.dir = o.dataDir ? path.resolve(String(o.dataDir)) : path.join(cpaths.getDataDir(), 'monitor');
    this.file = path.join(this.dir, 'history.json');
    this.now = typeof o.now === 'function' ? o.now : () => Date.now();
    this.sessions = [];
    this.active = new Map();          // printerId -> 进行中的 session（也在 sessions 里）
    this.lastState = new Map();       // printerId -> 上一次「在线」状态
    this.lastNotify = new Map();      // printerId -> { key, at }
    this.lastSampleAt = new Map();    // printerId -> 上次采样时间戳
    this.printers = o.printers || null;
    this._onUpdate = (p) => { try { this.onStatus(p); } catch (_) { /* 单条状态异常不影响轮询 */ } };
    this._started = false;
    this._dirty = false;
    this._pointsSinceFlush = 0;
    this._lastFlush = 0;
    this._loadError = '';
  }

  // ------------------------------------------------------------------ 配置

  config() {
    let s = {};
    try { s = (this.store && this.store.getSettings && this.store.getSettings()) || {}; }
    catch (_) { s = {}; }
    const m = Object.assign({}, DEFAULT_MONITOR, s.monitor || {});
    const n = Object.assign({}, DEFAULT_NOTIFY, s.notify || {});
    m.enabled = m.enabled !== false;
    m.intervalSec = clamp(Math.round(num(m.intervalSec, 15)), 5, 300);
    m.keepSessions = clamp(Math.round(num(m.keepSessions, DEFAULT_KEEP_SESSIONS)), 2, 100);
    n.enabled = n.enabled !== false;
    return { monitor: m, notify: n };
  }

  // ------------------------------------------------------------------ 生命周期

  start() {
    if (this._started) return this;
    this._started = true;
    this._load();
    if (this.printers && typeof this.printers.on === 'function') {
      this.printers.on('update', this._onUpdate);
    }
    return this;
  }

  stop() {
    if (!this._started) return;
    this._started = false;
    if (this.printers && typeof this.printers.removeListener === 'function') {
      this.printers.removeListener('update', this._onUpdate);
    }
    for (const id of Array.from(this.active.keys())) this._endSession(id);
    this.flush(true);
  }

  // ------------------------------------------------------------------ 状态入口

  /** PrinterService 每次推统一状态都走这里：先判通知，再采样 */
  onStatus(p) {
    if (!p || !p.id) return;
    this._checkNotify(p);
    this._sample(p);
  }

  // ------------------------------------------------------------------ 通知判定

  /**
   * 只在「在线 → 在线」的状态转移上通知，且每个任务每种类型只发一次。
   * 离线/连接中这类中间态直接跳过、也不覆盖 lastState：
   * MQTT 断线重连时会推一连串 offline → online，否则会重复弹「已完成」。
   */
  _checkNotify(p) {
    const { notify } = this.config();
    // 注意：notify.enabled 只管通知，不管回执。关掉通知时下面仍要发 'job' 事件，
    // 否则用户关了通知就永远没有打印记录（docs/13）。
    if (!p.online) return;
    const prev = this.lastState.get(p.id);
    this.lastState.set(p.id, p.state);
    if (!prev || prev === p.state) return;    // 首次见到这台机器不发「历史通知」

    let kind = '';
    if (p.state === 'finished' && ACTIVE_STATES.has(prev)) kind = 'finished';
    else if (p.state === 'error') kind = 'error';
    else if (p.state === 'paused' && prev === 'printing') kind = 'paused';
    if (!kind) return;

    const flag = { finished: 'onFinished', error: 'onError', paused: 'onPaused' }[kind];
    const jobName = safeText(p.job && p.job.name, '当前任务');
    const at = this.now();

    // 打印回执（13）：独立事件，不受通知分项开关影响——即使关掉了所有通知，
    // 完成/失败也要照常记账。暂停不落回执（不是一次打印的终态）。
    if (kind === 'finished' || kind === 'error') {
      const ses = this.active.get(p.id);
      this.emit('job', {
        printerId: p.id,
        printerName: safeText(p.name, '打印机'),
        result: kind,
        jobName,
        at,
        startedAt: ses && ses.startedAt ? ses.startedAt : at,
      });
    }

    if (notify.enabled === false || notify[flag] === false) return;
    const key = kind + '|' + jobName;
    // 去重规则：同一个任务的同一种提醒永远只发一次；
    // **不同类型之间不互相冷却** —— 打完立刻报错、或者打印中先断料再报错都该各提醒一次，
    // 早年用「60 秒内一律不重复」会把这些真正重要的连续事件吞掉。
    // 冷却只用来压住「同一类型、不同任务名」在 MQTT 抖动时的刷屏。
    const last = this.lastNotify.get(p.id);
    if (last) {
      if (last.key === key) return;
      if (last.kind === kind && at - last.at < NOTIFY_COOLDOWN_MS) return;
    }
    this.lastNotify.set(p.id, { key, kind, at });

    const name = safeText(p.name, '打印机');
    const msg = {
      finished: { title: '打印完成 · ' + name, body: jobName + ' 已经打完了，可以去取件。' },
      error: { title: '打印异常 · ' + name, body: jobName + ' 报错了，建议到「设备」页看一下状态。' },
      paused: { title: '打印已暂停 · ' + name, body: jobName + ' 暂停了，可能是断料或需要人工确认。' },
    }[kind];
    this.emit('notify', {
      printerId: p.id, printerName: name, kind, jobName, at,
      title: msg.title, body: msg.body,
      system: notify.system !== false,
    });
  }

  /** 设置页「发一条测试通知」用：绕开状态机，直接走同一条出口 */
  testNotify() {
    const { notify } = this.config();
    const at = this.now();
    const payload = {
      printerId: '__test__', printerName: 'PrintShelf', kind: 'test', jobName: '', at,
      title: 'PrintShelf 通知测试',
      body: '看到这条就说明系统通知已经打通了。',
      system: notify.system !== false,
    };
    this.emit('notify', payload);
    return payload;
  }

  // ------------------------------------------------------------------ 采样

  _sample(p) {
    const { monitor } = this.config();
    if (!monitor.enabled || !p.online) { this._endSession(p.id); return; }
    const live = ACTIVE_STATES.has(p.state) && !!p.job;
    if (!live) { this._endSession(p.id); return; }

    const t = this.now();
    const jobName = safeText(p.job && p.job.name, '未命名任务');
    let ses = this.active.get(p.id);
    if (!ses || ses.endedAt || ses.jobName !== jobName) {
      this._endSession(p.id);
      ses = this._newSession(p, jobName, t);
    }

    const last = this.lastSampleAt.get(p.id) || 0;
    if (ses.points.length && t - last < monitor.intervalSec * 1000) return;
    this.lastSampleAt.set(p.id, t);

    const temps = p.temps || {};
    const nozzle = temps.nozzle || {};
    const bed = temps.bed || {};
    // 紧凑数组而不是对象：一次 7 小时的打印 ~1800 点，对象会多出十几倍体积
    ses.points.push([
      t,
      clamp(Math.round(num(p.job.percent)), 0, 100),
      round1(num(nozzle.cur)), round1(num(nozzle.target)),
      round1(num(bed.cur)), round1(num(bed.target)),
    ]);
    if (ses.points.length > MAX_POINTS) ses.points.shift();
    ses.updatedAt = t;
    this._dirty = true;
    this._pointsSinceFlush++;
    if (this._pointsSinceFlush >= FLUSH_EVERY_POINTS || t - this._lastFlush >= FLUSH_MIN_MS) {
      this.flush(true);
    }
  }

  _newSession(p, jobName, t) {
    const { monitor } = this.config();
    const ses = {
      id: 'ses-' + t.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      printerId: p.id,
      printerName: safeText(p.name, '打印机'),
      jobName,
      startedAt: t,
      updatedAt: t,
      endedAt: 0,
      points: [],
    };
    this.sessions.push(ses);
    while (this.sessions.length > monitor.keepSessions) {
      const dropped = this.sessions.shift();
      if (dropped && this.active.get(dropped.printerId) === dropped) this.active.delete(dropped.printerId);
    }
    this.active.set(p.id, ses);
    this.lastSampleAt.delete(p.id);   // 新任务的第一个点不能被上一个任务的节流挡住
    this._dirty = true;
    return ses;
  }

  _endSession(id) {
    const ses = this.active.get(id);
    if (!ses) return;
    ses.endedAt = this.now();
    this.active.delete(id);
    this.lastSampleAt.delete(id);
    this._dirty = true;
    // 没有采到点的 session 不留着占位（例如刚切到 preparing 就立刻 cancel）
    if (!ses.points.length) {
      const i = this.sessions.indexOf(ses);
      if (i >= 0) this.sessions.splice(i, 1);
    }
    this.flush(true);
  }

  // ------------------------------------------------------------------ 落盘

  _load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const list = raw && Array.isArray(raw.sessions) ? raw.sessions : [];
      const { monitor } = this.config();
      this.sessions = list.filter((s) => s && typeof s === 'object'
        && Array.isArray(s.points) && typeof s.printerId === 'string')
        .map((s) => ({
          id: safeText(s.id, 'ses-unknown'),
          printerId: s.printerId,
          printerName: safeText(s.printerName, '打印机'),
          jobName: safeText(s.jobName, '未命名任务'),
          startedAt: num(s.startedAt),
          updatedAt: num(s.updatedAt, num(s.startedAt)),
          endedAt: num(s.endedAt),
          points: s.points.filter((p) => Array.isArray(p) && p.length >= 6),
        }))
        .slice(-monitor.keepSessions);
      // 上次是异常退出：磁盘上的 session 还标着进行中，这里统一收尾
      for (const s of this.sessions) {
        if (!s.endedAt) s.endedAt = s.updatedAt || s.startedAt;
      }
    } catch (e) {
      this._loadError = (e && e.message) || String(e);
      this.sessions = [];
    }
  }

  flush(force) {
    if (!this._dirty && !force) return { ok: false, reason: 'no-change' };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        version: 1, updatedAt: this.now(), sessions: this.sessions,
      }), 'utf8');
      fs.renameSync(tmp, this.file);
      this._dirty = false;
      this._pointsSinceFlush = 0;
      this._lastFlush = this.now();
      return { ok: true, sessions: this.sessions.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // ------------------------------------------------------------------ 查询

  /** 给设置页/曲线弹窗：按开始时间倒序，可选按设备过滤 */
  history(printerId, limit = 12) {
    const n = clamp(Math.round(num(limit, 12)), 1, 100);
    return this.sessions
      .filter((s) => !printerId || s.printerId === printerId)
      .slice(-n)
      .reverse()
      .map((s) => JSON.parse(JSON.stringify(s)));
  }

  latest(printerId) {
    const list = this.sessions.filter((s) => !printerId || s.printerId === printerId);
    const s = list[list.length - 1];
    return s ? JSON.parse(JSON.stringify(s)) : null;
  }

  /** 清空历史。不传 printerId = 全部清空；返回删掉的 session 数 */
  clear(printerId) {
    const before = this.sessions.length;
    if (printerId) {
      this.sessions = this.sessions.filter((s) => s.printerId !== printerId);
      const ses = this.active.get(printerId);
      if (ses && !this.sessions.includes(ses)) this.active.delete(printerId);
    } else {
      this.sessions = [];
      this.active.clear();
    }
    this._dirty = true;
    this.flush(true);
    return { cleared: before - this.sessions.length };
  }

  status() {
    return {
      running: this._started,
      file: this.file,
      sessions: this.sessions.length,
      points: this.sessions.reduce((n, s) => n + s.points.length, 0),
      active: Array.from(this.active.keys()),
      loadError: this._loadError,
      intervalSec: this.config().monitor.intervalSec,
    };
  }
}

// ------------------------------------------------------------------ 曲线模型

/**
 * 把一条 session 转成画图需要的坐标数据（纯函数，不碰 DOM）。
 * 双轴：左 = 温度 0..tempMax（℃），右 = 进度 0..100%；横向 = 真实时间。
 * 返回的对象里路径已拼好，渲染层只负责套 <svg> 外壳与图例。
 */
function buildChartModel(session, opts = {}) {
  const W = num(opts.width, 760);
  const H = num(opts.height, 260);
  const pad = { l: 42, r: 44, t: 16, b: 28 };
  const plot = { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: H - pad.t - pad.b };
  const points = (session && Array.isArray(session.points)) ? session.points : [];

  let tempPeak = 0;
  for (const p of points) {
    for (const i of [2, 3, 4, 5]) tempPeak = Math.max(tempPeak, num(p[i]));
  }
  // 轴上限向上取整到 50℃，且至少 100℃，避免全是室温时曲线贴着天花板
  const tempMax = Math.max(100, Math.ceil((tempPeak + 10) / 50) * 50);
  const t0 = points.length ? num(points[0][0]) : 0;
  const t1 = points.length ? Math.max(t0 + 60000, num(points[points.length - 1][0])) : t0 + 60000;
  const span = Math.max(1, t1 - t0);

  const xOf = (t) => plot.x + (num(t) - t0) / span * plot.w;
  const yTemp = (v) => plot.y + plot.h - clamp(num(v), 0, tempMax) / tempMax * plot.h;
  const yPct = (v) => plot.y + plot.h - clamp(num(v), 0, 100) / 100 * plot.h;

  const make = (key, label, color, idx, mapper, dashed) => {
    const coords = points.map((p) => ({
      x: round1(xOf(p[0])), y: round1(mapper(p[idx])), v: num(p[idx]), t: num(p[0]),
    }));
    return {
      key, label, color, dashed: !!dashed,
      path: coords.length ? 'M ' + coords.map((c) => c.x + ',' + c.y).join(' L ') : '',
      points: coords,
      last: coords.length ? coords[coords.length - 1].v : null,
    };
  };

  const series = [
    make('nozzle', '喷嘴', '#f97316', 2, yTemp, false),
    make('nozzleTarget', '喷嘴目标', '#fdba74', 3, yTemp, true),
    make('bed', '热床', '#3b82f6', 4, yTemp, false),
    make('progress', '进度', '#10b981', 1, yPct, false),
  ];

  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const y = round1(plot.y + plot.h * i / 4);
    grid.push({ y, tempLabel: String(Math.round(tempMax * (4 - i) / 4)), pctLabel: String(100 - i * 25) });
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    x: round1(plot.x + plot.w * r), t: t0 + span * r,
  }));

  const lastPoint = points.length ? points[points.length - 1] : null;
  return {
    width: W, height: H, plot, tempMax, t0, t1, series, grid, ticks,
    empty: !points.length,
    stats: {
      count: points.length,
      durationMin: points.length ? Math.round((num(lastPoint[0]) - t0) / 60000) : 0,
      percent: lastPoint ? num(lastPoint[1]) : 0,
      nozzleMax: points.reduce((m, p) => Math.max(m, num(p[2])), 0),
      bedMax: points.reduce((m, p) => Math.max(m, num(p[4])), 0),
    },
  };
}

module.exports = {
  PrinterMonitor, buildChartModel,
  MAX_POINTS, DEFAULT_MONITOR, DEFAULT_NOTIFY,
};
