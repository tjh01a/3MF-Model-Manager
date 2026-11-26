'use strict';
/**
 * PrintShelf 主进程。
 *
 * 关键设计：用自定义 app:// 协议加载渲染层，而不是 file://。
 * Chromium 会禁止 file:// 页面加载 ES Modules（CORS null origin），
 * 自定义 standard+secure 协议可让 <script type="module"> 正常工作。
 *
 * 启动参数：
 *   --smoke              无头自检：初始化服务、注册全部 IPC、真实扫描一次，输出 JSON 后退出
 *   --capture=<png路径>   自动截图 UI 供视觉走查；与正常启动共用单实例锁，已有实例时拒绝启动。
 *                         相对路径按项目根目录解析（如 data/ui-capture.png）
 *   --seed                capture 专用：库为空时显式灌入工作区示例数据（默认不灌，不碰真实 settings.folders）
 *   --ui=<场景>           截图前套用内置场景（dark/list/detail/settings/lightbox）
 *   --ui-script=<js路径>  截图前在页面里执行一段脚本（走查与自动化验证用，返回值会打印）
 *   --no-seed             显式否决示例数据灌入（即使传了 --seed；破坏性测试必须加）
 *   --dev                 打开开发者工具
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// 打包后 process.argv = [PrintShelf.exe, ...args]；开发期（electron .）= [electron, '.', ...args]。
// 直接用 slice(2) 会把打包版的第一个参数吞掉（--smoke / --capture 失效），2026-11-19 修复。
// 注意：打包版里 process.defaultApp 是 undefined（不是 false），
// 所以判断必须写成「真值取 2，否则 1」，写成 === false 会把打包版第一个参数吞掉。
const argv = process.argv.slice(process.defaultApp ? 2 : 1);
const isSmoke = argv.includes('--smoke');
const isDev = argv.includes('--dev');
const captureArg = argv.find((a) => a.startsWith('--capture='));
const capturePath = captureArg ? captureArg.slice('--capture='.length) : null;
const uiArg = argv.find((a) => a.startsWith('--ui='));
const uiScenario = uiArg ? uiArg.slice('--ui='.length) : null;
const uiScriptArg = argv.find((a) => a.startsWith('--ui-script='));
const uiScriptPath = uiScriptArg ? uiScriptArg.slice('--ui-script='.length) : null;
// 走查用：让 capture 能在任意窗口尺寸下截图（含 <760px 的侧栏抽屉断点）
const numArg = (name, fallback, lo, hi) => {
  const a = argv.find((x) => x.startsWith('--' + name + '='));
  const n = a ? Number(a.slice(name.length + 3)) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
};
const winWidth = numArg('width', 1480, 480, 3840);
const winHeight = numArg('height', 940, 360, 2160);

// 部分宿主程序会注入 ELECTRON_RUN_AS_NODE（值可能是 1 / true / 任意非空串），
// 使 Electron 退化成纯 Node、窗口不出现。与 launch.js 的「无条件 delete」语义保持一致：
// 只要是非空值就认为需要自愈，用干净环境重启自己。
if (process.env.ELECTRON_RUN_AS_NODE) {
  const cp = require('child_process');
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  const target = process.argv[1]
    ? path.resolve(process.argv[1])
    : path.resolve(__dirname, '..');
  cp.spawn(process.execPath, [target, ...process.argv.slice(2)], {
    cwd: path.resolve(__dirname, '..'),
    env: cleanEnv,
    detached: true,
    stdio: 'ignore',
  }).unref();
  process.exit(0);
}

// smoke 模式使用隔离的临时数据目录，不触碰用户真实索引
if (isSmoke && !process.env.PRINTSHELF_DATA_DIR) {
  process.env.PRINTSHELF_DATA_DIR = path.join(os.tmpdir(), 'printshelf-smoke-' + process.pid);
}

// 可选启动日志：打包版是 GUI 子系统，没有控制台，出错时用户什么也看不到。
// 只在显式开启时写文件（--smoke / --capture / PRINTSHELF_STARTUP_LOG=1），平时不产生垃圾文件。
const STARTUP_LOG_ON = argv.includes('--smoke')
  || argv.some((a) => a.startsWith('--capture=')) || process.env.PRINTSHELF_STARTUP_LOG === '1';
function startupLog(line) {
  if (!STARTUP_LOG_ON) return;
  try {
    const dir = process.defaultApp
      ? path.resolve(__dirname, '..')
      : path.dirname(process.execPath);
    fs.appendFileSync(path.join(dir, 'startup.log'),
      new Date().toISOString() + ' [pid ' + process.pid + '] ' + line + '\n', 'utf8');
  } catch (_) { /* 日志失败不能影响启动 */ }
}
startupLog('boot argv=' + JSON.stringify(process.argv.slice(1)) + ' defaultApp=' + process.defaultApp);
process.on('uncaughtException', (e) => {
  startupLog('uncaughtException: ' + (e && e.stack ? e.stack : String(e)));
});
process.on('exit', (code) => startupLog('exit code=' + code));

const electronApi = require('electron');
const { app, BrowserWindow, Menu, protocol, shell, dialog, Notification } = electronApi || {};

