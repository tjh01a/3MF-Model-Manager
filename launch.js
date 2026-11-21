'use strict';
/**
 * 跨平台启动器。
 *
 * 某些宿主环境（例如 WorkBuddy 桌面客户端）会向子进程注入 ELECTRON_RUN_AS_NODE=1，
 * 导致 Electron 以纯 Node 模式启动、窗口永远不出现。这里显式清除它。
 * 同时保证 `npm start` / `npm run smoke` 与双击 start.bat 行为一致。
 */
const { spawn } = require('child_process');
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

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electronExe, args, {
  cwd: __dirname,
  env,
  stdio: 'inherit',
  windowsHide: false,
});
child.on('error', (e) => { console.error('启动 Electron 失败：', e.message); process.exit(1); });
child.on('exit', (code) => process.exit(code == null ? 0 : code));
