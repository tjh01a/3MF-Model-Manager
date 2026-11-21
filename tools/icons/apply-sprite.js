'use strict';
/**
 * 把 tools/icons/sprite-lucide.html 安装进 index.html，并生成运行时回退数据。
 *
 * 幂等：可反复执行。首次执行会把 index.html 里原有的（自绘）sprite 备份成
 * sprite-legacy.html，作为 ui.iconSet='legacy' 的数据源；之后不再覆盖备份。
 *
 * 为什么两套 sprite 不用两套 id：
 *   全项目有 46 处静态 <use href="#i-xxx">，还有 icon('xxx') 动态生成，
 *   若 legacy 用另一组 id，就得遍历改写所有引用，还要常驻 MutationObserver。
 *   这里改为「同一组 id、只换 symbol 内容」，静态与动态引用都不用动，
 *   切换是一次 DOM 操作，也不需要全局观察器。
 *
 * 用法：node tools/icons/apply-sprite.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'src', 'renderer', 'index.html');
const LUCIDE = path.join(__dirname, 'sprite-lucide.html');
const LEGACY = path.join(__dirname, 'sprite-legacy.html');
const OUT = path.join(ROOT, 'src', 'renderer', 'js', 'components', 'icon-set.js');

const RE_SPRITE = /(<svg id="icon-sprite"[^>]*>)([\s\S]*?)(<\/svg>)/;
const RE_SYMBOL = /<symbol\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;

function fail(msg) {
  console.error('[apply-sprite] ' + msg);
  process.exitCode = 1;
  throw new Error(msg);
}

function readSymbols(file, label) {
  if (!fs.existsSync(file)) fail('缺少 ' + label + '：' + file);
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const seen = new Set();
  let m;
  RE_SYMBOL.lastIndex = 0;
  while ((m = RE_SYMBOL.exec(text))) {
    const id = m[1];
    const body = m[2].trim();
    if (seen.has(id)) fail(label + ' 里有重复 id：' + id);
    if (!body) fail(label + ' 里有空 symbol：' + id);
    seen.add(id);
    out.push([id, body]);
  }
  if (!out.length) fail(label + ' 里没有解析到任何 <symbol>');
  return out;
}

function toObject(pairs) {
  const lines = pairs.map(([id, body]) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(body) + ',');
  return '{\n' + lines.join('\n') + '\n}';
}

function main() {
  const lucidePairs = readSymbols(LUCIDE, 'sprite-lucide.html');
  const lucideIds = new Set(lucidePairs.map((p) => p[0]));
  const html = fs.readFileSync(INDEX, 'utf8');
  const match = html.match(RE_SPRITE);
  if (!match) fail('index.html 里找不到 <svg id="icon-sprite"> 区块');

  // 1. 首次运行：把改造前的 sprite 备份成 legacy 数据
  let legacyPairs;
  if (!fs.existsSync(LEGACY)) {
    const oldBody = match[2];
    const tmp = [];
    let m;
    const re = /<symbol\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
    while ((m = re.exec(oldBody))) tmp.push([m[1], m[2].trim()]);
    if (tmp.length < 50) fail('原 sprite 解析到的 symbol 太少，拒绝覆盖备份');
    // 旧 sprite 缺 i-wrench / i-gear（设置页两个按钮当时是空白图标）。
    // legacy 档也补上这两个，保证回退后界面不出现空白按钮。
    const have = new Set(tmp.map((p) => p[0]));
    for (const [id, body] of lucidePairs) {
      if ((id === 'i-wrench' || id === 'i-gear') && !have.has(id)) tmp.push([id, body]);
    }
    const header = [
      '<!-- PrintShelf legacy icon sprite — 改造前的自绘路径，由 tools/icons/apply-sprite.js 备份。 -->',
      '<!-- 仅补入原本缺失的 i-wrench / i-gear，其余 54 个保持原样。 -->',
      '<!-- 这是回退数据源，请勿手工编辑。 -->',
    ].join('\n');
    const body = tmp.map(([id, b]) => '<symbol id="' + id + '" viewBox="0 0 24 24">' + b + '</symbol>').join('\n');
    fs.writeFileSync(LEGACY, header + '\n' + body + '\n', 'utf8');
    console.log('[apply-sprite] 已备份改造前 sprite：' + tmp.length + ' 个 symbol');
    legacyPairs = tmp;
  } else {
    legacyPairs = readSymbols(LEGACY, 'sprite-legacy.html');
  }

  // 2. 校验两套数据 id 一致（不要求路径相同）
  const legacyIds = new Set(legacyPairs.map((p) => p[0]));
  const extra = [...legacyIds].filter((id) => !lucideIds.has(id));
  if (extra.length) fail('legacy 多出这些 id（lucide 里没有）：' + extra.join(', '));
  // 新增图标（lucide 有、legacy 备份里没有）用 Lucide 路径补齐。
  // legacy 档下这些新图标就是 Lucide 样式，属于可接受降级，总比渲染成空白强。
  const missing = [...lucideIds].filter((id) => !legacyIds.has(id));
  if (missing.length) {
    console.log('[apply-sprite] legacy 缺少 ' + missing.length + ' 个新图标，用 Lucide 路径补齐：' + missing.join(', '));
    const byId = new Map(legacyPairs);
    for (const [id, body] of lucidePairs) if (!byId.has(id)) byId.set(id, body);
    legacyPairs = Array.from(byId.entries());
  }

  // 3. 替换 index.html 的 sprite 区块（只换子节点，根 svg 的属性原样保留）
  const symbolLines = lucidePairs
    .map(([id, body]) => '<symbol id="' + id + '" viewBox="0 0 24 24">' + body + '</symbol>')
    .join('\n  ');
  const comment = '  <!-- 自动生成：tools/icons/build-sprite.js + apply-sprite.js；Lucide v1.73.0 / ISC。\n' +
    '       许可原文见 docs/licenses/LUCIDE-LICENSE.txt；勿手工编辑，改图标请重跑生成器。 -->\n  ';
  const next = html.replace(RE_SPRITE, (all, open, body, close) => open + '\n' + comment + symbolLines + '\n' + close);
  if (next === html) console.log('[apply-sprite] index.html 已是最新，跳过写入（幂等）');
  else fs.writeFileSync(INDEX, next, 'utf8');

  // 4. 生成运行时模块
  const src = [
    "'use strict';",
    '/**',
    ' * 图标集回退数据 —— 由 tools/icons/apply-sprite.js 生成，请勿手工编辑。',
    ' *',
    ' * index.html 里内联的是 Lucide（ISC, v1.73.0）路径，ui.iconSet 默认 lucide，',
    ' * 因此默认启动时一次 DOM 操作都不做。只有用户切到 legacy 才调用 applyIconSet()，',
    ' * 把 #icon-sprite 的 symbol 内容整体换回改造前的自绘路径。',
    ' *',
    ' * 两套数据共用同一组 id：静态 <use href="#i-*"> 与 icon() 生成的内容都不需要改写，',
    ' * 也不需要常驻 MutationObserver。切换是一次 replaceChildren。',
    ' */',
    '',
    'const LUCIDE_PATHS = ' + toObject(lucidePairs) + ';',
    '',
    'const LEGACY_PATHS = ' + toObject(legacyPairs) + ';',
    '',
    "// index.html 内联的就是 lucide，所以默认值下 applyIconSet('lucide') 是零 DOM 操作。",
    "let currentSet = 'lucide';",
    '',
    'function parseSymbols(html) {',
    '  const doc = new DOMParser().parseFromString(',
    '    \'<svg xmlns="http://www.w3.org/2000/svg">\' + html + \'</svg>\',',
    "    'image/svg+xml');",
    '  if (doc.querySelector(\'parsererror\')) return null;',
    '  return Array.from(doc.documentElement.children)',
    '    .map((n) => document.importNode(n, true));',
    '}',
    '',
    '/** 切换图标集。set 只允许 \'lucide\' | \'legacy\'，其它值一律按 lucide 处理。 */',
    'export function applyIconSet(set) {',
    "  const target = set === 'legacy' ? 'legacy' : 'lucide';",
    '  const table = target === \'legacy\' ? LEGACY_PATHS : LUCIDE_PATHS;',
    "  const sprite = document.getElementById('icon-sprite');",
    '  const root = document.documentElement;',
    '  if (root.dataset.iconset !== target) root.dataset.iconset = target;',
    '  if (!sprite || currentSet === target) return root.dataset.iconset;',
    '  const html = Object.keys(table).map((id) =>',
    '    \'<symbol id="\' + id + \'" viewBox="0 0 24 24">\' + table[id] + \'</symbol>\').join(\'\');',
    '  const nodes = parseSymbols(html);',
    '  if (!nodes || nodes.length !== Object.keys(table).length) {',
    "    console.warn('[icon-set] sprite 解析失败，保持原有图标');",
    '    return root.dataset.iconset;',
    '  }',
    '  sprite.replaceChildren(...nodes);',
    '  currentSet = target;',
    '  return root.dataset.iconset;',
    '}',
    '',
    'export function currentIconSet() { return currentSet || \'lucide\'; }',
    'export function iconSetIds() { return Object.keys(LUCIDE_PATHS); }',
    'export function iconSetBodies(set) {',
    "  return set === 'legacy' ? LEGACY_PATHS : LUCIDE_PATHS;",
    '}',
    '',
    '// 只读诊断接口：probe-icons.js / probe-motion.js 用来验证两套路径都能装载。',
    '// 正式业务只走 applyIconSet()，不依赖这个全局对象。',
    "if (typeof window !== 'undefined') {",
    '  window.__printshelfIcons = {',
    '    get set() { return currentSet; },',
    '    apply: applyIconSet,',
    '    ids: iconSetIds,',
    '    bodies: iconSetBodies,',
    '  };',
    '}',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, src, 'utf8');
  console.log('[apply-sprite] index.html sprite 校验通过：' + lucidePairs.length + ' 个 symbol');
  console.log('[apply-sprite] 已生成 ' + path.relative(ROOT, OUT) + '（' + src.length + ' 字节）');
}

try { main(); } catch (e) { if (!process.exitCode) process.exitCode = 1; }
