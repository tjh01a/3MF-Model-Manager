'use strict';
/** 网格 / 列表渲染：卡片结构严格照 DOM CONTRACT，事件委托 + 多选 + 懒加载。 */
import { state, setState } from '../state.js';
import { api, emitRefresh, emitToast } from '../api.js';
import { escapeHtml, icon, fmtBytes, fmtRelative, plural, qs, qsa } from '../utils.js';
import { openDetail } from './detail.js';
import { openLightbox } from './lightbox.js';
import { openMenu } from '../components/menu.js';
import { syncBulkbar } from '../components/bulkbar.js';
import { confirmDialog } from '../components/modal.js';
import { chooseCategory } from '../components/assign.js';
import { openMeshOpt } from '../components/meshopt.js';
import { openModelsWithChoice, convertOnly } from '../components/openwith.js';
import { enterEditMode, exitEditMode, isEditMode, syncEditBar } from '../components/editmode.js';
import { showQuickOpen, hideSoon, cancelHide, quickOpenContains, close as closeQuickOpen } from '../components/quickopen.js';
import { motionEnabled, enterView } from '../components/motion.js';

// constants.js 为 CommonJS，渲染层不可 import，按冻结值内联
const PRINT_STATUS = {
  unprinted: { label: '未打印' }, queued: { label: '待打印' },
  printing: { label: '打印中' }, printed: { label: '已完成' }, failed: { label: '失败' },
};
const STATUS_CYCLE = ['unprinted', 'queued', 'printing', 'printed'];
// 色板最多 6 个圆点，再多显示 +N；卡片最窄 140px，多了会和左下角徽标挤在一起
const MAX_SWATCHES = 6;
// 库文件可被导入的 JSON 覆盖，进 style="background:" 之前必须再校验一次
const SAFE_HEX = /^#[0-9a-fA-F]{6}$/;

let lastClickedId = null;
let mounted = false;
/**
 * 上一次渲染的指纹。收藏 / 打印状态 / 评分这类小改动以前会触发 245 张卡片全量
 * innerHTML 重建（约 1.2 万个节点 + 全部缩略图重新请求解码），点一下星星就卡一下，
 * 而且滚动位置会掉回顶部。现在只对指纹变化的卡片做 replaceChild。
 */
let lastRender = { cls: '', items: [], sig: [] };
/**
 * 普通视图里「内容完全相同」的重复模型只显示一张卡（折叠），避免 P55_Logo 这类
 * 一次导入产生 4 张外观一样的卡把列表淹没。
 * 折叠只作用在当前查询返回的 items 上：组内的代表取第一张（遵循当前排序），
 * 其余成员隐藏但仍留在 state.items 里 —— 重复文件特殊视图、详情里的「切换文件」
 * 都靠完整列表工作。state.items / selection / stats 一律不改。
 * 首页不提供「展开副本」入口（用户要求）：要查看同组其他文件，点开卡片在详情里切。
 */
let visibleCache = { source: null, items: [] };
function visibleItems() {
  const src = state.items || [];
  if (visibleCache.source !== src) {
    const seen = new Set();
    const out = [];
    for (const m of src) {
      if (!m) continue;
      const g = m.duplicateGroup;
      if (g && typeof g === 'string') {
        if (seen.has(g)) continue;
        seen.add(g);
      }
      out.push(m);
    }
    visibleCache = { source: src, items: out };
  }
  return visibleCache.items;
}
/** 同 duplicateGroup 的可见成员数（含代表本身），用于卡片角标「重复 ×N」 */
function dupGroupSize(m) {
  if (!m || !m.duplicateGroup) return 0;
  let n = 0;
  for (const x of (state.items || [])) if (x && x.duplicateGroup === m.duplicateGroup) n++;
  return n;
}
function nextStatus(cur) {
  const i = STATUS_CYCLE.indexOf(cur);
  return i < 0 ? 'unprinted' : STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}
function findItem(id) {
  return (state.items || []).find((m) => m && m.id === id) || null;
}
function starsHtml(rating) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  let html = '<span class="card-stars" title="点击星级评分">';
  for (let i = 1; i <= 5; i++) {
    html += '<span class="star' + (i <= r ? ' on' : '') + '" data-act="rate" data-rate="' + i + '">' +
      (i <= r ? '★' : '☆') + '</span>';
  }
  return html + '</span>';
}

/**
 * 缩略图右下角的耗材色板：不用点进详情就知道这个模型用了几色、分别是什么颜色。
 * 数据来自 meta.filamentColors（core/model3mf.js 按零件 extruder 映射槽位色得到），
 * colorSource='project' 表示没找到零件映射、展示的是切片配置里的全部 AMS 槽位色。
 */
