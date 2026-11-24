'use strict';
/**
 * 快造 U1 转换 · 编排层（契约 U1-D3）。
 * 纯 Node 实现：禁止 require('electron')。
 *
 * 职责：
 *   1. 算缓存键、决定输出路径
 *   2. 把重活丢给 worker 线程（主进程只收进度，界面不冻）
 *   3. 解析用户预设并展开成按槽位键值
 *   4. 缓存管理
 *
 * 安全：源文件只读，产物只写进 <数据目录>/u1-cache/。
 */
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const corePaths = require('./paths');
const OrcaPresets = require('./orcapresets');

// worker 必须放在 src/core 下：它属于运行时核心，打包时随 src/ 一起进 resources/app。
// （早前放在 tools/u1/ 而打包脚本排除 tools/，导致绿色版转换直接失败，2026-11-19 修正）
const WORKER = path.resolve(__dirname, 'u1-worker.js');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

function safeFileName(s) {
  return String(s || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'model';
}

class U1Converter extends EventEmitter {
  constructor({ store, presets } = {}) {
    super();
    this.store = store || null;
    this.presets = presets || new OrcaPresets({ store });
    this._worker = null;
    this._inflight = new Map();   // key -> Promise，同一任务不重复起 worker
    this._cancelCurrent = null;   // 当前 worker 的统一取消入口
    this._jobId = 0;
  }

  // ------------------------------------------------------------------ 配置

  settings() {
    const s = (this.store && this.store.getSettings && this.store.getSettings()) || {};
    const u1 = (s && s.u1) || {};
    return {
      openWith: u1.openWith || 'ask',
      filamentPreset: u1.filamentPreset || '',
      processPreset: u1.processPreset || '',
      cacheKeepDays: Number.isFinite(u1.cacheKeepDays) ? u1.cacheKeepDays : 30,
      // 源文件超过 4 色时：默认保留全部颜色（用户 2026-11-24 决定）。
      // 引擎默认会把颜色压到 4 槽，而它对「整模涂色」的模型只能按对象级 extruder 统计，
      // 用量全是 0，于是按顺序把白色/橙色这类大面积色并掉，转换后颜色明显对不上。
      keepAllColours: u1.keepAllColours !== false,
    };
  }

  cacheDir() {
    return path.join(corePaths.getDataDir(), 'u1-cache');
  }

  ensureCacheDir() {
    const d = this.cacheDir();
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /**
   * 缓存键：源路径 + 修改时间 + 大小 + 两个预设名。
   * 源文件被重新下载/编辑，或换了预设，键就变，自动失效。
   */
  cacheKey(srcPath, { filamentPreset, processPreset, keepAllColours }) {
    let mtime = 0, size = 0;
    try {
      const st = fs.statSync(srcPath);
      mtime = st.mtimeMs; size = st.size;
    } catch (_) { /* 不存在时由上层报错 */ }
    // keepAllColours 必须进键：以前生成的「压成 4 色」缓存不能当成「保留全部颜色」的结果复用。
    const keep = keepAllColours === false ? 'reduce' : 'keep';
    return sha1([srcPath, mtime, size, filamentPreset || '', processPreset || '', keep].join('|')).slice(0, 16);
  }

  cachePathFor(srcPath, key) {
    return path.join(this.cacheDir(), safeFileName(path.basename(srcPath)) + '_U1_' + key.slice(0, 8) + '.3mf');
  }

  /** 已缓存且比源文件新，才算命中 */
  cachedFor(srcPath, opts) {
    const key = this.cacheKey(srcPath, opts);
    const out = this.cachePathFor(srcPath, key);
    try {
      if (!fs.existsSync(out)) return null;
      const so = fs.statSync(out), ss = fs.statSync(srcPath);
      if (so.size <= 0) return null;
      if (so.mtimeMs < ss.mtimeMs) return null; // 源比产物新 → 过期
      const metaPath = out.replace(/\.3mf$/i, '.json');
      let report = null;
      try { report = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { /* 没有元信息也能用 */ }
      return { outPath: out, key, report, cached: true };
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------------------ 预设

  /** 解析预设 → 按槽位展开的键值；解析不到就返回 null（不阻断转换，只是标一下） */
  _presetValues(kind, name, slots) {
    if (!name) return { values: null, found: false };
    try {
      const flat = this.presets.toSlotValues(kind, name, slots);
      if (!flat) return { values: null, found: false };
      return { values: flat, found: true };
    } catch (_) {
      return { values: null, found: false };
    }
  }

  listFilamentPresets() { return this.presets.list('filament'); }
  listProcessPresets() { return this.presets.list('process'); }
  presetSummary(kind, name) { return this.presets.summary(kind, name); }
  orcaInstallDir() { return this.presets.installDir(); }

  /**
   * 这个文件是不是本来就是快造的项目？是的话打开就不必再转一遍。
   * 只解压配置条目，不动几何。
   */
  isAlreadyU1(srcPath) {
    try {
      const { sourcePrinterName } = require('./u1patch');
      const name = sourcePrinterName(srcPath);
      return !!name && /snapmaker|\bU1\b/i.test(String(name));
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------------ 转换

  /**
   * 转换单个文件；已有缓存且 opts.force 不为真时直接返回缓存。
   * @returns {Promise<{outPath,key,report,cached}>}
   */
  async convert(srcPath, opts = {}) {
    const cfg = this.settings();
    const filamentPreset = opts.filamentPreset != null ? opts.filamentPreset : cfg.filamentPreset;
    const processPreset = opts.processPreset != null ? opts.processPreset : cfg.processPreset;
    const keepAllColours = opts.keepAllColours != null ? !!opts.keepAllColours : cfg.keepAllColours;

    if (!srcPath || !fs.existsSync(srcPath)) throw new Error('模型文件不存在：' + srcPath);
    if (!/\.3mf$/i.test(srcPath)) throw new Error('只有 .3mf 文件需要转换（当前文件：' + path.basename(srcPath) + '）');

    const plan = { filamentPreset, processPreset, keepAllColours };
    if (!opts.force) {
      const hit = this.cachedFor(srcPath, plan);
      if (hit) {
        this.emit('progress', { stage: 'cache', message: '使用已转换的副本', percent: 100 });
        return hit;
      }
    }

    this.ensureCacheDir();
    const key = this.cacheKey(srcPath, plan);
    const outPath = this.cachePathFor(srcPath, key);

    // 同一份源文件 + 同一套预设，同一时刻只允许一个转换任务。
    // 否则双击/批量打开会起两个 worker，同时往同一个 outPath 写 .part 再各自 rename，
    // 轻则白做功，重则拿到半写文件；cancel() 也会终止错的那一个。
    const running = this._inflight.get(key);
    if (running) return running;
    const task = this._runConvert({ srcPath, outPath, key, opts, filamentPreset, processPreset, keepAllColours, timeoutMs: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS });
    this._inflight.set(key, task);
    try {
      return await task;
    } finally {
      this._inflight.delete(key);
    }
  }

  /** 真正起 worker 的那一段（已被 convert 的 in-flight 表串行化） */
  async _runConvert({ srcPath, outPath, key, opts, filamentPreset, processPreset, keepAllColours, timeoutMs }) {

    // 预设展开：槽位数取 U1 的工具头数 4
    const fil = this._presetValues('filament', filamentPreset, 4);
    const proc = this._presetValues('process', processPreset, 4);
    if (filamentPreset && !fil.found) {
      this.emit('log', { level: 'warn', message: '找不到耗材预设「' + filamentPreset + '」，本次只写入名字、不合并参数' });
    }

    const jobId = ++this._jobId;

    return await new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const worker = new Worker(WORKER, {
        workerData: {
          srcPath,
          outPath,
          options: {
            filamentPreset: filamentPreset || '',
            filamentValues: fil.values,
            processPreset: processPreset || '',
            processValues: proc.values,
            keepAllColours: keepAllColours !== false,
          },
        },
        resourceLimits: { maxOldGenerationSizeMb: 4096 },
      });
      this._worker = worker;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this._cancelCurrent && this._cancelCurrent.key === key) this._cancelCurrent = null;
        this._worker = null;
        try { worker.terminate(); } catch (_) { /* 已结束 */ }
        fn(arg);
      };

      // 取消走同一个 finish 出口：统一 reject「已取消」，不让 exit 事件误报「线程提前退出」。
      this._cancelCurrent = {
        key,
        cancel: () => {
          this.emit('cancelled', { key });
          finish(reject, new Error('已取消'));
        },
      };

      timer = setTimeout(() => {
        finish(reject, new Error('转换超时（超过 ' + Math.round(timeoutMs / 1000) + ' 秒）。文件可能过大，或引擎卡住。'));
      }, timeoutMs);

      worker.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.ok === true) {
          // 写一份元信息，便于缓存命中时仍能显示「上次转了什么」
          try {
            fs.writeFileSync(outPath.replace(/\.3mf$/i, '.json'), JSON.stringify({
              ...msg.report,
              presetFound: { filament: fil.found, process: proc.found },
              at: new Date().toISOString(),
              srcPath,
            }, null, 2), 'utf8');
          } catch (_) { /* 元信息写失败不影响产物 */ }
          finish(resolve, { outPath, key, report: msg.report, cached: false });
          return;
        }
        if (msg.ok === false) {
          finish(reject, new Error(msg.error || '转换失败（引擎未给出原因）'));
          return;
        }
        if (msg.stage) {
          this.emit('progress', { jobId, ...msg });
        }
      });

      worker.on('error', (e) => {
        finish(reject, new Error('转换线程异常：' + (e && e.message ? e.message : String(e))));
      });
      worker.on('exit', (code) => {
        if (settled) return;
        // 正常流程里 worker 在 postMessage 后会被 terminate，code 可能是 1；
        // 只有「从没收到结果就退出」才算失败。
        finish(reject, new Error('转换线程提前退出（退出码 ' + code + '），没有产出结果'));
      });
    });
  }

  /** 只要产物，不管缓存来源。给「用快造打开」用。 */
  async ensureConverted(srcPath, opts = {}) {
    return this.convert(srcPath, opts);
  }

  cancel() {
    const cur = this._cancelCurrent;
    if (cur) {
      // 先 reject 约定文案，再由 finish 统一 terminate / 清 _worker；
      // 直接 terminate 会先触发 exit，旧代码据此报「线程提前退出」。
      cur.cancel();
      // convert() 的 finally 会清 _inflight；这里兜底，防止取消时 finally 尚未执行。
      if (this._inflight.get(cur.key)) this._inflight.delete(cur.key);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ 缓存

  cacheStats() {
    const dir = this.cacheDir();
    const out = { dir, count: 0, bytes: 0, oldest: null, newest: null };
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { return out; }
    for (const f of files) {
      if (!/\.3mf$/i.test(f)) continue;
      try {
        const st = fs.statSync(path.join(dir, f));
        out.count++;
        out.bytes += st.size;
        if (!out.oldest || st.mtimeMs < out.oldest) out.oldest = st.mtimeMs;
        if (!out.newest || st.mtimeMs > out.newest) out.newest = st.mtimeMs;
      } catch (_) { /* 跳过 */ }
    }
    return out;
  }

  /** 清缓存；传 days 则只清比它旧的 */
  clearCache({ days = 0 } = {}) {
    const dir = this.cacheDir();
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { return { removed: 0, bytes: 0 }; }
    const cutoff = days > 0 ? Date.now() - days * 86400000 : Infinity;
    let removed = 0, bytes = 0;
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) continue;
        if (days > 0 && st.mtimeMs >= cutoff) continue;
        bytes += st.size;
        fs.unlinkSync(full);
        removed++;
      } catch (_) { /* 跳过占用中的文件 */ }
    }
    return { removed, bytes };
  }
}

module.exports = U1Converter;
module.exports.U1Converter = U1Converter;
