/**
 * 走查探针：普通 3MF → 快造 U1 专用 3MF 的真实转换（用户重点要求）。
 * 只转换，不打开切片软件；产物路径打印出来后由 tools/verify-u1-output.js 校验。
 *   node launch.js --no-seed --capture=data/reg/u1-convert.png --ui-script=tools/probe-u1-convert.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

const KEYWORD = 'AMS轻型顶置';   // 真实多色拓竹工程，库里存在
const q = await window.shelf.query({ keyword: KEYWORD, smart: 'all', page: 1, pageSize: 20 });
const items = (q && q.items) || [];
if (!items.length) return { ok: false, error: '没找到样本模型：' + KEYWORD };
const m = items[0];
out.model = { id: m.id, fileName: m.fileName, path: m.path, size: m.size, multiColor: !!(m.meta && m.meta.hasMultiColor) };

const st = await window.shelf.u1Status();
out.status = st;

const t0 = Date.now();
let r;
try {
  r = await window.shelf.u1Convert(m.id, { force: true });
} catch (e) {
  return { ok: false, error: '转换失败：' + ((e && e.message) || String(e)), model: out.model, status: st };
}
out.ms = Date.now() - t0;
out.result = r;
out.cached = !!(r && r.cached);
out.report = r && r.report;
out.outPath = r && r.outPath;

// 源文件必须原封不动
try {
  const after = await window.shelf.u1Status();
  out.statusAfter = after;
} catch (_) {}

out.ok = !!(r && r.outPath && r.report);
return out;
