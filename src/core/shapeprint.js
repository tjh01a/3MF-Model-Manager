'use strict';
/**
 * A · 几何指纹：识别「同模型不同版本 / 改色 / 缩放」（纯 Node，无 Electron 依赖）。
 *
 * 思路：不看文件、不看文件名，只看网格的形状。
 *   1. 在三角面上按面积加权撒点 → 去质心 → 按均方根半径归一化。
 *      于是平移 / 旋转 / 等比缩放都不影响后面的特征（也不需要 PCA，没有主轴不稳定的坑）。
 *   2. 取五组「形状分布」（都是旋转 / 镜像不变的直方图）：
 *        D1  点到质心的距离       —— 区分度最高（校准实验里立方体 vs 圆柱主要靠它）
 *        D2  点对距离
 *        D3  随机三角形的面积
 *        D4  随机四面体的体积
 *        A3  随机两向量夹角
 *   3. 每组直方图的差异 ÷ 该组「同一模型的典型噪声」= 归一化差异，加权求和得到 dist。
 *        dist ≤ SAME   → 同一模型（尺寸差 >5% 记为缩放版）
 *        dist ≤ MAYBE  → 疑似同款变体（需用户确认）
 *      噪声值来自 tools/_calib-shape.js 的校准：同一形状不同随机种子，各特征的 L1 差异上界。
 *
 * 指纹单独存在 数据目录/shapeprints.json，以「文件内容哈希」判断是否过期，不写进 library.json。
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const U = require('./utils');

const N_POINTS = 6000;        // 表面采样点数
const N_SAMPLES = 20000;      // D2 / D3 / D4 / A3 的采样次数
const MAX_ENTRY_XML = 24 * 1024 * 1024;
const MAX_FACES = 400000;     // 超过就只取前面这么多面（指纹不需要那么精细）
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const FULL_PAIRWISE_MAX = 1500;   // 不超过这个数量直接两两比较；再多才走分桶

const FEATURES = ['d1', 'd2', 'd3', 'd4', 'a3', 'da'];
// lp 不是直方图：ln(1 + 棱边总长 ÷ 均方根半径)。正方形板和异形轮廓板的周长差很多，见 similarity()。
const BINS = { d1: 32, d2: 64, d3: 32, d4: 16, a3: 32, da: 17 };
/** 直方图横轴上限（已按均方根半径归一）。超出范围的值夹到最后一个 bin。da 的单位是度，上限 180。 */
const RANGE = { d1: 3.4, d2: 4.4, d3: 3.2, d4: 1.3, a3: 1.0, da: 180 };
/** 同一模型的典型噪声（L1 差异），校准值 */
const NOISE = { d1: 0.06, d2: 0.04, d3: 0.03, d4: 0.03, a3: 0.025, da: 0.05, lp: 0.05 };
const WEIGHT = { d1: 0.32, d2: 0.16, d3: 0.09, d4: 0.09, a3: 0.08, da: 0.18, lp: 0.08 };
const CAP = 4;                // 单个特征的归一化差异最多记 4
const DA_FLAT = 10;           // 二面角小于 10° 的边当作「共面」忽略：重网格化不会改变结果
const DA_MAX_FACES = 200000;  // 超过这么多面就不算二面角（排序成本高）；两边都没有时差异记 0

/**
 * 阈值来自真实模型库校准（191 个模型，tools/_calib-real.js）：
 *   真同款（同一文件的多个副本、原版与 .u1 转换版、同一测试件的几种切片）    0.28 ~ 0.65
 *   不相关的模型开始出现                                                        0.70 ~
 *   真实的「另一个版本」（v2、带/不带 AMS 版、同主题不同细分）               0.72 ~ 0.93
 *   0.98 ~ 1.3 几乎全是无关的手办部件；1.3 以上上千对，全部无关
 */
const SAME_DIST = 0.70;        // dist ≤ 判「同一模型」
const MAYBE_DIST = 1.30;       // dist ≤ 判「疑似同款」（需用户确认；这一段本来就会混入无关模型）
const SCALE_EPS = 0.05;        // 尺寸差超过 5% 算缩放版

const V_RE = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g;
const F_RE = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"[^>]*\/>/g;
const MESH_RE = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/g;

