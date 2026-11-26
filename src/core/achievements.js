'use strict';
/**
 * I · 成就（docs/22 I）：纯本地规则，可复算。
 * unlockedAt 存在 data/achievements.json；规则只读模型/回执，不写别处。
 */

const fs = require('fs');
const path = require('path');
const U = require('./utils');

const RULES = [
  { id: 'first-model', title: '第一件作品', desc: '把第一个 3MF 放进模型库', target: 1, metric: 'models' },
  { id: 'ten-models', title: '小有收藏', desc: '模型库达到 10 个模型', target: 10, metric: 'models' },
  { id: 'fifty-models', title: '半个书架', desc: '模型库达到 50 个模型', target: 50, metric: 'models' },
  { id: 'first-print', title: '第一次开机', desc: '完成第一次打印', target: 1, metric: 'prints' },
  { id: 'ten-prints', title: '手感来了', desc: '累计完成 10 次打印', target: 10, metric: 'prints' },
  { id: 'fifty-prints', title: '打印老手', desc: '累计完成 50 次打印', target: 50, metric: 'prints' },
  { id: 'five-categories', title: '分类学家', desc: '至少 5 个分类下都有模型', target: 5, metric: 'categories' },
  { id: 'ten-tags', title: '标签控', desc: '模型库用到 10 个不同标签', target: 10, metric: 'tags' },
  { id: 'hundred-gb', title: '仓库管理员', desc: '模型库总大小超过 100 GB', target: 100, metric: 'gb' },
  { id: 'week-streak', title: '一周不断', desc: '同一自然周内完成 3 次打印', target: 3, metric: 'weekPrints' },
  { id: 'commercial-aware', title: '许可明白人', desc: '给 5 个模型补了许可信息', target: 5, metric: 'licensed' },
];

function metricOf(metric, ctx) {
  const models = ctx.models || [];
  const receipts = ctx.receipts || [];
  switch (metric) {
    case 'models': return models.length;
    case 'prints': return receipts.filter((r) => r.result === 'finished').length;
    case 'categories': return new Set(models.map((m) => m.categoryId).filter(Boolean)).size;
    case 'tags': return new Set(models.flatMap((m) => (Array.isArray(m.tagIds) ? m.tagIds : []))).size;
    case 'gb': return models.reduce((s, m) => s + (Number(m.size) || 0), 0) / (1024 * 1024 * 1024);
    case 'weekPrints': {
      // 任意自然周内最多完成几次
      const map = new Map();
      for (const r of receipts) {
        if (r.result !== 'finished') continue;
        const t = Number(r.endedAt || r.createdAt) || 0;
        if (!t) continue;
        const d = new Date(t); d.setHours(0, 0, 0, 0);
        const wd = (d.getDay() + 6) % 7;
        const key = d.getTime() - wd * 86400000;
        map.set(key, (map.get(key) || 0) + 1);
      }
      return map.size ? Math.max(...map.values()) : 0;
    }
    case 'licensed': return models.filter((m) => m.license || (m.meta && m.meta.license) || m.licenseUrl).length;
    default: return 0;
  }
}

class Achievements {
  constructor(file) {
    this.file = file || path.join(require('./paths').getDataDir(), 'achievements.json');
    this.data = { version: 1, items: {} };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j && j.items) this.data.items = j.items;
    } catch (_) { this.data = { version: 1, items: {} }; }
  }

  async flush() {
    const tmp = this.file + '.tmp';
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: U.now(), items: this.data.items }));
    try { await fs.promises.rename(tmp, this.file); }
    catch (_) { await fs.promises.copyFile(tmp, this.file); try { await fs.promises.unlink(tmp); } catch (_) {} }
  }

  /**
   * 计算全部成就；新解锁的写盘并返回 newly 列表。
   * @returns {{items:Array, newly:Array}}
   */
  async evaluate(ctx) {
    const items = [];
    const newly = [];
    for (const rule of RULES) {
      const value = metricOf(rule.metric, ctx || {});
      const unlocked = value >= rule.target;
      const prev = this.data.items[rule.id];
      if (unlocked && !prev) {
        this.data.items[rule.id] = { at: Date.now() };
        newly.push({ id: rule.id, title: rule.title, desc: rule.desc });
      }
      items.push({
        id: rule.id, title: rule.title, desc: rule.desc,
        unlocked: unlocked || !!prev,
        unlockedAt: (this.data.items[rule.id] || {}).at || null,
        progress: Math.min(value, rule.target),
        target: rule.target,
        ratio: Math.min(1, value / rule.target),
      });
    }
    if (newly.length) await this.flush();
    return { items, newly, unlockedCount: items.filter((x) => x.unlocked).length, total: items.length };
  }
}

module.exports = { Achievements, RULES, metricOf };
