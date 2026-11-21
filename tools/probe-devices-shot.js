/**
 * 截图用：打开设备页、点亮快造摄像头，停在有画面的状态供 capture。
 *   node launch.js --capture=docs/screenshots/52-设备四头温度与摄像头.png --ui-script=tools/probe-devices-shot.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(150);
  }
  return null;
}

q('#btn-devices').click();
await waitFor(() => { const p = q('#devices-panel'); return p && !p.hidden ? p : null; }, 8000);
const card = await waitFor(() => qa('.dev-card').find((c) => /快造|Snapmaker/i.test((c.querySelector('.dev-name') || {}).textContent || '')), 12000);
if (!card) return { ok: false, error: '没有快造卡片' };
const id = card.dataset.id;
const btn = q('.dev-card[data-id="' + id + '"] [data-act="dev-cam"]');
if (btn) btn.click();
const img = await waitFor(() => {
  const c = q('.dev-card[data-id="' + id + '"]');
  return c && c.querySelector('.dev-cam img') ? true : null;
}, 20000);
await sleep(600);
return { ok: !!img, id };
