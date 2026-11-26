'use strict';
/**
 * G · 以图搜图（docs/22 G）。
 * 纯 Node：dHash 计算 + 索引文件读写；解码图片在主进程 services 里做（nativeImage），
 * core 不碰 Electron。索引独立文件 img-hash.json，不进 library.json。
 */

const fs = require('fs');
const path = require('path');
const U = require('./utils');

const ALGO = 'dhash64';
const SIZE_W = 9;
const SIZE_H = 8;

/** 把 9×8 的灰度数组算成 64 bit dHash（十六进制字符串） */
function dhashFromGray(gray) {
  if (!gray || gray.length < SIZE_W * SIZE_H) throw new Error('灰度数据不足 9×8');
  let bits = '';
  for (let y = 0; y < SIZE_H; y++) {
    for (let x = 0; x < SIZE_W - 1; x++) {
      const i = y * SIZE_W + x;
      bits += gray[i] >= gray[i + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** BGRA/BGR 缓冲（Electron nativeImage.toBitmap 是 BGRA）转 9×8 灰度 */
function grayFromBitmap(bitmap, width, height, opts) {
  const o = opts || {};
  const channels = o.channels || 4;
  const order = o.order || 'bgra';          // 'bgra' | 'rgba' | 'gray'
  if (!bitmap || !width || !height) throw new Error('位图为空');
  const gray = new Uint8Array(SIZE_W * SIZE_H);
  for (let y = 0; y < SIZE_H; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / SIZE_H));
    for (let x = 0; x < SIZE_W; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / SIZE_W));
      let v;
      if (order === 'gray') {
        v = bitmap[sy * width + sx];
      } else {
        const i = (sy * width + sx) * channels;
        if (order === 'rgba') v = 0.299 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.114 * bitmap[i + 2];
        else v = 0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2];  // BGRA
      }
      gray[y * SIZE_W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return gray;
}

function popcount(n) { let c = 0; while (n) { n &= n - 1; c++; } return c; }

function hamming(a, b) {
  const sa = String(a || ''), sb = String(b || '');
  if (sa.length !== 16 || sb.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) {
    d += popcount(parseInt(sa[i], 16) ^ parseInt(sb[i], 16));
  }
  return d;
}

class ImageHashIndex {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, algo: ALGO, items: {} };
    this._queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j && j.items && typeof j.items === 'object') this.data = { version: 1, algo: ALGO, items: j.items };
    } catch (_) { this.data = { version: 1, algo: ALGO, items: {} }; }
  }

  async flush() {
    const job = this._queue.then(async () => {
      const tmp = this.file + '.tmp';
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, algo: ALGO, updatedAt: U.now(), items: this.data.items }));
      try { await fs.promises.rename(tmp, this.file); }
      catch (_) { await fs.promises.copyFile(tmp, this.file); try { await fs.promises.unlink(tmp); } catch (_) { /* 忽略 */ } }
    });
    this._queue = job.catch(() => {});
    return job;
  }

  size() { return Object.keys(this.data.items).length; }
  get(id) { return this.data.items[id] || null; }
  has(id) { return !!(this.data.items[id] && this.data.items[id].h); }

  async set(id, hash, meta) {
    if (!hash) throw new Error('没有可写入的指纹');
    this.data.items[String(id)] = { h: String(hash), at: U.now(), w: meta && meta.w, h2: meta && meta.h };
  }

  async remove(ids) {
    for (const id of ids || []) delete this.data.items[id];
  }

  async prune(validIds) {
    const keep = new Set(validIds || []);
    let removed = 0;
    for (const id of Object.keys(this.data.items)) {
      if (!keep.has(id)) { delete this.data.items[id]; removed++; }
    }
    return removed;
  }

  /** 找相似：返回 [{id, distance, score}]，按距离升序 */
  nearest(hash, limit, maxDistance) {
    const lim = Math.max(1, Math.min(200, Number(limit) || 20));
    const maxD = Number.isFinite(Number(maxDistance)) ? Number(maxDistance) : 12;
    if (!hash) return [];
    const rows = [];
    for (const [id, it] of Object.entries(this.data.items)) {
      if (!it || !it.h) continue;
      const d = hamming(hash, it.h);
      if (d > maxD) continue;
      rows.push({ id, distance: d, score: Math.round((1 - d / 64) * 1000) / 1000 });
    }
    rows.sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));
    return rows.slice(0, lim);
  }
}

module.exports = {
  ImageHashIndex, dhashFromGray, grayFromBitmap, hamming, ALGO, SIZE_W, SIZE_H,
};
