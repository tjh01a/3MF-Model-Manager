/**
 * 走查探针：普通 3MF → 快造 U1 专用 3MF 的只读核验（用户重点要求）。
 *   node launch.js --no-seed --capture=data/reg/u1-convert.png --ui-script=tools/probe-u1-convert.js
 *
 * 数据安全（P0）：本探针绝不调用 u1Convert（包括 force:false），不会写 u1-cache。
 *  - 只读检测已有转换缓存（u1Status().cache）；
 *  - 只读快照样本模型源文件信息，结束时核验源文件未变；
 *  - 若拿到既有 report（例如上层注入的只读诊断），按 u1-worker.js 的字段契约校验；
 *  - 没有既有产物时返回 ok:false 并说明，不主动触发转换。
 *
 * 产物是否符合 U1 规范请单独运行：node tools/u1/verify-output.js <输出.3mf> [源.3mf]
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const q = (s) => document.querySelector(s);

// 捕获被 catch 后只弹红字、不进 window.onerror 的运行时错误
const toastErrors = [];
const toastBox = q('#toast-container');
if (toastBox && typeof MutationObserver !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!n || n.nodeType !== 1) continue;
      const bad = n.classList && n.classList.contains('toast-error') ? n : n.querySelector('.toast-error');
      if (!bad) continue;
      const msg = bad.querySelector('.toast-message');
      toastErrors.push(msg ? msg.textContent.trim() : 'error toast');
    }
  }).observe(toastBox, { childList: true });
}

// report 基本字段契约（见 src/core/u1-worker.js 的 send({ report })：转换成功必有这些字段）
function checkReportBasic(report) {
  const required = ['sourceBytes', 'outputBytes', 'sourceMtimeMs', 'elapsedMs',
    'colorsTotal', 'colorsKept', 'painted', 'reduced', 'preserved', 'kept', 'removed'];
  const missing = required.filter((k) => !(k in report));
  const numbersOk = ['sourceBytes', 'outputBytes', 'sourceMtimeMs', 'elapsedMs', 'colorsTotal', 'colorsKept']
    .every((k) => typeof report[k] === 'number' && Number.isFinite(report[k]) && report[k] >= 0);
  const bytesOk = report.outputBytes > 0 && report.sourceBytes > 0;
  const colorsOk = report.colorsKept >= 0 && report.colorsTotal >= 0 && report.colorsKept <= report.colorsTotal;
  return { ok: missing.length === 0 && numbersOk && bytesOk && colorsOk, missing, numbersOk, bytesOk, colorsOk };
}

// 只读：U1 状态与缓存统计
let st = null;
try { st = await window.shelf.u1Status(); }
catch (e) { out.error = 'u1Status 读取失败：' + ((e && e.message) || String(e)); }
out.status = st;
out.cache = st && st.cache ? st.cache : null;
const statusOk = !!st && !st.error && !!out.cache;

// 只读：找一个 .3mf 样本模型
const KEYWORD = 'AMS轻型顶置';   // 真实多色拓竹工程，库里通常存在
let items = [];
try {
  items = ((await window.shelf.query({ keyword: KEYWORD, smart: 'all', page: 1, pageSize: 20 })) || {}).items || [];
  if (!items.length) items = ((await window.shelf.query({})) || {}).items || [];
} catch (e) { out.queryError = (e && e.message) || String(e); }
const m = items.find((x) => x && /\.3mf$/i.test(String(x.path || ''))) || null;
if (!m) {
  out.ok = false;
  out.error = '库中没有 .3mf 样本模型，无法只读核验 U1 转换（本探针不会触发转换）';
  out.toastErrors = Array.from(new Set(toastErrors));
  return out;
}
out.model = { id: m.id, fileName: m.fileName, path: m.path, size: m.size };

// 只读：源文件快照（get 不写库）
let sourceBefore = null;
try {
  const g = await window.shelf.get(m.id);
  sourceBefore = JSON.stringify({
    path: g && g.path, size: g && g.size,
    updatedAt: g && g.updatedAt, meta: g && g.meta ? g.meta : null,
  });
} catch (e) { out.sourceReadError = (e && e.message) || String(e); }
out.sourceBefore = sourceBefore;

// 只读：若上层注入了既有 report 诊断则校验字段；本探针自己绝不调用 u1Convert
out.report = window.__u1LastReport || null;
out.reportCheck = out.report ? checkReportBasic(out.report) : null;

// 只读：核验源文件未变
let sourceAfter = null;
try {
  const g2 = await window.shelf.get(m.id);
  sourceAfter = JSON.stringify({
    path: g2 && g2.path, size: g2 && g2.size,
    updatedAt: g2 && g2.updatedAt, meta: g2 && g2.meta ? g2.meta : null,
  });
} catch (e) { out.sourceReadError = (e && e.message) || String(e); }
out.sourceAfter = sourceAfter;
const sourceUnchanged = !!sourceBefore && sourceAfter === sourceBefore && !out.sourceReadError;

const cacheCount = (out.cache && Number(out.cache.count)) || 0;
out.checks = {
  statusOk, hasSample: true, sourceUnchanged,
  hasExistingCache: cacheCount > 0,
  reportFieldsOk: out.reportCheck ? out.reportCheck.ok : null,
};
out.toastErrors = Array.from(new Set(toastErrors));

// 没有既有缓存产物：不主动转换，明确跳过；有产物时给出只读健康结论，
// 产物规范校验由 tools/u1/verify-output.js 完成。
out.conversionVerified = false;
out.ok = statusOk && sourceUnchanged && !out.toastErrors.length &&
  (out.reportCheck ? out.reportCheck.ok : cacheCount > 0);
if (!cacheCount && !out.report) {
  out.error = 'u1-cache 没有既有产物；本探针只读、不主动转换，未验证转换结果。请在用户实际转换后重跑，并用 tools/u1/verify-output.js 校验产物';
}
return out;
