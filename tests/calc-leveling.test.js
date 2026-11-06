"use strict";

const assert = require("assert");
const C = require("../web/assets/calc-leveling.js");

function staff(lower, upper, black, red) {
  return {
    lower: String(lower),
    upper: String(upper),
    black: String(black),
    red: String(red)
  };
}

function input(overrides) {
  return Object.assign({
    back: staff(1575, 1475, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087),
    kBack: "4787",
    kFront: "4687"
  }, overrides || {});
}

function close(actual, expected, eps) {
  assert.ok(Math.abs(actual - expected) < (eps == null ? 1e-9 : eps),
    "expected " + expected + ", got " + actual);
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

console.log("calc-leveling.js tests");

test("staff / decimal parsing", () => {
  assert.strictEqual(C.readStaff("1575").value, 1575);
  assert.strictEqual(C.readStaff("01575").value, 1575);
  assert.strictEqual(C.readStaff("").state, "empty");
  assert.strictEqual(C.readStaff("15.5").state, "invalid");
  assert.strictEqual(C.readStaff("1234567").state, "invalid");
  // 米制小数：1.170 m = 1170 mm；红面 6.287 m = 6287 mm。
  assert.strictEqual(C.readStaff("1.170").value, 1170);
  assert.strictEqual(C.readStaff("1.17").value, 1170);
  assert.strictEqual(C.readStaff("0.562").value, 562);
  assert.strictEqual(C.readStaff("6.287").value, 6287);
  assert.strictEqual(C.readStaff("1.1705").value, 1171);
  assert.strictEqual(C.readStaff("1,170").value, 1170);
  // 四位小数按半值远离零到 mm，二进制尾巴不能让它少 1 mm。
  assert.strictEqual(C.readStaff("0.1025").value, 103);
  assert.strictEqual(C.readStaff("1.0005").value, 1001);
  assert.strictEqual(C.readStaff("2.0005").value, 2001);
  assert.strictEqual(C.staffMeters("0.1025"), "0.103");
  assert.strictEqual(C.staffMeters("1.1705"), "1.171");
  assert.strictEqual(C.staffMeters("1.0005"), "1.001");
  assert.strictEqual(C.staffMeters("1170"), "1.170");
  assert.strictEqual(C.staffMeters("1,170"), "1.170");
  assert.strictEqual(C.staffMeters(""), "");
  assert.strictEqual(C.staffMeters("1."), "1.000");
  assert.strictEqual(C.readDecimal("1,5").value, 1.5);
  assert.strictEqual(C.readDecimal("-1").state, "invalid");
  assert.strictEqual(C.readDecimal("").state, "empty");
});

test("complete 四等 station", () => {
  const res = C.computeStation(input(), { grade: "IV" });
  assert.strictEqual(res.started, true);
  close(res.backDist.value, 10);
  close(res.frontDist.value, 10);
  close(res.d.value, 0);
  close(res.sumD.value, 0);
  close(res.k1.value, 0);
  close(res.k2.value, 0);
  close(res.k3.value, 0);
  close(res.blackDiff.value, 100);
  close(res.redDiff.value, 200);
  close(res.mean.value, 100);
  assert.deepStrictEqual(res.issues, []);
});

test("meter readings match mm readings", () => {
  const res = C.computeStation({
    back: { lower: "1.575", upper: "1.475", black: "1.500", red: "6.287" },
    front: { lower: "1.475", upper: "1.375", black: "1.400", red: "6.087" },
    kBack: "4787",
    kFront: "4687"
  }, { grade: "IV" });
  const mm = C.computeStation(input(), { grade: "IV" });
  assert.strictEqual(res.backDist.value, mm.backDist.value);
  assert.strictEqual(res.frontDist.value, mm.frontDist.value);
  assert.strictEqual(res.blackDiff.value, mm.blackDiff.value);
  assert.strictEqual(res.redDiff.value, mm.redDiff.value);
  assert.strictEqual(res.mean.value, mm.mean.value);
  assert.deepStrictEqual(res.issues, []);
});

test("Σd accumulates from previous stations", () => {
  const res = C.computeStation({
    back: staff(1620, 1475, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  }, { grade: "IV", prevSumD: 3 });
  close(res.d.value, 4.5);
  close(res.sumD.value, 7.5);
  assert.ok(!res.issues.some((issue) => issue.field === "sumD"));

  const broken = C.computeStation({
    back: staff(1620, 1475, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  }, { grade: "IV", prevSumD: null });
  close(broken.d.value, 4.5);
  assert.strictEqual(broken.sumD.state, "waiting");
  assert.ok(!broken.issues.some((issue) => issue.field === "sumD"));
});

test("grade switch changes limits, not data", () => {
  const data = {
    back: staff(1620, 1475, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  };
  const third = C.computeStation(data, { grade: "III", prevSumD: 3 });
  close(third.d.value, 4.5);
  close(third.sumD.value, 7.5);
  assert.ok(third.issues.some((issue) => issue.level === "warning" && issue.field === "d"));
  assert.ok(third.issues.some((issue) => issue.level === "warning" && issue.field === "sumD"));
  assert.ok(third.issues.some((issue) => issue.message.includes("超三等限差")));

  const fourth = C.computeStation(data, { grade: "IV", prevSumD: 3 });
  close(fourth.d.value, 4.5);
  close(fourth.sumD.value, 7.5);
  assert.ok(!fourth.issues.some((issue) => issue.field === "d"));
  assert.ok(!fourth.issues.some((issue) => issue.field === "sumD"));
});

test("sight length limit (三等 75 m)", () => {
  const res = C.computeStation({
    back: staff(2375, 1575, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  }, { grade: "III" });
  close(res.backDist.value, 80);
  const issue = res.issues.find((item) => item.field === "back.dist");
  assert.ok(issue && issue.level === "warning");
  assert.ok(issue.message.includes("后视距"));
  assert.ok(issue.message.includes("75 m"));
});

test("80 m sight passes 四等 (100 m)", () => {
  const res = C.computeStation({
    back: staff(2375, 1575, 1500, 6287),
    front: staff(2375, 1575, 1400, 6087)
  }, { grade: "IV" });
  close(res.backDist.value, 80);
  close(res.frontDist.value, 80);
  assert.ok(!res.issues.some((item) => item.field === "back.dist"));
  assert.ok(!res.issues.some((item) => item.field === "front.dist"));
});

test("K + black - red per staff (三等 2 mm)", () => {
  const res = C.computeStation({
    back: staff(1575, 1475, 1500, 6280),
    front: staff(1475, 1375, 1400, 6080),
    kBack: "4787",
    kFront: "4687"
  }, { grade: "III" });
  close(res.k1.value, 7);
  close(res.k2.value, 7);
  close(res.k3.value, 0);
  assert.ok(res.issues.some((item) => item.field === "back.k" && item.level === "warning"));
  assert.ok(res.issues.some((item) => item.field === "front.k" && item.level === "warning"));
});

test("black/red height difference check (三等 3 mm, 四等 5 mm)", () => {
  const data = {
    back: staff(1575, 1475, 1500, 6287),
    front: staff(1475, 1375, 1400, 6083),
    kBack: "4787",
    kFront: "4687"
  };
  const third = C.computeStation(data, { grade: "III" });
  close(third.k2.value, 4);
  close(third.k3.value, -4);
  const issue = third.issues.find((item) => item.field === "k3");
  assert.ok(issue && issue.message.includes("黑红面高差之差"));

  const fourth = C.computeStation(data, { grade: "IV" });
  assert.ok(!fourth.issues.some((item) => item.field === "k3"));
});

test("K pair affects the mean height difference", () => {
  const data = {
    back: staff(1575, 1475, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  };
  const mixed = C.computeStation(Object.assign({}, data, { kBack: "4787", kFront: "4687" }),
    { grade: "IV" });
  close(mixed.k3.value, 0);
  close(mixed.mean.value, 100);

  const same = C.computeStation(Object.assign({}, data, { kBack: "4787", kFront: "4787" }),
    { grade: "IV" });
  close(same.k1.value, 0);
  close(same.k2.value, 100);
  close(same.k3.value, -100);
  close(same.mean.value, 150);
});

test("K normalization", () => {
  assert.strictEqual(C.computeStation(input({ kBack: "4.687", kFront: "4.787" }), {}).kBack, 4687);
  assert.strictEqual(C.computeStation(input({ kBack: "4.687", kFront: "4.787" }), {}).kFront, 4787);
  assert.strictEqual(C.computeStation(input({ kBack: "", kFront: "" }), {}).kBack, 4787);
  assert.strictEqual(C.computeStation(input({ kBack: "4687", kFront: "5000" }), {}).kFront, 4787);
});

test("missing fields are soft issues only after start", () => {
  const res = C.computeStation({
    back: { lower: "1575", upper: "", black: "", red: "" },
    front: { lower: "", upper: "", black: "", red: "" }
  }, { grade: "IV" });
  assert.strictEqual(res.started, true);
  assert.strictEqual(res.backDist.state, "waiting");
  assert.strictEqual(res.d.state, "waiting");
  assert.strictEqual(res.mean.state, "empty");
  const missing = res.issues.filter((item) => item.level === "missing").map((item) => item.field);
  assert.ok(missing.includes("back.upper"));
  assert.ok(missing.includes("front.red"));
});

test("lower wire must be above upper wire", () => {
  const res = C.computeStation({
    back: staff(1475, 1575, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  }, { grade: "IV" });
  assert.strictEqual(res.backDist.state, "invalid");
  assert.strictEqual(res.d.state, "invalid");
  assert.ok(res.issues.some((item) => item.field === "back.dist" && item.level === "invalid"));
});

test("empty station stays quiet", () => {
  const res = C.computeStation({}, { grade: "IV" });
  assert.strictEqual(res.started, false);
  assert.strictEqual(res.d.state, "empty");
  assert.strictEqual(res.sumD.state, "empty");
  assert.strictEqual(res.mean.state, "empty");
  assert.deepStrictEqual(res.issues, []);
});

test("formatters", () => {
  assert.strictEqual(C.formatMeters(10, 1), "10.0");
  assert.strictEqual(C.formatMeters(null), "—");
  assert.strictEqual(C.formatMm(100), "100");
  assert.strictEqual(C.formatMm(-4.5, 1), "-4.5");
  assert.strictEqual(C.formatMm(0), "0");
});

test("sight distance equal to the limit does not warn (四等 100 m)", () => {
  // 超限 = 严格大于限差；恰好 100.0 m 不报，101.1 m 才报。
  const atLimit = C.computeStation({
    back: staff(2575, 1575, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  }, { grade: "IV" });
  close(atLimit.backDist.value, 100);
  assert.ok(!atLimit.issues.some((item) => item.field === "back.dist"));

  const over = C.computeStation({
    back: staff(2576, 1575, 1500, 6287),
    front: staff(1475, 1375, 1400, 6087)
  }, { grade: "IV" });
  close(over.backDist.value, 100.1);
  assert.ok(over.issues.some((item) => item.field === "back.dist" && item.level === "warning"));
});

test("K + black - red equal to the limit does not warn (四等 3 mm)", () => {
  const atLimit = C.computeStation({
    back: staff(1575, 1475, 1500, 6284),
    front: staff(1475, 1375, 1400, 6084),
    kBack: "4787",
    kFront: "4687"
  }, { grade: "IV" });
  close(atLimit.k1.value, 3);
  close(atLimit.k2.value, 3);
  assert.ok(!atLimit.issues.some((item) => item.field === "back.k"));
  assert.ok(!atLimit.issues.some((item) => item.field === "front.k"));

  const over = C.computeStation({
    back: staff(1575, 1475, 1500, 6283),
    front: staff(1475, 1375, 1400, 6083),
    kBack: "4787",
    kFront: "4687"
  }, { grade: "IV" });
  assert.ok(over.issues.some((item) => item.field === "back.k" && item.level === "warning"));
  assert.ok(over.issues.some((item) => item.field === "front.k" && item.level === "warning"));
});

console.log("\n" + passed + " tests passed.");
