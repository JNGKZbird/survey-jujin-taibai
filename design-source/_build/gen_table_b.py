# -*- coding: utf-8 -*-
"""Build the blank '三、四等水准测量记录、计算表（双面尺法）' SVG + geometry.json."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("JUJIN_OUT", os.path.dirname(HERE))
os.makedirs(OUT, exist_ok=True)

PX = [154, 238, 323, 376, 451, 510, 586, 677, 768, 862, 954, 1044, 1158]  # screenshot x
ROW0 = 617.0
ROWH = (2007.0 - 617.0) / 36.0          # 38.6111
NOTE0, NOTE1 = 2007.0, 2098.0
TW, TH = PX[-1] - PX[0], NOTE1 - ROW0    # 1004 x 1481
MX, MY = 16.0, 140.0
CW, CH = TW + 2 * MX, MY + TH + 16.0

INK = "#1b1b1b"
CJK = "HarmonyOS Sans SC, PingFang SC, Microsoft YaHei, SimHei, sans-serif"
CJKQ = '"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "SimHei", sans-serif'
SERQ = '"Times New Roman", "Songti SC", "SimSun", serif'

def gx(px): return px - PX[0] + MX
def gy(py): return py - ROW0 + MY
def yk(k): return ROW0 + ROWH * k

L, CELLS = [], []
def add(s): L.append(s)

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def T(x, y, s, size=22.0, anchor="middle", family=None, weight=None, ls=None, cls=None,
      tspans=None, extra=""):
    a = [f'x="{x:.2f}"', f'y="{y:.2f}"']
    if anchor != "start":
        a.append(f'text-anchor="{anchor}"')
    if size != 22.0:
        a.append(f'style="font-size:{size:g}px"')
    if family:
        a.append(f'font-family="{family}"')
    if weight:
        a.append(f'font-weight="{weight}"')
    if ls is not None:
        a.append(f'letter-spacing="{ls:g}"')
    if cls:
        a.append(f'class="{cls}"')
    if extra:
        a.append(extra)
    inner = "".join(tspans) if tspans else esc(s)
    add(f'      <text {" ".join(a)}>{inner}</text>')

def cell(id_, role, x0, y0, x1, y1, note="", col=None, row=None, spans=""):
    CELLS.append(dict(id=id_, role=role, col=col, row=row, spans=spans,
                      x=round(gx(x0), 2), y=round(gy(y0), 2),
                      w=round(x1 - x0, 2), h=round(y1 - y0, 2), note=note))

def C(i): return PX[i]

# =====================================================================
add('<?xml version="1.0" encoding="UTF-8"?>')
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{CW:g}" height="{CH:g}" viewBox="0 0 {CW:g} {CH:g}" role="img" aria-label="三、四等水准测量记录、计算表（双面尺法，空白）">')
add('  <title>三、四等水准测量记录、计算表（双面尺法）— 空白表格（DSH 视觉稿）</title>')
add('  <desc>按 WPS 预览截图量测重建的印刷表单；不含手写与示例数据，数据格全部留空。</desc>')
add('  <defs>')
add('    <style>')
add(f'      #sheet text {{ font-family: {CJKQ}; fill: {INK}; font-size: 22px; }}')
add(f'      #sheet .serif {{ font-family: {SERQ}; }}')
add(f'      #sheet .title {{ font-family: {CJKQ}; font-size: 32px; font-weight: 700; }}')
add(f'      #sheet .meta {{ font-size: 25px; }}')
add(f'      #sheet .note {{ font-size: 22px; }}')
add(f'      #sheet .line {{ stroke: {INK}; fill: none; stroke-linecap: square; }}')
add('      #sheet .cells { fill: none; stroke: none; pointer-events: none; }')
add('    </style>')
add('  </defs>')
add('  <g id="sheet">')

# ---------------- title ----------------
add('    <g id="title">')
add(f'      <text id="title-main" class="title" x="212.00" y="43.50" text-anchor="start" letter-spacing="0.7">三、四等水准测量记录、计算表</text>')
add(f'      <text id="title-sub" class="title" x="676.00" y="43.50" text-anchor="start" style="font-size:23.5px">（双面尺法）</text>')
add('    </g>')

# ---------------- meta ----------------
add('    <g id="meta-row" aria-label="表头信息行">')
meta = [("日期", 171), ("天气", 340), ("仪器", 486), ("班级", 634), ("小组", 794)]
for t, x0 in meta:
    add(f'      <text class="meta" x="{gx(x0 - 4.5):.2f}" y="{gy(590.5):.2f}" text-anchor="start">{t}</text>')
add('    </g>')

METAY = (560.0, 600.0)
for id_, x0, x1, note in [("meta-date", 216, 332, "日期 之后"),
                          ("meta-weather", 389, 480, "天气 之后"),
                          ("meta-instrument", 535, 626, "仪器 之后"),
                          ("meta-class", 683, 786, "班级 之后"),
                          ("meta-group", 843, 1120, "小组 之后")]:
    cell(id_, "meta", x0, METAY[0], x1, METAY[1], note=note)

# ---------------- table ----------------
add('    <g id="table">')
add(f'      <rect id="frame" class="line" x="{gx(C(0)):g}" y="{gy(ROW0):g}" width="{TW:g}" height="{TH:g}" stroke-width="1.6"/>')

# vertical lines
add('      <g id="grid-vertical" class="line" stroke-width="1">')
add(f'        <path id="v-left" d="M {gx(C(0)):.2f} {gy(ROW0):.2f} V {gy(NOTE1):.2f}"/>')
for idx in (1, 2, 4, 6):
    add(f'        <path id="v{idx}" d="M {gx(C(idx)):.2f} {gy(ROW0):.2f} V {gy(2007):.2f}"/>')
for idx in (3, 5):
    add(f'        <path id="v{idx}-hdr" d="M {gx(C(idx)):.2f} {gy(ROW0):.2f} V {gy(yk(2)):.2f}"/>')
add('      </g>')
# inner vertical lines with a gap on the 4th row of every station block
add('      <g id="grid-vertical-inner" class="line" stroke-width="1">')
for idx in (7, 8, 9, 10):
    add(f'        <g id="v{idx}-segments">')
    start = yk(0)
    for b in range(8):
        y0_, y1_ = yk(4 + 4 * b), yk(4 + 4 * b + 3)
        add(f'          <path id="v{idx}-s{b+1}" d="M {gx(C(idx)):.2f} {gy(y0_):.2f} V {gy(y1_):.2f}"/>')
    add('        </g>')
add(f'        <path id="v11-full" d="M {gx(C(11)):.2f} {gy(ROW0):.2f} V {gy(2007):.2f}"/>')
add(f'        <path id="v-right" d="M {gx(C(12)):.2f} {gy(ROW0):.2f} V {gy(NOTE1):.2f}"/>')
add('      </g>')

# horizontal lines
add('      <g id="grid-horizontal" class="line">')
add(f'        <path id="h-top" d="M {gx(C(0)):.2f} {gy(ROW0):.2f} H {gx(C(12)):.2f}" stroke-width="1.6"/>')
add(f'        <path id="h-note" d="M {gx(C(0)):.2f} {gy(NOTE1):.2f} H {gx(C(12)):.2f}" stroke-width="1.6"/>')
add(f'        <path id="h-data-end" d="M {gx(C(0)):.2f} {gy(2007):.2f} H {gx(C(12)):.2f}" stroke-width="1.25"/>')
# header splits
add(f'        <path id="h-lower-upper-1" d="M {gx(C(3)):.2f} {gy(yk(1)):.2f} H {gx(C(4)):.2f}" stroke-width="1"/>')
add(f'        <path id="h-lower-upper-2" d="M {gx(C(5)):.2f} {gy(yk(1)):.2f} H {gx(C(6)):.2f}" stroke-width="1"/>')
add(f'        <path id="h-back-label" d="M {gx(C(2)):.2f} {gy(yk(2)):.2f} H {gx(C(6)):.2f}" stroke-width="1"/>')
add(f'        <path id="h-staff-divider" d="M {gx(C(7)):.2f} {gy(yk(2)):.2f} H {gx(C(9)):.2f}" stroke-width="1"/>')
add(f'        <path id="h-dist" d="M {gx(C(2)):.2f} {gy(yk(3)):.2f} H {gx(C(6)):.2f}" stroke-width="1"/>')
add(f'        <path id="h-header-bottom" d="M {gx(C(2)):.2f} {gy(yk(4)):.2f} H {gx(C(12)):.2f}" stroke-width="1.25"/>')
# data rows
for b in range(8):
    for j in (1, 2, 3):
        y = yk(4 + 4 * b + j)
        add(f'        <path id="s{b+1}-h{j}" d="M {gx(C(2)):.2f} {gy(y):.2f} H {gx(C(11)):.2f}" stroke-width="1"/>')
    yb = yk(4 + 4 * b + 4)
    add(f'        <path id="s{b+1}-block" d="M {gx(C(0)):.2f} {gy(yb):.2f} H {gx(C(11)):.2f}" stroke-width="1.25"/>')
add('      </g>')

# ---------------- header text ----------------
add('    <g id="header-text">')
def vtext(s, cx, cy, pitch=26.4, size=22.0, cid=None):
    n = len(s)
    for i, ch in enumerate(s):
        yy = cy + (i - (n - 1) / 2) * pitch + 0.425 * size - 1
        idattr = f' id="{cid}-{i+1}"' if cid else ""
        add(f'      <text{idattr} x="{gx(cx):.2f}" y="{gy(yy):.2f}" text-anchor="middle">{ch}</text>')

def ctext(s, cx, cy, size=22.0, family=None, ls=None, cid=None, dy=None):
    yy = cy + (dy if dy is not None else 0.425 * size)
    a = [f'x="{gx(cx):.2f}"', f'y="{gy(yy):.2f}"', 'text-anchor="middle"']
    if family:
        a.append(f'font-family="{family}"')
    if ls is not None:
        a.append(f'letter-spacing="{ls:g}"')
    if cid:
        a.append(f'id="{cid}"')
    add(f'      <text {" ".join(a)}>{esc(s)}</text>')

vtext("观测者", (C(0) + C(1)) / 2, (ROW0 + yk(8)) / 2, cid="h-observers")
vtext("测站编号", (C(1) + C(2)) / 2, (ROW0 + yk(8)) / 2, pitch=26.9, cid="h-station-no")
vtext("后尺", (C(2) + C(3)) / 2, (ROW0 + yk(2)) / 2, cid="h-back-ruler")
vtext("前尺", (C(4) + C(5)) / 2, (ROW0 + yk(2)) / 2, cid="h-front-ruler")
ctext("下丝", (C(3) + C(4)) / 2, (yk(0) + yk(1)) / 2, cid="h-back-lower")
ctext("上丝", (C(3) + C(4)) / 2, (yk(1) + yk(2)) / 2, cid="h-back-upper")
ctext("下丝", (C(5) + C(6)) / 2, (yk(0) + yk(1)) / 2, cid="h-front-lower")
ctext("上丝", (C(5) + C(6)) / 2, (yk(1) + yk(2)) / 2, cid="h-front-upper")
ctext("后视距", (C(2) + C(4)) / 2, (yk(2) + yk(3)) / 2, cid="h-back-dist")
ctext("前视距", (C(4) + C(6)) / 2, (yk(2) + yk(3)) / 2, cid="h-front-dist")

# 视距差 d  (mixed CJK + italic latin)
yy = (yk(3) + yk(4)) / 2 + 9.35
add(f'      <text id="h-dist-diff" x="{gx((C(2) + C(4)) / 2):.2f}" y="{gy(yy):.2f}" text-anchor="middle" letter-spacing="1.5">视距差<tspan class="serif" font-style="italic" font-size="24">d</tspan></text>')
yy = (yk(3) + yk(4)) / 2 + 9.35
add(f'      <text id="h-sum-d" x="{gx((C(4) + C(6)) / 2):.2f}" y="{gy(yy):.2f}" text-anchor="middle" letter-spacing="4"><tspan class="serif" font-size="30">Σ</tspan><tspan class="serif" font-style="italic" font-size="26">d</tspan></text>')

# two-line header labels
def two_lines(l1, l2, cx, cy, pitch=26.4, id1=None, id2=None):
    a1 = f' id="{id1}"' if id1 else ''
    a2 = f' id="{id2}"' if id2 else ''
    add(f'      <text{a1} x="{gx(cx):.2f}" y="{gy(cy - pitch / 2 + 9.35):.2f}" text-anchor="middle">{l1}</text>')
    add(f'      <text{a2} x="{gx(cx):.2f}" y="{gy(cy + pitch / 2 + 9.35):.2f}" text-anchor="middle">{l2}</text>')

two_lines("方向及", "尺号", (C(6) + C(7)) / 2, (yk(0) + yk(4)) / 2, id1="h-direction-1", id2="h-direction-2")
ctext("标尺读数", (C(7) + C(9)) / 2, (yk(0) + yk(2)) / 2, cid="h-staff-read")
ctext("黑面", (C(7) + C(8)) / 2, (yk(2) + yk(4)) / 2, cid="h-black")
ctext("红面", (C(8) + C(9)) / 2, (yk(2) + yk(4)) / 2, cid="h-red")
two_lines("K+黑", "-红", (C(9) + C(10)) / 2, (yk(0) + yk(4)) / 2, id1="h-k-diff-1", id2="h-k-diff-2")
two_lines("高差", "中数", (C(10) + C(11)) / 2, (yk(0) + yk(4)) / 2, id1="h-mean-height-1", id2="h-mean-height-2")
ctext("备注", (C(11) + C(12)) / 2 + 9.5, (yk(0) + yk(4)) / 2, ls=19, cid="h-remark")
add('    </g>')

# ---------------- block 1 printed numbers ----------------
add('    <g id="header-numbers">')
def num(s, cx, cy, cid):
    yy = cy + 7.0
    add(f'      <text class="serif" id="{cid}" x="{gx(cx + 2):.2f}" y="{gy(yy):.2f}" text-anchor="middle" letter-spacing="4">{s}</text>')

def cellc(i0, i1, k0, k1):
    return (C(i0) + C(i1)) / 2, (yk(k0) + yk(k1)) / 2

rows = [(4, 5), (5, 6), (6, 7), (7, 8)]
labels = [("(1)", "(4)", "后", "(3)", "(8)", "(14)", None),
          ("(2)", "(5)", "前", "(6)", "(7)", "(13)", None),
          ("(9)", "(10)", "后-前", "(15)", "(16)", "(17)", "(18)"),
          ("(11)", "(12)", None, None, None, None, None)]
for r, (k0, k1) in enumerate(rows):
    vals = labels[r]
    for cidx, v in enumerate(vals):
        if v is None:
            continue
        if cidx == 0:   # back
            cx, cy = cellc(2, 4, k0, k1)
        elif cidx == 1: # front
            cx, cy = cellc(4, 6, k0, k1)
        elif cidx == 2: # direction (CJK)
            cx, cy = cellc(6, 7, k0, k1)
        elif cidx == 3: # black
            cx, cy = cellc(7, 8, k0, k1)
        elif cidx == 4: # red
            cx, cy = cellc(8, 9, k0, k1)
        elif cidx == 5: # k
            cx, cy = cellc(9, 10, k0, k1)
        else:           # mean
            cx, cy = cellc(10, 11, k0, k1)
        cid = f"s1-r{r+1}-{'back' if cidx==0 else 'front' if cidx==1 else 'dir' if cidx==2 else 'black' if cidx==3 else 'red' if cidx==4 else 'k' if cidx==5 else 'mean'}"
        if cidx == 2:
            yy = cy + 9.35
            add(f'      <text id="{cid}" x="{gx(cx + 2):.2f}" y="{gy(yy):.2f}" text-anchor="middle" letter-spacing="4">{v}</text>')
        else:
            num(v, cx, cy, cid)
add('    </g>')

# ---------------- K note ----------------
add('    <g id="note">')
ny = NOTE1 - 40.0
add(f'      <text class="note" x="{gx(231):.2f}" y="{gy(ny):.2f}" text-anchor="start" textLength="377" lengthAdjust="spacing">'
    f'<tspan class="serif">K</tspan> 为水准尺常数，如 <tspan class="serif">K</tspan>'
    f'<tspan class="serif" style="font-size:15px" dy="3">1</tspan><tspan dy="-3" class="serif"> = 4.787</tspan>'
    f'<tspan dx="16">   </tspan>'
    f'<tspan class="serif">K</tspan><tspan class="serif" style="font-size:15px" dy="3">2</tspan>'
    f'<tspan dy="-3" class="serif"> = 4.687</tspan>'
    f'</text>')
add('    </g>')
add('  </g>')   # /table

# ---------------- semantic cells ----------------
add('  <g id="cells" class="cells">')
P = 2.0
# header cells
hdr = [
    ("h-observers", C(0), ROW0, C(1), yk(8), "观测者（逐字竖排，静态）"),
    ("h-station-no", C(1), ROW0, C(2), yk(8), "测站编号（逐字竖排，静态）"),
    ("h-back-ruler", C(2), ROW0, C(3), yk(2), "后尺（静态）"),
    ("h-back-lower", C(3), yk(0), C(4), yk(1), "下丝（静态）"),
    ("h-back-upper", C(3), yk(1), C(4), yk(2), "上丝（静态）"),
    ("h-front-ruler", C(4), ROW0, C(5), yk(2), "前尺（静态）"),
    ("h-front-lower", C(5), yk(0), C(6), yk(1), "下丝（静态）"),
    ("h-front-upper", C(5), yk(1), C(6), yk(2), "上丝（静态）"),
    ("h-back-dist", C(2), yk(2), C(4), yk(3), "后视距（静态）"),
    ("h-front-dist", C(4), yk(2), C(6), yk(3), "前视距（静态）"),
    ("h-dist-diff", C(2), yk(3), C(4), yk(4), "视距差 d（静态）"),
    ("h-sum-d", C(4), yk(3), C(6), yk(4), "Σd（静态）"),
    ("h-direction", C(6), ROW0, C(7), yk(4), "方向及尺号（静态）"),
    ("h-staff-read", C(7), ROW0, C(9), yk(2), "标尺读数（静态）"),
    ("h-black", C(7), yk(2), C(8), yk(4), "黑面（静态）"),
    ("h-red", C(8), yk(2), C(9), yk(4), "红面（静态）"),
    ("h-k-diff", C(9), ROW0, C(10), yk(4), "K+黑-红（静态）"),
    ("h-mean-height", C(10), ROW0, C(11), yk(4), "高差中数（静态）"),
    ("h-remark", C(11), ROW0, C(12), yk(4), "备注（静态）"),
]
for id_, x0, y0, x1, y1, note in hdr:
    cell(id_, "static", x0, y0, x1, y1, note=note)

for b in range(8):
    k0 = 4 + 4 * b
    nm = "" if b == 0 else f"站 {b+1} "
    # station no + observers extra cells (b>=1)
    if b >= 1:
        cell(f"s{b+1}-station-no", "input", C(1), yk(k0), C(2), yk(k0 + 4), note=nm + "测站编号格")
        cell(f"s{b+1}-observers", "static", C(0), yk(k0), C(1), yk(k0 + 4), note="观测者列（静态空列）")
    for j in range(4):
        kk = k0 + j
        cell(f"s{b+1}-r{j+1}-back", "input", C(2) + P, yk(kk) + P, C(4) - P, yk(kk + 1) - P,
             note=nm + "后尺读数/视距", col=3, row=j + 1)
        cell(f"s{b+1}-r{j+1}-front", "input", C(4) + P, yk(kk) + P, C(6) - P, yk(kk + 1) - P,
             note=nm + "前尺读数/视距", col=4, row=j + 1)
        if j < 3:
            cell(f"s{b+1}-r{j+1}-dir", "input", C(6) + P, yk(kk) + P, C(7) - P, yk(kk + 1) - P,
                 note=nm + "方向及尺号", col=5, row=j + 1)
            cell(f"s{b+1}-r{j+1}-black", "input", C(7) + P, yk(kk) + P, C(8) - P, yk(kk + 1) - P,
                 note=nm + "黑面读数", col=6, row=j + 1)
            cell(f"s{b+1}-r{j+1}-red", "input", C(8) + P, yk(kk) + P, C(9) - P, yk(kk + 1) - P,
                 note=nm + "红面读数", col=7, row=j + 1)
            cell(f"s{b+1}-r{j+1}-k", "computed", C(9) + P, yk(kk) + P, C(10) - P, yk(kk + 1) - P,
                 note=nm + "K+黑-红", col=8, row=j + 1)
            cell(f"s{b+1}-r{j+1}-mean", "computed", C(10) + P, yk(kk) + P, C(11) - P, yk(kk + 1) - P,
                 note=nm + "高差中数", col=9, row=j + 1)
        else:
            cell(f"s{b+1}-r4-wide", "input", C(6) + P, yk(kk) + P, C(11) - P, yk(kk + 1) - P,
                 note=nm + "第4行横向合并格（空）", col=5, row=4)
    cell(f"s{b+1}-remark", "input", C(11) + P, yk(k0) + P, C(12) - P, yk(k0 + 4) - P,
         note=nm + "备注（整站）", col=10)
add('    <g id="remark-span">')
cell("remark", "input", C(11) + P, yk(4) + P, C(12) - P, 2007 - P, note="备注整列合并（8 站）", col=10)
add('    </g>')
for c in CELLS:
    add(f'      <rect id="{c["id"]}-box" x="{c["x"]:g}" y="{c["y"]:g}" width="{c["w"]:g}" height="{c["h"]:g}"/>')
add('    </g>')

add('  </g>')
add('</svg>')

svg = "\n".join(L) + "\n"
path = os.path.join(OUT, "三四等水准-记录表.svg")
open(path, "w", encoding="utf-8", newline="\n").write(svg)
print("svg ->", len(svg.encode("utf-8")), "bytes")

for c in CELLS:
    c["px"] = round(c["x"] / CW * 100, 4)
    c["py"] = round(c["y"] / CH * 100, 4)
    c["pw"] = round(c["w"] / CW * 100, 4)
    c["ph"] = round(c["h"] / CH * 100, 4)

geo = dict(
    viewBox=dict(x=0, y=0, w=CW, h=round(CH, 2)),
    table=dict(x=MX, y=MY, w=TW, h=round(TH, 2)),
    grid=dict(cols=[round(gx(v), 2) for v in PX], rows=[round(gy(yk(k)), 2) for k in range(37)] + [round(gy(NOTE1), 2)]),
    recommended_display_width=1036,
    note_row=dict(y0=round(gy(2007), 2), y1=round(gy(NOTE1), 2)),
    cells=CELLS,
)
jp = os.path.join(OUT, "三四等水准-geometry.json")
json.dump(geo, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("json ->", len(CELLS), "cells", "canvas", CW, CH)
