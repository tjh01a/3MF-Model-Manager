'use strict';
/**
 * PrintShelf 绿色版（免安装）构建脚本。
 *
 * 设计取向：机器上没有 electron-builder / electron-packager / NSIS，也不想为打包联网装依赖，
 * 所以这里只做两件事——把 node_modules/electron/dist 整份复制出来当运行时，
 * 再把应用代码 + 运行期依赖放进 resources/app，交给 Electron 自带的应用加载逻辑。
 *
 * 产物：dist/<productName>-<version>-win-x64/
 *   PrintShelf.exe                   ← 由 electron.exe 改名而来
 *   *.dll / *.pak / locales/ ...      ← Electron 运行时原样带上
 *   resources/app/                    ← 应用代码（main 指向 electron/main.js）
 *   resources/app/README-使用说明.txt  ← 面向非技术用户的说明
 *   使用说明.txt                      ← 同内容，放在根目录方便第一眼看到
 *   一键安装.bat                      ← 安装到 %LOCALAPPDATA%\Programs\PrintShelf
 *   卸载 PrintShelf.bat               ← 安装后随程序一起落到安装目录
 *   app.ico                           ← 图标备份
 *
 * 只允许写 tools/ 与 dist/。本脚本不会碰 data/、electron/、src/、package.json。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(ROOT, 'dist');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const pkg = readJson(path.join(ROOT, 'package.json'));
const APP_NAME = pkg.productName || pkg.name || 'PrintShelf';
const VERSION = pkg.version || '0.0.0';
const OUT_NAME = `${APP_NAME}-${VERSION}-win-x64`;
const OUT_DIR = path.join(DIST_ROOT, OUT_NAME);
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP_DIR = path.join(OUT_DIR, 'resources', 'app');
const APP_ICON = path.join(ROOT, 'resources', 'app.ico');

// ---------------------------------------------------------------- 小工具

function assertInsideDist(target) {
  const rel = path.relative(DIST_ROOT, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('拒绝操作 dist 之外的路径：' + target);
  }
}

function rmrf(target) {
  assertInsideDist(target);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try { total += fs.statSync(p).size; } catch (_) { /* 忽略读不到的文件 */ }
      }
    }
  }
  return total;
}

function countFiles(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else n++;
    }
  }
  return n;
}

function step(label, fn) {
  const t = Date.now();
  process.stdout.write(`[build] ${label} ... `);
  const ret = fn();
  process.stdout.write(`完成 ${Date.now() - t}ms\n`);
  return ret;
}

// ---------------------------------------------------------------- 排除规则

// 应用源码里要跳过的目录（按目录名匹配，任意层级）
const SKIP_DIR_NAMES = new Set([
  'data', 'docs', 'tests', 'test', 'tools',
  '.git', '.github', '.vscode', '.idea',
  'screenshots', 'screenshot', 'coverage', '__pycache__',
]);

// node_modules 里只跳明显的开发垃圾，别误删包内的 assets/data
const SKIP_MODULE_DIR_NAMES = new Set(['.git', '.github', 'tests', 'test', 'docs', 'coverage', '.bin']);

function isScreenshotName(name) {
  return /screenshot|screen-shot|截图|截屏|ui-capture|\.shot\./i.test(name);
}

function shouldSkipFile(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.map')) return true;
  if (lower.endsWith('.log')) return true;
  if (lower.endsWith('.tsbuildinfo')) return true;
  if (lower === 'thumbs.db' || lower === '.ds_store' || lower === 'desktop.ini') return true;
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower) && isScreenshotName(name)) return true;
  return false;
}

function shouldSkipDir(name, moduleMode) {
  const set = moduleMode ? SKIP_MODULE_DIR_NAMES : SKIP_DIR_NAMES;
  return set.has(name.toLowerCase()) || (moduleMode && name.toLowerCase() === 'node_modules');
}

/**
 * 递归复制（保留目录结构，跳过排除项）。
 * copyFileSync 比 read+write 快，270MB 的 Electron 运行时几秒就能落地。
 */