function colorShareData(meta) {
  const raw = Array.isArray(meta.filamentColors) ? meta.filamentColors : [];
  const colors = raw.filter((c) => typeof c === 'string' && SAFE_HEX.test(c)).map((c) => c.toLowerCase());
  const types = Array.isArray(meta.filamentTypes) ? meta.filamentTypes : [];
  const typeFor = (color, type) => {
    if (type) return String(type);
    const i = colors.indexOf(color);
    return i >= 0 && types[i] ? String(types[i]) : '';
  };
  const values = new Map();
  const add = (color, type, amount) => {
    if (!SAFE_HEX.test(color) || !(amount > 0)) return;
    const cur = values.get(color) || { color, type: typeFor(color, type), amount: 0 };
    cur.amount += amount;
    if (!cur.type) cur.type = typeFor(color, type);
    values.set(color, cur);
  };

  let basis = 'none';
  const usages = Array.isArray(meta.filamentUsages) ? meta.filamentUsages : [];
  for (const u of usages) {
    const color = typeof (u && u.color) === 'string' ? u.color.toLowerCase() : '';
    const g = Number(u && u.usedG);
    if (color && Number.isFinite(g) && g > 0) add(color, u.type, g);
  }
  if (values.size) basis = 'usage';

  if (!values.size) {
    const faces = Array.isArray(meta.filamentFaceCounts) ? meta.filamentFaceCounts : [];
    for (const f of faces) {
      const color = typeof (f && f.color) === 'string' ? f.color.toLowerCase() : '';
      const n = Number(f && f.faces);
      if (color && Number.isFinite(n) && n > 0) add(color, f.type, n);
    }
    if (values.size) basis = 'faces';
  }

  if (!values.size) {
    return {
      basisLabel: '暂无数据',
      note: '这个 3MF 没有逐色克数，也没有可用的对象面数；切片后重新导入可显示真实占比。',
      rows: colors.map((c, i) => ({
        color: c, type: types[i] || '', pct: '—', amount: '',
      })),
    };
  }

  // 按色板顺序排列，保证浮层和圆点一一对应；色板里没有的用量颜色补在后面。
  const ordered = [];
  const rest = new Map(values);
  for (const c of colors) {
    const v = rest.get(c);
    if (!v) continue;
    ordered.push(v);
    rest.delete(c);
  }
  for (const v of rest.values()) ordered.push(v);
  const total = ordered.reduce((s, v) => s + v.amount, 0);
  if (!(total > 0)) {
    return {
      basisLabel: '暂无数据',
      note: '这个 3MF 没有可用的逐色用量数据。',
      rows: colors.map((c, i) => ({ color: c, type: types[i] || '', pct: '—', amount: '' })),
    };
  }

  const pcts = ordered.map((v) => Math.round((v.amount / total) * 1000) / 10);
  const diff = Math.round((100 - pcts.reduce((s, n) => s + n, 0)) * 10) / 10;
  if (pcts.length) pcts[pcts.length - 1] = Math.max(0, Math.round((pcts[pcts.length - 1] + diff) * 10) / 10);
  const fmtPct = (n) => {
    if (n > 0 && n < 0.1) return '<0.1%';
    const s = n >= 10 ? n.toFixed(0) : n.toFixed(1);
    return s.replace(/\.0$/, '') + '%';
  };
  return {
    basisLabel: basis === 'usage' ? '按耗材用量' : '按三角面估算',
    note: basis === 'usage'
      ? '按切片逐色克数计算。'
      : '未切片，按对象三角面数估算，仅用于比较各色大致比例。',
    rows: ordered.map((v, i) => ({
      color: v.color,
      type: v.type || '',
      pct: fmtPct(pcts[i]),
      amount: basis === 'usage'
        ? (Math.round(v.amount * 10) / 10).toFixed(1) + ' g'
        : Math.round(v.amount).toLocaleString('zh-CN') + ' 面',
    })),
  };
}

function colorsHtml(meta) {
  const shares = colorShareData(meta);
  const raw = Array.isArray(meta.filamentColors) ? meta.filamentColors : [];
  const colors = raw.filter((c) => typeof c === 'string' && SAFE_HEX.test(c));
  if (!colors.length) return '';
  const types = Array.isArray(meta.filamentTypes) ? meta.filamentTypes : [];
  const shown = colors.slice(0, MAX_SWATCHES);
  const more = colors.length - shown.length;
  const desc = (meta.colorSource === 'project'
    ? '切片配置中的耗材颜色（未找到零件挤出机映射）'
    : '零件用到的耗材颜色') + '：' +
    colors.map((c, i) => (types[i] ? types[i] + ' ' : '') + c).join('、') +
    (more ? '，共 ' + colors.length + ' 色' : '') + '；悬停查看各色占比';
  const label = escapeHtml(desc);
  const payload = escapeHtml(JSON.stringify(shares));
  let html = '<div class="card-colors" role="group" tabindex="0" aria-label="' + label +
    '" data-color-tip="' + payload + '">';
  for (let i = 0; i < shown.length; i++) {
    const tip = escapeHtml((types[i] ? types[i] + ' · ' : '') + shown[i]);
    html += '<span class="card-color" style="background:' + shown[i] +
      '" title="' + tip + '"></span>';
  }
  if (more) html += '<span class="card-color-more">+' + more + '</span>';
  return html + '</div>';
}

// 全局色板浮层：卡片和 .card-media 都有 overflow:hidden，浮层必须挂到 body 才不会被裁掉。
let colorTipEl = null;
let colorTipOwner = null;

function ensureColorTip() {
  if (colorTipEl && document.body.contains(colorTipEl)) return colorTipEl;
  colorTipEl = document.createElement('div');
  colorTipEl.className = 'color-tip';
  colorTipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(colorTipEl);
  return colorTipEl;
}

function hideColorTip() {
  colorTipOwner = null;
  if (colorTipEl) colorTipEl.classList.remove('is-on');
}

