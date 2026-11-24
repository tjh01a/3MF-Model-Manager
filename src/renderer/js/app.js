'use strict';
/** 应用入口：bootstrap、mount 全部模块、刷新调度、快捷键、拖拽、Undo、窗口事件。 */
import { state, setState, subscribe } from './state.js';
import { api, emitRefresh, emitToast, whenBackendReady } from './api.js';
import { escapeHtml, clamp, qs, fmtBytes } from './utils.js';
import { mountGrid, renderGrid } from './views/grid.js';
import { mountSidebar, renderSidebar } from './views/sidebar.js';
import { applySidebar, toggleSidebar } from './components/sidebar-state.js';
import { applyViewClass, invalidateGridCache } from './views/grid.js';
import { finishBoot, bootFailed } from './components/boot.js';
import { applyIconSet } from './components/icon-set.js';
import { applyMotionPrefs, watchMotionPrefs, withViewTransition, enterView, motionEnabled } from './components/motion.js';
import { mountToolbar, syncToolbar } from './views/toolbar.js';
import { mountDetail, openDetail, closeDetail, refreshDetail } from './views/detail.js';
import { mountSettings, openSettings, closeSettings, isSettingsOpen } from './views/settings.js';
import { mountDevices, openDevices, closeDevices, isDevicesOpen, refreshDeviceBadge, isPromptFormOpen, cancelPromptForm } from './views/devices.js';
import { mountFilaments, openFilaments, closeFilaments, isFilamentsOpen } from './views/filaments.js';
import { mountMonitorBar } from './components/monitorbar.js';
import { mountOnboarding, maybeStartOnboarding, isOnboardingOpen } from './components/onboarding.js';
import { mountLightbox, openLightbox, closeLightbox, isLightboxOpen } from './views/lightbox.js';
import { mountSpecialView, renderSpecialView } from './views/duplicates.js';
import { mountReceipts, renderReceipts } from './views/receipts.js';
import { mountToast } from './components/toast.js';
import { isModalOpen, confirmDialog, promptDialog } from './components/modal.js';
import { openClassifyPrompt } from './components/classify-prompt.js';
import { mountMenu, closeMenu, isMenuOpen } from './components/menu.js';
import { mountBulkbar, syncBulkbar } from './components/bulkbar.js';
import { mountSiteLinks } from './components/site-links.js';
import { openModelsWithChoice } from './components/openwith.js';
import { pickModelsForCategory } from './components/assign.js';
import { mountMeshOpt } from './components/meshopt.js';
import { mountEditMode, exitEditMode, isEditMode } from './components/editmode.js';
import { mountQuickOpen, close as closeQuickOpen } from './components/quickopen.js';
import { isBambuAccountOpen, closeBambuAccount } from './components/bambuaccount.js';

let started = false;
let hasShelf = false;
let refreshQueued = false;
let refreshRunning = false;
let refreshAgain = false;
let pendingReason = 'init';
let pendingHeavy = true;
let bootDone = false;

/**
 * 纯 UI 变更（切网格/列表、主题、默认折叠、卡片尺寸…）不需要重新查库。
 * 以前这些操作也走完整 doRefresh：3 次 IPC + 重建几百张卡片，切个视图就卡一下。
 * 注意 'view' 是 sidebar.js「应用保存的视图」，会改 query，必须走完整刷新；
 * 工具栏的视图切换单独用 'viewmode'。
 */
const UI_ONLY_REASONS = new Set(['viewmode', 'settings', 'theme', 'sidebar', 'cardSize', 'selection']);

/**
 * 只有明确的「换视图」才做转场。selection / theme / sidebar / settings 这些轻量刷新
 * 必须同步完成：startViewTransition 的回调要等快照后才执行，会把勾选、主题切换
 * 往后拖一帧，手感反而变差，也会让依赖同步 DOM 的探针读到旧状态。
 * 首屏 init 也不做动效，那时启动动画正在淡出。
 */
const VIEW_TRANSITION_REASONS = new Set(['viewmode', 'view', 'smartview']);

export function init() {
  if (started) return;
  started = true;
  hasShelf = !!(typeof window !== 'undefined' && window.shelf);
  try {
    mountToast();          // 尽早注册，避免早期提示丢失
    mountGrid();
    mountSidebar();
    mountToolbar();
    mountDetail();
    mountSettings();
    mountDevices();
    mountFilaments();
    mountMonitorBar();     // 主界面常驻打印监控条（设置里可关）
    mountLightbox();
    mountSpecialView();
    mountReceipts();
    mountMenu();
    mountBulkbar();
    mountMeshOpt();        // 尽早注册优化进度/完成事件，避免运行期间漏事件
    mountEditMode();       // 长按进入的编辑模式（操作条由它懒创建）
    mountQuickOpen();      // 「用切片软件打开」的悬停二层菜单
    mountOnboarding();     // 首次启动向导（空库 + 未完成时才弹，见 maybeStartOnboarding）

    bindRefresh();
    bindWebLinks();
    mountSiteLinks().catch(() => {});
    bindGlobalKeys();
    bindDragDrop();
    bindTitlebar();
    bindScanProgress();
    bindWindowClicks();
    subscribe(onState);
  } catch (err) {
    emitToast('error', (err && err.message) || '初始化失败');
    bootFailed('mount');
    return;
  }
  bootstrap()
    .then(() => {
      emitRefresh('init');
      // 设置已经读进来了，这里再判断「是否要提示未匹配」，不会误判默认值
      bindClassifyPrompt();
      // 首次启动：空库且没走完向导才拦；老用户库里有数据会被静默标记，不打扰
      maybeStartOnboarding().catch(() => {});
    })
    .catch((err) => {
      emitToast('error', (err && err.message) || '初始化失败');
      bootFailed('bootstrap');
    });
}

