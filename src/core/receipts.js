'use strict';
/**
 * 打印回执服务（13 · 打印回执）。纯 Node，禁止 require('electron')。
 *
 * 数据：data/receipts.json（与耗材库一样，不进 library 备份机制）
 * 触发：monitor 的 finished / error 通知 → services 调 add()
 * 保留 200 条，超出丢最旧；文件不会无限长大。
 *
 * 重要：回执里的成本 / 耗材名是「生成时的快照」，之后改耗材价格不影响历史回执。
 */

const fs = require('fs');
const fsp = fs.promises;
const paths = require('./paths');

const MAX_ITEMS = 200;

function emptyData() {
  return { schemaVersion: 1, updatedAt: Date.now(), items: [] };
}

/** 旧回执缺字段时补齐，避免列表渲染 undefined（P0-16）。 */
function normalizeReceipt(rec) {
  const r = (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : {};
  const now = Number.isFinite(Number(r.endedAt)) ? Number(r.endedAt) : Date.now();
  const started = Number.isFinite(Number(r.startedAt)) ? Number(r.startedAt) : now;
  const endAt = Number.isFinite(Number(r.endedAt)) ? Number(r.endedAt) : now;
  return {
    ...r,
    id: r.id == null ? '' : String(r.id),
    jobName: typeof r.jobName === 'string' ? r.jobName : '未命名任务',
    printerId: typeof r.printerId === 'string' ? r.printerId : '',
    printerName: typeof r.printerName === 'string' ? r.printerName : '',
    result: r.result === 'error' ? 'error' : 'finished',
    startedAt: started,
    endedAt: endAt,
    modelId: r.modelId == null ? null : r.modelId,
    modelTitle: typeof r.modelTitle === 'string' ? r.modelTitle : null,
    linkedAt: (r.linkedAt == null || r.linkedAt === '') ? null
      : (Number.isFinite(Number(r.linkedAt)) ? Number(r.linkedAt) : null),
    linkedManually: !!r.linkedManually,
    // Number(null) 会变成 0；缺失重量必须保持 null，不能伪装成 0g。
    weightG: (r.weightG == null || r.weightG === '') ? null
      : (Number.isFinite(Number(r.weightG)) ? Number(r.weightG) : null),
    cost: Number.isFinite(Number(r.cost)) ? Number(r.cost) : 0,
    filamentNames: Array.isArray(r.filamentNames) ? r.filamentNames.slice(0, 12) : [],
    note: typeof r.note === 'string' ? r.note : '',
    durationMin: Number.isFinite(Number(r.durationMin))
      ? Number(r.durationMin) : Math.max(0, Math.round((endAt - started) / 60000)),
  };
}

/** 损坏文件留底名；原始字节不能被静默覆盖。 */
function corruptBackupPath(file) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  // 毫秒固定 3 位：否则 -57 会排在 -570 前后错位，备份名也不再定宽。
  const ms = (n) => String(n).padStart(3, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms(d.getMilliseconds())}`;
  return `${file}.corrupt-${stamp}`;
}

async function atomicWrite(target, data) {
  const tmp = target + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  try {
    await fsp.writeFile(tmp, data);
    try { await fsp.rename(tmp, target); }
    catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
        try { await fsp.unlink(target); } catch (_) { /* 目标不存在 */ }
        await fsp.rename(tmp, target);
      } else throw e;
    }
  } catch (e) {
    try { await fsp.unlink(tmp); } catch (_) { /* 清理 */ }
    throw e;
  }
}

/** 规范化打印文件名，用于和库里的模型做精确匹配。去掉路径、扩展名、U1 转换后缀。 */
function normalizeJobName(s) {
  let n = String(s == null ? '' : s).trim();
  try { n = decodeURIComponent(n); } catch (_) { /* 保留原值 */ }
  n = n.replace(/\\/g, '/');
  n = n.substring(n.lastIndexOf('/') + 1);
  n = n.replace(/\.(3mf|gcode|gco)$/i, '');
  n = n.replace(/_U1_[0-9a-f]{8}$/i, '');       // 本工具转换产物的哈希后缀
  n = n.replace(/_已优化$/i, '');
  return n.trim().toLowerCase();
}

/** 按 jobName 在模型列表里找唯一匹配；不模糊，宁可漏不可错（用户确认要自动改状态，必须保守） */
function matchModel(jobName, models) {
  const key = normalizeJobName(jobName);
  if (!key) return null;
  const hits = (Array.isArray(models) ? models : Object.values(models || {})).filter((m) => {
    if (!m || m.status === 'missing') return false;
    return normalizeJobName(m.fileName || m.path) === key;
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 更激进的归一：把切片/分批打印产生的「同源不同名」剥成同一个名字。
 *
 * 实际遇到的写法（都指同一个模型）：
 *   沙奈朵拆(3)_plate_2 / 沙奈朵拆_plate_4 / 沙奈朵拆(3) / 沙奈朵拆 copy
 *   xxx_PETG_6h4m / xxx_1 / xxx（分多次打印，后缀编号会变）
 * 所以循环剥离：盘号、括号编号、copy/副本、纯数字尾标，直到不再变化。
 */
function looseJobName(name) {
  let n = String(name == null ? '' : name).trim();
  try { n = decodeURIComponent(n); } catch (_) { /* 保留原值 */ }
  n = n.replace(/\\/g, '/');
  n = n.substring(n.lastIndexOf('/') + 1);
  n = n.replace(/\.(3mf|gcode|gco|stl|obj)$/i, '');
  n = n.replace(/[.][a-z0-9]{1,6}$/i, '');            // 其它扩展名
  n = n.replace(/_U1_[0-9a-f]{8}$/i, '');
  n = n.replace(/_已优化$/i, '');
  for (let i = 0; i < 5; i++) {
    const before = n;
    // 注意不要用 \b：下划线属于 \w，"…_plate_2" 里 "_p" 之间没有词边界，
    // 早先写成 \b 会整条规则失效，只剩 "_plate" 剥不掉。
    n = n.replace(/[_\-\s]*(?:plate|盘)\s*[_\-\s]*\d*$/i, '');          // _plate_2 / plate2 / 盘_2
    n = n.replace(/\s*[（(\[【]\s*\d+\s*[)）\]】]\s*$/, '');            // (3) （2） [1] 【4】
    n = n.replace(/[_\-\s]*(?:copy|副本|拷贝)\s*\d*$/i, '');           // _copy2 / 副本
    n = n.replace(/[_\-\s]*(?:pla|petg|abs|asa|tpu|pa|pc|pva|hips)(?:[_\-\s]*\d+h\d+m?)?$/i, '');
    n = n.replace(/[_\-\s]+\d{1,3}$/, '');                              // 尾部编号 _1 / -02
    if (n === before) break;
  }
  return n.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 名字相似度：先看归一后是否相等/包含，再退回字符二元组 Dice 系数 */
function nameScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.86 + 0.1 * ratio;      // 0.86~0.96：包含关系算很像，但比完全相等低
  }
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a); const gb = grams(b);
  let hit = 0; let total = 0;
  for (const [g, n] of ga) { total += n; const o = gb.get(g); if (o) hit += Math.min(n, o); }
  for (const n of gb.values()) total += n;
  return total ? (2 * hit) / total : 0;
}

/**
 * 模糊匹配（用于「自动关联打印任务」，不直接改打印状态）。
 * 返回 { model, score, ambiguous }：
 *   - 只有唯一最高分且 ≥ minScore 才给 model，两个模型一样像时宁可返回 null。
 *   - score ≥ 0.98 可以认为是同一文件；0.72~0.98 是「名字大致匹配」。
 */
function matchModelFuzzy(jobName, models, opts = {}) {
  const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.72;
  const key = looseJobName(jobName);
  const rawKey = normalizeJobName(jobName);
  if (!key || key.length < 2) return { model: null, score: 0, ambiguous: false };
  const list = Array.isArray(models) ? models : Object.values(models || {});
  const prefixLen = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  const scored = [];
  for (const m of list) {
    if (!m || m.status === 'missing') continue;
    const names = [m.fileName, m.title].filter(Boolean);
    let s = 0;
    let raw = 0;
    let pre = 0;
    for (const nm of names) {
      s = Math.max(s, nameScore(key, looseJobName(nm)));
      const rk = normalizeJobName(nm);
      raw = Math.max(raw, nameScore(rawKey, rk));
      pre = Math.max(pre, prefixLen(rawKey, rk));
    }
    // 归一后相同（都是「沙奈朵拆」）时，靠原始名字区分：
    // 「沙奈朵拆(3)_plate_2」显然更该连「沙奈朵拆(3)」而不是「沙奈朵拆」。
    scored.push({ model: m, loose: s, raw, pre, score: s * 0.75 + raw * 0.25 });
  }
  if (!scored.length) return { model: null, score: 0, ambiguous: false };
  scored.sort((a, b) => (b.loose - a.loose) || (b.raw - a.raw) || (b.pre - a.pre));
  const best = scored[0];
  if (best.loose < minScore || best.score < minScore) {
    return { model: null, score: best.score, ambiguous: false };
  }
  // 只有「归一、原始相似度、公共前缀」三项都打平，才算真的分不清。
  // 早先只卡分数差，会让「沙奈朵拆(3)_plate_2」这种明明有更接近的名字被判成歧义。
  const second = scored[1];
  if (second && (best.loose - second.loose) < 1e-9
    && (best.raw - second.raw) < 0.02
    && best.pre === second.pre) {
    return { model: null, score: best.score, ambiguous: true };
  }
  return { model: best.model, score: best.score, ambiguous: false };
}

class ReceiptService {
  constructor() {
    this._data = null;
    this._queue = Promise.resolve();
    this.recovery = null;
  }

  _file() { return paths.getReceiptsPath(); }

  async init() {
    paths.ensureDirs();
    const file = this._file();
    let raw = null;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (e) {
      // 第一次启动文件不存在是正常的；其它读取失败一字不写。
      if (e && e.code === 'ENOENT') {
        this.recovery = { kind: 'missing', file };
        this._data = emptyData();
        await this._flush();
        return this;
      }
      this.recovery = { kind: 'unreadable', file, code: (e && e.code) || 'EUNKNOWN' };
      throw new Error('打印回执文件无法读取（可能被其它程序占用，错误码 '
        + ((e && e.code) || 'EUNKNOWN') + '）：' + file + '。为避免覆盖你的数据，本次不做任何写入。');
    }
    let j = null;
    try {
      j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch (_) {
      // JSON 损坏：先留底，再从空数据启动；原文件字节保存在 .corrupt-* 里。
      const backup = corruptBackupPath(file);
      try { await fsp.copyFile(file, backup); }
      catch (e) { throw new Error('回执文件已损坏，且无法另存备份（' + (e && e.message ? e.message : String(e)) + '）：' + file); }
      this.recovery = { kind: 'corrupt', file, backup };
      this._data = emptyData();
      await this._flush();
      return this;
    }
    if (j && Array.isArray(j.items)) {
      this._data = j;
      this._data.items = this._data.items.map(normalizeReceipt);
    } else {
      const backup = corruptBackupPath(file);
      try { await fsp.copyFile(file, backup); }
      catch (e) { throw new Error('回执文件结构无效，且无法另存备份（' + (e && e.message ? e.message : String(e)) + '）：' + file); }
      this.recovery = { kind: 'invalid-structure', file, backup };
      this._data = emptyData();
      await this._flush();
    }
    return this;
  }

  async _flush() {
    this._data.updatedAt = Date.now();
    let items = this._data.items;
    if (items.length > MAX_ITEMS) items = items.slice(items.length - MAX_ITEMS);
    this._data.items = items;
    await atomicWrite(this._file(), JSON.stringify(this._data, null, 2));
  }

  _mutate(fn) {
    const job = this._queue.then(async () => {
      const r = await fn(this._data);
      await this._flush();
      return r;
    });
    this._queue = job.catch(() => {});
    return job;
  }

  /**
   * 落一条回执。
   * @param {object} p {jobName, printerId, printerName, result:'finished'|'error', startedAt, endedAt,
   *                     modelId, weightG, cost, filamentNames, note}
   */
  async add(p) {
    const d = p || {};
    const now = Date.now();
    const rec = {
      id: 'rcp-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      jobName: String(d.jobName || '未命名任务').slice(0, 300),
      printerId: String(d.printerId || ''),
      printerName: String(d.printerName || ''),
      result: d.result === 'error' ? 'error' : 'finished',
      startedAt: Number(d.startedAt) || now,
      endedAt: Number(d.endedAt) || now,
      modelId: d.modelId || null,
      modelTitle: null,
      linkedAt: null,
      linkedManually: false,
      weightG: Number.isFinite(Number(d.weightG)) && Number(d.weightG) > 0 ? Number(d.weightG) : null,
      cost: Number.isFinite(Number(d.cost)) ? Math.round(Number(d.cost) * 100) / 100 : 0,
      filamentNames: Array.isArray(d.filamentNames) ? d.filamentNames.slice(0, 12) : [],
      note: String(d.note || '').slice(0, 300),
    };
    rec.durationMin = Math.max(0, Math.round((rec.endedAt - rec.startedAt) / 60000));
    await this._mutate((data) => { data.items.push(rec); });
    return rec;
  }

  list(limit) {
    const n = Number(limit);
    const items = ((this._data && this._data.items) || []).map(normalizeReceipt)
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
    return Number.isFinite(n) && n > 0 ? items.slice(0, n) : items;
  }

  /** 按 id 取单条回执（关联模型前确认记录还在） */
  get(id) {
    const key = String(id == null ? '' : id);
    if (!key) return null;
    const rec = ((this._data && this._data.items) || []).find((r) => String(r && r.id) === key);
    return rec ? normalizeReceipt(rec) : null;
  }

  /**
   * 手动关联 / 改绑 / 清除模型。
   * 只改 receipts.json 里的 modelId 与显示名快照，不动模型库、不碰磁盘文件，
   * 成本 / 用料仍是回执生成时的历史快照，不随新关联的模型重算。
   */
  async linkModel(id, modelId, modelTitle, opts = {}) {
    const key = String(id == null ? '' : id);
    const manual = opts.manual !== false;   // 默认按「用户手动」记；自动关联传 {manual:false}
    let found = false;
    await this._mutate((d) => {
      for (const r of d.items || []) {
        if (String(r && r.id) !== key) continue;
        found = true;
        r.modelId = modelId ? String(modelId) : null;
        r.modelTitle = modelId && modelTitle ? String(modelTitle).slice(0, 300) : null;
        r.linkedAt = modelId ? Date.now() : null;
        r.linkedManually = modelId ? manual : false;
        break;
      }
    });
    return { ok: found, modelId: modelId ? String(modelId) : null };
  }

  /**
   * 找「同一台机器的同一次打印」已经落过的回执，用于去重：
   * 掉线重连、重启后补判都可能对同一任务再发一次完成事件。
   * 判定：同 printerId + 同名任务 + 结果相同 + 开始/结束时间相差在窗口内。
   */
  findRecentJob(printerId, jobName, at, windowMs = 6 * 3600 * 1000) {
    const pid = String(printerId || '');
    const name = String(jobName || '');
    const t = Number(at) || Date.now();
    if (!pid || !name) return null;
    const items = (this._data && this._data.items) || [];
    for (let i = items.length - 1; i >= 0; i--) {
      const r = items[i];
      if (!r || r.printerId !== pid) continue;
      if (String(r.jobName || '') !== name) continue;
      if (Math.abs((Number(r.endedAt) || 0) - t) <= windowMs) return normalizeReceipt(r);
    }
    return null;
  }

  /** 汇总：只统计成功回执，成本/用料都是历史快照之和 */
  summary() {
    const items = this.list();
    const done = items.filter((r) => r.result === 'finished');
    return {
      prints: done.length,
      failures: items.length - done.length,
      totalGrams: done.reduce((s, r) => s + (Number(r.weightG) || 0), 0),
      totalCost: Math.round(done.reduce((s, r) => s + (Number(r.cost) || 0), 0) * 100) / 100,
    };
  }

  async clear() {
    await this._mutate((d) => { d.items = []; });
    return { ok: true };
  }

  /**
   * 按回执 id 删除选中的几条（长按编辑模式用）。
   * 只动回执记录，不碰模型库和磁盘文件；找不到的 id 记入 failed，不报错。
   */
  async delete(ids) {
    const wanted = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
    if (!wanted.length) return { ok: true, deleted: 0, failed: [] };
    const set = new Set(wanted);
    const missing = new Set(wanted);
    await this._mutate((d) => {
      d.items = d.items.filter((r) => {
        if (!set.has(String(r.id))) return true;
        missing.delete(String(r.id));
        return false;
      });
    });
    return { ok: true, deleted: wanted.length - missing.size, failed: Array.from(missing) };
  }
}

module.exports = {
  ReceiptService, normalizeJobName, looseJobName, matchModel, matchModelFuzzy,
  normalizeReceipt, corruptBackupPath, emptyData, MAX_ITEMS,
};
