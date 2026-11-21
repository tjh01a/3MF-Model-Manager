'use strict';
/**
 * 生成 Windows 安装包（Setup.exe）。
 *
 *   node tools/build-setup.js            用已有绿色版目录编译安装包
 *   node tools/build-setup.js --rebuild  先跑 build-all 再编译
 *
 * 依赖 NSIS（makensis）。查找顺序：
 *   1. 环境变量 NSIS_DIR 指向的目录
 *   2. tools/.cache/nsis/ 下的便携版（首次运行会自动下载）
 *   3. 系统安装路径 C:\Program Files (x86)\NSIS
 *
 * NSIS 是免费开源的安装包编译器，便携版约 2.3MB，只在本地缓存，不进 git。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(ROOT, 'dist');
const CACHE = path.join(__dirname, '.cache');
const NSIS_VERSION = '3.10';
const NSIS_URL = `https://prdownloads.sourceforge.net/nsis/nsis-${NSIS_VERSION}.zip`;

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const APP_NAME = pkg.productName || pkg.name;
const VERSION = pkg.version;
const APP_EXE = `${APP_NAME}.exe`;
const SRC_DIR = path.join(DIST_ROOT, `${APP_NAME}-${VERSION}-win-x64`);
const OUT_FILE = path.join(DIST_ROOT, `${APP_NAME}-${VERSION}-setup.exe`);

function log(msg) { process.stdout.write(msg + '\n'); }

function humanSize(b) {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

function httpGet(url, dest, depth) {
  depth = depth || 0;
  return new Promise((resolve, reject) => {
    if (depth > 6) return reject(new Error('重定向次数过多'));
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'PrintShelf-Build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpGet(new URL(res.headers.location, url).toString(), dest, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('下载失败 HTTP ' + res.statusCode));
      }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
      f.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(new Error('下载超时')); });
  });
}

function findMakensis() {
  const candidates = [];
  if (process.env.NSIS_DIR) candidates.push(path.join(process.env.NSIS_DIR, 'Bin', 'makensis.exe'));
  const cached = path.join(CACHE, `nsis-${NSIS_VERSION}`);
  candidates.push(path.join(cached, 'Bin', 'makensis.exe'));
  candidates.push(path.join(cached, 'makensis.exe'));
  candidates.push('C:\\Program Files (x86)\\NSIS\\makensis.exe');
  candidates.push('C:\\Program Files\\NSIS\\makensis.exe');
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function ensureNsis() {
  let mk = findMakensis();
  if (mk) { log('[setup] 已找到 NSIS: ' + mk); return mk; }

  log('[setup] 未找到 NSIS，正在下载便携版（约 2.3 MB）...');
  fs.mkdirSync(CACHE, { recursive: true });
  const zipPath = path.join(CACHE, `nsis-${NSIS_VERSION}.zip`);
  await httpGet(NSIS_URL, zipPath);
  log('[setup] 下载完成，正在解压 ...');
  new AdmZip(zipPath).extractAllTo(CACHE, true);
  fs.rmSync(zipPath, { force: true });

  mk = findMakensis();
  if (!mk) throw new Error('NSIS 解压后仍未找到 makensis.exe，请检查 ' + CACHE);
  log('[setup] NSIS 就绪: ' + mk);
  return mk;
}

function writeScript() {
  const tplPath = path.join(__dirname, 'setup-template.nsi');
  let tpl = fs.readFileSync(tplPath, 'utf8');
  const map = {
    '@@APP_NAME@@': APP_NAME,
    '@@VERSION@@': VERSION,
    '@@APP_EXE@@': APP_EXE,
    '@@PUBLISHER@@': pkg.author || 'PrintShelf',
    '@@APP_URL@@': 'https://github.com/tjh01a/3MF-Model-Manager',
    '@@SRC_DIR@@': SRC_DIR,
    '@@ICON@@': path.join(ROOT, 'resources', 'app.ico'),
    '@@LICENSE@@': path.join(ROOT, 'LICENSE'),
    '@@OUT_FILE@@': OUT_FILE,
  };
  for (const [k, v] of Object.entries(map)) {
    tpl = tpl.split(k).join(v);
  }
  const out = path.join(CACHE, 'setup.nsi');
  fs.mkdirSync(CACHE, { recursive: true });
  // NSIS Unicode 版要求脚本带 UTF-8 BOM，否则中文会乱码
  fs.writeFileSync(out, '\uFEFF' + tpl, 'utf8');
  return out;
}

async function main() {
  const rebuild = process.argv.includes('--rebuild');

  if (rebuild) {
    log('[setup] 先执行 build-all ...');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'build-all.js'), '--force'], {
      cwd: ROOT, stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error('build-all 失败');
  }

  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(
      `找不到绿色版目录：${SRC_DIR}\n` +
      '请先运行：node tools/build-all.js --force（或加 --rebuild 参数一步到位）'
    );
  }
  if (!fs.existsSync(path.join(SRC_DIR, APP_EXE))) {
    throw new Error(`绿色版目录里没有 ${APP_EXE}，请重新执行 build-all`);
  }

  const makensis = await ensureNsis();
  const nsi = writeScript();
  log('[setup] 正在编译安装包（270MB 数据，通常 1-3 分钟）...');

  const r = spawnSync(makensis, [nsi], {
    cwd: path.dirname(path.dirname(makensis)), // NSIS 根目录，用来找 Include/Contrib
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('makensis 编译失败，退出码 ' + r.status);
  if (!fs.existsSync(OUT_FILE)) throw new Error('编译完成但没找到输出文件：' + OUT_FILE);

  const size = fs.statSync(OUT_FILE).size;
  log('');
  log('[setup] 安装包已生成');
  log('        路径：' + OUT_FILE);
  log('        体积：' + humanSize(size));
  log('');
  log('提示：这个 exe 没有代码签名，首次运行会弹 SmartScreen，点「更多信息」→「仍要运行」即可。');
  log('      上传到 GitHub Release 时，文件名建议用英文：');
  log(`      3MF-Model-Manager-${VERSION}-setup.exe`);
}

main().catch((e) => {
  process.stderr.write('\n[setup] 失败：' + (e && e.message ? e.message : e) + '\n');
  process.exit(1);
});
