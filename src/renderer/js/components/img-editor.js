'use strict';
import { t as tr } from '../i18n.js';

/**
 * 图片导入编辑器（耗材图片用）：裁切 + 缩放。
 *
 * 渲染层没有 Node 权限，原图由主进程读成 data URL 传进来；确认后用 canvas 按输出尺寸
 * 重编码，再把 data URL 交给主进程落盘。全程不经过磁盘临时文件。
 *
 * 坐标约定：选区 sel 用「显示像素」存（相对图片显示框左上角），导出时除以 scale
 * 换算回原图像素。这样窗口/弹窗尺寸变化时不用重算选区，只按最新 scale 换算即可。
 */
import { customDialog } from './modal.js';

const MIN_SEL = 24;        // 选区最小边长（显示像素）
const MAX_OUT = 2000;      // 输出边长上限
const DEFAULT_OUT = 800;   // 默认输出宽度上限（超过就按原尺寸等比缩）

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v) => Math.max(1, Math.round(v));

const RATIOS = [
  { key: '0', label: tr('自由'), value: 0 },
  { key: '1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
  { key: 'orig', label: tr('原图'), value: -1 },
];

function bodyHtml() {
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    .map((d) => '<span class="imged-h" data-dir="' + d + '"></span>').join('');
  return '' +
    '<div class="imged">' +
      '<div class="imged-stage" data-role="stage">' +
        '<div class="imged-canvas" data-role="canvas">' +
          '<img data-role="img" alt="">' +
          '<div class="imged-sel" data-role="sel">' + handles + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="imged-side">' +
        '<div class="imged-group">' +
          tr('<span class="imged-label">裁切比例</span>') +
          '<div class="imged-ratios" data-role="ratios">' +
            RATIOS.map((r) => '<button type="button" data-ratio="' + r.key + '"' +
              (r.value === 0 ? ' class="is-on"' : '') + '>' + r.label + '</button>').join('') +
          '</div>' +
        '</div>' +
        '<div class="imged-group">' +
          tr('<span class="imged-label">输出尺寸</span>') +
          '<div class="imged-size">' +
            '<input type="number" data-role="w" min="16" max="' + MAX_OUT + '" step="1">' +
            '<span class="imged-x">×</span>' +
            '<input type="number" data-role="h" min="16" max="' + MAX_OUT + '" step="1">' +
            '<span class="imged-unit">px</span>' +
          '</div>' +
          tr('<label class="imged-lock"><input type="checkbox" data-role="lock" checked> 锁定比例</label>') +
        '</div>' +
        '<p class="imged-info" data-role="info"></p>' +
        tr('<p class="imged-tip">在图上拖动框选裁切范围；拖角或边可调整大小，框内拖动可平移。</p>') +
      '</div>' +
    '</div>';
}

/**
 * 打开编辑器。dataUrl 为原图；返回 { dataUrl, width, height } 或 null（取消）。
 */
export function openImageEditor({ dataUrl, fileName = '', name = '' } = {}) {
  return customDialog({
    title: name ? tr('调整耗材图片 · ') + name : tr('调整耗材图片'),
    width: '760px',
    body: bodyHtml(),
    foot:
      tr('<button type="button" class="btn btn-ghost" data-role="cancel">取消</button>') +
      '<span class="spacer"></span>' +
      tr('<button type="button" class="btn btn-ghost" data-role="reset">重置</button>') +
      tr('<button type="button" class="btn btn-primary" data-role="ok">应用</button>'),
    onMount: (modal, close) => {
      const stage = modal.querySelector('[data-role="stage"]');
      const canvas = modal.querySelector('[data-role="canvas"]');
      const img = modal.querySelector('[data-role="img"]');
      const selEl = modal.querySelector('[data-role="sel"]');
      const ratiosEl = modal.querySelector('[data-role="ratios"]');
      const wIn = modal.querySelector('[data-role="w"]');
      const hIn = modal.querySelector('[data-role="h"]');
      const lockIn = modal.querySelector('[data-role="lock"]');
      const info = modal.querySelector('[data-role="info"]');

      let natW = 0;
      let natH = 0;
      let scale = 1;
      let dw = 0;                 // 图片显示宽（显示像素）
      let dh = 0;
      let sel = { x: 0, y: 0, w: 1, h: 1 };
      let ratio = 0;              // 0 = 自由；-1 = 原图比例；其它为正数
      let outW = DEFAULT_OUT;
      let outH = DEFAULT_OUT;
      let manual = false;         // 用户改过输出尺寸后就不再跟随选区
      let drag = null;

      const dispScale = () => dw / natW || 1;

      function layout() {
        const availW = Math.max(120, stage.clientWidth);
        const availH = Math.max(120, stage.clientHeight);
        // 小图不放大：放大只是插值模糊，用户要的是裁切位置准确
        scale = Math.min(availW / natW, availH / natH, 1);
        dw = Math.max(1, Math.round(natW * scale));
        dh = Math.max(1, Math.round(natH * scale));
        canvas.style.width = dw + 'px';
        canvas.style.height = dh + 'px';
      }

      function clampSel() {
        sel.w = clamp(sel.w, MIN_SEL, dw);
        sel.h = clamp(sel.h, MIN_SEL, dh);
        sel.x = clamp(sel.x, 0, dw - sel.w);
        sel.y = clamp(sel.y, 0, dh - sel.h);
      }

      function paint() {
        selEl.style.left = sel.x + 'px';
        selEl.style.top = sel.y + 'px';
        selEl.style.width = sel.w + 'px';
        selEl.style.height = sel.h + 'px';
        const cropW = Math.round(sel.w / dispScale());
        const cropH = Math.round(sel.h / dispScale());
        if (!manual) {
          const fit = Math.min(1, DEFAULT_OUT / Math.max(1, cropW));
          outW = clamp(round(cropW * fit), 16, MAX_OUT);
          outH = clamp(round(cropH * fit), 16, MAX_OUT);
        }
        if (lockIn.checked) {
          // 锁定比例时高由宽推出来（按选区比例），避免手输宽高互相打架
          outH = clamp(round(outW * (cropH / Math.max(1, cropW))), 16, MAX_OUT);
        }
        wIn.value = outW;
        hIn.value = outH;
        hIn.disabled = lockIn.checked;
        info.textContent = tr('原图 ') + natW + ' × ' + natH + tr(' px · 选区 ') +
          cropW + ' × ' + cropH + tr(' px · 输出 ') + outW + ' × ' + outH + ' px';
      }

      /** 按给定比例把选区收成尽量大的矩形，中心贴住原选区中心 */
      function applyRatio(r) {
        ratio = r;
        if (r > 0) {
          let w = Math.min(dw, dh * r);
          let h = w / r;
          if (w < MIN_SEL || h < MIN_SEL) {
            h = Math.min(dh, dw / r);
            w = h * r;
          }
          const cx = clamp(sel.x + sel.w / 2, w / 2, Math.max(w / 2, dw - w / 2));
          const cy = clamp(sel.y + sel.h / 2, h / 2, Math.max(h / 2, dh - h / 2));
          sel = { x: cx - w / 2, y: cy - h / 2, w, h };
        }
        clampSel();
        paint();
      }

      function ratioValue() {
        return ratio === -1 ? dw / dh : ratio;
      }

      // ---------------- 指针交互 ----------------
      function onDown(e) {
        if (e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const px = clamp(e.clientX - rect.left, 0, dw);
        const py = clamp(e.clientY - rect.top, 0, dh);
        const hEl = e.target.closest ? e.target.closest('[data-dir]') : null;
        const dir = hEl ? hEl.dataset.dir : '';
        const inside = px >= sel.x && px <= sel.x + sel.w && py >= sel.y && py <= sel.y + sel.h;
        drag = {
          dir,
          mode: dir ? 'resize' : inside ? 'move' : 'new',
          px, py,
          orig: { ...sel },
        };
        if (drag.mode === 'new') sel = { x: px, y: py, w: MIN_SEL, h: MIN_SEL };
        try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 老内核忽略 */ }
        e.preventDefault();
      }

      function onMove(e) {
        if (!drag) return;
        const rect = canvas.getBoundingClientRect();
        const px = clamp(e.clientX - rect.left, 0, dw);
        const py = clamp(e.clientY - rect.top, 0, dh);

        if (drag.mode === 'move') {
          sel.x = clamp(drag.orig.x + (px - drag.px), 0, dw - drag.orig.w);
          sel.y = clamp(drag.orig.y + (py - drag.py), 0, dh - drag.orig.h);
          paint();
          return;
        }

        if (drag.mode === 'new') {
          const x1 = Math.min(drag.px, px);
          const x2 = Math.max(drag.px, px);
          const y1 = Math.min(drag.py, py);
          const y2 = Math.max(drag.py, py);
          sel = { x: x1, y: y1, w: Math.max(MIN_SEL, x2 - x1), h: Math.max(MIN_SEL, y2 - y1) };
          clampSel();
          paint();
          return;
        }

        // resize：按拖动方向改边，再按比例收一边
        const o = drag.orig;
        let x1 = o.x;
        let y1 = o.y;
        let x2 = o.x + o.w;
        let y2 = o.y + o.h;
        const d = drag.dir;
        if (d.includes('w')) x1 = px;
        if (d.includes('e')) x2 = px;
        if (d.includes('n')) y1 = py;
        if (d.includes('s')) y2 = py;
        if (x2 < x1) { const t = x1; x1 = x2; x2 = t; }
        if (y2 < y1) { const t = y1; y1 = y2; y2 = t; }

        let w = Math.max(MIN_SEL, x2 - x1);
        let h = Math.max(MIN_SEL, y2 - y1);
        const r = ratioValue();
        if (r > 0) {
          if (w / r >= h) h = w / r; else w = h * r;
          // 锚点：没被拖动的那条边保持不动
          if (d.includes('w')) x1 = x2 - w; else x2 = x1 + w;
          if (d.includes('n')) y1 = y2 - h; else y2 = y1 + h;
        }
        // 越界时整体平移回画布内，尺寸不缩（否则拖到边缘比例就变了）
        if (x1 < 0) { x2 -= x1; x1 = 0; }
        if (y1 < 0) { y2 -= y1; y1 = 0; }
        if (x2 > dw) { x1 -= (x2 - dw); x2 = dw; }
        if (y2 > dh) { y1 -= (y2 - dh); y2 = dh; }
        sel = { x: Math.max(0, x1), y: Math.max(0, y1), w: x2 - Math.max(0, x1), h: y2 - Math.max(0, y1) };
        clampSel();
        paint();
      }

      function onUp(e) {
        if (!drag) return;
        drag = null;
        try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* 忽略 */ }
      }

      // ---------------- 事件绑定 ----------------
      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerup', onUp);
      stage.addEventListener('pointercancel', onUp);

      ratiosEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ratio]');
        if (!btn) return;
        const r = RATIOS.find((x) => x.key === btn.dataset.ratio);
        if (!r) return;
        [...ratiosEl.querySelectorAll('button')].forEach((b) => b.classList.toggle('is-on', b === btn));
        applyRatio(r.value === -1 ? -1 : r.value);
      });

      wIn.addEventListener('input', () => {
        manual = true;
        outW = clamp(round(Number(wIn.value) || 16), 16, MAX_OUT);
        paint();
      });
      hIn.addEventListener('input', () => {
        manual = true;
        outH = clamp(round(Number(hIn.value) || 16), 16, MAX_OUT);
        wIn.value = outW;
        hIn.value = outH;
        info.textContent = tr('原图 ') + natW + ' × ' + natH + tr(' px · 输出 ') + outW + ' × ' + outH + ' px';
      });
      lockIn.addEventListener('change', () => { manual = false; paint(); });

      modal.querySelector('[data-role="reset"]').addEventListener('click', () => {
        manual = false;
        ratio = 0;
        [...ratiosEl.querySelectorAll('button')].forEach((b) => b.classList.toggle('is-on', b.dataset.ratio === '0'));
        sel = { x: 0, y: 0, w: dw, h: dh };
        paint();
      });

      modal.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));

      modal.querySelector('[data-role="ok"]').addEventListener('click', () => {
        try {
          // 原图 -> 选区 -> 输出尺寸，两步都用高质量插值，避免先裁后缩的两段锯齿
          const s = dispScale();
          const sx = sel.x / s;
          const sy = sel.y / s;
          const sw = Math.max(1, sel.w / s);
          const sh = Math.max(1, sel.h / s);
          const cv = document.createElement('canvas');
          cv.width = outW;
          cv.height = outH;
          const ctx = cv.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          const isPng = /^data:image\/png/i.test(dataUrl);
          // PNG 保留透明通道给抠图标；JPEG 源按 0.92 重编码，避免转 PNG 体积翻几倍
          if (!isPng) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, outW, outH);
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          close({
            dataUrl: isPng ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.92),
            width: outW,
            height: outH,
            fileName,
          });
        } catch (err) {
          close({ error: (err && err.message) || tr('图片处理失败') });
        }
      });

      // ---------------- 初始化 ----------------
      img.onload = () => {
        natW = img.naturalWidth || img.width;
        natH = img.naturalHeight || img.height;
        if (!natW || !natH) { close({ error: tr('这张图片读不出来，换一张试试') }); return; }
        layout();
        sel = { x: 0, y: 0, w: dw, h: dh };
        manual = false;
        paint();
      };
      img.onerror = () => close({ error: tr('这张图片读不出来，换一张试试') });
      img.src = dataUrl;
    },
  });
}
