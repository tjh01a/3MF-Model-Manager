'use strict';
/**
 * PrintShelf · 模型优化编排层（纯 Node）
 *
 * 把「3MF 桥接」与「Blender 计算引擎」串成一条可取消、可观测的流水线。
 * 主进程（electron/ipc）只需订阅 progress/log/done/error 事件转发给渲染层。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile, spawn } = require('child_process');
const mesh3mf = require('./mesh3mf');

const CANDIDATES = [
  'E:/steam/steamapps/common/Blender/blender.exe',
  'E:/steam/steamapps/common/Blender/5.3/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.0/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 3.6/blender.exe',
];
const PRESET_TO_ENGINE = { gentle: 'gentle', standard: 'standard', strong: 'strong', deep: 'voxel' };
const OVERALL_TIMEOUT = 5 * 60 * 1000;
const BLENDER_TIMEOUT = 3 * 60 * 1000;

function blenderScript() {
  // __dirname = <root>/src/core → 上两级才是项目根
  return path.resolve(__dirname, '..', '..', 'tools', 'blender', 'mesh_opt.py');
}
function tmpDir(tag) {
  const p = path.join(os.tmpdir(), 'printshelf-meshopt-' + (tag || Date.now().toString(36)) + '-' + Math.random().toString(36).slice(2, 7));
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function safeClean(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* TEMP 里残留无副作用 */ }
}
function uniqueOut(srcPath) {
  const ext = path.extname(srcPath);
  const base = srcPath.slice(0, -ext.length);
  let candidate = base + '_已优化' + ext;
  let i = 2;
  while (fs.existsSync(candidate)) { candidate = base + '_已优化_' + i + ext; i++; }
  return candidate;
}
function weightedTotals(parts) {
  const faces = parts.reduce((a, p) => a + p.faceCount, 0);
  const w = (k) => faces ? parts.reduce((a, p) => a + p[k] * p.faceCount, 0) / faces : 0;
  return {
    angleMean: Math.round(w('angleMean') * 100) / 100,
    gt15: w('gt15'), gt30: w('gt30'), thinPct: w('thinPct'),
    volumeMm3: Math.round(parts.reduce((a, p) => a + p.volumeMm3, 0) * 100) / 100,
    faces,
  };
}