function copyTree(src, dest, opts) {
  const options = opts || {};
  let st;
  try { st = fs.lstatSync(src); } catch (e) {
    if (options.ignoreMissing) return;
    throw e;
  }
  if (st.isSymbolicLink()) {
    const real = fs.statSync(src);
    if (real.isDirectory()) return copyTree(fs.realpathSync(src), dest, options);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(fs.realpathSync(src), dest);
    return;
  }
  if (st.isDirectory()) {
    if (options.skipRoot !== true && shouldSkipDir(path.basename(src), options.moduleMode)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const childOpts = Object.assign({}, options, { skipRoot: false });
      copyTree(path.join(src, name), path.join(dest, name), childOpts);
    }
    return;
  }
  if (st.isFile()) {
    if (shouldSkipFile(path.basename(src))) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ---------------------------------------------------------------- 运行期依赖

/**
 * 从 package.json 的 dependencies 出发，递归解析出真正需要随包发布的模块。
 * chokidar 有一串传递依赖，必须一起带上，否则打包后 require 直接报 MODULE_NOT_FOUND。
 */
function collectRuntimeDeps(rootPkg) {
  const seen = new Set();
  const queue = Object.keys(rootPkg.dependencies || {});
  const missing = [];
  while (queue.length) {
    const name = queue.shift();
    if (!name || seen.has(name)) continue;
    // fsevents 只在 macOS 生效，Windows 包不必带
    if (name === 'fsevents') continue;
    const modDir = path.join(ROOT, 'node_modules', name);
    const modPkgPath = path.join(modDir, 'package.json');
    if (!fs.existsSync(modPkgPath)) {
      missing.push(name);
      continue;
    }
    seen.add(name);
    const modPkg = readJson(modPkgPath);
    for (const dep of Object.keys(modPkg.dependencies || {})) queue.push(dep);
    for (const dep of Object.keys(modPkg.optionalDependencies || {})) queue.push(dep);
  }
  if (missing.length) {
    throw new Error('缺少运行期依赖：' + missing.join(', ') + '（请先 npm install）');
  }
  return [...seen].sort();
}

// ---------------------------------------------------------------- 生成物

const READ_ME_TEXT = `${APP_NAME} ${VERSION} —— 免安装绿色版使用说明
=====================================================

一、怎么启动
    双击本文件夹里的 ${APP_NAME}.exe 就能用。
    第一次启动可能要多等几秒（Windows 在检查新程序），之后会快很多。

二、数据存在哪里
    第一次启动后，程序会自动在「${APP_NAME}.exe 所在的文件夹」里建一个 data 文件夹。
    你的模型索引、缩略图、耗材库、打印回执全都存在这里面，不会上传到任何地方。
    备份或换电脑：把整个 data 文件夹复制走即可。
    注意：不要只把 ${APP_NAME}.exe 单独剪切到别处，那样它会以为自己是全新的，另建一份空 data。

三、安装到桌面 / 开始菜单（可选）
    双击「一键安装.bat」，程序会被安装到：
        %LOCALAPPDATA%\\Programs\\${APP_NAME}
    并在桌面和开始菜单创建 ${APP_NAME} 快捷方式，安装完成后自动启动一次。
    安装版的数据在安装目录下的 data 文件夹里。
    如果不想安装，直接用绿色版也完全一样，数据会留在这个文件夹。

四、怎么卸载
    绿色版：直接删除整个文件夹即可。
            想保留模型库，先把 data 文件夹复制到别处再删。
    安装版：到安装目录运行「卸载 ${APP_NAME}.bat」。
            桌面和开始菜单的快捷方式会被删除，
            你的 data 目录会被保留，脚本会告诉你它在哪里。

五、常见问题
    1) 双击后 Windows 提示「Windows 已保护你的电脑」
       点「更多信息」→「仍要运行」。
       这是因为个人打包的程序没有购买代码签名证书，不是病毒。
    2) 第一次扫描大文件夹会比较慢，缩略图是边扫边生成的，可以先干别的。
    3) 升级新版本：解压到新文件夹，把旧文件夹的 data 复制过去，
       再双击一次「一键安装.bat」覆盖安装即可。
    4) 别把程序文件夹放在会同步的网盘目录里，模型库文件被反复同步容易冲突。
`;

function buildInstallBat() {
  // PowerShell 脚本用 UTF-16LE base64 传进去，彻底绕开 bat 的中文编码坑
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    '$src = $env:PRINTSHELF_SRC',
    "if (-not $src) { throw '缺少安装源路径（请直接双击 一键安装.bat，不要用其他方式调用）' }",
    "$src = $src.TrimEnd('\\')",
    "$dest = Join-Path $env:LOCALAPPDATA 'Programs\\PrintShelf'",
    "Write-Host ''",
    "Write-Host '正在安装 PrintShelf ...'",
    "Write-Host ('  来源：' + $src)",
    "Write-Host ('  目标：' + $dest)",
    "Write-Host ''",
    'New-Item -ItemType Directory -Force -Path $dest | Out-Null',
    'if ($src -ne $dest) {',
    "  $rcArgs = @($src, $dest, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1', '/XD', (Join-Path $src 'data'))",
    '  & robocopy @rcArgs | Out-Null',
    "  if ($LASTEXITCODE -ge 8) { throw ('复制文件失败，robocopy 退出码 ' + $LASTEXITCODE) }",
    '}',
    "$exe = Join-Path $dest 'PrintShelf.exe'",
    "if (-not (Test-Path -LiteralPath $exe)) { throw '安装后没有找到 PrintShelf.exe，复制可能不完整' }",
    '$ws = New-Object -ComObject WScript.Shell',
    "$targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))",
    'foreach ($dir in $targets) {',
    '  if (-not (Test-Path -LiteralPath $dir)) { continue }',
    "  $lnkPath = Join-Path $dir 'PrintShelf.lnk'",
    '  $lnk = $ws.CreateShortcut($lnkPath)',
    '  $lnk.TargetPath = $exe',
    '  $lnk.WorkingDirectory = $dest',
    "  $lnk.IconLocation = ($exe + ',0')",
    "  $lnk.Description = 'PrintShelf 本地 3MF 模型库'",
    '  $lnk.WindowStyle = 1',
    '  $lnk.Save()',
    "  Write-Host ('  已创建快捷方式：' + $lnkPath)",
    '}',
    "Write-Host ''",
    "Write-Host '安装完成，正在启动 PrintShelf ...'",
    'Start-Process -FilePath $exe -WorkingDirectory $dest',
    "Write-Host ''",
    "Write-Host '提示：数据保存在安装目录的 data 文件夹，卸载时会保留。'",
    "Write-Host '卸载：运行安装目录里的「卸载 PrintShelf.bat」。'",
    "Read-Host '按回车键关闭这个窗口'",
  ].join('\r\n').replace(/PrintShelf/g, APP_NAME);

  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'title PrintShelf 安装程序',
    'set "PRINTSHELF_SRC=%~dp0"',
    'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + encoded,
    'if errorlevel 1 (',
    '  echo.',
    '  echo 安装失败，请把上面的提示截图反馈。',
    '  pause',
    ')',
    'endlocal',
    '',
  ].join('\r\n').replace(/PrintShelf/g, APP_NAME);

  fs.writeFileSync(path.join(OUT_DIR, '一键安装.bat'), bat, 'utf8');
}

