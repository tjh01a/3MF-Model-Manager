'use strict';
import { t as tr, getLanguage, setLanguage } from '../i18n.js';

/**
 * 首次启动向导 + 新手引导（2026-11-19）。
 *
 * 为什么需要：
 *   这个软件原本的用法是「先手动添加目录，再扫描」，对不熟悉 3MF 工具的朋友门槛偏高。
 *   向导把这一步收敛成「选一个模型文件夹 → 开始扫描 → 进入模型库」，并把结果写进设置，
 *   下次启动直接进库，不再打扰；切片软件、耗材成本作为可选配置放在完成页。
 *
 * 设计约束：
 *   1. 只在「首次使用」出现：settings.onboard.done 为真、或模型库已有数据，都不弹。
 *      老用户升级上来时库里有数据，会被静默标记为已完成，不会莫名弹窗。
 *   2. 「稍后」也要写 done，避免每次启动都拦一次；设置页提供「重新运行初始化向导」。
 *   3. 默认不勾任何盘，推荐只选一个模型文件夹；整盘扫描放进高级折叠项。
 *   4. 全程可用 Esc 退出；扫描中退出会取消扫描，不留后台任务。
 */
import { api, emitToast, emitRefresh } from '../api.js';
import { state } from '../state.js';
import { icon, escapeHtml } from '../utils.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

const DEPTHS = [
  { key: 'fast', label: tr('快速'), depth: 4, hint: tr('只看 4 层子文件夹，几十秒出结果') },
  { key: 'standard', label: tr('标准'), depth: 8, hint: tr('推荐：一般模型库都在 8 层以内') },
  { key: 'deep', label: tr('深入'), depth: 12, hint: tr('藏得很深的目录也能扫到，但更慢') },
];
const LANG_RESUME_KEY = 'printshelf.onboarding.lang-resume.v1';

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
let finalizing = false;
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
  if (ob.done === true) { clearLangResume(); return false; }
  // 从向导里切语言会 reload；先恢复到切换前那一步，不能被“库里有模型”
  // 的迁移逻辑吞掉（完成页可能已经有模型了）。
  const resume = readLangResume();
  if (resume) {
    clearLangResume();
    await restoreLangResume(resume);
    return true;
  }
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
  clearLangResume();
  step = 1;
  busy = false;
  finalizing = false;
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
  clearLangResume();
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

/**
 * 切换语言会整页 reload（模块顶层文案才能一起切），所以先把向导当前状态
 * 暂存到 sessionStorage；reload 后 maybeStartOnboarding 直接恢复到同一步。
 * 扫描进行中不允许切换，避免 reload 后扫描结果丢失。
 */
function saveLangResume() {
  try {
    sessionStorage.setItem(LANG_RESUME_KEY, JSON.stringify({
      step,
      depthKey,
      selected: [...selected],
      extras: [...extras],
      lastReport,
      lastTotal,
      at: Date.now(),
    }));
  } catch (_) { /* 隐私模式忽略 */ }
}

