'use strict';
/**
 * U1 产物校验（可复用）：命令行工具与单元测试共用同一套判定，避免两边标准漂移。
 * 放在 tools/u1/ 下是因为它依赖 adm-zip，且不属于运行时 core。
 */
const fs = require('fs');
const AdmZip = require('adm-zip');

// 快造 U1 的机器参数以 bedready 内置 U1 profile 为准（270×270×270）
const U1 = {
  printer_model: 'Snapmaker U1',
  printer_settings_id: 'Snapmaker U1 (0.4 nozzle)',
  printable_area: ['0.5x1', '270.5x1', '270.5x271', '0.5x271'],
  printable_height: '270.05',
};

function readEntry(zip, name) {
  const e = zip.getEntry(name);
  return e ? zip.readAsText(e) : null;
}

function countObjects(xml) {
  return (String(xml).match(/<object\b/g) || []).length;
}

/**
 * @param {string} outPath 转换产物
 * @param {string} [srcPath] 源 3MF，用于几何数量比对与「源文件未被改动」判定
 */
function verifyOutput(outPath, srcPath) {
  const res = { ok: false, outPath, srcPath: srcPath || null, checks: {} };
  try {
    if (!outPath || !fs.existsSync(outPath)) throw new Error('产物不存在：' + outPath);
    const st = fs.statSync(outPath);
    if (st.size <= 0) throw new Error('产物是空文件');

    const zip = new AdmZip(outPath);
    const names = zip.getEntries().map((e) => e.entryName);
    res.entries = names.length;
    res.hasModel = names.includes('3D/3dmodel.model');
    res.checks.zipOk = res.entries > 3 && res.hasModel;
    res.checks.modelXml = res.hasModel;

    const modelXml = res.hasModel ? readEntry(zip, '3D/3dmodel.model') : '';
    res.objects = modelXml ? countObjects(modelXml) : 0;
    res.painted = /paint_color\s*=\s*"[^"]+"/i.test(modelXml);

    let cfgText = readEntry(zip, 'Metadata/project_settings.config');
    if (!cfgText) cfgText = readEntry(zip, 'Metadata/model_settings.config');
    if (cfgText) {
      try {
        res.config = JSON.parse(cfgText);
      } catch (e) {
        res.error = '配置不是合法 JSON：' + e.message;
      }
    }
    res.configFound = !!res.config;

    const cfg = res.config;
    if (cfg) {
      const area = Array.isArray(cfg.printable_area) ? cfg.printable_area : [];
      res.printer = {
        model: cfg.printer_model,
        settingsId: cfg.printer_settings_id,
        variant: cfg.printer_variant,
        printableArea: area,
        printableHeight: cfg.printable_height,
        compat: Array.isArray(cfg.print_compatible_printers)
          ? cfg.print_compatible_printers.slice(0, 6) : cfg.print_compatible_printers,
      };
      res.printProfile = cfg.print_settings_id || null;
      res.filamentType = cfg.filament_type || null;
      res.filamentSettingsId = cfg.filament_settings_id || null;

      res.checks.printerModel = cfg.printer_model === U1.printer_model;
      res.checks.printerSettingsId = cfg.printer_settings_id === U1.printer_settings_id;
      res.checks.printableArea = area.length === U1.printable_area.length &&
        area.every((v, i) => String(v) === U1.printable_area[i]);
      res.checks.printableHeight = String(cfg.printable_height) === U1.printable_height;
      res.checks.compatOnlyU1 = Array.isArray(cfg.print_compatible_printers) &&
        cfg.print_compatible_printers.length > 0 &&
        cfg.print_compatible_printers.every((n) => /Snapmaker U1/i.test(String(n)));
      res.checks.noBambuResidue = !/bambu/i.test(String(cfg.printer_model || '')) &&
        !/bambu/i.test(String(cfg.printer_settings_id || ''));
    }

    if (srcPath && fs.existsSync(srcPath)) {
      const sst = fs.statSync(srcPath);
      res.source = { bytes: sst.size, mtimeMs: sst.mtimeMs };
      try {
        const szip = new AdmZip(srcPath);
        const sxml = readEntry(szip, '3D/3dmodel.model') || '';
        res.sourceObjects = countObjects(sxml);
        res.checks.geometryKept = res.sourceObjects > 0 && res.objects === res.sourceObjects;
      } catch (e) {
        res.checks.geometryKept = false;
        res.geometryError = e.message;
      }
      res.checks.sourceUnchanged = sst.size > 0 && st.mtimeMs >= sst.mtimeMs;
    }

    res.ok = Object.keys(res.checks).length >= 8 && Object.values(res.checks).every(Boolean);
  } catch (e) {
    res.error = e && e.stack ? e.stack : String(e);
  }
  return res;
}

module.exports = { verifyOutput, U1, countObjects };
