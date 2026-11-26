/**
 * 走查探针 C：智能合并（重复文件 → 副本）+ 详情页副本小节
 *
 *   node tools/probe-bca-prepare.js %TEMP%/ps-probe-bca
 *   set PRINTSHELF_DATA_DIR=%TEMP%/ps-probe-bca
 *   node launch.js --capture=%TEMP%/probe-merge.png --ui-script=tools/probe-merge.js
 *
 * 断言重点：每组恰好一个主记录、推荐理由可见、两个合并按钮都在；
 * 「只标为副本」后该组从列表消失；主记录详情页出现「副本」小节；
 * 解除副本后小节消失、记录重新独立。
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
    const nav = q('#sidebar [data-smart="duplicates"]');
    ok(!!nav, '侧栏有「重复文件」入口');
    nav.click();
    await until(() => q('#content .dup-group') || q('#content .empty'), 12000);

    const groups = () => qa('#content .dup-group');
    out.info.groups = groups().length;
    ok(groups().length >= 1, '至少一组重复（实际 ' + groups().length + '）');
    const shead = q('#content .special-head');
    ok(!!shead && (shead.textContent || '').includes('共'), '头部有组数汇总');
    const g0 = groups()[0];
    if (!g0) throw new Error('没有重复组');
    const checked = g0.querySelectorAll('input[type="radio"]:checked');
    ok(checked.length === 1, '默认每组主记录唯一（实际 ' + checked.length + '）');
    ok(!!g0.querySelector('.dup-reasons') && (g0.querySelector('.dup-reasons').textContent || '').length > 2, '显示推荐保留理由');
    ok(!!g0.querySelector('.badge-ok'), '主记录有「保留」徽标');
    ok(!!g0.querySelector('[data-act="sp-merge"]') && !!g0.querySelector('[data-act="sp-merge-trash"]'), '两个合并按钮都在');
    const keepId = checked[0] ? checked[0].dataset.id : null;
    out.info.keepId = keepId;
    ok(!!keepId, '能拿到主记录 id');

    const n0 = groups().length;
    g0.querySelector('[data-act="sp-merge"]').click();
    ok(await until(() => q('.modal [data-role="ok"]'), 5000), '合并前弹出确认框');
    const m = q('.modal');
    ok(m && /副本/.test(m.textContent || ''), '确认框说明提到副本');
    q('.modal [data-role="ok"]').click();
    ok(await until(() => groups().length < n0, 8000), '只标副本后该组从列表消失');
    out.info.afterMerge = groups().length;
    ok(/已合并/.test(toastText()), '合并后有成功提示');

    // 进主记录详情，检查「副本」小节
    const all = q('#sidebar [data-smart="all"]');
    if (all) all.click();
    ok(await until(() => q('#content [data-id="' + keepId + '"]'), 10000), '主记录仍在正常列表里');
    q('#content [data-id="' + keepId + '"]').click();
    ok(await until(() => q('#detail') && !q('#detail').hidden, 8000), '详情抽屉打开');
    ok(await until(() => q('#detail-aliases') && !q('#detail-aliases').hidden && qa('#detail-aliases .detail-alias-row').length > 0, 8000),
      '详情页出现副本小节和副本行');
    const aliasRow = q('#detail-aliases .detail-alias-row');
    ok(aliasRow && (aliasRow.textContent || '').includes('仍在原处'), '副本行显示文件状态');
    ok(aliasRow && !!aliasRow.querySelector('[data-act="alias-detach"]'), '副本行有解除按钮');
    aliasRow.querySelector('[data-act="alias-detach"]').click();
    ok(await until(() => q('.modal [data-role="ok"]'), 5000), '解除副本前弹出确认框');
    q('.modal [data-role="ok"]').click();
    ok(await until(() => q('#detail-aliases') && q('#detail-aliases').hidden, 8000), '解除后副本小节隐藏');
    ok(/已解除副本关系/.test(toastText()), '解除后有成功提示');
  } catch (e) {
    out.bad.push('探针异常：' + String((e && e.message) || e));
  } finally {
    try { await window.shelf.settingsUpdate({ ui: ui0 }); } catch (_) { /* ignore */ }
  }
  out.info.errors = out.errors;
return out;
