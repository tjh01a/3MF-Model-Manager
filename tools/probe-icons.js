'use strict';
/**
 * probe-icons.js — PrintShelf 图标 sprite 静态检查脚本。
 *
 * 纯 Node CJS，仅做文件读取，不启动 Electron、不依赖任何第三方包。
 * 用法：node tools/probe-icons.js
 *
 * 断言：
 *   1) src/renderer/index.html 的 #icon-sprite 里 symbol id 数量 >= 57，且包含全部 57 个 id；
 *   2) src/ 下 .js/.html 中出现的 i-* 名字（icon('...') / icon: '...' / href="#i-..." /
 *      data-bind / 'i-...' / #i-...），去掉 i- 前缀后都能在 sprite id 集合里找到；
 *   3) 无重复 symbol id；
 *   4) 每个 symbol 内容非空、viewBox 均为 "0 0 24 24"。
 *
 * 结果以 JSON 输出到 stdout，并设置 process.exitCode = ok ? 0 : 1。
 * index.html 尚未替换 sprite 时本脚本预期 ok=false（missing/orphans 非空），属正常。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'src', 'renderer', 'index.html');
const SRC = path.join(ROOT, 'src');

/** 需要存在的 57 个 symbol id（与 tools/icons/map.json 的键一致）。 */
const REQUIRED_IDS = [
  'i-grid', 'i-list', 'i-search',
  'i-plus', 'i-refresh', 'i-dice',
  'i-moon', 'i-sun', 'i-settings',
  'i-star', 'i-clock', 'i-circle',
  'i-folder', 'i-folder-open', 'i-tag',
  'i-sparkle', 'i-check', 'i-check-circle',
  'i-copy', 'i-alert', 'i-box',
  'i-cube', 'i-sliders', 'i-tool',
  'i-close', 'i-chevron-left', 'i-chevron-right',
  'i-chevron-down', 'i-more', 'i-trash',
  'i-edit', 'i-external', 'i-printer',
  'i-filter', 'i-sort', 'i-image',
  'i-download', 'i-upload', 'i-undo',
  'i-link', 'i-info', 'i-hard-drive',
  'i-save', 'i-eye', 'i-layers',
  'i-shuffle', 'i-play', 'i-pause',
  'i-minus', 'i-square', 'i-x',
  'i-heart', 'i-warning', 'i-cloud',
  'i-wrench', 'i-gear', 'i-globe',
];

/** 解析 #icon-sprite 内的所有 <symbol>。 */
function parseSprite(html) {
  const empty = { symbolCount: 0, ids: [], duplicates: [], badViewBox: [], emptySymbols: [] };
  // 找到带 id="icon-sprite" 的 <svg ...> 开标签，并取到其后第一个 </svg>
  const svgRe = /<svg\b[^>]*?\bid\s*=\s*(["'])icon-sprite\1[^>]*>([\s\S]*?)<\/svg>/i;
  const m = html.match(svgRe);
  if (!m) return empty;
  const body = m[2];

  const ids = [];
  const counts = new Map();
  const badViewBox = [];
  const emptySymbols = [];

  const symRe = /<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g;
  let s;
  while ((s = symRe.exec(body))) {
    const attrs = s[1];
    const inner = s[2];
    const idMatch = attrs.match(/\bid\s*=\s*(["'])([^"']*)\1/i);
    const id = idMatch ? idMatch[2] : '(no-id)';
    ids.push(id);
    counts.set(id, (counts.get(id) || 0) + 1);

    const vbMatch = attrs.match(/\bviewBox\s*=\s*(["'])([^"']*)\1/i);
    const viewBox = vbMatch ? vbMatch[2].trim() : '';
    if (viewBox !== '0 0 24 24') badViewBox.push({ id, viewBox });

    // 剥掉 symbol 内部注释后，若只剩空白则视为空
    if (inner.replace(/<!--[\s\S]*?-->/g, '').trim() === '') emptySymbols.push(id);
  }

  const duplicates = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();

  return { symbolCount: ids.length, ids, duplicates, badViewBox, emptySymbols };
}

/** 剥离 HTML 注释（DOM CONTRACT 示例、#i-xxx 占位等都不应计入引用）。 */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 剥离 JS 注释（// 与 /* ... *\/），同时完整保留字符串字面量，
 * 避免把 URL / 模板字符串里的 // 误当注释而破坏带引号的 i-* 引用。
 */
function stripJsComments(src) {
  let out = '';
  let i = 0;
  let quote = null; // 当前字符串引号：' " `
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      if (c === '\\') { // 转义字符连同下一字符原样保留
        out += c;
        if (i + 1 < n) out += src[i + 1];
        i += 2;
        continue;
      }
      out += c;
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      i += 2;
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 递归收集 src/ 下的 .js / .html 文件。 */
function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && /\.(js|html)$/i.test(ent.name)) out.push(p);
  }
}

/**
 * 收集源码里出现的 i-* 引用名。
 * 只匹配：引号内以 i- 开头的「完整标识符」，或 #i- 前缀。
 * 因此 data-i-... 之类的属性名、'ico' 之类的类名都不会被误报。
 */
function collectRefs() {
  const files = [];
  walk(SRC, files);
  const refs = new Set();
  const quotedRe = /(['"])(i-[A-Za-z][A-Za-z0-9-]*)\1/g;
  const hashRe = /#(i-[A-Za-z][A-Za-z0-9-]*)/g;

  for (const f of files) {
    let text = fs.readFileSync(f, 'utf8');
    text = /\.html$/i.test(f) ? stripHtmlComments(text) : stripJsComments(text);
    let m;
    while ((m = quotedRe.exec(text))) refs.add(m[2]);
    while ((m = hashRe.exec(text))) refs.add(m[1]);
  }
  return refs;
}

function main() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const sprite = parseSprite(html);
  const spriteIds = new Set(sprite.ids);

  const missing = REQUIRED_IDS.filter((id) => !spriteIds.has(id)).sort();

  // 引用名去掉 i- 前缀后，在同去掉前缀的 sprite id 集合里查找
  const spriteBare = new Set(sprite.ids.map((id) => id.replace(/^i-/, '')));
  const orphans = [...collectRefs()]
    .filter((name) => !spriteBare.has(name.replace(/^i-/, '')))
    .sort();

  const ok =
    sprite.symbolCount >= REQUIRED_IDS.length &&
    missing.length === 0 &&
    orphans.length === 0 &&
    sprite.duplicates.length === 0 &&
    sprite.badViewBox.length === 0 &&
    sprite.emptySymbols.length === 0;

  const result = {
    ok,
    symbolCount: sprite.symbolCount,
    missing,
    orphans,
    duplicates: sprite.duplicates,
    badViewBox: sprite.badViewBox,
    emptySymbols: sprite.emptySymbols,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = ok ? 0 : 1;
}

main();
