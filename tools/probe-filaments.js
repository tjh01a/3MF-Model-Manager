/**
 * 走查探针：耗材库板块（docs/13）——卡片网格 + 右侧详情栏 + 默认耗材。
 *   node launch.js --capture=<png> --ui-script=tools/probe-filaments.js
 *
 * 验证：
 *  1. 预设添加入口已移除，只保留「新建耗材」
 *  2. 「全部类型」筛选下拉点击后不会被 render 销毁（change 事件处理）
 *  3. 默认耗材：设为默认 → 卡片出现「默认」角标；取消默认 → 角标消失
 *  4. 详情栏字段齐全，CRUD 正常
 *
 * 数据安全（P0）：写接口仅在完整快照 + finally 恢复的保护下调用。
 *  - 只读快照：现有耗材 id 列表 + 原始默认耗材 id；
 *  - 不删除任何既有耗材（旧版会清掉 __探针耗材 前缀的既有记录，已废除）；
 *  - 只创建 1 个带时间戳的临时耗材，finally 中删除它并把默认耗材还原到原值；
 *  - 恢复后校验 id 集合与默认耗材完全一致，任何不一致都让 ok=false。
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

// 被 catch 后只弹红字、不进 window.onerror 的运行时错误，视为探针失败
const toastErrors = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!n || n.nodeType !== 1) continue;
      const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
      if (!bad) continue;
      const msg = bad.querySelector('.toast-message');
      toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
    }
  }).observe(toastBox, { childList: true });
}

const btn = await waitFor(() => q('#btn-filaments'), 15000);
if (!btn) { out.ok = false; out.error = '找不到耗材库按钮'; out.toastErrors = toastErrors; return out; }
btn.click();
const panel = await waitFor(() => {
  const p = q('#filaments-panel');
  return (p && !p.hidden) ? p : null;
}, 6000);
if (!panel) { out.ok = false; out.error = '耗材库面板没打开'; out.toastErrors = toastErrors; return out; }

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

// ---- 写前快照（只读） ----
let snap = null;
try {
  const before = await window.shelf.filamentsList();
  snap = {
    ids: ((before && before.items) || []).map((f) => f.id).sort(),
    defaultId: (before && before.defaultId) || null,
  };
} catch (e) {
  out.ok = false;
  out.error = '无法读取耗材快照，放弃写入：' + ((e && e.message) || String(e));
  out.toastErrors = toastErrors;
  return out;
}
out.originalCount = snap.ids.length;

// 恢复函数：删除本次创建的临时耗材 + 还原默认耗材，并校验 id 集合与默认值完全一致
async function restore() {
  const errs = [];
  for (const id of createdIds) {
    try { await window.shelf.filamentRemove(id); } catch (e) { errs.push((e && e.message) || String(e)); }
  }
  try { await window.shelf.filamentSetDefault(snap.defaultId); } catch (e) { errs.push((e && e.message) || String(e)); }
  let now = null;
  try { now = await window.shelf.filamentsList(); } catch (e) { errs.push((e && e.message) || String(e)); }
  const nowIds = ((now && now.items) || []).map((f) => f.id).sort();
  const idsMatch = JSON.stringify(nowIds) === JSON.stringify(snap.ids);
  const defaultMatch = !!now && ((now.defaultId) || null) === snap.defaultId;
  return { ok: !errs.length && idsMatch && defaultMatch, idsMatch, defaultMatch, errors: errs };
}

const createdIds = [];
let restoreResult = null;
try {
  const created = await window.shelf.filamentCreate({
    name: '__探针耗材·' + Date.now().toString(36) + '__', brand: 'Bambu 拓竹', type: 'PLA', color: '#f6f6f6', pricePerKg: 120,
  });
  const testId = created && created.id;
  if (testId) createdIds.push(testId);
  const updated = testId ? await window.shelf.filamentUpdate(testId, { pricePerKg: 128 }) : null;
  out.crud = { created: !!testId, priceUpdated: !!(updated && updated.pricePerKg === 128) };
  await sleep(600);

  // 筛选下拉：点一下不应导致面板重绘把 select 干掉
  const filter = q('[data-act-filter="type"]');
  out.filterAliveAfterClick = !!filter;
  if (filter) {
    filter.value = 'PLA';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    out.filterWorks = !!q('[data-act-filter="type"]') &&
      qa('.fil-card').every((c) => {
        const id = c.dataset.id;
        return !!qa('#filaments-body .fil-card').find((x) => x.dataset.id === id);
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
} finally {
  // 无论断言成败或中途异常，都先恢复数据
  restoreResult = await restore();
}

out.restored = restoreResult.ok;
out.restoreDetail = { idsMatch: restoreResult.idsMatch, defaultMatch: restoreResult.defaultMatch, errors: restoreResult.errors };
await sleep(300);

const cs = q('.fil-card') ? getComputedStyle(q('.fil-card')) : null;
out.style = cs ? { radius: cs.borderRadius, cursor: cs.cursor } : null;
out.panelVisible = !!(q('#filaments-panel') && !q('#filaments-panel').hidden);

const structOk = Object.values(out.structure).every(Boolean);
const detailOk = out.detail && out.detail.selected && out.detail.hasHero && out.detail.hasSave &&
  out.detail.hasUpload && out.detail.hasDelete && out.detail.hasSetDefault &&
  ['name', 'brand', 'type', 'color', 'colorText', 'pricePerKg', 'note'].every((k) => out.detail.fields.includes(k));
const crudOk = !!(out.crud && out.crud.created && out.crud.priceUpdated);
out.checks = {
  structOk, noPresetEntry: out.noPresetEntry, filterAliveAfterClick: out.filterAliveAfterClick,
  filterWorks: !!out.filterWorks, detailOk: !!detailOk, crudOk,
  defaultOn: !!out.defaultOn, defaultOff: !!out.defaultOff, restored: restoreResult.ok,
};
out.toastErrors = Array.from(new Set(toastErrors));
// 恢复失败一律不通过（即使功能断言全绿）
out.ok = restoreResult.ok && !out.toastErrors.length && structOk && out.noPresetEntry &&
  out.filterAliveAfterClick && !!out.filterWorks && !!detailOk && crudOk &&
  !!out.defaultOn && !!out.defaultOff && out.panelVisible;
if (!restoreResult.ok) out.error = '耗材数据恢复失败，禁止判定通过';
return out;
