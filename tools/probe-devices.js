/**
 * 走查探针：打开「设备」面板，等状态到齐后截图。
 *   node launch.js --capture=docs/screenshots/12-设备管理.png --ui-script=tools/probe-devices.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step || 120);
  }
  return null;
}

const q = (s) => document.querySelector(s);
const out = {};

// 统计主进程推来的增量事件：这一项能证明 preload 白名单 + api 桥接是通的，
// 否则设备页只能靠手动刷新（曾经就是这样，界面上写「每 3 秒刷新」是假的）。
window.__devPushCount = 0;
window.addEventListener('printers:update', () => { window.__devPushCount++; });

const btn = await waitFor(() => q('#btn-devices'), 15000);
if (!btn) return { ok: false, error: '找不到设备按钮' };
btn.click();

const panel = await waitFor(() => (q('#devices-panel') && !q('#devices-panel').hidden) ? q('#devices-panel') : null, 5000);
if (!panel) return { ok: false, error: '设备面板没打开' };

// 等卡片出现（首屏要先拉一次 IPC）
const cards = await waitFor(() => {
  const n = panel.querySelectorAll('.dev-card').length;
  return n ? Array.from(panel.querySelectorAll('.dev-card')) : null;
}, 12000);
if (!cards) {
  out.body = (q('#devices-body') || {}).textContent;
  return { ok: false, error: '没有渲染出打印机卡片', body: out.body };
}

// 等状态「定下来」：不许有卡片永远停在「连接中」，且至少有一台真的连上。
// 拓竹处于云端模式 / 换了 IP 时，正确行为是几次重试后明确标「离线」并给出处置，
// 而不是无限转圈；旧版探针把「连接中」也算通过，会漏掉这个缺陷。
const ready = await waitFor(() => {
  const sts = Array.from(document.querySelectorAll('.dev-card .dev-state')).map((e) => e.textContent.trim());
  const settled = sts.length && sts.every((t) => t && t !== '连接中');
  return settled && sts.some((t) => t !== '离线') ? sts : null;
}, 18000, 400);
out.readyStates = ready;
await sleep(1200);

const tx = (el, sel) => { const n = el.querySelector(sel); return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
out.cards = Array.from(panel.querySelectorAll('.dev-card')).map((c) => ({
  name: tx(c, '.dev-name'),
  sub: tx(c, '.dev-sub'),
  state: tx(c, '.dev-state'),
  job: tx(c, '.dev-job-name'),
  meta: tx(c, '.dev-job-meta'),
  temps: Array.from(c.querySelectorAll('.dev-temp')).map((t) => t.textContent.replace(/\s+/g, ' ').trim()),
  mats: Array.from(c.querySelectorAll('.dev-mat')).map((m) => m.textContent.replace(/\s+/g, ' ').trim()),
  actions: Array.from(c.querySelectorAll('.dev-actions .btn')).map((b) => b.textContent.trim()),
  error: tx(c, '.dev-job-empty'),
  barWidth: (() => { const b = c.querySelector('.dev-bar > i'); return b ? b.style.width : ''; })(),
}));
out.badge = (q('#btn-devices .dev-badge') || {}).textContent;
out.pushEvents = window.__devPushCount || 0;
out.onlineCount = out.cards.filter((c) => c.state && c.state !== '离线' && c.state !== '连接中').length;
out.degraded = out.onlineCount < out.cards.length;
// 允许「部分设备离线」（打印机可能没开机 / 在云端模式），但必须：有推送、至少一台在线、
// 且没有任何卡片卡在「连接中」——离线卡要给出可操作的错误说明。
out.ok = out.cards.length >= 1 && out.pushEvents > 0 && out.onlineCount >= 1 &&
  !out.cards.some((c) => c.state === '连接中' || (c.state === '离线' && !c.error));
return out;