const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

/** 确定性随机数（mulberry32）：同一个文件每次算出的指纹完全一样 */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 读网格

/** 从 3MF 的全部 .model 条目里读出三角网格，合并成一份 { V, F, faces } */
function loadMeshes(filePath) {
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size === 0) return null;
  if (st.size > MAX_FILE_BYTES) return { skipped: 'too-large' };
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries().filter((e) => e && !e.isDirectory
    && /\.(model|3dmodel)$/i.test(String(e.entryName || '')));
  const Vs = [];
  const Fs = [];
  let vTotal = 0;
  let fTotal = 0;
  for (const en of entries) {
    if (fTotal >= MAX_FACES) break;
    if (Number(en.header.size) > MAX_ENTRY_XML) continue;
    let xml;
    try { xml = en.getData().toString('utf8'); } catch (_) { continue; }
    MESH_RE.lastIndex = 0;
    let m;
    while ((m = MESH_RE.exec(xml)) !== null) {
      if (fTotal >= MAX_FACES) break;
      const block = m[1];
      V_RE.lastIndex = 0;
      F_RE.lastIndex = 0;
      const vOff = vTotal;
      const localV = [];
      let mm;
      while ((mm = V_RE.exec(block)) !== null) localV.push(num(mm[1]), num(mm[2]), num(mm[3]));
      if (!localV.length) continue;
      const localF = [];
      const nvLocal = localV.length / 3;
      while ((mm = F_RE.exec(block)) !== null) {
        const a = num(mm[1]), b = num(mm[2]), c = num(mm[3]);
        if (a < nvLocal && b < nvLocal && c < nvLocal) localF.push(a + vOff, b + vOff, c + vOff);
      }
      if (!localF.length) continue;
      Vs.push(localV);
      Fs.push(localF);
      vTotal += nvLocal;
      fTotal += localF.length / 3;
    }
  }
  if (!fTotal) return null;
  return { V: Float64Array.from(Vs.flat()), F: Int32Array.from(Fs.flat()), faces: fTotal };
}

// ---------------------------------------------------------------- 采样

/** 按面积加权在三角面上撒点 */
function sampleSurfacePoints(V, F, n, rand) {
  const nf = F.length / 3;
  const cum = new Float64Array(nf);
  let total = 0;
  for (let f = 0; f < nf; f++) {
    const a = F[3 * f] * 3, b = F[3 * f + 1] * 3, c = F[3 * f + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += 0.5 * Math.hypot(cx, cy, cz);
    cum[f] = total;
  }
  if (!(total > 0)) return null;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const target = rand() * total;
    let lo = 0, hi = nf - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    const f = lo;
    const a = F[3 * f] * 3, b = F[3 * f + 1] * 3, c = F[3 * f + 2] * 3;
    const r1 = Math.sqrt(rand());
    const r2 = rand();
    const w0 = 1 - r1, w1 = r1 * (1 - r2), w2 = r1 * r2;
    out[3 * i] = w0 * V[a] + w1 * V[b] + w2 * V[c];
    out[3 * i + 1] = w0 * V[a + 1] + w1 * V[b + 1] + w2 * V[c + 1];
    out[3 * i + 2] = w0 * V[a + 2] + w1 * V[b + 2] + w2 * V[c + 2];
  }
  return out;
}

function centroid(P, n) {
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += P[3 * i]; cy += P[3 * i + 1]; cz += P[3 * i + 2]; }
  return [cx / n, cy / n, cz / n];
}

/** 归一化坐标：去质心、除以均方根半径。返回 { q: Float64Array, rms } */
function normalize(P, n) {
  const [cx, cy, cz] = centroid(P, n);
  const q = new Float64Array(n * 3);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const x = P[3 * i] - cx, y = P[3 * i + 1] - cy, z = P[3 * i + 2] - cz;
    q[3 * i] = x; q[3 * i + 1] = y; q[3 * i + 2] = z;
    sq += x * x + y * y + z * z;
  }
  const rms = Math.sqrt(sq / n) || 1;
  for (let i = 0; i < q.length; i++) q[i] /= rms;
  return { q, rms };
}

