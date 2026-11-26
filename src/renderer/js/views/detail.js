'use strict';
import { t as tr } from '../i18n.js';

/**
 * 右侧详情抽屉：完整展示单个模型并支持就地编辑。
 * 编辑成功后 emitRefresh() + 局部刷新详情；输入类保存不重绘详情以避免失焦。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, icon, fmtBytes, fmtDate, fmtRelative, debounce } from '../utils.js';
import { confirmDialog, promptDialog, selectDialog } from '../components/modal.js';
import { openMenu } from '../components/menu.js';
import { chooseCategory } from '../components/assign.js';
import { openMeshOpt } from '../components/meshopt.js';
import { openModelsWithChoice } from '../components/openwith.js';
import { enterView, motionEnabled } from '../components/motion.js';
import { openLightbox } from './lightbox.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
// constants.js 为 CommonJS，按冻结值内联
const PRINT_STATUS = {
  unprinted: { label: tr('未打印'), color: '#94a3b8' },
  queued:    { label: tr('待打印'), color: '#f59e0b' },
  printing:  { label: tr('打印中'), color: '#3b82f6' },
  printed:   { label: tr('已完成'), color: '#10b981' },
  failed:    { label: tr('失败'),   color: '#ef4444' },
};
const PRINT_STATUS_ORDER = ['unprinted', 'queued', 'printing', 'printed', 'failed'];
const STATUS_LABEL = { ok: tr('正常'), missing: tr('文件已失效'), error: tr('解析错误') };

let mounted = false;
let currentId = null;
let saveHintTimer = null;
// 上一次渲染的模型 id：用来区分「同一个模型局部刷新」和「换了个模型」
let lastRenderId = null;
// 当前主记录名下的副本（C · 智能合并），异步取回后填进 #detail-aliases
let currentAliases = [];

const el = (id) => document.getElementById(id);
const itemById = (id) => (state.items || []).find((m) => m && m.id === id) || null;
const toastErr = (e) => emitToast('error', (e && e.message) || tr('操作失败'));
// 与 grid.js 卡片上的绿/灰校验完全一致：只认 http(s)，其余一律当作没有来源
const SAFE_HTTP = /^https?:\/\//i;
function safeSourceUrl(v) {
  const s = String(v == null ? '' : v).trim();
  return SAFE_HTTP.test(s) ? s : '';
}

// ---------- 展示辅助 ----------
function fmtOrDash(ts, fn) {
  const n = Number(ts);
  return (ts == null || ts === '' || !Number.isFinite(n) || n <= 0) ? '—' : fn(n);
}
function folderPath(m) {
  if (!m.folderId) return m.relativePath || '—';
  const list = state.folders || (state.settings && state.settings.folders) || [];
  const f = list.find((x) => x && x.id === m.folderId);
  return f ? f.path : (m.relativePath || '—');
}
function metaCell(k, v) {
  const val = (v === null || v === undefined || v === '') ? '—' : v;
  return '<div class="meta-cell"><span class="meta-k">' + esc(k) +
    '</span><span class="meta-v">' + esc(val) + '</span></div>';
}
function stat(k, v) {
  return '<div class="stat"><span class="stat-v">' + esc(v) + '</span><span class="stat-k">' + esc(k) + '</span></div>';
}
function iconBtn(act, ico, title, extra) {
  return '<button type="button" class="icon-btn" data-act="' + act + '" title="' + esc(title) +
    '"' + (extra || '') + '>' + icon(ico) + '</button>';
}
function textBtn(act, ico, label, cls, title) {
  return '<button type="button" class="' + (cls || 'btn btn-ghost btn-sm') + '" data-act="' + act +
    '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (ico ? icon(ico) : '') +
    '<span>' + esc(label) + '</span></button>';
}

// ---------- 渲染 ----------
function render(m) {
  const body = el('detail-body');
  if (!body) return;
  if (!m) { body.innerHTML = tr('<div class="empty">未找到该模型</div>'); lastRenderId = null; return; }
  // 同一个模型的状态/收藏/标签改动会走整块重绘：必须把滚动位置留住，
  // 否则每点一次「已打印」都会把人弹回详情顶部（2026-11-19）。
  const sameModel = !!lastRenderId && lastRenderId === m.id;
  const keepScroll = sameModel ? body.scrollTop : 0;

  const ps = PRINT_STATUS[m.printStatus] || PRINT_STATUS.unprinted;
  const title = m.title || m.fileName || tr('未命名');
  const meta = m.meta || {};
  const cat = (state.categories || []).find((c) => c && c.id === m.categoryId);
  const tags = (m.tagIds || [])
    .map((id) => (state.tags || []).find((t) => t && t.id === id))
    .filter(Boolean);
  const rating = Number(m.rating) || 0;

  const parts = [];

  // 重复文件切换器：主列表已把内容相同的文件折叠成一张卡，这里在大图下方
  // 把同组每个文件的完整路径都列出来，点一下即可切换当前查看的是哪一个文件。
  // 用 state.items 完整列表（含被折叠隐藏的成员），不能用可见列表。
  const dups = m.duplicateGroup
    ? (state.items || []).filter((x) => x && x.duplicateGroup === m.duplicateGroup)
    : [];
  const dupIndex = dups.findIndex((x) => x.id === m.id);
  let dupSectionHtml = '';
  if (dups.length > 1) {
    const rows = dups.map((d, i) => {
      const cur = d.id === m.id;
      const src = d.thumbnail ? esc('shelf://thumbs/' + d.thumbnail) : 'assets/placeholder.svg';
      // 内容一样，靠这些"各自独立"的元数据区分副本 —— 否则 5 行看起来完全相同
      const st = PRINT_STATUS[d.printStatus] || PRINT_STATUS.unprinted;
      const bits = [
        d.size != null ? fmtBytes(d.size) : null,
        esc(st.label),
        d.createdAt ? fmtRelative(d.createdAt) : null,
      ].filter(Boolean).join(' · ');
      const note = (d.note || '').trim().replace(/\s+/g, ' ');
      return '<div class="detail-dup-row' + (cur ? ' is-current' : '') + '" data-dup-index="' + i + '">' +
        '<button type="button" class="detail-dup-pick" data-act="dup-switch" data-id="' + esc(d.id) +
          '" title="' + esc(cur ? tr('当前正在查看') : tr('点此切换查看此文件')) + '">' +
          '<img class="detail-dup-thumb" src="' + src + '" alt="">' +
          '<span class="detail-dup-meta">' +
            '<span class="detail-dup-name">' + esc(d.fileName || d.title || tr('未命名')) +
              '<span class="badge status-' + esc(d.printStatus || 'unprinted') + '" style="--badge-color:' + esc(st.color) + '">' + esc(st.label) + '</span>' +
              (cur ? tr('<span class="badge badge-dup">当前</span>') : '') + '</span>' +
            '<span class="detail-dup-path mono" title="' + esc(d.path || '') + '">' + esc(d.path || '—') + '</span>' +
            '<span class="detail-dup-sub">' + esc(bits) + (note ? tr('<span class="detail-dup-note">备注：') + esc(note) + '</span>' : '') + '</span>' +
          '</span>' +
        '</button>' +
        iconBtn('reveal-other', 'i-folder-open', tr('在资源管理器中显示'), ' data-id="' + esc(d.id) + '"') +
        '<button type="button" class="icon-btn icon-btn-danger" data-act="dup-trash" data-id="' + esc(d.id) +
          tr('" title="删除这个副本（移入回收站），其他副本不受影响">') + icon('i-trash') + '</button>' +
      '</div>';
    }).join('');
    dupSectionHtml =
      '<div class="detail-section detail-dup-section">' +
        tr('<h4 class="section-title">内容相同的文件 · 共 ') + dups.length + tr(' 个 ') +
          tr('<span class="detail-dup-pos">第 ') + (dupIndex + 1) + ' / ' + dups.length + tr(' 个</span></h4>') +
        '<div class="detail-dup-nav">' +
          tr('<button type="button" class="btn btn-ghost btn-sm" data-act="dup-prev" title="上一个副本 (←)"') +
            (dupIndex <= 0 ? ' disabled' : '') + '>' + icon('i-chevron-left') + tr('上一个</button>') +
          tr('<span class="muted">← → 键切换 · 点行也可切换</span>') +
          tr('<button type="button" class="btn btn-ghost btn-sm" data-act="dup-next" title="下一个副本 (→)"') +
            (dupIndex >= dups.length - 1 ? ' disabled' : '') + tr('>下一个') + icon('i-chevron-right') + '</button>' +
        '</div>' +
        '<div class="detail-dup-list">' + rows + '</div>' +
      '</div>';
  }

  // 大图 + 按钮组
  parts.push(
    '<div class="detail-preview">' +
      '<img class="detail-hero" src="' + (m.thumbnail ? esc('shelf://thumbs/' + m.thumbnail) : 'assets/placeholder.svg') + '" alt="' + esc(title) + '">' +
      '<div class="detail-actions">' +
        textBtn('open', 'i-printer', tr('用切片软件打开'), 'btn btn-primary btn-sm', tr('使用默认切片软件打开')) +
        textBtn('meshopt', 'i-sparkle', tr('体检 / 优化'), 'btn btn-ghost btn-sm', tr('分析网格并优化表面质量（生成新的 3MF，原文件不动）')) +
        iconBtn('open-menu', 'i-chevron-down', tr('选择切片软件')) +
        iconBtn('reveal', 'i-folder-open', tr('在资源管理器中显示')) +
        iconBtn('copyPath', 'i-copy', tr('复制路径')) +
        iconBtn('preview', 'i-image', tr('大图预览')) +
        iconBtn('fav', 'i-star', m.favorite ? tr('取消收藏') : tr('收藏')) +
        iconBtn('more', 'i-more', tr('更多操作')) +
      '</div>' +
    '</div>'
  );
  if (dupSectionHtml) parts.push(dupSectionHtml);
  // 副本（C · 智能合并）：合并后降级的记录不再出现在列表里，只在这里列出来。
  // 需要异步从 dupAliases 取（state.items 默认不含别名），先占位、拿到再填。
  parts.push('<div class="detail-section detail-alias-section" id="detail-aliases" hidden></div>');
  // I · 模型护照（许可 / 作者 / 商用判断），异步填
  parts.push('<div class="detail-section" id="detail-passport" hidden></div>');

  // 标题 + 打印状态徽标
  parts.push(
    '<div class="detail-titlebar">' +
      tr('<h2 class="detail-title" data-act="title" title="点击重命名">') + esc(title) +
        '<span class="detail-title-edit">' + icon('i-edit') + '</span></h2>' +
      '<div class="detail-status-row">' +
        '<span class="badge status-' + esc(m.printStatus || 'unprinted') + tr('" data-act="status-cycle" title="点击循环切换状态" style="--badge-color:') + esc(ps.color) + '">' + esc(ps.label) + '</span>' +
        tr('<button type="button" class="link-btn" data-act="status-pick">手动选择</button>') +
      '</div>' +
    '</div>'
  );

  // 失效提示
  if (m.status && m.status !== 'ok') {
    parts.push(
      '<div class="detail-alert danger">' + icon('i-alert') +
        '<div class="detail-alert-text">' +
          '<strong>' + esc(STATUS_LABEL[m.status] || m.status) + '</strong>' +
          '<p class="mono">' + esc(m.path || '') + '</p>' +
          (m.missingSince ? tr('<p>失效时间：') + esc(fmtOrDash(m.missingSince, fmtDate)) + '</p>' : '') +
          (m.parseError ? tr('<p>原因：') + esc(m.parseError) + '</p>' : '') +
        '</div>' +
        textBtn('relink', 'i-link', tr('重新定位'), 'btn btn-primary btn-sm') +
      '</div>'
    );
  }

  // 可编辑区（分类 / 标签 / 评分 / 收藏 / 统计）
  const tagChips = tags.length
    ? tags.map((t) => '<span class="chip" style="--chip-color:' + esc(t.color) + '">' + esc(t.name) + '</span>').join('')
    : tr('<span class="muted">无标签</span>');
  let stars = '<div class="rating">';
  for (let i = 1; i <= 5; i++) {
    stars += '<button type="button" class="star' + (i <= rating ? ' on' : '') + '" data-act="rating" data-val="' + i +
      '" title="' + i + tr(' 星">') + (i <= rating ? '★' : '☆') + '</button>';
  }
  stars += '</div>';
  parts.push(
    '<div class="detail-section">' +
      '<div class="form-row">' +
        tr('<div class="field"><span class="field-label">分类</span>') +
          '<button type="button" class="chip chip-btn" data-act="category" style="--chip-color:' + esc(cat ? cat.color : '#94a3b8') + '">' +
            (cat ? icon(cat.icon || 'i-folder') : icon('i-folder')) + esc(cat ? cat.name : tr('未分类')) + icon('i-chevron-down') +
          '</button></div>' +
        tr('<div class="field"><span class="field-label">标签</span>') +
          '<button type="button" class="chip chip-btn" data-act="tag">' + tagChips + icon('i-chevron-down') + '</button></div>' +
      '</div>' +
      '<div class="form-row">' +
        tr('<div class="field"><span class="field-label">评分</span>') + stars + '</div>' +
        tr('<div class="field"><span class="field-label">收藏</span>') +
          '<button type="button" class="chip chip-btn' + (m.favorite ? ' is-on' : '') + '" data-act="fav">' + icon('i-heart') +
            esc(m.favorite ? tr('已收藏') : tr('未收藏')) + '</button></div>' +
      '</div>' +
      '<div class="stat-row">' +
        stat(tr('打印次数'), m.printCount != null ? m.printCount : 0) +
        stat(tr('最近打印'), fmtOrDash(m.lastPrintedAt, fmtRelative)) +
        stat(tr('最近打开'), fmtOrDash(m.lastOpenedAt, fmtRelative)) +
        stat(tr('打开次数'), m.openCount != null ? m.openCount : 0) +
      '</div>' +
    '</div>'
  );

  // 13 · 耗材与成本：占位，render 后由 fillCost() 异步填充（成本要查耗材库）。
  // docs/14：从详情底部前移到「统计块之后、备注之前」的概览带，首屏即可见。
  parts.push(
    '<div class="detail-section" id="detail-cost">' +
      tr('<h4 class="section-title">耗材与成本</h4>') +
      tr('<div class="cost-loading">计算中…</div>') +
    '</div>'
  );

  // 备注 / 来源 / 作者
  parts.push(
    '<div class="detail-section">' +
      tr('<div class="field"><label class="field-label">备注') +
        '<span class="save-hint" data-role="save-hint"></span></label>' +
        tr('<textarea class="input" data-field="note" rows="3" placeholder="记录打印参数、耗材、注意事项…">') + esc(m.note || '') + '</textarea>' +
      '</div>' +
      '<div class="form-row">' +
        tr('<label class="field"><span class="field-label">来源链接</span>') +
          '<input class="input" data-field="sourceUrl" value="' + esc(m.sourceUrl || '') + '" placeholder="https://…"></label>' +
        tr('<label class="field"><span class="field-label">作者 / 设计师</span>') +
          '<input class="input" data-field="author" value="' + esc(m.author || '') + tr('" placeholder="设计师名称"></label>') +
      '</div>' +
      (safeSourceUrl(m.sourceUrl) ? textBtn('open-source', 'i-external', tr('打开来源链接'), 'btn btn-ghost btn-sm') : '') +
    '</div>'
  );

  // 元信息网格
  parts.push(
    '<div class="detail-section">' +
      tr('<h4 class="section-title">文件信息</h4>') +
      '<div class="meta-grid">' +
        metaCell(tr('文件大小'), m.size != null ? fmtBytes(m.size) : '—') +
        metaCell(tr('修改时间'), fmtOrDash(m.mtime, fmtDate)) +
        metaCell(tr('添加时间'), fmtOrDash(m.createdAt, fmtDate)) +
        metaCell(tr('来源目录'), folderPath(m)) +
        metaCell(tr('状态'), STATUS_LABEL[m.status] || m.status || '—') +
        // 路径 + 复制按钮同一行：值 min-width:0 可省略，按钮固定不被顶出去
        tr('<div class="meta-cell meta-wide"><span class="meta-k">完整路径</span>') +
          '<div class="meta-path">' +
            '<span class="meta-v mono" title="' + esc(m.path || '') + '">' + esc(m.path || '—') + '</span>' +
            iconBtn('copyPath', 'i-copy', tr('复制完整路径')) +
          '</div>' +
        '</div>' +
      '</div>' +
      tr('<h4 class="section-title">3MF 内信息</h4>') +
      '<div class="meta-grid">' +
        metaCell(tr('对象数'), meta.objectCount) +
        metaCell(tr('盘数 / 层数'), meta.plateCount) +
        metaCell(tr('耗材数'), meta.filamentCount) +
        metaCell(tr('打印机型号'), meta.printerModel) +
        metaCell(tr('切片器版本'), meta.slicerVersion) +
        metaCell(tr('是否多色'), meta.hasMultiColor == null ? null : (meta.hasMultiColor ? tr('是') : tr('否'))) +
      '</div>' +
    '</div>'
  );

  body.innerHTML = parts.join('');
  if (sameModel && keepScroll > 0) {
    // 内容高度可能变短，交给浏览器 clamp；先同步写回，避免闪一下顶部再跳回来
    body.scrollTop = Math.min(keepScroll, Math.max(0, body.scrollHeight - body.clientHeight));
  } else if (!sameModel) {
    body.scrollTop = 0;
  }
  // 换模型时给内容一次轻淡入（同模型局部刷新不闪，否则每次点收藏都像重开）
  if (!sameModel) enterView(body, { duration: 140, distance: 4 });
  lastRenderId = m.id;
  // 成本区块异步填：不影响详情主体立刻可见
  Promise.resolve(fillCost(m)).catch(() => {});
  // 副本列表同理，没有副本时整个小节保持 hidden
  Promise.resolve(fillAliases(m)).catch(() => {});
  // I · 护照小节同理
  Promise.resolve(fillPassport(m)).catch(() => {});
}

// ---------- I · 模型护照 ----------
async function fillPassport(m) {
  const box = el('detail-passport');
  if (!box || !m) return;
  let p;
  try { p = await api.passportGet(m.id); } catch (_) { box.hidden = true; return; }
  if (currentId !== m.id) return;
  const badge = p.commercial === true ? 'badge-ok' : (p.commercial === false ? 'badge-danger' : 'badge-warn');
  box.innerHTML =
    '<h3>' + tr('模型护照') + '</h3>' +
    '<div class="pp-grid">' +
      '<div class="pp-row"><span>' + tr('许可') + '</span><b>' + esc(p.licenseLabel) + '</b></div>' +
      '<div class="pp-row"><span>' + tr('商用') + '</span><span class="badge ' + badge + '">' + esc(p.commercialLabel) + '</span></div>' +
      '<div class="pp-row"><span>' + tr('作者') + '</span><b>' + esc(p.designer || '—') + '</b></div>' +
      (p.sourceUrl ? '<div class="pp-row"><span>' + tr('来源') + '</span><a href="#" data-act="open-source" class="pp-link">' + tr('打开原页面') + '</a></div>' : '') +
    '</div>' +
    '<div class="pp-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="passport-edit">' + icon('i-edit') + '<span>' + tr('编辑许可') + '</span></button></div>' +
    (p.commercial == null ? '<p class="hint">' + tr('未标注许可：商用前请联系作者确认，不要默认可用。') + '</p>' : '');
  box.hidden = false;
}

async function editPassport(id) {
  let p;
  try { p = await api.passportGet(id); } catch (_) { return; }
  let choice;
  try {
    const picked = await selectDialog({
      title: tr('选择许可'),
      message: tr('只记录你确认的许可，软件不替你判断法律效力。'),
      options: (p.presets || []).map((x) => ({ value: x.id, label: x.label })),
      confirmText: tr('保存'),
    });
    choice = Array.isArray(picked) ? picked[0] : picked;
  } catch (_) { return; }
  if (!choice) return;
  const preset = (p.presets || []).find((x) => x.id === choice);
  try {
    await api.passportUpdate(id, { license: choice, commercialUse: preset ? preset.commercial : null });
    emitToast('success', tr('许可已更新'));
    emitRefresh('passport');
    const m = itemById(id);
    if (m) Promise.resolve(fillPassport(m)).catch(() => {});
  } catch (_) { /* 已 toast */ }
}

