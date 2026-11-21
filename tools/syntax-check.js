/**
 * 全量语法哨兵：主进程/核心层按 CommonJS 检查，渲染层与 tools 里的 ESM 按 module 检查。
 * 这次审查里我改坏过一个文件（presetguard 变量重名），所以把它做成可复跑的一步。
 *   node tools/syntax-check.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src/core', 'electron', 'src/renderer/js', 'tests', 'tools'];

/** 渲染层是原生 ESM（index.html 里 type="module"），其余是 CommonJS */
function isEsm(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('src/renderer/js/')) return true;
  // 构建期脚本是独立的 Node CJS（用 require/module.exports），按 CJS 检查更准；
  // 其余 tools/*.js 里既有 ESM 工具，也有被注入页面的探针片段。
  // probe-icons.js 是独立 Node CJS 脚本（其余 probe-* 是注入页面的代码片段）
  if (rel === 'tools/probe-icons.js' || rel === 'tools/check-ipc-contract.js' ||
      rel.startsWith('tools/icons/') || rel.startsWith('tools/u1/')) return false;
  if (rel.startsWith('tools/')) return true;
  return false;
}

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(path.relative(ROOT, full), out);
    } else if (/\.(js|cjs|mjs)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(d));
let bad = 0;

for (const f of files) {
  const esm = isEsm(f);
  try {
    if (esm) {
      // 探针脚本（tools/probe-*.js）不是独立模块：main.js 会把它们包进
      // `(async () => { ... })()` 再执行，里面的顶层 return 只有在这个上下文里合法。
      // 所以先按同样方式包一层再检查，否则会误报。
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      // shebang 只能在文件第 1 行；包一层之后它会落到第 2 行变成语法错误，先剥掉。
      const raw = fs.readFileSync(f, 'utf8').replace(/^#![^\n]*\r?\n/, '');
      const code = /^tools[/]probe-/.test(rel) ? '(async () => {\n' + raw + '\n})()\n' : raw;
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
    } else {
      execFileSync(process.execPath, ['--check', f], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
  } catch (e) {
    bad++;
    const msg = String(e.stderr || e.message).split('\n').slice(0, 4).join('\n');
    console.log('✗ ' + path.relative(ROOT, f) + (esm ? '  (ESM)' : '  (CJS)'));
    console.log('  ' + msg.replace(/\n/g, '\n  '));
  }
}

console.log('\n检查 ' + files.length + ' 个文件，语法错误 ' + bad + ' 个');
if (bad > 0) process.exitCode = 1;
