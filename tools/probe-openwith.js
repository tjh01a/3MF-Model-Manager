/**
 * 走查探针：卡片「用切片软件打开」悬浮菜单是否给出三个入口，
 * 且 data-pick 取值与文案、服务端 openWith(which) 的契约一致。
 *   node launch.js --capture=data/reg/openwith.png --ui-script=tools/probe-openwith.js
 *
 * 只读 DOM，不点击任何会真正启动切片软件的项（避免弹 GUI 干扰自动化）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = {};
const card = document.querySelector('#content .card');
out.hasCard = !!card;

if (card) {
  const btn = card.querySelector('.card-quick [data-act="open"]');
  out.hasButton = !!btn;

  if (btn) {
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    let pop = null;
    for (let i = 0; i < 30 && !pop; i++) {
      await sleep(80);
      pop = document.querySelector('.qpop.qpop-in');
    }
    out.menuOpen = !!pop;

    if (pop) {
      const items = Array.from(pop.querySelectorAll('.qpop-item'));
      const text = (el, sel) => {
        const n = el.querySelector(sel);
        return n ? n.textContent.trim() : '';
      };
      out.count = items.length;
      out.picks = items.map((el) => el.dataset.pick || '');
      out.titles = items.map((el) => text(el, 'strong'));
      out.descs = items.map((el) => text(el, 'small'));

      out.directIsOfficial = /官方 Orca/.test(out.titles[1] || '') && /不做转换/.test(out.descs[1] || '');
      out.snapIsOrca = /快造/.test(out.titles[2] || '') && /Orca/.test(out.titles[2] || '');
      out.convertedIsOfficial = /转换后/.test(out.titles[3] || '') && /官方/.test(out.titles[3] || '');
      out.convertedWarns = /200×200|U1 预设|转换/.test(out.descs[3] || '');

      // 真实应用图标是异步替换的：等最多 3 秒
      let appIcons = 0;
      for (let i = 0; i < 38 && appIcons === 0; i++) {
        await sleep(80);
        appIcons = pop.querySelectorAll('.qpop-app').length;
      }
      out.appIconCount = appIcons;

      // 关闭浮层，避免挡住截图里的卡片
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(120);
      out.menuClosed = !document.querySelector('.qpop.qpop-in');
    }
  }
}

out.apiOpenWith = !!(window.shelf && typeof window.shelf.openWith === 'function');

out.ok = out.hasCard && out.hasButton && out.menuOpen &&
  out.count === 4 &&
  out.picks[0] === 'bambu' &&
  out.picks[1] === 'orca-official-direct' &&
  out.picks[2] === 'snapmaker' &&
  out.picks[3] === 'orca-official' &&
  out.directIsOfficial && out.snapIsOrca && out.convertedIsOfficial && out.convertedWarns &&
  out.appIconCount >= 2 &&
  out.apiOpenWith && out.menuClosed !== false;

return out;
