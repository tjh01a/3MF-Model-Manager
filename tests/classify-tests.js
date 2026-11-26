'use strict';
/**
 * 预设词库自动分类的单元测试（docs/12）。
 * 纯内存，不碰真实库、不启 Electron。
 */
const C = require('../src/core/classify');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const categories = [
  { id: 'c_fn', name: '功能件', order: 0 },
  { id: 'c_deco', name: '摆件装饰', order: 1 },
  { id: 'c_test', name: '测试校准', order: 2 },
  { id: 'c_part', name: '备件维修', order: 3 },
  { id: 'c_disc', name: '唱片/绘画', order: 4 },
];
const rules = C.presetRules(categories);

// ---------- 1. 预设解析 ----------
section('1. 预设词库解析');
ok('五个分类都解析出规则', rules.length === 5, 'got ' + rules.length);
ok('规则顺序与侧栏一致（测试校准最先）', rules[0].categoryId === 'c_test');
ok('「唱片/绘画」别名能解析', rules.some((r) => r.categoryId === 'c_disc'));
ok('分类不存在时不硬造规则', C.presetRules([{ id: 'x', name: '别的分类' }]).length === 0);
ok('关键词都已清洗（无空值）', rules.every((r) => r.keywords.length > 0 && r.keywords.every((k) => k.length >= 2)));

section('1b. 英文界面词库（docs/21）');
const enCategories = [
  { id: 'en_fn', name: 'Functional Parts' },
  { id: 'en_deco', name: 'Figures & Decor' },
  { id: 'en_test', name: 'Test & Calibration' },
  { id: 'en_part', name: 'Spare Parts & Repair' },
];
const enRules = C.presetRules(enCategories, 'en-US');
ok('英文分类生成 4 条规则', enRules.length === 4, 'got ' + enRules.length);
ok('英文关键词命中 benchy → 测试校准',
  C.matchCategory({ title: 'Benchy calibration print' }, enRules) === 'en_test');
ok('英文关键词命中 holder → 功能件',
  C.matchCategory({ title: 'Desk holder for cables' }, enRules) === 'en_fn');
ok('英文关键词命中 miniature → 摆件',
  C.matchCategory({ title: 'Dragon miniature figure' }, enRules) === 'en_deco');
ok('显式英文语言时词库用英文关键词（中文分类名作为兼容别名）',
  C.presetRules(categories, 'en-US').some((r) => r.keywords.includes('holder'))
  && !C.presetRules(categories, 'en-US').some((r) => r.keywords.includes('高达')));
ok('不传语言时仍保持中文词库',
  C.presetRules(categories).some((r) => r.keywords.includes('高达')));

// ---------- 2. 匹配 ----------
section('2. 匹配命中');
const hit = (title, extra) => C.matchCategory(Object.assign({ title }, extra || {}), rules);
ok('测试件 → 测试校准', hit('0.6圆底拼接测试') === 'c_test');
ok('首层测试 → 测试校准', hit('首层测试（P1S）') === 'c_test');
ok('收缩率测试条 → 测试校准', hit('收缩率测试条') === 'c_test');
ok('拖链 → 备件维修', hit('A2L-DragChain-ToolHead') === 'c_part');
ok('AMS 顶置安装 → 备件维修', hit('AMS轻型顶置安装---A2L') === 'c_part');
ok('刮条 → 备件维修', hit('A2L+Düsenreinigungsabstreifer') === 'c_part');
ok('废料收纳 → 功能件', hit('Snapmaker_U1_废料收纳（增高）') === 'c_fn');
ok('record → 唱片/绘画', hit('record.gcode (3)') === 'c_disc');
ok('花样唱片 → 唱片/绘画', hit('花样唱片_D60_魔法阵夜想曲') === 'c_disc');
ok('高达 → 摆件装饰', hit('月高达-头') === 'c_deco');
ok('英文毒液 → 摆件装饰', hit('PAINTED_Venom') === 'c_deco');
ok('大小写不敏感', hit('PAINTED_VENOM') === 'c_deco');
ok('模糊名 + 3MF 内部对象名含关键词 → 命中',
  hit('v2', { meta: { objNames: ['左腿_Boolean', '刀刃_part'] } }) === 'c_deco');
ok('无信息名不硬猜', hit('v2') === null);
ok('空记录返回 null', C.matchCategory(null, rules) === null);

