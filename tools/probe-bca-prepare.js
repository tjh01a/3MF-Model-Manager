'use strict';
/**
 * 给 B/C/A 走查探针准备一个隔离数据目录：造样本 → 建库 → 扫描 → 算完几何指纹。
 *
 * 用法：node tools/probe-bca-prepare.js <数据目录>
 * 之后：set PRINTSHELF_DATA_DIR=<数据目录> && node launch.js --capture=out.png --ui-script=tools/probe-xxx.js
 *
 * 只写传入的目录；不传参数时拒绝执行，避免手滑写进真实 data/。
 */
const fs = require('fs');
const path = require('path');
const { build } = require('./probe-bca-seed');

const dataDir = process.argv[2];
if (!dataDir) {
  console.error('请显式传入临时数据目录，例如：node tools/probe-bca-prepare.js %TEMP%/ps-probe-bca');
  process.exit(2);
}
const dir = path.resolve(dataDir);
if (dir === path.resolve(__dirname, '..', 'data')) {
  console.error('拒绝把探针数据写进项目真实 data/');
  process.exit(2);
}

const paths = require('../src/core/paths');
fs.rmSync(dir, { recursive: true, force: true });   // 整个临时库重建：上一轮探针可能隔离/合并过文件
paths.setDataDir(dir);
const Services = require('../electron/services');

(async () => {
  const scanRoot = path.join(dir, 'scan-root');
  fs.mkdirSync(dir, { recursive: true });
  build(scanRoot);

  const svc = new Services();
  await svc.init({ autoWatch: false });
  await svc.folderAdd(scanRoot);
  const r = await svc.scanner.scanAll({ force: true });
  console.log('scan', JSON.stringify({ added: r.added, failed: r.failed, duplicates: r.duplicateGroups }));

  // 几何指纹是后台任务：这里同步等它算完，探针里就能直接看到「同款变体」分组
  svc.shapeRun({ force: true });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const st = svc.shapeStatus();
    if (!st.running && !st.pending) break;
    await new Promise((res) => setTimeout(res, 200));
  }
  const st = svc.shapeStatus();
  const groups = (svc.store.getLibrary().models || {});
  const variants = Object.values(groups).filter((m) => m && m.variantGroup).length;
  console.log('shape', JSON.stringify({ total: st.total, failed: st.failed, pending: st.pending, variantRecords: variants }));
  console.log('broken', JSON.stringify({ total: svc.brokenList().summary.total, repairable: svc.brokenList().summary.repairable }));
  console.log('ready', dir);
  process.exit(0);   // Services 会留下打印机/监视器句柄，准备脚本不需要常驻
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
