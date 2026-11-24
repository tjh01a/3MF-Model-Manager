'use strict';
/**
 * 快造 U1 转换 · 多盘坐标重排（我们自己的后处理，不属于上游引擎）。
 *
 * 拓竹 3MF 里，一个项目所有盘的对象坐标共用一张「跨盘画布」：
 *   盘原点 = (列 × 格距, −行 × 格距)，格距 = 床宽 + 51。
 * 实测（2026-11-24）：A1 mini(180) → 231；A1/P1S(256) → 307；U1(270) → 321。
 *
 * Orca 打开文件时按「坐标落在哪个格子」判盘，格子尺寸跟当前打印机走。
 * 源文件用 231 的格子、U1 用 321，于是每往右一盘内容就相对盘面左移 90 mm，
 * 越远的盘偏得越多 —— 这就是「A1 mini 转 U1 后整片错位」的真正原因。
 *
 * 之前试过的「整体平移 ±(床差/2)」只是在改一个常量，压根不解决逐盘累积误差，
 * 所以怎么调都不对（2026-11-24 两轮实测）。
 *
 * 做法：把每个对象拆成「盘号 + 格内位置」，再按目标格距重新拼回去。
 * 盘号由数据反解（格距的整数倍），不写死列数，5 列 / 26 盘的项目也适用。
 */
const AdmZip = require('adm-zip');

const GAP = 51;
const MODEL_ENTRY = /3dmodel\.model$/i;
const SETTINGS_ENTRY = /model_settings\.config$/i;

