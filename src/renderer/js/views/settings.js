'use strict';
import { t as tr, setLanguage } from '../i18n.js';
import { applyMakerWorldLinks } from '../components/site-links.js';

/**
 * 设置页：目录 / 切片软件 / 外观 / 数据 / 关于 5 个 tab。
 * 所有内容使用统一 .settings-section/.form-row/.field/.switch 结构；变更后立即应用并持久化。
 */
import { api, emitRefresh, emitToast } from '../api.js';
import { state, setState } from '../state.js';
import { escapeHtml, icon, fmtBytes, fmtDate } from '../utils.js';
import { confirmDialog, selectDialog, customDialog } from '../components/modal.js';
import { applySidebar } from '../components/sidebar-state.js';
import { applyIconSet } from '../components/icon-set.js';
import { applyMotionPrefs, enterView } from '../components/motion.js';
import { openMonitorChart } from '../components/monitorchart.js';
import { startOnboarding, startGuide } from '../components/onboarding.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const el = (id) => document.getElementById(id);
const toastErr = (e) => emitToast('error', (e && e.message) || tr('操作失败'));

const TABS = [
  { key: 'folders',    label: tr('监控目录'), icon: 'i-folder' },
  { key: 'slicers',    label: tr('切片软件'), icon: 'i-printer' },
  { key: 'appearance', label: tr('外观'),     icon: 'i-sun' },
  { key: 'monitor',    label: tr('打印监控'), icon: 'i-printer' },
  { key: 'classify',   label: tr('自动分类'), icon: 'i-sparkle' },
  { key: 'data',       label: tr('数据管理'), icon: 'i-hard-drive' },
  { key: 'about',      label: tr('关于'),     icon: 'i-info' },
];

let mounted = false;
let currentTab = 'folders';

// 快造 U1 预设信息（进入「切片软件」页时异步拉一次）
let u1Info = null;
let u1Loading = false;

// 预设保护状态 / .3mf 文件关联状态（同样懒加载）
let presetHealth = null;
let presetLoading = false;
let fileAssoc = null;
let fileAssocLoading = false;

// 打印监控历史统计（进入「打印监控」页时异步拉一次）
let monitorStatus = null;

// ---------- 通用 HTML 构造 ----------
function sec(title, inner) {
  return '<section class="settings-section"><h3 class="settings-section-title">' + esc(title) + '</h3>' + inner + '</section>';
}
function row(inner) { return '<div class="form-row">' + inner + '</div>'; }
function field(label, control, hint) {
  return '<label class="field"><span class="field-label">' + esc(label) + '</span>' + control +
    (hint ? '<span class="field-hint">' + esc(hint) + '</span>' : '') + '</label>';
}
function sw(label, checked, attrs) {
  return '<label class="switch"><input type="checkbox"' + (checked ? ' checked' : '') + ' ' + attrs + '>' +
    '<span class="switch-track"></span><span class="switch-label">' + esc(label) + '</span></label>';
}
function actionBtn(act, ico, label, cls) {
  return '<button type="button" class="' + (cls || 'btn btn-ghost btn-sm') + '" data-act="' + act + '">' +
    (ico ? icon(ico) : '') + '<span>' + esc(label) + '</span></button>';
}
function opt(v, label, cur) {
  return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
}

// ---------- 各 tab 渲染 ----------
function folderRow(f) {
  return '<div class="folder-row">' +
    '<div class="folder-main">' + icon('i-folder') +
      '<div><div class="mono">' + esc(f.path) + '</div>' +
        tr('<div class="muted">上次扫描：') + esc(f.lastScanAt ? fmtDate(f.lastScanAt) : tr('从未')) +
        ' · ' + (f.recursive ? tr('递归') : tr('仅本层')) + '</div></div></div>' +
    '<div class="folder-ctrls">' +
      sw(tr('启用'), f.enabled !== false, 'data-folder-toggle="enabled" data-id="' + esc(f.id) + '"') +
      sw(tr('递归'), !!f.recursive, 'data-folder-toggle="recursive" data-id="' + esc(f.id) + '"') +
      '<button type="button" class="icon-btn danger" data-act="folder-remove" data-id="' + esc(f.id) + tr('" title="移除目录">') + icon('i-trash') + '</button>' +
    '</div></div>';
}

function renderFolders() {
  const folders = state.folders || (state.settings && state.settings.folders) || [];
  const scan = (state.settings && state.settings.scan) || {};
  const list = folders.length
    ? folders.map(folderRow).join('')
    : tr('<div class="empty">还没有监控目录，点击下方按钮添加。</div>');
  return sec(tr('监控目录'),
      '<div class="folder-list">' + list + '</div>' +
      '<div class="btn-row">' +
        actionBtn('add-folder', 'i-plus', tr('添加目录'), 'btn btn-primary btn-sm') +
        actionBtn('scan-all', 'i-refresh', tr('扫描全部')) +
      '</div>'
    ) +
    sec(tr('扫描选项'),
      row(field(tr('排除目录名（逗号分隔）'),
        '<input class="input" data-bind="scan.excludeDirs" data-kind="csv" value="' +
        esc((scan.excludeDirs || []).join(', ')) + tr('" placeholder="例如：temp, backup, old">'))) +
      row(
        field(tr('最大递归深度'), '<input class="input" type="number" min="1" max="32" data-bind="scan.maxDepth" data-kind="number" value="' +
          esc(scan.maxDepth != null ? scan.maxDepth : 12) + '">') +
        field(tr('并发数'), '<input class="input" type="number" min="1" max="16" data-bind="scan.concurrency" data-kind="number" value="' +
          esc(scan.concurrency != null ? scan.concurrency : 4) + '">')
      ) +
      row(
        sw(tr('自动监视目录变化'), scan.autoWatch !== false, 'data-bind="scan.autoWatch" data-kind="bool"') +
        sw(tr('计算内容哈希（精确去重）'), scan.hashEnabled !== false, 'data-bind="scan.hashEnabled" data-kind="bool"')
      ) +
      row(
        sw(tr('后台计算几何指纹（识别同款变体）'), scan.shapePrint !== false, 'data-bind="scan.shapePrint" data-kind="bool"')
      ) +
      row(
        sw(tr('文件被删除后直接移出模型库'), scan.dropMissing !== false, 'data-bind="scan.dropMissing" data-kind="bool"')
      ) +
      '<p class="hint">' + tr('开启后：在资源管理器里删掉 3MF，下次扫描或监控到删除时会直接把这条记录移出模型库（不再出现在「失效文件」，也不计数）。关闭后：保留为「失效文件」，可以重新定位，备注、分类和打印记录都不会丢。注意：移动或重命名文件在开启时会被当作「旧文件已删除」，备注等人工字段不会跟着走。') + '</p>'
    ) +
    sec(tr('隔离区'),
      row(field(tr('隔离目录'),
        '<input class="input" data-bind="quarantine.dir" data-kind="string" value="' +
        esc((state.settings && state.settings.quarantine && state.settings.quarantine.dir) || '') +
        tr('" placeholder="留空则用数据目录下的 quarantine">'),
        tr('损坏文件「移入隔离区」后会移动到这里，扫描器不会扫描它。')))
    );
}

function slicerRow(s) {
  return '<div class="slicer-row">' +
    '<div class="slicer-head">' +
      '<label class="switch"><input type="radio" name="slicer-default"' + (s.isDefault ? ' checked' : '') +
        ' data-act="slicer-default" data-id="' + esc(s.id) + '"><span class="switch-label">' + esc(s.name) + tr('（设为默认）</span></label>') +
      '<span class="badge">' + esc(s.detected ? tr('自动探测') : tr('手动添加')) + '</span>' +
    '</div>' +
    '<div class="mono slicer-path">' + esc(s.exePath || '') + '</div>' +
    '<div class="form-row">' +
      field(tr('启动参数'), '<input class="input" data-slicer-args data-id="' + esc(s.id) + '" value="' +
        esc(s.args || '') + tr('" placeholder="可选，如 --slice">')) +
      sw(tr('启用'), s.enabled !== false, 'data-slicer-toggle="enabled" data-id="' + esc(s.id) + '"') +
    '</div>' +
    '<div class="btn-row">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="slicer-validate" data-id="' + esc(s.id) + '">' +
        icon('i-check') + tr('<span>校验 / 测试启动</span></button>') +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-act="slicer-remove" data-id="' + esc(s.id) + '">' +
        icon('i-trash') + tr('<span>移除</span></button>') +
      '<span class="validate-result" data-role="validate-' + esc(s.id) + '"></span>' +
    '</div></div>';
}

