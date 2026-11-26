'use strict';
/** 全局常量。子代理只读，勿修改。 */

const PRINT_STATUS = {
  unprinted: { label: '未打印', color: '#94a3b8', next: 'queued' },
  queued:    { label: '待打印', color: '#f59e0b', next: 'printing' },
  printing:  { label: '打印中', color: '#3b82f6', next: 'printed' },
  printed:   { label: '已完成', color: '#10b981', next: 'unprinted' },
  failed:    { label: '失败',   color: '#ef4444', next: 'unprinted' },
};
const PRINT_STATUS_ORDER = ['unprinted', 'queued', 'printing', 'printed', 'failed'];

const SMART_VIEWS = [
  { key: 'all',           label: '全部模型',   icon: 'i-grid',      group: 'library' },
  { key: 'favorites',     label: '收藏',       icon: 'i-star',      group: 'library' },
  { key: 'recentOpened',  label: '最近打开',   icon: 'i-clock',     group: 'library' },
  { key: 'unprinted',     label: '未打印',     icon: 'i-circle',    group: 'smart' },
  { key: 'uncategorized', label: '未分类',     icon: 'i-folder',    group: 'smart' },
  { key: 'untagged',      label: '未打标签',   icon: 'i-tag',       group: 'smart' },
  { key: 'recent',        label: '最近 7 天',  icon: 'i-sparkle',   group: 'smart' },
  { key: 'printed',       label: '已完成打印', icon: 'i-check',     group: 'smart' },
  { key: 'rated',         label: '已评分',     icon: 'i-star',      group: 'smart' },
  { key: 'duplicates',    label: '重复文件',   icon: 'i-copy',      group: 'quality' },
  { key: 'broken',        label: '损坏文件',   icon: 'i-alert',     group: 'quality' },
  { key: 'variants',      label: '同款变体',   icon: 'i-layers',    group: 'quality' },
  { key: 'missing',       label: '失效文件',   icon: 'i-alert',     group: 'quality' },
];

const DEFAULT_CATEGORIES = [
  { name: '功能件',   color: '#4f46e5', icon: 'i-box' },
  { name: '摆件装饰', color: '#ec4899', icon: 'i-sparkle' },
  { name: '测试校准', color: '#0ea5e9', icon: 'i-sliders' },
  { name: '备件维修', color: '#f59e0b', icon: 'i-tool' },
];

/**
 * 英文界面首次安装使用的分类（docs/21）。
 * 关键词不是中文的直译：用英文社区常见的搜索词，直接拿来匹配英文模型标题。
 */
const DEFAULT_CATEGORIES_EN = [
  { name: 'Functional Parts', color: '#4f46e5', icon: 'i-box' },
  { name: 'Figures & Decor', color: '#ec4899', icon: 'i-sparkle' },
  { name: 'Test & Calibration', color: '#0ea5e9', icon: 'i-sliders' },
  { name: 'Spare Parts & Repair', color: '#f59e0b', icon: 'i-tool' },
];

const DEFAULT_TAG_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'];
const CATEGORY_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];

/**
 * 扫描时跳过的目录名（大小写不敏感）。
 * 只放确定是工具/系统噪声的名字：像 data / temp / build / dist 这类通用词
 * 经常就是用户存放模型的文件夹名，绝不能一刀切跳过，否则会漏扫大量模型。
 * 应用自身的 data/ 目录里没有 .3mf，无需特殊处理。
 */
const IGNORE_DIRS = [
  'node_modules', '.git', '.svn', '.hg', '.workbuddy', '.vscode', '.idea',
  'appdata', '$recycle.bin', 'system volume information', 'windows',
  '__pycache__', '.cache', '.next', 'venv', '.venv', 'site-packages',
];

/** 缩略图候选路径（大小写不敏感），按优先级 */
const THUMB_PRIORITY = [
  'thumbnails/thumbnail.png', 'thumbnails/thumbnail.jpg', 'thumbnails/thumbnail.jpeg',
  'metadata/plate_1.png', 'metadata/plate_1.jpg',
  'metadata/plate_1_small.png', 'metadata/top_1.png',
  'metadata/plate_no_light_1.png', 'metadata/thumbnail.png',
];

