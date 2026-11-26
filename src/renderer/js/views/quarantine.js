'use strict';
import { t as tr } from '../i18n.js';

/**
 * B · 损坏文件隔离区视图（侧栏「质量检查 → 损坏文件」）。
 *
 * 数据来自 api.brokenList()（记录里的 parseErrorKind，不读磁盘），
 * 所有动作都是「先确认、再执行、失败逐条报告」，与重复文件视图的 sp- 前缀分开：
 * 这里统一用 br- 前缀，避免和 grid.js / duplicates.js 的动作串味。
 *
 * 一个刻意的取舍：不做勾选 + 批量操作栏，而是每行给动作 + 顶部「重试全部」。
 * 坏文件通常只有个位数，逐条确认比维护一套选择集更安全；而且浏览器的
 * state.selection 是模型卡片专用的，混用会把「删除勾选」错指到坏文件上。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, icon, fmtBytes, fmtDate } from '../utils.js';
import { confirmDialog } from '../components/modal.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const el = (id) => document.getElementById(id);
const toastErr = (e) => emitToast('error', (e && e.message) || tr('操作失败'));

/** 最近一次拉到的数据，动作后重绘用；避免每次都重新 invoke 又读旧值 */
let last = null;
let busy = false;

function idsOf(d) {
  const raw = String(d.ids || d.id || '').trim();
  return raw ? raw.split(',').filter(Boolean) : [];
}

