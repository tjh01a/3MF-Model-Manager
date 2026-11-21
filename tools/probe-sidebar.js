/**
 * 走查探针：侧栏展开 / 收起的布局、状态同步、文字隐藏与过渡。
 *   node launch.js --capture=docs/screenshots/13-侧栏收起.png --ui-script=tools/probe-sidebar.js
 *   node launch.js --capture=out.png --width=720 --ui-script=tools/probe-sidebar.js   # 窄屏抽屉
 *
 * 折叠态的 visibleTexts 必须为空：只应剩图标与色点，不能有数字徽标挤在 56px 里。
 * 2026-11-16 侧栏精简：五个智能视图入口与底部统计/数据目录按钮已删除，这里一并断言。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));

const TEXT_SEL = '#sidebar .nav-count, #sidebar .nav-sub-label, #sidebar .nav-label,' +
  '#sidebar .nav-add > span, #sidebar .tag-chip, #sidebar .nav-empty,' +
  '#sidebar .section-head';

function visibleTexts() {
  return qa(TEXT_SEL).filter((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' &&
      parseFloat(cs.fontSize) > 0 && r.width > 0 && r.height > 0;
  }).map((el) => ({
    cls: String(el.className || el.tagName).slice(0, 32),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18),
    fs: getComputedStyle(el).fontSize,
  }));
}

function snap(tag) {
  const body = q('#body'), sidebar = q('#sidebar'), scroll = q('.sidebar-scroll');
  const toggle = q('#sidebar-toggle');
  const r = (el) => el ? {
    w: Math.round(el.getBoundingClientRect().width),
    left: Math.round(el.getBoundingClientRect().left),
  } : null;
  const cs = body ? getComputedStyle(body) : null;
  return {
    tag,
    bodyClass: document.body.classList.contains('sidebar-collapsed'),
    cols: cs ? cs.gridTemplateColumns : null,
    transitionProp: cs ? cs.transitionProperty : null,
    sidebar: r(sidebar),
    scrollOverflowX: scroll ? scroll.scrollWidth - scroll.clientWidth : null,
    toggle: r(toggle),
    toggleTitle: toggle ? toggle.title : null,
    toggleAria: toggle ? toggle.getAttribute('aria-expanded') : null,
    visibleTexts: visibleTexts(),
    theme: document.documentElement.getAttribute('data-theme'),
    view: q('#content') ? q('#content').className : null,
  };
}

const out = { viewport: { w: window.innerWidth, h: window.innerHeight } };
out.narrow = out.viewport.w <= 759;
const toggle = q('#sidebar-toggle');
if (!toggle) return { ok: false, error: '找不到 #sidebar-toggle' };

// 先快照整份 ui 偏好。探针会点侧栏/主题/视图按钮，这些都会写 settings.json；
// 结尾必须显式 await 写回，不能指望 toggle 内部 fire-and-forget 的设置更新——
// capture 模式在脚本返回后很快 app.exit，排在写队列里的最后一次更新可能来不及落盘。
const shelf = window.shelf;
let originalUi = null;
try {
  const s = await shelf.settings();
  if (s && s.ui) originalUi = { ...s.ui };
} catch (_) { /* 读不到就退化为只还原侧栏 DOM 状态 */ }

// 记住用户原本的偏好，走查结束要还原，不能因为跑探针就改掉人家的设置
const wasCollapsed = document.body.classList.contains('sidebar-collapsed');
out.originalCollapsed = wasCollapsed;
// 统一从「展开」开始，避免上次运行留下的持久化状态影响判定
if (wasCollapsed) toggle.click();
await sleep(360);
out.expanded = snap('expanded');

toggle.click();
await sleep(360);
out.collapsed = snap('collapsed');

toggle.click();
await sleep(360);
out.expandedAgain = snap('expandedAgain');

// 深色主题 + 列表视图下再来一轮，确认状态不会和主题/视图互相干扰
const themeBtn = q('#btn-theme');
if (themeBtn) themeBtn.click();
const listBtn = q('#view-switch [data-view="list"]');
if (listBtn) listBtn.click();
await sleep(120);
toggle.click();
await sleep(360);
out.darkListCollapsed = snap('darkListCollapsed');
toggle.click();
await sleep(360);
out.darkListExpanded = snap('darkListExpanded');
q('#view-switch [data-view="grid"]') && q('#view-switch [data-view="grid"]').click();
if (themeBtn) themeBtn.click();

