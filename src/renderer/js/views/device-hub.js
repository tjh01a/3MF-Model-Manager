/**
 * 设备中心：局域网扫描、设备列表、单机监控台。
 *
 * 与旧「连接打印机」弹窗并存：旧入口不动，这一页是新的独立侧栏入口。
 * 数据来源：
 *   printersList()      → 已保存的设备配置（含品牌、端口、适配器、凭据）
 *   printersSnapshot()  → 主进程归一化后的实时状态
 *   printersDiscover()  → mDNS + SSDP + HTTP 指纹 + 端口/子网扫描的合并结果
 */

import { api, emitToast } from '../api.js';
import { escapeHtml, icon } from '../utils.js';
import { setState } from '../state.js';

const BETA_TIP = '未经过实机验证，协议基于公开资料/社区实现';

const BRANDS = [
  { id: 'anycubic', label: '纵维立方 Anycubic', beta: true, defaultPort: 18910, protocols: [
    { id: 'anycubic', adapter: 'anycubic', label: '原生局域网（18910 / MQTT 9883）', port: 18910 },
    { id: 'octoprint', adapter: 'octoprint', label: 'OctoPrint 兼容（端口 71，Kobra 2 系列）', port: 71 },
  ] },
  { id: 'creality', label: '创想三维 Creality', beta: true, defaultPort: 7125, protocols: [
    { id: 'moonraker', adapter: 'moonraker', label: 'Moonraker（K1/K2 社区固件，端口 7125）', port: 7125 },
    { id: 'moonraker-4408', adapter: 'moonraker', label: 'Moonraker 备用端口 4408', port: 4408 },
  ] },
  { id: 'bambu', label: '拓竹 Bambu Lab', beta: false, defaultPort: 8883, protocols: [
    { id: 'bambu', adapter: 'bambu', label: '局域网 MQTT over TLS（8883）', port: 8883 },
  ] },
  { id: 'snapmaker', label: '快造 Snapmaker', beta: false, defaultPort: 7125, protocols: [
    { id: 'moonraker', adapter: 'moonraker', label: 'Moonraker（U1 / J1，端口 7125）', port: 7125 },
  ] },
  { id: 'flashforge', label: '闪铸 FlashForge', beta: true, defaultPort: 8898, protocols: [
    { id: 'flashforge', adapter: 'flashforge', label: 'HTTP API（端口 8898，需序列号 + Check Code）', port: 8898 },
  ] },
  { id: 'moonraker', label: 'Klipper / Moonraker', beta: true, defaultPort: 7125, protocols: [
    { id: 'moonraker', adapter: 'moonraker', label: 'Moonraker REST（7125 / 4408 / 4409）', port: 7125 },
  ] },
  { id: 'octoprint', label: 'OctoPrint / 兼容设备', beta: true, defaultPort: 80, protocols: [
    { id: 'octoprint', adapter: 'octoprint', label: 'OctoPrint REST（80 / 71）', port: 80 },
  ] },
];

let hub = null;
let devices = [];
let snapshots = new Map();
let selectedId = null;
let scanResults = null;
let scanning = false;
let scanNote = '';
let modal = null;
let pollTimer = null;
let camTimer = null;
let modalSeq = 0;
let lastStagePaint = 0;
let prevTitle = '';
let prevSub = '';
let camBusy = false;
let camOwner = '';

function statusOf(id) {
  return snapshots.get(id) || null;
}

function brandOf(kind) {
  return BRANDS.find((b) => b.id === kind) || { id: kind, label: kind || '未知设备', beta: true };
}

function isBeta(p, st) {
  if (st && typeof st.beta === 'boolean') return st.beta;
  return brandOf(p.kind).beta;
}

function betaBadge(p, st) {
  if (!isBeta(p, st)) return '';
  return `<span class="dh-beta" title="${BETA_TIP}">BETA</span>`;
}

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Math.max(0, Math.min(100, n)).toFixed(n >= 100 ? 0 : 1) + '%';
}

function fmtTemp(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : '—';
}

function fmtRemain(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 60) return Math.round(n) + ' 秒';
  const m = Math.floor(n / 60);
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
}

function stateText(st) {
  if (!st) return '离线';
  if (st.online === false) return '离线';
  const map = {
    idle: '空闲', printing: '打印中', paused: '已暂停', preparing: '准备中', busy: '忙碌',
    finished: '已完成', error: '出错', offline: '离线', connecting: '连接中',
  };
  return st.stateText || map[st.state] || st.state || '未知';
}

function stateClass(st) {
  if (!st || st.online === false) return 'offline';
  if (st.state === 'printing' || st.state === 'preparing') return 'printing';
  if (st.state === 'paused') return 'paused';
  if (st.state === 'error') return 'error';
  if (st.state === 'finished') return 'finished';
  return 'idle';
}

function jobOf(st) {
  return (st && st.job) || null;
}