/** 直方图：计数后缩放到 0~255 存成字节（比较时会重新按总和归一，缩放不影响结果） */
function hist(vals, bins, range) {
  const counts = new Uint32Array(bins);
  const k = bins / range;
  let max = 0;
  for (let i = 0; i < vals.length; i++) {
    let b = Math.floor(vals[i] * k);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    if (++counts[b] > max) max = counts[b];
  }
  const h = new Uint8Array(bins);
  for (let b = 0; b < bins; b++) h[b] = max ? Math.round((counts[b] / max) * 255) : 0;
  return h;
}

function quantiles(vals, ps) {
  const s = Float64Array.from(vals).sort();
  return ps.map((p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]);
}

/**
 * 二面角直方图（按棱边长度加权）：区分「方」和「圆」。
 * 全局分布分不出立方体和矮圆柱，但立方体的棱全是 90°、48 段圆柱侧面只有 7.5°。
 *   - 小于 DA_FLAT 的角当作共面忽略 → 三角面怎么细分都不影响结果
 *   - 只统计恰好两个面共享的边；非流形边、开放边跳过
 * 返回 17 个 bin（10° 一格，10°~180°）的棱边总长度，未归一化。
 */
function dihedralHist(V, F) {
  const out = new Float64Array(BINS.da);
  const nf = F.length / 3;
  const nv = V.length / 3;
  if (nf < 2 || nf > DA_MAX_FACES) return out;
  const nrm = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const a = F[3 * f] * 3, b = F[3 * f + 1] * 3, c = F[3 * f + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    nrm[3 * f] = nx; nrm[3 * f + 1] = ny; nrm[3 * f + 2] = nz;
  }
  // 每条半边一个键（无序顶点对），排序后共享边的两个面会挨在一起
  const n = nf * 3;
  const keys = new Float64Array(n);
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[3 * f + k], b = F[3 * f + ((k + 1) % 3)];
      keys[3 * f + k] = (a < b) ? a * nv + b : b * nv + a;
    }
  }
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => keys[x] - keys[y]);
  const edgeLen = (half) => {
    const f = (half / 3) | 0, k = half % 3;
    const a = F[3 * f + k] * 3, b = F[3 * f + ((k + 1) % 3)] * 3;
    return Math.hypot(V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]);
  };
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && keys[order[j]] === keys[order[i]]) j++;
    if (j - i === 2) {
      const h1 = order[i], h2 = order[i + 1];
      const f1 = (h1 / 3) | 0, f2 = (h2 / 3) | 0;
      if (f1 !== f2) {
        const d = Math.min(1, Math.max(-1,
          nrm[3 * f1] * nrm[3 * f2] + nrm[3 * f1 + 1] * nrm[3 * f2 + 1] + nrm[3 * f1 + 2] * nrm[3 * f2 + 2]));
        const ang = Math.acos(d) * 180 / Math.PI;
        if (ang >= DA_FLAT) {
          // 软分箱：按到相邻两格中心的距离线性分摊。硬分箱会让「正好 90°」的棱
          // 因为浮点误差在两个格子间来回跳，同一个模型换个姿势就判成不像。
          const x = (ang - DA_FLAT) / 10;          // 格子中心在 0.5, 1.5, …
          const b0 = Math.floor(x - 0.5);
          const t = x - 0.5 - b0;
          const len = edgeLen(h1);
          if (b0 >= 0) out[b0] += len * (1 - t);
          if (b0 + 1 < BINS.da) out[b0 + 1] += len * t;
        }
      }
    }
    i = j;
  }
  return out;
}

/** 浮点数组缩放到 0~255（以最大值为 255）；全零保持全零 */
function scaleToBytes(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  const out = new Uint8Array(arr.length);
  if (max > 0) for (let i = 0; i < arr.length; i++) out[i] = Math.round((arr[i] / max) * 255);
  return out;
}

// ---------------------------------------------------------------- 指纹

function toB64(u8) { return Buffer.from(u8).toString('base64'); }
function fromB64(s, len) {
  if (typeof s !== 'string' || !s) return null;
  const b = Buffer.from(s, 'base64');
  return b.length === len ? new Uint8Array(b) : null;
}

