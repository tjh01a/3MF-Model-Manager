'use strict';
import { t as tr } from '../i18n.js';

/**
 * 耗材库（docs/13）：卡片网格 + 右侧详情栏，与模型库 / 设备页视觉与操作一致。
 *
 * 数据全走 api.filaments*()；图片用 shelf://filaments/<hash> 显示。
 * 详情栏是可编辑表单，点「保存」才写库——输入过程中不重绘，避免掉焦点。
 */
import { api, emitToast, emitRefresh } from '../api.js';
import { escapeHtml, icon } from '../utils.js';
import { confirmDialog, promptDialog, customDialog } from '../components/modal.js';
import { openImageEditor } from '../components/img-editor.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#94a3b8';

let mounted = false;
let open = false;
let refreshSeq = 0;   // 用序号丢弃过期响应；不要用 loading 直接 return，否则打开面板时可能永远拿不到新数据
const st = {
  items: [],
  brands: [],
  types: [],
  selectedId: null,
  keyword: '',
  filterType: '',
  defaultId: null,
  tab: 'stock',          // stock = 真正拥有的耗材；catalog = 市面选购参考
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

function itemsOf(kind) {
  return st.items.filter((f) => (f.kind === 'owned' ? 'owned' : 'catalog') === kind);
}

function filtered() {
  const kw = st.keyword.trim().toLowerCase();
  const base = st.tab === 'stock' ? 'owned' : 'catalog';
  return itemsOf(base).filter((f) => {
    if (st.filterType && f.type !== st.filterType) return false;
    if (!kw) return true;
    return [f.name, f.brand, f.type, f.note, f.params].some((v) => String(v || '').toLowerCase().includes(kw));
  });
}

// ------------------------------------------------------------------ 渲染

function cardHtml(f) {
  const sel = f.id === st.selectedId ? ' is-selected' : '';
  const isDefault = f.id === st.defaultId;
  const fullG = Number(f.fullG) > 0 ? Number(f.fullG) : 1000;
  const lowG = Number(f.lowG) >= 0 ? Number(f.lowG) : Math.round(fullG * 0.1);
  const managed = f.stockG != null;
  const stockG = managed ? Number(f.stockG) : null;
  const pct = managed ? Math.max(0, Math.min(100, Math.round((stockG / fullG) * 100))) : 0;
  const low = managed && stockG <= lowG;
  const stockHtml = managed
    ? tr('<span class="fil-stock') + (low ? ' is-low' : '') + '">' +
        '<span class="fil-stock-bar"><span style="width:' + pct + '%"></span></span>' +
        '<span class="fil-stock-text">' + tr('约剩 ') + Math.round(stockG) + ' g' +
        (low ? tr(' · 偏低') : '') + (Number(f.spools) > 0 ? tr(' · 备用 ') + Number(f.spools) + tr(' 卷') : '') + '</span></span>'
    : '';
  return '<button type="button" class="fil-card' + sel + (isDefault ? ' is-default' : '') + '" data-id="' + esc(f.id) + '" title="' + esc(f.name) + '">' +
    '<span class="fil-card-media"><img class="fil-card-img" src="' + thumbSrc(f) + '" alt="">' +
      (isDefault ? tr('<span class="fil-default-tag">默认</span>') : '') + '</span>' +
    '<span class="fil-card-body">' +
      '<span class="fil-card-name">' + esc(f.name) + '</span>' +
      '<span class="fil-card-meta">' +
        '<i class="fil-dot" style="background:' + esc(safeColor(f.color)) + '"></i>' +
        '<span class="fil-card-type">' + esc(f.type || 'PLA') + '</span>' +
        '<span class="fil-card-price">' + yuan(f.pricePerKg) + '/kg</span>' +
      '</span>' + stockHtml +
    '</span>' +
  '</button>';
}

function detailHtml(f, kind) {
  const owned = kind === 'owned';
  if (!f) {
    return '<div class="fil-detail-empty">' + icon('i-box') +
      (owned
        ? tr('<strong>还没有选中耗材</strong><span>点左侧库存里的耗材查看和编辑</span>')
        : tr('<strong>还没有选中耗材</strong><span>点左侧卡片查看和编辑参数</span>')) + '</div>';
  }
  const typeOpts = st.types.map((t) =>
    '<option value="' + esc(t) + '"' + (f.type === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  const defaultBtn = owned
    ? '<button type="button" class="btn btn-sm btn-ghost' + (f.id === st.defaultId ? ' is-default' : '') + '" data-act="set-default" title="' +
        (f.id === st.defaultId ? tr('已设为默认耗材，模型没分配耗材时按它的单价估算') : tr('设为默认：模型没分配耗材时按它的单价估算成本')) + '">' +
        icon('i-star') + (f.id === st.defaultId ? tr('已是默认') : tr('设为默认')) + '</button>'
    : '';
  return '' +
    '<div class="fil-detail-head">' +
      '<div class="fil-detail-hero"><img src="' + thumbSrc(f) + '" alt=""></div>' +
      '<div class="fil-detail-actions">' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="save">' + icon('i-check') + tr('保存') + '</button>' +
        defaultBtn +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="upload">' + icon('i-image') + tr('换图片') + '</button>' +
        '<button type="button" class="icon-btn" data-act="delete" title="' + tr('删除耗材') + '">' + icon('i-trash') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="fil-detail-fields">' +
      '<label class="fil-field"><span>' + tr('名称') + '</span><input type="text" data-field="name" value="' + esc(f.name) + '" maxlength="120"></label>' +
      '<label class="fil-field"><span>' + tr('品牌') + '</span><input type="text" data-field="brand" value="' + esc(f.brand || '') + '" list="fil-brand-list" maxlength="80"></label>' +
      '<datalist id="fil-brand-list">' + st.brands.map((b) => '<option value="' + esc(b) + '"></option>').join('') + '</datalist>' +
      '<label class="fil-field"><span>' + tr('耗材类型') + '</span><select data-field="type">' + typeOpts + '</select></label>' +
      '<div class="fil-field-row">' +
        '<label class="fil-field"><span>' + tr('颜色') + '</span><span class="fil-color-wrap">' +
          '<input type="color" data-field="color" value="' + esc(safeColor(f.color)) + '">' +
          '<input type="text" data-field="colorText" value="' + esc(safeColor(f.color)) + '" maxlength="7" class="fil-hex"></span></label>' +
        '<label class="fil-field"><span>' + tr('单价（元 / kg）') + '</span><input type="number" data-field="pricePerKg" min="0" step="0.01" value="' + esc(f.pricePerKg || 0) + '"></label>' +
      '</div>' +
      (owned
        ? '<div class="fil-field-row">' +
            '<label class="fil-field"><span>' + tr('剩余克数') + '</span><input type="number" data-field="stockG" min="0" step="1" placeholder="' + tr('例如 620') + '" value="' +
              esc(f.stockG == null ? '' : f.stockG) + '"></label>' +
            '<label class="fil-field"><span>' + tr('整卷克数') + '</span><input type="number" data-field="fullG" min="1" step="1" value="' + esc(f.fullG || 1000) + '"></label>' +
          '</div>' +
          '<div class="fil-field-row">' +
            '<label class="fil-field"><span>' + tr('低库存阈值（克）') + '</span><input type="number" data-field="lowG" min="0" step="1" value="' + esc(f.lowG == null ? 100 : f.lowG) + '"></label>' +
            '<label class="fil-field"><span>' + tr('备用整卷') + '</span><input type="number" data-field="spools" min="0" step="1" value="' + esc(f.spools || 0) + '"></label>' +
          '</div>'
        : '') +
      '<label class="fil-field"><span>' + tr('购买链接') + '</span><input type="url" data-field="buyUrl" value="' + esc(f.buyUrl || '') + '" placeholder="https://…"></label>' +
      (owned
        ? '<div class="fil-stock-actions">' +
            '<button type="button" class="btn btn-sm btn-ghost" data-act="stock-log">' + icon('i-clock') + '<span>' + tr('库存流水') + '</span></button>' +
            '<button type="button" class="btn btn-sm btn-ghost" data-act="stock-shopping">' + icon('i-box') + '<span>' + tr('采购清单') + '</span></button>' +
          '</div>'
        : '') +
      '<label class="fil-field"><span>' + tr('备注') + '</span><textarea data-field="note" rows="3" maxlength="2000">' + esc(f.note || '') + '</textarea></label>' +
      '<label class="fil-field"><span>' + tr('耗材参数') + '</span><textarea data-field="params" rows="3" maxlength="2000" placeholder="' + tr('例如：打印温度 220°C / 热床 60°C / 收缩率 0.4% 等') + '">' + esc(f.params || '') + '</textarea></label>' +
    '</div>';
}

function tabsHtml() {
  const n = (k) => itemsOf(k === 'stock' ? 'owned' : 'catalog').length;
  const tab = (key, label) =>
    '<button type="button" class="fil-tab' + (st.tab === key ? ' is-active' : '') + '" data-tab="' + key + '" role="tab" aria-selected="' +
      (st.tab === key ? 'true' : 'false') + '">' + tr(label) + '<span class="fil-tab-count">' + n(key) + '</span></button>';
  return '<div class="fil-tabs" role="tablist">' + tab('stock', '耗材库存') + tab('catalog', '耗材库') + '</div>';
}

function stockRowHtml(f) {
  const fullG = Number(f.fullG) > 0 ? Number(f.fullG) : 1000;
  const stockG = f.stockG == null ? 0 : Number(f.stockG);
  const lowG = Number(f.lowG) >= 0 ? Number(f.lowG) : fullG * 0.1;
  const low = stockG <= lowG;
  const pct = Math.max(0, Math.min(100, Math.round((stockG / fullG) * 100)));
  const meta = [f.type, f.brand, yuan(f.pricePerKg) + '/kg'].filter(Boolean).join(' · ');
  return '<div class="inv-row' + (f.id === st.selectedId ? ' is-selected' : '') + '" data-id="' + esc(f.id) + '" role="button" tabindex="0">' +
    '<span class="inv-name-cell">' +
      '<i class="inv-swatch" style="background:' + esc(safeColor(f.color)) + '"></i>' +
      '<span class="inv-name-block"><b>' + esc(f.name) + '</b><small>' + esc(meta) + '</small></span>' +
    '</span>' +
    '<span class="inv-remain' + (low ? ' is-low' : '') + '">' +
      '<span class="inv-grams">' + Math.round(stockG) + ' g / ' + Math.round(fullG) + ' g' + (f.spools ? tr(' · 备用 ') + f.spools + tr(' 卷') : '') + '</span>' +
      '<span class="inv-bar"><span style="width:' + pct + '%"></span></span>' +
    '</span>' +
    '<span class="inv-ops">' +
      '<button type="button" class="icon-btn inv-act" data-act="inv-edit" data-id="' + esc(f.id) + '" title="' + tr('编辑这个耗材') + '">' + icon('i-edit') + '</button>' +
      '<button type="button" class="icon-btn inv-act" data-act="delete" data-id="' + esc(f.id) + '" title="' + tr('删除这个耗材') + '">' + icon('i-trash') + '</button>' +
    '</span>' +
  '</div>';
}

function invRowsHtml(list) {
  return list.length
    ? list.map(stockRowHtml).join('')
    : '<div class="fil-empty">' + tr('还没有在库耗材。点「添加耗材」，把手上真正有的耗材记进来。') + '</div>';
}

function render() {
  const body = document.getElementById('filaments-body');
  if (!body) return;
  const list = filtered();
  const wantedKind = st.tab === 'stock' ? 'owned' : 'catalog';
  let sel = st.items.find((f) => f.id === st.selectedId) || null;
  if (!sel || (sel.kind === 'owned' ? 'owned' : 'catalog') !== wantedKind) {
    st.selectedId = list.length ? list[0].id : null;
    sel = list.length ? list[0] : null;
  }
  const stockView = st.tab === 'stock';
  const left = stockView
    ? '<button type="button" class="btn btn-sm btn-primary" data-act="new-owned">' + icon('i-plus') + tr('添加耗材') + '</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-act="stock-log">' + icon('i-clock') + '<span>' + tr('库存流水') + '</span></button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-act="stock-shopping">' + icon('i-box') + '<span>' + tr('采购清单') + '</span></button>'
    : '<button type="button" class="btn btn-sm btn-primary" data-act="new">' + icon('i-plus') + tr('新建耗材</button>') +
      '<select class="fil-filter" data-act-filter="type" aria-label="' + tr('按类型筛选') + '">' +
        '<option value="">' + tr('全部类型') + '</option>' +
        st.types.map((t) => '<option value="' + esc(t) + '"' + (st.filterType === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
      '</select>';
  const main = stockView
    ? '<div class="inv-wrap">' +
        '<div class="inv-head"><span>' + tr('耗材') + '</span><span>' + tr('剩余') + '</span><span>' + tr('操作') + '</span></div>' +
        '<div class="inv-rows" id="inv-rows">' + invRowsHtml(list) + '</div>' +
        '<div class="fil-count" id="inv-count">' + tr('共 ') + list.length + ' ' + tr('种在库耗材') + '</div>' +
      '</div>'
    : '<div class="fil-grid-wrap">' +
        '<div class="fil-grid">' + (list.length ? list.map(cardHtml).join('') :
          tr('<div class="fil-empty">还没有耗材，点「新建耗材」添加一个</div>')) + '</div>' +
        tr('<div class="fil-count">共 ') + list.length + tr(' 种耗材</div>') +
      '</div>';
  body.innerHTML = '' +
    tabsHtml() +
    '<div class="fil-toolbar">' +
      '<div class="fil-toolbar-left">' + left + '</div>' +
      '<div class="fil-toolbar-right">' +
        '<input type="search" class="fil-search" data-act-input="keyword" placeholder="' + tr('搜索名称 / 品牌 / 类型') + '" value="' + esc(st.keyword) + '">' +
        '<button type="button" class="icon-btn" data-act="open-dir" title="' + tr('打开耗材图片目录') + '">' + icon('i-folder') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="fil-main">' +
      main +
      '<aside class="fil-detail" id="fil-detail">' + detailHtml(sel, wantedKind) + '</aside>' +
    '</div>';
}

async function refresh() {
  const seq = ++refreshSeq;
  try {
    const r = await api.filamentsList();
    if (seq !== refreshSeq) return;   // 更晚的刷新已经回来了，丢掉这份旧数据
    st.items = (r && r.items) || [];
    st.brands = (r && r.brands) || [];
    st.defaultId = (r && r.defaultId) || null;
    st.types = (r && r.types) || ['PLA', 'PETG', 'ABS', 'TPU', tr('其他')];
    if (st.selectedId && !st.items.find((f) => f.id === st.selectedId)) st.selectedId = null;
    if (!st.selectedId && st.items.length) st.selectedId = st.items[0].id;
    if (open) render();
  } catch (_) { /* api 层已 toast */ }
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
    stockG: get('stockG'),
    fullG: get('fullG'),
    lowG: get('lowG'),
    spools: get('spools'),
    buyUrl: get('buyUrl'),
    note: get('note'),
    params: get('params'),
  };
}

async function save() {
  if (!st.selectedId) return;
  const p = readForm();
  if (!p || !String(p.name || '').trim()) { emitToast('error', tr('名称不能为空')); return; }
  // 耗材库详情没有库存字段，readForm 会拿到 undefined；不能把它们当「清空库存」提交
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  const cur = st.items.find((x) => x.id === st.selectedId);
  if (cur && cur.kind === 'owned') {
    if (p.stockG === '' || p.stockG == null) p.stockG = 0;   // 在库耗材至少记 0g，不留成「不管理」
    if (!(Number(p.fullG) > 0)) { emitToast('error', tr('整卷克数要大于 0')); return; }
  }
  // 后端会把非法颜色静默归一化成默认值，用户以为保存成功、再看却变了色。
  // 保存前在这里拦住，必须严格是 #RRGGBB。
  const color = String(p.color || '').trim();
  if (!HEX.test(color)) {
    emitToast('error', tr('颜色格式不对，请填写 #RRGGBB（例如 #FF0000）'));
    return;
  }
  p.color = color;
  try {
    await api.filamentUpdate(st.selectedId, p);
    emitToast('success', tr('耗材已保存'));
    emitRefresh('filaments');
    await refresh();
  } catch (_) { /* 已 toast */ }
}

async function createWithName(name) {
  try {
    const f = await api.filamentCreate({ name, kind: 'catalog' });
    st.selectedId = f.id;
    emitToast('success', tr('已添加耗材「') + name + tr('」，记得填单价'));
    await refresh();
  } catch (_) { /* 已 toast */ }
}

/** 添加「真正拥有的耗材」：一次把类型、颜色、克数、单价填完，不用先建再改 */
async function addOwned() {
  const typeOpts = st.types.map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
  const body =
    '<div class="inv-form">' +
      '<label class="fil-field"><span>' + tr('名称') + '</span><input class="input" data-role="name" maxlength="120" placeholder="' +
        tr('例如：拓竹 PLA Basic 白色') + '"></label>' +
      '<div class="fil-field-row">' +
        '<label class="fil-field"><span>' + tr('品牌') + '</span><input class="input" data-role="brand" maxlength="80" list="fil-brand-list-modal" placeholder="' +
          tr('可留空') + '"></label>' +
        '<label class="fil-field"><span>' + tr('耗材类型') + '</span><select class="select" data-role="type">' + typeOpts + '</select></label>' +
      '</div>' +
      '<datalist id="fil-brand-list-modal">' + st.brands.map((b) => '<option value="' + esc(b) + '"></option>').join('') + '</datalist>' +
      '<div class="fil-field-row">' +
        '<label class="fil-field"><span>' + tr('颜色') + '</span><span class="fil-color-wrap">' +
          '<input type="color" data-role="color" value="' + DEFAULT_COLOR + '">' +
          '<input class="input fil-hex" data-role="colorText" maxlength="7" value="' + DEFAULT_COLOR + '"></span></label>' +
        '<label class="fil-field"><span>' + tr('单价（元 / kg）') + '</span><input class="input" type="number" data-role="price" min="0" step="0.01" value="0"></label>' +
      '</div>' +
      '<div class="fil-field-row">' +
        '<label class="fil-field"><span>' + tr('剩余克数') + '</span><input class="input" type="number" data-role="stockG" min="0" step="1" value="1000"></label>' +
        '<label class="fil-field"><span>' + tr('整卷克数') + '</span><input class="input" type="number" data-role="fullG" min="1" step="1" value="1000"></label>' +
      '</div>' +
      '<p class="hint">' + tr('这里记录的是你手上真正有的耗材；打印成功后会按这里的剩余克数自动扣减。') + '</p>' +
    '</div>';
  customDialog({
    title: tr('添加耗材'),
    body,
    onMount: (modal, close) => {
      const q = (sel) => modal.querySelector(sel);
      const color = q('[data-role="color"]');
      const colorText = q('[data-role="colorText"]');
      color.addEventListener('input', () => { colorText.value = color.value; });
      colorText.addEventListener('input', () => {
        if (HEX.test(colorText.value.trim())) color.value = colorText.value.trim();
      });
      const foot = modal.querySelector('.modal-foot') || modal;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = tr('添加');
      btn.addEventListener('click', async () => {
        const name = q('[data-role="name"]').value.trim();
        if (!name) { emitToast('error', tr('名称不能为空')); return; }
        const c = colorText.value.trim();
        if (!HEX.test(c)) { emitToast('error', tr('颜色格式不对，请填写 #RRGGBB')); return; }
        const fullG = Number(q('[data-role="fullG"]').value);
        const stockG = Number(q('[data-role="stockG"]').value);
        if (!(fullG > 0)) { emitToast('error', tr('整卷克数要大于 0')); return; }
        if (!(stockG >= 0)) { emitToast('error', tr('剩余克数不能为负数')); return; }
        btn.disabled = true;
        try {
          const f = await api.filamentCreate({
            kind: 'owned',
            name,
            brand: q('[data-role="brand"]').value.trim(),
            type: q('[data-role="type"]').value,
            color: c,
            pricePerKg: q('[data-role="price"]').value,
            stockG,
            fullG,
            lowG: Math.round(fullG * 0.1),
          });
          st.selectedId = f.id;
          st.tab = 'stock';
          emitToast('success', tr('已添加耗材「') + name + '」');
          close(null);
          emitRefresh('filaments');
          await refresh();
        } catch (_) {
          btn.disabled = false;   // api 层已 toast，允许改完重试
        }
      });
      foot.appendChild(btn);
    },
  });
}

async function setDefault(f) {
  if (!f) return;
  const cancel = f.id === st.defaultId;
  try {
    const r = await api.filamentSetDefault(cancel ? null : f.id);
    st.defaultId = r && r.defaultId;
    emitToast('success', cancel ? tr('已取消默认耗材') : tr('已设为默认：未分配耗材的模型按它的单价估算'));
    emitRefresh('filaments');   // 卡片价格要按新默认耗材重算
    await refresh();
  } catch (_) { /* 已 toast */ }
}

async function showStockLog() {
  let r;
  try { r = await api.stockLog(40); } catch (_) { return; }
  const items = (r && r.items) || [];
  if (!items.length) { emitToast('info', tr('还没有库存流水')); return; }
  const rows = items.map((x) => {
    const d = new Date(x.at || 0);
    const when = d.toLocaleString();
    const delta = (x.deltaG ? (x.deltaG > 0 ? '+' : '') + x.deltaG + ' g' : '') +
      (x.deltaSpools ? (x.deltaSpools > 0 ? ' +' : '') + x.deltaSpools + tr(' 卷') : '');
    const kind = x.kind === 'print' ? tr('打印扣减') : (x.kind === 'undo' ? tr('撤销') : tr('手动调整'));
    return '<div class="stock-log-row"><div class="stock-log-main">' +
      '<b>' + esc(x.filamentName || x.filamentId) + '</b> ' +
      '<span class="badge">' + esc(kind) + '</span>' +
      '<div class="muted">' + esc(when) + (x.modelName ? tr(' · ') + esc(x.modelName) : '') +
      (x.note ? tr(' · ') + esc(x.note) : '') + '</div></div>' +
      '<div class="stock-log-delta">' + esc(delta) + '</div>' +
      (x.kind === 'undo' ? '' :
        '<button type="button" class="btn btn-ghost btn-sm" data-stock-undo="' + esc(x.id) + '">' + tr('撤销') + '</button>') +
      '</div>';
  }).join('');
  customDialog({
    title: tr('库存流水'),
    body: '<div class="stock-log">' + rows + '</div>',
    onMount: (modal, close) => {
      modal.querySelectorAll('[data-stock-undo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api.stockUndo(btn.dataset.stockUndo);
            emitToast('success', tr('已撤销这笔库存变动'));
            close(null);
            emitRefresh('filaments');
            await refresh();
          } catch (_) { /* api 已提示 */ }
        });
      });
    },
  });
}

