"use strict";

const assert = require("assert");
const C = require("../web/assets/calc-angle-distance.js");

function dm(d, m, s) {
  return { d: String(d), m: String(m), s: String(s) };
}

function row(target, d, m, s) {
  return { target, reading: dm(d, m, s) };
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

const ANGLE = 68 + 47 / 60;
const limitIssue = (res) => res.issues.find((item) => item.message.includes("半测回角值之差"));

console.log("calc-angle-distance.js tests");

test("normalize helpers", () => {
  assert.strictEqual(C.normalize360(-10), 350);
  assert.strictEqual(C.normalize360(370), 10);
  assert.strictEqual(C.normalize180(190), -170);
  assert.strictEqual(C.normalize180(-190), 170);
});

test("DMS parsing (horizontal dial)", () => {
  assert.strictEqual(C.readDms(dm("181", "55", "16")).value, 181 + 55 / 60 + 16 / 3600);
  assert.strictEqual(C.readDms(dm("0", "60", "0")).state, "invalid");
  assert.strictEqual(C.readDms(dm("0", "0", "60")).state, "invalid");
  assert.strictEqual(C.readDms(dm("", "", "")).state, "empty");
  assert.strictEqual(C.readDms(dm("1", "", "")).state, "partial");
  assert.strictEqual(C.readDms(dm("361", "0", "0")).state, "invalid");
  assert.strictEqual(C.readDms(dm("-1", "0", "0")).state, "invalid");
  assert.strictEqual(C.readDms(dm("360", "0", "0")).value, 0);
});

test("basic station, same row order on both faces", () => {
  const res = C.computeStation({
    rows: [
      row("", 0, 1, 0),
      row("", 68, 48, 0),
      row("", 180, 1, 12),
      row("", 248, 48, 12)
    ]
  });
  close(res.halfLeft.value, ANGLE);
  close(res.halfRight.value, ANGLE);
  close(res.halfDiff.value, 0);
  close(res.angleMean.value, ANGLE);
  assert.strictEqual(res.pairMode, "row");
  assert.strictEqual(res.halfDiff.state, "ok");
  assert.ok(res.issues.some((item) => item.level === "info"));
});

test("right face observed ②→① is paired by target name", () => {
  const res = C.computeStation({
    rows: [
      row("A", 0, 1, 0),
      row("B", 68, 48, 0),
      row("B", 248, 48, 12),
      row("A", 180, 1, 12)
    ]
  });
  assert.strictEqual(res.pairMode, "target");
  close(res.halfLeft.value, ANGLE);
  close(res.halfRight.value, ANGLE);
  close(res.halfDiff.value, 0);
  close(res.angleMean.value, ANGLE);
  assert.ok(!res.issues.some((item) => item.level === "info"));
});

test("half angle across 0°/360°", () => {
  const res = C.computeStation({
    rows: [
      row("A", 359, 59, 0),
      row("B", 0, 1, 0),
      row("A", 179, 59, 30),
      row("B", 180, 1, 30)
    ]
  });
  close(res.halfLeft.value, 2 / 60);
  close(res.halfRight.value, 2 / 60);
  close(res.halfDiff.value, 0);
  close(res.angleMean.value, 2 / 60);
});

test("mean across 0°/360°", () => {
  const res = C.computeStation({
    rows: [
      row("A", 0, 0, 0),
      row("B", 359, 59, 50),
      row("A", 180, 0, 0),
      row("B", 180, 0, 10)
    ]
  });
  close(res.halfLeft.value, 359 + 59 / 60 + 50 / 3600);
  close(res.halfRight.value, 10 / 3600);
  close(res.halfDiff.value, 20);
  close(res.angleMean.value, 0);
  assert.ok(!limitIssue(res));
});

test("half-angle difference limit (course default 20″)", () => {
  const nineteen = C.computeStation({
    rows: [
      row("A", 0, 1, 0),
      row("B", 68, 48, 0),
      row("A", 180, 1, 12),
      row("B", 248, 48, 31)
    ]
  });
  close(nineteen.halfDiff.value, 19);
  assert.ok(!limitIssue(nineteen));

  const twentyOne = C.computeStation({
    rows: [
      row("A", 0, 1, 0),
      row("B", 68, 48, 0),
      row("A", 180, 1, 12),
      row("B", 248, 48, 33)
    ]
  });
  close(twentyOne.halfDiff.value, 21);
  const issue = limitIssue(twentyOne);
  assert.ok(issue && issue.level === "warning");
  assert.ok(issue.message.includes("20″"));

  const custom = C.computeStation({
    rows: [
      row("A", 0, 1, 0),
      row("B", 68, 48, 0),
      row("A", 180, 1, 12),
      row("B", 248, 48, 33)
    ]
  }, { limit: 50 });
  assert.ok(!limitIssue(custom));
  assert.strictEqual(custom.limit, 50);
});

test("target labels on left only: fallback to row order with a hint", () => {
  const res = C.computeStation({
    rows: [
      row("A", 0, 1, 0),
      row("B", 68, 48, 0),
      row("", 180, 1, 12),
      row("", 248, 48, 12)
    ]
  });
  assert.strictEqual(res.pairMode, "row");
  close(res.halfRight.value, ANGLE);
  assert.ok(res.issues.some((item) => item.level === "info" && item.message.includes("行序")));
});

test("row-order fallback with reversed right face (documented behaviour)", () => {
  const res = C.computeStation({
    rows: [
      row("", 0, 1, 0),
      row("", 68, 48, 0),
      row("", 248, 48, 12),
      row("", 180, 1, 12)
    ]
  });
  assert.strictEqual(res.pairMode, "row");
  close(res.halfRight.value, 360 - ANGLE);
  assert.ok(res.issues.some((item) => item.level === "info"));
});

test("partial and invalid readings are soft issues", () => {
  const partial = C.computeStation({
    rows: [
      row("", 1, "", ""),
      row("", 68, 48, 0),
      row("", 180, 1, 12),
      row("", 248, 48, 12)
    ]
  });
  assert.strictEqual(partial.halfLeft.state, "partial");
  assert.strictEqual(partial.halfDiff.state, "partial");
  assert.ok(partial.issues.some((item) => item.row === 1 && item.message.includes("未填全")));

  const invalid = C.computeStation({
    rows: [
      row("", 1, 60, 0),
      row("", 68, 48, 0),
      row("", 180, 1, 12),
      row("", 248, 48, 12)
    ]
  });
  assert.strictEqual(invalid.halfLeft.state, "invalid");
  assert.ok(invalid.issues.some((item) => item.level === "invalid" && item.row === 1));
});

test("left face only: right half is waiting, no false warning", () => {
  const res = C.computeStation({
    rows: [
      row("", 0, 1, 0),
      row("", 68, 48, 0),
      row("", "", "", ""),
      row("", "", "", "")
    ]
  });
  assert.strictEqual(res.halfLeft.state, "ok");
  assert.strictEqual(res.halfRight.state, "empty");
  assert.strictEqual(res.halfDiff.state, "waiting");
  assert.strictEqual(res.angleMean.state, "waiting");
  assert.ok(!limitIssue(res));
  assert.strictEqual(res.issues.filter((item) => item.level === "missing").length, 2);
});

test("empty station stays quiet", () => {
  const res = C.computeStation({ rows: [] });
  assert.strictEqual(res.started, false);
  assert.strictEqual(res.halfLeft.state, "empty");
  assert.strictEqual(res.halfRight.state, "empty");
  assert.strictEqual(res.angleMean.state, "empty");
  assert.deepStrictEqual(res.issues, []);
  assert.strictEqual(res.rows.length, 4);
});

test("formatters", () => {
  assert.strictEqual(C.formatDms(ANGLE), "68°47′00″");
  assert.strictEqual(C.formatDms(ANGLE + 6 / 3600), "68°47′06″");
  assert.strictEqual(C.formatDms(359.9999, { decimals: 0 }), "0°00′00″");
  assert.strictEqual(C.formatDms(null), "—");
  assert.strictEqual(C.formatSeconds(41), "41″");
  assert.strictEqual(C.formatSeconds(20.5), "20.5″");
  assert.strictEqual(C.formatSeconds(-0.5, { showPlus: true }), "-0.5″");
  assert.strictEqual(C.formatSeconds(0, { showPlus: true }), "0″");
  assert.strictEqual(C.formatSeconds(NaN), "—");
});

console.log("\n" + passed + " tests passed.");
