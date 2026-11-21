/**
 * 走查探针：启动动画是否出现、是否按预期结束、结束后是否完全不挡界面。
 *   node launch.js --capture=out.png --ui-script=tools/probe-boot.js
 *
 * 注意：探针在页面加载数秒后才执行，此时动画早已淡出；通过 window.__printshelfBoot
 * 记录的起止时间/原因 + DOM 残留检查来还原整个过程，并验证异常路径幂等。
 */
const q = (s) => document.querySelector(s);
const boot = window.__printshelfBoot || null;
const api = window.__printshelfBootApi || null;
const out = { boot, apiAvailable: !!api };

if (!boot) return { ok: false, error: '启动动画控制器没有加载', ...out };

out.durationMs = (boot.endedAt || 0) - boot.startedAt;
out.stages = Array.isArray(boot.stages) ? boot.stages.slice() : [];
out.finalStage = boot.stage || '';
out.stageApiAvailable = !!(api && typeof api.setStage === 'function');
out.splashNodeGone = !q('#boot-splash');
out.cssFallback = Array.from(document.querySelectorAll('style'))
  .some((s) => /boot-autohide/.test(s.textContent || ''));
out.backendGate = !(window.shelf && typeof window.shelf.whenReady === 'function') ? 'absent' : 'present';
out.mainRendered = {
  cards: q('#content') ? q('#content').children.length : -1,
  navItems: q('#nav-library') ? q('#nav-library').children.length : -1,
  hasToggle: !!q('#sidebar-toggle'),
};
// 屏幕中心必须能点到主界面，不能被任何残留遮罩挡住
const center = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
out.centerTop = center ? (center.id || center.className || center.tagName) : null;
out.centerUnblocked = !!center && !center.closest('#boot-splash, .drag-mask, .overlay:not([hidden])');

// 异常路径：重复触发「失败」不能把动画重新拉回来，也不能改写结束原因
if (api) {
  api.bootFailed('probe-error');
  out.afterFailure = api.bootStatus();
  api.finishBoot('probe-ready');
  out.afterSecondFinish = api.bootStatus();
}

out.ok =
  boot.visible === false && boot.removed === true &&
  /^(ready|error|timeout|bootstrap|mount|pagehide)$/.test(boot.reason || '') &&
  out.durationMs >= 0 && out.durationMs < 12000 &&
  out.stageApiAvailable && out.stages.length > 0 && out.finalStage === 'paint' &&
  out.splashNodeGone && out.cssFallback &&
  out.mainRendered.cards > 0 && out.mainRendered.navItems > 0 &&
  out.mainRendered.hasToggle && out.centerUnblocked &&
  (!api || (out.afterFailure.reason === boot.reason && !out.afterFailure.visible &&
            out.afterSecondFinish.reason === boot.reason));
return out;
