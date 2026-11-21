'use strict';
/**
 * 拓竹云模块单测。不联网：登录/设备列表只测参数校验与状态机，
 * 网络层由真实登录时人工验证（不能拿测试账号去刷官方接口）。
 */
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
}

const { BambuCloud, parseJwt } = require('../src/core/bambucloud');

function fakeStore(conf) {
  const state = { bambuCloud: conf || null, printers: [] };
  return {
    getSettings: () => state,
    updateSettings: async (patch) => { Object.assign(state, patch); return state; },
  };
}

function testParseJwt() {
  console.log('\n[1] JWT 解析');
  // 手工构造：header.payload.signature 的 payload={"uid":"42","exp":1893456000}
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = b64({ alg: 'HS256' }) + '.' + b64({ uid: 42, exp: 1893456000 }) + '.sig';
  const jwt = parseJwt(token);
  ok('能解出 uid', jwt.uid === 42);
  ok('能解出 exp', jwt.exp === 1893456000);
  ok('坏 token 不炸', Object.keys(parseJwt('not-a-jwt')).length === 0);
  ok('空串不炸', Object.keys(parseJwt('')).length === 0);
}

function testStatus() {
  console.log('\n[2] 登录状态');
  const bc = new BambuCloud({ store: fakeStore(null) });
  let st = bc.status();
  ok('未登录时 loggedIn=false', st.loggedIn === false);

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = b64({ alg: 'HS256' }) + '.' + b64({ uid: 'u-9', exp: Math.floor(Date.now() / 1000) + 86400 }) + '.sig';
  bc.store = fakeStore({ token, account: 'me@example.com', uid: 'u-9', region: 'cn' });
  st = bc.status();
  ok('已登录', st.loggedIn === true && st.account === 'me@example.com');
  ok('未过期', st.expired === false);
  ok('token() 能取到', bc.token() === token);

  const expired = b64({ alg: 'HS256' }) + '.' + b64({ uid: 'u-9', exp: Math.floor(Date.now() / 1000) - 60 }) + '.sig';
  const bc2 = new BambuCloud({ store: fakeStore({ token: expired }) });
  ok('过期标记 expired=true', bc2.status().expired === true);
}

async function testValidation() {
  console.log('\n[3] 参数校验（不发真实请求）');
  const bc = new BambuCloud({ store: fakeStore(null) });
  let threw = '';
  try { await bc.login({}); } catch (e) { threw = e.message; }
  ok('空账号密码被拦截', /邮箱和密码/.test(threw), threw);

  threw = '';
  try { await bc.devices(); } catch (e) { threw = e.message; }
  ok('未登录拉设备给出提示', /未登录/.test(threw), threw);

  threw = '';
  try { await bc.loginWithCode({ account: 'a@b.c' }); } catch (e) { threw = e.message; }
  ok('验证码为空被拦截', /验证码/.test(threw), threw);
}

(async () => {
  try {
    testParseJwt();
    testStatus();
    await testValidation();
  } catch (e) {
    fail++;
    console.log('  ✗ 测试执行异常：' + e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exitCode = 1;
})();
