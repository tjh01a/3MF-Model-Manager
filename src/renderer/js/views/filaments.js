'use strict';
/**
 * 耗材库（docs/13）：卡片网格 + 右侧详情栏，与模型库 / 设备页视觉与操作一致。
 *
 * 数据全走 api.filaments*()；图片用 shelf://filaments/<hash> 显示。
 * 详情栏是可编辑表单，点「保存」才写库——输入过程中不重绘，避免掉焦点。
 */
import { api, emitToast, emitRefresh } from '../api.js';
import { escapeHtml, icon } from '../utils.js';
import { confirmDialog, promptDialog } from '../components/modal.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#94a3b8';

let mounted = false;
let open = false;
let loading = false;
const st = {
  items: [],
  brands: [],
  types: [],
  selectedId: null,
  keyword: '',
  filterType: '',
  defaultId: null,
};

// ------------------------------------------------------------------ 工具

function safeColor(c) {
  return HEX.test(String(c || '')) ? String(c) : DEFAULT_COLOR;
}

function imgUrl(f) {
  return f && f.image ? 'shelf://filaments/' + encodeURIComponent(f.image) : '';
}

/** 无图片时的占位 SVG：按耗材颜色生成一个线轴图形，与模型占位图同一调性。
 *  浅色耗材（白色 / 米色）会几乎看不见，所以先铺一层深色描边再叠真实颜色。 */
function placeholder(f) {
  const color = safeColor(f.color);
  const spool = '<ellipse cx="120" cy="62" rx="52" ry="17"/>' +
    '<path d="M68 62v54c0 9 23 17 52 17s52-8 52-17V62"/>' +
    '<ellipse cx="120" cy="116" rx="52" ry="17"/>';
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">',
    '<rect width="240" height="180" fill="#f1f5f9"/>',
    '<g stroke="#334155" stroke-opacity=".22" stroke-width="11" fill="none" stroke-linejoin="round">', spool, '</g>',
    '<g stroke="' + color + '" stroke-width="7" fill="none" stroke-linejoin="round">', spool, '</g>',
    '<ellipse cx="120" cy="89" rx="20" ry="7" fill="' + color + '" stroke="#334155" stroke-opacity=".18" stroke-width="2"/>',
    '</svg>',
  ].join('');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function thumbSrc(f) {
  return imgUrl(f) || placeholder(f);
}

function yuan(n) {
  const v = Number(n);
  return '¥' + (Number.isFinite(v) ? v.toFixed(2) : '0.00');
}

function filtered() {
  const kw = st.keyword.trim().toLowerCase();
  return st.items.filter((f) => {
    if (st.filterType && f.type !== st.filterType) return false;
    if (!kw) return true;
    return [f.name, f.brand, f.type, f.note].some((v) => String(v || '').toLowerCase().includes(kw));
  });
}

// ------------------------------------------------------------------ 渲染

function cardHtml(f) {
  const sel = f.id === st.selectedId ? ' is-selected' : '';
  const isDefault = f.id === st.defaultId;
  return '<button type="button" class="fil-card' + sel + (isDefault ? ' is-default' : '') + '" data-id="' + esc(f.id) + '" title="' + esc(f.name) + '">' +
    '<span class="fil-card-media"><img class="fil-card-img" src="' + thumbSrc(f) + '" alt="">' +
      (isDefault ? '<span class="fil-default-tag">默认</span>' : '') + '</span>' +
    '<span class="fil-card-body">' +
      '<span class="fil-card-name">' + esc(f.name) + '</span>' +
      '<span class="fil-card-meta">' +
        '<i class="fil-dot" style="background:' + esc(safeColor(f.color)) + '"></i>' +
        '<span class="fil-card-type">' + esc(f.type || 'PLA') + '</span>' +
        '<span class="fil-card-price">' + yuan(f.pricePerKg) + '/kg</span>' +
      '</span>' +
    '</span>' +
  '</button>';
}

