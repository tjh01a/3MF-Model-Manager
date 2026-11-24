'use strict';
/**
 * PrintShelf · 3MF 网格桥接层（纯 Node，无 Electron 依赖，可直接跑测试）
 *
 * 设计要点（见 docs/04、docs/05）：
 *  1. 3MF 是 ZIP。Bambu/Orca 拆件工程把网格放在 3D/Objects/*.model，
 *     主 3D/3dmodel.model 只存 object 壳与 build 变换；标准 3MF 则直接在主文件里。
 *  2. 优化只改 <vertex> 的坐标，或（深度档）重建 <vertices>/<triangles> 区块。
 *     其余 ZIP 条目一律字节级复制 —— 拆件、变换矩阵、切片配置、颜色、缩略图零风险保留。
 *  3. 绝不写源文件：输出固定为同目录的新文件。
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const V_RE = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g;
const F_RE = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"[^>]*\/>/g;
const MESH_RE = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/g;
const VERTICES_RE = /<vertices\b[^>]*>([\s\S]*?)<\/vertices>/;
const TRIANGLES_RE = /<triangles\b[^>]*>([\s\S]*?)<\/triangles>/;

const SAMPLE_FACES = 60000;     // 夹角分布抽样上限
const SAMPLE_THIN = 30000;      // 细长三角抽样上限
const ANGULAR_P90 = 60;         // 棱角件判定：夹角 p90 超过此值
const ANGULAR_GT30 = 20;        // 或 >30° 边占比超过 20%

function num(s) { const n = Number(s); return Number.isFinite(n) ? n : 0; }
function fmtCoord(v) {
  if (!Number.isFinite(v)) return '0';
  // 8 位有效数字，对 3MF 的 mm 坐标精度绰绰有余，且避免科学计数法
  return String(Number(v.toPrecision(8)));
}
function pct(v) { return Math.round(v * 10000) / 100; }   // 返回百分数，保留 2 位

// ---------------------------------------------------------------- 解析

/** 列出 ZIP 内所有含网格的 .model 条目 */
function modelEntries(zip) {
  return zip.getEntries().filter((e) => {
    if (e.isDirectory) return false;
    const n = e.entryName.toLowerCase();
    return n.endsWith('.model') || n.endsWith('.3dmodel');
  });
}

/** 从一个 <mesh> 块里解析顶点与三角面 */
function parseMeshBlock(block) {
  V_RE.lastIndex = 0; F_RE.lastIndex = 0;
  const vs = [], fs = [];
  let m;
  while ((m = V_RE.exec(block)) !== null) { vs.push(num(m[1]), num(m[2]), num(m[3])); }
  while ((m = F_RE.exec(block)) !== null) { fs.push(num(m[1]), num(m[2]), num(m[3])); }
  return { V: Float64Array.from(vs), F: Int32Array.from(fs) };
}

/** 切出一个 XML 里所有 <mesh> 段及其位置 */
function collectMeshes(xml) {
  MESH_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = MESH_RE.exec(xml)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      block: m[1],
    });
  }
  return out;
}

// ---------------------------------------------------------------- 指标

/**
 * 几何指标。边拓扑全量统计（准确），夹角/细长抽样（快）。
 * 返回角度为「度」，占比为 0~1 比例。
 */
