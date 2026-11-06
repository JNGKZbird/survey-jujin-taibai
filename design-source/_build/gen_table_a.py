# -*- coding: utf-8 -*-
"""Build the blank '全站仪导线观测记录表' SVG + geometry.json from the measured grid."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("JUJIN_OUT", os.path.dirname(HERE))
os.makedirs(OUT, exist_ok=True)

# ---------------- grid (table-relative units) ----------------
COLS = [0, 142, 284, 372, 539, 627, 794, 961, 1049, 1216, 1358, 1500, 1642]
ROWS = [0, 144.8] + [round(144.8 + 54.0 * i, 2) for i in range(1, 17)]
W, H = COLS[-1], ROWS[-1]
MX, MY = 16.0, 123.0
CW, CH = W + 2 * MX, MY + H + 16.0

LW_OUT, LW_BLK, LW_IN = 3.0, 2.2, 1.3
INK = "#1b1b1b"

def X(i): return MX + COLS[i]
def Y(i): return MY + ROWS[i]

CJK = "HarmonyOS Sans SC, PingFang SC, Microsoft YaHei, SimHei, sans-serif"
CJKQ = '"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "SimHei", sans-serif'
SER = "Times New Roman, Songti SC, SimSun, serif"
SERQ = '"Times New Roman", "Songti SC", "SimSun", serif'
TIT = "Songti SC, SimSun, STSong, Noto Serif CJK SC, serif"
TITQ = '"Songti SC", "SimSun", "STSong", "Noto Serif CJK SC", serif'

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

L, CELLS = [], []

def add(s): L.append(s)

def T(x, y, s, size=26.5, anchor="middle", ls=None, family=None, weight=None,
      style=None, cls=None, tlen=None, extra=""):
    a = [f'x="{x:.2f}"', f'y="{y:.2f}"']
    if anchor != "start":
        a.append(f'text-anchor="{anchor}"')
    if size != 26.5:
        a.append(f'style="font-size:{size:g}px"')
    if ls is not None:
        a.append(f'letter-spacing="{ls:g}"')
    if family:
        a.append(f'font-family="{family}"')
    if weight:
        a.append(f'font-weight="{weight}"')
    if style:
        a.append(f'font-style="{style}"')
    if cls:
        a.append(f'class="{cls}"')
    if tlen:
        a.append(f'textLength="{tlen:g}" lengthAdjust="spacing"')
    if extra:
        a.append(extra)
    add(f'      <text {" ".join(a)}>{s}</text>')

def cell(id_, role, x0, y0, x1, y1, spans="", note="", col=None, row=None):
    x, y = MX + x0, MY + y0
    CELLS.append(dict(id=id_, role=role, col=col, row=row, spans=spans,
                      x=round(x, 2), y=round(y, 2), w=round(x1 - x0, 2), h=round(y1 - y0, 2),
                      note=note))

# =====================================================================
add('<?xml version="1.0" encoding="UTF-8"?>')
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{CW:g}" height="{CH:g}" viewBox="0 0 {CW:g} {CH:g}" role="img" aria-label="全站仪导线观测记录表（空白）">')
add('  <title>全站仪导线观测记录表 — 空白表格（DSH 视觉稿）</title>')
add('  <desc>按空白表照片透视校正后重建的印刷表单。不含手写与示例数据，数据格全部留空。</desc>')
add('  <defs>')
add('    <style>')
add(f'      #sheet text {{ font-family: {CJKQ}; fill: {INK}; font-size: 26.5px; }}')
add(f'      #sheet .serif {{ font-family: {SERQ}; }}')
add(f'      #sheet .unit {{ font-family: {SERQ}; font-size: 23.5px; }}')
add(f'      #sheet .unit-i {{ font-family: {SERQ}; font-size: 23.5px; font-style: italic; }}')
add(f'      #sheet .title {{ font-family: {TITQ}; font-size: 40px; font-weight: 700; letter-spacing: -5.8px; }}')
add('      #sheet .meta { font-size: 26.5px; }')
add(f'      #sheet .lt {{ font-family: {SERQ}; font-style: italic; font-size: 27px; }}')
add(f'      #sheet .unit-lg {{ font-family: {SERQ}; font-size: 29px; font-style: italic; }}')
add(f'      #sheet .line {{ stroke: {INK}; fill: none; stroke-linecap: square; }}')
add('      #sheet .cells { fill: none; stroke: none; pointer-events: none; }')
add('    </style>')
add('  </defs>')
add('  <g id="sheet">')

# ---------------- title ----------------
add('    <g id="title">')
add(f'      <text class="title" x="{MX + W / 2 + 2.3:.2f}" y="{MY - 66.5:.2f}" text-anchor="middle">全站仪导线观测记录表</text>')
add('    </g>')

# ---------------- meta ----------------
add('    <g id="meta-row" aria-label="表头信息行">')
mb = MY - 19.5
for x, t in [(87, "20"), (156, "年"), (210, "月"), (264, "日"),
             (421, "观测:"), (676, "记录:"), (971, "计算:"), (1258, "班/组:")]:
    add(f'      <text class="meta" x="{MX + x:.2f}" y="{mb:.2f}" text-anchor="start">{t}</text>')
add('    </g>')

METAY0 = MY - 42
for id_, x0, x1, note in [
        ("meta-year", 116, 154, "20 与 年 之间（填写两位年份）"),
        ("meta-month", 183, 209, "年 与 月 之间"),
        ("meta-day", 234, 266, "月 与 日 之间"),
        ("meta-observer", 484, 668, "观测: 之后"),
        ("meta-recorder", 740, 963, "记录: 之后"),
        ("meta-calculator", 1034, 1250, "计算: 之后"),
        ("meta-group", 1328, 1630, "班/组: 之后")]:
    cell(id_, "meta", x0, METAY0, x1, METAY0 + 27, note=note)

# ---------------- table ----------------
add('    <g id="table">')
add('      <g id="frame">')
add(f'        <rect class="line" x="{MX:g}" y="{MY:g}" width="{W:g}" height="{H:.1f}" stroke-width="{LW_OUT}"/>')
add('      </g>')

add('      <g id="grid-vertical" class="line" stroke-width="%g">' % LW_IN)
for i in range(1, 12):
    add(f'        <path id="v{i}" d="M {X(i):.2f} {Y(0):.2f} V {Y(17):.2f}"/>')
add('      </g>')

add('      <g id="grid-horizontal" class="line">')
add(f'        <path id="h-header-bottom" d="M {X(0):.2f} {Y(1):.2f} H {X(12):.2f}" stroke-width="{LW_BLK}"/>')
for b in range(1, 4):
    add(f'        <path id="h-block-{b + 1}" d="M {X(0):.2f} {Y(1 + 4 * b):.2f} H {X(12):.2f}" stroke-width="{LW_BLK}"/>')
for b in range(4):
    r = 1 + 4 * b
    for tag, rr in (("h12", r + 1), ("h23", r + 2), ("h34", r + 3)):
        y = Y(rr)
        segs = [(1, 5), (6, 12)] if tag == "h23" else [(2, 4), (5, 7), (9, 10)]
        add(f'        <g id="s{b + 1}-{tag}" stroke-width="{LW_IN}">')
        for k, (a, c) in enumerate(segs):
            add(f'          <path id="s{b + 1}-{tag}-{k + 1}" d="M {X(a):.2f} {y:.2f} H {X(c):.2f}"/>')
        add('        </g>')
add('      </g>')

add('      <g id="diagonals" class="line" stroke-width="%g">' % LW_IN)
add(f'        <path id="hdr-diag-station" d="M {X(0):.2f} {Y(1):.2f} L {X(1):.2f} {Y(0):.2f}"/>')
add(f'        <path id="hdr-diag-target" d="M {X(1):.2f} {Y(1):.2f} L {X(2):.2f} {Y(0):.2f}"/>')
for b in range(4):
    r = 1 + 4 * b
    add(f'        <path id="s{b + 1}-diag-station" d="M {X(0):.2f} {Y(r + 4):.2f} L {X(1):.2f} {Y(r):.2f}"/>')
    add(f'        <path id="s{b + 1}-diag-target1" d="M {X(1):.2f} {Y(r + 2):.2f} L {X(2):.2f} {Y(r):.2f}"/>')
    add(f'        <path id="s{b + 1}-diag-target2" d="M {X(1):.2f} {Y(r + 4):.2f} L {X(2):.2f} {Y(r + 2):.2f}"/>')
add('      </g>')

# ---------------- header text ----------------
add('    <g id="header-text">')
def hx(x): return MX + x
def hy(y): return MY + y
T(hx(63), hy(32), "测站")
T(hx(95), hy(99), "仪器")
add(f'      <text x="{hx(59):.2f}" y="{hy(133):.2f}" text-anchor="start">高<tspan class="unit-lg">(m)</tspan></text>')
T(hx(201), hy(32), "目标")
T(hx(244), hy(99), "棱镜")
add(f'      <text x="{hx(207):.2f}" y="{hy(133):.2f}" text-anchor="start">高<tspan class="unit-lg">(m)</tspan></text>')
T(hx(330), hy(84), "盘位")
T(hx(458), hy(70), "水平度盘读数", ls=-1.1)
T(hx(458.5), hy(98), "(° ′ ″)", cls="unit", tlen=119)
T(hx(587), hy(70), "2C", family=SER, size=24.5)
T(hx(586.5), hy(98), "(″)", cls="unit", tlen=42)
T(hx(712.5), hy(70), "水平角值")
T(hx(719.5), hy(98), "(° ′ ″)", cls="unit", tlen=117)
T(hx(879), hy(70), "竖盘读数")
T(hx(886), hy(98), "(° ′ ″)", cls="unit", tlen=118)
T(hx(1007.5), hy(54), "指标", ls=-1.5, weight=700)
T(hx(1007.5), hy(85), "差", weight=700)
T(hx(1013), hy(113), "(″)", cls="unit", tlen=42)
T(hx(1134), hy(70), "竖直角", weight=700, tlen=99)
T(hx(1141), hy(98), "(° ′ ″)", cls="unit", tlen=118)
T(hx(1289.5), hy(66.5), "斜距", tlen=76)
T(hx(1289.5), hy(94), "(m)", cls="unit-i", tlen=39)
T(hx(1430.5), hy(66.5), "平距", tlen=76)
T(hx(1431.5), hy(94), "(m)", cls="unit-i", tlen=39)
T(hx(1572), hy(66.5), "高差", tlen=75)
T(hx(1572.5), hy(94), "(m)", cls="unit-i", tlen=39)
add('    </g>')
add('    </g>')   # /table

# ---------------- body ----------------
add('    <g id="body">')
for b in range(4):
    r0 = 1 + 4 * b
    add(f'      <g id="station-{b + 1}" data-station="{b + 1}">')
    for j in range(4):
        jj = r0 + j
        ybase = MY + (ROWS[jj] + ROWS[jj + 1]) / 2 + 10.9
        txt = "L" if j % 2 == 0 else "R"
        add(f'        <text class="lt" id="s{b + 1}-r{j + 1}-face-glyph" x="{MX + (COLS[2] + COLS[3]) / 2 - 1:.2f}" y="{ybase:.2f}" text-anchor="middle">{txt}</text>')
    add(f'        <text class="serif" id="s{b + 1}-angle-l-glyph" style="font-size:26px" x="{MX + 633:.2f}" y="{MY + ROWS[r0] + 28.5:.2f}" text-anchor="start">L</text>')
    add(f'        <text class="lbl" id="s{b + 1}-angle-avg-glyph" style="font-size:23px" x="{MX + 633.5:.2f}" y="{MY + ROWS[r0 + 1] + 27.7:.2f}" text-anchor="start">平均值:</text>')
    add(f'        <text class="serif" id="s{b + 1}-angle-r-glyph" style="font-size:26px" x="{MX + 633:.2f}" y="{MY + ROWS[r0 + 3] + 27.5:.2f}" text-anchor="start">R</text>')
    # label boxes for downstream collision checks
    for j in range(4):
        jj = r0 + j
        cy = (ROWS[jj] + ROWS[jj + 1]) / 2
        cell(f"s{b + 1}-r{j + 1}-face-label", "static", COLS[2] + 31, cy - 9, COLS[3] - 33, cy + 9,
             spans=f"r{j + 1}", col=3, note="印刷盘位 L/R 字形框")
    cell(f"s{b + 1}-angle-l-label", "static", COLS[5] + 6, ROWS[r0] + 8, COLS[5] + 30, ROWS[r0] + 27,
         spans="r1", col=6, note="印刷 L 字形框")
    cell(f"s{b + 1}-angle-avg-label", "static", COLS[5] + 7, ROWS[r0 + 1] + 6, COLS[5] + 83, ROWS[r0 + 1] + 29,
         spans="r2", col=6, note="印刷 平均值: 字形框")
    cell(f"s{b + 1}-angle-r-label", "static", COLS[5] + 6, ROWS[r0 + 3] + 7, COLS[5] + 30, ROWS[r0 + 3] + 26,
         spans="r4", col=6, note="印刷 R 字形框")
    add('      </g>')
add('    </g>')

# ---------------- semantic cells (invisible) ----------------
add('    <g id="cells" class="cells">')
P = 2.5
def rc(id_, role, c0, c1, y0, y1, **kw):
    cell(id_, role, COLS[c0] + P, y0, COLS[c1] - P, y1, **kw)

for b in range(4):
    i = b + 1
    r0 = 1 + 4 * b
    top, bot, mid = ROWS[r0], ROWS[r0 + 4], ROWS[r0 + 2]
    cell(f"s{i}-station", "input", COLS[0] + 8, top + 36, COLS[0] + 96, top + 62,
         spans="r1-r4", col=1, note="斜线左上三角内的输入区（测站名/号）")
    cell(f"s{i}-instrument-height", "input", COLS[0] + 50, top + 150, COLS[0] + 134, top + 178,
         spans="r1-r4", col=1, note="斜线右下三角内的输入区（仪器高/m）")
    for n, (sa, sb) in enumerate(((top, mid), (mid, bot))):
        cell(f"s{i}-r{1 + 2 * n}-target", "input", COLS[1] + 8, sa + 8, COLS[1] + 90, sa + 34,
             spans=f"r{1 + 2 * n}-r{2 + 2 * n}", col=2, note="目标名/编号（斜线左上三角）")
        cell(f"s{i}-r{1 + 2 * n}-prism", "input", COLS[1] + 54, sb - 34, COLS[1] + 136, sb - 8,
             spans=f"r{1 + 2 * n}-r{2 + 2 * n}", col=2, note="棱镜高/m（斜线右下三角）")
    for j in range(4):
        jj = r0 + j
        y0, y1 = ROWS[jj], ROWS[jj + 1]
        cell(f"s{i}-r{j + 1}-face", "static", COLS[2] + P, y0 + P, COLS[3] - P, y1 - P,
             spans=f"r{j + 1}", col=3, note="印刷 L/R（静态，不覆盖）")
        rc(f"s{i}-r{j + 1}-h", "input", 3, 4, y0 + P, y1 - P, spans=f"r{j + 1}", col=4, note="水平度盘读数 度分秒")
        rc(f"s{i}-r{j + 1}-v", "input", 6, 7, y0 + P, y1 - P, spans=f"r{j + 1}", col=7, note="竖盘读数 度分秒")
        rc(f"s{i}-r{j + 1}-s", "input", 9, 10, y0 + P, y1 - P, spans=f"r{j + 1}", col=10, note="斜距/m")
    for n, (sa, sb) in enumerate(((top, mid), (mid, bot))):
        key = f"r{1 + 2 * n}"
        sp = f"r{1 + 2 * n}-r{2 + 2 * n}"
        rc(f"s{i}-{key}-c2", "computed", 4, 5, sa + P, sb - P, spans=sp, col=5, note="2C/″（每目标一个值）")
        rc(f"s{i}-{key}-x", "computed", 7, 8, sa + P, sb - P, spans=sp, col=8, note="指标差/″")
        rc(f"s{i}-{key}-alpha", "computed", 8, 9, sa + P, sb - P, spans=sp, col=9, note="竖直角 度分秒")
        rc(f"s{i}-{key}-d", "computed", 10, 11, sa + P, sb - P, spans=sp, col=11, note="平距/m")
        rc(f"s{i}-{key}-hgt", "computed", 11, 12, sa + P, sb - P, spans=sp, col=12, note="高差/m")
    rc(f"s{i}-angle", "group", 5, 6, top + P, bot - P, spans="r1-r4", col=6, note="水平角值整块（含印刷 L / 平均值: / R）")
    cell(f"s{i}-angle-l", "input", COLS[5] + 26, ROWS[r0] + 3, COLS[6] - P, ROWS[r0 + 1] - 3,
         spans="r1", col=6, note="盘左半测回角值（印刷 L 之后）")
    cell(f"s{i}-angle-avg", "computed", COLS[5] + 86, ROWS[r0 + 1] + 3, COLS[6] - P, ROWS[r0 + 3] - 3,
         spans="r2-r3", col=6, note="一测回平均（印刷 平均值: 之后）")
    cell(f"s{i}-angle-r", "input", COLS[5] + 26, ROWS[r0 + 3] + 3, COLS[6] - P, ROWS[r0 + 4] - 3,
         spans="r4", col=6, note="盘右半测回角值（印刷 R 之后）")

for c in CELLS:
    add(f'      <rect id="{c["id"]}" x="{c["x"]:g}" y="{c["y"]:g}" width="{c["w"]:g}" height="{c["h"]:g}"/>')
add('    </g>')

add('  </g>')
add('</svg>')

svg = "\n".join(L) + "\n"
path = os.path.join(OUT, "全站仪导线观测记录表.svg")
open(path, "w", encoding="utf-8", newline="\n").write(svg)
print("svg ->", os.path.basename(path), len(svg.encode("utf-8")), "bytes")

for c in CELLS:
    c["px"] = round(c["x"] / CW * 100, 4)
    c["py"] = round(c["y"] / CH * 100, 4)
    c["pw"] = round(c["w"] / CW * 100, 4)
    c["ph"] = round(c["h"] / CH * 100, 4)

geo = dict(
    viewBox=dict(x=0, y=0, w=CW, h=CH),
    table=dict(x=MX, y=MY, w=W, h=round(H, 2)),
    grid=dict(cols=[round(MX + c, 2) for c in COLS], rows=[round(MY + r, 2) for r in ROWS]),
    recommended_display_width=1600,
    units="1 viewBox unit = 1/6.324 px-at-measurement = 0.15816 mm on the printed sheet",
    cells=CELLS,
)
jp = os.path.join(OUT, "geometry.json")
json.dump(geo, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("json ->", os.path.basename(jp), len(CELLS), "cells")
print("canvas", CW, CH)


