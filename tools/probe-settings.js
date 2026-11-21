/**
 * 走查探针：切到设置页「切片软件」tab，确认「快造 U1 转换」区块与表单都正常渲染。
 *   node launch.js --capture=data/tmp.png --ui-script=tools/probe-settings.js
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, step) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step || 100);
  }
  return null;
}

const q = (s) => document.querySelector(s);
const out = {};

const btn = await waitFor(() => q('#btn-settings'), 15000);
if (!btn) return { ok: false, error: '设置按钮没出现' };
btn.click();

const tab = await waitFor(() => q('[data-tab="slicers"]'), 6000);
if (!tab) return { ok: false, error: '找不到「切片软件」tab' };
tab.click();
// 切片软件列表是同步渲染的，但「快造 U1 预设」要异步扫 Orca 配置目录。
// 固定 sleep 在慢机器或别的实例占着 Chromium 缓存锁时会不够，改成等元素出现。
await waitFor(() => q('#settings-content [data-u1]'), 8000);
await sleep(300);

const content = q('#settings-content');
if (!content) return { ok: false, error: '#settings-content 不存在' };

const fullText = content.textContent.replace(/\s+/g, ' ');
out.text = fullText.slice(0, 600);          // 输出用，截断避免刷屏
const has = (re) => re.test(fullText);      // 断言必须用全文，别用截断后的
out.u1Selects = content.querySelectorAll('[data-u1]').length;
out.u1Options = Array.from(content.querySelectorAll('[data-u1]')).map((s) => ({
  kind: s.dataset.u1,
  value: s.value,
  count: s.options.length,
  first: s.options.length ? s.options[0].textContent.trim() : '',
}));
out.slicerRows = Array.from(content.querySelectorAll('.slicer-item, .slicer-row, [data-slicer-id]'))
  .map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
out.hasSlicerForm = !!q('#slicer-new-path') && !!q('#slicer-new-name')
  && has(/浏览…/) && has(/添加/);
out.hasU1Title = has(/快造 U1/);
out.hasResolved = has(/解析结果|喷嘴/);
out.hasPresetGuard = has(/预设保护/);
out.hasFileAssoc = has(/双击 \.3mf/);
out.presetRestoreSelect = !!q('#preset-restore-id');
out.sectionCount = content.querySelectorAll('.settings-section').length;
out.ok = out.hasSlicerForm && out.hasU1Title && out.u1Selects >= 1 && out.hasPresetGuard && out.hasFileAssoc;

// 把最后两块（预设保护 / 文件关联）的正文带出来，方便人工核对
const secs = Array.from(content.querySelectorAll('.settings-section'));
out.tailSections = secs.slice(-2).map((s) => s.textContent.replace(/\s+/g, ' ').trim().slice(0, 420));
out.assocButtons = Array.from(content.querySelectorAll('[data-act^="assoc-"]')).map((b) => b.textContent.trim());

// 滚到底，方便截图看到新加的两块
const sc = q('#settings-content');
if (sc) { sc.scrollTop = sc.scrollHeight; await sleep(350); }
return out;
