'use strict';
/**
 * 快造 U1 转换 · worker 线程入口。
 *
 * 为什么要单开线程：转换 180 MB 的模型要 20 秒以上，而且是纯 CPU 密集的字符串/zip 处理。
 * 放在主进程里会把整个界面冻住（连「取消」都点不动）。这里独立线程跑，主进程只收进度。
 *
 * 约定：不管成功失败都必须回一条消息，绝不让异常静默吞掉。
 */
const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const AdmZip = require('adm-zip');

// BedReady 的两个上限原本是给浏览器标签页的防 zip 炸弹护栏（200MB/800MB）。
// 用户库里 180MB 级的 3MF 解压后普遍 850MB~1.2GB，原值会直接判失败。
// 桌面端内存宽裕，放宽到 4GB/3GB，同时保留上限仍然能挡住真正的炸弹。
globalThis.__BEDREADY_CAP_COMPRESSED__ = 4096 * 1024 * 1024;
globalThis.__BEDREADY_CAP_INFLATED__ = 3072 * 1024 * 1024;

const ENGINE = path.resolve(__dirname, '..', '..', 'vendor', 'bedready', 'bedready-node.cjs');

function send(msg) {
  try { parentPort.postMessage(msg); } catch (_) { /* 主进程已断开，忽略 */ }
}

async function run() {
  const job = workerData || {};
  const { srcPath, outPath } = job;
  const opts = job.options || {};

  if (!srcPath || !fs.existsSync(srcPath)) {
    throw new Error('源文件不存在：' + srcPath);
  }
  if (!fs.existsSync(ENGINE)) {
    throw new Error('缺少转换引擎：' + ENGINE + '（vendor/bedready 目录缺失或被删）');
  }

  let engine;
  try {
    engine = require(ENGINE);
  } catch (e) {
    throw new Error('转换引擎加载失败：' + e.message);
  }
  if (typeof engine.cleanThreeMF !== 'function') {
    throw new Error('转换引擎版本不匹配：缺少 cleanThreeMF 入口');
  }

  send({ stage: 'read', message: '读取模型…' });
  const stat = fs.statSync(srcPath);
  const buf = fs.readFileSync(srcPath);

  // Node 18+ 有全局 File；老版本兜一个最小实现，避免直接崩
  let file;
  if (typeof File === 'function') {
    file = new File([buf], path.basename(srcPath));
  } else {
    file = { name: path.basename(srcPath), size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }

  send({ stage: 'convert', message: '重新生成快造配置…' });
  const t0 = Date.now();
  const result = await engine.cleanThreeMF(file, 'u1', { mode: 'stamp' });
  const bytes = Buffer.from(await result.blob.arrayBuffer());

  send({ stage: 'patch', message: '应用你的耗材与进程预设…' });
  const { patchProjectConfig } = require('../../src/core/u1patch');
  const patched = patchProjectConfig(bytes, {
    filamentPreset: opts.filamentPreset || '',
    filamentValues: opts.filamentValues || null,
    processPreset: opts.processPreset || '',
    processValues: opts.processValues || null,
  });

  // 先写临时文件再改名，避免中途失败留下半截文件被当成有效缓存
  const tmp = outPath + '.part';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmp, patched.buffer);
  fs.renameSync(tmp, outPath);

  // 床位再居中：上游只补了 printable_area 原点差，没补「床变大」的尺寸差。
  // A1 mini（180）→ U1（270）时每轴差 45 mm，不补就整盘贴在左下角（2026-11-24 实测）。
  send({ stage: 'recenter', message: '按新床尺寸居中…' });
  const { applyBedRecenter } = require('../../src/core/u1bedshift');
  const { readProjectConfigFromFile } = require('../../src/core/u1patch');
  let recenter = { applied: false, reason: '跳过' };
  try {
    const srcCfg = readProjectConfigFromFile(srcPath) || {};
    const dstCfg = (() => {
      try { return JSON.parse(new AdmZip(patched.buffer).getEntries()
        .find((e) => /project_settings\.config$/i.test(e.entryName)).getData().toString('utf8')); }
      catch (_) { return {}; }
    })();
    const shifted = applyBedRecenter(patched.buffer, {
      srcArea: srcCfg.printable_area,
      dstArea: dstCfg.printable_area,
    });
    recenter = shifted.report;
    if (shifted.report.applied) {
      fs.writeFileSync(tmp, shifted.buffer);
      fs.renameSync(tmp, outPath);
    }
  } catch (e) {
    recenter = { applied: false, reason: (e && e.message) || String(e) };
  }

  const d = result.diff || {};
  send({
    ok: true,
    outPath,
    report: {
      sourceBytes: stat.size,
      outputBytes: fs.statSync(outPath).size,
      sourceMtimeMs: stat.mtimeMs,
      elapsedMs: Date.now() - t0,
      colorsTotal: result.colorsTotal,
      colorsKept: result.colorsKept,
      painted: !!result.painted,
      reduced: !!result.reduced,
      preserved: !!result.preserved,
      kept: result.kept,
      removed: (result.removed || []).length,
      printerFrom: d.printerFrom || null,
      printerTo: d.printerTo || null,
      bedShift: d.bedShift || null,
      recenter,
      patch: patched.report,
    },
  });
}

run().catch((e) => {
  send({ ok: false, error: (e && e.message) ? e.message : String(e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : '' });
});