function renderSlicers() {
  const slicers = state.slicers || (state.settings && state.settings.slicers) || [];
  const list = slicers.length
    ? slicers.map(slicerRow).join('')
    : tr('<div class="empty">尚未配置切片软件，可一键探测或手动添加。</div>');
  return sec(tr('切片软件'),
      '<div class="btn-row">' + actionBtn('detect-slicers', 'i-search', tr('一键探测'), 'btn btn-primary btn-sm') + '</div>' +
      '<div class="slicer-list">' + list + '</div>' +
      tr('<p class="hint">提示：选中模型后点击「用切片软件打开」即可送入切片软件。</p>')
    ) +
    sec(tr('手动添加'),
      row(
        field(tr('名称'), tr('<input class="input" id="slicer-new-name" placeholder="例如：OrcaSlicer">')) +
        field(tr('可执行文件路径'), '<input class="input" id="slicer-new-path" placeholder="C:\\Program Files\\...\\xxx.exe">')
      ) +
      '<div class="btn-row">' +
        actionBtn('slicer-pick-exe', 'i-folder-open', tr('浏览…')) +
        actionBtn('slicer-add', 'i-plus', tr('添加'), 'btn btn-primary btn-sm') +
      '</div>' +
      tr('<p class="hint">也可以直接粘贴安装目录（例如 C:\\Program Files\\Snapmaker_Orca），会自动找出里面的可执行文件。</p>')
    ) +
    renderU1();
}

// ---------- 快造 U1 转换 ----------
function u1Select(kind, cur, list, emptyLabel) {
  const opts = ['<option value="">' + esc(emptyLabel) + '</option>'];
  for (const p of list) {
    opts.push('<option value="' + esc(p.name) + '"' + (p.name === cur ? ' selected' : '') + '>' +
      esc(p.name) + (p.inherits ? tr('（继承 ') + esc(p.inherits) + '）' : '') + '</option>');
  }
  return '<select class="input" data-u1="' + kind + '">' + opts.join('') + '</select>';
}

function renderU1() {
  if (u1Loading && !u1Info) {
    return sec(tr('快造 U1 转换'), tr('<p class="hint">正在读取快造预设…</p>'));
  }
  if (!u1Info) {
    return sec(tr('快造 U1 转换'),
      tr('<p class="hint">尚未读取到快造 Orca 的预设。请确认已安装快造 Orca 并在上方添加。</p>') +
      '<div class="btn-row">' + actionBtn('u1-refresh', 'i-refresh', tr('重新读取')) + '</div>');
  }

  const cur = (u1Info.settings || {});
  const filaments = u1Info.filaments || [];
  const processes = u1Info.processes || [];
  const sum = u1Info.filamentSummary;
  const cache = u1Info.cache || { count: 0, bytes: 0 };

  const summaryLine = sum
    ? tr('解析结果：') + esc(sum.material || '—') + tr(' · 喷嘴 ') + esc(sum.nozzle || '—') + '°C' +
      tr(' · 热床 ') + esc(sum.bed || '—') + '°C' + (sum.flow ? tr(' · 流量 ') + esc(sum.flow) : '')
    : (cur.filamentPreset ? tr('预设已选中，但没能解析出参数（会只写入名字）') : tr('不选则沿用 U1 样板自带的耗材参数'));

  const openWith = cur.openWith || 'ask';
  const keepAll = cur.keepAllColours !== false;
  const owOpts = [
    ['ask', tr('每次询问（推荐）')],
    ['bambu', tr('总是用拓竹打开')],
    ['orca-official-direct', tr('总是用官方 Orca 打开（原文件）')],
    ['snapmaker', tr('总是用 Orca 打开（快造 U1）')],
    ['orca-official', tr('总是转换后用官方 Orca 打开')],
  ].map(([v, l]) => '<option value="' + v + '"' + (v === openWith ? ' selected' : '') + '>' + l + '</option>').join('');

  const orcaLine = u1Info.orcaDir
    ? tr('<p class="hint">快造 Orca：') + esc(u1Info.orcaDir) + '</p>'
    : tr('<p class="hint">⚠ 没有找到快造 Orca 安装目录，预设无法解析。可在上方「一键探测」或手动添加。</p>');

  return sec(tr('快造 U1 转换'),
    tr('<p class="hint">把拓竹下载的 3MF 转换成快造 U1 能正确切片的格式。转换产物放在本地缓存里，<b>原文件不会被改动</b>。</p>') +
    row(
      field(tr('耗材预设'), u1Select('filamentPreset', cur.filamentPreset, filaments, tr('不指定（沿用 U1 样板）')), summaryLine) +
      field(tr('进程预设'), u1Select('processPreset', cur.processPreset, processes, tr('不指定（U1 样板 0.20mm）')),
        tr('选中后会把该预设的参数一并写进配置'))
    ) +
    row(field(tr('打开模型时'), '<select class="input" data-u1="openWith">' + owOpts + '</select>',
      tr('「每次询问」会在打开时弹一句，可勾选记住；官方 Orca 需先装 Snapmaker U1 共享配置'))) +
    row(field(tr('颜色超过 4 色时'),
      '<select class="input" data-u1="keepAllColours">' +
        '<option value="1"' + (keepAll ? ' selected' : '') + tr('>保留全部颜色（推荐）</option>') +
        '<option value="0"' + (keepAll ? '' : ' selected') + tr('>自动压到 4 色</option>') +
      '</select>',
      tr('U1 只有 4 个工具头：保留全部颜色时，多出来的颜色要在 Orca 里手动换料；自动压色能直接打，但可能把某种颜色并掉'))) +
    orcaLine +
    '<div class="btn-row">' +
      actionBtn('u1-open-cache', 'i-folder-open', tr('打开缓存目录')) +
      actionBtn('u1-clear-cache', 'i-trash', tr('清空缓存（') + fmtBytes(cache.bytes || 0) + '）', 'btn btn-ghost btn-sm danger') +
      actionBtn('u1-refresh', 'i-refresh', tr('重新读取预设')) +
    '</div>'
  ) + renderPresetGuard() + renderFileAssoc();
}

// ---------- 预设保护 ----------
/**
 * 为什么需要这一块：拓竹的耗材预设跟着拓竹账号云同步，快造默认不同步
 * （配置里 sync_user_preset=false），本机 user/default 那份就是世界上唯一一份。
 * 那份还很容易被冲掉：父预设被 OTA 改名就变孤儿、升级重建目录、重装换机……
 * 所以这里把预设定期快照到本地，能体检、能一键还原。
 */
function renderPresetGuard() {
  const g = presetHealth;
  if (!g) {
    return sec(tr('预设保护（快造用户预设）'), tr('<p class="hint">正在检查…</p>') +
      '<div class="btn-row">' + actionBtn('preset-check', 'i-refresh', tr('重新检查')) + '</div>');
  }
  if (g.ok === false) {
    return sec(tr('预设保护（快造用户预设）'),
      tr('<p class="hint">检查失败：') + esc(g.error || tr('未知原因')) + '</p>' +
      '<div class="btn-row">' + actionBtn('preset-check', 'i-refresh', tr('重新检查')) + '</div>');
  }

  const c = g.counts || {};
  const sync = g.cloudSync || {};
  const latest = g.latest;
  const broken = g.broken || [];
  const foreign = (g.foreign || []).filter((f) => f.presets > 0);

  const syncLine = sync.known
    ? (sync.enabled
      ? tr('云同步：<b>开着</b> —— 预设会跟着快造账号走。')
      : tr('云同步：<b class="warn-text">关着</b> —— 预设只存在本机这一份，快造云端没有副本。'))
    : tr('云同步：读不到快造配置，按「不同步」处理。');

  const backupLine = latest
    ? tr('最近一次备份：') + esc(fmtDate(latest.at)) + '（' + esc(latest.reason || '') + '，' + (latest.files || 0) + tr(' 个文件，') +
      fmtBytes(latest.bytes || 0) + '）'
    : tr('<b class="warn-text">还没有备份过</b>，点下面的「立即备份」留一份。');

  const brokenHtml = broken.length
    ? tr('<div class="hint warn-block">⚠ 有 ') + broken.length + tr(' 个预设的继承链断了，快造里会看不到它们：') +
      '<ul>' + broken.map((b) => '<li>' + esc(b.name) + '（' + esc(b.kind) + '）' +
        (b.missing.length ? tr(' 缺少：') + esc(b.missing.join('、')) : '') + '</li>').join('') + '</ul></div>'
    : '';

  const foreignHtml = foreign.length
    ? tr('<p class="hint">检测到原版 <b>') + foreign.map((f) => esc(f.app)).join('、') + tr('</b> 的预设目录（共 ')
      + foreign.reduce((s, f) => s + (f.presets || 0), 0)
      + tr(' 个预设）。它是另一个程序，<b>不会被读取</b>，也不会和快造混在一起。</p>')
    : '';

  const backupOpts = (g.backups || []).map((b) =>
    '<option value="' + esc(b.id) + '">' + esc(b.id) + ' · ' + esc(b.reason || '') + ' · ' + (b.files || 0) + tr(' 个</option>')
  ).join('');

  return sec(tr('预设保护（快造用户预设）'),
    tr('<p class="hint">当前用户预设：耗材 <b>') + (c.filament || 0) + tr('</b> 个 · 工艺 <b>') + (c.process || 0) + tr('</b> 个 · 机型 <b>') + (c.machine || 0) + tr('</b> 个。') +
      syncLine + '</p>' +
    (g.userRoot ? tr('<p class="hint">位置：') + esc(g.userRoot) + '</p>' : '') +
    '<p class="hint">' + backupLine + '</p>' +
    brokenHtml + foreignHtml +
    '<div class="btn-row">' +
      actionBtn('preset-snapshot', 'i-save', tr('立即备份'), 'btn btn-primary btn-sm') +
      actionBtn('preset-check', 'i-search', tr('重新检查')) +
      actionBtn('preset-open', 'i-folder-open', tr('打开备份目录')) +
    '</div>' +
    (backupOpts
      ? row(field(tr('从备份恢复'), '<select class="input" id="preset-restore-id">' + backupOpts + '</select>',
          tr('只会新增和覆盖，不会删除现有预设；恢复前会先把当前状态再备份一次')) +
        '<div class="btn-row">' + actionBtn('preset-restore', 'i-refresh', tr('恢复这份'), 'btn btn-ghost btn-sm') + '</div>')
      : '')
  );
}

