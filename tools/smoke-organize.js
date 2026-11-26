'use strict';
/**
 * 整理功能（B 隔离区 / C 智能合并 / A 几何指纹）服务层冒烟：在 Node 里直接驱动 Services。
 * 不需要 Electron 界面；数据全部在临时目录，跑完即删。
 *   node tools/smoke-organize.js
 * 末尾会打印 PASS/FAIL 汇总，任何一项不符期望都以非 0 退出。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('../src/core/paths');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-svc-'));
paths.setDataDir(path.join(root, 'data'));
const files = path.join(root, 'models');
fs.mkdirSync(files, { recursive: true });
const good = (name, colour) => {
  const z = new AdmZip();
  z.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  z.addFile('_rels/.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  z.addFile('3D/3dmodel.model', Buffer.from('<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices>'
    + '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>'
    + '</vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="7"/><triangle v1="4" v2="7" v3="6"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'));
  z.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({ filament_colour: colour })));
  z.writeZip(path.join(files, name));
};
good('a.3mf', ['#FF0000FF']); good('a-copy.3mf', ['#00FF00FF']); good('b.3mf', ['#0000FFFF']);
good('big.3mf', ['#FFFFFFFF']);
fs.writeFileSync(path.join(files, 'junk.3mf'), 'not a zip at all');
let bad = path.join(files, 'nocore.3mf');
{ const z = new AdmZip(); z.addFile('3D/3dmodel.model', Buffer.from('<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="5" y="0" z="0"/><vertex x="0" y="5" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>')); z.writeZip(bad); }

(async () => {
  const out = {};
  const Services = require('../electron/services.js');
  const sv = new Services();
  sv.on('event', (ch, p) => { if (ch === 'app:toast') (out.toasts = out.toasts || []).push(p.message); });
  await sv.init({ autoWatch: false });
  try {
    await sv.folderAdd(files);
    const rep = await sv.scanner.scanPath(files);
    out.scan = { added: rep.added, failed: rep.failed, broken: rep.broken };
    out.brokenList = sv.brokenList().items.map((i) => [i.fileName, i.kind, i.repairable]);
    const junk = sv.brokenList().items.find((i) => i.fileName === 'junk.3mf');
    const nocore = sv.brokenList().items.find((i) => i.fileName === 'nocore.3mf');

    // B：重试（仍然坏）→ 隔离 → 移回
    out.retryStillBroken = (await sv.brokenRetry([junk.id])).still.length === 1;
    const q = await sv.brokenQuarantine([junk.id, nocore.id]);
    out.quarantined = q.ok.length === 2 && q.failed.length === 0 && fs.existsSync(path.join(q.dir, 'junk.3mf'));
    out.hiddenFromList = sv.library.query({}).items.every((m) => m.id !== junk.id && m.id !== nocore.id);
    out.smartBroken = sv.library.smartCounts().broken;
    const res = await sv.brokenRestore([junk.id]);
    out.restored = res.ok.length === 1 && fs.existsSync(path.join(files, 'junk.3mf')) && sv.library.get(junk.id).status === 'ok';

    await sv.brokenRestore([nocore.id]);
    // B：修复缺核心文件的 3MF（不替换）
    const fix = await sv.brokenRepair(nocore.id, { replace: false });
    out.repaired = fix.ok === true && fs.existsSync(fix.outPath) && fs.existsSync(sv.library.get(nocore.id).path);
    // B：修好后替换原文件
    const fix2 = await sv.brokenRepair(nocore.id, { replace: true });
    out.repairedReplace = fix2.replaced === true && !sv.library.get(nocore.id).parseErrorKind && fs.existsSync(fix2.backupPath);
    // B：移出索引
    await sv.brokenForget([junk.id]);
    out.forgotten = !sv.library.get(junk.id);

    // C：预览 + 合并（不动文件）
    const pv = sv.mergePreview();
    out.mergeGroups = pv.groups.map((g) => [g.kind, g.members.length, g.keeperId === pv.groups[0].keeperId ? 'same' : 'diff']);
    const g = pv.groups[0];
    const m1 = await sv.mergeApply({ [g.key]: g.keeperId }, { trash: false });
    { const aliasId = g.members.find((m) => m.id !== g.keeperId).id;
      out.mergedShadow = m1.shadow === 1 && sv.library.aliasesOf(g.keeperId).length === 1 && !sv.library.query({}).items.some((m) => m.id === aliasId); }
    out.dupCountAfterMerge = sv.library.smartCounts().duplicates;
    { const aliasId2 = g.members.find((m) => m.id !== g.keeperId).id;
      const d = await sv.aliasDetach([aliasId2]);
      out.detached = d.detached === 1 && sv.library.query({}).items.some((m) => m.id === aliasId2); }

    // A：指纹
    out.shapeBefore = sv.shapeStatus().pending;
    sv.shapeRun({});
    await new Promise((r) => setTimeout(r, 4000));
    const st = sv.shapeStatus();
    out.shapeAfter = st;
    const all = sv.library.query({});
    out.variantGroups = all.items.filter((m) => m.variantGroup).map((m) => m.fileName + ':' + m.variantRole);
    out.toasts = out.toasts || [];
  } catch (e) {
    out.error = (e && e.stack) || String(e);
  }
  await sv.shutdown();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* 尽力清理 */ }
  const EXPECT = { scan: null, brokenList: null, shapeAfter: null, variantGroups: null, toasts: null, error: null, mergeGroups: null, dupCountAfterMerge: null };
  let bad = 0;
  for (const [k, v] of Object.entries(out)) {
    if (k in EXPECT) continue;
    if (typeof v === 'boolean') { console.log((v ? '  ✓ ' : '  ✗ ') + k); if (!v) bad++; }
  }
  console.log('  合并分组: ' + JSON.stringify(out.mergeGroups) + '  合并后重复计数: ' + out.dupCountAfterMerge);
  console.log('  变体分组: ' + JSON.stringify(out.variantGroups));
  console.log('  指纹状态: ' + JSON.stringify(out.shapeAfter) + '  提示: ' + JSON.stringify(out.toasts));
  if (out.error) { console.log('  ✗ 异常: ' + out.error); bad++; }
  console.log(bad ? '\n整理功能服务层冒烟：' + bad + ' 项失败' : '\n整理功能服务层冒烟：全部通过');
  process.exit(bad ? 1 : 0);
})();