async function showShopping() {
  let list, csv;
  try {
    list = await api.stockShoppingList();
    csv = await api.stockShoppingCsv();
  } catch (_) { return; }
  const items = (list && list.items) || [];
  if (!items.length) { emitToast('info', tr('没有需要补货的耗材')); return; }
  const rows = items.map((x) =>
    '<div class="stock-log-row"><div class="stock-log-main"><b>' + esc(x.name) + '</b>' +
    '<div class="muted">' + esc(x.brand || '') + tr(' · 约剩 ') + Math.round(x.stockG) + ' g' +
    (x.spools ? tr(' · 备用 ') + x.spools + tr(' 卷') : '') + '</div></div>' +
    '<div class="stock-log-delta">' + tr('建议买 ') + x.suggestSpools + tr(' 卷') + '</div></div>').join('');
  customDialog({
    title: tr('采购清单'),
    body: '<div class="stock-log">' + rows + '</div><p class="hint">' + tr('建议量按整卷估算，实际按你的用量调整。') + '</p>',
    onMount: (modal, close) => {
      const foot = modal.querySelector('.modal-foot') || modal;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = tr('复制 CSV');
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText((csv && csv.csv) || '');
          emitToast('success', tr('采购清单已复制，可直接粘贴到表格'));
        } catch (_) { emitToast('error', tr('复制失败，请重试')); }
        close(null);
      });
      foot.appendChild(btn);
    },
  });
}

