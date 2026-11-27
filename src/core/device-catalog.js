'use strict';
/**
 * 设备品牌/协议注册表。
 *
 * 这里只放“展示与能力”的静态事实，不放端口探测逻辑，避免 UI 和适配器各写一份品牌名。
 * beta 规则来自产品要求：除拓竹、快造外全部标 BETA。
 */

const BETA_NOTE = '未经过实机验证，协议基于公开资料/社区实现';

const BRANDS = {
  bambu: {
    key: 'bambu', label: '拓竹 Bambu Lab', short: 'Bambu', beta: false,
    adapter: 'bambu', protocol: 'Bambu LAN · MQTT/FTPS', defaultPort: 8883,
    color: '#00ae42', needs: ['accessCode'], canAutoConnect: false,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: true },
  },
  snapmaker: {
    key: 'snapmaker', label: '快造 Snapmaker', short: 'Snapmaker', beta: false,
    adapter: 'moonraker', protocol: 'Klipper · Moonraker', defaultPort: 7125,
    color: '#f59e0b', needs: [], canAutoConnect: true,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: true },
  },
  anycubic: {
    key: 'anycubic', label: '纵维立方 Anycubic', short: 'Anycubic', beta: true,
    adapter: 'anycubic', protocol: 'Anycubic LAN · HTTP/MQTT', defaultPort: 18910,
    color: '#22c55e', needs: [], canAutoConnect: true,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: false },
  },
  creality: {
    key: 'creality', label: '创想三维 Creality', short: 'Creality', beta: true,
    adapter: 'moonraker', protocol: 'Klipper · Moonraker', defaultPort: 7125,
    color: '#0ea5e9', needs: [], canAutoConnect: true,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: true },
  },
  flashforge: {
    key: 'flashforge', label: '闪铸 FlashForge', short: 'FlashForge', beta: true,
    adapter: 'flashforge', protocol: 'FlashForge HTTP', defaultPort: 8898,
    color: '#ef4444', needs: ['serial', 'checkCode'], canAutoConnect: false,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: true },
  },
  octoprint: {
    key: 'octoprint', label: 'OctoPrint / 兼容设备', short: 'OctoPrint', beta: true,
    adapter: 'octoprint', protocol: 'OctoPrint REST', defaultPort: 80,
    color: '#8b5cf6', needs: [], canAutoConnect: true,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: true },
  },
  moonraker: {
    key: 'moonraker', label: 'Klipper / Moonraker', short: 'Moonraker', beta: true,
    adapter: 'moonraker', protocol: 'Klipper · Moonraker', defaultPort: 7125,
    color: '#64748b', needs: [], canAutoConnect: true,
    capabilities: { pause: true, resume: true, stop: true, temp: true, sendJob: true, camera: true },
  },
};

// 品牌专用记录在去重时优先于通用协议族；数字越大越优先。
const PRIORITY = { bambu: 90, anycubic: 80, flashforge: 80, creality: 70, snapmaker: 70, moonraker: 40, octoprint: 30 };

const KIND_ALIASES = {
  klipper: 'moonraker', octo: 'octoprint', anycubic_kobra: 'anycubic',
  'bambu-lab': 'bambu', snap: 'snapmaker', ff: 'flashforge', cr: 'creality',
};

const STATE_TEXT = {
  offline: '离线', connecting: '连接中', idle: '待机', ready: '待机',
  printing: '打印中', paused: '已暂停', finished: '已完成', error: '异常', busy: '忙碌',
};

function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  return KIND_ALIASES[k] || k;
}

function brandOf(kind) {
  return BRANDS[normalizeKind(kind)] || null;
}

function isBeta(kind) {
  const b = brandOf(kind);
  return b ? !!b.beta : true;   // 未知品牌默认 BETA
}

function brandLabel(kind) {
  const b = brandOf(kind);
  return b ? b.label : (String(kind || '未知设备'));
}

function capabilitiesOf(kind) {
  const b = brandOf(kind);
  return b ? { ...b.capabilities } : { pause: false, resume: false, stop: false, temp: false, sendJob: false, camera: false };
}

/** 从任意文本（mDNS 实例名、hostname、HTTP 头、SSDP 头）推断品牌。 */
function inferBrand(text) {
  const s = String(text || '').toLowerCase();
  if (/bambu|bambulab|bl-p00|c1[13]\b|n7\b|n9\b|o1d\b/.test(s)) return 'bambu';
  if (/snapmaker|\bu1\b|j1\b|artisan\b/.test(s)) return 'snapmaker';
  if (/anycubic|kobra|kobra\s*s1|ks1\b/.test(s)) return 'anycubic';
  if (/creality|\bk1\b|\bk1c\b|\bk2\b|ender\b|halo\b/.test(s)) return 'creality';
  if (/flashforge|adventurer|creator\s*[35]|guider|finder\b/.test(s)) return 'flashforge';
  if (/octoprint/.test(s)) return 'octoprint';
  if (/moonraker|klipper|fluidd|mainsail/.test(s)) return 'moonraker';
  return '';
}

function stateText(state) {
  return STATE_TEXT[state] || STATE_TEXT.idle;
}

module.exports = {
  BETA_NOTE, BRANDS, PRIORITY, STATE_TEXT,
  normalizeKind, brandOf, isBeta, brandLabel, capabilitiesOf, inferBrand, stateText,
};