// ---------- .3mf 打开方式 ----------
function renderFileAssoc() {
  const a = fileAssoc;
  if (!a) {
    return sec(tr('双击 .3mf 用哪个程序打开'), tr('<p class="hint">正在检查文件关联…</p>') +
      '<div class="btn-row">' + actionBtn('assoc-check', 'i-refresh', tr('重新检查')) + '</div>');
  }
  const curExe = a.defaultExe ? String(a.defaultExe).replace(/\\/g, '/').split('/').pop() : '';
  const curLine = a.defaultExe
    ? tr('当前默认：<b>') + esc(curExe) + '</b>' + (a.defaultExists ? '' : tr(' <b class="warn-text">（文件不存在）</b>')) +
      '<br><span class="mono-sm">' + esc(a.defaultExe) + '</span>'
    : tr('当前没有可用的默认程序（双击会弹「打开方式」）。');

  const candRows = (a.candidates || []).map((c) => {
    const bad = c.exists === false || c.isStoreOrca;
    const missing = c.exists === false;
    return '<li' + (bad ? ' class="warn-text"' : '') + '>' + esc(c.name) +
      (c.isStoreOrca ? tr(' <b>（商店版原版 OrcaSlicer，非快造，启动即崩溃）</b>') : '') +
      (missing ? tr(' <b>（文件不存在）</b>') : '') + '</li>';
  }).join('');

  const problems = (a.problems || []).map((p) => '<p class="hint warn-text">⚠ ' + esc(p.message) + '</p>').join('');

  const dangling = (a.problems || []).find((p) => p.code === 'progid-dangling');
  const fixBtn = dangling
    ? actionBtn('assoc-fix', 'i-wrench', tr('修好（指回真实的处理器）'), 'btn btn-primary btn-sm')
    : '';

  const useBtns = (a.suggestions || []).map((s) =>
    '<button type="button" class="btn btn-ghost btn-sm" data-act="assoc-use" data-target="'
      + (s.exePath && /snapmaker/i.test(s.exePath) ? 'snapmaker' : 'bambu') + '">' + esc(s.label) + '</button>'
  ).join('');

  return sec(tr('双击 .3mf 用哪个程序打开'),
    '<p class="hint">' + curLine + '</p>' +
    (a.userChoice ? tr('<p class="hint">系统里记着一次显式选择：') + esc(a.userChoice) + '</p>' : '') +
    problems +
    (candRows ? tr('<p class="hint">「打开方式」里的候选：</p><ul class="hint">') + candRows + '</ul>' : '') +
    '<div class="btn-row">' + fixBtn + useBtns + '</div>' +
    tr('<p class="hint">修复会写 HKCU 的类注册（不需要管理员）。Windows 的「默认应用」选择带防篡改校验，') +
      tr('如果修完还不生效，就点下面的按钮到系统设置里手动点一次，找到 <b>.3mf</b> 选你要的程序。</p>') +
    '<div class="btn-row">' +
      actionBtn('assoc-open-settings', 'i-gear', tr('打开系统默认应用设置')) +
      actionBtn('assoc-check', 'i-refresh', tr('重新检查')) +
    '</div>'
  );
}

function renderAppearance() {
  const ui = (state.settings && state.settings.ui) || {};
  const theme = ui.theme || state.theme || 'light';
  const view = ui.view || state.view || 'grid';
  const size = ui.cardSize != null ? ui.cardSize : (state.cardSize || 220);
  const density = ui.density || 'comfortable';
  const showStats = ui.showStats !== false;
  const collapsed = !!ui.sidebarCollapsed;
  const iconSet = ui.iconSet === 'legacy' ? 'legacy' : 'lucide';
  const motion = ['full', 'reduced', 'off'].indexOf(ui.motionLevel) >= 0 ? ui.motionLevel : 'full';
  // 系统级「减少动态效果」会把档位降到 reduced，但设置页显示的仍是用户存的档。
  // 不解释一句的话，用户会觉得「选了完整却没动效」是 bug。
  const sysReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const followSystem = ui.motionFollowSystem === true;
  const language = ui.language === 'en-US' ? 'en-US' : 'zh-CN';
  const region = ['auto', 'cn', 'global'].includes(ui.makerWorldRegion) ? ui.makerWorldRegion : 'auto';
  return sec(tr('外观'),
    row(
      field(tr('主题'), '<select class="select" data-bind="ui.theme" data-kind="string">' +
        opt('light', tr('浅色'), theme) + opt('dark', tr('深色'), theme) + opt('system', tr('跟随系统'), theme) + '</select>') +
      field(tr('默认视图'), '<select class="select" data-bind="ui.view" data-kind="string">' +
        opt('grid', tr('网格'), view) + opt('list', tr('列表'), view) + '</select>')
    ) +
    row(
      field(tr('卡片尺寸'), '<input class="input" type="range" min="140" max="340" step="10" data-bind="ui.cardSize" data-kind="number" value="' + esc(size) + '">') +
      field(tr('界面密度'), '<select class="select" data-bind="ui.density" data-kind="string">' +
        opt('comfortable', tr('宽松'), density) + opt('compact', tr('紧凑'), density) + '</select>')
    ) +
    row(
      sw(tr('显示统计条'), showStats, 'data-bind="ui.showStats" data-kind="bool"') +
      sw(tr('侧栏默认折叠'), collapsed, 'data-bind="ui.sidebarCollapsed" data-kind="bool"')
    ) +
    row(
      field(tr('图标风格'), '<select class="select" data-bind="ui.iconSet" data-kind="string">' +
        opt('lucide', tr('统一线性图标'), iconSet) + opt('legacy', tr('经典自绘图标'), iconSet) + '</select>') +
      field(tr('界面动效'), '<select class="select" data-bind="ui.motionLevel" data-kind="string">' +
        opt('full', tr('完整'), motion) + opt('reduced', tr('精简'), motion) + opt('off', tr('关闭'), motion) + '</select>')
    ) +
    row(
      field(tr('language.label'), '<select class="select" data-bind="ui.language" data-kind="string">' +
        opt('zh-CN', tr('language.zh'), language) + opt('en-US', tr('language.en'), language) + '</select>') +
      field(tr('settings.makerWorldRegion'), '<select class="select" data-bind="ui.makerWorldRegion" data-kind="string">' +
        opt('auto', tr('settings.makerWorldAuto'), region) +
        opt('cn', tr('settings.makerWorldCn'), region) +
        opt('global', tr('settings.makerWorldGlobal'), region) + '</select>')
    ) +
    row(
      sw(tr('跟随系统「减少动态效果」'), followSystem, 'data-bind="ui.motionFollowSystem" data-kind="bool"')
    ) +
    tr('<p class="hint">外观设置会立即生效并保存到本机。') +
      (followSystem && sysReduced
        ? tr('已跟随系统：系统关闭了动画，应用降到精简档（只保留淡入，不做位移与转场）。')
        : (!followSystem && sysReduced
          ? tr('系统当前关闭了「显示动画」，但应用按你选的档位播放（默认如此，和多数桌面软件一致）。') +
            tr('如果反而觉得晃眼，可以打开「跟随系统」或把界面动效设为关闭。')
          : tr('动效按你选的档位播放：视图切换与状态反馈都是不超过 220ms 的短促过渡。'))) +
      tr('「经典自绘图标」配合关闭动效可一键回到本次美化前的界面。') +
      tr('MakerWorld 站点选「跟随界面语言」时，英文界面打开国际站、中文界面打开中国站；') +
      tr('两个站是独立的模型库，ID 不通用，找不到对应模型时会自动回退到另一个站并提示。</p>')
  ) +
  sec(tr('搜索'),
    row(sw(tr('启用自然语言搜索'), ((state.settings && state.settings.search) || {}).naturalLanguage !== false,
      'data-bind="search.naturalLanguage" data-kind="bool"')) +
    '<p class="hint">' + tr('开启后可以直接在搜索框里说条件，例如「上个月打印过的绿色收纳盒」「大于 50MB 的双色模型」，回车后条件会变成可移除的筛选标签。解析完全在本机完成，不联网；认不出来的词仍按普通关键字搜索。') + '</p>'
  );
}

