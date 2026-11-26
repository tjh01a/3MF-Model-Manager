'use strict';
import { t as tr } from '../i18n.js';

/**
 * 「没匹配上分类」的表单式弹窗。
 *
 * 用户要的是：直接看到缩略图，下面用下拉选分类，选不到就跳过。
 * 改词条的入口不放在这里 —— 底部只留一句灰色提示，指向「设置 → 自动分类」。
 *
 * 返回结果（docs/15）：
 *   null                                   —— Esc / 点 X / 点遮罩，只是随手关掉，不记跳过
 *   { picked:[{id,categoryId}], skipped:[id] } —— 点了「应用」或「全部跳过」
 *     全部跳过：picked 为空、skipped 为本次展示的全部 id（写进 settings 不再提醒）
 *     应用：picked 为选了分类的行；skipped 为空（没选的行保持原样，下次仍可能提示）
 */
import { customDialog } from './modal.js';
import { escapeHtml } from '../utils.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

export function openClassifyPrompt({ items = [], categories = [] } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return Promise.resolve(null);
  const cats = Array.isArray(categories) ? categories : [];
  const options = cats
    .map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>')
    .join('');

  const rows = list.map((m, i) => {
    const thumb = m.thumbnail
      ? 'shelf://thumbs/' + esc(m.thumbnail)
      : 'assets/placeholder.svg';
    return '<div class="cp-row">' +
      '<img class="cp-thumb" src="' + thumb + '" alt="" loading="lazy">' +
      '<div class="cp-main">' +
        '<div class="cp-name" title="' + esc(m.title) + '">' + esc(m.title) + '</div>' +
        '<select class="select cp-select" data-cp-row="' + i + '">' +
          tr('<option value="">跳过（保持未分类）</option>') +
          options +
        '</select>' +
      '</div>' +
    '</div>';
  }).join('');

  const body =
    tr('<p class="modal-message">下面这些模型没匹配上词库。给它们选个分类，或者直接跳过。</p>') +
    '<div class="cp-list">' + rows + '</div>' +
    tr('<p class="cp-hint">想让这类名字以后自动认出来？去「设置 → 自动分类」加几个关键词就行。</p>');

  const foot =
    tr('<button type="button" class="btn btn-ghost" data-cp-skip>全部跳过</button>') +
    tr('<button type="button" class="btn btn-primary" data-cp-apply>应用</button>');

  return customDialog({
    title: list.length + tr(' 个模型没匹配上分类'),
    body,
    foot,
    width: '540px',
    onMount(modal, close) {
      const skip = modal.querySelector('[data-cp-skip]');
      if (skip) skip.addEventListener('click', () =>
        close({ picked: [], skipped: list.map((m) => m.id) }));

      const apply = modal.querySelector('[data-cp-apply]');
      if (apply) {
        apply.addEventListener('click', () => {
          const picked = [];
          modal.querySelectorAll('[data-cp-row]').forEach((sel) => {
            const idx = Number(sel.getAttribute('data-cp-row'));
            const item = list[idx];
            if (item && sel.value) picked.push({ id: item.id, categoryId: sel.value });
          });
          close({ picked, skipped: [] });
        });
      }

      // 打开时把焦点放在第一个下拉，键盘用户可以直接选
      const first = modal.querySelector('.cp-select');
      if (first) first.focus();
    },
  });
}
