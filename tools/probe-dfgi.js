/**
 * 走查探针 D/F/G/I：库存 / 自然语言搜索 / 以图搜图 / 周报·成就·护照
 *
 *   node tools/probe-bca-prepare.js %TEMP%/ps-probe-dfgi
 *   set PRINTSHELF_DATA_DIR=%TEMP%/ps-probe-dfgi
 *   node launch.js --capture=%TEMP%/probe-dfgi.png --ui-script=tools/probe-dfgi.js
 *
 * 只读临时库；会新建一个耗材并在最后把 ui 设置写回。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    try { if (fn()) return true; } catch (_) { /* 继续等 */ }
    await sleep(120);
  }
  return false;
};
const esc = (e) => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); };

const out = { ok: [], bad: [], info: {}, errors: [] };
const ok = (cond, msg) => { (cond ? out.ok : out.bad).push(msg); };
window.addEventListener('error', (e) => out.errors.push(String((e && e.message) || e)));
window.addEventListener('unhandledrejection', (e) => out.errors.push('rejection: ' + String(e && e.reason)));

const s0 = await window.shelf.settings();
const ui0 = JSON.parse(JSON.stringify((s0 && s0.ui) || {}));

try {
  await until(() => q('#sidebar') && (q('#content .card') || q('#content .empty')), 15000);

  // ---------- D · 库存 ----------
  const f = await window.shelf.filamentCreate({
    kind: 'owned', name: '探针 PLA 白', type: 'PLA', color: '#f2f2f2',
    pricePerKg: 99, stockG: 620, fullG: 1000,
  });
  await window.shelf.stockAdjust({ filamentId: f.id, stockG: 620, addSpools: 1 });
  out.info.stock = await window.shelf.stockStatus(f.id);
  ok(out.info.stock && out.info.stock.stockG === 620, '库存写入 620g');
  ok(out.info.stock && out.info.stock.spools === 1, '备用卷 +1');
  const shop = await window.shelf.stockShoppingList();
  ok(shop && Array.isArray(shop.items), '采购清单接口可用');

  q('#btn-filaments').click();
  const fid = out.info.stock.id;
  await until(() => q('.inv-row[data-id="' + fid + '"]'), 10000);
  const card = q('.inv-row[data-id="' + fid + '"]');
  card.click();
  await until(() => q('[data-field="stockG"]') && q('[data-field="stockG"]').value === '620', 8000);
  ok(!!card && !!card.querySelector('.inv-bar'), '库存表显示剩余进度条');
  ok(card && /620/.test(card.textContent), '库存表显示约剩 620g');
  const sinput = q('[data-field="stockG"]');
  ok(!!sinput && sinput.value === '620', '详情里有剩余克数输入框且值正确');
  ok(!!q('[data-tab="catalog"]'), '耗材管理里有「耗材库」选购参考 tab');
  const rowsBefore = document.querySelectorAll('.inv-row').length;
  q('[data-act="new-owned"]').click();
  await until(() => q('.modal [data-role="name"]'), 6000);
  ok(!!q('.modal [data-role="name"]') && !!q('.modal [data-role="stockG"]'), '「添加耗材」弹窗含名称与克数字段');
  if (q('.modal [data-role="name"]')) {
    q('.modal [data-role="name"]').value = 'UI 添加的 PETG';
    q('.modal [data-role="price"]').value = '88';
    q('.modal [data-role="stockG"]').value = '500';
    q('.modal [data-role="type"]').value = 'PETG';
    q('.modal .modal-foot .btn-primary').click();
    await until(() => document.querySelectorAll('.inv-row').length > rowsBefore, 8000);
    ok(document.querySelectorAll('.inv-row').length > rowsBefore, '从弹窗添加后库存表多一行');
    ok(!!q('.inv-row.is-selected') && /UI 添加的 PETG/.test(q('.inv-row.is-selected').textContent), '新增耗材自动选中');
  }
  esc(); await sleep(300);
  q('#filaments-close').click();
  await sleep(300);

  // ---------- F · 自然语言搜索 ----------
  const inp = q('#search-input');
  inp.value = '上个月打印过的绿色收纳盒';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => qa('#filter-chips .chip').length >= 2, 8000);
  const chips = qa('#filter-chips .chip').map((c) => c.textContent);
  out.info.chips = chips;
  ok(chips.some((c) => /打印时间/.test(c)), '生成「打印时间」筛选标签');
  ok(chips.some((c) => /颜色/.test(c)), '生成「颜色」筛选标签');

  // ---------- G · 以图搜图 ----------
  ok(!!q('#btn-img-search'), '搜索框旁有「以图搜图」按钮');
  const hs = await window.shelf.imgHashStatus();
  ok(hs && typeof hs.total === 'number' && typeof hs.pending === 'number', '指纹索引导出状态');

  // ---------- I · 周报（打印回执页） / 成就（设置） ----------
  q('#sidebar [data-smart="printed"]').click();
  await until(() => q('.rc-summary'), 8000);
  ok(!!q('[data-act="rc-weekly"]'), '打印回执页右上角有「本周周报」按钮');
  q('[data-act="rc-weekly"]').click();
  await until(() => q('.wk-grid'), 6000);
  ok(qa('.wk-kpi').length >= 6, '周报弹窗有 6 个 KPI');
  esc(); await sleep(400);

  q('#sidebar [data-smart="all"]').click();
  q('#btn-settings').click();
  await until(() => q('#settings-content .settings-nav, #settings-nav'), 6000);
  const navData = q('#settings-nav [data-tab="data"]');
  ok(!!navData, '设置页有「数据管理」标签');
  if (navData) navData.click();
  await until(() => q('[data-act="achievements"]'), 6000);
  q('[data-act="achievements"]').click();
  await until(() => q('.ach-grid'), 6000);
  out.info.achCards = qa('.ach-card').length;
  ok(out.info.achCards >= 10, '成就弹窗列出全部成就（实际 ' + out.info.achCards + '）');
  esc(); await sleep(400);
  q('#settings-close, #btn-settings-close, .settings-close').click();
  await sleep(400);

  // 清掉前面 NL 搜索的筛选，回到全库再开详情
  if (q('#btn-clear-filters')) q('#btn-clear-filters').click();
  await until(() => q('#content .card'), 6000);

  // ---------- I · 护照小节 ----------
  const first = q('#content .card');
  if (first) {
    first.click();
    await until(() => q('#detail-passport') && !q('#detail-passport').hidden, 8000);
    ok(q('#detail-passport') && !q('#detail-passport').hidden, '详情出现「模型护照」小节');
    ok(/模型护照/.test((q('#detail-passport') || {}).textContent || ''), '护照小节标题正确');
  } else {
    out.bad.push('没有模型卡片，跳过护照走查');
  }
} catch (e) {
  out.errors.push(String((e && e.stack) || e));
} finally {
  try { await window.shelf.settingsUpdate({ ui: ui0 }); } catch (_) { /* 忽略 */ }
}

out.okCount = out.ok.length;
out.badCount = out.bad.length;
return out;
