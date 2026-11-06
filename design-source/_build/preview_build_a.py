# -*- coding: utf-8 -*-
"""Build preview.html : inline SVG + embedded HarmonyOS Sans SC, fixed 1600px wide."""
import base64, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("JUJIN_OUT", os.path.dirname(HERE))
FONTS = os.environ.get("JUJIN_FONTS", os.path.join(HERE, "..", "..", "web", "assets", "fonts"))
WORK = os.environ.get("JUJIN_WORK", os.path.join(HERE, "work"))
W_DISP = 1600
VB_H = 1147.8
VB_W = 1674.0

cache = os.path.join(WORK, "font_b64.json")
if os.path.exists(cache):
    import json
    d = json.load(open(cache))
else:
    d = {}
    for name, fn in [("400", "HarmonyOS_Sans_SC_Regular.woff2"),
                     ("500", "HarmonyOS_Sans_SC_Medium.woff2"),
                     ("700", "HarmonyOS_Sans_SC_Bold.woff2")]:
        d[name] = base64.b64encode(open(os.path.join(FONTS, fn), "rb").read()).decode()
    import json
    json.dump(d, open(cache, "w"))

svg_text = open(os.path.join(OUT, "全站仪导线观测记录表.svg"), encoding="utf-8").read()
svg_text = svg_text.split("\n", 1)[1] if svg_text.startswith("<?xml") else svg_text

import sys as _s
faces = "" if "--noff" in _s.argv else "\n".join(
    f"@font-face {{ font-family: 'HarmonyOS Sans SC'; font-style: normal; font-weight: {w}; "
    f"src: url(data:font/woff2;base64,{b}) format('woff2'); }}" for w, b in d.items())

H_DISP = round(VB_H / VB_W * W_DISP, 2)
html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
{faces}
html,body{{margin:0;padding:0;background:#ffffff;}}
#wrap{{width:{W_DISP}px;}}
#wrap svg{{display:block;width:{W_DISP}px;height:{H_DISP}px;}}
</style></head><body><div id="wrap">{svg_text}</div></body></html>"""

hp = os.path.join(WORK, "preview.html")
open(hp, "w", encoding="utf-8").write(html)
print("built", hp, round(os.path.getsize(hp) / 1e6, 2), "MB", W_DISP, H_DISP)
