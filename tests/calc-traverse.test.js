"use strict";

const assert = require("assert");
const C = require("../web/assets/calc-traverse.js");

function dms(d, m, s) {
  return { d: String(d), m: String(m), s: String(s) };
}

function reading(h, v, s) {
  return { h: h || dms("", "", ""), v: v || dms("", "", ""), s: s == null ? "" : String(s) };
}

function target(id, L, R) {
  return {
    id,
    name: id,
    prismHeight: "1.200",
    readings: {
      L: reading(L.h, L.v, L.s),
      R: reading(R.h, R.v, R.s)
    }
  };
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

console.log("calc-traverse.js tests");

test("normalize", () => {
  assert.strictEqual(C.normalize360(-10), 350);
  assert.strictEqual(C.normalize360(370), 10);
  assert.ok(Math.abs(C.normalize180(359.9) - (-0.1)) < 1e-9);
  assert.strictEqual(C.normalize180(-190), 170);
});

test("number parsing", () => {
  assert.strictEqual(C.readNumber("1,200").value, 1.2);
  assert.strictEqual(C.readNumber("1.5").value, 1.5);
  assert.strictEqual(C.readNumber("").state, "empty");
  assert.strictEqual(C.readNumber("-1").state, "invalid");
  assert.strictEqual(C.readNumber("abc").state, "invalid");
  assert.strictEqual(C.readNumber("0", { min: 0, exclusiveMin: true }).state, "invalid");
  assert.strictEqual(C.readNumber("0", { min: 0 }).state, "ok");
});

test("DMS parsing", () => {
  assert.strictEqual(C.readDms(dms("181", "55", "16"), "horizontal").value, 181 + 55 / 60 + 16 / 3600);
  assert.strictEqual(C.readDms(dms("0", "60", "0"), "horizontal").state, "invalid");
  assert.strictEqual(C.readDms(dms("-3", "33", "5"), "va").value, -(3 + 33 / 60 + 5 / 3600));
  assert.strictEqual(C.readDms(dms("-3", "33", "5"), "za").state, "invalid");
  assert.strictEqual(C.readDms(dms("", "", ""), "horizontal").state, "empty");
  assert.strictEqual(C.readDms(dms("1", "", ""), "horizontal").state, "partial");
  assert.strictEqual(C.readDms(dms("361", "0", "0"), "horizontal").state, "invalid");
  assert.strictEqual(C.readDms(dms("90", "0", "0"), "va").state, "ok");
});

test("format DMS / seconds", () => {
  assert.strictEqual(C.formatDms(68.785, {}), "68°47′06″");
  assert.strictEqual(C.formatDms(248 + 49 / 60 + 30 / 3600, {}), "248°49′30″");
  assert.strictEqual(C.formatDms(-(3 + 33 / 60 + 8.5 / 3600), { normalize: false, showPlus: true }), "-3°33′08.5″");
  assert.strictEqual(C.formatDms(0, {}), "0°00′00″");
  assert.strictEqual(C.formatSeconds(-12, { showPlus: true }), "-12″");
  assert.strictEqual(C.formatSeconds(6, { showPlus: true }), "+6″");
  assert.strictEqual(C.formatSeconds(0, { showPlus: true }), "0″");
  assert.strictEqual(C.formatSeconds(-3.5, { showPlus: true }), "-3.5″");
});

test("2C, index error, vertical angle (search example)", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "1", "0"), v: dms("86", "25", "18"), s: "100.000" },
        { h: dms("180", "1", "12"), v: dms("273", "34", "30"), s: "100.000" }
      ),
      target("B",
        { h: dms("0", "0", "0"), v: dms("86", "25", "18"), s: "100.000" },
        { h: dms("180", "0", "0"), v: dms("273", "34", "30"), s: "100.000" }
      )
    ]
  };
  const res = C.computeStation(station, "ZA");
  assert.ok(Math.abs(res.targets[0].c2.value + 12) < 1e-7, "2C should be -12″");
  assert.ok(Math.abs(res.targets[0].indexError.value + 6) < 1e-7, "x should be -6″");
  assert.ok(Math.abs(res.targets[0].alphaMean.value - (3 + 34 / 60 + 36 / 3600)) < 1e-9);
});

test("ZA 盘位组合不合法时拒绝计算", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("200", "0", "0"), s: "100.000" },
        { h: dms("180", "0", "0"), v: dms("160", "0", "0"), s: "100.000" }
      )
    ]
  };
  const res = C.computeStation(station, "ZA");
  const t = res.targets[0];
  assert.strictEqual(t.v.L.state, "invalid");
  assert.strictEqual(t.v.R.state, "invalid");
  assert.strictEqual(t.horizDist.value, null);
  assert.strictEqual(t.heightDiff.value, null);
  assert.ok(t.issues.some((item) => item.code === "v.L" && item.level === "invalid"));
  assert.ok(t.issues.some((item) => item.code === "v.R" && item.level === "invalid"));
});