function showColorTip(el) {
  if (!el || !el.dataset || !el.dataset.colorTip) return;
  if (colorTipOwner === el && colorTipEl && colorTipEl.classList.contains('is-on')) return;
  let data = null;
  try { data = JSON.parse(el.dataset.colorTip); } catch (_) { return; }
  if (!data || !Array.isArray(data.rows) || !data.rows.length) return;

  const tip = ensureColorTip();
  const rows = data.rows.map((r) => {
    const color = SAFE_HEX.test(String(r.color || '')) ? String(r.color) : '#999999';
    return '<div class="color-tip-row">' +
      '<i class="color-tip-dot" style="background:' + color + '"></i>' +
      '<div class="color-tip-main"><span class="color-tip-type">' + escapeHtml(r.type || '耗材') + '</span>' +
        '<span class="color-tip-hex">' + escapeHtml(color.toUpperCase()) + '</span></div>' +
      '<b class="color-tip-pct">' + escapeHtml(r.pct || '—') + '</b>' +
      (r.amount ? '<small class="color-tip-amount">' + escapeHtml(r.amount) + '</small>' : '') +
      '</div>';
  }).join('');
  tip.innerHTML = '<div class="color-tip-head"><span>耗材颜色占比</span>' +
    '<span class="color-tip-basis">' + escapeHtml(data.basisLabel || '') + '</span></div>' +
    rows + (data.note ? '<div class="color-tip-note">' + escapeHtml(data.note) + '</div>' : '');
  tip.classList.add('is-on');
  colorTipOwner = el;

  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.top - th - 8;
  if (top < 8) top = r.bottom + 8;
  if (top + th > window.innerHeight - 8) top = Math.max(8, window.innerHeight - th - 8);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function bindColorTip() {
  window.addEventListener('scroll', hideColorTip, true);
  window.addEventListener('resize', hideColorTip);
}

/**
 * 卡片价格徽标（docs/14）：从内存成本缓存读派生值，不逐卡发 IPC。
 * 缓存由 app.js 的批量 modelsCosts() 填充；算不出（无重量 / 无单价 / 未分配）
 * 就显示 ¥??，与用户"算不出则 ¥??"的要求一致。整数金额去掉 .00 省宽度。
 */
function priceHtml(m) {
  const c = (state.costs || {})[m.id];
  const total = c && Number(c.total);
  const known = !!c && Number.isFinite(total) && total > 0;
  const weightG = c && Number(c.weightG);
  let text = '¥??';
  if (known) text = '¥' + (Number.isInteger(total) ? String(total) : total.toFixed(2));
  // 算不出价钱但知道重量时，直接显示重量：让用户看得出「重量已识别，只是缺单价」，
  // 比一个光秃秃的 ¥?? 更有信息量（例如还没设默认耗材）。
  const knownWeight = !known && Number.isFinite(weightG) && weightG > 0;
  if (knownWeight) text = (weightG >= 100 ? Math.round(weightG) : weightG.toFixed(1)) + ' g';
  const costSource = c && c.source;
  const how = costSource === 'default' ? '按默认耗材单价 × 模型重量估算'
    : (c && c.complete ? '按已分配耗材与用量计算的估算成本' : '按切片重量与耗材单价估算的成本');
  const title = known
    ? how + '：' + text + '（点进详情看明细）'
    : (knownWeight
      ? '已识别切片重量 ' + weightG.toFixed(2) + ' g，但还没有可用单价：去耗材库设一个默认耗材或给模型分配耗材即可算价'
      : '这个文件里没有切片重量（未切片的 3MF 很常见）。点进详情可手填重量，或去耗材库设默认耗材后按重量估算。');
  return '<span class="card-price' + (known ? '' : ' is-unknown') + '" data-price="' +
    (known ? String(total) : (knownWeight ? 'w' + weightG : '??')) + '" title="' + escapeHtml(title) + '">' + text + '</span>';
}

function cardHtml(m) {
  const id = escapeHtml(m.id);
  const title = escapeHtml(m.title || m.fileName || '未命名');
  const src = escapeHtml(m.thumbnail ? 'shelf://thumbs/' + m.thumbnail : 'assets/placeholder.svg');
  const st = PRINT_STATUS[m.printStatus] ? m.printStatus : 'unprinted';
  const meta = m.meta || {};
  const metaBits = [fmtBytes(m.size)];
  if (meta.objectCount) metaBits.push(plural(meta.objectCount, '个对象'));
  else if (meta.plateCount) metaBits.push(plural(meta.plateCount, '个盘子'));
  metaBits.push(fmtRelative(m.createdAt));
  const cat = (state.categories || []).find((c) => c.id === m.categoryId);
  const chip = cat ? '<span class="chip">' + escapeHtml(cat.name) + '</span>' : '';
  // 卡片底色要用分类色：只接受安全的 #RRGGBB，非法值一律不写变量（color-mix 会回落到原底色）
  const catColor = (cat && typeof cat.color === 'string' && SAFE_HEX.test(cat.color)) ? cat.color : '';
  const catStyle = catColor ? ' style="--cat-color:' + catColor + '"' : '';
  // 来源网页：只接受 http(s)，避免把奇怪协议塞进 data-url；没有就留空，点了无反应
  const srcUrl = (typeof m.sourceUrl === 'string' && /^https?:\/\//i.test(m.sourceUrl.trim()))
    ? m.sourceUrl.trim() : '';
  // 有来源才给地球按钮加绿底 class；没来源保持原有灰色，视觉上就能区分是否可跳转
  const sourceClass = srcUrl ? ' class="has-source"' : '';
  const sourceUrlAttr = srcUrl ? ' data-url="' + escapeHtml(srcUrl) + '"' : '';

  const badges = ['<span class="badge status-' + st + '" data-act="status" title="点击切换打印状态">' +
    PRINT_STATUS[st].label + '</span>'];
  // 失效记录不会出现在普通视图（见 library.query），所以这里不再画「失效」徽标
  if (m.status === 'error') badges.push('<span class="badge badge-warn">解析失败</span>');
  if (m.duplicateGroup) {
    const dn = dupGroupSize(m);
    badges.push('<span class="badge badge-dup" title="内容完全相同，点开详情可在文件间切换">' +
      '重复' + (dn > 1 ? ' ×' + dn : '') + '</span>');
  }

  // 勾选态不写进 HTML：由 syncSelectionDom() 统一刷，这样勾一张卡不会让所有卡片重建
  return '<article class="card"' + catStyle + ' data-id="' + id + '" tabindex="0" draggable="true">' +
    '<div class="card-media">' +
      '<img class="card-img" src="' + src + '" loading="lazy" alt="">' +
      '<label class="card-check"><input type="checkbox" class="card-cb"></label>' +
      '<button class="card-fav' + (m.favorite ? ' is-fav' : '') + '" data-act="fav" title="收藏">' + icon('i-star') + '</button>' +
      '<div class="card-badges">' + badges.join('') + '</div>' +
      colorsHtml(meta) +
      '<div class="card-quick">' +
        // 常态高亮的主按钮：悬停弹出「拓竹 / Orca（快造）/ Orca（官方）」三选一，直接点按默认方式打开
        '<span class="q-open-wrap">' +
          '<button data-act="open" class="q-open" title="用切片软件打开（悬停可选拓竹 / Orca）">' + icon('i-printer') + '</button>' +
        '</span>' +
        // 浏览器图标：有来源链接就打开原网页；没有就静默无反应（不做假动作）
        '<button data-act="source"' + sourceClass + sourceUrlAttr +
          ' title="' + (srcUrl ? '在浏览器打开来源网页' : '没有来源链接') + '">' + icon('i-globe') + '</button>' +
        '<button data-act="reveal" title="在资源管理器中显示">' + icon('i-folder-open') + '</button>' +
        '<button data-act="trash" class="q-del" title="删除（移入系统回收站）">' + icon('i-trash') + '</button>' +
        '<button data-act="more" title="更多">' + icon('i-more') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="card-info">' +
      '<div class="card-title" title="' + title + '">' + title + '</div>' +
      '<div class="card-meta"><span class="card-meta-text">' + escapeHtml(metaBits.join(' · ')) + '</span>' +
        priceHtml(m) + '</div>' +
      '<div class="card-sub">' + chip + starsHtml(m.rating) + '</div>' +
    '</div>' +
  '</article>';
}

/** 卡片 DOM 指纹：只列 cardHtml 真正会读到的字段（含分类名，改名也要重画 chip） */
function cardSig(m) {
  const cat = (state.categories || []).find((c) => c.id === m.categoryId);
  const meta = m.meta || {};
  // 色板字段必须进指纹：旧库回填是异步写库后再刷新的，漏掉就不会重画卡片。
  const colors = Array.isArray(meta.filamentColors) ? meta.filamentColors.join(',') : '';
  const colorTypes = Array.isArray(meta.filamentTypes) ? meta.filamentTypes.join(',') : '';
  // 悬停占比也会读这两个字段；只补了克数/面数但色板没变时，卡片也必须重画。
  const colorShares = [
    ...(Array.isArray(meta.filamentUsages) ? meta.filamentUsages : [])
      .map((u) => (u && u.color ? u.color + ':' + (u.usedG || 0) : '')),
    ...(Array.isArray(meta.filamentFaceCounts) ? meta.filamentFaceCounts : [])
      .map((f) => (f && f.color ? f.color + ':' + (f.faces || 0) : '')),
  ].join(',');
  return [m.id, m.title || m.fileName || '', m.thumbnail || '', m.size,
    m.printStatus, m.status, m.duplicateGroup || '', m.categoryId || '',
    // 分类色也要进指纹：卡片底色读的是 --cat-color，改颜色但不改名字时必须重画这张卡
    cat ? cat.name : '', cat ? (cat.color || '') : '',
    // 来源链接也要进指纹：填了/改了 URL，卡片上的浏览器按钮才会更新 data-url
    m.sourceUrl || '',
    m.favorite ? 1 : 0, m.rating || 0, m.createdAt, dupGroupSize(m),
    meta.objectCount || 0, meta.plateCount || 0,
    colors, colorTypes, colorShares, meta.colorSource || '',
    // 价格是派生值但会显示：priceHtml 读到的每个字段都要进指纹——
    // 手填重量只改 weightG、切换来源只改 source，漏掉这两项卡片文本就不会更新（docs/14）
    (state.costs && state.costs[m.id] && state.costs[m.id].total) || 0,
    (state.costs && state.costs[m.id] && state.costs[m.id].weightG) || 0,
    (state.costs && state.costs[m.id] && state.costs[m.id].source) || '',
    (state.costs && state.costs[m.id] && state.costs[m.id].complete) ? 1 : 0].join('\u0001');
}

/** 把 state.selection 反映到 DOM（不整体重渲染） */
function syncSelectionDom() {
  const content = qs('#content');
  if (!content) return;
  for (const c of qsa('.card', content)) {
    const on = state.selection.has(c.dataset.id);
    c.classList.toggle('selected', on);
    const cb = c.querySelector('.card-cb');
    if (cb) cb.checked = on;
  }
}

/**
 * 切到「重复文件 / 失效文件」时 #content 会被 renderSpecialView 整块替换，
 * 网格的指纹缓存必须作废，否则切回来时可能对着别人的 DOM 做增量替换。
 */
export function invalidateGridCache() {
  lastRender = { cls: '', items: [], sig: [] };
}

/** 网格/列表切换只需要换 className；卡片 DOM 完全共用 */
export function applyViewClass() {
  const content = qs('#content');
  if (!content) return;
  // 回执 / 重复文件等特殊视图也走轻量刷新（切网格-列表、设置改动后的刷新），
  // 这里必须把 content-special 一起带上，否则特殊视图样式会被悄悄抹掉。
  const special = state.contentMode && state.contentMode !== 'normal' ? ' content-special' : '';
  const cls = (state.view === 'list' ? 'content-list' : 'content-grid') + special;
  if (content.className !== cls) content.className = cls;
  lastRender.cls = cls;
}

// 轻量诊断计数：走查探针据此量化「全量重建 vs 增量替换」，常态开销只有一次 performance.now()
if (typeof window !== 'undefined') {
  window.__printshelfRender = { full: 0, patch: 0, lastMs: 0, lastMode: '', replaced: 0 };
  // 走查用：卡片上的眼睛按钮已改成「打开来源网页」，--ui=lightbox 场景改从这里开大图。
  // 产品逻辑不依赖它，键盘 Space 与右键菜单「大图预览」才是正式入口。
  window.__printshelfPreviewFirst = () => {
    const ids = visibleItems().map((x) => x.id);
    if (ids.length) openLightbox(ids, 0);
  };
}

export function renderGrid() {
  const content = qs('#content');
  if (!content) return;
  hideColorTip();
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const cls = state.view === 'list' ? 'content-list' : 'content-grid';
  const prev = lastRender;
  document.documentElement.style.setProperty('--card-w', state.cardSize + 'px');

  const items = visibleItems();
  const sig = items.map(cardSig);
  const cards = qsa('.card', content);
  const canPatch = prev.cls === cls && cards.length === items.length && items.length > 0;
  const diff = [];
  if (canPatch) {
    for (let i = 0; i < items.length; i++) {
      if (prev.sig[i] !== sig[i] || cards[i].dataset.id !== items[i].id) diff.push(i);
    }
  }
  // 变了大半（重新排序 / 换筛选）时，逐张替换反而比一次 innerHTML 更贵
  const patch = canPatch && diff.length <= items.length / 2;
  const savedScroll = content.scrollTop;

  if (patch) {
    // S5：只对「少量单卡变化」做一次 160ms 淡入；批量换排序/换筛选完全不加动画。
    // 用 WAAPI 而非 class，动画结束自动消失，不会在被复用的 DOM 上留下残留类名。
    const animateIn = diff.length <= 12 && motionEnabled('fade');
    for (const i of diff) {
      const holder = document.createElement('div');
      holder.innerHTML = cardHtml(items[i]);
      const next = holder.firstElementChild;
      if (next) {
        content.replaceChild(next, cards[i]);
        if (animateIn) enterView(next, { duration: 160, distance: 6 });
      }
    }
  } else {
    content.className = cls;
    const holder = document.createElement('div');
    holder.innerHTML = items.map(cardHtml).join('');
    const frag = document.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);
    content.replaceChildren(frag);
    content.scrollTop = savedScroll;
  }
  lastRender = { cls, items, sig };
  syncSelectionDom();
  const diag = typeof window !== 'undefined' ? window.__printshelfRender : null;
  if (diag) {
    diag.lastMs = Math.round(((typeof performance !== 'undefined' ? performance.now() : t0) - t0) * 100) / 100;
    diag.lastMode = patch ? 'patch' : 'full';
    diag.replaced = patch ? diff.length : items.length;
    if (patch) diag.patch++; else diag.full++;
  }
}

function applySelection() {
  syncSelectionDom();
  syncBulkbar();
  setState({ selection: state.selection }, 'selection');
  syncEditBar();
}
function selectOnly(id) {
  state.selection.clear();
  state.selection.add(id);
  lastClickedId = id;
  applySelection();
}
function toggleSelect(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  lastClickedId = id;
  applySelection();
}
function rangeSelect(a, b) {
  const items = visibleItems();
  const ia = items.findIndex((m) => m && m.id === a);
  const ib = items.findIndex((m) => m && m.id === b);
  if (ia < 0 || ib < 0) { toggleSelect(b); return; }
  const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
  for (let i = lo; i <= hi; i++) state.selection.add(items[i].id);
  applySelection();
}

function openModels(ids, which) {
  if (!ids.length) return;
  const one = ids.length === 1 ? findItem(ids[0]) : null;
  // which 为空时按设置走（可能是每次询问）
  openModelsWithChoice(ids, { which, name: one ? (one.title || one.fileName || '') : '' })
    .then(() => emitRefresh('opened'))
    .catch(() => {});
}
async function removeModels(ids) {
  if (!ids.length) return;
  let ok = false;
  try {
    ok = await confirmDialog({
      title: '移出索引',
      message: '确定把选中的 ' + ids.length + ' 个模型移出索引吗？磁盘文件不会被删除。',
      detail: '以下模型将从库中移除：',
      items: ids.map((id) => { const m = findItem(id); return m ? (m.path || m.fileName || id) : id; }),
      danger: true, confirmText: '移出索引',
    });
  } catch (_) { return; }
  if (!ok) return;
  api.remove(ids).then(() => emitRefresh('remove')).catch(() => {});
}

/** 删除到系统回收站：会真正移动磁盘文件，所以必须二次确认并逐条报告失败原因。 */
async function trashModels(ids) {
  if (!ids.length) return;
  let ok = false;
  try {
    ok = await confirmDialog({
      title: '删除到回收站',
      message: '确定删除选中的 ' + ids.length + ' 个文件吗？文件会被移入系统回收站，之后可以从回收站还原。',
      detail: '以下文件将被移入回收站：',
      items: ids.map((id) => { const m = findItem(id); return m ? (m.path || m.fileName || id) : id; }),
      danger: true, confirmText: '移入回收站',
    });
  } catch (_) { return; }
  if (!ok) return;
  let res = null;
  try { res = await api.trash(ids); } catch (_) { return; }
  const done = (res && res.ok) || [];
  const failed = (res && res.failed) || [];
  if (failed.length) {
    emitToast(failed.length === ids.length ? 'error' : 'warn',
      failed.length + ' 个文件删除失败：' + ((failed[0] && failed[0].error) || '未知原因'));
  }
  if (done.length) emitToast('success', '已删除 ' + done.length + ' 个文件（可在回收站还原）');
  for (const id of ids) state.selection.delete(id);
  syncBulkbar();
  emitRefresh('trash');
}

function menuItemsFor(ids) {
  const one = ids.length === 1 ? findItem(ids[0]) : null;
  const allIds = visibleItems().map((m) => m.id);
  return [
    { label: '用切片软件打开', icon: 'i-printer', action: () => openModels(ids) },
    { label: '用拓竹打开', icon: 'i-box', action: () => openModels(ids, 'bambu') },
    { label: '用官方 Orca 打开（原文件）', icon: 'i-printer', action: () => openModels(ids, 'orca-official-direct') },
    { label: '用 Orca 打开（快造 U1，先转换）', icon: 'i-cube', action: () => openModels(ids, 'snapmaker') },
    { label: '转换后用官方 Orca 打开', icon: 'i-printer', action: () => openModels(ids, 'orca-official') },
    { label: '仅转换为快造格式…', icon: 'i-shuffle', action: () => convertOnly(ids) },
    { label: '大图预览', icon: 'i-eye', action: () => openLightbox(allIds, Math.max(0, allIds.indexOf(ids[0]))) },
    { label: '模型体检 / 优化…', icon: 'i-sparkle', action: () => openMeshOpt(ids[0]) },
    { divider: true },
    { label: '添加到分类…', icon: 'i-folder', action: () => chooseCategory(ids) },
    { label: one && one.favorite ? '取消收藏' : '收藏', icon: 'i-star',
      action: () => api.bulk(ids, { favorite: one ? !one.favorite : true }).then(() => emitRefresh('fav')).catch(() => {}) },
    { label: '设为已完成', icon: 'i-check',
      action: () => api.setPrintStatus(ids, 'printed').then(() => emitRefresh('status')).catch(() => {}) },
    { divider: true },
    { label: '在资源管理器中显示', icon: 'i-folder-open', action: () => ids.forEach((id) => api.reveal(id).catch(() => {})) },
    { label: '复制路径', icon: 'i-copy', action: () => ids.forEach((id) => api.copyPath(id).catch(() => {})) },
    { divider: true },
    { label: '移出索引', icon: 'i-minus', danger: true, action: () => removeModels(ids) },
    { label: '删除（移入回收站）', icon: 'i-trash', danger: true, action: () => trashModels(ids) },
  ];
}
function handleAct(act, el, card, e) {
  const id = card.dataset.id;
  const m = findItem(id) || {};
  switch (act) {
    case 'fav':
      api.update(id, { favorite: !m.favorite }).then(() => emitRefresh('fav')).catch(() => {});
      break;
    case 'status':
      api.setPrintStatus([id], nextStatus(m.printStatus)).then(() => emitRefresh('status')).catch(() => {});
      break;
    case 'open': openModels([id]); break;
    case 'open-bambu': openModels([id], 'bambu'); break;
    case 'open-snapmaker': openModels([id], 'snapmaker'); break;
    case 'source': {
      const url = (el && el.getAttribute && el.getAttribute('data-url')) || '';
      if (!url) break;                      // 没有来源链接：按用户要求，点了没反应
      api.openExternal(url).catch(() => {});
      break;
    }
    case 'reveal': api.reveal(id).catch(() => {}); break;
    case 'trash': {
      // 若该卡在多选内，删除整组；否则只删这一张
      const ids = (state.selection.has(id) && state.selection.size > 1) ? Array.from(state.selection) : [id];
      trashModels(ids);
      break;
    }
    case 'more': openMenu(e.clientX, e.clientY, menuItemsFor(state.selection.has(id) ? Array.from(state.selection) : [id])); break;
    case 'rate': {
      const r = Number(el.dataset.rate) || 0;
      api.update(id, { rating: r }).then(() => emitRefresh('rating')).catch(() => {});
      break;
    }
    default: break;
  }
}

function onClick(e) {
  // 长按刚进入编辑模式时，紧接着的这次 click 不应该再切换一次选中
  if (suppressClick) { suppressClick = false; return; }
  const actEl = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (actEl) {
    const card = actEl.closest('.card');
    if (card) {
      e.preventDefault();
      const act = actEl.dataset.act;
      // more 会打开右键菜单，必须阻止冒泡到 document，否则会被 menu.js 的点击外部立即关闭
      if (act === 'more') e.stopPropagation();
      if (act === 'open') closeQuickOpen();
      handleAct(act, actEl, card, e);
    }
    return;
  }
  if (e.target && e.target.closest && e.target.closest('.card-check, .card-cb')) return; // 交给 change
  const card = e.target && e.target.closest ? e.target.closest('.card') : null;
  if (!card) return;
  const id = card.dataset.id;
  // 编辑模式：点哪张就勾哪张，不再打开详情（想打开就按「完成」退出后再点）
  if (isEditMode()) { toggleSelect(id); return; }
  if (e.ctrlKey || e.metaKey) toggleSelect(id);
  else if (e.shiftKey && lastClickedId && lastClickedId !== id) rangeSelect(lastClickedId, id);
  else { selectOnly(id); Promise.resolve(openDetail(id)).catch(() => {}); }
}
function onDblClick(e) {
  if (isEditMode()) return;   // 编辑模式下双击只是"点了两次"，不该打开切片软件
  if (e.target && e.target.closest && e.target.closest('[data-act], .card-check, .card-cb')) return;
  const card = e.target && e.target.closest ? e.target.closest('.card') : null;
  if (card) openModels([card.dataset.id]);
}
function onContextMenu(e) {
  const card = e.target && e.target.closest ? e.target.closest('.card') : null;
  if (!card) return;
  e.preventDefault();
  const id = card.dataset.id;
  openMenu(e.clientX, e.clientY, menuItemsFor(state.selection.has(id) ? Array.from(state.selection) : [id]));
}
function onChange(e) {
  if (!e.target || !e.target.classList || !e.target.classList.contains('card-cb')) return;
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.checked) state.selection.add(id); else state.selection.delete(id);
  lastClickedId = id;
  applySelection();
}
// CSP 禁止 inline onerror，改用捕获阶段事件委托回退占位图
function onImgError(e) {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList && t.classList.contains('card-img')) {
    if (t.dataset.fallback !== '1') {
      t.dataset.fallback = '1';
      t.src = 'assets/placeholder.svg';
    }
  }
}

