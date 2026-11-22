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

class ReceiptService {
  constructor() {
    this._data = null;
    this._queue = Promise.resolve();
  }

  _file() { return paths.getReceiptsPath(); }

  async init() {
    paths.ensureDirs();
    try {
      const txt = await fsp.readFile(this._file(), 'utf8');
      const j = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);
      if (j && Array.isArray(j.items)) this._data = j;
      else this._data = emptyData();
    } catch (_) {
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
    const items = ((this._data && this._data.items) || []).slice().sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
    return Number.isFinite(n) && n > 0 ? items.slice(0, n) : items;
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

module.exports = { ReceiptService, normalizeJobName, matchModel, emptyData, MAX_ITEMS };
