'use strict';
/**
 * 1000 条 mock 的大库查询/筛选性能测试（纯 Node，无需 Electron）。
 * 只测 LibraryService.query 的过滤/分面/分页，不写磁盘。
 *
 * 运行：node tests/ui-p0-large-library.js
 */
const path = require('path');
const Library = require('../src/core/library');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failures.push({ name, e });
    console.log('  FAIL ' + name + ' :: ' + e.message);
  }
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + '：' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

const N = 1000;
const lib = {
  models: {},
  categories: [
    { id: 'cat-a', name: 'A 类', order: 0 },
    { id: 'cat-b', name: 'B 类', order: 1 },
  ],
  tags: [
    { id: 'tag-red', name: '红色', color: '#ef4444' },
    { id: 'tag-blue', name: '蓝色', color: '#3b82f6' },
  ],
  savedViews: [],
  folders: [],
};
const now = Date.now();
for (let i = 0; i < N; i++) {
  const id = 'm' + String(i).padStart(4, '0');
  const special = i === 731;
  lib.models[id] = {
    id,
    title: (special ? 'Needle 特制夹具' : '压力测试模型 ' + i),
    fileName: 'stress-' + i + '.3mf',
    path: path.join('C:\\mock', 'stress-' + i + '.3mf'),
    size: 1024 * (i + 1),
    createdAt: now - i * 60000,
    mtime: now - i * 60000,
    printStatus: ['unprinted', 'queued', 'printed'][i % 3],
    status: 'ok',
    favorite: i % 50 === 0,
    categoryId: i % 2 ? 'cat-b' : 'cat-a',
    tagIds: i % 4 === 0 ? ['tag-red'] : (i % 4 === 1 ? ['tag-blue'] : ['tag-red', 'tag-blue']),
    meta: { objectCount: 1, plateCount: 1, filamentColors: ['#888888'] },
  };
}
const store = {
  getLibrary() { return lib; },
  getSettings() { return { ui: { view: 'grid' } }; },
  async updateLibrary(fn) { return fn(lib); },
};
const svc = new Library({ store });

function timed(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { out, ms };
}

console.log('[1] 大库全量 / 筛选 / 分页');
test('1000 条全量查询不丢记录', () => {
  const r = timed(() => svc.query({ smart: 'all', limit: 0 }));
  eq(r.out.total, N);
  eq(r.out.items.length, N);
  ok(r.ms < 1000, '全量查询耗时 ' + r.ms.toFixed(1) + 'ms，超过 1000ms 预算');
  console.log('      全量 ' + N + ' 条：' + r.ms.toFixed(1) + 'ms');
});
test('关键词只命中唯一记录', () => {
  const r = timed(() => svc.query({ keyword: 'Needle', limit: 0 }));
  eq(r.out.total, 1);
  eq(r.out.items[0].id, 'm0731');
  ok(r.ms < 500, '关键词查询 ' + r.ms.toFixed(1) + 'ms，超过 500ms 预算');
});
test('打印状态筛选数量正确', () => {
  const r = timed(() => svc.query({ printStatuses: ['printed'], limit: 0 }));
  eq(r.out.total, 333);
  ok(r.out.items.every((m) => m.printStatus === 'printed'), '混入了非 printed 记录');
});
test('分类 + 标签组合筛选正确', () => {
  const r = svc.query({ categoryId: 'cat-a', tagIds: ['tag-red'], tagMode: 'all', limit: 0 });
  ok(r.total > 0, '组合筛选不应为空');
  ok(r.items.every((m) => m.categoryId === 'cat-a' && m.tagIds.includes('tag-red')), '组合筛选结果不纯');
});
test('分页只返回 50 条但 total 仍是 1000', () => {
  const r = svc.query({ limit: 50, offset: 0 });
  eq(r.items.length, 50);
  eq(r.total, N);
});
test('分面统计没有 NaN', () => {
  const r = svc.query({ limit: 0 });
  ok(r.facets && typeof r.facets === 'object', '缺少 facets');
  for (const [k, v] of Object.entries(r.facets)) {
    if (typeof v === 'number') ok(Number.isFinite(v), 'facets.' + k + ' 不是有限数字');
  }
});

console.log('\n[2] 排序稳定性');
test('名称升序 / 降序首尾互为镜像', () => {
  const asc = svc.query({ sortBy: 'name', sortDir: 'asc', limit: 0 });
  const desc = svc.query({ sortBy: 'name', sortDir: 'desc', limit: 0 });
  eq(asc.items.length, N);
  eq(desc.items.length, N);
  eq(asc.items[0].id, desc.items[N - 1].id, '升序首条 ≠ 降序末条');
  eq(asc.items[N - 1].id, desc.items[0].id, '升序末条 ≠ 降序首条');
});

console.log('\n' + (failures.length ? '大库性能：失败 ' + failures.length : '大库性能：' + passed + '/' + passed + ' 通过'));
if (failures.length) {
  for (const f of failures) console.error(f.name + '\n' + (f.e.stack || f.e));
  process.exitCode = 1;
}
