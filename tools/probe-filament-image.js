// 走查：耗材图片能显示 + 导入时可裁切/缩放
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];
await window.shelf.whenReady();
await sleep(700);

q('#btn-filaments').click();
await sleep(900);

// 1) 卡片与详情图是否真的解码成功（naturalWidth=0 就是破图）
const imgs = qa('.fil-card-img');
const loaded = imgs.map((i) => i.naturalWidth);
const cardOk = loaded.length > 0 && loaded.every((n) => n > 0);

// 2) 打开编辑器
const list = await window.shelf.filamentsList();
const f = list.items[0];
const dir = 'D:/AI工具workbuddy/PrintShelf/data/audit-img';
const path = dir + '/filament-img/' + f.image;
const raw = await window.shelf.filamentReadImage(path);

const mod = await import('/js/components/img-editor.js');
const pending = mod.openImageEditor({ dataUrl: raw.dataUrl, name: f.name });
await sleep(800);

const stage = q('.imged-stage');
const selEl = q('.imged-sel');
const handles = qa('.imged-sel [data-dir]');
const before = selEl ? selEl.getBoundingClientRect() : null;

// 3) 拖动右下角把手把选区缩小到约 60%
const se = q('.imged-sel [data-dir="se"]');
const r = se.getBoundingClientRect();
const canvasRect = q('.imged-canvas').getBoundingClientRect();
const startX = r.left + r.width / 2;
const startY = r.top + r.height / 2;
const endX = canvasRect.left + canvasRect.width * 0.6;
const endY = canvasRect.top + canvasRect.height * 0.6;
const pe = (type, x, y) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
se.dispatchEvent(pe('pointerdown', startX, startY));
stage.dispatchEvent(pe('pointermove', endX, endY));
stage.dispatchEvent(pe('pointerup', endX, endY));
await sleep(200);
const afterSel = selEl.getBoundingClientRect();

// 4) 改输出宽度并应用
const wIn = q('.imged-size [data-role="w"]');
wIn.value = '300';
wIn.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(120);
const hVal = q('.imged-size [data-role="h"]').value;
q('.modal [data-role="ok"]').click();
const res = await pending;

// 5) 落盘并验证能显示
let saved = null;
let savedLoaded = 0;
if (res && res.dataUrl) {
  saved = await window.shelf.filamentSetImageData(f.id, res.dataUrl);
  const probe = new Image();
  probe.src = 'shelf://filaments/' + saved.image + '?t=' + Date.now();
  await new Promise((ok) => { probe.onload = ok; probe.onerror = ok; setTimeout(ok, 1500); });
  savedLoaded = probe.naturalWidth;
}

// 6) PNG 也要能读
let pngOk = false;
let pngMsg = '';
try {
  const p = await window.shelf.filamentReadImage(dir + '/test.png');
  pngOk = /^data:image\/png;base64,/.test(p.dataUrl) && p.size > 0;
} catch (e) { pngMsg = String(e && e.message); }

return {
  ok: cardOk && !!(res && res.dataUrl) &&
      afterSel.width < before.width * 0.8 &&
      handles.length === 8 &&
      res.width === 300 && savedLoaded === 300 && pngOk,
  cardImgWidths: loaded,
  cardOk,
  handles: handles.length,
  selBefore: before ? Math.round(before.width) + 'x' + Math.round(before.height) : null,
  selAfter: Math.round(afterSel.width) + 'x' + Math.round(afterSel.height),
  outH: hVal,
  resW: res && res.width,
  resH: res && res.height,
  savedFile: saved && saved.image,
  savedNaturalW: savedLoaded,
  pngOk,
  pngMsg,
};
