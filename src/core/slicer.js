'use strict';
/**
 * 切片软件管理（契约 D-1）。
 * 纯 Node 实现：禁止 require('electron')，仅依赖 Node 内置模块与 core 基础层。
 * 所有对外抛出的 Error.message 均为可读简体中文。
 */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { SLICER_CANDIDATES } = require('./constants');
const corePaths = require('./paths');
const { uid, baseName, extName } = require('./utils');

const WIN_EXE_EXTS = ['.exe', '.bat', '.cmd', '.com'];

class SlicerService extends EventEmitter {
  constructor({ store } = {}) {
    super();
    if (!store || typeof store.getSettings !== 'function') {
      throw new Error('SlicerService 初始化失败：需要传入有效的 store');
    }
    this.store = store;
  }

  // ---------------------------------------------------------------- 内部工具

  _slicers() {
    const s = this.store.getSettings() || {};
    return Array.isArray(s.slicers) ? s.slicers : [];
  }

  /**
   * 写入 slicers：只在临时副本上构造新数组，交给 store 统一落盘。
   * 旧实现先原地改 store 内存，再写盘；一旦写盘失败，内存已是新值而磁盘还是旧值，
   * 界面会显示「保存成功」的假象（P1-14）。store.mergeSettings 对数组是整体替换，
   * 不需要也不应该手动截断内部数组。
   */
  async _write(slicers) {
    const arr = slicers.map((s) => ({ ...s }));
    await this.store.updateSettings({ slicers: arr });
  }

  _isFile(p) {
    try {
      return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
    } catch (_) {
      return false;
    }
  }

  _toPath(recordOrPath) {
    if (recordOrPath == null) return '';
    if (typeof recordOrPath === 'string') return recordOrPath;
    if (typeof recordOrPath === 'object') return recordOrPath.path || recordOrPath.filePath || '';
    return '';
  }

  /** args 字符串按空格拆分，支持简单双引号包裹（引号内可含空格） */
  _splitArgs(str) {
    const s = (str == null ? '' : String(str)).trim();
    if (!s) return [];
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(s)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }

  _friendlyName(exePath) {
    const b = baseName(exePath);
    const key = b.toLowerCase().replace(/[\s_-]+/g, '');
    const map = {
      bambustudio: 'Bambu Studio',
      orcaslicer: 'OrcaSlicer',
      prusaslicer: 'PrusaSlicer',
      cura: 'Ultimaker Cura',
      crealityprint: 'Creality Print',
      superslicer: 'SuperSlicer',
    };
    if (map[key]) return map[key];
    return b.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || '切片软件';
  }

  _pathDirs() {
    const raw = process.env.PATH || process.env.Path || '';
    return raw.split(path.delimiter).map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }

  /** 探测根目录集合：环境变量 + 固定盘符 + PATH + 额外目录，小写去重 */
  _roots() {
    const list = [];
    const add = (d) => { if (d && String(d).trim()) list.push(String(d).trim()); };

    add(process.env.ProgramFiles);
    add(process.env['ProgramFiles(x86)']);
    add(process.env.ProgramW6432);

    const lad = process.env.LOCALAPPDATA;
    if (lad) {
      add(path.join(lad, 'Programs'));
      add(path.join(lad, 'Programs', 'Bambu Studio'));
    }

    for (const d of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'Z']) {
      add(`${d}:\\Program Files`);
      add(`${d}:\\Program Files (x86)`);
    }

    for (const d of this._pathDirs()) add(d);