// ---------- C · 副本（智能合并后的别名记录） ----------

const ALIAS_LABEL = {
  shadow: tr('文件仍在原处'),
  trashed: tr('文件已进回收站'),
  pending: tr('待处理'),
};

/** 异步取副本并填进 #detail-aliases；没有副本就把小节藏起来 */
async function fillAliases(m) {
  const box = el('detail-aliases');
  if (!box || !m) return;
  let r;
  try { r = await api.dupAliases(m.id); } catch (_) { box.hidden = true; return; }
  if (currentId !== m.id) return;
  // aliasesOf 直接返回数组（不是 {items}），兼容一下以后可能的包装
  const items = Array.isArray(r) ? r : ((r && r.items) || []);
  currentAliases = items;
  if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
  const rows = items.map((a) => {
    const src = a.thumbnail ? esc('shelf://thumbs/' + a.thumbnail) : 'assets/placeholder.svg';
    const label = ALIAS_LABEL[a.aliasState] || ALIAS_LABEL.shadow;
    const cls = a.aliasState === 'trashed' ? 'warn' : 'badge-ok';
    const bits = [
      a.size != null ? fmtBytes(a.size) : null,
      a.aliasAt ? tr('降为副本于 ') + fmtDate(a.aliasAt) : null,
    ].filter(Boolean).join(' · ');
    return '<div class="detail-dup-row detail-alias-row" data-id="' + esc(a.id) + '">' +
      '<img class="detail-dup-thumb" src="' + src + '" alt="">' +
      '<span class="detail-dup-meta">' +
        '<span class="detail-dup-name">' + esc(a.fileName || a.title || tr('未命名')) +
          '<span class="badge ' + cls + '">' + esc(label) + '</span></span>' +
        '<span class="detail-dup-path mono" title="' + esc(a.path || '') + '">' + esc(a.path || '—') + '</span>' +
        '<span class="detail-dup-sub">' + esc(bits) + (a.note ? tr('<span class="detail-dup-note">备注：') + esc(a.note) + '</span>' : '') + '</span>' +
      '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="alias-detach" data-id="' + esc(a.id) +
        '" title="' + esc(tr('解除副本关系，让它重新成为独立模型')) + '">' +
        icon('i-undo') + tr('<span>解除副本</span>') + '</button>' +
    '</div>';
  }).join('');
  box.innerHTML = tr('<h4 class="section-title">副本 · 共 ') + items.length + tr(' 个 ') +
    tr('<span class="muted">合并后不再出现在列表，备注与打印记录保留在这里</span></h4>') +
    '<div class="detail-dup-list">' + rows + '</div>';
  box.hidden = false;
}

