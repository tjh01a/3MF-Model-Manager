'use strict';
/**
 * A · 几何指纹：同款变体识别。
 * 全部用合成网格（立方体 / 圆柱 / 球 / 圆环 / 组合体）写成 3MF，在临时目录里跑，不碰真实模型。
 *   node tests/shapeprint-tests.js            正常跑
 *   node tests/shapeprint-tests.js --verbose  额外打印两两距离，方便校准阈值
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const SP = require('../src/core/shapeprint');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

// ---------------------------------------------------------------- 合成网格

function cube(size = 10, c = [0, 0, 0]) {
  const h = size / 2;
  const V = [];
  for (const z of [-h, h]) for (const y of [-h, h]) for (const x of [-h, h]) V.push(c[0] + x, c[1] + y, c[2] + z);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const F = [];
  for (const q of quads) F.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  return { V, F };
}

function cylinder(r = 5, h = 10, segs = 48) {
  const V = [], F = [];
  for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; V.push(r * Math.cos(a), r * Math.sin(a), -h / 2); }
  for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; V.push(r * Math.cos(a), r * Math.sin(a), h / 2); }
  V.push(0, 0, -h / 2, 0, 0, h / 2);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    F.push(i, j, segs + j, i, segs + j, segs + i, 2 * segs, j, i, 2 * segs + 1, segs + i, segs + j);
  }
  return { V, F };
}

function sphere(r = 6, sub = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < sub; s++) { const m = subdivide(V, F); V = m.V; F = m.F; }
  const out = [];
  for (let i = 0; i < V.length; i += 3) {
    const l = Math.hypot(V[i], V[i + 1], V[i + 2]) || 1;
    out.push((V[i] / l) * r, (V[i + 1] / l) * r, (V[i + 2] / l) * r);
  }
  return { V: out, F };
}

function torus(R = 8, r = 3, segs = 40, sides = 16) {
  const V = [], F = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    for (let j = 0; j < sides; j++) {
      const b = (j / sides) * Math.PI * 2;
      V.push((R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b));
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j;
    const b = ((i + 1) % segs) * sides + j;
    const c = ((i + 1) % segs) * sides + ((j + 1) % sides);
    const d = i * sides + ((j + 1) % sides);
    F.push(a, b, c, a, c, d);
  }
  return { V, F };
}

/** 每个三角面拆成 4 个（中点）：形状不变，面数 ×4 */
function subdivide(V, F) {
  const nV = V.slice();
  const cache = new Map();
  const mid = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a;
    if (cache.has(k)) return cache.get(k);
    const id = nV.length / 3;
    nV.push((V[3 * a] + V[3 * b]) / 2, (V[3 * a + 1] + V[3 * b + 1]) / 2, (V[3 * a + 2] + V[3 * b + 2]) / 2);
    cache.set(k, id);
    return id;
  };
  const nF = [];
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f], b = F[f + 1], c = F[f + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    nF.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { V: nV, F: nF };
}
const remesh = (m) => subdivide(m.V, m.F);

