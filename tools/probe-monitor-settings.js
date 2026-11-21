/**
 * 截图探针：打开「设置 → 打印监控」页并保持打开，供视觉走查。
 *   node launch.js --capture=docs/screenshots/39-打印监控设置.png --ui-script=tools/probe-monitor-settings.js
 * 不改任何设置。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
await sleep(1600);

q('#btn-settings').click();
await sleep(300);
const tab = q('#settings-nav [data-tab="monitor"]');
if (tab) tab.click();
await sleep(900);
const content = q('#settings-content');
return {
  ok: !!content && !!q('#settings-nav [data-tab="monitor"].active'),
  sections: content ? Array.from(content.querySelectorAll('.settings-section-title')).map((e) => e.textContent.trim()) : [],
  switches: content ? content.querySelectorAll('.switch input').length : 0,
  buttons: content ? Array.from(content.querySelectorAll('[data-act]')).map((b) => b.dataset.act) : [],
  hasStatus: content ? /本机已记录/.test(content.textContent) : false,
};
