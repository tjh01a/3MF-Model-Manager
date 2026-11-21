/**
 * 走查截图专用：停在向导第 2 步（选盘），不关闭，交给 capture 截图。
 *   PRINTSHELF_DATA_DIR=<空目录> node launch.js --no-seed --capture=docs/screenshots/50-首次向导.png --ui-script=tools/probe-onboarding-shot.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  return null;
}
const q = (s) => document.querySelector(s);

const ob = await waitFor(() => {
  const el = q('#onboarding');
  return el && !el.hidden ? el : null;
}, 20000);
if (!ob) return { ok: false, error: '向导未出现' };

const next = q('#onboarding [data-ob="next"]');
if (next) next.click();
await waitFor(() => q('#onboarding [data-ob="drive"]'), 8000);
await sleep(400);
return { ok: true, step: ((q('#onboarding .ob-title') || {}).textContent || '').trim() };
