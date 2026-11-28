'use strict';
/**
 * 首启新手教程 E2E：
 *   空库 + onboard.done=false 启动真实 Electron → 检查“配置清单”欢迎页
 *   → 检查“推荐文件夹”而不是默认整盘
 *   → 用测试钩子注入一个只含 1 个 3MF 的临时目录 → 真实 folderAdd + scanStart
 *   → 检查扫描结果、可选下一步清单、完成状态持久化
 *
 * 不点原生目录选择框，避免依赖系统弹窗；正式用户路径仍是 api.pickFolder()。
 * 运行：node tools/onboarding-e2e.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function findSmallSample() {
  const candidates = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.3mf$/i.test(e.name)) candidates.push(p);
    }
  };
  walk(path.join(ROOT, 'data'));
  walk(path.join(ROOT, 'tests'));
  candidates.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
  return candidates[0] || null;
}

async function main() {
  const sample = findSmallSample();
  if (!sample) throw new Error('找不到可用于向导测试的 .3mf 样本');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-onboard-'));
  const dataDir = path.join(tmp, 'data');
  const modelDir = path.join(tmp, '我的模型');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
  fs.copyFileSync(sample, path.join(modelDir, 'OnboardingE2E.3mf'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 1,
    folders: [],
    onboard: { done: false, at: 0, depth: 'standard', skipped: false, guideDone: false },
    ui: { language: 'zh-CN', theme: 'light' },
  }, null, 2));

  const capPath = path.join(tmp, 'onboarding.png');
  const scriptPath = path.join(tmp, 'ui.js');
  fs.writeFileSync(scriptPath, `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
  return null;
}
async function waitAsync(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}
const q = (s) => document.querySelector(s);
const txt = (s) => ((q(s) || {}).textContent || '').replace(/\\s+/g, ' ').trim();
const out = { ok: false, checks: {}, step1: {}, step2: {}, result: {} };

const ob = await waitFor(() => {
  const el = q('#onboarding');
  return el && !el.hidden ? el : null;
}, 20000);
if (!ob) return { ok: false, error: '首次启动没有出现向导' };

out.step1 = {
  title: txt('#onboarding .ob-title'),
  sub: txt('#onboarding .ob-sub'),
  points: document.querySelectorAll('#onboarding .ob-point').length,
  required: document.querySelectorAll('#onboarding .ob-plan-badge.required').length,
  optional: document.querySelectorAll('#onboarding .ob-plan-badge:not(.required)').length,
  trust: !!q('#onboarding .ob-trust'),
  cta: txt('#onboarding [data-ob="next"]'),
};
q('#onboarding [data-ob="next"]').click();
await waitFor(() => q('#onboarding .ob-best'), 8000);

out.step2 = {
  title: txt('#onboarding .ob-title'),
  recommended: !!q('#onboarding .ob-best'),
  driveCount: document.querySelectorAll('#onboarding [data-ob="drive"]').length,
  selectedDrives: document.querySelectorAll('#onboarding .ob-drive.on').length,
  scanDisabled: !!q('#onboarding [data-ob="scan"]') && q('#onboarding [data-ob="scan"]').disabled,
  advancedClosed: Array.from(document.querySelectorAll('#onboarding .ob-advanced')).every((d) => !d.open),
  pickedText: txt('#onboarding .ob-picked'),
  focusPicker: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.ob-best')),
};
out.step2.hasFolderHook = typeof window.__printshelfOnboardingAddPath === 'function';
if (out.step2.hasFolderHook) {
  window.__printshelfOnboardingAddPath(${JSON.stringify(modelDir)});
  await sleep(250);
}
out.step2.selectedAfterHook = document.querySelectorAll('#onboarding .ob-extra').length;
out.step2.pickedAfterHook = txt('#onboarding .ob-picked');
out.step2.scanEnabledAfterHook = !!q('#onboarding [data-ob="scan"]') && !q('#onboarding [data-ob="scan"]').disabled;

q('#onboarding [data-ob="scan"]').click();
const result = await waitFor(() => q('#onboarding .ob-result') || q('#onboarding .ob-result-icon'), 30000);
out.result = {
  title: txt('#onboarding .ob-title'),
  number: txt('#onboarding .ob-result-num'),
  note: txt('#onboarding .ob-result-note'),
  nextRows: document.querySelectorAll('#onboarding .ob-next-row').length,
  slicerText: txt('#onboarding .ob-next-row b'),
  checklist: !!q('#onboarding .ob-next'),
};
q('#onboarding [data-ob="finish"]').click();
await waitFor(() => { const el = q('#onboarding'); return el && el.hidden ? true : null; }, 5000);
await sleep(500);
const settings = await window.shelf.settings();
const query = await window.shelf.query({ limit: 0 });
out.persist = {
  done: !!(settings.onboard && settings.onboard.done === true),
  folderCount: (await window.shelf.folders()).length,
  total: query.total,
  guideVisible: !!q('.gd-layer') && !q('.gd-layer').hidden,
};

out.checks = {
  welcome: out.step1.points === 3 && out.step1.required === 1 && out.step1.optional === 2 && out.step1.trust,
  cta: /选择模型文件夹/.test(out.step1.cta),
  noAutoDrive: out.step2.driveCount >= 1 && out.step2.selectedDrives === 0 && out.step2.scanDisabled,
  recommended: out.step2.recommended && out.step2.advancedClosed,
  focusPicker: out.step2.focusPicker,
  folderHook: out.step2.hasFolderHook && out.step2.selectedAfterHook >= 1 && out.step2.scanEnabledAfterHook,
  scanned: out.result.note && /新增 1/.test(out.result.note) && /1 个模型/.test(out.result.number),
  next: out.result.nextRows >= 3 && out.result.checklist,
  persisted: out.persist.done && out.persist.folderCount >= 1 && out.persist.total >= 1,
};
out.ok = Object.values(out.checks).every(Boolean);
return out;
`);

  const child = spawn(process.execPath, [
    'launch.js',
    '--capture=' + capPath,
    '--ui-script=' + scriptPath,
    '--no-seed',
  ], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PRINTSHELF_DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const code = await new Promise((resolve) => child.on('close', resolve));
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const m = stdout.match(/=== PRINTSHELF_UI_SCRIPT ===\n([\s\S]*?)\n=== END ===/);
  let result = null;
  if (m) {
    try { result = JSON.parse(m[1]); } catch (_) {}
  }
  const ok = code === 0 && result && result.ok === true;
  process.exitCode = ok ? 0 : 1;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  if (!ok) console.error('新手教程 E2E 失败：exit=' + code + '，结果=' + JSON.stringify(result));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
