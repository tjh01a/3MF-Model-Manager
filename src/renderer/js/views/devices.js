'use strict';
/**
 * 设备（打印机管理）：把快造 U1 和拓竹放在同一张卡片上。
 *
 * 数据不是从切片软件里抓的，是直连机器：
 *   快造 → Moonraker HTTP 轮询
 *   拓竹 → 局域网 MQTT 推送
 * 所以两台机器能显示在同一屏，而且不需要先打开切片软件。
 */
import { api, emitToast } from '../api.js';
import { escapeHtml, icon } from '../utils.js';
import { confirmDialog, customDialog, promptDialog } from '../components/modal.js';
import { openBambuAccount } from '../components/bambuaccount.js';
import { openMonitorChart } from '../components/monitorchart.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

let mounted = false;
let open = false;
let busy = false;
const st = {
  list: [],
  snap: [],
  discovered: null,
  loading: false,
  error: '',
};

// ------------------------------------------------------------------ 工具

function fmtMin(min) {
  const n = Number(min) || 0;
  if (n <= 0) return '—';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}

const KIND_META = {
  snapmaker: { label: '快造', icon: 'i-cube', cls: 'k-snap' },
  bambu: { label: '拓竹', icon: 'i-box', cls: 'k-bambu' },
};

const STATE_CLS = {
  printing: 's-printing', paused: 's-paused', idle: 's-idle',
  finished: 's-done', preparing: 's-busy', error: 's-err', offline: 's-off',
};

/**
 * 四工具头温度。U1 是 extruder + extruder1..3，只显示当前喷嘴的话，
 * 另外三个头有没有升温、有没有超温完全看不见（用户明确要求每个头都显示）。
 */
function headsHtml(p) {
  const heads = p && p.temps && p.temps.heads;
  if (!Array.isArray(heads) || heads.length < 2) return '';
  return '<div class="dev-tools">' + heads.map((h) => {
    const mat = (p.materials || []).find((m) => m.slot === (h.index + 1));
    const color = mat && mat.color ? mat.color : '';
    const hot = Number(h.target) > 0;
    return '<div class="dev-tool' + (h.active ? ' is-active' : '') + (hot ? ' is-hot' : '') + '"' +
      ' title="T' + (h.index + 1) + ' 当前 ' + h.cur + '° / 目标 ' + h.target + '°' +
        (h.active ? '（当前使用）' : '') + '">' +
      '<i class="dev-tool-dot"' + (color ? ' style="background:' + esc(color) + '"' : '') + '></i>' +
      '<span class="dev-tool-name">T' + (h.index + 1) + '</span>' +
      '<span class="dev-tool-val">' + Math.round(h.cur) + '<i>/' + Math.round(h.target) + '°</i></span>' +
    '</div>';
  }).join('') + '</div>';
}

function tempCell(label, t) {
  if (!t) return '';
  const cur = Math.round(t.cur || 0);
  const tgt = Math.round(t.target || 0);
  const hot = tgt > 0;
  return '<div class="dev-temp' + (hot ? ' is-hot' : '') + '">' +
    '<span class="dev-temp-label">' + esc(label) + '</span>' +
    '<span class="dev-temp-val">' + cur + '<i>/' + tgt + '°</i></span>' +
    '</div>';
}

function materialsHtml(mats) {
  if (!mats || !mats.length) return '<div class="dev-mats-empty">没有耗材信息</div>';
  return '<div class="dev-mats">' + mats.map((m) =>
    '<div class="dev-mat' + (m.active ? ' is-active' : '') + '" title="' + esc(m.type + ' ' + (m.vendor || '')) + '">' +
      '<i class="dev-mat-swatch" style="background:' + esc(m.color || '#9AA3AF') + '"></i>' +
      '<span class="dev-mat-slot">' + (m.slot || '') + '</span>' +
      '<span class="dev-mat-type">' + esc(m.type || '—') + '</span>' +
    '</div>').join('') + '</div>';
}

