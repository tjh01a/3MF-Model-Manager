/**
 * 走查探针：详情面板「文件信息」长路径不得撑破面板（2026-11-19 修复）。
 *   node launch.js --capture=data/reg/probe-overflow.png --ui-script=tools/probe-detail-overflow.js
 *   node launch.js --width=1180 --height=800 --capture=... --ui-script=...
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const out = { viewport: { w: innerWidth, h: innerHeight } };

const card = await waitFor(() => q('.card[data-id]'), 15000);
if (!card) return { ok: false, error: '没有模型卡片' };
card.click();
await waitFor(() => q('#detail-cost') && !q('#detail-cost .cost-loading'), 8000);

const body = q('#detail-body');
const grid = q('#detail-body .meta-grid');
const pathRow = q('#detail-body .meta-path');
const copyBtn = q('#detail-body .meta-path [data-act="copyPath"]');
const pathVal = q('#detail-body .meta-path .meta-v');
if (!body || !grid || !pathRow || !copyBtn || !pathVal) {
  return { ok: false, error: '结构缺失', has: { body: !!body, grid: !!grid, pathRow: !!pathRow, copyBtn: !!copyBtn, pathVal: !!pathVal } };
}

const br = body.getBoundingClientRect();
const gr = grid.getBoundingClientRect();
const cr = copyBtn.getBoundingClientRect();
const pr = pathRow.getBoundingClientRect();

out.body = { clientW: body.clientWidth, scrollW: body.scrollWidth, overflowX: body.scrollWidth - body.clientWidth };
out.grid = { left: Math.round(gr.left), right: Math.round(gr.right), w: Math.round(gr.width), scrollW: grid.scrollWidth, clientW: grid.clientWidth };
out.pathRow = { w: Math.round(pr.width), scrollW: pathRow.scrollWidth, clientW: pathRow.clientWidth, overflow: pathRow.scrollWidth - pathRow.clientWidth };
out.pathValue = {
  text: (pathVal.textContent || '').slice(0, 60),
  truncated: pathVal.scrollWidth > pathVal.clientWidth + 1,
  title: pathVal.getAttribute('title') ? 'yes' : 'no',
};
out.copyBtn = { right: Math.round(cr.right), insideBody: cr.right <= br.right + 0.5, insidePanel: cr.right <= br.right + 0.5 };
out.columns = getComputedStyle(grid).gridTemplateColumns;

const noBodyOverflow = out.body.overflowX <= 1;
const noRowOverflow = out.pathRow.overflow <= 1;
const btnInside = out.copyBtn.insideBody;
const hasTitle = out.pathValue.title === 'yes';
out.checks = { noBodyOverflow, noRowOverflow, btnInside, hasTitle };
out.ok = noBodyOverflow && noRowOverflow && btnInside && hasTitle;

// 截图用：把「文件信息」滚到视野中间，并给出它在视口里的位置，便于裁图核对
try {
  grid.scrollIntoView({ block: 'center' });
  await sleep(400);
  const r = grid.getBoundingClientRect();
  const cr2 = copyBtn.getBoundingClientRect();
  out.shotRect = {
    grid: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    copyRight: Math.round(cr2.right),
    copyInsideGrid: cr2.right <= r.right + 0.5,
  };
} catch (_) { /* 截图辅助信息，失败不影响判定 */ }
return out;
