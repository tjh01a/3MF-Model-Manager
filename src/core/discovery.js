'use strict';
/**
 * 局域网打印机发现：mDNS + SSDP + HTTP 指纹 + 端口/子网扫描，合并去重。
 *
 * 设计原则：
 *   1) 先找“证据”（服务名、SSDP 头、HTTP 返回），再判品牌；端口开着不等于品牌。
 *   2) 所有策略并发跑，最后统一合并；单个策略失败不影响其他策略。
 *   3) 扫描默认控制在 ~10 秒；mDNS/SSDP 是快路径，子网端口扫描是兜底。
 */
const dgram = require('dgram');
const os = require('os');
const { execFileSync } = require('child_process');
const catalog = require('./device-catalog');
const { requestJson, probeTcp, tlsSerial } = require('./adapters/http');

const MDNS_TYPES = ['_moonraker._tcp.local', '_octoprint._tcp.local', '_printer._tcp.local', '_http._tcp.local', '_bambulab._tcp.local'];
const PROBE_PORTS = [7125, 80, 71, 8898, 18910, 8883, 990, 9999, 4408, 8899];

function txtToObj(txt) {
  const out = {};
  for (const item of txt || []) {
    const s = Buffer.isBuffer(item) ? item.toString('utf8') : String(item || '');
    const i = s.indexOf('=');
    if (i > 0) out[s.slice(0, i)] = s.slice(i + 1);
    else if (s) out[s] = true;
  }
  return out;
}

function parseServiceName(full) {
  const s = String(full || '').replace(/\.$/, '');
  const m = /^(.*?)\.(_[^.]+\._tcp)\.local$/i.exec(s);
  if (!m) return null;
  return { instance: m[1], service: m[2].toLowerCase() };
}

function newRecord(host, patch = {}) {
  const brand = catalog.brandOf(patch.kind);
  return {
    kind: patch.kind || 'unknown',
    brand: patch.kind || 'unknown',
    adapter: patch.adapter || (brand ? brand.adapter : ''),
    brandLabel: brand ? brand.label : '未知设备',
    beta: catalog.isBeta(patch.kind || 'unknown'),
    betaNote: catalog.isBeta(patch.kind || 'unknown') ? catalog.BETA_NOTE : '',
    name: patch.name || '打印机',
    model: patch.model || '',
    host,
    port: Number(patch.port) || (brand ? brand.defaultPort : 0),
    ports: patch.ports || (patch.port ? [Number(patch.port)] : []),
    protocol: patch.protocol || (brand ? brand.protocol : '未知协议'),
    sources: patch.sources || [],
    confidence: patch.confidence || 'medium',
    needs: patch.needs || (brand ? brand.needs : []),
    autoConnect: patch.autoConnect != null ? !!patch.autoConnect : !!(brand && brand.canAutoConnect && !(brand.needs || []).length),
    serial: patch.serial || '', accessCode: patch.accessCode || '',
    modelId: patch.modelId || '', firmware: patch.firmware || '',
    also: patch.also || [], extra: patch.extra || {},
  };
}

