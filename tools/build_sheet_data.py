#!/usr/bin/env python3
"""Generate web/assets/sheet-data.js from the read-only DSH deliverables.

Source (never modified; snapshot of 视觉稿):
  design-source/全站仪导线观测记录表.svg + geometry.json
  design-source/三四等水准-记录表.svg  + 三四等水准-geometry.json
  design-source/角度距离-记录手簿.svg  + 角度距离-geometry.json
  design-source/三角高程-平差表.svg    + 三角高程-geometry.json（本仓 tools/gen_table_f.py 生成）

The formal page must open from file://, where fetch() is unavailable, so the
three SVGs and the cell geometry are inlined into a classic script at build
time.  Re-run this after DSH updates a sheet:

    python tools/build_sheet_data.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "assets" / "sheet-data.js"
SRC = HERE.parent / "design-source"

KEEP = (
    "id", "role", "x", "y", "w", "h", "px", "py", "pw", "ph",
    "spans", "rowspan", "colspan", "note",
)

# The printed diagonals cut a rectangular split cell into these two halves.
# Points are percentages of the split cell, not of the whole sheet.
HIT_POINTS = {
    "tl": ((0.0, 0.0), (100.0, 0.0), (0.0, 100.0)),
    "br": ((100.0, 0.0), (100.0, 100.0), (0.0, 100.0)),
}
TRIANGLE_EPS = 1e-6

# 表二第 1 站没有独立的「观测者 / 测站编号」单元格：两个字段写在表头格
# （h-observers / h-station-no，含表头共 308.89 高）的下半段。整格热区取
# 第 1 站自己的 4 行，不让表头文字跟着亮。
LEVELING_SNAP_TOL = 2.6
PRINTED_EPS = 0.05

SHEETS = [
    {
        "key": "traverse",
        "name": "全站仪导线观测记录表",
        "svg": "全站仪导线观测记录表.svg",
        "geo": "geometry.json",
        "paper": "landscape",
        "stations": 4,
        "printed": 136,
    },
    {
        "key": "leveling",
        "name": "三、四等水准测量记录、计算表（双面尺法）",
        "svg": "三四等水准-记录表.svg",
        "geo": "三四等水准-geometry.json",
        "paper": "portrait",
        "stations": 8,
        "printed": 236,
    },
    {
        "key": "angle",
        "name": "角度距离观测记录手簿",
        "svg": "角度距离-记录手簿.svg",
        "geo": "角度距离-geometry.json",
        "paper": "portrait",
        "stations": 6,
        "printed": 136,
    },
    # 汇总表：全部数据格由前表推导，没有可手填的正文格子，所以不生成
    # 印刷格热区；可编辑的只有表头 meta（表四）与姓名（表五）。
    {
        "key": "traverseSummary",
        "name": "导线测量原始数据汇总",
        "svg": "导线数据汇总-记录表.svg",
        "geo": "导线数据汇总-geometry.json",
        "paper": "landscape",
        "stations": 17,
        "printed": 0,
        "summary": True,
    },
    {
        "key": "levelingSummary",
        "name": "支水准测量原始数据汇总",
        "svg": "支水准汇总-记录表.svg",
        "geo": "支水准汇总-geometry.json",
        "paper": "landscape",
        "stations": 8,
        "printed": 0,
        "summary": True,
    },
    # 表六：与表四同属「由表一强制映射」的汇总表。17 行对应 17 条边，
    # 表头信息多一个「起点高程」，正文全由表一推导。
    {
        "key": "trigSummary",
        "name": "三角高程测量平差表",
        "svg": "三角高程-平差表.svg",
        "geo": "三角高程-geometry.json",
        "paper": "landscape",
        "stations": 17,
        "printed": 0,
        "summary": True,
    },
    # 表G：导线计算表。11 行正文既有手填也有推导，按普通表生成整格热区；
    # 四个 meta（日期/班组/计算人/复核人）不参与印刷格计数。
    {
        "key": "traverseCalc",
        "name": "导线计算表",
        "svg": "导线计算-记录表.svg",
        "geo": "导线计算-geometry.json",
        "paper": "landscape",
        "stations": 11,
        "printed": 151,
    },
]


def triangle_contains_rect(shape: str, tx0: float, ty0: float, tx1: float, ty1: float,
                           rect: tuple[float, float, float, float]) -> bool:
    """True when every corner of rect is inside the requested half-cell."""
    if tx1 <= tx0 or ty1 <= ty0:
        return False
    x, y, w, h = rect
    if w <= 0 or h <= 0:
        return False
    for px in (x, x + w):
        for py in (y, y + h):
            u = (px - tx0) / (tx1 - tx0)
            v = (py - ty0) / (ty1 - ty0)
            if shape == "tl":
                if u < -TRIANGLE_EPS or v < -TRIANGLE_EPS or u + v > 1 + TRIANGLE_EPS:
                    return False
            elif shape == "br":
                if u > 1 + TRIANGLE_EPS or v > 1 + TRIANGLE_EPS or u + v < 1 - TRIANGLE_EPS:
                    return False
            else:
                raise SystemExit(f"unknown triangle shape: {shape!r}")
    return True


def build_traverse_hits(geo: dict, width: float, height: float, cells: list[dict],
                        stations: int) -> list[dict]:
    """Build the 24 diagonal-half hit targets for table A.

    Each of the four station blocks has six inputs inside three split cells:
    station/instrument height, target①/prism①, and target②/prism②.  The
    input rectangles stay exactly where they are; these hits only add the
    rest of each printed triangle as a pointer target.
    """
    grid = geo.get("grid") or {}
    cols = [float(value) for value in grid.get("cols") or []]
    rows = [float(value) for value in grid.get("rows") or []]
    if len(cols) < 3 or len(rows) < 4 * stations + 2:
        raise SystemExit("geometry.json: grid is too small for the traverse splits")

    by_id = {cell["id"]: cell for cell in cells}
    hits: list[dict] = []
    seen_inputs: set[str] = set()

    def add(input_id: str, tx0: float, ty0: float, tx1: float, ty1: float, shape: str) -> None:
        cell = by_id.get(input_id)
        if not cell:
            raise SystemExit(f"geometry.json: missing split input {input_id!r}")
        if cell.get("role") != "input":
            raise SystemExit(f"geometry.json: {input_id!r} is not an input cell")
        if input_id in seen_inputs:
            raise SystemExit(f"geometry.json: duplicated split input {input_id!r}")
        if tx0 < 0 or ty0 < 0 or tx1 > width or ty1 > height:
            raise SystemExit(f"{input_id}: triangle leaves the sheet")
        rect = (float(cell["x"]), float(cell["y"]), float(cell["w"]), float(cell["h"]))
        if not triangle_contains_rect(shape, tx0, ty0, tx1, ty1, rect):
            raise SystemExit(
                f"{input_id}: input rectangle {rect} is not fully inside the "
                f"{shape} triangle ({tx0}, {ty0}) - ({tx1}, {ty1})"
            )
        seen_inputs.add(input_id)

        x = round(tx0, 2)
        y = round(ty0, 2)
        w = round(tx1 - tx0, 2)
        h = round(ty1 - ty0, 2)
        hits.append({
            "id": "hit-" + input_id,
            "input": input_id,
            "kind": "triangle",
            "shape": shape,
            "x": x,
            "y": y,
            "w": w,
            "h": h,
            "px": round(x / width * 100, 4),
            "py": round(y / height * 100, 4),
            "pw": round(w / width * 100, 4),
            "ph": round(h / height * 100, 4),
            "points": [list(point) for point in HIT_POINTS[shape]],
        })

    x0, x1, x2 = cols[0], cols[1], cols[2]
    for block in range(stations):
        r = 1 + 4 * block
        y0, y2, y4 = rows[r], rows[r + 2], rows[r + 4]
        sid = "s" + str(block + 1)
        add(sid + "-station", x0, y0, x1, y4, "tl")
        add(sid + "-instrument-height", x0, y0, x1, y4, "br")
        add(sid + "-r1-target", x1, y0, x2, y2, "tl")
        add(sid + "-r1-prism", x1, y0, x2, y2, "br")
        add(sid + "-r3-target", x1, y2, x2, y4, "tl")
        add(sid + "-r3-prism", x1, y2, x2, y4, "br")

    expected = stations * 6
    if len(hits) != expected:
        raise SystemExit(f"traverse hits: built {len(hits)}, expected {expected}")
    return hits


def snap_to_line(value: float, lines: list[float], tol: float = LEVELING_SNAP_TOL) -> float:
    """把单元格边线吸附到最近的网格线；超出容差就保留原值。"""
    best = min(lines, key=lambda line: abs(line - value))
    return best if abs(best - value) <= tol else value


def rect_outer(rect: tuple[float, float, float, float],
               inner: tuple[float, float, float, float], eps: float = PRINTED_EPS) -> bool:
    x, y, w, h = rect
    ix, iy, iw, ih = inner
    return (ix >= x - eps and iy >= y - eps and
            ix + iw <= x + w + eps and iy + ih <= y + h + eps)


def rects_overlap(a: tuple[float, float, float, float],
                  b: tuple[float, float, float, float],
                  eps: float = PRINTED_EPS) -> bool:
    """真实重叠：两个方向都要超过舍入容差（0.01 的接缝不算重叠）。"""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    dx = min(ax + aw, bx + bw) - max(ax, bx)
    dy = min(ay + ah, by + bh) - max(ay, by)
    return dx > eps and dy > eps


def build_printed_rects(spec: dict, geo: dict, cells: list[dict],
                        width: float, height: float) -> list[dict]:
    """推导每张表的印刷数据格矩形（不含 meta）。

    表一：列线来自 grid.cols，行线来自 spans（r1-r4 等）加测站块偏移；
    表二：单元格自带的 x/y/w/h 向内收过 1~2 单位，向最近网格线吸附；
    表三：geometry 的单元格矩形就是印刷格本身。
    """
    key = spec["key"]
    grid = geo.get("grid") or {}
    cols = [float(value) for value in grid.get("cols") or []]
    rows = [float(value) for value in grid.get("rows") or []]
    rects: dict[tuple[float, float, float, float], list[str]] = {}

    def add(x: float, y: float, w: float, h: float, cell_id: str) -> None:
        rect = (round(x, 2), round(y, 2), round(w, 2), round(h, 2))
        if rect[2] <= 0 or rect[3] <= 0:
            raise SystemExit(f"{cell_id}: printed rect has no area {rect}")
        if rect[0] < -PRINTED_EPS or rect[1] < -PRINTED_EPS or \
                rect[0] + rect[2] > width + PRINTED_EPS or \
                rect[1] + rect[3] > height + PRINTED_EPS:
            raise SystemExit(f"{cell_id}: printed rect leaves the sheet {rect}")
        rects.setdefault(rect, []).append(cell_id)

    if key == "traverse":
        if len(cols) < 3 or len(rows) < 4 * spec["stations"] + 2:
            raise SystemExit("geometry.json: grid is too small for table A")
        for cell in cells:
            if cell.get("role") == "meta":
                continue
            col = cell.get("col")
            match = re.match(r"^r(\d+)(?:-r(\d+))?$", str(cell.get("spans") or ""))
            block = re.match(r"^s(\d+)-", str(cell.get("id") or ""))
            if not col or not match or not block:
                raise SystemExit(f"{cell.get('id')}: cannot derive the printed cell "
                                 f"(col={col!r}, spans={cell.get('spans')!r})")
            first = int(match.group(1))
            last = int(match.group(2) or first)
            offset = 4 * (int(block.group(1)) - 1)
            x0, x1 = cols[col - 1], cols[col]
            y0, y1 = rows[first + offset], rows[last + 1 + offset]
            add(x0, y0, x1 - x0, y1 - y0, cell["id"])
    elif key == "leveling":
        if not cols or not rows:
            raise SystemExit("geometry.json: grid is missing for table B")
        for cell in cells:
            if cell.get("role") == "meta":
                continue
            x = float(cell["x"])
            y = float(cell["y"])
            x0 = snap_to_line(x, cols)
            x1 = snap_to_line(x + float(cell["w"]), cols)
            y0 = snap_to_line(y, rows)
            y1 = snap_to_line(y + float(cell["h"]), rows)
            add(x0, y0, x1 - x0, y1 - y0, cell["id"])
        # 第 1 站的两个字段落在表头合并格的下半段：显式补两个站内矩形。
        station_top, station_bottom = rows[4], rows[8]
        for index in range(2):
            add(cols[index], station_top, cols[index + 1] - cols[index],
                station_bottom - station_top, "s1-band-" + str(index + 1))
    else:
        for cell in cells:
            if cell.get("role") == "meta":
                continue
            add(float(cell["x"]), float(cell["y"]), float(cell["w"]),
                float(cell["h"]), cell["id"])

    # 每个非 meta 单元格都必须完整落在某个印刷格内。
    for cell in cells:
        if cell.get("role") == "meta":
            continue
        box = (float(cell["x"]), float(cell["y"]), float(cell["w"]), float(cell["h"]))
        if not any(rect_outer(rect, box) for rect in rects):
            raise SystemExit(f"{cell['id']}: no printed rect contains the cell {box}")

    # 印刷格之间只允许「相等」或「包含」，不允许部分重叠。
    keys = list(rects)
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            if not rects_overlap(a, b):
                continue
            if not (rect_outer(a, b) or rect_outer(b, a)):
                raise SystemExit(f"printed rects overlap partially: {a} / {b}")

    expected = spec["printed"]
    if len(rects) != expected:
        raise SystemExit(f"{key}: derived {len(rects)} printed rects, expected {expected}")

    ordered = sorted(rects, key=lambda rect: (rect[1], rect[0], rect[2], rect[3]))
    return [
        {"x": rect[0], "y": rect[1], "w": rect[2], "h": rect[3], "cells": rects[rect]}
        for rect in ordered
    ]


def build_sheet(spec: dict) -> dict:
    svg_path = SRC / spec["svg"]
    geo_path = SRC / spec["geo"]
    svg = svg_path.read_text(encoding="utf-8")
    geo = json.loads(geo_path.read_text(encoding="utf-8"))

    if 'id="sheet"' not in svg:
        raise SystemExit(f"{svg_path.name}: missing id=\"sheet\"; refuse to build")

    vb = geo["viewBox"]
    width, height = float(vb["w"]), float(vb["h"])

    cells = []
    for cell in geo["cells"]:
        item = {k: cell[k] for k in KEEP if k in cell and cell[k] not in ("", None)}
        # DSH's table-A generator computed meta y as METAY0 = MY - 42 and
        # then ran it through cell(), which adds MY a second time.  Data
        # cells are unaffected.  The design-source snapshot stays read-only; correct the
        # overlay coordinate here (the true meta row is above the frame).
        if spec["key"] == "traverse" and item.get("role") == "meta" and item.get("y", 0) >= 123:
            item["y"] = round(item["y"] - 123.0, 2)
        cells.append(item)

    # Keep the percentage mirrors consistent with the corrected coordinates.
    for item in cells:
        if all(k in item for k in ("x", "y", "w", "h")):
            item["px"] = round(item["x"] / width * 100, 4)
            item["py"] = round(item["y"] / height * 100, 4)
            item["pw"] = round(item["w"] / width * 100, 4)
            item["ph"] = round(item["h"] / height * 100, 4)

    ids = [c["id"] for c in cells]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{geo_path.name}: duplicate cell ids")

    hits = []
    if spec["key"] == "traverse":
        hits = build_traverse_hits(geo, width, height, cells, spec["stations"])
    # 汇总表没有正文手填格，不需要整格热区。
    if spec.get("summary"):
        printed = []
    else:
        # 用 geometry 的原始单元格（保留 col）：KEEP 里没有 col。
        printed = build_printed_rects(spec, geo, geo["cells"], width, height)

    return {
        "key": spec["key"],
        "name": spec["name"],
        "paper": spec["paper"],
        "stations": spec["stations"],
        "viewBox": f"0 0 {vb['w']} {vb['h']}",
        "width": width,
        "height": height,
        "displayWidth": float(geo.get("recommended_display_width") or width),
        "hits": hits,
        "printed": printed,
        "svg": svg,
        "cells": cells,
    }


def main() -> None:
    sheets = [build_sheet(spec) for spec in SHEETS]
    payload = {"version": 1, "generatedFrom": "design-source/", "sheets": {s["key"]: s for s in sheets}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "/* Generated by tools/build_sheet_data.py - do not edit by hand. */\n"
        "window.SHEET_DATA = " + body + ";\n",
        encoding="utf-8",
    )
    for s in sheets:
        print(f"{s['key']:<9} cells={len(s['cells']):>3}  hits={len(s['hits']):>2}  "
              f"printed={len(s['printed']):>3}  viewBox={s['viewBox']}  "
              f"{len(s['svg'])} chars svg")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
