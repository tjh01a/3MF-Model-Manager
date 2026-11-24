'use strict';
/**
 * 快造 U1 转换 · 床位居中补偿（我们自己的后处理，不属于上游引擎）。
 *
 * 问题：拓竹 A1 mini 的床是 180×180，U1 是 270×270。上游引擎只补偿了两边
 * printable_area 的原点差（0.5 / 1 mm），**没有补偿尺寸差**，于是模型保留在
 * 「180 床坐标系」里的位置，换到 270 床上就整体贴在左下角，看起来像错位
 * （2026-11-24 实测：A1 mini → U1，每轴缺 45 mm）。
 *
 * 做法：把 build item 与 assemble_item 的平移同时加 (ΔW/2, ΔH/2)。
 * 两处必须一起改——Orca 读 assemble 定位、Bambu 读 build item 定位，
 * 只改一处会让「盘内摆放」和「模型位置」互相打架。
 *
 * 坐标系假设：拓竹 3MF 里每个对象的平移是**本盘坐标**（不是跨盘画布），
 * 因此统一平移对所有盘同时生效、盘内相对关系不变。实测多盘样本（9/10/12 盘）
 * 盘内对象平移都落在 0~床宽 内，符合该假设。
 */
const AdmZip = require('adm-zip');

const MODEL_ENTRY = /3dmodel\.model$/i;
const SETTINGS_ENTRY = /model_settings\.config$/i;

/** "0x0" / "270.5x271" → { x, y } */
function parsePoint(s) {
  const m = /^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$/i.exec(String(s || ''));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** printable_area = ['0x0','180x0','180x180','0x180'] → { x0,y0,w,h } */
function bedRect(area) {
  if (!Array.isArray(area) || area.length < 4) return null;
  const pts = area.map(parsePoint).filter(Boolean);
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/**
 * 需要额外平移多少：床变大时对象坐标要**变小**，因为盘坐标以床中心为基准。
 *
 * 方向由拓竹自己的行为实测确定（2026-11-24）：同一个项目在 Bambu Studio 里
 * 把打印机从 A1 mini（180）换成 A1（256）后另存，87 个对象的 assemble 平移
 * **全部**是 −38.00 —— 正好等于 (180 − 256) / 2。所以公式是 (源床 − 目标床) / 2，
 * 不是反过来；上一版用了正号，往错的方向推了 90 mm，看起来比不补还歪。
 *
 * 于是 A1 mini → U1 直接转换得到 −45，与「先用拓竹换成 A1（−38）再转 U1（−7）」
 * 两段相加完全一致，不需要多一步中转。
 */
function recenterDelta(srcArea, dstArea) {
  const a = bedRect(srcArea);
  const b = bedRect(dstArea);
  if (!a || !b) return { dx: 0, dy: 0, reason: '缺少 printable_area' };
  const dx = +(((a.w - b.w) / 2)).toFixed(4);
  const dy = +(((a.h - b.h) / 2)).toFixed(4);
  return { dx, dy, src: a, dst: b };
}

function shiftTransform(t, dx, dy) {
  const v = String(t).trim().split(/\s+/).map(Number);
  if (v.length !== 12 || !v.every(Number.isFinite)) return null;
  v[9] += dx;
  v[10] += dy;
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));
  return v.map(fmt).join(' ');
}

/**
 * 平移 XML 里所有 transform="..."（build item / assemble_item / component 都用同一格式）。
 * 只动 12 个数的矩阵，其余原样保留；不动字符串长度敏感的空格风格以外的内容。
 */
function shiftXmlTransforms(xml, dx, dy) {
  let count = 0;
  const out = String(xml).replace(/(\btransform=")([^"]*)(")/g, (m, pre, val, post) => {
    const shifted = shiftTransform(val, dx, dy);
    if (!shifted) return m;
    count++;
    return pre + shifted + post;
  });
  return { xml: out, count };
}

/**
 * @param {Buffer} buf 转换产物
 * @param {{srcArea:string[], dstArea:string[]}} opts
 * @returns {{buffer:Buffer, report:object}}
 */
function applyBedRecenter(buf, { srcArea, dstArea } = {}) {
  const { dx, dy, src, dst, reason } = recenterDelta(srcArea, dstArea);
  const report = {
    applied: false,
    dx: 0,
    dy: 0,
    srcBed: src ? `${src.w}×${src.h}` : null,
    dstBed: dst ? `${dst.w}×${dst.h}` : null,
    models: 0,
    transforms: 0,
    reason: reason || null,
  };
  if ((!dx && !dy) || reason) return { buffer: buf, report };

  let zip;
  try { zip = new AdmZip(buf); } catch (_) { return { buffer: buf, report: { ...report, reason: 'zip 读取失败' } }; }
  for (const entry of zip.getEntries()) {
    if (!MODEL_ENTRY.test(entry.entryName) && !SETTINGS_ENTRY.test(entry.entryName)) continue;
    const text = entry.getData().toString('utf8');
    if (!text.includes('transform="')) continue;
    const r = shiftXmlTransforms(text, dx, dy);
    if (!r.count) continue;
    zip.updateFile(entry.entryName, Buffer.from(r.xml, 'utf8'));
    report.models++;
    report.transforms += r.count;
  }
  if (!report.models) return { buffer: buf, report: { ...report, reason: '产物里没有可平移的 transform' } };
  report.applied = true;
  report.dx = dx;
  report.dy = dy;
  return { buffer: zip.toBuffer(), report };
}

module.exports = { applyBedRecenter, recenterDelta, bedRect, parsePoint, shiftXmlTransforms };