const mapV = (m, fn) => ({ V: m.V.map((x, i) => fn(x, i % 3)), F: m.F.slice() });
const scale = (m, s) => mapV(m, (x) => x * s);
const translate = (m, d) => mapV(m, (x, k) => x + d[k]);
const mirror = (m) => mapV(m, (x, k) => (k === 0 ? -x : x));
function rotate(m, ax, ay, az) {
  const out = [];
  for (let i = 0; i < m.V.length; i += 3) {
    let x = m.V[i], y = m.V[i + 1], z = m.V[i + 2];
    let y1 = y * Math.cos(ax) - z * Math.sin(ax), z1 = y * Math.sin(ax) + z * Math.cos(ax); y = y1; z = z1;
    let x1 = x * Math.cos(ay) + z * Math.sin(ay), z2 = -x * Math.sin(ay) + z * Math.cos(ay); x = x1; z = z2;
    let x2 = x * Math.cos(az) - y * Math.sin(az), y2 = x * Math.sin(az) + y * Math.cos(az); x = x2; y = y2;
    out.push(x, y, z);
  }
  return { V: out, F: m.F.slice() };
}
/** 顶点顺序打乱（切片软件重新导出时很常见） */
function shuffle(m, seed = 7) {
  const n = m.V.length / 3;
  let a = seed;
  const rand = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const V = new Array(n * 3);
  for (let i = 0; i < n; i++) { V[3 * perm[i]] = m.V[3 * i]; V[3 * perm[i] + 1] = m.V[3 * i + 1]; V[3 * perm[i] + 2] = m.V[3 * i + 2]; }
  return { V, F: m.F.map((x) => perm[x]) };
}
/** 三角形绕向翻转 + 每个面的三个顶点轮换 */
function flipWinding(m) {
  const F = [];
  for (let f = 0; f < m.F.length; f += 3) F.push(m.F[f + 2], m.F[f], m.F[f + 1]);
  return { V: m.V.slice(), F };
}
function union(...meshes) {
  const V = [], F = [];
  let off = 0;
  for (const m of meshes) {
    V.push(...m.V);
    for (const x of m.F) F.push(x + off);
    off += m.V.length / 3;
  }
  return { V, F };
}
/** 小船：船体圆柱 + 烟囱 + 舱室，几种基本体的组合，更像真实模型 */
function boat() {
  return union(
    translate(cylinder(12, 30), [0, 0, -10]),
    translate(cylinder(5, 22), [0, 4, 12]),
    translate(cube(10), [-4, 6, 14]),
  );
}

// ---------------------------------------------------------------- 写成 3MF

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-shape-'));
function write3mf(name, mesh, colour) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + '<resources><object id="1" type="model"><mesh><vertices>';
  for (let i = 0; i < mesh.V.length; i += 3) {
    xml += '<vertex x="' + mesh.V[i].toFixed(5) + '" y="' + mesh.V[i + 1].toFixed(5) + '" z="' + mesh.V[i + 2].toFixed(5) + '"/>';
  }
  xml += '</vertices><triangles>';
  for (let i = 0; i < mesh.F.length; i += 3) {
    xml += '<triangle v1="' + mesh.F[i] + '" v2="' + mesh.F[i + 1] + '" v3="' + mesh.F[i + 2] + '"/>';
  }
  xml += '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'));
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    + '</Relationships>'));
  zip.addFile('3D/3dmodel.model', Buffer.from(xml));
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({ filament_colour: colour || ['#FFFFFFFF'] })));
  const p = path.join(dir, name + '.3mf');
  zip.writeZip(p);
  return p;
}

const sigs = {};
function make(key, mesh, colour) {
  const p = write3mf(key, mesh, colour);
  sigs[key] = SP.computeSignature(p);
  sigs[key].__p = p;
  return sigs[key];
}
const pathOf = (k) => sigs[k].__p;
const sim = (a, b) => SP.similarity(sigs[a], sigs[b]);
const d = (a, b) => sim(a, b).dist;

console.log('\n[1. 指纹基本性质]');
make('cube', cube());
ok('能从 3MF 算出指纹', !!(sigs.cube && sigs.cube.h && sigs.cube.h.d1), JSON.stringify(sigs.cube).slice(0, 90));
const again = SP.computeSignature(pathOf('cube'));
const cubeNoPath = Object.assign({}, sigs.cube); delete cubeNoPath.__p;
ok('确定性：同一文件两次计算结果一致', JSON.stringify(again) === JSON.stringify(cubeNoPath));const t0 = Date.now();
for (let i = 0; i < 20; i++) SP.computeSignature(pathOf('cube'));
const per = (Date.now() - t0) / 20;
ok('单个文件计算耗时可接受（< 150ms）', per < 150, per.toFixed(1) + 'ms');

console.log('\n[2. 同一模型的各种「变形」');
make('cubeRot', rotate(translate(cube(), [37, -12, 5]), 0.4, 1.1, 2.3));
make('cubeRemesh', remesh(remesh(cube())));
make('cubeShuffle', flipWinding(shuffle(rotate(cube(), 0.2, 0.9, 1.7))));
make('cubeMirror', mirror(cube()));
make('cubeColor', cube(), ['#FF0000FF', '#00FF00FF']);
make('cube125', scale(cube(), 1.25));
make('cube200', scale(rotate(cube(), 0.3, 0.8, 0.1), 2));
make('cubeFar', translate(cube(), [500, -300, 120]));

