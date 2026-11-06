"use strict";

const assert = require("assert");
require("../web/assets/calc-traverse.js");
require("../web/assets/calc-leveling.js");
const S = require("../web/assets/calc-summary.js");

function dms(d, m, s) {
  return { d: String(d), m: String(m), s: String(s) };
}

function reading(h, v, s) {
  return { h: h || dms("", "", ""), v: v || dms("", "", ""), s: s == null ? "" : String(s) };
}

function target(id, azimuth, distance, vertical) {
  const v = vertical == null ? 0 : vertical;
  return {
    id,
    name: id,
    prismHeight: "1.200",
    readings: {
      L: reading(dms("0", "0", "0"), dms(v, "0", "0"), distance),
      R: reading(dms("180", "0", "0"), dms(v, "0", "0"), distance)
    }
  };
}

// 方位角按给定值写在盘左，盘右加 180°；水平角 = 目标② − 目标①。
function traverseStation(name, azimuth1, azimuth2, distance1, distance2, vertical) {
  const t1 = target("A", azimuth1, distance1, vertical);
  const t2 = target("B", azimuth2, distance2, vertical);
  function offset(row, deg) {
    row.h = dms(deg, "0", "0");
  }
  offset(t1.readings.L, azimuth1);
  offset(t1.readings.R, azimuth1 + 180);
  offset(t2.readings.L, azimuth2);
  offset(t2.readings.R, azimuth2 + 180);
  return { name, instrumentHeight: "1.500", targets: [t1, t2] };
}

function staff(lower, upper, black, red) {
  return { lower: String(lower), upper: String(upper), black: String(black), red: String(red) };
}

function levelingStation(meanMm) {
  // 后黑 − 前黑 = 100 + 2n 时，高差中数 = (黑差 + 200 − 100) / 2 = 100 + n mm。
  const n = meanMm - 100;
  return {
    stationNo: "1",
    observer: "甲",
    back: staff(1575, 1475, 1500 + 2 * n, 6287),
    front: staff(1475, 1375, 1400, 6087),
    dirs: ["后", "前", "后−前"],
    wide: "",
    kBack: "4787",
    kFront: "4687"
  };
}

function levelingPage(meanMm) {
  return { meta: {}, stations: [levelingStation(meanMm)] };
}

function close(actual, expected, eps, label) {
  assert.ok(Math.abs(actual - expected) < (eps == null ? 1e-9 : eps),
    (label || "") + " expected " + expected + ", got " + actual);
}

function sampleStdev(values) {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, v) => a + (v - avg) * (v - avg), 0);
  return Math.sqrt(sq / (values.length - 1));
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

console.log("calc-summary.js tests");

test("packed DMS writes 1°02′03″ as 1.0203", () => {
  assert.strictEqual(S.packedDms(1 + 2 / 60 + 3 / 3600), 1.0203);
  assert.strictEqual(S.packedDms(0), 0);
  assert.strictEqual(S.packedDms(360 + 1 + 2 / 60 + 3 / 3600), 1.0203);
});

test("packed DMS rounds centiseconds and carries at 59.50″", () => {
  assert.strictEqual(S.packedDms(1 + 2 / 60 + 3.5 / 3600), 1.0204);
  assert.strictEqual(S.packedDms(1 + 2 / 60 + 59.5 / 3600), 1.03);
  assert.strictEqual(S.packedDms(1 + 59 / 60 + 59.5 / 3600), 2);
});

test("sumPackedDms adds base-60, not decimal", () => {
  assert.strictEqual(S.sumPackedDms([1.0203, 2.0304]), 3.0507);
  assert.strictEqual(S.sumPackedDms([0.5959, 0.0001]), 1);
  assert.strictEqual(S.sumPackedDms([]), null);
  assert.strictEqual(S.sumPackedDms([null, undefined]), null);
});

test("packedParts splits degrees / minutes / seconds", () => {
  assert.deepStrictEqual(S.packedParts(3.0507), { d: 3, m: 5, s: 7 });
  assert.deepStrictEqual(S.packedParts(1.0203), { d: 1, m: 2, s: 3 });
});

test("normalizeLegPages keeps 1..20 and defaults invalid input", () => {
  assert.strictEqual(S.normalizeLegPages(1), 1);
  assert.strictEqual(S.normalizeLegPages("3"), 3);
  assert.strictEqual(S.normalizeLegPages(0), 1);
  assert.strictEqual(S.normalizeLegPages(21), 20);
  assert.strictEqual(S.normalizeLegPages("abc"), 1);
  assert.strictEqual(S.normalizeLegPages(null), 1);
});

