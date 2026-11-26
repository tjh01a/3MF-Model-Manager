'use strict';
import { t as tr } from '../i18n.js';

/**
 * 特殊视图：重复文件（duplicateGroup 并排对比）/ 失效文件（missing 重定位）。
 * 事件委托挂在 #content 上，动作统一用 sp- 前缀避免与 grid.js 卡片冲突。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, icon, fmtBytes, fmtDate } from '../utils.js';
import { confirmDialog, promptDialog, selectDialog } from '../components/modal.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const el = (id) => document.getElementById(id);
const itemById = (id) => (state.items || []).find((m) => m && m.id === id) || null;
const toastErr = (e) => emitToast('error', (e && e.message) || tr('操作失败'));

let mounted = false;

function empty(title, desc) {
  return '<div class="empty">' + icon('i-info') + '<h2>' + esc(title) + '</h2><p>' + esc(desc) + '</p></div>';
}

/**
 * 空列表但全库计数不为 0，说明是「筛选条件」把结果挡住了。
 * 不解释的话，用户看到的就是「左边徽标 79、右边列表 0 个」这种矛盾。
 */
function filterHint(kind) {
  const q = state.query || {};
  const reasons = [];
  if (q.categoryId) reasons.push(tr('分类'));
  if (q.keyword) reasons.push(tr('关键词'));
  if (Array.isArray(q.tagIds) && q.tagIds.length) reasons.push(tr('标签'));
  if (q.favoritesOnly) reasons.push(tr('只看收藏'));
  if (Number(q.ratingMin) > 0) reasons.push(tr('评分'));
  const global = kind === 'duplicates'
    ? ((state.stats && state.stats.duplicates) || 0)
    : ((state.stats && state.stats.missing) || 0);
  if (!reasons.length || !global) return '';
  const name = kind === 'duplicates' ? tr('重复文件') : tr('失效文件');
  return tr('全库其实有 ') + global + tr(' 个') + name + tr('，但当前筛选（') + reasons.join('、')
    + tr('）把它们挡住了 —— 点右上角「清除筛选」就能看到全部。');
}
function groupBy(items, key) {
  const map = new Map();
  for (const m of items) {
    if (!m || !m[key]) continue;
    if (!map.has(m[key])) map.set(m[key], []);
    map.get(m[key]).push(m);
  }
  return Array.from(map.values()).filter((g) => g.length > 1);
}
function thumb(m) {
  return m && m.thumbnail ? esc('shelf://thumbs/' + m.thumbnail) : 'assets/placeholder.svg';
}

/**
 * 「保留哪一个」的打分：内容既然完全相同，优先留下承载了人工信息的那份，
 * 否则用户写的备注/评分/分类会随着被删的那份一起消失。
 * 只有磁盘上还在的副本参与打分；失效/解析错误的交给「失效文件」视图处理。
 */
function keepScore(m) {
  if (!m) return -1;
  let s = 0;
  if (m.status !== 'missing' && m.status !== 'error') s += 1000;
  if (m.favorite) s += 200;
  s += Math.max(0, Math.min(5, Number(m.rating) || 0)) * 20;
  if (m.note && String(m.note).trim()) s += 60;
  if (Number(m.printCount) > 0) s += 40;
  if (m.printStatus && m.printStatus !== 'none') s += 10;
  if (m.categoryId) s += 20;
  s += Math.min(10, (m.tagIds || []).length) * 6;
  return s;
}

/** 分数相同时保留更早入库的那份；再相同按 id 兜底，保证每次结果可复现 */
function compareKeeper(a, b) {
  const d = keepScore(b) - keepScore(a);
  if (d) return d;
  const ta = Number(a && a.createdAt) || 0;
  const tb = Number(b && b.createdAt) || 0;
  if (ta !== tb) return ta - tb;
  return String(a && a.id || '').localeCompare(String(b && b.id || ''));
}

/**
 * 生成「每组留一个」的清理计划。只处理内容完全相同（duplicateGroup）的组，
 * 疑似重复（similarGroup）一律不碰——那是要靠人判断的。
 */