const sameCases = ['cubeRot', 'cubeRemesh', 'cubeShuffle', 'cubeMirror', 'cubeColor', 'cubeFar'];
let worst = 0;
for (const k of sameCases) {
  const r = sim('cube', k);
  if (r.dist > worst) worst = r.dist;
  ok('立方体 vs ' + k + ' → 同一模型', r.role === 'same', 'dist=' + r.dist + ' score=' + r.score);
}
ok('「同一模型」里最差的一次仍明显低于阈值（留出余量）', worst <= SP.SAME_DIST * 0.7, 'worst=' + worst + ' SAME=' + SP.SAME_DIST);
const r125 = sim('cube', 'cube125');
ok('等比放大 1.25 倍 → 缩放版，倍数约 1.25', r125.role === 'scaled' && Math.abs(r125.scale - 1.25) < 0.03, 'dist=' + r125.dist + ' ×' + r125.scale);
const r200 = sim('cube', 'cube200');
ok('等比放大 2 倍 → 缩放版，倍数约 2', r200.role === 'scaled' && Math.abs(r200.scale - 2) < 0.03, 'dist=' + r200.dist + ' ×' + r200.scale);

console.log('\n[3. 真实感一点的组合体：换个姿势重新导出');
make('boat', boat());
make('boat2', rotate(translate(boat(), [120, 40, -60]), 1.2, 0.4, 2.2));
make('boat3', remesh(shuffle(boat())));
make('boatBig', scale(boat(), 1.5));
for (const k of ['boat2', 'boat3']) {
  const r = sim('boat', k);
  ok('小船 vs ' + k + ' → 同一模型', r.role === 'same', 'dist=' + r.dist);
}
ok('小船放大 1.5 倍 → 缩放版', sim('boat', 'boatBig').role === 'scaled', '×' + sim('boat', 'boatBig').scale);

console.log('\n[4. 改过的版本：小改动算疑似，大改动不再算同款');
make('cubeBump', union(cube(), translate(cube(5), [0, 0, 7.5])));
make('boatPlus', union(boat(), translate(cube(9), [10, -3, 8])));
make('boatNoCabin', union(translate(cylinder(12, 30), [0, 0, -10]), translate(cylinder(5, 22), [0, 4, 12])));
const rb = sim('cube', 'cubeBump');
ok('立方体加了大凸台 → 不再算同一模型', rb.role !== 'same', 'dist=' + rb.dist + ' role=' + rb.role);
ok('立方体加了大凸台 → 相似度明显低于同一模型', rb.dist > worst * 2.5, 'dist=' + rb.dist);
const rp = sim('boat', 'boatPlus');
ok('小船加个小凸起 → 疑似同款', rp.role === 'maybe', 'dist=' + rp.dist + ' role=' + rp.role);
const rn = sim('boat', 'boatNoCabin');
ok('小船去掉整个舱室 → 至少不算同一模型', rn.role !== 'same', 'dist=' + rn.dist + ' role=' + rn.role);

console.log('\n[5. 不同模型不分组');
make('cyl', cylinder(5, 10));
make('cyl2', rotate(cylinder(5, 10), 1, 2, 0.3));
make('cylTall', cylinder(5, 40));
make('sphere', sphere(6.2));
make('torus', torus(8, 3));
const flat = { V: cube(20).V.map((x, i) => (i % 3 === 2 ? x * 0.2 : x)), F: cube(20).F };
make('flat', flat);
ok('圆柱 vs 换姿势的圆柱 → 同一模型', sim('cyl', 'cyl2').role === 'same', 'dist=' + d('cyl', 'cyl2'));
ok('立方体 vs 矮圆柱 → 不分组（棱长不同：立方体 12 条棱，圆柱只有两圈边）', sim('cube', 'cyl').role === null, 'dist=' + d('cube', 'cyl'));
const diffPairs = [['cube', 'sphere'], ['cube', 'torus'], ['cube', 'flat'], ['cube', 'boat'], ['cyl', 'torus'],
  ['sphere', 'torus'], ['cyl', 'cylTall'], ['cyl', 'boat'], ['torus', 'boat'], ['boat', 'cubeBump']];