/** 从采样点算特征（P 为原始坐标，函数内部归一化）。da 为二面角直方图（原始长度）。 */
function signatureFromPoints(P, n, rand, da) {
  const { q, rms } = normalize(P, n);
  const pt = (i) => [q[3 * i], q[3 * i + 1], q[3 * i + 2]];
  const ri = () => Math.floor(rand() * n);

  const d1 = new Float64Array(n);
  for (let i = 0; i < n; i++) d1[i] = Math.hypot(q[3 * i], q[3 * i + 1], q[3 * i + 2]);

  const d2 = new Float64Array(N_SAMPLES), d3 = new Float64Array(N_SAMPLES), a3 = new Float64Array(N_SAMPLES);
  for (let k = 0; k < N_SAMPLES; k++) {
    const a = pt(ri()), b = pt(ri()), c = pt(ri());
    d2[k] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    d3[k] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const l1 = Math.hypot(ux, uy, uz), l2 = Math.hypot(vx, vy, vz);
    a3[k] = (l1 > 0 && l2 > 0)
      ? Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / (l1 * l2)))) / Math.PI : 0;
  }
  const d4 = new Float64Array(N_SAMPLES);
  for (let k = 0; k < N_SAMPLES; k++) {
    const a = pt(ri()), b = pt(ri()), c = pt(ri()), d = pt(ri());
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    const cx = vy * wz - vz * wy, cy = vz * wx - vx * wz, cz = vx * wy - vy * wx;
    d4[k] = Math.abs(ux * cx + uy * cy + uz * cz) / 6;
  }

  const sig = {
    h: {
      d1: toB64(hist(d1, BINS.d1, RANGE.d1)),
      d2: toB64(hist(d2, BINS.d2, RANGE.d2)),
      d3: toB64(hist(d3, BINS.d3, RANGE.d3)),
      d4: toB64(hist(d4, BINS.d4, RANGE.d4)),
      a3: toB64(hist(a3, BINS.a3, RANGE.a3)),
      da: da ? toB64(scaleToBytes(da)) : '',
    },
    // 分位数：分桶键 + 更稳的粗比较
    q: {
      d1: quantiles(d1, [0.05, 0.25, 0.5, 0.75, 0.95]).map((v) => Math.round(v * 1000) / 1000),
      d2: quantiles(d2, [0.05, 0.25, 0.5, 0.75, 0.95]).map((v) => Math.round(v * 1000) / 1000),
    },
    // 尺寸（均方根半径，mm）：用来认「缩放版」
    e: 0, f: 0, p: 0,
  };
  return sig;
}

/** 算一个文件的几何指纹。失败不抛，返回 { failed: 原因 }。 */
function computeSignature(filePath) {
  let mesh;
  try { mesh = loadMeshes(filePath); }
  catch (e) { return { failed: 'read-error', detail: (e && e.message) || String(e) }; }
  if (!mesh) return { failed: 'no-mesh' };
  if (mesh.skipped) return { failed: mesh.skipped };
  const seed = parseInt(U.sha1(String(filePath)).slice(0, 8), 16);
  const rand = rng(seed);
  const P = sampleSurfacePoints(mesh.V, mesh.F, N_POINTS, rand);
  if (!P) return { failed: 'degenerate' };
  let da = null;
  try { da = dihedralHist(mesh.V, mesh.F); } catch (_) { da = null; }
  const sig = signatureFromPoints(P, N_POINTS, rand, da);
  // 尺寸用均方根半径：旋转 / 镜像不变，采样噪声 <1%。轴对齐包围盒换个姿势就变，不能用。
  let sq = 0;
  const c = centroid(P, N_POINTS);
  for (let i = 0; i < N_POINTS; i++) {
    sq += (P[3 * i] - c[0]) ** 2 + (P[3 * i + 1] - c[1]) ** 2 + (P[3 * i + 2] - c[2]) ** 2;
  }
  const rms = Math.sqrt(sq / N_POINTS) || 1;
  sig.e = Math.round(rms * 1000) / 1000;
  // 棱边总长 ÷ 尺寸：与缩放无关。薄板之间的差别几乎全在轮廓（= 顶面与侧壁交出的棱），靠它区分。
  let sharp = 0;
  if (da) for (let i = 0; i < da.length; i++) sharp += da[i];
  sig.p = Math.round(Math.log(1 + sharp / rms) * 1000) / 1000;
  sig.f = mesh.faces;
  return sig;
}

