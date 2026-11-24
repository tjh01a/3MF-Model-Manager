/**
 * 一次性夹具：为「回执自动关联」走查准备临时数据（3 个模型 / 3 条未关联回执）。
 *
 *   node tools/make-receipt-fixture.js
 *   PRINTSHELF_DATA_DIR=data/audit-receipt node launch.js \
 *     --capture=data/probe.png --ui-script=tools/probe-receipts-autolink.js
 *
 * 设计：
 *   · 沙奈朵拆(3)_plate_2  → 应自动关联到「沙奈朵拆(3)」
 *   · 组合体_PETG_6h4m     → 应自动关联到「组合体」
 *   · 完全不相干的模型甲   → 不该乱连
 * 跑完可以直接删掉 data/audit-receipt。
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'data', 'audit-receipt');
fs.mkdirSync(dir, { recursive: true });
const now = Date.now();

function model(id, fileName, title) {
  return {
    id,
    path: path.join(dir, 'files', fileName),
    fileName,
    ext: '3mf',
    folderId: 'fld_probe',
    relativePath: 'files' + path.sep + fileName,
    size: 1024,
    mtime: now,
    hash: 'h-' + id,
    createdAt: now - 86400000,
    updatedAt: now,
    status: 'ok',
    missingSince: null,
    parseError: null,
    meta: {
      objectCount: 1, buildItemCount: 1, plateCount: 1, filamentCount: 1,
      hasThumbnail: false, hasSliceInfo: false, hasMultiColor: false,
      title, thumbnailEntry: null, entryCount: 3,
      weightChecked: true, weightG: 20, weightSource: 'probe', filamentUsages: [],
    },
    thumbSource: null,
    title,
    favorite: false,
    rating: 0,
    note: null,
    categoryId: null,
    tagIds: [],
    lastOpenedAt: null,
    openCount: 0,
    lastPrintedAt: null,
    printCount: 0,
    printStatus: 'unprinted',
  };
}

const lib = {
  schemaVersion: 3,
  updatedAt: now,
  models: {
    'mk-sana': model('mk-sana', '沙奈朵拆(3).3mf', '沙奈朵拆(3)'),
    'mk-zuti': model('mk-zuti', '组合体.3mf', '组合体'),
    'mk-other': model('mk-other', '完全不相干的模型甲.3mf', '完全不相干的模型甲'),
  },
  categories: [],
  tags: [],
  savedViews: [],
  scanMeta: {},
};

function receipt(id, jobName, result, startedAt) {
  return {
    id,
    jobName,
    printerId: 'pr-probe',
    printerName: '拓竹 3DP-26A-721',
    result,
    startedAt,
    endedAt: startedAt + 6 * 60000,
    modelId: null,
    modelTitle: null,
    linkedAt: null,
    linkedManually: false,
    weightG: null,
    cost: 0,
    filamentNames: [],
    note: '',
    durationMin: 6,
  };
}

const receipts = {
  schemaVersion: 3,
  updatedAt: now,
  items: [
    receipt('rcp-probe-sana', '沙奈朵拆(3)_plate_2', 'finished', now - 3 * 3600000),
    receipt('rcp-probe-zuti', '组合体_PETG_6h4m.gcode', 'finished', now - 2 * 3600000),
    receipt('rcp-probe-none', '厨房收纳盒_v3_plate_1', 'finished', now - 3600000),
  ],
};

fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(lib, null, 2));
fs.writeFileSync(path.join(dir, 'receipts.json'), JSON.stringify(receipts, null, 2));
fs.writeFileSync(path.join(dir, 'settings.json'),
  JSON.stringify({ schemaVersion: 3, folders: [], theme: 'dark' }, null, 2));
console.log('fixture 就绪：' + dir + '（3 模型 / 3 回执）');
