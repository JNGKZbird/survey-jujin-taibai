# -*- coding: utf-8 -*-
"""Build '三角高程测量平差表' (表六) blank SVG + geometry.json.

Adapted from the DSH visual handoff (视觉稿/_build/gen_table_f.py).  The
paper form has 16 rows; the app uses 17 so a 17-station closed traverse
maps one side per row without dropping the closing side.  A start
elevation field is added to the header meta row because the final
elevation column needs a starting value and the paper form has none.

Run from anywhere:  python tools/gen_table_f.py
Outputs into design-source/ (the read-only DSH snapshot directory).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "design-source")
os.makedirs(OUT, exist_ok=True)

NROWS = 17
W = [66, 189.5, 189.5, 118, 116.5, 116, 116.1, 118.4, 118.5, 116.9, 116.1, 118.5]
COLS = [0.0]
for w in W:
    COLS.append(round(COLS[-1] + w, 2))
HDR1, HDR2 = 42.0, 72.0
ROWH = 56.5
SUM_H, EVAL_H = 40.0, 62.0

MX = 24.0
T0 = 140.0
Y1 = T0 + HDR1                  # 182
Y2 = Y1 + HDR2                  # 254
DATA1 = Y2 + NROWS * ROWH       # 1214.5
SIG1 = DATA1 + SUM_H            # 1254.5
T1 = SIG1 + EVAL_H              # 1316.5
CW = 1548.0
CH = T1 + 40.0                  # 1356.5
TW = COLS[-1]

INK = "#1b1b1b"
CJKQ = '"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "SimHei", sans-serif'
SERQ = '"Times New Roman", "Songti SC", "SimSun", serif'

L, CELLS = [], []


def add(s):
    L.append(s)


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell(id_, role, x0, y0, x1, y1, note="", col=None, row=None):
    CELLS.append(dict(id=id_, role=role, col=col, row=row,
                      x=round(x0, 2), y=round(y0, 2),
                      w=round(x1 - x0, 2), h=round(y1 - y0, 2),
                      note=note))


def C(i):
    return MX + COLS[i]


def Yr(r):
    return Y2 + r * ROWH


add('<?xml version="1.0" encoding="UTF-8"?>')
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{CW:g}" height="{CH:g}" '
    f'viewBox="0 0 {CW:g} {CH:g}" role="img" aria-label="三角高程测量平差表（空白）">')
add('  <title>三角高程测量平差表 — 空白表格（DSH 视觉稿）</title>')
add('  <desc>按纸质表照片透视校正后重建的印刷表单；不含手写与示例数据。</desc>')
add('  <defs>')
add('    <style>')
add(f'      #sheet text {{ font-family: {CJKQ}; fill: {INK}; font-size: 20px; }}')
add(f'      #sheet .serif {{ font-family: {SERQ}; }}')
add(f'      #sheet .unit {{ font-family: {SERQ}; font-size: 18px; }}')
add(f'      #sheet .title {{ font-family: {CJKQ}; font-size: 34px; font-weight: 700; }}')
add(f'      #sheet .meta {{ font-size: 22px; }}')
add(f'      #sheet .diag {{ font-size: 19px; }}')
add(f'      #sheet .line {{ stroke: {INK}; fill: none; stroke-linecap: square; }}')
add('      #sheet .cells { fill: none; stroke: none; pointer-events: none; }')
add('    </style>')
add('  </defs>')
add('  <g id="sheet">')

# title + meta
add('    <g id="title">')
add(f'      <text class="title" x="{MX + TW / 2:.2f}" y="70" text-anchor="middle">三角高程测量平差表</text>')
add('    </g>')
add('    <g id="meta-row">')
add(f'      <text class="meta" x="{MX:g}" y="116" text-anchor="start">起点高程</text>')
add(f'      <text class="unit" x="118" y="116" text-anchor="start">(m)</text>')
for t, x in [("计算:", 300), ("检核:", 780), ("班/组:", 1140)]:
    add(f'      <text class="meta" x="{x}" y="116" text-anchor="start">{esc(t)}</text>')
add('    </g>')
for id_, x0, x1 in [("meta-start-elev", 156, 292), ("meta-calc", 356, 740),
                    ("meta-check", 838, 1110), ("meta-group", 1214, 1500)]:
    cell(id_, "meta", x0, 94, x1, 124, note="表头信息行填写区")

# table frame
add('    <g id="table">')
add(f'      <rect id="frame" class="line" x="{MX:g}" y="{T0:g}" width="{TW:g}" '
    f'height="{T1 - T0:.1f}" stroke-width="2.6"/>')

# verticals
add('      <g id="grid-vertical" class="line" stroke-width="1.15">')
for i in range(1, 12):           # header + data rows
    ystart = Y1 if i in (2, 4, 6, 7) else T0   # 块标题跨列：这些竖线从第 2 行起
    add(f'        <path id="v{i}" d="M {C(i):.1f} {ystart:g} V {DATA1:.1f}"/>')
for i in range(3, 12):           # sigma row (merged 0..3)
    add(f'        <path id="v{i}-sig" d="M {C(i):.1f} {DATA1:.1f} V {SIG1:.1f}"/>')
add(f'        <path id="v11-eval" d="M {C(11):.1f} {SIG1:.1f} V {T1:.1f}"/>')
add('      </g>')

# horizontals
add('      <g id="grid-horizontal" class="line">')
add(f'        <path id="h-h1" d="M {C(1):.1f} {Y1:.1f} H {C(8):.1f}" stroke-width="1.9"/>')
add(f'        <path id="h-h2" d="M {C(1):.1f} {Y2:.1f} H {C(11):.1f}" stroke-width="1.9"/>')
for r in range(1, NROWS):
    add(f'        <path id="h-r{r}" d="M {MX:g} {Yr(r):.1f} H {C(11):.1f}" stroke-width="1.15"/>')
add(f'        <path id="h-data-end" d="M {MX:g} {DATA1:.1f} H {C(11):.1f}" stroke-width="1.9"/>')
add(f'        <path id="h-sum-end" d="M {MX:g} {SIG1:.1f} H {C(11):.1f}" stroke-width="1.15"/>')
add(f'        <path id="h-eval" d="M {MX:g} {T1:.1f} H {C(11):.1f}" stroke-width="1.9"/>')
add('      </g>')

# diagonals: header obs cells + every data obs cell + sigma voids
add('      <g id="diagonals" class="line" stroke-width="1.15">')
for i in (1, 2):   # header obs cells (cols 2,3)
    add(f'        <path id="hdr-diag-{i}" d="M {C(i):.1f} {Y2:.1f} L {C(i+1):.1f} {Y1:.1f}"/>')
for r in range(NROWS):
    y0, y1 = Yr(r), Yr(r + 1)
    for i in (1, 2):
        add(f'        <path id="s{r+1}-diag-{i}" d="M {C(i):.1f} {y1:.1f} L {C(i+1):.1f} {y0:.1f}"/>')
# sigma voids
for i in (4, 6, 7, 10):
    add(f'        <path id="sig-diag-{i}" d="M {C(i):.1f} {SIG1:.1f} L {C(i+1):.1f} {DATA1:.1f}"/>')
add('      </g>')

# ---------------- header text ----------------
add('    <g id="header-text">')


def mid(i, j):
    return (C(i) + C(j)) / 2


add(f'      <text id="h-name" x="{mid(0,1):.1f}" y="{(T0 + Y2) / 2 + 7:.1f}" text-anchor="middle">点名</text>')
add(f'      <text id="h-obs" x="{mid(1,3):.1f}" y="{T0 + 27:.1f}" text-anchor="middle">高差/平距往返测观测值<tspan class="unit">(m)</tspan></text>')
add(f'      <text id="h-dist" x="{mid(3,5):.1f}" y="{T0 + 27:.1f}" text-anchor="middle">平距往返测</text>')
add(f'      <text id="h-dh" x="{mid(5,8):.1f}" y="{T0 + 27:.1f}" text-anchor="middle">高差对向观测</text>')


# 3-line vertical blocks
def block3(i, lines, id_=None):
    x = mid(i, i + 1)
    cy = (Y1 + Y2) / 2
    for k, t in enumerate(lines):
        cls = ' class="unit"' if t.startswith("(") else ""
        idattr = f' id="{id_}"' if (k == 0 and id_) else ""
        add(f'      <text{idattr} x="{x:.1f}" y="{cy + (k - (len(lines) - 1) / 2) * 25 + 7:.1f}" text-anchor="middle"{cls}>{esc(t)}</text>')


block3(8, ["高差", "改正值", "(mm)"], "h-corr")
block3(9, ["改正后", "的高差", "(m)"], "h-adj")
block3(10, ["最终高程", "(m)"], "h-elev")
add(f'      <text id="h-note" x="{mid(11,12):.1f}" y="{(Y1 + Y2) / 2 + 7:.1f}" text-anchor="middle">备 注</text>')
# obs diagonals labels
add(f'      <text class="diag" x="{C(1) + 8:.1f}" y="{Y1 + 26:.1f}" text-anchor="start">往测高差</text>')
add(f'      <text class="diag" x="{C(2) - 8:.1f}" y="{Y2 - 10:.1f}" text-anchor="end">往测平距</text>')
add(f'      <text class="diag" x="{C(2) + 8:.1f}" y="{Y1 + 26:.1f}" text-anchor="start">返测高差</text>')
add(f'      <text class="diag" x="{C(3) - 8:.1f}" y="{Y2 - 10:.1f}" text-anchor="end">返测平距</text>')
# sub labels row 2 (cols 4..8)
subs = [(3, ["平均值", "(m)"]), (4, ["相对误差", "(1/?)"]), (5, ["平均值", "(m)"]),
        (6, ["较差", "(mm)"]), (7, ["较差允许值", "(mm)"])]
for i, lines in subs:
    x = mid(i, i + 1)
    cy = (Y1 + Y2) / 2
    for k, t in enumerate(lines):
        cls = ' class="unit"' if t.startswith("(") else ""
        add(f'      <text x="{x:.1f}" y="{cy + (k - (len(lines) - 1) / 2) * 25 + 7:.1f}" text-anchor="middle"{cls}>{esc(t)}</text>')
add('    </g>')

# ---------------- sigma + evaluation rows ----------------
add('    <g id="sigma-row">')
add(f'      <text x="{mid(0,3):.1f}" y="{DATA1 + SUM_H / 2 + 8:.1f}" text-anchor="middle" style="font-size:24px">Σ</text>')
add('    </g>')
add('    <g id="eval-row">')
add(f'      <text x="{MX + 10:.1f}" y="{SIG1 + 28:.1f}" text-anchor="start">精度评定:</text>')
add('    </g>')
add('    </g>')   # /table

# ---------------- semantic cells ----------------
add('  <g id="cells" class="cells">')
P = 2.5
# header statics
cell("h-name", "static", C(0), T0, C(1), Y2, note="点名（静态）")
cell("h-obs", "static", C(1), T0, C(3), Y1, note="高差/平距往返测观测值（静态）")
cell("h-dist", "static", C(3), T0, C(5), Y1, note="平距往返测（静态）")
cell("h-dh", "static", C(5), T0, C(8), Y1, note="高差对向观测（静态）")
cell("h-corr", "static", C(8), T0, C(9), Y2, note="高差改正值（静态）")
cell("h-adj", "static", C(9), T0, C(10), Y2, note="改正后的高差（静态）")
cell("h-elev", "static", C(10), T0, C(11), Y2, note="最终高程（静态）")
cell("h-note", "static", C(11), T0, C(12), Y2, note="备注（静态）")
cell("h-sub-mean1", "static", C(3), Y1, C(4), Y2, note="平均值（静态）")
cell("h-sub-rel", "static", C(4), Y1, C(5), Y2, note="相对误差（静态）")
cell("h-sub-mean2", "static", C(5), Y1, C(6), Y2, note="平均值（静态）")
cell("h-sub-diff", "static", C(6), Y1, C(7), Y2, note="较差（静态）")
cell("h-sub-allow", "static", C(7), Y1, C(8), Y2, note="较差允许值（静态）")

# data rows: obs cells are diagonal -> two inscribed boxes each
def diag_boxes(i, y0, y1):
    x0, x1 = C(i), C(i + 1)
    w, h = x1 - x0, y1 - y0
    up = (x0 + 10, y0 + 4, x0 + w * 0.52, y0 + h * 0.42)
    lo = (x0 + w * 0.42, y1 - h * 0.42, x1 - 10, y1 - 4)
    return up, lo


for r in range(NROWS):
    y0, y1 = Yr(r), Yr(r + 1)
    n = f"第 {r+1} 点 "
    cell(f"s{r+1}-id", "input", C(0) + P, y0 + P, C(1) - P, y1 - P, note=n + "点名", col=1, row=r+1)
    up, lo = diag_boxes(1, y0, y1)
    cell(f"s{r+1}-fwd-dh", "input", up[0], up[1], up[2], up[3], note=n + "往测高差（斜线左上）", col=2, row=r+1)
    cell(f"s{r+1}-fwd-s", "input", lo[0], lo[1], lo[2], lo[3], note=n + "往测平距（斜线右下）", col=2, row=r+1)
    up, lo = diag_boxes(2, y0, y1)
    cell(f"s{r+1}-ret-dh", "input", up[0], up[1], up[2], up[3], note=n + "返测高差（斜线左上）", col=3, row=r+1)
    cell(f"s{r+1}-ret-s", "input", lo[0], lo[1], lo[2], lo[3], note=n + "返测平距（斜线右下）", col=3, row=r+1)
    cell(f"s{r+1}-dist-mean", "computed", C(3) + P, y0 + P, C(4) - P, y1 - P, note=n + "平距平均值", col=4, row=r+1)
    cell(f"s{r+1}-dist-rel", "computed", C(4) + P, y0 + P, C(5) - P, y1 - P, note=n + "相对误差", col=5, row=r+1)
    cell(f"s{r+1}-dh-mean", "computed", C(5) + P, y0 + P, C(6) - P, y1 - P, note=n + "高差对向平均值", col=6, row=r+1)
    cell(f"s{r+1}-dh-diff", "computed", C(6) + P, y0 + P, C(7) - P, y1 - P, note=n + "较差（mm）", col=7, row=r+1)
    cell(f"s{r+1}-dh-allow", "computed", C(7) + P, y0 + P, C(8) - P, y1 - P, note=n + "较差允许值（mm）", col=8, row=r+1)
    cell(f"s{r+1}-dh-corr", "computed", C(8) + P, y0 + P, C(9) - P, y1 - P, note=n + "高差改正值（mm）", col=9, row=r+1)
    cell(f"s{r+1}-dh-adj", "computed", C(9) + P, y0 + P, C(10) - P, y1 - P, note=n + "改正后的高差", col=10, row=r+1)
    cell(f"s{r+1}-elev", "input", C(10) + P, y0 + P, C(11) - P, y1 - P, note=n + "最终高程", col=11, row=r+1)

# sigma row
cell("sigma-label", "static", C(0) + P, DATA1 + P, C(3) - P, SIG1 - P, note="Σ（静态）")
cell("sigma-dist-mean", "computed", C(3) + P, DATA1 + P, C(4) - P, SIG1 - P, note="平距平均合计")
cell("sigma-dist-void", "static", C(4) + P, DATA1 + P, C(5) - P, SIG1 - P, note="斜线区")
cell("sigma-dh-mean", "computed", C(5) + P, DATA1 + P, C(6) - P, SIG1 - P, note="高差平均合计")
cell("sigma-dh-diff", "static", C(6) + P, DATA1 + P, C(7) - P, SIG1 - P, note="斜线区")
cell("sigma-allow", "static", C(7) + P, DATA1 + P, C(8) - P, SIG1 - P, note="斜线区")
cell("sigma-corr", "computed", C(8) + P, DATA1 + P, C(9) - P, SIG1 - P, note="改正值合计")
cell("sigma-adj", "computed", C(9) + P, DATA1 + P, C(10) - P, SIG1 - P, note="改正后高差合计")
cell("sigma-elev", "static", C(10) + P, DATA1 + P, C(11) - P, SIG1 - P, note="斜线区")

# merged right-hand cells
cell("remark", "input", C(11) + P, T0 + P, C(12) - P, T1 - P, note="备注（整列合并，从表头到表底）")
cell("eval", "input", C(0) + P, SIG1 + P, C(11) - P, T1 - P, note="精度评定（整行合并）")

for c in CELLS:
    add(f'      <rect id="{c["id"]}-box" x="{c["x"]:g}" y="{c["y"]:g}" '
        f'width="{c["w"]:g}" height="{c["h"]:g}"/>')
add('  </g>')
add('  </g>')   # /sheet
add('</svg>')

svg = "\n".join(L) + "\n"
open(os.path.join(OUT, "三角高程-平差表.svg"), "w", encoding="utf-8", newline="\n").write(svg)

for c in CELLS:
    c["px"] = round(c["x"] / CW * 100, 4)
    c["py"] = round(c["y"] / CH * 100, 4)
    c["pw"] = round(c["w"] / CW * 100, 4)
    c["ph"] = round(c["h"] / CH * 100, 4)

geo = dict(
    viewBox=dict(x=0, y=0, w=CW, h=CH),
    table=dict(x=MX, y=T0, w=round(TW, 2), h=round(T1 - T0, 2)),
    grid=dict(cols=[round(C(i), 2) for i in range(13)],
              hdr_rows=[T0, Y1, Y2], row_h=ROWH, n_rows=NROWS,
              sigma_row=[DATA1, SIG1], eval_row=[SIG1, T1]),
    recommended_display_width=1500,
    cells=CELLS,
)
json.dump(geo, open(os.path.join(OUT, "三角高程-geometry.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("svg", len(svg.encode("utf-8")), "bytes;", len(CELLS), "cells; canvas", CW, CH)