function progressHtml(p) {
  const s = p.state;
  if (!p.job) {
    return '<div class="dev-job dev-job-empty">' +
      (p.online ? '空闲中，没有正在打印的任务' : (p.error ? esc(p.error) : '还没连上')) + '</div>';
  }
  const j = p.job;
  const pct = Math.max(0, Math.min(100, j.percent || 0));
  const layerTxt = j.layers ? '层 ' + j.layer + '/' + j.layers : '';
  return '<div class="dev-job">' +
    '<div class="dev-job-name" title="' + esc(j.name) + '">' + esc(j.name) + '</div>' +
    '<div class="dev-bar"><i class="' + STATE_CLS[s] + '" style="width:' + pct + '%"></i></div>' +
    '<div class="dev-job-meta">' +
      '<span class="dev-pct">' + Math.round(pct) + '%</span>' +
      (layerTxt ? '<span>' + layerTxt + '</span>' : '') +
      (j.remainingMin ? '<span>剩余 ' + fmtMin(j.remainingMin) + '</span>' : '') +
      (j.elapsedMin && s === 'printing' ? '<span>已用 ' + fmtMin(j.elapsedMin) + '</span>' : '') +
    '</div>' +
  '</div>';
}

// ---- 机内摄像头与「打印机检测」（拓竹 A1/P1 系列）----
const camFrames = new Map();   // id -> data:image/jpeg;base64
const camTimers = new Map();   // id -> timeout
const camMeta = new Map();     // id -> { staleSec, source, static }
const camErrors = new Map();   // id -> string（取帧失败原因，直接显示在卡片上）
const camLoading = new Map();  // id -> true（正在连摄像头，画面区显示等待动画）
const detectState = new Map(); // id -> { running, left, shots, staleSec }

/** 把「多久以前」说成人话：45 秒前 / 3 分钟前 / 2 小时前 */
function agoText(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  if (n < 90) return n + ' 秒前';
  if (n < 3600) return Math.round(n / 60) + ' 分钟前';
  if (n < 86400) return Math.round(n / 3600) + ' 小时前';
  return Math.round(n / 86400) + ' 天前';
}

function camBlock(p) {
  const url = camFrames.get(p.id);
  const err = camErrors.get(p.id);
  const meta = camMeta.get(p.id) || {};
  // 拓竹首帧要 3~12 秒，没有等待动画用户会以为软件卡死
  if (camLoading.get(p.id) && !url && !err) {
    return '<div class="dev-cam is-loading">' +
      '<i class="ico i-refresh" aria-hidden="true"></i>' +
      '<span>正在连接摄像头…</span>' +
      '<span class="dev-cam-hint">拓竹首帧通常要几秒，请稍候</span>' +
      '</div>';
  }
  if (!url) {
    return '<div class="dev-cam is-empty">' +
      '<div class="dev-cam-empty">' +
        esc(err || '点「摄像头」查看机内画面') +
        (err ? '<span class="dev-cam-hint">也可以在「编辑」里填一个摄像头地址（快照或 MJPEG）</span>' : '') +
      '</div></div>';
  }
  const stale = Number(meta.staleSec) > 120;
  const source = meta.static
    ? '<span class="dev-cam-src">静态快照</span>'
    : (meta.source === 'u1-live'
      ? '<span class="dev-cam-src is-live">实时抓拍</span>'
      : (meta.source ? '<span class="dev-cam-src">实时画面</span>' : ''));
  return '<div class="dev-cam">' +
    '<img src="' + url + '" alt="机内摄像头画面">' +
    source +
    (stale
      ? '<span class="dev-cam-badge is-stale" title="打印机上的画面没有再刷新，摄像头服务可能没启动">画面停在 ' + esc(agoText(meta.staleSec)) + '</span>'
      : '') +
    (stale && meta.static
      ? '<div class="dev-cam-note">主动抓拍没成功，这是打印机上的旧快照。可在「编辑」里填一个摄像头地址（快照 / MJPEG）直接取画面。</div>'
      : (meta.notice && meta.static
        ? '<div class="dev-cam-note">' + esc(meta.notice) + '，暂时显示打印机上的快照。</div>'
        : '')) +
  '</div>';
}

