'use strict';
/**
 * 开发模式专用：生成一个带 PrintShelf 图标的 electron.exe 副本。
 *
 * Windows 任务栏在 AUMID 没和快捷方式绑定时，会回退到「进程 exe 的 PE 图标」，
 * 而不是快捷方式的 IconLocation。直接启动 node_modules/electron/dist/electron.exe，
 * 兜底看到的就是 Electron 原子图标；只改快捷方式图标没用。
 *
 * 所以所有开发启动入口（npm start、桌面快捷方式）都必须启动这个副本，
 * 而不是 electron.exe。发布包则使用 build-portable.js 里已嵌入图标的 exe。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ICON = path.join(ROOT, 'resources', 'app.ico');

function findElectronExe() {
  try {
    const p = require('electron');
    if (typeof p === 'string' && p) return p;
  } catch (_) { /* 下面按目录猜 */ }
  const guess = path.join(ROOT, 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron');
  return fs.existsSync(guess) ? guess : null;
}

function ensureDevExe(electronExe) {
  const exe = electronExe || findElectronExe();
  if (!exe || !fs.existsSync(exe)) return null;
  if (process.platform !== 'win32') return exe;
  if (!fs.existsSync(ICON)) return exe;

  const out = path.join(path.dirname(exe), 'PrintShelf-dev.exe');
  try {
    const iconTime = fs.statSync(ICON).mtimeMs;
    const exeTime = fs.statSync(exe).mtimeMs;
    const need = !fs.existsSync(out)
      || fs.statSync(out).mtimeMs < iconTime
      || fs.statSync(out).mtimeMs < exeTime;
    if (!need) return out;

    // 旧 dev 进程可能正占用这个 exe；删不掉就沿用已有的。
    if (fs.existsSync(out)) {
      try { fs.unlinkSync(out); } catch (_) { return out; }
    }
    fs.copyFileSync(exe, out);
    const rc = path.join(ROOT, 'node_modules', 'rcedit', 'bin',
      process.arch === 'x64' ? 'rcedit-x64.exe' : 'rcedit.exe');
    if (!fs.existsSync(rc)) {
      try { fs.unlinkSync(out); } catch (_) { /* 忽略 */ }
      return exe;
    }
    const r = spawnSync(rc, [
      out,
      '--set-icon', ICON,
      '--set-version-string', 'ProductName', 'PrintShelf',
      '--set-version-string', 'FileDescription', 'PrintShelf · 本地 3MF 模型库',
      '--set-version-string', 'OriginalFilename', 'PrintShelf.exe',
    ], { windowsHide: true, stdio: 'ignore' });
    if (r.status === 0) return out;
    try { fs.unlinkSync(out); } catch (_) { /* 忽略 */ }
    return exe;
  } catch (_) {
    return fs.existsSync(out) ? out : exe;
  }
}

if (require.main === module) {
  const p = ensureDevExe(process.argv[2]);
  if (!p) {
    process.stderr.write('未找到 Electron，请先执行 npm install\n');
    process.exit(1);
  }
  process.stdout.write(p + '\n');
}

module.exports = { ensureDevExe, findElectronExe, ICON, ROOT };