test("vertical angle pair without normalization (VA demo style)", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "20", "5"), v: dms("-3", "33", "5"), s: "98.969" },
        { h: dms("181", "55", "16"), v: dms("-3", "33", "12"), s: "98.970" }
      ),
      target("B",
        { h: dms("359", "56", "41"), v: dms("2", "49", "31"), s: "107.971" },
        { h: dms("181", "52", "36"), v: dms("2", "49", "48"), s: "107.971" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  assert.ok(Math.abs(res.targets[0].indexError.value + 3.5) < 1e-7);
  assert.ok(Math.abs(res.targets[0].alphaMean.value + (3 + 33 / 60 + 8.5 / 3600)) < 1e-9);
  assert.strictEqual(C.formatDms(res.targets[0].alphaMean.value, { normalize: false, showPlus: true }), "-3°33′08.5″");
});

test("horizontal angle from two directions", () => {
  const station = {
    targets: [
      target("A",
        { h: dms("180", "2", "24"), v: dms("0", "0", "0"), s: "100.000" },
        { h: dms("0", "2", "30"), v: dms("0", "0", "0"), s: "100.000" }
      ),
      target("B",
        { h: dms("248", "49", "30"), v: dms("0", "0", "0"), s: "100.000" },
        { h: dms("68", "49", "36"), v: dms("0", "0", "0"), s: "100.000" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  const expected = 68 + 47 / 60 + 6 / 3600;
  assert.ok(Math.abs(res.angleL.value - expected) < 1e-9);
  assert.ok(Math.abs(res.angleR.value - expected) < 1e-9);
  assert.ok(Math.abs(res.angleMean.value - expected) < 1e-9);
  assert.ok(res.halfDiff < 1e-7);
});

test("horizontal angle mean across 0°/360°", () => {
  const station = {
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" }
      ),
      target("B",
        { h: dms("350", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("10", "0", "0"), v: dms("0", "0", "0"), s: "10.000" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  assert.ok(Math.abs(res.angleL.value - 350) < 1e-9);
  assert.ok(Math.abs(res.angleR.value - 10) < 1e-9);
  assert.ok(Math.abs(C.normalize180(res.angleMean.value)) < 1e-9, "mean should be 0°");
});

test("horizontal distance and height difference", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("30", "0", "0"), s: "100.000" },
        { h: dms("180", "0", "0"), v: dms("30", "0", "0"), s: "100.000" }
      ),
      target("B",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "" },
        { h: dms("180", "0", "0"), v: dms("0", "0", "0"), s: "" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  assert.ok(Math.abs(res.targets[0].horizDist.value - 100 * Math.cos(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(res.targets[0].heightDiff.value - (50 + 1.5 - 1.2)) < 1e-9);
});

test("provisional result with one face only", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("30", "0", "0"), s: "100.000" },
        { h: dms("", "", ""), v: dms("", "", ""), s: "" }
      ),
      target("B",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "100.000" },
        { h: dms("", "", ""), v: dms("", "", ""), s: "" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  assert.strictEqual(res.targets[0].alphaMean.state, "partial");
  assert.strictEqual(res.targets[0].horizDist.state, "partial");
  assert.strictEqual(res.targets[0].heightDiff.state, "partial");
  assert.strictEqual(res.angleL.state, "ok");
  assert.strictEqual(res.angleR.state, "waiting");
  assert.strictEqual(res.angleMean.state, "partial");
});

test("missing fields are reported only after a target is started", () => {
  const station = {
    instrumentHeight: "",
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("", "", ""), s: "" },
        { h: dms("", "", ""), v: dms("", "", ""), s: "" }
      ),
      target("B",
        { h: dms("", "", ""), v: dms("", "", ""), s: "" },
        { h: dms("", "", ""), v: dms("", "", ""), s: "" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  const codes = res.issues.map((issue) => issue.code);
  assert.ok(codes.includes("v.L"));
  assert.ok(codes.includes("s.L"));
  assert.ok(codes.includes("i"));
  assert.ok(codes.includes("tBempty"));
});

test("half-angle discrepancy over 20″ raises a warning", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "0"), v: dms("0", "0", "0"), s: "10.000" }
      ),
      target("B",
        { h: dms("68", "47", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("248", "47", "30"), v: dms("0", "0", "0"), s: "10.000" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  assert.ok(Math.abs(res.halfDiff - 30) < 1e-7);
  assert.ok(res.issues.some((issue) => issue.code === "halfdiff" && issue.level === "warning"));

  const okStation = JSON.parse(JSON.stringify(station));
  okStation.targets[1].readings.R.h = dms("248", "47", "0");
  const okRes = C.computeStation(okStation, "VA");
  assert.ok(Math.abs(okRes.halfDiff) < 1e-7);
  assert.ok(okRes.issues.some((issue) => issue.code === "halfdiff-ok"));

  const lenient = C.computeStation(station, "VA", { halfDiffLimit: 40 });
  assert.ok(!lenient.issues.some((issue) => issue.code === "halfdiff" && issue.level === "warning"));
  assert.strictEqual(lenient.halfDiffLimit, 40);
});

test("configurable 2C reference limit", () => {
  const station = {
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "0"), v: dms("0", "0", "0"), s: "10.000" }
      ),
      target("B",
        { h: dms("68", "47", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("248", "47", "0"), v: dms("0", "0", "0"), s: "10.000" }
      )
    ]
  };
  station.targets[0].readings.R.h = dms("180", "0", "30");
  const strict = C.computeStation(station, "VA", { c2Limit: 10 });
  assert.ok(strict.issues.some((issue) => issue.code === "c2" && issue.level === "warning"));
  const lenient = C.computeStation(station, "VA", { c2Limit: 60 });
  assert.ok(!lenient.issues.some((issue) => issue.code === "c2" && issue.level === "warning"));
});

test("course default limits: 2C 12″ and index error 25″", () => {
  const strict = C.computeStation({
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "13"), v: dms("0", "0", "52"), s: "10.000" }
      )
    ]
  }, "VA");
  const warnings = strict.issues.filter((issue) => issue.level === "warning").map((issue) => issue.code);
  assert.ok(warnings.includes("c2"));
  assert.ok(warnings.includes("x"));

  const ok = C.computeStation({
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "11"), v: dms("0", "0", "48"), s: "10.000" }
      )
    ]
  }, "VA");
  assert.ok(!ok.issues.some((issue) =>
    issue.level === "warning" && (issue.code === "c2" || issue.code === "x")));
});

