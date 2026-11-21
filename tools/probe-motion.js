/**
 * 走查探针：高雅化简洁层 / 动效三档 / View Transitions 降级 / 一键回退开关。
 *   node launch.js --capture=out.png --ui-script=tools/probe-motion.js
 *
 * 不写 settings.json：档位用 __printshelfMotionApi.withLevel() 在内存里临时强制，
 * 图标集用 __printshelfIcons.apply() 临时切换；结束后把 html dataset、sprite、
 * matchMedia、startViewTransition 全部还原，并断言还原成功。
 */
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 6000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); }
  return false;
};

const out = {};
const html = document.documentElement;
const ready = await waitFor(() =>
  qa('#content .card').length > 0 && !!window.__printshelfMotionApi && !!window.__printshelfMotion);
if (!ready) return { ok: false, error: '首屏或动效模块未就绪' };

const api = window.__printshelfMotionApi;
const icons = window.__printshelfIcons;
const diag = window.__printshelfMotion;
const ipc = window.__printshelfIpc;
const render = window.__printshelfRender;

const was = {
  iconset: html.dataset.iconset,
  motion: html.dataset.motion,
  effective: html.dataset.motionEffective,
  runtime: icons ? icons.set : null,
};

// ---------- 1. 基础契约 ----------
out.cssLoaded = Array.from(document.styleSheets)
  .some((s) => String(s.href || '').includes('motion.css'));
out.vtCss = Array.from(document.styleSheets).some((s) => {
  try { return Array.from(s.cssRules).some((r) => String(r.cssText).includes('view-transition')); }
  catch (_) { return false; }
});
out.easeVar = getComputedStyle(html).getPropertyValue('--ease-ui').trim();
out.legacyEaseUnchanged = getComputedStyle(html).getPropertyValue('--ease').trim() === 'ease';
out.supportsVT = typeof document.startViewTransition === 'function';
out.dataset = { iconset: was.iconset, motion: was.motion, effective: was.effective };
out.viewTitleName = getComputedStyle(q('#view-title')).viewTransitionName;

// ---------- 2. 简洁化规则只在 lucide 档生效（一键回退的关键） ----------
const stat = q('.stat');
if (stat) {
  html.dataset.iconset = 'lucide';
  const lucideBg = getComputedStyle(stat).backgroundColor;
  const lucideBorder = getComputedStyle(stat).borderTopColor;
  html.dataset.iconset = 'legacy';
  const legacyBg = getComputedStyle(stat).backgroundColor;
  const legacyBorder = getComputedStyle(stat).borderTopColor;
  const transparent = (v) => v === 'transparent' || v === 'rgba(0, 0, 0, 0)';
  out.refine = {
    lucideBg, legacyBg, lucideBorder, legacyBorder,
    lucideFlat: transparent(lucideBg) && transparent(lucideBorder),
    legacyHasSurface: !transparent(legacyBg) && !transparent(legacyBorder),
  };
} else {
  out.refine = { skipped: true, lucideFlat: false, legacyHasSurface: false };
}
html.dataset.iconset = was.iconset;

// ---------- 3. 两套图标路径都能装载，且能切回原状 ----------
const firstD = (sym) => {
  const p = sym && sym.querySelector('path');
  return p ? (p.getAttribute('d') || '') : '';
};
const expectD = (s) => { const m = /<path[^>]*\bd="([^"]+)"/.exec(s || ''); return m ? m[1] : ''; };
const starNow = () => q('#icon-sprite #i-star');
if (icons) {
  const legacyExpected = expectD(icons.bodies('legacy')['i-star']);
  const lucideExpected = expectD(icons.bodies('lucide')['i-star']);
  icons.apply('legacy');
  const legacyD = firstD(starNow());
  const datasetLegacy = html.dataset.iconset;
  icons.apply('lucide');
  const lucideD = firstD(starNow());
  out.icons = {
    idCount: icons.ids().length,
    legacyApplied: legacyD === legacyExpected && legacyExpected.length > 0,
    lucideApplied: lucideD === lucideExpected && lucideExpected.length > 0,
    pathsDiffer: legacyD !== lucideD,
    datasetLegacy,
    restored: icons.set === (was.runtime || 'lucide'),
    datasetRestored: html.dataset.iconset === (was.iconset || 'lucide'),
  };
  // 无论用户原本是什么档，都还原到运行时原状
  icons.apply(was.runtime || was.iconset || 'lucide');
  out.icons.restored = icons.set === (was.runtime || 'lucide');
  out.icons.datasetRestored = html.dataset.iconset === (was.iconset || 'lucide');
} else {
  out.icons = { missing: true };
}

