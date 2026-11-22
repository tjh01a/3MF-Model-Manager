'use strict';
/**
 * 重量回填单元测试（src/core/weights.js）。
 * 纯内存 + 系统临时目录，不启 Electron。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../src/core/paths');
const { weightPatch, needsWeightParse } = require('../src/core/weights');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-weights-'));
paths.setDataDir(tmp);

section('1. weightPatch 合并策略');
{
  const oldMeta = { objectCount: 3, filamentColors: ['#ffffff'], weightG: null };
  const fresh = { weightG: 90.39, weightSource: 'slice_info', filamentUsages: [{ usedG: 90.39 }] };
  const p = weightPatch(oldMeta, fresh);
  ok('写入重量与来源', p.weightG === 90.39 && p.weightSource === 'slice_info');
  ok('写入逐耗材用量', Array.isArray(p.filamentUsages) && p.filamentUsages.length === 1);
  ok('保留旧 meta 的其它字段（对象数）', p.objectCount === 3);
  ok('保留旧 meta 的色板', Array.isArray(p.filamentColors) && p.filamentColors[0] === '#ffffff');
  ok('打上 checked 标记', p.weightChecked === true);

  const noWeight = weightPatch(oldMeta, { weightG: null, weightSource: null, filamentUsages: [] });
  ok('没重量时 weightG 归 null', noWeight.weightG === null);
  ok('没重量也打 checked，避免反复解析', noWeight.weightChecked === true);
  ok('没重量时用量为空数组', Array.isArray(noWeight.filamentUsages) && noWeight.filamentUsages.length === 0);

  const failed = weightPatch(oldMeta, null);
  ok('解析失败不抛错且标记 checked', failed.weightG === null && failed.weightChecked === true);
}

section('2. needsWeightParse 目标筛选');
{
  const base = { path: 'D:/m/a.3mf', status: 'ok', meta: {} };
  ok('普通无重量记录需要解析', needsWeightParse(base) === true);
  ok('已有重量不再解析', needsWeightParse({ ...base, meta: { weightG: 12.5 } }) === false);
  ok('已 checked 的不再解析', needsWeightParse({ ...base, meta: { weightChecked: true } }) === false);
  ok('已失效跳过', needsWeightParse({ ...base, status: 'missing' }) === false);
  ok('非 3mf 跳过', needsWeightParse({ ...base, path: 'D:/m/a.stl' }) === false);
  ok('没有路径跳过', needsWeightParse({ ...base, path: '' }) === false);
  ok('空记录安全', needsWeightParse(null) === false);
  ok('有重量且 checked 也跳过',
    needsWeightParse({ ...base, meta: { weightG: 1, weightChecked: true } }) === false);
}

console.log('\n────────────────────────────');
console.log((fail === 0 ? '  全部通过' : '  有失败') + '：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail === 0 ? 0 : 1);
