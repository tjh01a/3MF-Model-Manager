/**
 * 走查探针：向导已完成时，下次启动不应再弹（docs/16）。
 * 与 probe-onboarding.js 共用同一个数据目录，顺序执行：
 *   PRINTSHELF_DATA_DIR=<dir> node launch.js --no-seed ... --ui-script=tools/probe-onboarding.js
 *   PRINTSHELF_DATA_DIR=<dir> node launch.js --no-seed ... --ui-script=tools/probe-onboarding-relaunch.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await window.shelf.settings();
const ob = (s && s.onboard) || {};
// 给界面一点时间：万一逻辑有 bug，弹窗会在 bootstrap 后几百毫秒内出现
await sleep(1200);
const el = document.querySelector('#onboarding');
const visible = !!(el && !el.hidden);

return {
  onboard: { done: ob.done, skipped: ob.skipped, at: ob.at },
  wizardVisible: visible,
  ok: ob.done === true && visible === false,
};