// 宿主环境可能注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化成纯 Node，
// 此时 require('electron') 只返回可执行文件路径，所有 API 都是 undefined。
if (!app || !protocol || typeof protocol.registerSchemesAsPrivileged !== 'function') {
  console.error('[PrintShelf] 启动失败：Electron API 不可用。');
  console.error('通常由环境变量 ELECTRON_RUN_AS_NODE 被设为非空值引起，请使用 start.bat / npm start 启动（会自动清除该变量）。');
  console.error('当前 ELECTRON_RUN_AS_NODE =', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE || ''));
  process.exit(1);
}

// capture / smoke 是自动化通道：窗口经常处于「被遮挡」或未聚焦状态，
// Chromium 会把帧与定时器节流（实测 50ms 定时器被拉到 ~1s），导致所有 CSS 过渡
// 停在起始值、探针量到的是动画第一帧。这里只在这两个通道关掉节流，
// 正常启动不受影响。2026-11-19 加。
if (capturePath || isSmoke) {
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

// 打包版（绿色版 / 安装版）的数据目录：优先放到 exe 同级的 data/，
// 这样「拷走整个文件夹就带走了全部模型索引」，符合绿色版直觉；
// 如果 exe 所在目录不可写（例如装到 Program Files），退回用户数据目录。
// 必须在 require('./services') 之前设置，path.js 会在首次 getDataDir() 时读它。
if (app.isPackaged && !process.env.PRINTSHELF_DATA_DIR) {
  const exeDir = path.dirname(process.execPath);
  let dataDir = path.join(exeDir, 'data');
  let writable = true;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (_) {
    writable = false;
  }
  if (!writable) {
    dataDir = path.join(app.getPath('userData'), 'data');
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) { /* 交给下游报错 */ }
  }
  process.env.PRINTSHELF_DATA_DIR = dataDir;
}

const Services = require('./services');
const { registerIpc } = require('./ipc');
const cpaths = require('../src/core/paths');
const { backfillFilamentColors } = require('../src/core/colors');
const { backfillWeights } = require('../src/core/weights');
const classify = require('../src/core/classify');
const { backfillSourceUrls } = require('../src/core/source-urls');

const RENDERER_ROOT = path.resolve(__dirname, '..', 'src', 'renderer');
const APP_ICON = path.join(__dirname, '..', 'resources', 'app.ico');
const APP_ORIGIN = 'app://local';

// 让任务栏 / Alt-Tab 使用应用自己的图标（与桌面快捷方式一致）
if (process.platform === 'win32' && app.setAppUserModelId) {
  try { app.setAppUserModelId('com.printshelf.desktop'); } catch (_) { /* 忽略 */ }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // 只读缩略图服务：standard+secure 就够。bypassCSP / corsEnabled 是多余的高权限，
  // 一旦该源被利用就等于绕开页面 CSP 拉任意资源。
  { scheme: 'shelf', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let services = null;
let mainWindow = null;
let ipcMethods = [];
// 'pending' | 'ready' | 'failed'。窗口先于后端创建，状态可能在页面订阅前就确定，
// 因此 did-finish-load 会补发当前状态；失败态还会被 preload 缓存，不让 whenReady 永远挂起。
let readyState = 'pending';
let startupFailure = null;
let lastBootStage = null;
// capture 的 ui 快照放在模块级：正常 finally 与超时走 before-quit 时都要能还原。
let captureUiSnapshot = null;
let shutdownPromise = null;

function broadcastToRenderer(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents) {
      try { w.webContents.send(channel, payload); } catch (_) { /* 窗口已关闭 */ }
    }
  }
}

/** 后端（服务 + 全部 IPC handler）就绪信号：渲染层 bootstrap 之前会等它。 */
function signalRendererReady() {
  readyState = 'ready';
  startupFailure = null;
  broadcastToRenderer('app:ready', { ok: true });
}

/** 启动失败信号：preload 读取 payload.ok 后 reject 等待者并缓存失败态。 */
function signalRendererFailure(message) {
  readyState = 'failed';
  startupFailure = { message: String(message || '程序启动失败，请重新启动 PrintShelf') };
  broadcastToRenderer('app:ready', { ok: false, message: startupFailure.message });
}

/** did-finish-load 补发当前状态与最近缓存的 boot:stage，避免早发信号丢失。 */
function replayStartupState(win) {
  if (!win || win.isDestroyed() || !win.webContents) return;
  try {
    if (readyState === 'ready') win.webContents.send('app:ready', { ok: true });
    else if (readyState === 'failed') {
      win.webContents.send('app:ready', { ok: false, message: startupFailure.message });
    }
    if (lastBootStage) win.webContents.send('boot:stage', lastBootStage);
  } catch (_) { /* 窗口已关闭 */ }
}

/**
 * 分阶段启动信号：让启动动画从「无限转圈」变成看得见进度的加载条。
 * 纯视觉反馈，不参与任何 await；preload 会缓存历史帧，早发的阶段不会丢。
 */
function bootStage(name, percent) {
  lastBootStage = { name, percent };
  broadcastToRenderer('boot:stage', lastBootStage);
}

/** shutdown 幂等：正常路径、capture 超时与 before-quit 可能都走到。 */
function shutdownServicesOnce() {
  if (!services) return Promise.resolve();
  if (!shutdownPromise) shutdownPromise = Promise.resolve(services.shutdown()).catch(() => {});
  return shutdownPromise;
}

