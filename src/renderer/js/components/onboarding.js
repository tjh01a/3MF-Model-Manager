'use strict';
/**
 * 首次启动向导 + 新手引导（2026-11-19）。
 *
 * 为什么需要：
 *   这个软件原本的用法是「先手动添加目录，再扫描」，对不熟悉 3MF 工具的朋友门槛偏高。
 *   向导把这一步收敛成「勾几个盘 → 开始扫描 → 进入模型库」，并把结果写进设置，
 *   下次启动直接进库，不再打扰。
 *
 * 设计约束：
 *   1. 只在「首次使用」出现：settings.onboard.done 为真、或模型库已有数据，都不弹。
 *      老用户升级上来时库里有数据，会被静默标记为已完成，不会莫名弹窗。
 *   2. 「稍后」也要写 done，避免每次启动都拦一次；设置页提供「重新运行初始化向导」。
 *   3. 扫描是整盘递归，代价高：默认不勾系统盘，并给三档深度，把选择权交给用户。
 *   4. 全程可用 Esc 退出；扫描中退出会取消扫描，不留后台任务。
 */
import { api, emitToast, emitRefresh } from '../api.js';
import { state } from '../state.js';
import { icon, escapeHtml } from '../utils.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

const DEPTHS = [
  { key: 'fast', label: '快速', depth: 4, hint: '只看 4 层子文件夹，几十秒出结果' },
  { key: 'standard', label: '标准', depth: 8, hint: '推荐：一般模型库都在 8 层以内' },
  { key: 'deep', label: '深入', depth: 12, hint: '藏得很深的目录也能扫到，但更慢' },
];

let mounted = false;
let overlay = null;
let step = 1;
let busy = false;
let depthKey = 'standard';
let drives = [];
let selected = new Set();
let extras = [];
let scanListener = null;
let lastReport = null;
let lastTotal = 0;
let guideLayer = null;
let guideIdx = 0;

// ---------------- 挂载 ----------------

export function mountOnboarding() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  overlay = document.createElement('div');
  overlay.id = 'onboarding';
  overlay.className = 'ob-overlay';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title"></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', () => { if (guideLayer) positionGuide(); });
}

export function isOnboardingOpen() {
  return !!(overlay && !overlay.hidden);
}

/** 启动时判断：要不要弹向导 */
export async function maybeStartOnboarding() {
  if (!mounted) mountOnboarding();
  const ob = (state.settings && state.settings.onboard) || {};
  if (ob.done === true) return false;
  const total = Number((state.stats && state.stats.total) || 0);
  if (total > 0) {
    // 老用户升级：库里已有模型，直接标记完成，不打扰
    try { await api.settingsUpdate({ onboard: { done: true, at: Date.now(), migrated: true } }); } catch (_) {}
    if (state.settings) state.settings.onboard = { ...(state.settings.onboard || {}), done: true };
    return false;
  }
  startOnboarding();
  return true;
}

/** 强制打开（设置页「重新运行初始化向导」/ 探针） */
export function startOnboarding(opts) {
  if (!mounted) mountOnboarding();
  const force = !!(opts && opts.force);
  if (!force && state.settings && state.settings.onboard && state.settings.onboard.done === true) return;
  step = 1;
  busy = false;
  selected = new Set();
  extras = [];
  lastReport = null;
  depthKey = 'standard';
  overlay.hidden = false;
  render();
}

export function closeOnboarding() {
  if (!overlay) return;
  overlay.hidden = true;
  detachScan();
}

// ---------------- 持久化 ----------------

async function persistDone(extra) {
  const patch = {
    onboard: { done: true, at: Date.now(), ...(extra || {}) },
  };
  try {
    const s = await api.settingsUpdate(patch);
    if (s && state.settings) state.settings = s;
  } catch (_) { /* 写失败不影响本次使用，下次可能再问一次 */ }
}

// ---------------- 渲染 ----------------

function dots(n) {
  return '<div class="ob-dots">' + [1, 2, 3].map((i) =>
    '<span class="ob-dot' + (i <= n ? ' on' : '') + '"></span>').join('') + '</div>';
}

function head(kicker, title, sub) {
  return '<div class="ob-head">' + dots(step) +
    '<div class="ob-kicker">' + esc(kicker) + '</div>' +
    '<h2 class="ob-title" id="ob-title">' + esc(title) + '</h2>' +
    (sub ? '<p class="ob-sub">' + sub + '</p>' : '') +
    '</div>';
}

