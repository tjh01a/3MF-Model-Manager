/**
 * 走查探针：模拟用户「右键卡片 → 用快造 U1 打开（先转换）」。
 *
 * 用途是复现并锁死这个报错：
 *   点「用快造 U1 打开」→ 弹出「切片软件不可运行：…\C:\Program Files\Snapmaker_Orca」
 *
 * 用法（脚本会被 main.js 包进 async IIFE，返回值会打印）：
 *   node launch.js --capture=data/reg/probe-u1-open.png --ui-script=tools/probe-u1-open.js
 *
 * 注意：--ui-script 只在 --capture 模式下由 runCapture() 执行，必须同时带 --capture，
 *       否则脚本根本不会运行、窗口也不会自动退出。
 *
 * 判据：出现 success toast 且没有 error/warn toast。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step || 100);
  }
  return null;
}

// ---- 收集 toast（含期间新出现的） ----
const toasts = [];
const host = document.getElementById('toast-container') || document.body;
const grab = (n) => {
  if (!n || n.nodeType !== 1) return;
  const list = n.classList && n.classList.contains('toast') ? [n] : Array.from(n.querySelectorAll ? n.querySelectorAll('.toast') : []);
  for (const t of list) {
    const kind = ['success', 'error', 'warn', 'info'].find((k) => t.classList.contains('toast-' + k)) || '?';
    const msgEl = t.querySelector('.toast-msg');
    toasts.push({ kind, text: msgEl ? msgEl.textContent : t.textContent });
  }
};
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) grab(n);
}).observe(host, { childList: true, subtree: true });

const out = { ok: false, steps: [] };
const say = (s) => out.steps.push(s);

// ---- 1. 等卡片渲染 ----
const cards = await waitFor(() => {
  const list = Array.from(document.querySelectorAll('.card[data-id]'));
  return list.length ? list : null;
}, 15000);
if (!cards) return { ok: false, error: '卡片没渲染出来', steps: out.steps };
say('卡片数 ' + cards.length);

// ---- 2. 找目标卡片：优先「测试_AI改参数」（小、且是拓竹源） ----
// 注意要排除 _U1_ 缓存副本，否则会走「本来就是快造文件」的快路径，测不到转换
const exact = (el) => (el.textContent || '').replace(/\s+/g, '');
const convertible = cards.filter((c) => !/_U1_/i.test(exact(c)));
let card = convertible.find((c) => {
  const t = exact(c);
  return t.includes('测试_AI改参数') && !t.includes('V2');
});
let target = '测试_AI改参数';
if (!card) {
  card = convertible[0];
  target = card ? exact(card).slice(0, 40) : '';
}
if (!card) return { ok: false, error: '没找到可用卡片', steps: out.steps };
const id = card.dataset.id;
say('目标卡片：' + target + '（' + id + '）');

// ---- 3. 右键 → 点「用快造 U1 打开（先转换）」 ----
const r = card.getBoundingClientRect();
card.dispatchEvent(new MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, button: 2,
  clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
}));

const picked = await waitFor(() => {
  const all = Array.from(document.querySelectorAll('button, div, li, a, span'));
  const hits = all.filter((el) => {
    const t = (el.textContent || '').replace(/\s+/g, '');
    return t === '用快造U1打开（先转换）' || t === '用快造U1打开(先转换)';
  });
  // 取最深的那一个，避免点到整个菜单容器
  return hits.length ? hits[hits.length - 1] : null;
}, 4000);
if (!picked) return { ok: false, error: '右键菜单里没找到「用快造 U1 打开」', steps: out.steps, toasts };
say('已定位菜单项');
picked.click();
say('已点击');

// ---- 4. 等进度弹窗出现再消失，最多 120 秒 ----
const appeared = await waitFor(() => document.querySelector('.ow-modal-progress') || document.querySelector('.ow-backdrop'), 5000);
say(appeared ? '进度弹窗已出现' : '没看到进度弹窗（可能秒完）');

const finished = await waitFor(() => {
  const dlgEl = document.querySelector('.ow-modal-progress');
  const bad = toasts.find((t) => t.kind === 'error' || t.kind === 'warn');
  if (bad) return { how: 'toast' };
  if (!dlgEl && toasts.some((t) => t.kind === 'success')) return { how: 'done' };
  return null;
}, 120000, 200);

out.toasts = toasts;
out.finished = !!finished;
out.ok = !!(finished && toasts.some((t) => t.kind === 'success')
  && !toasts.some((t) => t.kind === 'error' || t.kind === 'warn'));
say(out.ok ? '成功' : '未达成成功条件');
return out;