// ---------- 打印监控（常驻条 / 通知 / 曲线） ----------
function renderMonitor() {
  const ui = (state.settings && state.settings.ui) || {};
  const m = Object.assign({ enabled: true, intervalSec: 15, keepSessions: 24 },
    (state.settings && state.settings.monitor) || {});
  const n = Object.assign({ enabled: true, onFinished: true, onError: true, onPaused: true, system: true },
    (state.settings && state.settings.notify) || {});
  const inv = Object.assign({ lowStockNotify: true }, (state.settings && state.settings.inventory) || {});
  const statLine = monitorStatus
    ? tr('本机已记录 ') + monitorStatus.sessions + tr(' 次打印、') + monitorStatus.points + tr(' 个采样点，') +
      tr('采样间隔 ') + monitorStatus.intervalSec + tr(' 秒。文件：') + esc(monitorStatus.file)
    : tr('正在读取本机记录…');

  return sec(tr('主界面常驻监控条'),
      row(sw(tr('在模型列表上方常驻显示打印机状态'), ui.monitorBar !== false,
        'data-bind="ui.monitorBar" data-kind="bool"')) +
      tr('<p class="hint">不用每次打开「设备」弹窗，进度、喷嘴/热床温度、剩余时间一直挂在列表上方。') +
        tr('点卡片可打开设备面板，点「曲线」回看这次打印的温度变化。没配置打印机时这一条会自动隐藏。</p>')
    ) +
    sec(tr('完成与异常通知'),
      row(
        sw(tr('开启打印提醒'), n.enabled !== false, 'data-bind="notify.enabled" data-kind="bool"') +
        sw(tr('同时弹系统通知'), n.system !== false, 'data-bind="notify.system" data-kind="bool"')
      ) +
      row(
        sw(tr('打印完成时提醒我'), n.onFinished !== false, 'data-bind="notify.onFinished" data-kind="bool"') +
        sw(tr('打印报错时提醒我'), n.onError !== false, 'data-bind="notify.onError" data-kind="bool"')
      ) +
      row(
        sw(tr('打印中突然暂停时提醒我（多半是断料）'), n.onPaused !== false,
          'data-bind="notify.onPaused" data-kind="bool"')
      ) +
      '<div class="btn-row">' + actionBtn('notify-test', 'i-info', tr('发一条测试通知')) + '</div>' +
      tr('<p class="hint">同一个任务的同一种提醒只发一次；打印机断线重连不会重复弹。') +
        tr('关掉「系统通知」后仍会在应用内弹提示，不会彻底收不到。</p>')
    ) +
    sec(tr('耗材库存'),
      row(sw(tr('低库存时提醒我'), inv.lowStockNotify !== false, 'data-bind="inventory.lowStockNotify" data-kind="bool"')) +
      '<p class="hint">' + tr('打印完成落到回执时，会按耗材分配自动扣库存；剩余低于阈值时每卷每天提醒一次。<br>某个耗材的剩余克数留空表示「不管理库存」，不参与扣减和提醒。库存只是估算，界面统一标「约」。') + '</p>'
    ) +
    sec(tr('温度与进度曲线'),
      row(
        sw(tr('后台记录温度与进度'), m.enabled !== false, 'data-bind="monitor.enabled" data-kind="bool"') +
        field(tr('采样间隔'), '<select class="select" data-bind="monitor.intervalSec" data-kind="number">' +
          opt(5, tr('每 5 秒'), Number(m.intervalSec)) + opt(10, tr('每 10 秒'), Number(m.intervalSec)) +
          opt(15, tr('每 15 秒'), Number(m.intervalSec)) + opt(30, tr('每 30 秒'), Number(m.intervalSec)) +
          opt(60, tr('每 60 秒'), Number(m.intervalSec)) + '</select>')
      ) +
      '<div class="btn-row">' +
        actionBtn('monitor-chart', 'i-layers', tr('查看最近一次曲线'), 'btn btn-primary btn-sm') +
        actionBtn('monitor-clear', 'i-trash', tr('清除本机历史')) +
      '</div>' +
      '<p class="hint">' + statLine + tr(' 采样只在本机进行，按打印任务分段保存；') +
        tr('每台机器最多 1800 个点，超过会自动丢最旧的，文件不会无限长大。</p>')
    );
}

async function refreshMonitorStatus() {
  try { monitorStatus = await api.monitorStatus(); }
  catch (_) { monitorStatus = null; }
  if (currentTab === 'monitor') renderContent();
}

async function clearMonitorHistory() {
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('清除打印监控历史'),
      message: tr('删除本机保存的所有温度 / 进度采样记录吗？'),
      detail: tr('只影响曲线回看，不会改动模型库、设置或打印机。正在进行的打印会重新开始记录。'),
      danger: true, confirmText: tr('清除'),
    });
  } catch (_) { return; }
  if (!ok) return;
  try {
    const r = await api.monitorClear(null);
    emitToast('success', tr('已清除 ') + ((r && r.cleared) || 0) + tr(' 次打印记录'));
    await refreshMonitorStatus();
  } catch (e) { toastErr(e); }
}

function backupRow(b) {
  return '<div class="backup-row">' +
    '<span class="mono">' + esc(b.name) + '</span>' +
    '<span class="muted">' + esc(b.size != null ? fmtBytes(b.size) : '—') + ' · ' +
      esc(b.mtime ? fmtDate(b.mtime) : '—') + '</span>' +
    '<button type="button" class="btn btn-ghost btn-sm danger" data-act="restore" data-name="' + esc(b.name) + '">' +
      icon('i-undo') + tr('<span>恢复</span></button></div>');
}

function renderData() {
  const info = state.info || {};
  const backups = state.backups || [];
  const bk = backups.length ? backups.map(backupRow).join('') : tr('<div class="empty">暂无备份</div>');
  return sec(tr('数据目录'),
      '<div class="data-dir"><span class="mono">' + esc(info.dataDir || '—') + '</span>' +
        actionBtn('open-datadir', 'i-folder-open', tr('打开目录')) + '</div>' +
      tr('<p class="hint">所有数据仅保存在本机，不联网、不上传。</p>')
    ) +
    sec(tr('备份与恢复'),
      '<div class="btn-row">' + actionBtn('backup', 'i-save', tr('立即备份'), 'btn btn-primary btn-sm') + '</div>' +
      '<div class="backup-list">' + bk + '</div>'
    ) +
    sec(tr('导入 / 导出'),
      '<div class="btn-row">' +
        actionBtn('export', 'i-download', tr('导出 JSON')) +
        actionBtn('import', 'i-upload', tr('导入 JSON')) +
      '</div>' +
      tr('<p class="hint">导入时可选择合并或覆盖；覆盖会替换现有模型库，需二次确认。</p>')
    ) +
    sec(tr('初始化向导'),
      '<div class="btn-row">' +
        actionBtn('rerun-onboarding', 'i-sparkle', tr('重新运行初始化向导'), 'btn btn-ghost btn-sm') +
        actionBtn('rerun-guide', 'i-info', tr('再看一遍新手引导'), 'btn btn-ghost btn-sm') +
      '</div>' +
      tr('<p class="hint">换电脑、换了模型盘，或者想重新选一次扫描范围时用这个。向导不会删除已有模型与分类。</p>')
    ) +
    sec(tr('统计与导出'),
      '<div class="btn-row">' +
        actionBtn('achievements', 'i-star', tr('成就')) +
        actionBtn('passport-csv', 'i-download', tr('导出模型护照 CSV')) +
      '</div>' +
      '<p class="hint">' + tr('护照 CSV 含作者、许可、来源与商用判断，方便核对素材能不能商用。打印周报在「打印回执 · 成本账本」页右上角打开。') + '</p>'
    ) +
    sec(tr('缩略图缓存'),
      '<div class="btn-row">' +
        actionBtn('thumb-prune', 'i-trash', tr('清理无效缓存')) +
        actionBtn('thumb-regen', 'i-refresh', tr('全部重新生成')) +
      '</div>' +
      tr('<div class="thumb-stats" data-role="thumb-stats">正在读取缓存统计…</div>')
    );
}