// ---------- 3. haystack 拼接 ----------
section('3. 可搜索文本');
const h = C.buildHaystack({
  title: '月高达-头',
  fileName: '月高达-头.3mf',
  path: 'C:\\Users\\10104\\Downloads\\月高达\\月高达-头.3mf',
  author: 'CoCo',
  note: '测试备注',
  meta: { objNames: ['HEAD_PART'] },
});
ok('含标题', h.includes('月高达-头'));
ok('含父目录名', h.includes('月高达'));
ok('不含盘符碎片', !h.includes('c:'));
ok('含作者', h.includes('coco'));
ok('含内部对象名', h.includes('head_part'));

// ---------- 4. 只填空值 ----------
section('4. 只处理未分类');
const rec1 = { id: 'a', title: '测试件' };
ok('空分类会被填上', C.applyToRecord(rec1, rules) === 'c_test' && rec1.categoryId === 'c_test');
ok('自动分类打了标记', rec1.autoClassified === true);
const rec2 = { id: 'b', title: '测试件', categoryId: 'c_deco' };
ok('已有分类绝不被改', C.applyToRecord(rec2, rules) === null && rec2.categoryId === 'c_deco');
ok('人工分类不带自动标记', rec2.autoClassified === undefined);

// ---------- 5. 关键词边界 ----------
section('5. 关键词清洗');
const shortRules = [{ id: 'r', categoryId: 'c_fn', keywords: ['刀', '支架'] }];
ok('单字关键词被忽略', C.matchCategory({ title: '黑伤刀' }, shortRules) === null);
ok('合法关键词照常命中', C.matchCategory({ title: '笔架支架' }, shortRules) === 'c_fn');
const dupRules = C.normalizeRules([{ id: 'r', categoryId: 'c_fn', keywords: ['支架', '支架', ' 支架 ', '收纳'] }]);
ok('重复关键词去重', dupRules[0].keywords.length === 2, JSON.stringify(dupRules[0].keywords));
ok('缺 categoryId 的规则被丢弃', C.normalizeRules([{ id: 'x', keywords: ['支架'] }]).length === 0);

// ---------- 6. 批量分类（mock store） ----------
section('6. 批量分类');
function makeStore(lib, settings) {
  const state = { lib: JSON.parse(JSON.stringify(lib)), set: JSON.parse(JSON.stringify(settings)), writes: 0 };
  return {
    getLibrary: () => state.lib,
    getSettings: () => state.set,
    async updateLibrary(fn) { state.writes++; fn(state.lib); return state.lib; },
    async updateSettings(patch) {
      for (const k of Object.keys(patch || {})) {
        const v = patch[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && state.set[k] && typeof state.set[k] === 'object') {
          state.set[k] = Object.assign({}, state.set[k], v);
        } else state.set[k] = v;
      }
      return state.set;
    },
    _writes: () => state.writes,
    _lib: () => state.lib,
  };
}