function detailHtml(f) {
  if (!f) {
    return '<div class="fil-detail-empty">' + icon('i-box') +
      '<strong>还没有选中耗材</strong><span>点左侧卡片查看和编辑参数</span></div>';
  }
  const typeOpts = st.types.map((t) =>
    '<option value="' + esc(t) + '"' + (f.type === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  return '' +
    '<div class="fil-detail-head">' +
      '<div class="fil-detail-hero"><img src="' + thumbSrc(f) + '" alt=""></div>' +
      '<div class="fil-detail-actions">' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="save">' + icon('i-check') + '保存</button>' +
        '<button type="button" class="btn btn-sm btn-ghost' + (f.id === st.defaultId ? ' is-default' : '') + '" data-act="set-default" title="' +
          (f.id === st.defaultId ? '已设为默认耗材，模型没分配耗材时按它的单价估算' : '设为默认：模型没分配耗材时按它的单价估算成本') + '">' +
          icon('i-star') + (f.id === st.defaultId ? '已是默认' : '设为默认') + '</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="upload">' + icon('i-image') + '换图片</button>' +
        '<button type="button" class="icon-btn" data-act="delete" title="删除耗材">' + icon('i-trash') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="fil-detail-fields">' +
      '<label class="fil-field"><span>名称</span><input type="text" data-field="name" value="' + esc(f.name) + '" maxlength="120"></label>' +
      '<label class="fil-field"><span>品牌</span><input type="text" data-field="brand" value="' + esc(f.brand || '') + '" list="fil-brand-list" maxlength="80"></label>' +
      '<datalist id="fil-brand-list">' + st.brands.map((b) => '<option value="' + esc(b) + '"></option>').join('') + '</datalist>' +
      '<label class="fil-field"><span>耗材类型</span><select data-field="type">' + typeOpts + '</select></label>' +
      '<div class="fil-field-row">' +
        '<label class="fil-field"><span>颜色</span><span class="fil-color-wrap">' +
          '<input type="color" data-field="color" value="' + esc(safeColor(f.color)) + '">' +
          '<input type="text" data-field="colorText" value="' + esc(safeColor(f.color)) + '" maxlength="7" class="fil-hex"></span></label>' +
        '<label class="fil-field"><span>单价（元 / kg）</span><input type="number" data-field="pricePerKg" min="0" step="0.01" value="' + esc(f.pricePerKg || 0) + '"></label>' +
      '</div>' +
      '<label class="fil-field"><span>备注</span><textarea data-field="note" rows="3" maxlength="2000">' + esc(f.note || '') + '</textarea></label>' +
      '<div class="fil-hint">每克价 = 单价 ÷ 1000。改价后新回执用新价，历史回执不变。</div>' +
    '</div>';
}

function render() {
  const body = document.getElementById('filaments-body');
  if (!body) return;
  const list = filtered();
  const sel = st.items.find((f) => f.id === st.selectedId) || null;
  body.innerHTML = '' +
    '<div class="fil-toolbar">' +
      '<div class="fil-toolbar-left">' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="new">' + icon('i-plus') + '新建耗材</button>' +
        '<select class="fil-filter" data-act-filter="type" aria-label="按类型筛选">' +
          '<option value="">全部类型</option>' +
          st.types.map((t) => '<option value="' + esc(t) + '"' + (st.filterType === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
        '</select>' +
      '</div>' +
      '<div class="fil-toolbar-right">' +
        '<input type="search" class="fil-search" data-act-input="keyword" placeholder="搜索名称 / 品牌 / 类型" value="' + esc(st.keyword) + '">' +
        '<button type="button" class="icon-btn" data-act="open-dir" title="打开耗材图片目录">' + icon('i-folder') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="fil-main">' +
      '<div class="fil-grid-wrap">' +
        '<div class="fil-grid">' + (list.length ? list.map(cardHtml).join('') :
          '<div class="fil-empty">还没有耗材，点「新建耗材」添加一个</div>') + '</div>' +
        '<div class="fil-count">共 ' + list.length + ' 种耗材</div>' +
      '</div>' +
      '<aside class="fil-detail" id="fil-detail">' + detailHtml(sel) + '</aside>' +
    '</div>';
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const r = await api.filamentsList();
    st.items = (r && r.items) || [];
    st.brands = (r && r.brands) || [];
    st.defaultId = (r && r.defaultId) || null;
    st.types = (r && r.types) || ['PLA', 'PETG', 'ABS', 'TPU', '其他'];
    if (st.selectedId && !st.items.find((f) => f.id === st.selectedId)) st.selectedId = null;
    if (!st.selectedId && st.items.length) st.selectedId = st.items[0].id;
    if (open) render();
  } catch (_) { /* api 层已 toast */ }
  finally { loading = false; }
}

// ------------------------------------------------------------------ 交互

function readForm() {
  const root = document.getElementById('fil-detail');
  if (!root) return null;
  const get = (k) => { const el = root.querySelector('[data-field="' + k + '"]'); return el ? el.value : undefined; };
  return {
    name: get('name'),
    brand: get('brand'),
    type: get('type'),
    color: get('colorText') || get('color'),
    pricePerKg: get('pricePerKg'),
    note: get('note'),
  };
}

async function save() {
  if (!st.selectedId) return;
  const p = readForm();
  if (!p || !String(p.name || '').trim()) { emitToast('error', '名称不能为空'); return; }
  try {
    await api.filamentUpdate(st.selectedId, p);
    emitToast('success', '耗材已保存');
    emitRefresh('filaments');
    await refresh();
  } catch (_) { /* 已 toast */ }
}

async function createWithName(name) {
  try {
    const f = await api.filamentCreate({ name });
    st.selectedId = f.id;
    emitToast('success', '已添加耗材「' + name + '」，记得填单价');
    await refresh();
  } catch (_) { /* 已 toast */ }
}

async function setDefault(f) {
  if (!f) return;
  const cancel = f.id === st.defaultId;
  try {
    const r = await api.filamentSetDefault(cancel ? null : f.id);
    st.defaultId = r && r.defaultId;
    emitToast('success', cancel ? '已取消默认耗材' : '已设为默认：未分配耗材的模型按它的单价估算');
    emitRefresh('filaments');   // 卡片价格要按新默认耗材重算
    await refresh();
  } catch (_) { /* 已 toast */ }
}

async function onClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;

  const card = t.closest('.fil-card');
  if (card) { st.selectedId = card.dataset.id; render(); return; }

  // 筛选下拉框不能在 click 阶段处理：原生 select 的下拉刚弹出，
  // 这里一 render() 就把整个面板 innerHTML 换掉，下拉框瞬间消失。
  // 交给 change 事件（选中之后才触发），见 onChange。

  const act = (t.closest('[data-act]') || {}).dataset;
  if (!act) return;
  switch (act.act) {
    case 'new': {
      let name;
      try { name = await promptDialog({ title: '新建耗材', label: '耗材名称', placeholder: '例如：拓竹 PLA Basic 白色', confirmText: '创建' }); }
      catch (_) { return; }
      if (name && name.trim()) await createWithName(name.trim());
      break;
    }
    case 'set-default': {
      const f = st.items.find((x) => x.id === st.selectedId);
      await setDefault(f);
      break;
    }
    case 'save': await save(); break;
    case 'upload': {
      let p;
      try { p = await api.filamentPickImage(); } catch (_) { return; }
      if (!p) return;
      try {
        const r = await api.filamentSetImage(st.selectedId, p);
        emitToast('success', '图片已更新');
        const f = st.items.find((x) => x.id === st.selectedId);
        if (f) f.image = r.image;
        render();
      } catch (_) { /* 已 toast */ }
      break;
    }
    case 'delete': {
      const f = st.items.find((x) => x.id === st.selectedId);
      if (!f) return;
      let yes = false;
      try {
        yes = await confirmDialog({
          title: '删除耗材', message: '确定删除耗材「' + f.name + '」吗？',
          detail: '已有模型引用的话，它们的成本会显示为「未分配耗材」；历史回执不受影响。',
          items: [f.name], danger: true, confirmText: '删除',
        });
      } catch (_) { return; }
      if (!yes) return;
      try {
        await api.filamentRemove(f.id);
        st.selectedId = null;
        emitToast('success', '已删除');
        await refresh();
      } catch (_) { /* 已 toast */ }
      break;
    }
    case 'open-dir':
      try { await api.filamentsOpenDir(); } catch (_) { /* 已 toast */ }
      break;
    default: break;
  }
}

function onChange(e) {
  const t = e.target;
  if (t && t.matches && t.matches('[data-act-filter="type"]')) {
    st.filterType = t.value || '';
    render();
  }
}

function onInput(e) {
  const t = e.target;
  if (t && t.matches && t.matches('[data-act-input="keyword"]')) {
    st.keyword = t.value || '';
    const grid = document.querySelector('.fil-grid');
    if (grid) {
      const list = filtered();
      grid.innerHTML = list.length ? list.map(cardHtml).join('') :
        '<div class="fil-empty">没有匹配的耗材</div>';
      const cnt = document.querySelector('.fil-count');
      if (cnt) cnt.textContent = '共 ' + list.length + ' 种耗材';
    }
    return;
  }
  // 颜色输入框联动：color -> hex 文本 -> color
  if (t && t.matches && t.matches('[data-field="color"]')) {
    const hex = document.querySelector('[data-field="colorText"]');
    if (hex) hex.value = t.value;
  } else if (t && t.matches && t.matches('[data-field="colorText"]')) {
    const v = String(t.value || '').trim();
    if (HEX.test(v)) {
      const cp = document.querySelector('[data-field="color"]');
      if (cp) cp.value = v;
    }
  }
}

// ------------------------------------------------------------------ 生命周期

export function mountFilaments() {
  if (mounted) return;
  mounted = true;
  const panel = document.getElementById('filaments-panel');
  if (panel) {
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', onChange);
    panel.addEventListener('input', onInput);
  }
  const close = document.getElementById('filaments-close');
  if (close) close.addEventListener('click', () => closeFilaments());
  // 背景点一下关闭（与设备页一致）
  if (panel) panel.addEventListener('click', (e) => { if (e.target === panel) closeFilaments(); });
  window.addEventListener('filaments:changed', () => { if (open) refresh(); });
  refresh().catch(() => {});
}

export function openFilaments() {
  const panel = document.getElementById('filaments-panel');
  if (!panel) return;
  panel.hidden = false;
  open = true;
  render();
  refresh();
}

export function closeFilaments() {
  const panel = document.getElementById('filaments-panel');
  if (panel) panel.hidden = true;
  open = false;
}

export function isFilamentsOpen() {
  const panel = document.getElementById('filaments-panel');
  return !!panel && !panel.hidden;
}
