"use strict";

const assert = require("assert");
require("../web/assets/calc-traverse.js");
require("../web/assets/calc-leveling.js");
const S = require("../web/assets/calc-summary.js");

// 表六测试用的最小测站：竖直角一律 0°，于是
//   平距 = 斜距；高差 = 仪器高 − 棱镜高（可以精确摆出想要的高差）
function dms(d, m, s) {
  return { d: String(d), m: String(m), s: String(s) };
}

function face(h, v, s) {
  return { h: dms(h, 0, 0), v: dms(v, 0, 0), s: String(s) };
}

function target(id, az, dist, prism) {
  return {
    id,
    name: id,
    prismHeight: String(prism),
    readings: { L: face(az, 0, dist), R: face(az + 180, 0, dist) }
  };
}

// back* 指目标①（后视，下一站用它作返测）；fwd* 指目标②（本站往测）。
function station(name, az, backDist, backPrism, fwdDist, fwdPrism, instr) {
  return {
    name,
    instrumentHeight: String(instr == null ? 1.5 : instr),
    targets: [target("A", az, backDist, backPrism), target("B", az + 90, fwdDist, fwdPrism)]
  };
}

function page(stations) {
  return { meta: {}, stations };
}

// 四站闭合环。高差（=1.500 − 棱镜高）逐行摆好：
//   第 1 条 +0.100 / +0.080   第 2 条 −0.050 / −0.070
//   第 3 条 +0.120 / +0.100   第 4 条 −0.030 / −0.020
// 四条边的往返高差平均值都是 +0.010 / +0.010 / +0.010 / −0.005，
// 闭合差 +0.025 m = +25 mm。
function loopPage(dist) {
  const d = dist || {};
  const pick = (key, fallback) => (d[key] == null ? fallback : d[key]);
  return page([
    station("A", 0, pick("r4b", 300), 1.52, pick("r1f", 500), 1.4),
    station("B", 90, pick("r1b", 500), 1.42, pick("r2f", 400), 1.55),
    station("C", 180, pick("r2b", 399.6), 1.57, pick("r3f", 600), 1.38),
    station("D", 270, pick("r3b", 599.4), 1.4, pick("r4f", 300), 1.53)
  ]);
}

function run(options, pages) {
  return S.trigRows(pages || [loopPage()], {}, options || {});
}