test("traverse summary maps each row forward/next station", () => {
  const pages = [{
    stations: [
      traverseStation("A1", 0, 30, 100, 50, 0),
      traverseStation("A2", 0, 60, 40, 60, 0)
    ]
  }];
  const out = S.traverseRows(pages, { mode: "VA" });
  assert.strictEqual(out.count, 2);
  assert.strictEqual(out.filled, 2);
  assert.strictEqual(out.overflow, 0);
  assert.strictEqual(out.rows[0].id.value, "A1");
  close(out.rows[0].distFwd.value, 50);
  close(out.rows[0].distBack.value, 40);
  close(out.rows[0].distMean.value, 45);
  close(out.rows[0].distErr.value, 10000);
  assert.strictEqual(out.rows[0].angle.value, 330);
  close(out.rows[1].distFwd.value, 60);
  close(out.rows[1].distBack.value, 100);
  assert.strictEqual(out.rows[1].angle.value, 300);
  assert.strictEqual(out.totalAngle.value, 630);
  close(out.totalDist.value, 125);
});

test("traverse summary totals add the displayed row values", () => {
  // 10 行的平距平均值落在 .0005 边界：列内显示 50.001，7 行显示 50.000。
  // 合计必须等于列内显示值之和 850.010，不能先加未取整值再 round3（850.005）。
  const stations = [];
  for (let i = 0; i < 17; i += 1) {
    const st = traverseStation("P" + i, 0, 90, 50, i < 10 ? 50.001 : 50, 0);
    // 高差平均值同样制造 10 个 −0.0005 边界行；其余行是 0。
    st.targets[0].prismHeight = "1.200";
    st.targets[1].prismHeight = i < 10 ? "1.201" : "1.200";
    stations.push(st);
  }
  const out = S.traverseRows([{ stations }], { mode: "VA" });
  const distColumn = out.rows.slice(0, 17)
    .map((row) => S.round3(row.distMean.value));
  close(distColumn.reduce((a, b) => a + b, 0), 850.01, 1e-9, "displayed dist sum");
  close(out.totalDist.value, 850.01, 1e-9, "totalDist");
  const dhColumn = out.rows.slice(0, 17)
    .map((row) => S.round3(row.dhMean.value));
  close(dhColumn.reduce((a, b) => a + b, 0), -0.01, 1e-9, "displayed dh sum");
  close(out.totalDh.value, -0.01, 1e-9, "totalDh");
});

test("roundInteger uses half-away and ignores binary noise", () => {
  assert.strictEqual(S.roundInteger(14.5), 15);
  assert.strictEqual(S.roundInteger(14.499999999999998), 15);
  assert.strictEqual(S.roundInteger(14.4999), 14);
  assert.strictEqual(S.roundInteger(-14.5), -15);
  assert.strictEqual(S.roundInteger(-14.499999999999998), -15);
  assert.strictEqual(S.roundInteger(0), 0);
  assert.strictEqual(S.roundInteger(null), null);
});

test("traverse summary returns 17 rows and leaves unused rows empty", () => {
  const pages = [{ stations: [traverseStation("A1", 0, 30, 100, 50, 0)] }];
  const out = S.traverseRows(pages, { mode: "VA" });
  assert.strictEqual(out.rows.length, S.TRAVERSE_ROWS);
  assert.strictEqual(out.rows[0].id.value, "A1");
  for (let i = 1; i < S.TRAVERSE_ROWS; i += 1) {
    assert.strictEqual(out.rows[i].id.state, "empty");
    assert.strictEqual(out.rows[i].distFwd.value, null);
  }
  // 只有一站时没有「下一站」，返测留空；平均值也不能编造。
  assert.strictEqual(out.rows[0].distBack.value, null);
  assert.strictEqual(out.rows[0].distMean.value, null);
  assert.strictEqual(out.rows[0].distErr.value, null);
  assert.strictEqual(out.totalDist.value, null);
});

