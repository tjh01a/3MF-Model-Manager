'use strict';
/** 列出源码里 tr('原文') 用到、但英文包还没覆盖的 key。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'data') continue;
      walk(p, out);
    } else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const keys = new Set();
for (const file of walk(path.join(ROOT, 'src', 'renderer'))) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /\btr\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    try { keys.add(JSON.parse('"' + m[2].replace(/"/g, '\\"') + '"')); } catch (_) { /* 忽略 */ }
  }
}
const enSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'locales', 'en-US.js'), 'utf8');
const missing = [];
for (const k of keys) {
  if (!enSrc.includes(JSON.stringify(k) + ':')) missing.push(k);
}
if (process.env.I18N_MISSING_OUT) {
  fs.writeFileSync(process.env.I18N_MISSING_OUT, JSON.stringify(missing, null, 2), 'utf8');
}
console.log('tr keys ' + keys.size + ' / missing ' + missing.length);
for (const k of missing) console.log(JSON.stringify(k));
