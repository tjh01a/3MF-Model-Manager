'use strict';
/**
 * B · 损坏 3MF 隔离区（纯 Node，无 Electron 依赖）。
 *
 * 三件事：
 *   1. classifyParseError  —— 扫描失败时只看报错文本 + 文件头，给错误归类（快，不读整个文件）。
 *   2. diagnose3mf         —— 用户点进来时做完整诊断：结构缺什么、哪些条目 CRC 对不上。
 *   3. repair3mf           —— 尽力修复，**永远输出到新文件**，绝不覆盖原文件。
 *
 * 另有隔离区文件移动、列表生成等辅助函数；落盘一律走 store.updateLibrary()。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');

const { parse3mf } = require('./model3mf');

const SIG_LH = 0x04034b50;   // local file header
const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_DDSIG = 0x08074b50; // data descriptor（可选的签名）
const MAX_DIAG_BYTES = 200 * 1024 * 1024;   // 超过就只做结构检查，不逐条目校验
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** 错误类型 → 人话。渲染层会再过一遍 tr()。 */
const KINDS = {
  'not-3mf': {
    label: '不是 3MF 文件', repairable: false,
    hint: '文件内容不是 3MF 压缩包，可能只是把别的文件改了扩展名。',
  },
  truncated: {
    label: '文件不完整', repairable: true,
    hint: '可能是下载中断或复制出错，可以尝试修复。',
  },
  'bad-crc': {
    label: '数据校验失败', repairable: true,
    hint: '压缩包里有条目损坏，可以尝试修复；修不好的条目会被丢弃。',
  },
  'missing-core': {
    label: '缺少必需文件', repairable: true,
    hint: '压缩包缺少 [Content_Types].xml 或 _rels/.rels，部分切片软件会打不开。',
  },
  'no-model': {
    label: '没有 3D 网格', repairable: false,
    hint: '压缩包里既没有 3D 网格也没有切片结果，不是可用的模型文件。',
  },
  'too-large': {
    label: '文件过大', repairable: false,
    hint: '超过解析上限，没有做完整检查。',
  },
  timeout: {
    label: '解析超时', repairable: false,
    hint: '上次解析超时，可以重试一次。',
  },
  unknown: {
    label: '解析失败', repairable: false,
    hint: '原因未知，可以重试一次。',
  },
};

const KIND_KEYS = Object.keys(KINDS);

function kindMeta(kind) {
  return KINDS[kind] || KINDS.unknown;
}

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---------------------------------------------------------------- 归类

/** 只读文件头 4 字节：PK 开头才算 zip。读不到当作不完整。 */
function headIsZip(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(4);
    const n = fs.readSync(fd, b, 0, 4, 0);
    return n >= 4 && b.readUInt32LE(0) === SIG_LH;
  } catch (_) {
    return false;
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) { /* 忽略 */ } }
  }
}

/**
 * 扫描失败时调用：按报错文本与文件头给出错误类型。
 * 不解压、不读整个文件，放在扫描热路径里也安全。
 */
function classifyParseError(message, filePath) {
  const m = String(message == null ? '' : message);
  if (/解压上限|超过解压|too large|limit exceeded/i.test(m)) return 'too-large';
  if (/超时|timeout|timed out/i.test(m)) return 'timeout';
  if (!filePath || !fs.existsSync(filePath)) return 'truncated';
  let st = null;
  try { st = fs.statSync(filePath); } catch (_) { return 'truncated'; }
  if (!st.isFile()) return 'not-3mf';
  if (st.size === 0) return 'truncated';
  return headIsZip(filePath) ? 'truncated' : 'not-3mf';
}

/** 坏文件类型对应的说明文字（写进 record.parseError，详情页「原因」用） */
const BROKEN_MESSAGES = {
  'no-model': '压缩包里没有 3D 网格，也没有切片结果',
  'missing-core': '压缩包缺少 [Content_Types].xml 或 _rels/.rels',
};