function row(it) {
  const thumbSrc = it.thumbnail ? esc('shelf://thumbs/' + it.thumbnail) : 'assets/placeholder.svg';
  const quarantined = !!it.quarantined;
  const bits = [
    it.size != null ? fmtBytes(it.size) : null,
    it.mtime ? tr('修改于 ') + fmtDate(it.mtime) : null,
    it.createdAt ? tr('入库于 ') + fmtDate(it.createdAt) : null,
  ].filter(Boolean).join(tr(' · '));

  const actions = quarantined
    ? '<button type="button" class="btn btn-ghost btn-sm" data-act="br-restore" data-ids="' + esc(it.id) + '">' +
        icon('i-undo') + tr('<span>移回原处</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="br-forget" data-ids="' + esc(it.id) + '">' +
        icon('i-x') + tr('<span>移出索引</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="br-trash" data-ids="' + esc(it.id) + '">' +
        icon('i-trash') + tr('<span>移入回收站</span></button>')
    : '<button type="button" class="btn btn-ghost btn-sm" data-act="br-retry" data-ids="' + esc(it.id) + '">' +
        icon('i-refresh') + tr('<span>重试解析</span></button>') +
      (it.repairable
        ? '<button type="button" class="btn btn-primary btn-sm" data-act="br-repair" data-id="' + esc(it.id) + '">' +
          icon('i-wrench') + tr('<span>尝试修复</span></button>')
        : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="br-quarantine" data-ids="' + esc(it.id) + '">' +
        icon('i-folder') + tr('<span>移入隔离区</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="br-forget" data-ids="' + esc(it.id) + '">' +
        icon('i-x') + tr('<span>移出索引</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="br-trash" data-ids="' + esc(it.id) + '">' +
        icon('i-trash') + tr('<span>移入回收站</span></button>');

  return '<article class="br-item' + (quarantined ? ' is-quarantined' : '') + '" data-id="' + esc(it.id) + '">' +
    '<img class="br-thumb" src="' + thumbSrc + '" alt="">' +
    '<div class="br-main">' +
      '<div class="br-name"><span class="br-file">' + esc(it.fileName || tr('未命名')) + '</span>' +
        '<span class="badge warn">' + esc(tr(it.kindLabel)) + '</span>' +
        (it.repairable && !quarantined ? '<span class="badge badge-ok">' + esc(tr('可尝试修复')) + '</span>' : '') +
        (quarantined ? '<span class="badge">' + esc(tr('已隔离')) + '</span>' : '') +
      '</div>' +
      '<div class="mono dup-path" title="' + esc(it.path) + '">' + esc(it.path || '—') + '</div>' +
      '<div class="muted">' + esc(bits) + '</div>' +
      '<div class="br-hint">' + esc(tr(it.hint)) +
        (it.message ? tr('<span class="br-raw mono">原始报错：') + esc(it.message) + '</span>' : '') +
        (quarantined && it.quarantinedAt ? tr('<span class="br-raw">隔离于 ') + esc(fmtDate(it.quarantinedAt)) + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="dup-actions br-actions">' + actions + '</div>' +
  '</article>';
}

function paint(content, r) {
  const items = (r && r.items) || [];
  const s = (r && r.summary) || { total: 0, quarantined: 0, repairable: 0, bytes: 0 };
  if (!items.length) {
    content.innerHTML = '<div class="empty">' + icon('i-check') +
      '<h2>' + esc(tr('没有发现损坏文件')) + '</h2>' +
      '<p>' + esc(tr('扫描时解析失败的 3MF 会出现在这里：能重试、能尝试修复、能隔离或移入回收站，不会再散落在正常网格里当占位图。')) + '</p>' +
      (s.total ? '<p>' + esc(tr('当前筛选下没有可显示的条目，但全库共有 ') + s.total + tr(' 个损坏文件。')) + '</p>' : '') +
      '</div>';
    return;
  }
  const active = items.filter((x) => !x.quarantined);
  const head = '<div class="special-head"><div class="special-head-main">' +
    tr('<h2>损坏文件</h2><p>这些文件解析失败了：可以重试、尝试修复，或移入隔离区 / 回收站。原始文件除非你确认「替换」，否则不会被改动。</p>') +
    '<p class="muted">' + esc(tr('共 ') + s.total + tr(' 个 · 未隔离 ') + active.length + tr(' 个 · 可修复 ') + (s.repairable || 0) +
      tr(' 个 · 已隔离 ') + (s.quarantined || 0) + tr(' 个 · 占用 ') + (s.bytes ? fmtBytes(s.bytes) : '0 B')) + '</p>' +
    '</div>' +
    '<div class="dup-actions">' +
      (active.length
        ? '<button type="button" class="btn btn-ghost btn-sm" data-act="br-retry" data-ids="' + esc(active.map((x) => x.id).join(',')) + '">' +
          icon('i-refresh') + tr('<span>重试全部</span></button>') +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="br-quarantine" data-ids="' + esc(active.map((x) => x.id).join(',')) + '">' +
          icon('i-folder') + tr('<span>未隔离的全部移入隔离区</span></button>')
        : '') +
    '</div></div>';
  content.innerHTML = head + '<div class="br-list">' + items.map(row).join('') + '</div>';
}

export function renderBroken(content) {
  const c = content || el('content');
  if (!c) return;
  c.className = 'content-special';
  last = null;
  Promise.resolve(api.brokenList()).then((r) => {
    if (state.contentMode !== 'broken') return;   // 期间用户切走了
    last = r;
    paint(c, r);
  }).catch((e) => {
    if (state.contentMode !== 'broken') return;
    c.innerHTML = '<div class="empty">' + icon('i-alert') + '<h2>' + esc(tr('读取损坏文件列表失败')) + '</h2>' +
      '<p>' + esc((e && e.message) || tr('未知原因')) + '</p></div>';
  });
}

/** 动作完成后重绘：坏文件列表不参与 query()，只能自己再拉一次 */
async function reload() {
  try {
    const r = await api.brokenList();
    last = r;
    const content = el('content');
    if (state.contentMode === 'broken' && content) paint(content, r);
    emitRefresh('broken');
  } catch (e) { toastErr(e); }
}

async function retry(ids) {
  if (!ids.length || busy) return;
  busy = true;
  try {
    const r = await api.brokenRetry(ids) || {};
    const ok = Array.isArray(r.ok) ? r.ok : [];
    const still = Array.isArray(r.still) ? r.still : [];
    const missing = Array.isArray(r.missing) ? r.missing : [];
    if (ok.length) {
      emitToast(still.length || missing.length ? 'warn' : 'success',
        tr('已恢复 ') + ok.length + tr(' 个文件') +
        (still.length ? tr('，') + still.length + tr(' 个仍无法解析') : '') +
        (missing.length ? tr('，') + missing.length + tr(' 个文件已不存在（已归入失效文件）') : ''));
    } else {
      emitToast('warn', tr('仍然无法解析') + (still[0] && still[0].error ? tr('：') + still[0].error : ''));
    }
    await reload();
  } catch (e) { toastErr(e); } finally { busy = false; }
}

async function repair(id) {
  if (busy || !id) return;
  const it = last && (last.items || []).find((x) => x.id === id);
  const ok = await confirmDialog({
    title: tr('尝试修复'),
    message: tr('会按压缩包结构把能读出的条目重新打包到新文件，原文件不会被改动。修不好的条目会被丢弃，属于尽力而为，不保证一定能打开。'),
    detail: tr('修复产物：') + ' <原名>.repaired.3mf',
    items: [it ? (it.path || it.fileName || id) : id],
    confirmText: tr('开始修复'),
  });
  if (!ok) return;
  busy = true;
  let r;
  try {
    r = await api.brokenRepair(id);
  } catch (e) {
    emitToast('error', (e && e.message) || tr('修复失败'));
    busy = false;
    return;
  } finally { busy = false; }
  const skipped = (r && Array.isArray(r.skipped)) ? r.skipped.length : 0;
  emitToast('success', tr('已生成修复版') + (skipped ? tr('（跳过 ') + skipped + tr(' 个条目）') : '') + tr('：') + (r && r.outPath ? r.outPath : ''));
  const replace = await confirmDialog({
    title: tr('用修复版替换原文件？'),
    message: tr('修复版能被正常解析。替换会把原文件改名备份为 .broken.bak（同目录），之后仍可手动改回来；再重新扫描一次就能恢复入库。'),
    detail: tr('替换后：') + (it ? (it.path || '') : '') + ' ← ' + (r && r.outPath ? r.outPath : ''),
    items: [tr('原文件 → 改名备份为 .broken.bak'), tr('修复版 → 顶替原文件名')],
    danger: true, confirmText: tr('替换原文件'), cancelText: tr('先不替换'),
  });
  if (!replace) { await reload(); return; }
  try {
    await api.brokenRepair(id, { replace: true });
    emitToast('success', tr('已用修复版替换原文件，原文件已备份'));
  } catch (e) {
    emitToast('error', (e && e.message) || tr('替换失败'));
  }
  await reload();
}

async function quarantine(ids) {
  if (!ids.length || busy) return;
  const items = ids.map((id) => {
    const it = last && (last.items || []).find((x) => x.id === id);
    return it ? (it.path || it.fileName || id) : id;
  });
  const ok = await confirmDialog({
    title: tr('移入隔离区'),
    message: tr('会把选中的文件移动到隔离目录，记录标为「已隔离」：不再出现在普通视图，也不会被误判成失效文件。随时可以移回原处。'),
    detail: tr('以下文件将被移动：'), items, confirmText: tr('移入隔离区'),
  });
  if (!ok) return;
  busy = true;
  try {
    const r = await api.brokenQuarantine(ids) || {};
    const failed = Array.isArray(r.failed) ? r.failed : [];
    if (failed.length) emitToast(failed.length === ids.length ? 'error' : 'warn', failed.length + tr(' 个文件移动失败：') + ((failed[0] && failed[0].error) || tr('未知原因')));
    else emitToast('success', tr('已移入隔离区'));
    await reload();
  } catch (e) { toastErr(e); } finally { busy = false; }
}

async function restore(ids) {
  if (!ids.length || busy) return;
  const items = ids.map((id) => {
    const it = last && (last.items || []).find((x) => x.id === id);
    return it ? (it.path || it.fileName || id) : id;
  });
  const ok = await confirmDialog({
    title: tr('移回原处'),
    message: tr('会把文件从隔离目录移回入库时的原目录，并恢复为正常记录。如果原目录不存在，移动会失败并给出原因。'),
    detail: tr('以下文件将移回原位置：'), items, confirmText: tr('移回原处'),
  });
  if (!ok) return;
  busy = true;
  try {
    const r = await api.brokenRestore(ids) || {};
    const failed = Array.isArray(r.failed) ? r.failed : [];
    if (failed.length) emitToast('error', failed.length + tr(' 个文件移回失败：') + ((failed[0] && failed[0].error) || tr('未知原因')));
    else emitToast('success', tr('已移回原处'));
    await reload();
  } catch (e) { toastErr(e); } finally { busy = false; }
}

async function trash(ids) {
  if (!ids.length || busy) return;
  const items = ids.map((id) => {
    const it = last && (last.items || []).find((x) => x.id === id);
    return it ? (it.path || it.fileName || id) : id;
  });
  const ok = await confirmDialog({
    title: tr('移入回收站'),
    message: tr('会把文件移入系统回收站，并从索引里移除。可从系统回收站恢复，但恢复后需要重新扫描才会重新入库。'),
    detail: tr('以下完整路径将被移入回收站：'), items, danger: true, confirmText: tr('移入回收站'),
  });
  if (!ok) return;
  busy = true;
  try {
    const r = await api.trash(ids) || {};
    const failed = Array.isArray(r.failed) ? r.failed : [];
    if (failed.length) emitToast('error', failed.length + tr(' 个文件移入回收站失败：') + ((failed[0] && failed[0].error) || tr('未知原因')));
    else emitToast('success', tr('已移入回收站'));
    await reload();
  } catch (e) { toastErr(e); } finally { busy = false; }
}

async function forget(ids) {
  if (!ids.length || busy) return;
  const items = ids.map((id) => {
    const it = last && (last.items || []).find((x) => x.id === id);
    return it ? (it.path || it.fileName || id) : id;
  });
  const ok = await confirmDialog({
    title: tr('移出索引'),
    message: tr('只从索引里移除记录，不会动磁盘文件。若文件仍在监控目录里，下次扫描会重新入库。'),
    detail: tr('以下记录将被移出索引：'), items, danger: true, confirmText: tr('移出索引'),
  });
  if (!ok) return;
  busy = true;
  try {
    await api.brokenForget(ids);
    emitToast('success', tr('已移出索引'));
    await reload();
  } catch (e) { toastErr(e); } finally { busy = false; }
}

function dispatch(d) {
  switch (d.act) {
    case 'br-retry': return retry(idsOf(d));
    case 'br-repair': return repair(d.id);
    case 'br-quarantine': return quarantine(idsOf(d));
    case 'br-restore': return restore(idsOf(d));
    case 'br-trash': return trash(idsOf(d));
    case 'br-forget': return forget(idsOf(d));
    default: return undefined;
  }
}

/** 挂在 #content 的 click 上；duplicates.js 在 broken 模式下转交过来 */
export function onBrokenClick(e) {
  if (state.contentMode !== 'broken') return;
  const content = el('content');
  if (!content || !content.contains(e.target)) return;
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node) return;
  const act = String(node.dataset.act || '');
  if (!act.startsWith('br-')) return;
  e.preventDefault();
  Promise.resolve(dispatch({ act, id: node.dataset.id, ids: node.dataset.ids })).catch(toastErr);
}

/** 离开视图：清掉本地缓存，避免下次进来先闪一遍旧数据 */
export function leaveBroken() {
  last = null;
  busy = false;
}
