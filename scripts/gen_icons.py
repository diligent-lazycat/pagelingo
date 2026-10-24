#!/usr/bin/env python3
"""生成扩展图标（16/48/128），依赖 Pillow。用法：python gen_icons.py"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(BASE, exist_ok=True)

PRIMARY = (37, 99, 235, 255)  # #2563eb
SIZES = [16, 48, 128]

FONT_CANDIDATES = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


for size in SIZES:
    scale = size / 128.0
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角背景
    radius = int(28 * scale)
    rounded_rect(draw, (0, 0, size, size), radius, PRIMARY)

    # 居中文字「译」
    font = load_font(int(72 * scale))
    text = '译'
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))

    img.save(os.path.join(BASE, 'icon%d.png' % size))

print('icons generated at', BASE)