function detectLabel(id) {
  const d = detectState.get(id);
  // 倒计时走完但两张图还没到，就老实显示「处理中…」，别停在「检测中 0s」
  if (d && d.running) return d.left > 0 ? ('检测中 ' + d.left + 's') : '处理中…';
  if (d && d.shots && d.shots.length) return '查看图片';
  return '打印机检测';
}

function cardHtml(p) {
  // 快照里的 kind 在缓存条目上不一定有，再用型号兜一层
  const isBambu = p.kind === 'bambu' || /bambu/i.test(String(p.model || ''));
  const meta = KIND_META[p.kind] || KIND_META.bambu;
  const scls = STATE_CLS[p.state] || 's-idle';
  const canPause = p.state === 'printing';
  const canResume = p.state === 'paused';
  const canStop = p.state === 'printing' || p.state === 'paused' || p.state === 'preparing';
  return '<article class="dev-card ' + meta.cls + '" data-id="' + esc(p.id) + '">' +
    '<header class="dev-head">' +
      '<span class="dev-kind" title="' + esc(meta.label) + '">' + icon(meta.icon) + '</span>' +
      '<div class="dev-title">' +
        '<div class="dev-name">' + esc(p.name) + '</div>' +
        '<div class="dev-sub">' + esc(p.model || meta.label) + ' · ' +
          (p.via === 'cloud' ? '云端通道' : (p.ip ? esc(p.ip) : '局域网')) + '</div>' +
      '</div>' +
      '<span class="dev-state ' + scls + '">' + esc(p.stateText || '—') + '</span>' +
    '</header>' +
    progressHtml(p) +
    '<div class="dev-temps">' +
      headsHtml(p) +
      (headsHtml(p) ? '' : tempCell('喷嘴', p.temps && p.temps.nozzle)) +
      tempCell('热床', p.temps && p.temps.bed) +
      (p.temps && p.temps.chamber ? tempCell('腔体', p.temps.chamber) : '') +
      (p.fan != null ? '<div class="dev-temp"><span class="dev-temp-label">风扇</span><span class="dev-temp-val">' + Math.round(p.fan) + '<i>%</i></span></div>' : '') +
    '</div>' +
    materialsHtml(p.materials) +
    '<div class="dev-actions">' +
      (canPause ? '<button class="btn btn-ghost btn-sm" data-act="dev-cmd" data-cmd="pause" ' +
        'title="暂停「' + esc(p.name) + '」正在进行的打印任务，打印件和进度都会保留，之后可以继续">暂停打印</button>' : '') +
      (canResume ? '<button class="btn btn-primary btn-sm" data-act="dev-cmd" data-cmd="resume" ' +
        'title="让「' + esc(p.name) + '」从暂停位置继续打印">继续打印</button>' : '') +
      (canStop ? '<button class="btn btn-ghost btn-sm danger" data-act="dev-cmd" data-cmd="stop" ' +
        'title="取消「' + esc(p.name) + '」当前的打印任务，打印件会作废且不可恢复。不影响摄像头预览">取消打印</button>' : '') +
      '<button class="btn btn-ghost btn-sm" data-act="dev-cam" ' +
        'title="' + (camTimers.has(p.id) ? '关闭本机摄像头画面（不会影响打印机）' : '在本机查看打印机摄像头画面（不影响打印任务）') + '">' +
        (camTimers.has(p.id) ? '关闭预览' : '查看摄像头') + '</button>' +
      '<button class="btn btn-ghost btn-sm' +
        ((detectState.get(p.id) || {}).running ? ' is-loading' : '') + '" data-act="dev-detect"' +
        ((detectState.get(p.id) || {}).running ? ' disabled' : '') +
        ' title="抓两张间隔约 3 秒的摄像头画面对比，看拉丝/空打/翘边；不控制打印机">' +
        detectLabel(p.id) + '</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="dev-chart" title="查看这台打印机的温度曲线">温度曲线</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="dev-test" title="测试与这台打印机的连接，不改动打印任务">测试连接</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="dev-edit" title="修改这台打印机的名称、地址与摄像头设置">编辑设备</button>' +
      '<button class="btn btn-ghost btn-sm danger" data-act="dev-remove" ' +
        'title="只从 PrintShelf 里移除这台设备，不会影响打印机本身或正在进行的打印">移除设备</button>' +
    '</div>' +
    camBlock(p) +
    (p.error && p.online ? '<p class="dev-err">' + esc(p.error) + '</p>' : '') +
  '</article>';
}

