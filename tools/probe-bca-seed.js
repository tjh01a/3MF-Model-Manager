'use strict';
/**
 * B/C/A 走查用样本生成器（隔离目录，不碰用户真实库）。
 *
 * 产出：
 *   完全重复A.3mf / 完全重复B.3mf   内容逐字节相同 → 精确重复组
 *   同款变体A/B.3mf              网格相同、多了不同的附加条目 → 3MF 哈希不同，缩略图字节相同
 *   损坏-纯文本.3mf               非 zip → not-3mf（不可修复）
 *   损坏-截断.3mf                 正常 zip 砍掉后半段 → truncated（可尝试修复）
 *   损坏-缺核心.3mf               只有 3D 模型、没有 [Content_Types].xml → missing-core（可修复）
 *
 * 用法：node tools/probe-bca-seed.js [输出目录]
 * 默认输出到 %TEMP%/printshelf-bca-probe，并把路径打到 stdout。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const PNG = Buffer.from(
  // 64×64 有效 PNG（1×1 的图 Electron nativeImage 会当成空图，缩略图指纹算不出来）
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFgSURBVHhe7dA7bgMxDIThPY6PkyOm8TkdqDAQ/IAelMhdApzia6YQR3O9fn4/lV0MqtEADKrRAAyq0QAMqtEADKrRAAyifN6XGd+IEDoAP3SCb3sJG4Af8MAbHtwHYOkIvHnCdQAWjcTbu1wGYLk7sYvV8QAs9AR2stAADCxY5Enstmp7ABbIgB1XaAAGK3g4E3adMQ/Agxmx84gGYDDDYxmx84hpAB7KjN17NACDER7JjN17NACDER7JjN17NACDHh7Ijv17lgdoeCQzdu/RAAxGeCQzdu/RAAxGeCQzdu/RAAxmeCgjdh7RAAxmeCwjdh4xD9DwYCbsOrM1QMPDGbDjCg3AwIIFnsRuq44GaFjkCexkoQEY7GChO7GLlcsAXywXibd3uQ7QsGgE3jzhPsAXS3vgDQ9hAzT8wAm+7SV0gP/4oRV8I8JtA2SlARhUowEYVKMBGFSjARhUU36APwfxqbUq0k/GAAAAAElFTkSuQmCC',
  'base64');
const TYPES = '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  '<Default Extension="png" ContentType="image/png"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  '<Relationship Target="/Thumbnails/thumbnail.png" Id="rel1" ' +
  'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>' +
  '</Relationships>';

/** 20mm 立方体：8 顶点 12 三角面，形状指纹能稳定算出来（单三角面太退化） */
function cubeModel() {
  const v = [];
  for (const z of [0, 20]) for (const y of [0, 20]) for (const x of [0, 20]) v.push([x, y, z]);
  const idx = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
    [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
    [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<resources><object id="1" type="model"><mesh><vertices>' +
    v.map((p) => '<vertex x="' + p[0] + '" y="' + p[1] + '" z="' + p[2] + '"/>').join('') +
    '</vertices><triangles>' +
    idx.map((t) => '<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>').join('') +
    '</triangles></mesh></object></resources>' +
    '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>';
}

function write3mf(out, extra) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(TYPES, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(RELS, 'utf8'));
  zip.addFile('3D/3dmodel.model', Buffer.from(cubeModel(), 'utf8'));
  zip.addFile('Thumbnails/thumbnail.png', PNG);
  for (const [name, body] of Object.entries(extra || {})) zip.addFile(name, Buffer.from(body, 'utf8'));
  zip.writeZip(out);
}

function build(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const dupA = path.join(dir, '完全重复A.3mf');
  write3mf(dupA);
  fs.copyFileSync(dupA, path.join(dir, '完全重复B.3mf'));

  write3mf(path.join(dir, '同款变体A.3mf'), { 'meta.txt': 'variant A' });
  write3mf(path.join(dir, '同款变体B.3mf'), { 'meta.txt': 'variant B' });

  fs.writeFileSync(path.join(dir, '损坏-纯文本.3mf'), '这不是一个 3MF 压缩包，只是改了扩展名的文本文件。\n'.repeat(20), 'utf8');

  const full = path.join(dir, '损坏-截断.full.tmp');
  write3mf(full);
  const buf = fs.readFileSync(full);
  fs.writeFileSync(path.join(dir, '损坏-截断.3mf'), buf.subarray(0, Math.floor(buf.length * 0.55)));
  fs.unlinkSync(full);

  const noCore = new AdmZip();
  noCore.addFile('3D/3dmodel.model', Buffer.from(cubeModel(), 'utf8'));
  noCore.writeZip(path.join(dir, '损坏-缺核心.3mf'));

  return dir;
}

if (require.main === module) {
  const dir = process.argv[2] || path.join(os.tmpdir(), 'printshelf-bca-probe');
  build(dir);
  console.log(dir);
}

module.exports = { build };
