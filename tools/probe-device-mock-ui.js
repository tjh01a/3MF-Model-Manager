const out = { ok: false, added: [] };
try {
  for (let i = 0; i < 20 && !window.shelf; i++) await new Promise((r) => setTimeout(r, 250));
  if (!window.shelf) throw new Error('preload 未就绪');
  const later = document.querySelector('[data-ob="later"]');
  if (later) { later.click(); await new Promise((r) => setTimeout(r, 700)); }

  const existing = await window.shelf.printersList();
  if (!existing || !existing.length) {
    const items = [
      { kind: 'snapmaker', adapter: 'moonraker', name: '快造 U1 · 车间', ip: '127.0.0.2', port: 17125, model: 'Snapmaker U1' },
      { kind: 'creality', adapter: 'moonraker', name: '创想 K1 Max', ip: '127.0.0.3', port: 14408, model: 'Creality K1 Max' },
      { kind: 'anycubic', adapter: 'octoprint', name: '纵维 Kobra 2', ip: '127.0.0.4', port: 18071, model: 'Kobra 2' },
      { kind: 'flashforge', adapter: 'flashforge', name: '闪铸 5M', ip: '127.0.0.5', port: 18898, serial: 'SN-MOCK-01', accessCode: 'CHECK01', model: 'Adventurer 5M' },
      { kind: 'bambu', adapter: 'bambu', name: '拓竹 P1S（离线示例）', ip: '127.0.0.6', port: 8883, serial: '01S00C000000001', accessCode: '12345678', model: 'P1S', mode: 'lan' },
    ];
    for (const it of items) {
      try { const r = await window.shelf.printerAdd(it); out.added.push(r.name); }
      catch (e) { out.added.push('ERR:' + (e.message || e)); }
    }
  }

  await new Promise((r) => setTimeout(r, 5200));
  window.__printshelfOpenDevices();
  await new Promise((r) => setTimeout(r, 900));
  const target = [...document.querySelectorAll('#device-hub .dh-card')].find((c) => c.innerText.includes('快造'));
  if (target) { target.click(); await new Promise((r) => setTimeout(r, 1200)); }

  out.diag = window.__printshelfDeviceHub();
  out.cards = document.querySelectorAll('#device-hub .dh-card').length;
  out.beta = document.querySelectorAll('#device-hub .dh-beta').length;
  out.online = document.querySelectorAll('#device-hub .dh-dot.online, #device-hub .dh-dot.printing').length;
  out.title = (document.querySelector('#device-hub .dh-stage-title h2') || {}).innerText || '';
  out.progress = (document.querySelector('#device-hub #dh-pct') || {}).textContent || '';
  out.remain = (document.querySelector('#device-hub #dh-remain') || {}).textContent || '';
  out.buttons = [...document.querySelectorAll('#device-hub .dh-btn')].map((b) => b.textContent.trim()).filter(Boolean);
  out.camera = (document.querySelector('#device-hub #dh-camera') || {}).innerText || '';
  const list = await window.shelf.printersList();
  const snap = list.find((x) => x.name && x.name.includes('快造'));
  try {
    const r = await window.shelf.printerAction(snap.id, 'pause');
    out.action = r && r.ok !== false ? 'pause ok' : JSON.stringify(r);
  } catch (e) { out.action = 'ERR:' + (e.message || e); }
  try {
    const r = await window.shelf.printerSetTemp(snap.id, { nozzle: 215, bed: 62 });
    out.setTemp = r && r.ok !== false ? 'temp ok' : JSON.stringify(r);
  } catch (e) { out.setTemp = 'ERR:' + (e.message || e); }
  try {
    const r = await window.shelf.printerSendJob(snap.id, 'C:\\Users\\10104\\AppData\\Local\\Temp\\printshelf-send-test.gcode', { start: true });
    out.sendJob = r && r.ok !== false ? 'send ok' : JSON.stringify(r);
  } catch (e) { out.sendJob = 'ERR:' + (e.message || e); }
  out.ok = out.diag.open && out.cards >= 5 && out.beta >= 3 && out.online >= 2 && out.title.includes('快造') &&
    out.action === 'pause ok' && out.setTemp === 'temp ok' && out.sendJob === 'send ok';
} catch (e) {
  out.error = (e && e.stack) || String(e);
}
return out;