if (typeof document !== 'undefined') {
  // 窗口先于主进程服务出现：等后端就绪再挂载各模块，避免 mountDevices 等
  // 在 IPC handler 注册前发请求、弹一串「操作失败」。等待期间由启动动画接管画面。
  const start = () => {
    Promise.resolve(whenBackendReady()).then((r) => {
      // 后端明确失败 / 超时：不要再走 bootstrap（否则会拿不到数据还弹一串错误），
      // 直接用中文错误收掉启动动画。
      if (r && r.ok === false) {
        const msg = r.message || (r.reason === 'timeout'
          ? '连接本地服务超时，请确认 PrintShelf 桌面应用已正常启动'
          : '后端启动失败，请重启 PrintShelf');
        emitToast('error', msg);
        bootFailed(r.reason || 'backend', msg);
        return;
      }
      init();
    }, (err) => {
      emitToast('error', '后端启动失败：' + ((err && err.message) || '未知原因'));
      bootFailed('backend');
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

// ---------- bootstrap ----------
async function bootstrap() {
  // 窗口现在先于主进程服务创建，这样启动动画从「双击图标」那一刻就在。
  // 后端就绪前不发 IPC，避免 bootstrap 撞上「还没注册 handler」而误报错误。
  const ready = await whenBackendReady();
  if (ready && ready.ok === false) {
    // 兜底：若 init 被其它入口直接调用，也不要在后端失败时继续 bootstrap
    const err = new Error(ready.message || '后端未就绪');
    err.ready = ready;
    throw err;
  }
  let data = {};
  try {
    data = await api.bootstrap();
  } catch (_) {
    data = {};
    emitToast('warn', hasShelf
      ? '读取本地数据失败，请稍后重试'
      : '请在 PrintShelf 桌面应用中打开以加载数据');
  }
  const s = data || {};
  const ui = (s.settings && s.settings.ui) || {};
  const info = s.info || {};
  const cardSize = clamp(ui.cardSize || 220, 140, 340);
  setState({
    ready: true,
    info: s.info || {},
    settings: s.settings || {},
    categories: s.categories || [],
    tags: s.tags || [],
    views: s.views || [],
    stats: s.stats || {},
    smartCounts: s.smartCounts || {},
    folders: s.folders || (s.settings && s.settings.folders) || [],
    slicers: s.slicers || [],
    backups: s.backups || [],
    view: ui.view === 'list' ? 'list' : 'grid',
    cardSize,
    theme: ui.theme || 'light',
    sidebarCollapsed: !!ui.sidebarCollapsed,
    query: {
      ...state.query,
      sortBy: ui.sortBy || state.query.sortBy,
      sortDir: ui.sortDir || state.query.sortDir,
    },
  }, 'bootstrap');
  // 两个总回退开关：lucide/full 是默认，legacy/off 等价于改造前界面。
  // applyIconSet('lucide') 是零 DOM 操作（index.html 内联的就是 Lucide 路径）。
  applyIconSet(ui.iconSet === 'legacy' ? 'legacy' : 'lucide');
  applyMotionPrefs();
  watchMotionPrefs();
  applyTheme(ui.theme || 'light');
  applyCardSize(cardSize);
  applySidebar(!!ui.sidebarCollapsed);
  updateDataDir(s.dataDir || info.dataDir || '');
}
function applyTheme(theme) {
  let t = theme || 'light';
  if (t === 'system') {
    t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
  state.theme = t;
  // 设置页读的是 state.settings.ui.theme，工具栏切换时也要同步，
  // 否则「刚切成深色，打开设置还是显示浅色」
  const settings = state.settings || {};
  state.settings = { ...settings, ui: { ...(settings.ui || {}), theme: theme || 'light' } };
  const btn = qs('#btn-theme');
  if (btn) {
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  }
}
function applyCardSize(size) {
  document.documentElement.style.setProperty('--card-w', size + 'px');
}
function updateDataDir(dir) {
  const el = qs('#status-datadir');
  if (!el) return;
  el.textContent = dir ? '数据目录：' + dir : '数据目录';
  el.title = dir || '点击打开数据目录';
}

// ---------- 刷新调度（连续事件合并到一帧 + 单飞） ----------
function scheduleRefresh(reason) {
  const r = reason || 'refresh';
  pendingReason = r;
  // 合并窗口里只要有一个「需要查库」的原因，这一轮就按完整刷新跑，别把数据刷新丢了
  if (!UI_ONLY_REASONS.has(r)) pendingHeavy = true;
  if (refreshRunning) { refreshAgain = true; return; }
  if (refreshQueued) return;
  refreshQueued = true;
  // 用定时器而非 requestAnimationFrame：窗口在后台或被遮挡时 Chromium 会暂停 rAF，
  // 那样首屏刷新与后续 lib:changed 刷新都不会执行，界面会一直是空的。
  setTimeout(() => {
    refreshQueued = false;
    runRefresh();
  }, 16);
}

async function runRefresh() {
  const heavy = pendingHeavy;
  const reason = pendingReason;
  pendingHeavy = false;
  refreshRunning = true;
  try {
    if (heavy) await doRefresh(reason);
    else if (VIEW_TRANSITION_REASONS.has(reason)) {
      withViewTransition(doLightRefresh, { reason, maxCards: 150 });
    } else doLightRefresh();
  } finally {
    refreshRunning = false;
    // 启动动画在第一轮界面真正画完后收掉；异常路径由 bootFailed / 超时兜底
    if (!bootDone) { bootDone = true; finishBoot('ready'); }
    if (refreshAgain) {
      refreshAgain = false;
      scheduleRefresh(pendingReason);
    }
  }
}

/** 纯 UI 刷新：不查库、不重建卡片，只把已有状态同步到 DOM */
function doLightRefresh() {
  applyViewClass();          // 网格 / 列表切换只改 className
  renderSidebar();
  syncToolbar();
  syncBulkbar();
  renderStats();
  updateEmptyState();
  updateStatusBar();
}

function bindRefresh() {
  window.addEventListener('shelf:refresh', (e) => {
    scheduleRefresh((e && e.detail && e.detail.reason) || 'refresh');
  });
  // docs/14：耗材改价 / 增删会推 filaments:changed，卡片价格来自派生成本缓存，
  // 必须跟着重算。filaments.js 自己的保存流程也会 emitRefresh，这里覆盖外部调用路径。
  window.addEventListener('filaments:changed', () => emitRefresh('costs'));
}

/**
 * 统计条右侧的「模型网站」导航。
 * URL 是 index.html 里写死的 data-url 常量，这里不拼接字符串；点击只走
 * api.openExternal → 主进程 shell.openExternal（那里还会再校验 ^https?://），
 * 用系统浏览器打开，绝不在 app:// 页面内导航（CSP 不允许，也会把窗口变空白）。
 */
function bindWebLinks() {
  const root = qs('#stats-links');
  if (!root) return;
  root.addEventListener('click', async (e) => {
    const btn = (e.target instanceof Element) ? e.target.closest('button[data-url]') : null;
    if (!btn || !root.contains(btn)) return;
    try {
      await api.openExternal(btn.getAttribute('data-url') || '');
    } catch (err) {
      emitToast('error', '打开网页失败：' + ((err && err.message) || '未知错误'));
    }
  });
}
/**
 * 首屏后由渲染层主动查一次「一次都没匹配上」的模型，弹表单式弹窗：
 * 缩略图 + 分类下拉 + 跳过；词库去「设置 → 自动分类」里改。本次运行只弹一次。
 */
let classifyPrompted = false;
function bindClassifyPrompt() {
  // 诊断字段：探针据此确认「是否查过、查到了什么、有没有弹」
  window.__printshelfClassify = { checked: 0, unmatched: 0, shown: 0, error: null };
  // 走查要截这个弹窗时手动调它，参数同主进程给的 unmatched 数组
  window.__printshelfPromptUnmatched = (items) => showClassifyPrompt(Array.isArray(items) ? items : []);
  scheduleUnmatchedCheck();
}

/**
 * 首屏画完后主动查一次「还有哪些没匹配上」，由渲染层直接弹窗。
 * 不走主进程推送：推送要赌渲染层 EventBus 的注册时序，这一版实测会丢事件；
 * classifyRun 只读 + 干跑，没有可分类项时连库都不写，成本可以忽略。
 */
function scheduleUnmatchedCheck() {
  // capture / 走查模式不自动弹：弹窗会挡住其它探针要点的按钮。
  // 需要截这个弹窗的探针调 window.__printshelfPromptUnmatched([...]) 手动触发。
  try {
    if (String(window.location.search || '').indexOf('capture=1') >= 0) return;
  } catch (_) { /* 非标准 location，照常检查 */ }
  setTimeout(() => {
    const diag = window.__printshelfClassify;
    const cfg = (state.settings && state.settings.classify) || {};
    if (cfg.enabled === false || cfg.promptUnmatched === false) return;
    diag.checked++;
    api.classifyRun()
      .then((r) => {
        if (!r || !Array.isArray(r.unmatched) || !r.unmatched.length) return;
        if (classifyPrompted) return;
        diag.unmatched = r.unmatched.length;
        classifyPrompted = true;
        diag.shown++;
        return showClassifyPrompt(r.unmatched);
      })
      .catch((e) => { diag.error = (e && e.message) || String(e); });
  }, 1400);
}

async function showClassifyPrompt(items) {
  const res = await openClassifyPrompt({
    items,
    categories: state.categories || [],
  });
  // res=null 是 Esc / 点 X / 点遮罩，随手关掉不算跳过，下次仍提醒。
  if (!res || typeof res !== 'object') return;
  // 「全部跳过」：把这批 id 记进 settings，重启后不再为它们弹窗（docs/15）。
  // 先记再提示，写失败也不影响本次关闭。
  if (Array.isArray(res.skipped) && res.skipped.length) {
    try {
      const s = await api.classifySkipUnmatched(res.skipped);
      if (s && Array.isArray(s.skippedIds)) {
        // 同步本地 settings，避免本次运行内再次读取到旧跳过名单
        state.settings = {
          ...state.settings,
          classify: { ...(state.settings.classify || {}), skippedIds: s.skippedIds },
        };
      }
      if (window.__printshelfClassify) window.__printshelfClassify.skipped = res.skipped.length;
    } catch (_) { /* api 层已 toast；跳过记录失败不该阻塞归类流程 */ }
  }
  const picks = Array.isArray(res.picked) ? res.picked : [];
  if (!picks.length) return;
  // 同一个分类的模型合成一次 bulk 写库，最多 5 组
  const byCat = new Map();
  for (const p of picks) {
    if (!p || !p.categoryId) continue;
    if (!byCat.has(p.categoryId)) byCat.set(p.categoryId, []);
    byCat.get(p.categoryId).push(p.id);
  }
  let done = 0;
  for (const [catId, ids] of byCat) {
    try {
      await api.bulk(ids, { categoryId: catId });
      done += ids.length;
    } catch (_) { /* 某一组失败不影响其它组 */ }
  }
  if (done) emitToast('success', '已归类 ' + done + ' 个模型');
  emitRefresh('classify');
}

/** 把选择集裁剪到当前结果集内（不可见的条目自动取消勾选） */
function pruneSelection(items) {
  // 回执视图的选择集存的是回执 id（rcp-…），不能拿模型列表去裁剪
  if (state.contentMode === 'receipts') return;
  const sel = state.selection;
  if (!sel || typeof sel.forEach !== 'function' || !sel.size) return;
  const visible = new Set((items || []).map((m) => m.id));
  for (const id of Array.from(sel)) {
    if (!visible.has(id)) sel.delete(id);
  }
}

async function doRefresh(reason) {
  const smart = state.query.smart;
  // 「已完成打印」走打印回执视图（docs/13）；重复 / 失效仍走各自特殊视图
  const mode = smart === 'printed' ? 'receipts'
    : (smart === 'duplicates' || smart === 'missing') ? smart : 'normal';
  const prevMode = state.contentMode;
  state.contentMode = mode;
  // 视图切换时退出长按编辑模式：回执 id 与模型 id 不能共用同一批勾选
  if (prevMode && prevMode !== mode && state.editMode) exitEditMode();

  if (!hasShelf) {
    // 浏览器直接打开调试：不反复发请求，仅用空数据渲染，不白屏
    setState({ items: [], total: 0, facets: {} }, 'refresh');
    if (mode === 'receipts') renderReceipts();
    else if (mode !== 'normal') renderSpecialView(mode);
    else renderGrid();
    renderSidebar();
    syncToolbar();
    syncBulkbar();
    updateEmptyState();
    updateStatusBar();
    return;
  }

  let ok = false;
  try {
    // 首屏 bootstrap 刚取过 stats / smartCounts，直接用，省掉两次全库遍历。
    // 之后的操作照常走 IPC，保证数据新鲜。
    const firstPaint = reason === 'init';
    const [res, stats, counts, costs] = await Promise.all([
      api.query(state.query),
      firstPaint ? state.stats : api.stats().catch(() => state.stats),
      firstPaint ? state.smartCounts : api.smartCounts().catch(() => state.smartCounts),
      api.modelsCosts().catch(() => state.costs),
    ]);
    const items = (res && res.items) || [];
    // 关键：筛选/搜索后，选择集里可能残留已经不可见的 id。
    // 不裁剪的话，用户点「删除勾选」会连看不见的模型一起删掉。
    pruneSelection(items);
    setState({
      items,
      total: (res && res.total) || 0,
      facets: (res && res.facets) || {},
      stats: stats || state.stats,
      smartCounts: counts || state.smartCounts,
      costs: costs || state.costs,
    }, 'refresh');
    ok = true;
  } catch (_) { /* api 层已统一 toast */ }

  if (ok) {
    if (mode === 'normal') renderGrid();
    else if (mode === 'receipts') { invalidateGridCache(); renderReceipts(); }
    else { invalidateGridCache(); renderSpecialView(mode); }
    if (state.activeId) Promise.resolve(refreshDetail()).catch(() => {});
  }
  renderSidebar();
  syncToolbar();
  syncBulkbar();
  renderStats();
  updateEmptyState();
  updateStatusBar();
  // 完整刷新（换分类 / 应用保存视图）不做整页快照，只给内容区一次 180ms 淡入。
  // DOM 已经在上面同步更新完毕，所以不会拖慢任何依赖同步状态的探针。
  if (VIEW_TRANSITION_REASONS.has(reason) && motionEnabled('fade')) {
    enterView(qs('#content'), { distance: 6 });
  }
}

// ---------- 顶部统计条 ----------
let lastStatsSig = '';
let lastStatValues = null;   // 上一轮各项数值，用于「变化才弹一下」
function renderStats() {
  const bar = qs('#stats-bar');
  const cells = qs('#stats-cells');
  if (!bar || !cells) return;
  const ui = (state.settings && state.settings.ui) || {};
  const s = state.stats || {};
  // 统计条每次刷新都重建 7~9 个节点；数据没变就直接跳过（勾选态由 syncBulkbar 负责）
  const sig = JSON.stringify([ui.showStats !== false, s.total, s.totalSize,
    s.byPrintStatus, s.favorites, s.duplicates, s.missing]);
  if (sig === lastStatsSig) { syncBulkbar(); return; }
  lastStatsSig = sig;
  if (ui.showStats === false || !s.total) {
    cells.innerHTML = '';
    cells.hidden = true;
    bar.hidden = true;
    syncBulkbar();          // 「删除勾选」跟着统计条一起隐藏，避免半截操作区
    return;
  }
  const by = s.byPrintStatus || {};
  const prevValues = lastStatValues || {};
  const list = [
    { value: s.total || 0, label: '模型总数', accent: true },
    { value: fmtBytes(s.totalSize || 0), label: '占用空间' },
    { value: by.unprinted || 0, label: '未打印' },
    { value: by.queued || 0, label: '待打印' },
    { value: by.printed || 0, label: '已完成' },
    { value: s.favorites || 0, label: '收藏' },
  ];
  if (s.duplicates) list.push({ value: s.duplicates, label: '重复文件' });
  // 失效记录不再出现在主页面（含这个计数）：文件被删掉后列表里直接消失即可。
  // 需要清理 / 重新定位时走侧栏「失效文件」维护视图。
  // 数字变了就轻弹一下：扫描/分类/删除之后，用户能立刻看到「哪一项动了」。
  // 只在 full 档给动画（CSS 侧用 data-motion-effective 短路），reduced/off 不动。
  const nextValues = {};
  cells.innerHTML = list.map((c) => {
    nextValues[c.label] = c.value;
    const prev = prevValues[c.label];
    const changed = prev !== undefined && String(prev) !== String(c.value);
    return '<div class="stat' + (c.accent ? ' accent' : '') + (changed ? ' bump' : '') + '">' +
      '<span class="stat-value">' + escapeHtml(String(c.value)) + '</span>' +
      '<span class="stat-label">' + escapeHtml(c.label) + '</span></div>';
  }).join('');
  lastStatValues = nextValues;
  cells.hidden = false;
  bar.hidden = false;
  syncBulkbar();            // 勾选状态可能已变：刷新右上角「删除勾选」
}

// ---------- 空状态 / 状态栏 ----------
function updateEmptyState() {
  const empty = qs('#empty-state');
  if (!empty) return;
  const content = qs('#content');
  const isEmpty = state.total === 0 && state.contentMode === 'normal';
  if (!isEmpty) {
    empty.hidden = true;
    if (content) content.hidden = false;
    return;
  }
  empty.hidden = false;
  if (content) content.hidden = false;
  const everAdded = (state.folders && state.folders.length > 0) ||
    (state.stats && (state.stats.total || 0) > 0);
  const never = !everAdded;
  // 停在某个空分类上：这里正是「手动添加」该出现的地方
  const catId = state.query.categoryId;
  const cat = catId ? (state.categories || []).find((c) => c.id === catId) : null;
  const catEmpty = !!cat && !never && state.contentMode === 'normal';
  const title = qs('#empty-title');
  const desc = qs('#empty-desc');
  if (title) {
    title.textContent = never ? '这里还没有模型'
      : (catEmpty ? '「' + cat.name + '」里还没有模型' : '没有符合条件的模型');
  }
  if (desc) {
    desc.textContent = never
      ? '添加一个本机文件夹，PrintShelf 会自动扫描其中的 .3mf 文件并生成缩略图。'
      : (catEmpty
        ? '点下面的按钮，在完整列表里勾选要加入的模型；也可以在「全部模型」里把卡片直接拖到这个分类上。'
        : '试试清除筛选条件，或更换搜索关键词。');
  }
  const addBtn = qs('#empty-add');
  const demoBtn = qs('#empty-demo');
  const pickBtn = qs('#empty-models-add');
  if (addBtn) addBtn.hidden = !never;
  if (demoBtn) demoBtn.hidden = !never;
  if (pickBtn) pickBtn.hidden = !catEmpty;
  let clearBtn = qs('#empty-clear');
  if (!clearBtn) {
    const actions = qs('.empty-actions', empty);
    if (actions) {
      clearBtn = document.createElement('button');
      clearBtn.id = 'empty-clear';
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-primary';
      clearBtn.textContent = '清除筛选';
      clearBtn.addEventListener('click', () => {
        // 停在空分类上时只退出分类筛选，保留其它条件不动
        if (state.query.categoryId && state.contentMode === 'normal' && !state.query.keyword) {
          setState({ query: { ...state.query, categoryId: null } }, 'query');
          emitRefresh('empty-all');
          return;
        }
        window.dispatchEvent(new CustomEvent('shelf:clearfilters'));
      });
      actions.appendChild(clearBtn);
    }
  }
  // 空分类时主按钮是「手动添加模型」，把「清除筛选」降级为次要按钮
  if (clearBtn) {
    clearBtn.hidden = never;
    clearBtn.className = catEmpty ? 'btn btn-ghost' : 'btn btn-primary';
    clearBtn.textContent = catEmpty ? '看看全部模型' : '清除筛选';
  }
}
function updateStatusBar() {
  const text = qs('#status-text');
  if (text) {
    const label = state.scanning ? '正在扫描…' : (!hasShelf ? '未连接本地服务' : '就绪');
    text.innerHTML = '<span class="status-dot"></span>' + escapeHtml(label);
  }
  const sel = qs('#status-selection');
  if (sel) sel.textContent = state.selection.size ? '已选 ' + state.selection.size + ' 项' : '';
  const count = qs('#status-count');
  if (count) count.textContent = '共 ' + state.total + ' 个模型';
}
function onState(_s, reason) {
  if (reason === 'selection') updateStatusBar();
}

// ---------- 标题栏 / 空状态按钮 ----------
function bind(id, evt, fn) {
  const el = qs(id);
  if (el) el.addEventListener(evt, fn);
}
function bindTitlebar() {
  bind('#btn-quick-add', 'click', quickAdd);
  bind('#empty-add', 'click', quickAdd);
  bind('#empty-demo', 'click', addDemo);
  // 空分类页的「手动添加模型」：打开可搜索多选弹窗
  bind('#empty-models-add', 'click', () => {
    const id = state.query.categoryId;
    if (id) Promise.resolve(pickModelsForCategory(id)).catch(() => {});
  });
  bind('#btn-scan', 'click', () => startScan(false));
  bind('#btn-roulette', 'click', roulette);
  bind('#btn-theme', 'click', toggleTheme);
  bind('#btn-settings', 'click', () => openSettings());
  bind('#btn-devices', 'click', () => { if (isDevicesOpen()) closeDevices(); else openDevices(); });
  bind('#btn-filaments', 'click', () => { if (isFilamentsOpen()) closeFilaments(); else openFilaments(); });
  bind('#btn-win-min', 'click', () => api.win('min').catch(() => {}));
  bind('#btn-win-max', 'click', () => api.win('max').catch(() => {}));
  bind('#btn-win-close', 'click', () => api.win('close').catch(() => {}));
  // 数据目录入口保留在状态栏 #status-datadir；侧栏 #btn-data-dir 已移除（侧栏精简）
  bind('#status-datadir', 'click', () => api.openDataDir().catch(() => {}));
  bind('#sidebar-toggle', 'click', toggleSidebar);
}
async function reloadFolders() {
  try {
    const list = await api.folders();
    setState({ folders: list || [] }, 'folders');
  } catch (_) { /* api 层已统一提示 */ }
}
async function quickAdd() {
  try {
    const dir = await api.pickFolder();
    if (!dir) return;
    await api.folderAdd(dir);
    emitToast('success', '已添加目录：' + dir);
    await reloadFolders();
    emitRefresh('folders');
    await api.scanStart({});
  } catch (_) { /* api 层已统一提示 */ }
}
async function addDemo() {
  try {
    // 不再硬编码开发机路径：让用户自己选目录
    const dir = await api.pickFolder();
    if (!dir) return;
    await api.folderAdd(dir);
    emitToast('success', '已添加示例目录');
    await reloadFolders();
    emitRefresh('folders');
    await api.scanStart({});
  } catch (_) { /* api 层已统一提示 */ }
}
async function startScan(force) {
  try {
    state.scanning = true;
    showScanProgress(0, '正在扫描…');
    updateStatusBar();
    await api.scanStart({ force: !!force });
  } catch (_) {
    state.scanning = false;
    hideScanProgress();
    updateStatusBar();
  }
}
async function roulette() {
  try {
    const m = await api.roulette();
    if (m && m.id) Promise.resolve(openDetail(m.id)).catch(() => {});
    else emitToast('info', '没有可挑选的未打印模型');
  } catch (_) { /* api 层已统一提示 */ }
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  setState({ theme: next }, 'theme');
  api.settingsUpdate({ ui: { theme: next } }).catch(() => {});
}
// ---------- 扫描进度 ----------
function bindScanProgress() {
  window.addEventListener('shelf:scanprogress', (e) => {
    const d = (e && e.detail) || {};
    if (d.done) {
      state.scanning = false;
      hideScanProgress();
      updateStatusBar();
      return;
    }
    state.scanning = true;
    const pct = clamp(d.percent || 0, 0, 100);
    showScanProgress(pct, d.message || '正在扫描…');
    updateStatusBar();
  });
}
function showScanProgress(pct, label) {
  const box = qs('#scan-progress');
  if (!box) return;
  box.hidden = false;
  const l = qs('#scan-label'); if (l) l.textContent = label;
  const bar = qs('#scan-bar'); if (bar) bar.style.width = pct + '%';
  const pc = qs('#scan-percent'); if (pc) pc.textContent = Math.round(pct) + '%';
}
function hideScanProgress() {
  const box = qs('#scan-progress');
  if (box) box.hidden = true;
}

// ---------- 拖拽添加目录 ----------
function bindDragDrop() {
  const mask = qs('#drag-mask');
  let depth = 0;
  // 只接管「从资源管理器拖进来的文件」；卡片拖拽到侧栏分类属于内部移动，不能让遮罩弹出来
  // 注意：拖卡片时 dataTransfer.types 里也会有 'Files'（Chromium 把卡片里的 <img> 当文件塞进去了），
  // 只判 Files 会让库内拖动弹出「松开即可添加」的导入遮罩。
  // 判定优先级：
  //   ① 带我们自己类型的一定是库内拖动（最可靠，和时间无关）；
  //   ② 其次是 dragstart 打的 body 标记（兜底，防止某些实现不带自定义类型）；
  //   ③ 都没有才按 Files 当作外部导入。
  const INTERNAL_TYPE = 'application/x-shelf-ids';
  const hasFiles = (e) => {
    const t = e.dataTransfer && e.dataTransfer.types;
    if (!t) return false;
    if (Array.prototype.indexOf.call(t, INTERNAL_TYPE) >= 0) return false;
    if (document.body.classList.contains('drag-holding-card')) return false;
    return Array.prototype.indexOf.call(t, 'Files') >= 0;
  };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (mask) mask.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0 && mask) mask.hidden = true;
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    if (mask) mask.hidden = true;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const dirs = new Set();
    for (const f of Array.from(files)) {
      const p = f.path || '';   // Electron 下 File.path 可用
      if (!p) continue;
      if (/\.3mf$/i.test(p)) {
        dirs.add(p.replace(/[\\/][^\\/]*$/, '') || p); // .3mf 文件取其父目录
      } else {
        dirs.add(p);
      }
    }
    if (!dirs.size) {
      emitToast('warn', '无法识别拖入的路径，请在桌面应用中拖入文件夹或 .3mf 文件');
      return;
    }
    try {
      for (const d of dirs) await api.folderAdd(d);
      emitToast('success', '已添加 ' + dirs.size + ' 个目录');
      await reloadFolders();
      emitRefresh('folders');
      await api.scanStart({});
    } catch (_) { /* api 层已统一提示 */ }
  });
}

// ---------- 全局快捷键 ----------
function isTyping(t) {
  if (!t) return false;
  const tag = (t.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable === true;
}
function targetIds() {
  if (state.selection.size) return Array.from(state.selection);
  if (state.activeId) return [state.activeId];
  return [];
}
function focusSearch() {
  const el = qs('#search-input');
  if (el) { el.focus(); el.select(); }
}
async function renameActive() {
  const ids = targetIds();
  if (ids.length !== 1) { emitToast('info', '请选中单个模型后重命名'); return; }
  const m = (state.items || []).find((x) => x && x.id === ids[0]);
  const old = m ? (m.title || m.fileName || '') : '';
  let name;
  try {
    name = await promptDialog({ title: '重命名模型', label: '名称', value: old, confirmText: '保存' });
  } catch (_) { return; }
  if (name == null || !name.trim()) return;
  api.rename(ids[0], name.trim()).then(() => emitRefresh('rename')).catch(() => {});
}
function toggleFav() {
  const ids = targetIds();
  if (!ids.length) return;
  const m = (state.items || []).find((x) => x && x.id === ids[0]);
  api.bulk(ids, { favorite: m ? !m.favorite : true }).then(() => emitRefresh('fav')).catch(() => {});
}
function openInSlicer() {
  const ids = targetIds();
  if (!ids.length) return;
  openModelsWithChoice(ids)
    .then(() => emitRefresh('opened'))
    .catch(() => {});
}
function openPreview() {
  const ids = (state.items || []).map((m) => m.id);
  if (!ids.length) return;
  let idx = 0;
  const anchor = state.activeId || (state.selection.size ? Array.from(state.selection)[0] : null);
  if (anchor) { const i = ids.indexOf(anchor); if (i >= 0) idx = i; }
  openLightbox(ids, idx);
}
async function removeTargets() {
  const ids = targetIds();
  if (!ids.length) return;
  const names = ids.map((id) => {
    const m = (state.items || []).find((x) => x && x.id === id);
    return m ? (m.path || m.fileName || id) : id;
  });
  let ok = false;
  try {
    ok = await confirmDialog({
      title: '移出索引',
      message: '确定把选中的 ' + ids.length + ' 个模型移出索引吗？磁盘文件不会被删除。',
      detail: '以下路径将从模型库移除：',
      items: names, danger: true, confirmText: '移出索引',
    });
  } catch (_) { return; }
  if (!ok) return;
  api.remove(ids).then(() => emitRefresh('remove')).catch(() => {});
}
function rate(n) {
  const ids = targetIds();
  if (!ids.length) return;
  api.bulk(ids, { rating: n }).then(() => emitRefresh('rating')).catch(() => {});
}
// 全局撤销：兼容 bulkbar 的 {ids,before,fields} 快照、{undo}、{ids,patch}，其余交给 api.undo()
async function globalUndo() {
  const stack = state.undoStack;
  if (!Array.isArray(stack) || !stack.length) {
    emitToast('info', '没有可撤销的操作');
    return;
  }
  const entry = stack.pop();
  let done = true;
  try {
    if (entry && typeof entry.undo === 'function') {
      const r = await entry.undo();
      if (r && r.ok === false) done = false;
    } else if (entry && entry.before && Array.isArray(entry.ids)) {
      if (Array.isArray(entry.fields) && entry.fields.length === 0) {
        // 移出索引：由后端 undo 恢复记录；ok:false 表示后端已没有对应快照
        const r = await api.undo();
        if (r && r.ok === false) done = false;
      } else {
        for (const id of entry.ids) {
          const b = entry.before[id];
          if (b) await api.update(id, b);
        }
      }
    } else if (entry && entry.ids && entry.patch) {
      await api.bulk(entry.ids, entry.patch);
    } else {
      const r = await api.undo();
      if (r && r.ok === false) done = false;
    }
  } catch (_) {
    done = false;   // api 层已统一提示
  }
  const diag = (typeof window !== 'undefined')
    ? (window.__printshelfUndo = window.__printshelfUndo || {}) : null;
  if (!done) {
    // 撤销没有真正生效：不弹「已撤销」，条目放回栈，避免吞掉可撤销操作
    if (diag) diag.globalNoop = (diag.globalNoop || 0) + 1;
    stack.push(entry);
    return;
  }
  if (diag) diag.globalDone = (diag.globalDone || 0) + 1;
  emitToast('success', '已撤销');
  emitRefresh('undo');
}
function handleEsc(e) {
  // 逐层关闭：自建表单 > 向导 > 灯箱 > 弹窗 > 菜单 > 设置 > 详情 > 清空选择，只关一层。
  if (typeof window !== 'undefined') {
    const d = (window.__printshelfKeys = window.__printshelfKeys || {});
    d.escSeen = (d.escSeen || 0) + 1;
  }
  // 设备页 promptForm 自建的 .ow-backdrop 不在 modal 栈里：先取消它并截断事件，
  // 否则会连底下的设备面板一起关掉（表单还留在屏幕上）。
  if (isPromptFormOpen()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelPromptForm();
    return;
  }
  if (isOnboardingOpen()) return; // 向导自己处理 Esc（避免同一次按键关掉两层）
  if (isLightboxOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeLightbox(); return; }
  if (isModalOpen()) {
    // 有弹窗时交给 modal.js 自己的捕获监听：它按栈只关顶层。
    // 这里不能 stopImmediatePropagation，也不能 closeAllModals（那样会一次关掉整栈）。
    e.preventDefault();
    return;
  }
  if (isMenuOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); return; }
  if (isBambuAccountOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeBambuAccount(); return; }
  if (isDevicesOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeDevices(); return; }
  if (isFilamentsOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeFilaments(); return; }
  if (isSettingsOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeSettings(); return; }
  if (isEditMode()) { e.preventDefault(); e.stopImmediatePropagation(); exitEditMode(); return; }
  if (state.activeId) { e.preventDefault(); e.stopImmediatePropagation(); closeDetail(); return; }
  e.preventDefault();
  e.stopImmediatePropagation();
  window.dispatchEvent(new CustomEvent('shelf:selectionclear'));
  if (isTyping(e.target) && document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
}
/**
 * 是否有弹窗 / 浮层打开。除 Esc 外，只要有一个打开，
 * 单键与 Ctrl/Alt+单键都不触发后台动作（含 Ctrl+Z，交给输入框或弹窗自己的原生处理）。
 */
function isOverlayOpen() {
  return isModalOpen() || isPromptFormOpen() || isSettingsOpen() || isDevicesOpen() ||
    isFilamentsOpen() || isLightboxOpen() || isOnboardingOpen() || isMenuOpen() ||
    isBambuAccountOpen();
}
function onKey(e) {
  const typing = isTyping(e.target);
  const k = (e.key || '').toLowerCase();

  // Esc 是唯一的例外：逐层关闭由 handleEsc 统一处理
  if (e.key === 'Escape') { handleEsc(e); return; }
  if (isOverlayOpen()) {
    if (typeof window !== 'undefined') {
      const d = (window.__printshelfKeys = window.__printshelfKeys || {});
      d.blocked = (d.blocked || 0) + 1;
      d.lastBlocked = k;
    }
    return;
  }
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  if (mod) {
    if ((e.ctrlKey || e.metaKey) && k === 'a') {
      if (typing) return;                 // 输入框内交给浏览器全选文本
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('shelf:selectall'));
    } else if ((e.ctrlKey || e.metaKey) && k === 'f') {
      e.preventDefault(); focusSearch();
    } else if ((e.ctrlKey || e.metaKey) && k === 'd') {
      e.preventDefault(); toggleFav();
    } else if ((e.ctrlKey || e.metaKey) && k === 'o') {
      e.preventDefault(); openInSlicer();
    } else if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault(); globalUndo();
    }
    return;
  }

  // 单键：输入框聚焦时忽略（Esc 已在上面处理）
  if (typing) return;
  switch (e.key) {
    case '/': e.preventDefault(); focusSearch(); break;
    case ' ': case 'Spacebar': e.preventDefault(); openPreview(); break;
    case 'Delete':
      e.preventDefault();
      // 回执视图的勾选是回执 id（rcp-…），绝不能传给模型 remove；转给回执自己的删除流程
      if (state.contentMode === 'receipts') {
        window.dispatchEvent(new CustomEvent('shelf:receipts-deleteselected'));
      } else {
        removeTargets();
      }
      break;
    case 'F2': e.preventDefault(); renameActive(); break;
    case 'F5': e.preventDefault(); startScan(false); break;
    default:
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); rate(Number(e.key)); }
  }
}
function bindGlobalKeys() {
  // 捕获阶段注册：先于 menu/detail 等冒泡监听，保证 Esc 逐层关闭只关一层
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('shelf:undo', () => globalUndo());
}

// ---------- 全局点击空白 ----------
function isBlankClick(t) {
  if (!t || !t.closest) return false;
  // .rc-card 是打印回执卡片，和主页面 .card 一样属于「内容」而非空白，
  // 否则编辑模式下点回执卡片会被当成点空白，立刻退出编辑模式。
  return !t.closest('.card, .rc-card, .bulkbar, #toolbar, #sidebar, .detail, .modal, .context-menu, .overlay, .lightbox, .toast, button, input, select, label, .chip, .badge, .nav-item, a');
}
function bindWindowClicks() {
  document.addEventListener('click', (e) => {
    if (isMenuOpen() && !(e.target && e.target.closest && e.target.closest('#context-menu'))) {
      closeMenu();
    }
    if ((state.selection.size || isEditMode()) && isBlankClick(e.target)) {
      // 在编辑模式里，点空白是"退出编辑"，不只是清空勾选
      if (isEditMode()) exitEditMode();
      else window.dispatchEvent(new CustomEvent('shelf:selectionclear'));
    }
    closeQuickOpen();
  });
}
