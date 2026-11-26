/**
 * 中英切换按钮走查（只读探针本身不改数据）：点击后立刻返回。
 * 重载会销毁脚本上下文，所以「重载后是否英文」请用 tools/probe-i18n.js 在下次启动时验证；
 * 本探针只证明按钮触发了设置落盘。
 *   node launch.js --capture=data/i18n-switch.png --ui-script=tools/probe-i18n-switch.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
await waitFor(() => q('#btn-language') && !q('#boot-splash'), 15000);
const before = q('#lang-label') ? q('#lang-label').textContent.trim() : '';
q('#btn-language').click();
await sleep(600);
return {
  ok: before === '中' || before === 'EN',
  before,
  stored: (() => { try { return localStorage.getItem('printshelf-language'); } catch (_) { return null; } })(),
};
