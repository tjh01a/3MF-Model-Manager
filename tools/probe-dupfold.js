/**
 * 走查探针：重复文件折叠 + 详情内副本切换（交互增强版）
 *   node launch.js --capture=<png> --ui-script=tools/probe-dupfold.js
 *
 * 验证：
 *  A. 普通视图里同一 duplicateGroup 只渲染一张卡 +「重复 ×N」角标
 *  B. 卡片上「展开 N 个副本 / 收起」可临时展开整组，再收起恢复折叠
 *  C. 点开卡片，详情大图下方列出同组全部文件路径与各自独立的元数据
 *  D. 点行 / 上一个 / 下一个 / ← → 键都能切换副本，第 N/M 位置提示同步更新
 *  E. 切换只改显示，不动 state.items / selection（副本各自独立）
 */
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const waitFor = async (fn, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true; } catch (_) {}
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
};
const currentPath = () => {
  const n = q('.detail-dup-row.is-current .detail-dup-path');
  return n ? n.textContent.trim() : '';
};
const posText = () => {
  const n = q('.detail-dup-pos');
  return n ? n.textContent.trim() : '';
};
const navBtn = (act) => q('.detail-dup-nav [data-act="' + act + '"]');

const out = {};
// 记录走查期间出现的错误 toast：捕获类似 "xxx is not defined" 这种被 catch 后
// 只弹提示、不进 window.onerror 的运行时错误（截图里肉眼容易漏掉）。
const toastErrors = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
      if (!bad) continue;
      const msg = bad.querySelector('.toast-message');
      toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
    }
  }).observe(toastBox, { childList: true });
}
await window.shelf.whenReady();
await waitFor(() => qa('#content .card').length > 0);

const all = await window.shelf.query({});
const items = (all && all.items) || [];
out.totalItems = items.length;

// 按 duplicateGroup 统计（只取 >1 的组）
const byGroup = new Map();
for (const m of items) {
  if (!m || !m.duplicateGroup) continue;
  if (!byGroup.has(m.duplicateGroup)) byGroup.set(m.duplicateGroup, []);
  byGroup.get(m.duplicateGroup).push(m);
}
const multi = Array.from(byGroup.values()).filter((g) => g.length > 1);
out.dupGroups = multi.length;
out.dupMembers = multi.reduce((n, g) => n + g.length, 0);

// A. 主视图折叠：卡片数 = 总数 - (每组多出的成员数)
const cards = qa('#content .card');
out.visibleCards = cards.length;
const expectedVisible = items.length - multi.reduce((n, g) => n + (g.length - 1), 0);
out.expectedVisible = expectedVisible;
out.foldedCorrectly = cards.length === expectedVisible;
const groupIds = new Set(cards.map((c) => c.dataset.id));
out.representativesFromGroups = multi.filter((g) => g.some((m) => groupIds.has(m.id))).length;
out.dupBadges = qa('#content .card .badge-dup').length;

if (!multi.length) {
  out.toastErrors = Array.from(new Set(toastErrors));
  out.noErrorToasts = out.toastErrors.length === 0;
  out.ok = out.noErrorToasts && out.foldedCorrectly && out.dupBadges === 0;
  return out;
}

// B. 首页没有「展开副本」按钮（用户要求）；重复 ×N 角标仍在
const targetGroup = multi[0];
out.noExpandButton = qa('#content .card [data-act="dup-toggle"], #content .card .card-dup-toggle').length === 0;

// C. 打开一个有多副本的卡，检查详情切换器
const cardsNow = qa('#content .card');
const rep = targetGroup.find((m) => cardsNow.some((c) => c.dataset.id === m.id)) || targetGroup[0];
const repCard = cardsNow.find((c) => c.dataset.id === rep.id) || cardsNow[0];
repCard.click();
await waitFor(() => q('#detail') && !q('#detail').hidden && qa('.detail-dup-row').length > 0);

out.detailOpen = !!(q('#detail') && !q('#detail').hidden);
out.detailTitle = q('.detail-title') ? q('.detail-title').textContent.trim() : '';
out.switchRows = qa('.detail-dup-row').length;
out.switchPaths = qa('.detail-dup-path').map((n) => n.textContent.trim());
out.pathsMatchGroup = targetGroup.every((m) => out.switchPaths.some((p) => p === (m.path || '')));
out.currentMarked = qa('.detail-dup-row.is-current').length === 1;

