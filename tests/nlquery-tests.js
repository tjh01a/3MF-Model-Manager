'use strict';
/**
 * F · 自然语言搜索单测（docs/22 F）
 * 解析器是纯函数；查询过滤用内存 LibraryService，不碰磁盘。
 */
const { parseNL, hueOfHex, startOfMonth, startOfWeek } = require('../src/core/nlquery');
const { LibraryService } = require('../src/core/library');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '（实际 ' + JSON.stringify(a) + '）'); }

const NOW = new Date('2026-11-26T15:00:00+08:00').getTime();
const cats = [{ id: 'c1', name: '工具' }, { id: 'c2', name: '摆件' }];
const tags = [{ id: 't1', name: '客户单' }, { id: 't2', name: '测试' }];
const parse = (s) => parseNL(s, { now: NOW, categories: cats, tags });

console.log('\n[1] 中文条件');
let r = parse('上个月打印过的收纳盒');
eq(r.query.printedFrom, startOfMonth(new Date(NOW).setMonth(new Date(NOW).getMonth() - 1)), '上个月 from');
ok(r.chips.some((c) => /上个月/.test(c.label)), '有「上个月」chip');
eq(r.query.printStatuses, ['printed'], '打印过');
ok(/收纳盒/.test(r.query.keyword || r.leftover), '收纳盒 进关键字');

r = parse('最近 7 天收藏的四色模型');
ok(r.query.printedFrom > NOW - 8 * 86400000, '最近 7 天');
eq(r.query.favoritesOnly, true, '收藏');
eq(r.query.minColors, 4, '四色');

r = parse('大于 100MB 的绿色摆件');
ok(r.query.sizeMin >= 100 * 1024 * 1024 - 1, '大于 100MB');
eq(r.query.colorHues[0].h, 120, '绿色色相');
ok(r.chips.some((c) => c.type === 'sizeMin'));

r = parse('深蓝色的支架');
eq(r.query.colorHues[0].h, 230, '「深蓝」先于「蓝」匹配，不会被当成普通蓝');

r = parse('作者是小明的测试件');
eq(r.query.author, '小明', '作者');
ok(/测试件/.test(r.query.keyword));

r = parse('标签 客户单 的 PLA 模型');
eq(r.query.tagIds, ['t1'], '标签');
eq(r.query.filamentTypes, ['PLA'], '材质');

r = parse('没有打印过的工具');
eq(r.query.printStatuses, ['unprinted'], '未打印');
eq(r.query.categoryId, 'c1', '分类 工具');

r = parse('五星 的 手办');
eq(r.query.ratingMin, 5, '五星');
ok(/手办/.test(r.query.keyword));

r = parse('有重复的 支架');
eq(r.query.smart, 'duplicates', '重复视图');
ok(/支架/.test(r.query.keyword));

console.log('\n[2] 英文条件');
r = parse('last month printed PETG holder');
eq(r.query.printStatuses, ['printed'], 'printed');
eq(r.query.filamentTypes, ['PETG'], 'PETG');
ok(/holder/i.test(r.query.keyword || r.leftover));
ok(r.chips.some((c) => c.type === 'printedFrom'));

r = parse('favorites 5 stars blue models');
eq(r.query.favoritesOnly, true, 'favorites');
eq(r.query.ratingMin, 5, '5 stars');
eq(r.query.colorHues[0].h, 220, 'blue');

r = parse('bigger than 50MB this year');
ok(r.query.sizeMin >= 50 * 1024 * 1024 - 1, 'bigger than 50MB');
ok(r.query.printedFrom < NOW, 'this year');

r = parse('by tjh01a');
eq(r.query.author, 'tjh01a', 'by 作者');

console.log('\n[3] 无法识别时回落');
r = parse('随便什么奇怪的东西');
eq(r.chips.length, 0, '没有识别出条件');
eq(r.used, false, 'used=false');
eq(r.leftover, '随便什么奇怪的东西', '原文进 leftover');

console.log('\n[4] 色相换算');
ok(Math.abs(hueOfHex('#ff0000') - 0) < 1, '红 0°');
ok(Math.abs(hueOfHex('#00ff00') - 120) < 1, '绿 120°');
ok(Math.abs(hueOfHex('#0000ff') - 240) < 1, '蓝 240°');
eq(hueOfHex('#808080'), null, '灰色没有色相');
eq(hueOfHex('not-a-color'), null, '非法输入');

console.log('\n[5] library.query 结构化过滤');
const models = {
  a: { id: 'a', title: '绿色盒子', fileName: 'a.3mf', path: 'C:/m/a.3mf', status: 'ok', size: 60 * 1024 * 1024, createdAt: NOW - 3 * 86400000, lastPrintedAt: NOW - 2 * 86400000, author: '小明', printStatus: 'printed', meta: { filamentColors: ['#00ff00'], filamentTypes: ['PLA'] } },
  b: { id: 'b', title: '蓝色支架', fileName: 'b.3mf', path: 'C:/m/b.3mf', status: 'ok', size: 5 * 1024 * 1024, createdAt: NOW - 400 * 86400000, lastPrintedAt: null, printStatus: 'unprinted', meta: { filamentColors: ['#0000ff', '#ff0000'], filamentTypes: ['PETG'] } },
  c: { id: 'c', title: '四色摆件', fileName: 'c.3mf', path: 'C:/m/c.3mf', status: 'ok', size: 120 * 1024 * 1024, createdAt: NOW - 1 * 86400000, lastPrintedAt: NOW - 1 * 86400000, printStatus: 'printed', meta: { filamentColors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'], filamentTypes: ['PLA'] } },
};
const libData = { models, categories: cats, tags, folders: [], settings: {} };
const store = {
  getLibrary: () => libData,
  getSettings: () => ({ scan: {}, duplicates: {} }),
  updateLibrary: async (fn) => fn(libData),
};
const lib = new LibraryService({ store });
const ids = (q) => lib.query(q).items.map((x) => x.id).sort();
eq(ids({ colorHues: [{ h: 120, tol: 25 }] }), ['a', 'c'], '含绿色的 a/c 命中，b 不命中');
eq(ids({ minColors: 2 }), ['b', 'c'], '至少两色');
eq(ids({ filamentTypes: ['PETG'] }), ['b'], 'PETG 只命中 b');
eq(ids({ sizeMin: 100 * 1024 * 1024 }), ['c'], '大于 100MB');
eq(ids({ author: '小明' }), ['a'], '作者过滤');
eq(ids({ printedFrom: NOW - 3 * 86400000 }), ['a', 'c'], '最近三天打印过');
eq(ids({ colorsCount: 1 }), ['a'], '单色');

console.log('\n────────────────────────────');
console.log('自然语言测试：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { failures.forEach((f) => console.log('  · ' + f)); process.exit(1); }