function renderAbout() {
  const i = state.info || {};
  const kv = (k, v) => '<div class="meta-cell"><span class="meta-k">' + esc(k) +
    '</span><span class="meta-v mono">' + esc(v || '—') + '</span></div>';
  const keys = [
    [tr('/ 或 Ctrl+F'), tr('聚焦搜索')], ['Ctrl+A', tr('全选')], ['F2', tr('重命名')], ['Ctrl+D', tr('收藏')],
    ['Ctrl+O', tr('送切片软件')], ['Space', tr('大图预览')], ['Delete', tr('移出索引')], ['1~5', tr('评分')],
    ['Esc', tr('逐层关闭')], ['F5', tr('扫描')],
  ];
  return sec(tr('关于 PrintShelf'),
      '<div class="about-logo">' + icon('i-layers') + '<strong>PrintShelf</strong>' +
        tr('<span>本地 3MF 模型库</span></div>') +
      '<div class="meta-grid">' +
        kv(tr('应用版本'), i.version) + kv('Electron', i.electron) + kv('Node', i.node) +
        kv(tr('平台'), i.platform) + kv(tr('数据目录'), i.dataDir) +
      '</div>' +
      tr('<p class="hint">扫描、分类、预览、去重、一键送切片软件，全部功能离线可用。</p>') +
      '<div class="privacy-note">' + icon('i-check-circle') + tr('所有数据仅保存在本机，不联网、不上传。</div>')
    ) +
    sec(tr('键盘快捷键'),
      '<div class="shortcut-list">' + keys.map((pair) =>
        '<div class="shortcut"><kbd>' + esc(pair[0]) + '</kbd><span>' + esc(pair[1]) + '</span></div>').join('') +
      '</div>'
    );
}

// ---------- 自动分类（预设词库） ----------
/** 渲染层拿不到核心模块，预设规则由主进程按当前分类解析后给过来 */
async function ensureClassifyRules() {
  const cfg = (state.settings && state.settings.classify) || {};
  if (Array.isArray(cfg.rules) && cfg.rules.length) return;
  try {
    const preset = await api.classifyPreset();
    if (!Array.isArray(preset) || !preset.length) return;
    await updateSettings({ classify: { rules: preset } });
  } catch (_) { /* 拿不到预设时页面显示「暂无规则」即可 */ }
}

/** 重新拉一次设置并重画当前页（分类跑完要刷新统计文案） */
async function refreshSettings() {
  try {
    const s = await api.settings();
    if (s) state.settings = s;
  } catch (_) { /* 保留旧值 */ }
  if (currentTab === 'classify') renderContent();
}

function renderClassify() {
  const cfg = (state.settings && state.settings.classify) || {};
  const onScan = cfg.onScan !== false;
  const onStartup = cfg.onStartup !== false;
  const promptUnmatched = cfg.promptUnmatched !== false;
  const cats = state.categories || [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const stat = cfg.lastRunStat;
  const statLine = stat && (stat.assigned || stat.scanned)
    ? tr('上次运行：扫描 ') + (stat.scanned || 0) + tr(' 个，分好 ') + (stat.assigned || 0) +
      tr(' 个，跳过 ') + (stat.skipped || 0) + tr(' 个') +
      (cfg.lastRunAt ? '（' + esc(fmtDate(cfg.lastRunAt)) + '）' : '')
    : tr('还没有跑过批量分类。启动软件或点上面的按钮都会跑一次。');

  const ruleRows = rules.map((r, i) => {
    const c = byId.get(r.categoryId);
    const dot = '<span class="rule-dot" style="--dot:' + esc((c && c.color) || '#94a3b8') + '"></span>';
    const name = c ? esc(c.name) : tr('<span class="muted">分类已删除（规则暂停）</span>');
    return '<div class="rule-row">' +
      '<div class="rule-head">' + dot +
        '<span class="rule-name">' + name + '</span>' +
        tr('<span class="rule-order">优先级 ') + (i + 1) + '</span>' +
      '</div>' +
      '<textarea class="textarea rule-kw" rows="3" spellcheck="false" data-rule="' + esc(r.id) + '">' +
        esc((r.keywords || []).join('\n')) + '</textarea>' +
    '</div>';
  }).join('');

  return sec(tr('自动分类'),
      tr('<p class="hint">导入新模型时按下面的词库自动落进分类。只处理「未分类」的模型，') +
        tr('你手动分过的永远不会被改；一个词都没命中就保持未分类，不会硬塞进某个分类。</p>') +
      row(
        sw(tr('新模型导入时自动分类'), onScan, 'data-bind="classify.onScan" data-kind="bool"') +
        sw(tr('每次启动补一次未分类'), onStartup, 'data-bind="classify.onStartup" data-kind="bool"')
      ) +
      row(
        sw(tr('有模型没匹配上时，打开软件提醒我'), promptUnmatched,
          'data-bind="classify.promptUnmatched" data-kind="bool"')
      ) +
      '<div class="btn-row">' +
        actionBtn('classify-run', 'i-sparkle', tr('立即分类未分类'), 'btn btn-primary btn-sm') +
        actionBtn('classify-preset', 'i-refresh', tr('恢复预设词库')) +
        actionBtn('classify-undo', 'i-undo', tr('撤销自动分类')) +
      '</div>' +
      ((Array.isArray(cfg.skippedIds) && cfg.skippedIds.length)
        ? '<div class="btn-row">' +
            tr('<span class="hint">已跳过 ') + cfg.skippedIds.length + tr(' 个模型的分类提醒。</span>') +
            actionBtn('classify-skip-reset', 'i-refresh', tr('恢复提醒')) +
          '</div>'
        : '') +
      '<p class="hint">' + statLine + '</p>'
    ) +
    sec(tr('词库'),
      tr('<p class="hint">每行一个关键词，也可以逗号分隔；命中任意一个就归入该分类。') +
        tr('越靠上的分类优先级越高，第一条命中即止。少于 2 个字的关键词会被忽略，避免误伤。</p>') +
      (ruleRows || tr('<div class="empty">当前没有可用规则。点「恢复预设词库」生成一套。</div>'))
    );
}

async function runClassify() {
  try {
    const r = await api.classifyRun();
    if (r && r.disabled) { emitToast('warn', tr('自动分类已关闭，先打开上面的开关')); return; }
    if (r && r.error) { emitToast('warn', r.error); return; }
    const n = (r && r.assigned) || 0;
    emitToast(n ? 'success' : 'info', n ? (tr('已自动分类 ') + n + tr(' 个模型')) : tr('没有需要分类的模型'));
    await refreshSettings();
    emitRefresh('classify');
  } catch (e) { toastErr(e); }
}

async function restorePreset() {
  try {
    const preset = await api.classifyPreset();
    if (!Array.isArray(preset) || !preset.length) {
      emitToast('warn', tr('当前分类里没有能匹配的预设规则，先建好分类再试'));
      return;
    }
    const ok = await updateSettings({ classify: { rules: preset } });
    if (ok) { emitToast('success', tr('已恢复预设词库')); await refreshSettings(); }
  } catch (e) { toastErr(e); }
}

/** 清空「全部跳过」名单，让这些模型下次启动重新进入未匹配提醒（docs/15） */
async function resetSkipped() {
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('恢复分类提醒'),
      message: tr('让之前点过「全部跳过」的模型重新参与提醒吗？'),
      detail: tr('只清掉跳过记录，不会改动任何模型的分类；下次启动如果仍未匹配，会再次提示。'),
      confirmText: tr('恢复'),
    });
  } catch (_) { return; }
  if (!ok) return;
  const r = await updateSettings({ classify: { skippedIds: [] } });
  if (r) { emitToast('success', tr('已恢复分类提醒')); await refreshSettings(); }
}

/** 重新走一次首次启动向导：不删数据，只重新选扫描范围 */
function rerunOnboarding() {
  closeSettings();
  startOnboarding({ force: true });
}

/** 再看一遍三步新手引导（聚光灯指向添加目录 / 侧栏 / 卡片） */
function rerunGuide() {
  closeSettings();
  startGuide();
}

async function undoClassify() {
  let ok = false;
  try {
    ok = await confirmDialog({
      title: tr('撤销自动分类'),
      message: tr('把所有「自动分好的」模型改回未分类吗？'),
      detail: tr('你自己手动分过的模型不受影响，只清掉自动分类的结果。'),
      danger: true, confirmText: tr('撤销'),
    });
  } catch (_) { return; }
  if (!ok) return;
  try {
    const r = await api.classifyUndo();
    const n = (r && r.cleared) || 0;
    emitToast(n ? 'success' : 'info', n ? (tr('已撤销 ') + n + tr(' 个自动分类')) : tr('没有可撤销的记录'));
    await refreshSettings();
    emitRefresh('classify');
  } catch (e) { toastErr(e); }
}

/** 编辑关键词：失焦保存，只写变化过的规则 */
async function saveRuleKeywords(id, text) {
  const cfg = (state.settings && state.settings.classify) || {};
  const rules = Array.isArray(cfg.rules) ? cfg.rules.map((r) => ({ ...r })) : [];
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const kws = String(text || '')
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const uniq = Array.from(new Set(kws));
  const before = Array.isArray(rules[idx].keywords) ? rules[idx].keywords : [];
  if (uniq.length === before.length && uniq.every((k, i) => k === before[i])) return;
  rules[idx].keywords = uniq;
  const ok = await updateSettings({ classify: { rules } });
  if (ok) emitToast('success', tr('词库已保存'));
}

