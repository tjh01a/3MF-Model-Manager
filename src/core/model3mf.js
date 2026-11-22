'use strict';
/**
 * A-1 · 3MF（ZIP/OPC）只读解析
 * 纯 Node，禁止 electron。核心保证：parse3mf 绝不向外抛异常，
 * 任何失败都收敛为 { ok:false, error } ，供扫描循环安全调用。
 *
 * 缩略图按 4 级回退链挑选；meta 各条目独立 try/catch，单条失败只降级。
 */
const fs = require('fs');
const AdmZip = require('adm-zip');
const { MAX_MODEL_BYTES, THUMB_PRIORITY } = require('./constants');

/** 与契约 1.2 一致的 meta 初始降级值 */
function emptyMeta() {
  return {
    objectCount: 0, buildItemCount: 0, plateCount: 0, filamentCount: 0,
    printerModel: null, slicerVersion: null, layerHeight: null, infill: null, unit: null,
    hasThumbnail: false, hasSliceInfo: false, hasMultiColor: false,
    title: null, designer: null, thumbnailEntry: null, entryCount: 0,
    // 卡片色板：filamentColors 恒为数组（旧库没有这个 key，回填据此判断），
    // colorSource = objects（按零件 extruder 映射，最准）/ project（只有切片配置色）/ none。
    filamentColors: [], filamentTypes: [], colorSource: null,
    objNames: [],
    sourceUrl: null,
    // 成本账本（13）：切片重量 + 逐耗材用量；没有切片数据时为 null
    weightG: null, weightSource: null, filamentUsages: [],
  };
}

/**
 * 从 slice_info.config / 内嵌 G-code 提取切片重量与逐耗材用量。
 * 只有拓竹系 3MF 会写这些字段（全库实测约 19% 覆盖），缺失是常态，不是错误。
 * 异常值（如 G-code 里 volume=9297cm³ 却 weight=11.62g）一律丢弃，交给用户手填。
 */
function extractWeightInfo(entries) {
  const out = { weightG: null, weightSource: null, filamentUsages: [] };
  const valid = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0.01 && n <= 5000;
  };

  // 1) slice_info.config：拓竹 plate 段 <metadata key="weight" value="90.39"/> 与 <filament .../>
  try {
    const txt = readEntryText(entries, 'Metadata/slice_info.config');
    if (txt) {
      const wm = /<metadata\b[^>]*\bkey\s*=\s*["']weight["'][^>]*\bvalue\s*=\s*["']([^"']+)["']/i.exec(txt);
      if (wm && valid(wm[1])) {
        out.weightG = Number(wm[1]);
        out.weightSource = 'slice_info';
      }
      const re = /<filament\b([^>]*)\/?>/gi;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const attrs = m[1];
        const g = attr(attrs, 'used_g');
        if (!valid(g)) continue;
        out.filamentUsages.push({
          slot: Number(attr(attrs, 'id')) || null,
          type: attr(attrs, 'type') || null,
          color: normalizeColor(attr(attrs, 'color')),
          usedG: Number(g),
          usedM: Number(attr(attrs, 'used_m')) || null,
        });
      }
    }
  } catch (_) { /* 单条目降级 */ }

  // 2) G-code 头部注释：; total filament weight [g] : 90.39
  if (out.weightG == null) {
    try {
      for (const e of entries) {
        if (!/\.gcode$/i.test(e.entryName)) continue;
        if (!e.header || typeof e.header.size !== 'number' || e.header.size > 1024 * 1024) continue;
        const head = e.getData().toString('utf8', 0, Math.min(16384, e.header.size));
        const wm = /;\s*total filament weight \[g\]\s*:\s*([\d.]+)/i.exec(head);
        if (wm && valid(wm[1])) {
          out.weightG = Number(wm[1]);
          out.weightSource = 'gcode';
        }
        break;
      }
    } catch (_) { /* 单条目降级 */ }
  }
  return out;
}

/**
 * Bambu 的「项目信息」写在 3D/3dmodel.model 的 Description 里，是一段 HTML 富文本，
 * 且常被实体转义两层：&amp;lt;a href=&amp;quot;https://makerworld.com/...&amp;quot;&amp;gt;
 * 所以要先解实体再找 URL，否则普通正则一个都匹配不到。
 */
