'use strict';
/**
 * 新手向导的中英切换回归：
 *   1. 中文首启 → 第二步点 EN → 页面真实 reload → 仍停在第二步，且整页变英文；
 *   2. 英文下继续扫描 → 完成页点「中」→ reload → 仍停在完成页，且整页变中文；
 *   3. 检查 settings.ui.language 落盘、没有中文残留、语言按钮 aria-pressed 正确。
 *
 * 运行：node tools/onboarding-language-e2e.js
 * 使用独立 --user-data-dir，不抢用户正在运行的 PrintShelf 单实例锁。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9340;
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

async function fetchJson(url, tries = 80) {
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
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const r = await this.send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        });
        if (r && r.exceptionDetails) {
          throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
        }
        return r && r.result ? r.result.value : undefined;
      } catch (e) {
        if (/Execution context was destroyed|Inspected target navigated|Target closed/i.test(e.message || '') && attempt < 14) {
          await sleep(400);
          continue;
        }
        throw e;
      }
    }
  }

  close() { try { this.ws.close(); } catch (_) {} }
}

async function connectPage() {
  const list = await fetchJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = (list || []).find((t) => t.type === 'page' && /^app:/.test(t.url || ''));
  if (!page) throw new Error('找不到页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true });
  });
  return { cdp: new CDP(ws), ws };
}

async function waitOnboarding(cdp, timeout = 20000) {
  return cdp.eval(`new Promise((resolve) => {
    const end = Date.now() + ${timeout};
    const tick = () => {
      const el = document.querySelector('#onboarding');
      if (el && !el.hidden && document.querySelector('#onboarding .ob-card')) resolve(true);
      else if (Date.now() > end) resolve(false);
      else setTimeout(tick, 150);
    };
    tick();
  })`);
}

async function main() {
  const sample = findSample();
  if (!sample) throw new Error('找不到 3MF 样本');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-onboard-lang-'));
  const data = path.join(tmp, 'data');
  const models = path.join(tmp, '模型');
  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(models, { recursive: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.copyFileSync(sample, path.join(models, 'One.3mf'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
    schemaVersion: 1,
    folders: [],
    onboard: { done: false, at: 0, depth: 'standard', skipped: false, guideDone: false },
    ui: { language: 'zh-CN', theme: 'light' },
  }, null, 2));

  const electron = require('electron');
  const out = { ok: false, checks: {}, step2En: null, resultEn: null, resultZh: null };
  let child = null;
  let conn = null;
  try {
    child = spawn(electron, [
      '.', '--no-seed',
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + PORT,
    ], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PRINTSHELF_DATA_DIR: data }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    conn = await connectPage();
    const cdp = conn.cdp;
    const visible = await waitOnboarding(cdp);
    if (!visible) throw new Error('首启向导没有出现');

    // 到第二步，点 EN。
    await cdp.eval(`document.querySelector('#onboarding [data-ob="next"]').click(); true`);
    await cdp.eval(`new Promise((resolve) => {
      const end = Date.now() + 8000;
      const tick = () => (document.querySelector('#onboarding .ob-best') ? resolve(true) : (Date.now() > end ? resolve(false) : setTimeout(tick, 150)));
      tick();
    })`);
    await sleep(300);
    const before = await cdp.eval(`(() => {
      const a = document.querySelector('#onboarding [data-ob="lang"][data-lang="en-US"]');
      return { visible: !!a, pressed: a && a.getAttribute('aria-pressed'), title: (document.querySelector('#onboarding .ob-title') || {}).textContent || '' };
    })()`);
    out.beforeEn = before;
    await cdp.eval(`document.querySelector('#onboarding [data-ob="lang"][data-lang="en-US"]').click(); true`);

    // reload 后重新连；等英文第二步出现。
    await sleep(2200);
    try { conn.ws.close(); } catch (_) {}
    conn = await connectPage();
    const cdp2 = conn.cdp;
    const ok2 = await waitOnboarding(cdp2);
    if (!ok2) throw new Error('切换英文后向导没有恢复');
    await sleep(400);
    out.step2En = await cdp2.eval(`(() => {
      const card = document.querySelector('#onboarding .ob-card');
      const clone = card ? card.cloneNode(true) : null;
      if (clone) { const l = clone.querySelector('.ob-lang'); if (l) l.remove(); }
      const t = (clone || {}).innerText || '';
      return {
        title: (document.querySelector('#onboarding .ob-title') || {}).textContent || '',
        cjk: (t.match(/[\u3400-\u9fff]/g) || []).length,
        enPressed: document.querySelector('#onboarding [data-ob="lang"][data-lang="en-US"]').getAttribute('aria-pressed'),
        zhPressed: document.querySelector('#onboarding [data-ob="lang"][data-lang="zh-CN"]').getAttribute('aria-pressed'),
        step: (document.querySelector('#onboarding .ob-kicker') || {}).textContent || '',
      };
    })()`);

    // 英文状态下继续扫描。
    await cdp2.eval(`window.__printshelfOnboardingAddPath(${JSON.stringify(models)}); true`);
    await sleep(300);
    await cdp2.eval(`document.querySelector('#onboarding [data-ob="scan"]').click(); true`);
    const scanned = await cdp2.eval(`new Promise((resolve) => {
      const end = Date.now() + 30000;
      const tick = () => (document.querySelector('#onboarding .ob-result') ? resolve(true) : (Date.now() > end ? resolve(false) : setTimeout(tick, 150)));
      tick();
    })`);
    if (!scanned) throw new Error('英文向导没有扫描出结果');
    await sleep(400);
    out.resultEn = await cdp2.eval(`(() => {
      const card = document.querySelector('#onboarding .ob-card');
      const clone = card ? card.cloneNode(true) : null;
      if (clone) { const l = clone.querySelector('.ob-lang'); if (l) l.remove(); }
      const t = (clone || {}).innerText || '';
      return {
        title: (document.querySelector('#onboarding .ob-title') || {}).textContent || '',
        number: (document.querySelector('#onboarding .ob-result-num') || {}).textContent || '',
        cjk: (t.match(/[\u3400-\u9fff]/g) || []).length,
        cta: (document.querySelector('#onboarding [data-ob="finish"]') || {}).textContent || '',
      };
    })()`);

    // 完成页切回中文，reload 后仍应停在完成页。
    await cdp2.eval(`document.querySelector('#onboarding [data-ob="lang"][data-lang="zh-CN"]').click(); true`);
    await sleep(2600);
    try { conn.ws.close(); } catch (_) {}
    conn = await connectPage();
    const cdp3 = conn.cdp;
    const ok3 = await waitOnboarding(cdp3);
    if (!ok3) throw new Error('切回中文后向导没有恢复');
    await sleep(400);
    out.resultZh = await cdp3.eval(`(() => {
      const card = document.querySelector('#onboarding .ob-card');
      const t = (card || {}).innerText || '';
      return {
        title: (document.querySelector('#onboarding .ob-title') || {}).textContent || '',
        number: (document.querySelector('#onboarding .ob-result-num') || {}).textContent || '',
        enPressed: document.querySelector('#onboarding [data-ob="lang"][data-lang="en-US"]').getAttribute('aria-pressed'),
        zhPressed: document.querySelector('#onboarding [data-ob="lang"][data-lang="zh-CN"]').getAttribute('aria-pressed'),
        hasChinese: /[\u3400-\u9fff]/.test(t),
      };
    })()`);

    const settings = JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
    out.checks = {
      switchVisible: before.visible === true && before.pressed === 'false',
      step2English: out.step2En.title === 'Where are the models?' && out.step2En.cjk === 0
        && out.step2En.enPressed === 'true' && out.step2En.zhPressed === 'false',
      scanEnglish: out.resultEn.title === "Scan complete. You're ready" && out.resultEn.cjk === 0
        && /model/.test(out.resultEn.number) && /Enter Model Library/.test(out.resultEn.cta),
      resultChinese: out.resultZh.title === '扫描完成，可以开始用了' && out.resultZh.hasChinese
        && out.resultZh.enPressed === 'false' && out.resultZh.zhPressed === 'true',
      persisted: settings.ui && settings.ui.language === 'zh-CN',
    };
    out.ok = Object.values(out.checks).every(Boolean);
    console.log('=== PRINTSHELF_ONBOARDING_LANGUAGE ===');
    console.log(JSON.stringify(out, null, 2));
    console.log('=== END ===');
  } finally {
    try { if (conn) conn.ws.close(); } catch (_) {}
    if (child && child.pid) {
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  if (!out.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
