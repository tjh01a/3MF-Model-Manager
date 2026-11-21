/**
 * 走查探针：交互反馈在三档动效下的表现（2026-11-19）。
 * 断言的是「计算样式」，不是视觉截图：
 *   full    → 按钮有 transform 过渡 + 统计数字跑 stat-bump
 *   reduced → 按钮用 opacity 反馈（无位移）+ 统计数字只闪颜色（stat-flash）
 *   off     → 两者都不新增动画
 *   node launch.js --capture=data/reg/motion-feedback.png --ui-script=tools/probe-motion-feedback.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(100);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const api = window.__printshelfMotionApi;
const out = {};

const btn = await waitFor(() => q('#btn-settings') || q('.btn'), 8000);
const stat = await waitFor(() => q('#stats-cells .stat .stat-value'), 8000);
if (!btn || !stat) return { ok: false, error: '缺少按钮或统计条' };

function read(level) {
  return api.withLevel(level, () => {
    api.applyMotionPrefs();
    const bs = getComputedStyle(btn);
    // 在统计数字的父节点上临时加 bump，读它真正会跑哪个动画
    const cell = stat.parentElement;
    cell.classList.add('bump');
    const ss = getComputedStyle(stat);
    const r = {
      dataset: document.documentElement.dataset.motionEffective,
      btnTransform: bs.transitionProperty.includes('transform'),
      btnOpacity: bs.transitionProperty.includes('opacity'),
      btnTransformDur: bs.transitionDuration,
      btnDurSec: parseFloat(bs.transitionDuration) || 0,
      statAnim: ss.animationName,
    };
    cell.classList.remove('bump');
    return r;
  });
}

try {
  out.full = read('full');
  out.reduced = read('reduced');
  out.off = read('off');
} finally {
  // 不管成败都恢复真实档位，别把界面留在强制状态
  api.applyMotionPrefs();
}
await sleep(150);
out.restored = document.documentElement.dataset.motionEffective;

out.checks = {
  fullHasTransform: out.full.btnTransform === true,
  // 系统开了「减少动态效果」但应用选完整时，CSS 时长不能被全局规则压成 0
  fullHasRealDuration: out.full.btnDurSec >= 0.05,
  fullStatBump: out.full.statAnim === 'stat-bump',
  reducedUsesOpacity: out.reduced.btnOpacity === true && out.reduced.btnTransform === false,
  reducedStatFlash: out.reduced.statAnim === 'stat-flash',
  offNoAnim: out.off.statAnim === 'none',
};
out.ok = Object.values(out.checks).every(Boolean);
return out;
