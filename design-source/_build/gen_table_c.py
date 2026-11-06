# -*- coding: utf-8 -*-
r"""表 C · 角度距离观测记录手簿 —— 生成器（单一数据源 -> SVG + geometry.json）

依据：委托书-角度距离手簿-交DSH.md
源图：本地参考照片（斜拍照片，只读；未随仓库提供）

用法：
    python gen_table_c.py
输出（写到本脚本的上一级目录，即 视觉稿\）：
    角度距离-记录手簿.svg
    角度距离-geometry.json

改几何只改本文件的 COLS / HEADER_H / 文字表，不要手改 SVG（会让 SVG 与 JSON 失配）。
预览渲染见 _build\README.md（Edge 无头）。

"""
import json
import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)   # 视觉稿\
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- geometry
TW, TH = 1200.0, 1272.0          # table size in design units
HEADER_H = 67.7
ROW_H = (TH - HEADER_H) / 24.0   # 50.179166...
COLS = [0.0, 60.6, 122.2, 180.8, 332.3, 487.6, 590.5, 750.6, 910.5, 1059.2, 1200.0]
OFFX, OFFY = 24.0, 170.0         # table position on the canvas
CW, CH = 1248.0, 1490.0          # canvas size
INK = '#1c1c1c'
SERIF = '"SimSun","Songti SC","STSong","Noto Serif CJK SC","Noto Serif SC","Source Han Serif SC","Times New Roman",serif'
LATIN = '"Times New Roman","SimSun",serif'

COL_KEYS = ['station', 'face', 'target', 'reading', 'halfangle', 'halfdiff', 'angle', 'sketch', 'distance', 'relerr']
COL_LABELS = ['测站', '盘位', '目标', '度盘读数', '半测回角值', '半测回角值之差', '一测回角值', '角度草图', '距离(m)', '距离及相对误差']


def X(u):
    return u + OFFX


def Y(v):
    return v + OFFY


def f(v):
    s = f'{v:.2f}'
    return s.rstrip('0').rstrip('.') if '.' in s else s


def row_y(k):
    """top y (table local) of data row k (1..24)."""
    return HEADER_H + (k - 1) * ROW_H


def col_x(i):
    return COLS[i]


def col_w(i):
    return COLS[i + 1] - COLS[i]


# ---------------------------------------------------------------- svg parts
svg = []
cells = []          # geometry records


def add_cell(cid, role, col, row, rowspan, colspan, x, y, w, h, label, note=''):
    cells.append(dict(id=cid, role=role, col=col, row=row, rowspan=rowspan, colspan=colspan,
                      x=round(X(x), 2), y=round(Y(y), 2), w=round(w, 2), h=round(h, 2),
                      label=label, note=note))


lines_outer = []
lines_block = []
lines_inner = []
texts = []

# ---- outer frame
lines_outer.append(f'<rect id="table-frame" x="{f(X(0))}" y="{f(Y(0))}" width="{f(TW)}" height="{f(TH)}" stroke-width="2.2"/>')

# ---- vertical grid
for i in range(1, 10):
    lines_inner.append(f'<path id="v{i}" d="M {f(X(COLS[i]))} {f(Y(0))} V {f(Y(TH))}"/>')

# ---- horizontal grid
lines_block.append(f'<path id="h-header" d="M {f(X(0))} {f(Y(HEADER_H))} H {f(X(TW))}"/>')
for b in range(6):
    if b:
        y = row_y(4 * b + 1)
        lines_block.append(f'<path id="h-block-{b + 1}" d="M {f(X(0))} {f(Y(y))} H {f(X(TW))}"/>')
    for j, segs in ((1, [(2, 3), (3, 4), (8, 9)]),
                    (2, [(1, 2), (2, 3), (3, 4), (4, 5), (8, 9)]),
                    (3, [(2, 3), (3, 4), (8, 9)])):
        y = row_y(4 * b + j + 1)
        for (a, c) in segs:
            lines_inner.append(
                f'<path id="s{b + 1}-h{j}{j + 1}-c{a + 1}" d="M {f(X(COLS[a]))} {f(Y(y))} H {f(X(COLS[c]))}"/>')

# ---- title
texts.append('<text id="title" class="title" x="%s" y="%s" text-anchor="middle">角度距离观测记录手簿</text>'
             % (f(X(600)), f(Y(-120.5))))

