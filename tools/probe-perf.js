/**
 * 走查探针：性能 A/B（同一份 224 条真实数据）。
 *   node launch.js --capture=out.png --ui-script=tools/probe-perf.js
 *
 * 量三件事：
 *   ① 纯 UI 刷新（网格/列表切换）是否真的不发查库 IPC；
 *   ② 数据没变时的刷新是否走增量路径、卡片 DOM 是否被复用、滚动位置是否保住；
 *   ③ 同一数据集下「全量重建」与「增量替换」的渲染耗时对比。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const diag = window.__printshelfRender;
if (!diag) return { ok: false, error: '网格诊断计数未加载' };

const nav = performance.getEntriesByType('navigation')[0] || {};
const paint = performance.getEntriesByType('paint') || [];
const boot = window.__printshelfBoot || {};
const fcp = paint.find((p) => p.name === 'first-contentful-paint');
const out = {
  timingMs: {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    firstContentfulPaint: fcp ? Math.round(fcp.startTime) : null,
    bootVisible: boot.endedAt ? boot.endedAt - boot.startedAt : null,
    bootSinceNavigation: boot.endedAt ? Math.round(boot.endedAt - performance.timeOrigin) : null,
  },
  dom: {
    totalNodes: document.querySelectorAll('*').length,
    cards: q('#content') ? q('#content').children.length : 0,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  },
};

// 计数由 api.js 的代理自己维护；contextBridge 对象是冻结的，外部打桩无效
const counts = window.__printshelfIpc;
if (!counts) return { ok: false, error: 'IPC 计数未加载' };

// 换排序会持久化到 settings.json，先快照整份 ui，结尾显式 await 写回，
// 避免 fire-and-forget 的设置在 capture 窗口退出前来不及落盘。
const shelf = window.shelf;
let originalUi = null;
try {
  const s = await shelf.settings();
  if (s && s.ui) originalUi = { ...s.ui };
} catch (_) { /* 读不到就只还原排序控件本身 */ }
const snapCounts = () => ({ ...counts });
const resetCounts = () => { for (const k of Object.keys(counts)) counts[k] = 0; };
const refresh = (reason) => window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason } }));

diag.full = 0; diag.patch = 0; resetCounts();

/**
 * 等渲染层真的画完再读 diag，别用固定 sleep。
 * 冷启动 / 连续跑探针时 doRefresh（query + stats + smartCounts）可能超过 800ms，
 * 固定 sleep 会读到上一步的结果，导致「fullRender 显示 patch、patchRender 显示 full」这种假失败。
 * renderGrid() 末尾是「先写 lastMs/lastMode/replaced，再递增 full 或 patch」，
 * 所以计数一变就能拿到该次渲染的准确快照。
 */
async function waitRenderSnapshot(accept, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (accept()) {
      return {
        ms: diag.lastMs, mode: diag.lastMode, replaced: diag.replaced, settled: true,
      };
    }
    await sleep(20);
  }
  return { ms: null, mode: null, replaced: null, settled: false };
}

// ① 纯 UI 刷新：一次查库 IPC 都不该发
const rendersBefore = diag.full + diag.patch;
refresh('viewmode');
await sleep(350);
out.lightRefresh = {
  ipc: snapCounts(), fullRenders: diag.full, patchRenders: diag.patch,
  renders: diag.full + diag.patch - rendersBefore,
};

// ② 换排序 → 顺序全变，走全量重建
const sort = q('#sort-select');
const originalSort = sort ? sort.value : null;
resetCounts();
const fullBefore = diag.full;
if (sort) { sort.value = 'name'; sort.dispatchEvent(new Event('change')); }
const fullShot = await waitRenderSnapshot(() => diag.full > fullBefore);
out.fullRender = Object.assign({ ipc: snapCounts() }, fullShot);

// ③ 数据没变再刷一次 → 增量路径，0 张卡片被替换
const firstCard = q('.card');
const scroller = q('#content');
if (scroller) scroller.scrollTop = 420;
resetCounts();
const patchBefore = diag.patch;
refresh('status');
const patchShot = await waitRenderSnapshot(() => diag.patch > patchBefore);
out.patchRender = Object.assign({ ipc: snapCounts() }, patchShot);
out.reuse = {
  sameCardNode: !!firstCard && q('.card') === firstCard,
  scrollPreserved: !!scroller && Math.abs(scroller.scrollTop - 420) <= 2,
};

// 还原：排序偏好 + 被临时打桩的 IPC 方法，不能因为跑探针改掉用户设置
if (sort && originalSort) { sort.value = originalSort; sort.dispatchEvent(new Event('change')); }
await sleep(500);
if (scroller) scroller.scrollTop = 0;
// 排序控件的 change 只发 fire-and-forget 的设置更新；这里补一次显式写回并等落盘。
if (originalUi && shelf && typeof shelf.settingsUpdate === 'function') {
  try { await shelf.settingsUpdate({ ui: originalUi }); } catch (_) { /* 不因还原失败影响测量结论 */ }
}

out.speedup = out.patchRender.ms > 0
  ? Math.round((out.fullRender.ms / out.patchRender.ms) * 10) / 10 : null;
out.ok =
  out.lightRefresh.ipc.query === 0 && out.lightRefresh.ipc.stats === 0 &&
  out.lightRefresh.ipc.smartCounts === 0 && out.lightRefresh.renders === 0 &&
  // 反证计数器确实在工作：两次完整刷新都必须真的发过 query、真的渲染完
  out.fullRender.settled && out.patchRender.settled &&
  out.fullRender.ipc.query > 0 && out.patchRender.ipc.query > 0 &&
  out.fullRender.mode === 'full' && out.patchRender.mode === 'patch' &&
  out.patchRender.replaced === 0 && out.reuse.sameCardNode && out.reuse.scrollPreserved &&
  out.patchRender.ms < out.fullRender.ms;
return out;
