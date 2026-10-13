"""Assemble recorded frame sequences into deck GIFs (shared palette, identical frames merged)."""
import hashlib
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
CAP = os.path.join(ROOT, "cap")
OUT = os.path.join(ROOT, "gif")
os.makedirs(OUT, exist_ok=True)

SCENES = {
    # name: (target width, dither)
    "login": (1000, Image.Dither.NONE),
    "events": (1000, Image.Dither.NONE),
    "imagery": (1000, Image.Dither.FLOYDSTEINBERG),
    "verify": (420, Image.Dither.NONE),
    "refresh": (1000, Image.Dither.NONE),
}
only = sys.argv[1:]

for name, (width, dither) in SCENES.items():
    if only and name not in only:
        continue
    frames = json.load(open(os.path.join(CAP, name, "frames.json")))
    imgs, durs, last = [], [], None
    for f, ms in frames:
        im = Image.open(os.path.join(CAP, name, f)).convert("RGB")
        if im.width != width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        h = hashlib.md5(im.tobytes()).hexdigest()
        if h == last:
            durs[-1] += ms
            continue
        imgs.append(im)
        durs.append(ms)
        last = h
    durs[-1] += 1800  # rest on the last frame before looping
    # Shared palette from a sample of frames.
    step = max(1, len(imgs) // 12)
    sample = imgs[::step][:12]
    mosaic = Image.new("RGB", (width, sum(i.height for i in sample)))
    y = 0
    for i in sample:
        mosaic.paste(i, (0, y))
        y += i.height
    pal = mosaic.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [i.quantize(palette=pal, dither=dither) for i in imgs]
    path = os.path.join(OUT, f"{name}.gif")
    q[0].save(path, save_all=True, append_images=q[1:], duration=[max(20, int(d)) for d in durs], loop=0, optimize=True, disposal=1)
    print(f"{name}: {len(imgs)} frames, {sum(durs)/1000:.1f} s, {os.path.getsize(path)/1e6:.1f} MB, {imgs[0].size}")
