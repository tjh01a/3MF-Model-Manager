/**
 * 一次性夹具：为「一键清除」的**会真删**走查准备临时库（4 记录 / 2 组重复）。
 *
 *   node tools/make-dup-fixture.js --from "D:\模型\任意.3mf"
 *   PRINTSHELF_DATA_DIR=data/audit-dup node launch.js \
 *     --capture=data/probe.png --ui-script=tools/probe-dup-cleanup-exec.js
 *
 * 生成目录：data/audit-dup/{library.json, settings.json, files/*.3mf}
 * 走查会把多余副本移入系统回收站（可恢复），跑完可直接删掉 data/audit-dup。
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'data', 'audit-dup');
const base = Date.now();

// --from 给一个真实 .3mf，复制出四个副本；不给则要求 files/ 里已经有四个文件
const fromIdx = process.argv.indexOf('--from');
const from = fromIdx > 0 ? path.resolve(process.argv[fromIdx + 1]) : null;
fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
if (from) {
  if (!fs.existsSync(from)) throw new Error('找不到样本文件：' + from);
  for (const n of ['a.3mf', 'a-copy.3mf', 'b.3mf', 'b-copy.3mf']) {
    fs.copyFileSync(from, path.join(dir, 'files', n));
  }
}

function rec(id, file, group, extra) {
  const p = path.join(dir, 'files', file);
  const st = fs.statSync(p);
  return Object.assign({
    id,
    path: p,
    fileName: file,
    ext: '3mf',
    folderId: 'fld_probe',
    relativePath: 'files' + path.sep + file,
    size: st.size,
    mtime: Math.round(st.mtimeMs),
    hash: 'probe-' + group,
    createdAt: base,
    updatedAt: base,
    status: 'ok',
    missingSince: null,
    parseError: null,
    meta: {
      objectCount: 3, buildItemCount: 1, plateCount: 1, filamentCount: 1,
      hasThumbnail: false, hasSliceInfo: false, hasMultiColor: false,
      title: file, thumbnailEntry: null, entryCount: 7,
      weightChecked: true, weightG: 12, weightSource: 'probe', filamentUsages: [],
    },
    thumbSource: null,
    title: file,
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
    duplicateGroup: group,
  }, extra || {});
}

const lib = { schemaVersion: 3, updatedAt: base, models: {}, categories: [], tags: [], savedViews: [], scanMeta: {} };
// g1：a-copy 带备注+评分，按「优先留人工信息」应保留 a-copy、删 a
const a = rec('probe-a', 'a.3mf', 'g1', { createdAt: base });
const a2 = rec('probe-a-copy', 'a-copy.3mf', 'g1', { createdAt: base + 1000, note: '这是我自己标注过的副本', rating: 5 });
// g2：两个都没有人工信息，按「留最早入库」应保留 b、删 b-copy
const b = rec('probe-b', 'b.3mf', 'g2', { createdAt: base });
const b2 = rec('probe-b-copy', 'b-copy.3mf', 'g2', { createdAt: base + 1000 });
for (const r of [a, a2, b, b2]) lib.models[r.id] = r;

fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(lib, null, 2));
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ schemaVersion: 3, folders: [], theme: 'dark' }, null, 2));
console.log('models=' + Object.keys(lib.models).length);
