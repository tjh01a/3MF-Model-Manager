'use strict';
/** 重复识别：疑似组按「代表」聚类，不再链式越滚越大；完全重复与疑似不重复列。纯 Node。 */
const D = require('../src/core/duplicates');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function rec(id, extra) {
  return Object.assign({
    id, fileName: '打印徽章.u1.3mf', size: 1000, hash: null, createdAt: 100,
    status: 'ok', aliasOf: null, parseErrorKind: null,
  }, extra || {});
}

console.log('\n[1. 疑似组只和代表比，不链式扩散]');
{
  const models = {
    a: rec('a', { size: 1000 }),
    b: rec('b', { size: 1020 }),    // 比 a 大 2%
    c: rec('c', { size: 1040 }),    // 比 b 大 2%，但比 a 大 4%
  };
  const groups = D.findSimilar(models);
  ok('只分出一簇', groups.length === 1, JSON.stringify(groups));
  ok('c 不因为和 b 差 2% 就被串进来', groups[0].ids.join() === 'a,b', groups[0].ids.join());
}

console.log('\n[2. 完全重复与疑似不重复列]');
{
  const models = {
    x: rec('x', { hash: 'H', fileName: '打印徽章.u1 (1).3mf', createdAt: 100 }),
    y: rec('y', { hash: 'H', fileName: '打印徽章.u1 (2).3mf', createdAt: 200 }),
    z: rec('z', { hash: 'Z', fileName: '打印徽章.u1 (3).3mf', createdAt: 300 }),
  };
  const out = D.annotate({ models });
  ok('1 个完全重复组', out.groups === 1, JSON.stringify(out));
  ok('x / y 在完全重复组', models.x.duplicateGroup === 'H' && models.y.duplicateGroup === 'H');
  ok('主记录本身不写 duplicateOf', models.x.duplicateOf === null && models.y.duplicateOf === 'x',
    JSON.stringify({ x: models.x.duplicateOf, y: models.y.duplicateOf }));
  ok('同组文件不会又在疑似里出现', !models.x.similarGroup && !models.y.similarGroup);
  ok('剩下的单条不单列疑似组', !models.z.similarGroup);
}

console.log('\n[3. 失效 / 解析失败 / 副本不参与]');
{
  const models = {
    ok1: rec('ok1', { hash: 'H' }),
    ok2: rec('ok2', { hash: 'H' }),
    miss: rec('miss', { hash: 'H', status: 'missing' }),
    broken: rec('broken', { hash: 'H', parseErrorKind: 'truncated' }),
    alias: rec('alias', { hash: 'H', aliasOf: 'ok1' }),
  };
  D.annotate({ models });
  ok('只有两条有效记录进组', models.ok1.duplicateGroup === 'H' && models.ok2.duplicateGroup === 'H'
    && !models.miss.duplicateGroup && !models.broken.duplicateGroup && !models.alias.duplicateGroup);
}

console.log('\n' + '='.repeat(56));
console.log('  重复识别测试：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(56));
process.exitCode = fail ? 1 : 0;