const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#34;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ',
};
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&(?:amp|lt|gt|quot|#34|#39|#x27|nbsp);/gi, (m) => ENTITY_MAP[m.toLowerCase()] || m);
}

/**
 * 作品页判定：光是「含 makerworld」远远不够——Description 里还混着
 * 预览图 CDN（makerworld.bblmw.cn/.../design/x.png）、作者社交链接、
 * 甚至被写坏的 "makerworld.com/%22https://instagram.com/..." 拼接。
 * 只认明确的「模型详情页」路径。
 */
const MODEL_PAGE_RULES = [
  // MakerWorld 有国际站 .com 和国内站 .com.cn，路径形如 /zh/models/1604099-xxx
  // 早期规则只认 .com，国内站下载的 3MF 链接全部识别不到（2026-11-22 修）。
  /^https?:\/\/(?:www\.)?makerworld\.com(?:\.cn)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/\d+/i,
  /^https?:\/\/(?:www\.)?printables\.com\/model\/\d+/i,
  /^https?:\/\/(?:www\.)?thingiverse\.com\/thing:\d+/i,
  /^https?:\/\/(?:www\.)?cults3d\.com\/[a-z]{2}\/3d-model\//i,
  /^https?:\/\/(?:www\.)?myminifactory\.com\/object\/\d+/i,
  /^https?:\/\/(?:www\.)?thangs\.com\/models?\//i,
];

