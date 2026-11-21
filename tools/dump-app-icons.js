/**
 * 调试工具：把三个切片软件的 exe 图标导出成 PNG，用来核对悬浮菜单里显示的是不是真图标。
 *   node_modules/electron/dist/electron.exe tools/dump-app-icons.js
 *
 * 只读 exe，不修改任何东西；产物写到 data/reg/final/icon-*.png。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'reg', 'final');
const TARGETS = {
  bambu: 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe',
  orca: 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe',
  snapmaker: 'C:\\Program Files\\Snapmaker_Orca\\snapmaker-orca.exe',
};

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [key, exe] of Object.entries(TARGETS)) {
    if (!fs.existsSync(exe)) { console.log(key, 'missing:', exe); continue; }
    try {
      const img = await app.getFileIcon(exe, { size: 'large' });
      if (!img || img.isEmpty()) { console.log(key, 'empty icon'); continue; }
      const file = path.join(OUT, 'icon-' + key + '.png');
      fs.writeFileSync(file, img.toPNG());
      const s = img.getSize();
      console.log(key, '->', file, s.width + 'x' + s.height, fs.statSync(file).size + ' bytes');
    } catch (e) {
      console.log(key, 'failed:', e.message);
    }
  }
  app.exit(0);
});
