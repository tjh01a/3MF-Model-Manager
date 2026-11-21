/**
 * 走查探针：卡片缩略图上的耗材色板。
 *   node launch.js --capture=out.png --ui-script=tools/probe-colors.js
 *   node launch.js --capture=out.png --ui=dark --ui-script=tools/probe-colors.js
 *   node launch.js --capture=out.png --width=720 --ui-script=tools/probe-colors.js
 *
 * 只读 DOM；列表视图直接改 #content.className、深色直接改 data-theme，
 * 不点击任何按钮、不写 settings.json，跑完原样恢复。
 * capture 模式下主进程会先 await 旧库颜色回填再放行 app:ready，所以首屏就该有色板。
 */
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAFE_STYLE = /^background:\s*#[0-9a-fA-F]{6}\s*;?$/i;

const waitFor = async (fn, timeout = 6000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
};

const ready = await waitFor(() => qa('#content .card').length > 0);
if (!ready) return { ok: false, error: '首屏没有渲染出卡片' };
// 正常启动是后台回填，capture 已提前跑完；这里仍给一点余量避免时序误判
await waitFor(() => qa('#content .card-colors').length > 0, 4000);

const visible = (el) => {
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 &&
    r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
};
const overlap = (a, b) => {
  if (!a || !b) return false;
  const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
  return !(r1.right <= r2.left || r2.right <= r1.left ||
    r1.bottom <= r2.top || r2.bottom <= r1.top);
};

const cards = qa('#content .card');
const palettes = qa('#content .card-colors');
const dots = qa('#content .card-color');
const sample = palettes.find(visible) || palettes[0] || null;
const sampleCard = sample ? sample.closest('.card') : null;
const badges = sampleCard ? sampleCard.querySelector('.card-badges') : null;

const out = {
  viewport: { w: window.innerWidth, h: window.innerHeight },
  cards: cards.length,
  palettes: palettes.length,
  dots: dots.length,
  moreLabels: qa('#content .card-color-more').length,
  visiblePalettes: palettes.filter(visible).length,
  // 色值会拼进 style，必须严格匹配 #RRGGBB，杜绝导入 JSON 里的任意字符串
  unsafeStyles: dots.filter((d) => !SAFE_STYLE.test((d.getAttribute('style') || '').trim())).length,
  titlesWithoutColor: palettes.filter((p) => !(p.getAttribute('title') || '').includes('#')).length,
  roleImg: palettes.every((p) => p.getAttribute('role') === 'img'),
  tooManyDots: palettes.filter((p) => p.querySelectorAll('.card-color').length > 6).length,
  allDotsHaveColor: dots.every((d) => {
    const c = getComputedStyle(d).backgroundColor;
    return /^rgb\(/.test(c) && c !== 'rgba(0, 0, 0, 0)';
  }),
  sampleColors: dots.slice(0, 6).map((d) => getComputedStyle(d).backgroundColor),
  noBadgeOverlap: (sample && badges) ? !overlap(sample, badges) : null,
  sampleTitle: sample ? sample.getAttribute('title') : null,
};

// 列表模式：同一份 DOM 改成行布局，色板要常显且取消网格模式的上移
const content = q('#content');
const wasCls = content.className;
content.className = 'content-list';
await sleep(90);
out.list = {
  palettes: qa('#content .card-colors').length,
  dots: qa('#content .card-color').length,
  visibleDots: qa('#content .card-color').filter(visible).length,
  position: sample ? getComputedStyle(sample).position : null,
  transform: sample ? getComputedStyle(sample).transform : null,
};
content.className = wasCls;
await sleep(50);
out.restoredViewClass = content.className;

// 深色主题：色板底色跟随 CSS 变量，圆点仍要看得见
const html = document.documentElement;
const wasTheme = html.getAttribute('data-theme');
html.setAttribute('data-theme', 'dark');
await sleep(70);
out.dark = {
  theme: html.getAttribute('data-theme'),
  paletteBg: sample ? getComputedStyle(sample).backgroundColor : null,
  paletteVisible: visible(sample),
  visibleDots: dots.filter(visible).length,
};
html.setAttribute('data-theme', wasTheme || 'light');
await sleep(40);
out.restoredTheme = html.getAttribute('data-theme');

out.ok = ready && out.cards > 0 && out.palettes > 0 && out.dots > 0 &&
  out.visiblePalettes > 0 && out.unsafeStyles === 0 && out.titlesWithoutColor === 0 &&
  out.roleImg && out.tooManyDots === 0 && out.allDotsHaveColor &&
  out.noBadgeOverlap === true &&
  out.list.palettes === out.palettes && out.list.dots === out.dots &&
  out.list.visibleDots > 0 && out.list.position === 'static' &&
  (out.list.transform === 'none' || out.list.transform === null) &&
  out.restoredViewClass === wasCls &&
  out.dark.theme === 'dark' && out.dark.paletteVisible && out.dark.visibleDots > 0 &&
  out.restoredTheme === (wasTheme || 'light');
return out;
