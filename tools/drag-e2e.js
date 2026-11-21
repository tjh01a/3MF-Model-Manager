'use strict';
/**
 * 真实拖放的端到端验证（合成 DragEvent 测不出浏览器层的 effectAllowed/dropEffect 协商）。
 *
 * 做法：
 *   1. 把真实库复制到临时目录（不动用户数据），用 PRINTSHELF_DATA_DIR 指过去；
 *   2. 用 --capture 启动（绕过单实例锁），并带一个「挂住 15 秒」的 ui-script 保持窗口存活；
 *   3. 通过 --remote-debugging-port 连 CDP，用 Input.dispatchDragEvent 发真实的
 *      dragEnter → dragOver → drop，dragOperationsMask = Copy(1)|Move(4)；
 *   4. 事后读 window.shelf.get(id)，看 categoryId 是否真的落库。
 *
 * 用 `Input.dispatchDragEvent` 的原因：它走浏览器进程的拖放协商（不是页面里 append 的假事件），
 * 页面把 dropEffect 设成 effectAllowed 以外的值时，drop 会被真正拒收 —— 这正是
 * 「能拖过去、高亮也有、松手却没反应」那个 bug 的成因。
 *
 * 用法：node tools/drag-e2e.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function makeTempData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-drag-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'library.json'), path.join(tmp, 'library.json'));
  const thumbs = path.join(ROOT, 'data', 'thumbs');
  if (fs.existsSync(thumbs)) copyDir(thumbs, path.join(tmp, 'thumbs'));
  return tmp;
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) { /* 端口还没起来 */ }
    await sleep(250);
  }
  return null;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.method) this.events.push(msg);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时：' + method));
        }
      }, 8000);
    });
  }
  async waitEvent(method, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i >= 0) return this.events.splice(i, 1)[0].params;
      await sleep(50);
    }
    return null;
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r && r.exceptionDetails) {
      throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    return r && r.result ? r.result.value : undefined;
  }
}

