const out = { ok: false };
try {
  for (let i = 0; i < 20 && typeof window.__printshelfOpenDevices !== 'function'; i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  window.__printshelfOpenDevices();
  await new Promise((r) => setTimeout(r, 1500));
  const card = [...document.querySelectorAll('#device-hub .dh-card')].find((c) => c.innerText.includes('纵维'));
  if (!card) throw new Error('没有找到 Anycubic 设备卡片');
  card.click();
  await new Promise((r) => setTimeout(r, 1500));
  out.title = (document.querySelector('#device-hub .dh-stage-title h2') || {}).innerText || '';
  out.beta = document.querySelectorAll('#device-hub .dh-beta').length;
  out.stageBeta = !!document.querySelector('#device-hub .dh-stage-title .dh-beta');
  out.tip = (document.querySelector('#device-hub .dh-stage-title .dh-beta') || {}).title || '';
  out.cards = document.querySelectorAll('#device-hub .dh-card').length;
  out.ok = out.stageBeta && out.tip.includes('未经过实机验证') && out.cards >= 5;
} catch (e) {
  out.error = (e && e.stack) || String(e);
}
return out;
