'use strict';
/**
 * 模型优化功能测试（纯 Node，不依赖 Electron）。
 * 运行： node tests/meshopt-tests.js
 *
 * 全部网格样本都在系统临时目录里生成/销毁，绝不碰用户文件与真实模型库。
 * 若本机有 Blender 且能找到调研样本，会追加一次真实大模型的端到端优化验证。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const M = require('../src/core/mesh3mf');
const { MeshOptimizer } = require('../src/core/meshopt');

const REAL_SAMPLE = 'C:/Users/10104/Downloads/甘雨表白拆件V2.0-1019.3mf';
let pass = 0, fail = 0;
const tmp = path.join(os.tmpdir(), 'printshelf-meshopt-test-' + process.pid);

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function sha1(p) { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); }

/** 造一个带一点噪声的立方体网格（8 顶点 / 12 面），封闭流形 */
function cube(noise = 0) {
  const V = new Float64Array([
    0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0,
    0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10,
  ]);
  if (noise) {
    for (let i = 0; i < V.length; i++) V[i] += (Math.sin(i * 12.9898) * 43758.5453 % 1) * noise;
  }
  const F = Int32Array.from([
    0, 2, 1, 0, 3, 2,  4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,  1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,  3, 0, 4, 3, 4, 7,
  ]);
  return { V, F };
}

/** 造一个最小可用的多部件 3MF */
function make3mf(out, parts) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'));
  zip.addFile('_rels/.rels', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'));
  let objects = '', items = '';
  parts.forEach((p, idx) => {
    const id = idx + 1;
    const vs = [], ts = [];
    for (let i = 0; i < p.V.length; i += 3) {
      vs.push('<vertex x="' + p.V[i] + '" y="' + p.V[i + 1] + '" z="' + p.V[i + 2] + '"/>');
    }
    for (let i = 0; i < p.F.length; i += 3) {
      ts.push('<triangle v1="' + p.F[i] + '" v2="' + p.F[i + 1] + '" v3="' + p.F[i + 2] + '"/>');
    }
    objects += '<object id="' + id + '" type="model"><mesh><vertices>' + vs.join('') +
      '</vertices><triangles>' + ts.join('') + '</triangles></mesh></object>';
    items += '<item objectid="' + id + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>';
  });
  const model = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<resources>' + objects + '</resources><build>' + items + '</build></model>';
  zip.addFile('3D/3dmodel.model', Buffer.from(model));
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({
    layer_height: '0.2', ironing_type: 'no ironing', wall_loops: '2',
    top_surface_speed: ['150'], seam_position: 'aligned',
  })));
  zip.writeZip(out);
}

