const out = { ok: false };
try {
  for (let i = 0; i < 20 && typeof window.__printshelfOpenDevices !== 'function'; i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (typeof window.__printshelfOpenDevices !== 'function') throw new Error('设备中心入口未挂载');
  const later = document.querySelector('[data-ob="later"]');
  if (later) { later.click(); await new Promise((r) => setTimeout(r, 700)); }
  window.__printshelfOpenDevices();
  await new Promise((r) => setTimeout(r, 1200));
  const hub = document.getElementById('device-hub');
  out.open = !!(hub && !hub.hidden);
  out.diag = window.__printshelfDeviceHub();
  out.sidebarEntry = !!document.querySelector('[data-act="open-device-hub"]');
  out.hasScan = !!document.querySelector('[data-act="scan"]');
  out.hasManual = !!document.querySelector('[data-act="manual"]');
  out.emptyStage = !!document.querySelector('.dh-empty-stage');
  out.title = (document.getElementById('view-title') || {}).textContent;
  out.bodyText = hub ? hub.innerText.slice(0, 300) : '';
  out.ok = out.open && out.sidebarEntry && out.hasScan && out.hasManual && out.title === '设备';
} catch (e) {
  out.error = (e && e.stack) || String(e);
}
return out;