(async () => {
  const lib = {
    categories,
    models: {
      m1: { id: 'm1', title: '首层测试', categoryId: null },
      m2: { id: 'm2', title: '月高达-头', categoryId: null },
      m3: { id: 'm3', title: '已经分好的', categoryId: 'c_fn' },
      m4: { id: 'm4', title: '完全没信息', thumbnail: 'abc123.png' },
    },
  };
  const store = makeStore(lib, { classify: { enabled: true, onScan: true, onStartup: true, rules } });
  const stat = await C.classifyUncategorized(store);
  ok('扫描 4 条', stat.scanned === 4, JSON.stringify(stat));
  ok('只分 2 条（跳过已有分类）', stat.assigned === 2, JSON.stringify(stat));
  ok('跳过 1 条已有分类', stat.skipped === 1);
  ok('只写一次库', store._writes() === 1, 'writes=' + store._writes());
  ok('m1 归测试校准', store._lib().models.m1.categoryId === 'c_test');
  ok('m2 归摆件装饰', store._lib().models.m2.categoryId === 'c_deco');
  ok('m3 原分类不变', store._lib().models.m3.categoryId === 'c_fn');
  ok('m4 保持未分类', store._lib().models.m4.categoryId == null);
  ok('返回值带 byCategory', stat.byCategory && stat.byCategory.c_test === 1);
  ok('未匹配的模型进入 unmatched（供启动弹窗用）',
    Array.isArray(stat.unmatched) && stat.unmatched.length === 1 && stat.unmatched[0].id === 'm4',
    JSON.stringify(stat.unmatched));
  ok('unmatched 带缩略图字段（弹窗要显示图）', stat.unmatched[0].thumbnail === 'abc123.png');

  // 再跑一次：没有未分类，不应再写库
  const before = store._writes();
  const stat2 = await C.classifyUncategorized(store);
  ok('第二轮不写库（干跑没命中就跳过）', store._writes() === before, 'writes=' + store._writes());
  ok('第二轮没分到新的', stat2.assigned === 0);
  ok('匹配不上的那条仍留在未分类', stat2.pending === 1, 'pending=' + stat2.pending);

  // 关闭总开关
  const store2 = makeStore({ categories, models: { x: { id: 'x', title: '首层测试' } } },
    { classify: { enabled: false, rules } });
  const stat3 = await C.classifyUncategorized(store2);
  ok('总开关关闭时不跑', stat3.disabled === true && store2._writes() === 0);
  const stat4 = await C.classifyUncategorized(store2, { force: true });
  ok('force 可以无视开关', stat4.assigned === 1);

  // ---------- 7. 撤销 ----------
  section('7. 撤销自动分类');
  const store3 = makeStore({
    categories,
    models: {
      a: { id: 'a', title: 'x', categoryId: 'c_test', autoClassified: true },
      b: { id: 'b', title: 'y', categoryId: 'c_fn' },
    },
  }, { classify: { rules } });
  const undo = await C.undoAutoClassified(store3);
  ok('只清自动分类的那条', undo.cleared === 1);
  ok('人工分类保留', store3._lib().models.b.categoryId === 'c_fn');
  ok('清空后标记也去掉', !store3._lib().models.a.autoClassified);

  // ---------- 7b. 「全部跳过」记忆（docs/15） ----------
  section('7b. 全部跳过的记忆与过滤');
  {
    const many = { m4: { id: 'm4', title: '完全没信息' }, m5: { id: 'm5', title: '也没有信息' },
      m6: { id: 'm6', title: '同样没信息' } };
    const s = makeStore({ categories, models: many }, { classify: { enabled: true, rules } });
    ok('configOf 默认 skippedIds 为空数组', C.configOf(s.getSettings()).skippedIds.length === 0);
    const ids = C.collectUnmatchedIds(s);
    ok('collectUnmatchedIds 抓到全部未匹配（不只弹窗的 20 条）',
      ids.length === 3 && ids.indexOf('m4') >= 0 && ids.indexOf('m6') >= 0, JSON.stringify(ids));

    const r = await C.skipUnmatched(s, ['m4']);   // 传弹窗展示的那批，核心仍记全部
    ok('skipUnmatched 新增 3 条全部未匹配（含没展示的 m5/m6）',
      r.added === 3 && r.skippedIds.length === 3, JSON.stringify(r));
    ok('跳过写进 settings.classify.skippedIds',
      Array.isArray(s.getSettings().classify.skippedIds) && s.getSettings().classify.skippedIds.length === 3);

    const after = await C.classifyUncategorized(s);
    ok('跳过后 unmatched 为空（下次启动不再弹）',
      Array.isArray(after.unmatched) && after.unmatched.length === 0, JSON.stringify(after.unmatched));
    ok('跳过只影响提示，不影响 pending 统计', after.pending === 3, 'pending=' + after.pending);

    const r2 = await C.skipUnmatched(s, ['m4', 'm4', '']);
    ok('重复跳过不重复记（去重）', r2.added === 0 && r2.skippedIds.length === 3, JSON.stringify(r2));

    const merged = C.mergeSkippedIds(['a', 'b'], ['b', 'c']);
    ok('mergeSkippedIds 合并去重保序', merged.join(',') === 'a,b,c', merged.join(','));
    const manyIds = Array.from({ length: 600 }, (_, i) => 'x' + i);
    ok('跳过名单有上限（500）防 settings 膨胀', C.mergeSkippedIds([], manyIds).length === C.MAX_SKIPPED);
    ok('configOf 过滤非字符串 id', C.configOf({ classify: { skippedIds: ['ok', 3, null] } }).skippedIds.length === 1);

    // 清掉跳过名单后应重新提示
    await s.updateSettings({ classify: { skippedIds: [] } });
    const again = await C.classifyUncategorized(s);
    ok('清空跳过后重新进入 unmatched（设置页「恢复提醒」）',
      again.unmatched.length === 3, JSON.stringify(again.unmatched));
  }

  // ---------- 8. 分类被删 ----------
  section('8. 规则指向已删除的分类');
  const store4 = makeStore({
    categories: [categories[0]],
    models: { z: { id: 'z', title: '月高达-头' } },
  }, { classify: { rules } });
  const stat5 = await C.classifyUncategorized(store4);
  ok('分类被删时不写入无效 id', stat5.assigned === 0 && store4._lib().models.z.categoryId == null);

  console.log('\n' + '─'.repeat(30));
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exitCode = 1;
})();
