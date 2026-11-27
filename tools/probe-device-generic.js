const out = { ok: false };
try {
  for (let i = 0; i < 20 && typeof window.__printshelfOpenDevices !== 'function'; i++) await new Promise((r) => setTimeout(r, 250));
  window.__printshelfOpenDevices();
  await new Promise((r) => setTimeout(r, 700));
  document.querySelector('[data-act="manual"]').click();
  await new Promise((r) => setTimeout(r, 400));

  const pickBrand = async (id) => {
    const sel = document.querySelector('#dh-m-brand');
    sel.value = id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return {
      port: (document.querySelector('#dh-m-port') || {}).value || '',
      hasSerial: !!document.querySelector('#dh-m-serial'),
      hasCode: !!document.querySelector('#dh-m-code'),
      beta: !!document.querySelector('.dh-modal-note'),
    };
  };

  out.octoprint = await pickBrand('octoprint');
  const proto = document.querySelector('#dh-m-protocol');
  out.octoProtocol = proto ? [...proto.options].map((o) => o.value) : [];

  out.creality = await pickBrand('creality');
  const cproto = document.querySelector('#dh-m-protocol');
  if (cproto) {
    cproto.value = 'moonraker-4408';
    cproto.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
  }
  out.crealityPort4408 = (document.querySelector('#dh-m-port') || {}).value || '';

  out.ok = out.octoprint.port === '80' && out.octoprint.hasCode && out.octoprint.beta &&
    out.crealityPort4408 === '4408';
} catch (e) { out.error = (e && e.stack) || String(e); }
return out;