/** capture 期间被改过的 ui 偏好，收尾时显式还原；重复调用只有第一次生效。 */
async function restoreCaptureUiSnapshot() {
  if (!captureUiSnapshot) return;
  const snap = captureUiSnapshot;
  captureUiSnapshot = null;
  if (!services || !services.store || typeof services.store.updateSettings !== 'function') return;
  try {
    await services.store.updateSettings({ ui: snap });
    process.stdout.write('[capture] 已还原 ui 设置快照（截图场景不污染用户偏好）\n');
  } catch (e) {
    process.stdout.write('[capture] ui 设置还原失败：' + ((e && e.message) || e) + '\n');
  }
}

/** 给用户看的启动失败原因：只取第一行，英文堆栈留给 stderr，不直接甩给用户。 */
function startupErrorMessage(e) {
  const raw = (e && e.message) ? e.message : String(e || '');
  const first = String(raw).split('\n')[0].trim();
  if (!first) return '程序启动失败，请重新启动 PrintShelf';
  if (/[\u4e00-\u9fa5]/.test(first)) return first;
  return '程序启动失败：' + first + '。请重新启动；若反复出现，请把这段信息反馈给我。';
}

/**
 * 目录监视（chokidar 递归扫描）不进启动关键路径：以前它在 services.init 里同步建立，
 * 监控目录大或在机械盘 / 网络盘上会明显拖慢进入软件。首屏画完后再后台启动。
 */
function scheduleBackgroundWatch() {
  setTimeout(() => {
    if (!services || !services.initialized) return;
    try { services.startBackground(); } catch (_) { /* 监视失败不影响使用 */ }
  }, 350);
}

/**
 * 快造用户预设保护：内容变了留一份快照，数量变少会提示。
 * 必须在 services.init 完成之后才可能触发 —— 窗口现在先于 init 创建，
 * 若挂在 did-finish-load 上直接调，极端情况下会打到尚未初始化的 service。
 */
function schedulePresetCheck() {
  const w = mainWindow;
  if (!w || w.isDestroyed()) return;
  const run = () => setTimeout(() => {
    if (!services || !services.initialized) return;
    try { Promise.resolve(services.u1PresetAutoCheck()).catch(() => {}); }
    catch (_) { /* 预设检查失败不影响启动 */ }
  }, 1500);
  const wc = w.webContents;
  if (wc.isLoading()) wc.once('did-finish-load', run);
  else run();
}

/**
 * 旧库耗材颜色回填：解析层升级后，已入库的记录还没有 meta.filamentColors。
 * 放在 app:ready 之后且不 await —— 启动动画与首屏刷新都不等它。
 * 回填内部一次性写库，只触发一次 lib:changed，所以色板会在后台自然出现。
 */
function scheduleColorBackfill() {
  if (!services || !services.initialized || !services.store) return;
  setTimeout(() => {
    if (!services || !services.initialized || !services.store) return;
    try { Promise.resolve(backfillFilamentColors(services.store)).catch(() => {}); }
    catch (_) { /* 回填失败不影响启动 */ }
  }, 1200);
}

/**
 * 启动后回填「切片重量」：旧版解析器入库的记录没有 meta.weightG，
 * 而增量扫描又因为 size/mtime 未变整条跳过，导致卡片一直显示 ¥??。
 * 只重解析没重量且没标记 checked 的记录，整批写一次库。
 */
function scheduleWeightBackfill() {
  if (!services || !services.initialized || !services.store) return;
  setTimeout(() => {
    if (!services || !services.initialized || !services.store) return;
    try {
      Promise.resolve(backfillWeights(services.store))
        .then((r) => {
          if (r && r.updated > 0) {
            process.stdout.write('[weights] 回填 ' + r.updated + ' 条模型重量（识别到重量的 ' +
              (r.scanned - r.failed) + ' 条已重解析）\n');
          }
        })
        .catch(() => {});
    } catch (_) { /* 回填失败不影响启动 */ }
  }, 1800);
}

/**
 * 启动后回填「来源网页」：老记录入库时还没解析这个字段，3MF 里其实一直带着。
 * 只处理 sourceUrl 为空的记录，整批写一次库；已经有链接的一条都不碰。
 */
function scheduleSourceUrlBackfill() {
  if (!services || !services.initialized || !services.store) return;
  setTimeout(() => {
    if (!services || !services.initialized || !services.store) return;
    try {
      Promise.resolve(backfillSourceUrls(services.store))
        .then((r) => {
          if (r && r.updated > 0) {
            process.stdout.write('[source-url] 回填 ' + r.updated + ' 条来源链接\n');
          }
        })
        .catch(() => {});
    } catch (_) { /* 回填失败不影响启动 */ }
  }, 2400);
}

/**
 * 启动后给还没关联模型的回执补一次自动关联。
 * 之前只在「打印完成那一刻」尝试匹配，一次没匹配上就永远空着；
 * 现在每次启动兜一次，用户新导入模型后老回执也能自己连上（2026-11-24）。
 */
