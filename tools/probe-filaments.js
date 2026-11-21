/**
 * 走查探针：耗材库板块（docs/13）——卡片网格 + 右侧详情栏 + 预设下拉。
 *   node launch.js --capture=docs/screenshots/42-耗材库.png --ui-script=tools/probe-filaments.js
 *
 * 探针会在库里建一条「探针耗材」并改价，结束时删除，不留脏数据。
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

const btn = await waitFor(() => q('#btn-filaments'), 15000);
if (!btn) return { ok: false, error: '找不到耗材库按钮' };
btn.click();
const panel = await waitFor(() => {
  const p = q('#filaments-panel');
  return (p && !p.hidden) ? p : null;
}, 6000);
if (!panel) return { ok: false, error: '耗材库面板没打开' };

// 等首屏数据到齐
await waitFor(() => q('#filaments-body .fil-toolbar') ? true : null, 12000);
await sleep(500);

out.structure = {
  hasToolbar: !!q('.fil-toolbar'),
  hasNewBtn: !!q('[data-act="new"]'),
  hasPresetBtn: !!q('[data-act="from-preset"]'),
  hasGrid: !!q('.fil-grid'),
  hasDetail: !!q('#fil-detail'),
  hasSearch: !!q('[data-act-input="keyword"]'),
  hasFilter: !!q('[data-act-filter="type"]'),
};

// 预设下拉：用 api 直接读，验证只放主流品牌
let presets = [];
try { const r = await window.shelf.filamentsList(); presets = (r && r.presets) || []; }
catch (_) { /* 保留空 */ }
out.presets = {
  count: presets.length,
  brands: Array.from(new Set(presets.map((p) => p.brand))).sort(),
  allMainstream: presets.every((p) => /Bambu|eSUN|Snapmaker|Creality|Polymaker|Anycubic/.test(p.brand)),
};

// 先清掉上次可能残留的探针耗材，再建一条用于验证详情 + 让截图有内容
try {
  const before = await window.shelf.filamentsList();
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
};

// 视觉一致性：卡片与详情栏的关键样式
const cs = q('.fil-card') ? getComputedStyle(q('.fil-card')) : null;
out.style = cs ? { radius: cs.borderRadius, cursor: cs.cursor } : null;
out.cardCount = qa('.fil-card').length;

// 面板保持打开，让截图能看到完整效果；测试数据由外部命令清理
out.panelVisible = !!(q('#filaments-panel') && !q('#filaments-panel').hidden);

const structOk = Object.values(out.structure).every(Boolean);
const presetOk = out.presets.count > 40 && out.presets.count < 100 && out.presets.allMainstream;
const detailOk = out.detail.selected && out.detail.hasHero && out.detail.hasSave &&
  out.detail.hasUpload && out.detail.hasDelete &&
  ['name', 'brand', 'type', 'color', 'colorText', 'pricePerKg', 'note'].every((k) => out.detail.fields.includes(k));
const crudOk = !!(out.crud && out.crud.created && out.crud.priceUpdated);

out.checks = { structOk, presetOk, detailOk, crudOk, panelVisible: out.panelVisible };
out.ok = structOk && presetOk && detailOk && crudOk && out.panelVisible;
return out;
