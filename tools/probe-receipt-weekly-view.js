/** 走查截图：打印回执页右上角的「本周周报」按钮。 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    try { if (fn()) return true; } catch (_) { /* 继续等 */ }
    await sleep(120);
  }
  return false;
};
q('#sidebar [data-smart="printed"]').click();
await until(() => q('.rc-summary'), 10000);
await sleep(500);
return { weekly: !!q('[data-act="rc-weekly"]'), summary: !!q('.rc-summary') };
