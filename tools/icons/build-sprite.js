#!/usr/bin/env node
'use strict';
/**
 * build-sprite.js — 从 lucide-static 官方 tarball 生成 PrintShelf 的 icon sprite 片段。
 *
 * 纯 Node CJS，仅依赖内置模块（fs / path / os / child_process）。
 * 用法：node tools/icons/build-sprite.js
 *
 * 产物（均写在本脚本同目录）：
 *   - map.json             项目 id -> 实际采用的 lucide 文件名
 *   - sprite-lucide.html   纯片段，每行一个 <symbol>
 *
 * 注意：本脚本只做资源构建，不会改动 src/ 下的任何运行时文件。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync } = require('child_process');

const VERSION = '1.73.0';
const OUT_DIR = __dirname;
const MAP_FILE = path.join(OUT_DIR, 'map.json');
const SPRITE_FILE = path.join(OUT_DIR, 'sprite-lucide.html');

/**
 * 语义映射表：键 = 项目 symbol id（保持不变），值 = lucide 图标文件名（不含 .svg）。
 *
 * 关于替换（逐一校验过 tarball 内 package/icons/*.svg 后确定）：
 *   - i-dice 原拟用 `dice`，但 lucide-static 1.73.0 中不存在同名图标；
 *     官方仅有 dice-1..6 与 dices，取语义最接近的通用骰子图标 `dices`。
 *   其余 55 个名字在包内均存在，未作改动。
 *
 * i-box / i-cube 分别取 package / box（用于拓竹 / 快造，路径不同）；
 * i-close / i-x 均为 x（用于弹窗 / 窗口按钮，作为两个独立 symbol 保留）。
 */
const MAP = {
  'i-grid': 'layout-grid',
  'i-list': 'list',
  'i-search': 'search',
  'i-plus': 'plus',
  'i-refresh': 'refresh-cw',
  'i-dice': 'dices', // 原 `dice` 不存在 -> 官方替代 `dices`
  'i-moon': 'moon',
  'i-sun': 'sun',
  'i-settings': 'settings',
  'i-star': 'star',
  'i-clock': 'clock',
  'i-circle': 'circle',
  'i-folder': 'folder',
  'i-folder-open': 'folder-open',
  'i-tag': 'tag',
  'i-sparkle': 'sparkles',
  'i-check': 'check',
  'i-check-circle': 'circle-check',
  'i-copy': 'copy',
  'i-alert': 'triangle-alert',
  'i-box': 'package',
  'i-cube': 'box',
  'i-sliders': 'sliders-horizontal',
  'i-tool': 'hammer',
  'i-close': 'x',
  'i-chevron-left': 'chevron-left',
  'i-chevron-right': 'chevron-right',
  'i-chevron-down': 'chevron-down',
  'i-more': 'ellipsis',
  'i-trash': 'trash-2',
  'i-edit': 'pencil',
  'i-external': 'external-link',
  'i-printer': 'printer',
  'i-filter': 'filter',
  'i-sort': 'arrow-up-down',
  'i-image': 'image',
  'i-download': 'download',
  'i-upload': 'upload',
  'i-undo': 'undo-2',
  'i-link': 'link',
  'i-info': 'info',
  'i-hard-drive': 'hard-drive',
  'i-save': 'save',
  'i-eye': 'eye',
  'i-layers': 'layers',
  'i-shuffle': 'shuffle',
  'i-play': 'play',
  'i-pause': 'pause',
  'i-minus': 'minus',
  'i-square': 'square',
  'i-x': 'x',
  'i-heart': 'heart',
  'i-warning': 'circle-alert',
  'i-cloud': 'cloud',
  'i-wrench': 'wrench',
  'i-gear': 'cog',
  'i-globe': 'globe',
};

/** 定位 tarball；找不到时在系统临时目录执行 npm pack。 */
function resolveTarball() {
  const tmp = os.tmpdir();
  const candidates = [];
  if (process.env.LUCIDE_TGZ) candidates.push(process.env.LUCIDE_TGZ);
  candidates.push(path.join(tmp, 'ps-lucide', `lucide-static-${VERSION}.tgz`));
  candidates.push(path.join(tmp, `lucide-static-${VERSION}.tgz`));
  candidates.push(path.join(OUT_DIR, `lucide-static-${VERSION}.tgz`));

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  // 兜底：在系统临时目录打包（execSync 走 shell，Windows 下可正确解析 npm.cmd）
  let out;
  try {
    out = execSync(`npm pack lucide-static@${VERSION} --silent`, {
      cwd: tmp,
      encoding: 'utf8',
    }).trim().split(/\r?\n/).pop().trim();
  } catch (e) {
    throw new Error(`找不到 tarball，且 npm pack 失败：${(e.stderr || e.message).toString().trim()}`);
  }
  const packed = path.join(tmp, out);
  if (!fs.existsSync(packed)) {
    throw new Error(`npm pack 产物不存在：${packed}`);
  }
  return packed;
}

