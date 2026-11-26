'use strict';
import { t as tr } from '../i18n.js';

/** 侧栏：智能视图 / 分类 / 标签 / 我的视图。底部统计块已按用户要求移除。 */
import { state, setState } from '../state.js';
import { api, emitRefresh, emitToast } from '../api.js';
import { escapeHtml, icon, qs } from '../utils.js';
import { promptDialog, selectDialog, confirmDialog, nameColorDialog } from '../components/modal.js';
import { openMenu } from '../components/menu.js';
import { setCategory, addTag as addTagTo, createCategoryWith, createTagWith, pickModelsForCategory } from '../components/assign.js';
import { flyToTarget } from '../components/dropfx.js';
import { openFilaments } from './filaments.js';

// constants.js 为 CommonJS，渲染层不可 import，按冻结值内联
const SMART_VIEWS = [
  { key: 'all',           label: tr('全部模型'),   icon: 'i-grid',      group: 'library' },
  { key: 'favorites',     label: tr('收藏'),       icon: 'i-star',      group: 'library' },
  { key: 'recentOpened',  label: tr('最近打开'),   icon: 'i-clock',     group: 'library' },
  // 精简侧栏：未打印 / 未分类 / 未打标签 / 最近 7 天 / 已评分 五个入口已移除（2026-11-16）。
  // 底层 query 语义仍在（constants.SMART_VIEWS 与 library.query 未动），只是不再占侧栏位置。
  // docs/14：「已完成打印」本质是打印回执 / 成本账本，从 smart 组迁入 cost 组并改名。
  { key: 'printed',       label: tr('打印回执 · 成本账本'), icon: 'i-check', group: 'cost' },
  { key: 'duplicates',    label: tr('重复文件'),   icon: 'i-copy',      group: 'quality' },
  { key: 'variants',      label: tr('同款变体'),   icon: 'i-layers',    group: 'quality' },
  { key: 'broken',        label: tr('损坏文件'),   icon: 'i-wrench',    group: 'quality' },
];
/** 非 smart 的模块入口：点击直接触发动作，不改 state.query */
const ACTION_VIEWS = [
  { key: 'filaments', label: tr('耗材管理'), icon: 'i-box', group: 'cost', act: 'open-filaments',
    title: tr('管理耗材库存（真正拥有的）与耗材库（选购参考）') },
];
const GROUPS = [
  { key: 'library', label: tr('模型库') },
  { key: 'quality', label: tr('质量检查') },
  { key: 'cost',    label: tr('耗材与成本') },
];
const CATEGORY_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
const DEFAULT_TAG_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'];

let mounted = false;

