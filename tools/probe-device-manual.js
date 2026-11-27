const out = { ok: false };
try {
  for (let i = 0; i < 20 && typeof window.__printshelfOpenDevices !== 'function'; i++) await new Promise((r) => setTimeout(r, 250));
  const later = document.querySelector('[data-ob="later"]');
  if (later) { later.click(); await new Promise((r) => setTimeout(r, 700)); }
  window.__printshelfOpenDevices();
  await new Promise((r) => setTimeout(r, 900));
  document.querySelector('[data-act="manual"]').click();
  await new Promise((r) => setTimeout(r, 500));
  const sel = document.querySelector('#dh-m-brand');
  sel.value = 'flashforge';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  out.modal = !!document.querySelector('.dh-modal');
  out.betaNote = (document.querySelector('.dh-modal-note') || {}).innerText || '';
  out.hasSerial = !!document.querySelector('#dh-m-serial');
  out.hasCode = !!document.querySelector('#dh-m-code');
  out.codeLabel = ([...document.querySelectorAll('.dh-modal-body .dh-field label')].map((x) => x.textContent).join('|'));
  out.port = (document.querySelector('#dh-m-port') || {}).value || '';
  out.ok = out.modal && out.betaNote.includes('未经过实机验证') && out.hasSerial && out.hasCode && out.port === '8898';
} catch (e) { out.error = (e && e.stack) || String(e); }
return out;
