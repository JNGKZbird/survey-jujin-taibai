"use strict";

const assert = require("assert");
const B = require("../web/assets/error-bands.js");

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

console.log("error-bands.js tests");

test("ratio divides value by the allowed error", () => {
  assert.strictEqual(B.ratio(10, 20), 0.5);
  assert.strictEqual(B.ratio(25, 25), 1);
});

test("ratio uses the absolute value of the error", () => {
  assert.strictEqual(B.ratio(-15, 30), 0.5);
  assert.strictEqual(B.ratio(-24, 12), 2);
});

test("ratio accepts numeric strings", () => {
  assert.strictEqual(B.ratio("13", "12"), 13 / 12);
});

test("ratio refuses missing or non-numeric values", () => {
  [null, undefined, "", "  ", "abc", NaN, Infinity].forEach((value) => {
    assert.strictEqual(B.ratio(value, 12), null, String(value));
  });
});

test("ratio refuses missing or non-positive limits", () => {
  [null, undefined, "", 0, -5, NaN].forEach((limit) => {
    assert.strictEqual(B.ratio(5, limit), null, String(limit));
  });
});

test("white band covers 0 up to and including 1x", () => {
  assert.strictEqual(B.band(0), 1);
  assert.strictEqual(B.band(0.5), 1);
  assert.strictEqual(B.band(1), 1);
  assert.strictEqual(B.band(1 + 1e-12), 1);
});

test("green band covers just over 1x up to and including 2x", () => {
  assert.strictEqual(B.band(1.000001), 2);
  assert.strictEqual(B.band(2), 2);
  assert.strictEqual(B.band(2 + 1e-10), 2);
});

test("yellow band covers just over 2x up to and including 3x", () => {
  assert.strictEqual(B.band(2.000001), 3);
  assert.strictEqual(B.band(3), 3);
  assert.strictEqual(B.band(3 + 1e-10), 3);
});

test("red band covers everything over 3x", () => {
  assert.strictEqual(B.band(3.000001), 4);
  assert.strictEqual(B.band(10), 4);
});

test("band rejects unjudgeable ratios", () => {
  [null, undefined, "", NaN, Infinity, -1].forEach((value) => {
    assert.strictEqual(B.band(value), 0, String(value));
  });
});

test("course 2C instances map to the right bands", () => {
  const limit = 12;
  assert.strictEqual(B.band(B.ratio(12, limit)), 1);
  assert.strictEqual(B.band(B.ratio(13, limit)), 2);
  assert.strictEqual(B.band(B.ratio(24, limit)), 2);
  assert.strictEqual(B.band(B.ratio(25, limit)), 3);
  assert.strictEqual(B.band(B.ratio(36, limit)), 3);
  assert.strictEqual(B.band(B.ratio(36.1, limit)), 4);
});

test("table four distance error uses mean/4 as the allowed mm", () => {
  const allowedMm = 100 / 4; // 100 m 平距，往返 1/4000 → 25 mm
  assert.strictEqual(B.band(B.ratio(25, allowedMm)), 1);
  assert.strictEqual(B.band(B.ratio(30, allowedMm)), 2);
  assert.strictEqual(B.band(B.ratio(60, allowedMm)), 3);
  assert.strictEqual(B.band(B.ratio(80, allowedMm)), 4);
});

test("table four height closure uses 60 sqrt(D km) mm", () => {
  const allowedMm = 60 * Math.sqrt(100 / 1000); // D = 0.1 km → 18.97 mm
  assert.strictEqual(B.band(B.ratio(19, allowedMm)), 2);
  assert.strictEqual(B.band(B.ratio(18, allowedMm)), 1);
  assert.strictEqual(B.band(B.ratio(60, allowedMm)), 4);
});

console.log("\n" + passed + " passed");