/** 本机切片软件常见安装位置（相对 Program Files 等根目录） */
const SLICER_CANDIDATES = [
  { name: 'Bambu Studio',  rel: 'Bambu Studio/bambu-studio.exe' },
  { name: 'Bambu Studio',  rel: 'BambuStudio/bambu-studio.exe' },
  { name: 'OrcaSlicer',    rel: 'OrcaSlicer/orca-slicer.exe' },
  { name: 'OrcaSlicer',    rel: 'OrcaSlicer/OrcaSlicer.exe' },
  { name: 'PrusaSlicer',   rel: 'Prusa3D/PrusaSlicer/prusaslicer.exe' },
  { name: 'PrusaSlicer',   rel: 'Prusa3D/PrusaSlicer 2/prusaslicer.exe' },
  { name: 'Creality Print',rel: 'Creality/Creality Print 7.3/CrealityPrint.exe' },
  { name: 'Creality Print',rel: 'Creality/Creality Print 6/CrealityPrint.exe' },
  // 快造 U1 专用版 Orca。目录名实测是 Snapmaker_Orca（不是「Snapmaker_Orca切片软件」）
  { name: '快造 Orca',      rel: 'Snapmaker_Orca/snapmaker-orca.exe' },
  { name: '快造 Orca',      rel: 'Snapmaker Orca/snapmaker-orca.exe' },
  { name: '快造 Orca',      rel: 'SnapmakerOrca/snapmaker-orca.exe' },
  { name: 'Ultimaker Cura',rel: 'Ultimaker Cura 5/cura.exe' },
  { name: 'Ultimaker Cura',rel: 'Ultimaker Cura 5.0/cura.exe' },
  { name: 'SuperSlicer',   rel: 'SuperSlicer/superslicer.exe' },
];

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  folders: [],
  slicers: [],
  blenderPath: '',          // 模型优化用的 Blender 可执行文件路径，留空 = 自动探测
  // 快造 U1 转换（见 docs/06）。slicer 决定卡片上「打开」按钮默认走哪条路。
  // 打印机管理：局域网直连（快造走 Moonraker，拓竹走 MQTT）
  printers: [],
  u1: {
    openWith: 'ask',            // 'ask' = 每次询问 | 'bambu' | 'snapmaker'
    filamentPreset: '',         // 快造耗材预设名，如「拓竹petg」，留空 = 不合并预设参数
    processPreset: '',          // 快造进程预设名，留空 = 用 U1 样板自带的 0.20mm Standard
    cacheKeepDays: 30,          // 转换缓存保留天数
  },
  ui: {
    view: 'grid', theme: 'light', cardSize: 220,
    sortBy: 'createdAt', sortDir: 'desc', density: 'comfortable',
    sidebarCollapsed: false, showStats: true,
    // 界面美化与动效的两个总回退开关（docs/11）。legacy + off = 改造前界面。
    iconSet: 'lucide',       // 'lucide' | 'legacy'
    language: 'zh-CN',       // 'zh-CN' | 'en-US'；首次安装由系统语言决定
    motionLevel: 'full',     // 'full' | 'reduced' | 'off'
    // 是否让系统的「减少动态效果」压制应用内档位。默认 false：应用设置优先，
    // 系统偏好只作为建议（游戏、多数桌面软件都不跟随）。需要无障碍降级的用户可打开。
    motionFollowSystem: false,
    makerWorldRegion: 'auto', // 'auto' | 'cn' | 'global'；auto 跟随界面语言
    makerWorldCn: true,      // 旧字段：保留给老设置迁移/回滚，新逻辑读 makerWorldRegion
    makerWorldCnMigrated: true, // 老版本默认 false，升级时一次性切到 true；之后用户手动关掉不再翻回来
    monitorBar: true,        // 主界面常驻打印监控条（可在设置 → 打印监控里关掉）
  },
  // 首次启动向导（docs/16）：done 一旦为真就不再自动弹；skipped 只用于区分「跳过」与「走完」
  onboard: {
    done: false,
    at: 0,
    depth: 'standard',   // 'fast' | 'standard' | 'deep'，对应 scan.maxDepth 4 / 8 / 12
    skipped: false,
    guideDone: false,    // 三步新手引导是否已看过
    migrated: false,     // 老用户升级时静默标记为已完成
  },
  // 打印监控：温度/进度采样（docs/09 A.14）。一次打印一个 session，落在 data/monitor/history.json。
  monitor: {
    enabled: true,
    intervalSec: 15,        // 采样间隔（秒）；MQTT 推送很密，这里必须节流
    keepSessions: 24,       // 最多保留多少个打印任务的历史
  },
  // 完成与异常通知：主进程发系统通知 + 渲染层 toast，两路都可在设置里关。
  notify: {
    enabled: true,
    onFinished: true,       // 打印完成
    onError: true,          // 报错
    onPaused: true,         // 打印中突然暂停（多半是断料 / 需要人工确认）
    system: true,           // 关掉后只在应用内弹 toast，不惊动系统通知中心
  },
  // 预设词库自动分类（docs/12）。rules 为空 = 还没生成过，运行时回落到内置预设。
  classify: {
    enabled: true,
    onScan: true,
    onStartup: true,
    rules: [],
    lastRunAt: 0,
    lastRunStat: null,
    promptUnmatched: true,   // 启动时若仍有没匹配上的模型，弹窗提醒
    skippedIds: [],          // 「全部跳过」记下的模型 id，这些不再进提醒（docs/15）
  },
  scan: {
    excludeDirs: [], maxDepth: 12, autoWatch: true,
    hashEnabled: true, parseMeta: true, concurrency: 4,
    shapePrint: true,      // A · 几何指纹：后台计算「同款变体」
  },
  // B · 隔离区：dir 留空 = 数据目录下的 quarantine/
  quarantine: { dir: '' },
  data: { backupKeep: 10, lastBackupAt: null },
  updatedAt: 0,
};

const DEFAULT_LIBRARY = {
  schemaVersion: 1,
  updatedAt: 0,
  models: {},
  categories: [],
  tags: [],
  savedViews: [],
  scanMeta: {},
};

const MAX_FILE_SIZE = 500 * 1024 * 1024;   // 500MB 以上跳过解析
const MAX_MODEL_BYTES = 24 * 1024 * 1024; // 3dmodel.model 精细统计上限

module.exports = {
  PRINT_STATUS, PRINT_STATUS_ORDER, SMART_VIEWS, DEFAULT_CATEGORIES, DEFAULT_CATEGORIES_EN,
  DEFAULT_TAG_COLORS, CATEGORY_COLORS, IGNORE_DIRS, THUMB_PRIORITY,
  SLICER_CANDIDATES, DEFAULT_SETTINGS, DEFAULT_LIBRARY,
  MAX_FILE_SIZE, MAX_MODEL_BYTES,
};