/** 同一 host 的多条记录合并；品牌专用优先，通用协议补充。 */
function mergeRecords(list = []) {
  const byHost = new Map();
  const rank = (r) => catalog.PRIORITY[r.kind] || 0;
  const score = (r) => (rank(r) * 10) + ({ low: 0, medium: 1, high: 2 }[r.confidence] || 0) +
    (r.port === 18910 || r.port === 8898 || r.port === 8883 ? 3 : 0);
  for (const raw of list) {
    if (!raw || !raw.host) continue;
    const host = raw.host;
    const cur = byHost.get(host);
    if (!cur) { byHost.set(host, { ...raw, sources: [...new Set(raw.sources || [])] }); continue; }
    const winner = score(raw) >= score(cur) ? raw : cur;
    const loser = winner === raw ? cur : raw;
    const out = {
      ...cur, ...winner,
      host,
      adapter: winner.adapter || loser.adapter,
      brand: winner.brand || loser.brand,
      brandLabel: winner.brandLabel || loser.brandLabel,
      sources: [...new Set([...(cur.sources || []), ...(raw.sources || [])])],
      ports: [...new Set([...(cur.ports || []), ...(raw.ports || [])])],
      also: [...new Set([...(cur.also || []), ...(raw.also || []), loser.kind].filter(Boolean))],
      name: winner.name || loser.name,
      model: winner.model || loser.model,
      serial: winner.serial || loser.serial,
      accessCode: winner.accessCode || loser.accessCode,
      confidence: higherConfidence(cur.confidence, raw.confidence),
      extra: { ...(loser.extra || {}), ...(winner.extra || {}) },
    };
    out.autoConnect = !!(catalog.brandOf(out.kind) && catalog.brandOf(out.kind).canAutoConnect && !(out.needs || []).length);
    out.beta = catalog.isBeta(out.kind);
    out.betaNote = out.beta ? catalog.BETA_NOTE : '';
    byHost.set(host, out);
  }
  const merged = Array.from(byHost.values());
  // 单条记录不会走合并分支，BETA / autoConnect 也要补齐，避免调用方拿到 undefined。
  for (const r of merged) {
    const brand = catalog.brandOf(r.kind);
    // 品牌要求优先于合并时留下的空 needs：避免“未知 HTTP + Bambu SSDP”合并后漏掉访问码。
    const brandNeeds = (brand && brand.needs) || [];
    r.needs = (Array.isArray(r.needs) && r.needs.length) ? r.needs : brandNeeds;
    r.autoConnect = !!(brand && brand.canAutoConnect && !r.needs.length);
    r.beta = catalog.isBeta(r.kind);
    r.betaNote = r.beta ? catalog.BETA_NOTE : '';
    r.brandLabel = r.brandLabel || (brand ? brand.label : '未知设备');
    r.adapter = r.adapter || (brand ? brand.adapter : '');
  }
  return merged.sort((a, b) => {
    const p = (catalog.PRIORITY[b.kind] || 0) - (catalog.PRIORITY[a.kind] || 0);
    if (p) return p;
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
  });
}

function higherConfidence(a, b) {
  const w = { low: 0, medium: 1, high: 2 };
  return (w[b] || 0) > (w[a] || 0) ? b : a;
}

/** 从 mDNS 记录里还原服务实例（含 PTR→SRV→A/TXT）。 */
function decodeMdns(records = []) {
  const byName = new Map();
  const put = (name, type, data, ttl) => {
    const key = String(name || '').replace(/\.$/, '').toLowerCase();
    if (!byName.has(key)) byName.set(key, {});
    byName.get(key)[type] = data;
    byName.get(key).ttl = ttl;
  };
  for (const r of records) {
    if (!r || !r.name || !r.type) continue;
    put(r.name, r.type, r.data, r.ttl);
  }
  const out = [];
  for (const [name, rec] of byName) {
    if (!rec.PTR) continue;
    const svc = parseServiceName(rec.PTR);
    if (!svc) continue;
    const full = String(rec.PTR).replace(/\.$/, '').toLowerCase();
    const srv = byName.get(full) || {};
    const target = String((srv.SRV && srv.SRV.target) || '').replace(/\.$/, '').toLowerCase();
    const addr = (byName.get(target) || {}).A;
    const txt = txtToObj(srv.TXT);
    const host = addr || (/^\d+\.\d+\.\d+\.\d+$/.test(target) ? target : '');
    if (!host) continue;
    out.push({
      host, port: Number(srv.SRV && srv.SRV.port) || 7125,
      instance: svc.instance, service: svc.service, txt, target,
    });
  }
  return out;
}

function mdnsDiscover(timeoutMs = 3500) {
  return new Promise((resolve) => {
    let browser;
    try { browser = require('multicast-dns')(); } catch (_) { resolve([]); return; }
    const records = [];
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      try { browser.destroy(); } catch (_) { /* 忽略 */ }
      resolve(decodeMdns(records));
    };
    browser.on('response', (packet) => {
      for (const sec of ['answers', 'additionals']) {
        for (const r of packet[sec] || []) records.push(r);
      }
    });
    browser.on('error', done);
    const query = () => {
      for (const type of MDNS_TYPES) {
        try { browser.query({ questions: [{ name: type, type: 'PTR' }] }); } catch (_) { /* 忽略 */ }
      }
    };
    query();
    setTimeout(query, 900);
    setTimeout(done, timeoutMs);
  });
}

