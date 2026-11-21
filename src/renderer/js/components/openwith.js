'use strict';
/**
 * 「用拓竹打开 / 用 Orca 打开（快造 U1 / 官方）」的选择与执行。
 *
 * 交互约定：
 *   - 设置里 openWith = 'ask'（默认）时，每次打开都先问一句，可选「记住」；
 *   - = 'bambu' / 'snapmaker' 时直接按默认走，不再打断；
 *   - 选快造要转换，转换跑在 worker 线程，这里只负责显示进度和等待。
 */
import { escapeHtml, icon } from '../utils.js';
import { toast } from './toast.js';
import { api } from '../api.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

// 一次只处理一个打开请求：双击卡片会同时触发 click 和 dblclick，
// 不拦住的话会弹两个选择器、发两次请求，失败时就变成两条一样的报错。
let opening = false;

// ------------------------------------------------------------------ 选择弹窗

/**
 * @returns {Promise<{choice:'bambu'|'snapmaker'|'orca-official', remember:boolean}|null>} 取消返回 null
 */
export function chooseOpenWith({ count = 1, current = 'ask', fileName = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root') || (() => {
      const r = document.createElement('div');
      r.id = 'modal-root';
      document.body.appendChild(r);
      return r;
    })();
    const back = document.createElement('div');
    back.className = 'ow-backdrop';
    back.innerHTML =
      '<div class="ow-modal" role="dialog" aria-modal="true" aria-labelledby="ow-title">' +
        '<div class="ow-head">' +
          '<div class="ow-title" id="ow-title">用哪个切片软件打开</div>' +
          '<button type="button" class="ow-close" data-pick="cancel" aria-label="关闭">' + icon('i-x') + '</button>' +
        '</div>' +
        '<div class="ow-sub">' +
          (count > 1 ? '共 ' + count + ' 个模型' : esc(fileName || '这个模型')) +
          '　·　快造会在同目录缓存一份转换副本，原文件不动' +
        '</div>' +
        '<div class="ow-options">' +
          '<button type="button" class="ow-opt" data-pick="bambu">' +
            '<span class="ow-ic has-app"><img class="ow-app" alt="" src="./assets/slicers/bambu-studio.png"></span>' +
            '<span class="ow-body"><span class="ow-name">用拓竹打开</span>' +
            '<span class="ow-desc">原文件直接打开，不做任何转换</span></span>' +
            '<span class="ow-key">默认</span>' +
          '</button>' +
          '<button type="button" class="ow-opt" data-pick="orca-official-direct">' +
            '<span class="ow-ic has-app"><img class="ow-app" alt="" src="./assets/slicers/orcaslicer.png"></span>' +
            '<span class="ow-body"><span class="ow-name">用官方 Orca 打开</span>' +
            '<span class="ow-desc">原文件直接打开，不做转换 —— Orca 会沿用文件里的机器配置</span></span>' +
          '</button>' +
          '<button type="button" class="ow-opt" data-pick="snapmaker">' +
            '<span class="ow-ic has-app"><img class="ow-app" alt="" src="./assets/slicers/snapmaker-orca.svg"></span>' +
            '<span class="ow-body"><span class="ow-name">用 Orca 打开（快造 U1）</span>' +
            '<span class="ow-desc">先转成 U1 工程，再用快造 Orca 打开 —— 自带完整 U1 预设</span></span>' +
            '<span class="ow-key">推荐</span>' +
          '</button>' +
          '<button type="button" class="ow-opt" data-pick="orca-official">' +
            '<span class="ow-ic has-app"><img class="ow-app" alt="" src="./assets/slicers/orcaslicer.png"></span>' +
            '<span class="ow-body"><span class="ow-name">转换后用官方 Orca 打开</span>' +
            '<span class="ow-desc">先用快造 U1 工具转换，再交给官方 Orca；缺 U1 预设会退回 200×200</span></span>' +
          '</button>' +
        '</div>' +
        '<label class="ow-remember"><input type="checkbox" id="ow-remember" checked>' +
          '<span>记住我的选择，以后不再询问</span></label>' +
        '<div class="ow-foot"><button type="button" class="btn btn-ghost" data-pick="cancel">取消</button></div>' +
      '</div>';
    root.appendChild(back);
    back.classList.add('ow-in');

    let done = false;
    const prevFocus = document.activeElement;
    const finish = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      back.classList.remove('ow-in');
      setTimeout(() => { try { back.remove(); } catch (_) {} }, 140);
      try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (_) {}
      resolve(val);
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); }
      if (e.key === 'Enter') {
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('ow-opt')) {
          e.preventDefault(); active.click();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);

    back.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (!pick) { if (e.target === back) finish(null); return; }
      const v = pick.dataset.pick;
      if (v === 'cancel') { finish(null); return; }
      const remember = !!(back.querySelector('#ow-remember') || {}).checked;
      finish({ choice: v, remember });
    });

    const first = back.querySelector('.ow-opt');
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) {} }
  });
}