// 设置面板打开时也要能切（浮层在上，侧栏按钮在下，不能互相吞事件）
const settingsBtn = q('#btn-settings');
if (settingsBtn) {
  settingsBtn.click();
  await sleep(200);
  out.overlayOpen = !!(q('#settings-panel') && !q('#settings-panel').hidden);
  const sc = q('#settings-close');
  if (sc) sc.click();
}

const statesOk = !out.expanded.bodyClass && out.collapsed.bodyClass &&
  !out.expandedAgain.bodyClass && out.darkListCollapsed.bodyClass &&
  !out.darkListExpanded.bodyClass;
const textsOk = out.collapsed.visibleTexts.length === 0 &&
  out.darkListCollapsed.visibleTexts.length === 0;
const a11yOk = out.collapsed.toggleAria === 'false' && out.expanded.toggleAria === 'true' &&
  /展开/.test(out.collapsed.toggleTitle || '') && /收起/.test(out.expanded.toggleTitle || '');
const motionOk = /grid-template-columns/.test(out.expanded.transitionProp || '');

// 侧栏精简回归：被红圈要求删除的元素不能回来，保留的入口必须还在。
const EXPECTED_SMART = ['all', 'favorites', 'recentOpened', 'printed', 'duplicates', 'missing'];
out.smartKeys = qa('#sidebar [data-smart]').map((el) => el.dataset.smart).sort();
out.removedGone = !q('#storage-meter') && !q('#btn-data-dir') && !q('#sidebar-footer') &&
  ['unprinted', 'uncategorized', 'untagged', 'recent', 'rated']
    .every((k) => !out.smartKeys.includes(k));
out.sidebarSimplified = out.removedGone &&
  EXPECTED_SMART.slice().sort().every((k) => out.smartKeys.includes(k)) &&
  out.smartKeys.length === EXPECTED_SMART.length;

// docs/14：耗材与成本模块分组。printed 迁入该组并改名，另有耗材库动作入口。
out.costGroup = q('#sidebar .nav-sub[data-group="cost"]');
out.costLabels = qa('#sidebar .nav-sub[data-group="cost"] .nav-label').map((el) => el.textContent.trim());
out.costGroupOk = !!out.costGroup &&
  out.costLabels.some((t) => /打印回执/.test(t) && /成本账本/.test(t)) &&
  out.costLabels.some((t) => /耗材库/.test(t)) &&
  !q('#sidebar .nav-sub[data-group="smart"]') &&
  !!q('#sidebar [data-act="open-filaments"]');

let layoutOk;
if (out.narrow) {
  // 窄屏是抽屉：展开贴在左边、收起滑出视口，切换按钮必须仍留在屏内可点
  layoutOk = out.expanded.sidebar.left >= -1 && out.collapsed.sidebar.left <= -200 &&
    out.collapsed.toggle.left >= 0 && out.expanded.toggle.left >= 0;
} else {
  layoutOk = out.collapsed.sidebar.w <= 60 && out.expanded.sidebar.w >= 220 &&
    out.collapsed.scrollOverflowX <= 1 && out.collapsed.toggle.w > 0;
}
out.checks = { statesOk, textsOk, a11yOk, motionOk, layoutOk,
  sidebarSimplified: out.sidebarSimplified, costGroupOk: out.costGroupOk };
out.ok = statesOk && textsOk && a11yOk && motionOk && layoutOk && out.sidebarSimplified && out.costGroupOk;

// 还原用户原本的偏好：先让 DOM 回到原状态
if (wasCollapsed !== document.body.classList.contains('sidebar-collapsed')) {
  toggle.click();
  await sleep(400);
}
out.restoredCollapsed = document.body.classList.contains('sidebar-collapsed');

// 再把整份 ui 显式写回磁盘。这条请求排在写队列最后，能保证覆盖前面所有
// 点击产生的异步写入；await 到落盘完成才返回，窗口随即退出也不会丢。
if (shelf && typeof shelf.settingsUpdate === 'function') {
  try {
    await shelf.settingsUpdate({ ui: originalUi || { sidebarCollapsed: wasCollapsed } });
    const after = originalUi ? await shelf.settings() : null;
    const ui = after && after.ui;
    out.restoredUi = ui ? {
      theme: ui.theme, view: ui.view, sidebarCollapsed: ui.sidebarCollapsed,
    } : null;
    out.settingsRestored = !originalUi || (!!ui &&
      ui.sidebarCollapsed === originalUi.sidebarCollapsed &&
      ui.theme === originalUi.theme && ui.view === originalUi.view);
  } catch (_) {
    out.settingsRestored = false;
  }
}
out.ok = out.ok && out.restoredCollapsed === wasCollapsed && out.settingsRestored !== false;
return out;