function parseSsdp(text) {
  const lines = String(text || '').split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function ssdpDiscover(timeoutMs = 3200) {
  return new Promise((resolve) => {
    const out = [];
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (_) { resolve([]); return; }
    const seen = new Set();
    const done = () => {
      try { sock.close(); } catch (_) { /* 忽略 */ }
      resolve(out);
    };
    sock.on('message', (msg, rinfo) => {
      const h = parseSsdp(msg.toString('utf8'));
      const st = (h.st || '').toLowerCase();
      const usn = (h.usn || '').toLowerCase();
      const server = (h.server || '').toLowerCase();
      const loc = h.location || '';
      const devModel = h.devmodel || '';
      const devName = h.devname || '';
      if (!/bambu|flashforge|creality|anycubic|snapmaker|moonraker|octoprint|printer/.test(st + usn + server + devModel + devName + loc)) {
        return;
      }
      let host = rinfo.address;
      try { if (loc) host = new URL(loc).hostname || host; } catch (_) { /* 用来源 IP */ }
      const key = host + '|' + (devModel || st);
      if (seen.has(key)) return;
      seen.add(key);
      let kind = catalog.inferBrand(usn + ' ' + server + ' ' + devName + ' ' + devModel);
      if (/bambulab-com:device:3dprinter/.test(st + usn)) kind = 'bambu';
      if (!kind) kind = 'unknown';
      out.push(newRecord(host, {
        kind, name: devName || (kind === 'bambu' ? 'Bambu Lab' : host),
        model: devModel, port: kind === 'bambu' ? 8883 : 0,
        protocol: kind === 'bambu' ? 'Bambu LAN · MQTT/FTPS' : 'SSDP',
        sources: ['ssdp'], confidence: kind === 'unknown' ? 'low' : 'medium',
        extra: { ssdp: h },
      }));
    });
    sock.on('error', done);
    sock.bind(0, () => {
      const targets = [
        { port: 2021, st: 'urn:bambulab-com:device:3dprinter:1', mx: 2 },
        { port: 1990, st: 'urn:bambulab-com:device:3dprinter:1', mx: 2 },
        { port: 1900, st: 'ssdp:all', mx: 2 },
      ];
      for (const t of targets) {
        const msg = 'M-SEARCH * HTTP/1.1\r\n' +
          `HOST: 239.255.255.250:${t.port}\r\n` +
          'MAN: "ssdp:discover"\r\n' + `MX: ${t.mx}\r\n` + `ST: ${t.st}\r\n\r\n`;
        try { sock.send(msg, 0, msg.length, t.port, '239.255.255.250'); } catch (_) { /* 忽略 */ }
      }
    });
    setTimeout(done, timeoutMs);
  });
}

function localSubnets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = String(a.address || '');
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
      const base = ip.split('.').slice(0, 3).join('.');
      if (!out.includes(base)) out.push(base);
    }
  }
  return out.slice(0, 4);
}

