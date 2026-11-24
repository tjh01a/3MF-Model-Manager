// 走查：耗材参数字段可填写、保存、重进仍在
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
await window.shelf.whenReady();
await sleep(600);

const btn = q('#btn-filaments');
if (!btn) return { ok: false, error: 'no filaments button' };
btn.click();
await sleep(1000);

const root = q('#filaments-body');
if (!root) return { ok: false, error: 'no detail root' };

// 找第一条卡片选中
const card = q('#filaments-body .fil-card');
if (!card) return { ok: false, error: 'no filament card' };
card.click();
await sleep(600);

const ta = q('#filaments-panel [data-field="params"]');
const hintGone = !q('#filaments-panel .fil-hint');
if (!ta) return { ok: false, error: 'no params textarea', hintGone };
tout_label = (ta.closest('.fil-field') || {}).textContent || '';
ta.value = '打印温度 220°C / 热床 60°C';
ta.dispatchEvent(new Event('input', { bubbles: true }));

const saveBtn = q('#filaments-panel [data-act="save"]');
saveBtn.click();
await sleep(1200);

// 切走再切回，验证持久化
const close = q('#filaments-close');
if (close) { close.click(); await sleep(400); }
const reopen = q('#btn-filaments');
if (reopen) { reopen.click(); await sleep(900); }
const card2 = q('#filaments-body .fil-card');
if (card2) { card2.click(); await sleep(600); }
const ta2 = q('#filaments-panel [data-field="params"]');
return {
  ok: ta2 && ta2.value === '打印温度 220°C / 热床 60°C',
  label: tout_label.includes('耗材参数'),
  hintGone,
  saved: ta2 ? ta2.value : null,
};
