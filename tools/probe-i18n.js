/**
 * 英文界面走查探针（只读）。
 *   PRINTSHELF_DATA_DIR=data-i18n-test node launch.js --capture=data/i18n.png --ui-script=tools/probe-i18n.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
const q = (s) => document.querySelector(s);
const out = {};
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));

await waitFor(() => q('#btn-language') && q('#search-input'), 15000);
await waitFor(() => q('#btn-settings') && q('#empty-state') && !q('#boot-splash'), 10000);
await sleep(400);

out.lang = document.documentElement.lang;
out.langButton = q('#lang-label') ? q('#lang-label').textContent.trim() : '';
out.title = document.title;
out.searchPlaceholder = q('#search-input') ? q('#search-input').placeholder : '';
out.emptyTitle = q('#empty-title') ? q('#empty-title').textContent.trim() : '';
out.allTitle = q('#view-title') ? q('#view-title').textContent.trim() : '';
out.makerUrl = q('#stats-links button[data-url]') ? q('#stats-links button[data-url]').getAttribute('data-url') : '';
out.bodyText = (q('body') ? q('body').innerText : '').replace(/\s+/g, ' ').slice(0, 900);

const settings = q('#btn-settings');
if (settings) {
  settings.click();
  await waitFor(() => q('[data-tab="appearance"]'), 5000);
  const tab = q('[data-tab="appearance"]');
  if (tab) tab.click();
  await sleep(350);
  const c = q('#settings-content');
  out.settingsText = c ? c.innerText.replace(/\s+/g, ' ').slice(0, 1200) : '';
  out.languageSelect = !!q('[data-bind="ui.language"]');
  out.regionSelect = !!q('[data-bind="ui.makerWorldRegion"]');
  if (q('[data-bind="ui.language"]')) out.languageValue = q('[data-bind="ui.language"]').value;
  if (q('[data-bind="ui.makerWorldRegion"]')) out.regionValue = q('[data-bind="ui.makerWorldRegion"]').value;
}

out.errors = errors;
out.ok = out.lang === 'en-US' && out.langButton === 'EN'
  && /3MF Model Manager/i.test(out.title)
  && /Search name/i.test(out.searchPlaceholder)
  && out.languageSelect && out.regionSelect
  && /makerworld\.com\/en/.test(out.makerUrl)
  && errors.length === 0;
return out;