/** 解除某个副本：记录恢复独立。文件若已进回收站，需要用户自己去还原。 */
async function detachAlias(id) {
  const a = currentAliases.find((x) => x.id === id);
  const ok = await confirmDialog({
    title: tr('解除副本关系'),
    message: tr('这条记录会恢复为独立模型，重新出现在列表、搜索与统计里。'),
    detail: tr('如果它的文件已经在回收站里，请到系统回收站还原后再扫描一次；这里只解除记录关系，不会替你取回文件。'),
    items: [a ? (a.path || a.fileName || id) : id],
    confirmText: tr('解除'),
  });
  if (!ok) return;
  try {
    await api.aliasDetach([id]);
    emitToast('success', tr('已解除副本关系'));
    emitRefresh('alias-detach');
    await refreshDetail();
  } catch (e) { toastErr(e); }
}

// ---------- 13 · 耗材与成本 ----------

const SOURCE_LABEL = {
  slice_info: tr('切片文件自动提取'), gcode: tr('G-code 自动提取'),
  assigned: tr('已分配耗材'), manual: tr('手动填写'), 'volume-estimate': tr('体积估算'),
  default: tr('按默认耗材估算'), none: tr('未取到'),
};

/** 异步取成本明细并填进 #detail-cost；只改这个区块的 innerHTML，不重绘整个详情 */
async function fillCost(m) {
  const box = document.getElementById('detail-cost');
  if (!box || !m) return;
  let c;
  try { c = await api.modelCost(m.id); }
  catch (_) { box.innerHTML = tr('<h4 class="section-title">耗材与成本</h4><div class="cost-loading">成本计算失败</div>'); return; }
  // 期间用户可能已经切到别的模型
  if (currentId !== m.id) return;

  const weightTxt = c.weightG != null ? (Number(c.weightG).toFixed(2) + ' g') : tr('未取到');
  const parts = (c.parts || []).map((p) =>
    '<div class="cost-row">' +
      '<i class="fil-dot" style="background:' + esc(p.color || '#94a3b8') + '"></i>' +
      '<span class="cost-name">' + esc(p.name) + '</span>' +
      '<span class="cost-grams">' + (Number(p.grams) || 0).toFixed(2) + ' g</span>' +
      '<span class="cost-num">¥' + (Number(p.cost) || 0).toFixed(2) + '</span>' +
    '</div>').join('');
  box.innerHTML =
    tr('<h4 class="section-title">耗材与成本</h4>') +
    '<div class="cost-summary">' +
      '<span class="cost-big">¥' + (Number(c.total) || 0).toFixed(2) + '</span>' +
      '<span class="cost-tag' + (c.complete ? ' is-ok' : '') + '">' +
        (c.complete ? tr('已分配') : tr('估算')) + '</span>' +
    '</div>' +
    '<div class="cost-meta">' +
      tr('<span>模型重量 <b>') + weightTxt + '</b></span>' +
      tr('<span>来源 <b>') + esc(SOURCE_LABEL[c.source] || c.source || tr('未取到')) + '</b></span>' +
    '</div>' +
    (parts ? '<div class="cost-parts">' + parts + '</div>' : '') +
    '<div class="detail-actions cost-actions">' +
      '<button type="button" class="btn btn-sm btn-ghost" data-act="cost-assign">' + icon('i-box') + tr('分配耗材</button>') +
      '<button type="button" class="btn btn-sm btn-ghost" data-act="cost-weight">' + icon('i-edit') + tr('填重量</button>') +
    '</div>';

  // 给成本按钮补一次事件（详情的 onClick 只认 [data-act]，这里已经带上了）
}

