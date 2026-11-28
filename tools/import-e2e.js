'use strict';
/**
 * 拖拽导入 E2E：用临时数据目录启动真实 Electron，在页面里构造一个带真实
 * `File.path` 的 .3mf 文件，触发 dragenter / dragover / drop，走真实的
 * folderAdd → scanStart → 入库链路；结束后查 folders / query 验证落库。
 *
 * 注意：这是“页面拖放事件 + 真实 IPC/扫描”的 E2E，不是操作系统级鼠标拖拽。
 * 项目现有的 `tools/drag-e2e.js` 负责操作系统级拖放协商；这里补导入链路。
 *
 * 运行：node tools/import-e2e.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function findSmallSample() {
  const candidates = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.3mf$/i.test(e.name)) candidates.push(p);
    }
  };
  for (const d of [path.join(ROOT, 'data'), path.join(ROOT, 'tests')]) {
    if (fs.existsSync(d)) walk(d);
  }
  candidates.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
  return candidates[0] || null;
}

async function main() {
  const sample = findSmallSample();
  if (!sample) throw new Error('找不到可用于导入测试的 .3mf 样本');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-import-'));
  const dataDir = path.join(tmp, 'data');
  const importDir = path.join(tmp, 'import-me');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(importDir, { recursive: true });
  fs.copyFileSync(sample, path.join(importDir, 'ImportE2E.3mf'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 1,
    folders: [],
    onboard: { done: true, at: Date.now() },
    ui: { language: 'zh-CN', theme: 'light' },
  }, null, 2));

  const filePath = path.join(importDir, 'ImportE2E.3mf');
  const capPath = path.join(tmp, 'import.png');
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
const out = { ok: false, checks: {} };
const q = (s) => document.querySelector(s);
await waitFor(() => q('#content') || q('#empty-state'), 15000);
await sleep(800);
const mask = q('#drag-mask');
const dt = new DataTransfer();
const file = new File(['p0 import test'], 'ImportE2E.3mf', { type: 'application/octet-stream' });
Object.defineProperty(file, 'path', { value: ${JSON.stringify(filePath)}, configurable: true });
dt.items.add(file);
const dragEnter = new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true });
const dragOver = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
window.dispatchEvent(dragEnter);
window.dispatchEvent(dragOver);
await sleep(80);
out.maskShown = !!mask && !mask.hidden;
const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
window.dispatchEvent(drop);
await sleep(120);
out.maskHidden = !!mask && mask.hidden;
const folders = await waitAsync(async () => {
  try {
    const list = await window.shelf.folders();
    return Array.isArray(list) && list.some((f) => f.path.toLowerCase() === ${JSON.stringify(importDir)}.toLowerCase()) ? list : null;
  } catch (_) { return null; }
}, 5000);
out.folderAdded = !!folders;
out.folderCount = folders ? folders.length : 0;
const toastText = Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.replace(/\\s+/g, ' ').trim());
out.toast = toastText.join(' | ');
const scanned = await waitAsync(async () => {
  try {
    const r = await window.shelf.query({ keyword: 'ImportE2E', limit: 0 });
    return r && r.total >= 1 ? r : null;
  } catch (_) { return null; }
}, 12000);
out.modelTotal = scanned ? scanned.total : 0;
out.modelTitle = scanned && scanned.items && scanned.items[0] ? scanned.items[0].title : '';
out.checks.mask = out.maskShown && out.maskHidden;
out.checks.folder = out.folderAdded;
out.checks.scan = out.modelTotal >= 1;
out.checks.toast = /已添加/.test(out.toast);
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
  if (!ok) {
    console.error('导入 E2E 失败：exit=' + code + '，结果=' + JSON.stringify(result));
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
