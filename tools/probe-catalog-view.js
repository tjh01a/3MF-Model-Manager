/** 走查截图：耗材库（选购参考）tab 不再显示库存字段。 */
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
q('#btn-filaments').click();
await until(() => q('[data-tab="catalog"]'), 10000);
q('[data-tab="catalog"]').click();
await until(() => q('.fil-card'), 8000);
await sleep(400);
return {
  cards: document.querySelectorAll('.fil-card').length,
  hasStockField: !!q('[data-field="stockG"]'),
  title: (q('.fil-head h2') || {}).textContent || '',
};
