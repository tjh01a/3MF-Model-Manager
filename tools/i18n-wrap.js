'use strict';
/**
 * 把渲染层 JS 里独立的中文字符串字面量包成 t('原文')，作为 i18n 的迁移工具。
 * 用途：新增功能时先写中文，跑本工具补齐 t() 包装，再补英文词典。
 *
 * 用法：node tools/i18n-wrap.js            # 只统计（dry run）
 *       node tools/i18n-wrap.js --write    # 写回文件
 *
 * 刻意跳过：case 标签、对象 key、比较运算、注释、模板字符串。
 * 模板字符串/拼接里的动态文案仍需人工改成 t('前缀 {x}', {x})。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer', 'js');
const WRITE = process.argv.includes('--write');
const EXTRA = process.argv.includes('--extra');
const SKIP_FILES = new Set(['i18n.js', 'api.js', 'state.js']);
const CJK = /[\u3400-\u9fff]/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function beforeIsKey(src, start) {
  // 对象 key：'中文': value，或比较：=== '中文' / !== '中文'
  let i = start - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  const tail = src.slice(Math.max(0, i - 4), i + 1);
  if (/case\s*$/.test(tail)) return true;
  if (/[=!]==?\s*$/.test(src.slice(0, i + 1))) return true;
  if (/tr\s*\(\s*$/.test(src.slice(0, i + 1)) || /t\s*\(\s*$/.test(src.slice(0, i + 1))) return true;
  let j = start + 1;                        // 跳过引号
  while (j < src.length && src[j] !== '"' && src[j] !== "'") j++;
  j++;
  while (j < src.length && /\s/.test(src[j])) j++;
  // 三元表达式的 true 分支也以冒号收尾，不能当成对象 key 跳过。
  return !EXTRA && src[j] === ':';
}

function regexStart(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if (/[=(:,\[!&|?{;]/.test(c)) return true;
  return /\breturn\s*$/.test(src.slice(Math.max(0, j - 8), j + 1));
}

function wrap(src) {
  let out = '';
  let count = 0;
  let i = 0;
  let mode = 'code';
  while (i < src.length) {
    const c = src[i];
    if (mode === 'code') {
      if (c === '/' && src[i + 1] === '/') { mode = 'line'; out += c; i++; continue; }
      if (c === '/' && src[i + 1] === '*') { mode = 'block'; out += c; i++; continue; }
      if (c === '/' && regexStart(src, i)) { mode = 'regex'; out += c; i++; continue; }
      if (c === '`') { mode = 'template'; out += c; i++; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        let esc = false;
        while (j < src.length) {
          if (esc) { esc = false; j++; continue; }
          if (src[j] === '\\') { esc = true; j++; continue; }
          if (src[j] === c) break;
          j++;
        }
        const raw = src.slice(i, j + 1);
        if (CJK.test(raw) && !beforeIsKey(src, i)) {
          out += 'tr(' + raw + ')';
          count++;
        } else out += raw;
        i = j + 1;
        continue;
      }
      out += c; i++; continue;
    }
    if (mode === 'line') {
      out += c; i++;
      if (c === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      out += c; i++;
      if (c === '*' && src[i] === '/') { out += '/'; i++; mode = 'code'; }
      continue;
    }
    if (mode === 'regex') {
      out += c; i++;
      if (c === '\\' && i < src.length) { out += src[i]; i++; continue; }
      if (c === '/') {
        while (i < src.length && /[a-z]/i.test(src[i])) { out += src[i]; i++; }
        mode = 'code';
      }
      continue;
    }
    // template：支持 ${} 内层，但不改里面内容
    out += c; i++;
    if (c === '\\' && i < src.length) { out += src[i]; i++; continue; }
    if (c === '`') { mode = 'code'; continue; }
    if (c === '$' && src[i] === '{') {
      let depth = 1;
      out += '{'; i++;
      while (i < src.length && depth > 0) {
        const d = src[i];
        out += d; i++;
        if (d === '{') depth++;
        else if (d === '}') depth--;
        else if (d === "'" || d === '"') {
          let j = i;
          while (j < src.length) {
            if (src[j] === '\\') { j += 2; continue; }
            if (src[j] === d) { j++; break; }
            j++;
          }
          out += src.slice(i, j); i = j;
        } else if (d === '`') {
          // 嵌套模板整体跳过
          let j = i;
          while (j < src.length && src[j] !== '`') j++;
          if (j < src.length) j++;
          out += src.slice(i, j); i = j;
        }
      }
    }
  }
  return { code: out, count };
}

let total = 0;
for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(path.basename(file))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const r = wrap(src);
  if (!r.count) continue;
  let code = r.code;
  const rel = path.relative(path.dirname(file), path.join(ROOT, 'i18n.js')).replace(/\\/g, '/');
  if (!/from\s+['"][^'"]*i18n\.js['"]/.test(src)) {
    const importLine = "import { t as tr } from '" + (rel.startsWith('.') ? rel : './' + rel) + "';\n";
    code = "'use strict';\n" + importLine + code.replace(/^'use strict';\n?/, '');
  }
  console.log((WRITE ? 'wrap ' : 'dry  ') + path.relative(ROOT, file) + ' : ' + r.count);
  if (WRITE) fs.writeFileSync(file, code, 'utf8');
  total += r.count;
}
console.log('total ' + total + (WRITE ? ' written' : ' (dry run)'));