function render() {
  if (!overlay) return;
  const card = overlay.querySelector('.ob-card');
  const skip = step < 3 ? '<button class="ob-skip" data-ob="later">稍后再说</button>' : '';
  let html = skip;
  if (step === 1) html += stepWelcome();
  else if (step === 2) html += stepDrives();
  else html += stepScan();
  card.innerHTML = html;
  // 聚焦主按钮，键盘用户回车即可继续
  const primary = card.querySelector('.ob-foot .btn-primary');
  if (primary) primary.focus();
}

function stepWelcome() {
  return head('第 1 步 · 共 3 步', '先把你的 3MF 找出来',
    'PrintShelf 是一个纯本地模型库：文件不上传、不联网，索引和缩略图都留在你自己的电脑里。') +
    '<div class="ob-body">' +
      '<div class="ob-points">' +
        point('i-folder', '选盘或选文件夹', '告诉它模型放在哪个盘、哪个目录，可以多选。') +
        point('i-search', '自动识别 3MF', '扫描时按体积与修改时间增量更新，重复扫不会重复入库。') +
        point('i-sparkle', '自动分类 + 成本估算', '按词库把模型分好类，还能按耗材单价估算每个模型花多少钱。') +
      '</div>' +
    '</div>' +
    '<div class="ob-foot"><span class="spacer"></span>' +
      '<button class="btn btn-primary" data-ob="next">开始设置</button>' +
    '</div>';
}

function point(ico, title, desc) {
  return '<div class="ob-point">' + icon(ico) + '<div><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div></div>';
}

function stepDrives() {
  const list = drives.length
    ? drives.map(driveRow).join('')
    : '<div class="ob-empty">没有探测到可用盘符。可以点下面的「添加指定文件夹」手动选择。</div>';
  const extrasHtml = extras.length
    ? '<div class="ob-extras">' + extras.map((p, i) =>
        '<div class="ob-extra" title="' + esc(p) + '">' + icon('i-folder') +
        '<span>' + esc(p) + '</span>' +
        '<button class="icon-btn" data-ob="rm-extra" data-i="' + i + '" title="移除">' + icon('i-close') + '</button></div>').join('') + '</div>'
    : '';
  const picked = selected.size + extras.length;
  return head('第 2 步 · 共 3 步', '选择要扫描的盘',
    '勾选存放模型的盘就行。整盘扫描会遍历子文件夹，只勾需要的盘会快很多。') +
    '<div class="ob-body">' +
      '<div class="ob-label">本机盘符</div>' +
      '<div class="ob-drives">' + list + '</div>' +
      '<div class="ob-row">' +
        '<button class="btn btn-ghost btn-sm" data-ob="pick-folder">' + icon('i-plus') + '<span>添加指定文件夹</span></button>' +
      '</div>' + extrasHtml +
      '<div class="ob-label">扫描深度</div>' +
      '<div class="ob-depth">' + DEPTHS.map((d) =>
        '<button class="ob-chip' + (depthKey === d.key ? ' on' : '') + '" data-ob="depth" data-key="' + d.key + '" title="' + esc(d.hint) + '">' +
        esc(d.label) + '</button>').join('') + '</div>' +
      '<p class="ob-sub" style="margin-top:10px">' + esc((DEPTHS.find((d) => d.key === depthKey) || DEPTHS[1]).hint) + '</p>' +
    '</div>' +
    '<div class="ob-foot">' +
      '<button class="btn btn-ghost" data-ob="back">上一步</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-primary" data-ob="scan"' + (picked ? '' : ' disabled') + '>' +
        (picked ? '开始扫描' : '先选一个位置') + '</button>' +
    '</div>';
}

function driveRow(d) {
  const on = selected.has(d.path);
  const gb = (n) => (n == null ? '' : (n / 1073741824).toFixed(n / 1073741824 >= 100 ? 0 : 1) + ' GB');
  const meta = d.total != null
    ? '剩余 ' + gb(d.free) + ' / 共 ' + gb(d.total)
    : '容量未知（网络盘或权限受限）';
  return '<label class="ob-drive' + (on ? ' on' : '') + '" data-ob="drive" data-path="' + esc(d.path) + '">' +
    '<input type="checkbox"' + (on ? ' checked' : '') + '>' +
    '<span class="ob-check">' + icon('i-check') + '</span>' +
    '<span class="ob-drive-main">' +
      '<span class="ob-drive-name">' + esc(d.letter) +
        (d.system ? '<span class="ob-tag">系统盘 · 文件多</span>' : '') + '</span>' +
      '<span class="ob-drive-meta">' + esc(meta) + '</span>' +
    '</span></label>';
}