function renderNav() {
  const nav = el('settings-nav');
  if (!nav) return;
  nav.innerHTML = TABS.map((t) =>
    '<button type="button" class="nav-item settings-nav-item' + (t.key === currentTab ? ' active' : '') +
    '" data-tab="' + esc(t.key) + '">' + icon(t.icon) + '<span>' + esc(t.label) + '</span></button>'
  ).join('');
}

function renderContent() {
  const c = el('settings-content');
  if (!c) return;
  const map = {
    folders: renderFolders, slicers: renderSlicers, appearance: renderAppearance,
    monitor: renderMonitor, classify: renderClassify, data: renderData, about: renderAbout,
  };
  c.innerHTML = (map[currentTab] || renderFolders)();
}

// ---------- 设置持久化 ----------
async function updateSettings(patch) {
  try {
    const s = await api.settingsUpdate(patch);
    if (s) state.settings = s;
    return true;
  } catch (e) { toastErr(e); return false; }
}

function applyCardSize(v) {
  // 网格用的是 --card-w（app.js / toolbar.js / grid.js 都写它）。
  // 以前这里写了一个没人读的 --card-size，设置页的尺寸滑块等于没接上。
  const size = Math.max(140, Math.min(340, Number(v) || 220));
  document.documentElement.style.setProperty('--card-w', size + 'px');
}

function applyUI(key, value) {
  setState({ [key]: value });
  const root = document.documentElement;
  if (key === 'theme') {
    let t = value;
    if (t === 'system') t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    root.dataset.theme = t;
    // 与 app.js applyTheme 保持同一套行为：state.theme 记实际生效值，
    // 工具栏按钮也要换图标（深色显示太阳，浅色显示月亮），否则切完主题图标还是旧的
    setState({ theme: t });
    const btn = document.getElementById('btn-theme');
    if (btn) {
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
    }
  } else if (key === 'cardSize') {
    applyCardSize(value);
  } else if (key === 'showStats') {
    const bar = el('stats-bar');
    if (bar) bar.hidden = !value;
  } else if (key === 'sidebarCollapsed') {
    // 走统一入口：body class / state / settings / 按钮标题四处一起同步
    applySidebar(value);
  } else if (key === 'density') {
    root.dataset.density = value;
  } else if (key === 'iconSet') {
    // 同一组 i-* id，只换 #icon-sprite 里的路径；静态 <use> 与 icon() 都不用改
    applyIconSet(value);
  } else if (key === 'motionLevel' || key === 'motionFollowSystem') {
    // 两处都会改变「实际生效档位」，必须立刻重算 dataset，否则要重启才生效
    applyMotionPrefs();
  }
}

