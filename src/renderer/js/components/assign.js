'use strict';
import { t as tr } from '../i18n.js';

/**
 * 手动归类：把模型放进分类 / 打标签的统一入口。
 * 拖拽落地、右键菜单、空分类页的「手动添加」都走这里，保证提示与撤销行为一致。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state } from '../state.js';
import { selectDialog, pickerDialog, nameColorDialog } from './modal.js';

// constants.js 为 CommonJS，渲染层不可 import，按冻结值内联
const CATEGORY_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
const DEFAULT_TAG_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'];

const catName = (id) => ((state.categories || []).find((c) => c.id === id) || {}).name || '';
function findModel(id) {
  return (state.items || []).find((m) => m && m.id === id) || null;
}
/** 全局刷新：侧栏计数、统计条、当前列表一起更新 */
function afterAssign() {
  emitRefresh('assign');
}

/**
 * 把 ids 归入 categoryId（null = 未分类）。带撤销 Toast。
 * @returns {Promise<{ok:boolean, count:number}>}
 */
export async function setCategory(ids, categoryId) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return { ok: false, count: 0 };
  const target = categoryId || null;
  const before = {};
  for (const id of list) {
    const m = findModel(id);
    before[id] = m && m.categoryId !== undefined ? m.categoryId : null;
  }
  try {
    await api.bulk(list, { categoryId: target });
  } catch (e) {
    emitToast('error', (e && e.message) || tr('归类失败'));
    return { ok: false, count: 0 };
  }
  const name = target ? ('「' + (catName(target) || tr('分类')) + '」') : tr('未分类');
  emitToast('success', tr('已把 ') + list.length + tr(' 个模型放入') + name, {
    actionLabel: tr('撤销'),
    action: async () => {
      for (const id of list) {
        const back = Object.prototype.hasOwnProperty.call(before, id) ? before[id] : null;
        try { await api.update(id, { categoryId: back }); } catch (_) { /* 单个失败不阻断 */ }
      }
      emitRefresh('undo');
    },
  });
  afterAssign();
  return { ok: true, count: list.length };
}

/** 给 ids 追加一个标签。带撤销 Toast。 */
export async function addTag(ids, tagId) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length || !tagId) return { ok: false, count: 0 };
  const before = {};
  for (const id of list) {
    const m = findModel(id);
    before[id] = m && Array.isArray(m.tagIds) ? m.tagIds.slice() : [];
  }
  const tag = (state.tags || []).find((t) => t.id === tagId) || {};
  try {
    await api.tagAssign(list, [tagId], 'add');
  } catch (e) {
    emitToast('error', (e && e.message) || tr('添加标签失败'));
    return { ok: false, count: 0 };
  }
  emitToast('success', tr('已给 ') + list.length + tr(' 个模型加上「') + (tag.name || tr('标签')) + '」', {
    actionLabel: tr('撤销'),
    action: async () => {
      for (const id of list) {
        try { await api.update(id, { tagIds: before[id] || [] }); } catch (_) { /* 忽略 */ }
      }
      emitRefresh('undo');
    },
  });
  afterAssign();
  return { ok: true, count: list.length };
}

/** 右键菜单用：弹出分类列表（含「不分类」），选中即归类。 */
export async function chooseCategory(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return;
  const options = [{ value: '__none__', label: tr('不分类（移出分类）'), icon: 'i-folder-open', color: '#94a3b8' }]
    .concat((state.categories || []).map((c) => ({
      value: c.id, label: c.name, icon: c.icon || 'i-folder', color: c.color,
    })));
  let r;
  try {
    r = await selectDialog({
      title: tr('添加到分类'),
      message: tr('把选中的 ') + list.length + tr(' 个模型放入哪个分类？'),
      options, mode: 'single',
    });
  } catch (_) { return; }
  if (r === undefined) return;
  if (r === '__none__') { await setCategory(list, null); return; }
  await setCategory(list, r);
}