function readLangResume() {
  try {
    const raw = sessionStorage.getItem(LANG_RESUME_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (!r || Date.now() - Number(r.at || 0) > 5 * 60 * 1000) return null;
    return r;
  } catch (_) { return null; }
}

function clearLangResume() {
  try { sessionStorage.removeItem(LANG_RESUME_KEY); } catch (_) {}
}

async function restoreLangResume(r) {
  step = r.step === 2 ? 2 : (r.step === 3 ? 3 : 1);
  depthKey = DEPTHS.some((d) => d.key === r.depthKey) ? r.depthKey : 'standard';
  selected = new Set(Array.isArray(r.selected) ? r.selected.filter((x) => typeof x === 'string') : []);
  extras = Array.isArray(r.extras) ? r.extras.filter((x) => typeof x === 'string') : [];
  lastTotal = Number(r.lastTotal) || 0;
  lastReport = r.lastReport && typeof r.lastReport === 'object' ? r.lastReport : null;
  busy = false;
  finalizing = false;
  // 扫描中不落 resume；万一状态不完整，退回第二步，避免永远停在进度条。
  if (step === 3 && !lastReport) step = 2;
  overlay.hidden = false;
  if (step === 2) await ensureDrives();
  render();
}

async function switchLanguage(next) {
  if (next !== 'en-US' && next !== 'zh-CN') return;
  if (next === getLanguage()) return;
  if (step === 3 && !lastReport) return;   // 扫描中不切，避免丢结果
  try {
    await api.settingsUpdate({ ui: { language: next } });
  } catch (_) {
    emitToast('error', tr('切换语言失败'));
    return;
  }
  saveLangResume();
  setLanguage(next);
  // 和主界面语言按钮一致：整页重载，让模块顶层的词条也切过去。
  setTimeout(() => { api.win('reload').catch(() => {}); }, 80);
}

// ---------------- 渲染 ----------------

function dots(n) {
  return '<div class="ob-dots" aria-hidden="true">' + [1, 2, 3].map((i) =>
    '<span class="ob-dot' + (i <= n ? ' on' : '') + '"></span>').join('') + '</div>';
}

function head(kicker, title, sub) {
  return '<div class="ob-head">' + dots(step) +
    '<div class="ob-kicker">' + esc(kicker) + '</div>' +
    '<h2 class="ob-title" id="ob-title">' + esc(title) + '</h2>' +
    (sub ? '<p class="ob-sub">' + sub + '</p>' : '') +
    '</div>';
}

function langSwitch() {
  const disabled = (step === 3 && !lastReport) ? ' disabled' : '';
  const current = getLanguage();
  const pressed = (code) => ' aria-pressed="' + (current === code ? 'true' : 'false') + '"';
  return '<div class="ob-lang' + (step === 3 ? ' no-skip' : '') + '" role="group" aria-label="' + esc(tr('界面语言')) + '">' +
    '<button type="button" data-ob="lang" data-lang="zh-CN"' + pressed('zh-CN') + disabled + '>中</button>' +
    '<button type="button" data-ob="lang" data-lang="en-US"' + pressed('en-US') + disabled + '>EN</button>' +
    '</div>';
}

function render() {
  if (!overlay) return;
  const card = overlay.querySelector('.ob-card');
  const skip = step < 3 ? tr('<button class="ob-skip" data-ob="later">稍后再说</button>') : '';
  let html = langSwitch() + skip;
  if (step === 1) html += stepWelcome();
  else if (step === 2) html += stepDrives();
  else html += stepScan();
  card.innerHTML = html;
  // 聚焦主按钮，键盘用户回车即可继续
  // 优先聚焦可执行的主操作；第二步扫描按钮未选文件夹时是禁用的，
  // 这时把焦点落到「选择文件夹」，键盘用户按 Enter 就能直接打开选择框。
  const primary = card.querySelector('.ob-foot .btn-primary:not([disabled])')
    || card.querySelector('.ob-best .btn-primary:not([disabled])')
    || card.querySelector('.ob-foot .btn-primary');
  if (primary) primary.focus();
}

function stepWelcome() {
  return head(tr('第 1 步 · 共 3 步'), tr('第一次用，只要先做一件事'),
    tr('选一个放 3MF 的文件夹，扫描完就能开始用。切片软件和耗材都可以以后再加。')) +
    '<div class="ob-body">' +
      '<div class="ob-trust">' + icon('i-check') + '<span>' + tr('数据只留在本机 · 不上传、不注册') + '</span></div>' +
      '<div class="ob-points">' +
        point('i-folder', tr('选择模型文件夹'), tr('必做。选一个专门放 3MF 的文件夹就行，不用扫整个盘。'), tr('必做')) +
        point('i-printer', tr('配置切片软件'), tr('可选。配好后，卡片上的“打开”可以直接启动 Orca / Bambu 等切片。'), tr('可选')) +
        point('i-sparkle', tr('设置默认耗材'), tr('可选。配好后，卡片和详情里的成本估算才有参考价。'), tr('可选')) +
      '</div>' +
      '<p class="ob-note">' + tr('先完成必做项就能用；两项可选项不配也不影响管理模型。') + '</p>' +
    '</div>' +
    '<div class="ob-foot"><span class="spacer"></span>' +
      '<button class="btn btn-primary" data-ob="next">' + tr('选择模型文件夹') + '</button>' +
    '</div>';
}

function point(ico, title, desc, badge) {
  const tag = badge
    ? '<span class="ob-plan-badge' + (badge === tr('必做') ? ' required' : '') + '">' + esc(badge) + '</span>'
    : '';
  return '<div class="ob-point">' + icon(ico) + '<div><b>' + tag + esc(title) + '</b><span>' + esc(desc) + '</span></div></div>';
}

function stepDrives() {
  const extrasHtml = extras.length
    ? '<div class="ob-extras">' + extras.map((p, i) =>
        '<div class="ob-extra" title="' + esc(p) + '">' + icon('i-folder') +
        '<span>' + esc(p) + '</span>' +
        '<button class="icon-btn" data-ob="rm-extra" data-i="' + i + tr('" title="移除">') + icon('i-close') + '</button></div>').join('') + '</div>'
    : '';
  const picked = selected.size + extras.length;
  const driveList = drives.length
    ? '<div class="ob-drives">' + drives.map(driveRow).join('') + '</div>'
    : '<div class="ob-empty">没有探测到可用盘符。用上面的「选择文件夹」即可。</div>';
  const pickedText = picked
    ? tr('已选择 ') + picked + tr(' 个位置')
    : tr('还没有选择位置');
  return head(tr('第 2 步 · 共 3 步'), tr('模型放在哪里？'),
    tr('推荐选一个专门放 3MF 的文件夹。只扫这个文件夹，速度快，也不会把系统盘里的杂项扫进来。')) +
    '<div class="ob-body">' +
      '<div class="ob-best">' +
        '<span class="ob-best-ico">' + icon('i-folder') + '</span>' +
        '<div class="ob-best-main"><b>' + tr('推荐：选择模型文件夹') + '</b>' +
          '<span>' + tr('例如 D:\\3D打印\\模型，或你平时下载 3MF 的目录') + '</span></div>' +
        '<button class="btn btn-primary btn-sm" data-ob="pick-folder">' + icon('i-plus') + '<span>' + tr('选择文件夹') + '</span></button>' +
      '</div>' +
      extrasHtml +
      '<div class="ob-picked' + (picked ? ' has-pick' : '') + '">' +
        '<span class="ob-picked-dot">' + (picked ? icon('i-check') : icon('i-info')) + '</span>' +
        '<span>' + esc(pickedText) + '</span>' +
      '</div>' +
      '<details class="ob-advanced">' +
        '<summary><span>' + tr('高级：按盘扫描') + '</span><small>' + tr('不推荐') + '</small></summary>' +
        '<p class="ob-advanced-hint">' + tr('整盘扫描会遍历所有子文件夹，系统盘文件多时会很慢。只有模型分散在整块盘里时才用。') + '</p>' +
        driveList +
      '</details>' +
      '<details class="ob-advanced">' +
        '<summary><span>' + tr('扫描深度') + '</span><small>' + esc((DEPTHS.find((d) => d.key === depthKey) || DEPTHS[1]).label) + '</small></summary>' +
        '<div class="ob-depth">' + DEPTHS.map((d) =>
          '<button class="ob-chip' + (depthKey === d.key ? ' on' : '') + '" data-ob="depth" data-key="' + d.key + '" title="' + esc(d.hint) + '">' +
          esc(d.label) + '</button>').join('') + '</div>' +
        '<p class="ob-sub" style="margin-top:10px">' + esc((DEPTHS.find((d) => d.key === depthKey) || DEPTHS[1]).hint) + '</p>' +
      '</details>' +
    '</div>' +
    '<div class="ob-foot">' +
      tr('<button class="btn btn-ghost" data-ob="back">上一步</button>') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-primary" data-ob="scan"' + (picked ? '' : ' disabled') + '>' +
        (picked ? tr('开始扫描') : tr('先选一个位置')) + '</button>' +
    '</div>';
}

function driveRow(d) {
  const on = selected.has(d.path);
  const gb = (n) => (n == null ? '' : (n / 1073741824).toFixed(n / 1073741824 >= 100 ? 0 : 1) + ' GB');
  const meta = d.total != null
    ? tr('剩余 ') + gb(d.free) + tr(' / 共 ') + gb(d.total)
    : tr('容量未知（网络盘或权限受限）');
  return '<label class="ob-drive' + (on ? ' on' : '') + '" data-ob="drive" data-path="' + esc(d.path) + '">' +
    '<input type="checkbox"' + (on ? ' checked' : '') + '>' +
    '<span class="ob-check">' + icon('i-check') + '</span>' +
    '<span class="ob-drive-main">' +
      '<span class="ob-drive-name">' + esc(d.letter) +
        (d.system ? tr('<span class="ob-tag">系统盘 · 文件多</span>') : '') + '</span>' +
      '<span class="ob-drive-meta">' + esc(meta) + '</span>' +
    '</span></label>';
}

function stepScan() {
  const done = !!lastReport;
  if (!done) {
    return head(tr('第 3 步 · 共 3 步'), tr('正在扫描模型'),
      tr('第一次扫描大目录会久一点，之后都是增量更新。可以随时取消。')) +
      '<div class="ob-body">' +
        '<div class="ob-progress" role="progressbar" aria-label="' + tr('扫描进度') + '" aria-valuemin="0" aria-valuemax="100"' +
          (scanPercent == null ? '' : ' aria-valuenow="' + Math.max(3, Math.min(100, scanPercent)) + '"') + '>' +
          '<div class="ob-bar' + (scanPercent == null ? ' indeterminate' : '') + '">' +
            '<i style="width:' + (scanPercent == null ? 35 : Math.max(3, Math.min(100, scanPercent))) + '%"></i></div>' +
          '<div class="ob-progress-text">' +
            '<span class="path" id="ob-current">' + esc(scanMessage || tr('准备中…')) + '</span>' +
            '<span class="ob-count" id="ob-count">' + esc(scanCountText || '') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ob-foot"><span class="spacer"></span>' +
        tr('<button class="btn btn-ghost" data-ob="cancel">取消扫描</button>') +
      '</div>';
  }
  const added = Number(lastReport.added || 0);
  const updated = Number(lastReport.updated || 0);
  const failed = Number(lastReport.failed || 0);
  const total = Number(lastTotal || 0);
  const none = total === 0;
  const slicers = (state.slicers || []).filter((s) => s && s.enabled !== false);
  const slicerText = slicers.length
    ? tr('已检测到 ') + slicers.length + tr(' 个切片软件')
    : tr('还没配置，之后可以一键探测');
  return head(tr('完成 · 共 3 步'), none ? tr('没有找到 3MF 文件') : tr('扫描完成，可以开始用了'),
    none ? tr('可能选错了文件夹，或者模型还没下载到这台电脑。你可以重新选一个位置。')
      : tr('现在可以直接进入模型库。下面两项是可选配置，不配也能正常用。')) +
    '<div class="ob-body">' +
      '<div class="ob-result">' +
        '<div class="ob-result-icon' + (none ? '' : ' ok') + '">' + icon(none ? 'i-alert' : 'i-check') + '</div>' +
        '<div>' +
          '<div class="ob-result-num">' + (none ? '0' + tr(' 个模型') : (total === 1 ? tr('1 个模型') : String(total) + tr(' 个模型'))) + '</div>' +
          tr('<div class="ob-result-note">本次新增 ') + added + tr(' · 更新 ') + updated + (failed ? tr(' · 失败 ') + failed : '') + '</div>' +
        '</div>' +
      '</div>' +
      (none ? '' : nextChecklist(slicerText)) +
    '</div>' +
    '<div class="ob-foot">' +
      tr('<button class="btn btn-ghost" data-ob="restart">重新选择</button>') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-primary" data-ob="finish">' + (none ? tr('进入模型库') : tr('进入模型库')) + '</button>' +
    '</div>';
}

function nextChecklist(slicerText) {
  return '<div class="ob-next">' +
    '<div class="ob-next-title">' + tr('接下来（可跳过）') + '</div>' +
    nextRow('i-printer', tr('切片软件'), slicerText, tr('去设置'), 'go-slicers') +
    nextRow('i-sparkle', tr('耗材成本'), tr('打开耗材库，设一个默认耗材，成本估算才有参考价'), tr('打开耗材库'), 'go-filaments') +
    '<div class="ob-next-row is-static">' +
      '<span class="ob-next-ico">' + icon('i-search') + '</span>' +
      '<div><b>' + tr('先逛逛') + '</b><span>' + tr('进入模型库后，点任意卡片就能看详情、分配耗材或打开切片。') + '</span></div>' +
    '</div>' +
  '</div>';
}

function nextRow(ico, title, desc, action, act) {
  return '<div class="ob-next-row">' +
    '<span class="ob-next-ico">' + icon(ico) + '</span>' +
    '<div><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div>' +
    '<button class="btn btn-ghost btn-sm" data-ob="' + act + '">' + esc(action) + '</button>' +
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
    // 扫描完成事件可能早于 beginScan 里的 stats() 返回；先拉最新 stats 再渲染，
    // 否则会闪一下“0 个模型 / 没有找到 3MF 文件”。
    finalizeScan();
    return;
  }
  const pct = Number(d && d.percent);
  scanPercent = Number.isFinite(pct) ? pct : null;
  scanMessage = (d && (d.message || d.phase)) || tr('扫描中…');
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
      const pg = document.querySelector('#onboarding .ob-progress');
      if (pg && scanPercent != null) pg.setAttribute('aria-valuenow', String(Math.max(3, Math.min(100, scanPercent))));
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
  // 不再默认勾选整块盘：新手很容易直接点“开始扫描”，然后等几个小时。
  // 只把已配置过的目录放进待扫描列表，方便“重新运行向导”时保留原选择。
  if (!extras.length && !selected.size && Array.isArray(state.folders)) {
    for (const f of state.folders) {
      const p = f && (f.path || f);
      if (p) extras.push(String(p));
    }
  }
}