// ---------- 长按进入编辑模式（Steam 库式） ----------
const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE = 8;      // 手指/鼠标抖动容忍，超过就算拖动而不是长按
let pressTimer = null;
let pressStart = null;
let suppressClick = false;

function cancelPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  pressStart = null;
}
function onPointerDown(e) {
  if (e.button !== 0) return;                 // 只认左键
  suppressClick = false;
  const card = e.target && e.target.closest ? e.target.closest('.card') : null;
  if (!card) return;
  // 按钮 / 复选框 / 星级上的长按不做任何事，否则会干扰正常点按
  if (e.target.closest('button, input, label, a')) return;
  if (isEditMode()) return;                   // 已在编辑模式，直接点就是多选
  pressStart = { x: e.clientX, y: e.clientY, id: card.dataset.id, moved: false };
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (!pressStart || pressStart.moved) return;
    suppressClick = true;                     // 松手后紧跟的 click 会被吞掉
    enterEditMode(pressStart.id);
  }, LONG_PRESS_MS);
}
function onPointerMove(e) {
  if (!pressStart || pressStart.moved) return;
  if (Math.abs(e.clientX - pressStart.x) > MOVE_TOLERANCE ||
      Math.abs(e.clientY - pressStart.y) > MOVE_TOLERANCE) {
    pressStart.moved = true;                  // 判定为拖动，取消长按
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }
}
function onPointerUp() { cancelPress(); }