/**
 * parse3mf 的结果 → 坏文件类型；正常返回 null。扫描与「重试解析」共用这一处判断。
 * 两类情况：parse3mf 直接失败；或压缩包能打开但缺网格 / 缺核心条目。
 */
function brokenKindOf(parseResult, filePath) {
  if (!parseResult || parseResult.ok !== true) {
    return classifyParseError(parseResult && parseResult.error, filePath);
  }
  const core = parseResult.core;
  if (!core) return null;
  // core.mesh：切片盘文件里的 3dmodel.model 是空壳，只有组件引用，不算有网格
  if (!core.mesh && !core.gcode) return 'no-model';
  if (!core.contentTypes || !core.rels) return 'missing-core';
  return null;
}

// ---------------------------------------------------------------- 诊断

function isModelEntry(name) {
  const n = String(name || '').toLowerCase();
  return n === '3d/3dmodel.model' || n.endsWith('.model') || n.endsWith('.3dmodel');
}
/** 条目里真的有网格吗（切片盘文件的 3dmodel.model 是空壳，只有组件引用） */
function hasMeshContent(en) {
  if (!en || en.isDirectory) return false;
  try {
    if ((Number(en.header.size) || 0) > MAX_ENTRY_BYTES) return true;
    return /<mesh\b/.test(en.getData().toString('utf8'));
  } catch (_) { return false; }
}
function isGcodeEntry(name) {
  return /^metadata\/.*\.gcode$/i.test(String(name || ''));
}

/**
 * 完整诊断。返回：
 *   { kind, repairable, bad:[条目名], missing:{contentTypes,rels}, hasModel, hasGcode, entries }
 * kind === 'ok' 表示文件结构没问题。
 */
function diagnose3mf(filePath) {
  const out = {
    kind: 'unknown', repairable: false, bad: [],
    missing: { contentTypes: false, rels: false },
    hasModel: false, hasGcode: false, entries: 0,
  };
  if (!filePath || !fs.existsSync(filePath)) {
    out.kind = 'truncated';
    return out;
  }
  const st = fs.statSync(filePath);
  if (!st.isFile()) { out.kind = 'not-3mf'; return out; }
  if (st.size === 0) { out.kind = 'truncated'; return out; }
  if (!headIsZip(filePath)) { out.kind = 'not-3mf'; return out; }

  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch (e) {
    out.kind = 'truncated';
    out.repairable = true;      // 截断可以按本地文件头抢救，不要求一定成功
    out.detail = (e && e.message) || String(e);
    return out;
  }

  let entries;
  try { entries = zip.getEntries() || []; } catch (_) { entries = []; }
  const files = entries.filter((en) => en && !en.isDirectory);
  out.entries = files.length;
  if (!files.length) { out.kind = 'truncated'; out.repairable = true; return out; }

  const names = files.map((en) => en.entryName);
  const lower = names.map((n) => String(n).toLowerCase());
  out.missing.contentTypes = !lower.includes('[content_types].xml');
  out.missing.rels = !lower.includes('_rels/.rels');
  out.hasModel = files.some((en) => isModelEntry(en.entryName) && hasMeshContent(en));
  out.hasGcode = lower.some(isGcodeEntry);

  // 逐条目 CRC 校验（文件不大时才做；这是唯一需要解压的步骤）
  if (st.size <= MAX_DIAG_BYTES) {
    for (const en of files) {
      const declared = en.header && Number.isFinite(Number(en.header.crc)) ? Number(en.header.crc) >>> 0 : null;
      let data = null;
      try {
        if (Number(en.header.size) > MAX_ENTRY_BYTES) continue;
        data = en.getData();
      } catch (_) {
        out.bad.push(en.entryName);
        continue;
      }
      if (!data) continue;
      if (declared != null && declared !== 0 && crc32(data) !== declared) out.bad.push(en.entryName);
    }
  }

  const modelBad = out.bad.some(isModelEntry);
  if (modelBad) { out.kind = 'bad-crc'; out.repairable = false; return out; }
  if (out.bad.length) { out.kind = 'bad-crc'; out.repairable = true; return out; }
  if (out.missing.contentTypes || out.missing.rels) { out.kind = 'missing-core'; out.repairable = true; return out; }
  if (!out.hasModel && !out.hasGcode) { out.kind = 'no-model'; out.repairable = false; return out; }
  out.kind = 'ok';
  return out;
}

