const out = { ok: false };
try {
  for (let i = 0; i < 20 && typeof window.__printshelfOpenDevices !== 'function'; i++) await new Promise((r) => setTimeout(r, 250));
  const later = document.querySelector('[data-ob="later"]');
  if (later) { later.click(); await new Promise((r) => setTimeout(r, 700)); }
  window.__printshelfOpenDevices();
  await new Promise((r) => setTimeout(r, 1000));
  const btn = document.querySelector('[data-act="scan"]');
  if (!btn) throw new Error('没有扫描按钮');
  btn.click();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const d = window.__printshelfDeviceHub();
    if (!d.scanning && (d.scanResults > 0 || i > 20)) break;
  }
  const d = window.__printshelfDeviceHub();
  out.diag = d;
  out.rows = document.querySelectorAll('#device-hub .dh-discover-row').length;
  out.rowText = [...document.querySelectorAll('#device-hub .dh-discover-row')].slice(0, 3).map((r) => r.innerText.replace(/\n/g, ' | '));
  out.note = (document.querySelector('#device-hub .dh-discover-head span') || {}).textContent || '';
  out.ok = d.scanResults > 0 || out.rows > 0;
} catch (e) { out.error = (e && e.stack) || String(e); }
return out;
