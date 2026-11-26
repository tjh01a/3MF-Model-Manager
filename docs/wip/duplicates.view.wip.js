'use strict';
import { t as tr } from '../i18n.js';

/**
 * 特殊视图：
 *   重复文件（duplicateGroup 并排对比 + 智能合并）/ 失效文件（missing 重定位）/ 同款变体（几何指纹）。
 * 事件委托挂在 #content 上，动作统一用 sp- 前缀避免与 grid.js 卡片冲突。
 * 「损坏文件隔离区」的渲染与点击在 views/quarantine.js，这里只做转交。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, icon, fmtBytes, fmtDate } from '../utils.js';
import { confirmDialog, promptDialog, selectDialog } from '../components/modal.js';
import { renderBroken, onBrokenClick, leaveBroken } from './quarantine.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const el = (id) => document.getElementById(id);
const itemById = (id) => (state.items || []).find((m) => m && m.id === id) || null;
const toastErr = (e) => emitToast('error', (e && e.message) || tr('操作失败'));

let mounted = false;

function empty(title, desc, extra) {
  return '<div class="empty">' + icon('i-info') + '<h2>' + esc(title) + '</h2><p>' + esc(desc) + '</p>' + (extra || '') + '</div>';
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
function shortName(m) {
  if (!m) return tr('未知文件');
  return m.fileName || m.title || String(m.path || '').split(/[\\/]/).pop() || tr('未知文件');
}

// ---------- 智能合并（C） ----------

/** 用户在界面上手动改选的「主记录」：groupKey -> id。没选过就用服务端推荐的。 */
const picked = new Map();
/** 最近一次拉到的合并分组，按 key 索引 */
let groupIndex = new Map();
let mergeBusy = false;

function pickFor(g) {
  const id = picked.get(g.key);
  return (id && g.members.some((m) => m.id === id)) ? id : g.keeperId;
}