// ---------- 切片软件打开：悬停弹出「拓竹 / Orca 快造 / Orca 官方」 ----------
function onMouseOver(e) {
  const colorEl = e.target && e.target.closest ? e.target.closest('.card-colors') : null;
  if (colorEl) { showColorTip(colorEl); return; }
  const btn = e.target && e.target.closest ? e.target.closest('.card-quick [data-act="open"]') : null;
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  // 多选时"打开"作用于整组，和直接点按钮的行为保持一致
  const ids = (state.selection.has(id) && state.selection.size > 1) ? Array.from(state.selection) : [id];
  showQuickOpen(btn, ids, (pick) => { openModels(ids, pick); });
}
function onMouseOut(e) {
  const colorEl = e.target && e.target.closest ? e.target.closest('.card-colors') : null;
  if (colorEl) {
    const to = e.relatedTarget;
    if (to && colorEl.contains(to)) return;
    hideColorTip();
  }
  const btn = e.target && e.target.closest ? e.target.closest('.card-quick [data-act="open"]') : null;
  if (!btn) return;
  const to = e.relatedTarget;
  if (to && (quickOpenContains(to) || btn.contains(to))) return;  // 鼠标移进了浮层，别关
  hideSoon();
}

// ---------- 拖拽归类（拖到左侧分类 / 标签即完成归类） ----------
const DRAG_TYPE = 'application/x-shelf-ids';
let dragTimer = null;