async function saveBind(t) {
  const parts = (t.dataset.bind || '').split('.');
  if (parts.length !== 2) return;
  const scope = parts[0];
  const key = parts[1];
  const kind = t.dataset.kind || 'string';
  let value;
  if (kind === 'bool') value = t.checked;
  else if (kind === 'number') value = Number(t.value);
  else if (kind === 'csv') value = String(t.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  else value = t.value;
  const patch = {};
  patch[scope] = {};
  patch[scope][key] = value;
  const okSetting = await updateSettings(patch);
  // monitor / notify 也要发一次轻量刷新：常驻监控条订阅 shelf:refresh 后立刻显隐或重画，
  // 不用等下次开设置页才生效。
  if (okSetting && (scope === 'ui' || scope === 'classify' || scope === 'monitor' || scope === 'notify')) {
    if (scope === 'ui') applyUI(key, value);
    if (scope === 'ui' && key === 'makerWorldRegion') applyMakerWorldLinks(value === 'auto' ? (languageIsEnglish() ? 'global' : 'cn') : value);
    emitRefresh('settings');
  }
  // 语言切换要重绘所有模块顶层的预设文案，整页重载最可靠（设置已先落盘）。
  if (okSetting && scope === 'ui' && key === 'language') {
    setLanguage(value);
    setTimeout(() => { api.win('reload').catch(() => {}); }, 80);
  }
}

function languageIsEnglish() {
  return (state.settings && state.settings.ui && state.settings.ui.language) === 'en-US';
}

// ---------- 目录 ----------
async function reloadFolders() {
  try { const fs = await api.folders(); if (Array.isArray(fs)) state.folders = fs; } catch (_) { /* 保留旧值 */ }
}
async function reloadSlicers() {
  try { const ss = await api.slicers(); if (Array.isArray(ss)) state.slicers = ss; } catch (_) { /* 保留旧值 */ }
}

async function addFolder() {
  try {
    const path = await api.pickFolder();
    if (!path) return;
    const f = await api.folderAdd(path);
    emitToast('success', tr('已添加目录'));
    await reloadFolders();
    renderContent();
    emitRefresh('folders');
    const scan = await confirmDialog({
      title: tr('立即扫描？'), message: tr('是否立即扫描刚添加的目录？'),
      detail: tr('目录完整路径：'), items: [path], confirmText: tr('立即扫描'),
    });
    if (scan) {
      await api.scanStart({ folderIds: f && f.id ? [f.id] : undefined });
      emitToast('info', tr('已开始扫描'));
    }
  } catch (e) { toastErr(e); }
}

async function scanAll() {
  try { await api.scanStart({ force: true }); emitToast('info', tr('已开始扫描全部目录')); }
  catch (e) { toastErr(e); }
}

async function folderRemove(id) {
  const f = (state.folders || []).find((x) => x && x.id === id);
  const ok = await confirmDialog({
    title: tr('移除监控目录'), message: tr('确定移除该监控目录？已入库的模型不会被删除。'),
    detail: tr('目录完整路径：'), items: [f ? f.path : id], danger: true, confirmText: tr('移除'),
  });
  if (!ok) return;
  try {
    await api.folderRemove(id);
    emitToast('success', tr('已移除目录'));
    await reloadFolders();
    renderContent();
    emitRefresh('folders');
  } catch (e) { toastErr(e); }
}

async function updateFolder(id, patch) {
  try { await api.folderUpdate(id, patch); await reloadFolders(); emitRefresh('folders'); }
  catch (e) { toastErr(e); }
}

// ---------- 切片软件 ----------
async function detectSlicers() {
  try {
    const found = await api.slicerDetect();
    if (!Array.isArray(found) || !found.length) { emitToast('info', tr('未检测到已安装的切片软件')); return; }
    const options = found.map((s, i) => ({ value: i, label: s.name + ' — ' + s.exePath, icon: 'i-printer' }));
    const r = await selectDialog({
      title: tr('探测到的切片软件'), message: tr('选择要添加的软件（可多选）'),
      options, mode: 'multi', confirmText: tr('添加所选'),
    });
    if (r === undefined || !r.length) return;
    for (const i of r) {
      const s = found[i];
      if (s) await api.slicerAdd({ name: s.name, exePath: s.exePath, args: s.args || '' });
    }
    emitToast('success', tr('已添加 ') + r.length + tr(' 个切片软件'));
    await reloadSlicers();
    renderContent();
    emitRefresh('slicers');
  } catch (e) { toastErr(e); }
}

async function slicerPickExe() {
  try {
    const p = await api.pickExe();
    if (!p) return;
    const pi = document.getElementById('slicer-new-path');
    if (pi) pi.value = p;
    const ni = document.getElementById('slicer-new-name');
    if (ni && !ni.value) ni.value = String(p).replace(/\\/g, '/').split('/').pop().replace(/\.(exe|bat|cmd)$/i, '');
  } catch (e) { toastErr(e); }
}

async function slicerAdd() {
  const ni = document.getElementById('slicer-new-name');
  const pi = document.getElementById('slicer-new-path');
  const name = ((ni && ni.value) || '').trim();
  const path = ((pi && pi.value) || '').trim();
  if (!name || !path) { emitToast('warn', tr('请填写名称与可执行文件路径')); return; }
  try {
    const v = await api.slicerValidate(path);
    if (v && v.ok === false) { emitToast('error', (v && v.reason) || tr('路径无效，无法添加')); return; }
    // 填的是安装目录时后端会自动定位到目录里的可执行文件，这里按纠正后的路径存
    const realPath = (v && v.exePath) || path;
    if (v && v.fixed && pi) pi.value = realPath;
    await api.slicerAdd({ name, exePath: realPath, args: '' });
    emitToast('success', v && v.fixed
      ? tr('已添加（这是文件夹，自动用了里面的 ') + String(realPath).replace(/\\/g, '/').split('/').pop() + '）'
      : tr('已添加切片软件'));
    await reloadSlicers();
    renderContent();
    emitRefresh('slicers');
  } catch (e) { toastErr(e); }
}

async function slicerRemove(id) {
  try {
    await api.slicerRemove(id);
    emitToast('success', tr('已移除'));
    await reloadSlicers();
    renderContent();
    emitRefresh('slicers');
  } catch (e) { toastErr(e); }
}

async function setDefault(id) {
  try { await api.slicerSetDefault(id); emitToast('success', tr('已设为默认')); await reloadSlicers(); }
  catch (e) { toastErr(e); }
}

async function slicerValidate(id) {
  const s = (state.slicers || []).find((x) => x && x.id === id);
  if (!s) return;
  try {
    const v = await api.slicerValidate(s.exePath);
    const ok = !!(v && v.ok !== false);
    let box = null;
    document.querySelectorAll('.validate-result').forEach((b) => {
      if (b.getAttribute('data-role') === 'validate-' + id) box = b;
    });
    if (box) {
      box.textContent = ok ? tr('可用') : ((v && v.reason) || tr('不可用'));
      box.className = 'validate-result ' + (ok ? 'ok' : 'bad');
    }
    emitToast(ok ? 'success' : 'error', ok ? tr('路径可用') : ((v && v.reason) || tr('校验失败')));
  } catch (e) { toastErr(e); }
}

async function updateSlicer(id, patch) {
  try { await api.slicerUpdate(id, patch); await reloadSlicers(); }
  catch (e) { toastErr(e); }
}

// ---------- 数据管理 ----------
async function loadDataExtras() {
  try {
    const bs = await api.backups();
    state.backups = Array.isArray(bs) ? bs : [];
    const list = document.querySelector('.backup-list');
    if (list) list.innerHTML = state.backups.length ? state.backups.map(backupRow).join('') : tr('<div class="empty">暂无备份</div>');
  } catch (e) { toastErr(e); }
  try {
    const st = await api.thumbStats();
    const box = document.querySelector('[data-role="thumb-stats"]');
    if (box) box.textContent = tr('缓存文件：') + ((st && st.count) || 0) + tr(' 个 · 占用：') + fmtBytes((st && st.bytes) || 0);
  } catch (_) { /* 统计失败不提示 */ }
}

async function loadInfo() {
  try {
    const i = await api.getInfo();
    if (i) {
      state.info = Object.assign({}, state.info || {}, i);
      if (currentTab === 'about') renderContent();
    }
  } catch (_) { /* 保留已有 info */ }
}

async function backup() {
  try { const name = await api.backup(); emitToast('success', tr('备份完成：') + (name || '')); loadDataExtras(); }
  catch (e) { toastErr(e); }
}

async function restore(name) {
  const ok = await confirmDialog({
    title: tr('恢复备份'), message: tr('恢复备份会覆盖当前模型库与设置，建议先手动备份。'),
    detail: tr('将恢复的备份文件：'), items: [name], danger: true, confirmText: tr('恢复备份'),
  });
  if (!ok) return;
  try {
    await api.restore(name);
    emitToast('success', tr('已恢复备份'));
    emitRefresh('restore');
    renderContent();
  } catch (e) { toastErr(e); }
}

async function exportData() {
  try {
    const p = await api.saveJson('printshelf-export.json');
    if (!p) return;
    await api.exportData(p);
    emitToast('success', tr('已导出：') + p);
  } catch (e) { toastErr(e); }
}

async function importData() {
  try {
    const p = await api.pickJson();
    if (!p) return;
    // 选择合并 / 覆盖；覆盖属于危险操作，追加二次确认
    const mode = await selectDialog({
      title: tr('导入 JSON'), message: tr('选择导入方式'), options: [
        { value: 'merge', label: tr('合并（保留现有数据）'), icon: 'i-layers' },
        { value: 'overwrite', label: tr('覆盖（替换现有模型库）'), icon: 'i-alert' },
      ], mode: 'single',
    });
    if (mode === undefined) return;
    const merge = mode === 'merge';
    if (!merge) {
      const ok = await confirmDialog({
        title: tr('确认覆盖导入'), message: tr('覆盖导入将替换现有模型库，此操作不可撤销。'),
        detail: tr('数据来源文件完整路径：'), items: [p], danger: true, confirmText: tr('确认覆盖'),
      });
      if (!ok) return;
    }
    const r = await api.importData(p, merge);
    emitToast('success', tr('已导入 ') + ((r && r.imported != null) ? r.imported : 0) + tr(' 条记录'));
    emitRefresh('import');
  } catch (e) { toastErr(e); }
}

async function thumbPrune() {
  try {
    const r = await api.thumbPrune();
    emitToast('success', tr('已清理 ') + ((r && r.removed) || 0) + tr(' 个无效缓存'));
    loadDataExtras();
  } catch (e) { toastErr(e); }
}

async function thumbRegen() {
  const ok = await confirmDialog({
    title: tr('重新生成全部缩略图'), message: tr('将重新解析所有模型并生成缩略图，可能耗时较长。'), confirmText: tr('开始'),
  });
  if (!ok) return;
  try {
    const r = await api.thumbRegenerate([], true);
    emitToast('success', tr('已重新生成 ') + ((r && r.done) || 0) + tr(' 张缩略图') + ((r && r.failed) ? tr('，失败 ') + r.failed + tr(' 张') : ''));
    loadDataExtras();
  } catch (e) { toastErr(e); }
}

async function openDataDir() {
  try { await api.openDataDir(); } catch (e) { toastErr(e); }
}

// ---------- 事件分发 ----------
// ---------- I · 成就 / 护照（周报已移到打印回执页） ----------
async function showAchievements() {
  let r;
  try { r = await api.achievementsList({ notify: false }); } catch (_) { return; }
  const cards = (r.items || []).map((a) =>
    '<div class="ach-card' + (a.unlocked ? ' is-unlocked' : '') + '">' +
      '<div class="ach-title">' + icon(a.unlocked ? 'i-star' : 'i-circle') + escapeHtml(a.title) + '</div>' +
      '<div class="ach-desc">' + escapeHtml(a.desc) + '</div>' +
      '<div class="ach-bar"><span style="width:' + Math.round((a.ratio || 0) * 100) + '%"></span></div>' +
      '<div class="ach-progress">' + a.progress + ' / ' + a.target + (a.unlocked ? tr(' · 已解锁') : '') + '</div>' +
    '</div>').join('');
  customDialog({
    title: tr('成就') + ' · ' + r.unlockedCount + ' / ' + r.total,
    body: '<div class="ach-grid">' + cards + '</div>',
  });
}

async function copyPassportCsv() {
  let r;
  try { r = await api.passportCsv(); } catch (_) { return; }
  try {
    await navigator.clipboard.writeText(r.csv || '');
    emitToast('success', tr('护照 CSV 已复制（') + r.count + tr(' 个模型），可直接粘贴到表格'));
  } catch (_) { emitToast('error', tr('复制失败，请重试')); }
}

async function dispatch(act, node) {
  const d = node && node.dataset ? node.dataset : {};
  switch (act) {
    case 'add-folder': return addFolder();
    case 'scan-all': return scanAll();
    case 'achievements': return showAchievements();
    case 'passport-csv': return copyPassportCsv();
    case 'folder-remove': return folderRemove(d.id);
    case 'detect-slicers': return detectSlicers();
    case 'slicer-add': return slicerAdd();
    case 'slicer-pick-exe': return slicerPickExe();
    case 'slicer-remove': return slicerRemove(d.id);
    case 'slicer-validate': return slicerValidate(d.id);
    case 'open-datadir': return openDataDir();
    case 'backup': return backup();
    case 'restore': return restore(d.name);
    case 'export': return exportData();
    case 'import': return importData();
    case 'thumb-prune': return thumbPrune();
    case 'thumb-regen': return thumbRegen();
    case 'u1-refresh': return refreshU1(true);
    case 'u1-open-cache': return api.u1OpenCache().catch(toastErr);
    case 'u1-clear-cache': return clearU1Cache();
    case 'preset-check': return refreshPresetHealth(true);
    case 'preset-snapshot': return presetSnapshot();
    case 'preset-open': return api.u1OpenPresetBackups().catch(toastErr);
    case 'preset-restore': return presetRestore();
    case 'assoc-check': return refreshFileAssoc(true);
    case 'assoc-open-settings': return api.fileAssocOpenSettings().catch(toastErr);
    case 'assoc-fix': return assocRepair('fix');
    case 'assoc-use': return assocRepair(d.target || 'bambu');
    case 'classify-run': return runClassify();
    case 'classify-preset': return restorePreset();
    case 'classify-undo': return undoClassify();
    case 'classify-skip-reset': return resetSkipped();
    case 'rerun-onboarding': return rerunOnboarding();
    case 'rerun-guide': return rerunGuide();
    case 'monitor-chart': return openMonitorChart('', '');
    case 'monitor-clear': return clearMonitorHistory();
    case 'notify-test': return api.notifyTest().then(() => emitToast('info', tr('已发送测试通知'))).catch(toastErr);
    default: return;                       // slicer-default 等由 change 事件处理
  }
}

function onClick(e) {
  const c = el('settings-content');
  if (!c || !c.contains(e.target)) return;
  const node = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!node) return;
  Promise.resolve(dispatch(node.dataset.act, node)).catch(toastErr);
}