// ------------------------------------------------------------------ 进度弹窗

function progressDialog({ title, stages }) {
  const root = document.getElementById('modal-root') || document.body;
  const back = document.createElement('div');
  back.className = 'ow-backdrop ow-in';
  back.innerHTML =
    '<div class="ow-modal ow-modal-progress" role="dialog" aria-modal="true">' +
      '<div class="ow-head"><div class="ow-title">' + esc(title) + '</div></div>' +
      '<div class="ow-sub" data-role="stage">准备中…</div>' +
      '<div class="ow-bar"><i data-role="fill"></i></div>' +
      '<div class="ow-steps" data-role="steps">' +
        stages.map((s, i) => '<span class="ow-step" data-i="' + i + '">' + esc(s.label) + '</span>').join('') +
      '</div>' +
      '<div class="ow-foot"><button type="button" class="btn btn-ghost" data-role="cancel">取消</button></div>' +
    '</div>';
  root.appendChild(back);

  const $stage = back.querySelector('[data-role="stage"]');
  const $fill = back.querySelector('[data-role="fill"]');
  const $steps = back.querySelector('[data-role="steps"]');
  let cancelled = false;

  back.querySelector('[data-role="cancel"]').addEventListener('click', () => {
    cancelled = true;
    $stage.textContent = '正在取消…';
    try { api.u1Cancel(); } catch (_) {}
  });

  const maxIdx = Math.max(1, stages.length - 1);
  return {
    update(stage, message) {
      if (message) $stage.textContent = message;
      const idx = stages.findIndex((s) => s.key === stage);
      if (idx >= 0) {
        $fill.style.width = Math.round((idx / maxIdx) * 100) + '%';
        Array.from($steps.children).forEach((el, i) => {
          el.classList.toggle('is-done', i < idx);
          el.classList.toggle('is-now', i === idx);
        });
      }
    },
    close() {
      back.classList.remove('ow-in');
      setTimeout(() => { try { back.remove(); } catch (_) {} }, 140);
    },
    get cancelled() { return cancelled; },
  };
}

// ------------------------------------------------------------------ 执行

function readOpenWith(settings) {
  const v = settings && settings.u1 && settings.u1.openWith;
  return v === 'bambu' || v === 'snapmaker' || v === 'orca-official' || v === 'orca-official-direct'
    ? v : 'ask';
}

function shortName(p) {
  const s = String(p || '');
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] || s;
}

/**
 * 打开一组模型（替代原先直接调 slicerOpen 的做法）。
 * @param {string[]} ids
 * @param {{which?: 'bambu'|'snapmaker'}} [opts] 指定走哪条路，跳过询问
 */
export async function openModelsWithChoice(ids, opts = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return;
  if (opening) return;
  opening = true;
  try {
    return await runOpen(list, opts);
  } finally {
    opening = false;
  }
}

