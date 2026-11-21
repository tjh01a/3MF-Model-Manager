/**
 * 走查探针：详情面板「局部刷新不跳回顶部」（2026-11-19 交互流畅性修复）。
 * 之前点状态 / 收藏 / 标签会整块重绘 body.innerHTML，滚动位置被清零，
 * 表现为「每点一次就弹回顶部」。
 *   node launch.js --capture=data/reg/detail-smooth.png --ui-script=tools/probe-detail-smooth.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(100);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const out = {};

const cards = Array.from(document.querySelectorAll('.card[data-id]')).slice(0, 12);
if (!cards.length) return { ok: false, error: '没有模型卡片' };

let picked = null;
for (const c of cards) {
  c.click();
  await waitFor(() => q('#detail-body .meta-grid'), 6000);
  await sleep(500);
  const body = q('#detail-body');
  if (body && body.scrollHeight > body.clientHeight + 120) { picked = c; break; }
}
if (!picked) return { ok: false, error: '找不到可滚动的详情（内容都太短）' };

const body = q('#detail-body');
out.scrollable = { h: body.scrollHeight, client: body.clientHeight };
body.scrollTop = 260;
await sleep(120);
out.beforeScroll = body.scrollTop;

// 触发一次同模型的局部刷新：点收藏（会 render 整块 + 刷新详情）
const fav = q('#detail [data-act="fav"]');
if (!fav) return { ok: false, error: '找不到收藏按钮' };
fav.click();
await sleep(800);
out.afterScroll = body.scrollTop;
out.jump = out.beforeScroll - out.afterScroll;

// 内容必须真的可见（淡入不能停在 opacity 0）
const op = getComputedStyle(body).opacity;
out.opacity = op;
out.contentOk = body.querySelectorAll('.meta-grid, .detail-section').length > 0;

// 再点一次还原收藏状态，避免改用户数据
const fav2 = q('#detail [data-act="fav"]');
if (fav2) { fav2.click(); await sleep(600); }

out.checks = {
  keptScroll: out.afterScroll >= Math.max(0, out.beforeScroll - 40),
  visible: Number(op) >= 0.99,
  contentOk: out.contentOk,
};
out.ok = Object.values(out.checks).every(Boolean);
return out;
