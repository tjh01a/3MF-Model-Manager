'use strict';
/**
 * 模型体检 / 优化弹窗（渲染层）。
 * 原生 ES Modules + 原生 CSS，零框架、零构建、零 CDN、离线可用。
 *
 * 数据通道：
 *  - 写操作全部经 api.*（api.js 的 Proxy 已统一错误 Toast）；错误另在面板内以中文呈现。
 *  - 主进程把优化进度转发为 window 自定义事件（e.detail 为载荷）：
 *      mesh:progress / mesh:log / mesh:done / mesh:error。
 *
 * 与主进程需对齐的约定（详见任务返回说明）：
 *  - preset: 'gentle' | 'standard' | 'strong' | 'deep'，默认 'standard'。
 *  - gt15 / gt30 / thinPct 建议以 0~1 比例下发；渲染层兼容 0~100 百分数（|v|<=1 视为比例）。
 *  - meshOptimize 返回值与 mesh:done 载荷为同一份 result，渲染层先到先渲染并去重。
 *  - 本模块固定 addToLibrary:false，输出文件由主进程写到可被扫描的目录；
 *    「加入模型库」按钮通过派发 shelf:refresh(reason:'meshopt') 触发库刷新。
 *  - 主进程请把 meshInspect / meshOptimize / meshCancel / meshBlender 加入 api.js 的 METHODS 白名单。
 */
import { api, emitToast } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, icon, qs, qsa } from '../utils.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

// ---------------------------------------------------------------------------
// 常量与默认值
// ---------------------------------------------------------------------------
const PRESETS = [
  { key: 'gentle',   name: '温和',               desc: '仅做轻度平滑，几乎不改变外形与尺寸。' },
  { key: 'standard', name: '标准',               desc: '平衡平滑与保形，适合大多数模型（推荐）。' },
  { key: 'strong',   name: '较强',               desc: '更明显的平滑，可能损失细小特征。' },
  { key: 'deep',     name: '深度 · 体素重网格',   desc: '重建网格、去除内部与伪影，顶点数会变化。' },
];
const DEFAULTS = { preset: 'standard', clampMm: 0.15, voxelMm: 0.25, includeAngular: false };
const MAX_LOG_LINES = 60;
// 体检卡「不健康」阈值：角度为 °，其余为百分数 0~100
const HEALTH = { angleMean: 25, gt15: 15, thinPct: 10 };
// Blender 不可用原因的中文兜底（主进程可直接下发中文，这里只兜常见英文 code）
const BLENDER_REASON = {
  notfound: '未找到 Blender 可执行文件，请检查路径配置。',
  'not-found': '未找到 Blender 可执行文件，请检查路径配置。',
  notconfigured: '尚未配置 Blender 可执行文件路径。',
  notexec: 'Blender 文件不可执行或没有运行权限。',
  timeout: '检测 Blender 超时，请重试。',
};

// ---------------------------------------------------------------------------
// 模块状态（单例）
// ---------------------------------------------------------------------------
let mounted = false;
let root = null;
let currentId = null;
let status = 'loading';     // loading | error | empty | ready | done
let running = false;        // 优化进行中（ready 视图的子状态）
let confirmOpen = false;
let finishGuard = false;    // 防止 mesh:done 与 meshOptimize 返回值重复渲染
let result = null;
let added = false;
let partsExpanded = false;
let form = Object.assign({}, DEFAULTS);

