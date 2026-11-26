'use strict';
/**
 * D · 耗材库存（docs/22 D）。
 * 纯 Node，禁止 require('electron')。
 *
 * 数据：
 *  - 耗材记录本身存 stockG / fullG / lowG / spools / buyUrl（filaments.json）
 *  - 出入库流水单独存 data/stock-log.json，按 receiptId 幂等
 *
 * 口径：所有克数都是「估算」，界面必须标「约」；stockG=null 表示不管理库存。
 */

const fs = require('fs');
const path = require('path');
const U = require('./utils');

const DEFAULT_FULL_G = 1000;
const DEFAULT_LOW_RATIO = 0.1;

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function numOr(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function normalizeStockFields(rec) {
  const r = rec || {};
  const fullG = numOr(r.fullG, DEFAULT_FULL_G) || DEFAULT_FULL_G;
  const lowG = numOr(r.lowG, round2(fullG * DEFAULT_LOW_RATIO));
  return {
    stockG: r.stockG == null || r.stockG === '' ? null : numOr(r.stockG, 0),
    fullG,
    lowG,
    spools: Math.max(0, Math.floor(numOr(r.spools, 0))),
    buyUrl: typeof r.buyUrl === 'string' ? r.buyUrl.slice(0, 500) : '',
    lowNotifiedAt: Number.isFinite(Number(r.lowNotifiedAt)) ? Number(r.lowNotifiedAt) : 0,
  };
}

function stockOf(f) {
  const s = normalizeStockFields(f);
  return {
    ...s,
    managed: s.stockG != null,
    low: s.stockG != null && s.stockG <= s.lowG,
    remainingTotalG: s.stockG == null ? null : round2(s.stockG + s.spools * s.fullG),
    percent: s.stockG == null ? null : Math.max(0, Math.min(100, Math.round((s.stockG / s.fullG) * 100))),
  };
}

/** 采购建议：只列「现有 + 备用卷 ≤ 阈值」的耗材 */
function shoppingOf(f) {
  const s = stockOf(f);
  if (!s.managed) return null;
  if (s.stockG + s.spools * s.fullG > s.lowG) return null;
  const need = Math.max(1, Math.ceil((s.fullG - s.stockG) / s.fullG));
  return {
    id: f.id,
    name: f.name,
    brand: f.brand,
    type: f.type,
    color: f.color,
    stockG: s.stockG,
    spools: s.spools,
    lowG: s.lowG,
    fullG: s.fullG,
    suggestSpools: need,
    buyUrl: s.buyUrl,
  };
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

class Stock {
  /**
   * @param {object} opts { filaments, file }
   *   filaments 需提供 list()/get(id)/update(id, patch)
   */
  constructor({ filaments, file } = {}) {
    this.filaments = filaments;
    this.file = file || path.join(require('./paths').getDataDir(), 'stock-log.json');
    this.data = { version: 1, items: [] };
    this._queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j && Array.isArray(j.items)) this.data.items = j.items;
    } catch (_) { this.data = { version: 1, items: [] }; }
  }

  async _flush() {
    const tmp = this.file + '.tmp';
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: U.now(), items: this.data.items }));
    try { await fs.promises.rename(tmp, this.file); }
    catch (_) {
      await fs.promises.copyFile(tmp, this.file);
      try { await fs.promises.unlink(tmp); } catch (_) { /* 忽略 */ }
    }
  }

  _mutate(fn) {
    const job = this._queue.then(async () => {
      const r = await fn(this.data);
      await this._flush();
      return r;
    });
    this._queue = job.catch(() => {});
    return job;
  }

  _entry(rec) {
    const r = rec || {};
    return {
      id: String(r.id || ''),
      at: Number(r.at) || 0,
      filamentId: String(r.filamentId || ''),
      filamentName: String(r.filamentName || ''),
      deltaG: Number(r.deltaG) || 0,
      deltaSpools: Number(r.deltaSpools) || 0,
      kind: ['print', 'manual', 'open', 'undo'].includes(r.kind) ? r.kind : 'manual',
      receiptId: r.receiptId ? String(r.receiptId) : null,
      modelName: r.modelName ? String(r.modelName) : '',
      note: r.note ? String(r.note).slice(0, 200) : '',
      undoOf: r.undoOf ? String(r.undoOf) : null,
    };
  }

  _dedupKey(receiptId, filamentId) {
    return 'print|' + receiptId + '|' + filamentId;
  }

  log(limit) {
    const n = Number(limit);
    const items = this.data.items.map((x) => this._entry(x))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    return Number.isFinite(n) && n > 0 ? items.slice(0, n) : items;
  }

  has(receiptId, filamentId) {
    if (!receiptId) return false;
    const key = this._dedupKey(receiptId, filamentId);
    return this.data.items.some((x) => x && x._key === key);
  }

  status(filamentId) {
    const f = this.filaments.get(filamentId);
    if (!f) return null;
    const s = stockOf(f);
    return { id: f.id, name: f.name, type: f.type, color: f.color, ...s };
  }

  /** 全部耗材的库存概览（不管理库存的也返回，managed=false） */
  overview() {
    const items = (this.filaments.list() || {}).items || [];
    const mapped = items.map((f) => ({ id: f.id, name: f.name, brand: f.brand, type: f.type, color: f.color, ...stockOf(f) }));
    const low = mapped.filter((x) => x.low);
    return { items: mapped, lowCount: low.length, managedCount: mapped.filter((x) => x.managed).length };
  }

  lowList() {
    return this.overview().items.filter((x) => x.low);
  }

  shoppingList() {
    const items = (this.filaments.list() || {}).items || [];
    return items.map(shoppingOf).filter(Boolean);
  }

  shoppingCsv() {
    const rows = this.shoppingList();
    const head = ['名称', '品牌', '类型', '颜色', '剩余(g)', '备用卷', '阈值(g)', '整卷(g)', '建议购买(卷)', '购买链接'];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([
        r.name, r.brand, r.type, r.color || '', round2(r.stockG), r.spools,
        r.lowG, r.fullG, r.suggestSpools, r.buyUrl || '',
      ].map(csvCell).join(','));
    }
    return '\ufeff' + lines.join('\r\n') + '\r\n';   // BOM 让 Excel 正确识别 UTF-8
  }

  /**
   * 回执扣减：parts 来自 cost.costOf()，只处理有 filamentId 且克数有效的行。
   * 同一回执同一耗材只扣一次；stockG=null 的耗材跳过。
   * @returns {{ok:boolean, deducted:Array, skipped:Array}}
   */
  async deductReceipt(receipt, parts) {
    const rc = receipt || {};
    if (!rc.id || !Array.isArray(parts)) return { ok: true, deducted: [], skipped: [] };
    const deducted = [];
    const skipped = [];
    const updates = new Map();
    const seen = new Set();
    for (const p of parts) {
      const fid = p && p.filamentId;
      const grams = Number(p && p.grams);
      if (!fid || !(grams > 0)) { skipped.push({ filamentId: fid || null, reason: !fid ? 'no-filament' : 'no-grams' }); continue; }
      if (seen.has(fid) || this.has(rc.id, fid)) { skipped.push({ filamentId: fid, reason: 'already' }); continue; }
      seen.add(fid);
      const f = this.filaments.get(fid);
      if (!f) { skipped.push({ filamentId: fid, reason: 'missing' }); continue; }
      const s = stockOf(f);
      if (!s.managed) { skipped.push({ filamentId: fid, reason: 'unmanaged' }); continue; }
      const before = updates.has(fid) ? updates.get(fid) : s.stockG;
      const after = round2(Math.max(0, before - grams));
      const actual = round2(before - after);       // 钳到 0 时实际只扣了这么多，撤销要按实际值反算
      updates.set(fid, after);
      deducted.push({
        filamentId: fid, name: f.name, grams: round2(grams), actual,
        before, after, clamped: before - grams < 0,
      });
    }
    for (const [fid, after] of updates) {
      await this.filaments.update(fid, { stockG: after });
    }
    if (deducted.length) {
      await this._mutate((d) => {
        for (const row of deducted) {
          d.items.push({
            id: 'st-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            at: Date.now(),
            filamentId: row.filamentId,
            filamentName: row.name,
            deltaG: -row.actual,
            deltaSpools: 0,
            kind: 'print',
            receiptId: rc.id,
            modelName: rc.modelTitle || rc.jobName || '',
            note: row.clamped ? '按 ' + row.grams + ' g 估算，库存只够 ' + row.actual + ' g，已扣到 0，建议称重' : '',
            _key: this._dedupKey(rc.id, row.filamentId),
          });
        }
      });
    }
    return { ok: true, deducted, skipped };
  }

  /**
   * 手动调整：{ filamentId, stockG?, addSpools?, buyUrl?, note? }
   * stockG 是「称重后的剩余克数」，addSpools 是「+N 卷备用」。
   */
  async adjust({ filamentId, stockG, addSpools, buyUrl, note } = {}) {
    const id = String(filamentId || '');
    const f = this.filaments.get(id);
    if (!f) throw new Error('找不到这个耗材');
    const before = stockOf(f);
    const patch = {};
    let deltaG = 0;
    let deltaSpools = 0;
    if (stockG != null && stockG !== '') {
      const after = numOr(stockG, 0);
      patch.stockG = after;
      deltaG = round2(after - (before.stockG == null ? 0 : before.stockG));
    }
    if (addSpools != null && addSpools !== '') {
      const add = Math.floor(numOr(addSpools, 0));
      patch.spools = Math.max(0, before.spools + add);
      deltaSpools = add;
    }
    if (buyUrl != null) patch.buyUrl = String(buyUrl).slice(0, 500);
    if (!Object.keys(patch).length) throw new Error('没有要调整的内容');
    await this.filaments.update(id, patch);
    const rec = await this._mutate((d) => {
      const item = {
        id: 'st-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        at: Date.now(),
        filamentId: id,
        filamentName: f.name,
        deltaG,
        deltaSpools,
        kind: 'manual',
        note: String(note || '').slice(0, 200),
      };
      d.items.push(item);
      return item;
    });
    return { ok: true, entry: this._entry(rec), status: this.status(id) };
  }

  /** 撤销一条流水：反向加减；已被后续操作混合时只反算这一笔 */
  async undo(logId) {
    const key = String(logId || '');
    const target = this.data.items.find((x) => x && x.id === key);
    if (!target) throw new Error('找不到这条流水');
    if (target.kind === 'undo') throw new Error('撤销记录不能再次撤销');
    if (this.data.items.some((x) => x && x.undoOf === key)) throw new Error('这笔流水已经撤销过');
    const f = this.filaments.get(target.filamentId);
    if (!f) throw new Error('这条流水对应的耗材已被删除');
    const s = stockOf(f);
    const patch = {};
    if (target.deltaG) patch.stockG = round2(Math.max(0, (s.stockG == null ? 0 : s.stockG) - Number(target.deltaG)));
    if (target.deltaSpools) patch.spools = Math.max(0, s.spools - Number(target.deltaSpools));
    if (!Object.keys(patch).length) throw new Error('这条流水没有可撤销的库存变化');
    await this.filaments.update(target.filamentId, patch);
    await this._mutate((d) => {
      d.items.push({
        id: 'st-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        at: Date.now(),
        filamentId: target.filamentId,
        filamentName: target.filamentName || f.name,
        deltaG: -Number(target.deltaG || 0),
        deltaSpools: -Number(target.deltaSpools || 0),
        kind: 'undo',
        note: '撤销 ' + (target.note || target.kind),
        undoOf: key,
      });
    });
    return { ok: true, status: this.status(target.filamentId) };
  }

  /** 每日一次的低库存提醒标记（防止重复弹） */
  async markLowNotified(filamentId) {
    await this.filaments.update(filamentId, { lowNotifiedAt: Date.now() });
  }
}

module.exports = {
  Stock, stockOf, shoppingOf, normalizeStockFields,
  DEFAULT_FULL_G, DEFAULT_LOW_RATIO,
};