async function runOpen(list, opts) {

  let settings = {};
  try { settings = await api.settings(); } catch (_) {}
  const saved = readOpenWith(settings);

  let which = opts.which;
  if (!which) {
    if (saved === 'ask') {
      const picked = await chooseOpenWith({
        count: list.length,
        current: saved,
        fileName: opts.name || '',
      });
      if (!picked) return;
      which = picked.choice;
      if (picked.remember) {
        try {
          await api.settingsUpdate({ u1: Object.assign({}, settings.u1 || {}, { openWith: picked.choice }) });
        } catch (_) { /* 记不住不影响本次打开 */ }
      }
    } else {
      which = saved;
    }
  }

  if (which === 'bambu' || which === 'orca-official-direct') {
    try {
      const r = await api.openWith(list, which);
      await Promise.all(list.map((id) => api.markOpened(id).catch(() => {})));
      const n = r.launched ? r.launched.length : list.length;
      if (r.failed && r.failed.length) {
        toast({ type: 'warn', message: n + ' 个已打开，' + r.failed.length + ' 个失败：' + (r.failed[0].error || '') });
      }
      return;
    } catch (e) {
      toast({ type: 'error', message: e.message || '打开失败' });
      return;
    }
  }

  // ---- 快造 / 官方 Orca：两条路都要先转成 U1 工程 ----
  const isOfficial = which === 'orca-official';
  const targetName = isOfficial ? '官方 Orca' : '快造 Orca';
  const dlg = progressDialog({
    title: list.length > 1 ? '正在转换为 U1 工程（' + list.length + ' 个）' : '正在转换为 U1 工程',
    stages: [
      { key: 'read', label: '读取模型' },
      { key: 'convert', label: '生成 U1 配置' },
      { key: 'patch', label: '应用预设' },
      { key: 'open', label: '交给 ' + targetName },
    ],
  });

  const onProg = (e) => {
    const d = e.detail || {};
    if (d.stage === 'cache') dlg.update('read', '已有转换副本，直接使用');
    else if (d.stage) dlg.update(d.stage, d.message || '');
  };
  window.addEventListener('u1:progress', onProg);

  try {
    const r = await api.openWith(list, which);
    dlg.update('open', '已交给 ' + (r.slicerName || targetName) + '，窗口可能要几秒才弹出来');
    await new Promise((res) => setTimeout(res, 500));
    dlg.close();

    const converted = r.converted || [];
    const nativeCount = converted.filter((c) => c.native).length;
    const cachedCount = converted.filter((c) => c.cached && !c.native).length;
    const parts = ['已用 ' + (r.slicerName || '快造') + ' 打开 ' + converted.length + ' 个'];
    if (nativeCount) parts.push(nativeCount + ' 个本来就是快造文件，直接打开');
    if (cachedCount) parts.push(cachedCount + ' 个用了缓存');
    const first = converted.find((c) => c.report);
    if (first && first.report.patch && first.report.patch.filamentPreset) {
      parts.push('耗材预设：' + first.report.patch.filamentPreset);
    }
    toast({
      type: 'success',
      message: parts.join(' · '),
      actionLabel: converted.length === 1 ? '查看缓存' : '',
      action: converted.length === 1 ? () => { api.u1OpenCache().catch(() => {}); } : null,
    });
    if (r.presetWarning) {
      toast({ type: 'warn', message: r.presetWarning, duration: 12000 });
    }
    if (r.failed && r.failed.length) {
      toast({ type: 'warn', message: r.failed.length + ' 个失败：' + (r.failed[0].error || '') });
    }
  } catch (e) {
    dlg.close();
    toast({ type: 'error', message: e.message || '转换失败' });
  } finally {
    window.removeEventListener('u1:progress', onProg);
  }
}

/** 单独转换（不动切片软件），给右键菜单 / 详情页用 */
export async function convertOnly(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return null;
  const dlg = progressDialog({
    title: list.length > 1 ? '正在转换为快造 U1 格式（' + list.length + ' 个）' : '正在转换为快造 U1 格式',
    stages: [
      { key: 'read', label: '读取模型' },
      { key: 'convert', label: '生成快造配置' },
      { key: 'patch', label: '应用预设' },
    ],
  });
  const onProg = (e) => {
    const d = e.detail || {};
    if (d.stage === 'cache') dlg.update('read', '已有转换副本，直接使用');
    else if (d.stage) dlg.update(d.stage, d.message || '');
  };
  window.addEventListener('u1:progress', onProg);
  const out = [];
  try {
    for (const id of list) {
      const r = await api.u1Convert(id, {});
      out.push(r);
    }
    dlg.close();
    toast({
      type: 'success',
      message: '已转换 ' + out.length + ' 个，缓存在本地',
      actionLabel: '打开缓存目录',
      action: () => { api.u1OpenCache().catch(() => {}); },
    });
    return out;
  } catch (e) {
    dlg.close();
    toast({ type: 'error', message: e.message || '转换失败' });
    return null;
  } finally {
    window.removeEventListener('u1:progress', onProg);
  }
}
