/**
 * 中英切换按钮走查（只读探针本身不改数据）：点击后立刻返回。
 * 真实按钮会在设置落盘 80ms 后触发主进程 reload，重载会销毁脚本上下文；
 * 因此这里用 5ms 轮询抢在重载前读到 localStorage 并立即返回。
 *   node launch.js --capture=data/i18n-switch.png --ui-script=tools/probe-i18n-switch.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step = 120) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
const q = (s) => document.querySelector(s);
await waitFor(() => q('#btn-language') && !q('#boot-splash'), 15000);
const btn = q('#btn-language');
if (!btn) return { ok: false, error: 'language button not found' };

const before = q('#lang-label') ? q('#lang-label').textContent.trim() : '';
const next = before === 'EN' ? 'zh-CN' : 'en-US';
const readStored = () => {
  try { return localStorage.getItem('printshelf-language'); } catch (_) { return null; }
};

btn.click();
const stored = await waitFor(() => (readStored() === next ? readStored() : null), 3000, 5);
const label = q('#lang-label') ? q('#lang-label').textContent.trim() : '';
const expectedLabel = next === 'en-US' ? 'EN' : '中';

return {
  ok: (before === '中' || before === 'EN') && stored === next && label === expectedLabel,
  before,
  stored,
  label,
  expectedLabel,
};
