'use strict';
/**
 * 由临时机翻结果 + 人工术语表生成 src/renderer/locales/en-US.js。
 * 机翻只作为兜底短语表；界面高频词一律以 OVERRIDES 为准。
 * 新增/修改英文文案请直接改 en-US.js，然后按需重跑本脚本。
 */
const fs = require('fs');
const path = require('path');

const AUTO = process.argv[2] || 'C:/Users/10104/AppData/Local/Temp/zh-en-auto.json';
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'locales', 'en-US.js');

const SEMANTIC = {
  'language.label': 'Language',
  'language.zh': '简体中文',
  'language.en': 'English',
  'language.switchToEn': 'Switch to English',
  'language.switchToZh': 'Switch to 简体中文',
  'settings.language': 'Language',
  'settings.makerWorldRegion': 'MakerWorld site',
  'settings.makerWorldAuto': 'Follow interface language',
  'settings.makerWorldCn': 'China site',
  'settings.makerWorldGlobal': 'Global site',
  'notify.finished.title': 'Print finished · {name}',
  'notify.finished.body': '{job} is done. Ready to pick up.',
  'notify.error.title': 'Print error · {name}',
  'notify.error.body': '{job} reported an error. Check the device page.',
  'notify.paused.title': 'Print paused · {name}',
  'notify.paused.body': '{job} is paused, possibly out of filament or waiting for input.',
  'notify.test.title': 'PrintShelf notification test',
  'notify.test.body': 'This is a test notification. If you see it, system notifications work.',
  'makerworld.fallbackCn': 'This model is only available on MakerWorld China. Opened the China site for you.',
  'makerworld.fallbackGlobal': 'This model is only available on MakerWorld Global. Opened the global site for you.',
};

