/**
 * 走查探针：编辑模式 / 悬停二选一 / 库内拖动不误弹导入遮罩 / 设备页确认框可点。
 *   node launch.js --capture=data/tmp-i.png --ui-script=tools/probe-interactions.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step || 100);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const out = {};

const cards = await waitFor(() => {
  const n = document.querySelectorAll('#content .card');
  return n.length >= 2 ? Array.from(n) : null;
}, 15000);
if (!cards) return { ok: false, error: '没有卡片，库可能是空的' };

const at = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const pointer = (el, type) => {
  const p = at(el);
  el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1, pointerType: 'mouse', isPrimary: true,
  }));
};
const click = (el) => {
  const p = at(el);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
};

// ---------- 1. 长按进入编辑模式 ----------
const first = cards[0];
const firstId = first.dataset.id;
pointer(first, 'pointerdown');
await sleep(700);                       // 长按阈值 480ms
pointer(first, 'pointerup');
click(first);                           // 真实流程里松手会补一个 click，这里模拟它（应被吞掉）
await sleep(120);

const bar = q('#editbar');
out.edit = {
  on: document.body.classList.contains('edit-mode'),
  barShown: !!(bar && !bar.hidden),
  count: bar ? (bar.querySelector('[data-role="n"]') || {}).textContent : '',
  anchorSelected: !!document.querySelector('.card.selected[data-id="' + firstId + '"]'),
  checkVisible: (() => {
    const c = document.querySelector('.card.selected .card-check');
    return c ? getComputedStyle(c).opacity : '';
  })(),
};

// ---------- 2. 编辑模式下点第二张 = 多选 ----------
click(cards[1]);
await sleep(120);
out.multi = {
  count: bar ? (bar.querySelector('[data-role="n"]') || {}).textContent : '',
  selected: document.querySelectorAll('.card.selected').length,
  detailOpened: !(q('#detail') || {}).hidden,
};

// ---------- 3. Esc 退出编辑模式 ----------
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await sleep(200);
out.exited = {
  off: !document.body.classList.contains('edit-mode'),
  barHidden: !!(bar && bar.hidden),
  stillSelected: document.querySelectorAll('.card.selected').length,
};

// ---------- 4. 「用切片软件打开」悬停二选一 ----------
const openBtn = first.querySelector('[data-act="open"]');
const p0 = at(openBtn);
openBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: p0.x, clientY: p0.y }));
const pop = await waitFor(() => q('.qpop.qpop-in'), 1200);
out.quickOpen = pop
  ? {
    items: Array.from(pop.querySelectorAll('.qpop-item')).map((b) => ({
      pick: b.dataset.pick,
      title: (b.querySelector('strong') || {}).textContent,
    })),
    // 浮层必须挂在 body 上：卡片 .card-media 有 overflow:hidden，挂在卡里会被裁掉
    parent: pop.parentElement === document.body ? 'body' : pop.parentElement.id,
    anchorHighlight: getComputedStyle(openBtn).backgroundColor,
    inViewport: (() => {
      const r = pop.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    })(),
  }
  : { error: '悬停后没有出现 .qpop' };
document.body.click();                  // 关掉浮层
await sleep(200);
out.quickOpenClosed = !q('.qpop.qpop-in');

// ---------- 4b. 菜单项不能误触发 ----------
// 说明：window.shelf 是 contextBridge 暴露的只读对象，无法在页面里替换成桩，
// 点菜单项会真的调 IPC 打开切片软件。所以这里不去点，只做结构断言 + 只读性检查；
// "点了之后走哪条分支"由 handleAct 里的一行 openModels(ids, 'bambu'|'snapmaker') 保证，
// 与右键菜单「用拓竹打开 / 用快造 U1 打开」是同一条路径。
out.menuStructure = {
  picks: (out.quickOpen.items || []).map((i) => i.pick),
  shelfFrozen: Object.isFrozen(window.shelf),
  writable: Object.getOwnPropertyDescriptor(window, 'shelf') ? !!Object.getOwnPropertyDescriptor(window, 'shelf').writable : null,
};

// ---------- 5. 库内拖动不能触发导入遮罩 ----------
// 关键回归：卡片里带 <img>，Chromium 会让 dataTransfer.types 里出现 'Files'；
// 旧实现只判 Files，于是拖卡片会弹出「松开即可添加」。
const dtTypes = new DataTransfer();
dtTypes.items.add(new File(['x'], 'sample.3mf', { type: 'application/octet-stream' }));
const filesDrag = new DataTransfer();
filesDrag.items.add(new File(['x'], 'sample.3mf', { type: 'application/octet-stream' }));

const dtDrag = new DataTransfer();
dtDrag.setData('text/plain', '[]');
first.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dtDrag }));
await sleep(80);
const flag = document.body.classList.contains('drag-holding-card');
const mask = q('#drag-mask');
window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: filesDrag }));
await sleep(80);
const maskWhileInternal = !!mask.hidden;
first.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dtDrag }));
await sleep(80);
// 去掉标记后再进一次，证明遮罩本身是好的（不是永远不显示）
window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: filesDrag }));
await sleep(80);
const maskWhileExternal = !!mask.hidden;
mask.hidden = true;
document.body.classList.remove('drag-holding-card');

out.drag = {
  typesHasFiles: Array.prototype.indexOf.call(dtTypes.types, 'Files') >= 0,
  flagOnDragstart: flag,
  maskStaysHiddenForInternal: maskWhileInternal,
  maskShowsForExternal: !maskWhileExternal,
  flagCleared: !document.body.classList.contains('drag-holding-card'),
};

// ---------- 6. 设备页里的删除确认框必须能点到 ----------
const devBtn = q('#btn-devices');
if (devBtn) devBtn.click();
const panel = await waitFor(() => (q('#devices-panel') && !q('#devices-panel').hidden) ? q('#devices-panel') : null, 4000);
const devCards = panel ? await waitFor(() => {
  const n = panel.querySelectorAll('.dev-card');
  return n.length ? Array.from(n) : null;
}, 8000) : null;

if (devCards) {
  const rm = devCards[0].querySelector('[data-act="dev-remove"]');
  if (rm) {
    rm.click();
    const back = await waitFor(() => q('#modal-root .modal-backdrop'), 3000);
    if (back) {
      const okBtn = back.querySelector('[data-role="ok"]');
      const r = okBtn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const zModal = Number(getComputedStyle(back).zIndex) || 0;
      const zOverlay = Number(getComputedStyle(panel).zIndex) || 0;
      out.deviceConfirm = {
        modalZ: zModal,
        overlayZ: zOverlay,
        aboveOverlay: zModal > zOverlay,
        // 面板中心点命中的必须就是确认按钮（不被遮罩挡住才算真的可点）
        topElementIsButton: !!(hit && (hit === okBtn || okBtn.contains(hit))),
        title: (back.querySelector('.modal-title, h3, .modal-head') || {}).textContent,
      };
      const cancel = back.querySelector('[data-role="cancel"]');
      if (cancel) cancel.click();
    } else {
      out.deviceConfirm = { error: '没弹出确认框' };
    }
  } else {
    out.deviceConfirm = { error: '没找到移除按钮' };
  }
  const closeDev = q('#devices-close');
  if (closeDev) closeDev.click();
} else {
  out.deviceConfirm = { error: '设备面板里没有卡片' };
}

out.ok = out.edit.on && out.edit.barShown && out.edit.count === '1' && out.edit.anchorSelected
  && out.multi.count === '2' && out.multi.selected === 2 && !out.multi.detailOpened
  && out.exited.off && out.exited.barHidden
  // 二级菜单现在是四路（docs/06 + openwith）：拓竹直开 / 官方 Orca 直开 /
  // 快造 U1 转换后打开 / 转换后官方 Orca。断言对齐现行契约，
  // 同时要求浮层条目数与菜单项一致，避免有项没渲染出来。
  && out.quickOpen.items && out.quickOpen.items.length === 4
  && out.quickOpen.items.length === out.menuStructure.picks.length
  && out.menuStructure.picks.join(',') === 'bambu,orca-official-direct,snapmaker,orca-official'
  && out.drag.typesHasFiles && out.drag.flagOnDragstart
  && out.drag.maskStaysHiddenForInternal && out.drag.maskShowsForExternal
  && out.deviceConfirm.aboveOverlay && out.deviceConfirm.topElementIsButton;
return out;