/** "0x0" / "270.5x271" → {x,y} */
function parsePoint(s) {
  const m = /^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$/i.exec(String(s || ''));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** printable_area → { x0,y0,w,h } */
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

/** 盘号 → 对象 id 列表 */
function readPlates(xml) {
  const out = [];
  let i = 0;
  for (const m of String(xml).matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    i++;
    const body = m[1];
    const idx = (body.match(/key="plater_id"\s+value="(\d+)"/) || [])[1];
    const ids = [...body.matchAll(/key="object_id"\s+value="(\d+)"/g)].map((x) => x[1]);
    if (!ids.length) continue;
    out.push({ index: idx ? Number(idx) : i, ids });
  }
  return out;
}

/** 在 [min,max] 里找唯一的格距整数倍作为原点；找不到就用最接近的那个 */
function solveOrigin(min, max, stride, bed) {
  const cands = [];
  const lo = Math.floor(min / stride) - 1;
  const hi = Math.ceil(max / stride) + 1;
  for (let k = lo; k <= hi; k++) {
    const o = k * stride;
    if (min - o >= -1 && max - o <= bed + 1) cands.push(o);
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) return cands.sort((a, b) => Math.abs(a - min) - Math.abs(b - min))[0];
  return null;
}

function shiftTransform(t, dx, dy) {
  const v = String(t).trim().split(/\s+/).map(Number);
  if (v.length !== 12 || !v.every(Number.isFinite)) return null;
  v[9] = +(v[9] + dx).toFixed(6);
  v[10] = +(v[10] + dy).toFixed(6);
  return v.map((n) => (Number.isInteger(n) ? String(n) : String(n))).join(' ');
}

/**
 * @param {Buffer} buf 转换产物
 * @param {{srcArea:string[], dstArea:string[]}} opts
 * @returns {{buffer:Buffer, report:object}}
 */
function applyPlateRetile(buf, { srcArea, dstArea, center = true } = {}) {
  const src = bedRect(srcArea);
  const dst = bedRect(dstArea);
  const report = {
    applied: false, centered: false, srcBed: src ? `${src.w}×${src.h}` : null, dstBed: dst ? `${dst.w}×${dst.h}` : null,
    srcStride: null, dstStride: null, plates: 0, items: 0, fallbackPlates: 0, reason: null,
  };
  if (!src || !dst) return { buffer: buf, report: { ...report, reason: '缺少 printable_area' } };
  // 床一样大就不需要重排（同尺寸换机、已经是 U1 的文件）
  if (Math.abs(src.w - dst.w) < 0.5 && Math.abs(src.h - dst.h) < 0.5) {
    return { buffer: buf, report: { ...report, reason: '同尺寸床，无需重排' } };
  }

  let zip;
  try { zip = new AdmZip(buf); } catch (_) { return { buffer: buf, report: { ...report, reason: 'zip 读取失败' } }; }

  const msEntry = zip.getEntries().find((e) => SETTINGS_ENTRY.test(e.entryName));
  const modelEntries = zip.getEntries().filter((e) => MODEL_ENTRY.test(e.entryName));
  if (!msEntry || !modelEntries.length) {
    return { buffer: buf, report: { ...report, reason: '缺少 model_settings / 3dmodel' } };
  }

  const plates = readPlates(msEntry.getData().toString('utf8'));
  if (plates.length < 2) return { buffer: buf, report: { ...report, reason: '单盘项目，无需重排' } };

  const strideSrc = src.w + GAP;
  const strideDst = dst.w + GAP;
  report.srcStride = strideSrc;
  report.dstStride = strideDst;

  // 先把所有 build item 的坐标读出来，按盘求原点
  const items = [];
  for (const e of modelEntries) {
    const xml = e.getData().toString('utf8');
    for (const m of xml.matchAll(/<item\b([^>]*?)\/>/g)) {
      const a = m[1];
      const id = (a.match(/objectid="(\d+)"/) || [])[1];
      const t = (a.match(/transform="([^"]*)"/) || [])[1];
      if (!id || !t) continue;
      const v = t.trim().split(/\s+/).map(Number);
      if (v.length !== 12 || !v.every(Number.isFinite)) continue;
      items.push({ entry: e.entryName, raw: m[0], id, t: v });
    }
  }
  if (!items.length) return { buffer: buf, report: { ...report, reason: '没有可重排的 build item' } };

  const plateOf = new Map();
  for (const p of plates) for (const id of p.ids) plateOf.set(String(id), p.index);

  // 每盘：x 正向、y 负向找格距整数倍
  const originByPlate = new Map();
  for (const p of plates) {
    const list = items.filter((it) => plateOf.get(it.id) === p.index);
    if (!list.length) continue;
    const xs = list.map((it) => it.t[9]);
    const ys = list.map((it) => it.t[10]);
    const ox = solveOrigin(Math.min(...xs), Math.max(...xs), strideSrc, src.w);
    const oy = solveOrigin(Math.min(...ys), Math.max(...ys), strideSrc, src.h);
    if (ox == null || oy == null) {
      // 解不出来（比如对象跨了格）：按「每行 4 列」的常规布局兜底
      const col = (p.index - 1) % 4;
      const row = Math.floor((p.index - 1) / 4);
      originByPlate.set(p.index, { ox: col * strideSrc, oy: -row * strideSrc, guessed: true });
      report.fallbackPlates++;
    } else {
      originByPlate.set(p.index, { ox, oy, guessed: false });
    }
  }

  // 先算出每个对象重排后的目标位置
  for (const it of items) {
    const plate = plateOf.get(it.id);
    const o = originByPlate.get(plate);
    if (!o) continue;
    const lx = it.t[9] - o.ox;          // 本盘坐标：x 减原点
    const ly = it.t[10] - o.oy;         //             y 减原点（原点为负）
    const col = Math.round(o.ox / strideSrc);
    const row = Math.round(-o.oy / strideSrc);
    it.nx = lx + col * strideDst;       // 按目标格距拼回
    it.ny = ly - row * strideDst;
    it.plate = plate;
  }

  // 再按盘把内容整体挪到盘中心：拓竹自己换机保存时也是每盘居中摆放
  const centers = new Map();
  if (center) {
    for (const p of plates) {
      const list = items.filter((it) => it.plate === p.index && it.nx != null);
      if (!list.length) continue;
      const o = originByPlate.get(p.index);
      const col = Math.round(o.ox / strideSrc);
      const row = Math.round(-o.oy / strideSrc);
      // 目标是「本盘自己的格子中心」，不是绝对盘中心——否则所有盘会被摞进第一格
      const targetX = col * strideDst + dst.x0 + dst.w / 2;
      const targetY = -row * strideDst + dst.y0 + dst.h / 2;
      const xs = list.map((it) => it.nx);
      const ys = list.map((it) => it.ny);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      centers.set(p.index, { dx: targetX - cx, dy: targetY - cy });
    }
  }
  for (const it of items) {
    if (it.nx == null) continue;
    const c = centers.get(it.plate);
    if (c) { it.nx += c.dx; it.ny += c.dy; }
  }

  let changed = 0;
  for (const e of modelEntries) {
    const xml = e.getData().toString('utf8');
    let text = xml;
    let touched = false;
    for (const it of items) {
      if (it.entry !== e.entryName || it.nx == null) continue;
      const shifted = shiftTransform(it.t.join(' '), it.nx - it.t[9], it.ny - it.t[10]);
      if (!shifted) continue;
      text = text.replace(it.raw, it.raw.replace(/transform="[^"]*"/, 'transform="' + shifted + '"'));
      touched = true;
      changed++;
    }
    if (touched) zip.updateFile(e.entryName, Buffer.from(text, 'utf8'));
  }
  if (!changed) return { buffer: buf, report: { ...report, reason: '没有任何对象需要重排' } };
  report.applied = true;
  report.centered = center && centers.size > 0;
  report.plates = originByPlate.size;
  report.items = changed;
  return { buffer: zip.toBuffer(), report };
}

module.exports = { applyPlateRetile, readPlates, bedRect, parsePoint, solveOrigin, GAP };