class MeshOptimizer extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.cancelled = false;
    this.running = false;
    this.timer = null;
    this.workDir = null;
    this.cachedBlender = null;
  }

  /** 探测 Blender。custom 优先，其次环境变量、常见路径、PATH。 */
  async detectBlender(custom) {
    if (!custom && this.cachedBlender) return this.cachedBlender;
    const list = [];
    if (custom) list.push(custom);
    if (process.env.PRINTSHELF_BLENDER) list.push(process.env.PRINTSHELF_BLENDER);
    list.push(...CANDIDATES);
    list.push('blender');
    const seen = new Set();
    for (const p of list) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (p !== 'blender' && !fs.existsSync(p)) continue;
      try {
        const version = await new Promise((resolve, reject) => {
          execFile(p, ['--version'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
            if (err) return reject(err);
            const m = String(stdout).match(/Blender\s+([\d.]+)/);
            resolve(m ? m[1] : 'unknown');
          });
        });
        const r = { path: p, version, ok: true, reason: '' };
        this.cachedBlender = r;
        return r;
      } catch (_) { /* 试下一个 */ }
    }
    return {
      path: custom || '', version: '', ok: false,
      reason: '没有找到可用的 Blender。请在设置里填写 blender.exe 的完整路径，或安装 Blender 后重试。',
    };
  }

  emitProgress(stage, current, total, message) {
    this.emit('progress', { stage, current, total, message });
  }
  emitLog(message) {
    if (message) this.emit('log', { message: String(message) });
  }

  cancel() {
    if (!this.running) return { ok: false, reason: '当前没有正在运行的优化' };
    this.cancelled = true;
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGKILL'); } catch (_) { /* 已退出 */ }
    }
    return { ok: true };
  }

  /**
   * @param {Object} o
   *  srcPath       源 3MF（只读）
   *  preset        gentle | standard | strong | deep
   *  clampMm       位移上限（默认 0.15）
   *  voxelMm       深度档体素大小（默认 0.25）
   *  includeAngular 是否连棱角件一起处理
   *  blenderPath   手动指定的 Blender 路径
   *  outPath       可选；默认同目录「_已优化.3mf」
   */
  async run(o = {}) {
    if (this.running) throw new Error('已有优化任务在运行，请先取消');
    const srcPath = o.srcPath;
    if (!srcPath || !fs.existsSync(srcPath)) throw new Error('找不到源 3MF 文件');
    const preset = PRESET_TO_ENGINE[o.preset] ? o.preset : 'standard';
    const enginePreset = PRESET_TO_ENGINE[preset];
    const deep = enginePreset === 'voxel';
    const clampMm = Number.isFinite(Number(o.clampMm)) ? Number(o.clampMm) : 0.15;
    const voxelMm = Number.isFinite(Number(o.voxelMm)) ? Number(o.voxelMm) : 0.25;
    const outPath = o.outPath || uniqueOut(srcPath);
    if (path.resolve(outPath) === path.resolve(srcPath)) throw new Error('输出路径不能与源文件相同');

    this.running = true;
    this.cancelled = false;
    this.workDir = tmpDir();
    const inDir = path.join(this.workDir, 'in');
    const outDir = path.join(this.workDir, 'out');
    fs.mkdirSync(inDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(this.workDir, 'report.json');
    let produced = null;

    const cleanup = () => {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      safeClean(this.workDir);
      this.workDir = null;
      this.child = null;
      this.running = false;
    };

    try {
      // ---- 1. Blender 自检 ----
      this.emitProgress('detect', 0, 5, '检查 Blender…');
      const blender = await this.detectBlender(o.blenderPath);
      if (!blender.ok) throw new Error(blender.reason);
      this.emitLog('Blender ' + blender.version + ' → ' + blender.path);

      // ---- 2. 体检 ----
      this.emitProgress('inspect', 1, 5, '分析 3MF 结构…');
      const info = await mesh3mf.inspect3mf(srcPath);
      const allParts = info.parts;
      const skipped = allParts.filter((p) => p.isAngular && !o.includeAngular);
      const targets = allParts.filter((p) => !p.isAngular || o.includeAngular);
      if (!targets.length) throw new Error('所有部件都被判定为棱角件，没有可安全优化的网格');
      this.emitLog('共 ' + allParts.length + ' 个部件 / ' + info.totals.faces.toLocaleString() +
        ' 面，处理 ' + targets.length + ' 个，跳过 ' + skipped.length + ' 个');

      // ---- 3. 导出 PLY ----
      this.emitProgress('export', 2, 5, '导出网格…');
      const exported = await mesh3mf.exportParts(srcPath, targets, inDir, (p) => {
        this.emitLog(p.message);
      });
      if (this.cancelled) throw new Error('已取消');

      // ---- 4. 跑 Blender ----
      this.emitProgress('blender', 3, 5, 'Blender 处理中…');
      const script = blenderScript();
      if (!fs.existsSync(script)) throw new Error('缺少 Blender 脚本：' + script);
      const args = [
        '--background', '--factory-startup', '--python', script, '--',
        'inputDir=' + inDir,
        'outputDir=' + outDir,
        'preset=' + enginePreset,
        'parts=' + exported.files.length,
        'report=' + reportPath,
      ];
      if (deep) args.push('voxel=' + voxelMm);
      await this.runBlender(blender.path, args, exported.files.length);
      if (this.cancelled) throw new Error('已取消');
      if (!fs.existsSync(reportPath)) throw new Error('Blender 没有生成处理报告');

      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (!report.ok) throw new Error('Blender 报告处理失败');
      for (const p of report.parts || []) {
        const src = exported.files.find((f) => f.ply === p.file);
        if (src && !deep && (p.outV !== p.inV || p.outF !== p.inF)) {
          throw new Error('Blender 改变了网格拓扑（' + p.file + '），已中止以保证拆件结构安全');
        }
      }

      // ---- 5. 无损写回 ----
      this.emitProgress('writeback', 4, 5, '写回 3MF…');
      const written = await mesh3mf.buildOptimized3mf({
        srcPath, outPath, parts: targets, plyDir: outDir,
        mode: deep ? 'rebuild' : 'coords', clampMm,
      });
      produced = outPath;
      if (this.cancelled) { safeCleanFile(produced); throw new Error('已取消'); }

      // ---- 6. 复测输出，生成前后对比 ----
      this.emitProgress('verify', 5, 5, '校验输出…');
      const afterInfo = await mesh3mf.inspect3mf(outPath);
      const keyOf = (p) => p.entry + '#' + p.meshIndex;
      const beforeParts = allParts.filter((p) => targets.some((t) => keyOf(t) === keyOf(p)));
      const afterParts = afterInfo.parts.filter((p) => targets.some((t) => keyOf(t) === keyOf(p)));
      const before = weightedTotals(beforeParts);
      const after = weightedTotals(afterParts);

      const tips = (info.sliceConfigHint || []).map((h) => h.key + '：当前 ' + h.current + ' — ' + h.advice);
      tips.push('几何已改动，请在切片软件里重新切片（原工程里的切片结果已失效）。');
      tips.push('原文件未做任何修改，输出是新 3MF；不满意直接删除输出即可。');
      if (deep) tips.push('深度档重建了网格，顶点数会变化，切片软件里的面数统计需要重新计算。');
      const extraWarns = [];
      if (written.paintDropped > 0) {
        extraWarns.push('这个模型有 ' + written.paintDropped + ' 个三角面带涂色标注，深度档重建了拓扑，'
          + '颜色对应关系无法保留（不是丢了文件，是需要重新上色）。要保留涂色请用「温和/标准/较强」档。');
      }

      const result = {
        ok: true,
        outPath,
        bytes: written.bytes,
        verified: written.verified,
        unchangedEntries: written.unchangedEntries,
        clampStats: written.clampStats,
        preset, enginePreset, clampMm, voxelMm: deep ? voxelMm : null,
        before, after,
        skipped: skipped.map((p) => ({ name: p.name, reason: '棱角/结构件（夹角 p90 ' + p.angleP90 + '°），保护拼装面' })),
        tips,
        warnings: (info.warnings || []).concat(extraWarns),
        addedToLibrary: false,
      };
      this.emit('done', { result });
      return result;
    } catch (err) {
      if (produced && this.cancelled) safeCleanFile(produced);
      const message = (err && err.message) || String(err);
      // EventEmitter 的 'error' 事件在没有监听者时会直接抛异常，掩盖原始错误
      if (this.listenerCount('error') > 0) {
        this.emit('error', { message: this.cancelled ? '优化已取消' : message });
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  /** spawn Blender，逐行解析 PROGRESS / ERROR，带硬超时 */
  runBlender(exe, args, totalParts) {
    return new Promise((resolve, reject) => {
      let done = false;
      let buf = '';
      let tail = [];
      const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const finish = (err) => {
        if (done) return;
        done = true;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (err) reject(err); else resolve();
      };
      this.timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) { /* 已退出 */ }
        finish(new Error('Blender 处理超时（超过 3 分钟），已中止'));
      }, BLENDER_TIMEOUT);

      const onLine = (line) => {
        const s = line.trim();
        if (!s) return;
        tail.push(s);
        if (tail.length > 30) tail.shift();
        if (s.startsWith('PROGRESS ')) {
          const m = s.match(/^PROGRESS\s+(\d+)\/(\d+)\s+(.*)$/);
          if (m) {
            this.emitProgress('blender', Number(m[1]), Number(m[2]),
              'Blender 处理网格 ' + Number(m[1]) + '/' + totalParts + ' · ' + m[3]);
            this.emitLog(s);
          }
        } else if (s.startsWith('ERROR ')) {
          finish(new Error(s.slice(6).trim() || 'Blender 处理失败'));
        } else if (s.startsWith('DONE ')) {
          this.emitLog(s);
        } else if (/^(Info|Warning|Error):/.test(s)) {
          // Blender 自己的日志，只保留少量
          if (/Error/i.test(s)) this.emitLog(s);
        }
      };
      const feed = (data) => {
        buf += data.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
      };
      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', (e) => finish(new Error('无法启动 Blender：' + e.message)));
      child.on('close', (code) => {
        if (buf.trim()) onLine(buf);
        if (done) return;
        if (this.cancelled) return finish(new Error('已取消'));
        if (code !== 0) return finish(new Error('Blender 退出码 ' + code + '：' + tail.slice(-3).join(' | ')));
        resolveSafely();
      });
      const resolveSafely = () => {
        // close 时报告可能刚落盘，稍等一个 tick
        setTimeout(() => finish(), 30);
      };
    });
  }
}

function safeCleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* 忽略 */ }
}

module.exports = { MeshOptimizer, detectBlender: (custom) => new MeshOptimizer().detectBlender(custom), OVERALL_TIMEOUT };
