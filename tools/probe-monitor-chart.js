/**
 * 截图探针：打开「温度与进度曲线」弹窗并保持打开，供视觉走查。
 *   node launch.js --capture=docs/screenshots/38-温度进度曲线.png --ui-script=tools/probe-monitor-chart.js
 * 不改任何设置。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
await sleep(2200);   // 等首屏与监控条首轮刷新

const btn = q('#monitor-bar [data-mon-act="chart-first"]');
if (btn) btn.click();
// 弹窗要等一次 IPC（monitorChart）回来才挂载，固定 sleep 900ms 会偶发读到 null
let modal = null;
for (let i = 0; i < 40 && !modal; i++) {
  modal = q('#modal-root .modal');
  if (!modal) await sleep(150);
}
return {
  ok: !!modal,
  title: modal ? (modal.querySelector('.modal-title') || {}).textContent : '',
  paths: modal ? modal.querySelectorAll('.mc-svg path').length : 0,
  legend: modal ? modal.querySelectorAll('.mc-lg').length : 0,
  stats: modal ? Array.from(modal.querySelectorAll('.mc-stat > span')).map((e) => e.textContent.trim()) : [],
  empty: modal ? !!modal.querySelector('.mc-empty') : true,
};