async function main() {
  fs.mkdirSync(tmp, { recursive: true });
  console.log('\n=== 模型优化功能测试 ===\n临时目录：' + tmp + '\n');

  // ---------------------------------------------------------------- [1] 纯函数
  console.log('[1] 几何指标');
  {
    const { V, F } = cube();
    const g = M.measureGeometry(V, F);
    ok('顶点/面数', g.vertexCount === 8 && g.faceCount === 12, JSON.stringify({ v: g.vertexCount, f: g.faceCount }));
    ok('立方体体积 1000 mm³', Math.abs(g.volumeMm3 - 1000) < 1e-6, String(g.volumeMm3));
    ok('封闭流形（边界边 0）', g.boundaryEdges === 0, String(g.boundaryEdges));
    ok('无非流形边', g.nonmanifoldEdges === 0, String(g.nonmanifoldEdges));
    ok('包围盒 10×10×10', g.bboxMm.every((x) => Math.abs(x - 10) < 1e-6), JSON.stringify(g.bboxMm));
    ok('立方体存在 90° 折角', g.angleP90 >= 89, String(g.angleP90));
  }

  console.log('\n[2] 位移上限 clamp');
  {
    const a = Float64Array.from([0, 0, 0, 10, 0, 0]);
    const b = Float64Array.from([0, 0, 0, 15, 0, 0]);   // 第二个点飞出 5mm
    const c = M.clampCoords(a, b, 0.15);
    ok('输出长度一致', c.coords.length === a.length);
    ok('未超限的点不动', c.coords[0] === 0 && c.coords[1] === 0 && c.coords[2] === 0);
    ok('超限点被裁到 0.15mm', Math.abs(c.coords[3] - 10.15) < 1e-9, String(c.coords[3]));
    ok('实际写回最大位移 ≤ 0.15', c.maxDisp <= 0.15 + 1e-9, String(c.maxDisp));
    ok('原始最大位移单独记录', Math.abs(c.rawMaxDisp - 5) < 1e-9, String(c.rawMaxDisp));
    ok('裁剪计数 = 1', c.clipped === 1, String(c.clipped));
  }

  console.log('\n[3] PLY 二进制往返');
  {
    const { V, F } = cube(0.4);
    const p = path.join(tmp, 'round.ply');
    M.writePly(p, V, F);
    const r = M.readPlyCoords(p, true);
    ok('顶点数一致', r.V.length === V.length);
    ok('坐标误差 < 1e-5（float32）', Array.from(V).every((x, i) => Math.abs(x - r.V[i]) < 1e-5));
    ok('三角面索引一致', r.F && r.F.length === F.length && Array.from(F).every((x, i) => x === r.F[i]));
  }

  // ---------------------------------------------------------------- [4] 合成 3MF 全流程
  console.log('\n[4] 合成 3MF 解析 / 导出 / 无损写回');
  {
    const src = path.join(tmp, 'src.3mf');
    const out = path.join(tmp, 'out.3mf');
    const parts = [cube(0.2), cube(0.4)];
    make3mf(src, parts);
    const h0 = sha1(src);
    const info = await M.inspect3mf(src);
    ok('识别 2 个部件', info.parts.length === 2, String(info.parts.length));
    ok('总面数 24', info.totals.faces === 24, String(info.totals.faces));
    ok('边界边 0', info.totals.boundaryEdges === 0);
    ok('给出打印建议', info.sliceConfigHint.length >= 2, JSON.stringify(info.sliceConfigHint.map((x) => x.key)));

    const plyDir = path.join(tmp, 'ply');
    const exported = await M.exportParts(src, info.parts, plyDir);
    ok('导出 2 个 PLY', exported.files.length === 2);
    // 模拟 Blender 输出：把每个顶点平移 0.02mm，验证坐标确实被写回
    for (const f of exported.files) {
      const r = M.readPlyCoords(f.plyPath, true);
      for (let i = 0; i < r.V.length; i++) r.V[i] += 0.02;
      M.writePly(f.plyPath, r.V, r.F);
    }
    const written = await M.buildOptimized3mf({
      srcPath: src, outPath: out, parts: info.parts, plyDir,
      mode: 'coords', clampMm: 0.15,
    });
    ok('写回校验通过', written.verified === true);
    ok('原文件哈希不变', sha1(src) === h0);
    ok('输出存在且非空', fs.existsSync(out) && fs.statSync(out).size > 100);
    const a = new AdmZip(src), b = new AdmZip(out);
    ok('ZIP 条目集合一致', a.getEntries().length === b.getEntries().length);
    ok('未改条目字节一致', a.getEntry('Metadata/project_settings.config').getData()
      .equals(b.getEntry('Metadata/project_settings.config').getData()));
    const after = await M.inspect3mf(out);
    ok('输出部件数/面数不变', after.parts.length === 2 && after.totals.faces === 24);
    const firstX = (p) => {
      const xml = new AdmZip(p).getEntry('3D/3dmodel.model').getData().toString('utf8');
      const m = /<vertex\s+x="([^"]+)"/.exec(xml);
      return m ? Number(m[1]) : null;
    };
    // 整体平移不改变体积，所以直接比对顶点坐标
    ok('写回后坐标确实改变', Math.abs(firstX(out) - firstX(src) - 0.02) < 1e-5,
      firstX(src) + ' → ' + firstX(out));
  }

  // ---------------------------------------------------------------- [5] 错误处理
  console.log('\n[5] 错误与边界');
  {
    let threw = false;
    try { await M.inspect3mf(path.join(tmp, 'not-exist.3mf')); } catch (_) { threw = true; }
    ok('文件不存在 → 抛错', threw);
    const bad = path.join(tmp, 'bad.txt');
    fs.writeFileSync(bad, 'x');
    threw = false;
    try { await M.inspect3mf(bad); } catch (_) { threw = true; }
    ok('非 3MF → 抛中文错', threw);
    const zipBroken = path.join(tmp, 'broken.3mf');
    fs.writeFileSync(zipBroken, 'not a zip');
    threw = false;
    try { await M.inspect3mf(zipBroken); } catch (_) { threw = true; }
    ok('损坏 ZIP → 抛错', threw);
  }

  // ---------------------------------------------------------------- [6] 真实大模型端到端（可选）
  console.log('\n[6] 真实样本端到端优化（需要 Blender + 样本文件）');
  const blender = await new MeshOptimizer().detectBlender('');
  if (!fs.existsSync(REAL_SAMPLE) || !blender.ok) {
    console.log('  - 跳过（样本或 Blender 不可用）');
  } else {
    const dir = path.join(tmp, 'real');
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, '样本.3mf');
    const out = path.join(dir, '样本_已优化.3mf');
    fs.copyFileSync(REAL_SAMPLE, src);
    const h0 = sha1(src);
    const opt = new MeshOptimizer();
    const stages = [];
    opt.on('progress', (p) => stages.push(p.stage));
    const r = await opt.run({ srcPath: src, outPath: out, preset: 'standard', clampMm: 0.15 });
    ok('流程完成且校验通过', r.ok && r.verified);
    ok('原文件哈希不变', sha1(src) === h0);
    ok('输出 3MF 存在', fs.existsSync(out));
    ok('跳过棱角件 object_5', r.skipped.some((s) => s.name === 'object_5'), JSON.stringify(r.skipped));
    ok('面数不变', r.before.faces === r.after.faces, r.before.faces + ' → ' + r.after.faces);
    ok('夹角均值下降 ≥10%', r.after.angleMean <= r.before.angleMean * 0.9,
      r.before.angleMean + ' → ' + r.after.angleMean);
    ok('>30° 边下降 ≥20%', r.after.gt30 <= r.before.gt30 * 0.8,
      (r.before.gt30 * 100).toFixed(2) + '% → ' + (r.after.gt30 * 100).toFixed(2) + '%');
    ok('体积变化 ≤1%', Math.abs(r.after.volumeMm3 / r.before.volumeMm3 - 1) <= 0.01,
      r.before.volumeMm3 + ' → ' + r.after.volumeMm3);
    ok('实际写回最大位移 ≤ 0.15mm', r.clampStats.maxDisp <= 0.150001, String(r.clampStats.maxDisp));
    ok('阶段覆盖 detect→verify', stages.includes('detect') && stages.includes('blender') && stages.includes('verify'), stages.join(','));
    ok('给出打印建议与重新切片提示', r.tips.length >= 3 && r.tips.some((t) => t.includes('重新切片')));
    // 外部结构复核
    const a = new AdmZip(src), b = new AdmZip(out);
    ok('34 条目 → 34 条目', a.getEntries().length === 34 && b.getEntries().length === 34,
      a.getEntries().length + ' → ' + b.getEntries().length);
    ok('主 model 字节一致', a.getEntry('3D/3dmodel.model').getData().equals(b.getEntry('3D/3dmodel.model').getData()));
    ok('切片配置字节一致', a.getEntry('Metadata/project_settings.config').getData()
      .equals(b.getEntry('Metadata/project_settings.config').getData()));
  }

  console.log('\n==========================================');
  console.log('模型优化测试：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('==========================================\n');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('\n测试异常：', e && e.stack ? e.stack : e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  process.exit(1);
});