# ---- meta labels + rules
meta_rows = [
    dict(y_base=-78.0, y_rule=-75.0,
         labels=[('lbl-date', '日期', 120.5), ('lbl-instrument', '仪器', 440.0), ('lbl-observer', '观测', 739.5)],
         rules=[(177.5, 378.0), (497.5, 688.0), (797.5, 958.0)],
         fields=[('meta-date', 177.5, 378.0), ('meta-instrument', 497.5, 688.0), ('meta-observer', 797.5, 958.0)]),
    dict(y_base=-43.5, y_rule=-41.0,
         labels=[('lbl-weather', '天气', 120.0), ('lbl-group', '班组', 439.5), ('lbl-recorder', '记录', 739.0)],
         rules=[(178.0, 378.0), (498.0, 688.0), (798.0, 958.0)],
         fields=[('meta-weather', 178.0, 378.0), ('meta-group', 498.0, 688.0), ('meta-recorder', 798.0, 958.0)]),
]

meta_svg = []
for r, row in enumerate(meta_rows):
    meta_svg.append(f'<g id="meta-row-{r + 1}">')
    for lid, txt, x in row['labels']:
        meta_svg.append(f'<text id="{lid}" class="meta" x="{f(X(x))}" y="{f(Y(row["y_base"]))}" letter-spacing="21.5">{txt}</text>')
    for i, (x0, x1) in enumerate(row['rules']):
        meta_svg.append(f'<path id="meta-rule-{r + 1}-{i + 1}" class="rule" d="M {f(X(x0))} {f(Y(row["y_rule"]))} H {f(X(x1))}"/>')
    for fid, x0, x1 in row['fields']:
        add_cell(fid, 'meta', None, None, 1, 1, x0, row['y_rule'] - 24, x1 - x0, 24,
                 f'表头信息 · {fid}', f'空白填写区，下边线 y={f(Y(row["y_rule"]))}；文字基线建议 y={f(Y(row["y_base"]))}')
    meta_svg.append('</g>')

# ---- table header text
def header_text(cid, cls, x, y, txt, extra=''):
    return f'<text id="{cid}" class="{cls}" x="{f(X(x))}" y="{f(Y(y))}" text-anchor="middle"{extra}>{txt}</text>'


hdr = []
hdr.append('<g id="th-station"><text class="th" x="%s" y="%s" text-anchor="middle"><tspan x="%s" y="%s">测</tspan><tspan x="%s" y="%s">站</tspan></text></g>'
           % (f(X(col_x(0) + col_w(0) / 2)), f(Y(23.5)), f(X(col_x(0) + col_w(0) / 2)), f(Y(23.5)),
              f(X(col_x(0) + col_w(0) / 2)), f(Y(55.5))))
hdr.append('<g id="th-face"><text class="th" x="%s" y="%s" text-anchor="middle"><tspan x="%s" y="%s">盘</tspan><tspan x="%s" y="%s">位</tspan></text></g>'
           % (f(X(col_x(1) + col_w(1) / 2)), f(Y(23.5)), f(X(col_x(1) + col_w(1) / 2)), f(Y(23.5)),
              f(X(col_x(1) + col_w(1) / 2)), f(Y(55.5))))
hdr.append('<g id="th-target"><text class="th" x="%s" y="%s" text-anchor="middle"><tspan x="%s" y="%s">目</tspan><tspan x="%s" y="%s">标</tspan></text></g>'
           % (f(X(col_x(2) + col_w(2) / 2)), f(Y(23.5)), f(X(col_x(2) + col_w(2) / 2)), f(Y(23.5)),
              f(X(col_x(2) + col_w(2) / 2)), f(Y(55.5))))

UNIT_DX = 30.5
UNIT_Y = 54.5


def unit_group(cx, name):
    out = [f'<g id="{name}" aria-label="度 分 秒">']
    for sym, dx in (('°', -UNIT_DX), ('′', 0.0), ('″', UNIT_DX)):
        out.append(f'<text class="unit" x="{f(X(cx + dx))}" y="{f(Y(UNIT_Y))}" text-anchor="middle">{sym}</text>')
    out.append('</g>')
    return out