function emptyHtml() {
  return '<div class="dev-empty">' +
    '<div class="dev-empty-ic">' + icon('i-printer') + '</div>' +
    '<h3>还没有添加打印机</h3>' +
    '<p>本工具可以直连局域网里的打印机看状态，不用先打开切片软件。<br>' +
      '快造 U1 走 Moonraker（7125 端口），拓竹走局域网 MQTT（8883）。</p>' +
    '<div class="btn-row"><button class="btn btn-primary" data-act="dev-scan">扫描局域网</button>' +
    '<button class="btn btn-ghost" data-act="dev-add">手动添加</button></div>' +
    '</div>';
}

function discoveredHtml() {
  const list = st.discovered;
  if (!list) return '';
  if (!list.length) {
    return '<div class="dev-panel-block"><p class="hint">这个网段没有扫到打印机。确认打印机已开机、和电脑在同一个局域网。</p>' +
      '<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="dev-scan">再扫一次</button></div></div>';
  }
  return '<div class="dev-panel-block"><h4>扫到 ' + list.length + ' 台</h4>' +
    list.map((d) => '<div class="dev-found">' +
      '<span class="dev-found-kind">' + esc((KIND_META[d.kind] || {}).label || d.kind) + '</span>' +
      '<span class="dev-found-ip">' + esc(d.ip) + '</span>' +
      '<span class="dev-found-name">' + esc(d.name || '') + '</span>' +
      (d.added
        ? '<span class="dev-found-tag">已在列表</span>'
        : '<button class="btn btn-primary btn-sm" data-act="dev-add-found" data-ip="' + esc(d.ip) + '">添加</button>') +
    '</div>').join('') +
    '<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="dev-scan">再扫一次</button>' +
    '<button class="btn btn-ghost btn-sm" data-act="dev-close-found">收起</button></div></div>';
}

function render() {
  const body = document.getElementById('devices-body');
  if (!body) return;
  const cards = st.snap.map(cardHtml).join('');
  // 只要本机配过拓竹打印机就给「拓竹账号」入口：云端通道 + 自动补访问码都靠它
  const hasBambu = st.snap.some((p) => p && p.kind === 'bambu') ||
    (Array.isArray(st.list) && st.list.some((p) => p && p.kind === 'bambu'));
  body.innerHTML =
    '<div class="dev-toolbar">' +
      '<button class="btn btn-ghost btn-sm" data-act="dev-scan">' + icon('i-search') + '扫描局域网</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="dev-add">' + icon('i-plus') + '手动添加</button>' +
      (hasBambu ? '<button class="btn btn-ghost btn-sm" data-act="dev-bambu-account">' + icon('i-cloud') + '拓竹账号</button>' : '') +
      '<span class="dev-tip">状态每 3 秒刷新一次</span>' +
    '</div>' +
    (st.error ? '<p class="dev-err">' + esc(st.error) + '</p>' : '') +
    discoveredHtml() +
    (st.loading && !st.snap.length ? '<p class="hint">正在连接…</p>' : '') +
    (cards ? '<div class="dev-grid">' + cards + '</div>' : (st.discovered ? '' : emptyHtml()));
}

// ------------------------------------------------------------------ 数据

async function refresh() {
  try {
    const [list, snap] = await Promise.all([api.printersList(), api.printersSnapshot()]);
    st.list = list || [];
    st.snap = snap || [];
    st.error = '';
  } catch (e) {
    st.error = (e && e.message) || '读取打印机状态失败';
  }
  render();
  updateBadge();
}

async function scan() {
  if (busy) return;
  busy = true;
  render();
  const body = document.getElementById('devices-body');
  if (body) body.insertAdjacentHTML('afterbegin', '<p class="hint" id="dev-scanning">正在扫描局域网（约 3 秒）…</p>');
  try {
    st.discovered = await api.printersDiscover({});
  } catch (e) {
    st.discovered = [];
    emitToast('warn', (e && e.message) || '扫描失败');
  } finally {
    busy = false;
    const el = document.getElementById('dev-scanning');
    if (el) el.remove();
    render();
  }
}

