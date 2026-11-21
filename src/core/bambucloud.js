'use strict';
/**
 * 拓竹云：账号登录 / 设备列表 / 云端 MQTT 参数。
 *
 * 这是**非官方接口**（拓竹没开放文档），字段以 2026-11 实测为准，出错时把服务端原话带回去。
 * 安全约定：密码只在登录那一刻用于换 token，**绝不落盘**；本地只存 accessToken/refreshToken。
 *
 * 端点：
 *   api  https://api.bambulab.com
 *   mqtt cn/us/eu.mqtt.bambulab.com:8883（TLS，证书是正规 CA 签的，不需要关校验）
 * 订阅主题与局域网一致：device/<序列号>/report，连上后同样要发 pushall。
 */
const https = require('https');

const API_HOST = 'api.bambulab.com';
const MQTT_HOSTS = ['cn.mqtt.bambulab.com', 'us.mqtt.bambulab.com', 'eu.mqtt.bambulab.com'];

function request(method, path, { body, token, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = https.request({
      host: API_HOST,
      path,
      method,
      timeout,
      headers: Object.assign(
        { 'content-type': 'application/json', accept: 'application/json' },
        token ? { authorization: 'Bearer ' + token } : {},
        data ? { 'content-length': data.length } : {}
      ),
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let obj = null;
        try { obj = buf ? JSON.parse(buf) : null; } catch (_) { obj = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(obj || {});
          return;
        }
        const err = new Error((obj && (obj.message || obj.error)) || ('拓竹云返回 HTTP ' + res.statusCode));
        err.status = res.statusCode;
        err.payload = obj || null;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求拓竹云超时')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** 解 JWT 拿 uid / 过期时间（不校验签名，本地展示用） */
function parseJwt(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) || {};
  } catch (_) { return {}; }
}

class BambuCloud {
  constructor({ store } = {}) {
    if (!store) throw new Error('BambuCloud 初始化失败：缺少 store');
    this.store = store;
  }

  _conf() {
    const s = (this.store.getSettings && this.store.getSettings()) || {};
    return s.bambuCloud || null;
  }

  /** 给渲染层 / printers 用的登录状态 */
  status() {
    const c = this._conf();
    if (!c || !c.token) return { loggedIn: false };
    const jwt = parseJwt(c.token);
    const exp = jwt.exp ? jwt.exp * 1000 : (c.exp || 0);
    return {
      loggedIn: true,
      account: c.account || '',
      uid: String(c.uid || jwt.uid || ''),
      expiresAt: exp,
      expired: !!exp && Date.now() > exp,
      region: c.region || 'cn',
    };
  }

  token() {
    const c = this._conf();
    return c && c.token ? c.token : '';
  }

  mqttHost() { return MQTT_HOSTS[0]; }
  mqttHosts() { return MQTT_HOSTS.slice(); }

  /**
   * 密码登录。
   * 成功 → 落盘 token 并返回登录状态；
   * 需要邮箱验证码 → 返回 { needCode: true, tfaKey }（不报错，UI 据此进入第二步）。
   */
  async login({ account, password }) {
    if (!account || !password) throw new Error('请填写拓竹账号邮箱和密码');
    let r;
    try {
      r = await request('POST', '/v1/user-service/user/login', {
        body: { account: String(account).trim(), password, apiError: '' },
      });
    } catch (e) {
      const p = e.payload || {};
      if (p.tfaKey || p.loginType === 'verifyCode') return { needCode: true, tfaKey: p.tfaKey || '' };
      throw new Error('登录失败：' + (e.message || '未知原因'));
    }
    if (r && (r.tfaKey || r.loginType === 'verifyCode')) {
      return { needCode: true, tfaKey: r.tfaKey || '' };
    }
    return this._save(r, account);
  }

  /** 邮箱验证码登录（第二步）。字段名 code / tfaCode 都试一次，兼容接口版本差异。 */
  async loginWithCode({ account, tfaKey, code }) {
    if (!code) throw new Error('请填写邮箱验证码');
    let lastErr = null;
    for (const field of ['code', 'tfaCode']) {
      try {
        const r = await request('POST', '/v1/user-service/user/login', {
          body: { account: String(account || '').trim(), [field]: String(code).trim(), tfaKey },
        });
        return this._save(r, account);
      } catch (e) { lastErr = e; }
    }
    throw new Error('验证码校验失败：' + (lastErr && lastErr.message ? lastErr.message : '未知原因'));
  }

  _save(r, account) {
    if (!r || !r.accessToken) {
      throw new Error('登录响应里没有 token：' + JSON.stringify(r || {}).slice(0, 160));
    }
    const jwt = parseJwt(r.accessToken);
    const conf = {
      token: r.accessToken,
      refreshToken: r.refreshToken || '',
      account: String(account || '').trim(),
      uid: String(jwt.uid || jwt.user_id || ''),
      exp: jwt.exp ? jwt.exp * 1000 : 0,
      region: 'cn',
    };
    return this.store.updateSettings({ bambuCloud: conf }).then(() => this.status());
  }

  async logout() {
    await this.store.updateSettings({ bambuCloud: null });
    return { loggedIn: false };
  }

  /** 账号绑定的打印机（含序列号与访问码 —— 拿到它就不用手抄了） */
  async devices() {
    const t = this.token();
    if (!t) throw new Error('拓竹账号未登录');
    const r = await request('GET', '/v1/iot-service/api/user/bind', { token: t });
    const list = (r && r.devices) || [];
    return list
      .map((d) => ({
        serial: String((d && (d.dev_id || d.serial)) || ''),
        name: String((d && (d.name || d.dev_model_name)) || '拓竹打印机'),
        model: String((d && (d.dev_product_name || d.dev_model_name)) || ''),
        accessCode: String((d && d.dev_access_code) || ''),
        online: !!(d && d.online),
      }))
      .filter((d) => d.serial);
  }
}

module.exports = { BambuCloud, parseJwt, MQTT_HOSTS, request };
