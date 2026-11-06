"use strict";

/*
 * 印刷格热区（Phase 3）的静态校验。
 *
 * sheet-data.js 里的 printed 是构建期从 design-source 的三张 SVG / geometry
 * 推导出来的印刷数据格；本测试不碰 DOM，只核对几何关系：
 *   - 每张表的印刷格数量固定；
 *   - 每个非 meta 单元格都完整落在某个印刷格里；
 *   - 印刷格之间只允许嵌套（或完全相等），不允许部分重叠；
 *   - 表一的斜线格热区与对应印刷格一致，测站块 4 行、目标块 2 行；
 *   - 表二第 1 站有站内 override（观测者 / 站号）。
 */

const assert = require("assert");

global.window = global;
require("../web/assets/sheet-data.js");
const DATA = global.SHEET_DATA;
assert.ok(DATA && DATA.sheets, "sheet-data.js should expose window.SHEET_DATA");

const EPS = 0.05;
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log("ok " + passed + " - " + name);
}

function containsRect(outer, inner, eps) {
  const e = eps == null ? EPS : eps;
  return inner.x >= outer.x - e && inner.y >= outer.y - e &&
    inner.x + inner.w <= outer.x + outer.w + e &&
    inner.y + inner.h <= outer.y + outer.h + e;
}

function overlaps(a, b) {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return dx > EPS && dy > EPS;
}

function rectOf(cell) {
  return { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
}

const EXPECTED = {
  traverse: { printed: 136, triangles: 24 },
  leveling: { printed: 236, triangles: 0 },
  angle: { printed: 136, triangles: 0 },
  traverseCalc: { printed: 151, triangles: 0 }
};

Object.keys(EXPECTED).forEach(function (key) {
  const sheet = DATA.sheets[key];
  const want = EXPECTED[key];

  test(key + " 印刷格数量 " + want.printed, function () {
    assert.ok(Array.isArray(sheet.printed), key + " should expose printed rects");
    assert.strictEqual(sheet.printed.length, want.printed);
  });

  test(key + " 印刷格都在纸面内", function () {
    sheet.printed.forEach(function (rect) {
      assert.ok(rect.w > 0 && rect.h > 0, "printed rect must have area");
      assert.ok(rect.x >= -EPS && rect.y >= -EPS, "printed rect starts outside the sheet");
      assert.ok(rect.x + rect.w <= sheet.width + EPS, "printed rect leaves the right edge");
      assert.ok(rect.y + rect.h <= sheet.height + EPS, "printed rect leaves the bottom edge");
    });
  });

  test(key + " 每个非 meta 单元格都落在印刷格里", function () {
    sheet.cells.filter(function (cell) { return cell.role !== "meta"; })
      .forEach(function (cell) {
        const box = rectOf(cell);
        const hit = sheet.printed.some(function (rect) { return containsRect(rect, box); });
        assert.ok(hit, cell.id + " is not contained by any printed rect");
      });
  });

  test(key + " 印刷格只嵌套、不部分重叠", function () {
    for (let i = 0; i < sheet.printed.length; i += 1) {
      for (let j = i + 1; j < sheet.printed.length; j += 1) {
        const a = sheet.printed[i];
        const b = sheet.printed[j];
        if (!overlaps(a, b)) continue;
        assert.ok(containsRect(a, b) || containsRect(b, a),
          "printed rects partially overlap: " + JSON.stringify(a) + " / " + JSON.stringify(b));
      }
    }
  });

  test(key + " 印刷格记录的单元格都真的在里面", function () {
    sheet.printed.forEach(function (rect) {
      assert.ok(rect.cells && rect.cells.length, "printed rect should name its cells");
      rect.cells.filter(function (id) { return id.indexOf("s1-band-") !== 0; })
        .forEach(function (id) {
          const cell = sheet.cells.find(function (item) { return item.id === id; });
          assert.ok(cell, "unknown cell id in printed rect: " + id);
          assert.ok(containsRect(rect, rectOf(cell)), id + " is not inside its own printed rect");
        });
    });
  });

  test(key + " meta 不生成印刷格", function () {
    sheet.cells.filter(function (cell) { return cell.role === "meta"; })
      .forEach(function (cell) {
        const box = rectOf(cell);
        const covered = sheet.printed.some(function (rect) { return containsRect(rect, box); });
        assert.ok(!covered, "meta cell " + cell.id + " got a printed rect");
      });
  });
});

test("表一斜线格热区与印刷格一一对应", function () {
  const sheet = DATA.sheets.traverse;
  assert.strictEqual(sheet.hits.length, EXPECTED.traverse.triangles);
  sheet.hits.forEach(function (hit) {
    assert.strictEqual(hit.kind, "triangle");
    const match = sheet.printed.filter(function (rect) {
      return rect.x === hit.x && rect.y === hit.y && rect.w === hit.w && rect.h === hit.h;
    });
    assert.strictEqual(match.length, 1, hit.input + " should match exactly one printed rect");
  });
  const keys = {};
  sheet.hits.forEach(function (hit) {
    keys[[hit.x, hit.y, hit.w, hit.h].join(",")] = true;
  });
  assert.strictEqual(Object.keys(keys).length, 12, "24 triangle hits should cover 12 split cells");
});

test("表一测站块 4 行、目标/棱镜块 2 行", function () {
  const sheet = DATA.sheets.traverse;
  for (let n = 1; n <= 4; n += 1) {
    const station = sheet.printed.find(function (rect) {
      return rect.cells.indexOf("s" + n + "-station") >= 0;
    });
    assert.ok(station, "missing station rect for s" + n);
    assert.strictEqual(station.h, 216, "s" + n + " station block should be 4 rows");
    ["r1", "r3"].forEach(function (row) {
      const target = sheet.printed.find(function (rect) {
        return rect.cells.indexOf("s" + n + "-" + row + "-target") >= 0;
      });
      assert.ok(target, "missing target rect for s" + n + " " + row);
      assert.strictEqual(target.h, 108, "s" + n + " " + row + " should be 2 rows");
    });
  }
});

test("表二第 1 站观测者 / 站号有站内 override", function () {
  const sheet = DATA.sheets.leveling;
  const bands = sheet.printed.filter(function (rect) {
    return rect.cells.some(function (id) { return id.indexOf("s1-band-") === 0; });
  });
  assert.strictEqual(bands.length, 2);
  const observer = bands.find(function (rect) { return rect.x === 16; });
  const station = bands.find(function (rect) { return rect.x === 100; });
  assert.ok(observer && observer.w === 84 && observer.h === 154.45, "observer band");
  assert.ok(station && station.w === 85 && station.h === 154.45, "station band");
  assert.strictEqual(observer.y, 294.44);
  assert.strictEqual(station.y, 294.44);
});

test("表二整列备注是包含 8 个站内备注格的大格", function () {
  const sheet = DATA.sheets.leveling;
  const merged = sheet.printed.find(function (rect) {
    return rect.cells.indexOf("remark") >= 0;
  });
  assert.ok(merged, "merged remark rect");
  for (let n = 1; n <= 8; n += 1) {
    const cell = sheet.cells.find(function (item) { return item.id === "s" + n + "-remark"; });
    assert.ok(cell, "s" + n + "-remark cell");
    assert.ok(containsRect(merged, rectOf(cell)), "s" + n + "-remark should nest in remark");
  }
});

console.log("\n" + passed + " assertions passed (sheet-data printed rects).");
