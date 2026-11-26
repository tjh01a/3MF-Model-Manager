/**
 * 走查探针 B：损坏文件隔离区
 *
 *   node tools/probe-bca-prepare.js %TEMP%/ps-probe-bca
 *   set PRINTSHELF_DATA_DIR=%TEMP%/ps-probe-bca
 *   node launch.js --capture=%TEMP%/probe-broken.png --ui-script=tools/probe-broken.js
 *
 * 断言重点：三类坏文件都列出来、可修复标记只给能修的两条、按钮齐全、
 * 重试有反馈、移入隔离区后行标变化、再移回原处能恢复。
 * 结尾把 ui 设置写回，避免探针把语言/主题/布局留在临时库里影响下一轮。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const until = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) {
      try { if (fn()) return true; } catch (_) { /* 继续等 */ }
      await sleep(120);
    }
    return false;
  };
  const toastText = () => qa('.toast-message').map((t) => t.textContent).join('|');

  const out = { ok: [], bad: [], info: {}, errors: [] };
  const ok = (cond, msg) => { (cond ? out.ok : out.bad).push(msg); };
  window.addEventListener('error', (e) => out.errors.push(String((e && e.message) || e)));
  window.addEventListener('unhandledrejection', (e) => out.errors.push('rejection: ' + String(e && e.reason)));

  const s0 = await window.shelf.settings();
  const ui0 = JSON.parse(JSON.stringify((s0 && s0.ui) || {}));

  try {
    await until(() => q('#sidebar') && (q('#content .card') || q('#content .empty')), 15000);

    const nav = q('#sidebar [data-smart="broken"]');
    ok(!!nav, '侧栏有「损坏文件」入口');
    if (!nav) throw new Error('缺少 broken 入口');
    nav.click();
    await until(() => q('#content .br-item') || q('#content .empty'), 10000);

    const rows = qa('#content .br-item');
    out.info.rows = rows.length;
    ok(rows.length === 3, '三条坏文件都列出来了（实际 ' + rows.length + '）');
    ok(rows.every((r) => r.querySelector('.br-file')), '每行都有文件名');
    ok(rows.every((r) => (r.textContent || '').includes('.3mf')), '每行都显示扩展名');
    const repairable = rows.filter((r) => r.querySelector('.badge-ok'));
    ok(repairable.length === 2, '可修复徽标只给截断/缺核心两条（实际 ' + repairable.length + '）');
    const textRow = rows.find((r) => (r.textContent || '').includes('纯文本'));
    ok(!!textRow, '纯文本坏文件在列表里');
    ok(textRow && !textRow.querySelector('[data-act="br-repair"]'), '不可修复的那条没有「尝试修复」');
    ok(rows.every((r) => r.querySelector('[data-act="br-quarantine"]') && r.querySelector('[data-act="br-trash"]') && r.querySelector('[data-act="br-forget"]')),
      '每行都有 隔离 / 回收站 / 移出索引');
    ok(rows.every((r) => r.querySelector('.badge.warn')), '每行有故障类型徽标');
    const head = q('#content .special-head');
    ok(head && (head.textContent || '').includes('共 3 个'), '汇总显示共 3 个');

    // 重试：截断文件仍然解析不了，必须有失败反馈
    const broken = rows.find((r) => (r.textContent || '').includes('截断'));
    const before = toastText();
    if (broken) broken.querySelector('[data-act="br-retry"]').click();
    await sleep(1500);
    out.info.retryToast = toastText();
    ok(toastText() !== before, '重试后有提示（不是静默失败）');
    await until(() => qa('#content .br-item').length === 3, 5000);
    ok(qa('#content .br-item').length === 3, '重试后列表仍是三条');

    // 隔离纯文本那条，再移回原处
    const fresh = () => qa('#content .br-item');
    const t1 = fresh().find((r) => (r.textContent || '').includes('纯文本'));
    if (!t1) throw new Error('重试后找不到纯文本那条');
    t1.querySelector('[data-act="br-quarantine"]').click();
    ok(await until(() => q('.modal [data-role="ok"]'), 5000), '隔离前弹出确认框');
    const m1 = q('.modal');
    ok(m1 && (m1.textContent || '').includes('隔离'), '确认框说明写的是隔离');
    q('.modal [data-role="ok"]').click();
    await sleep(1500);
    const qrow = q('#content .br-item.is-quarantined');
    ok(!!qrow, '隔离后行标记为已隔离');
    out.info.afterQuarantine = fresh().length;

    if (qrow) qrow.querySelector('[data-act="br-restore"]').click();
    ok(await until(() => q('.modal [data-role="ok"]'), 5000), '移回原处前弹出确认框');
    q('.modal [data-role="ok"]').click();
    await sleep(1800);
    ok(!q('#content .br-item.is-quarantined'), '移回原处后不再有已隔离行');
    ok(fresh().length === 3, '移回原处后仍是三条');
  } catch (e) {
    out.bad.push('探针异常：' + String((e && e.message) || e));
  } finally {
    try { await window.shelf.settingsUpdate({ ui: ui0 }); } catch (_) { /* 恢复失败不吞断言 */ }
  }
  out.info.errors = out.errors;
return out;