async function main() {
  const tmp = makeTempData();
  const holdScript = path.join(tmp, 'hold.js');
  fs.writeFileSync(holdScript, 'await new Promise((r) => setTimeout(r, 15000));\nreturn { held: true };\n');
  const capPath = path.join(tmp, 'shot.png');

  const log = [];
  const push = (s) => { log.push(s); process.stdout.write(s + '\n'); };

  const child = spawn(process.execPath, [
    'launch.js',
    '--capture=' + capPath,
    '--ui-script=' + holdScript,
    '--no-seed',
    '--remote-debugging-port=' + PORT,
  ], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PRINTSHELF_DATA_DIR: tmp }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let cdp = null;
  try {
    const list = await fetchJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (list || []).find((t) => t.type === 'page' && /^app:/.test(t.url || ''));
    if (!page) throw new Error('找不到页面 target（端口 ' + PORT + '）');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true });
    });
    cdp = new CDP(ws);

    // 等页面把卡片渲染出来
    for (let i = 0; i < 40; i++) {
      const n = await cdp.eval('document.querySelectorAll("#content .card").length');
      if (n >= 3) break;
      await sleep(300);
    }

    const info = await cdp.eval(`(() => {
      const card = document.querySelector('#content .card');
      const cat = document.querySelector('#nav-categories .cat-item');
      if (!card || !cat) return null;
      const cr = card.getBoundingClientRect();
      const kr = cat.getBoundingClientRect();
      return {
        id: card.dataset.id,
        title: (card.querySelector('.card-title') || {}).textContent,
        catId: cat.dataset.cat,
        catName: (cat.querySelector('.nav-label') || {}).textContent,
        from: { x: Math.round(cr.left + cr.width / 2), y: Math.round(cr.top + 40) },
        to: { x: Math.round(kr.left + 40), y: Math.round(kr.top + kr.height / 2) },
      };
    })()`);
    if (!info) throw new Error('页面里没有卡片或分类');
    push('拖动：「' + info.title + '」 → 「' + info.catName + '」');

    // 记录页面实际收到的拖放事件，用于区分「CDP 没送到页面」和「送到了但被拒收」
    await cdp.eval(`(() => {
      window.__dnd = [];
      ['dragenter', 'dragover', 'drop', 'dragleave'].forEach((t) => {
        document.addEventListener(t, (e) => {
          window.__dnd.push({
            t,
            types: e.dataTransfer ? Array.from(e.dataTransfer.types) : null,
            prevented: e.defaultPrevented,
            dropEffect: e.dataTransfer ? e.dataTransfer.dropEffect : null,
            target: e.target && e.target.className ? String(e.target.className).slice(0, 40) : '',
          });
        }, true);
      });
      return true;
    })()`);

    // effectAllowed = 'copyMove' 对应的掩码：Copy(1) | Move(4)
    const dragData = {
      items: [
        { mimeType: 'application/x-shelf-ids', data: JSON.stringify([info.id]) },
        { mimeType: 'text/plain', data: JSON.stringify([info.id]) },
      ],
      files: [],
      dragOperationsMask: 5,
    };

    // 先做一次真实鼠标拖拽并拦截它，拿到浏览器真正使用的 dragData
    // （这样 effectAllowed 掩码、items、有没有 Files 都是真实的，而不是我编的）
    let dispatched = 'ok';
    let realMask = null;
    let realTypes = null;
    try {
      await cdp.send('Input.setInterceptDrags', { enabled: true });
      const mid = { x: Math.round((info.from.x + info.to.x) / 2), y: Math.round((info.from.y + info.to.y) / 2) };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.from.x, y: info.from.y, button: 'none', buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.from.x, y: info.from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of [info.from, { x: info.from.x - 14, y: info.from.y - 10 }, mid, { x: info.to.x, y: info.to.y - 6 }, info.to]) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
        await sleep(60);
      }
      const intercepted = await cdp.waitEvent('Input.dragIntercepted', 4000);
      if (intercepted && intercepted.data) {
        realMask = intercepted.data.dragOperationsMask;
        realTypes = (intercepted.data.items || []).map((i) => i.mimeType);
        dragData.dragOperationsMask = realMask;
        // 用真实 items 覆盖，保证页面能拿到自己 setData 的内容
        if (intercepted.data.items && intercepted.data.items.length) dragData.items = intercepted.data.items;
        if (intercepted.data.files) dragData.files = intercepted.data.files;
      }
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await cdp.send('Input.dispatchDragEvent', { type, x: info.to.x, y: info.to.y, data: dragData });
        await sleep(100);
      }
      try { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.to.x, y: info.to.y, button: 'left', buttons: 0, clickCount: 1 }); } catch (_) {}
      try { await cdp.send('Input.setInterceptDrags', { enabled: false }); } catch (_) {}
    } catch (e) {
      dispatched = (e && e.message) || String(e);
    }
    push('真实拖拽：mask=' + realMask + ' types=' + JSON.stringify(realTypes));
    push('拖放事件派发：' + dispatched);
    push('页面收到：' + JSON.stringify(await cdp.eval('window.__dnd || []')));

    await sleep(1200);
    const after = await cdp.eval('(async () => { const m = await window.shelf.get(' +
      JSON.stringify(info.id) + '); return { categoryId: m && m.categoryId }; })()');
    const toasts = await cdp.eval('Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent.replace(/\\s+/g, " ").trim())');

    const landed = after && after.categoryId === info.catId;
    const out = {
      ok: !!landed,
      card: info.title,
      targetCategory: info.catName,
      categoryIdAfterDrop: after && after.categoryId,
      expected: info.catId,
      toasts,
      dispatch: dispatched,
      realDragMask: realMask,
      realDragTypes: realTypes,
    };
    push('结果：' + JSON.stringify(out, null, 2));
    process.exitCode = out.ok ? 0 : 1;
  } catch (e) {
    push('失败：' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (_) {}
    try { child.kill(); } catch (_) {}
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

main();
