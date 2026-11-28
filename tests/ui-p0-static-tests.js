'use strict';
/**
 * P0 UI 契约静态测试（纯 Node，无需 Electron / 无需显示）。
 *
 * 目的：把本轮「布局 / 卡片 / 详情 / 批量条 / 状态」的结构契约锁住，
 * 防止后续改 CSS 或模板时悄悄退回旧行为。真正的点击交互由
 * tools/probe-p0-ui.js 在 Electron 里验证。
 *
 * 运行：node tests/ui-p0-static-tests.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const files = {
  index: read('src/renderer/index.html'),
  layout: read('src/renderer/styles/layout.css'),
  components: read('src/renderer/styles/components.css'),
  views: read('src/renderer/styles/views.css'),
  app: read('src/renderer/js/app.js'),
  grid: read('src/renderer/js/views/grid.js'),
  detail: read('src/renderer/js/views/detail.js'),
  monitor: read('src/renderer/js/components/monitorbar.js'),
};

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    failures.push({ name, error: err });
    console.log('  FAIL ' + name + ' :: ' + err.message);
  }
}
function includes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error('缺少 ' + (label || needle));
}
function notIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error('不应存在 ' + (label || needle));
}

console.log('\n[1] 顶部工具栏收敛');
test('存在“更多”入口和面板', () => {
  includes(files.index, 'id="btn-app-more"');
  includes(files.index, 'id="app-more-panel"');
  includes(files.index, 'aria-controls="app-more-panel"');
});
test('次要动作进入面板，id 没丢', () => {
  const panel = files.index.slice(files.index.indexOf('id="app-more-panel"'));
  for (const id of ['btn-filaments', 'btn-roulette', 'btn-language', 'btn-theme', 'btn-settings']) {
    includes(panel, 'id="' + id + '"', id);
  }
});
test('面板有定位与键盘焦点样式', () => {
  includes(files.layout, '.app-more-panel');
  includes(files.layout, '.app-more-item:focus-visible');
});
test('代码绑定了展开 / 关闭 / Esc', () => {
  includes(files.app, "bind('#btn-app-more', 'click'");
  includes(files.app, 'setMoreOpen(false)');
  includes(files.app, 'if (closeAppMore())');
});

console.log('\n[2] 主区密度与详情宽度');
test('工具栏压缩为 7px 上下内边距', () => {
  includes(files.layout, 'padding: 7px 20px;');
});
test('详情宽度使用 340–380 clamp', () => {
  includes(files.layout, 'width: clamp(340px, 26vw, 380px);');
});
test('统计条压缩成轻量胶囊', () => {
  includes(files.components, '.stat.is-active');
  includes(files.components, 'min-height: 28px;');
});
test('旧统计批量区不再显示', () => {
  includes(files.components, '.stats-actions { display: none !important; }');
});
test('监控条默认折叠且保留展开入口', () => {
  includes(files.monitor, 'let collapsed = true;');
  includes(files.monitor, "btn.dataset.monAct = 'collapse';");
  includes(files.components, '.monitor-bar.is-collapsed .mon-list { display: none; }');
  includes(files.monitor, 'bar.hidden = false;');
  includes(files.monitor, 'applyCollapsed(bar);');
});

console.log('\n[3] 卡片状态 / 动作 / 键盘');
test('状态徽标 hover 不再隐藏', () => {
  notIncludes(files.components, '.card:hover .card-badges, .card:focus-within .card-badges { opacity: 0;', '旧 hover 隐藏规则');
});
test('复选常驻 45% 可见度', () => {
  includes(files.components, 'opacity: .45;');
});
test('卡片动作只保留打开 / 来源 / 更多', () => {
  const cardHtml = files.grid.slice(files.grid.indexOf('function cardHtml(m)'), files.grid.indexOf('/** 卡片 DOM 指纹'));
  includes(cardHtml, 'data-act="open"');
  includes(cardHtml, 'data-act="source"');
  includes(cardHtml, 'data-act="more"');
  notIncludes(cardHtml, 'data-act="trash"', '卡片快捷删除');
  notIncludes(cardHtml, 'data-act="reveal"', '卡片快捷定位');
});
test('卡片有 2 行标题与拖拽态', () => {
  includes(files.components, '-webkit-line-clamp: 2;');
  includes(files.components, '.card.is-dragging');
});
test('Enter / Space 有卡片级键盘契约', () => {
  includes(files.grid, 'function onKeyDown(e)');
  includes(files.grid, "e.key === 'Enter'");
  includes(files.grid, "e.key === ' '");
  includes(files.grid, "content.addEventListener('keydown', onKeyDown);");
});

console.log('\n[4] 详情摘要前置');
test('摘要位于大图之前', () => {
  const summary = files.detail.indexOf('detail-summary');
  const preview = files.detail.indexOf("'<div class=\"detail-preview\">'");
  if (summary < 0 || preview < 0 || summary > preview) throw new Error('detail-summary 不在 detail-preview 之前');
});
test('摘要 sticky 且有主操作', () => {
  includes(files.views, '.detail-summary {');
  includes(files.views, 'position: sticky;');
  includes(files.detail, 'detail-summary-actions');
});
test('更多菜单接管定位 / 复制 / 收藏 / 预览', () => {
  const more = files.detail.slice(files.detail.indexOf('function openMoreMenu'));
  for (const label of ['大图预览', '在资源管理器中显示', '复制路径', '体检 / 优化…']) {
    includes(more, label, label);
  }
});

console.log('\n[5] 批量条唯一化');
test('编辑模式隐藏普通批量条', () => {
  includes(files.components, 'body.edit-mode #bulkbar { display: none !important; }');
});
test('批量条包含删除 / 标签入口', () => {
  includes(files.index, 'id="bulk-tag"');
  includes(files.index, 'id="bulk-delete"');
});

console.log('\n[6] 空 / 骨架 / 错误 / Toast');
test('空态有标题 / 描述 / 添加目录入口', () => {
  includes(files.index, 'id="empty-state"');
  includes(files.index, 'id="empty-title"');
  includes(files.index, 'id="empty-add"');
  includes(files.components, '.empty-state');
});
test('骨架与错误态样式存在', () => {
  includes(files.components, '#content.skeleton-grid');
  includes(files.components, '#content.content-error');
  includes(files.components, '.content-error-card');
});
test('骨架渲染函数可被探针调用', () => {
  includes(files.grid, 'export function showSkeleton(count)');
  includes(files.grid, '__printshelfShowSkeleton');
});
test('错误态有重试按钮绑定', () => {
  includes(files.app, 'function renderContentError()');
  includes(files.app, 'data-content-retry');
  includes(files.app, 'bindContentError()');
});
test('Toast 移到底部并避让批量条', () => {
  includes(files.components, 'bottom: 42px;');
  includes(files.components, 'body:has(#bulkbar:not([hidden])) .toast-container { bottom: 104px; }');
});

console.log('\n[7] 统计可点击筛选');
test('统计按钮带 data-stat-filter 和 aria-pressed', () => {
  includes(files.app, 'data-stat-filter="');
  includes(files.app, 'aria-pressed="');
});
test('点击统计会清掉会挡住结果的条件', () => {
  includes(files.app, 'function applyStatFilter(key)');
  includes(files.app, 'printStatuses: [],');
  includes(files.app, 'state.query.printStatuses');
});

const total = passed + failures.length;
console.log('\nUI P0 static: ' + passed + '/' + total + ' passed');
if (failures.length) {
  console.log('\n失败项：');
  for (const f of failures) console.log('- ' + f.name + ': ' + f.error.message);
  process.exitCode = 1;
} else {
  console.log('全部静态契约通过。');
}