test("traverse summary wraps the last station back to the first", () => {
  const pages = [{
    stations: [
      traverseStation("A1", 0, 30, 100, 50, 0),
      traverseStation("A2", 0, 60, 40, 60, 0),
      traverseStation("A3", 0, 90, 70, 80, 0)
    ]
  }];
  const out = S.traverseRows(pages, { mode: "VA" });
  close(out.rows[2].distFwd.value, 80);
  close(out.rows[2].distBack.value, 100);
});

test("traverse summary keeps the true next station when over 17 stations", () => {
  const stations = [];
  for (let i = 0; i < 18; i += 1) {
    stations.push(traverseStation("S" + (i + 1), 0, 30, 100 + i, 50 + i, 0));
  }
  const out = S.traverseRows([{ stations }], { mode: "VA" });
  assert.strictEqual(out.count, 18);
  assert.strictEqual(out.overflow, 1);
  assert.strictEqual(out.filled, 17);
  // 第 17 行的返测应取第 18 站目标①（150 + 17 = 167），而不是绕回第 1 站（100）。
  close(out.rows[16].distFwd.value, 50 + 16);
  close(out.rows[16].distBack.value, 100 + 17);
});

test("traverse summary can extend past 17 rows for Table G", () => {
  const stations = [];
  for (let i = 0; i < 22; i += 1) {
    stations.push(traverseStation("S" + (i + 1), 0, 30, 100 + i, 50 + i, 0));
  }
  const out = S.traverseRows([{ stations }], { mode: "VA" }, { rows: 22 });
  assert.strictEqual(out.rows.length, 22);
  assert.strictEqual(out.overflow, 0);
  assert.strictEqual(out.filled, 22);
  assert.strictEqual(out.rows[21].id.value, "S22");
  // 22 站正好铺满：最后一站的返测绕回第 1 站目标①。
  close(out.rows[21].distFwd.value, 50 + 21);
  close(out.rows[21].distBack.value, 100);
  // 默认与非法行数仍按表四的 17 行。
  assert.strictEqual(S.traverseRows([{ stations }], { mode: "VA" }).rows.length, 17);
  assert.strictEqual(S.traverseRows([{ stations }], { mode: "VA" }, { rows: 0 }).rows.length, 17);
});

test("traverse summary collects started stations across pages in order", () => {
  const pages = [
    { stations: [traverseStation("P1-1", 0, 30, 100, 50, 0), { name: "", instrumentHeight: "", targets: [{ name: "", prismHeight: "", readings: { L: reading(), R: reading() } }, { name: "", prismHeight: "", readings: { L: reading(), R: reading() } }] }] },
    { stations: [traverseStation("P2-1", 0, 60, 40, 60, 0)] }
  ];
  const out = S.traverseRows(pages, { mode: "VA" });
  assert.strictEqual(out.count, 2);
  assert.deepStrictEqual(out.stations.map((s) => s.name), ["P1-1", "P2-1"]);
  assert.strictEqual(out.rows[1].id.value, "P2-1");
});

test("traverse summary signs follow the sheet: distance(+) / height(−)", () => {
  const pages = [{
    stations: [
      traverseStation("A1", 0, 30, 100, 50, 1),
      traverseStation("A2", 0, 60, 40, 60, 2)
    ]
  }];
  const out = S.traverseRows(pages, { mode: "VA" });
  const row = out.rows[0];
  close(row.dhFwd.value, 50 * Math.sin(Math.PI / 180) + 0.3, 1e-3);
  close(row.dhBack.value, 40 * Math.sin(2 * Math.PI / 180) + 0.3, 1e-3);
  close(row.dhMis.value, Math.round((row.dhFwd.value + row.dhBack.value) * 1000));
  close(row.dhMean.value, (row.dhFwd.value - row.dhBack.value) / 2, 1e-9);
  assert.notStrictEqual(row.dhMis.value, row.distErr.value);
});

test("leveling summary splits four legs per person", () => {
  const pages = [];
  for (let i = 0; i < 32; i += 1) pages.push(levelingPage(100 + i));
  const out = S.levelingRows(pages, { grade: "IV" }, { legPages: 1, names: [] });
  assert.strictEqual(out.legPages, 1);
  assert.strictEqual(out.perPerson, 4);
  assert.strictEqual(out.pagesNeeded, 32);
  assert.strictEqual(out.pagesAvailable, 32);
  assert.strictEqual(out.missingPages, 0);
  assert.strictEqual(out.ignoredPages, 0);
  close(out.rows[0].s1.fwd.value, 0.100);
  close(out.rows[0].s1.back.value, 0.101);
  close(out.rows[0].s1.mis.value, 201);
  close(out.rows[0].s1.mean.value, -0.0005);
  close(out.rows[0].s2.fwd.value, 0.102);
  close(out.rows[0].s2.back.value, 0.103);
  close(out.rows[0].s2.mis.value, 205);
  close(out.rows[1].s1.fwd.value, 0.104);
});

