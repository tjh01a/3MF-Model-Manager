'use strict';
/**
 * 快造 U1 转换 · 配置后处理（契约 U1-D2）。
 * 纯函数，不碰文件系统，便于单测。
 *
 * 为什么需要后处理：
 *   BedReady 的 preserve 模式（网页版默认）会把拓竹的 print_compatible_printers 原样留下，
 *   快造 Orca 2.4 因此报 `process not compatible with printer`。实测确认。
 *   它的 stamp 模式用的样板里这些键是对的，但它不保证每次都对，所以这里再兜一层。
 */
const AdmZip = require('adm-zip');

const U1_PRINTER_NAME = 'Snapmaker U1 (0.4 nozzle)';
const CONFIG_ENTRY = /(^|\/)Metadata\/project_settings\.config$/i;

/** 从 3MF 字节里读出 project_settings.config 对象；没有则返回 null */
function readProjectConfig(buf) {
  let zip;
  try { zip = new AdmZip(buf); } catch (e) {
    throw new Error('输出文件不是有效的 3MF（zip 读取失败）：' + e.message);
  }
  const entry = zip.getEntries().find((e) => CONFIG_ENTRY.test(e.entryName));
  if (!entry) return null;
  const text = entry.getData().toString('utf8');
  try {
    return { zip, entry, config: JSON.parse(text) };
  } catch (e) {
    throw new Error('输出文件的 project_settings.config 不是合法 JSON：' + e.message);
  }
}

/** 槽位数：优先看 filament_colour，其次 filament_type，兜底 4 */
function slotCount(config) {
  for (const k of ['filament_colour', 'filament_type', 'filament_settings_id']) {
    if (Array.isArray(config[k]) && config[k].length) return config[k].length;
  }
  return 4;
}

/**
 * 把预设展开出来的「按槽位键值」写进配置。
 * 只覆盖预设真正定义过的键——预设没提的一律不动，避免把 U1 样板的安全值冲掉。
 */
function mergeSlotValues(config, values, slots) {
  if (!values) return 0;
  let n = 0;
  for (const [k, arr] of Object.entries(values)) {
    if (!Array.isArray(arr)) continue;
    const v = arr.length === slots ? arr.slice()
      : new Array(slots).fill(arr.length ? arr[0] : '');
    config[k] = v;
    n++;
  }
  return n;
}

/**
 * 主入口：对转换产物做配置后处理。
 *
 * @param {Buffer} buf         BedReady 转换产物
 * @param {object} opts
 * @param {string} [opts.filamentPreset]  耗材预设名（写进 filament_settings_id）
 * @param {object} [opts.filamentValues]  该预设展开后的按槽位键值
 * @param {string} [opts.processPreset]   进程预设名
 * @param {object} [opts.processValues]   该预设展开后的按槽位键值
 * @returns {{ buffer: Buffer, report: object }}
 */
function patchProjectConfig(buf, opts = {}) {
  const found = readProjectConfig(buf);
  if (!found) {
    // 没有配置文件说明这不是标准项目文件，交给上层决定要不要报错
    return { buffer: buf, report: { patched: false, reason: '缺少 project_settings.config' } };
  }
  const { zip, entry, config } = found;
  const slots = slotCount(config);

  const report = {
    patched: true,
    slots,
    printerBefore: config.printer_settings_id || null,
    printProfileBefore: config.print_settings_id || null,
    compatBefore: Array.isArray(config.print_compatible_printers)
      ? config.print_compatible_printers.slice(0, 4) : null,
    mergedFilamentKeys: 0,
    mergedProcessKeys: 0,
    filamentPreset: opts.filamentPreset || null,
    processPreset: opts.processPreset || null,
  };

  // ---- ① 打印机兼容性：这是 Orca 判定「能不能切」的直接依据 ----
  // 这里必须无条件写 U1 的名字，不能回填 config.printer_settings_id：
  // 万一上游没把身份改干净（源文件还是 Bambu Lab X2D），回填就等于把错误原样写回去。
  // 我们转换的目标固定是 U1，不需要猜。
  config.print_compatible_printers = [U1_PRINTER_NAME];
  config.upward_compatible_machine = [];

  // ---- ② 耗材预设 ----
  if (opts.filamentPreset) {
    config.filament_settings_id = new Array(slots).fill(String(opts.filamentPreset));
  }
  if (opts.filamentValues) {
    report.mergedFilamentKeys = mergeSlotValues(config, opts.filamentValues, slots);
  }

  // ---- ③ 进程预设 ----
  if (opts.processPreset) {
    const name = String(opts.processPreset);
    config.print_settings_id = name;
    config.default_print_profile = name;
  }
  if (opts.processValues) {
    report.mergedProcessKeys = mergeSlotValues(config, opts.processValues, slots);
  }

  report.printProfileAfter = config.print_settings_id || null;

  const text = JSON.stringify(config);
  zip.updateFile(entry.entryName, Buffer.from(text, 'utf8'));
  return { buffer: zip.toBuffer(), report };
}

/** 从磁盘上的 3MF 直接读配置（只解压配置条目，不碰几何） */
function readProjectConfigFromFile(filePath) {
  let zip;
  try { zip = new AdmZip(filePath); } catch (_) { return null; }
  let entry;
  try { entry = zip.getEntries().find((e) => CONFIG_ENTRY.test(e.entryName)); } catch (_) { return null; }
  if (!entry) return null;
  try { return JSON.parse(entry.getData().toString('utf8')); } catch (_) { return null; }
}

/** 源文件的打印机身份，用来判断「是不是本来就是快造文件」 */
function sourcePrinterName(filePath) {
  const cfg = readProjectConfigFromFile(filePath);
  if (!cfg) return null;
  return cfg.printer_settings_id || cfg.printer_model || null;
}

module.exports = {
  patchProjectConfig,
  readProjectConfig,
  readProjectConfigFromFile,
  sourcePrinterName,
  mergeSlotValues,
  slotCount,
  U1_PRINTER_NAME,
};