/** 弹出的分配面板：列出耗材库，每种填克数 */
async function assignFilaments(id, m) {
  let lib;
  try { lib = await api.filamentsList(); }
  catch (_) { emitToast('error', tr('读取耗材库失败')); return; }
  const items = (lib && lib.items) || [];
  if (!items.length) {
    emitToast('warn', tr('耗材库还是空的，先从标题栏「耗材库」加一种'));
    return;
  }
  const cur = Array.isArray(m.filamentLinks) ? m.filamentLinks : [];
  const opts = items.map((f) => ({
    value: f.id,
    label: f.name + ' · ' + (f.type || '') + ' · ¥' + (Number(f.pricePerKg) || 0).toFixed(2) + '/kg',
    checked: cur.some((x) => x.filamentId === f.id),
  }));
  const picked = await selectDialog({
    title: tr('分配耗材'), message: tr('可多选；保存后按各耗材单价与用量重算成本。'),
    options: opts, mode: 'multi', confirmText: tr('下一步'),
  });
  if (!picked) return;
  const ids = Array.isArray(picked) ? picked : [picked];
  const links = [];
  for (const fid of ids) {
    const f = items.find((x) => x.id === fid);
    const prev = cur.find((x) => x.filamentId === fid);
    const def = prev ? String(prev.weightG || '') :
      (m.meta && m.meta.weightG != null && ids.length === 1 ? String(m.meta.weightG) : '');
    const v = await promptDialog({
      title: tr('用量（克）'), label: f ? f.name : tr('耗材'),
      value: def, placeholder: tr('例如 90.39'), confirmText: tr('确定'),
    });
    if (v == null) continue;
    const g = Number(v);
    if (!Number.isFinite(g) || g <= 0) { emitToast('warn', tr('用量要是大于 0 的数字，已跳过')); continue; }
    links.push({ filamentId: fid, weightG: g });
  }
  try {
    await api.modelSetFilaments(id, links, null);
    await afterEdit(tr('耗材分配已保存'));
  } catch (_) { /* 已 toast */ }
}

