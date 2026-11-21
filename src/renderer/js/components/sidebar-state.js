'use strict';
/**
 * 侧栏折叠状态的唯一入口。
 *
 * 一处改动要同步四个地方：body 的 class（CSS 全靠它）、state.sidebarCollapsed、
 * state.settings.ui.sidebarCollapsed（设置页「默认折叠」读的是这个）、
 * 以及切换按钮的 title / aria-expanded。以前 app.js、settings.js 各改各的，
 * 出现过「按钮写着收起、实际已经收起」「设置页开关和实际状态打架」。
 */
import { state, setState } from '../state.js';
import { api } from '../api.js';

export function applySidebar(collapsed, { persist = false } = {}) {
  const on = !!collapsed;
  const root = typeof document !== 'undefined' ? document : null;
  if (root && root.body) root.body.classList.toggle('sidebar-collapsed', on);

  const settings = state.settings || {};
  setState({
    sidebarCollapsed: on,
    settings: { ...settings, ui: { ...(settings.ui || {}), sidebarCollapsed: on } },
  }, 'sidebar');

  const btn = root && root.getElementById ? root.getElementById('sidebar-toggle') : null;
  if (btn) {
    btn.setAttribute('aria-expanded', on ? 'false' : 'true');
    btn.title = on ? '展开侧栏' : '收起侧栏';
  }
  if (persist) api.settingsUpdate({ ui: { sidebarCollapsed: on } }).catch(() => {});
  return on;
}

export function toggleSidebar() {
  return applySidebar(!state.sidebarCollapsed, { persist: true });
}
