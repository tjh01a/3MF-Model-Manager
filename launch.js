'use strict';
/**
 * 跨平台启动器。
 *
 * 某些宿主环境（例如 WorkBuddy 桌面客户端）会向子进程注入 ELECTRON_RUN_AS_NODE=1，
 * 导致 Electron 以纯 Node 模式启动、窗口永远不出现。这里显式清除它。
 * 同时保证 `npm start` / `npm run smoke` 与双击 start.bat 行为一致。
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let electronExe;
try {
  electronExe = require('electron');
} catch (_) {
  electronExe = null;
}
if (typeof electronExe !== 'string' || !electronExe) {
  const guess = path.join(__dirname, 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron');
  electronExe = fs.existsSync(guess) ? guess : null;
}
if (!electronExe || !fs.existsSync(electronExe)) {
  console.error('未找到 Electron，请先执行：npm install');
  process.exit(1);
}

/**
 * Windows 任务栏图标来自「进程 exe 的 PE 图标」，不是 BrowserWindow 的 icon。
 * 直接跑 node_modules/electron/dist/electron.exe 时，任务栏永远显示 Electron 原子图标。
 * 这里在同一目录复制一个 PrintShelf-dev.exe（旁边就是 Electron 运行时资源），
 * 用 rcedit 把软件图标写进去，再启动它；打包版仍走自己的安装包 exe。
 */
function windowsDevExe(exe) {
  if (process.platform !== 'win32') return exe;
  const icon = path.join(__dirname, 'resources', 'app.ico');
  if (!fs.existsSync(icon)) return exe;
  const out = path.join(path.dirname(exe), 'PrintShelf-dev.exe');
  try {
    const iconTime = fs.statSync(icon).mtimeMs;
    const exeTime = fs.statSync(exe).mtimeMs;
    const need = !fs.existsSync(out)
      || fs.statSync(out).mtimeMs < iconTime
      || fs.statSync(out).mtimeMs < exeTime;
    if (!need) return out;

    // 旧 dev 进程可能正占用这个 exe；能删就重建，删不掉就沿用已有的。
    if (fs.existsSync(out)) {
      try { fs.unlinkSync(out); } catch (_) { return out; }
    }
    fs.copyFileSync(exe, out);
    const rc = path.join(__dirname, 'node_modules', 'rcedit', 'bin',
      process.arch === 'x64' ? 'rcedit-x64.exe' : 'rcedit.exe');
    if (!fs.existsSync(rc)) {
      try { fs.unlinkSync(out); } catch (_) { /* 忽略 */ }
      return exe;
    }
    const r = spawnSync(rc, [
      out,
      '--set-icon', icon,
      '--set-version-string', 'ProductName', '3MF模型管理器',
      '--set-version-string', 'FileDescription', '3MF模型管理器',
    ], { windowsHide: true, stdio: 'ignore' });
    if (r.status === 0) return out;
    try { fs.unlinkSync(out); } catch (_) { /* 忽略 */ }
    return exe;
  } catch (_) {
    return fs.existsSync(out) ? out : exe;
  }
}

const runExe = windowsDevExe(electronExe);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(runExe, args, {
  cwd: __dirname,
  env,
  stdio: 'inherit',
  windowsHide: false,
});
child.on('error', (e) => { console.error('启动 Electron 失败：', e.message); process.exit(1); });
child.on('exit', (code) => process.exit(code == null ? 0 : code));
