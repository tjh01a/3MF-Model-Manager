'use strict';
/**
 * 统计条右侧「常用模型网站」：内置两个固定站 + 用户自己添加的（创想云之类）。
 *
 * 站点存 `settings.ui.customSites = [{ name, url }]`。
 * 打开一律走 api.openExternal（主进程 shell.openExternal 还会再校验 ^https?://），
 * 绝不在 app:// 页面内导航——CSP 会拦，窗口会变空白。
 *
 * 点击打开复用 app.js 里 #stats-links 的委托（认 button[data-url]），
 * 这里只负责渲染按钮和「＋」的添加/管理弹窗。
 */
import { api, emitToast } from '../api.js';
import { escapeHtml, qs } from '../utils.js';
import { customDialog } from './modal.js';

const MAX_VISIBLE = 4;   // 工具栏只展示前几个，多了进「管理」列表
const MAX_ITEMS = 12;

let sites = [];
let mounted = false;

/** 归一化网址：没写协议就补 https；不合法返回空串 */
function normUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return '';
    if (!u.hostname || !u.hostname.includes('.')) return '';
    return u.toString();
  } catch (_) { return ''; }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { return ''; }
}

function labelOf(site) { return site.name || hostOf(site.url) || '网站'; }

function linkHtml(site, i) {
  return '<button type="button" class="btn btn-sm web-link stats-site" data-custom-site="' + i + '"' +
    ' data-url="' + escapeHtml(site.url) + '" title="' + escapeHtml(site.url) + '">' +
    '<svg class="ico"><use href="#i-globe"/></svg>' +
    '<span class="stats-site-name">' + escapeHtml(labelOf(site)) + '</span>' +
    '<svg class="ico web-link-ext"><use href="#i-external"/></svg></button>';
}

function render() {
  const root = qs('#stats-links');
  if (!root) return;
  for (const el of root.querySelectorAll('[data-custom-site]')) el.remove();
  const addBtn = root.querySelector('[data-site-manage]');
  if (!addBtn) return;
  const html = sites.slice(0, MAX_VISIBLE).map(linkHtml).join('');
  if (html) addBtn.insertAdjacentHTML('beforebegin', html);
}

async function persist() {
  try {
    await api.settingsUpdate({ ui: { customSites: sites.slice() } });
    return true;
  } catch (e) {
    emitToast('error', '保存网站失败：' + ((e && e.message) || '未知错误'));
    return false;
  }
}

function listHtml() {
  if (!sites.length) return '<p class="hint">还没有添加自定义网站。</p>';
  return '<div class="site-list">' + sites.map((s, i) =>
    '<div class="site-row">' +
      '<span class="site-row-name">' + escapeHtml(labelOf(s)) + '</span>' +
      '<span class="site-row-url" title="' + escapeHtml(s.url) + '">' + escapeHtml(hostOf(s.url)) + '</span>' +
      '<button type="button" class="btn btn-sm btn-ghost danger" data-del="' + i + '">删除</button>' +
    '</div>').join('') + '</div>';
}

function openManage() {
  const body = '' +
    '<div class="site-form">' +
      '<label class="field"><span class="field-label">网站名称</span>' +
        '<input type="text" class="input" data-role="name" maxlength="16" placeholder="例如：创想云" autocomplete="off"></label>' +
      '<label class="field"><span class="field-label">网址</span>' +
        '<input type="text" class="input" data-role="url" maxlength="500" placeholder="例如：https://www.crealitycloud.cn" autocomplete="off" spellcheck="false"></label>' +
    '</div>' +
    '<p class="hint">网址不写 https:// 会自动补上。最多添加 ' + MAX_ITEMS + ' 个，工具栏只显示前 ' + MAX_VISIBLE + ' 个。</p>' +
    '<div class="site-list-wrap" data-role="list">' + listHtml() + '</div>';

  customDialog({
    title: '常用模型网站',
    width: '520px',
    body,
    foot: '<button type="button" class="btn btn-ghost" data-role="cancel">关闭</button>' +
          '<button type="button" class="btn btn-primary" data-role="ok">添加</button>',
    onMount: (modal, close) => {
      const nameIn = modal.querySelector('[data-role="name"]');
      const urlIn = modal.querySelector('[data-role="url"]');
      const listWrap = modal.querySelector('[data-role="list"]');

      const refreshList = () => { listWrap.innerHTML = listHtml(); };

      modal.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));

      modal.querySelector('[data-role="ok"]').addEventListener('click', async () => {
        const url = normUrl(urlIn.value);
        if (!url) { emitToast('error', '网址不对，请填写完整地址（例如 https://www.crealitycloud.cn）'); urlIn.focus(); return; }
        if (sites.some((s) => s.url === url)) { emitToast('warn', '这个网站已经添加过了'); return; }
        if (sites.length >= MAX_ITEMS) { emitToast('warn', '最多添加 ' + MAX_ITEMS + ' 个网站，先删掉不用的'); return; }
        sites.push({ name: String(nameIn.value || '').trim().slice(0, 16), url });
        if (!(await persist())) { sites.pop(); return; }
        render();
        refreshList();
        nameIn.value = '';
        urlIn.value = '';
        nameIn.focus();
        emitToast('success', '已添加：' + labelOf(sites[sites.length - 1]));
      });

      // 列表内删除（在弹窗里改完立刻生效，不必关掉再进）
      listWrap.addEventListener('click', async (e) => {
        const btn = e.target.closest ? e.target.closest('[data-del]') : null;
        if (!btn) return;
        const idx = Number(btn.dataset.del);
        const backup = sites.slice();
        sites.splice(idx, 1);
        if (!(await persist())) { sites = backup; return; }
        render();
        refreshList();
        emitToast('success', '已删除');
      });

      setTimeout(() => { try { nameIn.focus(); } catch (_) {} }, 30);
    },
  });
}

/** 挂载：插一个「＋」按钮，读设置渲染已保存的站点 */
export async function mountSiteLinks() {
  const root = qs('#stats-links');
  if (!root || mounted) return;
  mounted = true;

  root.insertAdjacentHTML('beforeend',
    '<button type="button" class="btn btn-sm btn-ghost stats-site-add" data-site-manage' +
    ' title="添加 / 管理常用模型网站（例如创想云）">' +
    '<svg class="ico"><use href="#i-plus"/></svg></button>');

  root.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('[data-site-manage]') : null;
    if (!btn) return;
    e.preventDefault();
    openManage();
  });

  try {
    const s = await api.settings();
    const raw = (s && s.ui && Array.isArray(s.ui.customSites)) ? s.ui.customSites : [];
    sites = raw.map((x) => ({ name: String((x && x.name) || '').slice(0, 16), url: normUrl(x && x.url) }))
      .filter((x) => !!x.url).slice(0, MAX_ITEMS);
  } catch (_) { sites = []; }
  render();
}