function stepScan() {
  const done = !!lastReport;
  if (!done) {
    return head('第 3 步 · 共 3 步', '正在扫描模型',
      '第一次扫描大目录会久一点，之后都是增量更新。可以随时取消。') +
      '<div class="ob-body">' +
        '<div class="ob-progress">' +
          '<div class="ob-bar' + (scanPercent == null ? ' indeterminate' : '') + '">' +
            '<i style="width:' + (scanPercent == null ? 35 : Math.max(3, Math.min(100, scanPercent))) + '%"></i></div>' +
          '<div class="ob-progress-text">' +
            '<span class="path" id="ob-current">' + esc(scanMessage || '准备中…') + '</span>' +
            '<span class="ob-count" id="ob-count">' + esc(scanCountText || '') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ob-foot"><span class="spacer"></span>' +
        '<button class="btn btn-ghost" data-ob="cancel">取消扫描</button>' +
      '</div>';
  }
  const added = Number(lastReport.added || 0);
  const updated = Number(lastReport.updated || 0);
  const failed = Number(lastReport.failed || 0);
  const total = Number(lastTotal || 0);
  const none = total === 0;
  return head('完成 · 共 3 步', none ? '没有找到 3MF 文件' : '扫描完成',
    none ? '可能选错了盘，或者模型还没下载到这台电脑。你可以重新选一个位置。' : '以后新下载的模型放进来，启动时会自动增量扫描。') +
    '<div class="ob-body">' +
      '<div class="ob-result">' +
        '<div class="ob-result-icon' + (none ? '' : ' ok') + '">' + icon(none ? 'i-alert' : 'i-check') + '</div>' +
        '<div>' +
          '<div class="ob-result-num">' + (none ? '0' : String(total)) + ' 个模型</div>' +
          '<div class="ob-result-note">本次新增 ' + added + ' · 更新 ' + updated + (failed ? ' · 失败 ' + failed : '') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ob-foot">' +
      '<button class="btn btn-ghost" data-ob="restart">重新选择</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-primary" data-ob="finish">' + (none ? '进入模型库' : '进入模型库') + '</button>' +
    '</div>';
}

// ---------------- 扫描进度状态 ----------------

let scanPercent = null;
let scanMessage = '';
let scanCountText = '';

function onScanProgress(d) {
  if (d && d.done) {
    lastReport = d.report || { added: 0 };
    scanPercent = 100;
    if (step === 3) render();
    return;
  }
  const pct = Number(d && d.percent);
  scanPercent = Number.isFinite(pct) ? pct : null;
  scanMessage = (d && (d.message || d.phase)) || '扫描中…';
  const cur = Number(d && d.current) || 0;
  const tot = Number(d && d.total) || 0;
  scanCountText = tot ? cur + ' / ' + tot : (cur ? String(cur) : '');
  // 只更新文字，不整块重绘（重绘会掉进度条动画）
  if (step === 3 && !lastReport) {
    const curEl = document.getElementById('ob-current');
    const cntEl = document.getElementById('ob-count');
    const bar = document.querySelector('#onboarding .ob-bar');
    if (curEl) curEl.textContent = scanMessage;
    if (cntEl) cntEl.textContent = scanCountText;
    if (bar) {
      bar.classList.toggle('indeterminate', scanPercent == null);
      const fill = bar.querySelector('i');
      if (fill) fill.style.width = (scanPercent == null ? 35 : Math.max(3, Math.min(100, scanPercent))) + '%';
    }
  }
}

function attachScan() {
  if (scanListener) return;
  scanListener = (e) => onScanProgress((e && e.detail) || {});
  window.addEventListener('shelf:scanprogress', scanListener);
}

function detachScan() {
  if (scanListener) window.removeEventListener('shelf:scanprogress', scanListener);
  scanListener = null;
}

// ---------------- 行为 ----------------

async function ensureDrives() {
  if (drives.length) return;
  try {
    drives = await api.drivesList();
  } catch (_) {
    drives = [];
  }
  // 默认勾非系统盘；只有系统盘时勾上它（用户至少能继续）
  const nonSys = drives.filter((d) => !d.system);
  const pool = nonSys.length ? nonSys : drives;
  for (const d of pool) selected.add(d.path);
}

