'use strict';
/**
 * 首启向导可访问性检查（真实 Electron + axe-core）：
 *   1. 三步界面各跑一遍 WCAG A/AA，critical / serious 必须为 0；
 *   2. 检查欢迎页的必做 / 可选徽章能被读出，而不是只有颜色；
 *   3. 检查 Tab 焦点被限制在向导卡片内（首个 Shift+Tab → 最后一个控件，末个 Tab → 第一个控件）；
 *   4. 全程使用临时数据目录，不碰真实设置与模型库。
 *
 * 运行：node tools/onboarding-a11y.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findSample() {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.3mf$/i.test(e.name)) found.push(p);
    }
  };
  walk(path.join(ROOT, 'data'));
  walk(path.join(ROOT, 'tests'));
  found.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
  return found[0] || null;
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
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
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
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
        if (/Execution context was destroyed|Inspected target navigated/i.test(e.message || '') && attempt < 11) {
          await sleep(400);
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
}

async function main() {
  const sample = findSample();
  if (!sample) throw new Error('找不到可用于向导测试的 .3mf 样本');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-onboard-a11y-'));
  const data = path.join(tmp, 'data');
  const models = path.join(tmp, '模型');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(models, { recursive: true });
  fs.copyFileSync(sample, path.join(models, 'One.3mf'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
    schemaVersion: 1,
    folders: [],
    onboard: { done: false, at: 0, depth: 'standard', skipped: false, guideDone: false },
    ui: { language: 'zh-CN', theme: 'light' },
  }, null, 2));

  const hold = path.join(tmp, 'hold.js');
  fs.writeFileSync(hold, 'await new Promise((r) => setTimeout(r, 60000));\nreturn { held: true };\n');
  const cap = path.join(tmp, 'onboarding-a11y.png');

  const out = { ok: false, axe: {}, checks: {} };
  let child = null;
  try {
    child = spawn(process.execPath, [
      'launch.js',
      '--capture=' + cap,
      '--ui-script=' + hold,
      '--no-seed',
      '--remote-debugging-port=' + PORT,
    ], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PRINTSHELF_DATA_DIR: data }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    console.error('[onboarding-a11y] started');

    const list = await fetchJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (list || []).find((t) => t.type === 'page' && /^app:/.test(t.url || ''));
    if (!page) throw new Error('找不到页面 target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true });
    });
    const cdp = new CDP(ws);
    console.error('[onboarding-a11y] cdp connected');

    const visible = await cdp.eval(`new Promise((resolve) => {
      const end = Date.now() + 20000;
      const tick = () => {
        const el = document.querySelector('#onboarding');
        if (el && !el.hidden) resolve(true);
        else if (Date.now() > end) resolve(false);
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    if (!visible) throw new Error('首启向导没有出现');
    await sleep(500);
    console.error('[onboarding-a11y] onboarding visible');

    const axeSource = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    await cdp.eval(axeSource + '\n; "axe-loaded"');
    console.error('[onboarding-a11y] axe loaded');

    const audit = async (label) => {
      const r = await cdp.eval(`(async () => {
        const r = await axe.run(document.querySelector('#onboarding') || document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        });
        return r.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
          targets: v.nodes.slice(0, 8).map((n) => n.target.join(' ')),
        }));
      })()`);
      out.axe[label] = {
        all: r,
        critical: r.filter((v) => v.impact === 'critical').length,
        serious: r.filter((v) => v.impact === 'serious').length,
      };
      console.error('[onboarding-a11y] ' + label + ' critical=' + out.axe[label].critical
        + ' serious=' + out.axe[label].serious + ' all=' + r.length);
    };

    await audit('step1');
    await cdp.eval(`document.documentElement.setAttribute('data-theme', 'dark'); true`);
    await sleep(350);
    await audit('step1-dark');
    await cdp.eval(`document.documentElement.setAttribute('data-theme', 'light'); true`);
    await sleep(250);
    out.step1 = await cdp.eval(`(() => ({
      title: (document.querySelector('#onboarding .ob-title') || {}).textContent || '',
      required: Array.from(document.querySelectorAll('#onboarding .ob-plan-badge.required')).map((e) => e.textContent.trim()),
      optional: Array.from(document.querySelectorAll('#onboarding .ob-plan-badge:not(.required)')).map((e) => e.textContent.trim()),
      trust: (document.querySelector('#onboarding .ob-trust') || {}).textContent || '',
      dotsHidden: !!document.querySelector('#onboarding .ob-dots[aria-hidden="true"]'),
    }))()`);

    await cdp.eval(`document.querySelector('#onboarding [data-ob="next"]').click(); true`);
    await cdp.eval(`new Promise((resolve) => {
      const end = Date.now() + 8000;
      const tick = () => {
        if (document.querySelector('#onboarding .ob-best')) resolve(true);
        else if (Date.now() > end) resolve(false);
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    await sleep(400);
    await audit('step2');

    await cdp.eval(`window.__printshelfOnboardingAddPath(${JSON.stringify(models)}); true`);
    await sleep(300);
    await cdp.eval(`document.querySelector('#onboarding [data-ob="scan"]').click(); true`);
    const scanned = await cdp.eval(`new Promise((resolve) => {
      const end = Date.now() + 30000;
      const tick = () => {
        if (document.querySelector('#onboarding .ob-result')) resolve(true);
        else if (Date.now() > end) resolve(false);
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    if (!scanned) throw new Error('扫描没有出结果');
    await sleep(500);
    await audit('result');

    // 焦点陷阱：结果页第一个控件 Shift+Tab 应回到最后一个，最后一个控件 Tab 应回到第一个。
    const focusEdge = `(() => {
      const items = Array.from(document.querySelectorAll('#onboarding button, #onboarding [href], #onboarding input, #onboarding summary, #onboarding [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.tabIndex !== -1 && el.getClientRects().length > 0);
      return items;
    })()`;
    await cdp.eval(`(() => { const items = ${focusEdge}; items[0].focus(); return items[0].textContent; })()`);
    await cdp.key('Tab', 'Tab', 9, 8);
    const afterShift = await cdp.eval(`(() => {
      const a = document.activeElement;
      const items = ${focusEdge};
      return { ob: !!(a && a.closest && a.closest('#onboarding')), text: (a && (a.textContent || '').trim()) || '', tag: a && a.tagName, expect: (items[items.length - 1].textContent || '').trim() };
    })()`);
    await cdp.eval(`(() => { const items = ${focusEdge}; items[items.length - 1].focus(); return items[items.length - 1].textContent; })()`);
    await cdp.key('Tab', 'Tab', 9);
    const afterTab = await cdp.eval(`(() => {
      const a = document.activeElement;
      const items = ${focusEdge};
      return { ob: !!(a && a.closest && a.closest('#onboarding')), text: (a && (a.textContent || '').trim()) || '', tag: a && a.tagName, expect: (items[0].textContent || '').trim() };
    })()`);

    out.focus = { afterTab, afterShift };
    out.checks = {
      dialog: await cdp.eval(`!!document.querySelector('#onboarding .ob-card[role="dialog"][aria-modal="true"]')`),
      labelled: await cdp.eval(`(document.querySelector('#onboarding .ob-card') || {}).getAttribute && document.querySelector('#onboarding .ob-card').getAttribute('aria-labelledby') === 'ob-title'`),
      langSwitch: await cdp.eval(`!!document.querySelector('#onboarding .ob-lang [data-lang="zh-CN"][aria-pressed="true"]') && !!document.querySelector('#onboarding .ob-lang [data-lang="en-US"][aria-pressed="false"]')`),
      badgesText: out.step1.required.includes('必做') && out.step1.optional.includes('可选'),
      dotsHidden: out.step1.dotsHidden,
      axe: Object.values(out.axe).every((x) => x.critical === 0 && x.serious === 0),
      tabTrap: afterTab.ob && afterTab.text === afterTab.expect && afterShift.ob && afterShift.text === afterShift.expect,
    };
    out.ok = Object.values(out.checks).every(Boolean);
    console.log('=== PRINTSHELF_ONBOARDING_A11Y ===');
    console.log(JSON.stringify(out, null, 2));
    console.log('=== END ===');
  } finally {
    try { if (child) child.kill(); } catch (_) {}
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  if (!out.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
