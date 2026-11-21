/**
 * 走查探针：统计条右侧两个「模型网站」导航的结构、位置与可点性。
 *   node launch.js --capture=out.png --ui-script=tools/probe-weblinks.js
 *   node launch.js --capture=out.png --width=720 --ui-script=tools/probe-weblinks.js  # 窄屏
 *
 * 刻意不真的点击按钮：点击会拉起系统浏览器，走查不该有这个副作用。
 * 打开链路只验到「window.shelf.openExternal 存在」为止（真实打开由主进程 shell 负责）。
 * 主题切换直接改 data-theme 属性、勾选态直接改 hidden 属性，都不写 settings.json。
 */
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPECTED = [
  'https://makerworld.com.cn/zh',
  'https://space.snapmaker.cn/zh?tab=home-featured',
];

const root = q('#stats-links');
if (!root) return { ok: false, error: '找不到 #stats-links' };

const btns = qa('#stats-links button[data-url]');
const cells = q('#stats-cells');
const bar = q('#stats-bar');
const actions = q('#stats-actions');
if (!cells || !bar) return { ok: false, error: '统计条 DOM 不完整' };

const visible = (el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' &&
    r.width > 0 && r.height > 0 && r.right <= window.innerWidth + 1 && r.left >= -1;
};
const hit = (el) => {
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(
    Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return !!top && (top === el || el.contains(top));
};

const out = {
  viewport: { w: window.innerWidth, h: window.innerHeight },
  urls: btns.map((b) => b.getAttribute('data-url')),
  labels: btns.map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()),
  statsBarHidden: bar.hidden,
  openExternal: typeof (window.shelf && window.shelf.openExternal) === 'function',
};

// 位置：导航必须紧贴在统计格子右侧（即截图里红框那块空白），且完整留在视口内
const cellsRect = cells.getBoundingClientRect();
const linksRect = root.getBoundingClientRect();
out.position = {
  cellsRight: Math.round(cellsRect.right),
  linksLeft: Math.round(linksRect.left),
  linksRight: Math.round(linksRect.right),
  rightOfCells: linksRect.left >= cellsRect.right - 2,
  withinViewport: btns.every((b) => b.getBoundingClientRect().right <= window.innerWidth + 1),
};
out.visible = btns.map(visible);
out.clickable = btns.map(hit);

// 勾选态：#stats-actions 浮出时，导航不能被挤走或被遮住
if (actions) {
  const wasHidden = actions.hidden;
  actions.hidden = false;
  await sleep(80);
  const aRect = actions.getBoundingClientRect();
  const lRect = root.getBoundingClientRect();
  out.withActions = {
    actionsVisible: getComputedStyle(actions).display !== 'none',
    linksVisible: btns.every(visible),
    linksClickable: btns.map(hit),
    noOverlap: lRect.left >= aRect.right - 2,
  };
  actions.hidden = wasHidden;
  await sleep(40);
}

// 深色主题：按钮颜色随 CSS 变量切换，但仍要可见可点（不点 #btn-theme，避免写设置）
const html = document.documentElement;
const wasTheme = html.getAttribute('data-theme');
html.setAttribute('data-theme', 'dark');
await sleep(60);
out.dark = {
  theme: html.getAttribute('data-theme'),
  visible: btns.map(visible),
  clickable: btns.map(hit),
  color: getComputedStyle(btns[0]).color,
};
html.setAttribute('data-theme', wasTheme || 'light');
await sleep(40);
out.restoredTheme = html.getAttribute('data-theme');

out.ok =
  out.urls.length === 2 && EXPECTED.every((u, i) => out.urls[i] === u) &&
  out.labels.every((t) => t.length > 0) &&
  !out.statsBarHidden && out.openExternal &&
  out.position.rightOfCells && out.position.withinViewport &&
  out.visible.every(Boolean) && out.clickable.every(Boolean) &&
  !!out.withActions && out.withActions.actionsVisible &&
  out.withActions.linksVisible && out.withActions.linksClickable.every(Boolean) &&
  out.withActions.noOverlap &&
  out.dark.visible.every(Boolean) && out.dark.clickable.every(Boolean) &&
  out.restoredTheme === (wasTheme || 'light');
return out;