# 度盘读数
c3 = col_x(3) + col_w(3) / 2
hdr.append(header_text('th-reading', 'th', c3, 26.0, '度盘读数'))
hdr += unit_group(c3, 'units-reading')
# 半测回角值
c4 = col_x(4) + col_w(4) / 2
hdr.append(header_text('th-halfangle', 'th', c4, 26.0, '半测回角值'))
hdr += unit_group(c4, 'units-halfangle')
# 半测回角值之差 (small, 2 lines)
c5 = col_x(5) + col_w(5) / 2
hdr.append('<g id="th-halfdiff"><text class="th-sm" text-anchor="middle"><tspan x="%s" y="%s">半测回角</tspan><tspan x="%s" y="%s">值之差</tspan></text></g>'
           % (f(X(c5)), f(Y(25.0)), f(X(c5)), f(Y(58.5))))
# 一测回角值
c6 = col_x(6) + col_w(6) / 2
hdr.append(header_text('th-angle', 'th', c6, 26.0, '一测回角值'))
hdr += unit_group(c6, 'units-angle')
# 角度草图
c7 = col_x(7) + col_w(7) / 2
hdr.append(header_text('th-sketch', 'th', c7, 43.5, '角度草图'))
# 距离 (m)
c8 = col_x(8) + col_w(8) / 2
hdr.append('<g id="th-distance"><text class="th" text-anchor="middle"><tspan x="%s" y="%s">距离</tspan><tspan class="latin" x="%s" y="%s">(m)</tspan></text></g>'
           % (f(X(c8)), f(Y(26.5)), f(X(c8)), f(Y(58.5))))
# 距离及相对误差
c9 = col_x(9) + col_w(9) / 2
hdr.append('<g id="th-relerr"><text class="th" text-anchor="middle"><tspan x="%s" y="%s">距离及相对</tspan><tspan x="%s" y="%s">误差</tspan></text></g>'
           % (f(X(c9)), f(Y(25.0)), f(X(c9)), f(Y(57.5))))

for i in range(10):
    add_cell(f'th-{COL_KEYS[i]}', 'static', i, 0, 1, 1, col_x(i), 0, col_w(i), HEADER_H,
             COL_LABELS[i], '印刷列头（静态文字），不要覆盖输入框')

# ---- face labels 左 / 右
face_svg = []
for b in range(6):
    for lab, r0 in (('左', 1), ('右', 3)):
        ytop = row_y(4 * b + r0)
        face_svg.append(f'<text class="face" x="{f(X(col_x(1) + col_w(1) / 2))}" y="{f(Y(ytop + 54.5))}" text-anchor="middle">{lab}</text>')
        add_cell(f's{b + 1}-face-{"left" if r0 == 1 else "right"}', 'static', 1, 4 * b + r0, 2, 1,
                 col_x(1), ytop, col_w(1), 2 * ROW_H, f'盘位 {lab}',
                 '印刷盘位字（静态），数据框请让开该字或在同格内避开中心')

# ---- station / data cells
data_cells = []
for b in range(6):
    y0 = row_y(4 * b + 1)
    add_cell(f's{b + 1}-station', 'input', 0, 4 * b + 1, 4, 1, col_x(0), y0, col_w(0), 4 * ROW_H,
             f'第{b + 1}测站 · 测站', '跨 4 行；建议手写测站号居中')
    add_cell(f's{b + 1}-half-left', 'computed', 4, 4 * b + 1, 2, 1, col_x(4), row_y(4 * b + 1), col_w(4), 2 * ROW_H,
             f'第{b + 1}测站 · 左盘半测回角值', '跨 2 行')
    add_cell(f's{b + 1}-half-right', 'computed', 4, 4 * b + 3, 2, 1, col_x(4), row_y(4 * b + 3), col_w(4), 2 * ROW_H,
             f'第{b + 1}测站 · 右盘半测回角值', '跨 2 行')
    add_cell(f's{b + 1}-halfdiff', 'computed', 5, 4 * b + 1, 4, 1, col_x(5), y0, col_w(5), 4 * ROW_H,
             f'第{b + 1}测站 · 半测回角值之差', '跨 4 行')
    add_cell(f's{b + 1}-angle', 'computed', 6, 4 * b + 1, 4, 1, col_x(6), y0, col_w(6), 4 * ROW_H,
             f'第{b + 1}测站 · 一测回角值', '跨 4 行；含 ° ′ ″ 三组数字')
    add_cell(f's{b + 1}-sketch', 'free', 7, 4 * b + 1, 4, 1, col_x(7), y0, col_w(7), 4 * ROW_H,
             f'第{b + 1}测站 · 角度草图', '跨 4 行；留给手绘草图/SVG 线稿')
    add_cell(f's{b + 1}-dist-err', 'free', 9, 4 * b + 1, 4, 1, col_x(9), y0, col_w(9), 4 * ROW_H,
             f'第{b + 1}测站 · 距离及相对误差', '跨 4 行')
    for j in range(1, 5):
        add_cell(f's{b + 1}-r{j}-target', 'input', 2, 4 * b + j, 1, 1, col_x(2), row_y(4 * b + j), col_w(2), ROW_H,
                 f'第{b + 1}测站 行{j} · 目标')
        add_cell(f's{b + 1}-r{j}-reading', 'input', 3, 4 * b + j, 1, 1, col_x(3), row_y(4 * b + j), col_w(3), ROW_H,
                 f'第{b + 1}测站 行{j} · 度盘读数', '° ′ ″ 三段')
        add_cell(f's{b + 1}-r{j}-distance', 'input', 8, 4 * b + j, 1, 1, col_x(8), row_y(4 * b + j), col_w(8), ROW_H,
                 f'第{b + 1}测站 行{j} · 距离(m)')

