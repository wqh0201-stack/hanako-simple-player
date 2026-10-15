#!/usr/bin/env python3
"""Inspect rendered pixels and assemble screenshot sheets (existing Pillow only)."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageStat

root = Path(sys.argv[1])
palettes = ['pink', 'green', 'blue', 'dark']
checks = []
for tone in ['light', 'dark']:
    for width in [720, 312]:
        for palette in palettes:
            images = {p: Image.open(root / f'{palette}-{tone}-{width}-{p}-lyric.png').convert('RGB') for p in [0, 50, 100]}
            # y=36 is four px inside the 64px bar: away from text and decorative stars.
            y, bar_x, bar_w = 36, 88, width - 100
            pixel = lambda progress, f: images[progress].getpixel((int(bar_x + bar_w * f), y))
            distance = lambda a, b: sum(abs(x-y) for x, y in zip(a, b))
            left_change = distance(pixel(0, .2), pixel(50, .2))
            right_change = distance(pixel(0, .8), pixel(50, .8))
            end_change = distance(pixel(0, .8), pixel(100, .8))
            edge = int(bar_x + bar_w * .5)
            ambient_path = root / f'{palette}-{tone}-{width}-50-ambient-only.png'
            ambient = Image.open(ambient_path).convert('RGB') if ambient_path.exists() else images[50]
            steps = [distance(ambient.getpixel((x, y)), ambient.getpixel((x+1, y))) for x in range(edge-12, edge+4)]
            base_colors = [pixel(0, f) for f in [.1, .3, .6, .9]]
            spread = max(distance(a, b) for a in base_colors for b in base_colors)
            active_max = max(sum(pixel(100, f))/3 for f in [.1, .3, .6, .9])
            checks.append(dict(case=f'{palette}-{tone}-{width}',
                               ok=left_change > 12 and right_change <= 3 and end_change > 12 and max(steps) < 30 and spread > 3 and active_max < 245,
                               left_change=left_change, unplayed_change=right_change, end_change=end_change,
                               max_edge_pixel_step=max(steps), base_color_spread=spread, max_active_rgb_mean=active_max))
        # 0/50/100; each palette has the existing lyric and control states.
        sheet = Image.new('RGB', (width * 3, 28 + 8 * 150), '#f8f4ed' if tone == 'light' else '#34424b')
        draw = ImageDraw.Draw(sheet)
        ink = '#2a2622' if tone == 'light' else '#e1eaf0'
        for col, progress in enumerate([0, 50, 100]):
            draw.text((col * width + 12, 8), f'{tone} / {progress}% / {width}px viewport', fill=ink)
        for row, (palette, state) in enumerate((p, s) for p in palettes for s in ['lyric', 'controls']):
            y0 = 28 + row * 150
            draw.text((12, y0 + 4), f'{palette} / {state}', fill=ink)
            for col, progress in enumerate([0, 50, 100]):
                sheet.paste(Image.open(root / f'{palette}-{tone}-{width}-{progress}-{state}.png'), (col * width, y0 + 22))
        sheet.save(root / f'overview-{tone}-{width}.png')

legacy = []
for tone in ['light', 'dark']:
    restored = root / f'base-restored-{tone}.png'
    reference = root / f'base-legacy-full-{tone}.png'
    if not restored.exists():
        continue
    # 屏蔽外围圆角抗锯齿，仅对整条内部（包含文字和歌词）逐像素比对。
    box = (96, 40, 700, 88)
    a, b = [Image.open(p).convert('RGB').crop(box) for p in [restored, reference]]
    diff = ImageChops.difference(a, b)
    peak = max(v[1] for v in diff.getextrema())
    legacy.append(dict(case='legacy-full-base-' + tone, ok=peak <= 2, max_channel_difference=peak, mean_channel_difference=ImageStat.Stat(diff).mean))
report = dict(passed=sum(c['ok'] for c in checks + legacy), total=len(checks + legacy), failed=[c for c in checks + legacy if not c['ok']], cases=checks, legacy=legacy)
(root / 'pixel-inspection.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k: report[k] for k in ['passed', 'total', 'failed']}, indent=2))
sys.exit(0 if not report['failed'] else 1)
