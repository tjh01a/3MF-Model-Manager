'use strict';
/**
 * I · 模型护照（docs/22 I）。
 * 只做「许可规范化 + 商用判断 + 导出」，不联网、不判断法律效力。
 */

const PRESETS = [
  { id: 'cc0', label: 'CC0 / 公有领域', commercial: true, rehost: true, remix: true, attribution: false },
  { id: 'cc-by', label: 'CC BY（署名）', commercial: true, rehost: true, remix: true, attribution: true },
  { id: 'cc-by-sa', label: 'CC BY-SA（相同方式共享）', commercial: true, rehost: true, remix: true, attribution: true, shareAlike: true },
  { id: 'cc-by-nc', label: 'CC BY-NC（禁止商用）', commercial: false, rehost: true, remix: true, attribution: true },
  { id: 'cc-by-nd', label: 'CC BY-ND（禁止演绎）', commercial: true, rehost: true, remix: false, attribution: true },
  { id: 'mit', label: 'MIT', commercial: true, rehost: true, remix: true, attribution: true },
  { id: 'gpl', label: 'GPL', commercial: true, rehost: true, remix: true, attribution: true, shareAlike: true },
  { id: 'personal', label: '仅个人使用', commercial: false, rehost: false, remix: true, attribution: true },
  { id: 'unknown', label: '未标注许可', commercial: null, rehost: null, remix: null, attribution: null },
];

function findPreset(v) {
  const s = String(v || '').toLowerCase().trim();
  if (!s) return null;
  const slug = s.replace(/\s+/g, '-');
  const exact = PRESETS.find((p) => p.id === slug || p.id === s || p.label.toLowerCase() === s);
  if (exact) return exact;
  if (/public\s*domain|cc0/i.test(s)) return PRESETS.find((p) => p.id === 'cc0');
  // 常见写法带版本号：CC BY-SA 4.0 / CC BY-NC 4.0。
  // 先匹配「去掉版本号」的前缀，且要求命中后紧跟 '-' 或结尾，避免 CC BY 抢走 CC BY-NC。
  const byPrefix = PRESETS
    .filter((p) => p.id.indexOf('cc-') === 0)
    .sort((a, b) => b.id.length - a.id.length)
    .find((p) => new RegExp('^' + p.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '(?:-(?:\\d+(?:\\.\\d+)?|international|unported))?$').test(slug));
  return byPrefix || null;
}

/**
 * 归一化：把作者手填的许可、平台字段、来源链接揉成一个可判断的对象。
 * 明确写了「禁止商用」优先；其次看许可预设；都没有则 commercial=null（未知，不臆断）。
 */
function normalizeLicense(rec) {
  const r = rec || {};
  const meta = r.meta || {};
  const raw = String(r.license || meta.license || '').trim();
  const preset = findPreset(raw);
  let commercial = null;
  if (typeof r.commercialUse === 'boolean') commercial = r.commercialUse;
  else if (typeof meta.commercialUse === 'boolean') commercial = meta.commercialUse;
  else if (preset) commercial = preset.commercial;
  const source = String(r.sourceUrl || meta.sourceUrl || '').trim();
  return {
    license: preset ? preset.id : (raw || 'unknown'),
    licenseLabel: preset ? preset.label : (raw || '未标注许可'),
    licenseUrl: String(r.licenseUrl || meta.licenseUrl || '').trim(),
    designer: String(r.author || meta.designer || '').trim(),
    designerUrl: String(r.authorUrl || meta.designerUrl || '').trim(),
    sourceUrl: source,
    commercial,
    commercialLabel: commercial === true ? '允许商用' : (commercial === false ? '禁止商用' : '未知'),
    attribution: preset ? preset.attribution : null,
    remix: preset ? preset.remix : null,
    rehost: preset ? preset.rehost : null,
  };
}

function isCommercial(rec) { return normalizeLicense(rec).commercial === true; }
function isNonCommercial(rec) { return normalizeLicense(rec).commercial === false; }

const PASSPORT_FIELDS = ['license', 'licenseUrl', 'author', 'authorUrl', 'commercialUse', 'sourceUrl'];

function CSV_HEAD() {
  return ['名称', '文件名', '作者', '许可', '许可链接', '来源', '可否商用', '分类', '打印次数', '最后打印', '最近修改'].join(',');
}

function cell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function passportCsv(models, categories) {
  const catMap = new Map((categories || []).map((c) => [c.id, c.name]));
  const lines = [CSV_HEAD()];
  for (const rec of models || []) {
    const p = normalizeLicense(rec);
    lines.push([
      rec.title || rec.fileName || '', rec.fileName || '', p.designer, p.licenseLabel, p.licenseUrl,
      p.sourceUrl, p.commercialLabel, catMap.get(rec.categoryId) || '',
      Number(rec.printCount) || 0,
      rec.lastPrintedAt ? new Date(rec.lastPrintedAt).toISOString().slice(0, 10) : '',
      rec.mtime ? new Date(rec.mtime).toISOString().slice(0, 10) : '',
    ].map(cell).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  PRESETS, findPreset, normalizeLicense, isCommercial, isNonCommercial,
  passportCsv, PASSPORT_FIELDS,
};