// ------------------------------------------------------------------ 表单

function promptForm({ title, fields, confirmText }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root') || document.body;
    const back = document.createElement('div');
    back.className = 'ow-backdrop ow-in';
    back.innerHTML =
      '<div class="ow-modal dev-form" role="dialog" aria-modal="true">' +
        '<div class="ow-head"><div class="ow-title">' + esc(title) + '</div></div>' +
        fields.map((f) => '<label class="dev-field"><span>' + esc(f.label) + '</span>' +
          '<input class="input" data-k="' + esc(f.key) + '" value="' + esc(f.value || '') + '"' +
          ' placeholder="' + esc(f.ph || '') + '"></label>').join('') +
        '<div class="ow-foot">' +
          '<button type="button" class="btn btn-ghost" data-x="1">取消</button>' +
          '<button type="button" class="btn btn-primary" data-ok="1">' + esc(confirmText || '确定') + '</button>' +
        '</div>' +
      '</div>';
    root.appendChild(back);
    const finish = (v) => { back.remove(); resolve(v); };
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-x]')) return finish(null);
      if (e.target.closest('[data-ok]')) {
        const out = {};
        back.querySelectorAll('[data-k]').forEach((i) => { out[i.dataset.k] = i.value.trim(); });
        return finish(out);
      }
    });
    const first = back.querySelector('input');
    if (first) first.focus();
  });
}

async function addManual() {
  const v = await promptForm({
    title: '添加打印机',
    fields: [
      { key: 'kind', label: '类型（snapmaker 或 bambu）', value: 'snapmaker', ph: 'snapmaker / bambu' },
      { key: 'ip', label: 'IP 地址', ph: '192.168.1.100' },
      { key: 'name', label: '名称（可留空）', ph: '快造 U1' },
      { key: 'serial', label: '序列号（拓竹必填）', ph: '见打印机屏幕/设置' },
      { key: 'accessCode', label: '访问码（拓竹必填，屏幕上的 8 位）', ph: '8 位访问码' },
      { key: 'cameraUrl', label: '摄像头地址（可选，快照或 MJPEG）', ph: '留空则自动探测' },
    ],
    confirmText: '添加',
  });
  if (!v) return;
  try {
    await api.printerAdd(v);
    emitToast('success', '已添加，正在连接…');
    await refresh();
  } catch (e) { emitToast('error', (e && e.message) || '添加失败'); }
}

async function addFound(ip) {
  const d = (st.discovered || []).find((x) => x.ip === ip);
  if (!d) return;
  try {
    await api.printerAdd({ kind: d.kind, ip: d.ip, name: d.name, serial: d.serial, accessCode: d.accessCode, model: d.model });
    emitToast('success', '已添加 ' + d.name);
    await scan();
    await refresh();
  } catch (e) { emitToast('error', (e && e.message) || '添加失败'); }
}

async function editPrinter(id) {
  const p = st.list.find((x) => x.id === id);
  if (!p) return;
  const v = await promptForm({
    title: '编辑 ' + p.name,
    fields: [
      { key: 'name', label: '名称', value: p.name },
      { key: 'ip', label: 'IP 地址', value: p.ip },
      { key: 'serial', label: '序列号（拓竹）', value: p.serial },
      { key: 'accessCode', label: '访问码（拓竹）', value: p.accessCode },
      { key: 'cameraUrl', label: '摄像头地址（留空自动走机型）', value: p.cameraUrl || '', ph: 'http://192.168.1.100:8080/?action=stream' },
    ],
    confirmText: '保存',
  });
  if (!v) return;
  try {
    await api.printerUpdate(id, v);
    emitToast('success', '已保存，正在重连…');
    await refresh();
  } catch (e) { emitToast('error', (e && e.message) || '保存失败'); }
}