function arpHosts() {
  try {
    const text = execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    const out = [];
    for (const m of text.matchAll(/(\d+\.\d+\.\d+\.\d+)/g)) {
      if (!/\.255$|\.0$/.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  } catch (_) { return []; }
}

async function identifyHost(host, ports, hints = {}) {
  const out = [];
  const has = (p) => ports.includes(p);
  const hintText = `${hints.name || ''} ${hints.model || ''} ${hints.brand || ''} ${hints.txt || ''}`;

  if (has(18910)) {
    const r = await requestJson({ host, port: 18910, path: '/info', timeout: 1800 }).catch(() => null);
    if (r && r.json && (r.json.modelId || r.json.ctrlType)) {
      const j = r.json;
      const modelId = String(j.modelId || '');
      const modelName = String(j.modelName || '');
      out.push(newRecord(host, {
        kind: 'anycubic', name: modelName || 'Anycubic', model: modelName || modelId,
        port: 18910, ports: [18910, 9883], modelId,
        protocol: 'Anycubic LAN · HTTP/MQTT', sources: ['port'], confidence: 'high',
        serial: String(j.cn || ''), extra: { ctrlType: j.ctrlType, token: !!j.token },
      }));
    }
  }

  for (const port of [7125, 4408, 4409]) {
    if (!has(port)) continue;
    const r = await requestJson({ host, port, path: '/server/info', timeout: 1800 }).catch(() => null);
    if (!r || !r.json || !(r.json.result || r.json)) continue;
    const result = r.json.result || r.json;
    const hostname = String(result.hostname || '');
    let kind = catalog.inferBrand(hintText + ' ' + hostname);
    if (!kind) kind = 'moonraker';
    out.push(newRecord(host, {
      kind, name: hostname || (kind === 'snapmaker' ? 'Snapmaker U1' : 'Klipper 打印机'),
      model: hostname, port, ports: [port], firmware: String(result.software_version || ''),
      protocol: 'Klipper · Moonraker', sources: ['port'], confidence: 'high',
    }));
  }

  for (const port of [71, 80]) {
    if (!has(port)) continue;
    const r = await requestJson({ host, port, path: '/api/version', timeout: 1500 }).catch(() => null);
    if (!r || !r.json || r.status >= 400) continue;
    let kind = catalog.inferBrand(hintText);
    let adapter = 'octoprint';
    if (!kind && port === 71) kind = 'anycubic';
    if (!kind) kind = 'octoprint';
    out.push(newRecord(host, {
      kind, adapter, name: hints.name || (kind === 'anycubic' ? 'Anycubic Kobra（Octo 兼容）' : 'OctoPrint'),
      model: '', port, ports: [port], firmware: String((r.json.text || r.json.server || '')),
      protocol: 'OctoPrint REST', sources: ['port'], confidence: 'high',
    }));
  }

  if (has(80)) {
    const r = await requestJson({ host, port: 80, path: '/info', timeout: 900 }).catch(() => null);
    if (r && r.json && (r.json.modelId || r.json.ctrlType)) {
      out.push(newRecord(host, {
        kind: 'anycubic', name: String(r.json.modelName || 'Anycubic'), model: String(r.json.modelName || ''),
        port: 80, ports: [80, 18910], protocol: 'Anycubic HTTP', sources: ['port'], confidence: 'medium',
      }));
    }
  }

  if (has(8898)) {
    const r = await requestJson({ host, port: 8898, path: '/', timeout: 1200 }).catch(() => null);
    const ffHint = catalog.inferBrand(hintText) === 'flashforge';
    const server = String((r && r.headers && r.headers.server) || '');
    const looksFF = ffHint || /flashforge|adventurer|creator|guider|finder/i.test(`${server} ${r ? r.body : ''}`);
    if (r && r.status && looksFF) {
      out.push(newRecord(host, {
        kind: 'flashforge', name: hints.name || 'FlashForge', model: hints.model || '',
        port: 8898, ports: [8898], protocol: 'FlashForge HTTP',
        sources: ['port'], confidence: ffHint ? 'high' : 'medium',
      }));
    }
  }
  if (has(8899)) {
    // 8899 不是闪铸独占端口；没有 mDNS/SSDP/型号证据时只把它列为“未知开放端口”，
    // 避免把路由器/其他服务误标成 FlashForge。现代 8898 仍走 HTTP 指纹识别。
    if (catalog.inferBrand(hintText) === 'flashforge') {
      out.push(newRecord(host, {
        kind: 'flashforge', name: hints.name || 'FlashForge（旧 TCP）', port: 8899,
        ports: [8899], protocol: 'FlashForge TCP（仅识别）', sources: ['port'],
        confidence: 'medium', extra: { legacyTcp: true },
      }));
    }
  }

  if (has(9999) || (has(80) && catalog.inferBrand(hintText) === 'creality')) {
    const kindHint = catalog.inferBrand(hintText);
    // 9999 是常见管理端口，只有名称/hostname 已指向创想时才认作品牌设备。
    if (kindHint === 'creality') {
      out.push(newRecord(host, {
        kind: 'creality', name: hints.name || 'Creality', port: 80, ports: [80, 9999].filter(has),
        protocol: has(7125) ? 'Klipper · Moonraker' : 'CrealityPrint 私有协议（仅识别）',
        sources: ['port'], confidence: has(7125) ? 'medium' : 'low',
        extra: { privateProtocol: !has(7125) },
      }));
    }
  }

  if (has(8883)) {
    const serial = await tlsSerial(host);
    if (serial || has(990) || catalog.inferBrand(hintText) === 'bambu') {
      out.push(newRecord(host, {
        kind: 'bambu', name: hints.name || (serial ? ('拓竹 ' + serial.slice(-3)) : '拓竹（需访问码）'),
        model: hints.model || 'Bambu Lab', port: 8883, ports: [8883, 990].filter((p) => has(p) || p === 8883),
        protocol: 'Bambu LAN · MQTT/FTPS', sources: ['port'],
        confidence: serial ? 'high' : 'medium', serial,
      }));
    }
  }
  return out;
}

async function portScan(timeoutMs = 350, concurrency = 64) {
  const subnets = localSubnets();
  const hosts = [];
  for (const base of subnets) {
    for (let i = 1; i <= 254; i++) hosts.push(base + '.' + i);
  }
  if (!hosts.length) return [];
  // ARP 表里的地址优先，先扫它们，能更快出结果；剩余地址作为兜底。
  const arp = arpHosts().filter((h) => subnets.some((b) => h.startsWith(b + '.')));
  const ordered = [...new Set([...arp, ...hosts])];
  const result = [];
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= ordered.length) return;
      const host = ordered[i];
      const open = [];
      await Promise.all(PROBE_PORTS.map(async (port) => {
        if (await probeTcp(host, port, timeoutMs)) open.push(port);
      }));
      if (open.length) result.push({ host, ports: open });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ordered.length) }, worker));
  return result;
}

