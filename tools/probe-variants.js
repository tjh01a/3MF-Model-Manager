/**
 * 走查探针 C：同款变体（几何指纹）
 *
 *   node tools/probe-bca-prepare.js %TEMP%/ps-probe-bca
 *   set PRINTSHELF_DATA_DIR=%TEMP%/ps-probe-bca
 *   node launch.js --capture=%TEMP%/probe-variants.png --ui-script=tools/probe-variants.js
 *
 * 断言重点：指纹计算状态可见（不是无限转圈）、分组卡片出来、
 * 同一模型/疑似徽标、推荐保留理由、两个合并按钮；空数据时不崩。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const until = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) {
      try { if (fn()) return true; } catch (_) { /* 继续等 */ }
      await sleep(150);
    }
    return false;
  };

  const out = { ok: [], bad: [], info: {}, errors: [] };
  const ok = (cond, msg) => { (cond ? out.ok : out.bad).push(msg); };
  window.addEventListener('error', (e) => out.errors.push(String((e && e.message) || e)));
  window.addEventListener('unhandledrejection', (e) => out.errors.push('rejection: ' + String(e && e.reason)));

  const s0 = await window.shelf.settings();
  const ui0 = JSON.parse(JSON.stringify((s0 && s0.ui) || {}));

  try {
    await until(() => q('#sidebar') && (q('#content .card') || q('#content .empty')), 15000);

    const st = await window.shelf.shapeStatus();
    out.info.status = st;
    ok(st && typeof st.total === 'number' && st.total >= 4, '几何指纹已算出基础数据（total ' + (st && st.total) + '）');

    const nav = q('#sidebar [data-smart="variants"]');
    ok(!!nav, '侧栏有「同款变体」入口');
    nav.click();
    ok(await until(() => q('#content .dup-group') || q('#content .empty'), 12000), '变体视图渲染完成');

    const head = q('#content .special-head');
    ok(!!head && (head.textContent || '').includes('已计算'), '头部显示已计算状态');
    ok(!!head && (head.textContent || '').includes('同款变体'), '标题是「同款变体」');
    ok(!!q('#content [data-act="sp-shape-run"]'), '有「计算 / 更新」按钮');

    const groups = qa('#content .dup-group');
    out.info.groups = groups.length;
    ok(groups.length >= 1, '至少一组同款（实际 ' + groups.length + '）');
    const members = qa('#content .dup-item');
    out.info.members = members.length;
    ok(members.length >= 4, '四个同网格文件都归到组里（实际 ' + members.length + '）');
    const tagged = members.filter((m) => m.querySelector('.badge-ok') || m.querySelector('.badge.warn')).length;
    ok(tagged >= members.length - 1, '除主记录外每个成员都标了同一模型/疑似（' + tagged + '/' + members.length + '）');
    const g0 = groups[0];
    if (g0) {
      ok(!!g0.querySelector('.dup-reasons'), '组头显示推荐保留理由');
      ok((g0.querySelector('.dup-reasons') || {}).textContent.includes('最早'), '推荐理由包含「最早入库」');
      ok(g0.querySelectorAll('input[type="radio"]:checked').length === 1, '每组主记录唯一');
      ok(!!g0.querySelector('[data-act="sp-merge"]') && !!g0.querySelector('[data-act="sp-merge-trash"]'), '两个合并按钮都在');
    }

    // 空数据兜底不该崩：这里只校验切换回去正常
    q('#sidebar [data-smart="all"]').click();
    ok(await until(() => q('#content .card') || q('#content .empty'), 8000), '切回全部视图正常');
    // 留一张「同款变体」截图给人工核对
    q('#sidebar [data-smart="variants"]').click();
    await until(() => q('#content .dup-group') || q('#content .empty'), 8000);
  } catch (e) {
    out.bad.push('探针异常：' + String((e && e.message) || e));
  } finally {
    try { await window.shelf.settingsUpdate({ ui: ui0 }); } catch (_) { /* ignore */ }
  }
  out.info.errors = out.errors;
return out;