async function removePrinter(id) {
  const p = st.list.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmDialog({
    title: '移除设备（只删本机配置）',
    message: '把「' + p.name + '」（' + p.ip + '）从 PrintShelf 的设备列表里移除？',
    detail: '只是删除本工具保存的连接信息，不会重置打印机、也不会影响它正在进行的打印。以后可以重新添加回来。',
    confirmText: '移除设备',
    cancelText: '不移除，返回',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.printerRemove(id);
    emitToast('success', '已移除');
    await refresh();
  } catch (e) { emitToast('error', (e && e.message) || '移除失败'); }
}

async function doCommand(id, cmd) {
  const p = st.snap.find((x) => x.id === id);
  const name = (p && p.name) || '这台打印机';
  const jobName = (p && p.job && p.job.name) || '当前打印任务';
  const label = {
    pause: '暂停打印', resume: '继续打印', stop: '取消打印',
  }[cmd] || cmd;

  // 暂停会中断当前打印，必须先说清楚暂停的是什么
  if (cmd === 'pause') {
    const ok = await confirmDialog({
      title: '暂停打印任务',
      message: '要暂停「' + name + '」上的打印吗？',
      detail: '当前任务：' + jobName + '。暂停后喷头停在当前层，打印件和进度都会保留，可以再点「继续打印」从原处接着打。',
      confirmText: '暂停打印',
      cancelText: '不暂停，返回',
    });
    if (!ok) return;
  }

  // 取消打印不可恢复，做两道确认：先说清后果，再手动输入确认
  if (cmd === 'stop') {
    const first = await confirmDialog({
      title: '取消打印任务（不可恢复）',
      message: '要取消「' + name + '」上的打印吗？',
      detail: '当前任务：' + jobName + '。取消后这次打印会立即停止，打印件作废、无法接着打。这只是取消打印任务，不会关闭摄像头预览，也不会移除设备。',
      confirmText: '下一步',
      cancelText: '不取消，返回',
      danger: true,
    });
    if (!first) return;
    const typed = await promptDialog({
      title: '再次确认：取消打印',
      label: '请输入「取消打印」四个字确认（区分大小写）：',
      placeholder: '取消打印',
      confirmText: '确认取消打印',
    });
    if (String(typed || '').trim() !== '取消打印') {
      emitToast('info', '已放弃取消打印，任务继续进行');
      return;
    }
  }

  try {
    await api.printerAction(id, cmd);
    emitToast('success', '已发送「' + label + '」指令到 ' + name);
    setTimeout(refresh, 700);
  } catch (e) { emitToast('error', (e && e.message) || (label + '失败')); }
}

async function testPrinter(id) {
  emitToast('info', '正在测试连接…');
  try {
    const r = await api.printerTest(id);
    emitToast(r.ok ? 'success' : 'error', r.message || (r.ok ? '连接正常' : '连接失败'));
  } catch (e) { emitToast('error', (e && e.message) || '测试失败'); }
}

// ------------------------------------------------------------------ 事件

function onClick(e) {
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node) return;
  const act = node.dataset.act;
  const card = node.closest('.dev-card');
  const id = card ? card.dataset.id : (node.dataset.id || '');
  switch (act) {
    case 'dev-scan': return scan();
    case 'dev-bambu-account': return openBambuAccount();
    case 'dev-add': return addManual();
    case 'dev-add-found': return addFound(node.dataset.ip);
    case 'dev-close-found': st.discovered = null; return render();
    case 'dev-test': return testPrinter(id);
    case 'dev-edit': return editPrinter(id);
    case 'dev-remove': return removePrinter(id);
    case 'dev-cmd': return doCommand(id, node.dataset.cmd);
    default: return;
  }
}

export function mountDevices() {
  if (mounted) return;
  mounted = true;
  const panel = document.getElementById('devices-panel');
  if (panel) panel.addEventListener('click', onClick);
  // 摄像头/检测走独立监听，不动既有的 onClick 分支
  if (panel) panel.addEventListener('click', onCamClick);
  const close = document.getElementById('devices-close');
  if (close) close.addEventListener('click', () => closeDevices());
  // 主进程推来的增量状态：直接替换对应卡片的数据，不整块重拉
  window.addEventListener('printers:update', (e) => {
    const p = e.detail;
    if (!p || !p.id) return;
    const i = st.snap.findIndex((x) => x.id === p.id);
    if (i >= 0) st.snap[i] = p; else st.snap.push(p);
    if (open) render();
    updateBadge();
  });
  window.addEventListener('printers:changed', () => { if (open) refresh(); });
  // 启动时先拉一次，工具栏角标才有数
  refresh().then(updateBadge).catch(() => {});
}