// ---------------------------------------------------------------- 相似度

/** 两组直方图的 L1 距离（各自归一化后），范围 0~1 */
function l1(a, b) {
  let sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
  if (!(sa > 0) && !(sb > 0)) return 0;    // 两边都没有这类边：视为一致
  if (!(sa > 0) || !(sb > 0)) return 1;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] / sa - b[i] / sb);
  return d / 2;
}

/**
 * 两份指纹的距离：各特征差异 ÷ 噪声 后加权。
 * 返回 { dist, score, role, scale, parts }
 *   dist  越小越像；≤ SAME_DIST 同一模型，≤ MAYBE_DIST 疑似同款
 *   score 0~1，给界面显示的「相似度」（100% − 8 × dist，再夹到 0~1）
 */
function similarity(A, B, opts = {}) {
  if (!A || !B || !A.h || !B.h) return { dist: Infinity, score: 0, role: null, scale: null };
  const same = opts.same == null ? SAME_DIST : opts.same;
  const maybe = opts.maybe == null ? MAYBE_DIST : opts.maybe;
  const parts = {};
  let dist = 0;
  for (const f of FEATURES) {
    const ha = fromB64(A.h[f], BINS[f]);
    const hb = fromB64(B.h[f], BINS[f]);
    const raw = (ha && hb) ? l1(ha, hb) : (f === 'da' ? 0 : 1);
    parts[f] = Math.round(raw * 1000) / 1000;
    dist += WEIGHT[f] * Math.min(CAP, raw / NOISE[f]);
  }
  if (A.p != null && B.p != null) {
    const rawP = Math.abs(A.p - B.p);
    parts.lp = Math.round(rawP * 1000) / 1000;
    dist += WEIGHT.lp * Math.min(CAP, rawP / NOISE.lp);
  }
  const scale = (A.e && B.e) ? Math.round((B.e / A.e) * 100) / 100 : null;
  let role = null;
  if (dist <= same) {
    role = (scale != null && Math.abs(scale - 1) > SCALE_EPS) ? 'scaled' : 'same';
  } else if (dist <= maybe) {
    role = 'maybe';
  }
  dist = Math.round(dist * 100) / 100;
  return { dist, score: Math.max(0, Math.min(1, Math.round((1 - 0.08 * dist) * 100) / 100)), role, scale, parts };
}

// ---------------------------------------------------------------- 分桶

const CHUNK = 0.2;   // 分桶宽度
/**
 * 候选键（只在记录数 > FULL_PAIRWISE_MAX 时用）：D1 / D2 的每个分位数各出一个键，
 * 两套偏移，减少恰好落在格子边界的漏配。任何**一个**分位数同格就成为候选，召回优先。
 */
function bucketKeys(sig) {
  const keys = [];
  for (const name of ['d1', 'd2']) {
    const arr = sig.q[name];
    for (let i = 0; i < arr.length; i++) {
      for (const off of [0, CHUNK / 2]) keys.push(name + i + ':' + Math.floor((arr[i] + off) / CHUNK));
    }
  }
  return keys;
}

function candidatePairs(list) {
  const pairs = new Set();
  const buckets = new Map();
  list.forEach((c, i) => {
    for (const k of bucketKeys(c.sig)) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
  });
  for (const ids of buckets.values()) {
    // 太大的桶（一堆同尺寸方块之类）退化成 O(n²)，跳过它，靠其它桶补
    if (ids.length > 1500) continue;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const i = ids[a], j = ids[b];
        pairs.add(i < j ? i * 1000003 + j : j * 1000003 + i);
      }
    }
  }
  return Array.from(pairs, (key) => [Math.floor(key / 1000003), key % 1000003]);
}

// ---------------------------------------------------------------- 索引

class ShapeIndex {
  constructor(file) {
    this.file = file;
    this.items = {};
    this._dirty = false;
    this.load();
  }

