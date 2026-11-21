'use strict';
/**
 * 快造 Orca 预设读取（契约 U1-D1）。
 * 纯 Node 实现：只依赖 Node 内置模块与 core 基础层。
 *
 * 为什么需要这个模块：
 *   3MF 里的 `filament_settings_id` 只是「这份配置来自哪个预设」的溯源标签。
 *   实测：同一份文件只改这个标签，切片出来的温度完全不变——Orca 用的是配置文件里内嵌的数值。
 *   所以要让用户的「拓竹petg」真正生效，必须把预设的参数沿 inherits 链解析出来再写进配置。
 *
 * 预设的两种来源：
 *   系统预设  <Orca 安装目录>/resources/profiles/<厂商>/{filament,process,machine}/*.json
 *   用户预设  %APPDATA%/<AppData 目录>/user/default/{filament,process}/*.json
 */
const fs = require('fs');
const path = require('path');

const { SLICER_CANDIDATES } = require('./constants');

/** 变体相关键：2.4 起一个耗材在同一预设里并排存「标准流量 / 高流量」两套值。 */
const FLOW_VARIANT_KEYS = new Set([
  'filament_flow_ratio', 'enable_pressure_advance', 'pressure_advance', 'nozzle_temperature_initial_layer',
  'nozzle_temperature', 'filament_max_volumetric_speed', 'fan_min_speed', 'fan_max_speed',
  'additional_cooling_fan_speed', 'filament_retraction_length', 'filament_retraction_speed',
  'filament_deretraction_speed', 'filament_z_hop_types', 'filament_wipe_distance',
  'filament_retract_length_toolchange', 'filament_multitool_ramming', 'filament_multitool_ramming_volume',
  'filament_multitool_ramming_flow', 'filament_minimal_purge_on_wipe_tower',
]);

/** 合并时跳过的身份/元信息键——它们描述「这是哪个预设」，不是「预设怎么打印」。 */
const META_SKIP = new Set([
  'name', 'from', 'inherits', 'inherits_from', 'version', 'type', 'instantiation',
  'is_custom_defined', 'setting_id', 'filament_settings_id', 'print_settings_id',
  'compatible_printers', 'compatible_printers_condition', 'compatible_prints',
  'compatible_prints_condition', 'printer_model', 'printer_settings_id', 'printer_variant',
]);

function mkdirpSafe(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (_) { /* 只读环境 */ } }

/**
 * 读一个 JSON 文件，容忍 UTF-8 BOM。
 *
 * 实测（2026-11-14，快造 Orca 2.4.1）：`0.20mm Standard @Snapmaker U1 (0.4 nozzle).json`
 * 和 `fdm_process_common.json` 开头带 BOM，JSON.parse 会抛 `Unexpected token '\ufeff'`。
 * 旧的实现 catch 之后 `continue`，于是这两个预设静默消失 —— 而 U1 的所有工艺预设
 * 都继承自它们，用户自建的工艺预设因此全部变成孤儿：UI 里看不到、参数也解析不出来。
 * 这类问题不会报错，只会「感觉预设不见了」，所以必须在这里兜住。
 */
function readJsonFile(file) {
  const txt = fs.readFileSync(file, 'utf8');
  return JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);
}

const KINDS = {
  filament: { sys: 'filament', user: 'filament' },
  process: { sys: 'process', user: 'process' },
  machine: { sys: 'machine', user: 'machine' },
};

class OrcaPresets {
  constructor({ store } = {}) {
    this.store = store || null;
    this._index = new Map(); // kind -> { stamp, byName: Map }
  }

  // ------------------------------------------------------------------ 路径

  _slicers() {
    const s = (this.store && this.store.getSettings && this.store.getSettings()) || {};
    return Array.isArray(s.slicers) ? s.slicers : [];
  }

  _isFile(p) {
    try { return !!p && fs.existsSync(p) && fs.statSync(p).isFile(); } catch (_) { return false; }
  }

