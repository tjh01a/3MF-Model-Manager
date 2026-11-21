/**
 * 一次性维护脚本：把「误把快造转换缓存当模型入库」的记录清出索引。
 * 只删索引记录，磁盘上的缓存文件保留（它们本来就是我们自己的产物）。
 *
 *   node tools/clean-cache-records.js [--dry]
 */
const path = require('path');
const Store = require('../src/core/store');
const Library = require('../src/core/library');
const corePaths = require('../src/core/paths');

(async () => {
  const dry = process.argv.includes('--dry');
  const store = new Store({});
  await store.init();
  const lib = new Library({ store });

  const cacheDir = path.join(corePaths.getDataDir(), 'u1-cache').toLowerCase();
  const byKey = (p) => String(p || '').toLowerCase();
  const bad = Object.values(store.getLibrary().models || {})
    .filter((m) => byKey(m.path).startsWith(cacheDir + path.sep));

  console.log('数据目录:', corePaths.getDataDir());
  console.log('缓存目录:', cacheDir);
  console.log('命中记录:', bad.length);
  for (const m of bad) console.log('  -', m.title, '|', m.path);

  if (!bad.length) return;
  if (dry) { console.log('（--dry 只报告，不改动）'); return; }

  const ids = bad.map((m) => m.id);
  await lib.remove(ids);
  const after = Object.values(store.getLibrary().models || {})
    .filter((m) => byKey(m.path).startsWith(cacheDir + path.sep));
  console.log('已移除', ids.length, '条，剩余命中', after.length);
})().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
