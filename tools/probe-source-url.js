/**
 * 走查探针：模型来源链接识别（makerworld.com.cn / DSM 编号反推）
 *   node launch.js --capture=<png> --ui-script=tools/probe-source-url.js
 *
 * 验证：
 *  1. 库里带 sourceUrl 的模型数量
 *  2. 卡片上的「浏览器」按钮对这类模型带 data-url（可点击），不带的没有
 *  3. 详情里出现「打开来源链接」
 *  4. 中国站链接能被识别（makerworld.com.cn/zh/models/<id>）
 *  5. 有来源的地球按钮为绿底、无来源保持灰色；网格 / 列表两种布局都成立
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  return null;
}
function parseRgb(value) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
    .exec(String(value || ''));
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] == null ? 1 : Number(m[4]) };
}
function isGreenBackground(value) {
  const c = parseRgb(value);
  // 深浅主题的 --success 分别是 #10b981 / #34d399，绿色通道要明显压过红、蓝通道
  return !!c && c.a >= .9 && c.g > c.r + 60 && c.g > c.b + 30;
}

const out = {};
// 捕获被 catch 后只弹红字、不进 window.onerror 的运行时错误
const toastErrors = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!n || n.nodeType !== 1) continue;
        const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
        if (!bad) continue;
        const msg = bad.querySelector('.toast-message');
        toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
      }
    }
  }).observe(toastBox, { childList: true });
}

await window.shelf.whenReady();
await waitFor(() => qa('#content .card').length > 0);

const all = await window.shelf.query({});
const items = (all && all.items) || [];
const withUrl = items.filter((m) => m && typeof m.sourceUrl === 'string' && /^https?:\/\//i.test(m.sourceUrl));
out.totalModels = items.length;
out.withSourceUrl = withUrl.length;
out.cnSource = withUrl.filter((m) => /makerworld\.com\.cn/i.test(m.sourceUrl)).length;

// 卡片：有来源的按钮应带 data-url
const cards = qa('#content .card');
const urlById = new Map(withUrl.map((m) => [m.id, m.sourceUrl]));
let cardsWithDataUrl = 0;
let mismatched = 0;
for (const c of cards) {
  const btn = c.querySelector('.card-quick [data-act="source"]');
  if (!btn) continue;
  const du = btn.getAttribute('data-url') || '';
  const expect = urlById.get(c.dataset.id) || '';
  if (du) {
    cardsWithDataUrl++;
    if (du !== expect) mismatched++;
  } else if (expect) {
    mismatched++;
  }
}
out.cardsWithDataUrl = cardsWithDataUrl;
out.urlMismatch = mismatched;

// 地球按钮的视觉状态必须由来源链接唯一决定，且网格 / 列表两种布局都不能被覆盖
function measureSourceButtons() {
  const s = { linked: 0, linkedGreen: 0, unlinked: 0, unlinkedGreen: 0, classMismatch: 0 };
  for (const c of cards) {
    const btn = c.querySelector('.card-quick [data-act="source"]');
    if (!btn) continue;
    const hasUrl = !!(btn.getAttribute('data-url') || '');
    const hasClass = btn.classList.contains('has-source');
    const green = isGreenBackground(getComputedStyle(btn).backgroundColor);
    if (hasUrl) {
      s.linked++;
      if (green) s.linkedGreen++;
      if (!hasClass) s.classMismatch++;
    } else {
      s.unlinked++;
      if (green) s.unlinkedGreen++;
      if (hasClass) s.classMismatch++;
    }
  }
  return s;
}
out.sourceColorsGrid = measureSourceButtons();

const contentEl = q('#content');
const savedClass = contentEl ? contentEl.className : '';
if (contentEl) contentEl.classList.add('content-list');
await sleep(80);
out.sourceColorsList = measureSourceButtons();
if (contentEl) contentEl.className = savedClass;
await sleep(80);

// 打开一个中国站来源的模型，详情里应有「打开来源链接」
const target = withUrl.find((m) => /makerworld\.com\.cn/i.test(m.sourceUrl)) || withUrl[0];
if (target) {
  const card = cards.find((c) => c.dataset.id === target.id);
  if (card) card.click();
  await waitFor(() => q('#detail') && !q('#detail').hidden);
  await sleep(400);
  out.detailSourceUrl = target.sourceUrl;
  out.detailHasOpenSource = !!q('#detail [data-act="open-source"]');
  const input = q('#detail [data-field="sourceUrl"]');
  out.detailShowsUrl = !!input && input.value === target.sourceUrl;
}

const colorsOk = [out.sourceColorsGrid, out.sourceColorsList].every((s) =>
  s.linked > 0 && s.unlinked > 0 && s.linkedGreen === s.linked &&
  s.unlinkedGreen === 0 && s.classMismatch === 0);
out.toastErrors = Array.from(new Set(toastErrors));
out.noErrorToasts = out.toastErrors.length === 0;
out.ok = out.withSourceUrl > 0 && out.cardsWithDataUrl > 0 && out.urlMismatch === 0 &&
  colorsOk && out.noErrorToasts && (out.detailHasOpenSource === true);
return out;