function scheduleReceiptAutoLink() {
  if (!services || !services.initialized) return;
  // 截图走查期间不做后台写库：探针要观察稳定状态，不能被 3 秒后的自动关联改掉
  if (capturePath) return;
  setTimeout(() => {
    if (!services || !services.initialized) return;
    try {
      // 先补录历史漏记（从监控采样里找打完但没记账的），再做自动关联
      Promise.resolve(services.receiptsBackfillFromMonitor())
        .then((r) => {
          if (r && r.created > 0) {
            process.stdout.write('[receipts] 补录 ' + r.created + ' 条漏记的打印回执\n');
          }
        })
        .catch(() => {})
        .then(() => services && services.receiptsAutoLink())
        .then((r) => {
          if (r && r.linked > 0) {
            process.stdout.write('[receipts] 自动关联 ' + r.linked + ' 条打印回执\n');
          }
        })
        .catch(() => {});
    } catch (_) { /* 关联失败不影响启动 */ }
  }, 3000);
}

/**
 * 启动后给「未分类」补一次自动分类（用户要求每次打开软件跑一次）。
 * 延迟 1.6 秒、异步、整批只写一次库；没有未分类时连库都不写。
 * 与扫描时的即时分类共用 classify.js，规则只从设置里读一次。
 */
function scheduleAutoClassify() {
  if (!services || !services.initialized || !services.store) return;
  let cfg;
  try { cfg = classify.configOf(services.store.getSettings()); }
  catch (_) { return; }
  if (!cfg.enabled || !cfg.onStartup) return;
  setTimeout(() => {
    if (!services || !services.initialized || !services.store) return;
    try {
      Promise.resolve(classify.classifyUncategorized(services.store))
        .then((stat) => {
          if (stat && stat.assigned > 0) {
            process.stdout.write('[classify] 启动自动分类：' + stat.assigned + ' 个\n');
          }
          // 「未匹配」提示由渲染层首屏后主动查（app.js 的 scheduleUnmatchedCheck）。
          // 这里只负责把能分的分好：主进程推事件的方案实测会撞上渲染层注册时序，已放弃。
        })
        .catch(() => {});
    } catch (_) { /* 分类失败不影响启动 */ }
  }, 1600);
}

// ---------------- 协议：渲染层静态资源 + 缩略图 ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function fileResponse(file, cacheControl = 'no-cache') {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('Not Found', { status: 404 });
    }
    const ext = path.extname(file).toLowerCase();
    const data = new Uint8Array(fs.readFileSync(file));
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': cacheControl,
      },
    });
  } catch (e) {
    return new Response('Internal Error', { status: 500 });
  }
}

function registerProtocols() {
  protocol.handle('app', (request) => {
    let rel;
    try { rel = decodeURIComponent(new URL(request.url).pathname || ''); }
    catch (_) { return new Response('Bad URL', { status: 400 }); }
    rel = rel.replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(RENDERER_ROOT, rel);
    if (file !== RENDERER_ROOT && !file.startsWith(RENDERER_ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return fileResponse(file);
  });

  protocol.handle('shelf', (request) => {
    let url;
    let rel;
    try {
      url = new URL(request.url);
      rel = decodeURIComponent(url.pathname || '');
    } catch (_) { return new Response('Bad URL', { status: 400 }); }
    const name = path.basename(rel);
    if (!name || name === '.' || name === '..') return new Response('Not Found', { status: 404 });
    // 耗材图片（docs/13）：与缩略图同样按内容哈希命名，同样 immutable。
    // 注意 shelf 是 standard 协议：shelf://filaments/xx.jpg 里的 filaments 是「主机名」，
    // pathname 只有 /xx.jpg。只判断 rel 前缀会永远落到缩略图目录，图片全部 404（2026-11-24 实测）。
    const host = String(url.hostname || '').toLowerCase();
    const isFilamentImg = host === 'filaments' || /^\/?filaments\//i.test(rel);
    if (isFilamentImg) {
      return fileResponse(path.join(cpaths.getFilamentImagesDir(), name),
        'public, max-age=31536000, immutable');
    }
    // 缩略图文件名是内容哈希，内容不变路径就不变：声明为不可变资源。
    // 以前一律 no-cache，卡片每次重建都会重读并重新解码几百张 PNG，是明显的首屏/滚动瓶颈。
    return fileResponse(path.join(cpaths.getThumbsDir(), name),
      'public, max-age=31536000, immutable');
  });
}

// ---------------- 窗口 ----------------

function createWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    // 正常启动保持原来的最小尺寸；只有走查截图才允许缩到断点以下
    minWidth: capturePath ? Math.min(1000, winWidth) : 1000,
    minHeight: capturePath ? Math.min(640, winHeight) : 640,
    frame: false,
    show,
    backgroundColor: '#f7f8fc',
    title: '3MF模型管理器 · 本地 3MF 模型库',
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 只用到 contextBridge / ipcRenderer，开沙箱不影响功能；
      // 没有这一层，渲染层一旦被注入就等于拿到完整 Node 权限。
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // 渲染层日志转发到主进程控制台，便于排查界面问题
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    process.stdout.write('[renderer:' + level + '] ' + message + '  (' + sourceId + ':' + line + ')\n');
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    process.stdout.write('[preload-error] ' + p + ' :: ' + (err && err.message) + '\n');
  });

  win.webContents.on('did-finish-load', () => {
    // 后端可能比页面更早就绪（成功或失败）；补发当前状态与最近的 boot:stage，
    // 保证 preload 在 document-start 的监听一定能拿到终态。
    replayStartupState(win);
  });
  // capture/走查模式下带 query：渲染层据此跳过「未匹配提示」弹窗，
  // 否则弹窗会挡住其它探针要点的按钮。需要截这个弹窗的探针自己调
  // window.__printshelfPromptUnmatched([...]) 手动触发。
  win.loadURL(APP_ORIGIN + '/index.html' + (capturePath ? '?capture=1' : ''));
  // 协议注册失败或静态资源缺失时，以前就是一个纯白窗口，用户完全不知道发生了什么
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    process.stdout.write('[did-fail-load] ' + code + ' ' + desc + ' :: ' + url + '\n');
    if (isSmoke || capturePath) return;
    try {
      dialog.showErrorBox('界面加载失败',
        '无法加载应用界面（错误码 ' + code + '：' + desc + '）。\n\n'
        + '通常是安装不完整或被杀毒软件拦截，建议重新解压/安装 PrintShelf。');
    } catch (_) { /* 忽略 */ }
  });

  // 阻止拖拽文件导致窗口导航、以及任何外部跳转
  win.webContents.on('will-navigate', (e, url) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(url).origin === APP_ORIGIN; } catch (_) { sameOrigin = false; }
    if (!sameOrigin) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  return win;
}