function renderLibrary() {
  const nav = qs('#nav-library');
  if (!nav) return;
  const counts = state.smartCounts || {};
  let html = '';
  for (const g of GROUPS) {
    const smarts = SMART_VIEWS.filter((x) => x.group === g.key);
    const actions = ACTION_VIEWS.filter((x) => x.group === g.key);
    if (!smarts.length && !actions.length) continue;   // 空组不渲染（smart 组移除后）
    html += '<div class="nav-sub" data-group="' + g.key + '"><div class="nav-sub-label">' + g.label + '</div>';
    for (const v of smarts) {
      const active = state.query.smart === v.key ? ' active' : '';
      const n = v.key === 'all' ? state.total : counts[v.key];
      const badge = (n != null && Number(n) > 0) ? '<span class="nav-count">' + Number(n) + '</span>' : '';
      html += '<button class="nav-item' + active + '" data-smart="' + escapeHtml(v.key) + '" title="' + escapeHtml(v.label) + '">' +
        icon(v.icon) + '<span class="nav-label">' + escapeHtml(v.label) + '</span>' + badge + '</button>';
    }
    for (const v of actions) {
      html += '<button class="nav-item" data-act="' + escapeHtml(v.act) + '" title="' + escapeHtml(v.title || v.label) + '">' +
        icon(v.icon) + '<span class="nav-label">' + escapeHtml(v.label) + '</span></button>';
    }
    html += '</div>';
  }
  nav.innerHTML = html;
}
function renderCategories() {
  const nav = qs('#nav-categories');
  if (!nav) return;
  const byCat = (state.stats && state.stats.byCategory) || (state.facets && state.facets.byCategory) || {};
  // 一次性动效标记：投放成功后让对应分类弹一下（重渲染会丢掉 class，所以借 state 传递）
  const flash = state.flashCategory;
  if (flash) state.flashCategory = null;
  let html = '';
  for (const c of (state.categories || [])) {
    const on = state.query.categoryId === c.id ? ' active' : '';
    const pop = flash === c.id ? ' just-dropped' : '';
    html += '<button class="nav-item cat-item' + on + pop + '" data-cat="' + escapeHtml(c.id) +
      '" data-context="category" title="' + escapeHtml(c.name) + tr('（可把模型拖到这里）">') +
      '<span class="dot" style="--dot:' + escapeHtml(c.color || '#4f46e5') + '"></span>' +
      '<span class="nav-label">' + escapeHtml(c.name) + '</span>' +
      '<span class="nav-count">' + (byCat[c.id] || 0) + '</span></button>';
  }
  // Steam 式末行：既能点着新建，也是最大的拖放目标
  html += '<button type="button" class="nav-add" data-act="category-new" data-drop="category" ' +
    tr('title="新建分类；也可以把模型直接拖到这一行">') + icon('i-plus') + tr('<span>新建分类</span></button>');
  nav.innerHTML = html;
}
function renderTags() {
  const nav = qs('#nav-tags');
  if (!nav) return;
  const sel = state.query.tagIds || [];
  let html = '';
  for (const t of (state.tags || [])) {
    const on = sel.includes(t.id) ? ' active' : '';
    html += '<button class="chip tag-chip' + on + '" data-tag="' + escapeHtml(t.id) +
      '" data-context="tag" style="--tag:' + escapeHtml(t.color || '#4f46e5') + '">' +
      escapeHtml(t.name) + '</button>';
  }
  nav.innerHTML = html || tr('<div class="nav-empty">暂无标签</div>');
}
function renderViews() {
  const nav = qs('#nav-views');
  if (!nav) return;
  let html = '';
  for (const v of (state.views || [])) {
    html += '<button class="nav-item" data-view="' + escapeHtml(v.id) +
      tr('" data-context="view" title="应用视图：') + escapeHtml(v.name) + '">' +
      icon('i-save') + '<span class="nav-label">' + escapeHtml(v.name) + '</span></button>';
  }
  nav.innerHTML = html || tr('<div class="nav-empty">未保存视图</div>');
}
let lastNavSig = '';
/** 侧栏每次刷新都会重建 4 段导航 HTML；数据没变就跳过，纯 UI 刷新尤其受益 */
export function renderSidebar() {
  const q = state.query || {};
  const s = state.stats || {};
  const sig = JSON.stringify([
    state.total, state.smartCounts,
    (state.categories || []).map((c) => [c.id, c.name, c.color]),
    (state.tags || []).map((t) => [t.id, t.name, t.color]),
    (state.views || []).map((v) => [v.id, v.name]),
    s.byCategory || {},
    q.smart, q.categoryId, q.tagIds,
  ]);
  const lib = qs('#nav-library');
  // flashCategory 是一次性动效标记：它强制重渲染，但不写进签名，避免下次平白多刷一轮
  if (sig === lastNavSig && !state.flashCategory && lib && lib.children.length) return;
  lastNavSig = sig;
  renderLibrary();
  renderCategories();
  renderTags();
  renderViews();
}

function onClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  // docs/14：耗材与成本组里的模块入口（非 smart），直接触发动作
  const act = t.closest('[data-act="open-filaments"]');
  if (act) { openFilaments(); return; }
  const smart = t.closest('[data-smart]');
  if (smart) {
    const key = smart.dataset.smart;
    const next = { ...state.query, smart: key };
    // 这四个都是全库体检视图，侧栏徽标显示的也是全库数量。
    // 如果带着上一次的分类/标签/关键词筛选进来，就会出现「左边写 79、列表 0 个」——
    // 看起来像计数 bug，其实是筛选把结果挡掉了。进这些视图时把会隐藏结果的条件清掉。
    if (key === 'duplicates' || key === 'missing' || key === 'broken' || key === 'variants') {
      next.categoryId = null;
      next.tagIds = [];
      next.keyword = '';
      next.favoritesOnly = false;
      next.ratingMin = 0;
      next.printStatuses = [];
    }
    setState({ query: next }, 'query');
    renderSidebar();
    emitRefresh('smart');
    return;
  }
  const cat = t.closest('[data-cat]');
  if (cat) {
    const id = cat.dataset.cat;
    setState({ query: { ...state.query, categoryId: state.query.categoryId === id ? null : id } }, 'query');
    renderSidebar();
    emitRefresh('category');
    return;
  }
  const tag = t.closest('[data-tag]');
  if (tag) {
    const id = tag.dataset.tag;
    const ids = state.query.tagIds || [];
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat(id);
    setState({ query: { ...state.query, tagIds: next } }, 'query');
    renderSidebar();
    emitRefresh('tag');
    return;
  }
  const view = t.closest('[data-view]');
  if (view) {
    const v = (state.views || []).find((x) => x.id === view.dataset.view);
    if (v) {
      setState({ query: Object.assign({}, state.query, v.query || {}) }, 'query');
      emitRefresh('view');
    }
    return;
  }
  if (t.closest('#btn-category-add') || t.closest('[data-act="category-new"]')) { addCategory(); return; }
  if (t.closest('#btn-tag-add')) { addTag(); return; }
  if (t.closest('#btn-view-save')) { saveView(); return; }
}

function onContextMenu(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  const cat = t.closest('[data-cat][data-context="category"]');
  if (cat) {
    e.preventDefault();
    const id = cat.dataset.cat;
    const c = (state.categories || []).find((x) => x.id === id) || { name: '' };
    openMenu(e.clientX, e.clientY, [
      { label: tr('手动添加模型…'), icon: 'i-plus', action: () => pickModelsForCategory(id) },
      { label: tr('重命名'), icon: 'i-edit', action: () => renameCategory(id, c.name) },
      { label: tr('修改颜色'), icon: 'i-sliders', action: () => recolorCategory(id) },
      { divider: true },
      { label: tr('删除分类'), icon: 'i-trash', danger: true, action: () => deleteCategory(id, c.name) },
    ]);
    return;
  }
  const tag = t.closest('[data-tag][data-context="tag"]');
  if (tag) {
    e.preventDefault();
    const id = tag.dataset.tag;
    const g = (state.tags || []).find((x) => x.id === id) || { name: '' };
    openMenu(e.clientX, e.clientY, [
      { label: tr('重命名'), icon: 'i-edit', action: () => renameTag(id, g.name) },
      { label: tr('修改颜色'), icon: 'i-sliders', action: () => recolorTag(id) },
      { divider: true },
      { label: tr('删除标签'), icon: 'i-trash', danger: true, action: () => deleteTag(id, g.name) },
    ]);
    return;
  }
  const view = t.closest('[data-view][data-context="view"]');
  if (view) {
    e.preventDefault();
    const id = view.dataset.view;
    const v = (state.views || []).find((x) => x.id === id) || { name: '' };
    openMenu(e.clientX, e.clientY, [
      { label: tr('删除视图'), icon: 'i-trash', danger: true, action: () => deleteView(id, v.name) },
    ]);
  }
}

export function mountSidebar() {
  if (mounted) return;
  const root = qs('#sidebar');
  if (!root) return;
  mounted = true;
  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', onContextMenu);
  // 拖拽归类：Steam 库把游戏拖进收藏库的同一套交互
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
}

