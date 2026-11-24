const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await window.shelf.whenReady();
await sleep(900);
const add = document.querySelector('#stats-links [data-site-manage]');
if (add) add.click();
await sleep(500);
return { sites: document.querySelectorAll('#stats-links [data-custom-site]').length, dialog: !!document.querySelector('.modal') };
