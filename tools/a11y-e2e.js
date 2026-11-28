'use strict';
/**
 * 可访问性 / 键盘 E2E（真实 Electron + axe-core，不引入 Playwright）。
 *
 * 做三件事：
 *   1. 在临时数据副本上跑 axe（WCAG A/AA），浅色 + 深色各一遍，critical 必须为 0；
 *   2. 用 CDP 发真实 Tab/Shift+Tab/Esc/Ctrl+A/Delete/F2/Space，检查焦点、选择、确认弹窗；
 *   3. 不修改用户真实 settings / library，临时目录用完即删。
 *
 * 运行：node tools/a11y-e2e.js
 * 前置：npm install（axe-core 已在 devDependencies）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copyFileSafe(src, dst) {
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
}
function makeTempData() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-a11y-'));
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data, { recursive: true });
  const libPath = path.join(ROOT, 'data', 'library.json');
  const lib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  // 给批量打标签 E2E 一个稳定标签夹具；只在临时库里加，不碰真实库。
  if (!Array.isArray(lib.tags) || !lib.tags.length) {
    lib.tags = [{ id: 'tag-e2e', name: 'E2E标签', color: '#4f46e5' }];
  }
  fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify(lib, null, 2));
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'settings.json'), 'utf8'));
  settings.folders = [];
  settings.onboard = Object.assign({}, settings.onboard, { done: true });
  settings.ui = Object.assign({}, settings.ui, { theme: 'light' });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings, null, 2));
  return { tmp, data };
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
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, timeout = 15000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP 超时：' + method));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const r = await this.send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        });
        if (r && r.exceptionDetails) {
          throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
        }
        return r && r.result ? r.result.value : undefined;
      } catch (e) {
        if (/Execution context was destroyed|Inspected target navigated/i.test(e.message) && attempt < 11) {
          await sleep(500);
          continue;
        }
        throw e;
      }
    }
  }
  async key(key, code, keyCode, modifiers = 0) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    await sleep(80);
  }
  async waitFor(expression, timeout = 4000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = await this.eval(expression);
      if (v) return v;
      await sleep(120);
    }
    return null;
  }
}

async function main() {
  const { tmp, data } = makeTempData();
  const holdScript = path.join(tmp, 'hold.js');
  fs.writeFileSync(holdScript, 'await new Promise((r) => setTimeout(r, 40000));\nreturn { held: true };\n');
  const capPath = path.join(tmp, 'a11y.png');
  let cdp = null;
  let child = null;
  const out = { ok: false, axe: {}, keys: {}, checks: {} };
  try {
    child = spawn(process.execPath, [
      'launch.js',
      '--capture=' + capPath,
      '--ui-script=' + holdScript,
      '--no-seed',
      '--remote-debugging-port=' + PORT,
    ], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PRINTSHELF_DATA_DIR: data }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    console.error('[a11y] started');

    const list = await fetchJson('http://127.0.0.1:' + PORT + '/json/list');
    console.error('[a11y] target list', !!list);
    const page = (list || []).find((t) => t.type === 'page' && /^app:/.test(t.url || ''));
    if (!page) throw new Error('找不到页面 target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true });
    });
    cdp = new CDP(ws);
    console.error('[a11y] cdp connected');
    await sleep(1500);

    await cdp.eval(`new Promise((resolve) => {
      const end = Date.now() + 20000;
      const tick = () => {
        if (document.querySelectorAll('#content .card').length > 0 || Date.now() > end) resolve(true);
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    await sleep(800);
    console.error('[a11y] page ready');
    await cdp.eval(`new Promise((resolve) => {
      const end = Date.now() + 6000;
      const tick = () => {
        const el = document.querySelector('#boot-splash');
        const hidden = !el || getComputedStyle(el).visibility === 'hidden' || parseFloat(getComputedStyle(el).opacity) < 0.02;
        if (hidden || Date.now() > end) resolve(true);
        else setTimeout(tick, 100);
      };
      tick();
    })`);
    console.error('[a11y] boot hidden');

    const axeSource = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    await cdp.eval(axeSource + '\n; "axe-loaded"');
    console.error('[a11y] axe loaded');
    const audit = async (label) => {
      const r = await cdp.eval(`(async () => {
        const r = await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        });
        return r.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
          targets: v.nodes.slice(0, 8).map((n) => n.target.join(' ')),
        }));
      })()`);
      out.axe[label] = {
        critical: r.filter((v) => v.impact === 'critical').length,
        serious: r.filter((v) => v.impact === 'serious').length,
        violations: r,
      };
      return r;
    };

    await cdp.eval(`(() => { const b = document.querySelector('#btn-app-more'); if (b) b.click(); return true; })()`);
    await sleep(150);
    await audit('light');

    await cdp.eval(`(() => { const b = document.querySelector('#btn-theme'); if (b) b.click(); return document.documentElement.getAttribute('data-theme'); })()`);
    await sleep(350);
    out.theme = await cdp.eval(`document.documentElement.getAttribute('data-theme')`);
    await audit('dark');

    // 键盘：Tab / Shift+Tab / Ctrl+A / Delete / F2 / Space / Esc
    await cdp.eval(`(() => { const c = document.querySelector('#content .card'); if (c) c.focus(); return true; })()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 0 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 0 });
    await sleep(100);
    out.keys.tab = await cdp.eval(`(() => {
      const el = document.activeElement;
      const st = el ? getComputedStyle(el) : null;
      return { tag: el && el.tagName, cls: el && el.className, id: el && el.id, focusVisible: !!(el && el.matches && el.matches(':focus-visible')), outline: st && (st.outlineWidth + ' ' + st.outlineStyle) };
    })()`);
    await cdp.key('Tab', 'Tab', 9, 8);
    out.keys.shiftTab = await cdp.eval(`(() => {
      const el = document.activeElement;
      return { tag: el && el.tagName, cls: el && el.className, id: el && el.id, focusVisible: !!(el && el.matches && el.matches(':focus-visible')) };
    })()`);

    await cdp.eval(`(() => { const b = document.querySelector('#bulk-clear'); if (b) b.click(); const c = document.querySelector('#content .card'); if (c) c.focus(); return true; })()`);
    await cdp.key('a', 'KeyA', 65, 2);
    out.keys.ctrlA = await cdp.eval(`({ count: (document.querySelector('#bulk-count') || {}).textContent, visible: !!document.querySelector('#bulkbar') && !document.querySelector('#bulkbar').hidden })`);
    await cdp.key('Delete', 'Delete', 46, 0);
    out.keys.deleteConfirm = await cdp.eval(`({ modal: !!document.querySelector('#modal-root .modal-backdrop'), title: (document.querySelector('#modal-root .modal-title, #modal-root h3, #modal-root .modal-head') || {}).textContent || '' })`);
    await cdp.key('Escape', 'Escape', 27, 0);
    out.keys.deleteCancel = await cdp.eval(`({ modal: !!document.querySelector('#modal-root .modal-backdrop') })`);

    await cdp.eval(`(() => { const b = document.querySelector('#bulk-clear'); if (b) b.click(); const c = document.querySelector('#content .card'); if (c) c.focus(); return true; })()`);
    await cdp.key(' ', 'Space', 32, 0);
    await sleep(250);
    out.keys.f2Sel = await cdp.eval(`({ count: (document.querySelector('#bulk-count') || {}).textContent, visible: !!document.querySelector('#bulkbar') && !document.querySelector('#bulkbar').hidden })`);
    await cdp.key('F2', 'F2', 113, 0);
    await sleep(350);
    out.keys.f2 = await cdp.eval(`({ modal: !!document.querySelector('#modal-root .modal-backdrop'), hasInput: !!document.querySelector('#modal-root input') })`);
    await cdp.key('Escape', 'Escape', 27, 0);
    out.keys.f2Cancel = await cdp.eval(`({ modal: !!document.querySelector('#modal-root .modal-backdrop') })`);

    await cdp.eval(`(() => { const b = document.querySelector('#bulk-clear'); if (b) b.click(); const c = document.querySelector('#content .card'); if (c) c.focus(); return true; })()`);
    await cdp.key(' ', 'Space', 32, 0);
    out.keys.space = await cdp.eval(`({ selected: !!document.querySelector('#bulkbar') && !document.querySelector('#bulkbar').hidden, lightboxHidden: document.querySelector('#lightbox').hidden })`);
    await cdp.eval(`(() => { const b = document.querySelector('#bulk-clear'); if (b) b.click(); return true; })()`);
    await cdp.eval(`(() => { const c = document.querySelector('#content .card'); if (c) c.click(); return true; })()`);
    await sleep(200);
    out.keys.detailOpen = await cdp.eval(`({ open: !document.querySelector('#detail').hidden })`);
    await cdp.key('Escape', 'Escape', 27, 0);
    out.keys.detailEsc = await cdp.eval(`({ closed: document.querySelector('#detail').hidden })`);

    // 批量操作 E2E（只在临时库上执行）：全选 → 收藏 → 添加标签（真实 IPC + 刷新）
    await cdp.eval(`(() => { const b = document.querySelector('#btn-select-all'); if (b) b.click(); return true; })()`);
    await sleep(150);
    out.batch = await cdp.eval(`({ selected: (document.querySelector('#bulk-count') || {}).textContent })`);
    await cdp.eval(`(() => { const b = document.querySelector('#bulk-fav'); if (b) b.click(); return true; })()`);
    out.batch.favoriteToast = await cdp.waitFor(`(() => {
      const t = document.querySelector('#toast-container .toast-message');
      return t && t.textContent.includes('已更新') ? t.textContent : null;
    })()`, 5000);
    await sleep(250);
    await cdp.eval(`(() => { const b = document.querySelector('#bulk-tag'); if (b) b.click(); return true; })()`);
    out.batch.tagModal = await cdp.waitFor(`(() => {
      const m = document.querySelector('#modal-root .modal-backdrop');
      return m ? { title: (document.querySelector('#modal-root .modal-title') || {}).textContent, empty: (document.querySelector('#modal-root .empty') || {}).textContent || '' } : null;
    })()`, 2500);
    out.batch.tagOptions = await cdp.eval(`document.querySelectorAll('#modal-root .select-opt[data-i]').length`);
    if (out.batch.tagOptions) {
      await cdp.eval(`(() => {
        document.querySelector('#modal-root .select-opt[data-i]').click();
        document.querySelector('#modal-root [data-role="ok"]').click();
        return true;
      })()`);
      out.batch.tagToast = await cdp.waitFor(`(() => {
        const t = document.querySelector('#toast-container .toast-message');
        return t && t.textContent.includes('已更新') ? t.textContent : null;
      })()`, 5000);
    } else if (out.batch.tagModal) {
      await cdp.eval(`(() => { const b = document.querySelector('#modal-root [data-role="cancel"]'); if (b) b.click(); return true; })()`);
    }
    await cdp.eval(`(() => { const b = document.querySelector('#bulk-category'); if (b) b.click(); return true; })()`);
    out.batch.categoryOptions = await cdp.waitFor(`document.querySelectorAll('#modal-root .select-opt[data-i]').length`, 2500);
    if (out.batch.categoryOptions) {
      await cdp.eval(`(() => {
        const opts = document.querySelectorAll('#modal-root .select-opt[data-i]');
        (opts[1] || opts[0]).click();
        return true;
      })()`);
      out.batch.categoryToast = await cdp.waitFor(`(() => {
        const t = document.querySelector('#toast-container .toast-message');
        return t && t.textContent.includes('已更新') ? t.textContent : null;
      })()`, 5000);
    }
    await sleep(300);
    out.checks.batchFavorite = !!out.batch.favoriteToast;
    out.checks.batchTag = !!(out.batch.tagOptions && out.batch.tagToast);
    out.checks.batchCategory = !!(out.batch.categoryOptions && out.batch.categoryToast);

    const critical = Math.max(out.axe.light.critical, out.axe.dark.critical);
    out.cards = await cdp.eval(`document.querySelectorAll('#content .card').length`);
    out.checks.axeCritical = critical === 0;
    out.checks.focusVisible = !!(out.keys.tab && out.keys.tab.focusVisible);
    out.checks.shiftTab = !!(out.keys.shiftTab && out.keys.shiftTab.focusVisible);
    out.checks.ctrlA = out.keys.ctrlA.visible && Number(out.keys.ctrlA.count) === out.cards;
    out.checks.delete = out.keys.deleteConfirm.modal && /删除|移出索引|回收站/.test(out.keys.deleteConfirm.title) && !out.keys.deleteCancel.modal;
    out.checks.f2 = out.keys.f2Sel.visible && out.keys.f2Sel.count === '1' && out.keys.f2.modal && out.keys.f2.hasInput && !out.keys.f2Cancel.modal;
    out.checks.space = out.keys.space.selected && out.keys.space.lightboxHidden;
    out.checks.esc = out.keys.detailOpen.open && out.keys.detailEsc.closed;
    out.checks.dark = out.theme === 'dark';

    // 空库引导（不写库，只替换内存 items）
    out.empty = await cdp.eval(`(() => {
      window.__printshelfSetItems([]);
      window.__printshelfForceEmptyLibrary();
      const el = document.querySelector('#empty-state');
      const add = document.querySelector('#empty-add');
      return {
        visible: !!el && !el.hidden,
        text: el ? el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : '',
        addVisible: !!add && !add.hidden,
      };
    })()`);
    await sleep(200);
    out.checks.emptyGuide = out.empty.visible && out.empty.addVisible && /导入|添加|选择/.test(out.empty.text);
    out.ok = Object.values(out.checks).every(Boolean);
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (_) {}
    try { if (child) child.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
