'use strict';
/**
 * 快造 Orca 用户预设的「保护」：快照、恢复、体检（契约 U1-D2）。
 * 纯 Node，禁止 require('electron')。
 *
 * 背景（实测 2026-11-14）：
 *   拓竹的预设跟着拓竹账号云同步；快造这边不一样 —— `%APPDATA%\Snapmaker_Orca\
 *   Snapmaker_Orca.conf` 里写着 `"sync_user_preset": false`，而每个预设的 `.info`
 *   里 `user_id` 和 `setting_id` 都是空的。也就是说这些预设**从来没上过云**，
 *   世界上只有一份，就在 `%APPDATA%\Snapmaker_Orca\user\default\{filament,process,machine}\`。
 *
 *   那一份还非常脆：
 *     ① 预设靠 `inherits` 指向系统预设，系统预设有 OTA 自动同步（sync_system_preset=true），
 *        父预设被改名/下架 → 子预设变孤儿，文件还在但列表里没了；
 *     ② 版本升级会重建 user 目录（本机就留着一个空的 user_backup-v2.4.1）；
 *     ③ 重置配置 / 重装 / 换机，这一份就彻底没了。
 *
 * 所以这里做的事很直接：定期把这几个 json 复制一份存在我们自己的数据目录里，
 * 变了就留新快照，少了就提醒，需要时一键写回去。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const corePaths = require('./paths');

const KINDS = ['filament', 'process', 'machine'];
const KEEP_DEFAULT = 30;

function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }

class PresetGuard {
  constructor({ store, presets } = {}) {
    if (!presets || typeof presets.list !== 'function') {
      throw new Error('PresetGuard 初始化失败：需要传入 OrcaPresets 实例');
    }
    this.store = store || null;
    this.presets = presets;
  }

  // ------------------------------------------------------------------ 路径

  backupRoot() {
    return path.join(corePaths.getDataDir(), 'preset-backups');
  }

  /** 当前用户预设的真实目录（只含存在的） */
  userDirs() {
    const out = [];
    for (const root of this.presets.userRoots()) {
      for (const kind of KINDS) {
        const dir = path.join(root, kind);
        try {
          if (fs.statSync(dir).isDirectory()) out.push({ kind, dir });
        } catch (_) { /* 没有这类预设 */ }
      }
    }
    return out;
  }

  /** 枚举当前所有用户预设文件（json + info 成对） */
  files() {
    const out = [];
    for (const { kind, dir } of this.userDirs()) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch (_) { continue; }
      for (const n of names) {
        if (!/\.json$/i.test(n)) continue;
        const base = n.replace(/\.json$/i, '');
        const jsonPath = path.join(dir, n);
        const infoPath = path.join(dir, base + '.info');
        let st;
        try { st = fs.statSync(jsonPath); } catch (_) { continue; }
        out.push({
          kind,
          name: base,
          jsonPath,
          infoPath: isFile(infoPath) ? infoPath : '',
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
    out.sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name, 'zh'));
    return out;
  }

  /** 内容指纹：文件名 + 大小 + mtime。用来判断「和上次比变没变」 */
  fingerprint() {
    const h = crypto.createHash('sha1');
    for (const f of this.files()) {
      h.update(f.kind + '/' + f.name + ':' + f.size + ':' + Math.round(f.mtimeMs));
    }
    return h.digest('hex').slice(0, 16);
  }

  counts() {
    const c = { filament: 0, process: 0, machine: 0, total: 0 };
    for (const f of this.files()) { c[f.kind] = (c[f.kind] || 0) + 1; c.total++; }
    return c;
  }

  // ------------------------------------------------------------------ 体检

  /**
   * 检查每个用户预设能否被解析出来。
   * @returns {{counts, presets:Array, broken:Array, ignoredRoots:Array, foreignDirs:Array}}
   */
  health() {
    const broken = [];
    const presets = [];
    for (const f of this.files()) {
      const ch = this.presets.chain(f.kind, f.name);
      const info = this.readInfo(f.infoPath);
      const item = {
        kind: f.kind,
        name: f.name,
        path: f.jsonPath,
        inherits: ch.names.length > 1 ? ch.names[1] : '',
        missing: ch.missing,
        ok: ch.missing.length === 0,
        baseId: info.base_id || '',
        synced: !!info.setting_id,
      };
      presets.push(item);
      if (!item.ok) broken.push(item);
    }

    // 原版 OrcaSlicer 的预设目录如果也在，列出来说明「已忽略」——本机实测两个都装着
    const foreign = [];
    for (const name of this._foreignRootNames()) {
      const root = this._rootOf(name);
      if (!root) continue;
      let n = 0;
      for (const kind of KINDS) {
        try { n += fs.readdirSync(path.join(root, kind)).filter((x) => /\.json$/i.test(x)).length; }
        catch (_) { /* 没有 */ }
      }
      foreign.push({ app: name, dir: root, presets: n });
    }

    return { counts: this.counts(), presets, broken, foreign };
  }

  _foreignRootNames() {
    return ['OrcaSlicer'];
  }

  _rootOf(appName) {
    const appData = process.env.APPDATA;
    if (!appData) return '';
    const p = path.join(appData, appName, 'user', 'default');
    try { return fs.statSync(p).isDirectory() ? p : ''; } catch (_) { return ''; }
  }

  readInfo(infoPath) {
    const out = {};
    if (!infoPath || !isFile(infoPath)) return out;
    let txt = '';
    try { txt = fs.readFileSync(infoPath, 'utf8'); } catch (_) { return out; }
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  // ------------------------------------------------------------------ 快照

  /** 一份快照的元信息（从 meta.json 读） */
  _metaOf(dir) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    } catch (_) { return null; }
  }

  list() {
    const root = this.backupRoot();
    let names = [];
    try { names = fs.readdirSync(root); } catch (_) { return []; }
    const out = [];
    for (const n of names) {
      const dir = path.join(root, n);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch (_) { continue; }
      const meta = this._metaOf(dir);
      if (!meta) continue;
      out.push({ id: n, dir, ...meta });
    }
    out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return out;
  }

  latest() {
    return this.list()[0] || null;
  }

  /**
   * 打一份快照。
   * @param {{reason?:string, force?:boolean}} opts force=true 时即使指纹没变也照打
   * @returns {{id, dir, files, bytes, skipped}|null} skipped=true 表示内容没变
   */
  snapshot({ reason = 'manual', force = false } = {}) {
    const files = this.files();
    if (!files.length) return null;
    const fp = this.fingerprint();
    const last = this.latest();
    if (!force && last && last.fingerprint === fp) {
      return { id: last.id, dir: last.dir, files: last.files || 0, bytes: last.bytes || 0, skipped: true };
    }

    const id = nowStamp();
    const dir = path.join(this.backupRoot(), id);
    // 同一秒内重复打快照：加后缀，别覆盖
    let finalDir = dir;
    let n = 1;
    while (fs.existsSync(finalDir)) { finalDir = dir + '-' + (++n); }
    mkdirp(finalDir);

    let bytes = 0;
    const saved = [];
    for (const f of files) {
      const sub = path.join(finalDir, 'files', f.kind);
      mkdirp(sub);
      const dstJson = path.join(sub, f.name + '.json');
      try {
        fs.copyFileSync(f.jsonPath, dstJson);
        bytes += fs.statSync(dstJson).size;
      } catch (_) { continue; }
      if (f.infoPath) {
        try {
          const dstInfo = path.join(sub, f.name + '.info');
          fs.copyFileSync(f.infoPath, dstInfo);
          bytes += fs.statSync(dstInfo).size;
        } catch (_) { /* info 缺了也能回写，只是少点元信息 */ }
      }
      saved.push({ kind: f.kind, name: f.name });
    }

    const meta = {
      at: new Date().toISOString(),
      reason,
      fingerprint: fp,
      files: saved.length,
      bytes,
      counts: this.counts(),
      items: saved,
      source: (this.presets.userRoots()[0] || ''),
    };
    fs.writeFileSync(path.join(finalDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    this.prune();
    return { id: path.basename(finalDir), dir: finalDir, files: saved.length, bytes, skipped: false };
  }

  /**
   * 从快照写回。
   * 只「新增 + 覆盖」，绝不删除现有文件 —— 万一快照比现在旧，也不能把新的抹掉。
   * 写回前会先给当前状态打一份快照，方便后悔。
   */
  restore(id) {
    // 防御路径穿越：id 只允许是「单段目录名」，不能是 ../../xxx 或绝对路径
    const raw = String(id || '');
    const safe = path.basename(raw);
    if (!raw || safe !== raw || safe === '.' || safe === '..') {
      throw new Error('快照编号不合法：' + raw);
    }
    const backupRoot = this.backupRoot();
    const dir = path.join(backupRoot, safe);
    if (!path.resolve(dir).startsWith(path.resolve(backupRoot) + path.sep)) {
      throw new Error('快照路径越界，已拒绝');
    }
    const meta = this._metaOf(dir);
    if (!meta) throw new Error('找不到这份预设快照：' + (id || '(空)'));

    const before = this.snapshot({ reason: '恢复前自动备份', force: true });
    const root = this.presets.userRoots()[0];
    if (!root) throw new Error('找不到快造 Orca 的用户配置目录，无法恢复');

    const added = [];
    const overwritten = [];
    const failed = [];
    const srcDir = path.join(dir, 'files');
    for (const kind of KINDS) {
      const srcKind = path.join(srcDir, kind);
      let names = [];
      try { names = fs.readdirSync(srcKind); } catch (_) { continue; }
      const dstKind = path.join(root, kind);
      mkdirp(dstKind);
      for (const n of names) {
        const from = path.join(srcKind, n);
        const to = path.join(dstKind, n);
        const existed = isFile(to);
        try {
          fs.copyFileSync(from, to);
          (existed ? overwritten : added).push(kind + '/' + n.replace(/\.(json|info)$/i, ''));
        } catch (e) {
          failed.push({ file: kind + '/' + n, error: e.message });
        }
      }
    }
    // 目录 mtime 变了，索引要重建
    this.presets.invalidate();
    return {
      ok: failed.length === 0,
      added: [...new Set(added)],
      overwritten: [...new Set(overwritten)],
      failed,
      safetySnapshot: before ? before.id : null,
      source: { id, at: meta.at, reason: meta.reason },
    };
  }

  /** 只留最近 keep 份快照 */
  prune(keep = KEEP_DEFAULT) {
    const all = this.list();
    const drop = all.slice(Math.max(1, keep));
    for (const s of drop) {
      try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (_) { /* 删不掉就算了 */ }
    }
    return { kept: Math.min(all.length, Math.max(1, keep)), removed: drop.length };
  }

  /**
   * 启动时调用：内容变了就打一份；顺带和上一份比数量，少了就报出来。
   * @returns {{snapshot, delta, message}}
   */
  autoSnapshot() {
    const prev = this.latest();
    const cur = this.counts();
    const snap = this.snapshot({ reason: 'auto' });
    let delta = null;
    if (prev && prev.counts) {
      const before = prev.counts.total || 0;
      const after = cur.total;
      if (after < before) {
        delta = { before, after, lost: before - after };
      }
    }
    let message = '';
    if (delta) {
      message = '快造预设比上次少了 ' + delta.lost + ' 个（上次 ' + delta.before
        + ' 个，现在 ' + delta.after + ' 个）。已保留上一份快照，可在设置 → 切片软件里恢复。';
    }
    return { snapshot: snap, delta, message };
  }
}

module.exports = PresetGuard;
module.exports.KINDS = KINDS;
