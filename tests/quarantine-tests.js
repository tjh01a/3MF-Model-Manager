'use strict';
/**
 * B · 损坏 3MF 隔离区：错误归类、诊断、修复、列表。
 * 全部在临时目录里合成样本，不碰真实模型。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const Q = require('../src/core/quarantine');
const { parse3mf } = require('../src/core/model3mf');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
const sha = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-quarantine-'));
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
  + '</Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
  + '</Relationships>';
const MODEL = '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
  + '<resources><object id="1" type="model"><mesh><vertices>'
  + '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/>'
  + '<vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>'
  + '</vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object></resources>'
  + '<build><item objectid="1"/></build></model>';

function build(file, { contentTypes = true, rels = true, model = true, cfg = true, padBytes = 0 } = {}) {
  const zip = new AdmZip();
  if (contentTypes) zip.addFile('[Content_Types].xml', Buffer.from(CT));
  if (rels) zip.addFile('_rels/.rels', Buffer.from(RELS));
  if (model) zip.addFile('3D/3dmodel.model', Buffer.from(MODEL));
  if (cfg) zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({ layer_height: '0.2', note: 'x'.repeat(400) })));
  if (padBytes) zip.addFile('Metadata/pad.bin', crypto.randomBytes(padBytes));
  zip.writeZip(file);
  return fs.readFileSync(file);
}
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };

(async () => {
  console.log('\n[1. 错误归类（扫描热路径，只看报错 + 文件头）]');
  const notZip = write('notzip.3mf', Buffer.from('这不是一个压缩包，只是扩展名叫 3mf'));
  const p1 = await parse3mf(notZip);
  ok('纯文本改后缀：parse3mf 失败', p1.ok === false, p1.error);
  ok('归类为 not-3mf', Q.classifyParseError(p1.error, notZip) === 'not-3mf', Q.classifyParseError(p1.error, notZip));

  const good = path.join(dir, 'good.3mf');
  const goodBuf = build(good, { padBytes: 60000 });
  ok('合成的好文件 parse3mf 成功', (await parse3mf(good)).ok === true);

  console.log('\n[2. 完整诊断]');
  const dg = Q.diagnose3mf(good);
  ok('好文件诊断 kind=ok', dg.kind === 'ok', dg.kind);
  ok('识别出 3D 网格', dg.hasModel === true);
  ok('识别出两个核心条目都在', dg.missing.contentTypes === false && dg.missing.rels === false);

  const dn = Q.diagnose3mf(notZip);
  ok('纯文本诊断 not-3mf 且不可修复', dn.kind === 'not-3mf' && dn.repairable === false);

  const noCore = path.join(dir, 'nocore.3mf');
  build(noCore, { contentTypes: false, rels: false });
  const dc = Q.diagnose3mf(noCore);
  ok('缺核心文件 → missing-core 可修复', dc.kind === 'missing-core' && dc.repairable === true, dc.kind);

  const noModel = path.join(dir, 'nomodel.3mf');
  const zNo = new AdmZip();
  zNo.addFile('[Content_Types].xml', Buffer.from(CT));
  zNo.addFile('_rels/.rels', Buffer.from(RELS));
  zNo.addFile('Metadata/project_settings.config', Buffer.from('{"a":1}'));
  zNo.writeZip(noModel);
  const dm = Q.diagnose3mf(noModel);
  ok('没有网格也没有切片 → no-model 不可修复', dm.kind === 'no-model' && dm.repairable === false, dm.kind);

  console.log('\n[3. 文件截断：按本地文件头抢救]');
  // 截掉尾部 30%：中央目录肯定没了，最后那个大条目的数据也被切掉一部分
  const cut = goodBuf.subarray(0, Math.floor(goodBuf.length * 0.7));
  const trunc = write('truncated.3mf', cut);
  const p3 = await parse3mf(trunc);
  ok('截断文件 parse3mf 失败', p3.ok === false);
  ok('归类为 truncated', Q.classifyParseError(p3.error, trunc) === 'truncated', Q.classifyParseError(p3.error, trunc));
  const dt = Q.diagnose3mf(trunc);
  ok('诊断 truncated 可修复', dt.kind === 'truncated' && dt.repairable === true, dt.kind);
  const salvaged = Q.salvageLocalEntries(cut);
  const salvNames = salvaged.map((x) => x.name);
  ok('抢救出 3D 网格', salvNames.includes('3D/3dmodel.model'), salvNames.join(','));
  ok('抢救出的网格字节与原始一致',
    salvaged.find((x) => x.name === '3D/3dmodel.model').data.equals(Buffer.from(MODEL)));

  const hashBefore = sha(trunc);
  const rr = Q.repair3mf(trunc, path.join(dir, 'truncated.repaired.3mf'), dt);
  ok('修复成功并输出到新文件', rr.ok === true && fs.existsSync(rr.outPath));
  ok('原文件哈希不变', sha(trunc) === hashBefore);
  ok('修复版能被 parse3mf 读取', (await parse3mf(rr.outPath)).ok === true);
  ok('修复版诊断 ok', Q.diagnose3mf(rr.outPath).kind === 'ok', Q.diagnose3mf(rr.outPath).kind);

  console.log('\n[4. 数据校验失败]');
  // 在「最后一个条目」的压缩数据中间改一个字节（pad.bin 在最后，前面的条目不受影响）
  const corruptBuf = Buffer.from(goodBuf);
  const padStart = corruptBuf.indexOf(Buffer.from('Metadata/pad.bin'));
  let patched = false;
  for (let i = padStart + 40; i < corruptBuf.length - 200; i++) {
    if (corruptBuf[i] !== 0) { corruptBuf[i] ^= 0xff; patched = true; break; }
  }
  const badcrc = write('badcrc.3mf', corruptBuf);
  const db = Q.diagnose3mf(badcrc);
  ok('确实改到了数据', patched === true);
  ok('诊断 bad-crc 且网格没坏 → 可修复', db.kind === 'bad-crc' && db.repairable === true, db.kind + ' bad=' + db.bad.join(','));
  ok('坏条目被点名', db.bad.some((n) => n.includes('pad.bin')), db.bad.join(','));
  const rb = Q.repair3mf(badcrc, path.join(dir, 'badcrc.repaired.3mf'), db);
  ok('修复时丢弃坏条目', rb.ok === true && rb.skipped.some((n) => n.includes('pad.bin')), rb.skipped.join(','));
  ok('修复版诊断 ok', Q.diagnose3mf(rb.outPath).kind === 'ok');

  // 网格条目本身坏了：不可修复
  const zModelOnly = new AdmZip();
  zModelOnly.addFile('[Content_Types].xml', Buffer.from(CT));
  zModelOnly.addFile('_rels/.rels', Buffer.from(RELS));
  zModelOnly.addFile('3D/3dmodel.model', Buffer.from(MODEL));
  zModelOnly.addFile('Metadata/big.txt', Buffer.from('y'.repeat(8000)));
  const mo = path.join(dir, 'modelonly.3mf');
  zModelOnly.writeZip(mo);
  const moBuf = fs.readFileSync(mo);
  const mStart = moBuf.indexOf(Buffer.from('3D/3dmodel.model'));
  for (let i = mStart + 40; i < mStart + 120; i++) {
    if (moBuf[i] !== 0 && moBuf[i] !== 0xff) { moBuf[i] ^= 0x5a; break; }
  }
  const modelBad = write('modelbad.3mf', moBuf);
  const dmb = Q.diagnose3mf(modelBad);
  ok('网格条目损坏 → 不可修复', dmb.kind === 'bad-crc' && dmb.repairable === false, dmb.kind + ' bad=' + dmb.bad.join(','));
  let threw = null;
  try { Q.repair3mf(modelBad, path.join(dir, 'modelbad.repaired.3mf'), dmb); } catch (e) { threw = e; }
  ok('不可修复时抛出中文原因且不生成文件',
    !!threw && /[\u4e00-\u9fa5]/.test(threw.message) && !fs.existsSync(path.join(dir, 'modelbad.repaired.3mf')), threw && threw.message);

  console.log('\n[5. 缺核心文件：注入后修复]');
  const rm = Q.repair3mf(noCore, path.join(dir, 'nocore.repaired.3mf'), dc);
  ok('注入了两个核心条目', rm.injected.length === 2, rm.injected.join(','));
  ok('修复版诊断 ok', Q.diagnose3mf(rm.outPath).kind === 'ok');
  ok('不覆盖已存在的输出（自动加序号）', / \(2\)/.test(Q.uniqueSuffix(good)));

  console.log('\n[6. 不该修的不修]');
  let e2 = null;
  try { Q.repair3mf(good, path.join(dir, 'good.repaired.3mf')); } catch (e) { e2 = e; }
  ok('好文件拒绝修复', !!e2 && /不需要修复/.test(e2.message));
  let e3 = null;
  try { Q.repair3mf(noModel, path.join(dir, 'nomodel.repaired.3mf'), dm); } catch (e) { e3 = e; }
  ok('no-model 拒绝修复并说明原因', !!e3 && /没有 3D 网格/.test(e3.message), e3 && e3.message);

  console.log('\n[7. 文件移动]');
  const qdir = path.join(dir, 'quarantine');
  const moved = Q.moveFile(nocoreOk(), path.join(qdir, 'nocore.3mf'));
  ok('移动到隔离目录', fs.existsSync(moved) && !fs.existsSync(path.join(dir, 'nocore.3mf')));
  const moved2 = Q.moveFile(rm.outPath, path.join(qdir, 'nocore.3mf'));
  ok('目标重名不覆盖，自动加序号', /\(2\)\.3mf$/.test(moved2) && fs.existsSync(moved), moved2);

  function nocoreOk() { return noCore; }

  console.log('\n[8. 隔离区列表]');
  const library = { models: {
    a: { id: 'a', fileName: 'a.3mf', path: 'a', parseErrorKind: 'truncated', parseError: 'x', status: 'ok', size: 10, createdAt: 2 },
    b: { id: 'b', fileName: 'b.3mf', path: 'b', parseErrorKind: 'not-3mf', parseError: 'y', status: 'quarantined', size: 20, createdAt: 3 },
    c: { id: 'c', fileName: 'c.3mf', path: 'c', parseError: 'old', status: 'ok', size: 30, createdAt: 1 },   // 旧记录：没归类 → 不进列表
    d: { id: 'd', parseErrorKind: 'truncated', status: 'missing' },                                        // 文件没了 → 归失效
    e: { id: 'e', parseErrorKind: 'truncated', status: 'ok', aliasOf: 'a' },                               // 别名不单列
    f: { id: 'f', fileName: 'f.3mf', path: 'f', parseErrorKind: 'truncated', status: 'ok', size: 5, createdAt: 9 },
  } };
  const list = Q.brokenItems(library);
  ok('只列出已归类的坏文件', list.items.length === 3 && list.items.map((i) => i.id).sort().join() === 'a,b,f', list.items.map((i) => i.id).join());
  ok('未隔离的排在前面', list.items[0].id === 'f' && list.items[2].id === 'b');
  ok('汇总数字正确', list.summary.total === 3 && list.summary.quarantined === 1 && list.summary.repairable === 2, JSON.stringify(list.summary));
  ok('按类型计数', list.summary.byKind.truncated === 2 && list.summary.byKind['not-3mf'] === 1);
  ok('带了人话标签', /文件不完整/.test(list.items[0].kindLabel), list.items[0].kindLabel);
  ok('标出是否已隔离', list.items.every((i) => i.quarantined === (i.id === 'b')));

  console.log('\n[9. CRC32]');
  ok('CRC32 与标准值一致', Q.crc32(Buffer.from('123456789')) === 0xcbf43926, Q.crc32(Buffer.from('123456789')).toString(16));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 临时目录，尽力清理 */ }

  console.log('\n' + '='.repeat(56));
  console.log('  隔离区测试：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('='.repeat(56));
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('测试异常：', e);
  process.exitCode = 1;
});
