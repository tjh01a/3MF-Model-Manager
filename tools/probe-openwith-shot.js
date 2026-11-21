/**
 * 走查探针（只截图用）：展开卡片悬浮菜单并保持打开，验证真实应用图标的视觉效果。
 *   node launch.js --capture=docs/screenshots/40-打开方式菜单.png --ui-script=tools/probe-openwith-shot.js
 *
 * 和 probe-openwith.js 的区别：那个会关掉菜单再截图（看卡片），这个故意不关（看菜单）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = {};
const card = document.querySelector('#content .card');
const btn = card && card.querySelector('.card-quick [data-act="open"]');
out.hasButton = !!btn;

if (btn) {
  btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  let pop = null;
  for (let i = 0; i < 40 && !pop; i++) {
    await sleep(80);
    pop = document.querySelector('.qpop.qpop-in');
  }
  out.menuOpen = !!pop;

  let icons = 0;
  for (let i = 0; i < 38 && icons === 0; i++) {
    await sleep(80);
    icons = pop ? pop.querySelectorAll('.qpop-app').length : 0;
  }
  out.appIconCount = icons;

  out.labels = pop ? Array.from(pop.querySelectorAll('.qpop-item strong')).map((n) => n.textContent.trim()) : [];
  out.iconSizes = pop ? Array.from(pop.querySelectorAll('.qpop-app')).map((n) => {
    const r = n.getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height);
  }) : [];
}

out.ok = out.hasButton && out.menuOpen && out.appIconCount >= 2 && out.iconSizes.every((s) => s !== '0x0');
return out;