async function beginScan() {
  if (busy) return;
  busy = true;
  lastReport = null;
  scanPercent = null;
  scanMessage = tr('准备扫描…');
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
  } catch (e) {
    lastReport = { added: 0, updated: 0, failed: paths.length, error: (e && e.message) || String(e) };
    await finalizeScan();
    return;
  }
  // scanStart 可能只是“已开始，立即返回”；真正的完成以 scan:done 事件为准，
  // 由 onScanProgress → finalizeScan 拉最新 stats 后统一渲染。
  if (lastReport) await finalizeScan();
}

async function finalizeScan() {
  if (finalizing) return;
  finalizing = true;
  try {
    try {
      const stats = await api.stats();
      lastTotal = Number((stats && stats.total) || 0);
    } catch (_) {
      lastTotal = Number((state.stats && state.stats.total) || 0);
    }
    busy = false;
    detachScan();
    if (step === 3) render();
    emitRefresh('scan:done');
  } finally {
    finalizing = false;
  }
}

async function onClick(e) {
  const t = e.target;
  const btn = t && t.closest ? t.closest('[data-ob]') : null;
  if (!btn) return;
  const act = btn.getAttribute('data-ob');

  if (act === 'lang') {
    e.preventDefault();
    await switchLanguage(btn.getAttribute('data-lang'));
    return;
  }

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
    } catch (err) { emitToast('error', (err && err.message) || tr('选择文件夹失败')); }
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
    emitToast('info', tr('已取消扫描'));
    return;
  }

  if (act === 'restart') { step = 2; await ensureDrives(); render(); return; }

  if (act === 'later') {
    await persistDone({ skipped: true });
    closeOnboarding();
    emitToast('info', tr('随时可以在「设置 → 数据管理」里重新运行初始化向导'));
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

  if (act === 'go-slicers' || act === 'go-filaments') {
    await persistDone({ setupTab: act === 'go-slicers' ? 'slicers' : 'filaments' });
    closeOnboarding();
    window.dispatchEvent(new CustomEvent('shelf:open-setup', {
      detail: { tab: act === 'go-slicers' ? 'slicers' : 'filaments' },
    }));
    return;
  }
}

