const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await window.shelf.whenReady();
await sleep(900);
// 预置一个站点（走真实保存路径），再打开管理弹窗截图
await window.shelf.settingsUpdate({ ui: { customSites: [
  { name: '创想云', url: 'https://www.crealitycloud.cn/' },
  { name: 'Cults3D', url: 'https://cults3d.com/' },
] } });
const root = document.querySelector('#stats-links');
await sleep(200);
// 重新挂载渲染：直接插按钮（mount 只在启动跑一次）
return { ok: root.querySelectorAll('[data-custom-site]').length };