# ---- invisible hit rectangles for every semantic cell
fields = []
for c in cells:
    if c['role'] == 'static':
        continue
    fields.append(f'<rect id="cell-{c["id"]}" x="{f(c["x"])}" y="{f(c["y"])}" width="{f(c["w"])}" height="{f(c["h"])}" />')
# also invisible rects for static cells so the layout is explicit (not hit targets)
static_fields = []
for c in cells:
    if c['role'] == 'static':
        static_fields.append(f'<rect id="cell-{c["id"]}" x="{f(c["x"])}" y="{f(c["y"])}" width="{f(c["w"])}" height="{f(c["h"])}" />')

# ---------------------------------------------------------------- document
header = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{f(CW)}" height="{f(CH)}" viewBox="0 0 {f(CW)} {f(CH)}" role="img" aria-label="角度距离观测记录手簿（空白表格）">
  <title>角度距离观测记录手簿 — 空白表格（DSH 视觉稿）</title>
  <desc>按纸质表照片透视校正后重建的空白印刷表单。无手写、无示例数据、无位图。数据格全部留空。</desc>
  <defs>
    <style>
      #sheet text {{ font-family: {SERIF}; fill: {INK}; }}
      #sheet .title {{ font-size: 30.3px; font-weight: 700; letter-spacing: 0.1px; }}
      #sheet .meta {{ font-size: 19.2px; }}
      #sheet .th {{ font-size: 19.8px; }}
      #sheet .th-sm {{ font-size: 16px; }}
      #sheet .face {{ font-size: 19.5px; }}
      #sheet .unit {{ font-family: {LATIN}; font-size: 18.5px; }}
      #sheet .latin {{ font-family: {LATIN}; font-size: 19px; }}
      #sheet .note {{ font-size: 19px; }}
      #sheet .line {{ fill: none; stroke: {INK}; stroke-linecap: square; stroke-linejoin: miter; }}
      #sheet .rule {{ fill: none; stroke: {INK}; stroke-width: 1.1; stroke-linecap: butt; }}
      #sheet .cells {{ fill: none; stroke: none; pointer-events: none; }}
    </style>
  </defs>
  <g id="sheet">
