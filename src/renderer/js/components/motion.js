'use strict';
/**
 * 动效统一入口 —— 所有新增动效都必须从这里过一遍。
 *
 * 设计契约（见 docs/11-界面美化与动效实施计划书.md §3）：
 *   1. 只动 transform / opacity；单次 ≤220ms；一次只表达一件事。
 *   2. 三档：full / reduced / off。系统「减少动态效果」会把档位降到最弱的
 *      reduced（去掉位移 / 转场 / 循环，只留纯 opacity 淡入），但不会把用户在
 *      应用里显式选的「完整」直接变成「无动效」；用户显式选 off 仍一票否决。
 *   3. off 档完全不调用 startViewTransition、不调用 element.animate()，
 *      CSS 侧也用 html[data-motion-effective="off"] 把新增 animation 全部短路。
 *   4. View Transitions 回调内禁止 await / IPC / 磁盘读取；卡片过多时直接跳过快照，
 *      避免几百张卡片参与截图掉帧。
 *   5. 不注册任何全局 MutationObserver / ResizeObserver。
 *
 * 诊断：window.__printshelfMotion（探针 probe-motion.js 读取）。
 */
import { state } from '../state.js';

const LEVELS = new Set(['full', 'reduced', 'off']);
const MAX_VT_CARDS = 150;
// 仅诊断用：probe-motion.js 通过 __printshelfMotionApi.withLevel() 临时强制档位，
// 不写 settings.json、不改用户偏好，fn 结束自动恢复。
let forcedLevel = null;
// 探针用：临时强制「跟随系统」开关，不写 settings.json
let forcedFollow = null;
const FALLBACK_EASE = 'cubic-bezier(.2, .7, .3, 1)';
// 与 base.css 的 --ease-ui 共用同一条曲线，避免 CSS 过渡与 WAAPI 动画节奏分家。
const EASE = (() => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ease-ui').trim();
    return v || FALLBACK_EASE;
  } catch (_) { return FALLBACK_EASE; }
})();

const diag = (typeof window !== 'undefined')
  ? (window.__printshelfMotion = {
    level: 'full', effective: 'full', vt: 0, vtFallback: 0,
    enter: 0, pulse: 0, lastReason: '',
  })
  : { level: 'full', effective: 'full', vt: 0, vtFallback: 0, enter: 0, pulse: 0, lastReason: '' };

/** 用户设置的档位；未设置 / 非法值一律按 full */
export function motionLevel() {
  const ui = (state.settings && state.settings.ui) || {};
  return LEVELS.has(ui.motionLevel) ? ui.motionLevel : 'full';
}

/** 系统无障碍偏好；浏览器不会自动关掉 View Transitions，必须自己读 */
export function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) { return false; }
}

/**
 * 实际生效档位。
 * 系统「减少动态效果」优先降到 reduced：既尊重无障碍偏好，又不会让界面完全失去
 * 反馈（reduced 档只保留纯 opacity 淡入，没有位移 / 转场 / 循环动画）。
 * 用户显式选择 off 时一律 off，优先级最高。
 * 本机实测该媒体查询会命中 reduce，若直接压成 off，应用内「完整」选项就等于摆设。
 */
/** 用户是否显式要求「跟随系统减少动态」；默认否，应用内档位优先 */
export function followSystemMotion() {
  if (forcedFollow !== null) return forcedFollow;
  const ui = (state.settings && state.settings.ui) || {};
  return ui.motionFollowSystem === true;
}

export function effectiveLevel() {
  if (forcedLevel) return forcedLevel;
  const level = motionLevel();
  if (level === 'off') return 'off';
  // 2026-11-19 改：系统「减少动态效果」只是建议，不再硬覆盖应用内选择。
  // 只有用户明确打开「跟随系统」时才降档，否则按应用内档位走。
  if (followSystemMotion() && prefersReducedMotion()) return 'reduced';
  return level;
}

/**
 * 某类动效是否允许。reduced 档只保留纯 opacity 淡入（kind='fade'）。
 * grid.js 的单卡反馈、app.js 的内容淡入都用它做入口短路。
 */
export function motionEnabled(kind = 'move') {
  const l = effectiveLevel();
  if (l === 'off') return false;
  if (l === 'reduced') return kind === 'fade';
  return true;
}

/** 把档位写到 <html>，CSS 靠这两个属性短路；bootstrap 与设置变更后都要调一次 */
export function applyMotionPrefs() {
  const root = document.documentElement;
  diag.level = motionLevel();
  diag.effective = effectiveLevel();
  root.dataset.motion = diag.level;
  root.dataset.motionEffective = diag.effective;
  return diag.effective;
}

/** 系统偏好变化时重新同步（只注册一个 matchMedia 监听，不是全局观察器） */
export function watchMotionPrefs() {
  try {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applyMotionPrefs();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  } catch (_) { /* 老版本 Electron 不支持监听时，bootstrap 时的读值仍生效 */ }
}