export function openDevices() {
  const panel = document.getElementById('devices-panel');
  if (!panel) return;
  panel.hidden = false;
  open = true;
  render();
  refresh();
}

export function closeDevices() {
  const panel = document.getElementById('devices-panel');
  if (panel) panel.hidden = true;
  open = false;
  stopAllCams();
}

export function isDevicesOpen() {
  const panel = document.getElementById('devices-panel');
  return !!panel && !panel.hidden;
}

/** 工具栏小角标：有几台在打印 */
function updateBadge() {
  const btn = document.getElementById('btn-devices');
  if (!btn) return;
  const printing = st.snap.filter((p) => p.state === 'printing').length;
  const dot = btn.querySelector('.dev-badge');
  if (!dot) return;
  dot.textContent = printing ? String(printing) : '';
  dot.hidden = !printing;
}

// ---------- 机内摄像头 / 打印机检测 ----------

function onCamClick(e) {
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node) return;
  const act = node.dataset.act;
  if (act !== 'dev-cam' && act !== 'dev-detect' && act !== 'dev-chart') return;
  const card = node.closest('.dev-card');
  const id = card ? card.dataset.id : '';
  if (!id) return;
  e.stopPropagation();
  if (act === 'dev-cam') { toggleCam(id); return; }
  if (act === 'dev-chart') {
    const p = st.snap.find((x) => x.id === id);
    openMonitorChart(id, p ? p.name : '打印机');
    return;
  }
  const d = detectState.get(id);
  if (d && d.running) return;
  if (d && d.shots && d.shots.length) { showDetect(id); return; }
  startDetect(id);
}

/** 取帧诊断：只留最近 40 条，命名与其它 __printshelf* 诊断字段一致，不留无限增长的调试日志 */
function camLog(entry) {
  const log = (window.__printshelfCam = window.__printshelfCam || []);
  log.push(Object.assign({ t: Date.now() }, entry));
  if (log.length > 40) log.shift();
}

async function grabFrame(id) {
  try {
    const r = await api.cameraFrame(id);
    camLog({
      id, ok: !!(r && r.ok), len: r && r.base64 ? r.base64.length : 0,
      stale: r && r.staleSec, source: r && r.source, notice: r && r.notice,
    });
    if (r && r.ok && r.base64) {
      camFrames.set(id, 'data:image/jpeg;base64,' + r.base64);
      camMeta.set(id, {
        staleSec: r.staleSec || 0,
        source: r.source || '',
        static: !!r.static,
        notice: r.notice || '',
      });
      camErrors.delete(id);
      camLoading.delete(id);
      repaintCam(id);
      return true;
    }
    return false;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    camLog({ id, error: msg });
    camErrors.set(id, msg);
    camLoading.delete(id);
    // 取不到就停掉循环，避免每 1.2 秒反复失败刷日志
    stopCamTimer(id);
    repaintCam(id);
    return false;
  }
}

/** 只停轮询，保留最后一帧 */
function stopCamTimer(id) {
  const t = camTimers.get(id);
  if (t) clearTimeout(t);
  camTimers.delete(id);
}

/** 关画面：停轮询 + 丢掉画面，卡片回到「点摄像头查看」——按钮写着关闭就该真的消失 */
function stopCam(id) {
  stopCamTimer(id);
  camFrames.delete(id);
  camMeta.delete(id);
  camErrors.delete(id);
  camLoading.delete(id);
  repaintCam(id);
}

function repaintCam(id) {
  const card = document.querySelector('.dev-card[data-id="' + id + '"]');
  if (!card) return;
  const box = card.querySelector('.dev-cam');
  const p = st.snap.find((x) => x.id === id) || { id };
  if (box) box.outerHTML = camBlock(p);
  const btn = card.querySelector('[data-act="dev-cam"]');
  if (btn) btn.textContent = camTimers.has(id) ? '关闭画面' : '摄像头';
}