// ---------- 4. View Transitions：支持路径必须真的更新 DOM ----------
const vtBefore = diag.vt, fbBefore = diag.vtFallback;
let vtUpdated = false;
// 显式放大 maxCards：库里 189 张时会走 too-many-cards 降级，测不到真正的转场路径
const transition = api.withViewTransition(() => { vtUpdated = true; }, { reason: 'probe-vt', maxCards: 1e6 });
if (transition && transition.updateCallbackDone) {
  await Promise.resolve(transition.updateCallbackDone).catch(() => {});
  // 等这一轮转场彻底结束，否则紧接着的强制 full 用例会撞上「上一轮未完成」而抛错
  await Promise.resolve(transition.finished).catch(() => {});
}
out.vt = {
  called: !!transition,
  domUpdated: vtUpdated,
  vtDelta: diag.vt - vtBefore,
  fallbackDelta: diag.vtFallback - fbBefore,
};
out.vt.ok = vtUpdated && ((transition && diag.vt > vtBefore) ||
  (!transition && diag.vtFallback > fbBefore));

// 强制「浏览器不支持」分支：回调必须同步执行，DOM 不能被丢下
let disabled = false;
try {
  Object.defineProperty(document, 'startViewTransition',
    { value: undefined, configurable: true, writable: true });
  disabled = typeof document.startViewTransition !== 'function';
} catch (_) { disabled = false; }
const fb0 = diag.vtFallback;
let syncUpdated = false;
const noVtResult = disabled
  ? api.withViewTransition(() => { syncUpdated = true; }, { reason: 'probe-unsupported' })
  : null;
out.unsupported = {
  actuallyDisabled: disabled,
  returnedNull: noVtResult === null,
  domUpdated: syncUpdated,
  fallbackDelta: diag.vtFallback - fb0,
  vtUnchanged: true,
};
try { delete document.startViewTransition; } catch (_) { /* 原型方法仍在 */ }
out.unsupported.apiRestored = typeof document.startViewTransition === 'function';

// ---------- 5. off 档：无 VT、无 WAAPI，CSS 命名组也关掉 ----------
api.withLevel('off', () => {
  api.applyMotionPrefs();
  const d0 = { vt: diag.vt, enter: diag.enter, pulse: diag.pulse };
  let updated = false;
  const r = api.withViewTransition(() => { updated = true; }, { reason: 'probe-off' });
  const p = api.pulse(q('#btn-scan'));
  const e = api.enterView(q('#content'));
  out.off = {
    effective: api.effective(),
    dataset: html.dataset.motionEffective,
    returnedNull: r === null,
    domUpdated: updated,
    vtUnchanged: diag.vt === d0.vt,
    pulseNull: p === null,
    enterNull: e === null,
    countersUnchanged: diag.enter === d0.enter && diag.pulse === d0.pulse,
    viewTitleName: getComputedStyle(q('#view-title')).viewTransitionName,
  };
});
api.applyMotionPrefs();

// ---------- 6. reduced 档：只保留纯 opacity 淡入 ----------
api.withLevel('reduced', () => {
  api.applyMotionPrefs();
  out.reduced = {
    effective: api.effective(),
    fadeEnabled: api.enabled('fade'),
    moveEnabled: api.enabled('move'),
    dataset: html.dataset.motionEffective,
  };
});
api.applyMotionPrefs();

