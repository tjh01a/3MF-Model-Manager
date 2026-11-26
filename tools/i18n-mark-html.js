'use strict';
/** 给 index.html 的静态中文加上 data-i18n-* 标记。只跑一次即可；重复运行幂等。 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
let s = fs.readFileSync(file, 'utf8');

// 注释 / <style>/<script>/SVG sprite 都不翻译：里面有大量代码与诊断契约文本。
const SKIP = /<!--[\s\S]*?-->|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<svg id="icon-sprite"[\s\S]*?<\/svg>/g;
const holes = [];
s = s.replace(SKIP, (m) => { holes.push(m); return '\u0000' + (holes.length - 1) + '\u0000'; });

// 属性：title / placeholder / aria-label
for (const [attr, mark] of [['title', 'data-i18n-title'], ['placeholder', 'data-i18n-placeholder'], ['aria-label', 'data-i18n-aria']]) {
  const re = new RegExp('\\s' + attr + '="([^"]*[\\u3400-\\u9fff][^"]*)"', 'g');
  s = s.replace(re, (m, value) =>
    (m.indexOf(' ' + mark + '=') >= 0 ? m : ' ' + mark + '="' + value + '"' + m));
}

// 纯文本子元素：<tag ...>中文</tag>
const TEXT = /<([a-zA-Z][\w-]*)(\s[^<>]*?)?>([^<>]*[\u3400-\u9fff][^<>]*)<\/([a-zA-Z][\w-]*)>/g;
s = s.replace(TEXT, (m, tag, attrs = '', text, close) => {
  if (tag.toLowerCase() !== close.toLowerCase()) return m;
  if (/^(style|script|option|code|pre)$/i.test(tag)) return m;
  if (m.indexOf('data-i18n=') >= 0) return m;
  return '<' + tag + attrs + ' data-i18n="' + text + '">' + text + '</' + close + '>';
});

// 下拉选项文字也要翻译，但 value 不能动。
s = s.replace(/<option value="([^"]*)">([^<>]*[\u3400-\u9fff][^<>]*)<\/option>/g,
  (m, value, text) => m.indexOf('data-i18n=') >= 0 ? m
    : '<option value="' + value + '" data-i18n="' + text + '">' + text + '</option>');

s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => holes[Number(i)]);
fs.writeFileSync(file, s, 'utf8');
console.log('[i18n] 静态 HTML 标记完成');
