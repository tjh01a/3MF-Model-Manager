'use strict';
import { t as tr } from '../i18n.js';

/** 工具栏：搜索(防抖)、排序、筛选 chips、视图切换、尺寸滑块、全选、标题与结果数。 */
import { state, setState } from '../state.js';
import { api, emitRefresh } from '../api.js';
import { escapeHtml, icon, debounce, clamp, qs, qsa } from '../utils.js';
import { receiptsCount } from './receipts.js';

const SMART_LABELS = {
  all: tr('全部模型'), favorites: tr('收藏'), recentOpened: tr('最近打开'),
  unprinted: tr('未打印'), uncategorized: tr('未分类'), untagged: tr('未打标签'),
  recent: tr('最近 7 天'), printed: tr('已完成打印'), rated: tr('已评分'),
  duplicates: tr('重复文件'), variants: tr('同款变体'), broken: tr('损坏文件'), missing: tr('失效文件'),
};
const STATUS_LABELS = {
  unprinted: tr('未打印'), queued: tr('待打印'), printing: tr('打印中'), printed: tr('已完成'), failed: tr('失败'),
};

let mounted = false;

function viewName() {
  return SMART_LABELS[state.query.smart] || tr('全部模型');
}
function hasFilters() {
  const q = state.query;
  return !!(q.keyword || q.categoryId || (q.tagIds && q.tagIds.length) ||
    (q.printStatuses && q.printStatuses.length) || q.favoritesOnly || q.ratingMin > 0 ||
    q.folderId || (q.statuses && q.statuses.length));
}
function filterChipsHtml() {
  const q = state.query;
  const chips = [];
  const add = (key, label) => chips.push(
    '<button class="chip" data-filter="' + escapeHtml(key) + '">' +
    escapeHtml(label) + icon('i-close', 'ico chip-x') + '</button>'
  );
  if (q.keyword) add('keyword', tr('搜索：') + q.keyword);
  if (q.categoryId) {
    const c = (state.categories || []).find((x) => x.id === q.categoryId);
    add('categoryId', tr('分类：') + (c ? c.name : q.categoryId));
  }
  if (q.tagIds && q.tagIds.length) {
    for (const id of q.tagIds) {
      const t = (state.tags || []).find((x) => x.id === id);
      add('tag:' + id, tr('标签：') + (t ? t.name : id));
    }
  }
  if (q.printStatuses && q.printStatuses.length) {
    for (const s of q.printStatuses) add('status:' + s, tr('状态：') + (STATUS_LABELS[s] || s));
  }
  if (q.favoritesOnly) add('favoritesOnly', tr('仅收藏'));
  if (q.ratingMin > 0) add('ratingMin', tr('评分 ≥ ') + q.ratingMin);
  if (q.folderId) add('folderId', tr('指定目录'));
  if (q.statuses && q.statuses.length) {
    for (const s of q.statuses) add('fileStatus:' + s, tr('文件：') + s);
  }
  return chips.join('');
}

