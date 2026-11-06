"use strict";

const assert = require("assert");
const A = require("../web/assets/agent/attachments.js");

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

const DIRECT = {
  imageSupport: "on",
  providerId: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  visionModel: ""
};
const TRANSCRIBE = {
  imageSupport: "auto",
  providerId: "other",
  baseUrl: "https://example.com/v1",
  model: "text-only",
  visionModel: "vision-helper"
};
const NONE = Object.assign({}, TRANSCRIBE, { imageSupport: "off" });

function image(id, extra) {
  return Object.assign({
    id: id,
    kind: "image",
    mime: "image/jpeg",
    name: id + ".jpg",
    w: 100,
    h: 80,
    bytes: 1024,
    thumb: "",
    transcript: ""
  }, extra || {});
}

function options(extra) {
  return Object.assign({
    imageSupport: DIRECT.imageSupport,
    providerId: DIRECT.providerId,
    baseUrl: DIRECT.baseUrl,
    model: DIRECT.model,
    visionModel: DIRECT.visionModel,
    hasData: function () { return ""; },
    hasStored: function () { return false; },
    storageReady: false
  }, extra || {});
}

test("empty list is none and is not an image turn", function () {
  const plan = A.planImageTurn([], DIRECT);
  assert.deepStrictEqual(plan, { mode: "none", imageTurn: false, payloads: [] });
});

test("direct channel sends every in-memory image in order", function () {
  const plan = A.planImageTurn([image("img_a"), image("img_b")], options({
    hasData: function (id) { return id === "img_a" ? "data:image/jpeg;base64,QUJD" :
      (id === "img_b" ? "data:image/png;base64,REVG" : ""); }
  }));
  assert.strictEqual(plan.mode, "direct");
  assert.deepStrictEqual(plan.payloads,
    ["data:image/jpeg;base64,QUJD", "data:image/png;base64,REVG"]);
  assert.strictEqual(plan.imageTurn, true);
});

test("direct channel prefers transcripts when an original is missing", function () {
  const plan = A.planImageTurn([
    image("img_a", { transcript: "读数 1.234" }),
    image("img_b", { transcript: "读数 2.345" })
  ], options({ hasData: function () { return ""; } }));
  assert.strictEqual(plan.mode, "transcript");
  assert.strictEqual(plan.fallback, true);
  assert.deepStrictEqual(plan.payloads, []);
});

test("direct channel stores only the missing originals and counts the whole turn", function () {
  const plan = A.planImageTurn([image("img_a"), image("img_b")], options({
    hasData: function (id) { return id === "img_a" ? "data:image/jpeg;base64,QUJD" : ""; },
    hasStored: function (id) { return id === "img_b"; },
    storageReady: true
  }));
  assert.strictEqual(plan.mode, "stored");
  assert.deepStrictEqual(plan.needs, ["img_b"]);
  assert.strictEqual(plan.sendCount, 2, "stored 的披露数必须按整轮图片数，不能是 0");
  assert.deepStrictEqual(plan.payloads, []);
});

test("direct channel is missing when a missing original is not on disk", function () {
  const plan = A.planImageTurn([image("img_a"), image("img_b")], options({
    hasData: function (id) { return id === "img_a" ? "data:image/jpeg;base64,QUJD" : ""; },
    hasStored: function (id) { return id === "img_a"; },
    storageReady: true
  }));
  assert.strictEqual(plan.mode, "missing");
  assert.strictEqual(plan.imageTurn, true);
});

test("stored mode is never used when the disk index is not ready", function () {
  const plan = A.planImageTurn([image("img_a")], options({
    hasStored: function () { return true; },
    storageReady: false
  }));
  assert.strictEqual(plan.mode, "missing");
});

test("transcribe channel lists only the images without transcripts", function () {
  const plan = A.planImageTurn([
    image("img_a", { transcript: "已有转写" }),
    image("img_b"),
    image("img_c")
  ], options({
    imageSupport: TRANSCRIBE.imageSupport,
    providerId: TRANSCRIBE.providerId,
    baseUrl: TRANSCRIBE.baseUrl,
    model: TRANSCRIBE.model,
    visionModel: TRANSCRIBE.visionModel,
    hasData: function () { return "data:image/jpeg;base64,QUJD"; }
  }));
  assert.strictEqual(plan.mode, "transcribe");
  assert.deepStrictEqual(plan.pending.map(function (one) { return one.id; }),
    ["img_b", "img_c"]);
  assert.strictEqual(plan.vision.visionModel, "vision-helper");
});