  load() {
    this.items = {};
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j && j.items && typeof j.items === 'object') this.items = j.items;
    } catch (_) { this.items = {}; }
  }

  /** 有效指纹数（算失败的条目不计） */
  get size() {
    let n = 0;
    for (const k of Object.keys(this.items)) if (this.items[k] && this.items[k].h) n++;
    return n;
  }

  get(id) { return this.items[id] || null; }
  set(id, sig) { this.items[id] = sig; this._dirty = true; }
  remove(ids) {
    let n = 0;
    for (const id of ids) if (this.items[id]) { delete this.items[id]; n++; }
    if (n) this._dirty = true;
    return n;
  }

  flush() {
    if (!this.file || !this._dirty) return;
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ version: 2, updatedAt: U.now(), items: this.items }));
    try { fs.renameSync(tmp, this.file); }
    catch (_) {
      fs.copyFileSync(tmp, this.file);
      try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
    }
    this._dirty = false;
  }

  status() {
    let failed = 0;
    for (const k of Object.keys(this.items)) if (this.items[k] && !this.items[k].h) failed++;
    return { total: this.size, failed };
  }

  /**
   * 重算全部「同款变体」分组并写回记录（先清空再算）。
   * 只用「指纹没过期」的记录：文件内容变了（hash 对不上）的先不参与，等后台重算。
   */
  annotate(lib, opts = {}) {
    const models = (lib && lib.models) || {};
    const maybe = opts.maybe == null ? MAYBE_DIST : opts.maybe;
    const cands = [];
    for (const r of Object.values(models)) {
      if (!r) continue;
      r.variantGroup = null;
      r.variantRole = null;
      r.variantScore = null;
      r.variantScale = null;
      if (!r.id || r.aliasOf) continue;
      if (r.status === 'missing' || r.status === 'quarantined' || r.parseErrorKind) continue;
      const sig = this.items[r.id];
      if (!sig || !sig.h) continue;
      if (sig.s && r.hash && sig.s !== r.hash) continue;   // 过期
      cands.push({ rec: r, sig });
    }
    if (cands.length < 2) return { groups: 0, members: 0, candidates: cands.length };

    // ---- 候选对 ----
    let pairs;
    if (cands.length <= FULL_PAIRWISE_MAX) {
      pairs = [];
      for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) pairs.push([i, j]);
      }
    } else {
      pairs = candidatePairs(cands);
    }

    // ---- 并查集 ----
    const parent = cands.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const [i, j] of pairs) {
      if (find(i) === find(j)) continue;
      const r = similarity(cands[i].sig, cands[j].sig, { maybe });
      if (r.dist <= maybe) {
        const a = find(i), b = find(j);
        if (a !== b) parent[a] = b;
      }
    }

    // ---- 写回 ----
    const byRoot = new Map();
    cands.forEach((c, i) => {
      const root = find(i);
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(i);
    });
    let groups = 0;
    let members = 0;
    for (const list of byRoot.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (Number(cands[a].rec.createdAt) || 0) - (Number(cands[b].rec.createdAt) || 0)
        || String(cands[a].rec.id).localeCompare(String(cands[b].rec.id)));
      const rep = cands[list[0]];
      // 防止「A~B、B~C 都疑似」把毫不相干的 A 和 C 串成一组：每个成员必须和**基准**相似。
      const keep = [];
      for (const idx of list) {
        if (idx === list[0]) { keep.push([idx, { role: 'base' }]); continue; }
        const r = similarity(rep.sig, cands[idx].sig, { maybe });
        if (r.role) keep.push([idx, r]);
      }
      if (keep.length < 2) continue;
      groups++;
      for (const [idx, r] of keep) {
        const c = cands[idx];
        c.rec.variantGroup = 'var:' + rep.rec.id;
        c.rec.variantRole = r.role;
        c.rec.variantScore = r.score == null ? null : r.score;
        c.rec.variantScale = r.scale == null ? null : r.scale;
        members++;
      }
    }
    return { groups, members, candidates: cands.length };
  }
}

module.exports = {
  ShapeIndex, computeSignature, similarity, bucketKeys, candidatePairs, l1,
  loadMeshes, sampleSurfacePoints, signatureFromPoints, normalize, rng, dihedralHist,
  BINS, NOISE, WEIGHT, FEATURES,
  SAME_DIST: SAME_DIST, MAYBE_DIST: MAYBE_DIST, SCALE_EPS,
};
