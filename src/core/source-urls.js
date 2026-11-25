'use strict';
/**
 * 回填「来源网页」：老记录入库时还没有这个字段，3MF 里其实一直带着
 * （Bambu Studio「项目信息」里那个可点的链接，存在 Description 富文本里）。
 *
 * 只处理 sourceUrl 为空、状态 ok、文件还在的记录；只读 meta，不解缩略图。
 * 并发 4 个，整批写一次库。
 */
const { parse3mf, isModelPage } = require('./model3mf');

const CONCURRENCY = 4;

async function backfillSourceUrls(store) {
  if (!store || typeof store.getLibrary !== 'function') return { scanned: 0, updated: 0 };

  // 只清理「自动填的、而且不是作品页」的值（早年没有校验时写进去的图片 CDN、
  // 作者主页、工具页）。用户手填的链接没有 sourceUrlAuto 标记，一律不碰。
  const lib0 = store.getLibrary() || {};
  const broken = Object.values(lib0.models || {}).filter(
    (m) => m && m.sourceUrl && m.sourceUrlAuto === true && !isModelPage(m.sourceUrl)
  );
  let cleaned = 0;
  if (broken.length) {
    await store.updateLibrary((target) => {
      for (const m of broken) {
        const rec = target.models && target.models[m.id];
        if (rec && rec.sourceUrlAuto === true && !isModelPage(rec.sourceUrl)) {
          rec.sourceUrl = '';
          rec.sourceUrlAuto = false;
          cleaned++;
        }
      }
    }, 'source-url-clean');
  }

  const lib = store.getLibrary() || {};
  const models = lib.models || {};
  const todo = Object.values(models).filter((m) => m && !m.sourceUrl && m.status === 'ok' && m.path);
  if (!todo.length) return { scanned: 0, updated: 0, cleaned };

  const hits = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const m = todo[cursor++];
      try {
        const r = await parse3mf(m.path, { withThumbnail: false, withMeta: true });
        const meta = (r && r.meta) || {};
        let url = meta.sourceUrl || null;
        // 描述里没有链接时，用 DesignProfileId 反查国服作品页（仅 CN 项目）
        if (!url) url = await resolveMakerWorldSource(meta);
        if (url) hits.push({ id: m.id, url });
      } catch (_) { /* 单个文件坏了就跳过，不影响整批 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  if (!hits.length) return { scanned: todo.length, updated: 0, cleaned };

  let updated = 0;
  await store.updateLibrary((target) => {
    for (const h of hits) {
      const rec = target.models && target.models[h.id];
      // 再确认一次：回填期间用户可能已经手填了一个，别覆盖
      if (rec && !rec.sourceUrl) {
        rec.sourceUrl = h.url;
        rec.sourceUrlAuto = true;   // 打标记：以后这条可以按作品页规则重算
        updated++;
      }
    }
  }, 'source-url');

  // 返回真正写进去的条数，不是解析命中的条数（两者在「用户刚好手填了」时会不一样）
  return { scanned: todo.length, updated, cleaned };
}

/**
 * 国际站链接 → 中国站同路径链接（保留路径 / query / 锚点）。
 * 注意：两站是**独立的模型库，ID 不通用**，少数国际站模型在国服不存在。
 * 默认开启自动换站（ui.makerWorldCn），用户可以自己关掉回到国际站；
 * 换过去是否存在由站点自己提示。
 *
 * 语言段也一起归一：makerworld.com/en/models/... → makerworld.com.cn/zh/models/...
 * 只换域名的话，国服可能停在英文界面或再弹一次站点提示。
 * 非 makerworld.com 域名返回 null（不需要转换）。
 */
function cnMakerWorldUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (!/(^|\.)makerworld\.com$/i.test(u.hostname)) return null;
    u.hostname = 'makerworld.com.cn';
    // /en/、/es/、/zh-cn/ 等语言前缀统一成国服默认的 /zh/；
    // 没有语言段的 /models/... 保持原样。
    if (/^\/[a-z]{2}(?:-[a-z]{2})?(?:\/|$)/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?/i, '/zh');
    }
    return u.toString();
  } catch (_) { return null; }
}

// DesignModelId -> 作品页 URL / null；映射稳定，进程内缓存，避免重复请求。
const modelUrlCache = new Map();

/**
 * 用 3MF 里的 DesignModelId 反查 MakerWorld 国服作品页。
 *
 * 背景：部分 MakerWorld 下载的 3MF 只在 Description 里写介绍，不写 URL；
 * 但 3D/3dmodel.model 里有 DesignModelId（例如 CN43896f4bbe0ae7）。
 * Bambu Studio 自己用 v1/design-service/model/{DesignModelId} 拿到数值 id，
 * 再拼成 /models/{id} 作品页；这里复用同一路径，不需要登录。
 *
 * 走 api.bambulab.cn（国服），不会被 makerworld.com.cn 的 Cloudflare 挑战拦；
 * 失败/超时一律返回 null，不阻断扫描或回填。只处理 DesignRegion=CN
 *（或 DesignModelId 以 CN 开头）的项目。
 */
async function resolveMakerWorldSource(meta, opts = {}) {
  const modelId = String((meta && meta.designModelId) || '').trim();
  const region = String((meta && meta.designRegion) || '').trim().toUpperCase();
  if (!modelId) return null;
  if (region && region !== 'CN' && !/^CN/i.test(modelId)) return null;

  if (modelUrlCache.has(modelId)) return modelUrlCache.get(modelId);
  if (opts.cache === false) modelUrlCache.delete(modelId);

  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 4500;
  const endpoint = 'https://api.bambulab.cn/v1/design-service/model/'
    + encodeURIComponent(modelId);

  let timer = null;
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetchImpl(endpoint, {
      headers: { accept: 'application/json', 'user-agent': 'PrintShelf/1.0' },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!r || r.ok === false) return null;
    const j = await r.json();
    const designId = Number(j && j.id);
    if (!Number.isFinite(designId) || designId <= 0) return null;
    const url = 'https://makerworld.com.cn/zh/models/' + designId;
    modelUrlCache.set(modelId, url);
    return url;
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { backfillSourceUrls, cnMakerWorldUrl, resolveMakerWorldSource };