for (const [a, b] of diffPairs) {
  const r = sim(a, b);
  ok(a + ' vs ' + b + ' → 不分组', r.role === null, 'dist=' + r.dist + ' role=' + r.role);
}
const stretch = { V: cube().V.map((x, i) => (i % 3 === 2 ? x * 1.6 : x)), F: cube().F };
make('stretch', stretch);
ok('立方体被拉高 60% → 不分组', sim('cube', 'stretch').role === null, 'dist=' + d('cube', 'stretch') + ' role=' + sim('cube', 'stretch').role);

if (VERBOSE) {
  console.log('\n---- 距离明细（校准用）----');
  const keys = Object.keys(sigs);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const r = sim(keys[i], keys[j]);
    const p = r.parts;
    console.log('  ' + keys[i].padEnd(11) + ' vs ' + keys[j].padEnd(11) + ' dist=' + String(r.dist).padEnd(6)
      + ' d1=' + p.d1.toFixed(3) + ' d2=' + p.d2.toFixed(3) + ' d3=' + p.d3.toFixed(3) + ' d4=' + p.d4.toFixed(3) + ' a3=' + p.a3.toFixed(3));
  }
}

console.log('\n[6. 分组（ShapeIndex.annotate）');
const idxFile = path.join(dir, 'shapeprints.json');
const idx = new SP.ShapeIndex(idxFile);
const lib = { models: {} };
const strip = (s) => { const o = Object.assign({}, s); delete o.__p; return o; };
function addRec(id, key, createdAt) {
  lib.models[id] = { id, path: pathOf(key), hash: 'h-' + key, createdAt, status: 'ok', fileName: key + '.3mf' };
  idx.set(id, Object.assign({ s: 'h-' + key }, strip(sigs[key])));
}
addRec('a', 'cube', 300);
addRec('b', 'cubeRot', 100);
addRec('c', 'cubeShuffle', 200);
addRec('d', 'cyl', 150);
addRec('e', 'torus', 160);
addRec('f', 'cubeBump', 170);
addRec('g', 'cube125', 140);
// 过期指纹：hash 对不上 → 不参与
lib.models.stale = { id: 'stale', path: pathOf('flat'), hash: 'changed', createdAt: 1, status: 'ok' };
idx.set('stale', Object.assign({ s: 'old-hash' }, strip(sigs.flat)));
// 算失败的条目
lib.models.nf = { id: 'nf', path: 'x', hash: 'x', createdAt: 1, status: 'ok' };
idx.set('nf', { failed: 'no-mesh' });
// 别名 / 失效 / 坏文件不参与
lib.models.al = { id: 'al', path: pathOf('cube'), hash: 'h-cube', createdAt: 1, status: 'ok', aliasOf: 'a' };
idx.set('al', Object.assign({ s: 'h-cube' }, strip(sigs.cube)));

const ann = idx.annotate(lib);
ok('只分出 1 组（立方体家族）', ann.groups === 1, JSON.stringify(ann));
ok('最早入库的 b 是基准（b 100 < g 140 < a 300）', lib.models.b.variantRole === 'base', lib.models.b.variantRole);
ok('a / c / g 都归到 b 这一组',
  ['a', 'c', 'g'].every((k) => lib.models[k].variantGroup === 'var:b'), JSON.stringify({ a: lib.models.a.variantGroup, c: lib.models.c.variantGroup, g: lib.models.g.variantGroup }));
ok('a / c 标为同一模型', lib.models.a.variantRole === 'same' && lib.models.c.variantRole === 'same', lib.models.a.variantRole + '/' + lib.models.c.variantRole);
ok('g 标为缩放版并记下倍数', lib.models.g.variantRole === 'scaled' && Math.abs(lib.models.g.variantScale - 1.25) < 0.05, lib.models.g.variantRole + ' ×' + lib.models.g.variantScale);
ok('矮圆柱 d 不在组里', !lib.models.d.variantGroup);
ok('带大凸台的 f 差太多，不进组', !lib.models.f.variantGroup, 'dist=' + SP.similarity(sigs.cubeRot, sigs.cubeBump).dist);
ok('圆环 / 过期 / 别名 / 失败 都不在任何组里',
  ['e', 'stale', 'al', 'nf'].every((k) => !lib.models[k].variantGroup));