  /**
   * 找快造 Orca 的安装目录。优先用设置里已配置的切片软件，其次按候选表探测，
   * 最后兜底本机实际安装路径。找不到就返回空串（调用方降级为「不合并预设」）。
   */
  installDir() {
    for (const s of this._slicers()) {
      const exe = String(s && s.exePath || '');
      if (!exe) continue;
      if (/snapmaker[_-]?orca/i.test(exe)) {
        const dir = path.dirname(exe);
        if (this._isProfileRoot(dir)) return dir;
      }
    }
    const roots = [];
    const add = (d) => { if (d) roots.push(String(d)); };
    add(process.env.ProgramFiles);
    add(process.env['ProgramFiles(x86)']);
    for (const d of ['C', 'D', 'E', 'F']) {
      add(`${d}:\\Program Files`);
      add(`${d}:\\Program Files (x86)`);
    }
    for (const c of SLICER_CANDIDATES) {
      if (!/snapmaker/i.test(c.name + ' ' + c.rel)) continue;
      for (const r of roots) {
        const dir = path.join(r, path.dirname(c.rel));
        if (this._isProfileRoot(dir)) return dir;
      }
    }
    for (const p of ['C:\\Program Files\\Snapmaker_Orca', 'C:\\Program Files\\Snapmaker Orca']) {
      if (this._isProfileRoot(p)) return p;
    }
    return '';
  }

  _isProfileRoot(dir) {
    try {
      return fs.existsSync(path.join(dir, 'resources', 'profiles'));
    } catch (_) { return false; }
  }

  /**
   * 用户配置根目录（可能不存在）。
   *
   * ⚠️ 顺序很重要：快造 Orca 用 `Snapmaker_Orca`，原版 OrcaSlicer 用 `OrcaSlicer`，
   * 两个程序会装在同一台机器上（实测本机就有 Microsoft Store 版 OrcaSlicer 2.5.0）。
   * 原版那套里也会有同名预设，混进来会把快造的值覆盖掉，所以：
   *   - 只要存在任一 Snapmaker 目录，就完全不理 `OrcaSlicer`；
   *   - 一个 Snapmaker 目录都没有时，才退回到 `OrcaSlicer`（个别改版只认这个名字）。
   */
  userRoots() {
    const appData = process.env.APPDATA;
    const home = process.env.USERPROFILE || process.env.HOME;
    const snapNames = ['Snapmaker_Orca', 'SnapmakerOrca', 'Snapmaker Orca'];
    const fallback = ['OrcaSlicer'];

    const expand = (names) => {
      const out = [];
      // Windows 上 %APPDATA% 就等于 %USERPROFILE%\AppData\Roaming，
      // 两条都拼会得到同一个目录（测试里还会串到真实目录），所以有 APPDATA 时只认它。
      if (appData) {
        for (const n of names) out.push(path.join(appData, n, 'user', 'default'));
      } else if (home) {
        for (const n of names) out.push(path.join(home, 'AppData', 'Roaming', n, 'user', 'default'));
      }
      // 非 Windows 或旧版本把配置放在 ~/.config
      if (home) for (const n of names) out.push(path.join(home, '.config', n, 'user', 'default'));
      return out;
    };

    const dedupe = (list) => {
      const seen = new Set();
      return list.filter((p) => {
        const k = p.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        try { return fs.existsSync(p); } catch (_) { return false; }
      });
    };

    const snap = dedupe(expand(snapNames));
    return snap.length ? snap : dedupe(expand(fallback));
  }

  /** 某类预设的所有候选目录，用户目录在前（同名时用户覆盖系统） */
  _dirs(kind) {
    const spec = KINDS[kind];
    if (!spec) return [];
    const dirs = [];
    for (const u of this.userRoots()) dirs.push({ dir: path.join(u, spec.user), user: true });
    const inst = this.installDir();
    if (inst) {
      const base = path.join(inst, 'resources', 'profiles');
      const vendors = ['Snapmaker', 'OrcaFilamentLibrary', 'Custom'];
      for (const v of vendors) dirs.push({ dir: path.join(base, v, spec.sys), user: false });
    }
    return dirs.filter((d) => { try { return fs.existsSync(d.dir); } catch (_) { return false; } });
  }