// ---------- 拖拽归类：投放目标 = 分类项 / 标签 / 分类·标签标题行的「+」 ----------
// 侧栏「未分类」入口移除后，拖到侧栏取消归类不再可用；
// 需要移回未分类时走右键「添加到分类…」里取消勾选（assign.js 仍支持）。
const DRAG_TYPE = 'application/x-shelf-ids';
let dropZone = null;

function isModelDrag(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  return !!t && Array.prototype.indexOf.call(t, DRAG_TYPE) >= 0;
}
function resolveZone(node) {
  if (!node || !node.closest) return null;
  return node.closest('[data-cat], [data-tag], [data-drop]');
}
function clearDropZone() {
  if (dropZone) {
    dropZone.classList.remove('drop-target');
    dropZone = null;
  }
}
function readDragIds(e) {
  try {
    const raw = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain') || '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (_) { return []; }
}
function onDragOver(e) {
  if (!isModelDrag(e)) return;
  const zone = resolveZone(e.target);
  if (!zone) { clearDropZone(); return; }
  e.preventDefault();
  e.stopPropagation();
  // 必须是 effectAllowed 允许的值。拖动开始时设的是 'copyMove'（只含 copy/move），
  // 这里以前写 'link' —— 不在允许列表里，Chromium 会把本次拖放操作判为 none，
  // 于是高亮正常、drop 却永远不触发（表现为「拖过去松手没反应」）。
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (zone !== dropZone) {
    clearDropZone();
    dropZone = zone;
    zone.classList.add('drop-target');
  }
}
function onDragLeave(e) {
  if (!isModelDrag(e)) return;
  const zone = resolveZone(e.target);
  if (!zone || zone !== dropZone) return;
  if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
  clearDropZone();
}
async function onDrop(e) {
  if (!isModelDrag(e)) return;
  const zone = resolveZone(e.target);
  if (!zone) return;
  e.preventDefault();
  e.stopPropagation();
  clearDropZone();
  const ids = readDragIds(e);
  if (!ids.length) return;
  // 动效起点：拖拽的那张卡片（视图切换后可能已不在，飞入动画就自动跳过）
  let srcCard = null;
  try { srcCard = document.querySelector('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(ids[0]) : ids[0]) + '"]'); }
  catch (_) { srcCard = null; }
  try {
    const newKind = zone.dataset.drop;
    if (newKind === 'category') { await createCategoryWith(ids); return; }
    if (newKind === 'tag') { await createTagWith(ids); return; }
    if (zone.dataset.tag) { flyToTarget(srcCard, zone); await addTagTo(ids, zone.dataset.tag); return; }
    const catId = zone.dataset.cat;
    if (catId) {
      flyToTarget(srcCard, zone);        // 缩略图先飞进分类
      state.flashCategory = catId;       // 侧栏重建时让该分类弹一下（一次性标记）
      const r = await setCategory(ids, catId);
      if (!r.ok) state.flashCategory = null;
      return;
    }
  } catch (err) {
    emitToast('error', (err && err.message) || tr('归类失败'));
  }
}

// 写操作后重新拉取分类/标签/视图列表并刷新计数
async function reloadNav(reason = 'nav') {
  try {
    const [cats, tags, views] = await Promise.all([
      api.categories().catch(() => state.categories),
      api.tags().catch(() => state.tags),
      api.views().catch(() => state.views),
    ]);
    setState({ categories: cats || [], tags: tags || [], views: views || [] }, 'nav');
  } catch (_) { /* api 层已统一提示 */ }
  renderSidebar();
  emitRefresh(reason);
}
async function pickColor(title, message) {
  try {
    const r = await selectDialog({
      title, message,
      options: CATEGORY_COLORS.map((c) => ({ value: c, label: c, color: c })),
      mode: 'single', confirmText: tr('确定'),
    });
    if (r == null) return null;
    if (typeof r === 'string') return r;
    return r.value || r.color || null;
  } catch (_) { return null; }
}

async function addCategory() {
  let r = null;
  try {
    r = await nameColorDialog({
      title: tr('新建分类'),
      label: tr('分类名称'),
      placeholder: tr('例如：功能件'),
      colors: CATEGORY_COLORS,
      confirmText: tr('创建'),
    });
  } catch (_) { return; }
  if (!r || !r.value) return;
  const name = r.value;
  api.categoryCreate({ name, color: r.color })
    .then(() => { emitToast('success', tr('已创建分类「') + name + '」'); reloadNav('categories'); })
    .catch(() => {});
}
async function addTag() {
  let r = null;
  try {
    r = await nameColorDialog({
      title: tr('新建标签'),
      label: tr('标签名称'),
      placeholder: tr('例如：高精度'),
      colors: DEFAULT_TAG_COLORS,
      confirmText: tr('创建'),
    });
  } catch (_) { return; }
  if (!r || !r.value) return;
  const name = r.value;
  api.tagCreate({ name, color: r.color })
    .then(() => { emitToast('success', tr('已创建标签「') + name + '」'); reloadNav('tags'); })
    .catch(() => {});
}
async function saveView() {
  let name;
  try { name = await promptDialog({ title: tr('保存视图'), label: tr('视图名称'), placeholder: tr('例如：待打印功能件'), confirmText: tr('保存') }); }
  catch (_) { return; }
  if (!name || !name.trim()) return;
  api.viewSave({ name: name.trim(), query: { ...state.query } })
    .then(() => { emitToast('success', tr('已保存视图')); reloadNav('views'); })
    .catch(() => {});
}

async function renameCategory(id, oldName) {
  let name;
  try { name = await promptDialog({ title: tr('重命名分类'), label: tr('分类名称'), value: oldName, confirmText: tr('保存') }); }
  catch (_) { return; }
  if (name == null || !name.trim()) return;
  api.categoryUpdate(id, { name: name.trim() }).then(() => reloadNav('categories')).catch(() => {});
}
async function recolorCategory(id) {
  const c = await pickColor(tr('修改颜色'), tr('选择新的标识色'));
  if (!c) return;
  api.categoryUpdate(id, { color: c }).then(() => reloadNav('categories')).catch(() => {});
}
async function deleteCategory(id, name) {
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('删除分类'), message: tr('确定删除分类「') + name + tr('」吗？'),
      detail: tr('该分类下的模型将改为「未分类」，模型文件不会删除。'),
      items: [name], danger: true, confirmText: tr('删除'),
    });
  } catch (_) { return; }
  if (!ok) return;
  api.categoryDelete(id).then(() => { emitToast('success', tr('已删除分类')); reloadNav('categories'); }).catch(() => {});
}
async function renameTag(id, oldName) {
  let name;
  try { name = await promptDialog({ title: tr('重命名标签'), label: tr('标签名称'), value: oldName, confirmText: tr('保存') }); }
  catch (_) { return; }
  if (name == null || !name.trim()) return;
  api.tagUpdate(id, { name: name.trim() }).then(() => reloadNav('tags')).catch(() => {});
}
async function recolorTag(id) {
  const c = await pickColor(tr('修改颜色'), tr('选择新的标识色'));
  if (!c) return;
  api.tagUpdate(id, { color: c }).then(() => reloadNav('tags')).catch(() => {});
}
async function deleteTag(id, name) {
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('删除标签'), message: tr('确定删除标签「') + name + tr('」吗？'),
      detail: tr('该标签会从所有模型上移除，模型文件不会删除。'),
      items: [name], danger: true, confirmText: tr('删除'),
    });
  } catch (_) { return; }
  if (!ok) return;
  api.tagDelete(id).then(() => { emitToast('success', tr('已删除标签')); reloadNav('tags'); }).catch(() => {});
}
async function deleteView(id, name) {
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('删除视图'), message: tr('确定删除视图「') + name + tr('」吗？'),
      items: [name], danger: true, confirmText: tr('删除'),
    });
  } catch (_) { return; }
  if (!ok) return;
  api.viewDelete(id).then(() => { emitToast('success', tr('已删除视图')); reloadNav('views'); }).catch(() => {});
}
