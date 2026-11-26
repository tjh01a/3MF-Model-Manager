'use strict';
/** A · 同款变体按缩略图指纹分组：只认同图，不再靠几何相似硬凑。纯 Node 临时数据。 */

const path = require('path');
const TP = require('../src/core/thumbprint');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function rec(id, extra) {
  return Object.assign({
    id, createdAt: 100, thumbnail: id + '.png', status: 'ok', aliasOf: null,
    duplicateGroup: null, similarGroup: null, parseErrorKind: null,
  }, extra || {});
}
function lib(models) {
  const out = {};
  for (const m of models) out[m.id] = m;
  return { models: out };
}

const H0 = '0123456789abcdef0123456789abcdef01234567';
const H1 = '0123456789abcdef0123456789abcdef01234566'; // 只差 1 个字节，但不是同一张图
const HF = 'ffffffffffffffffffffffffffffffffffffffff';

console.log('\n[1. 同一张缩略图成组');
{
  const L = lib([
    rec('b', { createdAt: 200, thumbnail: 'b.png' }),
    rec('a', { createdAt: 100, thumbnail: 'a.png' }),
    rec('c', { createdAt: 300, thumbnail: 'c.png' }),
  ]);
  const out = TP.annotate(L, { a: H0, b: H0, c: H0 });
  ok('3 张同图 → 1 组 3 个', out.groups === 1 && out.members === 3, JSON.stringify(out));
  ok('基准是最早入库的 a', L.models.a.variantRole === 'base' && L.models.a.variantGroup === 'thumb:' + H0.slice(0, 12));
  ok('b / c 标为同一模型', L.models.b.variantRole === 'same' && L.models.c.variantRole === 'same');
  ok('不写缩放倍数（不是几何推断）', L.models.b.variantScale === null);
}

console.log('\n[2. 只认字节完全相同，不做相似度阈值');
{
  const L = lib([rec('a', { createdAt: 100 }), rec('b', { createdAt: 200 }), rec('c', { createdAt: 300 })]);
  const out = TP.annotate(L, { a: H0, b: H1, c: H0 });
  ok('a/c 同图成组，b 虽然很像但不进组', out.groups === 1 && out.members === 2 && !L.models.b.variantGroup, JSON.stringify(out));
  ok('同图成员分数为 1', L.models.c.variantScore === 1);
}
{
  const L = lib([rec('a', { createdAt: 100 }), rec('x', { createdAt: 200 })]);
  const out = TP.annotate(L, { a: H0, x: HF });
  ok('毫不相干的缩略图不成组', out.groups === 0 && !L.models.x.variantGroup);
}

console.log('\n[3. 不能参与的情况');
{
  const L = lib([
    rec('real', { createdAt: 100 }),
    rec('svg', { createdAt: 110, thumbnail: 'p.svg' }),
    rec('dup', { createdAt: 120, duplicateGroup: 'H1' }),
    rec('sim', { createdAt: 130, similarGroup: 'sim:1' }),
    rec('missing', { createdAt: 140, status: 'missing' }),
    rec('alias', { createdAt: 150, aliasOf: 'real' }),
    rec('broken', { createdAt: 160, parseErrorKind: 'truncated' }),
    rec('nothumb', { createdAt: 170, thumbnail: null }),
  ]);
  const out = TP.annotate(L, { real: H0, svg: H0, dup: H0, sim: H0, missing: H0, alias: H0, broken: H0, nothumb: H0 });
  ok('占位图 / 重复组 / 疑似组 / 失效 / 副本 / 解析失败 / 无缩略图都不参与', out.groups === 0 && out.checked === 1, JSON.stringify(out));
  ok('没有指纹的记录不会互相成组', !L.models.nothumb.variantGroup);
}

console.log('\n[4. 重算幂等 / 清空');
{
  const L = lib([rec('a', { createdAt: 100 }), rec('b', { createdAt: 200 })]);
  TP.annotate(L, { a: H0, b: H0 });
  const out = TP.annotate(L, { a: H0, b: H0 });
  ok('重复执行结果一致', out.groups === 1 && L.models.b.variantGroup === 'thumb:' + H0.slice(0, 12));
  TP.annotate(L, {});
  ok('没有指纹时清掉旧分组，不会残留', !L.models.a.variantGroup && !L.models.b.variantGroup);
}

console.log('\n' + '='.repeat(56));
console.log('  同款变体（缩略图）测试：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(56));
process.exitCode = fail ? 1 : 0;