function isModelPage(url) {
  if (!url) return false;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#]|$)/i.test(url)) return false;  // 图片
  if (/\/design\//i.test(url)) return false;                                  // 图片 CDN 路径
  if (/bblmw\.cn/i.test(url)) return false;                                   // 拓竹图片域名
  if (/%22|%20%22/i.test(url)) return false;                                  // 被写坏的拼接
  if (/[\\"'`<>]$/.test(url)) return false;                                   // 尾部粘了转义残留
  return MODEL_PAGE_RULES.some((re) => re.test(url));
}

/** 明显不是作品页的 URL（用于清理早先回填错的值） */
function looksBrokenUrl(url) {
  const u = String(url || '');
  return /bblmw\.cn/i.test(u) || /\/design\//i.test(u)
    || /\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#]|$)/i.test(u) || /%22/.test(u);
}

/**
 * 从 MakerWorld 图片 CDN 路径反推作品页。
 *
 * 很多 3MF 的描述里**只有合集链接和插图**，没有作品页链接，但插图地址长这样：
 *   https://makerworld.bblmw.cn/makerworld/model/DSM00000001604099/design/xxx.jpg
 * 其中 DSM 后面的数字就是作品 id（1604099），可以直接拼出
 *   https://makerworld.com.cn/zh/models/1604099
 * 这是目前国内站 3MF 最可靠的来源线索（Bambu Studio 项目信息里的链接点开也是它）。
 */
function deriveMakerWorldUrl(text) {
  if (!text) return null;
  const m = /makerworld\.bblmw\.cn\/makerworld\/model\/DSM0*(\d{4,})/i.exec(String(text));
  if (!m) return null;
  return 'https://makerworld.com.cn/zh/models/' + m[1];
}

/**
 * 从任意文本里挑第一个作品页链接；没有直接链接时用 DSM 编号反推。
 * 解码两次是因为常见「双重转义」；URL 尾巴常粘着 &amp;#34; 之类，截到第一个 & 为止。
 */
function extractSourceUrl(text) {
  if (!text) return null;
  const decoded = decodeEntities(decodeEntities(text));
  const re = /https?:\/\/[^\s"'<>]+/gi;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    const url = m[0]
      .split('&')[0]
      .replace(/[\\"'`]+$/g, '')     // 转义残留会让 URL 尾巴粘上反斜杠/引号
      .replace(/[),.;]+$/, '');
    if (url.length < 12 || url.length > 400) continue;
    if (!isModelPage(url)) continue;  // 图片 CDN、社交链接、坏拼接一律跳过，继续找下一个
    return url;
  }
  return deriveMakerWorldUrl(decoded);
}

/* ---------------- 路径归一化 / zip-slip 防护 ---------------- */

/** 统一分隔符、去前导 / 、折叠重复 / 、去掉 ./ 段 */
function normName(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/(^|\/)\.\//g, '$1');
}

/** 返回可比较的小写 key；含 .. 路径段（zip-slip）一律拒绝 */
function safeKey(s) {
  const n = normName(s);
  if (!n) return null;
  if (/(^|\/)\.\.(\/|$)/.test(n)) return null;
  return n.toLowerCase();
}

function mimeOf(name) {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  return 'application/octet-stream';
}

/** 从一段标签文本里取属性（双引号 / 单引号 / 大小写容错） */
function attr(tag, name) {
  let m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag);
  if (!m) m = new RegExp(name + "\\s*=\\s*'([^']*)'", 'i').exec(tag);
  return m ? m[1] : '';
}

/* ---------------- A-1 导出：parseRels ---------------- */

/** 解析 OPC 关系文件 -> [{ target, type, id }]；属性顺序/引号/大小写容错 */
function parseRels(xml) {
  const out = [];
  if (!xml || typeof xml !== 'string') return out;
  const re = /<Relationship\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    out.push({
      target: attr(tag, 'Target'),
      type: attr(tag, 'Type'),
      id: attr(tag, 'Id'),
    });
  }
  return out;
}

/* ---------------- A-1 导出：pickThumbnailEntry（纯函数） ---------------- */

/**
 * 把 entries 归一化为 { name, key, size }。
 * 兼容两种入参：
 *  - string[]                       单元测试（纯字符串，size 视为 0）
 *  - adm-zip entry[] / {entryName,size}  真实解析（可拿到 header.size，即解压后体积）
 * 这样既保持纯函数可单测，又能让第 4 级按体积挑最大图片。
 */
function normalizeEntries(entries) {
  const list = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    let name = '', size = 0;
    if (typeof e === 'string') {
      name = e;
    } else if (e && typeof e === 'object') {
      name = e.entryName || e.name || '';
      if (e.header && typeof e.header.size === 'number') size = e.header.size;
      else if (typeof e.size === 'number') size = e.size;
    } else {
      name = e == null ? '' : String(e);
    }
    const key = safeKey(name);
    if (!key) continue; // 拒绝 zip-slip 条目
    list.push({ name, key, size });
  }
  return list;
}

/** 按归一化 key 在真实条目里查找，返回 entries 中原本的条目名 */
function findByKey(list, rawTarget) {
  const k = safeKey(rawTarget);
  if (!k) return null;
  const hit = list.find((x) => x.key === k);
  return hit ? hit.name : null;
}

/**
 * 纯函数：按契约 4 级回退链挑选缩略图条目名（返回 entries 中真实条目名，或 null）。
 *  1. _rels/.rels 中 Type 含 /metadata/thumbnail 的 Target
 *  2. _rels/.rels 中 Type 含 cover-thumbnail-middle / cover-thumbnail（拓竹）
 *  3. 固定候选（项目常量 THUMB_PRIORITY，与契约固定候选一致）
 *  4. 包内所有 png/jpg/jpeg 中解压后体积最大者（排除 pick 贴图与 <1KB 图片）
 * 全部大小写不敏感；Target 前导 / 归一化；拒绝含 .. 的条目。
 */
function pickThumbnailEntry(entries, relsXml) {
  const list = normalizeEntries(entries);
  if (!list.length) return null;
  const rels = parseRels(relsXml);

  // 1
  for (const r of rels) {
    if (/\/metadata\/thumbnail/i.test(r.type || '')) {
      const hit = findByKey(list, r.target);
      if (hit) return hit;
    }
  }
  // 2（middle 优先）
  for (const pattern of [/cover-thumbnail-middle/i, /cover-thumbnail/i]) {
    for (const r of rels) {
      if (pattern.test(r.type || '')) {
        const hit = findByKey(list, r.target);
        if (hit) return hit;
      }
    }
  }
  // 3
  for (const c of THUMB_PRIORITY) {
    const hit = findByKey(list, c);
    if (hit) return hit;
  }
  // 4
  const imgs = list.filter((x) => {
    if (!/\.(png|jpe?g)$/i.test(x.key)) return false;
    const base = x.key.slice(x.key.lastIndexOf('/') + 1);
    if (/pick/i.test(base)) return false;            // 排除 pick_* 贴图
    if (x.size > 0 && x.size < 1024) return false;  // 排除 <1KB 图片（size 未知时保留）
    return true;
  });
  if (!imgs.length) return null;
  imgs.sort((a, b) => (b.size - a.size) || a.key.localeCompare(b.key));
  return imgs[0].name;
}

/* ---------------- meta 提取（单条目独立降级） ---------------- */

function findEntry(entries, name) {
  const k = safeKey(name);
  if (!k) return null;
  return entries.find((e) => safeKey(e.entryName) === k) || null;
}

function readEntryText(entries, name) {
  const e = findEntry(entries, name);
  if (!e) return null;
  return e.getData().toString('utf8');
}

/** JSON 容错：去 BOM / 首尾空白；混合换行由 JSON.parse 自身消化 */
function parseJsonLoose(text) {
  if (text == null) return null;
  const s = String(text).replace(/^\uFEFF/, '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

function firstVal(v) {
  return Array.isArray(v) ? (v.length ? v[0] : null) : v;
}
function asStr(v) {
  const x = firstVal(v);
  return x === null || x === undefined ? null : String(x);
}

/* ---------------- 耗材颜色 ---------------- */

// 一次 AMS 最多 16 槽；色板只展示去重后的前若干个，库里保留完整数组。
const MAX_FILAMENT_COLORS = 16;

/**
 * 把切片软件里五花八门的颜色写法收敛成安全的 #RRGGBB，无法识别返回 null。
 * 覆盖：#RGB / #RRGGBB / #RRGGBBAA（忽略 alpha）/ 0xRRGGBB / 十进制整数 / 纯 6 位十六进制。
 * 之所以必须归一化：色值会进 style="background:..."，绝不能把 3MF 里的任意字符串拼进 DOM。
 */
function normalizeColor(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.max(0, Math.min(0xFFFFFF, Math.round(v)));
    return '#' + n.toString(16).padStart(6, '0').toUpperCase();
  }
  const s = String(v).trim();
  if (!s) return null;
  // 有 # / 0x 前缀的先按十六进制解析，避免把 "#16711680" 之类误判成十进制。
  if (/^#|^0x/i.test(s)) {
    const hex = s.replace(/^#|^0x/i, '');
    let m = /^([0-9a-f]{3})$/i.exec(hex);
    if (m) {
      const h = m[1].toUpperCase();
      return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    m = /^([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex);
    if (m) return '#' + m[1].toUpperCase();
    return null;
  }
  // 纯数字按十进制颜色值处理（如 16711680 = #FF0000）。
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n > 0xFFFFFF) return null;
    return '#' + n.toString(16).padStart(6, '0').toUpperCase();
  }
  // 无前缀的十六进制串：必须含 a-f，否则会和十进制写法混淆。
  const m = /^([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
  if (m && /[a-f]/i.test(m[1])) return '#' + m[1].toUpperCase();
  return null;
}

/**
 * 取第一个「至少含一个可识别色值」的候选数组（拓竹不同版本键名不一样）。
 * 注意必须保留槽位下标：无效/空色值留在原位用 null 占位，否则 filament_type
 * 与 filament_colour 的下标会错位，显示出来的耗材类型就对不上颜色。
 */
function firstColorArray(...candidates) {
  for (const c of candidates) {
    const arr = Array.isArray(c) ? c : (c == null ? [] : [c]);
    const out = arr.map(normalizeColor);
    if (out.some(Boolean)) return out;
  }
  return [];
}

/**
 * 从「槽位颜色数组 + 槽位耗材类型数组 + 零件实际使用的挤出机索引」生成色板数据。
 * 关键：filament_colour 是 AMS 槽位配置，不一定每个都被模型用到；
 * model_settings.config 里每个 <object> 的 extruder 才是零件真正使用的槽位（1-based）。
 * 没有 extruder 信息时退回展示全部配置色，并用 colorSource 标明口径。
 */
function colorPairs(allColors, allTypes, usedIdx) {
  const idxs = (usedIdx && usedIdx.length)
    ? usedIdx
    : allColors.map((_, i) => i + 1);
  const seen = new Set();
  const colors = [], types = [];
  for (const n of idxs) {
    const i = Number(n);
    if (!Number.isFinite(i) || i < 1 || i > allColors.length) continue;
    const c = normalizeColor(allColors[i - 1]);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    colors.push(c);
    types.push(allTypes[i - 1] == null ? '' : String(allTypes[i - 1]));
    if (colors.length >= MAX_FILAMENT_COLORS) break;
  }
  return { colors, types, source: (usedIdx && usedIdx.length) ? 'objects' : 'project' };
}

/** 从 XML/JSON 里收集 1-based 挤出机索引；0 表示「跟随默认」，按槽位 1 处理。 */
function collectExtruderIndices(out, n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 64) return;
  out.push(v === 0 ? 1 : Math.round(v));
}

function extractMeta(entries, opts, thumbnailName) {
  const meta = emptyMeta();
  meta.entryCount = entries.length;
  meta.thumbnailEntry = thumbnailName || null;
  meta.hasThumbnail = !!thumbnailName;

  const maxModel = Number(opts.maxModelBytes) || MAX_MODEL_BYTES;
  let filamentTypeCount = 0;
  let seqLen = 0;
  let plateFromSeq = 0;
  let multiColorHint = false;
  let objectNames = [];
  let allColors = [];       // 按槽位下标对齐的颜色数组（无效槽位为 null）
  let allTypes = [];        // 与 allColors 同下标
  const extruderIdx = [];   // 零件实际使用的挤出机槽位（1-based）

  // 3D/3dmodel.model：仅当 header.size <= maxModelBytes 才读取统计
  try {
    const e = findEntry(entries, '3D/3dmodel.model');
    if (e && e.header && typeof e.header.size === 'number' && e.header.size <= maxModel) {
      const xml = e.getData().toString('utf8');
      meta.objectCount = (xml.match(/<object[\s/>]/gi) || []).length;
      meta.buildItemCount = (xml.match(/<item[\s/>]/gi) || []).length;
      const um = /<model\b[^>]*\bunit\s*=\s*["']([^"']*)["']/i.exec(xml);
      if (um && um[1]) meta.unit = um[1];
      const gm = (tag) => {
        let re = new RegExp('<metadata\\b[^>]*\\bname\\s*=\\s*"' + tag + '"[^>]*>\\s*([^<]*)<', 'i');
        let m = re.exec(xml);
        if (!m) {
          re = new RegExp("<metadata\\b[^>]*\\bname\\s*=\\s*'" + tag + "'[^>]*>\\s*([^<]*)<", 'i');
          m = re.exec(xml);
        }
        return m && m[1] ? m[1].trim() : '';
      };
      // 对象名：自动分类词库的可搜索文本（哈希文件名如 at=…/v2/final 只能靠它判断）
      const objRe = /<object\b[^>]*\bname\s*=\s*"([^"]+)"/gi;
      let om;
      while ((om = objRe.exec(xml)) !== null) {
        const v = om[1].trim();
        if (v) objectNames.push(v);
      }
      const t = gm('Title'); if (t) meta.title = t;
      const d = gm('Designer'); if (d) meta.designer = d;
      // 作品页链接：Bambu Studio「项目信息」里那个可点的地址就来自这里
      const su = extractSourceUrl(xml);
      if (su) meta.sourceUrl = su;
      if ((xml.match(/<build[\s/>]/gi) || []).length) meta.plateCount = 1;
    }
  } catch (_) { /* 单条目降级 */ }

  // Metadata/project_settings.config（JSON，可能含 BOM / 混合换行）
  try {
    const j = parseJsonLoose(readEntryText(entries, 'Metadata/project_settings.config'));
    if (j && typeof j === 'object') {
      const lh = parseFloat(firstVal(j.layer_height));
      meta.layerHeight = isNaN(lh) ? null : lh;
      meta.infill = asStr(j.sparse_infill_density);
      meta.printerModel = asStr(j.printer_model);
      const ft = j.filament_type;
      filamentTypeCount = Array.isArray(ft) ? ft.length : (ft ? 1 : 0);
      // 拓竹不同版本把颜色写在不同键上；extruder_colour 是打印机机身色，绝不能当耗材色。
      allColors = firstColorArray(j.filament_colour, j.filament_multi_colour, j.default_filament_colour);
      allTypes = Array.isArray(ft) ? ft.map((x) => String(x == null ? '' : x))
        : (ft ? [String(ft)] : []);
    }
  } catch (_) { /* 单条目降级 */ }

  // Metadata/slice_info.config（XML：X-BBL-Client-Version）
  try {
    const txt = readEntryText(entries, 'Metadata/slice_info.config');
    if (txt != null) {
      meta.hasSliceInfo = true;
      const tagM = /<header_item\b[^>]*X-BBL-Client-Version[^>]*>/i.exec(txt);
      if (tagM) {
        const v = attr(tagM[0], 'value');
        if (v) meta.slicerVersion = v;
      }
    }
  } catch (_) { /* 单条目降级 */ }

  // Metadata/model_settings.config：真实样本是 XML，契约描述为 JSON，双容错
  try {
    const txt = readEntryText(entries, 'Metadata/model_settings.config');
    if (txt != null) {
      const j = parseJsonLoose(txt);
      let handled = false;
      if (j && typeof j === 'object') {
        const names = [], colors = [];
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          for (const [k, v] of Object.entries(o)) {
            if (/^(name|object_name|objectName|title)$/i.test(k) && typeof v === 'string') names.push(v);
            if (/^extruder$/i.test(k) && v != null && typeof v !== 'object') {
              collectExtruderIndices(extruderIdx, v);
            }
            if (/colou?r/i.test(k)) {
              if (Array.isArray(v)) colors.push(...v);
              else if (v != null) colors.push(v);
            }
            if (v && typeof v === 'object') walk(v);
          }
        };
        walk(j);
        objectNames = names;
        if (!allColors.length) allColors = firstColorArray(colors);
        if (new Set(colors.map(String)).size > 1) multiColorHint = true;
        handled = true;
      }
      if (!handled) {
        const names = [];
        let m;
        const res = [
          /key\s*=\s*"name"\s+value\s*=\s*"([^"]*)"/gi,
          /key\s*=\s*'name'\s+value\s*=\s*'([^']*)'/gi,
          /value\s*=\s*"([^"]*)"\s+key\s*=\s*"name"/gi,
          /value\s*=\s*'([^']*)'\s+key\s*=\s*'name'/gi,
        ];
        for (const re of res) { while ((m = re.exec(txt)) !== null) names.push(m[1]); }
        objectNames = names;
        // 拓竹真实样本是 <metadata key="extruder" value="1"/>，属性顺序还可能反过来。
        // 早先只匹配 extruder="1" 的形式，等于从没读到过，hasMultiColor 一直 false。
        const exRes = [
          /key\s*=\s*["']extruder["']\s+value\s*=\s*["'](\d+)["']/gi,
          /value\s*=\s*["'](\d+)["']\s+key\s*=\s*["']extruder["']/gi,
          /\bextruder\s*=\s*["'](\d+)["']/gi,
        ];
        for (const re of exRes) {
          let em;
          while ((em = re.exec(txt)) !== null) collectExtruderIndices(extruderIdx, em[1]);
        }
        if (!allColors.length) {
          const hex = txt.match(/#[0-9a-f]{6}\b/gi);
          if (hex) allColors = firstColorArray(hex);
        }
      }
    }
  } catch (_) { /* 单条目降级 */ }

  // Metadata/filament_sequence.json：plate 数 + 耗材序列长度
  try {
    const j = parseJsonLoose(readEntryText(entries, 'Metadata/filament_sequence.json'));
    if (j && typeof j === 'object') {
      const plates = Object.keys(j);
      plateFromSeq = plates.length;
      for (const p of plates) {
        const v = j[p];
        if (v && typeof v === 'object' && Array.isArray(v.sequence)) seqLen += v.sequence.length;
      }
    }
  } catch (_) { /* 单条目降级 */ }

  // 切片重量与逐耗材用量（13 · 成本账本）：缺失是常态，不影响其它 meta
  try {
    const w = extractWeightInfo(entries);
    meta.weightG = w.weightG;
    meta.weightSource = w.weightSource;
    meta.filamentUsages = w.filamentUsages;
  } catch (_) { /* 单条目降级 */ }

  // 汇总
  if (plateFromSeq > 0) meta.plateCount = plateFromSeq;
  meta.filamentCount = seqLen > 0 ? seqLen : filamentTypeCount;

  // 色板：优先按零件实际使用的挤出机槽位取色；没有槽位信息才退回全部配置色。
  const uniqIdx = Array.from(new Set(extruderIdx)).sort((a, b) => a - b);
  const pairs = colorPairs(allColors, allTypes, uniqIdx);
  meta.filamentColors = pairs.colors;
  meta.filamentTypes = pairs.types;
  meta.colorSource = pairs.colors.length ? pairs.source : 'none';
  meta.hasMultiColor = pairs.colors.length > 1 || uniqIdx.length > 1
    || seqLen > 1 || multiColorHint;
  // 自动分类要用的可搜索文本：去重、去空白、截断到 12 个 / 每个 60 字，避免库文件膨胀
  const uniqNames = [];
  const seenName = new Set();
  for (const n of objectNames) {
    const v = String(n == null ? '' : n).trim().replace(/\s+/g, ' ');
    if (!v || v.length > 60) continue;
    const low = v.toLowerCase();
    if (seenName.has(low)) continue;
    seenName.add(low);
    uniqNames.push(v);
    if (uniqNames.length >= 12) break;
  }
  meta.objNames = uniqNames;

  // 兜底：少数 3MF 把来源写在 project_settings / model_settings 里
  if (!meta.sourceUrl) {
    try {
      const su = extractSourceUrl(readEntryText(entries, 'Metadata/project_settings.config'))
        || extractSourceUrl(readEntryText(entries, 'Metadata/model_settings.config'));
      if (su) meta.sourceUrl = su;
    } catch (_) { /* 单条目降级 */ }
  }

  if (!meta.title && objectNames.length) meta.title = objectNames[0];
  return meta;
}

