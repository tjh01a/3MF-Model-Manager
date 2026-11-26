/** 走查截图：「添加耗材」弹窗。 */
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
await until(() => q('.inv-row'), 10000);
q('[data-act="new-owned"]').click();
await until(() => q('.modal [data-role="name"]'), 8000);
await sleep(400);
return { fields: document.querySelectorAll('.modal .fil-field').length, hasFoot: !!q('.modal .modal-foot .btn-primary') };
