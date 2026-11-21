'use strict';
/**
 * 本地数据目录解析。所有数据 100% 落在本机，默认位于项目 data/ 下，
 * 便于用户直接查看、复制与备份；测试可通过 PRINTSHELF_DATA_DIR 覆盖。
 */
const path = require('path');
const fs = require('fs');

let _override = null;

function getProjectRoot() {
  // __dirname = <root>/src/core
  return path.resolve(__dirname, '..', '..');
}

function getDataDir() {
  if (_override) return _override;
  if (process.env.PRINTSHELF_DATA_DIR) return path.resolve(process.env.PRINTSHELF_DATA_DIR);
  return path.join(getProjectRoot(), 'data');
}

function setDataDir(dir) {
  _override = dir ? path.resolve(dir) : null;
  if (dir) ensureDirs();
}

function getLibraryPath() { return path.join(getDataDir(), 'library.json'); }
function getSettingsPath() { return path.join(getDataDir(), 'settings.json'); }
function getThumbsDir() { return path.join(getDataDir(), 'thumbs'); }
function getBackupDir() { return path.join(getDataDir(), 'backups'); }
function getLogDir() { return path.join(getDataDir(), 'logs'); }
// 耗材库 / 打印回执：独立文件，用户确认不进现有 library 备份机制（2026-11-16）
function getFilamentsPath() { return path.join(getDataDir(), 'filaments.json'); }
function getFilamentImagesDir() { return path.join(getDataDir(), 'filament-img'); }
function getReceiptsPath() { return path.join(getDataDir(), 'receipts.json'); }

function ensureDirs() {
  for (const d of [getDataDir(), getThumbsDir(), getBackupDir(), getLogDir(), getFilamentImagesDir()]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) { /* 只读环境忽略 */ }
  }
}

module.exports = {
  getProjectRoot, getDataDir, setDataDir, ensureDirs,
  getLibraryPath, getSettingsPath, getThumbsDir, getBackupDir, getLogDir,
  getFilamentsPath, getFilamentImagesDir, getReceiptsPath,
};