function buildUninstallBat() {
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$dest = Join-Path $env:LOCALAPPDATA 'Programs\\PrintShelf'",
    "Write-Host ''",
    'if (-not (Test-Path -LiteralPath $dest)) {',
    "  Write-Host '没有找到 PrintShelf 安装目录，可能已经卸载过了。'",
    "  Read-Host '按回车键退出'",
    '  exit 0',
    '}',
    "$answer = Read-Host '确定卸载 PrintShelf 吗？模型库数据（data 目录）会保留 [y/N]'",
    "if ($answer -notmatch '^(y|yes)$') { Write-Host '已取消卸载。'; Read-Host '按回车键退出'; exit 0 }",
    'Get-Process -Name PrintShelf | Stop-Process -Force',
    'Start-Sleep -Milliseconds 600',
    '$ws = New-Object -ComObject WScript.Shell',
    "$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'PrintShelf.lnk'), (Join-Path (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs') 'PrintShelf.lnk'))",
    'foreach ($p in $links) {',
    '  if (Test-Path -LiteralPath $p) {',
    '    Remove-Item -LiteralPath $p -Force',
    "    Write-Host ('已删除快捷方式：' + $p)",
    '  }',
    '}',
    "Get-ChildItem -LiteralPath $dest -Force | Where-Object { $_.Name -ne 'data' } | Remove-Item -Recurse -Force",
    "$dataDir = Join-Path $dest 'data'",
    '$note = "PrintShelf 已卸载。`r`n`r`n你的模型库索引和缩略图仍然保留在：`r`n" + $dataDir + "`r`n`r`n确认不再需要后，可以手动删除整个 data 文件夹。`r`n"',
    "Set-Content -LiteralPath (Join-Path $dest '数据已保留-说明.txt') -Value $note -Encoding UTF8",
    "Write-Host ''",
    "Write-Host '卸载完成。数据目录已保留：' $dataDir",
    "Read-Host '按回车键退出'",
    "$self = Join-Path $dest '卸载 PrintShelf.bat'",
    "Start-Process -FilePath $env:ComSpec -ArgumentList @('/c', ('ping -n 4 127.0.0.1 >nul & del /f /q \"' + $self + '\"')) -WindowStyle Hidden",
  ].join('\r\n').replace(/PrintShelf/g, APP_NAME);

  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'title PrintShelf 卸载程序',
    'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + encoded,
    'endlocal',
    '',
  ].join('\r\n').replace(/PrintShelf/g, APP_NAME);

  fs.writeFileSync(path.join(OUT_DIR, `卸载 ${APP_NAME}.bat`), bat, 'utf8');
}

