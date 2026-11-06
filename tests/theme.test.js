"use strict";

const assert = require("assert");
const T = require("../web/assets/theme.js");

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

console.log("theme.js tests");

test("default preference is light", () => {
  assert.strictEqual(T.DEFAULT_PREFERENCE, "light");
  assert.strictEqual(T.getPreference(), "light");
  assert.strictEqual(T.KEY, "survey-jujin.theme");
});

test("exactly three preferences are offered", () => {
  assert.deepStrictEqual(T.PREFERENCES, ["light", "dark", "system"]);
  assert.throws(() => T.PREFERENCES.push("sepia"), TypeError);
  assert.deepStrictEqual(T.PREFERENCES, ["light", "dark", "system"]);
});

test("normalize keeps valid values", () => {
  ["light", "dark", "system"].forEach((value) => {
    assert.strictEqual(T.normalize(value), value);
  });
});

test("normalize falls back to light for anything else", () => {
  [null, undefined, "", "Light", "auto", 0, 1, {}, []].forEach((value) => {
    assert.strictEqual(T.normalize(value), "light");
  });
});

test("resolve follows an explicit light preference", () => {
  assert.strictEqual(T.resolve("light", true), "light");
  assert.strictEqual(T.resolve("light", false), "light");
});

test("resolve follows an explicit dark preference", () => {
  assert.strictEqual(T.resolve("dark", true), "dark");
  assert.strictEqual(T.resolve("dark", false), "dark");
});

test("resolve follows the system only for system preference", () => {
  assert.strictEqual(T.resolve("system", true), "dark");
  assert.strictEqual(T.resolve("system", false), "light");
});

test("effective falls back to light when matchMedia is unavailable", () => {
  assert.strictEqual(T.getTheme(), "light");
  assert.strictEqual(T.isDark(), false);
});

test("setPreference normalizes, keeps the value and notifies once", () => {
  const calls = [];
  const off = T.onChange((preference, theme) => {
    calls.push([preference, theme]);
  });
  assert.strictEqual(T.setPreference("dark"), "dark");
  assert.strictEqual(T.getPreference(), "dark");
  assert.deepStrictEqual(calls, [["dark", "dark"]]);

  T.setPreference("dark");
  assert.strictEqual(calls.length, 1);

  assert.strictEqual(T.setPreference("bogus"), "light");
  assert.strictEqual(T.getPreference(), "light");
  assert.deepStrictEqual(calls[1], ["light", "light"]);

  off();
  T.setPreference("light");
  assert.strictEqual(calls.length, 2);
});

test("setPreferenceAnimated applies immediately without a document", () => {
  const calls = [];
  const ret = T.setPreferenceAnimated("dark", () => calls.push("after"));
  assert.strictEqual(ret, "dark");
  assert.strictEqual(T.getPreference(), "dark");
  assert.strictEqual(T.getTheme(), "dark");
  assert.deepStrictEqual(calls, ["after"]);
});

test("setPreferenceAnimated normalizes and tolerates a missing callback", () => {
  assert.strictEqual(T.setPreferenceAnimated("sepia"), "light");
  assert.strictEqual(T.getPreference(), "light");
});

test("setPreferenceAnimated still runs the extra step when the theme is unchanged", () => {
  let after = 0;
  let notified = 0;
  const off = T.onChange(() => { notified += 1; });
  assert.strictEqual(T.setPreferenceAnimated("light", () => { after += 1; }), "light");
  assert.strictEqual(after, 1);
  assert.strictEqual(notified, 0);
  off();
});

console.log("theme.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
