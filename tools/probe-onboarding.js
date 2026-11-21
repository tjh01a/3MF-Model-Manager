/**
 * 走查探针：首次启动向导（docs/16）。
 * 必须在「空库 + 未完成向导」的隔离数据目录下跑：
 *   PRINTSHELF_DATA_DIR=<临时目录> node launch.js --no-seed --capture=data/reg/ob-1.png --ui-script=tools/probe-onboarding.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const txt = (s) => ((q(s) || {}).textContent || '').replace(/\s+/g, ' ').trim();
const out = {};

const ob = await waitFor(() => {
  const el = q('#onboarding');
  return el && !el.hidden ? el : null;
}, 20000);
if (!ob) return { ok: false, error: '首次启动没有出现向导' };

// --- 第 1 步 ---
out.step1 = {
  visible: !ob.hidden,
  kicker: txt('#onboarding .ob-kicker'),
  title: txt('#onboarding .ob-title'),
  points: document.querySelectorAll('#onboarding .ob-point').length,
  dotsOn: document.querySelectorAll('#onboarding .ob-dot.on').length,
};
q('#onboarding [data-ob="next"]').click();
await waitFor(() => q('#onboarding [data-ob="drive"]') || q('#onboarding .ob-empty'), 8000);

// --- 第 2 步 ---
const driveEls = Array.from(document.querySelectorAll('#onboarding [data-ob="drive"]'));
out.step2 = {
  title: txt('#onboarding .ob-title'),
  drives: driveEls.length,
  selected: document.querySelectorAll('#onboarding .ob-drive.on').length,
  chips: document.querySelectorAll('#onboarding [data-ob="depth"]').length,
  scanBtn: txt('#onboarding [data-ob="scan"]'),
  tags: document.querySelectorAll('#onboarding .ob-tag').length,
};

// 切换一个盘，确认勾选态与按钮联动
if (driveEls.length) {
  const first = driveEls[0];
  const before = first.classList.contains('on');
  first.click();
  await sleep(150);
  const after = first.classList.contains('on');
  out.toggle = { before, after, changed: before !== after };
  // 复原
  first.click();
  await sleep(120);
}

// 深度切换
const deep = q('#onboarding [data-ob="depth"][data-key="deep"]');
if (deep) {
  deep.click();
  await sleep(150);
  out.depthOn = deep.classList.contains('on');
}

// --- 稍后再说：应写 done，避免下次再拦 ---
q('#onboarding [data-ob="later"]').click();
await waitFor(() => { const el = q('#onboarding'); return el && el.hidden ? true : null; }, 5000);
await sleep(400);
const s1 = await window.shelf.settings();
out.doneAfterSkip = !!(s1.onboard && s1.onboard.done === true);
out.skippedFlag = !!(s1.onboard && s1.onboard.skipped === true);

// --- 设置页入口：重新运行向导 ---
q('#btn-settings').click();
await waitFor(() => q('#settings-panel [data-tab="data"]'), 8000);
q('#settings-panel [data-tab="data"]').click();
const rerun = await waitFor(() => q('[data-act="rerun-onboarding"]'), 8000);
out.settingsEntry = !!rerun;
if (rerun) {
  rerun.click();
  const again = await waitFor(() => { const el = q('#onboarding'); return el && !el.hidden ? el : null; }, 6000);
  out.reopened = !!again;
  out.reopenedStep = again ? txt('#onboarding .ob-kicker') : '';
  if (again) { q('#onboarding [data-ob="later"]').click(); await sleep(300); }
}

out.checks = {
  step1Ok: out.step1.visible && out.step1.points >= 3 && out.step1.dotsOn === 1,
  step2Ok: out.step2.drives >= 1 && out.step2.chips === 3,
  toggleOk: !!(out.toggle && out.toggle.changed),
  depthOk: out.depthOn === true,
  persistOk: out.doneAfterSkip === true,
  entryOk: out.settingsEntry === true && out.reopened === true,
};
out.ok = Object.values(out.checks).every(Boolean);

// 收尾：把自己打开的设置面板关掉，别影响截图
const close = q('#settings-close');
if (close) close.click();
await sleep(200);
return out;
