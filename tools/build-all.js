'use strict';
/**
 * 一键打包：绿色版目录 + 便携 zip。
 *
 *   node tools/build-all.js            完整构建（覆盖旧目录，zip 已存在则跳过）
 *   node tools/build-all.js --force    连 zip 一起覆盖重建
 *
 * 各步骤用子进程跑，任何一个失败都会立刻中断并返回非 0 退出码，
 * 这样 CI / bat 里调用时不会出现「目录新、zip 旧」的半成品。
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function run(label, script, args) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: false,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${label} 失败，退出码 ${r.status}`);
  }
}

function main() {
  const start = Date.now();
  const force = process.argv.includes('--force');

  run('1/2 构建绿色版目录', 'build-portable.js', []);
  run('2/2 生成便携 zip', 'build-zip.js', force ? ['--force'] : []);

  const portable = require('./build-portable.js');
  const indexPath = path.join(portable.DIST_ROOT, portable.OUT_NAME, `${portable.APP_NAME}.exe`);
  const zipPath = path.join(portable.DIST_ROOT, `${portable.APP_NAME}-${portable.VERSION}-portable.zip`);
  const fs = require('fs');

  process.stdout.write('\n=== 产物清单 ===\n');
  if (fs.existsSync(indexPath)) {
    process.stdout.write(`  目录：${path.join(portable.DIST_ROOT, portable.OUT_NAME)}\n`);
    process.stdout.write(`        ${portable.humanSize(portable.dirSize(path.join(portable.DIST_ROOT, portable.OUT_NAME)))}\n`);
  }
  if (fs.existsSync(zipPath)) {
    process.stdout.write(`  zip ：${zipPath}\n`);
    process.stdout.write(`        ${portable.humanSize(fs.statSync(zipPath).size)}\n`);
  }
  process.stdout.write(`\n[all] 全部完成，总耗时 ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write('\n[all] 打包失败：' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  }
}