/**
 * 打印完成 / 异常的系统通知。
 * 判定（状态转移、去重、分项开关）全在 core/monitor.js，这里只负责把它弹到系统通知中心。
 * 通知中心不可用时应用内还有 toast，不会彻底丢提醒；走查/自检模式不弹，避免干扰自动化。
 */
function showSystemNotification(n) {
  if (!n || n.system === false || isSmoke || capturePath) return;
  if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) return;
  try {
    const note = new Notification({
      title: String(n.title || '3MF模型管理器'),
      body: String(n.body || ''),
      icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
      silent: false,
    });
    note.on('click', () => {
      const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
    });
    note.show();
  } catch (_) { /* 通知中心不可用时忽略，还有应用内 toast */ }
}

function bridgeEvents() {
  services.on('event', (channel, payload) => {
    if (channel === 'printers:notify') showSystemNotification(payload);
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.webContents) w.webContents.send(channel, payload);
    }
  });
}

// ---------------- 自检 / 截图 ----------------

async function runSmoke() {
  const out = { ok: false, stage: 'init', ipcHandlers: 0, protocol: false };
  startupLog('smoke start dataDir=' + cpaths.getDataDir() + ' packaged=' + app.isPackaged);
  try {
    cpaths.ensureDirs();
    registerProtocols();
    out.protocol = true;

    out.stage = 'services';
    await services.init({ autoWatch: false });
    out.stage = 'ipc';
    ipcMethods = registerIpc(services, { getWindow: () => mainWindow });
    bridgeEvents();
    // 打印机轮询：截图走查与正常启动都要有，否则设备页永远显示离线
    try { services.printers.start(); } catch (_) { /* 没配打印机也不影响启动 */ }
    out.ipcHandlers = ipcMethods.length;

    out.stage = 'scan';
    // 开发期用整个工作区作样本，覆盖拓竹原生 / 极简 / 校验件等全部真实形态；
    // 打包版没有工作区，改为读 --smoke-seed=<目录>，没给就跳过扫描（配合 --smoke-allow-empty 判定）。
    const seedArg = argv.find((a) => a.startsWith('--smoke-seed='));
    const seed = seedArg
      ? path.resolve(seedArg.slice('--smoke-seed='.length))
      : (app.isPackaged ? null : path.resolve(__dirname, '..', '..'));
    let report = { added: 0, updated: 0, missing: 0, failed: 0, duplicateGroups: 0, duration: 0 };
    if (seed && fs.existsSync(seed)) {
      await services.folderAdd(seed);
      report = await services.scanner.scanAll({ force: false });
    }
    out.seed = seed;
    out.scan = {
      added: report.added, updated: report.updated, missing: report.missing,
      failed: report.failed, duplicates: report.duplicateGroups, durationMs: report.duration,
    };

    out.stage = 'verify';
    const stats = services.library.stats();
    out.library = { total: stats.total, totalSize: stats.totalSize, missing: stats.missing };
    out.thumbs = services.thumbs.stats();
    out.query = (() => {
      const r = services.library.query({ keyword: '', smart: 'all' });
      return { total: r.total, first: r.items[0] ? r.items[0].fileName : null };
    })();
    out.slicersDetected = (await services.slicer.detect()).length;
    out.bootstrapKeys = Object.keys(services.bootstrap()).sort();

    out.ok = out.ipcHandlers >= 50 && out.protocol &&
      (argv.includes('--smoke-allow-empty') || (stats.total > 0 && out.thumbs.count > 0));
    out.stage = 'done';
  } catch (e) {
    out.error = (e && e.stack) ? e.stack : String(e);
  }
  process.stdout.write('\n=== PRINTSHELF_SMOKE_RESULT ===\n' + JSON.stringify(out, null, 2) + '\n=== END ===\n');
  startupLog('smoke result ok=' + out.ok + ' stage=' + out.stage +
    ' handlers=' + out.ipcHandlers + (out.error ? ' err=' + String(out.error).split('\n')[0] : ''));
  return out;
}