async function beginScan() {
  if (busy) return;
  busy = true;
  lastReport = null;
  scanPercent = null;
  scanMessage = '准备扫描…';
  scanCountText = '';
  step = 3;
  render();
  attachScan();

  const depth = (DEPTHS.find((d) => d.key === depthKey) || DEPTHS[1]).depth;
  try {
    await api.settingsUpdate({ scan: { maxDepth: depth } });
  } catch (_) { /* 深度写失败就用原有设置 */ }

  // 先把选中的盘 / 文件夹写进监控目录，再统一扫描
  const paths = [...selected];
  for (const p of extras) paths.push(p);
  const added = [];
  for (const p of paths) {
    try {
      const f = await api.folderAdd(p);
      if (f) added.push(f.path);
    } catch (_) { /* 单个目录失败不影响其它 */ }
  }
  if (!added.length) {
    // 一个都没加成功：给个明确的失败结果，而不是卡在进度条
    lastReport = { added: 0, updated: 0, failed: paths.length };
    lastTotal = Number((state.stats && state.stats.total) || 0);
    busy = false;
    detachScan();
    render();
    return;
  }
  try {
    await api.scanStart({ force: false });
    if (!lastReport) {
      // 极端情况下没收到 done 事件：主动兜底查一次统计
      lastReport = { added: 0, updated: 0, failed: 0 };
    }
  } catch (e) {
    lastReport = { added: 0, updated: 0, failed: paths.length, error: (e && e.message) || String(e) };
  }
  try {
    const stats = await api.stats();
    lastTotal = Number((stats && stats.total) || 0);
  } catch (_) {
    lastTotal = Number((state.stats && state.stats.total) || 0);
  }
  busy = false;
  detachScan();
  render();
  emitRefresh('scan:done');
}

async function onClick(e) {
  const t = e.target;
  const btn = t && t.closest ? t.closest('[data-ob]') : null;
  if (!btn) return;
  const act = btn.getAttribute('data-ob');

  if (act === 'drive') {
    e.preventDefault();
    const p = btn.getAttribute('data-path');
    if (selected.has(p)) selected.delete(p); else selected.add(p);
    // 只切自己的 on 类，避免整块重绘导致滚动位置跳动
    btn.classList.toggle('on', selected.has(p));
    const input = btn.querySelector('input');
    if (input) input.checked = selected.has(p);
    updateScanButton();
    return;
  }

  if (act === 'depth') {
    depthKey = btn.getAttribute('data-key') || 'standard';
    overlay.querySelectorAll('[data-ob="depth"]').forEach((b) => b.classList.toggle('on', b === btn));
    const hint = overlay.querySelector('.ob-body > .ob-sub');
    const d = DEPTHS.find((x) => x.key === depthKey);
    if (hint && d) hint.textContent = d.hint;
    return;
  }

  if (act === 'pick-folder') {
    try {
      const p = await api.pickFolder();
      if (p && !extras.includes(p) && !selected.has(p)) {
        extras.push(p);
        render();
      }
    } catch (err) { emitToast('error', (err && err.message) || '选择文件夹失败'); }
    return;
  }

  if (act === 'rm-extra') {
    const i = Number(btn.getAttribute('data-i'));
    if (i >= 0) extras.splice(i, 1);
    render();
    return;
  }

  if (act === 'next') { step = 2; await ensureDrives(); render(); return; }
  if (act === 'back') { step = 1; render(); return; }
  if (act === 'scan') { beginScan(); return; }

  if (act === 'cancel') {
    try { await api.scanCancel(); } catch (_) {}
    busy = false;
    detachScan();
    step = 2;
    render();
    emitToast('info', '已取消扫描');
    return;
  }

  if (act === 'restart') { step = 2; await ensureDrives(); render(); return; }

  if (act === 'later') {
    await persistDone({ skipped: true });
    closeOnboarding();
    emitToast('info', '随时可以在「设置 → 数据管理」里重新运行初始化向导');
    return;
  }

  if (act === 'finish') {
    await persistDone({ depth: depthKey });
    closeOnboarding();
    emitRefresh('scan:done');
    // 首次引导：库里有内容才讲，避免对着空白页讲三个点
    if (Number(lastTotal || (state.stats && state.stats.total) || 0) > 0) startGuide();
    return;
  }
}

function updateScanButton() {
  const btn = overlay.querySelector('[data-ob="scan"]');
  if (!btn) return;
  const n = selected.size + extras.length;
  btn.disabled = n === 0;
  btn.textContent = n ? '开始扫描' : '先选一个位置';
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (guideLayer) { e.stopPropagation(); closeGuide(true); return; }
  if (!isOnboardingOpen()) return;
  e.stopPropagation();
  if (step === 3 && !lastReport) return; // 扫描中不允许 Esc 直接关，先取消
  persistDone({ skipped: true }).then(() => closeOnboarding());
}