async function editCostWeight(id, m) {
  const cur = m.costWeightG != null ? m.costWeightG : (m.meta && m.meta.weightG);
  const v = await promptDialog({
    title: tr('填写模型重量'), label: tr('重量（克）'),
    value: cur != null ? String(cur) : '', placeholder: tr('例如 90.39'), confirmText: tr('保存'),
  });
  if (v == null) return;
  const g = Number(v);
  if (!Number.isFinite(g) || g <= 0 || g > 5000) { emitToast('error', tr('重量要是 0~5000 之间的数字')); return; }
  try {
    await api.update(id, { costWeightG: g });
    await afterEdit(tr('重量已保存'));
  } catch (_) { /* 已 toast */ }
}

// ---------- 数据获取 ----------
async function fetchFresh(id) {
  try { const m = await api.get(id); if (m) return m; } catch (_) { /* 回退本地 */ }
  return itemById(id);
}

// 编辑成功后：刷新全局数据 + 局部刷新详情（输入中不重绘，见 refreshDetail 保护）
async function afterEdit(msg, light) {
  emitRefresh('detail-edit');
  if (msg) emitToast('success', msg);
  if (!light) await refreshDetail();
}

// ---------- 各类编辑动作 ----------
async function editTitle(id, m) {
  const v = await promptDialog({ title: tr('重命名'), label: tr('显示名称（不改动磁盘文件）'), value: (m && m.title) || '', confirmText: tr('保存') });
  if (v == null) return;
  const t = v.trim();
  if (!t) { emitToast('warn', tr('名称不能为空')); return; }
  try { await api.rename(id, t); await afterEdit(tr('已重命名')); } catch (e) { toastErr(e); }
}