async function ensureSeedData() {
  // 只在调用方显式传 --seed 时才会走到这里；这里再保留一层否决，
  // 破坏性测试（删除/移入回收站）加 --no-seed 就绝不会把工作区真实 3mf 灌进测试库。
  if (argv.includes('--no-seed')) return;
  // 打包版没有「工作区」这个概念，不能把 resources/app 当样本目录写进用户设置
  if (app.isPackaged) return;
  const stats = services.library.stats();
  if (stats.total > 0) return;
  const sample = path.resolve(__dirname, '..', '..');
  if (!fs.existsSync(sample)) return;
  try {
    await services.folderAdd(sample);
    await services.scanner.scanAll({ force: false });
  } catch (e) {
    console.warn('[PrintShelf] 示例数据扫描失败：', e.message);
  }
}

async function runCapture(target) {
  // 窗口已在启动阶段创建（这样启动动画能覆盖 services.init / 示例扫描），这里复用它
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow({ show: true });
  const wc = mainWindow.webContents;
  await new Promise((resolve) => {
    if (!wc.isLoading()) return resolve();
    wc.once('did-finish-load', resolve);
    setTimeout(resolve, 8000); // 兜底，避免卡死
  });
  // 等待 bootstrap + 首次查询 + 图片解码完成
  await new Promise((r) => setTimeout(r, 2600));

  // capture 的 --ui=<场景> 会点击真实的视图切换按钮，而 toolbar.js 会把
  // ui.view 写进 settings.json。截图/走查是自动化工具，不该改用户偏好：
  // 先快照整份 ui，收尾时显式写回（沿用探针的「整份快照 + 显式还原」约定）。
  captureUiSnapshot = null;
  if (uiScenario) {
    try {
      const cur = services && services.store ? services.store.getSettings() : null;
      if (cur && cur.ui) captureUiSnapshot = JSON.parse(JSON.stringify(cur.ui));
    } catch (_) { captureUiSnapshot = null; }
  }

  // 诊断：主动触发一次刷新并读取真实 DOM 状态，便于定位渲染层问题
  try {
    const diag = await wc.executeJavaScript(`(async () => {
      const out = { hasShelf: !!window.shelf, readyState: document.readyState };
      const q = (s) => document.querySelector(s);
      const snap = () => ({
        contentChildren: q('#content') ? q('#content').children.length : -1,
        navLibrary: q('#nav-library') ? q('#nav-library').children.length : -1,
        navCategories: q('#nav-categories') ? q('#nav-categories').children.length : -1,
        statsBar: q('#stats-bar') ? q('#stats-bar').children.length : -1,
        statusCount: q('#status-count') ? q('#status-count').textContent : null,
        emptyHidden: q('#empty-state') ? q('#empty-state').hidden : null,
      });
      Object.assign(out, { before: snap() });
      const box = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
      const media = q('.card-media');
      const img = q('.card-img');
      out.card = { card: box(q('.card')), media: box(media),
        aspect: media ? getComputedStyle(media).aspectRatio : null,
        cardW: getComputedStyle(document.documentElement).getPropertyValue('--card-w') };
      out.img = img ? { src: img.getAttribute('src'), complete: img.complete,
        naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        box: box(img), currentSrc: img.currentSrc } : null;
      try { const r = await window.shelf.query({}); out.queryTotal = r && r.total; }
      catch (e) { out.queryError = String((e && e.message) || e); }
      try { const s = await window.shelf.stats(); out.statsTotal = s && s.total; }
      catch (e) { out.statsError = String((e && e.message) || e); }
      window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason: 'diagnose' } }));
      await new Promise((r) => setTimeout(r, 1500));
      Object.assign(out, { after: snap() });
      return out;
    })()`, true);
    process.stdout.write('\n=== PRINTSHELF_UI_DIAG ===\n' + JSON.stringify(diag, null, 2) + '\n=== END ===\n');
  } catch (e) {
    process.stdout.write('\n=== PRINTSHELF_UI_DIAG_ERROR ===\n' + (e && e.stack ? e.stack : e) + '\n=== END ===\n');
  }

  // 可选 UI 场景：用于自动走查详情抽屉 / 设置页 / 深色主题 / 列表视图 / 灯箱
  if (uiScenario) {
    try {
      const state = await wc.executeJavaScript(`(() => {
        const s = ${JSON.stringify(uiScenario)};
        const q = (x) => document.querySelector(x);
        // 先复位，避免场景之间互相影响
        if (q('#settings-panel')) q('#settings-panel').hidden = true;
        if (q('#detail')) q('#detail').hidden = true;
        if (q('#lightbox')) q('#lightbox').hidden = true;
        document.documentElement.setAttribute('data-theme', s === 'dark' ? 'dark' : 'light');
        if (s === 'list') q('#view-switch [data-view="list"]') && q('#view-switch [data-view="list"]').click();
        else q('#view-switch [data-view="grid"]') && q('#view-switch [data-view="grid"]').click();
        if (s === 'detail') q('.card') && q('.card').click();
        if (s === 'settings') q('#btn-settings') && q('#btn-settings').click();
        if (s === 'lightbox' && typeof window.__printshelfPreviewFirst === 'function') window.__printshelfPreviewFirst();
        return { scenario: s, theme: document.documentElement.getAttribute('data-theme') };
      })()`, true);
      process.stdout.write('[ui-scenario] ' + JSON.stringify(state) + '\n');
    } catch (e) {
      process.stdout.write('[ui-scenario] 应用失败：' + e.message + '\n');
    }
    await new Promise((r) => setTimeout(r, 900));
  }

  // 可选：执行外部脚本，用于自动化走查（点击、拖拽、读取真实 DOM 结果）
  let uiScriptFailed = false;
  if (uiScriptPath) {
    try {
      const code = fs.readFileSync(path.resolve(uiScriptPath), 'utf8');
      const r = await wc.executeJavaScript('(async () => {' + code + '\n})()', true);
      process.stdout.write('\n=== PRINTSHELF_UI_SCRIPT ===\n' + JSON.stringify(r, null, 2) + '\n=== END ===\n');
      // 探针返回 ok:false 必须让进程失败，否则 CI / 自动验收会「永远绿」。
      if (r && typeof r === 'object' && r.ok === false) uiScriptFailed = true;
    } catch (e) {
      uiScriptFailed = true;
      process.stdout.write('\n=== PRINTSHELF_UI_SCRIPT_ERROR ===\n' + (e && e.stack ? e.stack : e) + '\n=== END ===\n');
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  // 硬超时保底：截图链路在部分无显示环境会挂住，但不能再 app.exit(2)——
  // 那会绕过 ui 快照还原与 shutdown 落盘，留下半截状态。改为打标志并触发
  // 正常退出流程：before-quit 会先还原 ui、再 shutdown（落盘 + 停监视/连接）。
  let captureTimedOut = false;
  const hardTimer = setTimeout(() => {
    captureTimedOut = true;
    process.stdout.write('\n=== PRINTSHELF_CAPTURE_TIMEOUT ===\n');
    process.exitCode = 2;
    try { app.quit(); } catch (_) { app.exit(2); }
  }, 30000);

  try {
    // 相对路径按项目根目录解析（npm run capture 传 data/ui-capture.png）
    const abs = path.isAbsolute(target) ? target : path.resolve(__dirname, '..', target);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    // 让窗口处于前台，capturePage 在被遮挡时会返回 0 字节
    try {
      mainWindow.show();
      mainWindow.restore();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.moveTop();
    } catch (_) { /* 部分平台不支持 */ }
    await new Promise((r) => setTimeout(r, 700));

  let buf = null;
  let captureFailed = false;
  // 优先 CDP（不依赖窗口可见性），但必须带超时：某些环境该命令永不返回
    try {
      const dbg = wc.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      const shot = await Promise.race([
        (async () => {
          await dbg.sendCommand('Page.enable');
          return dbg.sendCommand('Page.captureScreenshot', {
            format: 'png', fromSurface: false, captureBeyondViewport: false,
          });
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CDP 截图超时')), 6000)),
      ]);
      buf = Buffer.from(shot.data || '', 'base64');
      try { dbg.detach(); } catch (_) { /* 忽略 */ }
    } catch (e) {
      process.stdout.write('[capture] CDP 不可用，改用 capturePage：' + e.message + '\n');
    }

    if (!buf || !buf.length) {
      const img = await wc.capturePage();
      buf = img.toPNG();
    }
    if (!buf || !buf.length) throw new Error('截图结果为空（窗口可能被遮挡）');

    fs.writeFileSync(abs, buf);
    process.stdout.write('\n=== PRINTSHELF_CAPTURE ===\n' + abs + ' (' + buf.length + ' bytes)\n=== END ===\n');
  } catch (e) {
    captureFailed = true;
    process.stdout.write('\n=== PRINTSHELF_CAPTURE_ERROR ===\n' + (e && e.stack ? e.stack : e) + '\n=== END ===\n');
  } finally {
    clearTimeout(hardTimer);
    // 正常结束与超时都先还原 ui（幂等）；超时时再确保 shutdown 落盘。
    // before-quit 可能已在走同一条路径，shutdownServicesOnce 保证只执行一次。
    await restoreCaptureUiSnapshot();
    if (captureTimedOut) {
      process.exitCode = 2;
      await shutdownServicesOnce();
    } else if (uiScriptFailed && !process.exitCode) {
      process.exitCode = 1;
    }
  }
}

// ---------------- 生命周期 ----------------

// smoke 用隔离的临时数据目录，允许并发；capture 必须和正常启动共用同一把锁，
// 否则两个进程会同时读写 real data 目录里的 library/settings/filaments/receipts，
// 造成互相覆盖。渲染层 UI 探针一般单独运行，拿得到锁，不受影响。
//
// 例外：capture 显式指定了 PRINTSHELF_DATA_DIR 时，它读写的是一份影子数据目录，
// 和用户正在用的 real data 不是同一份，此时再抢同一把锁只会让「用户开着软件就
// 不能跑走查」。把 userData 也切到影子目录下，锁随之分开：既不打扰已开窗口，
// 也不存在并发写同一份库的问题（2026-11-24 加）。
if (capturePath && process.env.PRINTSHELF_DATA_DIR) {
  try {
    const isoUserData = path.join(path.resolve(process.env.PRINTSHELF_DATA_DIR), '.capture-userdata');
    fs.mkdirSync(isoUserData, { recursive: true });
    app.setPath('userData', isoUserData);
  } catch (_) {
    // 切不过去就退回共享锁：安全优先，宁可拒绝启动也不并发写真实库。
  }
}
const gotLock = isSmoke ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  if (capturePath) {
    const reason = '已有 PrintShelf 实例正在运行。为避免两个进程同时改写模型库、设置、耗材与回执，'
      + '本次 --capture 截图已拒绝启动。请先关闭正在运行的 PrintShelf，再重新执行截图。';
    console.error('[PrintShelf] ' + reason);
    process.stderr.write('PRINTSHELF_CAPTURE_LOCKED ' + reason + '\n');
    startupLog('capture 拒绝启动：已有实例持有单实例锁');
  }
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    services = new Services();

    if (isSmoke) {
      const result = await runSmoke();
      await shutdownServicesOnce();
      app.exit(result.ok ? 0 : 1);
      return;
    }

    cpaths.ensureDirs();
    registerProtocols();

    // 窗口先创建：以前 services.init 期间屏幕上什么都没有，现在这段时间是分阶段启动动画。
    // 渲染层会在 app:ready 之前只显示动画、不发任何 IPC，所以不存在「handler 还没注册」。
    mainWindow = createWindow({ show: true });
    bootStage('starting', 8);

    await services.init({
      autoWatch: false,
      systemLocale: app.getLocale(),
      onStage: (name, percent) => bootStage(name, percent),
    });
    ipcMethods = registerIpc(services, { getWindow: () => mainWindow });
    bridgeEvents();
    bootStage('ipc', 78);
    // 打印机轮询：截图走查与正常启动都要有，否则设备页永远显示离线
    try { services.printers.start(); } catch (_) { /* 没配打印机也不影响启动 */ }

    // capture 默认不再灌示例数据：dev 模式下项目上层目录会被写进真实 settings.folders
    // 并触发全盘扫描。只有显式传 --seed 才灌；--no-seed 仍然可以否决。
    // 旧库回填只处理已有记录，空库上是 no-op，保持原样执行。
    if (capturePath) {
      if (argv.includes('--seed')) await ensureSeedData();
      try { await backfillFilamentColors(services.store); } catch (_) { /* 色板失败不影响截图 */ }
      try { await backfillSourceUrls(services.store); } catch (_) { /* 来源链接失败不影响截图 */ }
      try { await backfillWeights(services.store); } catch (_) { /* 重量失败不影响截图 */ }
    }
    bootStage('backend', 92);
    signalRendererReady();
    // 渲染层拿到 app:ready 后才会挂载 toast 监听，此时再排预设检查提示不会丢
    schedulePresetCheck();
    // 正常启动时回填在后台跑，不进启动关键路径
    scheduleColorBackfill();
    scheduleAutoClassify();
    scheduleSourceUrlBackfill();
    scheduleReceiptAutoLink();
    scheduleWeightBackfill();
    // 目录监视也移到后台：chokidar 的初始递归扫描不再是「进软件」的前置条件
    scheduleBackgroundWatch();

    if (capturePath) {
      await runCapture(capturePath);
      // 与正常退出共用一条优雅路径：before-quit 会再兜底还原快照 + 幂等 shutdown
      await shutdownServicesOnce();
      // Electron 在 quit 时不会把 process.exitCode 带出去（实测总是 0），
      // 探针失败 / 截图超时必须显式 app.exit(code)，否则自动验收永远「绿」。
      // shutdown 已经跑完，这里再 exit 不会丢落盘。
      const code = process.exitCode || 0;
      if (code) app.exit(code);
      else app.quit();
    }
  }).catch((e) => {
    console.error('[PrintShelf] 启动失败：', e);
    process.stderr.write('PRINTSHELF_START_ERROR ' + (e && e.stack ? e.stack : e) + '\n');
    // 明确告诉渲染层「后端没起来」：preload 会 reject whenReady 并缓存失败态，
    // 不再让 bootstrap 傻等或被 8 秒兜底放行到未注册的 IPC 上。
    signalRendererFailure(startupErrorMessage(e));
    process.exitCode = 1;
    shutdownServicesOnce().then(() => {
      // 留一点时间让 app:ready {ok:false} 真正投递到渲染层，再走优雅退出
      setTimeout(() => {
        try { app.quit(); } catch (_) { app.exit(1); }
      }, 200);
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
    // 退出前必须等落盘：store 保存有 200ms 防抖、watcher 停止是异步的，
  // 直接退出会把队列里的写入丢掉（表现为「刚改的备注/分类重启后没了」）。
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !services) return;
    e.preventDefault();
    quitting = true;
    Promise.resolve()
      .then(() => restoreCaptureUiSnapshot()) // capture 改过的 ui 偏好先还原
      .then(() => shutdownServicesOnce())     // 落盘 + 停 watcher/连接（幂等）
      .catch(() => {})
      .then(() => app.quit());
  });
}

process.on('uncaughtException', (e) => {
  console.error('[PrintShelf] 未捕获异常：', e);
  // 主进程状态已不可信：静默继续只会在后面以白屏/丢数据的形式暴露。
  // 这里给一句人话，然后走正常的退出流程（before-quit 会先把数据落盘）。
  if (!isSmoke && !capturePath) {
    try {
      dialog.showErrorBox('PrintShelf 遇到意外错误',
        '程序内部发生未处理的异常，需要重新启动。\n\n'
        + '你的模型文件和索引不会因此被改动；重启后如仍复现，请把下面的信息发给我：\n\n'
        + ((e && (e.stack || e.message)) || String(e)).slice(0, 1200));
    } catch (_) { /* 弹窗失败也只能退出 */ }
    try { app.quit(); } catch (_) { /* 忽略 */ }
  }
});
process.on('unhandledRejection', (e) => {
  console.error('[PrintShelf] 未处理的 Promise 拒绝：', e);
});
