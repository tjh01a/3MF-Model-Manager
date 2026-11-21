/**
 * 走查探针：卡片价格徽标（docs/14）。
 *   node launch.js --capture=docs/screenshots/45-卡片价格.png --ui-script=tools/probe-card-price.js
 *
 * 断言：
 *  1) 每张卡片的 .card-meta 行右端都有 .card-price，且该行文字左对齐、价格靠右；
 *  2) 当前库中没有任何可算成本的模型时，徽标显示 ¥?? 并带 data-price="??"；
 *  3) 批量 modelsCosts() 能一次拿全（返回对象，长度与模型数一致）；
 *  4) 造一条"100g × ¥120/kg"的测试分配后，对应卡片价格变成 ¥12 并带 data-price="12"，
 *     验证派生成本 → 缓存 → 卡片重画整条链路；最后清理分配与测试耗材，不留脏数据。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v;
    try { v = fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(step || 120);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const out = {};

// 等首屏卡片画出来
await waitFor(() => qa('.card[data-id]').length ? true : null, 15000);
const cards = qa('.card[data-id]');
out.cardCount = cards.length;

// 1) 每张卡的 meta 行都有价格徽标，位置靠右
const withBadge = cards.filter((c) => {
  const meta = c.querySelector('.card-meta');
  const badge = c.querySelector('.card-price');
  return !!meta && !!badge;
});
out.badgeCount = withBadge.length;
out.badgeLayout = (() => {
  const c = withBadge[0];
  if (!c) return null;
  const meta = c.querySelector('.card-meta').getBoundingClientRect();
  const txt = c.querySelector('.card-meta-text').getBoundingClientRect();
  const badge = c.querySelector('.card-price').getBoundingClientRect();
  return {
    textLeft: Math.round(txt.left - meta.left),
    badgeRight: Math.round(meta.right - badge.right),
    inRow: badge.top >= meta.top - 2 && badge.bottom <= meta.bottom + 2,
  };
})();

// 2) 批量成本接口
try {
  const costs = await window.shelf.modelsCosts();
  out.costsIsObject = !!costs && typeof costs === 'object' && !Array.isArray(costs);
  out.costsEntries = Object.keys(costs || {}).length;
} catch (e) { out.costsError = (e && e.message) || String(e); }

// 3) 徽标两种状态都要成立：算不出的显示 ¥??，算得出的显示 ¥金额
//    注意：不能假设「库是空的」——用户可能真的配了耗材并给模型分配过重量。
out.unknownCount = qa('.card-price.is-unknown').length;
out.unknownText = ((q('.card-price.is-unknown') || {}).textContent || '').trim();
out.knownCount = out.cardCount - out.unknownCount;
out.knownSample = ((qa('.card-price:not(.is-unknown)')[0] || {}).textContent || '').trim();

// 4) 造测试分配，验证派生成本 → 卡片重画；测完立即还原
let fid = null;
let targetId = null;
try {
  let f = (await window.shelf.filamentsList()).items.find((x) => x.name === '__探针耗材·卡片价__');
  if (!f) f = await window.shelf.filamentCreate({
    name: '__探针耗材·卡片价__', brand: 'Bambu 拓竹', type: 'PLA', color: '#ffffff', pricePerKg: 120,
  });
  fid = f.id;
  const card = cards[0];
  if (card) {
    targetId = card.dataset.id;
    await window.shelf.modelSetFilaments(targetId, [{ filamentId: fid, weightG: 100 }], null);
    // filaments:changed → emitRefresh('costs') → 重新拉缓存 + 卡片重画
    await waitFor(() => {
      const el = document.querySelector('.card[data-id="' + targetId + '"] .card-price');
      return el && el.getAttribute('data-price') === '12' ? el : null;
    }, 8000);
    const badge = document.querySelector('.card[data-id="' + targetId + '"] .card-price');
    out.afterAssign = {
      text: badge ? badge.textContent.trim() : null,
      dataPrice: badge ? badge.getAttribute('data-price') : null,
      isUnknown: badge ? badge.classList.contains('is-unknown') : null,
    };
  }
} catch (e) { out.assignError = (e && e.message) || String(e); }

// 清理：还原分配 + 删除测试耗材
try {
  if (targetId) await window.shelf.modelSetFilaments(targetId, [], null);
  if (fid) await window.shelf.filamentRemove(fid);
} catch (_) { /* 清理失败也要如实返回 */ }

const badgeOk = out.cardCount > 0 && out.badgeCount === out.cardCount;
const layoutOk = !!out.badgeLayout && out.badgeLayout.inRow &&
  out.badgeLayout.textLeft >= 0 && out.badgeLayout.badgeRight >= 0;
const batchOk = out.costsIsObject && out.costsEntries === out.cardCount;
// 每个徽标要么是 ¥??，要么是 ¥数字；两种都算正常，乱码/空才算失败
const unknownOk = out.unknownCount + out.knownCount === out.cardCount
  && (out.unknownCount === 0 || out.unknownText === '¥??')
  && (out.knownCount === 0 || /^¥\d/.test(out.knownSample));
const assignOk = !!(out.afterAssign && out.afterAssign.dataPrice === '12' &&
  out.afterAssign.text === '¥12' && out.afterAssign.isUnknown === false);

out.checks = { badgeOk, layoutOk, batchOk, unknownOk, assignOk };
out.ok = badgeOk && layoutOk && batchOk && unknownOk && assignOk;
return out;