/* ---------------- A-1 导出：parse3mf / readThumbnail ---------------- */

/**
 * 解析单个 3mf（只读，不写文件）。
 * @returns {Promise<{ok:Boolean, error?:String, thumbnail:{entry,data:Buffer,mime}|null, meta:Object}>}
 */
async function parse3mf(filePath, options = {}) {
  const result = { ok: false, thumbnail: null, meta: emptyMeta() };
  const opts = {
    withThumbnail: options.withThumbnail !== false,
    withMeta: options.withMeta !== false,
    maxModelBytes: Number(options.maxModelBytes) || MAX_MODEL_BYTES,
  };

  try {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径为空');
    }

    let zip;
    try {
      // 优先直接从路径构造（adm-zip 按需读取，内存友好）
      zip = new AdmZip(filePath);
    } catch (_) {
      // 回退：先读入内存再解析
      zip = new AdmZip(fs.readFileSync(filePath));
    }

    const entries = zip.getEntries();
    if (!Array.isArray(entries)) throw new Error('无法读取 3MF 内的条目列表');

    // _rels/.rels（失败仅降级，不影响整体）
    let relsXml = '';
    try {
      const relEntry = findEntry(entries, '_rels/.rels');
      if (relEntry) relsXml = relEntry.getData().toString('utf8');
    } catch (_) { relsXml = ''; }

    // 缩略图
    let thumbName = null;
    if (opts.withThumbnail) {
      try {
        thumbName = pickThumbnailEntry(entries, relsXml);
        if (thumbName) {
          const te = findEntry(entries, thumbName);
          if (te) {
            const data = te.getData();
            if (data && data.length) {
              result.thumbnail = { entry: thumbName, data, mime: mimeOf(thumbName) };
            }
          }
        }
      } catch (_) { result.thumbnail = null; }
    }

    // meta
    if (opts.withMeta) {
      try {
        result.meta = extractMeta(
          entries, opts,
          result.thumbnail ? result.thumbnail.entry : thumbName
        );
      } catch (_) { /* 保留 emptyMeta */ }
    }

    result.ok = true;
    return result;
  } catch (e) {
    result.ok = false;
    result.error = '解析 3MF 失败：' + filePath + '（' + (e && e.message ? e.message : String(e)) + '）';
    result.thumbnail = null;
    return result;
  }
}

/** 便捷封装：只取缩略图二进制，失败或无图返回 null */
async function readThumbnail(filePath) {
  const r = await parse3mf(filePath, { withThumbnail: true, withMeta: false });
  return r.ok && r.thumbnail ? r.thumbnail.data : null;
}

module.exports = {
  parse3mf, pickThumbnailEntry, parseRels, readThumbnail, normalizeColor,
  extractSourceUrl, deriveMakerWorldUrl, decodeEntities, isModelPage, looksBrokenUrl,
};
