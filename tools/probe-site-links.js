// 走查：工具栏「＋」添加自定义网站（创想云）→ 出现按钮 → 可删除
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await window.shelf.whenReady();
await sleep(900);

const root = document.querySelector('#stats-links');
if (!root) return { ok: false, error: 'no stats-links' };
const addBtn = root.querySelector('[data-site-manage]');
if (!addBtn) return { ok: false, error: 'no add button' };

addBtn.click();
await sleep(400);
let modal = document.querySelector('.modal');
if (!modal) return { ok: false, error: 'no dialog' };
const nameIn = modal.querySelector('[data-role="name"]');
const urlIn = modal.querySelector('[data-role="url"]');
if (!nameIn || !urlIn) return { ok: false, error: 'no inputs' };

nameIn.value = '创想云';
urlIn.value = 'www.crealitycloud.cn';   // 故意不写协议，验证自动补 https
modal.querySelector('[data-role="ok"]').click();
await sleep(700);

const added = [...root.querySelectorAll('[data-custom-site]')].find((b) => /创想云/.test(b.textContent));
const savedAfterAdd = (await window.shelf.settings()).ui.customSites;

// 再打开弹窗删掉
addBtn.click();
await sleep(400);
modal = document.querySelector('.modal');
const rows = modal.querySelectorAll('.site-row');
const delBtn = modal.querySelector('[data-del]');
if (delBtn) delBtn.click();
await sleep(700);
const savedAfterDel = (await window.shelf.settings()).ui.customSites;
const remain = root.querySelectorAll('[data-custom-site]').length;

return {
  ok: !!added && added.dataset.url === 'https://www.crealitycloud.cn/' &&
      savedAfterAdd.length === 1 && savedAfterDel.length === 0 && remain === 0,
  addedLabel: added ? added.textContent.trim() : null,
  addedUrl: added ? added.dataset.url : null,
  rowsBeforeDel: rows.length,
  savedAfterAdd: savedAfterAdd,
  savedAfterDel,
  remainInBar: remain,
};