ok('相似度写回了记录', lib.models.a.variantScore >= 0.9, lib.models.a.variantScore);
ok('再跑一次结果一致（幂等）', idx.annotate(lib).groups === 1 && lib.models.c.variantGroup === 'var:b');
// 事后加入的成员：关系按「和基准比」来定
lib.models.h = { id: 'h', path: pathOf('cube200'), hash: 'h-cube200', createdAt: 500, status: 'ok' };
idx.set('h', Object.assign({ s: 'h-cube200' }, strip(sigs.cube200)));
idx.annotate(lib);
ok('事后加入的放大版 → 缩放版，倍数约 2', lib.models.h.variantRole === 'scaled' && lib.models.h.variantScale > 1.9, '×' + lib.models.h.variantScale);
// 疑似：和基准的距离在 0.70~1.30 之间的成员进组，但标「疑似」
lib.models.q = { id: 'q', path: pathOf('boat'), hash: 'y', createdAt: 600, status: 'ok' };
idx.set('q', Object.assign({ s: 'y' }, strip(sigs.boat)));
lib.models.p = { id: 'p', path: pathOf('boatPlus'), hash: 'x', createdAt: 601, status: 'ok' };
idx.set('p', Object.assign({ s: 'x' }, strip(sigs.boatPlus)));
const ann3 = idx.annotate(lib);
ok('改过的版本另成一组', ann3.groups === 2, JSON.stringify(ann3));
ok('组里标「疑似」而不是「同一模型」', lib.models.q.variantRole === 'base' && lib.models.p.variantRole === 'maybe', lib.models.q.variantRole + '/' + lib.models.p.variantRole + ' dist=' + sim('boat', 'boatPlus').dist);
ok('立方体组不受影响', lib.models.a.variantGroup === 'var:b' && lib.models.b.variantRole === 'base');

console.log('\n[7. 索引落盘');
idx.flush();
ok('索引文件已写出', fs.existsSync(idxFile));
const idx2 = new SP.ShapeIndex(idxFile);
ok('重新加载后指纹还在', idx2.size === idx.size && !!idx2.get('a').h.d1, idx2.size + '/' + idx.size);
ok('指纹序列化后相似度不变', SP.similarity(idx2.get('a'), idx2.get('c')).role === 'same');
ok('清掉条目', idx2.remove(['stale', 'nf', 'nope']) === 2 && !idx2.get('stale'));
ok('状态统计', idx2.status().total === idx2.size, JSON.stringify(idx2.status()));
ok('索引文件很小（每条指纹 < 1KB）', fs.statSync(idxFile).size / idx.size < 1024, Math.round(fs.statSync(idxFile).size / idx.size) + 'B');

console.log('\n[8. 大库分桶不漏掉同款');
const big = [];
for (let i = 0; i < 60; i++) {
  big.push({ sig: i === 7 ? sigs.cube125 : (i % 3 === 0 ? sigs.sphere : i % 3 === 1 ? sigs.cyl : sigs.torus) });
}
big.push({ sig: sigs.cubeRot });
const prs = SP.candidatePairs(big);
let hit = false;
for (const [i, j] of prs) if ((i === 7 && j === 60) || (i === 60 && j === 7)) hit = true;
ok('分桶候选里包含那对同款', hit, 'pairs=' + prs.length);

console.log('\n[9. 边界');
ok('不存在的文件：不抛，返回 failed', !!SP.computeSignature(path.join(dir, 'nope.3mf')).failed);
const empty3mf = path.join(dir, 'empty.3mf');
const zEmpty = new AdmZip();
zEmpty.addFile('[Content_Types].xml', Buffer.from('x'));
zEmpty.writeZip(empty3mf);
ok('没有网格的 3MF：failed=no-mesh', SP.computeSignature(empty3mf).failed === 'no-mesh');
const plain = path.join(dir, 'plain.3mf');
fs.writeFileSync(plain, 'not a zip');
ok('不是 zip：failed=no-mesh（read-error 也允许）', ['no-mesh', 'read-error'].includes(SP.computeSignature(plain).failed), SP.computeSignature(plain).failed);
ok('两份坏指纹距离为无穷', SP.similarity(null, {}).dist === Infinity);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 临时目录，尽力清理 */ }

console.log('\n' + '='.repeat(56));
console.log('  几何指纹测试：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(56));
process.exitCode = fail ? 1 : 0;