test("leveling summary honours legPages > 1", () => {
  const pages = [];
  for (let i = 0; i < 64; i += 1) pages.push(levelingPage(100 + i));
  const out = S.levelingRows(pages, { grade: "IV" }, { legPages: 2, names: [] });
  assert.strictEqual(out.legPages, 2);
  assert.strictEqual(out.perPerson, 8);
  assert.strictEqual(out.pagesNeeded, 64);
  close(out.rows[0].s1.fwd.value, 0.201);
  close(out.rows[0].s1.back.value, 0.205);
  close(out.rows[0].s2.fwd.value, 0.209);
  close(out.rows[0].s2.back.value, 0.213);
});

test("leveling summary reports missing and ignored pages", () => {
  const pages = [];
  for (let i = 0; i < 10; i += 1) pages.push(levelingPage(100 + i));
  const out = S.levelingRows(pages, { grade: "IV" }, { legPages: 1, names: [] });
  assert.strictEqual(out.pagesNeeded, 32);
  assert.strictEqual(out.missingPages, 22);
  assert.strictEqual(out.ignoredPages, 0);

  const many = [];
  for (let i = 0; i < 40; i += 1) many.push(levelingPage(100 + i));
  const extra = S.levelingRows(many, { grade: "IV" }, { legPages: 1, names: [] });
  assert.strictEqual(extra.ignoredPages, 8);
});

test("leveling summary page 2 maps people 9-16 to the next table-2 block", () => {
  const pages = [];
  for (let i = 0; i < 64; i += 1) pages.push(levelingPage(100 + i));
  const names = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"];
  const out = S.levelingRows(pages, { grade: "IV" }, {
    legPages: 1, names, pageIndex: 1, pageCount: 2
  });
  assert.strictEqual(out.pageIndex, 1);
  assert.strictEqual(out.personStart, 9);
  assert.strictEqual(out.personEnd, 16);
  assert.strictEqual(out.sourceStartPage, 33);
  assert.strictEqual(out.sourceEndPage, 64);
  assert.strictEqual(out.rows[0].personIndex, 9);
  assert.strictEqual(out.rows[0].name, "甲");
  close(out.rows[0].s1.fwd.value, 0.132);
  close(out.rows[0].s1.back.value, 0.133);
  close(out.rows[0].s2.fwd.value, 0.134);
  close(out.rows[0].s2.back.value, 0.135);
  close(out.rows[7].s2.back.value, 0.163);
  assert.strictEqual(out.missingPages, 0);
  assert.strictEqual(out.ignoredPages, 0);
  assert.strictEqual(out.footer.n1, 8);
  assert.strictEqual(out.footer.n2, 8);
});

test("leveling summary judges missing and ignored against all pages", () => {
  const pages = [];
  for (let i = 0; i < 40; i += 1) pages.push(levelingPage(100 + i));
  const second = S.levelingRows(pages, { grade: "IV" }, {
    legPages: 1, names: [], pageIndex: 1, pageCount: 2
  });
  assert.strictEqual(second.sourceStartPage, 33);
  assert.strictEqual(second.capacityPages, 64);
  assert.strictEqual(second.rangeAvailable, 8);
  assert.strictEqual(second.missingPages, 24);
  assert.strictEqual(second.ignoredPages, 0);

  const firstOfTwo = S.levelingRows(pages, { grade: "IV" }, {
    legPages: 1, names: [], pageIndex: 0, pageCount: 2
  });
  assert.strictEqual(firstOfTwo.missingPages, 0);
  assert.strictEqual(firstOfTwo.ignoredPages, 0);

  const onlyOne = S.levelingRows(pages, { grade: "IV" }, {
    legPages: 1, names: [], pageIndex: 0, pageCount: 1
  });
  assert.strictEqual(onlyOne.capacityPages, 32);
  assert.strictEqual(onlyOne.ignoredPages, 8);
});