async function renameFile(id, m) {
  const oldBase = (m && m.fileName ? m.fileName.replace(/\.3mf$/i, '') : (m && m.title) || '');
  const v = await promptDialog({ title: tr('修改磁盘文件名'), label: tr('新文件名（不含 .3mf）'), value: oldBase, confirmText: tr('下一步') });
  if (v == null) return;
  const name = v.trim();
  if (!name) { emitToast('warn', tr('文件名不能为空')); return; }
  const ok = await confirmDialog({
    title: tr('确认修改磁盘文件'),
    message: tr('此操作会直接重命名磁盘上的文件，并更新模型记录；若目标文件名已存在将被拒绝。'),
    detail: tr('原文件完整路径：'),
    items: [m.path || m.fileName || id],
    danger: true,
    confirmText: tr('确认改名'),
  });
  if (!ok) return;
  try {
    const updated = await api.renameFile(id, name);
    if (updated && updated.id) currentId = updated.id;   // renameFile 会迁移 id
    await afterEdit(tr('磁盘文件名已修改'));
  } catch (e) { toastErr(e); }
}

async function editCategory(id) {
  const options = [{ value: null, label: tr('不分类'), icon: 'i-folder-open', color: '#94a3b8' }]
    .concat((state.categories || []).map((c) => ({ value: c.id, label: c.name, icon: c.icon || 'i-folder', color: c.color })));
  const r = await selectDialog({ title: tr('设置分类'), message: tr('为模型指定分类'), options, mode: 'single' });
  if (r === undefined) return;
  try { await api.update(id, { categoryId: r }); await afterEdit(tr('分类已更新')); } catch (e) { toastErr(e); }
}

async function editTags(id) {
  const options = (state.tags || []).map((t) => ({ value: t.id, label: t.name, icon: 'i-tag', color: t.color }));
  const r = await selectDialog({ title: tr('编辑标签'), message: tr('可多选；选择"无 / 清除全部"将清空标签'), options, mode: 'multi', confirmText: tr('保存') });
  if (r === undefined) return;
  try { await api.tagAssign([id], r, 'set'); await afterEdit(tr('标签已更新')); } catch (e) { toastErr(e); }
}

async function cycleStatus(id, m) {
  const order = ['unprinted', 'queued', 'printing', 'printed'];  // 循环；failed 任意切入
  const cur = (m && m.printStatus) || 'unprinted';
  const next = (cur === 'failed' || !order.includes(cur))
    ? 'unprinted'
    : order[(order.indexOf(cur) + 1) % order.length];
  try { await api.setPrintStatus([id], next); await afterEdit(tr('状态：') + PRINT_STATUS[next].label); } catch (e) { toastErr(e); }
}

async function pickStatus(id) {
  const options = PRINT_STATUS_ORDER.map((k) => ({ value: k, label: PRINT_STATUS[k].label, icon: 'i-printer', color: PRINT_STATUS[k].color }));
  const r = await selectDialog({ title: tr('选择打印状态'), options, mode: 'single' });
  if (r === undefined) return;
  try { await api.setPrintStatus([id], r); await afterEdit(tr('状态：') + (PRINT_STATUS[r] ? PRINT_STATUS[r].label : r)); } catch (e) { toastErr(e); }
}

async function setRating(id, val) {
  if (!val) return;
  try { await api.update(id, { rating: val }); await afterEdit(tr('评分已更新')); } catch (e) { toastErr(e); }
}

async function toggleFav(id, m) {
  try { await api.update(id, { favorite: !(m && m.favorite) }); await afterEdit((m && m.favorite) ? tr('已取消收藏') : tr('已收藏')); } catch (e) { toastErr(e); }
}

async function doOpen(id) {
  // 走「用拓竹 / 用快造」选择器；具体提示由 openwith 组件统一给出
  await openModelsWithChoice([id]);
  await afterEdit(null);
}

function openSlicerMenu(id, node) {
  const slicers = (state.slicers || []).filter((s) => s && s.enabled !== false);
  if (!slicers.length) { emitToast('warn', tr('请先在「设置 → 切片软件」中配置')); return; }
  const items = slicers.map((s) => ({
    label: s.name, icon: 'i-printer',
    action: async () => {
      const res = await api.slicerOpen([id], s.id);
      if (res && Array.isArray(res.failed) && res.failed.length) {
        emitToast('error', (res.failed[0] && res.failed[0].error) || tr('打开失败'));
      } else {
        emitToast('success', tr('已用 ') + s.name + tr(' 打开'));
      }
      await api.markOpened(id);
      await afterEdit(null);
    },
  }));
  const rect = node.getBoundingClientRect();
  openMenu(rect.left, rect.bottom + 4, items);
}

async function doReveal(id) {
  try { await api.reveal(id); } catch (e) { toastErr(e); }
}
async function doCopyPath(id) {
  try { await api.copyPath(id); emitToast('success', tr('已复制路径')); } catch (e) { toastErr(e); }
}