test("transcribe channel becomes pure transcript when nothing needs uploading", function () {
  const plan = A.planImageTurn([
    image("img_a", { transcript: "已有转写" }),
    image("img_b", { transcript: "也有" })
  ], options({
    imageSupport: TRANSCRIBE.imageSupport,
    providerId: TRANSCRIBE.providerId,
    baseUrl: TRANSCRIBE.baseUrl,
    model: TRANSCRIBE.model,
    visionModel: TRANSCRIBE.visionModel
  }));
  assert.strictEqual(plan.mode, "transcript");
  assert.deepStrictEqual(plan.payloads, []);
});

test("transcribe channel stores missing pending originals and counts pending uploads", function () {
  const plan = A.planImageTurn([
    image("img_a", { transcript: "已有转写" }),
    image("img_b"),
    image("img_c")
  ], options({
    imageSupport: TRANSCRIBE.imageSupport,
    providerId: TRANSCRIBE.providerId,
    baseUrl: TRANSCRIBE.baseUrl,
    model: TRANSCRIBE.model,
    visionModel: TRANSCRIBE.visionModel,
    hasData: function (id) { return id === "img_b" ? "data:image/jpeg;base64,QUJD" : ""; },
    hasStored: function (id) { return id === "img_c"; },
    storageReady: true
  }));
  assert.strictEqual(plan.mode, "stored");
  assert.deepStrictEqual(plan.needs, ["img_c"]);
  assert.strictEqual(plan.sendCount, 2, "只上传待转写的两张，不含已有转写的一张");
});

test("transcribe channel is missing when a pending original is nowhere", function () {
  const plan = A.planImageTurn([image("img_a"), image("img_b")], options({
    imageSupport: TRANSCRIBE.imageSupport,
    providerId: TRANSCRIBE.providerId,
    baseUrl: TRANSCRIBE.baseUrl,
    model: TRANSCRIBE.model,
    visionModel: TRANSCRIBE.visionModel,
    hasData: function (id) { return id === "img_a" ? "data:image/jpeg;base64,QUJD" : ""; },
    hasStored: function (id) { return id === "img_a"; },
    storageReady: true
  }));
  assert.strictEqual(plan.mode, "missing");
});

test("off support still allows a fully transcribed text-only turn", function () {
  const plan = A.planImageTurn([image("img_a", { transcript: "读数" })],
    Object.assign({}, NONE, { hasData: function () { return ""; } }));
  assert.strictEqual(plan.mode, "transcript");
});

test("off support blocks a turn that still needs an original", function () {
  const plan = A.planImageTurn([image("img_a")], NONE);
  assert.strictEqual(plan.mode, "blocked");
  assert.strictEqual(plan.reason, "off");
});

test("no vision fallback blocks a turn without transcripts", function () {
  const plan = A.planImageTurn([image("img_a")], {
    imageSupport: "auto",
    providerId: "other",
    baseUrl: "https://example.com/v1",
    model: "text-only",
    visionModel: ""
  });
  assert.strictEqual(plan.mode, "blocked");
  assert.strictEqual(plan.reason, "no-vision");
});

test("stored needs are unique and preserve attachment order", function () {
  const plan = A.planImageTurn([image("img_a"), image("img_a"), image("img_b")],
    options({
      hasStored: function () { return true; },
      storageReady: true
    }));
  assert.strictEqual(plan.mode, "stored");
  assert.deepStrictEqual(plan.needs, ["img_a", "img_b"]);
});

test("missing mode has no payloads and no stored count", function () {
  const plan = A.planImageTurn([image("img_a")], options({
    hasData: function () { return ""; },
    hasStored: function () { return false; },
    storageReady: true
  }));
  assert.strictEqual(plan.mode, "missing");
  assert.strictEqual(plan.payloads, undefined);
  assert.strictEqual(plan.sendCount, undefined);
});

console.log("agent-image-plan.js: " + passed + " passed");