function planCleanup(items) {
  const groups = groupBy(items, 'duplicateGroup');
  const plans = [];
  const extras = [];
  for (const g of groups) {
    const healthy = g.filter((m) => m && m.status !== 'missing' && m.status !== 'error');
    if (healthy.length < 2) continue;   // 只剩一份（或都已失效）就没有可清理的
    const sorted = healthy.slice().sort(compareKeeper);
    const drop = sorted.slice(1);
    plans.push({ keeper: sorted[0], drop });
    for (const d of drop) extras.push(d);
  }
  return { plans, extras };
}

/** 确认清单里用短名，避免一屏都是超长路径 */
function shortName(m) {
  if (!m) return tr('未知文件');
  const name = m.fileName || m.title || '';
  if (name) return name;
  const p = String(m.path || '');
  return p.split(/[\\/]/).pop() || p || tr('未知文件');
}

// ---------- 重复文件 ----------
function dupCard(m, group, similar) {
  const others = group.filter((x) => x && x.id !== m.id);
  const otherIds = others.map((o) => o.id).join(',');
  return '<article class="dup-item" data-id="' + esc(m.id) + '">' +
    '<img class="dup-thumb" src="' + thumb(m) + '" alt="">' +
    '<div class="dup-info">' +
      '<div class="dup-name">' + esc(m.fileName || m.title || tr('未命名')) + '</div>' +
      '<div class="mono dup-path" title="' + esc(m.path || '') + '">' + esc(m.path || '—') + '</div>' +
      '<div class="muted">' + (m.size != null ? fmtBytes(m.size) : '—') +
        tr(' · 添加于 ') + (m.createdAt ? fmtDate(m.createdAt) : '—') + '</div>' +
    '</div>' +
    '<div class="dup-actions">' +
      (similar ? '' :
        '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-keep" data-id="' + esc(m.id) +
          '" data-others="' + esc(otherIds) + '">' + icon('i-check') + tr('<span>仅保留此文件</span></button>')) +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="sp-trash" data-id="' + esc(m.id) + '">' +
        icon('i-trash') + tr('<span>移入回收站</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-reveal" data-id="' + esc(m.id) + '">' +
        icon('i-folder-open') + tr('<span>定位文件</span></button>') +
    '</div></article>';
}

function dupGroup(group, similar) {
  const label = similar ? tr('疑似，请人工确认') : tr('内容完全相同');
  const ids = group.map((m) => m.id).join(',');
  const head = '<div class="dup-group-head">' +
    '<span class="badge' + (similar ? ' warn' : '') + '">' + icon(similar ? 'i-warning' : 'i-copy') + esc(label) + '</span>' +
    tr('<span class="muted">共 ') + group.length + tr(' 个文件</span>') +
    (similar ? '' :
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="sp-trash-group" data-ids="' + esc(ids) + '">' +
        icon('i-trash') + tr('<span>整组移入回收站</span></button>')) +
    '</div>';
  return '<section class="dup-group' + (similar ? ' similar' : '') + '">' + head +
    '<div class="dup-items">' + group.map((m) => dupCard(m, group, similar)).join('') + '</div></section>';
}

function renderDuplicates(items) {
  const groups = groupBy(items, 'duplicateGroup');
  const similar = groupBy(items, 'similarGroup');
  if (!groups.length && !similar.length) {
    return empty(tr('当前范围内没有重复模型'),
      filterHint('duplicates') || tr('内容哈希完全相同的文件会在这里成组显示，方便你清理冗余。'));
  }
  const plan = planCleanup(items);
  let out = '<div class="special-head"><div class="special-head-main">' +
    tr('<h2>重复文件</h2><p>按内容哈希完全相同的文件归为一组。</p></div>') +
    (plan.extras.length
      ? '<button type="button" class="btn btn-ghost btn-sm danger" data-act="sp-clean-all">' +
        icon('i-trash') + tr('<span>一键清除 · 每组留 1 个（') + plan.extras.length + '）</span></button>'
      : '') +
    '</div>';
  out += groups.length
    ? groups.map((g) => dupGroup(g, false)).join('')
    : empty(tr('没有内容完全相同的重复文件'), tr('仅有下方疑似重复，请人工确认。'));
  if (similar.length) {
    out += tr('<div class="special-head"><h2>疑似重复</h2>') +
      tr('<p class="warn">疑似，请人工确认：文件名与体积相近，但不保证内容相同，请谨慎处理。</p></div>');
    out += similar.map((g) => dupGroup(g, true)).join('');
  }
  return out;
}

// ---------- 失效文件 ----------
function missingCard(m) {
  const cat = (state.categories || []).find((c) => c && c.id === m.categoryId);
  const tags = (m.tagIds || []).map((id) => (state.tags || []).find((t) => t && t.id === id)).filter(Boolean);
  const kept = [
    cat ? tr('分类：') + cat.name : null,
    tags.length ? tr('标签：') + tags.map((t) => t.name).join('、') : null,
    m.note ? tr('备注：') + m.note : null,
  ].filter(Boolean);
  return '<article class="missing-item" data-id="' + esc(m.id) + '">' +
    '<div class="missing-main">' +
      '<div class="dup-name">' + esc(m.fileName || m.title || tr('未命名')) +
        '<span class="badge ' + (m.status === 'error' ? 'warn' : 'danger') + '">' +
        esc(m.status === 'error' ? tr('解析错误') : tr('已失效')) + '</span></div>' +
      '<div class="mono dup-path" title="' + esc(m.path || '') + '">' + esc(m.path || '—') + '</div>' +
      tr('<div class="muted">失效时间：') + (m.missingSince ? fmtDate(m.missingSince) : '—') + '</div>' +
      (kept.length ? '<div class="kept-fields">' + kept.map((k) => '<span class="chip">' + esc(k) + '</span>').join('') + '</div>' : '') +
    '</div>' +
    '<div class="dup-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-relink-auto" data-id="' + esc(m.id) + '">' +
        icon('i-search') + tr('<span>自动查找候选</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-relink-manual" data-id="' + esc(m.id) + '">' +
        icon('i-edit') + tr('<span>手动指定</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="sp-remove-missing" data-id="' + esc(m.id) + '">' +
        icon('i-trash') + tr('<span>移出索引</span></button>') +
    '</div></article>';
}

function renderMissing(items) {
  const missing = items.filter((m) => m && (m.status === 'missing' || m.status === 'error'));
  if (!missing.length) {
    return empty(tr('当前范围内没有失效模型'),
      filterHint('missing') || tr('所有已入库模型的磁盘文件均可正常访问。'));
  }
  return tr('<div class="special-head"><h2>失效文件</h2>') +
    tr('<p>这些模型的原文件已无法访问，可重新定位或移出索引；备注、标签、分类会保留。</p></div>') +
    '<div class="missing-list">' + missing.map(missingCard).join('') + '</div>';
}

// ---------- 操作后刷新（自取最新数据，不依赖 app.js 是否重绘特殊视图） ----------
async function refreshSpecial(mode) {
  emitRefresh('special');
  try {
    const r = await api.query(state.query || {});
    if (r && Array.isArray(r.items)) state.items = r.items;
  } catch (_) { /* 回退现有 state.items */ }
  renderSpecialView(mode);
}

// ---------- 各类操作 ----------
async function keepOne(id, othersStr) {
  const others = String(othersStr || '').split(',').filter(Boolean);
  if (!others.length) { emitToast('info', tr('该组没有其它文件')); return; }
  const keep = itemById(id);
  const paths = others.map((oid) => { const m = itemById(oid); return m ? (m.path || m.fileName || oid) : oid; });
  const ok = await confirmDialog({
    title: tr('仅保留此文件'), message: tr('将把同组其它 ') + others.length + tr(' 个文件移出索引（不删除磁盘文件）。'),
    detail: tr('保留：') + (keep ? (keep.path || keep.fileName) : '') + tr('；以下完整路径将移出索引：'),
    items: paths, danger: true, confirmText: tr('移出其它文件'),
  });
  if (!ok) return;
  try {
    const r = await api.remove(others);
    emitToast('success', tr('已移出 ') + ((r && r.removed) || others.length) + tr(' 个文件'));
    await refreshSpecial('duplicates');
  } catch (e) { toastErr(e); }
}

async function trashOne(id) {
  const m = itemById(id);
  const ok = await confirmDialog({
    title: tr('移入回收站'), message: tr('确定把该文件移入回收站？此操作会移动磁盘文件，可从系统回收站恢复。'),
    detail: tr('以下完整路径将被移入回收站：'), items: [m ? (m.path || m.fileName || id) : id],
    danger: true, confirmText: tr('移入回收站'),
  });
  if (!ok) return;
  try {
    const r = await api.trash([id]);
    if (r && Array.isArray(r.failed) && r.failed.length) {
      emitToast('error', (r.failed[0] && r.failed[0].error) || tr('移入回收站失败'));
    } else {
      emitToast('success', tr('已移入回收站'));
      await refreshSpecial('duplicates');
    }
  } catch (e) { toastErr(e); }
}

async function trashGroup(idsStr) {
  const ids = String(idsStr || '').split(',').filter(Boolean);
  if (!ids.length) return;
  const paths = ids.map((id) => { const m = itemById(id); return m ? (m.path || m.fileName || id) : id; });
  const ok = await confirmDialog({
    title: tr('整组移入回收站'), message: tr('将把该组 ') + ids.length + tr(' 个文件全部移入回收站（含磁盘文件）。'),
    detail: tr('以下完整路径将被移入回收站：'), items: paths, danger: true, confirmText: tr('全部移入回收站'),
  });
  if (!ok) return;
  try {
    const r = await api.trash(ids);
    if (r && Array.isArray(r.failed) && r.failed.length) {
      emitToast('error', r.failed.length + tr(' 个文件移入回收站失败'));
    } else {
      emitToast('success', tr('已移入回收站'));
      await refreshSpecial('duplicates');
    }
  } catch (e) { toastErr(e); }
}

/**
 * 一键清除：内容完全相同的组，每组只留一个，其余移入回收站。
 * 为什么不是「移出索引」——只移索引的话文件还在磁盘上，下次扫描会重新入库，
 * 用户会以为没清理干净。这里走回收站（可恢复），并同时把记录移出索引。
 */
let cleaning = false;
async function cleanupAll() {
  if (cleaning) return;
  const { plans, extras } = planCleanup(state.items || []);
  if (!extras.length) { emitToast('info', tr('没有可清理的重复文件')); return; }
  const lines = plans.slice(0, 8).map((p, i) =>
    tr('第 ') + (i + 1) + tr(' 组：保留「') + shortName(p.keeper) + tr('」，移入回收站 ') + p.drop.length + tr(' 个'));
  if (plans.length > 8) lines.push(tr('…另有 ') + (plans.length - 8) + tr(' 组，同样每组留 1 个'));
  const ok = await confirmDialog({
    title: tr('一键清除重复（每组留一个）'),
    message: tr('共 ') + plans.length + tr(' 组重复，保留 ') + plans.length + tr(' 个，把其余 ') + extras.length + tr(' 个移入回收站。'),
    detail: tr('保留规则：优先留有备注/评分/分类等人工信息的副本，其次留最早入库的。')
      + tr('磁盘文件进系统回收站可恢复，记录同时从索引移除；「疑似重复」不参与一键清除。'),
    items: lines, danger: true, confirmText: tr('移入回收站并清理'), cancelText: tr('先不清除'),
  });
  if (!ok) return;
  cleaning = true;
  try {
    const r = await api.trash(extras.map((m) => m.id)) || {};
    const done = Array.isArray(r.ok) ? r.ok.length : 0;
    const failed = Array.isArray(r.failed) ? r.failed : [];
    if (failed.length) {
      emitToast(done ? 'warn' : 'error',
        tr('已清理 ') + done + tr(' 个，') + failed.length + tr(' 个失败（') + ((failed[0] && failed[0].error) || tr('未知原因')) + '）');
    } else {
      emitToast('success', tr('已清理 ') + done + tr(' 个重复文件，每组保留 1 个'));
    }
  } catch (e) {
    toastErr(e);
  } finally {
    cleaning = false;
    await refreshSpecial('duplicates');
  }
}

async function relinkAuto(id) {
  let candidates = [];
  try { candidates = await api.findRelinkCandidates(id); } catch (_) { /* 无候选走手动 */ }
  if (Array.isArray(candidates) && candidates.length) {
    const options = candidates.map((p) => ({ value: p, label: p, icon: 'i-box' }));
    const r = await selectDialog({
      title: tr('自动查找候选'), message: tr('选择一个候选路径重新定位，或取消后手动指定'), options, mode: 'single',
    });
    if (r === undefined) return;
    return doRelink(id, r);
  }
  emitToast('info', tr('未找到自动候选，请手动指定'));
  return relinkManual(id);
}

async function relinkManual(id) {
  const m = itemById(id);
  const ok = await confirmDialog({
    title: tr('手动指定路径'),
    message: tr('请用系统文件选择定位该 .3mf 文件；若不便使用文件选择，可在下一步直接粘贴完整路径。'),
    detail: tr('原完整路径：'), items: [m ? (m.path || m.fileName || id) : id], confirmText: tr('继续'),
  });
  if (!ok) return;
  const p = await promptDialog({
    title: tr('指定文件路径'), label: tr('完整 .3mf 路径'), value: m ? (m.path || '') : '', placeholder: tr('D:\\模型\\xxx.3mf'),
  });
  if (p == null) return;
  const path = p.trim();
  if (!path) return;
  return doRelink(id, path);
}

async function doRelink(id, path) {
  try {
    await api.relink(id, path);
    emitToast('success', tr('已重新定位'));
    await refreshSpecial('missing');
  } catch (e) { toastErr(e); }
}

async function removeMissing(id) {
  const m = itemById(id);
  const ok = await confirmDialog({
    title: tr('移出索引'), message: tr('确定把该失效模型移出索引？磁盘文件不会被删除。'),
    detail: tr('以下完整路径将移出索引：'), items: [m ? (m.path || m.fileName || id) : id],
    danger: true, confirmText: tr('移出索引'),
  });
  if (!ok) return;
  try {
    await api.remove([id]);
    emitToast('success', tr('已移出索引'));
    await refreshSpecial('missing');
  } catch (e) { toastErr(e); }
}

async function dispatch(act, d) {
  switch (act) {
    case 'sp-keep': return keepOne(d.id, d.others);
    case 'sp-trash': return trashOne(d.id);
    case 'sp-trash-group': return trashGroup(d.ids);
    case 'sp-clean-all': return cleanupAll();
    case 'sp-reveal': return api.reveal(d.id);
    case 'sp-relink-auto': return relinkAuto(d.id);
    case 'sp-relink-manual': return relinkManual(d.id);
    case 'sp-remove-missing': return removeMissing(d.id);
    default: return;
  }
}

function onClick(e) {
  const content = el('content');
  if (!content || !content.contains(e.target)) return;
  // 仅在特殊视图下接管，且只处理 sp- 前缀动作
  if (state.contentMode !== 'duplicates' && state.contentMode !== 'missing') return;
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node || !String(node.dataset.act || '').startsWith('sp-')) return;
  Promise.resolve(dispatch(node.dataset.act, node.dataset)).catch(toastErr);
}

// ---------- 对外导出 ----------
export function mountSpecialView() {
  if (mounted) return;
  mounted = true;
  const content = el('content');
  if (content) content.addEventListener('click', onClick);
}

export function renderSpecialView(mode) {
  const content = el('content');
  if (!content) return;
  const m = mode === 'missing' ? 'missing' : 'duplicates';
  setState({ contentMode: m });
  const items = state.items || [];
  content.innerHTML = m === 'duplicates' ? renderDuplicates(items) : renderMissing(items);
  content.className = 'content-special';
}
