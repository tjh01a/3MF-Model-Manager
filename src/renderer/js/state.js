'use strict';
/** 单一状态对象 + 订阅通知。所有模块通过 state 通信，跨模块刷新走 shelf:refresh 事件。 */

const subscribers = new Set();

export const state = {
  ready: false,
  info: {},
  settings: {},
  categories: [],
  tags: [],
  views: [],
  stats: {},
  smartCounts: {},
  folders: [],
  slicers: [],
  backups: [],
  query: {
    keyword: '', smart: 'all', categoryId: null, tagIds: [], tagMode: 'any',
    printStatuses: [], favoritesOnly: false, ratingMin: 0, folderId: null,
    statuses: [], sortBy: 'createdAt', sortDir: 'desc', limit: 0, offset: 0,
  },
  items: [],
  total: 0,
  facets: {},
  // 卡片价格缓存（docs/14）：批量 modelsCosts 一次取回，卡片同步渲染时读这里，
  // 不写库、不进备份。改耗材价 / 分配耗材后由 app.js 重拉。
  costs: {},
  selection: new Set(),
  activeId: null,
  view: 'grid',
  cardSize: 220,
  theme: 'light',
  contentMode: 'normal', // normal | duplicates | missing
  settingsOpen: false,
  settingsTab: 'folders',
  sidebarCollapsed: false,
  lightbox: { open: false, ids: [], index: 0 },
  undoStack: [],
  scanning: false,
  // 拖拽归类成功后的「弹一下」标记：侧栏重渲染时读取并立刻清空，只播一次
  flashCategory: null,
};

export function getState() {
  return state;
}

/** 浅合并 patch 并通知订阅者；patch.reason 或第二参数仅作通知 reason，不写入 state。支持 selection 为 Set。 */
export function setState(patch, reason) {
  if (!patch || typeof patch !== 'object') return state;
  let r = reason;
  for (const key of Object.keys(patch)) {
    if (key === 'reason') { if (r == null) r = patch.reason; continue; }
    state[key] = patch[key];
  }
  notify(r == null ? 'state' : r);
  return state;
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify(reason) {
  for (const fn of Array.from(subscribers)) {
    try { fn(state, reason); } catch (e) { console.error('[state] 订阅者异常：', e); }
  }
}
