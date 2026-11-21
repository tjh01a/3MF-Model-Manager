/**
 * 走查探针：设备页四头温度 / U1 摄像头 / 检测弹窗关闭后画面消失（2026-11-19）。
 *   node launch.js --capture=data/reg/dev-cam.png --ui-script=tools/probe-devices-cam.js
 *
 * 依赖本机真机（快造 U1 @ 192.168.1.50）。摄像头没出流时也能过：
 * 断言的是「有图 + 陈旧角标」或「明确的失败文案」，不是「必须有实时画面」。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v; try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(150);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const out = {};

q('#btn-devices').click();
const panel = await waitFor(() => { const p = q('#devices-panel'); return p && !p.hidden ? p : null; }, 8000);
if (!panel) return { ok: false, error: '设备面板没打开' };

const cards = await waitFor(() => (qa('#devices-panel .dev-card').length ? qa('#devices-panel .dev-card') : null), 12000);
if (!cards) return { ok: false, error: '没有设备卡片' };

// 找快造那张卡
const snapCard = cards.find((c) => /快造|Snapmaker/i.test((c.querySelector('.dev-name') || {}).textContent || ''));
if (!snapCard) return { ok: false, error: '没有快造设备卡' };
const id = snapCard.dataset.id;

// ---- 1. 四头温度 ----
const heads = qa('#devices-panel .dev-card[data-id="' + id + '"] .dev-tool');
out.heads = {
  count: heads.length,
  texts: heads.map((h) => ((h.querySelector('.dev-tool-name') || {}).textContent || '') + ' ' +
    ((h.querySelector('.dev-tool-val') || {}).textContent || '')).slice(0, 6),
  activeCount: heads.filter((h) => h.classList.contains('is-active')).length,
};
out.checks = { headsOk: heads.length === 4 };

// ---- 2. 摄像头（U1 也应出现按钮） ----
const camBtn = q('#devices-panel .dev-card[data-id="' + id + '"] [data-act="dev-cam"]');
const detBtn = q('#devices-panel .dev-card[data-id="' + id + '"] [data-act="dev-detect"]');
out.buttons = { cam: !!camBtn, detect: !!detBtn };
out.checks.camButtonOk = !!camBtn && !!detBtn;

if (camBtn) {
  camBtn.click();
  // 点下去立刻要有等待反馈（拓竹首帧要几秒，不能有「按钮没反应」的空窗）
  out.loadingImmediately = !!q('.dev-card[data-id="' + id + '"] .dev-cam.is-loading');
  out.checks.loadingFeedbackOk = out.loadingImmediately;
  // 有图，或卡片上出现明确失败文案，都算「点得动、有反馈」
  const got = await waitFor(() => {
    const card = q('.dev-card[data-id="' + id + '"]');
    if (!card) return null;
    const img = card.querySelector('.dev-cam img');
    const err = card.querySelector('.dev-cam-empty');
    return (img && img.src.startsWith('data:image')) ? { img: true } :
      (err && /失败|没有|超时|连不上|HTTP/.test(err.textContent) ? { err: true } : null);
  }, 20000);
  out.cam = {
    got: !!got,
    kind: got && got.img ? 'image' : (got ? 'error' : 'none'),
    log: (window.__printshelfCam || []).slice(-5),
    badge: ((q('.dev-card[data-id="' + id + '"] .dev-cam-badge') || {}).textContent || '').trim(),
    src: ((q('.dev-card[data-id="' + id + '"] .dev-cam-src') || {}).textContent || '').trim(),
    btnText: (camBtn.textContent || '').trim(),
  };
  out.checks.camOk = !!(got && (got.img || got.err));
  // 理想情况：主动抓拍拿到实时画面。退而求其次：如实标成「静态快照 + 画面停在…」。
  out.checks.liveFrameOk = out.cam.kind !== 'image' || /实时抓拍/.test(out.cam.src);
  out.checks.staleLabelOk = out.cam.kind !== 'image' ||
    (/实时抓拍/.test(out.cam.src) && !/画面停在/.test(out.cam.badge)) ||
    (/画面停在/.test(out.cam.badge) && /静态快照/.test(out.cam.src));
}

// ---- 3. 打印机检测：关闭弹窗后画面必须消失 ----
// 设备页每 3 秒重绘卡片，之前抓到的按钮节点可能已经被替换；
// 点之前必须重新查一次，否则点的是脱离文档的旧节点，什么都不会发生。
if (detBtn) {
  const fresh = q('.dev-card[data-id="' + id + '"] [data-act="dev-detect"]');
  (fresh || detBtn).click();
  out.detectLoadingImmediately = !!q('.dev-card[data-id="' + id + '"] [data-act="dev-detect"].is-loading');
  out.checks.detectLoadingOk = out.detectLoadingImmediately;
  // 现在检测完成会自动弹窗，一次点击即可
  const modal = await waitFor(() => {
    const ms = qa('.modal');
    const m = ms.find((x) => /打印机检测/.test((x.textContent || '')));
    return m && m.querySelectorAll('.detect-grid img').length ? m : null;
  }, 30000);
  out.detect = { opened: !!modal, shots: modal ? modal.querySelectorAll('.detect-grid img').length : 0 };
  out.detect.staleWarn = modal ? /画面停在/.test(modal.textContent || '') : false;

  if (modal) {
    const closeBtn = modal.querySelector('[data-det-close]');
    if (closeBtn) closeBtn.click();
    await sleep(600);
    const card = q('.dev-card[data-id="' + id + '"]');
    const imgAfter = card ? card.querySelector('.dev-cam img') : null;
    out.afterClose = {
      modalGone: !qa('.modal').some((x) => /打印机检测/.test(x.textContent || '')),
      imgGone: !imgAfter,
      camBtnText: ((card && card.querySelector('[data-act="dev-cam"]')) || {}).textContent || '',
    };
    out.checks.detectOk = out.detect.shots >= 2;
    out.checks.closeClearsPreview = out.afterClose.imgGone === true;
  } else {
    // 弹窗没开就是失败，不能因为「没进 if」而漏判
    out.checks.detectOk = false;
    out.checks.closeClearsPreview = false;
  }
}

out.ok = Object.values(out.checks).every(Boolean);

// 收尾：关掉设备面板，别把用户留在浮层里
const close = q('#devices-close');
if (close) close.click();
return out;