/**
 * @param {{timeout?:number, deep?:boolean, concurrency?:number}} opts
 * @returns {Promise<Array>} 统一设备列表
 */
async function discoverPrinters(opts = {}) {
  const timeout = Math.max(150, Math.min(1200, Number(opts.timeout) || 320));
  const concurrency = Math.max(16, Math.min(128, Number(opts.concurrency) || 64));
  const startedAt = Date.now();
  const [mdns, ssdp] = await Promise.all([mdnsDiscover(3600), ssdpDiscover(3200)]);
  const byHostHints = new Map();
  const records = [];

  for (const m of mdns) {
    const brand = catalog.inferBrand(`${m.instance} ${m.service} ${JSON.stringify(m.txt)}`);
    const patch = {
      kind: brand || (m.service.includes('_moonraker') ? 'moonraker' : m.service.includes('_octoprint') ? 'octoprint' : 'unknown'),
      name: m.instance, port: m.port,
      model: String(m.txt.model || m.txt.product || ''),
      protocol: m.service.includes('_moonraker') ? 'Klipper · Moonraker' : 'mDNS',
      sources: ['mdns'], confidence: brand ? 'high' : 'medium',
      extra: { service: m.service, txt: m.txt },
    };
    records.push(newRecord(m.host, patch));
    const h = byHostHints.get(m.host) || {};
    byHostHints.set(m.host, { ...h, name: m.instance, brand: brand || h.brand, txt: JSON.stringify(m.txt) });
  }
  for (const s of ssdp) {
    records.push(s);
    const h = byHostHints.get(s.host) || {};
    byHostHints.set(s.host, { ...h, name: s.name, model: s.model, brand: s.kind });
  }

  const scanned = await portScan(timeout, concurrency);
  const existing = new Set(records.map((r) => r.host));
  await Promise.all(scanned.map(async ({ host, ports }) => {
    let found = [];
    try { found = await identifyHost(host, ports, byHostHints.get(host) || {}); } catch (_) { /* 忽略单机 */ }
    if (!found.length && !existing.has(host)) {
      found = [newRecord(host, {
        kind: 'unknown', name: '未知设备', port: ports[0], ports,
        protocol: '开放端口: ' + ports.join(', '), sources: ['port'],
        confidence: 'low', extra: { openPorts: ports },
      })];
    }
    records.push(...found);
  }));

  const merged = mergeRecords(records);
  // 端口探测只保留“有证据”的；纯未知开放端口仍列出，但标 low，不自动连。
  for (const r of merged) {
    r.elapsedMs = Date.now() - startedAt;
    r.needs = r.needs || (catalog.brandOf(r.kind) || {}).needs || [];
    r.autoConnect = !!(catalog.brandOf(r.kind) && catalog.brandOf(r.kind).canAutoConnect && !(r.needs || []).length);
  }
  return merged;
}

module.exports = {
  discoverPrinters, mergeRecords, decodeMdns, parseSsdp, parseServiceName,
  identifyHost, localSubnets, PROBE_PORTS, MDNS_TYPES,
};