'''.replace('{SERIF}', SERIF).replace('{LATIN}', LATIN).replace('{INK}', INK)

body = []
body.append('    <g id="layer-title">')
body += ['      ' + t for t in texts]
body.append('    </g>')
body.append('    <g id="layer-meta" aria-label="表头信息行">')
body += ['      ' + t for t in meta_svg]
body.append('    </g>')
body.append('    <g id="layer-table">')
body.append('      <g id="frame" class="line">')
body += ['        ' + t for t in lines_outer]
body.append('      </g>')
body.append('      <g id="grid-vertical" class="line" stroke-width="1.2">')
body += ['        ' + t for t in lines_inner if '"v' in t]
body.append('      </g>')
body.append('      <g id="grid-horizontal" class="line">')
body.append('        <g id="h-block-lines" stroke-width="1.7">')
body += ['          ' + t for t in lines_block]
body.append('        </g>')
body.append('        <g id="h-row-lines" stroke-width="1.2">')
body += ['          ' + t for t in lines_inner if '"s' in t]
body.append('        </g>')
body.append('      </g>')
body.append('      <g id="table-header" aria-label="主表列头">')
body += ['        ' + t for t in hdr]
body.append('      </g>')
body.append('      <g id="face-labels" aria-label="盘位标签">')
body += ['        ' + t for t in face_svg]
body.append('      </g>')
body.append('    </g>')
body.append('    <g id="layer-note">')
body.append(f'      <text id="note" class="note" x="{f(X(85))}" y="{f(Y(1295))}">使用铅笔记录。可划掉重写，不得使用橡皮。</text>')
body.append('    </g>')
body.append('    <g id="layer-cells" class="cells" aria-hidden="true">')
body += ['      ' + t for t in static_fields]
body += ['      ' + t for t in fields]
body.append('    </g>')
body.append('  </g>')
body.append('</svg>')

doc = header + '\n'.join(body) + '\n'
path = os.path.join(OUT, '角度距离-记录手簿.svg')
with open(path, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write(doc)

# ---------------------------------------------------------------- geometry.json
def pct(v, total):
    return round(v / total * 100, 4)


geo = {
    'name': '角度距离观测记录手簿',
    'version': '1.0',
    'date': '2026-10-25',
    'source': {
        'file': 'reference-photo.jpg',
        'size': [1856, 2476],
        'method': '四点透视校正（表格外框）+ 汉字方块纵横比校正（2400×2544 校正空间），逐线量测后理想化',
    },
    'viewBox': {'x': 0, 'y': 0, 'w': CW, 'h': CH},
    'recommended_display_width': CW,
    'table': {'x': X(0), 'y': Y(0), 'w': TW, 'h': TH},
    'columns': [
        {'index': i, 'key': COL_KEYS[i], 'label': COL_LABELS[i],
         'x': round(X(COLS[i]), 2), 'w': round(col_w(i), 2),
         'px': pct(X(COLS[i]), CW), 'pw': pct(col_w(i), CW)}
        for i in range(10)
    ],
    'rows': [
        {'index': 0, 'type': 'header', 'y': round(Y(0), 2), 'h': round(HEADER_H, 2)}
    ] + [
        {'index': k, 'type': 'data', 'station': (k - 1) // 4 + 1,
         'row_in_station': (k - 1) % 4 + 1,
         'face': '左' if (k - 1) % 4 < 2 else '右',
         'y': round(Y(row_y(k)), 2), 'h': round(ROW_H, 2)}
        for k in range(1, 25)
    ],
    'line_widths': {'outer': 2.2, 'block_and_header': 1.7, 'inner': 1.2, 'meta_rule': 1.1},
    'fonts': {
        'family': SERIF,
        'title': {'size': 30.3, 'weight': 700, 'letter_spacing': 0.1},
        'meta': {'size': 19.2, 'weight': 400, 'letter_spacing': 21.5},
        'header': {'size': 19.8, 'weight': 400},
        'header_small': {'size': 16, 'weight': 400},
        'face': {'size': 19.5, 'weight': 400},
        'unit': {'size': 18.5, 'family': LATIN},
        'note': {'size': 19, 'weight': 400},
    },
    'static_texts': {
        'title': {'text': '角度距离观测记录手簿', 'x': round(X(600), 2), 'baseline': round(Y(-120.5), 2), 'anchor': 'middle'},
        'note': {'text': '使用铅笔记录。可划掉重写，不得使用橡皮。', 'x': round(X(85), 2), 'baseline': round(Y(1295), 2), 'anchor': 'start'},
        'meta_rows': [
            {'baseline': round(Y(-78), 2), 'rule_y': round(Y(-75), 2)},
            {'baseline': round(Y(-43.5), 2), 'rule_y': round(Y(-41), 2)},
        ],
    },
    'cells': [],
}
for c in cells:
    rec = dict(c)
    rec.pop('label', None)
    rec['px'] = pct(rec['x'], CW)
    rec['py'] = pct(rec['y'], CH)
    rec['pw'] = pct(rec['w'], CW)
    rec['ph'] = pct(rec['h'], CH)
    geo['cells'].append(rec)

with open(os.path.join(OUT, '角度距离-geometry.json'), 'w', encoding='utf-8') as fh:
    json.dump(geo, fh, ensure_ascii=False, indent=1)

print('svg bytes', len(doc.encode('utf-8')), 'cells', len(cells))
print('table', X(0), Y(0), TW, TH, 'canvas', CW, CH)
