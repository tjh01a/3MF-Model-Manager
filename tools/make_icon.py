"""生成 PrintShelf 的 Windows .ico 图标（复刻 src/renderer/assets/logo.svg）。

仅依赖 Pillow，不调用任何外部渲染器。输出：
  resources/app.ico   多尺寸图标（16/24/32/48/64/128/256）
  resources/app.png   256x256 PNG（备用）
可重复运行，结果幂等。
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'resources')
ICO = os.path.join(OUT_DIR, 'app.ico')
PNG = os.path.join(OUT_DIR, 'app.png')

S = 1024                     # 超采样画布，最后缩小获得平滑边缘
K = S / 128.0               # SVG viewBox 128 -> 画布
TOP = (79, 70, 229)         # #4f46e5
BOTTOM = (129, 140, 248)    # #818cf8


def rounded_mask(size: int, margin: float, radius: float):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([margin, margin, size - margin, size - margin],
                        radius=radius, fill=255)
    return m


def build() -> Image.Image:
    mask = rounded_mask(S, 4 * K, 28 * K)

    # 对角渐变（用垂直渐变近似，视觉上与 SVG 的对角渐变接近）
    g = Image.linear_gradient('L').resize((S, S), Image.LANCZOS)
    top = Image.new('RGB', (S, S), TOP)
    bottom = Image.new('RGB', (S, S), BOTTOM)
    base = Image.composite(bottom, top, g).convert('RGBA')
    base.putalpha(mask)

    # 顶部柔光（上 14% 白 -> 下透明），限制在圆角内
    sheen_alpha = Image.eval(g, lambda v: int((255 - v) / 255.0 * 36))
    sheen_alpha = ImageChops.multiply(sheen_alpha, mask)
    sheen = Image.new('RGBA', (S, S), (255, 255, 255, 0))
    sheen.putalpha(sheen_alpha)
    base = Image.alpha_composite(base, sheen)

    # 白色层叠图层线条（对应 SVG 的三段路径）
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    white = (255, 255, 255, 255)
    w = int(6 * K)

    diamond = [(64 * K, 34 * K), (96 * K, 51 * K),
               (64 * K, 68 * K), (32 * K, 51 * K)]
    d.polygon(diamond, fill=(255, 255, 255, 42))
    d.line(diamond + [diamond[0]], fill=white, width=w, joint='curve')
    line2 = [(32 * K, 68 * K), (64 * K, 85 * K), (96 * K, 68 * K)]
    line3 = [(32 * K, 85 * K), (64 * K, 102 * K), (96 * K, 85 * K)]
    d.line(line2, fill=white, width=w, joint='curve')
    d.line(line3, fill=white, width=w, joint='curve')

    # 圆头端点
    r = w / 2.0
    for pt in (diamond[0], diamond[1], diamond[2], diamond[3],
               line2[0], line2[2], line3[0], line3[2]):
        x, y = pt
        d.ellipse([x - r, y - r, x + r, y + r], fill=white)

    base = Image.alpha_composite(base, layer)
    # 保证边缘严格落在圆角内
    base.putalpha(ImageChops.multiply(base.getchannel('A'), mask))
    return base.resize((256, 256), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    img = build()
    img.save(PNG, format='PNG')
    img.save(ICO, format='ICO',
             sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                    (64, 64), (128, 128), (256, 256)])
    # 自检
    check = Image.open(ICO)
    print('ICO :', ICO, os.path.getsize(ICO), 'bytes')
    print('PNG :', PNG, os.path.getsize(PNG), 'bytes')
    print('ICO sizes:', sorted(getattr(check, 'ico', None).sizes()) if hasattr(check, 'ico') else 'multi-size')


if __name__ == '__main__':
    main()
