'use strict';
/**
 * 3MF 来源网页解析（Bambu Studio「项目信息」里那个链接）。
 * 关键点：Description 是 HTML 富文本，URL 外面裹着两层实体转义。
 */
const fs = require('fs');
const { extractSourceUrl, parse3mf, isModelPage, looksBrokenUrl } = require('../src/core/model3mf');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('\n[1. 实体转义]');
const doubled = '&amp;lt;a href=&amp;quot;https://makerworld.com/es/models/3377037-soporte&amp;quot;&amp;gt;点我&amp;lt;/a&amp;gt;';
ok('双重转义能解出 URL',
  extractSourceUrl(doubled) === 'https://makerworld.com/es/models/3377037-soporte',
  extractSourceUrl(doubled));
ok('单层转义也能解',
  extractSourceUrl('https://printables.com/model/123') === 'https://printables.com/model/123');
ok('尾部实体残留被截断（作品页）',
  extractSourceUrl('https://makerworld.com/models/1234-x#profileId-1&amp;#34;')
    === 'https://makerworld.com/models/1234-x#profileId-1',
  extractSourceUrl('https://makerworld.com/models/1234-x#profileId-1&amp;#34;'));

console.log('\n[2. 只认作品站]');
ok('跳过普通网站', extractSourceUrl('https://example.com/model/1') === null);
ok('跳过 bambu 文档站', extractSourceUrl('https://wiki.bambulab.com/x') === null);
ok('支持 thingiverse', extractSourceUrl('https://www.thingiverse.com/thing:1') === 'https://www.thingiverse.com/thing:1');
ok('纯文字返回 null', extractSourceUrl('这是一段没有链接的描述') === null);
ok('空值返回 null', extractSourceUrl('') === null && extractSourceUrl(null) === null);

console.log('\n[2b. 中国站域名 makerworld.com.cn]');
ok('接受国服作品页',
  isModelPage('https://makerworld.com.cn/zh/models/1604099-xing-zhi-qia-bi'),
  'isModelPage 国服作品页');
ok('能从国服作品页原样取出',
  extractSourceUrl('https://makerworld.com.cn/zh/models/1604099-xing-zhi-qia-bi#profileId-1754672')
    === 'https://makerworld.com.cn/zh/models/1604099-xing-zhi-qia-bi#profileId-1754672',
  extractSourceUrl('https://makerworld.com.cn/zh/models/1604099-xing-zhi-qia-bi#profileId-1754672'));
ok('国服合集页仍不算作品页',
  extractSourceUrl('https://makerworld.com.cn/zh/collections/335702') === null);

console.log('\n[2c. 从图片 CDN 的 DSM 编号反推作品页]');
const { deriveMakerWorldUrl } = require('../src/core/model3mf');
ok('DSM 编号去掉前导零拼出国服作品页',
  deriveMakerWorldUrl('https://makerworld.bblmw.cn/makerworld/model/DSM00000001604099/design/2025-09-19_a.jpg')
    === 'https://makerworld.com.cn/zh/models/1604099',
  deriveMakerWorldUrl('https://makerworld.bblmw.cn/makerworld/model/DSM00000001604099/design/a.jpg'));
ok('描述里只有图片+合集时也能反推',
  extractSourceUrl('&amp;lt;img src=&amp;#34;https://makerworld.bblmw.cn/makerworld/model/DSM00000001604099/design/a.jpg&amp;#34; /&amp;gt;')
    === 'https://makerworld.com.cn/zh/models/1604099');
ok('没有 DSM 编号返回 null', deriveMakerWorldUrl('https://example.com/a.jpg') === null);
ok('有直接作品页时优先用直接链接（不反推）',
  extractSourceUrl('https://makerworld.com.cn/zh/models/42-x https://makerworld.bblmw.cn/makerworld/model/DSM00000001604099/design/a.jpg')
    === 'https://makerworld.com.cn/zh/models/42-x');

console.log('\n[3. 多链接取第一个作品页]');
const multi = '先看 https://example.com/a 再看 https://makerworld.com/en/models/9 最后 https://printables.com/m/2';
ok('跳过前面无关链接，命中第一个作品页',
  extractSourceUrl(multi) === 'https://makerworld.com/en/models/9', extractSourceUrl(multi));

console.log('\n[4. 国际站 → 中国站候选地址]');
const { cnMakerWorldUrl } = require('../src/core/source-urls');
ok('保留路径与 profileId 锚点',
  cnMakerWorldUrl('https://makerworld.com/zh/models/1-a#profileId-2')
    === 'https://makerworld.com.cn/zh/models/1-a#profileId-2',
  cnMakerWorldUrl('https://makerworld.com/zh/models/1-a#profileId-2'));
ok('www 前缀也能转',
  cnMakerWorldUrl('https://www.makerworld.com/models/9') === 'https://makerworld.com.cn/models/9');
ok('本来就是国服，不转',
  cnMakerWorldUrl('https://makerworld.com.cn/zh/models/1') === null);
ok('其它站点不碰',
  cnMakerWorldUrl('https://printables.com/model/1') === null);
ok('非法 URL 返回 null', cnMakerWorldUrl('not a url') === null);

console.log('\n[5. 拒绝图片 CDN 与坏拼接]');
ok('拒预览图 png', !isModelPage('https://makerworld.bblmw.cn/makerworld/model/DSM1/design/x.png'));
ok('拒 bblmw 图片域名', !isModelPage('https://makerworld.bblmw.cn/makerworld/model/DSM00000002673007/design/a.gif'));
ok('拒 model_settings 里的 /design/ 路径', !isModelPage('https://makerworld.com/design/abc'));
ok('拒坏拼接 %22', !isModelPage('https://makerworld.com/%22https://www.instagram.com/x//%22'));
ok('接受正常作品页', isModelPage('https://makerworld.com/es/models/3377037-x#profileId-1'));
ok('接受 printables 作品页', isModelPage('https://www.printables.com/model/123-x'));
ok('尾部反斜杠不误判',
  extractSourceUrl('https://makerworld.com/models/92486\\') === 'https://makerworld.com/models/92486',
  extractSourceUrl('https://makerworld.com/models/92486\\'));
ok('图片 URL 会被 looksBrokenUrl 识别',
  looksBrokenUrl('https://makerworld.bblmw.cn/makerworld/model/x/design/y.jpg') === true);
ok('正常作品页不会被 looksBrokenUrl 误杀',
  looksBrokenUrl('https://makerworld.com/es/models/1-x') === false);

console.log('\n[6. 真实样本（本机有文件才跑）]');
const sample = 'C:\\Users\\10104\\Downloads\\ocarina_simbolo_Zelda.3mf';
(async () => {
  if (!fs.existsSync(sample)) {
    console.log('  - 跳过：样本文件不存在');
  } else {
    const r = await parse3mf(sample, { withThumbnail: false, withMeta: true });
    const url = r && r.meta && r.meta.sourceUrl;
    ok('从真实 3MF 解出 makerworld 链接', !!url && /makerworld\.com/i.test(url), String(url));
    ok('链接里带 models 路径', !!url && /\/models\//.test(url), String(url));
  }

  console.log('\n' + '─'.repeat(30));
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) process.exitCode = 1;
})();