// ---------------- 新手引导（三步聚光灯） ----------------

const GUIDE_STEPS = [
  { sel: '#btn-quick-add', title: '添加目录', text: '以后想加新的模型文件夹，点这里。也可以直接把文件夹拖进窗口。' },
  { sel: '#nav-library', title: '全部模型与筛选', text: '左侧是模型库。分类、标签、我的视图都在这里切换。' },
  { sel: '.card[data-id]', title: '点开任意模型', text: '右侧会显示详情：可以分配耗材、填重量、估算成本，也能一键送进切片软件。' },
];

export function startGuide() {
  if (!mounted) mountOnboarding();
  guideIdx = 0;
  if (!guideLayer) {
    guideLayer = document.createElement('div');
    guideLayer.className = 'gd-layer';
    guideLayer.innerHTML = '<div class="gd-ring"></div><div class="gd-bubble"><h5></h5><p></p>' +
      '<div class="gd-foot"><span class="gd-step"></span><span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-sm" data-gd="skip">跳过</button>' +
      '<button class="btn btn-primary btn-sm" data-gd="next">下一步</button></div></div>';
    document.body.appendChild(guideLayer);
    guideLayer.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-gd]') : null;
      if (!b) return;
      if (b.getAttribute('data-gd') === 'skip') closeGuide(true);
      else {
        guideIdx += 1;
        if (guideIdx >= GUIDE_STEPS.length) closeGuide(false);
        else renderGuide();
      }
    });
  }
  guideLayer.hidden = false;
  renderGuide();
}

function renderGuide() {
  const st = GUIDE_STEPS[guideIdx];
  if (!st) { closeGuide(false); return; }
  const target = document.querySelector(st.sel);
  const ring = guideLayer.querySelector('.gd-ring');
  const bubble = guideLayer.querySelector('.gd-bubble');
  bubble.querySelector('h5').textContent = st.title;
  bubble.querySelector('p').textContent = st.text;
  bubble.querySelector('.gd-step').textContent = (guideIdx + 1) + ' / ' + GUIDE_STEPS.length;
  bubble.querySelector('[data-gd="next"]').textContent = guideIdx === GUIDE_STEPS.length - 1 ? '知道了' : '下一步';
  if (!target) {
    // 目标不存在（例如空库没有卡片）：收缩成无聚光灯的提示，仍可继续
    ring.style.cssText = 'display:none';
    bubble.style.left = 'calc(50% - 134px)';
    bubble.style.top = '38%';
    return;
  }
  ring.style.display = '';
  const r = target.getBoundingClientRect();
  const pad = 6;
  ring.style.left = (r.left - pad) + 'px';
  ring.style.top = (r.top - pad) + 'px';
  ring.style.width = (r.width + pad * 2) + 'px';
  ring.style.height = (r.height + pad * 2) + 'px';
  positionGuide();
}

function positionGuide() {
  if (!guideLayer || guideLayer.hidden) return;
  const bubble = guideLayer.querySelector('.gd-bubble');
  const st = GUIDE_STEPS[guideIdx];
  const target = st && document.querySelector(st.sel);
  if (!bubble) return;
  const bw = 268;
  const bh = bubble.offsetHeight || 140;
  if (!target) { bubble.style.left = 'calc(50% - 134px)'; bubble.style.top = '38%'; return; }
  const r = target.getBoundingClientRect();
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(12, Math.min(window.innerWidth - bw - 12, left));
  let top = r.bottom + 12;
  if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 12);
  bubble.style.left = left + 'px';
  bubble.style.top = top + 'px';
}

function closeGuide(skipped) {
  if (!guideLayer) return;
  guideLayer.hidden = true;
  if (skipped) {
    try { api.settingsUpdate({ onboard: { guideDone: true } }); } catch (_) {}
  } else {
    try { api.settingsUpdate({ onboard: { guideDone: true } }); } catch (_) {}
    emitToast('success', '小提示：随时可以点右上角 ? 或设置里的说明再看一遍');
  }
}

// 供探针/调试使用
export const __onboarding = {
  get step() { return step; },
  get lastReport() { return lastReport; },
  get lastTotal() { return lastTotal; },
  get drives() { return drives; },
  get selected() { return [...selected]; },
};