test("leveling summary footer averages and sample stdev use section means", () => {
  const pages = [];
  for (let i = 0; i < 32; i += 1) pages.push(levelingPage(100 + i));
  const out = S.levelingRows(pages, { grade: "IV" }, { legPages: 1, names: [] });
  const means1 = out.rows.map((row) => row.s1.mean.value);
  const means2 = out.rows.map((row) => row.s2.mean.value);
  close(out.footer.avg1.value, means1.reduce((a, b) => a + b, 0) / means1.length);
  close(out.footer.avg2.value, means2.reduce((a, b) => a + b, 0) / means2.length);
  close(out.footer.err1.value, sampleStdev(means1) * 1000);
  close(out.footer.err2.value, sampleStdev(means2) * 1000);
  assert.strictEqual(out.footer.n1, 8);
  assert.strictEqual(out.footer.n2, 8);
});

test("leveling summary leaves footer error empty with fewer than two people", () => {
  const pages = [levelingPage(100), levelingPage(101)];
  const out = S.levelingRows(pages, { grade: "IV" }, { legPages: 1, names: [] });
  assert.strictEqual(out.footer.n1, 1);
  assert.strictEqual(out.footer.err1.value, null);
  assert.strictEqual(out.footer.n2, 0);
  assert.strictEqual(out.footer.err2.value, null);
  close(out.footer.avg1.value, (0.100 - 0.101) / 2);
});

test("leveling summary flags unfinished stations as partial", () => {
  const page = { meta: {}, stations: [inputWithMissingReading()] };
  const out = S.levelingRows([page], { grade: "IV" }, { legPages: 1, names: [] });
  assert.strictEqual(out.rows[0].s1.fwd.state, "partial");
  assert.ok(/未算完/.test(out.rows[0].s1.fwd.note));
});

test("leveling summary does not invent values without leveling pages", () => {
  const out = S.levelingRows([], { grade: "IV" }, { legPages: 1, names: [] });
  assert.strictEqual(out.rows.length, S.LEVELING_ROWS);
  assert.strictEqual(out.footer.avg1.value, null);
  assert.strictEqual(out.footer.err1.value, null);
  assert.strictEqual(out.missingPages, 32);
  assert.strictEqual(out.rows[0].s1.mean.value, null);
});

function inputWithMissingReading() {
  return {
    stationNo: "1",
    observer: "甲",
    back: staff(1575, 1475, 1500, 6287),
    front: staff(1475, 1375, "", 6087),
    dirs: ["后", "前", "后−前"],
    wide: "",
    kBack: "4787",
    kFront: "4687"
  };
}

function ownerPage(meanMm, person, leg) {
  return {
    meta: {},
    owner: { person, leg },
    stations: [levelingStation(meanMm)]
  };
}

test("normalizeOwner accepts people 1-800 and legs 0-3", () => {
  assert.deepStrictEqual(S.normalizeOwner({ person: "2", leg: 3 }), { person: 2, leg: 3 });
  assert.strictEqual(S.normalizeOwner({ person: 0, leg: 0 }), null);
  assert.strictEqual(S.normalizeOwner({ person: 801, leg: 0 }), null);
  assert.strictEqual(S.normalizeOwner({ person: 1, leg: 4 }), null);
  assert.strictEqual(S.normalizeOwner({ person: 1, leg: -1 }), null);
  assert.strictEqual(S.normalizeOwner(null), null);
  assert.strictEqual(S.normalizeOwner("第 1 人"), null);
  assert.strictEqual(S.ownerLabel({ person: 3, leg: 2 }), "第 3 人 · BM0–1号点 往测");
});

test("leveling summary owner tags sum non-contiguous pages per person and leg", () => {
  const pages = [
    ownerPage(100, 1, 0),
    ownerPage(101, 1, 0), // 同一人同一段允许两页
    ownerPage(102, 1, 1),
    ownerPage(103, 1, 2),
    ownerPage(104, 1, 3),
    levelingPage(999), // 无归属页不参与汇总
    ownerPage(105, 2, 0)
  ];
  const out = S.levelingRows(pages, { grade: "IV" }, { names: [] });
  assert.strictEqual(out.mode, "owners");
  close(out.rows[0].s1.fwd.value, 0.201);
  close(out.rows[0].s1.back.value, 0.102);
  close(out.rows[0].s2.fwd.value, 0.103);
  close(out.rows[0].s2.back.value, 0.104);
  close(out.rows[1].s1.fwd.value, 0.105);
  assert.deepStrictEqual(out.rows[0].source.legs[0].pages, [1, 2]);
  assert.deepStrictEqual(out.rows[0].source.pages, [1, 2, 3, 4, 5]);
  assert.strictEqual(out.assignedPages, 6);
  assert.strictEqual(out.unassignedPages, 1);
  // 第 1 人四段齐；第 2 人只打了 1 段；第 3–8 人全空 = 3 + 24。
  assert.strictEqual(out.emptyLegs, 27);
});

