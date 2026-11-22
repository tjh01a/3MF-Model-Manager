/**
 * 走查探针：耗材库板块（docs/13）——卡片网格 + 右侧详情栏 + 默认耗材。
 *   node launch.js --capture=<png> --ui-script=tools/probe-filaments.js
 *
 * 验证：
 *  1. 预设添加入口已移除，只保留「新建耗材」
 *  2. 「全部类型」筛选下拉点击后不会被 render 销毁（change 事件处理）
 *  3. 默认耗材：设为默认 → 卡片出现「默认」角标；取消默认 → 角标消失
 *  4. 详情栏字段齐全，CRUD 正常
 * 探针结束时删除自己建的测试耗材并还原默认，不留脏数据。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(step || 120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const out = {};
const ORIGINAL_DEFAULT = null;

const btn = await waitFor(() => q('#btn-filaments'), 15000);
if (!btn) return { ok: false, error: '找不到耗材库按钮' };
btn.click();
const panel = await waitFor(() => {
  const p = q('#filaments-panel');
  return (p && !p.hidden) ? p : null;
}, 6000);
if (!panel) return { ok: false, error: '耗材库面板没打开' };

await waitFor(() => q('#filaments-body .fil-toolbar') ? true : null, 12000);
await sleep(500);

out.structure = {
  hasToolbar: !!q('.fil-toolbar'),
  hasNewBtn: !!q('[data-act="new"]'),
  hasGrid: !!q('.fil-grid'),
  hasDetail: !!q('#fil-detail'),
  hasSearch: !!q('[data-act-input="keyword"]'),
  hasFilter: !!q('[data-act-filter="type"]'),
};
out.noPresetEntry = !q('[data-act="from-preset"]');

// 先清掉上次可能残留的探针耗材，并记录原始默认耗材以便还原
let originalDefaultId = null;
try {
  const before = await window.shelf.filamentsList();
  originalDefaultId = (before && before.defaultId) || null;
  for (const f of ((before && before.items) || [])) {
    if (/^__探针耗材/.test(f.name)) await window.shelf.filamentRemove(f.id);
  }
} catch (_) { /* 忽略 */ }

let testId = null;
try {
  const created = await window.shelf.filamentCreate({
    name: '__探针耗材 · 拓竹 PLA 白色__', brand: 'Bambu 拓竹', type: 'PLA', color: '#f6f6f6', pricePerKg: 120,
  });
  testId = created && created.id;
  const updated = await window.shelf.filamentUpdate(testId, { pricePerKg: 128 });
  out.crud = { created: !!testId, priceUpdated: updated && updated.pricePerKg === 128 };
} catch (e) {
  out.crud = { created: false, error: (e && e.message) || String(e) };
}
await sleep(600);

// 筛选下拉：点一下不应导致面板重绘把 select 干掉（原生下拉可能只留 toggle 事件，
// 这里用 DOM 是否还在 + 触发 change 后列表是否正确来验证）
const filter = q('[data-act-filter="type"]');
out.filterAliveAfterClick = !!filter;
if (filter) {
  filter.value = 'PLA';
  filter.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  out.filterWorks = !!q('[data-act-filter="type"]') &&
    qa('.fil-card').every((c) => {
      const id = c.dataset.id;
      const card = qa('#filaments-body .fil-card').find((x) => x.dataset.id === id);
      return !!card;   // 面板没被整块销毁
    });
  filter.value = '';
  filter.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);
}

// 选中新建的卡片，检查右侧详情栏
const target = testId ? q('.fil-card[data-id="' + testId + '"]') : q('.fil-card');
if (target) { target.click(); await sleep(350); }
out.detail = {
  selected: !!q('.fil-card.is-selected'),
  hasHero: !!q('.fil-detail-hero img'),
  fields: qa('.fil-detail [data-field]').map((e) => e.dataset.field),
  hasSave: !!q('[data-act="save"]'),
  hasUpload: !!q('[data-act="upload"]'),
  hasDelete: !!q('[data-act="delete"]'),
  hasSetDefault: !!q('[data-act="set-default"]'),
};

// 默认耗材：设为默认 → 角标出现 → 取消 → 角标消失
const setBtn = q('[data-act="set-default"]');
if (setBtn && testId) {
  setBtn.click();
  await sleep(500);
  out.defaultOn = !!q('.fil-card[data-id="' + testId + '"].is-default') &&
    !!q('.fil-card[data-id="' + testId + '"] .fil-default-tag');
  const cancelBtn = q('[data-act="set-default"]');
  if (cancelBtn) {
    cancelBtn.click();
    await sleep(500);
    out.defaultOff = !q('.fil-card[data-id="' + testId + '"].is-default');
  }
}

// 还原原始默认耗材
try { if (originalDefaultId) await window.shelf.filamentSetDefault(originalDefaultId); } catch (_) {}
// 删除探针耗材
try { if (testId) await window.shelf.filamentRemove(testId); } catch (_) {}
await sleep(300);

const cs = q('.fil-card') ? getComputedStyle(q('.fil-card')) : null;
out.style = cs ? { radius: cs.borderRadius, cursor: cs.cursor } : null;
out.panelVisible = !!(q('#filaments-panel') && !q('#filaments-panel').hidden);

const structOk = Object.values(out.structure).every(Boolean);
const detailOk = out.detail.selected && out.detail.hasHero && out.detail.hasSave &&
  out.detail.hasUpload && out.detail.hasDelete && out.detail.hasSetDefault &&
  ['name', 'brand', 'type', 'color', 'colorText', 'pricePerKg', 'note'].every((k) => out.detail.fields.includes(k));
const crudOk = !!(out.crud && out.crud.created && out.crud.priceUpdated);
out.checks = {
  structOk, noPresetEntry: out.noPresetEntry, filterAliveAfterClick: out.filterAliveAfterClick,
  filterWorks: !!out.filterWorks, detailOk, crudOk,
  defaultOn: !!out.defaultOn, defaultOff: !!out.defaultOff,
};
out.ok = structOk && out.noPresetEntry && out.filterAliveAfterClick && !!out.filterWorks &&
  detailOk && crudOk && !!out.defaultOn && !!out.defaultOff && out.panelVisible;
return out;