function openMoreMenu(id, m, node) {
  const items = [
    { label: tr('重命名'), icon: 'i-edit', action: () => editTitle(id, m) },
    { label: tr('修改磁盘文件名'), icon: 'i-edit', action: () => renameFile(id, m) },
    { divider: true },
    { label: tr('添加到分类…'), icon: 'i-folder', action: () => chooseCategory([id]) },
    { label: tr('移出索引'), icon: 'i-minus', danger: true, action: () => removeFromIndex(id, m) },
    { label: tr('删除（移入回收站）'), icon: 'i-trash', danger: true, action: () => trashModel(id, m) },
  ];
  const rect = node.getBoundingClientRect();
  openMenu(rect.right, rect.bottom + 4, items);
}

async function removeFromIndex(id, m) {
  const ok = await confirmDialog({
    title: tr('移出索引'), message: tr('确定把该模型移出索引吗？磁盘文件不会被删除。'),
    detail: tr('以下路径将从模型库移除：'), items: [m.path || m.fileName || id],
    danger: true, confirmText: tr('移出索引'),
  });
  if (!ok) return;
  try {
    await api.remove([id]);
    closeDetail();
    emitToast('success', tr('已移出索引'));
    emitRefresh('remove');
  } catch (e) { toastErr(e); }
}

async function trashModel(id, m) {
  const ok = await confirmDialog({
    title: tr('移入回收站'), message: tr('确定把该文件移入回收站？此操作会移动磁盘文件，可从系统回收站恢复。'),
    detail: tr('以下文件将被移入回收站：'), items: [m.path || m.fileName || id],
    danger: true, confirmText: tr('移入回收站'),
  });
  if (!ok) return;
  try {
    const res = await api.trash([id]);
    if (res && Array.isArray(res.failed) && res.failed.length) {
      emitToast('error', (res.failed[0] && res.failed[0].error) || tr('移入回收站失败'));
    } else {
      closeDetail();
      emitToast('success', tr('已移入回收站'));
      emitRefresh('trash');
    }
  } catch (e) { toastErr(e); }
}

async function relink(id, m) {
  let candidates = [];
  try { candidates = await api.findRelinkCandidates(id); } catch (_) { /* 无候选走手动 */ }
  if (Array.isArray(candidates) && candidates.length) {
    const options = candidates.map((p) => ({ value: p, label: p, icon: 'i-box' }));
    options.push({ value: '__MANUAL__', label: tr('手动指定 / 粘贴路径…'), icon: 'i-edit' });
    const r = await selectDialog({ title: tr('重新定位文件'), message: tr('选择一个候选路径，或手动指定新位置'), options, mode: 'single' });
    if (r === undefined) return;
    if (r === '__MANUAL__') return manualRelink(id, m);
    return doRelink(id, r);
  }
  return manualRelink(id, m);
}

async function manualRelink(id, m) {
  const ok = await confirmDialog({
    title: tr('手动重新定位'),
    message: tr('未找到自动候选。请用系统文件选择定位该 .3mf 文件，或在下一步粘贴其完整路径。'),
    detail: tr('原文件完整路径：'), items: [m.path || m.fileName || id], confirmText: tr('继续'),
  });
  if (!ok) return;
  const p = await promptDialog({ title: tr('指定文件路径'), label: tr('完整 .3mf 路径'), value: m.path || '', placeholder: tr('D:\\模型\\xxx.3mf') });
  if (p == null) return;
  const path = p.trim();
  if (!path) return;
  return doRelink(id, path);
}

async function doRelink(id, path) {
  try {
    await api.relink(id, path);
    await afterEdit(tr('已重新定位'));
  } catch (e) { toastErr(e); }
}

async function openSource(id, m) {
  const url = safeSourceUrl(m && m.sourceUrl);
  if (!url) { emitToast('warn', tr('来源链接只支持 http(s) 开头的网址')); return; }
  try {
    const r = await api.openSource(id);
    if (r && r.fallback) {
      emitToast('info', tr(r.fallback === 'cn' ? 'makerworld.fallbackCn' : 'makerworld.fallbackGlobal'));
    }
  } catch (e) { toastErr(e); }
}

// ---------- 输入类保存（不重绘详情，保住焦点） ----------
const saveNote = debounce(async (id, value) => {
  if (!id) return;
  try {
    await api.update(id, { note: value });
    showSaved();
    emitRefresh('detail-edit');
  } catch (e) { toastErr(e); }
}, 500);

function showSaved() {
  const body = el('detail-body');
  const hint = body && body.querySelector('[data-role="save-hint"]');
  if (!hint) return;
  hint.textContent = tr('已保存');
  hint.classList.add('show');
  clearTimeout(saveHintTimer);
  saveHintTimer = setTimeout(() => hint.classList.remove('show'), 1800);
}

function onInput(e) {
  const t = e.target;
  if (t && t.dataset && t.dataset.field === 'note') saveNote(currentId, t.value);
}
function onChange(e) {
  const t = e.target;
  if (!t || !t.dataset || !t.dataset.field) return;
  const field = t.dataset.field;
  if (field !== 'sourceUrl' && field !== 'author') return;
  const id = currentId;
  if (!id) return;
  const patch = {};
  if (field === 'sourceUrl') {
    const raw = String(t.value || '').trim();
    if (raw && !SAFE_HTTP.test(raw)) {
      emitToast('warn', tr('来源链接只支持 http(s) 开头的网址，已忽略这次修改'));
      const m = itemById(id);
      t.value = safeSourceUrl(m && m.sourceUrl);   // 还原成已保存的有效值
      return;
    }
    patch[field] = raw;   // 规范化：去掉首尾空白
  } else {
    patch[field] = t.value;
  }
  Promise.resolve(api.update(id, patch))
    .then(() => { showSaved(); emitRefresh('detail-edit'); })
    .catch(toastErr);
}

// ---------- 重复文件切换（点击 / 上一个 / 下一个 / 键盘共用） ----------
/** 同组副本列表（含当前），供导航使用；只有一项时返回空 */
function dupSiblings(id) {
  const m = itemById(id);
  if (!m || !m.duplicateGroup) return [];
  const list = (state.items || []).filter((x) => x && x.duplicateGroup === m.duplicateGroup);
  return list.length > 1 ? list : [];
}