function buildGhost(ids) {
  const first = findItem(ids[0]) || {};
  const thumb = first.thumbnail ? 'shelf://thumbs/' + first.thumbnail : 'assets/placeholder.svg';
  const label = ids.length > 1
    ? (ids.length + ' 个模型')
    : (first.title || first.fileName || '1 个模型');
  const el = document.createElement('div');
  el.className = 'drag-ghost';
  el.innerHTML = '<img src="' + escapeHtml(thumb) + '" alt="">' +
    '<span class="drag-ghost-count">' + escapeHtml(label) + '</span>';
  document.body.appendChild(el);
  return el;
}
function clearDragMarks() {
  if (dragTimer) { clearTimeout(dragTimer); dragTimer = null; }
  for (const el of qsa('.card.is-dragging')) el.classList.remove('is-dragging');
  const ghost = qs('.drag-ghost');
  if (ghost) ghost.remove();
  // 库内拖动标记必须和 dragend 一起清掉，否则下一次从资源管理器拖文件进来会被误判成内部拖动
  document.body.classList.remove('drag-holding-card');
}
function onDragStart(e) {
  const card = e.target && e.target.closest ? e.target.closest('.card') : null;
  if (!card) return;
  // 从按钮 / 复选框 / 星级上按下时不要触发拖拽，否则点选会变成拖动
  if (e.target.closest('button, input, label, a')) { e.preventDefault(); return; }
  closeQuickOpen();
  cancelPress();
  const id = card.dataset.id;
  const ids = (state.selection.has(id) && state.selection.size > 1) ? Array.from(state.selection) : [id];
  const dt = e.dataTransfer;
  if (!dt) return;
  try {
    dt.effectAllowed = 'copyMove';
    dt.setData(DRAG_TYPE, JSON.stringify(ids));
    dt.setData('text/plain', JSON.stringify(ids));
    const ghost = buildGhost(ids);
    dt.setDragImage(ghost, 20, 20);
  } catch (_) { /* 自定义拖影失败时退化为默认行为 */ }
  // 关键：卡片里带 <img>，Chromium 会把图片塞进 dataTransfer 的 Files 里，
  // 于是 window 上的 dragenter 会误判成"从外面拖文件进来"，弹出「松开即可添加」。
  // 用一个 body 标记明确告诉 app.js：这次是库内拖动，别接管。
  document.body.classList.add('drag-holding-card');
  card.classList.add('is-dragging');
  // 兜底清理：某些情况下 dragend 不会触发（拖出窗口后松开）。
  // 12 秒是安全网，不是正常路径 —— 正常拖拽再慢也就几秒，之前的 4 秒会在
  // 用户慢慢找分类时把标记清掉，导入遮罩就会中途弹出来盖住侧栏。
  dragTimer = setTimeout(clearDragMarks, 12000);
}
function onDragEnd() {
  clearDragMarks();
}

