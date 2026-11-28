/**
 * P0 UI 交互探针：在真实 Electron 页面里验证布局、卡片、详情、多选、
 * 删除确认、统计筛选、搜索、键盘、骨架 / 错误态 / Toast。
 *
 * 运行：
 *   node launch.js --capture=$env:TEMP/printshelf-p0.png --ui-script=tools/probe-p0-ui.js --width=1440 --height=900
 * 退出码：ok:false 时进程失败（main.js 已有约定）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step || 80);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const out = { ok: false, checks: {} };
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

// 1. 等首屏。空库也允许，但要能验证空态和骨架。
const cards = await waitFor(() => {
  const n = document.querySelectorAll('#content .card');
  return n.length >= 2 ? Array.from(n) : (document.getElementById('empty-state') && !document.getElementById('empty-state').hidden ? [] : null);
}, 15000);
if (cards === null) return { ok: false, error: '首屏既没有卡片，也没有空态' };
out.mode = cards.length ? 'library' : 'empty';
out.cardCount = cards.length;

// 2. 布局与顶部动作
const content = q('#content');
const top = content ? content.getBoundingClientRect().top : 9999;
const visibleActions = ['#btn-quick-add', '#btn-scan', '#btn-devices', '#btn-app-more']
  .filter((s) => { const el = q(s); return el && !el.hidden && getComputedStyle(el).display !== 'none'; }).length;
out.layout = {
  contentTop: Math.round(top),
  noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  visibleAppActions: visibleActions,
  detailWidth: Math.round((q('#detail') || {}).getBoundingClientRect ? q('#detail').getBoundingClientRect().width : 0),
  statsActionsHidden: !!q('#stats-actions') && getComputedStyle(q('#stats-actions')).display === 'none',
};
out.checks.layout = out.layout.noHorizontalOverflow && out.layout.contentTop <= 270 && out.layout.visibleAppActions <= 4;

// 3. 顶部“更多”菜单
const moreBtn = q('#btn-app-more');
const morePanel = q('#app-more-panel');
if (moreBtn && morePanel) {
  click(moreBtn);
  await sleep(50);
  const opened = !morePanel.hidden && moreBtn.getAttribute('aria-expanded') === 'true';
  const items = morePanel.querySelectorAll('.app-more-item').length;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(30);
  out.more = {
    opened,
    items,
    closedByEsc: morePanel.hidden,
    expandedReset: moreBtn.getAttribute('aria-expanded') === 'false',
  };
  out.checks.more = opened && items === 5 && out.more.closedByEsc && out.more.expandedReset;
} else {
  out.more = { error: '没有更多按钮/面板' };
  out.checks.more = false;
}

// 4. 卡片初始可见性 + 键盘焦点
if (cards.length) {
  const card = cards[0];
  const badge = card.querySelector('.card-badges');
  const check = card.querySelector('.card-check');
  const quick = card.querySelectorAll('.card-quick button');
  const beforeFocus = getComputedStyle(card.querySelector('.card-quick'));
  card.focus();
  await sleep(80);
  const afterFocus = getComputedStyle(card.querySelector('.card-quick'));
  out.card = {
    badgeOpacity: badge ? Number(getComputedStyle(badge).opacity) : 0,
    checkOpacity: check ? Number(getComputedStyle(check).opacity) : 0,
    quickButtonCount: quick.length,
    quickHasDanger: Array.from(quick).some((b) => b.dataset.act === 'trash'),
    quickVisibilityBeforeFocus: beforeFocus.visibility,
    quickVisibilityAfterFocus: afterFocus.visibility,
    quickOpacityAfterFocus: Number(afterFocus.opacity),
    titleClamp: getComputedStyle(card.querySelector('.card-title')).webkitLineClamp,
  };
  out.checks.card = out.card.badgeOpacity >= 1 && out.card.checkOpacity >= 0.4
    && out.card.quickButtonCount === 3 && !out.card.quickHasDanger
    && out.card.quickVisibilityAfterFocus === 'visible';
} else {
  out.card = { skipped: 'empty library' };
  out.checks.card = true;
}

// 5. 键盘 Enter 打开详情，Space 勾选
if (cards.length) {
  const card = cards[0];
  card.focus();
  key(card, 'Enter');
  const detail = await waitFor(() => {
    const p = q('#detail');
    return p && !p.hidden && q('#detail-body .detail-summary') ? p : null;
  }, 4000);
  const summary = q('#detail-body .detail-summary');
  out.detail = {
    opened: !!detail,
    summaryFirst: !!summary && summary === q('#detail-body').firstElementChild,
    sticky: summary ? getComputedStyle(summary).position : '',
    title: summary ? (summary.querySelector('.detail-title') || {}).textContent : '',
    actionCount: summary ? summary.querySelectorAll('.detail-summary-actions > *').length : 0,
    closeVisible: !!q('#detail-close') && !q('#detail-close').hidden,
  };
  if (detail) click(q('#detail-close'));
  await waitFor(() => q('#detail').hidden, 2000);
  out.checks.detail = out.detail.opened && out.detail.summaryFirst && out.detail.sticky === 'sticky'
    && out.detail.actionCount <= 4 && out.detail.closeVisible;
} else {
  out.detail = { skipped: 'empty library' };
  out.checks.detail = true;
}

// 6. 多选 / 批量条 / 删除确认（只取消，不真删）
if (cards.length) {
  const clear = q('#bulk-clear');
  if (clear && !q('#bulkbar').hidden) click(clear);
  await sleep(80);
  cards[0].querySelector('.card-cb').click();
  cards[1].querySelector('.card-cb').click();
  await sleep(120);
  const bar = q('#bulkbar');
  out.multi = {
    count: (q('#bulk-count') || {}).textContent,
    bulkVisible: !!bar && !bar.hidden,
    statsDisplay: getComputedStyle(q('#stats-actions')).display,
  };
  let confirm = null;
  if (bar && !bar.hidden) {
    click(q('#bulk-delete'));
    confirm = await waitFor(() => q('#modal-root .modal-backdrop'), 2500);
    out.multi.confirmTitle = confirm ? ((confirm.querySelector('.modal-title, h3, .modal-head') || {}).textContent || '') : '';
    if (confirm) {
      const cancel = confirm.querySelector('[data-role="cancel"]');
      if (cancel) click(cancel);
      await sleep(80);
      out.multi.cancelled = !q('#modal-root .modal-backdrop');
    }
  }
  out.checks.multi = out.multi.bulkVisible && out.multi.count === '2'
    && out.multi.statsDisplay === 'none' && !!confirm && out.multi.cancelled;
} else {
  out.multi = { skipped: 'empty library' };
  out.checks.multi = true;
}

// 7. 统计筛选 + 搜索（结束后复位到全部）
if (cards.length) {
  const statsCells = q('#stats-cells');
  let directClicks = 0;
  if (statsCells) statsCells.addEventListener('click', () => { directClicks++; });
  const unprinted = q('[data-stat-filter="unprinted"]');
  if (unprinted) click(unprinted);
  await sleep(350);
  const active = q('[data-stat-filter="unprinted"]');
  out.stats = {
    unprintedPressed: active ? active.getAttribute('aria-pressed') : '',
    unprintedClass: active ? active.className : '',
    directClicks,
    cardsAfterUnprinted: qa('#content .card').length,
  };
  const total = q('[data-stat-filter="total"]');
  if (total) click(total);
  await sleep(350);
  const totalActive = q('[data-stat-filter="total"]');
  out.stats.totalPressed = totalActive ? totalActive.getAttribute('aria-pressed') : '';
  out.checks.stats = out.stats.unprintedPressed === 'true' && out.stats.totalPressed === 'true';

  const search = q('#search-input');
  if (search) {
    search.focus();
    search.value = '__p0_no_such_model__';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(450);
    const clearSearch = q('#search-clear');
    out.search = {
      clearVisible: !!clearSearch && !clearSearch.hidden,
      cardsNow: qa('#content .card').length,
    };
    if (clearSearch) click(clearSearch);
    await sleep(500);
    out.search.restoredCards = qa('#content .card').length;
    out.checks.search = out.search.clearVisible && out.search.restoredCards > 0;
  } else {
    out.search = { error: '没有搜索框' };
    out.checks.search = false;
  }
} else {
  out.stats = { skipped: 'empty library' };
  out.search = { skipped: 'empty library' };
  out.checks.stats = true;
  out.checks.search = true;
}

// 8. 空格勾选（键盘）
if (cards.length) {
  const card = qa('#content .card')[0];
  if (card) {
    card.focus();
    key(card, ' ');
    await sleep(100);
    out.space = {
      bulkVisible: !!q('#bulkbar') && !q('#bulkbar').hidden,
      lightboxHidden: q('#lightbox').hidden,
    };
    const clear = q('#bulk-clear');
    if (clear) click(clear);
    out.checks.space = out.space.bulkVisible && out.space.lightboxHidden;
  } else {
    out.checks.space = false;
  }
} else {
  out.space = { skipped: 'empty library' };
  out.checks.space = true;
}

// 8b. 1000 条内存 mock：验证大量卡片不崩、可滚动、懒加载属性在；
// 结束后通过 shelf:refresh 恢复真实库，不写磁盘。
if (window.__printshelfSetItems) {
  const mock = Array.from({ length: 1000 }, (_, i) => ({
    id: 'mock-' + i,
    title: '压力测试模型 ' + String(i + 1).padStart(4, '0'),
    fileName: 'stress-' + i + '.3mf',
    path: 'C:\\mock\\stress-' + i + '.3mf',
    size: 1024 * (i + 1),
    createdAt: Date.now() - i * 60000,
    printStatus: ['unprinted', 'queued', 'printed'][i % 3],
    status: 'ok',
    favorite: i % 50 === 0,
    meta: { objectCount: 1, plateCount: 1, filamentColors: ['#888888'] },
  }));
  const r = window.__printshelfSetItems(mock);
  await sleep(180);
  const contentEl = q('#content');
  const cardN = qa('#content .card').length;
  const lazyN = qa('#content .card-img[loading="lazy"]').length;
  contentEl.scrollTop = contentEl.scrollHeight;
  await sleep(120);
  const scrollTop = contentEl.scrollTop;
  const firstStyle = qa('#content .card')[0]
    ? getComputedStyle(qa('#content .card')[0].querySelector('.card-img')).contentVisibility : '';
  contentEl.scrollTop = 0;
  out.large = {
    requested: 1000,
    cards: cardN,
    lazyImages: lazyN,
    renderMs: r && r.ms,
    mode: r && r.mode,
    scrollTop: Math.round(scrollTop),
    contentVisibility: firstStyle,
  };
  out.checks.large = cardN === 1000 && lazyN === 1000 && r && r.ms < 3000 && scrollTop > 1000;
  window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason: 'init' } }));
  await waitFor(() => qa('#content .card').length > 0 && qa('#content .card').length < 1000, 5000);
  out.large.restoredCards = qa('#content .card').length;
  out.checks.large = out.checks.large && out.large.restoredCards > 0;
} else {
  out.large = { skipped: '没有 __printshelfSetItems 钩子' };
  out.checks.large = false;
}


if (window.__printshelfShowSkeleton) window.__printshelfShowSkeleton(6);
await sleep(80);
out.skeleton = { cards: qa('#content .skeleton-card').length };
out.checks.skeleton = out.skeleton.cards === 6;
if (window.__printshelfShowContentError) window.__printshelfShowContentError();
await sleep(80);
out.error = {
  hasError: !!q('#content.content-error'),
  hasRetry: !!q('[data-content-retry]'),
};
out.checks.error = out.error.hasError && out.error.hasRetry;
window.dispatchEvent(new CustomEvent('shelf:refresh', { detail: { reason: 'init' } }));
await waitFor(() => qa('#content .card').length > 0 || (q('#empty-state') && !q('#empty-state').hidden), 5000);

window.dispatchEvent(new CustomEvent('shelf:toast', { detail: { type: 'info', message: 'P0 UI 探针提示', duration: 3200 } }));
const toast = await waitFor(() => q('#toast-container .toast'), 1200);
if (toast) {
  await sleep(420);                 // 等入场动画结束再量最终位置
  const r = toast.getBoundingClientRect();
  out.toast = {
    bottom: Math.round(r.bottom),
    right: Math.round(innerWidth - r.right),
    viewportH: innerHeight,
    text: toast.textContent,
  };
  out.checks.toast = r.bottom <= innerHeight && r.top > 0 && innerWidth - r.right >= 0;
  const close = toast.querySelector('.toast-close');
  if (close) click(close);
} else {
  out.toast = { error: '没有 Toast' };
  out.checks.toast = false;
}

out.ok = Object.values(out.checks).every(Boolean);
return out;