test("2C / index error equal to the limit do not warn", () => {
  // 超限 = 严格大于限差。2C 恰好 20″ / 上限 20″，指标差恰好 25″ / 上限 25″。
  // 2C 的浮点结果本身是 20.000000000015916，没有余量时会被误判为超限。
  const atLimit = C.computeStation({
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "20"), v: dms("0", "0", "50"), s: "10.000" }
      )
    ]
  }, "VA", { c2Limit: 20, indexLimit: 25 });
  assert.ok(Math.abs(atLimit.targets[0].c2.value) > 20, "浮点值略大于 20，正好压测余量");
  assert.ok(Math.abs(atLimit.targets[0].indexError.value - 25) < 1e-9);
  assert.ok(!atLimit.issues.some((issue) =>
    issue.level === "warning" && (issue.code === "c2" || issue.code === "x")));

  const over = C.computeStation({
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "21"), v: dms("0", "0", "52"), s: "10.000" }
      )
    ]
  }, "VA", { c2Limit: 20, indexLimit: 25 });
  const warnings = over.issues.filter((issue) => issue.level === "warning").map((issue) => issue.code);
  assert.ok(warnings.includes("c2"));
  assert.ok(warnings.includes("x"));
});

test("half-angle discrepancy equal to 20″ does not warn", () => {
  const station = {
    instrumentHeight: "1.500",
    targets: [
      target("A",
        { h: dms("0", "0", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("180", "0", "0"), v: dms("0", "0", "0"), s: "10.000" }
      ),
      target("B",
        { h: dms("68", "47", "0"), v: dms("0", "0", "0"), s: "10.000" },
        { h: dms("248", "47", "20"), v: dms("0", "0", "0"), s: "10.000" }
      )
    ]
  };
  const res = C.computeStation(station, "VA");
  assert.ok(Math.abs(res.halfDiff) > 20, "浮点值略大于 20，正好压测余量");
  assert.ok(!res.issues.some((issue) => issue.code === "halfdiff" && issue.level === "warning"));
  assert.ok(res.issues.some((issue) => issue.code === "halfdiff-ok"));

  const overStation = JSON.parse(JSON.stringify(station));
  overStation.targets[1].readings.R.h = dms("248", "47", "21");
  const over = C.computeStation(overStation, "VA");
  assert.ok(over.issues.some((issue) => issue.code === "halfdiff" && issue.level === "warning"));
});

console.log("\n" + passed + " tests passed.");