/** 拖到分类区「+」时用：新建分类并立即把模型放进去。 */
export async function createCategoryWith(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  let r = null;
  try {
    r = await nameColorDialog({
      title: tr('新建分类'),
      label: tr('分类名称') + (list.length ? tr('（建好后直接放入这 ') + list.length + tr(' 个模型）') : ''),
      placeholder: tr('例如：功能件'),
      colors: CATEGORY_COLORS,
      confirmText: tr('创建'),
    });
  } catch (_) { return; }
  if (!r || !r.value) return;
  let cat = null;
  try {
    cat = await api.categoryCreate({ name: r.value, color: r.color });
  } catch (e) {
    emitToast('error', (e && e.message) || tr('创建分类失败'));
    return;
  }
  try { state.categories = await api.categories(); } catch (_) { /* 忽略 */ }
  if (!cat || !cat.id) { emitToast('warn', tr('分类已创建，但未能自动放入模型')); afterAssign(); return; }
  if (!list.length) {
    emitToast('success', tr('已创建分类「') + r.value + '」');
    afterAssign();
    return;
  }
  state.flashCategory = cat.id;
  await setCategory(list, cat.id);
}

/** 拖到标签区「+」时用：新建标签并立即打到模型上。 */
export async function createTagWith(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  let r = null;
  try {
    r = await nameColorDialog({
      title: tr('新建标签'),
      label: tr('标签名称') + (list.length ? tr('（建好后直接打到这 ') + list.length + tr(' 个模型上）') : ''),
      placeholder: tr('例如：高精度'),
      colors: DEFAULT_TAG_COLORS,
      confirmText: tr('创建'),
    });
  } catch (_) { return; }
  if (!r || !r.value) return;
  let tag = null;
  try {
    tag = await api.tagCreate({ name: r.value, color: r.color });
  } catch (e) {
    emitToast('error', (e && e.message) || tr('创建标签失败'));
    return;
  }
  try { state.tags = await api.tags(); } catch (_) { /* 忽略 */ }
  if (!tag || !tag.id) { emitToast('warn', tr('标签已创建，但未能自动打上')); afterAssign(); return; }
  if (!list.length) { emitToast('success', tr('已创建标签「') + r.value + '」'); afterAssign(); return; }
  await addTag(list, tag.id);
}

/**
 * 空分类页 / 分类右键用：打开可搜索多选弹窗，勾选即加入，取消勾选即移出。
 * 这样「手动添加」既能加也能减，不用来回切视图。
 */
export async function pickModelsForCategory(categoryId) {
  const cat = (state.categories || []).find((c) => c.id === categoryId);
  if (!cat) return;
  let all = [];
  try {
    const res = await api.query({ keyword: '', smart: 'all', categoryId: null, limit: 0, sortBy: 'name', sortDir: 'asc' });
    all = (res && res.items) || [];
  } catch (_) {
    all = (state.items || []).slice();
  }
  if (!all.length) {
    emitToast('warn', tr('模型库还是空的，先添加目录并扫描吧'));
    return;
  }
  const inCat = all.filter((m) => m && m.categoryId === categoryId).map((m) => m.id);
  const options = all.map((m) => {
    const bits = [];
    if (m.categoryId && m.categoryId !== categoryId) bits.push(catName(m.categoryId) || tr('其他分类'));
    else if (!m.categoryId) bits.push(tr('未分类'));
    if (m.fileName && m.title && m.fileName !== m.title) bits.push(m.fileName);
    return { value: m.id, label: m.title || m.fileName || m.id, hint: bits.join(' · ') };
  });
  let picked;
  try {
    picked = await pickerDialog({
      title: tr('加入「') + cat.name + '」',
      message: tr('勾选要放进这个分类的模型（可搜索）；已勾选的可以取消，取消会移回「未分类」。'),
      options, selected: inCat, confirmText: tr('保存'), placeholder: tr('搜索名称 / 文件名…'),
    });
  } catch (_) { return; }
  if (picked === undefined) return;

  const pickedSet = new Set(picked);
  const add = picked.filter((id) => !inCat.includes(id));
  const drop = inCat.filter((id) => !pickedSet.has(id));
  if (!add.length && !drop.length) { emitToast('info', tr('分类没有变化')); return; }

  if (add.length) await setCategory(add, categoryId);
  if (drop.length) {
    try {
      await api.bulk(drop, { categoryId: null });
      emitToast('success', tr('已把 ') + drop.length + tr(' 个模型移回「未分类」'));
    } catch (e) {
      emitToast('error', (e && e.message) || tr('移出失败'));
    }
  }
  afterAssign();
}