  // ------------------------------------------------------------------ 索引

  /**
   * 索引失效依据。
   * 系统目录几百个文件，只看目录 mtime 就够（不会有人去改安装目录）；
   * 但**用户目录**必须看到文件级变化 —— 原地改一个预设的 json、或者同名覆盖，
   * 目录 mtime 是不变的，只靠它就会一直返回旧内容，直到重启。
   */
  _stampOf(dirs) {
    return dirs.map((d) => {
      try {
        const dirM = fs.statSync(d.dir).mtimeMs;
        if (!d.user) return d.dir + ':' + dirM;
        const files = fs.readdirSync(d.dir).filter((f) => /\.(json|info)$/i.test(f));
        let sig = 0;
        for (const f of files) {
          try {
            const st = fs.statSync(path.join(d.dir, f));
            sig += st.mtimeMs + st.size;
          } catch (_) { /* 文件刚被删，忽略 */ }
        }
        return d.dir + ':' + dirM + ':' + files.length + ':' + Math.round(sig);
      } catch (_) { return d.dir + ':0'; }
    }).join('|');
  }

  /** 建立 name → { file, user } 索引。目录变动后自动重建。 */
  _indexOf(kind) {
    const dirs = this._dirs(kind);
    const stamp = this._stampOf(dirs);
    const hit = this._index.get(kind);
    if (hit && hit.stamp === stamp) return hit.byName;

    const byName = new Map();
    // 用户目录先扫，先入为主；系统预设不覆盖同名用户预设
    for (const d of dirs) {
      let files = [];
      try { files = fs.readdirSync(d.dir).filter((f) => /\.json$/i.test(f)); } catch (_) { continue; }
      for (const f of files) {
        const full = path.join(d.dir, f);
        let o;
        try { o = readJsonFile(full); } catch (_) { continue; }
        // 一个文件可能声明多个名字（filament_settings_id 是数组），但真正的键是 name
        const names = [];
        if (typeof o.name === 'string' && o.name) names.push(o.name);
        for (const key of ['filament_settings_id', 'print_settings_id', 'printer_settings_id']) {
          if (Array.isArray(o[key])) for (const n of o[key]) if (typeof n === 'string' && n) names.push(n);
        }
        for (const n of names) {
          if (!byName.has(n)) byName.set(n, { file: full, user: d.user, raw: o });
        }
      }
    }
    this._index.set(kind, { stamp, byName });
    return byName;
  }

