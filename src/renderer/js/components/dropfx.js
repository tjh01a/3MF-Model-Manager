'use strict';
/**
 * 拖拽归类的动效层（纯 DOM，不读写业务状态）：
 *  - flyToTarget：松手后把缩略图"飞"进左侧分类，让人看见东西去哪了
 *  - pulse：给元素贴一次性动效 class
 * 目标行的高亮/脉冲样式在 components.css（.drop-target / .just-dropped）。
 *
 * 说明：这里不做 prefers-reduced-motion 降级。本机实测该媒体查询命中 reduce（Windows 关闭了动画），
 * 若跟随它降级，"拖入分类"就完全没有反馈了。动效本身仅 0.4s、幅度很小，保留更好用。
 */

/** 把 fromEl 里的缩略图从原位飞到 toEl，约 520ms 后自清理 */
export function flyToTarget(fromEl, toEl) {
  if (!fromEl || !toEl) return null;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return null;

  const img = fromEl.querySelector('.card-img');
  const el = document.createElement('div');
  el.className = 'fly-chip';
  el.style.left = Math.round(a.left) + 'px';
  el.style.top = Math.round(a.top) + 'px';
  el.style.width = Math.round(a.width) + 'px';
  el.style.height = Math.round(a.width * 0.72) + 'px';
  const src = img && (img.currentSrc || img.getAttribute('src'));
  if (src) el.style.backgroundImage = 'url("' + src + '")';
  document.body.appendChild(el);

  const fromCx = a.left + a.width / 2;
  const fromCy = a.top + (a.width * 0.72) / 2;
  const toCx = b.left + b.width / 2;
  const toCy = b.top + b.height / 2;
  const dx = Math.round(toCx - fromCx);
  const dy = Math.round(toCy - fromCy);

  // 下一帧再改 transform，才会触发过渡
  requestAnimationFrame(() => {
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.14)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 520);
  return el;
}

/** 给元素贴一次性动效 class，动画结束自动摘掉（可重复触发） */
export function pulse(el, cls = 'just-dropped', ms = 680) {
  if (!el) return;
  el.classList.remove(cls);
  // 强制回流，保证连续两次投放也能重新播放
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}
