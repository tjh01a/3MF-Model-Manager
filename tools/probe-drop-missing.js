/**
 * 走查探针：设置 → 监控目录 → 扫描选项里的「文件被删除后直接移出模型库」。
 *   node launch.js --capture=%TEMP%/probe-dropmissing.png --ui-script=tools/probe-drop-missing.js
 *
 * 只读断言 + 切换一次再切回（探针库是临时 PRINTSHELF_DATA_DIR，不碰真实库）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step || 100); }
  return null;
}
const q = (s) => document.querySelector(s);

const out = {};
const btn = await waitFor(() => q('#btn-settings'), 15000);
if (!btn) return { ok: false, error: '设置按钮没出现' };
btn.click();

const box = await waitFor(() => q('[data-bind="scan.dropMissing"]'), 8000);
if (!box) return { ok: false, error: '找不到 scan.dropMissing 开关' };

const label = box.closest('.switch') && box.closest('.switch').textContent.replace(/\s+/g, ' ').trim();
const section = (box.closest('.settings-section') || {}).textContent || '';
const hint = (section.match(/开启后：[\s\S]*?不会跟着走。/) || [''])[0];

// 默认应为开启（DEFAULT_SETTINGS.scan.dropMissing = true）
out.defaultChecked = box.checked;
out.label = label;
out.hasHint = /移动或重命名/.test(hint);
out.hint = hint.slice(0, 120);

// 切换一次再切回，确认 UI 能写回而不崩
box.click();
await sleep(400);
const afterOff = q('[data-bind="scan.dropMissing"]');
out.toggleOff = afterOff ? !afterOff.checked : false;
afterOff.click();
await sleep(400);
const afterOn = q('[data-bind="scan.dropMissing"]');
out.toggleBack = afterOn ? afterOn.checked : false;

out.ok = out.defaultChecked && /删除/.test(label || '') && out.hasHint && out.toggleOff && out.toggleBack;
return out;