// ---------- 7. 系统「减少动态效果」不再是硬覆盖（2026-11-19 改） ----------
// 新契约：应用内档位优先；只有用户打开「跟随系统」时才降档。
// 本节同时验证两条路径，避免又退回「选完整却没动效」。
const origMM = window.matchMedia;
let mmHits = 0;
try {
  window.matchMedia = function (sel) {
    if (String(sel).indexOf('prefers-reduced-motion') >= 0) {
      mmHits++;
      return { matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
    }
    return origMM.call(window, sel);
  };
  out.systemReduce = api.withFollowSystem(true, () => {
    api.applyMotionPrefs();
    return { effective: api.effective(), dataset: html.dataset.motionEffective, intercepted: mmHits > 0 };
  });
  out.appWins = api.withFollowSystem(false, () => {
    api.applyMotionPrefs();
    return { effective: api.effective(), dataset: html.dataset.motionEffective };
  });
} finally {
  window.matchMedia = origMM;
  api.applyMotionPrefs();
}
out.systemReduce.matchMediaRestored = window.matchMedia === origMM;

// ---------- 8. 浮层层级未被破坏 ----------
const z = (sel) => { const el = q(sel); return el ? Number(getComputedStyle(el).zIndex) || 0 : null; };
out.layers = { toast: z('#toast-container'), dragMask: z('#drag-mask') };
out.layersOk = out.layers.toast === 210 && out.layers.dragMask === 200;

// ---------- 9. 强制 full 档：证明 View Transitions 这条路径本身可用 ----------
// 本机系统「减少动态效果」命中时，默认 effective 会被降到 reduced；
// 这一节用 withLevel('full') 绕开系统偏好，验证 startViewTransition 真被调用、
// 回调真的更新了 DOM。它不写任何设置，回调结束后档位自动还原。
let forcedTransition = null;
const forcedFlag = { updated: false };
api.withLevel('full', () => {
  api.applyMotionPrefs();
  const v0 = diag.vt;
  forcedTransition = api.withViewTransition(
    () => { forcedFlag.updated = true; }, { reason: 'probe-full', maxCards: 1e6 });
  out.fullForced = {
    effective: api.effective(),
    called: !!forcedTransition,
    vtDelta: diag.vt - v0,
    domUpdated: forcedFlag.updated,
  };
});
if (forcedTransition && forcedTransition.updateCallbackDone) {
  await Promise.resolve(forcedTransition.updateCallbackDone).catch(() => {});
  out.fullForced.domUpdated = forcedFlag.updated;
}
api.applyMotionPrefs();

// ---------- 10. 轻量刷新仍不查库（沿用 probe-perf 口径） ----------
const ipc0 = ipc ? { query: ipc.query, stats: ipc.stats, smartCounts: ipc.smartCounts } : null;
const renders0 = render ? render.full + render.patch : 0;
window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason: 'viewmode' } }));
await sleep(400);
out.light = ipc0 ? {
  query: ipc.query - ipc0.query,
  stats: ipc.stats - ipc0.stats,
  smartCounts: ipc.smartCounts - ipc0.smartCounts,
  renders: render ? (render.full + render.patch - renders0) : -1,
} : { skipped: true };

// ---------- 11. 还原并断言 ----------
html.dataset.motion = was.motion;
html.dataset.motionEffective = was.effective;
api.applyMotionPrefs();
out.restored = {
  iconset: html.dataset.iconset === (was.iconset || 'lucide'),
  iconsetRuntime: icons ? icons.set === (was.runtime || 'lucide') : true,
  motion: html.dataset.motion === (was.motion || 'full'),
  effective: html.dataset.motionEffective === (was.effective || 'full'),
};

out.ok = ready && out.cssLoaded && out.vtCss &&
  out.easeVar.indexOf('cubic-bezier') >= 0 && out.legacyEaseUnchanged &&
  out.dataset.iconset === 'lucide' && out.dataset.motion === 'full' &&
  (out.viewTitleName === 'shelf-title' || out.viewTitleName === 'none') &&
  out.refine.lucideFlat && out.refine.legacyHasSurface &&
  // 只设下限：sprite 的确切数量与 id 集合由 probe-icons.js 专职校验，
  // 这里只保证整套图标已装载。新增图标（如 i-globe）不应该让动效探针误报。
  out.icons.idCount >= 57 && out.icons.legacyApplied && out.icons.lucideApplied &&
  out.icons.pathsDiffer && out.icons.restored && out.icons.datasetRestored &&
  out.vt.ok &&
  out.unsupported.actuallyDisabled && out.unsupported.returnedNull &&
  out.unsupported.domUpdated && out.unsupported.fallbackDelta > 0 &&
  out.unsupported.apiRestored &&
  out.off.effective === 'off' && out.off.dataset === 'off' &&
  out.off.returnedNull && out.off.domUpdated && out.off.vtUnchanged &&
  out.off.pulseNull && out.off.enterNull && out.off.countersUnchanged &&
  out.off.viewTitleName === 'none' &&
  out.reduced.effective === 'reduced' && out.reduced.fadeEnabled &&
  !out.reduced.moveEnabled && out.reduced.dataset === 'reduced' &&
  // 系统 reduce 只降级到 reduced，不再一票压成 off；显式 off 仍完全关闭
  out.systemReduce.effective === 'reduced' && out.systemReduce.intercepted &&
  out.appWins.effective === 'full' && out.systemReduce.matchMediaRestored &&
  out.fullForced.called && out.fullForced.vtDelta > 0 && out.fullForced.domUpdated &&
  out.layersOk &&
  (!out.light.skipped && out.light.query === 0 && out.light.stats === 0 &&
    out.light.smartCounts === 0 && out.light.renders === 0) &&
  out.restored.iconset && out.restored.iconsetRuntime &&
  out.restored.motion && out.restored.effective;
return out;