// ---------------------------------------------------------------------------
// 数值与格式化
// ---------------------------------------------------------------------------
function nv(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function has(v) { return v != null && v !== '' && isFinite(Number(v)); }
function fmtInt(v) {
  if (!has(v)) return '—';
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
/** 兼容 0~1 比例与 0~100 百分数：|v|<=1 视为比例并乘 100，返回 0~100 数值或 null */
function toPct(v) {
  if (!has(v)) return null;
  const n = Number(v);
  return Math.abs(n) <= 1 ? n * 100 : n;
}
function fmtPct(v) { const p = toPct(v); return p == null ? '—' : p.toFixed(1) + '%'; }
function fmtAngle(v) { return has(v) ? Number(v).toFixed(2) + '°' : '—'; }
function fmtVol(v) { return has(v) ? fmtInt(v) + ' mm³' : '—'; }
function pctDelta(b, a) {
  if (!has(b) || !has(a)) return null;
  const bv = Number(b), av = Number(a);
  if (bv === 0) return av === 0 ? 0 : null;
  return (av - bv) / Math.abs(bv) * 100;
}
/** totals 未提供 angleMean 时，按面数加权从 parts 估算 */
function weightedAngle(parts) {
  let sum = 0, w = 0;
  for (const p of parts || []) {
    if (p && has(p.angleMean)) {
      const f = Math.max(1, nv(p.faceCount));
      sum += Number(p.angleMean) * f;
      w += f;
    }
  }
  return w > 0 ? sum / w : null;
}
function tipText(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (typeof t === 'object') return String(t.message || t.text || t.advice || t.reason || '');
  return String(t);
}
function itemName(id) {
  const m = (state.items || []).find((x) => x && x.id === id);
  return m ? (m.title || m.fileName || id) : id;
}
function presetName(key) {
  const p = PRESETS.find((x) => x.key === key);
  return p ? p.name : key;
}
function reasonText(b) {
  const r = b && b.reason ? String(b.reason) : '';
  if (!r) return '未检测到可用的 Blender，优化可能无法进行。';
  return BLENDER_REASON[r.toLowerCase()] || r;   // 已是中文则原样显示
}
// ---------------------------------------------------------------------------
// DOM 骨架（mount 时一次性创建，之后只切换分区显隐 / 填充内容）
// ---------------------------------------------------------------------------
function modalRootEl() {
  let r = document.getElementById('modal-root');
  if (!r) {
    r = document.createElement('div');
    r.id = 'modal-root';
    document.body.appendChild(r);
  }
  return r;
}

function buildDom() {
  root = document.createElement('div');
  root.className = 'mo-backdrop';
  root.hidden = true;
  root.innerHTML =
    '<div class="mo-panel" role="dialog" aria-modal="true" aria-label="模型体检与优化">' +
      '<div class="mo-head">' +
        '<span class="mo-head-ico">' + icon('i-tool') + '</span>' +
        '<div class="mo-head-txt">' +
          '<h2 class="mo-title">模型体检与优化</h2>' +
          '<p class="mo-subtitle" data-role="subtitle">—</p>' +
        '</div>' +
        '<button type="button" class="mo-close" data-act="close" aria-label="关闭" title="关闭 (Esc)">' + icon('i-close') + '</button>' +
      '</div>' +
      '<div class="mo-statusbar" data-role="statusbar" hidden>' +
        '<span class="mo-statusbar-ico" data-role="statusbar-ico"></span>' +
        '<div class="mo-statusbar-main">' +
          '<strong data-role="statusbar-title"></strong>' +
          '<span class="mo-statusbar-sub" data-role="statusbar-sub"></span>' +
        '</div>' +
        '<span class="mo-statusbar-hint" data-role="statusbar-hint"></span>' +
      '</div>' +
      '<div class="mo-body">' +
        '<div class="mo-view" data-view="loading" hidden></div>' +
        '<div class="mo-view" data-view="error" hidden></div>' +
        '<div class="mo-view" data-view="empty" hidden></div>' +
        '<div class="mo-view" data-view="ready" hidden></div>' +
        '<div class="mo-view" data-view="done" hidden></div>' +
      '</div>' +
      '<div class="mo-confirm" data-role="confirm" hidden>' +
        '<div class="mo-confirm-box" role="alertdialog" aria-modal="true" aria-label="确认关闭">' +
          '<div class="mo-confirm-title">' + icon('i-warning') + '<span>优化正在进行</span></div>' +
          '<p class="mo-confirm-desc">关闭面板会中断当前优化并取消任务，确定要关闭吗？</p>' +
          '<div class="mo-confirm-actions">' +
            '<button type="button" class="mo-btn mo-btn-ghost" data-act="confirm-keep">继续优化</button>' +
            '<button type="button" class="mo-btn mo-btn-danger" data-act="confirm-close">取消并关闭</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  modalRootEl().appendChild(root);
}

// ---------------------------------------------------------------------------
// 视图切换
// ---------------------------------------------------------------------------
function showStatus(s) {
  status = s;
  for (const v of qsa('.mo-view', root)) v.hidden = (v.dataset.view !== s);
  const sb = qs('[data-role="statusbar"]', root);
  if (sb) sb.hidden = !(s === 'ready' || s === 'done');
}
function view(name) { return qs('.mo-view[data-view="' + name + '"]', root); }

// ---------------------------------------------------------------------------
// 渲染：加载 / 错误 / 空状态
// ---------------------------------------------------------------------------
function renderLoading() {
  return '<div class="mo-loading">' +
      '<div class="mo-loading-ico">' + icon('i-refresh') + '</div>' +
      '<p class="mo-loading-text">正在分析模型网格与拓扑…</p>' +
      '<div class="mo-skel-grid">' +
        '<div class="mo-skel-cell mo-skel"></div><div class="mo-skel-cell mo-skel"></div>' +
        '<div class="mo-skel-cell mo-skel"></div><div class="mo-skel-cell mo-skel"></div>' +
        '<div class="mo-skel-cell mo-skel"></div><div class="mo-skel-cell mo-skel"></div>' +
      '</div>' +
      '<div class="mo-skel mo-skel-line"></div>' +
      '<div class="mo-skel mo-skel-line mo-skel-line-short"></div>' +
    '</div>';
}
function renderStateBox(tone, icoName, title, desc) {
  return '<div class="mo-statebox mo-statebox-' + tone + '">' +
      '<span class="mo-statebox-ico">' + icon(icoName) + '</span>' +
      '<h3 class="mo-statebox-title">' + esc(title) + '</h3>' +
      '<p class="mo-statebox-desc">' + esc(desc) + '</p>' +
      '<div class="mo-statebox-actions">' +
        '<button type="button" class="mo-btn mo-btn-primary" data-act="retry">' + icon('i-refresh') + '<span>重新体检</span></button>' +
        '<button type="button" class="mo-btn mo-btn-ghost" data-act="close">关闭</button>' +
      '</div>' +
    '</div>';
}
function showError(msg) {
  const v = view('error');
  if (v) v.innerHTML = renderStateBox('error', 'i-alert', '体检失败', msg || '无法完成模型体检，请稍后重试。');
  showStatus('error');
}
function showEmpty(msg) {
  const v = view('empty');
  if (v) v.innerHTML = renderStateBox('empty', 'i-box', '没有可分析的网格', msg || '该文件未检测到可分析的网格部件，可能不是有效的 3MF / 网格模型。');
  showStatus('empty');
}

// ---------------------------------------------------------------------------
// 渲染：Blender 状态条
// ---------------------------------------------------------------------------
function renderBlender(b) {
  const bar = qs('[data-role="statusbar"]', root);
  if (!bar) return;
  const ok = !!(b && b.ok);
  bar.classList.toggle('is-ok', ok);
  bar.classList.toggle('is-bad', !ok);
  const ic = qs('[data-role="statusbar-ico"]', root);
  const t = qs('[data-role="statusbar-title"]', root);
  const sub = qs('[data-role="statusbar-sub"]', root);
  const hint = qs('[data-role="statusbar-hint"]', root);
  if (ic) ic.innerHTML = icon(ok ? 'i-check-circle' : 'i-alert');
  if (t) t.textContent = ok ? ('Blender 就绪' + (b.version ? ' · v' + b.version : '')) : 'Blender 不可用';
  if (sub) { sub.textContent = ok ? (b.path || '') : reasonText(b); sub.title = sub.textContent; }
  if (hint) {
    hint.innerHTML = ok ? ''
      : '未找到 Blender · <button type="button" class="mo-link" data-act="pickblender">手动选择 blender.exe</button>';
  }
}

// ---------------------------------------------------------------------------
// 渲染：体检结果（ready 视图，一次性生成；交互靠 class 切换，不重绘以保留表单状态）
// ---------------------------------------------------------------------------
function statCell(label, valueHtml, tone) {
  const cls = tone === 'warn' ? ' is-warn' : tone === 'good' ? ' is-good' : '';
  return '<div class="mo-stat' + cls + '">' +
      '<span class="mo-stat-label">' + esc(label) + '</span>' +
      '<span class="mo-stat-value">' + valueHtml + '</span>' +
    '</div>';
}
function statGridHtml(data) {
  const t = data.totals || {};
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const boundary = nv(t.boundaryEdges), nonman = nv(t.nonmanifoldEdges);
  const closed = boundary === 0 && nonman === 0;
  const closedVal = closed
    ? icon('i-check-circle') + '<span>封闭流形</span>'
    : esc('边界 ' + fmtInt(boundary) + (nonman ? ' · 非流形 ' + fmtInt(nonman) : ''));
  const ang = has(t.angleMean) ? Number(t.angleMean) : weightedAngle(parts);
  const gt15Tone = (toPct(t.gt15) || 0) > HEALTH.gt15 ? 'warn' : '';
  const thinTone = (toPct(t.thinPct) || 0) > HEALTH.thinPct ? 'warn' : '';
  const angTone = (ang != null && ang > HEALTH.angleMean) ? 'warn' : '';
  return '<section class="mo-sec">' +
      '<div class="mo-sec-head"><h3 class="mo-sec-title">体检概览</h3>' +
        '<span class="mo-sec-hint">' + esc(data.format ? ('格式 ' + data.format) : '网格质量指标') + '</span></div>' +
      '<div class="mo-statgrid">' +
        statCell('部件数', esc(fmtInt(t.parts != null ? t.parts : parts.length)), '') +
        statCell('三角面数', esc(fmtInt(t.faces)), '') +
        statCell('拓扑 / 边界', closedVal, closed ? 'good' : 'warn') +
        statCell('相邻面平均夹角', esc(fmtAngle(ang)), angTone) +
        statCell('>15° 边占比', esc(fmtPct(t.gt15)), gt15Tone) +
        statCell('细长三角形占比', esc(fmtPct(t.thinPct)), thinTone) +
      '</div>' +
    '</section>';
}
function hintsHtml(data) {
  const warns = Array.isArray(data.warnings) ? data.warnings : [];
  const hints = Array.isArray(data.sliceConfigHint) ? data.sliceConfigHint : [];
  const rows = [];
  for (const w of warns) {
    const txt = tipText(w);
    if (txt) rows.push('<li class="mo-hint is-warn">' + icon('i-warning') +
      '<span class="mo-hint-text">' + esc(txt) + '</span></li>');
  }
  for (const h of hints) {
    if (!h || typeof h !== 'object') continue;
    const key = esc(h.key || '切片参数');
    const cur = h.current != null ? '<span class="mo-hint-cur">当前 ' + esc(h.current) + '</span>' : '';
    rows.push('<li class="mo-hint">' + icon('i-sliders') +
      '<span class="mo-hint-text"><span class="mo-hint-key">' + key + '</span>' + cur +
      esc(h.advice || '') + '</span></li>');
  }
  if (!rows.length) return '';
  return '<section class="mo-sec">' +
      '<div class="mo-sec-head"><h3 class="mo-sec-title">提示与建议</h3></div>' +
      '<ul class="mo-hints">' + rows.join('') + '</ul>' +
    '</section>';
}
function partsHtml(data) {
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const head = '<button type="button" class="mo-parts-toggle" data-act="toggle-parts">' +
      '<span class="mo-parts-chevron' + (partsExpanded ? ' is-open' : '') + '">' + icon('i-chevron-right') + '</span>' +
      '<span>部件明细（' + esc(fmtInt(parts.length)) + '）</span>' +
      '<span class="mo-sec-hint">' + (partsExpanded ? '点击收起' : '点击展开') + '</span>' +
    '</button>';
  let body;
  if (!parts.length) {
    body = '<div class="mo-parts-empty">无部件数据</div>';
  } else {
    const rows = parts.map((p) => {
      const name = (p && (p.name || p.entry)) || '未命名部件';
      const angular = !!(p && p.isAngular);
      const skip = !!(p && (p.isAngular || p.skip));
      const badge = skip
        ? '<span class="mo-badge is-warn">' + esc(angular ? '棱角件 · 将跳过' : '将跳过') + '</span>'
        : '';
      return '<tr>' +
          '<td class="mo-td-name" title="' + esc(name) + '">' + esc(name) + '</td>' +
          '<td class="mo-num">' + esc(fmtInt(p && p.vertexCount)) + ' / ' + esc(fmtInt(p && p.faceCount)) + '</td>' +
          '<td class="mo-num">' + esc(fmtAngle(p && p.angleMean)) + '</td>' +
          '<td class="mo-num">' + esc(fmtPct(p && p.gt30)) + '</td>' +
          '<td class="mo-num">' + esc(fmtPct(p && p.thinPct)) + '</td>' +
          '<td>' + badge + '</td>' +
        '</tr>';
    }).join('');
    body = '<div class="mo-parts-scroll"><table class="mo-table">' +
        '<thead><tr><th>部件</th><th>V / F</th><th>夹角均值</th><th>>30°</th><th>细长</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
  }
  return '<section class="mo-sec">' +
      '<div class="mo-sec-head"><h3 class="mo-sec-title">部件清单</h3></div>' +
      head +
      '<div class="mo-parts-body" data-role="parts-body"' + (partsExpanded ? '' : ' hidden') + '>' + body + '</div>' +
    '</section>';
}
function presetsHtml() {
  const cards = PRESETS.map((p) =>
    '<button type="button" class="mo-preset' + (form.preset === p.key ? ' is-selected' : '') +
      '" data-act="preset" data-preset="' + esc(p.key) + '">' +
      '<span class="mo-preset-radio"></span>' +
      '<span class="mo-preset-txt"><span class="mo-preset-name">' + esc(p.name) + '</span>' +
      '<span class="mo-preset-desc">' + esc(p.desc) + '</span></span>' +
    '</button>').join('');
  return '<section class="mo-sec">' +
      '<div class="mo-sec-head"><h3 class="mo-sec-title">优化档位</h3>' +
        '<span class="mo-sec-hint">默认「标准」</span></div>' +
      '<div class="mo-presets">' + cards + '</div>' +
      '<div class="mo-alert is-warn mo-deepwarn" data-role="deepwarn"' + (form.preset === 'deep' ? '' : ' hidden') + '>' +
        icon('i-warning') + '<span>深度档会重建部件、顶点数发生变化，且需要重新切片。</span>' +
      '</div>' +
    '</section>';
}
function paramsHtml() {
  return '<section class="mo-sec">' +
      '<div class="mo-sec-head"><h3 class="mo-sec-title">参数</h3></div>' +
      '<div class="mo-params">' +
        '<div class="mo-param">' +
          '<label class="mo-param-label" for="mo-clamp">位移上限</label>' +
          '<div class="mo-param-ctrl">' +
            '<input type="range" class="mo-range" id="mo-clamp" data-field="clampMm" min="0.05" max="0.40" step="0.01" value="' + esc(form.clampMm) + '">' +
            '<span class="mo-range-val" data-role="clamp-val">' + esc(Number(form.clampMm).toFixed(2)) + ' mm</span>' +
          '</div>' +
        '</div>' +
        '<div class="mo-param mo-param-voxel" data-role="voxel"' + (form.preset === 'deep' ? '' : ' hidden') + '>' +
          '<label class="mo-param-label" for="mo-voxel">体素大小</label>' +
          '<div class="mo-param-ctrl">' +
            '<input type="number" class="mo-number" id="mo-voxel" data-field="voxelMm" min="0.05" max="5" step="0.05" value="' + esc(form.voxelMm) + '">' +
            '<span class="mo-param-unit">mm</span>' +
          '</div>' +
        '</div>' +
        '<div class="mo-param">' +
          '<label class="mo-check-row"><input type="checkbox" class="mo-checkbox" data-field="includeAngular"' + (form.includeAngular ? ' checked' : '') + '>' +
          '<span>包含棱角件（默认跳过，避免磨圆锐边）</span></label>' +
        '</div>' +
      '</div>' +
    '</section>';
}
function actionsHtml() {
  return '<div class="mo-actions">' +
      '<button type="button" class="mo-btn mo-btn-primary" data-act="start" data-role="start">' + icon('i-play') + '<span>开始优化</span></button>' +
      '<button type="button" class="mo-btn mo-btn-ghost" data-act="cancel" data-role="cancel" hidden>' + icon('i-close') + '<span>取消优化</span></button>' +
      '<span class="mo-actions-spacer"></span>' +
      '<span class="mo-actions-hint">优化会生成新文件，不覆盖原模型</span>' +
    '</div>';
}
function progressHtml() {
  return '<div class="mo-progressbox" data-role="progressbox" hidden>' +
      '<div class="mo-progress-top">' +
        '<span class="mo-stage" data-role="stage">准备中…</span>' +
        '<span class="mo-progress-pct" data-role="pct"></span>' +
      '</div>' +
      '<div class="mo-progress-track"><div class="mo-progress-fill" data-role="fill"></div></div>' +
      '<div class="mo-log" data-role="log" aria-live="polite"></div>' +
    '</div>';
}
function renderReady(data) {
  return statGridHtml(data) + hintsHtml(data) + partsHtml(data) +
    '<div class="mo-config" data-role="config">' + presetsHtml() + paramsHtml() + '</div>' +
    actionsHtml() + progressHtml();
}

// ---------------------------------------------------------------------------
// 渲染：完成区
// ---------------------------------------------------------------------------
function compareRow(label, bv, av, fmt) {
  const delta = (has(bv) && has(av)) ? (Number(av) - Number(bv)) : 0;
  const cls = delta < 0 ? 'mo-good' : delta > 0 ? 'mo-bad' : 'mo-flat';
  const d = pctDelta(bv, av);
  const dtxt = d == null ? '—' : ((d > 0 ? '+' : '') + d.toFixed(1) + '%');
  return '<tr class="mo-compare-row">' +
      '<td class="mo-compare-label">' + esc(label) + '</td>' +
      '<td><span class="mo-compare-pair"><span>' + esc(fmt(bv)) + '</span>' +
        '<span class="mo-compare-arrow">→</span><span>' + esc(fmt(av)) + '</span></span></td>' +
      '<td class="mo-compare-delta ' + cls + '">' + esc(dtxt) + '</td>' +
    '</tr>';
}
function renderDone(res) {
  const b = res.before || {}, a = res.after || {};
  const rows =
    compareRow('夹角均值', b.angleMean, a.angleMean, fmtAngle) +
    compareRow('>15° 边占比', b.gt15, a.gt15, fmtPct) +
    compareRow('>30° 边占比', b.gt30, a.gt30, fmtPct) +
    compareRow('细长三角形占比', b.thinPct, a.thinPct, fmtPct) +
    compareRow('体积', b.volumeMm3, a.volumeMm3, fmtVol);
  const skipped = Array.isArray(res.skipped) ? res.skipped : [];
  const skipHtml = skipped.length
    ? '<ul class="mo-list">' + skipped.map((s) =>
        '<li class="mo-list-item"><span>' + esc((s && s.name) || '部件') + '</span>' +
        '<span class="mo-list-reason">' + esc((s && s.reason) || '') + '</span></li>').join('') + '</ul>'
    : '<div class="mo-list-empty">没有跳过的部件</div>';
  const tips = Array.isArray(res.tips) ? res.tips : [];
  const tipsHtml = tips.length
    ? '<ul class="mo-list">' + tips.map((t) =>
        '<li class="mo-list-item">' + icon('i-sparkle') + '<span>' + esc(tipText(t)) + '</span></li>').join('') + '</ul>'
    : '<div class="mo-list-empty">暂无额外打印建议</div>';
  const out = res.outPath || '';
  return '<div class="mo-done">' +
      '<div class="mo-done-banner">' + icon('i-check-circle') + '<span>优化完成，以下为前后质量对比（下降为改善）。</span></div>' +
      '<section class="mo-sec"><div class="mo-sec-head"><h3 class="mo-sec-title">前后指标对比</h3>' +
        '<span class="mo-sec-hint">绿色 = 改善 · 红色 = 变差</span></div>' +
        '<table class="mo-compare"><thead><tr><th>指标</th><th>前 → 后</th><th>变化</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></section>' +
      '<section class="mo-sec"><div class="mo-sec-head"><h3 class="mo-sec-title">跳过部件</h3></div>' + skipHtml + '</section>' +
      '<section class="mo-sec"><div class="mo-sec-head"><h3 class="mo-sec-title">打印建议</h3></div>' + tipsHtml + '</section>' +
      '<section class="mo-sec"><div class="mo-sec-head"><h3 class="mo-sec-title">输出文件</h3></div>' +
        '<div class="mo-outpath"><span class="mo-outpath-text mo-num" title="' + esc(out) + '">' + esc(out || '—') + '</span>' +
        '<button type="button" class="mo-btn mo-btn-ghost mo-outpath-copy" data-act="copy">' + icon('i-copy') + '<span>复制路径</span></button></div>' +
      '</section>' +
      '<div class="mo-done-actions">' +
        '<button type="button" class="mo-btn mo-btn-primary" data-act="addlib" data-role="addlib"' + (added ? ' disabled' : '') + '>' +
          icon(added ? 'i-check' : 'i-save') + '<span>' + (added ? '已在模型库中' : '加入模型库') + '</span></button>' +
        '<button type="button" class="mo-btn mo-btn-ghost" data-act="reveal">' + icon('i-folder-open') + '<span>在资源管理器中显示</span></button>' +
        '<button type="button" class="mo-btn mo-btn-ghost" data-act="close">' + icon('i-close') + '<span>关闭</span></button>' +
      '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// 交互：档位 / 折叠 / 表单
// ---------------------------------------------------------------------------
function setPreset(key) {
  if (!PRESETS.some((p) => p.key === key)) return;
  form.preset = key;
  for (const el of qsa('.mo-preset', root)) el.classList.toggle('is-selected', el.dataset.preset === key);
  const deep = key === 'deep';
  const dw = qs('[data-role="deepwarn"]', root);
  const vx = qs('[data-role="voxel"]', root);
  if (dw) dw.hidden = !deep;
  if (vx) vx.hidden = !deep;
}
function toggleParts() {
  partsExpanded = !partsExpanded;
  const body = qs('[data-role="parts-body"]', root);
  const chev = qs('.mo-parts-chevron', root);
  if (body) body.hidden = !partsExpanded;
  if (chev) chev.classList.toggle('is-open', partsExpanded);
  const hint = qs('.mo-parts-toggle .mo-sec-hint', root);
  if (hint) hint.textContent = partsExpanded ? '点击收起' : '点击展开';
}
function onField(e) {
  const t = e.target;
  if (!t || !t.dataset || !t.dataset.field) return;
  const f = t.dataset.field;
  if (f === 'clampMm') {
    form.clampMm = Number(t.value);
    const v = qs('[data-role="clamp-val"]', root);
    if (v) v.textContent = (isFinite(form.clampMm) ? form.clampMm : DEFAULTS.clampMm).toFixed(2) + ' mm';
  } else if (f === 'voxelMm') {
    form.voxelMm = Number(t.value);
  } else if (f === 'includeAngular') {
    form.includeAngular = !!t.checked;
  }
}
function onClick(e) {
  if (e.target === root) {
    if (!running && !confirmOpen) closeMeshOpt();   // 点遮罩空白处关闭（运行中除外）
    return;
  }
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node) return;
  switch (node.dataset.act) {
    case 'close': closeMeshOpt(); break;
    case 'retry': runInspect(currentId); break;
    case 'toggle-parts': toggleParts(); break;
    case 'preset': if (!running) setPreset(node.dataset.preset); break;
    case 'start': startOptimize(); break;
    case 'cancel': cancelOptimize(); break;
    case 'copy': copyOutPath(); break;
    case 'addlib': addToLibrary(); break;
    case 'reveal': revealOutPath(); break;
    case 'pickblender': pickBlender(); break;
    case 'confirm-keep': closeConfirmLayer(); break;
    case 'confirm-close': confirmClose(); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// 运行态：按钮 / 进度 / 日志
// ---------------------------------------------------------------------------
function setRunning(on, keepProgress) {
  const start = qs('[data-role="start"]', root);
  const cancel = qs('[data-role="cancel"]', root);
  const box = qs('[data-role="progressbox"]', root);
  const cfg = qs('[data-role="config"]', root);
  if (start) {
    start.disabled = on;
    start.classList.toggle('is-loading', on);
    const s = qs('span', start);
    if (s) s.textContent = on ? '优化中…' : '开始优化';
  }
  if (cancel) cancel.hidden = !on;
  if (box) box.hidden = on ? false : !keepProgress;
  if (cfg) {
    cfg.classList.toggle('mo-locked', on);
    for (const el of qsa('input, button', cfg)) el.disabled = on;
  }
}
function setStage(msg) { const el = qs('[data-role="stage"]', root); if (el) el.textContent = msg || ''; }
function setPct(msg) { const el = qs('[data-role="pct"]', root); if (el) el.textContent = msg || ''; }
function setFill(pct) {
  const el = qs('[data-role="fill"]', root);
  if (!el) return;
  el.classList.remove('is-indeterminate');
  el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function appendLog(msg) {
  const box = qs('[data-role="log"]', root);
  if (!box) return;
  const line = document.createElement('div');
  line.className = 'mo-log-line';
  const time = document.createElement('span');
  time.className = 'mo-log-time';
  time.textContent = new Date().toTimeString().slice(0, 8);
  const text = document.createElement('span');
  text.className = 'mo-log-text';
  text.textContent = String(msg == null ? '' : msg);   // 纯文本，杜绝注入
  line.appendChild(time);
  line.appendChild(text);
  box.appendChild(line);
  while (box.childElementCount > MAX_LOG_LINES) box.removeChild(box.firstElementChild);
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------------------
// 流程：体检 / 优化 / 事件
// ---------------------------------------------------------------------------
async function runInspect(id) {
  if (!id) return;
  showStatus('loading');
  const v = view('loading');
  if (v) v.innerHTML = renderLoading();
  let data;
  try {
    data = await api.meshInspect(id);
  } catch (err) {
    // api 封装已 emitToast，这里只补面板内中文错误态，避免重复 Toast
    fail((err && err.message) || '模型体检失败，无法读取该文件。', { toast: false });
    return;
  }
  // 结果返回前用户已关闭 / 切换了模型：丢弃过期结果
  if (!isMeshOptOpen() || currentId !== id) return;
  if (!data || data.ok === false) {
    fail((data && (data.reason || data.message)) || '模型体检失败，无法解析该文件。', { toast: true });
    return;
  }
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const t = data.totals || {};
  if (parts.length === 0 && nv(t.parts) === 0 && nv(t.faces) === 0) {
    showEmpty(data.format ? ('当前格式（' + data.format + '）未解析出网格部件。') : '');
    return;
  }
  renderBlender(data.blender);
  const sub = qs('[data-role="subtitle"]', root);
  if (sub && data.format) { sub.textContent = itemName(id) + ' · ' + data.format; sub.title = sub.textContent; }
  const rv = view('ready');
  if (rv) rv.innerHTML = renderReady(data);
  showStatus('ready');
}

function startOptimize() {
  if (running || !currentId) return;
  const params = {
    id: currentId,
    preset: form.preset,
    clampMm: (isFinite(form.clampMm) ? form.clampMm : DEFAULTS.clampMm),
    includeAngular: !!form.includeAngular,
    addToLibrary: false,
  };
  if (form.preset === 'deep') params.voxelMm = (isFinite(form.voxelMm) ? form.voxelMm : DEFAULTS.voxelMm);
  running = true;
  finishGuard = false;
  result = null;
  added = false;
  const logBox = qs('[data-role="log"]', root);
  if (logBox) logBox.innerHTML = '';
  setRunning(true);
  setStage('准备中…');
  setPct('');
  setFill(0);
  appendLog('开始优化 · 档位：' + presetName(form.preset));
  Promise.resolve(api.meshOptimize(params))
    .then((res) => {
      // 主进程若直接以返回值给出最终 result，作为兜底（与 mesh:done 去重）
      if (res && res.ok !== false && res.outPath && !finishGuard) handleDone({ result: res });
      else if (res && res.ok === false && !finishGuard) fail(res.message || '优化未成功', { toast: true });
    })
    .catch((err) => {
      // api 封装已 emitToast；仅当尚未由事件通道结算时补面板错误态
      if (!finishGuard && running) fail((err && err.message) || '优化失败', { toast: false });
    });
}

function cancelOptimize() {
  if (!running) return;
  appendLog('正在请求取消…');
  Promise.resolve(api.meshCancel()).catch(() => { /* api 封装已 Toast */ });
  running = false;
  finishGuard = true;          // 忽略取消后主进程补发的 done / error
  setRunning(false, true);     // 保留进度区展示「已取消」
  setStage('已取消优化');
  appendLog('优化已取消，可调整参数后重新开始。');
  emitToast('info', '已取消优化');
}

function handleProgress(d) {
  if (!isMeshOptOpen() || !running) return;
  const p = d || {};
  setStage(p.message || p.stage || '处理中…');
  const cur = Number(p.current), total = Number(p.total);
  if (isFinite(total) && total > 0 && isFinite(cur)) {
    const pct = cur / total * 100;
    setFill(pct);
    setPct(Math.max(0, Math.min(100, pct)).toFixed(0) + '%');
  } else {
    setPct('');
    const fill = qs('[data-role="fill"]', root);
    if (fill) fill.classList.add('is-indeterminate');
  }
}
function handleLog(d) {
  if (!isMeshOptOpen() || !running) return;
  appendLog((d && d.message) || '');
}
function handleDone(d) {
  if (!isMeshOptOpen() || finishGuard) return;
  const res = (d && d.result) ? d.result : ((d && d.outPath) ? d : null);
  if (res && res.ok === false) { fail(res.message || '优化未成功', { toast: true }); return; }
  if (!res) return;
  finishGuard = true;
  running = false;
  setRunning(false);
  result = res;
  added = !!res.addedToLibrary;
  const dv = view('done');
  if (dv) dv.innerHTML = renderDone(res);
  showStatus('done');
  emitToast('success', '模型优化完成');
}
function handleError(d) {
  if (!isMeshOptOpen() || finishGuard || status === 'done') return;
  // 事件通道错误不经过 api 封装，需手动 Toast
  fail((d && d.message) || '优化过程发生错误。', { toast: true });
}
function fail(msg, opts) {
  const o = opts || {};
  running = false;
  setRunning(false);
  if (o.toast !== false) emitToast('error', msg || '发生错误');
  showError(msg || '发生错误');
}

async function pickBlender() {
  let p = null;
  try { p = await api.pickExe(); } catch (_) { return; }
  if (!p) return;
  try {
    const r = await api.meshBlenderSet(p);
    renderBlender(r);
    emitToast(r && r.ok ? 'success' : 'error',
      r && r.ok ? ('Blender 已就绪 · v' + (r.version || '?')) : ((r && r.reason) || '该可执行文件不是可用的 Blender'));
  } catch (e) {
    emitToast('error', (e && e.message) || '配置 Blender 路径失败');
  }
}

async function addToLibrary() {
  if (added) return;
  const p = result && result.outPath;
  if (!p) { emitToast('warn', '没有可加入的输出文件'); return; }
  const b = qs('[data-role="addlib"]', root);
  if (b) b.disabled = true;
  try {
    const r = await api.meshAddToLibrary(p);
    added = true;
    emitToast('success', r && r.folderAdded ? '已登记目录并把优化结果加入模型库' : '已把优化结果加入模型库');
    window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason: 'meshopt' } }));
    if (b) {
      b.classList.add('is-done');
      b.innerHTML = icon('i-check') + '<span>已在模型库中</span>';
    }
  } catch (e) {
    if (b) b.disabled = false;
    // api 封装已统一 Toast，这里只恢复按钮状态
    if (!e) emitToast('error', '加入模型库失败');
  }
}
function revealOutPath() {
  const p = result && result.outPath;
  if (!p) { emitToast('warn', '没有可显示的输出路径'); return; }
  Promise.resolve(api.reveal(p)).catch(() => { /* api 封装已 Toast */ });
}
function copyOutPath() {
  const text = (result && result.outPath) || '';
  if (!text) { emitToast('warn', '没有可复制的路径'); return; }
  const done = () => emitToast('success', '已复制输出路径');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.className = 'mo-clip-tmp';
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  if (ok) done(); else emitToast('error', '复制失败，请手动选中路径复制');
}

// ---------------------------------------------------------------------------
// 关闭 / 二次确认 / Esc
// ---------------------------------------------------------------------------
function openConfirm() {
  const c = qs('[data-role="confirm"]', root);
  if (c) c.hidden = false;
  confirmOpen = true;
}
function closeConfirmLayer() {
  const c = qs('[data-role="confirm"]', root);
  if (c) c.hidden = true;
  confirmOpen = false;
}
async function confirmClose() {
  closeConfirmLayer();
  if (running) {
    try { await api.meshCancel(); } catch (_) { /* api 封装已 Toast */ }
  }
  doClose();
}
function doClose() {
  if (root) root.hidden = true;
  closeConfirmLayer();
  currentId = null;
  status = 'loading';
  running = false;
  finishGuard = false;
  result = null;
  added = false;
  partsExpanded = false;
  form = Object.assign({}, DEFAULTS);
}
export function isMeshOptOpen() { return !!root && !root.hidden; }

/** 关闭（优化进行中先弹自绘二次确认） */
export function closeMeshOpt() {
  if (!isMeshOptOpen()) return;
  if (running) { openConfirm(); return; }
  doClose();
}

function onKeydown(e) {
  if (!isMeshOptOpen() || e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();     // 捕获阶段接管，避免 app.js 全局 Esc / modal.js 抢处理
  if (confirmOpen) { closeConfirmLayer(); return; }
  closeMeshOpt();
}

// window 自定义事件回调（mount 时注册一次，幂等）
const onProgressEvt = (e) => handleProgress(e.detail);
const onLogEvt = (e) => handleLog(e.detail);
const onDoneEvt = (e) => handleDone(e.detail || {});
const onErrorEvt = (e) => handleError(e.detail || {});

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------
/** 幂等挂载：创建 DOM 追加到 #modal-root，绑定事件，注册 window 监听 */
export function mountMeshOpt() {
  if (mounted) return;
  mounted = true;
  buildDom();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onField);
  root.addEventListener('change', onField);
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('mesh:progress', onProgressEvt);
  window.addEventListener('mesh:log', onLogEvt);
  window.addEventListener('mesh:done', onDoneEvt);
  window.addEventListener('mesh:error', onErrorEvt);
}

/** 打开面板并调用 api.meshInspect(modelId) 渲染体检卡 */
export async function openMeshOpt(modelId) {
  if (!mounted) mountMeshOpt();      // 容错：即使主代理忘了 mount 也能用
  if (!modelId) return;
  currentId = modelId;
  form = Object.assign({}, DEFAULTS);
  result = null;
  added = false;
  finishGuard = false;
  running = false;
  partsExpanded = false;
  closeConfirmLayer();
  const sub = qs('[data-role="subtitle"]', root);
  if (sub) { sub.textContent = itemName(modelId); sub.title = sub.textContent; }
  root.hidden = false;              // 从 hidden 恢复会重播 mo-panel-in 动画
  showStatus('loading');
  await runInspect(modelId);
}