async function onClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;

  const tabBtn = t.closest('[data-tab]');
  if (tabBtn && tabBtn.closest('.fil-tabs')) {
    const next = tabBtn.dataset.tab === 'catalog' ? 'catalog' : 'stock';
    if (next !== st.tab) {
      st.tab = next;
      st.selectedId = null;
      st.keyword = '';
      st.filterType = '';
    }
    render();
    return;
  }

  const act = (t.closest('[data-act]') || {}).dataset;
  if (act) {
    switch (act.act) {
      case 'new-owned': await addOwned(); return;
      case 'new': {
        let name;
        try { name = await promptDialog({ title: tr('新建耗材'), label: tr('耗材名称'), placeholder: tr('例如：拓竹 PLA Basic 白色'), confirmText: tr('创建') }); }
        catch (_) { return; }
        if (name && name.trim()) await createWithName(name.trim());
        return;
      }
      case 'inv-edit': {
        if (act.id) { st.selectedId = act.id; render(); }
        return;
      }
      case 'set-default': {
        const f = st.items.find((x) => x.id === st.selectedId);
        await setDefault(f);
        return;
      }
      case 'save': await save(); return;
      case 'upload': {
        let p;
        try { p = await api.filamentPickImage(); } catch (_) { return; }
        if (!p) return;
        const f0 = st.items.find((x) => x.id === st.selectedId);
        // 先读原图 -> 裁切/缩放 -> 再落盘。原图不直接入库，
        // 手机拍的 4000px 大图会在卡片里当几百 KB 的装饰图，白占内存。
        let raw;
        try { raw = await api.filamentReadImage(p); } catch (_) { return; }
        let edited;
        try {
          edited = await openImageEditor({ dataUrl: raw.dataUrl, fileName: raw.name, name: f0 ? f0.name : '' });
        } catch (_) { return; }
        if (!edited) return;
        if (edited.error) { emitToast('error', edited.error); return; }
        try {
          const r = await api.filamentSetImageData(st.selectedId, edited.dataUrl);
          emitToast('success', tr('图片已更新（') + edited.width + ' × ' + edited.height + '）');
          const f = st.items.find((x) => x.id === st.selectedId);
          if (f) f.image = r.image;
          render();
        } catch (_) { /* 已 toast */ }
        return;
      }
      case 'delete': {
        const f = st.items.find((x) => x.id === (act.id || st.selectedId));
        if (!f) return;
        let yes = false;
        try {
          yes = await confirmDialog({
            title: tr('删除耗材'), message: tr('确定删除耗材「') + f.name + tr('」吗？'),
            detail: tr('已有模型引用的话，它们的成本会显示为「未分配耗材」；历史回执不受影响。'),
            items: [f.name], danger: true, confirmText: tr('删除'),
          });
        } catch (_) { return; }
        if (!yes) return;
        try {
          await api.filamentRemove(f.id);
          if (st.selectedId === f.id) st.selectedId = null;
          emitToast('success', tr('已删除'));
          await refresh();
        } catch (_) { /* 已 toast */ }
        return;
      }
      case 'stock-log': await showStockLog(); return;
      case 'stock-shopping': await showShopping(); return;
      case 'open-dir':
        try { await api.filamentsOpenDir(); } catch (_) { /* 已 toast */ }
        return;
      default: return;
    }
  }

  const row = t.closest('.inv-row');
  if (row && row.dataset.id) { st.selectedId = row.dataset.id; render(); return; }
  const card = t.closest('.fil-card');
  if (card) { st.selectedId = card.dataset.id; render(); return; }
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
    const invRows = document.querySelector('#inv-rows');
    if (invRows) {
      const list = filtered();
      invRows.innerHTML = invRowsHtml(list);
      const cnt = document.querySelector('#inv-count');
      if (cnt) cnt.textContent = tr('共 ') + list.length + ' ' + tr('种在库耗材');
      return;
    }
    const grid = document.querySelector('.fil-grid');
    if (grid) {
      const list = filtered();
      grid.innerHTML = list.length ? list.map(cardHtml).join('') :
        tr('<div class="fil-empty">没有匹配的耗材</div>');
      const cnt = document.querySelector('.fil-count');
      if (cnt) cnt.textContent = tr('共 ') + list.length + tr(' 种耗材');
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
  // 打印回执扣库存只发 stock:changed，浮层开着时也要跟着刷新
  window.addEventListener('stock:changed', () => { if (open) refresh(); });
  refresh().catch(() => {});
}

export function openFilaments() {
  const panel = document.getElementById('filaments-panel');
  if (!panel) return;
  panel.hidden = false;
  open = true;
  st.tab = 'stock';          // 「耗材管理」首先看自己真正拥有的库存
  st.selectedId = null;
  st.keyword = '';
  st.filterType = '';
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