export function mountGrid() {
  if (mounted) return;
  const content = qs('#content');
  if (!content) return;
  mounted = true;
  bindColorTip();
  content.addEventListener('click', onClick);
  content.addEventListener('dblclick', onDblClick);
  content.addEventListener('contextmenu', onContextMenu);
  content.addEventListener('change', onChange);
  content.addEventListener('error', onImgError, true);
  content.addEventListener('dragstart', onDragStart);
  content.addEventListener('dragend', onDragEnd);
  // 长按进编辑模式
  content.addEventListener('pointerdown', onPointerDown);
  content.addEventListener('pointermove', onPointerMove);
  content.addEventListener('pointerup', onPointerUp);
  content.addEventListener('pointercancel', onPointerUp);
  content.addEventListener('pointerleave', onPointerUp);
  // 「用切片软件打开」悬停菜单
  content.addEventListener('mouseover', onMouseOver);
  content.addEventListener('mouseout', onMouseOut);
  // 编辑模式里"完成"按钮的入口由 editbar 提供；这里只负责长按选中的第一张同步高亮
  window.addEventListener('shelf:editpick', () => applySelection());
  // 全选 / 清空选择：由 toolbar、app.js 通过 window 事件触发
  window.addEventListener('shelf:selectall', () => {
    // 回执视图用同一个选择集存回执 id，不能由网格来填模型 id
    if (state.contentMode !== 'normal') return;
    state.selection.clear();
    for (const m of visibleItems()) state.selection.add(m.id);
    applySelection();
  });
  window.addEventListener('shelf:selectionclear', () => {
    if (state.contentMode !== 'normal' || !state.selection.size) return;
    state.selection.clear();
    applySelection();
  });
}