export function syncToolbar() {
  const title = qs('#view-title');
  if (title) title.textContent = viewName();
  const sub = qs('#view-subtitle');
  if (sub) {
    // 回执视图里 state.total 是「智能视图匹配到的模型数」，写成「个模型」会让人以为
    // 回执页在显示模型。这里按当前视图换成对应单位。
    const isReceipts = state.contentMode === 'receipts';
    const n = isReceipts ? receiptsCount() : state.total;
    sub.textContent = tr('共 ') + n + (isReceipts ? tr(' 条回执') : tr(' 个模型')) + (hasFilters() ? tr(' · 已筛选') : '');
  }

  const chips = qs('#filter-chips');
  if (chips) chips.innerHTML = filterChipsHtml();
  const clearBtn = qs('#btn-clear-filters');
  if (clearBtn) clearBtn.hidden = !hasFilters();

  const sort = qs('#sort-select');
  if (sort && sort.value !== state.query.sortBy) sort.value = state.query.sortBy;
  const dirBtn = qs('#btn-sort-dir');
  if (dirBtn) {
    dirBtn.title = state.query.sortDir === 'asc' ? tr('当前升序，点击降序') : tr('当前降序，点击升序');
    dirBtn.classList.toggle('is-asc', state.query.sortDir === 'asc');
  }
  qsa('#view-switch [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const slider = qs('#size-slider');
  if (slider && slider.value !== String(state.cardSize)) slider.value = String(state.cardSize);

  const input = qs('#search-input');
  if (input && document.activeElement !== input && input.value !== state.query.keyword) {
    input.value = state.query.keyword;
  }
  const searchClear = qs('#search-clear');
  if (searchClear) searchClear.hidden = !state.query.keyword;
}

function applyKeyword() {
  const input = qs('#search-input');
  const kw = input ? input.value.trim() : '';
  if (kw === state.query.keyword) return;
  setState({ query: { ...state.query, keyword: kw } }, 'query');
  syncToolbar();
  emitRefresh('keyword');
}
function clearFilters() {
  setState({
    query: {
      ...state.query, keyword: '', categoryId: null, tagIds: [], printStatuses: [],
      favoritesOnly: false, ratingMin: 0, folderId: null, statuses: [], smart: 'all',
    },
  }, 'query');
  const input = qs('#search-input');
  if (input) input.value = '';
  syncToolbar();
  emitRefresh('clear');
}

export function mountToolbar() {
  if (mounted) return;
  mounted = true;

  const input = qs('#search-input');
  if (input) {
    const debounced = debounce(applyKeyword, 180);
    input.addEventListener('input', () => {
      const c = qs('#search-clear');
      if (c) c.hidden = !input.value;
      debounced();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyKeyword(); }
    });
  }
  const sc = qs('#search-clear');
  if (sc) sc.addEventListener('click', () => {
    if (input) { input.value = ''; input.focus(); }
    applyKeyword();
  });

  const sort = qs('#sort-select');
  if (sort) sort.addEventListener('change', () => {
    setState({ query: { ...state.query, sortBy: sort.value } }, 'query');
    api.settingsUpdate({ ui: { sortBy: sort.value } }).catch(() => {});
    emitRefresh('sort');
  });

  const dirBtn = qs('#btn-sort-dir');
  if (dirBtn) dirBtn.addEventListener('click', () => {
    const dir = state.query.sortDir === 'asc' ? 'desc' : 'asc';
    setState({ query: { ...state.query, sortDir: dir } }, 'query');
    api.settingsUpdate({ ui: { sortDir: dir } }).catch(() => {});
    syncToolbar();
    emitRefresh('sort');
  });

  qsa('#view-switch [data-view]').forEach((b) => b.addEventListener('click', () => {
    if (!b.dataset.view) return;
    setState({ view: b.dataset.view }, 'view');
    api.settingsUpdate({ ui: { view: b.dataset.view } }).catch(() => {});
    syncToolbar();
    emitRefresh('viewmode'); // 纯 UI 变更：只改 #content 的 className，不重新查库/重建卡片
  }));

  const slider = qs('#size-slider');
  if (slider) {
    slider.addEventListener('input', () => {
      const size = clamp(slider.value, 140, 340);
      setState({ cardSize: size }, 'cardSize');
      document.documentElement.style.setProperty('--card-w', size + 'px');
    });
    slider.addEventListener('change', () => {
      api.settingsUpdate({ ui: { cardSize: clamp(slider.value, 140, 340) } }).catch(() => {});
    });
  }

  const chips = qs('#filter-chips');
  if (chips) chips.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
    if (!b) return;
    const key = b.dataset.filter || '';
    const q = { ...state.query };
    if (key === 'keyword') q.keyword = '';
    else if (key === 'categoryId') q.categoryId = null;
    else if (key.indexOf('tag:') === 0) q.tagIds = (q.tagIds || []).filter((x) => x !== key.slice(4));
    else if (key.indexOf('status:') === 0) q.printStatuses = (q.printStatuses || []).filter((x) => x !== key.slice(7));
    else if (key === 'favoritesOnly') q.favoritesOnly = false;
    else if (key === 'ratingMin') q.ratingMin = 0;
    else if (key === 'folderId') q.folderId = null;
    else if (key.indexOf('fileStatus:') === 0) q.statuses = (q.statuses || []).filter((x) => x !== key.slice(11));
    setState({ query: q }, 'query');
    if (key === 'keyword' && input) input.value = '';
    syncToolbar();
    emitRefresh('filter');
  });

  const clearBtn = qs('#btn-clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('shelf:clearfilters')));
  window.addEventListener('shelf:clearfilters', clearFilters);

  const selAll = qs('#btn-select-all');
  if (selAll) selAll.addEventListener('click', () => window.dispatchEvent(new CustomEvent('shelf:selectall')));

  // 回执是异步拉回来的：首次进入视图时工具栏先按缓存（0 条）渲染，
  // 数据到位后回执视图会广播一次，这里补刷副标题的「共 N 条回执」。
  window.addEventListener('shelf:receipts-rendered', () => {
    if (state.contentMode === 'receipts') syncToolbar();
  });
}
