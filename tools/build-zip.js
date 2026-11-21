'use strict';
/**
 * 把绿色版目录压成 zip（给朋友发快递用）。
 *
 * 用项目里已有的 adm-zip，不额外装依赖。adm-zip 内部用 zlib 默认级别（6）；
 * Node 22 的 zlib 导出是只读 getter，改不了 zlib 本身，所以这里替换
 * adm-zip 自己的 methods/deflater.js 模块导出（只影响本次进程），
 * 把 compression level 提到 9，拿到最高压缩率。
 *
 * 用法：
 *   node tools/build-zip.js            已有 zip 就跳过
 *   node tools/build-zip.js --force    覆盖重建
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

const pkg = readJson(path.join(ROOT, 'package.json'));
const APP_NAME = pkg.productName || pkg.name || 'PrintShelf';
const VERSION = pkg.version || '0.0.0';
const DIR_NAME = `${APP_NAME}-${VERSION}-win-x64`;
const SRC_DIR = path.join(ROOT, 'dist', DIR_NAME);
const ZIP_PATH = path.join(ROOT, 'dist', `${APP_NAME}-${VERSION}-portable.zip`);

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

/**
 * 必须在 require adm-zip 之前替换，否则 zipEntry 已经捕获了旧函数引用。
 * 保持与原实现同样的返回结构（deflate / deflateAsync），只是 level 固定为 9。
 */
function installMaxDeflater() {
  const deflaterPath = path.join(ROOT, 'node_modules', 'adm-zip', 'methods', 'deflater.js');
  if (!fs.existsSync(deflaterPath)) {
    throw new Error('未找到 adm-zip（请先 npm install）：' + deflaterPath);
  }
  const resolved = require.resolve(deflaterPath);
  require(deflaterPath);
  require.cache[resolved].exports = function (inbuf) {
    const chunkSize = (parseInt(inbuf.length / 1024) + 1) * 1024;
    return {
      deflate: function () {
        return zlib.deflateRawSync(inbuf, { level: 9, chunkSize });
      },
      deflateAsync: function (callback) {
        const tmp = zlib.createDeflateRaw({ level: 9, chunkSize });
        const parts = [];
        let total = 0;
        tmp.on('data', function (data) { parts.push(data); total += data.length; });
        tmp.on('end', function () {
          callback && callback(Buffer.concat(parts, total));
        });
        tmp.end(inbuf);
      },
    };
  };
}

function main() {
  const force = process.argv.includes('--force');

  if (!fs.existsSync(SRC_DIR)) {
    throw new Error('未找到绿色版目录：' + SRC_DIR + '（请先运行 node tools/build-portable.js）');
  }
  if (fs.existsSync(ZIP_PATH) && !force) {
    const st = fs.statSync(ZIP_PATH);
    process.stdout.write(`[zip] 已存在 ${path.relative(ROOT, ZIP_PATH)}（${humanSize(st.size)}），跳过。加 --force 覆盖重建。\n`);
    return { zipPath: ZIP_PATH, size: st.size, skipped: true };
  }

  installMaxDeflater();
  const AdmZip = require(path.join(ROOT, 'node_modules', 'adm-zip', 'adm-zip.js'));
  const t = Date.now();
  process.stdout.write(`[zip] 压缩 ${DIR_NAME} → ${path.relative(ROOT, ZIP_PATH)} ... `);

  const zip = new AdmZip();
  zip.addLocalFolder(SRC_DIR, DIR_NAME);
  zip.writeZip(ZIP_PATH);

  const size = fs.statSync(ZIP_PATH).size;
  process.stdout.write(`完成 ${Date.now() - t}ms\n`);
  process.stdout.write(`[zip] zip 体积：${humanSize(size)}\n`);
  return { zipPath: ZIP_PATH, size, skipped: false };
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write('\n[zip] 打包失败：' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  }
}

module.exports = { main, ZIP_PATH };