function onChange(e) {
  const t = e.target;
  if (!t || !t.dataset) return;
  const d = t.dataset;
  if (d.rule) return saveRuleKeywords(d.rule, t.value);
  if (d.bind) return saveBind(t);
  if (d.folderToggle) {
    const patch = {};
    patch[d.folderToggle] = t.checked;
    return updateFolder(d.id, patch);
  }
  if (d.slicerToggle) return updateSlicer(d.id, { enabled: t.checked });
  if (t.hasAttribute && t.hasAttribute('data-slicer-args')) return updateSlicer(d.id, { args: t.value });
  if (d.act === 'slicer-default' && t.checked) return setDefault(d.id);
  if (d.u1) return updateU1(d.u1, t.value);
}

function onInput(e) {
  const t = e.target;
  // 拖动卡片尺寸滑块时即时预览
  if (t && t.dataset && t.dataset.bind === 'ui.cardSize') applyCardSize(Number(t.value));
}

function onNavClick(e) {
  const nav = el('settings-nav');
  if (!nav || !nav.contains(e.target)) return;
  const node = e.target.closest ? e.target.closest('[data-tab]') : null;
  if (node) openSettings(node.dataset.tab);
}

// ---------- 快造 U1 相关操作 ----------
async function refreshU1(force) {
  if (u1Loading) return;
  if (u1Info && !force) return;
  u1Loading = true;
  if (currentTab === 'slicers') renderContent();
  try {
    if (force) { try { await api.u1PresetsInvalidate(); } catch (_) {} }
    u1Info = await api.u1Status();
  } catch (e) {
    u1Info = { filaments: [], processes: [], settings: {}, cache: {}, orcaDir: '', error: (e && e.message) || '' };
    emitToast('warn', tr('读取快造预设失败：') + ((e && e.message) || tr('未知原因')));
  } finally {
    u1Loading = false;
    if (currentTab === 'slicers') renderContent();
  }
}

async function updateU1(key, value) {
  if (key === 'keepAllColours') value = value === '1' || value === 'true';
  const cur = (state.settings && state.settings.u1) || {};
  const patch = Object.assign({}, cur, { [key]: value });
  try {
    const s = await api.settingsUpdate({ u1: patch });
    if (s) state.settings = s;
    // 换预设后摘要要重算
    if (key === 'filamentPreset' || key === 'processPreset') await refreshU1(true);
    else if (currentTab === 'slicers') renderContent();
  } catch (e) { toastErr(e); }
}

async function clearU1Cache() {
  const ok = await confirmDialog({
    title: tr('清空转换缓存'),
    message: tr('确定清空快造转换缓存吗？只是把已经转换好的副本删掉，下次打开会重新转换，原文件不受影响。'),
    confirmText: tr('清空'),
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await api.u1ClearCache(0);
    emitToast('success', tr('已清理 ') + (r.removed || 0) + tr(' 个文件，释放 ') + fmtBytes(r.bytes || 0));
    await refreshU1(true);
  } catch (e) { toastErr(e); }
}

// ---------- 预设保护 / 文件关联 ----------
async function refreshPresetHealth(force) {
  if (presetLoading) return;
  if (presetHealth && !force) return;
  presetLoading = true;
  if (currentTab === 'slicers') renderContent();
  try {
    presetHealth = await api.u1PresetHealth();
  } catch (e) {
    presetHealth = { ok: false, error: (e && e.message) || '' };
  } finally {
    presetLoading = false;
    if (currentTab === 'slicers') renderContent();
  }
}

async function presetSnapshot() {
  try {
    const r = await api.u1PresetSnapshot();
    if (!r) { emitToast('warn', tr('没有找到任何用户预设，没什么可备份的')); return; }
    emitToast('success', tr('已备份 ') + (r.files || 0) + tr(' 个预设文件（') + fmtBytes(r.bytes || 0) + '）');
    await refreshPresetHealth(true);
  } catch (e) { toastErr(e); }
}

async function presetRestore() {
  const sel = document.getElementById('preset-restore-id');
  const id = sel && sel.value;
  if (!id) { emitToast('warn', tr('先选一份备份')); return; }
  const ok = await confirmDialog({
    title: tr('从备份恢复预设'),
    message: tr('把备份 ') + id + tr(' 里的预设写回快造的 user 目录。\n')
      + tr('只会新增和覆盖，不会删除你现在的其他预设；恢复前会先把当前状态再备份一次。\n')
      + tr('恢复完请在快造里重新打开一次，让它重新读取预设。'),
    confirmText: tr('恢复'),
  });
  if (!ok) return;
  try {
    const r = await api.u1PresetRestore(id);
    const parts = [];
    if (r.added.length) parts.push(tr('新增 ') + r.added.length + tr(' 个'));
    if (r.overwritten.length) parts.push(tr('覆盖 ') + r.overwritten.length + tr(' 个'));
    emitToast('success', tr('已恢复：') + (parts.join(' · ') || tr('没有变化')));
    await refreshPresetHealth(true);
    await refreshU1(true);
  } catch (e) { toastErr(e); }
}

async function assocRepair(target) {
  const isFix = target === 'fix';
  const ok = await confirmDialog({
    title: isFix ? tr('修好 .3mf 关联') : tr('把 .3mf 交给 ') + (target === 'snapmaker' ? tr('快造 Orca') : 'Bambu Studio'),
    message: (isFix
      ? tr('现在 .3mf 的默认指向一个不存在的注册项，双击解析不出程序。\n修好 = 把它指回真实存在的那个处理器。')
      : tr('会写一条你自己的用户级注册项（不需要管理员），并清掉系统里记着的旧选择，让 .3mf 双击就用它打开。'))
      + tr('\n\n只动 HKCU 里的文件关联，不碰任何模型文件。随时可以在系统「设置 → 默认应用」里改回去。'),
    confirmText: tr('修复'),
  });
  if (!ok) return;
  try {
    const r = await api.fileAssocRepair(target);
    if (r && r.ok === false) { emitToast('warn', r.message || tr('没修成')); return; }
    emitToast('success', (r && r.message) || tr('已修复'));
    await refreshFileAssoc(true);
  } catch (e) { toastErr(e); }
}

async function refreshFileAssoc(force) {
  if (fileAssocLoading) return;
  if (fileAssoc && !force) return;
  fileAssocLoading = true;
  if (currentTab === 'slicers') renderContent();
  try {
    fileAssoc = await api.fileAssocReport();
  } catch (e) {
    fileAssoc = { problems: [{ code: 'read-fail', message: (e && e.message) || tr('读取失败') }] };
  } finally {
    fileAssocLoading = false;
    if (currentTab === 'slicers') renderContent();
  }
}

// ---------- 对外导出 ----------
export function mountSettings() {
  if (mounted) return;
  mounted = true;
  const close = el('settings-close');
  if (close) close.addEventListener('click', () => closeSettings());
  const nav = el('settings-nav');
  if (nav) nav.addEventListener('click', onNavClick);
  const c = el('settings-content');
  if (c) {
    c.addEventListener('click', onClick);
    c.addEventListener('change', onChange);
    c.addEventListener('input', onInput);
  }
}

export function openSettings(tab) {
  const panel = el('settings-panel');
  if (!panel) return;
  const t = tab || state.settingsTab || 'folders';
  const prevTab = currentTab;
  const wasHidden = panel.hidden;
  currentTab = TABS.some((x) => x.key === t) ? t : 'folders';
  setState({ settingsOpen: true, settingsTab: currentTab });
  panel.hidden = false;
  renderNav();
  renderContent();
  // 切换 tab 时给内容一次轻淡入：面板还是同一个，只有右侧内容换了，
  // 不这么做会像「整块刷新」。首次打开由浮层自身的 modal-in 负责，不叠加。
  if (!wasHidden && prevTab !== currentTab) {
    enterView(el('settings-content'), { duration: 150, distance: 4 });
  }
  if (currentTab === 'data') loadDataExtras();
  if (currentTab === 'about') loadInfo();
  if (currentTab === 'monitor') refreshMonitorStatus();
  // 首次打开这一页时把内置预设落成可编辑的规则，之后以用户编辑结果为准。
  // 同时拉一次最新设置：跳过名单等字段可能在别处被改（弹窗 / 另一窗口），
  // 只靠 state.settings 会让面板显示旧状态（例如「恢复提醒」按钮该出现却没出现）。
  if (currentTab === 'classify') {
    ensureClassifyRules()
      .then(() => api.settings().catch(() => null))
      .then((s) => {
        if (s) state.settings = s;
        if (currentTab === 'classify') renderContent();
      })
      .catch(() => { if (currentTab === 'classify') renderContent(); });
  }
  if (currentTab === 'slicers') { refreshU1(false); refreshPresetHealth(false); refreshFileAssoc(false); }
}

export function closeSettings() {
  const panel = el('settings-panel');
  if (panel) panel.hidden = true;
  setState({ settingsOpen: false });
}

export function isSettingsOpen() {
  const panel = el('settings-panel');
  return !!panel && !panel.hidden;
}