/** 切换到指定副本，带一个很轻的方向性淡入；direction: 'next' | 'prev' | 'jump' */
async function switchDuplicate(id, direction = 'jump') {
  if (!id || id === currentId) return;
  await openDetail(id);
  const body = el('detail-body');
  if (body && direction !== 'jump' && motionEnabled('fade')) {
    const dx = direction === 'next' ? 14 : -14;
    try {
      body.animate([
        { opacity: 0.55, transform: 'translateX(' + dx + 'px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 180, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'none' });
    } catch (_) { /* 老浏览器不支持 WAAPI 时跳过动画，不影响切换 */ }
  }
  // 这里不弹 toast：连续用 ← → 切换会叠一摞提示挡住右上角，
  // 而当前行高亮 +「第 N/M 个」+ 主图切换本身已经是即时反馈。
}

/** 相对当前位置移动 n 位（到头则不动） */
function stepDuplicate(n) {
  if (!currentId) return;
  const list = dupSiblings(currentId);
  if (!list.length) return;
  const i = list.findIndex((x) => x.id === currentId);
  const j = i + n;
  if (j < 0 || j >= list.length) return;
  Promise.resolve(switchDuplicate(list[j].id, n > 0 ? 'next' : 'prev')).catch(toastErr);
}

/** 详情打开且焦点不在输入框时，← → 切换重复副本 */
function onDetailKey(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const panel = el('detail');
  if (!panel || panel.hidden || !currentId) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const list = dupSiblings(currentId);
  if (!list.length) return;
  e.preventDefault();
  e.stopPropagation();
  stepDuplicate(e.key === 'ArrowRight' ? 1 : -1);
}

/** 只把这一个副本移入回收站；其他副本及各自的备注/状态不受影响 */
async function trashDuplicate(id) {
  const m = itemById(id);
  if (!m) return;
  const ok = await confirmDialog({
    title: tr('删除这个副本'),
    message: tr('确定只把这一个副本移入回收站吗？同组其他文件不受影响，之后可从系统回收站恢复。'),
    detail: tr('将被删除的文件：'), items: [m.path || m.fileName || id],
    danger: true, confirmText: tr('移入回收站'),
  });
  if (!ok) return;
  let res;
  try { res = await api.trash([id]); } catch (e) { toastErr(e); return; }
  const failed = (res && res.failed) || [];
  if (failed.length) {
    emitToast('error', (failed[0] && failed[0].error) || tr('删除失败'));
    return;
  }
  // 删的正是当前查看的副本：先切到同组剩下的一个（没有就关抽屉），
  // 再做全局刷新，避免刷新后拿着已失效的 currentId 取数据。
  if (id === currentId) {
    const rest = dupSiblings(id).filter((x) => x.id !== id);
    if (rest.length) await openDetail(rest[0].id);
    else closeDetail();
  }
  emitToast('success', tr('已把这个副本移入回收站'));
  emitRefresh('dup-trash');
}

// ---------- 事件分发 ----------
async function dispatch(act, node, id, m) {
  switch (act) {
    case 'title': return editTitle(id, m);
    case 'renameFile': return renameFile(id, m);
    case 'open': return doOpen(id);
    case 'meshopt': return openMeshOpt(id);
    case 'open-menu': return openSlicerMenu(id, node);
    case 'reveal': return doReveal(id);
    case 'copyPath': return doCopyPath(id);
    case 'preview': return openLightbox([id], 0);
    case 'fav': return toggleFav(id, m);
    case 'more': return openMoreMenu(id, m, node);
    case 'category': return editCategory(id);
    case 'tag': return editTags(id);
    case 'status-cycle': return cycleStatus(id, m);
    case 'status-pick': return pickStatus(id);
    case 'rating': return setRating(id, Number(node.dataset.val));
    case 'relink': return relink(id, m);
    case 'open-source': return openSource(id, m);
    case 'reveal-other': return doReveal(node.dataset.id || id);
    case 'dup-switch': return switchDuplicate(node.dataset.id, 'jump');
    case 'dup-prev': return stepDuplicate(-1);
    case 'dup-next': return stepDuplicate(1);
    case 'dup-trash': return trashDuplicate(node.dataset.id || id);
    case 'alias-detach': return detachAlias(node.dataset.id || id);
    case 'cost-assign': return assignFilaments(id, m);
    case 'passport-edit': return editPassport(id);
    case 'cost-weight': return editCostWeight(id, m);
    default: return;
  }
}

function onClick(e) {
  const body = el('detail-body');
  if (!body || !body.contains(e.target)) return;
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node || !currentId) return;
  const m = itemById(currentId);
  Promise.resolve(dispatch(node.dataset.act, node, currentId, m)).catch(toastErr);
}

// ---------- 对外导出 ----------
export function mountDetail() {
  if (mounted) return;
  mounted = true;
  const close = el('detail-close');
  if (close) close.addEventListener('click', () => closeDetail());
  const body = el('detail-body');
  if (body) {
    body.addEventListener('click', onClick);
    body.addEventListener('input', onInput);
    body.addEventListener('change', onChange);
  }
  // 捕获阶段：先于 app.js 的全局按键处理，避免 ← → 被别的逻辑吃掉
  window.addEventListener('keydown', onDetailKey, true);
}

export async function openDetail(id) {
  if (!id) return;
  currentId = id;
  setState({ activeId: id });
  const panel = el('detail');
  if (panel) panel.hidden = false;
  let m = itemById(id);
  if (!m) m = await fetchFresh(id);
  render(m);
}

export function closeDetail() {
  const panel = el('detail');
  if (panel) panel.hidden = true;
  currentId = null;
  lastRenderId = null;
  setState({ activeId: null });
}

export async function refreshDetail() {
  const panel = el('detail');
  if (!panel || panel.hidden || !currentId) return;
  const body = el('detail-body');
  // 输入中不重绘，避免光标/焦点丢失
  if (body && document.activeElement && body.contains(document.activeElement) &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const m = await fetchFresh(currentId);
  render(m);
}
