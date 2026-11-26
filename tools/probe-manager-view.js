/**
 * 走查截图：耗材管理默认停在「耗材库存」tab，并保留一个在库耗材。
 *   node tools/probe-bca-prepare.js %TEMP%/ps-probe-manager-view
 *   set PRINTSHELF_DATA_DIR=%TEMP%/ps-probe-manager-view
 *   node launch.js --capture=%TEMP%/probe-manager-view.png --ui-script=tools/probe-manager-view.js
 */
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
await window.shelf.filamentCreate({
  kind: 'owned', name: '拓竹 PLA Basic 白', type: 'PLA', color: '#f5f5f4',
  brand: 'Bambu 拓竹', pricePerKg: 129, stockG: 860, fullG: 1000, spools: 1,
});
await window.shelf.filamentCreate({
  kind: 'owned', name: 'eSUN PETG 黑', type: 'PETG', color: '#222222',
  brand: 'eSUN 易生', pricePerKg: 79, stockG: 180, fullG: 1000,
});
q('#btn-filaments').click();
await until(() => q('.inv-row'), 10000);
q('.inv-row').click();
await sleep(600);
return { rows: document.querySelectorAll('.inv-row').length, tabs: document.querySelectorAll('.fil-tab').length };