// ---------------------------------------------------------------- 修复

const CONTENT_TYPES_BY_EXT = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  model: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  txt: 'text/plain', json: 'application/json', stl: 'model/stl', obj: 'model/obj',
};

function buildContentTypes(names) {
  const exts = new Set();
  for (const raw of names) {
    const n = String(raw || '');
    const base = n.split('/').pop();
    const i = base.lastIndexOf('.');
    if (i > 0) exts.add(base.slice(i + 1).toLowerCase());
  }
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
  for (const e of Array.from(exts).sort()) {
    const ct = CONTENT_TYPES_BY_EXT[e] || 'application/octet-stream';
    xml += '<Default Extension="' + e + '" ContentType="' + ct + '"/>';
  }
  xml += '</Types>';
  return xml;
}

const RELS_XML = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Target="/3D/3dmodel.model" Id="rel0"'
  + ' Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
  + '</Relationships>';

/**
 * 从被截断的 zip 里按「本地文件头」逐个抢救条目。
 * 中央目录在文件末尾，截断后先没的就是它；但前面各条目的本地头与数据通常完好。
 * 返回 [{ name, data }]；读不出的条目直接跳过。
 */
function salvageLocalEntries(buf) {
  const out = [];
  const len = buf.length;
  let off = 0;
  let guard = 0;
  const findNext = (from) => {
    // 在剩余数据里找下一个本地文件头（或中央目录 / EOCD），用于跳过读不出的条目
    for (let i = from; i + 4 <= len; i++) {
      const s = buf.readUInt32LE(i);
      if (s === SIG_LH || s === SIG_EOCD || s === 0x02014b50 || s === 0x08074b50) return i;
    }
    return -1;
  };
  while (off + 30 <= len && guard++ < 200000) {
    if (buf.readUInt32LE(off) !== SIG_LH) {
      const nx = findNext(off + 1);
      if (nx < 0) break;
      off = nx;
      continue;
    }
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const nlen = buf.readUInt16LE(off + 26);
    const xlen = buf.readUInt16LE(off + 28);
    const dataStart = off + 30 + nlen + xlen;
    if (dataStart > len) break;
    const name = buf.toString('utf8', off + 30, off + 30 + nlen);
    let data = null;
    let next = -1;
    try {
      if (method === 8) {
        // 不依赖压缩长度：inflateRaw 在数据流结束处停下，bytesWritten 就是实际消耗
        const r = zlib.inflateRawSync(buf.subarray(dataStart), { info: true, maxOutputLength: MAX_ENTRY_BYTES });
        data = r.buffer;
        next = dataStart + r.engine.bytesWritten;
      } else if (method === 0) {
        const csize = buf.readUInt32LE(off + 18);
        if (flags & 8) {
          // 大小在数据描述符里：只能找描述符签名，找不到就停
          let end = -1;
          for (let i = dataStart; i + 16 <= len; i++) {
            if (buf.readUInt32LE(i) === SIG_DDSIG) { end = i; break; }
          }
          if (end < 0) break;
          data = buf.subarray(dataStart, end);
          next = end + 16;
        } else {
          if (dataStart + csize > len) break;
          data = buf.subarray(dataStart, dataStart + csize);
          next = dataStart + csize;
        }
      } else {
        // 不认识的压缩方式：跳到下一个本地头
        const nx = findNext(dataStart);
        if (nx < 0) break;
        off = nx;
        continue;
      }
    } catch (_) {
      // 解压失败（数据本身被截断）：跳到下一个能认出的头
      const nx = findNext(dataStart);
      if (nx < 0 || nx <= off) break;
      off = nx;
      continue;
    }
    if (next < 0 || next > len) break;
    // 带数据描述符的条目：描述符 12 字节，若带签名则 16 字节
    if (flags & 8) {
      let n2 = next;
      if (n2 + 4 <= len && buf.readUInt32LE(n2) === SIG_DDSIG) n2 += 16;
      else n2 += 12;
      // 校验：描述符后面应该紧跟另一个本地头 / 中央目录 / EOCD；不对就换另一种长度试
      const okAt = (p) => {
        if (p + 4 > len) return true;
        const s = buf.readUInt32LE(p);
        return s === SIG_LH || s === SIG_EOCD || s === 0x02014b50;
      };
      if (!okAt(n2)) {
        const alt = (n2 - 12) + 16;
        if (okAt(alt)) n2 = alt;
      }
      next = n2;
    }
    if (data && data.length && !/\/$/.test(name)) out.push({ name, data: Buffer.from(data) });
    if (next <= off) break;
    off = next;
    if (off + 4 <= len && buf.readUInt32LE(off) !== SIG_LH) {
      const nx = findNext(off);
      if (nx < 0) break;
      off = nx;
    }
  }
  return out;
}

