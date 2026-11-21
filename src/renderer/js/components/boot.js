'use strict';
/**
 * 启动动画控制器。
 *
 * 动画本体全是 index.html 里的内联 CSS（首帧即画、纯 transform/opacity），这里只负责
 * 「展示哪些阶段、什么时候结束」。三条收尾路径，互不冲突、且只生效一次：
 *   1. 首轮界面渲染完成 → finishBoot('ready')，淡出后移除节点；
 *   2. 挂载 / bootstrap 抛错 → bootFailed(...)，先给一句人话再淡出；
 *   3. 12 秒硬超时 → finishBoot('timeout')，绝不让遮罩盖住界面；
 *   4. 连脚本都没加载成功 → index.html 里还有一层纯 CSS 自动隐藏兜底。
 *
 * 分阶段：主进程在启动链上推 boot:stage（api.js 转成 window 的 shelf:bootstage），
 * 这里把阶段排队、每个至少展示 STAGE_EACH_MS，让「加载一会 → 后台加载一会 → 进软件」
 * 看得见；阶段本身不阻塞任何真实工作，纯视觉节奏。
 */
const FADE_MS = 280;
const HARD_TIMEOUT_MS = 12000;
// 库小的时候首屏 300ms 就能画完，直接淡出会变成一次刺眼的闪白；给个很短的最小展示时长
const MIN_VISIBLE_MS = 460;
// 每个阶段至少展示这么久，避免几毫秒一闪而过；总时长另有上限兜底
const STAGE_EACH_MS = 200;
const MAX_STAGE_WAIT_MS = 900;

const STAGE_LABELS = {
  starting: '正在启动 PrintShelf',
  dirs: '正在准备本地数据目录',
  store: '正在读取本地模型库',
  data: '正在加载耗材与记录',
  services: '正在准备转换与设备服务',
  ipc: '正在连接应用功能',
  backend: '后端就绪，正在绘制界面',
  paint: '界面准备完成',
};

const boot = {
  startedAt: Date.now(),
  endedAt: 0,
  reason: '',
  visible: true,
  removed: false,
  stage: 'starting',
  stages: [],
};
if (typeof window !== 'undefined') window.__printshelfBoot = boot;

let finished = false;
let timer = null;
let removeTimer = null;
let stageTimer = null;
let pumping = false;
const stageQueue = [];

function root() {
  return typeof document !== 'undefined' ? document.getElementById('boot-splash') : null;
}

function applyStage({ name, percent }) {
  boot.stage = name || 'stage';
  const track = typeof document !== 'undefined' ? document.getElementById('boot-track') : null;
  const text = typeof document !== 'undefined' ? document.getElementById('boot-stage-text') : null;
  const pct = typeof document !== 'undefined' ? document.getElementById('boot-pct') : null;
  const hint = typeof document !== 'undefined' ? document.getElementById('boot-hint') : null;
  if (track) {
    track.classList.add('is-determinate');
    track.style.setProperty('--boot-pct', Math.round(percent || 0) + '%');
  }
  if (text) {
    text.textContent = STAGE_LABELS[name] || (name === 'paint' ? '界面准备完成' : '正在加载…');
    if (hint) {
      hint.classList.remove('is-changing');
      // 强制回流，让同一个节点上的动画能重播
      void hint.offsetWidth;
      hint.classList.add('is-changing');
    }
  }
  if (pct) pct.textContent = Math.round(percent || 0) + '%';
}

function pumpStage() {
  if (pumping || finished || !stageQueue.length) return;
  pumping = true;
  const next = () => {
    if (finished) { pumping = false; stageQueue.length = 0; return; }
    const s = stageQueue.shift();
    if (!s) { pumping = false; return; }
    applyStage(s);
    stageTimer = setTimeout(next, STAGE_EACH_MS);
  };
  next();
}

/** 供主进程 boot:stage 事件调用；只做视觉排队，不影响启动链路 */
export function setStage(name, percent) {
  if (finished || !name) return;
  boot.stages.push(name);
  stageQueue.push({ name, percent });
  pumpStage();
}

function finish(reason) {
  if (finished) return;
  finished = true;                 // 先占位，保证 ready/error/timeout 只有第一次生效
  if (timer) { clearTimeout(timer); timer = null; }
  if (stageTimer) { clearTimeout(stageTimer); stageTimer = null; }
  pumping = false;
  boot.reason = reason;

  const apply = () => {
    boot.endedAt = Date.now();
    boot.visible = false;
    // 收尾前把进度推到 100%，避免用户最后一眼停在 92%
    applyStage({ name: 'paint', percent: 100 });
    const el = root();
    if (!el) { boot.removed = true; return; }
    el.classList.add('is-leaving');
    el.setAttribute('aria-hidden', 'true');
    let done = false;
    const remove = () => {
      if (done) return;
      done = true;
      if (el.parentNode) el.remove();
      boot.removed = true;
    };
    el.addEventListener('transitionend', remove, { once: true });
    // transitionend 在「减少动效」或窗口被遮挡时可能不触发，定时器兜底
    removeTimer = setTimeout(remove, FADE_MS + 90);
  };
  const elapsed = Date.now() - boot.startedAt;
  const stageWait = Math.min(MAX_STAGE_WAIT_MS, stageQueue.length * STAGE_EACH_MS);
  const wait = Math.max(Math.max(0, MIN_VISIBLE_MS - elapsed), stageWait);
  if (wait) timer = setTimeout(apply, wait);
  else apply();
}

export function finishBoot(reason = 'ready') {
  finish(reason);
}

export function bootFailed(reason = 'error') {
  // 已经正常收尾了（例如先 ready 后又有异步报错）：幂等退出，别再留定时器或改结束原因
  if (finished) return;
  const el = root();
  const hint = typeof document !== 'undefined' ? document.getElementById('boot-hint') : null;
  if (el) el.classList.add('is-error');
  if (hint) hint.textContent = '启动时遇到问题，已进入主界面；如有异常可查看界面提示';
  // 留 ~900ms 让人看清提示，但仍受硬超时约束
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => finish(reason), 900);
}

/** 供诊断使用：动画是否还在、停了多久 */
export function bootStatus() {
  return { ...boot, stages: boot.stages.slice(), finished, fadeMs: FADE_MS, hasTimer: !!removeTimer };
}

if (typeof window !== 'undefined') {
  window.__printshelfBootApi = { finishBoot, bootFailed, bootStatus, setStage, hardTimeoutMs: HARD_TIMEOUT_MS };
  // 主进程推来的阶段信号（api.js 转发成 shelf:bootstage）
  window.addEventListener('shelf:bootstage', (e) => {
    const d = (e && e.detail) || {};
    if (d.ok === false) return;
    setStage(d.name, d.percent);
  });
  timer = setTimeout(() => finish('timeout'), HARD_TIMEOUT_MS);
  // 主进程已经退出 / 页面被隐藏等极端情况下，回来时也别让动画卡住
  window.addEventListener('pagehide', () => finish('pagehide'), { once: true });
}