function buildAppPackageJson(depVersions) {
  return {
    name: pkg.name,
    productName: APP_NAME,
    version: VERSION,
    description: pkg.description,
    main: pkg.main || 'electron/main.js',
    author: pkg.author,
    license: pkg.license,
    private: true,
    type: pkg.type || 'commonjs',
    dependencies: depVersions,
    engines: pkg.engines,
  };
}

// ---------------------------------------------------------------- 主流程

function main() {
  const totalStart = Date.now();
  process.stdout.write(`[build] PrintShelf ${VERSION} 绿色版 → ${path.relative(ROOT, OUT_DIR)}\n`);

  if (!fs.existsSync(ELECTRON_DIST)) {
    throw new Error('未找到 Electron 运行时：' + ELECTRON_DIST + '（请先 npm install）');
  }
  const electronExe = path.join(ELECTRON_DIST, 'electron.exe');
  if (!fs.existsSync(electronExe)) {
    throw new Error('未找到 electron.exe，Electron 目录可能不完整：' + ELECTRON_DIST);
  }

  // 1. 清空旧产物（只允许动 dist 下的目录）
  step('清理旧产物', () => {
    rmrf(OUT_DIR);
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  // 2. 复制 Electron 运行时（跳过自带的 default_app.asar，我们用 resources/app 替它）
  step('复制 Electron 运行时', () => {
    for (const name of fs.readdirSync(ELECTRON_DIST)) {
      const src = path.join(ELECTRON_DIST, name);
      if (name === 'electron.exe') continue;
      if (name === 'resources') continue;
      copyTree(src, path.join(OUT_DIR, name), { skipRoot: true });
    }
    // resources 目录单独处理：只要运行时需要的文件，别把 default_app.asar 带进来
    const resSrc = path.join(ELECTRON_DIST, 'resources');
    const resDest = path.join(OUT_DIR, 'resources');
    fs.mkdirSync(resDest, { recursive: true });
    if (fs.existsSync(resSrc)) {
      for (const name of fs.readdirSync(resSrc)) {
        if (name === 'default_app.asar') continue;
        copyTree(path.join(resSrc, name), path.join(resDest, name), { skipRoot: true });
      }
    }
    fs.copyFileSync(electronExe, path.join(OUT_DIR, `${APP_NAME}.exe`));
  });

  // 3. 复制应用代码
  const deps = collectRuntimeDeps(pkg);
  step(`复制应用代码（含 ${deps.length} 个运行期依赖）`, () => {
    fs.mkdirSync(APP_DIR, { recursive: true });
    for (const dir of ['electron', 'src', 'vendor', 'resources']) {
      const src = path.join(ROOT, dir);
      if (!fs.existsSync(src)) throw new Error('缺少源码目录：' + dir);
      copyTree(src, path.join(APP_DIR, dir), { skipRoot: true });
    }
    // 运行期依赖：逐个复制到 resources/app/node_modules
    for (const name of deps) {
      copyTree(path.join(ROOT, 'node_modules', name), path.join(APP_DIR, 'node_modules', name), {
        skipRoot: true,
        moduleMode: true,
      });
    }
    // 应用自己的 package.json：去掉 devDependencies 与 scripts，保留 main
    const depVersions = {};
    for (const name of deps) {
      depVersions[name] = readJson(path.join(APP_DIR, 'node_modules', name, 'package.json')).version;
    }
    fs.writeFileSync(
      path.join(APP_DIR, 'package.json'),
      JSON.stringify(buildAppPackageJson(depVersions), null, 2) + '\n',
      'utf8'
    );
    // 说明文档（CRLF + BOM，老记事本也不乱码）；根目录再放一份，解压后第一眼就能看到
    const readmeText = '\uFEFF' + READ_ME_TEXT.replace(/\r?\n/g, '\r\n');
    fs.writeFileSync(path.join(APP_DIR, 'README-使用说明.txt'), readmeText, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, '使用说明.txt'), readmeText, 'utf8');
  });

  // 4. 图标 + 安装/卸载脚本
  step('生成图标与安装脚本', () => {
    if (fs.existsSync(APP_ICON)) {
      fs.copyFileSync(APP_ICON, path.join(OUT_DIR, 'app.ico'));
    }
    buildInstallBat();
    buildUninstallBat();
  });

  // 5. 校验关键文件
  const required = [
    path.join(OUT_DIR, `${APP_NAME}.exe`),
    path.join(APP_DIR, 'package.json'),
    path.join(APP_DIR, 'electron', 'main.js'),
    path.join(APP_DIR, 'vendor', 'bedready', 'bedready-node.cjs'),
    path.join(APP_DIR, 'node_modules', 'adm-zip', 'package.json'),
    path.join(APP_DIR, 'node_modules', 'chokidar', 'package.json'),
  ];
  const missing = required.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    throw new Error('产物缺少关键文件：\n  ' + missing.map((p) => path.relative(OUT_DIR, p)).join('\n  '));
  }

  const size = dirSize(OUT_DIR);
  const files = countFiles(OUT_DIR);
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  process.stdout.write('\n[build] 产物目录：' + OUT_DIR + '\n');
  process.stdout.write(`[build] 体积：${humanSize(size)}，文件数：${files}，总耗时：${elapsed}s\n`);

  // 顺带把体积大头列出来，方便判断异常膨胀
  const top = fs.readdirSync(OUT_DIR).map((name) => {
    const p = path.join(OUT_DIR, name);
    const st = fs.statSync(p);
    return { name, size: st.isDirectory() ? dirSize(p) : st.size };
  }).sort((a, b) => b.size - a.size).slice(0, 5);
  process.stdout.write('[build] 体积 Top5：' + top.map((t) => `${t.name} ${humanSize(t.size)}`).join(' | ') + '\n');

  return { outDir: OUT_DIR, size, files };
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write('\n[build] 构建失败：' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  }
}

module.exports = { main, OUT_DIR, OUT_NAME, APP_NAME, VERSION, DIST_ROOT, dirSize, humanSize };
