# -*- coding: utf-8 -*-
"""Build preview HTML for the leveling form (inline SVG + embedded HarmonyOS Sans SC)."""
import base64, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("JUJIN_OUT", os.path.dirname(HERE))
FONTS = os.environ.get("JUJIN_FONTS", os.path.join(HERE, "..", "..", "web", "assets", "fonts"))
WORK = os.environ.get("JUJIN_WORK", os.path.join(HERE, "work2"))
SVG_NAME = "三四等水准-记录表.svg"
VB_W, VB_H = 1036.0, 1637.0
W_DISP = 1036

cache = os.path.join(WORK, "font_b64.json")
d = json.load(open(cache))

svg_text = open(os.path.join(OUT, SVG_NAME), encoding="utf-8").read()
svg_text = svg_text.split("\n", 1)[1] if svg_text.startswith("<?xml") else svg_text

faces = "\n".join(
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