/**
 * 内容区/单卡的一次性淡入。用 WAAPI 而不是加 class：
 * 动画结束自动消失，不会在增量渲染复用的 DOM 节点上留下残留 class。
 */
export function enterView(el, opts = {}) {
  if (!el || typeof el.animate !== 'function') return null;
  const l = effectiveLevel();
  if (l === 'off' || !motionEnabled('fade')) return null;
  const reduced = l === 'reduced';
  const frames = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
      { opacity: 0, transform: 'translateY(' + (opts.distance || 6) + 'px)' },
      { opacity: 1, transform: 'translateY(0px)' },
    ];
  const duration = Math.min(220, Number(opts.duration) || (reduced ? 140 : 180));
  diag.enter++;
  return el.animate(frames, { duration, easing: EASE, fill: 'none' });
}

/** 状态反馈脉冲：成功轻微 scale，失败短促横向抖动；reduced 档只做透明度 */
export function pulse(el, kind = 'ok') {
  if (!el || typeof el.animate !== 'function') return null;
  const l = effectiveLevel();
  if (l === 'off') return null;
  let frames;
  let duration = 160;
  if (l === 'reduced') {
    frames = [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }];
    duration = 140;
  } else if (kind === 'error') {
    frames = [
      { transform: 'translateX(0px)', opacity: 1 },
      { transform: 'translateX(-4px)', opacity: 0.85 },
      { transform: 'translateX(3px)', opacity: 0.92 },
      { transform: 'translateX(0px)', opacity: 1 },
    ];
    duration = 200;
  } else {
    frames = [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.06)', opacity: 0.9 },
      { transform: 'scale(1)', opacity: 1 },
    ];
  }
  diag.pulse++;
  return el.animate(frames, { duration, easing: EASE, fill: 'none' });
}

/**
 * 视图切换转场。update 必须是**同步**的 DOM 更新函数，回调内不得 await。
 *
 * 降级路径（都直接 update，不产生任何动画）：
 *   - off 档 / 系统 reduce
 *   - 浏览器不支持 startViewTransition
 *   - 当前卡片数超过 maxCards（避免整页快照掉帧）
 *   - reduced 档（只补一次内容淡入，由调用方传 enterEl）
 *   - startViewTransition 抛错（例如上一次转场还没结束）
 */
export function withViewTransition(update, opts = {}) {
  diag.lastReason = opts.reason || '';
  applyMotionPrefs();
  const l = diag.effective;
  const fallback = (why) => {
    diag.vtFallback++;
    diag.lastReason = why;
    update();
    if (opts.enterEl && motionEnabled('fade')) enterView(opts.enterEl);
    return null;
  };
  if (l === 'off') return fallback('off');
  if (typeof document.startViewTransition !== 'function') return fallback('unsupported');
  const max = Number.isFinite(opts.maxCards) ? opts.maxCards : MAX_VT_CARDS;
  const cards = document.querySelectorAll('#content .card').length;
  if (cards > max) return fallback('too-many-cards');
  if (l === 'reduced') return fallback('reduced');

  let scheduled = false;
  let transition;
  try {
    transition = document.startViewTransition(() => { scheduled = true; update(); });
  } catch (_) {
    // 抛错时回调没有执行过，这里补一次，保证 DOM 一定被更新
    if (scheduled) return null;
    return fallback('throw');
  }
  diag.vt++;
  const before = document.activeElement;
  Promise.resolve(transition.updateCallbackDone).then(() => {
    // 转场把焦点元素换掉时，落回主搜索框而不是让焦点掉到 body
    if (before && before.isConnected === false) {
      const target = document.getElementById('search-input');
      if (target) target.focus({ preventScroll: true });
    }
  }).catch(() => {});
  // 快速连续切换时 finished 可能 reject，吞掉以免 unhandled rejection
  Promise.resolve(transition.finished).catch(() => {});
  return transition;
}

/** 供探针读取，不参与业务逻辑 */
export function motionDiag() {
  return { ...diag, supportsVT: typeof document.startViewTransition === 'function' };
}

/** 仅探针：在 fn 执行期间强制某个档位，结束自动恢复。不触碰 settings.json。 */
function withFollowSystem(v, fn) {
  const prev = forcedFollow;
  forcedFollow = (v === true) ? true : (v === false ? false : null);
  try { return fn(); } finally { forcedFollow = prev; }
}

function withLevel(level, fn) {
  const prev = forcedLevel;
  forcedLevel = LEVELS.has(level) ? level : null;
  try { return fn(); } finally { forcedLevel = prev; }
}

if (typeof window !== 'undefined') {
  window.__printshelfMotionApi = {
    level: motionLevel,
    effective: effectiveLevel,
    enabled: motionEnabled,
    prefersReduced: prefersReducedMotion,
    withLevel,
    withFollowSystem,
    followSystem: followSystemMotion,
    withViewTransition,
    enterView,
    pulse,
    applyMotionPrefs,
    motionDiag,
  };
}
