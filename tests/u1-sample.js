'use strict';
/**
 * 真实转换样本的解析（测试用）：
 *   1. PRINTSHELF_U1_SAMPLE 环境变量
 *   2. 旧硬编码路径（还在就优先用，保持历史行为）
 *   3. 从 data/library.json 里挑一个可读的多色 3MF（体积适中）
 *
 * 为什么要动态找：原先写死一个 Downloads 下的文件，用户一删，真实端到端用例
 * 就永远「跳过」——而这条恰恰是「普通 3MF → 快造 U1」最关键的验证。
 */
const fs = require('fs');
const path = require('path');

const LEGACY = 'C:/Users/10104/Downloads/三角洲×影之刃-黑伤AMS-多色版 (1).3mf';
const MAX_BYTES = 90 * 1024 * 1024;

function usable(p) {
  try {
    if (!p || !/\.3mf$/i.test(p)) return false;
    const st = fs.statSync(p);
    return st.isFile() && st.size > 1024 * 1024 && st.size < MAX_BYTES;
  } catch (_) {
    return false;
  }
}

function fromLibrary() {
  try {
    // 注意：不能直接用 corePaths.getLibraryPath()——u1-tests 前面的用例会
    // corePaths.setDataDir(临时目录)，之后这里就查不到真实库了。
    const envDir = process.env.PRINTSHELF_DATA_DIR;
    const libPath = envDir
      ? path.join(envDir, 'library.json')
      : path.join(__dirname, '..', 'data', 'library.json');
    if (!fs.existsSync(libPath)) return null;
    const lib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
    const models = Object.values(lib.models || {});
    const cands = models.filter((m) => m && usable(m.path));
    if (!cands.length) return null;
    // 优先多色工程：能顺带验证颜色/多槽位保留
    const multi = cands.filter((m) => (m.meta && m.meta.hasMultiColor));
    const pool = multi.length ? multi : cands;
    // 体积从小到大，测试跑得快
    pool.sort((a, b) => (a.size || 0) - (b.size || 0));
    return pool[0].path;
  } catch (_) {
    return null;
  }
}

function resolveRealSample() {
  const env = process.env.PRINTSHELF_U1_SAMPLE;
  if (usable(env)) return env;
  if (usable(LEGACY)) return LEGACY;
  return fromLibrary();
}

module.exports = { resolveRealSample, verifyOutput: require('../tools/u1/verify-lib').verifyOutput };