function updateScanButton() {
  const btn = overlay.querySelector('[data-ob="scan"]');
  if (!btn) return;
  const n = selected.size + extras.length;
  btn.disabled = n === 0;
  btn.textContent = n ? tr('开始扫描') : tr('先选一个位置');
}

function trapTab(e) {
  if (!overlay || overlay.hidden) return;
  const items = Array.from(overlay.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.disabled && el.tabIndex !== -1 && el.getClientRects().length > 0);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !overlay.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function onKey(e) {
  const guideOpen = !!(guideLayer && !guideLayer.hidden);
  if (e.key === 'Tab' && !guideOpen && isOnboardingOpen()) {
    trapTab(e);
    return;
  }
  if (e.key !== 'Escape') return;
  if (guideOpen) { e.stopPropagation(); closeGuide(true); return; }
  if (!isOnboardingOpen()) return;
  e.stopPropagation();
  if (step === 3 && !lastReport) return; // 扫描中不允许 Esc 直接关，先取消
  persistDone({ skipped: true }).then(() => closeOnboarding());
}

// ---------------- 新手引导（三步聚光灯） ----------------

const GUIDE_STEPS = [
  { sel: '#btn-quick-add', title: tr('添加目录'), text: tr('以后想加新的模型文件夹，点这里。也可以直接把文件夹拖进窗口。') },
  { sel: '#nav-library', title: tr('全部模型与筛选'), text: tr('左侧是模型库。分类、标签、我的视图都在这里切换。') },
  { sel: '.card[data-id]', title: tr('点开任意模型'), text: tr('右侧会显示详情：可以分配耗材、填重量、估算成本，也能一键送进切片软件。') },
];

export function startGuide() {
  if (!mounted) mountOnboarding();
  guideIdx = 0;
  if (!guideLayer) {
    guideLayer = document.createElement('div');
    guideLayer.className = 'gd-layer';
    guideLayer.innerHTML = '<div class="gd-ring"></div><div class="gd-bubble"><h5></h5><p></p>' +
      '<div class="gd-foot"><span class="gd-step"></span><span class="spacer"></span>' +
      tr('<button class="btn btn-ghost btn-sm" data-gd="skip">跳过</button>') +
      tr('<button class="btn btn-primary btn-sm" data-gd="next">下一步</button></div></div>');
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
  bubble.querySelector('[data-gd="next"]').textContent = guideIdx === GUIDE_STEPS.length - 1 ? tr('知道了') : tr('下一步');
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
    emitToast('success', tr('小提示：随时可以点右上角 ? 或设置里的说明再看一遍'));
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

if (typeof window !== 'undefined') {
  // 只读测试钩子：模拟“选择文件夹”结果，避免自动化去点原生目录选择框。
  // 正式用户路径仍然只走 api.pickFolder()。
  window.__printshelfOnboardingAddPath = (p) => {
    const path = String(p || '').trim();
    if (!path) return false;
    if (!extras.includes(path) && !selected.has(path)) extras.push(path);
    if (isOnboardingOpen()) render();
    return true;
  };
}
