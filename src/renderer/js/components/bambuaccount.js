'use strict';
/**
 * 拓竹账号：登录（邮箱+密码，可能要邮箱验证码）→ 同步绑定设备。
 *
 * 为什么不用通用 modal 组件：这里有两步式（密码 → 验证码）和设备清单，
 * 状态机自己管更清楚。安全约定：密码只在本弹窗里用于换 token，不写入任何存储。
 */
import { escapeHtml, icon } from '../utils.js';
import { api, emitToast, emitRefresh } from '../api.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const fmtExp = (ts) => {
  if (!ts) return '未知';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

let busy = false;

export function isBambuAccountOpen() {
  return !!document.getElementById('bambu-account-backdrop');
}

export function closeBambuAccount() {
  const el = document.getElementById('bambu-account-backdrop');
  if (el) el.remove();
}

export async function openBambuAccount() {
  if (isBambuAccountOpen()) return;
  if (busy) return;
  const root = document.getElementById('modal-root') || document.body;
  const back = document.createElement('div');
  back.id = 'bambu-account-backdrop';
  back.className = 'ow-backdrop';
  back.innerHTML = '<div class="ow-modal" id="bambu-account-modal"></div>';
  root.appendChild(back);
  back.classList.add('ow-in');
  // 点遮罩空白处关闭（点在弹窗本体上不算）
  back.addEventListener('click', (e) => { if (e.target === back) closeBambuAccount(); });

  let tfaKey = '';
  let lastStatus = null;

  const modal = () => back.querySelector('#bambu-account-modal');

  const render = (status, opts = {}) => {
    lastStatus = status;
    const loggedIn = status && status.loggedIn;
    modal().innerHTML =
      '<div class="ow-head">' +
        '<div class="ow-title">拓竹账号（云端通道）</div>' +
        '<button type="button" class="ow-close" data-ba="close" aria-label="关闭">' + icon('i-x') + '</button>' +
      '</div>' +
      '<div class="ow-sub">云端通道不需要打印机开「局域网模式」；密码只用于换登录凭证，不会保存在本机。</div>' +
      (opts.message ? '<div class="ba-message ' + (opts.kind || '') + '">' + esc(opts.message) + '</div>' : '') +
      (loggedIn
        ? renderLoggedIn(status)
        : renderLogin(opts)) +
      '<div class="ow-foot">' +
        (loggedIn
          ? '<button type="button" class="btn btn-ghost" data-ba="logout">退出登录</button>'
          : '') +
        '<button type="button" class="btn btn-ghost" data-ba="close">关闭</button>' +
      '</div>';

    modal().querySelector('[data-ba="close"]').addEventListener('click', closeBambuAccount);
    const logout = modal().querySelector('[data-ba="logout"]');
    if (logout) logout.addEventListener('click', onLogout);
    const login = modal().querySelector('[data-ba="login"]');
    if (login) login.addEventListener('click', onLogin);
    const code = modal().querySelector('[data-ba="code"]');
    if (code) code.addEventListener('click', onCode);
    const sync = modal().querySelector('[data-ba="sync"]');
    if (sync) sync.addEventListener('click', onSync);
    const email = modal().querySelector('#ba-email');
    if (email) email.focus();
  };

  function renderLoggedIn(status) {
    return '<div class="ba-status">' +
      '<div class="ba-row"><span>账号</span><strong>' + esc(status.account || '—') + '</strong></div>' +
      '<div class="ba-row"><span>凭证到期</span><strong>' + esc(fmtExp(status.expiresAt)) +
        (status.expired ? '（已过期）' : '') + '</strong></div>' +
      '<div class="ba-row"><span>云端通道</span><strong>' + (status.expired ? '不可用，请重新登录' : '可用') + '</strong></div>' +
      '</div>' +
      '<p class="ba-hint">「同步设备」会把拓竹账号里绑定的打印机合并到设备列表，并自动补上访问码。</p>' +
      '<div class="ba-actions"><button type="button" class="btn btn-primary" data-ba="sync">' +
      icon('i-refresh') + '同步设备</button></div>';
  }

  function renderLogin(opts) {
    const needCode = !!opts.needCode;
    return '<div class="ba-form">' +
      (needCode
        ? '<label class="ba-field"><span>邮箱验证码</span>' +
          '<input id="ba-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位数字"></label>'
        : '<label class="ba-field"><span>邮箱</span>' +
          '<input id="ba-email" type="email" autocomplete="username" placeholder="你在拓竹用的邮箱"></label>' +
          '<label class="ba-field"><span>密码</span>' +
          '<input id="ba-password" type="password" autocomplete="current-password" placeholder="拓竹账号密码"></label>') +
      '<div class="ba-actions"><button type="button" class="btn btn-primary" data-ba="' +
        (needCode ? 'code' : 'login') + '">' + icon('i-check') +
        (needCode ? '验证并登录' : '登录') + '</button></div>' +
      (needCode ? '<p class="ba-hint">验证码已发送到你的拓竹账号邮箱，如没收到请检查垃圾邮件。</p>' : '') +
      '</div>';
  }

  async function onLogin() {
    if (busy) return;
    const email = modal().querySelector('#ba-email');
    const pwd = modal().querySelector('#ba-password');
    if (!email || !email.value.trim() || !pwd || !pwd.value) {
      render(lastStatus, { message: '请填写邮箱和密码', kind: 'warn' });
      return;
    }
    busy = true;
    try {
      const r = await api.bambuCloudLogin({ account: email.value.trim(), password: pwd.value });
      pwd.value = '';
      if (r && r.needCode) {
        tfaKey = r.tfaKey || '';
        render({ loggedIn: false }, { needCode: true, message: '需要邮箱验证码，已发送到 ' + email.value.trim(), kind: 'info' });
        return;
      }
      await afterLogin(r);
    } catch (e) {
      render(lastStatus, { message: (e && e.message) || '登录失败', kind: 'error' });
    } finally { busy = false; }
  }

  async function onCode() {
    if (busy) return;
    const input = modal().querySelector('#ba-code');
    if (!input || !input.value.trim()) return;
    busy = true;
    try {
      const r = await api.bambuCloudLoginCode({ tfaKey, code: input.value.trim() });
      await afterLogin(r);
    } catch (e) {
      render({ loggedIn: false }, { needCode: true, message: (e && e.message) || '验证失败', kind: 'error' });
    } finally { busy = false; }
  }

  async function afterLogin(status) {
    let msg = '登录成功';
    try {
      const r = await api.bambuCloudSync();
      const n = (r && r.devices || []).length;
      if (n) msg += '，已同步 ' + n + ' 台拓竹设备';
    } catch (e) {
      msg += '，但同步设备失败：' + ((e && e.message) || '');
    }
    emitToast('success', msg);
    emitRefresh('printers');
    render(status);
  }

  async function onSync() {
    if (busy) return;
    busy = true;
    try {
      const r = await api.bambuCloudSync();
      emitToast('success', '已同步 ' + ((r && r.devices) || []).length + ' 台拓竹设备');
      emitRefresh('printers');
      render(lastStatus);
    } catch (e) {
      render(lastStatus, { message: (e && e.message) || '同步失败', kind: 'error' });
    } finally { busy = false; }
  }

  async function onLogout() {
    if (busy) return;
    busy = true;
    try {
      await api.bambuCloudLogout();
      emitToast('info', '已退出拓竹账号，云端通道停用');
      render(await api.bambuCloudStatus());
    } catch (e) {
      emitToast('error', (e && e.message) || '退出失败');
    } finally { busy = false; }
  }

  function onKey(e) {
    // Esc 由 app.js 的 handleEsc 统一处理（全局 Esc 优先级链里排在设备面板之前），
    // 这里只管「在输入框里按回车 = 提交」
    if (e.key === 'Enter') {
      const btn = modal().querySelector('[data-ba="login"], [data-ba="code"]');
      if (btn && document.activeElement && document.activeElement.tagName === 'INPUT') {
        e.preventDefault();
        btn.click();
      }
    }
  }
  document.addEventListener('keydown', onKey, true);
  const cleanup = () => document.removeEventListener('keydown', onKey, true);
  const obs = new MutationObserver(() => {
    if (!back.isConnected) { cleanup(); obs.disconnect(); }
  });
  obs.observe(root, { childList: true });

  let status = { loggedIn: false };
  try { status = await api.bambuCloudStatus(); } catch (_) { /* 未连接时也允许看弹窗 */ }
  render(status);
  return status;
}