/**
 * 从 tarball 读取单个图标 SVG。
 * 用 `tar -xzOf <tgz> package/icons/<name>.svg`，并把 cwd 设为 tgz 所在目录、
 * -f 参数用相对文件名，避免 Windows 下 `C:\...` 的冒号被 tar 当作远端主机。
 */
function readIcon(tgz, name) {
  const dir = path.dirname(tgz);
  const base = path.basename(tgz);
  const member = `package/icons/${name}.svg`;
  return execFileSync('tar', ['-xzOf', base, member], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * 把 Lucide SVG 的内部子元素折成一行，且完整保留子元素及其属性原样。
 * - 引号内的内容（如 d="..."、fill="currentColor"）逐字符保留，不做任何改动；
 * - 仅把「含换行」的空白折叠成单个空格，去掉行首缩进；
 * - 根 <svg ...> / </svg> 及其之前的 license 注释一并剥掉。
 */
function toOneLine(inner) {
  let out = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === '\n' || c === '\r') {
      while (i + 1 < inner.length && /\s/.test(inner[i + 1])) i++;
      out = out.replace(/\s+$/, '');
      if (out.length) out += ' ';
      continue;
    }
    out += c;
  }
  return out.trim();
}

/** 剥掉根 svg，返回 symbol 的内部内容（单行）。 */
function toSymbolInner(svgText, id, name) {
  const open = svgText.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error(`package/icons/${name}.svg：找不到 <svg> 根标签`);
  const start = open.index + open[0].length;
  const close = svgText.indexOf('</svg>', start);
  if (close < 0) throw new Error(`package/icons/${name}.svg：找不到 </svg>`);
  const inner = toOneLine(svgText.slice(start, close));
  if (!inner) throw new Error(`package/icons/${name}.svg：内部子元素为空`);
  return inner;
}

function main() {
  const tgz = resolveTarball();
  const ids = Object.keys(MAP);
  const symbols = [];
  const errors = [];

  for (const id of ids) {
    const name = MAP[id];
    let inner;
    try {
      inner = toSymbolInner(readIcon(tgz, name), id, name);
    } catch (e) {
      const msg = (e.stderr || e.message || String(e)).toString().trim().split(/\r?\n/)[0];
      errors.push(`${id} -> ${name}：${msg}`);
      continue;
    }
    symbols.push(`<symbol id="${id}" viewBox="0 0 24 24">${inner}</symbol>`);
  }

  // 缺失 / 读取失败：报错并以非零码退出，绝不静默产出空 symbol
  if (errors.length) {
    console.error(`[build-sprite] 有 ${errors.length} 个图标无法生成，未写出任何产物：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const header = [
    '<!-- PrintShelf icon sprite (Lucide) — generated by tools/icons/build-sprite.js; do not edit by hand. -->',
    `<!-- Source: lucide-static v${VERSION} — https://github.com/lucide-icons/lucide — ISC License. -->`,
    '<!-- Path data only. Full license: docs/licenses/LUCIDE-LICENSE.txt and docs/licenses/NOTICE.md. -->',
    `<!-- ${symbols.length} symbols; generated ${dateStr}. -->`,
  ].join('\n');

  const sprite = header + '\n' + symbols.join('\n') + '\n';
  fs.writeFileSync(SPRITE_FILE, sprite, 'utf8');
  fs.writeFileSync(MAP_FILE, JSON.stringify(MAP, null, 2) + '\n', 'utf8');

  console.log(`[build-sprite] tarball: ${tgz}`);
  console.log(`[build-sprite] map.json: ${ids.length} 条映射 -> ${MAP_FILE}`);
  console.log(`[build-sprite] sprite: ${symbols.length} 个 symbol -> ${SPRITE_FILE} (${Buffer.byteLength(sprite, 'utf8')} bytes)`);
  console.log('[build-sprite] 替换记录: i-dice 的 `dice` 在包内不存在，实际采用 `dices`。');
}

main();
