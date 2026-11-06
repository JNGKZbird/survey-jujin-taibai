"use strict";

const assert = require("assert");
const C = require("../web/assets/agent/column.js");
assert.ok(C, "column.js should expose the column helpers");

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

console.log("agent-column tests");

test("default width is 760 for missing values", () => {
  assert.strictEqual(C.DEFAULT, 760);
  assert.strictEqual(C.parseStored(null, C.MIN, C.MAX_STORED), 760);
  assert.strictEqual(C.parseStored(undefined, C.MIN, C.MAX_STORED), 760);
  assert.strictEqual(C.parseStored("", C.MIN, C.MAX_STORED), 760);
  assert.strictEqual(C.parseStored("   ", C.MIN, C.MAX_STORED), 760);
});

test("garbage stored values fall back to the default", () => {
  assert.strictEqual(C.parseStored("abc", C.MIN, C.MAX_STORED), 760);
  assert.strictEqual(C.parseStored("NaN", C.MIN, C.MAX_STORED), 760);
  assert.strictEqual(C.parseStored("-50", C.MIN, C.MAX_STORED), 760);
  assert.strictEqual(C.parseStored("0", C.MIN, C.MAX_STORED), 760);
});

test("stored widths are clamped into range", () => {
  assert.strictEqual(C.parseStored("520", C.MIN, C.MAX_STORED), 520);
  assert.strictEqual(C.parseStored("100", C.MIN, C.MAX_STORED), 420);
  assert.strictEqual(C.parseStored("99999", C.MIN, C.MAX_STORED), 4000);
});

test("right handle grows at twice the pointer delta", () => {
  assert.strictEqual(C.widthFromDrag("right", 760, 40, 420, 1200), 840);
  assert.strictEqual(C.widthFromDrag("right", 760, -40, 420, 1200), 680);
});

test("left handle mirrors the right handle", () => {
  assert.strictEqual(C.widthFromDrag("left", 760, 40, 420, 1200), 680);
  assert.strictEqual(C.widthFromDrag("left", 760, -40, 420, 1200), 840);
  assert.strictEqual(
    C.widthFromDrag("left", 760, 40, 420, 1200),
    C.widthFromDrag("right", 760, -40, 420, 1200)
  );
});

test("drag stops at the lower and upper bounds", () => {
  assert.strictEqual(C.widthFromDrag("right", 760, -600, 420, 1200), 420);
  assert.strictEqual(C.widthFromDrag("right", 760, 600, 420, 1200), 1200);
  assert.strictEqual(C.widthFromDrag("left", 760, 600, 420, 1200), 420);
});

test("available width below the minimum wins over the minimum", () => {
  assert.strictEqual(C.widthFromDrag("right", 760, 0, 420, 360), 360);
  assert.strictEqual(C.clamp(500, 420, 360), 360);
});

test("widths are whole pixels", () => {
  assert.strictEqual(C.widthFromDrag("right", 760, 10.4, 420, 1200), 781);
  assert.strictEqual(C.parseStored("520.6", C.MIN, C.MAX_STORED), 521);
});

test("non-finite inputs never produce NaN", () => {
  assert.strictEqual(C.widthFromDrag("right", NaN, 10, 420, 1200), 780);
  assert.strictEqual(C.widthFromDrag("right", 760, NaN, 420, 1200), 760);
  assert.ok(Number.isFinite(C.widthFromDrag("right", 760, 10, 420, NaN)));
  assert.ok(Number.isFinite(C.clamp(NaN, 420, 1200)));
});

console.log("agent-column: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