  /** 列举某类预设（默认只列用户自建的） */
  list(kind, { userOnly = true } = {}) {
    const byName = this._indexOf(kind);
    const out = [];
    for (const [name, rec] of byName) {
      if (userOnly && !rec.user) continue;
      if (!userOnly && rec.user) continue;
      out.push({
        name,
        inherits: typeof rec.raw.inherits === 'string' ? rec.raw.inherits : '',
        from: rec.raw.from || (rec.user ? 'User' : 'System'),
        user: rec.user,
        // 耗材类型只知道继承链才知道，这里留空由 resolve 补
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return out;
  }

  // ------------------------------------------------------------------ 解析

  /**
   * 走一遍 inherits 链，返回 { names, missing }。
   *
   * missing 是「链上引用了、但当前找不到」的预设名。系统预设有 OTA 自动同步
   * （Snapmaker_Orca.conf 里 sync_system_preset=true），父预设一旦被改名或下架，
   * 子预设就变成孤儿：文件还在 user 目录里，Orca 却解析不出来，在列表里就等于消失了。
   * 这是「预设经常不见了」最主要的成因，所以单独做成可查询的接口。
   */
  chain(kind, name) {
    const byName = this._indexOf(kind);
    const names = [];
    const missing = [];
    const seen = new Set();
    let cur = name;
    while (cur) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const rec = byName.get(cur);
      if (!rec) { missing.push(cur); break; }
      names.push(cur);
      cur = typeof rec.raw.inherits === 'string' ? rec.raw.inherits : '';
    }
    return { names, missing };
  }

  /** 沿 inherits 链把预设展平成单个对象（子覆盖父）。找不到返回 null。 */
  resolve(kind, name, _seen) {
    if (!name) return null;
    const byName = this._indexOf(kind);
    const rec = byName.get(name);
    if (!rec) return null;
    const seen = _seen || new Set();
    if (seen.has(name)) return { ...rec.raw }; // 环保护：遇到重复就停
    seen.add(name);

    const parentName = typeof rec.raw.inherits === 'string' ? rec.raw.inherits : '';
    const parent = parentName ? this.resolve(kind, parentName, seen) : null;
    const merged = Object.assign({}, parent || {});
    const own = { ...rec.raw };
    delete own.inherits_from;
    // inherits 保留下来只为展示「这个预设从谁继承」，toSlotValues 会跳过它
    return Object.assign(merged, own);
  }

  /** 解析结果的摘要，给 UI 显示「这个预设到底会用什么温度」 */
  summary(kind, name) {
    const o = this.resolve(kind, name);
    if (!o) return null;
    const pick = (k) => {
      const v = o[k];
      if (v == null) return null;
      if (Array.isArray(v)) return v.length ? v[0] : null;
      return v;
    };
    return {
      name,
      inherits: o.inherits || '',
      material: pick('filament_type'),
      nozzle: pick('nozzle_temperature'),
      bed: pick('hot_plate_temp') || pick('cool_plate_temp'),
      flow: pick('filament_flow_ratio'),
      mvs: pick('filament_max_volumetric_speed'),
      layerHeight: pick('layer_height'),
    };
  }

  /**
   * 把一个预设展平后转成「按槽位展开」的键值对。
   * 关键点：同一个键可能是「每槽一个值」，也可能是「同一耗材的多个流量变体」。
   * 变体数组必须挑标准流量那一个，不能按槽位硬展开（否则槽 1 会拿到槽 0 的高流量值）。
   */
  toSlotValues(kind, name, slots) {
    const flat = this.resolve(kind, name);
    if (!flat) return null;
    const n = Math.max(1, slots | 0);

    // 变体数：filament_flow_support 的长度；没有就按 1 算
    const support = Array.isArray(flat.filament_flow_support)
      ? flat.filament_flow_support.map(String)
      : (Array.isArray(flat.process_flow_support) ? flat.process_flow_support.map(String) : []);
    const variantCount = support.length > 1 ? support.length : 1;
    const stdIdx = Math.max(0, support.indexOf('standard'));

    const out = {};
    for (const [k, v] of Object.entries(flat)) {
      if (META_SKIP.has(k)) continue;
      if (k === 'filament_flow_support' || k === 'process_flow_support' || k === 'filament_flow_step_size') continue;
      if (v == null) continue;
      if (!Array.isArray(v)) { out[k] = new Array(n).fill(v); continue; }

      if (v.length === n && !(variantCount > 1 && v.length === variantCount)) {
        out[k] = v.slice(); // 本来就是一槽一个
      } else if (v.length === 1) {
        out[k] = new Array(n).fill(v[0]);
      } else if (v.length === variantCount) {
        const pick = v[stdIdx] != null ? v[stdIdx] : v[0];
        out[k] = new Array(n).fill(pick); // 变体数组 → 取标准流量
      } else if (FLOW_VARIANT_KEYS.has(k) && v.length >= variantCount) {
        const pick = v[stdIdx] != null ? v[stdIdx] : v[0];
        out[k] = new Array(n).fill(pick);
      } else {
        out[k] = new Array(n).fill(v[0]); // 兜底：取第一个
      }
    }
    return out;
  }

  /** 清空索引缓存（设置变更 / 外部改动后调用） */
  invalidate() { this._index.clear(); }
}

module.exports = OrcaPresets;
module.exports.OrcaPresets = OrcaPresets;
