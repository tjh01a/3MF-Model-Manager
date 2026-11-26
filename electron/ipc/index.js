'use strict';
/**
 * 全部 IPC handler。channel 统一为 'shelf:<方法名>'，与 preload 的 METHODS 表一一对应。
 * 约定：失败直接 throw（message 为可读中文），由渲染层 api.js 统一转成 Toast。
 */
const { ipcMain, dialog, shell, clipboard, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const cpaths = require('../../src/core/paths');
const U = require('../../src/core/utils');
const classify = require('../../src/core/classify');
const { cnMakerWorldUrl, resolveRecordSource } = require('../../src/core/source-urls');
const camera = require('../../src/core/camera');

/**
 * IPC 错误统一中文包装：core 层抛出的原始错误常是英文（ENOENT / ECONNREFUSED /
 * Unexpected token ...），个别还带整段 stack。渲染层只负责弹 Toast，这里先变成人话，
 * 只保留第一行，杜绝把英文堆栈直接甩给用户；业务自己写好的中文提示原样透传。
 */
const NODE_ERR_CN = {
  ENOENT: '找不到指定的文件或目录',
  EACCES: '没有访问权限',
  EPERM: '操作被系统拒绝',
  EEXIST: '目标已存在',
  ENOTDIR: '路径不是目录',
  EISDIR: '目标是目录而不是文件',
  ECONNREFUSED: '连接被拒绝，请检查设备是否在线',
  ETIMEDOUT: '连接超时，请检查网络或设备',
  ENOTFOUND: '找不到主机，请检查地址是否正确',
  EINVAL: '参数无效',
};
function toUserError(e) {
  let raw = (e && e.message) ? e.message : String(e || '');
  raw = String(raw).replace(/^Error:\s*/, '').split('\n')[0].trim();
  if (!raw) return new Error('操作失败，请稍后重试');
  if (/[\u4e00-\u9fa5]/.test(raw)) return new Error(raw);
  const code = /^([A-Z]{2,})\b/.exec(raw);
  if (code && NODE_ERR_CN[code[1]]) {
    return new Error('操作失败：' + NODE_ERR_CN[code[1]] + '（' + raw + '）');
  }
  return new Error('操作失败：' + raw);
}

/**
 * MakerWorld 中国站与国际站是两套**独立的模型库**，同一个作品的 ID 不一样
 * （实测：国际站 models/3377037 在中国站返回「模型不存在」）。
 * 所以不能自动换域名，也不能靠 HTTP 状态码探测（两站对非浏览器请求都返回 403）。
 * 这里只按用户的设置决定：开启「优先中国站」才换域名，换完是否存在由站点自己提示。
 */

/**
 * 统一取一帧：显式 cameraUrl 优先，其次按机型走各自的通道。
 * 返回值里带 staleSec —— U1 的 monitor.jpg 会停更（摄像头没插/没启动时），
 * 界面必须如实显示「画面停在几点」，而不是把旧画面当实时。
 */
async function takeCamShot(p) {
  if (p.cameraUrl) {
    const r = await camera.httpFrame(p.cameraUrl);
    if (!r.ok) throw new Error(r.error || '取画面失败');
    return { buf: r.frames[0], staleSec: 0, source: 'url' };
  }
  if (p.kind === 'bambu') {
    const r = await camera.captureFrame({ host: p.ip, accessCode: p.accessCode });
    if (!r.ok) throw new Error(r.error || '取画面失败');
    return { buf: r.frames[0], staleSec: 0, source: 'bambu' };
  }
  // 快造 U1：优先主动抓拍一张真实时画面（G-code 触发摄像头服务）。
  // 抓不到再退回打印机上的 monitor.jpg，并由 staleSec/static 如实标注。
  const opts = { host: p.ip, port: p.cameraPort, cameraUrl: p.cameraUrl };
  const live = await camera.snapmakerLiveFrame(opts);
  if (live.ok) {
    return { buf: live.frames[0], staleSec: live.staleSec || 0, source: 'u1-live', static: false };
  }
  const r = await camera.snapmakerFrame(opts);
  if (!r.ok) throw new Error(r.error || '取画面失败');
  return {
    buf: r.frames[0], staleSec: r.staleSec || 0,
    source: r.source || '', static: !!r.static,
    notice: live.error || '',
  };
}

function registerIpc(services, { getWindow = () => null } = {}) {
  const lib = () => services.library;
  const store = () => services.store;
  const win = () => getWindow() || BrowserWindow.getFocusedWindow();

  /** 写操作前自动快照，供 api.undo() / Ctrl+Z 使用 */
  const snap = (ids) => { try { services.snapshot(ids); } catch (_) { /* 不影响主流程 */ } };

  const handlers = {
    // ---------------- 应用 ----------------
    bootstrap: () => services.bootstrap(),
    getInfo: () => services.getInfo(),
    openDataDir: async () => {
      const dir = cpaths.getDataDir();
      cpaths.ensureDirs();
      const err = await shell.openPath(dir);
      if (err) throw new Error('打开数据目录失败：' + err);
      return dir;
    },
    win: (action) => {
      const w = getWindow();
      if (!w) return;
      if (action === 'min') w.minimize();
      else if (action === 'reload') w.reload();
      else if (action === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
      else if (action === 'close') w.close();
    },
    openExternal: async (url) => {
      const u = String(url || '');
      if (!/^https?:\/\//i.test(u)) throw new Error('仅支持打开 http/https 链接');
      let target = u;
      try {
        const s = store().getSettings() || {};
        if (!s.ui || s.ui.makerWorldCn !== false) target = cnMakerWorldUrl(u) || u;
      } catch (_) { /* 读设置失败就按原链接打开 */ }
      await shell.openExternal(target);
    },

    /**
     * 按当前站点设置打开某条模型的来源页。
     * 两站模型 ID 不通用：优先用 DesignModelId 查目标站；查不到就回退另一站，
     * 并通过 fallback 告诉渲染层弹一句提示，而不是把用户丢到 404 页面。
     */
    openSource: async (id) => {
      const st = store();
      const rec = (st.getLibrary() || {}).models || {};
      const model = rec[String(id)];
      if (!model) throw new Error('模型不存在或已被移除');
      const s = st.getSettings() || {};
      const ui = s.ui || {};
      const region = ui.makerWorldRegion === 'cn' || ui.makerWorldRegion === 'global'
        ? ui.makerWorldRegion
        : (/^zh/i.test(String(ui.language || 'zh-CN')) ? 'cn' : 'global');

      let r = await resolveRecordSource(st, model, region);
      let fallback = null;
      let url = r.url;
      if (!url) {
        const other = region === 'cn' ? 'global' : 'cn';
        r = await resolveRecordSource(st, model, other);
        if (r.url) { url = r.url; fallback = other; }
      }
      if (!url && model.sourceUrl && /^https?:\/\//i.test(model.sourceUrl)) url = model.sourceUrl;
      if (!url) throw new Error('这条模型没有可用的来源链接');
      await shell.openExternal(url);
      return { url, region, fallback };
    },

    // ---------------- 查询 ----------------
    query: (q) => lib().query(q || {}),
    nlParse: (text) => services.nlParse(text || ''),
    // I · 周报 / 成就 / 护照
    weeklyReport: (weekOffset) => services.weeklyReport(weekOffset),
    achievementsList: (opts) => services.achievementsList(opts || {}),
    passportGet: (id) => services.passportGet(id),
    passportUpdate: (id, patch) => services.passportUpdate(id, patch || {}),
    passportCsv: () => services.passportCsv(),
    // G · 以图搜图
    imgHashStatus: () => services.imgHashStatus(),
    imgHashRun: (opts) => services.imgHashRun(opts || {}),
    imgHashStop: () => services.imgHashStop(),
    imgFindSimilar: (payload) => services.imgFindSimilar(payload || {}),
    imgPickFile: async () => {
      const r = await dialog.showOpenDialog(win(), {
        title: '选择要搜索的图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile'],
      });
      return (r && !r.canceled && r.filePaths && r.filePaths[0]) ? r.filePaths[0] : null;
    },
    get: (id) => lib().get(id),
    stats: () => lib().stats(),
    smartCounts: () => lib().smartCounts(),
    roulette: () => lib().roulette(),

    // ---------------- 模型写操作 ----------------
    update: async (id, patch) => { snap([id]); return lib().update(id, patch); },
    bulk: async (ids, patch) => { snap(ids); return lib().bulk(ids, patch); },
    rename: async (id, t) => { snap([id]); return lib().rename(id, t); },
    renameFile: (id, name) => lib().renameFile(id, name),
    remove: async (ids) => { snap(ids); return lib().remove(ids); },
    setPrintStatus: async (ids, status) => { snap(ids); return lib().setPrintStatus(ids, status); },
    markOpened: (id) => lib().markOpened(id),
    relink: async (id, p) => { snap([id]); return lib().relink(id, p); },
    findRelinkCandidates: (id) => lib().findRelinkCandidates(id),
    undo: () => services.undo(),

    // 移入回收站：成功后才移出索引。与隔离区、智能合并共用 services 里的同一份实现。
    trash: (ids) => services.trashIds(ids),

    // ---------------- 整理 · B 隔离区 / C 智能合并 / A 几何指纹 ----------------
    brokenList: () => services.brokenList(),
    brokenRetry: (ids) => services.brokenRetry(ids),
    brokenRepair: (id, opts) => services.brokenRepair(id, opts || {}),
    brokenQuarantine: (ids) => services.brokenQuarantine(ids),
    brokenRestore: (ids) => services.brokenRestore(ids),
    brokenForget: (ids) => services.brokenForget(ids),
    shapeStatus: () => services.shapeStatus(),
    shapeRun: (opts) => services.shapeRun(opts || {}),
    shapeStop: () => services.shapeStop(),
    dupMergePreview: () => services.mergePreview(),
    dupMergeApply: (selection, opts) => services.mergeApply(selection || {}, opts || {}),
    dupAliases: (id) => services.aliasesOf(id),
    aliasDetach: (ids) => services.aliasDetach(ids),

    reveal: async (idOrPath) => {
      const rec = lib().get(idOrPath);
      const p = rec ? rec.path : U.normalizePath(String(idOrPath || ''));
      if (!p || !fs.existsSync(p)) throw new Error('文件不存在：' + (p || '未知路径'));
      shell.showItemInFolder(p);
    },
    copyPath: (id) => {
      const rec = lib().get(id);
      if (!rec) throw new Error('找不到该模型');
      clipboard.writeText(rec.path);
      return rec.path;
    },

    // ---------------- 分类 / 标签 / 视图 ----------------
    categories: () => lib().categories(),
    categoryCreate: (p) => lib().categoryCreate(p),
    categoryUpdate: (id, p) => lib().categoryUpdate(id, p),
    // 预设词库自动分类（docs/12）：force 忽略总开关，用户显式点「立即分类」时用
    classifyRun: () => classify.classifyUncategorized(store(), { force: true }),
    classifySkipUnmatched: (ids) => classify.skipUnmatched(store(), ids),
    classifyUndo: () => classify.undoAutoClassified(store()),
    classifyPreset: () => classify.presetRules((store().getLibrary() || {}).categories || [], ((store().getSettings() || {}).ui || {}).language),
    categoryDelete: async (id, moveTo = null) => { snap(Object.keys(store().getLibrary().models || {})); return lib().categoryDelete(id, moveTo); },
    tags: () => lib().tags(),
    tagCreate: (p) => lib().tagCreate(p),
    tagUpdate: (id, p) => lib().tagUpdate(id, p),
    tagDelete: async (id) => { snap(Object.keys(store().getLibrary().models || {})); return lib().tagDelete(id); },
    tagAssign: async (ids, tagIds, mode) => { snap(ids); return lib().tagAssign(ids, tagIds, mode); },
    views: () => lib().views(),
    viewSave: (p) => lib().viewSave(p),
    viewDelete: (id) => lib().viewDelete(id),

    // ---------------- 扫描与目录 ----------------
    scanStart: (opts) => services.scanStart(opts || {}),
    scanCancel: () => { services.scanner.cancel(); return { ok: true }; },
    scanStatus: () => services.scanStatus(),
    folders: () => services.folders(),
    drivesList: () => services.drivesList(),
    folderAdd: (p) => services.folderAdd(p),
    folderUpdate: (id, p) => services.folderUpdate(id, p),
    folderRemove: (id) => services.folderRemove(id),
    watchRefresh: () => { services.refreshWatch(); return { ok: true }; },

    // ---------------- 缩略图 ----------------
    thumbRegenerate: (ids, force) => services.thumbRegenerate(ids, force),
    thumbStats: () => services.thumbs.stats(),
    thumbPrune: () => services.thumbs.prune(),

    // ---------------- 切片软件 ----------------
    slicers: () => services.slicer.list(),
    slicerDetect: () => services.slicer.detect(),
    slicerAdd: (p) => services.slicer.add(p),
    slicerUpdate: (id, p) => services.slicer.update(id, p),
    slicerRemove: (id) => services.slicer.remove(id),
    slicerSetDefault: (id) => services.slicer.setDefault(id),
    slicerValidate: (p) => services.slicer.validate(p),
    slicerOpen: (ids, second) => {
      const opts = typeof second === 'string'
        ? { slicerId: second }
        : (second && typeof second === 'object' ? second : {});
      return services.slicer.open(ids, opts);
    },

    // ---------------- 快造 U1 转换 ----------------
    u1Status: () => services.u1Status(),
    u1Convert: (id, opts) => services.u1Convert(id, opts || {}),
    u1Cancel: () => services.u1Cancel(),
    u1ClearCache: (days) => services.u1ClearCache(days),
    u1PresetsInvalidate: () => services.u1PresetsInvalidate(),
    u1OpenCache: async () => {
      const dir = services.u1.ensureCacheDir();
      const err = await shell.openPath(dir);
      if (err) throw new Error('打开转换缓存目录失败：' + err);
      return dir;
    },
    /** which: 'bambu' = 原文件直接开；'snapmaker' = 先转换再开产物 */
    openWith: (ids, which) => services.openWith(ids, which),

    // ---------------- 打印机管理 ----------------
    printersList: () => services.printersList(),
    printersSnapshot: () => services.printersSnapshot(),
    printerAdd: (cfg) => services.printerAdd(cfg),
    printerUpdate: (id, patch) => services.printerUpdate(id, patch),
    printerRemove: (id) => services.printerRemove(id),
    printerTest: (id) => services.printerTest(id),
    printerAction: (id, cmd) => services.printerAction(id, cmd),

    /**
     * 机内摄像头单帧。
     *   · 用户填了 cameraUrl → 任何机型都走 HTTP（快照 / MJPEG）
     *   · 拓竹 A1/P1 → TCP 6000 帧流
     *   · 快造 U1 → Moonraker webcam，或 camera/monitor.jpg 快照
     */
    cameraFrame: async (id) => {
      const p = services.printers.get(id);
      if (!p) throw new Error('设备不存在');
      const shot = await takeCamShot(p);
      return {
        ok: true,
        base64: shot.buf.toString('base64'),
        staleSec: shot.staleSec || 0,
        source: shot.source || '',
        static: !!shot.static,
        notice: shot.notice || '',
      };
    },

    /** 打印机检测：抓两帧、间隔 3 秒，供人眼对比有没有拉丝/空打/翘边 */
    cameraDetect: async (id) => {
      const p = services.printers.get(id);
      if (!p) throw new Error('设备不存在');
      if (p.kind === 'bambu' && !p.cameraUrl) {
        const r = await camera.captureTwo({ host: p.ip, accessCode: p.accessCode, gapMs: 3000 });
        if (!r.ok) throw new Error(r.error || '取画面失败');
        return { ok: true, shots: r.frames.map((b) => b.toString('base64')), staleSec: 0, source: 'bambu' };
      }
      // 快造 U1：两次都是主动抓拍，而不是同一张静态快照
      if (p.kind === 'snapmaker' && !p.cameraUrl) {
        const live = await camera.snapmakerLiveTwo({ host: p.ip, port: p.cameraPort, gapMs: 3000 });
        if (live.ok) {
          return {
            ok: true, shots: live.frames.map((b) => b.toString('base64')),
            staleSec: 0, source: 'u1-live', static: false,
          };
        }
      }
      const a = await takeCamShot(p);
      await new Promise((r) => setTimeout(r, 3000));
      const b = await takeCamShot(p);
      return {
        ok: true,
        shots: [a.buf.toString('base64'), b.buf.toString('base64')],
        staleSec: b.staleSec || 0,
        source: b.source || '',
        static: !!b.static,
      };
    },
    printersDiscover: (opts) => services.printersDiscover(opts),

    // ---------------- 打印监控（docs/09 A.14） ----------------
    monitorHistory: (id, limit) => services.monitorHistory(id, limit),
    monitorChart: (id, sessionId) => services.monitorChart(id, sessionId),
    monitorLatest: (id) => services.monitorLatest(id),
    monitorStatus: () => services.monitorStatus(),
    monitorClear: (id) => services.monitorClear(id),
    /** 设置页「发一条测试通知」：走和真实通知完全相同的出口 */
    notifyTest: () => services.notifyTest(),

    // ---------------- 13 · 耗材库 / 打印回执 / 成本账本 ----------------
    filamentsList: () => services.filamentsList(),
    // D · 库存
    stockOverview: () => services.stockOverview(),
    stockStatus: (filamentId) => services.stockStatus(filamentId),
    stockLog: (limit) => services.stockLog(limit),
    stockAdjust: (payload) => services.stockAdjust(payload || {}),
    stockUndo: (id) => services.stockUndo(id),
    stockLowList: () => services.stockLowList(),
    stockShoppingList: () => services.stockShoppingList(),
    stockShoppingCsv: () => services.stockShoppingCsv(),
    filamentCreate: (data) => services.filamentCreate(data || {}),
    filamentUpdate: (id, patch) => services.filamentUpdate(id, patch || {}),
    filamentRemove: (id) => services.filamentRemove(id),
    filamentSetDefault: (id) => services.filamentSetDefault(id),
    filamentPickImage: async () => {
      const r = await dialog.showOpenDialog(win(), {
        title: '选择耗材图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
        properties: ['openFile'],
      });
      return (r && !r.canceled && r.filePaths && r.filePaths[0]) ? r.filePaths[0] : null;
    },
    filamentSetImage: (id, filePath) => services.filamentSetImage(id, filePath),
    filamentReadImage: (filePath) => services.filamentReadImage(filePath),
    filamentSetImageData: (id, dataUrl) => services.filamentSetImageData(id, dataUrl),
    filamentsOpenDir: async () => {
      const dir = cpaths.getFilamentImagesDir();
      cpaths.ensureDirs();
      const err = await shell.openPath(dir);
      if (err) throw new Error('打开耗材图片目录失败：' + err);
      return dir;
    },
    modelCost: (id) => services.modelCost(id),
    modelsCosts: () => services.modelsCosts(),
    modelSetFilaments: (id, links, weightG) => services.modelSetFilaments(id, links, weightG),
    receiptsList: (limit) => services.receiptsList(limit),
    receiptsWithModels: (limit) => services.receiptsWithModels(limit),
    receiptsClear: () => services.receiptsClear(),
    receiptsDelete: (ids) => services.receiptsDelete(ids),
    receiptsLinkModel: (id, modelId) => services.receiptsLinkModel(id, modelId),
    receiptsAutoLink: () => services.receiptsAutoLink(),

    // 拓竹云账号
    bambuCloudStatus: () => services.bambuCloudStatus(),
    bambuCloudLogin: (o) => services.bambuCloudLogin(o || {}),
    bambuCloudLoginCode: (o) => services.bambuCloudLoginCode(o || {}),
    bambuCloudLogout: () => services.bambuCloudLogout(),
    bambuCloudSync: () => services.bambuCloudSync(),

    // ---------------- 快造预设保护 ----------------
    u1PresetHealth: () => services.u1PresetHealth(),
    u1PresetSnapshot: () => services.u1PresetSnapshot(),
    u1PresetRestore: (id) => services.u1PresetRestore(id),
    u1OpenPresetBackups: async () => {
      const dir = services.presetguard.backupRoot();
      fs.mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      if (err) throw new Error('打开预设备份目录失败：' + err);
      return dir;
    },

    // ---------------- .3mf 文件关联 ----------------
    fileAssocReport: () => services.fileAssocReport(),
    fileAssocOpenSettings: () => services.fileAssocOpenSettings(),
    fileAssocRepair: (target) => services.fileAssocRepair(target),

    // ---------------- 设置 ----------------
    settings: () => store().getSettings(),
    settingsUpdate: (patch) => store().updateSettings(patch),

    // ---------------- 系统对话框 ----------------
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(win(), {
        title: '选择要监控的模型文件夹',
        properties: ['openDirectory'],
      });
      return (r && !r.canceled && r.filePaths && r.filePaths[0]) || null;
    },
    pickExe: async () => {
      const r = await dialog.showOpenDialog(win(), {
        title: '选择切片软件可执行文件',
        properties: ['openFile'],
        filters: [{ name: '可执行程序', extensions: ['exe', 'bat', 'cmd', 'com'] }],
      });
      return (r && !r.canceled && r.filePaths && r.filePaths[0]) || null;
    },
    pickJson: async () => {
      const r = await dialog.showOpenDialog(win(), {
        title: '选择要导入的 PrintShelf 索引文件',
        properties: ['openFile'],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });
      return (r && !r.canceled && r.filePaths && r.filePaths[0]) || null;
    },
    saveJson: async (defaultName) => {
      const r = await dialog.showSaveDialog(win(), {
        title: '导出本地索引',
        defaultPath: path.join(require('os').homedir(), 'Desktop', defaultName || 'printshelf-export.json'),
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });
      return (r && !r.canceled && r.filePath) || null;
    },

    // ---------------- 模型体检 / 优化（源文件只读，输出新 3MF） ----------------
    meshInspect: (id) => services.meshInspect(id),
    meshBlender: () => services.meshBlender(),
    meshBlenderSet: (p) => services.meshBlenderSet(p),
    meshOptimize: (o) => services.meshOptimize(o || {}),
    meshCancel: () => services.meshCancel(),
    meshAddToLibrary: (p) => services.meshAddToLibrary(p),

    // ---------------- 数据管理 ----------------
    backups: () => store().listBackups(),
    backup: () => store().backup('manual'),
    restore: (name) => store().restoreBackup(name),
    exportData: (p) => {
      if (!p) throw new Error('未指定导出路径');
      return lib().exportJson(p);
    },
    importData: async (p, merge = true) => {
      if (!p || !fs.existsSync(p)) throw new Error('导入文件不存在：' + (p || '未指定'));
      snap(Object.keys(store().getLibrary().models || {}));
      const r = await lib().importJson(p, merge !== false);
      services.emitToRenderer('lib:changed', { reason: 'import' });
      return r;
    },
  };

  for (const [name, fn] of Object.entries(handlers)) {
    const channel = 'shelf:' + name;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        throw toUserError(e);
      }
    });
  }

  return Object.keys(handlers);
}

module.exports = { registerIpc };