// 增强点：第 N/M 位置、上一个/下一个、每个副本各自的状态/大小/时间/备注
out.posText = posText();
out.posOk = /第\s*\d+\s*\/\s*\d+\s*个/.test(out.posText);
out.navActs = qa('.detail-dup-nav [data-act]').map((b) => b.dataset.act);
out.navOk = out.navActs.includes('dup-prev') && out.navActs.includes('dup-next');
const subs = qa('.detail-dup-sub');
out.subLines = subs.length;
out.subOk = subs.length === targetGroup.length && subs.every((n) => n.textContent.trim().length > 0);
out.statusBadges = qa('.detail-dup-name .badge[class*="status-"]').length;
out.noteCount = qa('.detail-dup-note').length;
// 每个副本行都有一个「删除这个副本」按钮，且 data-id 指向该行对应的副本
const trashBtns = qa('.detail-dup-row [data-act="dup-trash"]');
out.trashButtons = trashBtns.length;
out.trashIdsMatch = trashBtns.length === targetGroup.length &&
  targetGroup.every((m) => trashBtns.some((b) => b.dataset.id === m.id));

// D1. 点另一行切换
const otherRow = qa('.detail-dup-row').find((r) => !r.classList.contains('is-current'));
if (otherRow) {
  const before = currentPath();
  const beforePos = posText();
  otherRow.querySelector('.detail-dup-pick').click();
  await waitFor(() => currentPath() && currentPath() !== before);
  out.switchedPath = currentPath();
  out.switchWorked = !!out.switchedPath && out.switchedPath !== before;
  out.posChangedOnPick = posText() !== beforePos;
}

// 把当前位置挪到组内中间项（副本数=2 时就是最后一项），后面再按需调整方向
const rowsAll = qa('.detail-dup-row');
const mid = rowsAll[Math.floor(rowsAll.length / 2)];
if (mid && !mid.classList.contains('is-current')) {
  mid.querySelector('.detail-dup-pick').click();
  await waitFor(() => q('.detail-dup-row.is-current') === mid ||
    (currentPath() && currentPath() === mid.querySelector('.detail-dup-path').textContent.trim()));
}

// D2. 「上一个 / 下一个」按钮
let before = currentPath();
let beforePos = posText();
const stepBtn = (navBtn('dup-next') && !navBtn('dup-next').disabled) ? navBtn('dup-next') : navBtn('dup-prev');
out.stepBtnEnabled = !!stepBtn && !stepBtn.disabled;
if (stepBtn && !stepBtn.disabled) stepBtn.click();
await waitFor(() => currentPath() && currentPath() !== before);
out.stepWorked = !!currentPath() && currentPath() !== before;
out.stepPosChanged = posText() !== beforePos;
out.currentStillOne = qa('.detail-dup-row.is-current').length === 1;

// D3. ← / → 键切换（详情打开、焦点不在输入框时生效）
// 先确保当前不在第一项，否则 ← 到头不动，断言会误判成「键盘没生效」
const firstRow = qa('.detail-dup-row')[0];
if (firstRow && firstRow.classList.contains('is-current') && qa('.detail-dup-row').length > 1) {
  qa('.detail-dup-row')[1].querySelector('.detail-dup-pick').click();
  await waitFor(() => {
    const cur = q('.detail-dup-row.is-current');
    return cur && cur !== firstRow;
  });
}
before = currentPath();
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
await waitFor(() => currentPath() && currentPath() !== before);
out.keyLeftWorked = !!currentPath() && currentPath() !== before;

before = currentPath();
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
await waitFor(() => currentPath() && currentPath() !== before);
out.keyRightWorked = !!currentPath() && currentPath() !== before;

out.toastErrors = Array.from(new Set(toastErrors));
out.noErrorToasts = out.toastErrors.length === 0;

out.ok = out.noErrorToasts && out.foldedCorrectly && out.dupBadges > 0 && out.detailOpen &&
  out.switchRows === targetGroup.length && out.pathsMatchGroup && out.currentMarked &&
  out.noExpandButton &&
  out.posOk && out.navOk && out.subOk &&
  out.trashButtons === targetGroup.length && out.trashIdsMatch &&
  out.switchWorked && out.posChangedOnPick &&
  out.stepBtnEnabled && out.stepWorked && out.stepPosChanged && out.currentStillOne &&
  out.keyLeftWorked && out.keyRightWorked;
return out;
