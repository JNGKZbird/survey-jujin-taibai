"use strict";

const assert = require("assert");
require("../web/assets/agent/thinking.js");
const T = global.JujinAgentThinking;
assert.ok(T, "thinking.js should expose JujinAgentThinking");

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

console.log("agent-thinking tests");

test("DeepSeek exposes four levels with high as default", () => {
  const cap = T.capability("https://api.deepseek.com/v1", "deepseek-flash");
  assert.strictEqual(cap.dialectId, "deepseek");
  assert.deepStrictEqual(cap.levels, ["off", "low", "high", "max"]);
  assert.strictEqual(cap.defaultLevel, "high");
  assert.strictEqual(cap.canDisable, true);
});

test("DeepSeek off sends thinking disabled and no effort", () => {
  assert.deepStrictEqual(
    T.payload("https://api.deepseek.com/v1", "deepseek-flash", "off"),
    { thinking: { type: "disabled" } }
  );
});

test("DeepSeek low/high/max enable thinking and send effort", () => {
  ["low", "high", "max"].forEach((level) => {
    assert.deepStrictEqual(
      T.payload("https://api.deepseek.com/v1", "deepseek-flash", level),
      { thinking: { type: "enabled" }, reasoning_effort: level }
    );
  });
});

test("unknown levels fall back to the provider default", () => {
  assert.strictEqual(T.normalizeLevel("ultra", T.capability("https://api.deepseek.com", "")), "high");
  assert.strictEqual(T.normalizeLevel("", T.capability("https://api.deepseek.com", "")), "high");
});

test("OpenAI-compatible unknown hosts only offer default and off", () => {
  const cap = T.capability("https://example.com/v1", "anything");
  assert.strictEqual(cap.dialectId, "generic");
  assert.deepStrictEqual(cap.levels, ["off", "default"]);
  assert.strictEqual(cap.defaultLevel, "default");
  assert.deepStrictEqual(T.payload("https://example.com/v1", "anything", "default"), {});
  assert.deepStrictEqual(T.payload("https://example.com/v1", "anything", "off"), {});
  assert.strictEqual(T.options("https://example.com/v1", "anything").length, 2);
});

test("Qwen uses thinking budget", () => {
  assert.deepStrictEqual(
    T.payload("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", "low"),
    { enable_thinking: true, thinking_budget: 1000 }
  );
  assert.deepStrictEqual(
    T.payload("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", "max"),
    { enable_thinking: true, thinking_budget: 32000 }
  );
  assert.deepStrictEqual(
    T.payload("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", "off"),
    { enable_thinking: false }
  );
});

test("Kimi K3 cannot disable thinking", () => {
  const cap = T.capability("https://api.moonshot.cn/v1", "kimi-k3");
  assert.strictEqual(cap.canDisable, false);
  assert.deepStrictEqual(cap.levels, ["max"]);
  assert.strictEqual(cap.defaultLevel, "max");
  assert.strictEqual(T.normalizeLevel("off", cap), "max");
});

test("GLM 5.3+ cannot disable thinking", () => {
  const cap = T.capability("https://open.bigmodel.cn/api/paas/v4", "glm-5.3");
  assert.strictEqual(cap.canDisable, false);
  assert.deepStrictEqual(cap.levels, ["low", "high", "max"]);
  assert.deepStrictEqual(
    T.payload("https://open.bigmodel.cn/api/paas/v4", "glm-5.3", "off"),
    { thinking: { type: "enabled" }, reasoning_effort: "high" }
  );
});

test("host matching covers subdomains but not lookalikes", () => {
  assert.strictEqual(T.hostOf("https://api.deepseek.com/v1"), "api.deepseek.com");
  assert.strictEqual(T.capability("https://foo.api.deepseek.com/v1", "").dialectId, "deepseek");
  assert.strictEqual(T.capability("https://notdeepseek.com/v1", "").dialectId, "generic");
  assert.strictEqual(T.hostOf("not a url"), "");
});

test("labels are stable for the UI", () => {
  assert.strictEqual(T.labelFor("off"), "Off");
  assert.strictEqual(T.labelFor("low"), "Low");
  assert.strictEqual(T.labelFor("high"), "High");
  assert.strictEqual(T.labelFor("max"), "Max");
  assert.strictEqual(T.labelFor("default"), "Default");
});

console.log("agent-thinking.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