function progressOf(st) {
  const j = jobOf(st);
  if (!j) return null;
  const n = Number(j.progress != null ? j.progress : j.percent);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/** 各适配器历史字段不完全一致：优先秒，退到分钟。 */
function remainSecOf(st) {
  const j = jobOf(st);
  if (!j) return 0;
  if (Number.isFinite(Number(j.remainSec)) && Number(j.remainSec) > 0) return Number(j.remainSec);
  if (Number.isFinite(Number(j.remainingMin)) && Number(j.remainingMin) > 0) return Number(j.remainingMin) * 60;
  return 0;
}

function capsOf(st, p) {
  const c = (st && st.capabilities) || {};
  return {
    pauseResume: c.pause !== false && c.resume !== false,
    stop: c.stop !== false,
    setTemp: c.temp !== false && c.setTemp !== false,
    sendJob: c.sendJob !== false,
    camera: c.camera !== false,
  };
}

function selectedDevice() {
  return devices.find((p) => p.id === selectedId) || null;
}

// ------------------------------------------------------------------ 数据

async function refreshAll() {
  try {
    const [list, snap] = await Promise.all([api.printersList(), api.printersSnapshot()]);
    devices = (list || []).filter((p) => p && p.enabled !== false);
    snapshots = new Map((Array.isArray(snap) ? snap : []).map((s) => [s.id, s]));
    if (!selectedId && devices.length) selectedId = devices[0].id;
    if (selectedId && !devices.some((p) => p.id === selectedId)) selectedId = devices[0] ? devices[0].id : null;
    paint();
  } catch (e) {
    if (hub) {
      hub.innerHTML = `<div class="dh-empty-stage"><h3>读不到设备列表</h3><p>${escapeHtml(e.message || e)}</p></div>`;
    }
  }
}

async function pollStatuses() {
  if (!hub || hub.hidden) return;
  try {
    const beforeSt = selectedId ? statusOf(selectedId) : null;
    const before = beforeSt ? beforeSt.online : null;
    const beforeState = beforeSt ? beforeSt.state : null;
    const snap = await api.printersSnapshot();
    snapshots = new Map((Array.isArray(snap) ? snap : []).map((s) => [s.id, s]));
    paintCards();
    paintLive();
    // 首次连上 / 掉线 / 状态切换（打印→暂停）时按钮可用状态会变，整块重画一次；其余只更新数字
    const now = statusOf(selectedId) || {};
    if (selectedId && !modal && (before !== now.online || beforeState !== now.state)) paint();
  } catch (_) { /* 轮询失败下一轮再试 */ }
}

function mergeSnapshot(s) {
  if (!s || !s.id) return;
  const before = statusOf(s.id);
  snapshots.set(s.id, s);
  paintCards();
  paintLive();
  // 在线/离线或状态切换需要重画按钮、目标温度占位与“局域网直连/离线”标签；
  // 其余增量只更新数字，避免每 3 秒打断正在输入的温度框。
  if (selectedId === s.id && !modal && (!before || before.online !== s.online || before.state !== s.state)) paint();
}

// ------------------------------------------------------------------ 渲染

function paint() {
  if (!hub || hub.hidden) return;
  const online = devices.filter((p) => {
    const s = statusOf(p.id);
    return s && s.online !== false;
  }).length;
  const printing = devices.filter((p) => {
    const s = statusOf(p.id);
    return s && s.online !== false && (s.state === 'printing' || s.state === 'preparing');
  }).length;

  hub.innerHTML = `
    <div class="dh-head">
      <div>
        <h1>设备中心</h1>
        <p>同一个网段里自动找打印机：Bonjour/mDNS、SSDP、HTTP 指纹、端口与子网兜底扫描，识别品牌后可直接连接。未经过实机验证的品牌已标 BETA。</p>
      </div>
      <div class="dh-head-actions">
        <div class="dh-kpis">
          <div class="dh-kpi"><b>${online}</b><span>在线设备</span></div>
          <div class="dh-kpi"><b>${printing}</b><span>正在打印</span></div>
        </div>
        <button class="btn btn-primary dh-scan-btn ${scanning ? 'dh-spin' : ''}" data-act="scan" ${scanning ? 'disabled' : ''}>
          ${icon('refresh')}<span>${scanning ? '正在扫描…' : '扫描局域网'}</span>
        </button>
        <button class="btn btn-ghost" data-act="manual">${icon('plus')}<span>手动添加</span></button>
      </div>
    </div>
    <div class="dh-body">
      <div class="dh-left">
        <div class="dh-left-head">
          <span>已保存设备 · ${devices.length}</span>
          <button class="dh-mini-btn" data-act="refresh">${icon('refresh')}刷新</button>
        </div>
        <div class="dh-device-list">${renderCards()}</div>
      </div>
      <div class="dh-stage">${renderStage()}</div>
    </div>
    ${scanResults ? renderDiscover() : ''}
    ${modal ? renderModal() : ''}
  `;
  loadCamera();
}

function renderCards() {
  if (!devices.length) {
    return `<div class="dh-empty-list">
      ${icon('printer')}
      <h3>还没有添加打印机</h3>
      <p>点右上角「扫描局域网」，同一网段的机器会自动出现在下方；也可以手动填 IP。</p>
    </div>`;
  }
  return devices.map((p) => {
    const st = statusOf(p.id);
    const online = st && st.online !== false;
    const pct = progressOf(st);
    const j = jobOf(st);
    const cls = stateClass(st);
    return `<button class="dh-card ${p.id === selectedId ? 'active' : ''}" data-act="select" data-id="${escapeHtml(p.id)}">
      <div class="dh-card-top">
        <span class="dh-dot ${online ? (st.state === 'printing' ? 'printing' : 'online') : (st && st.state === 'error' ? 'error' : '')}"></span>
        <span class="dh-card-name">${escapeHtml(p.name || p.ip)}</span>
        ${betaBadge(p, st)}
      </div>
      <div class="dh-card-meta">
        <span>${escapeHtml((st && st.brandLabel) || brandOf(p.kind).label)}</span>
        <span>·</span>
        <span>${escapeHtml(p.ip)}${p.port ? ':' + p.port : ''}</span>
      </div>
      <div class="dh-card-progress">
        <div class="dh-bar ${pct != null && pct >= 100 ? 'done' : (cls === 'error' ? 'warn' : '')}"><i style="width:${pct == null ? 0 : pct}%"></i></div>
        <div class="dh-card-foot">
          <span>${online ? stateText(st) : '离线'}</span>
          <span>${online && j ? (pct != null ? fmtPct(pct) : '') + (remainSecOf(st) ? ' · 剩 ' + fmtRemain(remainSecOf(st)) : '') : '—'}</span>
        </div>
      </div>
    </button>`;
  }).join('');
}

function renderStage() {
  const p = selectedDevice();
  if (!p) {
    return `<div class="dh-empty-stage">
      ${icon('printer')}
      <h3>选中一台设备看监控</h3>
      <p>左侧设备卡片会显示状态、进度和剩余时间；右侧是喷头/热床温度、控制按钮、发送任务和摄像头画面。</p>
    </div>`;
  }
  const st = statusOf(p.id) || { online: false, state: 'offline' };
  const caps = capsOf(st, p);
  const online = st.online !== false;
  const j = jobOf(st) || {};
  const pct = progressOf(st);
  const temps = st.temps || {};
  const nozzle = temps.nozzle || { cur: 0, target: 0 };
  const bed = temps.bed || { cur: 0, target: 0 };
  const chamber = temps.chamber;
  const model = st.model || p.model || '';
  const hasCam = !!p.cameraUrl || !!(st.camera && (st.camera.streamUrl || st.camera.snapshotUrl)) ||
    p.kind === 'bambu' || p.kind === 'snapmaker';
  const showCamera = hasCam;
  const canPause = online && caps.pauseResume && ['printing', 'preparing', 'busy'].includes(st.state);
  const canResume = online && caps.pauseResume && st.state === 'paused';
  const canStop = online && caps.stop && ['printing', 'paused', 'preparing', 'busy'].includes(st.state);

  return `<div class="dh-stage-head">
    <div class="dh-stage-title">
      <h2>${escapeHtml(p.name || p.ip)} ${betaBadge(p, st)}</h2>
      <div class="dh-sub">${escapeHtml(st.brandLabel || brandOf(p.kind).label)}${model ? ' · ' + escapeHtml(model) : ''} · ${escapeHtml(p.ip)}${p.port ? ':' + p.port : ''}</div>
    </div>
    <div class="dh-stage-actions">
      <button class="dh-icon-btn" data-act="test" title="测试连接">${icon('link')}</button>
      <button class="dh-icon-btn" data-act="refresh-one" title="立即刷新状态">${icon('refresh')}</button>
    </div>
  </div>
  <div class="dh-stage-body">
    <div class="dh-status-strip">
      <span class="dh-state-chip ${stateClass(st)}" id="dh-state">${icon('printer')}${escapeHtml(online ? stateText(st) : '离线')}</span>
      <div class="dh-job-name">
        <b id="dh-job-name">${escapeHtml(j.name || (online ? '当前没有打印任务' : '设备未连接'))}</b>
        <small id="dh-job-sub">${escapeHtml(online ? (j.message || (st.error ? st.error : '等待状态更新')) : (st.error || '检查电源、网络和访问码'))}</small>
      </div>
      <span class="dh-live" id="dh-live">${online ? '实时' : '未连接'}</span>
    </div>

    <div class="dh-progress-wrap">
      <div class="dh-progress-top">
        <b id="dh-pct">${pct == null ? '—' : fmtPct(pct)}</b>
        <span>剩余 <i id="dh-remain" style="font-style:normal;color:var(--text-dim)">${remainSecOf(st) ? fmtRemain(remainSecOf(st)) : '—'}</i></span>
      </div>
      <div class="dh-progress-track"><i id="dh-bar" style="width:${pct == null ? 0 : pct}%"></i></div>
    </div>

    <div class="dh-section">
      <div class="dh-section-title"><span>温度</span><em>目标 / 当前</em></div>
      <div class="dh-metrics">
        <div class="dh-metric">
          <div class="dh-metric-top"><span>喷头</span><i>NOZZLE</i></div>
          <div class="dh-metric-val"><b id="dh-nozzle-cur">${fmtTemp(nozzle.cur)}</b><small>°C</small><i style="font-style:normal;font-size:10px;color:var(--text-mute)">/ <span id="dh-nozzle-target">${fmtTemp(nozzle.target)}</span>°</i></div>
          <div class="dh-metric-track hot"><i id="dh-nozzle-bar" style="width:${Math.min(100, (Number(nozzle.cur) || 0) / 3)}%"></i></div>
        </div>
        <div class="dh-metric">
          <div class="dh-metric-top"><span>热床</span><i>BED</i></div>
          <div class="dh-metric-val"><b id="dh-bed-cur">${fmtTemp(bed.cur)}</b><small>°C</small><i style="font-style:normal;font-size:10px;color:var(--text-mute)">/ <span id="dh-bed-target">${fmtTemp(bed.target)}</span>°</i></div>
          <div class="dh-metric-track hot"><i id="dh-bed-bar" style="width:${Math.min(100, (Number(bed.cur) || 0) / 1.2)}%"></i></div>
        </div>
        <div class="dh-metric">
          <div class="dh-metric-top"><span>${chamber ? '腔体' : '风扇 / 速度'}</span><i>${chamber ? 'CHAMBER' : 'FAN'}</i></div>
          <div class="dh-metric-val">
            ${chamber
    ? `<b id="dh-chamber-cur">${fmtTemp(chamber.cur)}</b><small>°C</small>`
    : `<b id="dh-fan">${st.fan == null ? '—' : Math.round(st.fan)}</b><small>%</small>`}
          </div>
          <div class="dh-metric-track"><i style="width:${chamber ? 0 : (Number(st.fan) || 0)}%"></i></div>
        </div>
      </div>
    </div>

    <div class="dh-section">
      <div class="dh-section-title"><span>控制</span><em>${online ? '局域网直连' : '离线'}</em></div>
      <div class="dh-controls">
        <button class="dh-btn primary" data-act="pause" ${!canPause ? 'disabled' : ''}>${icon('pause')}暂停</button>
        <button class="dh-btn" data-act="resume" ${!canResume ? 'disabled' : ''}>${icon('play')}继续</button>
        <button class="dh-btn danger" data-act="stop" ${!canStop ? 'disabled' : ''}>${icon('square')}停止</button>
        <button class="dh-btn ghost" data-act="test" ${!online ? '' : ''}>${icon('link')}测试连接</button>
      </div>
    </div>

    <div class="dh-section">
      <div class="dh-section-title"><span>温度设定</span><em>留空表示不改</em></div>
      <div class="dh-temp-form">
        <div class="dh-field"><label>喷头目标 °C</label><input class="dh-input" id="dh-temp-nozzle" type="number" min="0" max="320" placeholder="当前 ${fmtTemp(nozzle.cur)}"></div>
        <div class="dh-field"><label>热床目标 °C</label><input class="dh-input" id="dh-temp-bed" type="number" min="0" max="120" placeholder="当前 ${fmtTemp(bed.cur)}"></div>
        <button class="dh-btn" data-act="set-temp" ${!online || !caps.setTemp ? 'disabled' : ''}>${icon('sliders')}应用</button>
      </div>
    </div>

    <div class="dh-section">
      <div class="dh-section-title"><span>打印任务</span><em>支持 .gcode / .gco / .3mf</em></div>
      <div class="dh-controls">
        <button class="dh-btn wide" data-act="send" ${!online || !caps.sendJob ? 'disabled' : ''}>${icon('upload')}选择文件并发送</button>
      </div>
    </div>

    <div class="dh-section">
      <div class="dh-section-title"><span>摄像头</span><em>${showCamera ? '可用时自动取帧' : '该协议未发现画面'}</em></div>
      <div class="dh-camera ${hasCam ? '' : 'is-empty'}" id="dh-camera">
        <span class="dh-camera-tag">CAM</span>
        <div class="dh-camera-empty">${icon('image')}<span>${hasCam ? '正在尝试获取画面…' : '该协议未发现摄像头，可在添加设备时填写 MJPEG / 快照地址'}</span></div>
      </div>
    </div>

    <div class="dh-danger-zone">
      <span>${betaBadge(p, st) ? '<strong style="color:#f2b544;font-weight:700">BETA · </strong>' : ''}${isBeta(p, st) ? '本机型未经过实机验证，协议基于公开资料/社区实现。' : '连接参数保存在本机。'}</span>
      <button class="dh-btn danger" data-act="remove">${icon('trash')}移除设备</button>
    </div>
  </div>`;
}

function confidencePct(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return Math.round(c <= 1 ? c * 100 : c);
  return ({ low: 45, medium: 70, high: 92 }[String(c)] || 0);
}

function renderDiscover() {
  const rows = scanResults && scanResults.length
    ? scanResults.map((d) => {
      const saved = d.added || devices.some((p) => p.ip === d.host);
      const canConnect = !!(d.kind && d.kind !== 'unknown') && !(d.extra && (d.extra.legacyTcp || d.extra.privateProtocol));
      return `<div class="dh-discover-row">
        <div class="dh-disc-main">
          <b>${escapeHtml(d.name || d.host)} ${d.beta && d.kind && d.kind !== 'unknown' ? `<span class="dh-beta" title="${BETA_TIP}">BETA</span>` : ''}</b>
          <small>${escapeHtml(d.brandLabel || d.brand || '未知')} · ${escapeHtml(d.host)}${d.port ? ':' + d.port : ''}${d.protocol ? ' · ' + escapeHtml(d.protocol) : ''}${d.model ? ' · ' + escapeHtml(d.model) : ''}</small>
          <div class="dh-disc-src">${(d.sources || []).map((s) => `<span class="dh-src ${s === 'mdns' || s === 'ssdp' ? 'on' : ''}">${escapeHtml(s)}</span>`).join('')}
            ${d.confidence != null ? `<span class="dh-src">置信 ${confidencePct(d.confidence)}%</span>` : ''}
          </div>
        </div>
        <div class="dh-disc-actions">
          ${saved
    ? '<span class="dh-src on">已添加</span>'
    : (canConnect
      ? `<button class="dh-btn primary" data-act="add-result" data-idx="${scanResults.indexOf(d)}">${icon('plus')}连接</button>`
      : '<span class="dh-src">仅识别</span>')}
        </div>
      </div>`;
    }).join('')
    : `<div class="dh-empty-list"><h3>没有发现设备</h3><p>确认打印机和电脑在同一网段、打印机已开启局域网模式；部分品牌需要先在机器上允许局域网访问。</p></div>`;

  return `<div class="dh-discover">
    <div class="dh-discover-head">
      <div><strong>发现结果 · ${scanResults ? scanResults.length : 0} 台</strong><span>${escapeHtml(scanNote)}</span></div>
      <button class="dh-mini-btn" data-act="close-scan" style="border:0;background:transparent;color:var(--text-mute);cursor:pointer">${icon('close')}收起</button>
    </div>
    <div class="dh-discover-list">${rows}</div>
  </div>`;
}

function brandOptions(current) {
  return BRANDS.map((b) => `<option value="${b.id}" ${b.id === current ? 'selected' : ''}>${escapeHtml(b.label)}${b.beta ? '（BETA）' : ''}</option>`).join('');
}

function protocolOptions(brand, current) {
  const b = BRANDS.find((x) => x.id === brand) || BRANDS[0];
  return b.protocols.map((p) => `<option value="${p.id}" data-port="${p.port}" ${p.id === current ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('');
}

function renderModal() {
  if (!modal) return '';
  const brand = BRANDS.find((b) => b.id === modal.brand) || BRANDS[0];
  const proto = brand.protocols.find((p) => p.id === modal.protocol) || brand.protocols[0];
  const needSerial = modal.brand === 'bambu' || modal.brand === 'flashforge';
  const needCode = modal.brand === 'bambu' || modal.brand === 'flashforge' || modal.brand === 'creality' || modal.brand === 'octoprint';
  const codeLabel = modal.brand === 'bambu' ? '访问码 Access Code' : (modal.brand === 'flashforge' ? 'Check Code' : 'API Key（可选）');
  return `<div class="dh-modal" data-act="modal-backdrop">
    <div class="dh-modal-card" data-stop="1">
      <div class="dh-modal-head">
        <h2>手动添加打印机</h2>
        <button class="dh-icon-btn" data-act="modal-close">${icon('close')}</button>
      </div>
      <div class="dh-modal-body">
        <div class="dh-field"><label>品牌</label>
          <select class="dh-input" id="dh-m-brand">${brandOptions(modal.brand)}</select>
        </div>
        ${brand.beta ? `<div class="dh-modal-note"><strong style="color:#f2b544">BETA</strong> · ${BETA_TIP}。连接参数来自公开协议资料，可能因固件版本不同而失败。</div>` : ''}
        <div class="dh-field"><label>连接方式</label>
          <select class="dh-input" id="dh-m-protocol">${protocolOptions(modal.brand, modal.protocol)}</select>
        </div>
        <div class="dh-field"><label>IP 地址</label><input class="dh-input" id="dh-m-ip" value="${escapeHtml(modal.ip)}" placeholder="192.168.1.50" autocomplete="off"></div>
        <div style="display:grid;grid-template-columns:1fr 110px;gap:8px">
          <div class="dh-field"><label>显示名称</label><input class="dh-input" id="dh-m-name" value="${escapeHtml(modal.name)}" placeholder="例如：车间 K1"></div>
          <div class="dh-field"><label>端口</label><input class="dh-input" id="dh-m-port" type="number" value="${escapeHtml(modal.port || proto.port)}"></div>
        </div>
        ${needSerial ? `<div class="dh-field"><label>序列号${modal.brand === 'bambu' ? '（打印机设置 → 设备信息）' : ''}</label><input class="dh-input" id="dh-m-serial" value="${escapeHtml(modal.serial)}" placeholder="${modal.brand === 'bambu' ? '例如 01S00C123456789' : '打印机背面/屏幕上的序列号'}" autocomplete="off"></div>` : ''}
        ${needCode ? `<div class="dh-field"><label>${codeLabel}</label><input class="dh-input" id="dh-m-code" value="${escapeHtml(modal.code)}" placeholder="${modal.brand === 'bambu' ? '局域网模式里的 8 位访问码' : (modal.brand === 'flashforge' ? '屏幕 → 网络设置里的 Check Code' : '留空表示 Moonraker 不启用鉴权')}" autocomplete="off"></div>` : ''}
        <div class="dh-field"><label>摄像头地址（可选）</label><input class="dh-input" id="dh-m-cam" value="${escapeHtml(modal.cam)}" placeholder="http://192.168.1.50/webcam/?action=snapshot" autocomplete="off"></div>
        <div class="dh-modal-error" id="dh-m-error"></div>
        <div class="dh-modal-note">提示：IP 填错不会保存成功；扫描发现通常比手动填更准。拓竹需要先在打印机上开启“仅局域网 + 开发者模式”。</div>
      </div>
      <div class="dh-modal-foot">
        <button class="dh-btn ghost" data-act="modal-close">取消</button>
        <button class="dh-btn primary" data-act="modal-save">添加并连接</button>
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ 实时

function paintCards() {
  if (!hub || hub.hidden) return;
  const list = hub.querySelector('.dh-device-list');
  if (list) list.innerHTML = renderCards();
}

function paintLive() {
  if (!hub || hub.hidden) return;
  const p = selectedDevice();
  if (!p) return;
  const st = statusOf(p.id);
  if (!st) return;
  const j = jobOf(st) || {};
  const pct = progressOf(st);
  const online = st.online !== false;
  const set = (id, text) => {
    const e = hub.querySelector('#' + id);
    if (e) e.textContent = text;
  };
  const chip = hub.querySelector('#dh-state');
  if (chip) {
    chip.className = 'dh-state-chip ' + stateClass(st);
    chip.innerHTML = icon('printer') + escapeHtml(online ? stateText(st) : '离线');
  }
  set('dh-job-name', j.name || (online ? '当前没有打印任务' : '设备未连接'));
  set('dh-job-sub', online ? (j.message || (st.error ? st.error : '等待状态更新')) : (st.error || '检查电源、网络和访问码'));
  set('dh-live', online ? '实时' : '未连接');
  set('dh-pct', pct == null ? '—' : fmtPct(pct));
  set('dh-remain', remainSecOf(st) ? fmtRemain(remainSecOf(st)) : '—');
  const bar = hub.querySelector('#dh-bar');
  if (bar) bar.style.width = (pct == null ? 0 : pct) + '%';
  const t = st.temps || {};
  const nz = t.nozzle || {};
  const bd = t.bed || {};
  set('dh-nozzle-cur', fmtTemp(nz.cur));
  set('dh-nozzle-target', fmtTemp(nz.target));
  set('dh-bed-cur', fmtTemp(bd.cur));
  set('dh-bed-target', fmtTemp(bd.target));
  const nzBar = hub.querySelector('#dh-nozzle-bar');
  if (nzBar) nzBar.style.width = Math.min(100, (Number(nz.cur) || 0) / 3) + '%';
  const bdBar = hub.querySelector('#dh-bed-bar');
  if (bdBar) bdBar.style.width = Math.min(100, (Number(bd.cur) || 0) / 1.2) + '%';
  if (st.temps && st.temps.chamber) {
    set('dh-chamber-cur', fmtTemp(st.temps.chamber.cur));
  } else {
    set('dh-fan', st.fan == null ? '—' : Math.round(st.fan));
  }
}

async function loadCamera() {
  if (!hub || hub.hidden) return;
  const p = selectedDevice();
  if (!p) return;
  const box = hub.querySelector('#dh-camera');
  if (!box) return;
  const st = statusOf(p.id);
  const url = (st && st.camera && (st.camera.streamUrl || st.camera.snapshotUrl)) || p.cameraUrl || '';
  const mayFrame = p.kind === 'bambu' || p.kind === 'snapmaker' || !!p.cameraUrl;
  if (!url && !mayFrame) {
    box.innerHTML = `<span class="dh-camera-tag">CAM</span><div class="dh-camera-empty">${icon('image')}<span>该协议未发现摄像头，可在添加设备时填写 MJPEG / 快照地址</span></div>`;
    return;
  }
  // RTSP/FLV 浏览器 <img> 不能直接播，明确说明，避免只显示一张破图。
  const camKind = String((st && st.camera && st.camera.kind) || '').toLowerCase();
  if (url && (camKind === 'rtsp' || camKind === 'flv' || /^rtsps?:|\.flv($|\?)/i.test(url))) {
    box.innerHTML = `<span class="dh-camera-tag">CAM</span><div class="dh-camera-empty">${icon('image')}<span>这台机器的画面是 RTSP/FLV，浏览器不能直接内嵌<br>请在添加设备时填写 HTTP 快照 / MJPEG 地址</span></div>`;
    return;
  }
  if (url && /\.(jpg|jpeg|png|mjpeg)(\?|$)/i.test(url)) {
    const bust = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const img = new Image();
    img.onload = () => {
      if (selectedId !== p.id) return;
      box.innerHTML = `<span class="dh-camera-tag">CAM</span><img alt="打印机摄像头" src="${escapeHtml(bust)}">`;
    };
    img.onerror = () => {
      if (selectedId !== p.id) return;
      box.innerHTML = `<span class="dh-camera-tag">CAM</span><div class="dh-camera-empty">${icon('image')}<span>摄像头地址无法访问<br>${escapeHtml(url)}</span></div>`;
    };
    img.src = bust;
    return;
  }
  if (st && st.camera && st.camera.streamUrl && st.camera.kind !== 'frame') {
    box.innerHTML = `<span class="dh-camera-tag">LIVE</span><img alt="打印机摄像头" src="${escapeHtml(st.camera.streamUrl)}">`;
    return;
  }
  if (camBusy && camOwner === p.id) return;
  camBusy = true;
  camOwner = p.id;
  try {
    const shot = await api.cameraFrame(p.id);
    if (selectedId !== p.id) return;
    if (shot && shot.ok && shot.base64) {
      box.innerHTML = `<span class="dh-camera-tag">CAM${shot.staleSec ? ' · ' + Math.round(shot.staleSec) + 's 前' : ''}</span><img alt="打印机摄像头" src="data:image/jpeg;base64,${shot.base64}">`;
    } else {
      box.innerHTML = `<span class="dh-camera-tag">CAM</span><div class="dh-camera-empty">${icon('image')}<span>已连接，但暂时取不到画面<br>可在添加设备时填写摄像头地址</span></div>`;
    }
  } catch (_) {
    if (selectedId !== p.id) return;
    box.innerHTML = `<span class="dh-camera-tag">CAM</span><div class="dh-camera-empty">${icon('image')}<span>这台设备没有可用的取帧方式<br>可填写 MJPEG / 快照地址</span></div>`;
  } finally {
    camBusy = false;
    camOwner = '';
  }
}

// ------------------------------------------------------------------ 扫描

async function scan() {
  if (scanning) return;
  scanning = true;
  scanNote = '正在并发探测本网段…';
  paint();
  try {
    const found = await api.printersDiscover({});
    scanResults = Array.isArray(found) ? found : [];
    const auto = scanResults.filter((d) => d.added).length;
    scanNote = `共 ${scanResults.length} 台；${auto} 台已在列表。协议识别来源见卡片标签。`;
    if (scanResults.length === 0) scanNote = '没有响应。检查网段、防火墙，或打印机未开局域网模式。';
    emitToast('success', `扫描完成：发现 ${scanResults.length} 台打印机`);
    await refreshAll();
  } catch (e) {
    scanResults = [];
    scanNote = (e && e.message) || '扫描失败';
    emitToast('error', scanNote);
    paint();
  } finally {
    scanning = false;
    paint();
  }
}

async function addResult(idx) {
  const d = scanResults && scanResults[idx];
  if (!d) return;
  // 缺访问码 / 序列号 / Check Code 的品牌不硬加一个连不上的空配置，直接打开带预填的手动弹窗
  if (d.needs && d.needs.length) {
    openManual({
      brand: d.kind, adapter: d.adapter, ip: d.host, port: d.port,
      name: d.name, serial: d.serial, accessCode: d.accessCode, cameraUrl: d.cameraUrl,
    });
    return;
  }
  try {
    await api.printerAdd({
      kind: d.kind || d.brand,
      adapter: d.adapter || '',
      name: d.name || d.brandLabel || d.host,
      ip: d.host,
      port: d.port || 0,
      model: d.model || '',
      serial: d.serial || '',
      accessCode: d.accessCode || '',
      cameraUrl: d.cameraUrl || '',
    });
    emitToast('success', '已添加 ' + (d.name || d.host));
    await refreshAll();
    selectedId = devices.find((p) => p.ip === d.host)?.id || selectedId;
    paint();
  } catch (e) {
    emitToast('error', (e && e.message) || '添加失败');
  }
}

// ------------------------------------------------------------------ 操作

async function doAction(cmd) {
  if (!selectedId) return;
  try {
    const r = await api.printerAction(selectedId, cmd);
    if (r && r.ok === false) throw new Error(r.message || '操作失败');
    emitToast('success', cmd === 'pause' ? '已发送暂停' : (cmd === 'resume' ? '已发送继续' : '已发送停止'));
    setTimeout(() => refreshAll(), 900);
  } catch (e) {
    emitToast('error', (e && e.message) || '操作失败');
  }
}

async function applyTemp() {
  if (!selectedId) return;
  const nz = hub.querySelector('#dh-temp-nozzle')?.value;
  const bd = hub.querySelector('#dh-temp-bed')?.value;
  const payload = {};
  if (String(nz).trim() !== '') payload.nozzle = Number(nz);
  if (String(bd).trim() !== '') payload.bed = Number(bd);
  if (payload.nozzle === undefined && payload.bed === undefined) {
    emitToast('info', '先填一个目标温度');
    return;
  }
  if ((payload.nozzle !== undefined && (!Number.isFinite(payload.nozzle) || payload.nozzle < 0 || payload.nozzle > 320)) ||
      (payload.bed !== undefined && (!Number.isFinite(payload.bed) || payload.bed < 0 || payload.bed > 120))) {
    emitToast('error', '温度超出范围：喷头 0–320°C，热床 0–120°C');
    return;
  }
  try {
    await api.printerSetTemp(selectedId, payload);
    emitToast('success', '温度指令已发送');
    setTimeout(() => refreshAll(), 900);
  } catch (e) {
    emitToast('error', (e && e.message) || '温度设定失败');
  }
}

async function sendJob() {
  if (!selectedId) return;
  try {
    const file = await api.printerPickFile();
    if (!file) return;
    const r = await api.printerSendJob(selectedId, file, { start: true });
    emitToast('success', '已上传' + (r && r.started ? '并开始打印' : '，请在机器上开始'));
    setTimeout(() => refreshAll(), 1400);
  } catch (e) {
    emitToast('error', (e && e.message) || '发送失败');
  }
}

async function testConn() {
  if (!selectedId) return;
  emitToast('info', '正在测试连接…');
  try {
    const r = await api.printerTest(selectedId);
    emitToast(r && r.ok ? 'success' : 'error', (r && r.message) || '测试完成');
    await refreshAll();
  } catch (e) {
    emitToast('error', (e && e.message) || '测试失败');
  }
}

async function removeDevice() {
  const p = selectedDevice();
  if (!p) return;
  if (!window.confirm(`从列表移除「${p.name || p.ip}」？\n只删除本机保存的连接信息，不会影响打印机。`)) return;
  try {
    await api.printerRemove(p.id);
    selectedId = null;
    emitToast('success', '已移除');
    await refreshAll();
  } catch (e) {
    emitToast('error', (e && e.message) || '移除失败');
  }
}

// ------------------------------------------------------------------ 手动添加

function openManual(prefill) {
  const b = BRANDS[0];
  modal = {
    brand: (prefill && prefill.brand) || 'anycubic',
    protocol: (prefill && prefill.adapter) || b.protocols[0].id,
    ip: (prefill && prefill.ip) || '',
    name: (prefill && prefill.name) || '',
    port: (prefill && prefill.port) || '',
    serial: (prefill && prefill.serial) || '',
    code: (prefill && prefill.accessCode) || '',
    cam: (prefill && prefill.cameraUrl) || '',
  };
  if (prefill && prefill.brand) {
    const bb = BRANDS.find((x) => x.id === prefill.brand);
    if (bb) {
      const wantAdapter = prefill.adapter || '';
      const wantPort = Number(prefill.port) || 0;
      const proto = bb.protocols.find((p) => (p.adapter || p.id) === wantAdapter && (!wantPort || p.port === wantPort))
        || bb.protocols.find((p) => (p.adapter || p.id) === wantAdapter)
        || bb.protocols[0];
      modal.protocol = proto.id;
      modal.port = prefill.port || proto.port;
    }
  }
  modalSeq++;
  paint();
}

function readModal() {
  if (!modal) return;
  modal.brand = hub.querySelector('#dh-m-brand')?.value || modal.brand;
  modal.protocol = hub.querySelector('#dh-m-protocol')?.value || modal.protocol;
  modal.ip = hub.querySelector('#dh-m-ip')?.value || '';
  modal.name = hub.querySelector('#dh-m-name')?.value || '';
  modal.port = hub.querySelector('#dh-m-port')?.value || '';
  modal.serial = hub.querySelector('#dh-m-serial')?.value || '';
  modal.code = hub.querySelector('#dh-m-code')?.value || '';
  modal.cam = hub.querySelector('#dh-m-cam')?.value || '';
}

async function saveModal() {
  readModal();
  const err = hub.querySelector('#dh-m-error');
  const b = BRANDS.find((x) => x.id === modal.brand) || BRANDS[0];
  const proto = b.protocols.find((p) => p.id === modal.protocol) || b.protocols[0];
  if (!String(modal.ip || '').trim()) {
    if (err) err.textContent = 'IP 地址不能为空';
    return;
  }
  if (modal.brand === 'bambu' && (!modal.serial || !modal.code)) {
    if (err) err.textContent = '拓竹需要序列号和 8 位访问码';
    return;
  }
  if (modal.brand === 'flashforge' && (!modal.serial || !modal.code)) {
    if (err) err.textContent = '闪铸 HTTP API 需要序列号和 Check Code';
    return;
  }
  try {
    await api.printerAdd({
      kind: modal.brand,
      adapter: proto.adapter || proto.id,
      name: modal.name || (b.label + ' ' + modal.ip.split('.').pop()),
      ip: modal.ip.trim(),
      port: Number(modal.port) || proto.port,
      model: '',
      serial: modal.serial.trim(),
      accessCode: modal.code.trim(),
      cameraUrl: modal.cam.trim(),
    });
    const host = modal.ip.trim();
    modal = null;
    emitToast('success', '已添加，等待首次状态');
    await refreshAll();
    selectedId = devices.find((p) => p.ip === host)?.id || selectedId;
    paint();
  } catch (e) {
    if (err) err.textContent = (e && e.message) || '添加失败';
  }
}

// ------------------------------------------------------------------ 事件

function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t || !hub.contains(t)) return;
  const act = t.getAttribute('data-act');
  if (act === 'modal-backdrop') {
    if (e.target === t) { modal = null; paint(); }
    return;
  }
  if (act === 'scan') return void scan();
  if (act === 'manual') return openManual(null);
  if (act === 'refresh') return void refreshAll();
  if (act === 'refresh-one') return void refreshAll();
  if (act === 'select') {
    selectedId = t.getAttribute('data-id');
    paint();
    loadCamera();
    return;
  }
  if (act === 'pause' || act === 'resume' || act === 'stop') return void doAction(act);
  if (act === 'set-temp') return void applyTemp();
  if (act === 'send') return void sendJob();
  if (act === 'test') return void testConn();
  if (act === 'remove') return void removeDevice();
  if (act === 'close-scan') { scanResults = null; paint(); return; }
  if (act === 'add-result') return void addResult(Number(t.getAttribute('data-idx')));
  if (act === 'modal-close') { modal = null; paint(); return; }
  if (act === 'modal-save') return void saveModal();
}

function onChange(e) {
  if (!modal || !hub) return;
  if (e.target.id === 'dh-m-brand') {
    readModal();
    const b = BRANDS.find((x) => x.id === modal.brand) || BRANDS[0];
    modal.protocol = b.protocols[0].id;
    modal.port = b.protocols[0].port;
    paint();
  } else if (e.target.id === 'dh-m-protocol') {
    readModal();
    const b = BRANDS.find((x) => x.id === modal.brand) || BRANDS[0];
    const proto = b.protocols.find((p) => p.id === modal.protocol) || b.protocols[0];
    modal.port = proto.port;
    const port = hub.querySelector('#dh-m-port');
    if (port) port.value = proto.port;
  }
}

function onKey(e) {
  if (e.key === 'Escape' && modal) { modal = null; paint(); }
}

// ------------------------------------------------------------------ 生命周期

export function mountDeviceHub() {
  if (hub) return hub;
  hub = document.getElementById('device-hub');
  if (!hub) return null;
  hub.addEventListener('click', onClick);
  hub.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  window.addEventListener('printers:update', (e) => mergeSnapshot(e && e.detail));
  window.addEventListener('printers:changed', () => { refreshAll(); });
  return hub;
}

export function openDeviceHub() {
  const el = mountDeviceHub();
  if (!el) return;
  el.hidden = false;
  document.getElementById('main')?.classList.add('device-mode');
  setState({ deviceHubOpen: true }, 'nav');
  document.querySelectorAll('#nav-library .nav-item.active').forEach((n) => n.classList.remove('active'));
  document.querySelector('[data-act="open-device-hub"]')?.classList.add('active');
  const title = document.getElementById('view-title');
  const sub = document.getElementById('view-subtitle');
  prevTitle = title ? title.textContent : '';
  prevSub = sub ? sub.textContent : '';
  if (title) title.textContent = '设备';
  if (sub) sub.textContent = '局域网发现与打印监控';
  refreshAll();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { pollStatuses(); }, 5000);
  clearInterval(camTimer);
  camTimer = setInterval(() => { loadCamera(); }, 10000);
}

export function closeDeviceHub() {
  if (hub) hub.hidden = true;
  document.getElementById('main')?.classList.remove('device-mode');
  document.querySelector('[data-act="open-device-hub"]')?.classList.remove('active');
  setState({ deviceHubOpen: false }, 'nav');
  const title = document.getElementById('view-title');
  const sub = document.getElementById('view-subtitle');
  if (title && prevTitle) title.textContent = prevTitle;
  if (sub && prevSub) sub.textContent = prevSub;
  clearInterval(pollTimer);
  clearInterval(camTimer);
  pollTimer = null;
  camTimer = null;
  modal = null;
}

export function isDeviceHubOpen() {
  return !!(hub && !hub.hidden);
}

/** 给走查/自动化留的只读诊断口径。 */
export function deviceHubDiag() {
  return {
    open: isDeviceHubOpen(),
    devices: devices.length,
    online: devices.filter((p) => (statusOf(p.id) || {}).online !== false).length,
    selected: selectedId,
    scanResults: scanResults ? scanResults.length : 0,
    scanning,
    modal: !!modal,
  };
}