function memberRow(g, m, isKeeper) {
  const role = m.variantRole && m.variantRole !== 'base' ? variantBadge(m) : '';
  const reasons = (isKeeper && g.keeperReasons && g.keeperReasons.length)
    ? tr('<span class="muted dup-reasons">推荐保留：') + esc(g.keeperReasons.join('、')) + '</span>' : '';
  const trashed = m.aliasState === 'trashed';
  return '<article class="dup-item dup-pick' + (isKeeper ? ' is-keeper' : '') + '" data-id="' + esc(m.id) + '">' +
    '<label class="dup-radio" title="' + esc(tr('设为保留的主记录')) + '">' +
      '<input type="radio" name="pick-' + esc(g.key) + '"' + (isKeeper ? ' checked' : '') +
        ' data-act="sp-pick" data-group="' + esc(g.key) + '" data-id="' + esc(m.id) + '">' +
      '<span class="dup-radio-dot"></span></label>' +
    '<img class="dup-thumb" src="' + thumb(m) + '" alt="">' +
    '<div class="dup-info">' +
      '<div class="dup-name">' + esc(shortName(m)) + role +
        (isKeeper ? tr('<span class="badge badge-dup">保留</span>') : '') +
        (trashed ? tr('<span class="badge">文件已进回收站</span>') : '') + '</div>' +
      '<div class="mono dup-path" title="' + esc(m.path || '') + '">' + esc(m.path || '—') + '</div>' +
      '<div class="muted">' + (m.size != null ? fmtBytes(m.size) : '—') +
        (m.printCount ? tr(' · 打印过 ') + m.printCount + tr(' 次') : '') +
        (m.note ? tr(' · 有备注') : '') +
        (m.favorite ? tr(' · 已收藏') : '') +
        tr(' · 添加于 ') + (m.createdAt ? fmtDate(m.createdAt) : '—') + '</div>' +
      reasons +
    '</div>' +
    '<div class="dup-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-reveal" data-id="' + esc(m.id) + '">' +
        icon('i-folder-open') + tr('<span>定位文件</span></button>' +
    '</div></article>';
}

function variantBadge(m) {
  if (m.variantRole === 'same') return tr('<span class="badge badge-ok">同一模型</span>');
  if (m.variantRole === 'scaled') {
    const s = Number(m.variantScale);
    return '<span class="badge badge-ok">' + esc(tr('缩放版')) + ' ×' + (isFinite(s) ? s.toFixed(2).replace(/\.?0+$/, '') : '—') + '</span>';
  }
  const pct = m.variantScore == null ? null : Math.round(Number(m.variantScore) * 100);
  return '<span class="badge warn">' + esc(tr('疑似')) + (pct != null ? ' · ' + tr('相似度') + ' ' + pct + '%' : '') + '</span>';
}

function groupCard(g) {
  const isExact = g.kind === 'exact';
  const isVariant = g.kind === 'variant';
  const label = isExact ? tr('内容完全相同') : (isVariant ? tr('几何指纹相近') : tr('疑似，请人工确认'));
  const cls = isExact ? '' : ' warn';
  const keeperId = pickFor(g);
  const rows = g.members.map((m) => memberRow(g, m, m.id === keeperId)).join('');
  const note = isExact
    ? tr('每组的文件内容一模一样，可以放心合并。')
    : (isVariant
      ? tr('形状相近但不保证内容相同，请看缩略图确认后再合并。')
      : tr('文件名与体积相近，但不保证内容相同，请谨慎处理。'));
  return '<section class="dup-group' + (isExact ? '' : ' similar') + '" data-group="' + esc(g.key) + '">' +
    '<div class="dup-group-head">' +
      '<span class="badge' + cls + '">' + icon(isExact ? 'i-copy' : 'i-layers') + esc(label) + '</span>' +
      tr('<span class="muted">共 ') + g.members.length + tr(' 个文件</span>') +
      (g.freedBytes ? tr('<span class="muted">合并后可释放约 ') + esc(fmtBytes(g.freedBytes)) + '</span>' : '') +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-merge" data-group="' + esc(g.key) + '" title="' + esc(tr('其余文件降为这个主记录的「副本」，不再出现在列表里；磁盘文件保持不动')) + '">' +
        icon('i-copy') + tr('<span>合并 · 只标为副本</span></button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="sp-merge-trash" data-group="' + esc(g.key) + '" title="' + esc(tr('其余文件降为副本，并把它们的文件移入系统回收站')) + '">' +
        icon('i-trash') + tr('<span>合并并移入回收站</span></button>' +
      (isVariant ? '' :
        '<button type="button" class="btn btn-ghost btn-sm danger" data-act="sp-trash-group" data-ids="' + esc(g.members.map((m) => m.id).join(',')) + '">' +
          icon('i-trash') + tr('<span>整组移入回收站</span></button>') +
    '</div>' +
    '<p class="dup-note">' + esc(note) + '</p>' +
    '<div class="dup-items">' + rows + '</div></section>';
}

async function loadGroups(kinds) {
  try {
    const r = await api.dupMergePreview();
    groupIndex = new Map(((r && r.groups) || []).map((g) => [g.key, g]));
    return r;
  } catch (_) { return null; }
}

async function renderDuplicates() {
  const content = el('content');
  if (!content) return;
  const r = await loadGroups();
  const groups = r ? (r.groups || []) : [];
  const exact = groups.filter((g) => g.kind === 'exact');
  const similar = groups.filter((g) => g.kind === 'similar');
  if (!exact.length && !similar.length) {
    const extra = (state.stats && state.stats.aliases) ? '<p>' + esc(tr('已有 ') + state.stats.aliases + tr(' 个副本挂在主记录下，可在详情页查看或解除。')) + '</p>' : '';
    content.innerHTML = empty(tr('当前范围内没有重复模型'),
      filterHint('duplicates') || tr('内容哈希完全相同的文件会在这里成组显示，方便你清理冗余。'), extra);
    return;
  }
  const totalBytes = exact.reduce((s, g) => s + (Number(g.freedBytes) || 0), 0);
  const aliasCount = exact.reduce((s, g) => s + g.members.length - 1, 0);
  let out = '<div class="special-head"><div class="special-head-main">' +
    tr('<h2>重复文件</h2><p>每组选一条作为主记录，其余降为它的「副本」：不再占列表、不重复计数，备注和打印记录都会保留。</p></div>' +
    (exact.length
      ? '<button type="button" class="btn btn-primary btn-sm" data-act="sp-merge-all" data-ids="' + esc(exact.map((g) => g.key).join('|')) + '">' +
        icon('i-trash') + tr('<span>一键合并全部完全重复（') + aliasCount + tr(' 个 · 约 ') + esc(fmtBytes(totalBytes)) + '）</span></button>'
      : '') +
    '</div>';
  out += exact.map(groupCard).join('');
  if (similar.length) {
    out += tr('<div class="special-head"><h2>疑似重复</h2>') +
      tr('<p class="warn">文件名与体积相近，但不保证内容相同，请看缩略图确认后再合并。</p></div>');
    out += similar.map(groupCard).join('');
  }
  content.innerHTML = out;
}

// ---------- 同款变体（A） ----------

let shapeTimer = null;
function stopShapePolling() {
  if (shapeTimer) { clearInterval(shapeTimer); shapeTimer = null; }
}

async function renderVariants() {
  const content = el('content');
  if (!content) return;
  let st = null;
  try { st = await api.shapeStatus(); } catch (_) { st = null; }
  if (state.contentMode !== 'variants' || !content) return;
  const groups = groupBy(state.items || [], 'variantGroup');
  const running = st && st.running;
  const members = groups.reduce((s, g) => s + g.length, 0);

  let statusHtml = '';
  if (st) {
    const bits = [];
    if (running) bits.push(tr('正在后台计算…'));
    bits.push(tr('已计算 ') + (st.total || 0) + tr(' 个模型'));
    if (st.pending && !running) bits.push(tr('还有 ') + st.pending + tr(' 个待计算'));
    if (st.failed) bits.push(tr(st.failed + ' 个没有 3D 网格（切片文件）已跳过'));
    statusHtml = '<p class="muted">' + esc(bits.join(tr(' · '))) + '</p>' +
      '<div class="dup-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-shape-run"' + (running ? ' disabled' : '') + '>' +
          icon('i-refresh') + tr('<span>计算 / 更新</span></button>' +
        (running ? '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-shape-stop">' + tr('<span>暂停</span></button>' : '') +
      '</div>';
  }

  if (!groups.length) {
    content.innerHTML = empty(tr('还没有发现同款变体'),
      tr('同一个模型改了颜色、放大缩小、换个姿势重新导出，文件名和哈希都会变，但形状是一样的。软件会在后台按形状比对，把这类文件归到这里。'),
      '<div class="empty-extra">' + statusHtml + '</div>');
    if (running && !shapeTimer) shapeTimer = setInterval(() => { if (state.contentMode === 'variants') refreshSpecial('variants'); else stopShapePolling(); }, 2500);
    return;
  }
  let out = '<div class="special-head"><div class="special-head-main">' +
    tr('<h2>同款变体</h2><p>按网格形状比对得出的结果，不看文件名。') +
    tr('<b>同一模型</b>可以放心合并，<b>疑似</b>请对照缩略图确认。</p>') + statusHtml + '</div></div>';
  out += groups.map((list) => {
    const g = {
      key: 'variant:' + list[0].variantGroup,
      kind: 'variant',
      members: list.map((m) => Object.assign({ reasons: [] }, m)),
      keeperId: (list.find((x) => x.variantRole === 'base') || list[0]).id,
      keeperReasons: [tr('最早入库的那一个')],
      freedBytes: list.slice(1).reduce((s, m) => s + (Number(m.size) || 0), 0),
    };
    return groupCard(g);
  }).join('');
  content.innerHTML = out;
  if (running && !shapeTimer) shapeTimer = setInterval(() => { if (state.contentMode === 'variants') refreshSpecial('variants'); else stopShapePolling(); }, 2500);
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
        icon('i-search') + tr('<span>自动查找候选</span></button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="sp-relink-manual" data-id="' + esc(m.id) + '">' +
        icon('i-edit') + tr('<span>手动指定</span></button>' +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="sp-remove-missing" data-id="' + esc(m.id) + '">' +
        icon('i-trash') + tr('<span>移出索引</span></button>' +
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

function linesForMerge(selection) {
  const lines = [];
  let n = 0;
  for (const key of Object.keys(selection)) {
    const g = groupIndex.get(key);
    if (!g) continue;
    const keepId = selection[key];
    const keep = g.members.find((m) => m.id === keepId);
    lines.push(tr('保留「') + shortName(keep || {}) + tr('」，其余 ') + (g.members.length - 1) + tr(' 个降为副本'));
    n += g.members.length - 1;
    if (lines.length >= 8) break;
  }
  const total = Object.keys(selection).length;
  if (total > 8) lines.push(tr('…另有 ') + (total - 8) + tr(' 组'));
  return { lines, n };
}

/** 合并一组或几组。trash=true 时先把副本文件移入回收站。 */
async function doMerge(keys, trash) {
  if (mergeBusy || !keys.length) return;
  const selection = {};
  for (const key of keys) {
    const g = groupIndex.get(key);
    if (!g) continue;
    selection[key] = pickFor(g);
  }
  if (!Object.keys(selection).length) return;
  const { lines, n } = linesForMerge(selection);
  const freed = keys.reduce((s, key) => s + (Number((groupIndex.get(key) || {}).freedBytes) || 0), 0);
  const groupCount = Object.keys(selection).length;
  const ok = await confirmDialog({
    title: trash ? tr('合并并移入回收站') : tr('合并 · 只标为副本'),
    message: trash
      ? tr('共 ') + groupCount + tr(' 组：保留 ') + groupCount + tr(' 个主记录，其余 ') + n + tr(' 个降为副本，并把它们的文件移入系统回收站（约 ') + esc(fmtBytes(freed)) + tr('）。')
      : tr('共 ') + groupCount + tr(' 组：保留 ') + groupCount + tr(' 个主记录，其余 ') + n + tr(' 个降为副本。磁盘文件不动。'),
    detail: tr('保留规则：优先留有缩略图、备注、打印记录的那份，其次留最早入库的。可在每组里手动改选。')
      + (trash
        ? tr('副本的备注和打印记录会保留在主记录的详情页。软件只能解除副本关系，不能把文件从回收站取回；要还原请到系统回收站操作。')
        : tr('副本的备注和打印记录会保留在主记录的详情页，随时可以解除。')),
    items: lines, danger: !!trash,
    confirmText: trash ? tr('合并并移入回收站') : tr('合并'),
  });
  if (!ok) return;
  mergeBusy = true;
  try {
    const r = await api.dupMergeApply(selection, { trash: !!trash }) || {};
    const failed = Array.isArray(r.failed) ? r.failed : [];
    for (const key of keys) picked.delete(key);
    if (failed.length) {
      emitToast(r.merged ? 'warn' : 'error',
        tr('已合并 ') + (r.merged || 0) + tr(' 组，') + failed.length + tr(' 个文件移入回收站失败（')
        + ((failed[0] && failed[0].error) || tr('未知原因')) + '）');
    } else if (r.merged) {
      emitToast('success', trash
        ? tr('已合并 ') + r.merged + tr(' 组，') + (r.trashed || 0) + tr(' 个副本进了回收站，约释放 ') + esc(fmtBytes(r.freedBytes || 0))
        : tr('已合并 ') + r.merged + tr(' 组，') + (r.shadow || 0) + tr(' 个降为副本'));
    } else {
      emitToast('info', tr('没有需要合并的文件'));
    }
  } catch (e) {
    toastErr(e);
  } finally {
    mergeBusy = false;
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

function pick(d) {
  picked.set(d.group, d.id);
  const section = el('content').querySelector('[data-group="' + (window.CSS && CSS.escape ? CSS.escape(d.group) : d.group) + '"]');
  if (!section) return;
  // 只更新这一组的选中态，不整页重绘（否则滚动位置会跳）
  for (const row of section.querySelectorAll('.dup-item')) {
    const on = row.dataset.id === d.id;
    row.classList.toggle('is-keeper', on);
    const radio = row.querySelector('input[type="radio"]');
    if (radio) radio.checked = on;
  }
}

async function dispatch(act, d) {
  switch (act) {
    case 'sp-pick': pick(d); return;
    case 'sp-merge': return doMerge([d.group], false);
    case 'sp-merge-trash': return doMerge([d.group], true);
    case 'sp-merge-all': return doMerge(String(d.ids || '').split('|').filter(Boolean), true);
    case 'sp-shape-run': {
      try { const r = await api.shapeRun({ force: d.force === '1' }); if (r && r.started === false) emitToast('info', r.reason || tr('没有需要计算的模型')); }
      catch (e) { toastErr(e); }
      await refreshSpecial('variants');
      return;
    }
    case 'sp-shape-stop': try { await api.shapeStop(); } catch (e) { toastErr(e); } return;
    case 'sp-trash': return trashOne(d.id);
    case 'sp-trash-group': return trashGroup(d.ids);
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
  const mode = state.contentMode;
  if (mode !== 'duplicates' && mode !== 'missing' && mode !== 'variants') return;
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node) return;
  const act = String(node.dataset.act || '');
  if (!act.startsWith('sp-')) return;
  // 单选按钮的默认行为（选中）保留，这里只记下选择
  Promise.resolve(dispatch(act, node.dataset)).catch(toastErr);
}

// ---------- 对外导出 ----------
export function mountSpecialView() {
  if (mounted) return;
  mounted = true;
  const content = el('content');
  if (content) {
    content.addEventListener('click', (e) => {
      if (state.contentMode === 'broken') { onBrokenClick(e); return; }
      onClick(e);
    });
  }
}

export function renderSpecialView(mode) {
  const content = el('content');
  if (!content) return;
  if (mode !== 'variants' && mode !== 'broken') stopShapePolling();
  if (mode === 'broken') { setState({ contentMode: 'broken' }); leaveVariants(); content.className = 'content-special'; renderBroken(content); return; }
  if (mode === 'variants') { setState({ contentMode: 'variants' }); content.className = 'content-special'; renderVariants(); return; }
  leaveVariants();
  const m = mode === 'missing' ? 'missing' : 'duplicates';
  setState({ contentMode: m });
  const items = state.items || [];
  content.className = 'content-special';
  if (m === 'duplicates') { content.innerHTML = ''; renderDuplicates(); }
  else content.innerHTML = renderMissing(items);
}

function leaveVariants() { stopShapePolling(); }
