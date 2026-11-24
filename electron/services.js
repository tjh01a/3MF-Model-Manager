'use strict';
/**
 * 主进程服务容器：装配全部 core 模块，统一事件出口，并提供目录/扫描/撤销等聚合能力。
 * core 层完全不知道 Electron 的存在，这里是唯一的粘合层。
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const Store = require('../src/core/store');
const LibraryService = require('../src/core/library');
const ThumbnailService = require('../src/core/thumbs');
const Scanner = require('../src/core/scanner');
const SlicerService = require('../src/core/slicer');
const FolderWatcher = require('../src/core/watcher');
const cpaths = require('../src/core/paths');
const U = require('../src/core/utils');
const { MeshOptimizer } = require('../src/core/meshopt');
const mesh3mf = require('../src/core/mesh3mf');
const OrcaPresets = require('../src/core/orcapresets');
const { BambuCloud } = require('../src/core/bambucloud');
const PresetGuard = require('../src/core/presetguard');
const PrinterService = require('../src/core/printers');
const { PrinterMonitor, buildChartModel } = require('../src/core/monitor');
const U1Converter = require('../src/core/u1convert');
const { FilamentService, sniffImageExt } = require('../src/core/filaments');
const { ReceiptService, matchModel, matchModelFuzzy } = require('../src/core/receipts');
const cost = require('../src/core/cost');

class Services extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this._undoStack = [];
    this._scanning = false;
    // 模型优化引擎：纯 Node，可独立于窗口生命周期使用
    this.meshopt = new MeshOptimizer();
    this._autoWatch = true;
    this._bgStarted = false;
  }

  /** 主进程 → 渲染层的统一事件出口 */
  emitToRenderer(channel, payload) { this.emit('event', channel, payload); }

  async init({ autoWatch = true, onStage = null } = {}) {
    if (this.initialized) return this;
    const stage = (name, percent) => { if (typeof onStage === 'function') onStage(name, percent); };
    cpaths.ensureDirs();

    stage('dirs', 15);
    this.store = new Store({});
    await this.store.init();
    stage('store', 34);
    this.library = new LibraryService({ store: this.store });
    // 耗材库 / 回执：独立文件，不进 library 备份机制（用户 2026-11-16 确认）
    this.filaments = new FilamentService();
    await this.filaments.init();
    this.receipts = new ReceiptService();
    await this.receipts.init();
    stage('data', 48);
    this.thumbs = new ThumbnailService({ store: this.store });
    this.scanner = new Scanner({ store: this.store, thumbs: this.thumbs });
    this.slicer = new SlicerService({ store: this.store });
    // 快造 U1 转换：预设解析 + 转换编排（转换本身跑在 worker 线程里）
    this.orcapresets = new OrcaPresets({ store: this.store });
    this.presetguard = new PresetGuard({ store: this.store, presets: this.orcapresets });
    this.u1 = new U1Converter({ store: this.store, presets: this.orcapresets });
    // 拓竹云：账号登录（换 token）+ 绑定设备列表。token 存 settings.bambuCloud，密码不落盘。
    this.bambuCloud = new BambuCloud({ store: this.store });
    // 打印机管理：快造走 Moonraker 轮询、拓竹走 MQTT 长连接（局域网优先，云端兜底），统一成一套状态
    this.printers = new PrinterService({ store: this.store, cloud: this.bambuCloud });
    this.printers.on('update', (p) => this.emitToRenderer('printers:update', p));
    this.printers.on('changed', (c) => this.emitToRenderer('printers:changed', c));
    // 打印监控：同一份状态推送顺手做曲线采样与「完成/异常」判定。
    // 系统通知不在这里发（core 不碰 Electron），统一走 'printers:notify' 事件出口，
    // main.js 订阅后决定要不要弹系统通知。
    this.monitor = new PrinterMonitor({ store: this.store, printers: this.printers });
    this.monitor.on('notify', (n) => this.emitToRenderer('printers:notify', n));
    // 打印回执：终态落盘 +（用户确认）成功时自动把匹配到的模型标为已打印
    this.monitor.on('job', (j) => { this._onPrintJob(j).catch(() => {}); });
    this.monitor.start();
    this.watcher = new FolderWatcher({
      store: this.store,
      scanner: this.scanner,
      onChanged: (type, p) => this.emitToRenderer('watcher:changed', { type, path: p }),
    });

    // ---- 事件桥接 ----
    this.scanner.on('progress', (p) => this.emitToRenderer('scan:progress', p));
    this.scanner.on('done', (report) => {
      this._scanning = false;
      this.emitToRenderer('scan:done', report);
    });
    this.scanner.on('error', (e) => this.emitToRenderer('app:error', {
      message: '扫描出错：' + (e && e.message ? e.message : String(e)),
    }));
    this.scanner.on('error', () => { this._scanning = false; });
    this.store.on('change', (p) => this.emitToRenderer('lib:changed', p || { reason: 'update' }));
    this.store.on('settings', () => { /* 设置由设置页自行重取，避免整库刷新 */ });
    this.store.on('error', (e) => this.emitToRenderer('app:toast', {
      type: 'warn', message: (e && e.message) || '本地数据写入异常',
    }));

    // 模型优化：主进程 → 渲染层的进度/日志/完成/失败事件
    this.meshopt.on('progress', (p) => this.emitToRenderer('mesh:progress', p));
    this.meshopt.on('log', (p) => this.emitToRenderer('mesh:log', p));
    this.meshopt.on('done', (p) => this.emitToRenderer('mesh:done', p));
    this.meshopt.on('error', (p) => this.emitToRenderer('mesh:error', p));

    // 快造 U1 转换：进度 / 日志
    this.u1.on('progress', (p) => this.emitToRenderer('u1:progress', p));
    this.u1.on('log', (p) => this.emitToRenderer('u1:log', p));
    this.u1.on('cancelled', () => this.emitToRenderer('u1:cancelled', {}));

    // 切片软件打开成功后记录"最近使用"
    this.slicer.on('opened', async ({ ids } = {}) => {
      for (const id of ids || []) {
        try { await this.library.markOpened(id); } catch (_) { /* 忽略单条 */ }
      }
    });

    // 目录监视不进启动关键路径：chokidar 的初始递归扫描在机械盘 / 网络盘上可能很慢。
    // 这里只记下意图，由 main.js 在首屏画完后调用 startBackground()。
    this._autoWatch = !!autoWatch;
    stage('services', 64);

    this.initialized = true;
    return this;
  }

  /**
   * 首屏画完后再启动目录监视。幂等：重复调用只会真正执行一次。
   * 用户设置里关掉自动监视时不启动，与原来的行为一致。
   */
  startBackground() {
    if (!this.initialized || this._bgStarted || !this._autoWatch || !this.watcher) return;
    this._bgStarted = true;
    const s = this.store.getSettings();
    if (s && s.scan && s.scan.autoWatch === false) return;
    try { this.watcher.start(); } catch (e) {
      this.emitToRenderer('app:toast', { type: 'warn', message: '目录自动监视启动失败：' + e.message });
    }
  }

  async shutdown() {
    // 先停采样并把队列里的曲线点落盘，再断打印机连接
    try { if (this.monitor) this.monitor.stop(); } catch (_) { /* 忽略 */ }
    try { if (this.printers) this.printers.stop(); } catch (_) { /* 忽略 */ }
    try { if (this.watcher) await this.watcher.stop(); } catch (_) { /* 忽略 */ }
    try { if (this.store) await this.store.saveLibrary(); } catch (_) { /* 忽略 */ }
  }

  // ---------------- 目录管理 ----------------

  folders() {
    const s = this.store.getSettings();
    return (s.folders || []).slice();
  }

  /**
   * 列出本机可用盘符（首次启动向导选扫描范围用）。
   * 只用 fs 探测，不依赖 wmic / PowerShell，打包后也能正常跑。
   * @returns {Promise<Array<{letter, path, total, free, system}>>}
   */
  async drivesList() {
    const sysLetter = String(process.env.SystemDrive || 'C:').slice(0, 1).toUpperCase();
    const out = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = letter + ':\\';
      try {
        if (!fs.statSync(root).isDirectory()) continue;
      } catch (_) { continue; }
      let total = null;
      let free = null;
      try {
        if (typeof fs.promises.statfs === 'function') {
          const st = await fs.promises.statfs(root);
          total = Number(st.blocks) * Number(st.bsize);
          free = Number(st.bavail) * Number(st.bsize);
        }
      } catch (_) { /* 网络盘 / 权限受限时只显示盘符 */ }
      out.push({ letter: letter + ':', path: root, total, free, system: letter === sysLetter });
    }
    return out;
  }

  async folderAdd(dir) {
    const p = U.normalizePath(dir);
    let stat;
    try { stat = fs.statSync(p); } catch (_) { stat = null; }
    if (!stat || !stat.isDirectory()) throw new Error('目录不存在或不是文件夹：' + p);
    const folders = this.folders();
    const existed = folders.find((f) => U.pathKey(f.path) === U.pathKey(p));
    if (existed) return existed;
    const folder = {
      id: U.uid('fld'), path: p, enabled: true, recursive: true,
      addedAt: U.now(), lastScanAt: null,
    };
    folders.push(folder);
    await this.store.updateSettings({ folders });
    this.refreshWatch();
    return folder;
  }

  async folderUpdate(id, patch = {}) {
    const folders = this.folders();
    const i = folders.findIndex((f) => String(f.id) === String(id));
    if (i < 0) throw new Error('找不到该监控目录');
    folders[i] = { ...folders[i], ...patch, id: folders[i].id };
    await this.store.updateSettings({ folders });
    this.refreshWatch();
    return folders[i];
  }

  async folderRemove(id) {
    const before = this.folders();
    const folders = before.filter((f) => String(f.id) !== String(id));
    if (folders.length === before.length) throw new Error('找不到该监控目录');
    // 安全：仅停止监视，不删除已有索引与任何人工元数据
    await this.store.updateSettings({ folders });
    this.refreshWatch();
    return { removed: 1 };
  }

  refreshWatch() {
    try { if (this.watcher) this.watcher.refresh(); } catch (_) { /* 忽略 */ }
  }

  // ---------------- 扫描 ----------------

  async scanStart({ folderIds, force = false } = {}) {
    if (this._scanning || this.scanner.getStatus().running) {
      return { started: false, reason: '正在扫描中，请稍候' };
    }
    this._scanning = true;
    setImmediate(async () => {
      try {
        await this.scanner.scanAll({ folderIds, force: !!force });
      } catch (e) {
        this._scanning = false;
        const msg = '扫描失败：' + (e && e.message ? e.message : String(e));
        this.emitToRenderer('app:error', { message: msg });
        this.emitToRenderer('scan:done', {
          added: 0, updated: 0, unchanged: 0, missing: 0, failed: 0, duration: 0,
          files: [], duplicateGroups: 0, error: msg,
        });
      }
    });
    return { started: true };
  }

  scanStatus() {
    const s = this.scanner.getStatus();
    return { ...s, running: !!(s.running || this._scanning) };
  }

  // ---------------- 撤销栈 ----------------

  /** 写操作前记录受影响记录的完整快照；null 表示该记录原本不存在 */
  snapshot(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const models = this.store.getLibrary().models || {};
    const records = {};
    for (const id of list) {
      records[id] = models[id] ? JSON.parse(JSON.stringify(models[id])) : null;
    }
    this._undoStack.push({ ids: list, records, at: Date.now() });
    if (this._undoStack.length > 30) this._undoStack.shift();
  }

  async undo() {
    const snap = this._undoStack.pop();
    if (!snap) return { ok: false, reason: '没有可撤销的操作' };
    await this.store.updateLibrary((lib) => {
      for (const [id, rec] of Object.entries(snap.records)) {
        if (rec) lib.models[id] = rec;
        else delete lib.models[id];
      }
    }, 'undo');
    return { ok: true, restored: snap.ids.length };
  }

  // ---------------- 聚合 ----------------

  getInfo() {
    let version = '1.0.0';
    try { version = require('../package.json').version || version; } catch (_) { /* 忽略 */ }
    return {
      version,
      electron: process.versions.electron || '—',
      node: process.versions.node || '—',
      platform: process.platform,
      dataDir: cpaths.getDataDir(),
      libraryPath: cpaths.getLibraryPath(),
      thumbsDir: cpaths.getThumbsDir(),
    };
  }

  bootstrap() {
    const info = this.getInfo();
    return {
      version: info.version,
      dataDir: cpaths.getDataDir(),
      info,
      settings: this.store.getSettings(),
      categories: this.library.categories(),
      tags: this.library.tags(),
      views: this.library.views(),
      stats: this.library.stats(),
      smartCounts: this.library.smartCounts(),
      folders: this.folders(),
      slicers: this.slicer.list(),
      backups: this.store.listBackups(),
      scanStatus: this.scanStatus(),
    };
  }

  /** 缩略图重生成：ids 为空表示全部 */
  async thumbRegenerate(ids, force = true) {
    let list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!list.length) list = Object.keys(this.store.getLibrary().models || {});
    return this.thumbs.regenerate(list, { force: !!force });
  }

  // ---------------- 模型体检 / 优化 ----------------

  blenderPath() {
    return (this.store.getSettings().blenderPath || '').trim();
  }

  /** 只读体检：把模型库 id 解析成本地路径，附带 Blender 检测结果 */
  async meshInspect(id) {
    const rec = this.library.get(id);
    if (!rec) throw new Error('找不到该模型');
    const p = String(rec.path || '');
    if (!/\.3mf$/i.test(p)) throw new Error('模型优化目前只支持 .3mf 文件');
    if (!fs.existsSync(p)) throw new Error('源文件已失效：' + p);
    const info = await mesh3mf.inspect3mf(p);
    const blender = await this.meshopt.detectBlender(this.blenderPath());
    return Object.assign({}, info, { blender, filePath: p });
  }

  async meshBlender() {
    return this.meshopt.detectBlender(this.blenderPath());
  }

  async meshBlenderSet(p) {
    const v = String(p || '').trim();
    if (v && !fs.existsSync(v)) throw new Error('路径不存在：' + v);
    await this.store.updateSettings({ blenderPath: v });
    this.meshopt.cachedBlender = null;      // 强制下次重新探测
    return this.meshopt.detectBlender(v);
  }

  /** 执行优化：源文件只读，输出同目录新 3MF */
  async meshOptimize(opts = {}) {
    const rec = this.library.get(opts.id);
    if (!rec) throw new Error('找不到该模型');
    const p = String(rec.path || '');
    if (!fs.existsSync(p)) throw new Error('源文件已失效：' + p);
    return this.meshopt.run({
      srcPath: p,
      preset: opts.preset,
      clampMm: opts.clampMm,
      voxelMm: opts.voxelMm,
      includeAngular: !!opts.includeAngular,
      blenderPath: this.blenderPath(),
    });
  }

  meshCancel() { return this.meshopt.cancel(); }

  // ---------------------------------------------------------------- 快造 U1 转换

  /**
   * 按关键词找切片软件（bambu / snapmaker）。找不到就抛出可读原因。
   *
   * 注意：探测结果每次都是新造的随机 id，不在设置里。所以返回的对象可能带 `__transient`
   * 标记，调用方必须把对象整体传给 slicer.open / openPaths，不能只传 id（否则查不到）。
   */
  async _slicerByHint(hint) {
    // 「快造」只认 snapmaker / 快造，不能把裸 orca 算进来：
    // 本机可能同时装着原版 OrcaSlicer（实测是 Microsoft Store 版 2.5.0，
    // exe 叫 orca-slicer.exe，一启动就崩），它没有任何快造的东西，
    // 却因为名字里有 orca 被误判成快造 —— 用它打开 U1 工程是错的。
    const isSnap = hint === 'snapmaker';
    const isOfficialOrca = hint === 'orca-official';
    const re = isSnap ? /snapmaker|快造/i
      : isOfficialOrca ? /orca[-_ ]?slicer|orcaslicer/i
      : /bambu|拓竹/i;
    const label = (s) => String(s.name || '') + ' ' + String(s.exePath || '');
    const isSnapName = (s) => /snapmaker|快造/i.test(label(s));
    const isPlainOrca = (s) => /orca/i.test(label(s));
    // 官方 Orca 必须排除快造版：两个 exe 名都含 orca，只按名字匹配必然误判
    const match = (s) => re.test(label(s)) && (!isOfficialOrca || !isSnapName(s));

    const list = this.slicer.list();
    const hit = list.find((s) => s.enabled !== false && match(s));
    if (hit) return hit;

    // 设置里没有就探测一次；结果按关键词缓存，避免每次打开都扫一遍磁盘
    if (!this._detectedSlicers) {
      try { this._detectedSlicers = await this.slicer.detect(); } catch (_) { this._detectedSlicers = []; }
    }
    const d = this._detectedSlicers.find(match);
    if (d) return Object.assign({}, d, { __transient: true });

    if (isSnap) {
      const wrong = list.find(isPlainOrca) || this._detectedSlicers.find(isPlainOrca);
      if (wrong) {
        throw new Error('找到的是原版 OrcaSlicer（' + wrong.exePath + '），不是快造 Orca。'
          + '快造请指向 C:\\Program Files\\Snapmaker_Orca\\snapmaker-orca.exe');
      }
      throw new Error('没有找到快造 Orca。请先在设置 → 切片软件里添加 snapmaker-orca.exe');
    }
    if (isOfficialOrca) {
      const wrong = list.find(isSnapName) || this._detectedSlicers.find(isSnapName);
      if (wrong) {
        throw new Error('找到的是快造 Orca（' + wrong.exePath + '），不是官方 OrcaSlicer。'
          + '官方版请指向 C:\\Program Files\\OrcaSlicer\\orca-slicer.exe');
      }
      throw new Error('没有找到官方 OrcaSlicer。请先在设置 → 切片软件里添加 orca-slicer.exe');
    }
    throw new Error('没有找到 Bambu Studio。请先在设置 → 切片软件里添加 bambu-studio.exe');
  }

  /**
   * 检查某个 Orca 是否具备切片 U1 所需的完整机器预设。
   *
   * 为什么需要：官方 OrcaSlicer 的 resources/profiles/Snapmaker 里只有 U1 的床贴图，
   * 没有 machine JSON；用户在界面里看到的 "Snapmaker U1" 可能只是一个 inherits 悬空的壳。
   * 这种情况切片不会报错，但 printable_area 会退回 200×200 兜底，G-code 拿到 U1 上不能打。
   */
  u1PresetForOrca(exePath) {
    const isComplete = (file) => {
      try {
        const txt = fs.readFileSync(file, 'utf8');
        const j = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);
        return !!(j && Array.isArray(j.printable_area) && j.printable_area.length);
      } catch (_) {
        return false;
      }
    };

    const dir = path.dirname(String(exePath || ''));
    const resFile = path.join(dir, 'resources', 'profiles', 'Snapmaker', 'machine', 'Snapmaker U1 (0.4 nozzle).json');
    if (isComplete(resFile)) return { ok: true, source: 'resources', file: resFile };

    // 用户 profile：%APPDATA%/OrcaSlicer/user/<任意 profile>/machine/*U1*.json
    const appData = process.env.APPDATA || '';
    for (const name of ['OrcaSlicer', 'orca-slicer', 'OrcaSlicerNightly']) {
      const userRoot = path.join(appData, name, 'user');
      let profiles = [];
      try {
        profiles = fs.readdirSync(userRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory()).map((d) => d.name);
      } catch (_) { continue; }
      for (const p of profiles) {
        const mdir = path.join(userRoot, p, 'machine');
        let files = [];
        try { files = fs.readdirSync(mdir); } catch (_) { continue; }
        for (const f of files) {
          if (!/\.json$/i.test(f) || !/U1/i.test(f)) continue;
          const file = path.join(mdir, f);
          if (isComplete(file)) return { ok: true, source: 'user', file };
        }
      }
    }
    return {
      ok: false,
      reason: '官方 OrcaSlicer 缺少 Snapmaker U1 的完整机器预设（没有 printable_area），'
        + '切片时会退回 200×200 兜底床',
    };
  }

  /**
   * 探测出来的切片软件不在设置里。既然用户刚用它成功打开了文件，就顺手记下来，
   * 免得下次还要重新扫磁盘、设置页里也一直空着。
   */
  async _persistSlicer(sl, success) {
    if (!success || !sl || !sl.__transient) return;
    try {
      await this.slicer.add({ name: sl.name, exePath: sl.exePath });
      this._detectedSlicers = null; // 下次重新探测时会看到设置里已有
      this.emitToRenderer('app:toast', { type: 'info', message: '已把「' + sl.name + '」加入切片软件列表' });
    } catch (_) { /* 记不住不影响本次打开 */ }
  }

  /** 快造预设与安装状态，给设置页用 */
  u1Status() {
    let filaments = [], processes = [], orcaDir = '', error = null;
    try {
      filaments = this.orcapresets.list('filament');
      processes = this.orcapresets.list('process');
      orcaDir = this.orcapresets.installDir();
    } catch (e) {
      error = e.message;
    }
    return {
      orcaDir,
      error,
      filaments,
      processes,
      settings: this.u1.settings(),
      cache: this.u1.cacheStats(),
      filamentSummary: this.u1.settings().filamentPreset
        ? this.orcapresets.summary('filament', this.u1.settings().filamentPreset) : null,
    };
  }

  /** 转换一个模型（以库 id 指定），产物进缓存目录，源文件不动 */
  async u1Convert(id, opts = {}) {
    const rec = this.library.get(id);
    if (!rec) throw new Error('找不到该模型');
    const p = String(rec.path || '');
    if (!/\.3mf$/i.test(p)) throw new Error('只有 .3mf 文件需要转换（当前：' + path.basename(p) + '）');
    if (!fs.existsSync(p)) throw new Error('源文件已失效：' + p);
    const r = await this.u1.convert(p, opts);
    return Object.assign({ id, srcPath: p }, r);
  }

  u1Cancel() { return this.u1.cancel(); }
  u1ClearCache(days) { return this.u1.clearCache({ days: Number(days) || 0 }); }
  u1PresetsInvalidate() { this.orcapresets.invalidate(); return true; }

  // ---------------------------------------------------------------- 打印机

  printersList() { return this.printers.list(); }
  printersSnapshot() {
    const snap = this.printers.snapshot();
    // 缓存还是空的（刚打开面板/刚启动），先踢一次刷新，界面马上会有推送
    if (snap.length && snap.every((x) => !x.updatedAt)) this.printers.tick().catch(() => {});
    return snap;
  }
  printerAdd(cfg) { return this.printers.add(cfg || {}); }
  printerUpdate(id, patch) { return this.printers.update(id, patch || {}); }
  printerRemove(id) { return this.printers.remove(id); }
  printerTest(id) { return this.printers.test(id); }
  printerAction(id, cmd) { return this.printers.action(id, cmd); }
  printersDiscover(opts) { return this.printers.discover(opts || {}); }

  // ---- 打印监控（曲线 / 通知）----
  monitorHistory(id, limit) { return this.monitor.history(id || null, limit); }
  monitorLatest(id) { return this.monitor.latest(id || null); }
  monitorStatus() { return this.monitor.status(); }
  monitorClear(id) { return this.monitor.clear(id || null); }
  notifyTest() { return this.monitor.testNotify(); }

  // ---- 13 · 打印回执 / 耗材库 / 成本账本 ----

  /** monitor 'job' 终态 → 落回执；成功且匹配到模型时自动回写状态（用户 2026-11-16 确认） */
  async _onPrintJob(j) {
    if (!j) return null;
    const models = this.store.getLibrary().models || {};

    // 精确匹配优先；精确不中再走「名字大致匹配」——分多次打印会让同一模型出现
    // _plate_2 / (3) / 尾部编号等变体，只用精确匹配会全落空（用户 2026-11-24 反馈）。
    let model = matchModel(j.jobName, models);
    let score = model ? 1 : 0;
    if (!model) {
      const fuzzy = matchModelFuzzy(j.jobName, models);
      if (fuzzy.model) { model = fuzzy.model; score = fuzzy.score; }
    } else if (!j.jobName || /^(当前任务|未命名任务)$/.test(String(j.jobName).trim())) {
      // 名字是兜底文案时不能拿去匹配，否则会随机关联到某个模型
      model = null;
      score = 0;
    }

    // 去重：掉线重连、重启补判都可能对同一次打印再发一次终态事件
    const dup = this.receipts.findRecentJob(j.printerId, j.jobName, j.at);
    if (dup) return dup;

    // 成本核算：先算一次快照，之后用户改耗材价格不影响历史回执
    let weightG = null;
    let costTotal = 0;
    let filamentNames = [];
    if (model) {
      try {
        const c = cost.costOf(model, this.filaments.list());
        weightG = c.weightG;
        costTotal = c.total;
        filamentNames = c.parts.map((p) => p.name).filter(Boolean);
      } catch (_) { /* 成本算不出来也要落回执 */ }
    }

    const receipt = await this.receipts.add({
      jobName: j.jobName,
      printerId: j.printerId,
      printerName: j.printerName,
      result: j.result,
      startedAt: j.startedAt,
      endedAt: j.at,
      modelId: model ? model.id : null,
      weightG,
      cost: costTotal,
      filamentNames,
    });
    // 自动关联也要把模型名快照写进去，否则卡片只剩 id，用户看不出连的是谁
    if (model) {
      try {
        await this.receipts.linkModel(receipt.id,
          model.id, model.title || model.fileName || '', { manual: false });
        receipt.modelId = model.id;
        receipt.modelTitle = model.title || model.fileName || '';
      } catch (_) { /* 关联失败不影响回执本身 */ }
    }

    // 只有匹配很确定时才回写打印状态：模糊匹配只用来记账，不该动「已打印」标记
    if (j.result === 'finished' && model && score >= 0.9) {
      try { await this.library.setPrintStatus([model.id], 'printed'); }
      catch (_) { /* 状态回写失败不影响回执本身 */ }
    }
    this.emitToRenderer('receipts:changed', { id: receipt.id, result: j.result });
    return receipt;
  }

  /**
   * 补录历史漏记的回执：从监控采样里找「最后一个点 ≥95% 但没对应回执」的 session。
   * 只补最近 7 天，且同一任务 30 分钟内已有回执就跳过——宁可少补，不能补出重复账。
   * 补出来的回执 note 标明来源，方便用户判断要不要改。
   */
  async receiptsBackfillFromMonitor() {
    let list = [];
    try { list = this.monitor.missedCompletions(120) || []; } catch (_) { return { ok: false, created: 0 }; }
    const models = this.store.getLibrary().models || {};
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    let created = 0;
    for (const s of list) {
      if (!s || !s.endedAt || s.endedAt < cutoff) continue;
      // 6 小时窗口和实时去重保持一致：同一个任务被切成多段 session 时，
      // 阈值太小会给同一次打印补出两三条账。
      if (this.receipts.findRecentJob(s.printerId, s.jobName, s.endedAt, 6 * 3600 * 1000)) continue;
      let model = matchModel(s.jobName, models);
      if (!model) {
        const f = matchModelFuzzy(s.jobName, models);
        if (f.model) model = f.model;
      }
      let weightG = null;
      let costTotal = 0;
      let filamentNames = [];
      if (model) {
        try {
          const c = cost.costOf(model, this.filaments.list());
          weightG = c.weightG;
          costTotal = c.total;
          filamentNames = c.parts.map((p) => p.name).filter(Boolean);
        } catch (_) { /* 成本算不出来也照补 */ }
      }
      const rec = await this.receipts.add({
        jobName: s.jobName,
        printerId: s.printerId,
        printerName: s.printerName,
        result: 'finished',
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        modelId: model ? model.id : null,
        weightG,
        cost: costTotal,
        filamentNames,
        note: '由打印监控补录（完成时未记录回执）',
      });
      if (model) {
        try {
          await this.receipts.linkModel(rec.id, model.id,
            model.title || model.fileName || '', { manual: false });
        } catch (_) { /* 忽略 */ }
      }
      created++;
    }
    if (created) this.emitToRenderer('receipts:changed', { backfilled: created });
    return { ok: true, created };
  }

  /**
   * 给还没关联模型的回执补做自动关联（设置页/回执页的「自动关联」按钮，以及启动后台跑一次）。
   * 只写 modelId/modelTitle，不动成本与用料快照——那些是打印当时的事实。
   */
  async receiptsAutoLink() {
    const models = this.store.getLibrary().models || {};
    const items = this.receipts.list();
    const pending = items.filter((r) => r && !r.modelId && r.jobName);
    let linked = 0;
    const ambiguous = [];
    for (const r of pending) {
      const m = matchModel(r.jobName, models);
      if (m) {
        await this.receipts.linkModel(r.id, m.id, m.title || m.fileName || '', { manual: false });
        linked++;
        continue;
      }
      const fuzzy = matchModelFuzzy(r.jobName, models);
      if (fuzzy.model) {
        await this.receipts.linkModel(r.id, fuzzy.model.id,
          fuzzy.model.title || fuzzy.model.fileName || '', { manual: false });
        linked++;
      } else if (fuzzy.ambiguous) {
        ambiguous.push(r.id);
      }
    }
    if (linked) this.emitToRenderer('receipts:changed', { autoLinked: linked });
    return { ok: true, checked: pending.length, linked, ambiguous: ambiguous.length };
  }

  filamentsList() { return this.filaments.list(); }
  async filamentCreate(data) {
    const r = await this.filaments.create(data);
    this.emitToRenderer('filaments:changed', { action: 'create', id: r.id });
    return r;
  }
  async filamentUpdate(id, patch) {
    const r = await this.filaments.update(id, patch);
    this.emitToRenderer('filaments:changed', { action: 'update', id });
    return r;
  }
  async filamentRemove(id) {
    const r = await this.filaments.remove(id);
    this.emitToRenderer('filaments:changed', { action: 'remove', id });
    return r;
  }
  async filamentSetDefault(id) {
    const r = await this.filaments.setDefault(id);
    this.emitToRenderer('filaments:changed', { action: 'default', id: r.defaultId });
    return r;
  }
  async filamentSetImage(id, filePath) {
    const r = await this.filaments.setImage(id, filePath);
    this.emitToRenderer('filaments:changed', { action: 'image', id });
    return r;
  }
  /**
   * 导出原图给渲染层做裁剪 / 缩放预览（渲染层没有 Node 权限，读不了磁盘）。
   * 直接返回 data URL：图片本来就要整段送进 <img>，省一次 blob 生命周期管理。
   * 上限与落盘一致（8MB 原图），避免把几十 MB 的图塞进 IPC。
   */
  async filamentReadImage(filePath) {
    const src = String(filePath || '');
    if (!src) throw new Error('没有选择图片');
    const st = await fs.promises.stat(src);
    if (!st.isFile()) throw new Error('选择的不是文件');
    if (st.size > 8 * 1024 * 1024) throw new Error('原图超过 8MB，请先压缩后再导入');
    const buf = await fs.promises.readFile(src);
    const ext = sniffImageExt(buf);
    if (!ext) throw new Error('只支持 PNG / JPG 图片');
    return {
      name: path.basename(src),
      size: buf.length,
      mime: ext === '.png' ? 'image/png' : 'image/jpeg',
      dataUrl: 'data:' + (ext === '.png' ? 'image/png' : 'image/jpeg') + ';base64,' + buf.toString('base64'),
    };
  }
  /** 保存裁剪 / 缩放后的图片（前端 canvas 导出的 data URL）。 */
  async filamentSetImageData(id, dataUrl) {
    const s = String(dataUrl || '');
    const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s);
    if (!m) throw new Error('图片数据格式不对');
    const buf = Buffer.from(m[2], 'base64');
    const r = await this.filaments.setImageBuffer(id, buf);
    this.emitToRenderer('filaments:changed', { action: 'image', id });
    return r;
  }
  filamentImagePath(name) { return this.filaments.imagePath(name); }

  modelCost(id) {
    const rec = this.library.get(id);
    if (!rec) return { total: 0, parts: [], weightG: null, source: 'none', complete: false };
    return cost.costOf(rec, this.filaments.list(), { defaultFilament: this.filaments.getDefault() });
  }
  /**
   * 卡片价格用的批量成本：一次 IPC 拿全部模型的 { id -> {total, complete} }。
   * 153 张卡片若逐条调 modelCost 就是 153 次 IPC，首屏会被拖垮；这里只算不写库，
   * filaments.list() 也只取一次。卡片是同步渲染的，只能读内存缓存，故由此接口供给。
   */
  modelsCosts() {
    return cost.costOfBatch(this.store.getLibrary().models || {}, this.filaments.list(),
      { defaultFilament: this.filaments.getDefault() });
  }
  async modelSetFilaments(id, links, weightG) {
    const patch = { filamentLinks: Array.isArray(links) ? links : [] };
    if (weightG != null) patch.costWeightG = weightG;
    await this.library.update(id, patch);
    return this.modelCost(id);
  }

  receiptsList(limit) { return { items: this.receipts.list(limit), summary: this.receipts.summary() }; }
  async receiptsClear() {
    const r = await this.receipts.clear();
    this.emitToRenderer('receipts:changed', { cleared: true });
    return r;
  }
  /** 删除选中的回执（只删记录，不动模型文件和模型库） */
  async receiptsDelete(ids) {
    const r = await this.receipts.delete(ids);
    this.emitToRenderer('receipts:changed', { deleted: r.deleted });
    return r;
  }
  /**
   * 手动把回执关联到模型库里的某个模型；传 null 则清除关联。
   * 自动匹配不上或匹配错时由用户自己纠正，不改写原任务名、成本与用量快照。
   */
  async receiptsLinkModel(id, modelId) {
    if (!this.receipts.get(id)) throw new Error('找不到这条打印回执');
    const key = modelId ? String(modelId) : '';
    let model = null;
    if (key) {
      const models = this.store.getLibrary().models || {};
      model = models[key] || null;
      if (!model) throw new Error('找不到这个模型，请重新选择');
    }
    const r = await this.receipts.linkModel(
      id, key || null, model ? (model.title || model.fileName) : null
    );
    this.emitToRenderer('receipts:changed', { linked: r.ok, modelId: r.modelId });
    return r;
  }
  /** 已完成打印视图：回执 + 对应模型记录，供渲染层一次拿到 */
  receiptsWithModels(limit) {
    const models = this.store.getLibrary().models || {};
    const items = this.receipts.list(limit).map((r) => ({
      ...r,
      model: r.modelId ? (models[r.modelId] || null) : null,
    }));
    return { items, summary: this.receipts.summary() };
  }
  /** 曲线弹窗的全部数据：session 列表 + 选中 session + 已经算好坐标的画图模型 */
  monitorChart(id, sessionId) {
    const list = this.monitor.history(id || null, 100);
    const ses = sessionId ? list.find((s) => s.id === sessionId) : (list[0] || null);
    return {
      sessions: list.map((s) => ({
        id: s.id, jobName: s.jobName, printerName: s.printerName,
        startedAt: s.startedAt, points: s.points.length, endedAt: s.endedAt,
      })),
      session: ses,
      model: buildChartModel(ses),
    };
  }

  // ---- 拓竹云账号 ----
  bambuCloudStatus() { return this.bambuCloud.status(); }
  async bambuCloudLogin(o) { return this.bambuCloud.login(o || {}); }
  async bambuCloudLoginCode(o) { return this.bambuCloud.loginWithCode(o || {}); }
  async bambuCloudLogout() {
    const r = await this.bambuCloud.logout();
    this.printers.reload();
    this.emitToRenderer('printers:changed', { type: 'cloud-logout' });
    return r;
  }
  /** 拉一遍绑定设备，按序列号合并进打印机列表（存在就更新，不存在就新增为双通道模式） */
  async bambuCloudSync() {
    const devices = await this.bambuCloud.devices();
    const st = (this.store.getSettings && this.store.getSettings()) || {};
    const list = Array.isArray(st.printers) ? st.printers.map((x) => ({ ...x })) : [];
    for (const d of devices) {
      const i = list.findIndex((x) => x.kind === 'bambu' && x.serial === d.serial);
      if (i >= 0) {
        list[i].mode = 'auto';
        list[i].serial = d.serial;
        list[i].name = d.name || list[i].name;
        list[i].model = d.model || list[i].model;
        if (d.accessCode) list[i].accessCode = d.accessCode;   // 自动补访问码，用户不用手抄
      } else {
        list.push({
          id: 'pr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          kind: 'bambu', name: d.name, ip: '', serial: d.serial,
          accessCode: d.accessCode, model: d.model, mode: 'auto', enabled: true,
        });
      }
    }
    await this.store.updateSettings({ printers: list });
    this.printers.reload();
    this.emitToRenderer('printers:changed', { type: 'cloud-sync' });
    return { devices, printers: this.printers.list() };
  }

  // ---------------------------------------------------------------- 预设保护

  /**
   * 快造用户预设的体检 + 备份状态。
   * 顺带说明为什么这些预设「很容易不见」：快造默认不同步用户预设（配置里
   * sync_user_preset=false），云端没有副本，本机这一份是唯一的一份。
   */
  u1PresetHealth() {
    let health;
    try { health = this.presetguard.health(); }
    catch (e) { return { ok: false, error: e.message }; }
    const backups = this.presetguard.list().slice(0, 10).map((b) => ({
      id: b.id, at: b.at, reason: b.reason, files: b.files, bytes: b.bytes, counts: b.counts,
    }));
    return {
      ok: true,
      counts: health.counts,
      broken: health.broken,
      presets: health.presets,
      foreign: health.foreign,
      userRoot: this.orcapresets.userRoots()[0] || '',
      backupRoot: this.presetguard.backupRoot(),
      backups,
      latest: backups[0] || null,
      // 快造云端到底同不同步用户预设，直接读它的配置，别猜
      cloudSync: this._orcaUserPresetSync(),
    };
  }

  /** 读 Snapmaker_Orca.conf 里的 sync_user_preset 开关（配置是带 # 注释的 JSON） */
  _orcaUserPresetSync() {
    const dirs = [];
    if (process.env.APPDATA) {
      dirs.push(path.join(process.env.APPDATA, 'Snapmaker_Orca', 'Snapmaker_Orca.conf'));
      dirs.push(path.join(process.env.APPDATA, 'SnapmakerOrca', 'SnapmakerOrca.conf'));
    }
    for (const f of dirs) {
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      const m = /"sync_user_preset"\s*:\s*(true|false)/i.exec(txt);
      if (m) return { known: true, enabled: m[1].toLowerCase() === 'true', confPath: f };
    }
    return { known: false, enabled: false, confPath: '' };
  }

  u1PresetSnapshot() { return this.presetguard.snapshot({ reason: '手动备份', force: true }); }
  u1PresetRestore(id) {
    const r = this.presetguard.restore(id);
    this.orcapresets.invalidate();
    return r;
  }

  /**
   * 启动时跑一次：内容变了就留快照；数量比上次少就提示用户。
   * 失败一律吞掉——这只是保险，不能影响启动。
   */
  async u1PresetAutoCheck() {
    try {
      const r = this.presetguard.autoSnapshot();
      if (r && r.message) {
        this.emitToRenderer('app:toast', { type: 'warn', message: r.message, duration: 8000 });
      }
      return r;
    } catch (_) { return null; }
  }

  // ---------------------------------------------------------------- 文件关联

  /**
   * 读一个注册表键的默认值。
   * 注意：reg.exe 按控制台代码页输出，返回值里的中文值名会乱码，
   * 但我们只取 REG_SZ 之后的内容（路径是 ASCII），所以按 latin1 读更稳。
   */
  _regDefault(key) {
    try {
      const buf = require('child_process').execFileSync('reg', ['query', key, '/ve'],
        { windowsHide: true, timeout: 4000, maxBuffer: 32 * 1024 * 1024 });
      const out = buf.toString('latin1');
      const m = /REG_SZ\s+(.+?)\s*$/m.exec(out);
      return m ? m[1].trim() : '';
    } catch (_) { return ''; }
  }

  /** 列出一个键下面的子键名（注册表里真实存在的名字，可能带空格） */
  _regSubKeys(key) {
    try {
      const buf = require('child_process').execFileSync('reg', ['query', key],
        { windowsHide: true, timeout: 4000, maxBuffer: 32 * 1024 * 1024 });
      const out = buf.toString('latin1');
      const prefix = key.replace(/^[^\\]+\\/, '').toLowerCase();
      const names = [];
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || !/^HKEY_/i.test(t)) continue;
        const rest = t.replace(/^HKEY_[A-Z_]+\\/i, '');
        if (rest.toLowerCase() === prefix) continue;          // 键自身
        if (!rest.toLowerCase().startsWith(prefix + '\\')) continue;
        const tail = rest.slice(prefix.length + 1);
        if (tail && !tail.includes('\\')) names.push(tail);
      }
      return names;
    } catch (_) { return []; }
  }

  /**
   * 解析一个 ProgId 的打开命令。HKCR 是合并视图，但遇到「孤儿 ProgId」时
   * HKCR 查不到而 HKCU/HKLM 里其实有 —— 所以三级都试。
   */
  _progIdCommand(progId) {
    const pid = String(progId || '');
    if (!pid) return '';
    for (const root of ['HKCR', 'HKCU\\SOFTWARE\\Classes', 'HKLM\\SOFTWARE\\Classes']) {
      const v = this._regDefault(root + '\\' + pid + '\\shell\\open\\command');
      if (v) return v;
    }
    return '';
  }

  /**
   * `.3mf` 现在双击会用谁打开。
   *
   * 实测本机有个很坑的情况：Bambu Studio 注册的 ProgId 名字**前面多一个空格**
   * （`" Bambu.Studio.1"`，长度 15），而 `.3mf` 的默认值写的是不带空格的
   * `Bambu.Studio.1` —— 指向一个不存在的壳。于是双击解析不出程序，
   * Windows 只能弹「打开方式」，列表里最近用过的是原版 OrcaSlicer，
   * 用户就以为「默认被 Orca 抢了」。
   */
  fileAssocReport() {
    // 缓存 3 秒：设置页一次渲染会连着问诊断/修复/复核，每次都枚举注册表太亏
    const now = Date.now();
    if (this._assocCache && now - this._assocCacheAt < 3000) return this._assocCache;
    const ext = '.3mf';
    const out = {
      ext,
      defaultProgId: '',
      defaultCommand: '',
      defaultExe: '',
      defaultExists: false,
      userChoice: '',
      candidates: [],
      problems: [],
      suggestions: [],
    };

    out.defaultProgId = this._regDefault('HKCR\\' + ext);
    out.userChoice = this._regDefault('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\UserChoice\\ProgId')
      || this._regDefault('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\UserChoice');
    out.defaultCommand = this._progIdCommand(out.defaultProgId);
    const m = /"([^"]+\.exe)"/i.exec(out.defaultCommand);
    out.defaultExe = m ? m[1] : '';
    out.defaultExists = !!out.defaultExe && fs.existsSync(out.defaultExe);

    // ProgId 名字带空格的情况：找 HKCU/HKLM 下「去掉首尾空格后相同」的键
    if (out.defaultProgId && !out.defaultCommand) {
      for (const root of ['HKCU\\SOFTWARE\\Classes', 'HKLM\\SOFTWARE\\Classes']) {
        const near = this._regSubKeys(root)
          .find((n) => n !== out.defaultProgId && n.trim() === out.defaultProgId.trim());
        if (near) {
          // near 就是真正的 ProgId（比如 " Bambu.Studio.1"，带前导空格），直接解析它
          const cmd = this._progIdCommand(near);
          if (cmd) {
            out.problems.push({
              code: 'progid-dangling',
              message: '.3mf 指向的 ' + out.defaultProgId + ' 并不存在；真正的 ProgId 名字里'
                + '多了空格（"' + near + '"）。所以双击 .3mf 解析不出程序，会弹「打开方式」。',
              fixProgId: near,
              fixRoot: root.split('\\')[0],
            });
            break;
          }
        }
      }
    }

    // 打开方式候选
    const progIds = this._regSubKeys('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\OpenWithProgids');
    for (const pid of progIds) {
      const cmd = this._progIdCommand(pid);
      const mm = /"([^"]+\.exe)"/i.exec(cmd);
      const exe = mm ? mm[1] : '';
      out.candidates.push({
        progId: pid,
        exe,
        name: exe ? path.basename(exe) : (pid || '(无命令)'),
        exists: !!exe && fs.existsSync(exe),
        isStoreOrca: /orca-slicer\.exe$/i.test(exe) && /WindowsApps/i.test(exe),
      });
    }
    // 「打开方式」最近使用列表（Windows 按 MRU 排序）
    for (const exe of this._openWithList(ext)) {
      if (out.candidates.some((c) => c.exe && path.basename(c.exe).toLowerCase() === exe.toLowerCase())) continue;
      const found = this._findSlicerExe(exe);
      out.candidates.push({
        progId: '',
        exe: found,
        name: exe,
        // 只对「切片软件里能定位到路径、但文件没了」判红；系统程序（msedge 之类）解析不到路径不算问题
        exists: found ? fs.existsSync(found) : null,
        isStoreOrca: /orca-slicer\.exe$/i.test(exe) && /WindowsApps/i.test(found || ''),
      });
    }

    const storeOrca = out.candidates.find((c) => c.isStoreOrca);
    if (storeOrca) {
      out.problems.push({
        code: 'store-orca',
        message: '「打开方式」里挂着 Microsoft Store 版 OrcaSlicer（' + storeOrca.exe
          + '），它不是快造，而且启动即崩溃。',
      });
    }
    if (out.defaultProgId && !out.defaultCommand && !out.problems.some((p) => p.code === 'progid-dangling')) {
      out.problems.push({
        code: 'broken-progid',
        message: '默认关联 ' + out.defaultProgId + ' 没有对应的打开命令，双击可能没反应或弹「打开方式」。',
      });
    }

    // 能一键修的目标：优先已配置的切片软件
    const slicers = this.slicer.list().filter((s) => s.enabled !== false && s.exePath);
    for (const s of slicers) {
      out.suggestions.push({ key: s.name, label: '用 ' + s.name + ' 打开', exePath: s.exePath });
    }
    this._assocCache = out;
    this._assocCacheAt = Date.now();
    return out;
  }

  _openWithList(ext) {
    const out = [];
    const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\OpenWithList';
    try {
      const buf = require('child_process').execFileSync('reg', ['query', base],
        { windowsHide: true, timeout: 4000 });
      for (const line of buf.toString('latin1').split(/\r?\n/)) {
        const m = /^\s+([a-h])\s+REG_SZ\s+(.+?)\s*$/i.exec(line);
        if (m) out.push(m[2].trim());
      }
    } catch (_) { /* 没有候选 */ }
    return out;
  }

  /** 从名字猜出真正的 exe 路径（OpenWithList 只存文件名） */
  _findSlicerExe(basename) {
    const want = String(basename || '').toLowerCase();
    if (!want) return '';
    for (const s of this.slicer.list()) {
      if (path.basename(String(s.exePath || '')).toLowerCase() === want) return s.exePath;
    }
    return '';
  }

  /**
   * 一键修 `.3mf` 关联。
   * Windows 的 UserChoice 有防篡改哈希，程序写不进去 —— 但删掉它可以回到「没有显式选择」，
   * 此时 HKCU\Software\Classes\.3mf 的默认值生效，这是能可靠改的。
   *
   * @param {'bambu'|'snapmaker'|'fix'|{exePath,name}} target
   */
  fileAssocRepair(target) {
    this._assocCache = null;
    const ext = '.3mf';
    let exePath = '';
    let name = '';
    if (target && typeof target === 'object' && target.exePath) {
      exePath = String(target.exePath);
      name = String(target.name || path.basename(exePath, path.extname(exePath)));
    } else if (target === 'bambu') {
      const sl = this.slicer.list().find((s) => /bambu/i.test(s.name));
      exePath = sl ? sl.exePath : '';
      name = sl ? sl.name : 'Bambu Studio';
    } else if (target === 'snapmaker') {
      const sl = this.slicer.list().find((s) => /snapmaker|快造/i.test(s.name));
      exePath = sl ? sl.exePath : '';
      name = sl ? sl.name : '快造 Orca';
    } else {
      return this.fileAssocRepairFixDangling();
    }
    if (!exePath) throw new Error('没有找到对应的切片软件，请先在设置里添加');
    if (!fs.existsSync(exePath)) throw new Error('程序不存在：' + exePath);
    return this._writeAssoc(ext, exePath, name);
  }

  /** 修「默认值指向不存在 ProgId」：把 .3mf 指回真实存在的那个 ProgId */
  fileAssocRepairFixDangling() {
    this._assocCache = null;
    const rep = this.fileAssocReport();
    const p = (rep.problems || []).find((x) => x.code === 'progid-dangling');
    if (!p || !p.fixProgId) return { ok: false, message: '没有发现需要修的孤儿 ProgId' };
    const base = p.fixRoot + '\\SOFTWARE\\Classes';
    // 用 reg add 把默认值指到真实存在（带空格）的 ProgId
    require('child_process').execFileSync('reg', ['add', base + '\\.3mf', '/ve', '/t', 'REG_SZ',
      '/d', p.fixProgId, '/f'], { windowsHide: true, timeout: 5000 });
    return { ok: true, message: '已把 .3mf 指回 "' + p.fixProgId + '"', progId: p.fixProgId };
  }

  _writeAssoc(ext, exePath, name) {
    const cp = require('child_process');
    const run = (args) => cp.execFileSync('reg', args, { windowsHide: true, timeout: 5000 });
    const progId = String(name).replace(/[^A-Za-z0-9]+/g, '') + '.3mf';
    const cls = 'HKCU\\SOFTWARE\\Classes\\' + progId;
    run(['add', cls, '/ve', '/t', 'REG_SZ', '/d', name + ' 项目', '/f']);
    run(['add', cls + '\\DefaultIcon', '/ve', '/t', 'REG_SZ', '/d', '"' + exePath + '",0', '/f']);
    run(['add', cls + '\\shell\\open\\command', '/ve', '/t', 'REG_SZ',
      '/d', '"' + exePath + '" "%1"', '/f']);
    // 让 .3mf 指到这个新 ProgId
    run(['add', 'HKCU\\SOFTWARE\\Classes\\' + ext, '/ve', '/t', 'REG_SZ', '/d', progId, '/f']);
    // 有 UserChoice 会盖过上面的设置；删掉它，回到「无显式选择」才能生效
    let userChoiceRemoved = false;
    try {
      run(['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\UserChoice', '/f']);
      userChoiceRemoved = true;
    } catch (_) { /* 本来就没有 */ }
    // 顺带把最近使用记录清空，避免旧的（已卸载的）程序排在第一
    try {
      run(['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\OpenWithList', '/f']);
    } catch (_) { /* 忽略 */ }
    return { ok: true, progId, exePath, userChoiceRemoved, message: '已把 .3mf 交给 ' + name };
  }

  /** 打开 Windows 的「默认应用」页（改 .3mf 默认程序只能由用户在那里点） */
  async fileAssocOpenSettings() {
    const { shell } = require('electron');
    try { await shell.openExternal('ms-settings:defaultapps'); } catch (_) { /* 忽略 */ }
    return true;
  }

  /**
   * 打开模型：
   *   bambu                —— 原文件直接交给 Bambu Studio，不做转换
   *   orca-official-direct —— 原文件直接交给官方 OrcaSlicer，不做转换
   *   snapmaker            —— 先转成 U1 工程，再交给快造 Orca（自带完整 U1 预设）
   *   orca-official        —— 先转成 U1 工程，再交给官方 OrcaSlicer，并附预设体检结果
   */
  async openWith(ids, which = 'bambu') {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) throw new Error('没有选中模型');
    const mode = which === 'snapmaker' ? 'snapmaker'
      : (which === 'orca-official' ? 'orca-official'
      : (which === 'orca-official-direct' ? 'orca-official-direct' : 'bambu'));

    // 两条「原文件直接打开」：拓竹 / 官方 Orca，都不转换
    if (mode === 'bambu' || mode === 'orca-official-direct') {
      const sl = await this._slicerByHint(mode === 'bambu' ? 'bambu' : 'orca-official');
      const r = await this.slicer.open(list, { slicer: sl });
      await this._persistSlicer(sl, r.launched.length > 0);
      return {
        mode, launched: r.launched, failed: r.failed,
        converted: [], slicerName: sl.name, presetWarning: '',
      };
    }

    const sl = await this._slicerByHint(mode === 'orca-official' ? 'orca-official' : 'snapmaker');
    // 官方 Orca 缺 U1 预设时不会报错，但床尺寸会退回 200×200 —— 必须在打开前说清楚
    let presetWarning = '';
    if (mode === 'orca-official' && !this.u1PresetForOrca(sl.exePath).ok) {
      presetWarning = '官方 Orca 缺少 U1 完整机器预设：切片前请先在 Orca 的「浏览共享配置文件」里安装 Snapmaker U1 配置，'
        + '否则床尺寸会退回 200×200。';
    }
    const converted = [];
    const failedConv = [];
    for (const id of list) {
      const rec = this.library.get(id);
      if (!rec) { failedConv.push({ id, error: '找不到该模型' }); continue; }
      const p = String(rec.path || '');
      if (!/\.3mf$/i.test(p)) { failedConv.push({ id, error: '不是 .3mf 文件' }); continue; }
      // 本来就是快造的项目文件，直接开原文件，没必要再转一遍
      if (this.u1.isAlreadyU1(p)) {
        converted.push({ id, srcPath: p, outPath: p, native: true, cached: true, report: null });
        continue;
      }
      try {
        const r = await this.u1.convert(p);
        converted.push({ id, srcPath: p, outPath: r.outPath, cached: !!r.cached, report: r.report });
      } catch (e) {
        failedConv.push({ id, error: e.message });
      }
    }
    if (!converted.length) {
      throw new Error(failedConv[0] ? failedConv[0].error : '转换失败');
    }

    const r = await this.slicer.openPaths(converted.map((c) => c.outPath), { slicer: sl });
    await this._persistSlicer(sl, r.launched.length > 0);
    for (const c of converted) {
      if (r.launched.includes(c.outPath)) {
        try { await this.library.markOpened(c.id); } catch (_) { /* 单条失败不影响 */ }
      }
    }
    return {
      mode,
      launched: converted.filter((c) => r.launched.includes(c.outPath)).map((c) => c.id),
      failed: failedConv.concat(r.failed.map((f) => ({ error: f.error, path: f.path }))),
      converted,
      slicerName: sl.name,
      presetWarning,
    };
  }

  /** 把优化结果纳入模型库：必要时登记它所在的目录并重扫一次 */
  async meshAddToLibrary(outPath) {
    const p = path.resolve(String(outPath || ''));
    if (!fs.existsSync(p)) throw new Error('优化结果文件不存在：' + outPath);
    const dir = path.dirname(p);
    const before = this.folders().length;
    await this.folderAdd(dir);
    if (!this._scanning && !this.scanner.getStatus().running) {
      this._scanning = true;
      try {
        await this.scanner.scanAll({ force: false });
      } finally {
        this._scanning = false;
      }
    }
    this.emitToRenderer('lib:changed', { reason: 'meshopt' });
    return { ok: true, dir, folderAdded: this.folders().length > before, outPath: p };
  }
}

module.exports = Services;