async function toggleCam(id) {
  if (camTimers.has(id)) {
    stopCam(id);
    return;
  }
  camTimers.set(id, null);          // 先占位，避免连点开两个循环
  camLoading.set(id, true);         // 立刻给出等待反馈，别让用户以为按钮没反应
  repaintCam(id);
  await camLoop(id);
}

/** 抓一帧要 3~6 秒，用「抓完再排下一次」而不是 setInterval，否则请求会越积越多 */
async function camLoop(id) {
  await grabFrame(id);
  if (!camTimers.has(id)) return;   // 期间被关掉了
  camTimers.set(id, setTimeout(() => camLoop(id), 1200));
}

function stopAllCams() {
  for (const t of camTimers.values()) if (t) clearTimeout(t);
  camTimers.clear();
  // 面板关掉后不留旧画面：下次打开是干净的「点摄像头查看」
  camFrames.clear();
  camMeta.clear();
  camErrors.clear();
  camLoading.clear();
}

function repaintDetect(id) {
  const card = document.querySelector('.dev-card[data-id="' + id + '"]');
  if (!card) return;
  const btn = card.querySelector('[data-act="dev-detect"]');
  if (!btn) return;
  const d = detectState.get(id);
  btn.disabled = !!(d && d.running);
  btn.classList.toggle('is-loading', !!(d && d.running));
  btn.textContent = detectLabel(id);
}

async function startDetect(id) {
  // 别叫 st：模块顶部的 st 是设备面板的数据容器，遮蔽它以后改代码极易踩坑
  const job = { running: true, left: 10, shots: [] };
  detectState.set(id, job);
  repaintDetect(id);
  const tick = setInterval(() => {
    job.left = Math.max(0, job.left - 1);
    repaintDetect(id);
  }, 1000);
  try {
    const r = await api.cameraDetect(id);
    if (r && r.shots && r.shots.length) {
      job.shots = r.shots;
      job.staleSec = r.staleSec || 0;
    } else emitToast('warn', '没有取到画面，检查打印机是否开机、访问码是否正确');
  } catch (e) {
    emitToast('error', (e && e.message) || '检测失败');
  }
  clearInterval(tick);
  job.running = false;
  repaintDetect(id);
  // 检测完直接弹结果：按钮点下去就该看到画面，不该再要求点第二次
  if (job.shots.length) {
    emitToast('success', '检测完成');
    showDetect(id);
  }
}

function showDetect(id) {
  const d = detectState.get(id);
  if (!d || !d.shots.length) return;
  const imgs = d.shots
    .map((b) => '<img src="data:image/jpeg;base64,' + b + '" alt="检测画面">')
    .join('');
  const stale = Number(d.staleSec) > 120;
  customDialog({
    title: '打印机检测 · 两张间隔约 3 秒',
    body: '<div class="detect-grid">' + imgs + '</div>' +
      (stale
        ? '<p class="modal-detail dev-stale-warn">这两张来自打印机上的静态快照，画面停在 ' +
          esc(agoText(d.staleSec)) + '，说明摄像头当前没有在出流（可能没插好或没启动）。</p>'
        : '') +
      '<p class="modal-detail">重点看：有没有拉丝成团（炒面）、喷头空走没出料（空打）、模型是否翘边脱落。</p>',
    foot: '<button type="button" class="btn btn-ghost" data-det-close>关闭</button>',
    width: '760px',
    onMount(modal, close) {
      const btn = modal.querySelector('[data-det-close]');
      if (btn) btn.addEventListener('click', () => close(null));
    },
  })
    // 关闭检测弹窗 = 结束这次检查：顺带把卡片上的实时画面也收起来。
    // 用户的原话是「点击关闭后，那张图就应该消失」，三条关闭路径（按钮 / Esc / 遮罩）都要生效。
    .then(() => stopCam(id))
    .catch(() => {});
}

export function refreshDeviceBadge() {
  refresh().then(updateBadge).catch(() => {});
}