    const seen = new Set();
    return list.filter((r) => {
      const k = r.replace(/[\\/]+$/, '').toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** 启动独立子进程；挂 error 监听避免异步 error 事件未处理导致进程崩溃 */
  _spawnDetached(cmd, args, opts = {}) {
    let child;
    try {
      child = spawn(cmd, args, Object.assign(
        { detached: true, stdio: 'ignore', shell: false, windowsHide: true },
        opts
      ));
    } catch (e) {
      throw new Error('启动外部程序失败：' + e.message);
    }
    child.on('error', () => {});
    try { child.unref(); } catch (_) {}
    return child;
  }

  /** 执行一段 PowerShell 脚本，返回 { ok, unavailable?, error? } */
  _runPowerShell(script) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], shell: false });
      } catch (e) {
        resolve({ ok: false, unavailable: false, error: e.message });
        return;
      }
      let stderr = '';
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      if (child.stderr) child.stderr.on('data', (c) => { stderr += String(c); });
      child.on('error', (e) => done({ ok: false, unavailable: true, error: e.message }));
      child.on('close', (code) => {
        if (code === 0) done({ ok: true });
        else done({ ok: false, unavailable: false, error: stderr.trim() || ('PowerShell 退出码 ' + code) });
      });
    });
  }

  // ---------------------------------------------------------------- 探测/列表

  /** 扫描常见安装位置，返回候选数组（不自动写入 settings，由 UI 决定采纳） */
  async detect() {
    const roots = this._roots();
    const probes = []; // { name, exePath }
    const push = (name, exePath) => {
      if (name && exePath) probes.push({ name: String(name), exePath: String(exePath) });
    };

    // 候选 × 根目录
    for (const c of SLICER_CANDIDATES) {
      for (const root of roots) push(c.name, path.join(root, c.rel));
    }
    // PATH 多为扁平 bin 目录，额外按 exe 文件名直接探测
    for (const dir of this._pathDirs()) {
      for (const c of SLICER_CANDIDATES) push(c.name, path.join(dir, path.basename(c.rel)));
    }
    // 本机真实路径 / 拓竹默认安装目录（显式兜底）
    const lad = process.env.LOCALAPPDATA;
    if (lad) {
      push('Bambu Studio', path.join(lad, 'Programs', 'Bambu Studio', 'bambu-studio.exe'));
      push('Bambu Studio', path.join(lad, 'Programs', 'Bambu Studio', 'BambuStudio.exe'));
    }
    push('Bambu Studio', 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe');
    push('Creality Print', 'C:\\Program Files\\Creality\\Creality Print 7.3\\CrealityPrint.exe');

    // 去重（exePath 小写）+ 存在性检查
    const seen = new Set();
    const out = [];
    for (const p of probes) {
      const key = p.exePath.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this._isFile(p.exePath)) continue;
      out.push({
        id: uid('sl'),
        name: p.name,
        exePath: p.exePath,
        args: '',
        detected: true,
        enabled: true,
        isDefault: false,
      });
    }
    return out;
  }

  list() {
    return this._slicers().map((s) => ({ ...s }));
  }

  // ---------------------------------------------------------------- 校验

  /**
   * 从一个目录里找出最像切片软件的可执行文件。
   *
   * 为什么需要：用户手动填路径时，十有八九是从资源管理器地址栏复制的**文件夹**，
   * 例如 C:\Program Files\Snapmaker_Orca。以前这里直接判「不是有效文件」并把路径
   * 原样抛给用户，看起来就像报错指向了安装目录 —— 而目录里其实躺着 snapmaker-orca.exe。
   */
  _resolveExeIn(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return '';
    }
    const exes = entries
      .filter((e) => e.isFile() && WIN_EXE_EXTS.includes(extName(e.name)))
      .map((e) => e.name);
    if (!exes.length) return '';
    const good = /slicer|orca|bambu|studio|snapmaker|creality|prusa|cura/i;
    const bad = /unins|setup|install|update|crash|report|helper|redist|vc_/i;
    const rank = (n) => (good.test(n) ? 0 : 2) + (bad.test(n) ? 1 : 0);
    const sorted = exes.slice().sort((a, b) => rank(a) - rank(b) || a.length - b.length);
    const pick = sorted.find((n) => good.test(n) && !bad.test(n)) || (exes.length === 1 ? exes[0] : '');
    return pick ? path.join(dir, pick) : '';
  }

  /**
   * 校验并尽量纠正路径。
   * @returns {{ok:boolean, reason?:string, exePath?:string, fixed?:boolean}}
   *   ok 时 exePath 是真正可用的可执行文件；fixed 表示原路径是文件夹、已被自动纠正。
   */
  validate(exePath) {
    const p = (exePath == null ? '' : String(exePath)).trim();
    if (!p) return { ok: false, reason: '可执行文件路径为空' };
    if (!fs.existsSync(p)) return { ok: false, reason: '文件不存在：' + p };
    let st;
    try {
      st = fs.statSync(p);
    } catch (e) {
      return { ok: false, reason: '无法访问文件：' + p + ' · ' + e.message };
    }
    if (st.isDirectory()) {
      const found = this._resolveExeIn(p);
      if (!found) {
        return { ok: false, reason: '这是文件夹，里面没找到 .exe：' + p + '，请选到具体的可执行文件' };
      }
      return { ok: true, exePath: found, fixed: true, reason: '已自动改用文件夹里的 ' + baseName(found) };
    }
    if (!st.isFile()) return { ok: false, reason: '不是有效文件：' + p };
    if (process.platform === 'win32' && !WIN_EXE_EXTS.includes(extName(p))) {
      return { ok: false, reason: 'Windows 下仅支持 .exe/.bat/.cmd/.com 可执行文件' };
    }
    return { ok: true, exePath: p };
  }

  // ---------------------------------------------------------------- 增删改

  async add({ name, exePath, args = '', setDefault = false } = {}) {
    const check = this.validate(exePath);
    if (!check.ok) throw new Error(check.reason);
    // 传进来的是安装目录时，落到真正能启动的那个 exe 上
    const target = check.exePath || String(exePath);

    const slicers = this._slicers().map((s) => ({ ...s }));
    const key = String(target).toLowerCase();
    const existing = slicers.find((s) => String(s.exePath).toLowerCase() === key);
    if (existing) {
      if (setDefault) {
        for (const s of slicers) s.isDefault = (s.id === existing.id);
        await this._write(slicers);
        return { ...slicers.find((s) => s.id === existing.id), autoFixedPath: check.fixed ? target : '' };
      }
      return { ...existing, autoFixedPath: check.fixed ? target : '' }; // 同 exePath 已存在：不重复添加
    }

    const item = {
      id: uid('sl'),
      name: (name != null && String(name).trim()) ? String(name).trim() : this._friendlyName(target),
      exePath: String(target),
      args: args == null ? '' : String(args),
      isDefault: false,
      detected: false,
      enabled: true,
    };
    if (setDefault) {
      for (const s of slicers) s.isDefault = false;
      item.isDefault = true;
    }
    slicers.push(item);
    await this._write(slicers);
    return { ...item, autoFixedPath: check.fixed ? target : '' };
  }

  async update(id, patch = {}) {
    const slicers = this._slicers().map((s) => ({ ...s }));
    const cur = slicers.find((s) => s.id === id);
    if (!cur) throw new Error('未找到该切片软件配置');
    const p = (patch && typeof patch === 'object') ? patch : {};

    if ('name' in p && p.name != null) cur.name = String(p.name).trim() || cur.name;
    if ('args' in p) cur.args = p.args == null ? '' : String(p.args);
    if ('enabled' in p) cur.enabled = !!p.enabled;
    if ('exePath' in p) {
      const check = this.validate(p.exePath);
      if (!check.ok) throw new Error(check.reason);
      cur.exePath = String(check.exePath || p.exePath);
    }
    if ('isDefault' in p) {
      if (p.isDefault) {
        for (const s of slicers) s.isDefault = false;
        cur.isDefault = true;
      } else {
        cur.isDefault = false;
      }
    }
    await this._write(slicers);
    return { ...cur };
  }

  async remove(id) {
    const slicers = this._slicers().map((s) => ({ ...s }));
    const idx = slicers.findIndex((s) => s.id === id);
    if (idx < 0) return; // 幂等：不存在则忽略
    slicers.splice(idx, 1);
    await this._write(slicers);
  }

  async setDefault(id) {
    const slicers = this._slicers().map((s) => ({ ...s }));
    if (!slicers.some((s) => s.id === id)) throw new Error('未找到该切片软件配置，无法设为默认');
    for (const s of slicers) s.isDefault = (s.id === id);
    await this._write(slicers);
  }

  // ---------------------------------------------------------------- 打开

  /** 解析要用的切片软件：显式 id 优先，否则默认启用项 */
  /**
   * 解析要用的切片软件。
   *   _pick(id)        —— 按设置里的 id 找
   *   _pick(_, obj)    —— 直接用给定对象（用于「探测到但还没写进设置」的临时项）
   * 后者很关键：detect() 每次返回的都是新造的随机 id，拿这个 id 回设置里查必然查不到。
   */
  _pick(slicerId, slicerObj) {
    const slicers = this._slicers();
    let slicer;
    if (slicerObj && slicerObj.exePath) {
      slicer = slicerObj;
    } else if (slicerId != null) {
      slicer = slicers.find((s) => s.id === slicerId);
      if (!slicer) throw new Error('未找到指定的切片软件：' + slicerId);
    } else {
      if (slicers.length === 0) throw new Error('尚未配置切片软件，请先在设置中添加');
      slicer = slicers.find((s) => s.isDefault && s.enabled) || slicers.find((s) => s.enabled);
      if (!slicer) throw new Error('没有已启用的切片软件，请先在设置中启用');
    }
    const check = this.validate(slicer.exePath);
    if (!check.ok) throw new Error('切片软件不可运行：' + check.reason);
    // 设置里存的是安装目录时，validate 会纠正成目录里的 exe，这里把纠正结果带下去
    if (check.exePath && check.exePath !== slicer.exePath) {
      return Object.assign({}, slicer, { exePath: check.exePath });
    }
    return slicer;
  }

  /**
   * 决定怎么启动目标程序。
   * Windows 下 .bat/.cmd 不能直接 spawn（Node 20 起为安全修复而禁止，会报 EINVAL），
   * 必须经 cmd.exe /c 转一道。切片软件本体都是 .exe，这里只是让「用户填了个 .bat」也能用。
   */
  _spawnPlan(exePath) {
    const ext = extName(exePath);
    if (process.platform === 'win32' && ['.bat', '.cmd'].includes(ext)) {
      const comspec = process.env.ComSpec || 'cmd.exe';
      return { cmd: comspec, pre: ['/d', '/s', '/c', exePath] };
    }
    return { cmd: exePath, pre: [] };
  }

  /** 用某个切片软件打开一组「已经确定好的文件路径」 */
  async openPaths(paths, { slicerId = null, slicer: slicerObj = null } = {}) {
    const slicer = this._pick(slicerId, slicerObj);
    const argsArray = this._splitArgs(slicer.args);
    const launched = [];
    const failed = [];

    for (const raw of Array.isArray(paths) ? paths : [paths]) {
      const filePath = String(raw || '');
      if (!filePath) { failed.push({ path: filePath, error: '路径为空' }); continue; }
      if (!this._isFile(filePath)) {
        failed.push({ path: filePath, error: '文件已失效：' + filePath });
        continue;
      }
      try {
        // 文件路径（可能含空格）作为单个数组元素；shell:false 防命令注入
        const { cmd, pre } = this._spawnPlan(slicer.exePath);
        const child = spawn(cmd, pre.concat(argsArray, [filePath]), {
          detached: true, stdio: 'ignore', shell: false, windowsHide: true,
        });
        child.on('error', () => {});
        child.unref();
        launched.push(filePath);
      } catch (e) {
        failed.push({ path: filePath, error: '启动切片软件失败：' + e.message });
      }
    }
    return { launched, failed, slicerId: slicer.id, slicerName: slicer.name };
  }

  async open(ids, { slicerId = null, slicer: slicerObj = null } = {}) {
    const idList = Array.isArray(ids) ? ids.slice() : (ids == null ? [] : [ids]);
    const slicer = this._pick(slicerId, slicerObj);

    const models = (this.store.getLibrary() || {}).models || {};
    const launched = [];
    const failed = [];
    const paths = [];

    for (const id of idList) {
      const record = models[id];
      if (!record || !record.path) {
        failed.push({ id, error: '未找到模型记录：' + id });
        continue;
      }
      const filePath = record.path;
      if (!this._isFile(filePath)) {
        failed.push({ id, error: '文件已失效：' + filePath });
        continue;
      }
      paths.push(filePath);
    }

    const r = await this.openPaths(paths, { slicer });
    for (const p of r.launched) {
      const id = idList.find((i) => models[i] && models[i].path === p);
      if (id) launched.push(id);
    }
    for (const f of r.failed) failed.push({ path: f.path, error: f.error });

    if (launched.length) this.emit('opened', { ids: launched.slice(), slicerId: slicer.id });
    return { launched, failed };
  }

  // ---------------------------------------------------------------- 系统交互

  async reveal(recordOrPath) {
    const raw = this._toPath(recordOrPath);
    if (!raw) throw new Error('未提供有效的文件路径');
    const abs = path.resolve(raw);
    if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);

    if (process.platform === 'win32') {
      // explorer 的 /select 与路径合并为单个参数最稳妥；失败时回退到两参数形式
      try { this._spawnDetached('explorer.exe', ['/select,' + abs]); }
      catch (_) { this._spawnDetached('explorer.exe', ['/select,', abs]); }
    } else if (process.platform === 'darwin') {
      this._spawnDetached('open', ['-R', abs]);
    } else {
      this._spawnDetached('xdg-open', [path.dirname(abs)]);
    }
  }

  async openDataDir() {
    try { corePaths.ensureDirs(); } catch (_) { /* 只读环境忽略 */ }
    const dir = corePaths.getDataDir();
    if (process.platform === 'win32') this._spawnDetached('explorer.exe', [dir]);
    else if (process.platform === 'darwin') this._spawnDetached('open', [dir]);
    else this._spawnDetached('xdg-open', [dir]);
  }

  async trash(paths) {
    const list = Array.isArray(paths) ? paths : (paths == null ? [] : [paths]);
    const ok = [];
    const failed = [];
    for (const item of list) {
      const target = String(item || '');
      if (!target) { failed.push({ path: target, error: '路径为空' }); continue; }
      if (!fs.existsSync(target)) {
        failed.push({ path: target, error: '文件不存在：' + target });
        continue;
      }
      // PowerShell 单引号字符串内，单引号写成两个以转义；绝不 fs.unlinkSync
      const escaped = target.replace(/'/g, "''");
      const script = 'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
        "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('" + escaped + "', " +
        '[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, ' +
        '[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)';
      const r = await this._runPowerShell(script);
      if (r.unavailable) {
        throw new Error('系统未找到可用的 PowerShell，无法将文件移入回收站');
      }
      if (r.ok) ok.push(target);
      else failed.push({ path: target, error: '移入回收站失败：' + (r.error || '未知错误') });
    }
    return { ok, failed };
  }

  async testLaunch(exePath) {
    const check = this.validate(exePath);
    if (!check.ok) return { ok: false, error: check.reason };
    try {
      fs.accessSync(String(exePath), fs.constants.R_OK);
    } catch (e) {
      return { ok: false, error: '文件不可访问：' + e.message };
    }
    return { ok: true }; // 仅可访问性校验，不真正启动 GUI
  }
}

// 兼容两种引入方式：const S = require('./slicer') 或 const { SlicerService } = require('./slicer')
module.exports = SlicerService;
module.exports.SlicerService = SlicerService;