function close(actual, expected, eps, label) {
  assert.ok(Math.abs(actual - expected) < (eps == null ? 1e-9 : eps),
    (label || "") + " expected " + expected + ", got " + actual);
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (err) {
    console.error("FAIL  " + name);
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

console.log("calc-summary.js 表六（三角高程）tests");

test("TRIG_ROWS follows the 17-row sheet", () => {
  assert.strictEqual(S.TRIG_ROWS, 17);
  assert.strictEqual(S.TRIG_ROWS, S.TRAVERSE_ROWS);
});

test("empty project yields 17 blank rows and no verdict", () => {
  const res = S.trigRows([], {}, {});
  assert.strictEqual(res.rows.length, 17);
  assert.strictEqual(res.count, 0);
  assert.strictEqual(res.filled, 0);
  assert.strictEqual(res.rows[0].source, null);
  assert.strictEqual(res.rows[0].distMean.value, null);
  assert.strictEqual(res.totalDist.value, null);
  assert.strictEqual(res.closure, null);
  assert.strictEqual(res.adjustable, false);
  assert.strictEqual(res.evalText, "");
});

test("rows map each side forward→return with endpoint names", () => {
  const res = run();
  assert.strictEqual(res.count, 4);
  assert.deepStrictEqual(res.rows.slice(0, 4).map((row) => row.id.value), ["B", "C", "D", "A"]);
  assert.strictEqual(res.rows[4].source, null);
  close(res.rows[0].distFwd.value, 500, 1e-9, "row1 fwd dist");
  close(res.rows[0].distBack.value, 500, 1e-9, "row1 back dist");
  close(res.rows[0].dhFwd.value, 0.1, 1e-9, "row1 fwd dh");
  close(res.rows[0].dhBack.value, 0.08, 1e-9, "row1 back dh");
});

test("mean distance / relative error / mean height difference", () => {
  const res = run();
  close(res.rows[0].distMean.value, 500, 1e-9, "row1 mean");
  close(res.rows[1].distMean.value, 399.8, 1e-9, "row2 mean");
  close(res.rows[2].distMean.value, 599.7, 1e-9, "row3 mean");
  close(res.rows[0].distRel.value, 0, 1e-12, "row1 rel");
  close(res.rows[1].distRel.value, 0.4 / 399.8, 1e-12, "row2 rel");
  close(res.rows[2].distRel.value, 0.6 / 599.7, 1e-12, "row3 rel");
  close(res.rows[0].dhMean.value, 0.01, 1e-12, "row1 dh mean");
  close(res.rows[3].dhMean.value, -0.005, 1e-12, "row4 dh mean");
});

test("discrepancy in mm and its 60√D allowance (strict abs compare)", () => {
  const res = run();
  assert.strictEqual(res.rows[0].dhDiff.value, 180);
  assert.strictEqual(res.rows[1].dhDiff.value, -120);
  assert.strictEqual(res.rows[2].dhDiff.value, 220);
  assert.strictEqual(res.rows[3].dhDiff.value, -50);
  assert.strictEqual(res.rows[0].dhAllow.value, 42);
  assert.strictEqual(res.rows[1].dhAllow.value, 38);
  assert.strictEqual(res.rows[2].dhAllow.value, 46);
  assert.strictEqual(res.rows[3].dhAllow.value, 33);
  // −120 的绝对值超过 38，负号不能被比较吃掉。
  assert.strictEqual(res.sideOver, 4);
});

test("0.4×S allowance option measures the mean distance in metres", () => {
  const res = run({ sideFormula: "linear" });
  assert.strictEqual(res.sideFormula, "linear");
  assert.deepStrictEqual(res.rows.slice(0, 4).map((row) => row.dhAllow.value), [200, 160, 240, 120]);
  // 0.4×S 比 60√D 松：同一组往返较差不超限。
  assert.strictEqual(res.sideOver, 0);
  // 系数仍可在抽屉里改：0.04×S 就收紧到原来的 1/10。
  const tight = run({ sideFormula: "linear", sideLinear: "0.04" });
  assert.strictEqual(tight.rows[0].dhAllow.value, 20);
  assert.strictEqual(tight.sideOver, 4);
  // 未知公式/非法系数回落到默认的 60√D / 0.4。
  const fallback = run({ sideFormula: "bogus", sideLinear: "0" });
  assert.strictEqual(fallback.sideFormula, "sqrt");
  assert.strictEqual(fallback.sideLinear, 0.4);
  assert.strictEqual(fallback.rows[0].dhAllow.value, 42);
});

test("40√D preset keeps the old coefficient available", () => {
  // 40√D 是此前用过的口径：同一组平距 500/400/600/300 m，
  // 允许值 round(40·√D) mm = 28/25/31/22，比 60√D 紧。
  const res = run({ sideFormula: "sqrt", sideLimit: "40" });
  assert.strictEqual(res.sideFormula, "sqrt");
  assert.strictEqual(res.sideK, 40);
  assert.deepStrictEqual(res.rows.slice(0, 4).map((row) => row.dhAllow.value), [28, 25, 31, 22]);
});

test("allowance rounds half away at .5 mm (K=50 and default K=60)", () => {
  // 50×√0.0841 在 JS 里是 14.499999999999998，公式值是 14.5 → 15。
  const k50 = run({ sideFormula: "sqrt", sideLimit: "50" },
    [loopPage({ r1f: 84.1, r1b: 84.1 })]);
  assert.strictEqual(k50.rows[0].dhAllow.value, 15);
  // 默认 60√D 在 855.625 m 这种三位小数平距上也是 .5 边界 → 56，不能是 55。
  const k60 = run({ sideFormula: "sqrt", sideLimit: "60" },
    [loopPage({ r1f: 855.625, r1b: 855.625 })]);
  assert.strictEqual(k60.rows[0].dhAllow.value, 56);
});

test("totals: ΣD in m, closure in m, −closure in mm", () => {
  const res = run();
  close(res.totalDist.value, 1799.5, 1e-9, "ΣD");
  close(res.totalDh.value, 0.025, 1e-12, "closure");
  assert.strictEqual(res.closureMm, 25);
  assert.strictEqual(res.closureAllow, 54);
  assert.strictEqual(res.closureOver, false);
  assert.strictEqual(res.completeLoop, true);
});

test("correction is proportional to distance and sums to −f_h", () => {
  const res = run();
  assert.deepStrictEqual(res.rows.slice(0, 4).map((row) => row.corr.value), [-7, -6, -8, -4]);
  assert.strictEqual(res.totalCorr.value, -25);
  close(res.totalAdj.value, 0, 1e-12, "Σ adjusted");
});

test("adjusted height differences close the loop", () => {
  const res = run();
  close(res.rows[0].dhAdj.value, 0.003, 1e-12, "row1 adj");
  close(res.rows[1].dhAdj.value, 0.004, 1e-12, "row2 adj");
  close(res.rows[2].dhAdj.value, 0.002, 1e-12, "row3 adj");
  close(res.rows[3].dhAdj.value, -0.009, 1e-12, "row4 adj");
});

test("elevations run from the start height and close on it", () => {
  const res = run({ startElev: "100.000" });
  assert.strictEqual(res.elevationsReady, true);
  close(res.rows[0].elev.value, 100.003, 1e-9, "row1 elev");
  close(res.rows[1].elev.value, 100.007, 1e-9, "row2 elev");
  close(res.rows[2].elev.value, 100.009, 1e-9, "row3 elev");
  close(res.rows[3].elev.value, 100, 1e-9, "row4 closes");
  close(res.finalElev, 100, 1e-9, "final elev");
  assert.ok(/闭合差合格/.test(res.evalText));
  assert.ok(/闭合于 100\.000 m/.test(res.evalText));
});

test("without a start elevation the corrections still show", () => {
  const res = run({});
  assert.strictEqual(res.elevationsReady, false);
  assert.strictEqual(res.rows[0].corr.value, -7);
  assert.strictEqual(res.rows[0].elev.value, null);
  assert.ok(/起点高程未填/.test(res.evalText));
});

test("closure exactly at the allowance passes; one mm more fails", () => {
  const dist100 = { r1f: 100, r1b: 100, r2f: 100, r2b: 100, r3f: 100, r3b: 100, r4f: 100, r4b: 100 };
  const at = run({ startElev: "50" }, [loopPage(dist100)]);
  close(at.totalDist.value, 400, 1e-9, "ΣD 400");
  assert.strictEqual(at.closureAllow, 25);
  assert.strictEqual(at.closureMm, 25);
  assert.strictEqual(at.closureOver, false);
  // 100 m 四等分，-6、-6、-6 余 -1 给最长边（同长取第一行）。
  assert.deepStrictEqual(at.rows.slice(0, 4).map((row) => row.corr.value), [-7, -6, -6, -6]);
  assert.strictEqual(at.totalCorr.value, -25);
  close(at.totalAdj.value, 0, 1e-12, "Σ adjusted");

  // 改第 1 条往测的棱镜高，把闭合差推到 27 mm（高差平均值 +0.012）。
  const bumped = loopPage(dist100);
  bumped.stations[0].targets[1].prismHeight = "1.396";
  const res = S.trigRows([bumped], {}, { startElev: "50" });
  assert.strictEqual(res.closureMm, 27);
  assert.strictEqual(res.closureAllow, 25);
  assert.strictEqual(res.closureOver, true);
  assert.ok(/闭合差超限/.test(res.evalText));
});

test("fewer than three sides is not a closed loop", () => {
  const two = page([
    station("A", 0, 200, 1.5, 200, 1.4),
    station("B", 90, 200, 1.4, 200, 1.5)
  ]);
  const res = S.trigRows([two], {}, { startElev: "10" });
  assert.strictEqual(res.count, 2);
  assert.strictEqual(res.completeLoop, false);
  assert.strictEqual(res.adjustable, false);
  assert.strictEqual(res.rows[0].corr.value, null);
  assert.ok(/至少需要 3 条边/.test(res.evalText));
});

function manyStations(n) {
  const stations = [];
  for (let i = 1; i <= n; i += 1) {
    stations.push(station("P" + i, (i * 20) % 360, 200, 1.5, 200, 1.5));
  }
  return page(stations);
}

test("more than a sheet's capacity reports how many sides are hidden", () => {
  const res = S.trigRows([manyStations(18)], {}, { startElev: "10", pageCount: 1 });
  assert.strictEqual(res.count, 18);
  assert.strictEqual(res.edgeCount, 18);
  assert.strictEqual(res.capacity, 17);
  assert.strictEqual(res.overflow, 1);
  assert.strictEqual(res.adjustable, false);
  assert.ok(/本表 1 页共可显示 17 条边，还有 1 条未显示/.test(res.evalText));
  assert.ok(/补「新页」/.test(res.evalText));
});

test("a second sheet carries the remaining sides and completes the loop", () => {
  const res = S.trigRows([manyStations(18)], {}, { startElev: "10", pageCount: 2 });
  assert.strictEqual(res.edgeCount, 18);
  assert.strictEqual(res.capacity, 34);
  assert.strictEqual(res.overflow, 0);
  assert.strictEqual(res.rows.length, 18);
  assert.strictEqual(res.closureMm, 0);
  assert.strictEqual(res.adjustable, true);
  assert.strictEqual(res.elevationsReady, true);
  assert.ok(!/未显示/.test(res.evalText));
  close(res.rows[17].elev.value, 10, 1e-9, "row18 closes on start");
});

test("two sheets hold up to 34 sides", () => {
  const at = S.trigRows([manyStations(34)], {}, { startElev: "10", pageCount: 2 });
  assert.strictEqual(at.edgeCount, 34);
  assert.strictEqual(at.overflow, 0);
  assert.strictEqual(at.rows.length, 34);
  const over = S.trigRows([manyStations(35)], {}, { startElev: "10", pageCount: 2 });
  assert.strictEqual(over.edgeCount, 35);
  assert.strictEqual(over.overflow, 1);
  assert.ok(/本表 2 页共可显示 34 条边，还有 1 条未显示/.test(over.evalText));
});

test("non-closed route drops the return edge and skips closure adjustment", () => {
  const res = S.trigRows([loopPage()], {}, { closed: false, startElev: "100" });
  assert.strictEqual(res.closed, false);
  assert.strictEqual(res.count, 4);
  assert.strictEqual(res.edgeCount, 3);
  assert.strictEqual(res.rows[0].id.value, "B");
  assert.strictEqual(res.rows[2].id.value, "D");
  assert.strictEqual(res.rows[3].source, null);
  assert.strictEqual(res.completeLoop, false);
  assert.strictEqual(res.closureOver, false);
  assert.strictEqual(res.adjustable, false);
  [0, 1, 2].forEach((i) => {
    assert.strictEqual(res.rows[i].corr.value, 0, "corr row " + (i + 1));
    close(res.rows[i].dhAdj.value, 0.01, 1e-12, "adj row " + (i + 1));
  });
  close(res.totalDh.value, 0.03, 1e-12, "Σ dh");
  close(res.finalElev, 100.03, 1e-9, "final elev");
  assert.ok(/非闭合路线/.test(res.evalText));
  assert.ok(/不分配闭合差/.test(res.evalText));
  assert.ok(/终于 100\.030 m/.test(res.evalText));
});

test("non-closed route lowers the sheet capacity by one side", () => {
  const res = S.trigRows([manyStations(19)], {}, { closed: false, pageCount: 1 });
  assert.strictEqual(res.count, 19);
  assert.strictEqual(res.edgeCount, 18);
  assert.strictEqual(res.overflow, 1);
  assert.ok(/还有 1 条未显示/.test(res.evalText));
  assert.ok(/再推高程/.test(res.evalText));
});

test("a non-closed route with one station has no side to carry", () => {
  const res = S.trigRows([page([station("A", 0, 200, 1.5, 200, 1.4)])], {},
    { closed: false, startElev: "10" });
  assert.strictEqual(res.edgeCount, 0);
  assert.strictEqual(res.routeReady, false);
  assert.ok(/至少需要 2 个测站/.test(res.evalText));
});

test("a one-face reading leaves the side incomplete and blocks adjustment", () => {
  const p = loopPage();
  p.stations[1].targets[1].readings.R = { h: dms("", "", ""), v: dms("", "", ""), s: "" };
  const res = S.trigRows([p], {}, { startElev: "100" });
  assert.ok(res.incomplete >= 1);
  assert.strictEqual(res.completeLoop, false);
  assert.strictEqual(res.rows[1].distFwd.value, 400);
  assert.strictEqual(res.rows[1].distFwd.state, "partial");
  assert.strictEqual(res.rows[1].distMean.state, "partial");
  assert.ok(/往返观测未算全/.test(res.evalText));
});

test("course limits can be overridden from the drawer", () => {
  const strict = run({ closureLimit: "10" });
  assert.strictEqual(strict.closureAllow, 13);
  assert.strictEqual(strict.closureOver, true);
  const loose = run({ sideLimit: "120" });
  assert.strictEqual(loose.rows[0].dhAllow.value, 85);
});

test("single station has no return leg and stays blank", () => {
  const res = S.trigRows([page([station("A", 0, 200, 1.5, 200, 1.4)])], {}, {});
  assert.strictEqual(res.count, 1);
  assert.strictEqual(res.rows[0].distFwd.value, 200);
  assert.strictEqual(res.rows[0].distBack.value, null);
  assert.strictEqual(res.rows[0].id.value, null);
  assert.ok(/至少需要 3 条边/.test(res.evalText));
});

if (process.exitCode) {
  console.error("表六 tests failed");
} else {
  console.log("表六: " + passed + " passed");
}
