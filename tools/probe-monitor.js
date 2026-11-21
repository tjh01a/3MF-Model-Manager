/**
 * 走查探针：主界面常驻监控条 + 打印监控设置 + 温度/进度曲线弹窗。
 *   node launch.js --capture=docs/screenshots/37-常驻监控条.png --ui-script=tools/probe-monitor.js
 *
 * 会临时切换一次「常驻监控条」开关验证显隐，结束时**必须还原**：
 * 走查工具不允许改用户的真实偏好（settings.json 是主进程内存直写的）。
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
const qa = (s) => Array.from(document.querySelectorAll(s));
const out = { ok: false };

const bar = await waitFor(() => q('#monitor-bar'), 15000);
if (!bar) return { ok: false, error: '找不到 #monitor-bar 节点' };
await sleep(1800);   // 等首轮 printersList + printersSnapshot

out.diag = Object.assign({}, window.__printshelfMonitor || {});
out.cardCount = qa('#monitor-bar .mon-card').length;
out.cards = qa('#monitor-bar .mon-card').slice(0, 4).map((c) => ({
  id: c.dataset.id,
  name: (c.querySelector('.mon-name') || {}).textContent,
  state: (c.querySelector('.mon-state') || {}).textContent,
  meta: (c.querySelector('.mon-meta') || {}).textContent.replace(/\s+/g, ' ').trim(),
  barWidth: (() => { const b = c.querySelector('.mon-bar > i'); return b ? b.style.width : ''; })(),
  hasChart: !!c.querySelector('[data-mon-act="chart"]'),
}));
out.barHidden = bar.hidden;

// ---- 曲线弹窗（没有采样数据时应该显示友好空态，不算失败） ----
let mstat = null;
try { mstat = await window.shelf.monitorStatus(); } catch (_) { mstat = null; }
out.monitorStatus = mstat;
const chartBtn = q('#monitor-bar [data-mon-act="chart-first"]');
if (chartBtn) chartBtn.click();
const modal = await waitFor(() => q('#modal-root .modal'), 6000);
out.chartOpened = !!modal;
if (modal) {
  out.chartTitle = (modal.querySelector('.modal-title') || {}).textContent;
  out.chartPaths = modal.querySelectorAll('.mc-svg path').length;
  out.chartEmpty = !!modal.querySelector('.mc-empty');
  out.chartStats = qa('#modal-root .mc-stat > span').map((e) => e.textContent.trim());
  out.chartSessions = (modal.querySelector('#mc-session') || {}).options
    ? modal.querySelector('#mc-session').options.length : 0;
  const close = modal.querySelector('[data-mc-close]');
  if (close) close.click();
  await sleep(250);
}
out.chartClosed = !q('#modal-root .modal');

// ---- 设置页「打印监控」 ----
q('#btn-settings').click();
const tab = await waitFor(() => q('#settings-nav [data-tab="monitor"]'), 6000);
if (!tab) return Object.assign(out, { ok: false, error: '设置页没有「打印监控」tab' });
tab.click();
await sleep(700);
const content = q('#settings-content');
out.switches = content ? qa('.switch input').map((i) => ({
  bind: i.dataset.bind, checked: i.checked,
})) : [];
out.selects = content ? qa('select[data-bind]').map((s) => ({ bind: s.dataset.bind, value: s.value })) : [];
out.actions = content ? Array.from(content.querySelectorAll('[data-act]')).map((b) => b.dataset.act) : [];
out.statusLine = content ? (content.textContent.match(/本机已记录[^\n]*?文件：[^\s]*/) || [''])[0] : '';

// ---- 临时关掉常驻条，验证它真的会隐藏，再还原 ----
const sw = content && content.querySelector('[data-bind="ui.monitorBar"]');
let orig = null;
try { orig = await window.shelf.settings(); } catch (_) { orig = null; }
if (sw) {
  const before = sw.checked;
  sw.checked = false;
  sw.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(450);
  out.hiddenAfterOff = q('#monitor-bar').hidden;
  const sw2 = q('#settings-content [data-bind="ui.monitorBar"]');
  if (sw2) {
    sw2.checked = before;
    sw2.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(450);
  }
  out.hiddenAfterRestore = q('#monitor-bar').hidden;
}
let after = null;
try { after = await window.shelf.settings(); } catch (_) { after = null; }
out.preferenceRestored = !!orig && !!after &&
  (orig.ui && orig.ui.monitorBar) === (after.ui && after.ui.monitorBar);

// 关设置页，让截图留在主界面（监控条可见）
const sclose = q('#settings-close');
if (sclose) sclose.click();
await sleep(300);

out.ok = !!out.diag && out.chartOpened && out.chartClosed &&
  out.switches.length >= 7 && out.actions.includes('monitor-chart') &&
  out.actions.includes('notify-test') &&
  (out.cardCount === 0 || out.cards.every((c) => c.hasChart)) &&
  (out.hiddenAfterOff === undefined || out.hiddenAfterOff === true) &&
  (out.hiddenAfterRestore === undefined || out.hiddenAfterRestore === out.barHidden) &&
  // 本机已经有采样时必须真的画出 4 条曲线，而不是停在空态
  (!(mstat && mstat.sessions > 0) || (out.chartPaths >= 4 && !out.chartEmpty)) &&
  out.preferenceRestored !== false;
return out;