// 人工术语表：优先级最高，覆盖机翻。
const OVERRIDES = {
  '3MF模型管理器': '3MF Model Manager',
  '本地 3MF 模型库': 'Local 3MF model library',
  '正在启动 PrintShelf': 'Starting PrintShelf',
  '全部模型': 'All models',
  '收藏': 'Favorites',
  '最近打开': 'Recently opened',
  '未打印': 'Not printed',
  '待打印': 'Queued',
  '打印中': 'Printing',
  '已完成': 'Done',
  '失败': 'Failed',
  '未分类': 'Uncategorized',
  '未打标签': 'Untagged',
  '最近 7 天': 'Last 7 days',
  '已完成打印': 'Printed models',
  '已评分': 'Rated',
  '重复文件': 'Duplicate files',
  '失效文件': 'Missing files',
  '功能件': 'Functional parts',
  '摆件装饰': 'Figures & decor',
  '测试校准': 'Test & calibration',
  '备件维修': 'Spare parts & repair',
  '分类': 'Categories',
  '标签': 'Tags',
  '我的视图': 'My views',
  '模型库': 'Library',
  '质量检查': 'Quality checks',
  '耗材与成本': 'Filaments & cost',
  '打印回执 · 成本账本': 'Print receipts · Cost ledger',
  '添加目录': 'Add folder',
  '重新扫描 (F5)': 'Rescan (F5)',
  '设备：管理你的打印机': 'Devices: manage your printers',
  '耗材库：管理耗材与单价': 'Filaments: manage materials and prices',
  '打印轮盘：随机挑一个未打印模型': 'Roulette: pick a random unprinted model',
  '切换深浅主题': 'Toggle light / dark theme',
  '设置': 'Settings',
  '最小化': 'Minimize',
  '最大化': 'Maximize',
  '关闭': 'Close',
  '收起侧栏': 'Collapse sidebar',
  '新建分类': 'New category',
  '新建标签': 'New tag',
  '保存当前筛选为视图': 'Save current filters as a view',
  '搜索名称、备注、标签、作者…': 'Search name, notes, tags, author…',
  '清空搜索': 'Clear search',
  '清除筛选': 'Clear filters',
  '添加时间': 'Date added',
  '名称': 'Name',
  '文件大小': 'File size',
  '文件修改时间': 'Modified',
  '最近打印': 'Last printed',
  '评分': 'Rating',
  '打印次数': 'Print count',
  '打开次数': 'Open count',
  '排序字段': 'Sort by',
  '切换升序/降序': 'Toggle ascending / descending',
  '浏览方式': 'View mode',
  '网格视图': 'Grid view',
  '列表视图': 'List view',
  '缩略图大小': 'Thumbnail size',
  '全选 (Ctrl+A)': 'Select all (Ctrl+A)',
  '全选': 'Select all',
  '已勾选': 'Selected: ',
  '删除勾选': 'Delete selected',
  '取消勾选': 'Clear selection',
  '模型网站导航': 'Model sites',
  '在浏览器打开拓竹模型库 MakerWorld（makerworld.com.cn）': 'Open MakerWorld in your browser',
  '快造空间': 'Snapmaker space',
  '打印监控': 'Print monitor',
  '暂无打印任务': 'No active print jobs',
  '看曲线': 'View chart',
  '监控设置': 'Monitor settings',
  '正在扫描…': 'Scanning…',
  '这里还没有模型': 'No models yet',
  '添加一个本机文件夹，PrintShelf 会自动扫描其中的 .3mf 文件并生成缩略图。': 'Add a local folder. PrintShelf will scan it for .3mf files and generate thumbnails.',
  '添加模型文件夹': 'Add model folder',
  '扫描工作区示例': 'Scan sample workspace',
  '手动添加模型': 'Add model manually',
  '也可以直接把文件夹或 .3mf 文件拖进窗口': 'You can also drag a folder or .3mf files into the window',
  '模型详情': 'Model details',
  '关闭详情 (Esc)': 'Close details (Esc)',
  '就绪': 'Ready',
  '项已选中': 'selected',
  '迁移': 'Move',
  '加标签': 'Add tag',
  '打印状态': 'Print status',
  '打开': 'Open',
  '移出索引': 'Remove from library',
  '删除': 'Delete',
  '取消选择': 'Clear selection',
  '关闭 (Esc)': 'Close (Esc)',
  '上一个 (←)': 'Previous (←)',
  '下一个 (→)': 'Next (→)',
  '松开即可添加': 'Drop to add',
  '支持文件夹或 .3mf 文件': 'Folders or .3mf files supported',
  '按耗材用量': 'By filament usage',
  '按三角面估算': 'Estimated from triangles',
  '打开来源链接': 'Open source page',
  '在浏览器打开来源网页': 'Open source page in browser',
  '在资源管理器中显示': 'Show in File Explorer',
  '删除（移入回收站）': 'Delete (move to Recycle Bin)',
  '更多': 'More',
  '收藏': 'Favorite',
  'MakerWorld 链接优先打开中国站': 'Prefer MakerWorld China site',
  '跟随系统「减少动态效果」': 'Follow system "Reduce motion"',
  '外观设置会立即生效并保存到本机。': 'Appearance changes apply immediately and are saved locally.',
  '界面语言': 'Interface language',
  'MakerWorld 站点': 'MakerWorld site',
  '跟随界面语言': 'Follow interface language',
  '中国站': 'China site',
  '国际站': 'Global site',
  '英文版不内置示例耗材': 'No sample filaments in English mode',
};

function main() {
  let auto = {};
  try {
    auto = JSON.parse(fs.readFileSync(AUTO, 'utf8'));
  } catch (e) {
    console.warn('[i18n] 机翻词典不可用，仅写入人工术语：' + e.message);
  }
  const out = Object.assign({}, SEMANTIC);
  for (const [k, v] of Object.entries(auto)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (!/[\u3400-\u9fff]/.test(k)) continue;
    if (/[<>{}$\\`|]/.test(k)) continue;
    if (k.length > 160) continue;
    out[k] = v.trim();
  }
  for (const [k, v] of Object.entries(OVERRIDES)) out[k] = v;
  for (const file of ['i18n-overrides-extra.js', 'i18n-overrides-ui.js', 'i18n-overrides-more.js', 'i18n-overrides-tail.js']) {
    Object.assign(out, require('./' + file));
  }

  const body = Object.entries(out).map(([k, v]) =>
    '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + ',').join('\n');
  fs.writeFileSync(OUT,
    "'use strict';\n" +
    '/** 英文语言包。中文原文即 key；机翻兜底，高频词由 tools/i18n-build-dict.js 人工校准。 */\n' +
    'export default {\n' + body + '\n};\n', 'utf8');
  console.log('[i18n] 写入 en-US.js，条目 ' + Object.keys(out).length);
}
main();