function uniqueSuffix(outPath) {
  if (!fs.existsSync(outPath)) return outPath;
  const dir = path.dirname(outPath);
  const ext = path.extname(outPath);
  const base = path.basename(outPath, ext);
  for (let i = 2; i < 1000; i++) {
    const p = path.join(dir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, base + ' ' + Date.now() + ext);
}

/**
 * 尝试修复。输出到 outPath（已存在则自动加序号），原文件一个字节都不动。
 * @returns {{ok:true, outPath, skipped:String[], injected:String[], entries:Number}}
 */
function repair3mf(filePath, outPath, diagnosis = null) {
  const src = String(filePath || '');
  if (!src || !fs.existsSync(src)) throw new Error('文件不存在：' + src);
  const d = diagnosis && diagnosis.kind ? diagnosis : diagnose3mf(src);
  if (d.kind === 'ok') throw new Error('这个文件结构正常，不需要修复');
  if (!d.repairable && d.kind !== 'truncated') {
    throw new Error(kindMeta(d.kind).label + '：' + kindMeta(d.kind).hint);
  }

  let recovered = [];
  let skipped = [];
  if (d.kind === 'truncated') {
    // 截断：整文件读入后按本地头抢救。超过上限的不处理（内存安全）。
    const st = fs.statSync(src);
    if (st.size > MAX_DIAG_BYTES) throw new Error('文件过大，无法在内存里修复');
    recovered = salvageLocalEntries(fs.readFileSync(src));
  } else {
    const zip = new AdmZip(src);
    for (const en of zip.getEntries()) {
      if (!en || en.isDirectory) continue;
      if ((d.bad || []).includes(en.entryName)) { skipped.push(en.entryName); continue; }
      try { recovered.push({ name: en.entryName, data: en.getData() }); }
      catch (e) { skipped.push(en.entryName); }
    }
  }
  if (!recovered.length) throw new Error('没有能读出的内容，无法修复');

  const names = recovered.map((x) => x.name);
  const lower = names.map((n) => String(n).toLowerCase());
  if (!lower.some(isModelEntry)) throw new Error('修复后仍没有 3D 网格，无法修复');

  const injected = [];
  if (!lower.includes('[content_types].xml')) {
    recovered.unshift({ name: '[Content_Types].xml', data: Buffer.from(buildContentTypes(names), 'utf8') });
    injected.push('[Content_Types].xml');
  }
  if (!lower.includes('_rels/.rels')) {
    recovered.unshift({ name: '_rels/.rels', data: Buffer.from(RELS_XML, 'utf8') });
    injected.push('_rels/.rels');
  }

  const zip = new AdmZip();
  for (const it of recovered) zip.addFile(it.name, it.data);
  const finalPath = uniqueSuffix(outPath);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  zip.writeZip(finalPath);

  // 自检：修完的文件必须能被解析
  const check = parse3mfSync(finalPath);
  if (!check.ok) {
    try { fs.unlinkSync(finalPath); } catch (_) { /* 留着也无妨 */ }
    throw new Error('修复后的文件仍无法读取：' + (check.error || '未知原因'));
  }
  return { ok: true, outPath: finalPath, skipped, injected, entries: recovered.length };
}

/** parse3mf 是 async 的；这里同步等结果（同步上下文里用） */
function parse3mfSync(filePath) {
  const r = { ok: false, error: null };
  try {
    const zip = new AdmZip(filePath);
    const names = zip.getEntries().map((e) => String(e.entryName || '').toLowerCase());
    const hasModel = names.some(isModelEntry);
    if (!hasModel) return { ok: false, error: '没有 3D 网格' };
    // 内容可读性：随便解一个条目确认数据区没问题
    const first = zip.getEntries().find((e) => e && !e.isDirectory);
    if (first) first.getData();
    r.ok = true;
  } catch (e) {
    r.error = (e && e.message) || String(e);
  }
  return r;
}

// ---------------------------------------------------------------- 文件移动

/** 移动文件；跨盘 rename 会失败，退回复制 + 删除。目标已存在则加序号。 */
function moveFile(src, dst) {
  const finalPath = uniqueSuffix(dst);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  try {
    fs.renameSync(src, finalPath);
  } catch (e) {
    if (e && (e.code === 'EXDEV' || e.code === 'EPERM' || /cross-device|different/i.test(String(e.message)))) {
      fs.copyFileSync(src, finalPath);
      fs.unlinkSync(src);
    } else {
      throw e;
    }
  }
  return finalPath;
}

// ---------------------------------------------------------------- 列表

/** 隔离区列表：解析失败的记录（含已隔离）。不读磁盘，直接用记录里的标记。 */
function brokenItems(library) {
  const models = (library && library.models) || {};
  const items = [];
  for (const r of Object.values(models)) {
    if (!r || !r.parseErrorKind) continue;
    if (r.aliasOf) continue;                 // 别名跟随主记录，不单独列
    if (r.status === 'missing') continue;    // 文件不在了归「失效文件」管
    const meta = kindMeta(r.parseErrorKind);
    items.push({
      id: r.id,
      fileName: r.fileName || r.title || '',
      path: r.path || '',
      size: r.size,
      mtime: r.mtime,
      createdAt: r.createdAt,
      thumbnail: r.thumbnail || null,
      kind: r.parseErrorKind,
      kindLabel: meta.label,
      hint: meta.hint,
      repairable: !!meta.repairable || r.parseErrorKind === 'timeout',
      message: r.parseError || '',
      quarantined: r.status === 'quarantined',
      quarantinedAt: r.quarantinedAt || null,
      hasMeta: !!(r.meta && (r.meta.hasThumbnail || r.meta.title)),
    });
  }
  items.sort((a, b) => (a.quarantined - b.quarantined) || ((b.createdAt || 0) - (a.createdAt || 0)));
  const byKind = {};
  for (const it of items) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
  return {
    items,
    summary: {
      total: items.length,
      quarantined: items.filter((i) => i.quarantined).length,
      repairable: items.filter((i) => i.repairable && !i.quarantined).length,
      bytes: items.reduce((s, i) => s + (Number(i.size) || 0), 0),
      byKind,
    },
  };
}

module.exports = {
  KINDS, KIND_KEYS, kindMeta, BROKEN_MESSAGES, brokenKindOf,
  classifyParseError, diagnose3mf, repair3mf, salvageLocalEntries,
  crc32, moveFile, uniqueSuffix, brokenItems,
};
