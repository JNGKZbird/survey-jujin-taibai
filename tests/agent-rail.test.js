"use strict";

const assert = require("assert");
const R = require("../web/assets/agent/rail.js");
assert.ok(R, "rail.js should expose the rail helpers");

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

console.log("agent-rail tests");

test("no hover keeps every bar at the resting width", () => {
  assert.strictEqual(R.growAt(0, null), 0);
  assert.strictEqual(R.growAt(5, undefined), 0);
  assert.strictEqual(R.barWidth(0), R.BAR_MIN);
  assert.strictEqual(R.barAlpha(0), R.ALPHA_BASE);
});

test("proximity growth falls off by distance like the reference", () => {
  assert.strictEqual(R.growAt(3, 3), 1);
  assert.strictEqual(R.growAt(2, 3), 0.72);
  assert.strictEqual(R.growAt(4, 3), 0.72);
  assert.strictEqual(R.growAt(1, 3), 0.45);
  assert.strictEqual(R.growAt(5, 3), 0.45);
  assert.strictEqual(R.growAt(0, 3), 0.2);
  assert.strictEqual(R.growAt(7, 3), 0);
});

test("the hovered bar is 24px, the resting bar 10px", () => {
  assert.strictEqual(R.barWidth(1), 24);
  assert.strictEqual(R.barWidth(0.72), 10 + 0.72 * 14);
  assert.ok(Math.abs(R.barAlpha(1) - 0.46) < 1e-9, "alpha is 0.16 + 0.3");
});

test("width and alpha clamp bad grow values", () => {
  assert.strictEqual(R.barWidth(-3), R.BAR_MIN);
  assert.strictEqual(R.barWidth(9), 24);
  assert.strictEqual(R.barWidth("x"), R.BAR_MIN);
  assert.strictEqual(R.barAlpha(-1), R.ALPHA_BASE);
  assert.ok(Math.abs(R.barAlpha(2) - 0.46) < 1e-9, "alpha clamps at 0.46");
});

test("the rail keeps only the newest 32 rounds", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ nid: "n" + i }));
  const kept = R.tail(many, R.CAP);
  assert.strictEqual(kept.length, 32);
  assert.strictEqual(kept[0].nid, "n8");
  assert.strictEqual(kept[31].nid, "n39");
  assert.strictEqual(many.length, 40, "tail must not mutate the input");
  assert.deepStrictEqual(R.tail([{ nid: "a" }], 32), [{ nid: "a" }]);
  assert.deepStrictEqual(R.tail([], 32), []);
});

test("a round is visible when any part of it crosses the viewport", () => {
  const rows = [
    { nid: "above", top: -200, bottom: -10 },
    { nid: "edge-top", top: -20, bottom: 0 },
    { nid: "partial", top: 10, bottom: 40 },
    { nid: "full", top: 40, bottom: 80 },
    { nid: "edge-bottom", top: 100, bottom: 120 },
    { nid: "below", top: 100, bottom: 200 }
  ];
  const vis = R.visibleNids(rows, 0, 100);
  assert.deepStrictEqual(Object.keys(vis).sort(), ["full", "partial"]);
  assert.strictEqual(vis.above, undefined);
  assert.strictEqual(vis["edge-top"], undefined, "bottom == viewTop does not intersect");
  assert.strictEqual(vis["edge-bottom"], undefined, "top == viewBottom does not intersect");
});

test("jump target leaves an 8px breath above the round", () => {
  assert.strictEqual(R.jumpTop(300, 100, 500), 692);
  assert.strictEqual(R.jumpTop(100, 100, 0), 0, "top of the stream clamps at 0");
  assert.strictEqual(R.jumpTop(80, 100, 0), 0);
});

if (passed) console.log("agent-rail: " + passed + " passed");