test("leveling summary owner mode reads pages in sheet order, not tag order", () => {
  const pages = [
    ownerPage(102, 1, 2),
    ownerPage(100, 1, 0),
    ownerPage(103, 1, 3),
    ownerPage(101, 1, 1)
  ];
  const out = S.levelingRows(pages, { grade: "IV" }, { names: [] });
  assert.strictEqual(out.mode, "owners");
  close(out.rows[0].s1.fwd.value, 0.100);
  close(out.rows[0].s1.back.value, 0.101);
  close(out.rows[0].s2.fwd.value, 0.102);
  close(out.rows[0].s2.back.value, 0.103);
});

test("leveling summary warns about untagged and out-of-range owner pages", () => {
  const pages = [
    ownerPage(100, 1, 0),
    { meta: {}, owner: { person: 900, leg: 0 }, stations: [levelingStation(101)] },
    { meta: {}, owner: { person: 0, leg: 0 }, stations: [levelingStation(102)] },
    levelingPage(103)
  ];
  const out = S.levelingRows(pages, { grade: "IV" }, { names: [] });
  assert.strictEqual(out.mode, "owners");
  assert.strictEqual(out.assignedPages, 1);
  assert.strictEqual(out.outOfRangePages, 2);
  assert.strictEqual(out.outOfRangeMaxPerson, 900);
  assert.strictEqual(out.unassignedPages, 1);
  close(out.rows[0].s1.fwd.value, 0.100);
});

test("leveling summary reports people beyond the 800 cap", () => {
  const out = S.levelingRows([ownerPage(100, 1, 0)], { grade: "IV" }, {
    names: [], pageIndex: 100, pageCount: 101
  });
  assert.strictEqual(out.mode, "owners");
  assert.strictEqual(out.personStart, 801);
  assert.strictEqual(out.outOfRangePeople, 8);
  assert.strictEqual(out.footer.n1, 0);
  assert.strictEqual(out.rows[0].s1.fwd.value, null);
});

test("leveling summary can force block mode even when pages carry owners", () => {
  const pages = [
    ownerPage(102, 1, 2),
    ownerPage(100, 1, 0),
    ownerPage(103, 1, 3),
    ownerPage(101, 1, 1)
  ];
  const out = S.levelingRows(pages, { grade: "IV" }, { names: [], mode: "blocks", legPages: 1 });
  assert.strictEqual(out.mode, "blocks");
  close(out.rows[0].s1.fwd.value, 0.102);
  close(out.rows[0].s1.back.value, 0.100);
  close(out.rows[0].s2.fwd.value, 0.103);
  close(out.rows[0].s2.back.value, 0.101);
});

test("leveling summary stays in block mode when no page carries an owner", () => {
  const out = S.levelingRows([levelingPage(100)], { grade: "IV" }, { names: [], legPages: 1 });
  assert.strictEqual(out.mode, "blocks");
  assert.strictEqual(out.sourceStartPage, 1);
});

test("round3 在 .00005 边界按十进制半值远离零", function () {
  assert.strictEqual(S.round3(98.7705), 98.771);
  assert.strictEqual(S.round3(107.8355), 107.836);
  assert.strictEqual(S.round3(76.6105), 76.611);
  assert.strictEqual(S.round3(85.5185), 85.519);
  assert.strictEqual(S.round3(1.2345), 1.235);
  assert.strictEqual(S.round3(0.0005), 0.001);
  assert.strictEqual(S.round3(-98.7705), -98.771);
  assert.strictEqual(S.round3(-0.0005), -0.001);
  assert.strictEqual(S.round3(1.2344), 1.234);
  assert.strictEqual(S.round3(1.2346), 1.235);
  assert.strictEqual(S.roundTo(70.58335, 4), 70.5834);
  assert.strictEqual(S.roundTo(-70.58335, 4), -70.5834);
});

console.log("calc-summary.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