function measureGeometry(V, F) {
  const nv = V.length / 3, nf = F.length / 3;
  const r = {
    vertexCount: nv, faceCount: nf,
    angleMean: 0, angleP90: 0, gt15: 0, gt30: 0, thinPct: 0,
    boundaryEdges: 0, nonmanifoldEdges: 0,
    volumeMm3: 0, bboxMm: [0, 0, 0], edgeMm: 0,
  };
  if (!nf || !nv) return r;

  // ---- 全量边拓扑 + 包围盒 + 体积（散度定理，封闭网格有效） ----
  const keys = new Float64Array(nf * 3);
  let bi = 0;
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = V[3 * i], y = V[3 * i + 1], z = V[3 * i + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  r.bboxMm = [maxx - minx, maxy - miny, maxz - minz];

  let vol6 = 0, edgeSum = 0;
  const base = nv + 1;
  for (let f = 0; f < nf; f++) {
    const a = F[3 * f] * 3, b = F[3 * f + 1] * 3, c = F[3 * f + 2] * 3;
    const ax = V[a], ay = V[a + 1], az = V[a + 2];
    const bx = V[b], by = V[b + 1], bz = V[b + 2];
    const cx = V[c], cy = V[c + 1], cz = V[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    edgeSum += Math.hypot(ux, uy, uz) + Math.hypot(cx - bx, cy - by, cz - bz) + Math.hypot(ax - cx, ay - cy, az - cz);
    const ids = [F[3 * f], F[3 * f + 1], F[3 * f + 2]];
    for (let k = 0; k < 3; k++) {
      const p = ids[k], q = ids[(k + 1) % 3];
      keys[bi++] = (p < q ? p * base + q : q * base + p);
    }
    void nx; void ny; void nz;
  }
  r.volumeMm3 = Math.abs(vol6 / 6);
  r.edgeMm = edgeSum / (nf * 3);
  keys.sort();
  let boundary = 0, nonmanifold = 0;
  let i = 0;
  while (i < keys.length) {
    let j = i + 1;
    while (j < keys.length && keys[j] === keys[i]) j++;
    if (j - i === 1) boundary++;
    else if (j - i > 2) nonmanifold++;
    i = j;
  }
  r.boundaryEdges = boundary;
  r.nonmanifoldEdges = nonmanifold;

  // ---- 夹角分布（抽样） ----
  const step = Math.max(1, Math.ceil(nf / SAMPLE_FACES));
  const sample = [];
  for (let f = 0; f < nf; f += step) sample.push(f);
  const normals = new Float64Array(sample.length * 3);
  for (let s = 0; s < sample.length; s++) {
    const f = sample[s];
    const a = F[3 * f] * 3, b = F[3 * f + 1] * 3, c = F[3 * f + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[3 * s] = nx / l; normals[3 * s + 1] = ny / l; normals[3 * s + 2] = nz / l;
  }
  const pairs = [];
  for (let s = 0; s < sample.length; s++) {
    const f = sample[s];
    const ids = [F[3 * f], F[3 * f + 1], F[3 * f + 2]];
    for (let k = 0; k < 3; k++) {
      const p = ids[k], q = ids[(k + 1) % 3];
      pairs.push({ key: p < q ? p * base + q : q * base + p, s });
    }
  }
  pairs.sort((a, b) => a.key - b.key);
  const angs = [];
  for (let k = 1; k < pairs.length; k++) {
    if (pairs[k].key !== pairs[k - 1].key) continue;
    const a = pairs[k - 1].s, b = pairs[k].s;
    if (a === b) continue;
    let d = normals[3 * a] * normals[3 * b] + normals[3 * a + 1] * normals[3 * b + 1] + normals[3 * a + 2] * normals[3 * b + 2];
    d = Math.min(1, Math.max(-1, d));
    angs.push(Math.acos(d) * 180 / Math.PI);
  }
  if (angs.length) {
    angs.sort((a, b) => a - b);
    let sum = 0, n15 = 0, n30 = 0;
    for (const a of angs) { sum += a; if (a > 15) n15++; if (a > 30) n30++; }
    r.angleMean = sum / angs.length;
    r.angleP90 = angs[Math.min(angs.length - 1, Math.floor(angs.length * 0.9))];
    r.gt15 = n15 / angs.length;
    r.gt30 = n30 / angs.length;
  }

  // ---- 细长三角形（最小内角 <5°）抽样 ----
  const tstep = Math.max(1, Math.ceil(nf / SAMPLE_THIN));
  let thin = 0, tn = 0;
  for (let f = 0; f < nf; f += tstep) {
    const a = F[3 * f] * 3, b = F[3 * f + 1] * 3, c = F[3 * f + 2] * 3;
    const e0 = Math.hypot(V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]);
    const e1 = Math.hypot(V[c] - V[b], V[c + 1] - V[b + 1], V[c + 2] - V[b + 2]);
    const e2 = Math.hypot(V[a] - V[c], V[a + 1] - V[c + 1], V[a + 2] - V[c + 2]);
    const s0 = Math.min(e0, e1, e2), s2 = Math.max(e0, e1, e2);
    const s1 = e0 + e1 + e2 - s0 - s2;
    const cos = Math.min(1, Math.max(-1, (s1 * s1 + s2 * s2 - s0 * s0) / Math.max(2 * s1 * s2, 1e-12)));
    if (Math.acos(cos) * 180 / Math.PI < 5) thin++;
    tn++;
  }
  r.thinPct = tn ? thin / tn : 0;
  return r;
}

// ---------------------------------------------------------------- 体检

function sliceHints(zip) {
  const hints = [];
  let cfg = null;
  try {
    const e = zip.getEntry('Metadata/project_settings.config');
    if (e) cfg = JSON.parse(e.getData().toString('utf8'));
  } catch (_) { return hints; }
  if (!cfg) return hints;
  const first = (v) => Array.isArray(v) ? v[0] : v;
  const add = (key, cur, advice) => hints.push({ key, current: String(cur), advice });
  if (String(cfg.ironing_type || '').toLowerCase().includes('no ironing')) {
    add('顶面熨烫', cfg.ironing_type, '建议开「仅最上层表面」熨烫，明显改善平面顶观感');
  }
  if (Number(first(cfg.wall_loops)) < 3) {
    add('外壁圈数', first(cfg.wall_loops), '建议 3~4 圈，能盖住细碎外壁与轻微透光的薄壁');
  }
  const lh = Number(first(cfg.layer_height));
  if (Number.isFinite(lh) && lh > 0.12) {
    add('层高', lh + ' mm', '曲面建议 0.08~0.12 mm 或开自适应层高，减少台阶纹');
  }
  const ts = Number(first(cfg.top_surface_speed));
  if (Number.isFinite(ts) && ts > 100) {
    add('顶面速度', ts + ' mm/s', '建议降到 60~90 mm/s，减少顶面振纹');
  }
  if (String(cfg.seam_position || '') === 'aligned') {
    add('接缝位置', cfg.seam_position, '建议改随机或手动放到背面，避免在正面留下一条竖线');
  }
  return hints;
}

/**
 * 只读体检。返回结构见 docs/05 §5。
 * 占比统一为 0~1 比例（渲染层会 ×100）。
 */
async function inspect3mf(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('找不到模型文件');
  if (!/\.3mf$/i.test(filePath)) throw new Error('模型优化目前只支持 .3mf 文件');
  let zip;
  try { zip = new AdmZip(filePath); } catch (e) { throw new Error('无法解包 3MF：' + e.message); }
  const entries = zip.getEntries();
  const models = modelEntries(zip);
  if (!models.length) throw new Error('这个 3MF 里没有找到网格部件（可能不是标准 3MF）');

  const parts = [];
  let meshNo = 0;
  for (const entry of models) {
    let xml;
    try { xml = entry.getData().toString('utf8'); } catch (e) { continue; }
    const meshes = collectMeshes(xml);
    for (let mi = 0; mi < meshes.length; mi++) {
      const { V, F } = parseMeshBlock(meshes[mi].block);
      if (!F.length) continue;
      const g = measureGeometry(V, F);
      const isAngular = g.angleP90 > ANGULAR_P90 || pct(g.gt30) > ANGULAR_GT30;
      parts.push({
        key: entry.entryName + '#' + mi,
        ply: 'part_' + String(meshNo++).padStart(3, '0') + '.ply',
        entry: entry.entryName,
        meshIndex: mi,
        name: path.basename(entry.entryName).replace(/\.model$/i, '') + (meshes.length > 1 ? ' #' + (mi + 1) : ''),
        vertexCount: g.vertexCount,
        faceCount: g.faceCount,
        angleMean: Math.round(g.angleMean * 100) / 100,
        angleP90: Math.round(g.angleP90 * 100) / 100,
        gt15: g.gt15, gt30: g.gt30, thinPct: g.thinPct,
        boundaryEdges: g.boundaryEdges, nonmanifoldEdges: g.nonmanifoldEdges,
        volumeMm3: Math.round(g.volumeMm3 * 100) / 100,
        bboxMm: g.bboxMm.map((x) => Math.round(x * 100) / 100),
        edgeMm: Math.round(g.edgeMm * 10000) / 10000,
        isAngular,
        skip: isAngular,
      });
    }
  }
  if (!parts.length) throw new Error('没有解析出任何三角网格，可能是不支持的 3MF 变体');

  const sum = (k) => parts.reduce((a, p) => a + p[k], 0);
  const faces = sum('faceCount');
  const wmean = (k) => faces ? parts.reduce((a, p) => a + p[k] * p.faceCount, 0) / faces : 0;
  const totals = {
    parts: parts.length,
    vertices: sum('vertexCount'),
    faces,
    angleMean: Math.round(wmean('angleMean') * 100) / 100,
    gt15: wmean('gt15'),
    gt30: wmean('gt30'),
    thinPct: wmean('thinPct'),
    boundaryEdges: sum('boundaryEdges'),
    nonmanifoldEdges: sum('nonmanifoldEdges'),
    volumeMm3: Math.round(sum('volumeMm3') * 100) / 100,
  };

  const names = entries.map((e) => e.entryName);
  const isCut = names.includes('Metadata/cut_information.xml');
  const hasSlice = names.some((n) => /slice_info|slice_data|\.gcode/i.test(n));
  const bambu = names.some((n) => n.startsWith('3D/Objects/'));
  const warnings = [];
  if (isCut) warnings.push('检测到拆件工程：平面切口与棱角属于拼装基准，默认不会磨圆。');
  if (parts.some((p) => p.isAngular)) {
    warnings.push('有 ' + parts.filter((p) => p.isAngular).length + ' 个棱角/结构件，默认跳过以免破坏拼装面。');
  }
  if (hasSlice) warnings.push('这个工程带切片结果；几何改动后请在切片软件里重新切片。');
  if (totals.boundaryEdges > 0 || totals.nonmanifoldEdges > 0) {
    warnings.push('检测到开放边/非流形边，建议先在切片软件里做一次修复。');
  }

  return {
    ok: true,
    format: (bambu ? 'Bambu Studio 多部件工程' : '标准 3MF') + (isCut ? ' · 拆件' : ''),
    entries: entries.length,
    parts,
    totals,
    sliceConfigHint: sliceHints(zip),
    warnings,
    fileSize: fs.statSync(filePath).size,
  };
}

// ---------------------------------------------------------------- PLY

function writePly(outPath, V, F) {
  const nv = V.length / 3, nf = F.length / 3;
  const header = Buffer.from(
    'ply\nformat binary_little_endian 1.0\n' +
    'element vertex ' + nv + '\n' +
    'property float x\nproperty float y\nproperty float z\n' +
    'element face ' + nf + '\n' +
    'property list uchar uint vertex_indices\nend_header\n', 'ascii');
  const body = Buffer.allocUnsafe(nv * 12 + nf * 13);
  let p = 0;
  for (let i = 0; i < V.length; i++) { body.writeFloatLE(V[i], p); p += 4; }
  for (let f = 0; f < nf; f++) {
    body[p++] = 3;
    body.writeUInt32LE(F[3 * f], p); p += 4;
    body.writeUInt32LE(F[3 * f + 1], p); p += 4;
    body.writeUInt32LE(F[3 * f + 2], p); p += 4;
  }
  fs.writeFileSync(outPath, Buffer.concat([header, body]));
}

/** 读回 PLY 的顶点坐标；voxel 档还会返回三角化后的面索引 */
function readPlyCoords(plyPath, withFaces = false) {
  const buf = fs.readFileSync(plyPath);
  let off = 0, nv = 0, nf = 0, binary = false, vprops = 3;
  const lines = [];
  while (off < buf.length) {
    let e = buf.indexOf(0x0A, off);
    if (e < 0) e = buf.length;
    const line = buf.toString('ascii', off, e).replace(/\r$/, '');
    off = e + 1;
    lines.push(line);
    if (line === 'end_header') break;
  }
  const props = lines.filter((l) => l.startsWith('property '));
  for (const l of lines) {
    if (l.startsWith('element vertex ')) nv = parseInt(l.split(/\s+/)[2], 10);
    else if (l.startsWith('element face ')) nf = parseInt(l.split(/\s+/)[2], 10);
    else if (l.includes('binary_little_endian')) binary = true;
  }
  vprops = props.slice(0, props.findIndex((p) => p.includes('list')) === -1 ? props.length : props.findIndex((p) => p.includes('list')))
    .filter((p) => /float|double/.test(p)).length || 3;
  const V = new Float64Array(nv * 3);
  if (binary) {
    for (let i = 0; i < nv; i++) {
      for (let k = 0; k < 3; k++) { V[3 * i + k] = buf.readFloatLE(off + (i * vprops + k) * 4); }
    }
  } else {
    const txt = buf.toString('ascii', off).split(/\r?\n/);
    for (let i = 0; i < nv; i++) {
      const t = txt[i].trim().split(/\s+/);
      V[3 * i] = Number(t[0]); V[3 * i + 1] = Number(t[1]); V[3 * i + 2] = Number(t[2]);
    }
  }
  if (!withFaces) return { V, F: null };

  // 面区：binary = 1 字节数量 + N×uint32；quad 拆成两个三角形
  const F = [];
  let p = binary ? off + nv * vprops * 4 : off;
  const faceLines = binary ? null : buf.toString('ascii', off).split(/\r?\n/).slice(nv);
  for (let f = 0; f < nf; f++) {
    let ids;
    if (binary) {
      const n = buf[p]; p += 1;
      ids = [];
      for (let k = 0; k < n; k++) { ids.push(buf.readUInt32LE(p)); p += 4; }
    } else {
      ids = (faceLines[f] || '').trim().split(/\s+/).slice(1).map(Number);
    }
    for (let k = 1; k + 1 < ids.length; k++) F.push(ids[0], ids[k], ids[k + 1]);
  }
  return { V, F: Int32Array.from(F) };
}

/** 逐件导出 PLY。只导出未被跳过的部件，编号保持连续。 */
async function exportParts(filePath, parts, outDir, onProgress) {
  fs.mkdirSync(outDir, { recursive: true });
  const zip = new AdmZip(filePath);
  const byEntry = new Map();
  for (const p of parts) {
    if (!byEntry.has(p.entry)) byEntry.set(p.entry, []);
    byEntry.get(p.entry).push(p);
  }
  const files = [];
  for (const [entryName, list] of byEntry) {
    const entry = zip.getEntry(entryName);
    if (!entry) throw new Error('3MF 部件丢失：' + entryName);
    const xml = entry.getData().toString('utf8');
    const meshes = collectMeshes(xml);
    for (const p of list) {
      const mesh = meshes[p.meshIndex];
      if (!mesh) throw new Error('网格索引越界：' + p.key);
      const { V, F } = parseMeshBlock(mesh.block);
      const plyPath = path.join(outDir, p.ply);
      writePly(plyPath, V, F);
      files.push({ key: p.key, ply: p.ply, plyPath, vertexCount: V.length / 3, faceCount: F.length / 3 });
      if (onProgress) onProgress({ stage: 'export', message: '导出部件 ' + (files.length) + '/' + parts.length });
    }
  }
  return { files, dir: outDir };
}

// ---------------------------------------------------------------- 写回

/** 逐顶点位移 clamp：既保留平滑效果，又杜绝尖刺被拉飞 */
function clampCoords(origV, newV, maxStep) {
  if (origV.length !== newV.length) throw new Error('顶点数不一致，无法无损写回');
  const out = new Float64Array(origV.length);
  let maxDisp = 0, rawMaxDisp = 0, sum = 0, clipped = 0;
  for (let i = 0; i < origV.length; i += 3) {
    const dx = newV[i] - origV[i], dy = newV[i + 1] - origV[i + 1], dz = newV[i + 2] - origV[i + 2];
    const d = Math.hypot(dx, dy, dz);
    rawMaxDisp = Math.max(rawMaxDisp, d);
    const s = d > maxStep ? maxStep / d : 1;
    if (s < 1) clipped++;
    const ax = dx * s, ay = dy * s, az = dz * s;
    const applied = Math.hypot(ax, ay, az);
    maxDisp = Math.max(maxDisp, applied);
    sum += applied;
    out[i] = origV[i] + ax; out[i + 1] = origV[i + 1] + ay; out[i + 2] = origV[i + 2] + az;
  }
  // maxDisp 是「实际写回」的最大位移；rawMaxDisp 才是 Blender 原始（未裁剪）最大位移
  return { coords: out, maxDisp, rawMaxDisp, meanDisp: sum / (origV.length / 3), clipped };
}

/** 按序替换一个 mesh 块里的 <vertex> 坐标 */
function replaceVertexTags(block, V) {
  let i = 0;
  const out = block.replace(V_RE, () => {
    const k = i++;
    if (k * 3 + 2 >= V.length) return '<vertex x="0" y="0" z="0"/>';
    return '<vertex x="' + fmtCoord(V[3 * k]) + '" y="' + fmtCoord(V[3 * k + 1]) +
      '" z="' + fmtCoord(V[3 * k + 2]) + '"/>';
  });
  if (i !== V.length / 3) throw new Error('顶点标签数不匹配：' + i + ' vs ' + V.length / 3);
  return out;
}

/** 深度档：重建 <vertices> 与 <triangles> 区块（顶点/面数可变） */
function replaceMeshGeometry(block, V, F) {
  const vs = [];
  for (let i = 0; i < V.length; i += 3) {
    vs.push('<vertex x="' + fmtCoord(V[i]) + '" y="' + fmtCoord(V[i + 1]) + '" z="' + fmtCoord(V[i + 2]) + '"/>');
  }
  const ts = [];
  for (let f = 0; f < F.length; f += 3) {
    ts.push('<triangle v1="' + F[f] + '" v2="' + F[f + 1] + '" v3="' + F[f + 2] + '"/>');
  }
  let out = block;
  const vb = '<vertices>\n' + vs.join('\n') + '\n</vertices>';
  const tb = '<triangles>\n' + ts.join('\n') + '\n</triangles>';
  if (!VERTICES_RE.test(out) || !TRIANGLES_RE.test(out)) throw new Error('3MF 网格结构不符合预期，无法重建');
  out = out.replace(VERTICES_RE, vb).replace(TRIANGLES_RE, tb);
  return out;
}

/**
 * 生成优化后的 3MF。
 * @param {Object} o
 *   srcPath    源 3MF（只读）
 *   outPath    输出路径（绝不与 srcPath 相同）
 *   parts      要写回的部件（inspect3mf 的 parts 子集，含 entry/meshIndex/ply）
 *   plyDir     PLY 目录
 *   mode       'coords' | 'rebuild'
 *   clampMm    位移上限（coords 档）
 *   origParts  源文件的完整 parts（用于取原始坐标做 clamp）
 */
async function buildOptimized3mf(o) {
  const { srcPath, outPath, parts, plyDir, mode = 'coords', clampMm = 0.15 } = o;
  // 同 inode / 软链接绕过 path.resolve 比较：realpath 必须不同，否则会覆盖源文件（P1-15）。
  const real = (p) => {
    try { return fs.realpathSync(path.resolve(p)); } catch (_) { return path.resolve(p); }
  };
  const srcReal = real(srcPath);
  const outReal = real(outPath);
  const samePath = process.platform === 'win32'
    ? srcReal.toLowerCase() === outReal.toLowerCase()
    : srcReal === outReal;
  // 硬链接的 realpath 仍不同，但 dev/ino 相同；不查 inode 就可能把优化产物写回源文件。
  let sameInode = false;
  try {
    const a = fs.statSync(srcReal);
    const b = fs.statSync(outReal);
    sameInode = a.dev === b.dev && a.ino === b.ino;
  } catch (_) { /* 输出还不存在时按路径判断即可 */ }
  if (samePath || sameInode) throw new Error('输出路径不能与源文件相同（软链接或同一文件）');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const zip = new AdmZip(srcPath);
  const allEntries = zip.getEntries();
  const originals = new Map();
  for (const e of allEntries) originals.set(e.entryName, Buffer.from(e.getData()));

  // 按 entry 分组，从后往前替换 mesh 段，避免字符串偏移
  const byEntry = new Map();
  for (const p of parts) {
    if (!byEntry.has(p.entry)) byEntry.set(p.entry, []);
    byEntry.get(p.entry).push(p);
  }

  const clampStats = { maxDisp: 0, rawMaxDisp: 0, meanDisp: 0, clipped: 0, moved: 0 };
  let paintDropped = 0;   // 深度档会重建拓扑，面上的涂色对应关系无法保留，统计出来告知用户
  const modified = new Map();   // entryName -> Buffer（改过的 .model）
  for (const [entryName, list] of byEntry) {
    const entry = zip.getEntry(entryName);
    if (!entry) throw new Error('3MF 部件丢失：' + entryName);
    let xml = originals.get(entryName).toString('utf8');
    const meshes = collectMeshes(xml);
    list.sort((a, b) => b.meshIndex - a.meshIndex);

    for (const p of list) {
      const mesh = meshes[p.meshIndex];
      if (!mesh) throw new Error('网格索引越界：' + p.key);
      const orig = parseMeshBlock(mesh.block);
      const plyPath = path.join(plyDir, p.ply);
      const needFaces = mode === 'rebuild';
      const back = readPlyCoords(plyPath, needFaces);
      let newBlock;
      if (mode === 'rebuild') {
        // 重建拓扑后三角面与原来的涂色标注不再一一对应 —— 统计数量，别让用户以为颜色还在
        const m = mesh.full.match(/paint_color=/g);
        if (m) paintDropped += m.length;
        // 必须用 mesh.full（含 <mesh>…</mesh> 外壳），否则写回后标签会丢失
        newBlock = replaceMeshGeometry(mesh.full, back.V, back.F);
      } else {
        const c = clampCoords(orig.V, back.V, clampMm);
        clampStats.maxDisp = Math.max(clampStats.maxDisp, c.maxDisp);
        clampStats.rawMaxDisp = Math.max(clampStats.rawMaxDisp, c.rawMaxDisp);
        clampStats.meanDisp += c.meanDisp;
        clampStats.clipped += c.clipped;
        clampStats.moved++;
        newBlock = replaceVertexTags(mesh.full, c.coords);
      }
      xml = xml.slice(0, mesh.start) + newBlock + xml.slice(mesh.end);
    }
    modified.set(entryName, Buffer.from(xml, 'utf8'));
  }
  // 按原条目顺序重建 ZIP，保持每个 entryName 对应的字节不变。
  // 注意 adm-zip 的 compressToBuffer() 内部会按文件名做一次 sortEntries()，
  // 所以最终 ZIP 的物理顺序是字母序；OPC/3MF 按部件名查找、不要求顺序，
  // 这里校验「条目集合 + 逐条字节」，不校验物理顺序。
  const outZip = new AdmZip();
  for (const e of allEntries) {
    const data = modified.get(e.entryName) || originals.get(e.entryName) || Buffer.alloc(0);
    outZip.addFile(e.entryName, data);
  }
  // 先写临时文件再 rename：写到一半崩溃不会留下半截 3MF 覆盖旧产物（P1-15）。
  const tmpOut = outPath + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  try {
    outZip.writeZip(tmpOut);
    if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size <= 0) throw new Error('写入输出文件失败');
    try {
      fs.renameSync(tmpOut, outPath);
    } catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
        try { fs.unlinkSync(outPath); } catch (_) { /* 目标不存在 */ }
        fs.renameSync(tmpOut, outPath);
      } else throw e;
    }
  } catch (e) {
    try { fs.unlinkSync(tmpOut); } catch (_) { /* 清理残留 */ }
    throw e;
  }
  if (!fs.existsSync(outPath)) throw new Error('写入输出文件失败');
  clampStats.meanDisp = clampStats.moved ? clampStats.meanDisp / clampStats.moved : 0;

  // ---- 写回后结构校验 ----
  const out = new AdmZip(outPath);
  const outEntries = out.getEntries();
  if (outEntries.length !== allEntries.length) throw new Error('输出 3MF 条目数不一致');
  const srcNames = new Set(allEntries.map((e) => e.entryName));
  const outNames = new Set(outEntries.map((e) => e.entryName));
  if (outNames.size !== srcNames.size || Array.from(srcNames).some((n) => !outNames.has(n))) {
    throw new Error('输出 3MF 条目集合不一致');
  }
  const changed = new Set(byEntry.keys());
  let unchanged = 0;
  for (const e of outEntries) {
    if (changed.has(e.entryName)) continue;
    const a = originals.get(e.entryName), b = Buffer.from(e.getData());
    if (!a || !a.equals(b)) throw new Error('未修改的条目发生了字节变化：' + e.entryName);
    unchanged++;
  }
  // 顶点/面数复核
  for (const p of parts) {
    const e = out.getEntry(p.entry);
    if (!e) throw new Error('输出缺少条目：' + p.entry);
    const meshes = collectMeshes(e.getData().toString('utf8'));
    const cm = meshes[p.meshIndex];
    if (!cm) throw new Error('输出网格结构损坏（找不到 mesh）：' + p.key);
    const g = parseMeshBlock(cm.block);
    if (mode !== 'rebuild' && g.V.length / 3 !== p.vertexCount) throw new Error('输出顶点数不一致：' + p.key);
    if (mode !== 'rebuild' && g.F.length / 3 !== p.faceCount) throw new Error('输出面数不一致：' + p.key);
  }
  return {
    ok: true, outPath, bytes: fs.statSync(outPath).size, unchangedEntries: unchanged,
    verified: true, clampStats, paintDropped,
  };
}

module.exports = {
  inspect3mf, exportParts, buildOptimized3mf, measureGeometry,
  readPlyCoords, writePly, clampCoords, collectMeshes, parseMeshBlock,
};
