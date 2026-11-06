"use strict";

const assert = require("assert");

let channel = null;
let calls = [];
let streamMode = "pending";
let pendingResolve = null;

function installPlatform(options) {
  const o = options || {};
  calls = [];
  streamMode = o.mode || "pending";
  pendingResolve = null;
  channel = null;
  global.__TAURI__ = {
    core: {
      Channel: class FakeChannel {
        constructor() { channel = this; }
      }
    }
  };
  global.JujinPlatform = {
    isDesktop: () => o.desktop !== false,
    nativeReady: () => true,
    call(command, args) {
      calls.push({ command: command, args: args });
      if (command === "agent_stream") {
        if (streamMode === "reject") return Promise.reject(new Error("boom"));
        return new Promise((resolve) => { pendingResolve = resolve; });
      }
      if (command === "agent_cancel") return Promise.resolve({ ok: true });
      return Promise.resolve({ command: command });
    }
  };
}

require("../web/assets/agent/llm.js");
const L = global.JujinAgentLLM;
assert.ok(L, "llm.js should expose JujinAgentLLM");

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

function handlers(record) {
  const r = record || {};
  return {
    onDelta: (text) => (r.delta = (r.delta || "") + text),
    onReasoning: (text) => (r.reasoning = (r.reasoning || "") + text),
    onToolCalls: (calls) => (r.tools = calls),
    onUsage: (usage) => (r.usage = usage),
    onDone: (info) => (r.done = info),
    onError: (error) => (r.error = error)
  };
}

test("baseRequest uses camelCase, drops invalid messages and empty tools", () => {
  installPlatform();
  const ctrl = L.startStream({
    providerId: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    messages: [
      { role: "user", content: "hi" },
      { role: 42, content: "bad" },
      null
    ],
    temperature: undefined,
    maxTokens: 0.4,
    thinking: null,
    tools: [],
    toolChoice: null
  }, {});
  assert.ok(ctrl.requestId.indexOf("req_") === 0);
  const request = calls[0].args.request;
  assert.strictEqual(calls[0].command, "agent_stream");
  assert.strictEqual(request.providerId, "deepseek");
  assert.strictEqual(request.baseUrl, "https://api.deepseek.com/v1");
  assert.strictEqual(request.model, "deepseek-flash");
  assert.strictEqual(request.temperature, 1.0);
  assert.strictEqual(request.maxTokens, 1);
  assert.deepStrictEqual(request.messages, [{ role: "user", content: "hi" }]);
  assert.strictEqual(request.thinking, null);
  assert.strictEqual(request.tools, null);
  assert.strictEqual(request.toolChoice, null);
  assert.strictEqual(request.requestId, ctrl.requestId);
  pendingResolve({ ok: true });
  return ctrl.promise;
});

test("omitted maxTokens defaults to deepseek-flash's 384K output ceiling", async () => {
  installPlatform();
  assert.strictEqual(L.maxOutputTokens, 393216);
  const ctrl = L.startStream({ messages: [{ role: "user", content: "x" }] }, {});
  const request = calls[0].args.request;
  assert.strictEqual(request.maxTokens, 393216);
  pendingResolve({ ok: true });
  await ctrl.promise;
});

test("stream events dispatch in order and done carries aborted/toolsDropped/finishReason", async () => {
  installPlatform();
  const record = {};
  const ctrl = L.startStream({ messages: [{ role: "user", content: "x" }] }, handlers(record));
  channel.onmessage({ type: "delta", text: "你" });
  channel.onmessage({ type: "delta", text: "好" });
  channel.onmessage({ type: "reasoning", text: "想" });
  const toolCalls = [{ id: "c1", type: "function", function: { name: "survey_read_table", arguments: "{}" } }];
  channel.onmessage({ type: "tool_calls", calls: toolCalls });
  channel.onmessage({ type: "usage", promptTokens: 10, completionTokens: 2 });
  channel.onmessage({ type: "done", aborted: true, toolsDropped: true, finishReason: "length" });
  pendingResolve({ ok: true });
  const result = await ctrl.promise;
  assert.strictEqual(record.delta, "你好");
  assert.strictEqual(record.reasoning, "想");
  assert.deepStrictEqual(record.tools, toolCalls);
  assert.deepStrictEqual(record.usage, { type: "usage", promptTokens: 10, completionTokens: 2 });
  assert.deepStrictEqual(record.done, {
    requestId: ctrl.requestId, aborted: true, toolsDropped: true, finishReason: "length"
  });
  assert.deepStrictEqual(result, record.done);
});

test("event error reports once and never calls onDone", async () => {
  installPlatform();
  const record = {};
  const ctrl = L.startStream({ messages: [] }, handlers(record));
  channel.onmessage({ type: "error", code: "invalid_key", detail: "401" });
  channel.onmessage({ type: "done" });
  pendingResolve({ ok: true });
  await ctrl.promise;
  assert.deepStrictEqual(record.error, { code: "invalid_key", detail: "401" });
  assert.strictEqual(record.done, undefined);
});

test("invoke failure settles as invoke_failed and resolves the error object", async () => {
  installPlatform({ mode: "reject" });
  const record = {};
  const ctrl = L.startStream({ messages: [] }, handlers(record));
  const result = await ctrl.promise;
  assert.strictEqual(record.error.code, "invoke_failed");
  assert.ok(record.error.detail.indexOf("boom") !== -1);
  assert.strictEqual(record.done, undefined);
  assert.strictEqual(result.code, "invoke_failed");
});

test("cancel invokes agent_cancel once with the request id", async () => {
  installPlatform();
  const ctrl = L.startStream({ messages: [] }, {});
  const first = await ctrl.cancel();
  assert.deepStrictEqual(first, { ok: true });
  assert.strictEqual(calls.filter((one) => one.command === "agent_cancel").length, 1);
  assert.strictEqual(calls.filter((one) => one.command === "agent_cancel")[0].args.requestId, ctrl.requestId);
  assert.strictEqual(await ctrl.cancel(), false);
  channel.onmessage({ type: "done" });
  pendingResolve({ ok: true });
  await ctrl.promise;
  assert.strictEqual(await ctrl.cancel(), false);
});

test("missing desktop channel reports not_desktop without invoking Rust", async () => {
  delete global.__TAURI__;
  global.JujinPlatform = { isDesktop: () => false, nativeReady: () => false, call: () => Promise.reject(new Error("no")) };
  const record = {};
  const ctrl = L.startStream({ messages: [] }, handlers(record));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepStrictEqual(record.error, { code: "not_desktop", detail: "AI 助手需要桌面版。" });
  assert.deepStrictEqual(await ctrl.promise, record.error);
  assert.strictEqual(await ctrl.cancel(), false);
});

test("complete, listModels and key commands keep the expected payloads", async () => {
  installPlatform();
  await L.complete({ messages: [{ role: "user", content: "x" }], temperature: 0 });
  assert.strictEqual(calls[calls.length - 1].command, "agent_complete");
  assert.strictEqual(calls[calls.length - 1].args.request.temperature, 0);
  await L.listModels({ providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1" });
  assert.deepStrictEqual(calls[calls.length - 1].args, {
    providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1"
  });
  await L.keyHas("deepseek", "agent");
  assert.deepStrictEqual(calls[calls.length - 1].args, { providerId: "deepseek", scope: "agent" });
  await L.keySet("deepseek", "sk-x", "agent");
  assert.deepStrictEqual(calls[calls.length - 1].args, { providerId: "deepseek", key: "sk-x", scope: "agent" });
  await L.keyClear("deepseek");
  assert.deepStrictEqual(calls[calls.length - 1].args, { providerId: "deepseek", scope: null });
  await L.openUrl("https://example.com");
  assert.deepStrictEqual(calls[calls.length - 1].args, { url: "https://example.com" });
});

test("webSearch invokes agent_web_search with query and optional count", async () => {
  installPlatform();
  const result = await L.webSearch({ query: "测量 新闻", count: 6 });
  assert.strictEqual(calls[calls.length - 1].command, "agent_web_search");
  assert.deepStrictEqual(calls[calls.length - 1].args, { query: "测量 新闻", count: 6 });
  assert.deepStrictEqual(result, { command: "agent_web_search" });
  await L.webSearch({ query: "只有搜索词" });
  assert.deepStrictEqual(calls[calls.length - 1].args, { query: "只有搜索词" });
});

test("webSearch normalizes transport failures and empty responses", async () => {
  global.JujinPlatform = {
    isDesktop: () => true,
    nativeReady: () => true,
    call: () => Promise.reject(new Error("ipc down"))
  };
  const failed = await L.webSearch({ query: "q" });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.code, "invoke_failed");
  assert.ok(failed.detail.indexOf("ipc down") !== -1);

  global.JujinPlatform = {
    isDesktop: () => true,
    nativeReady: () => true,
    call: () => Promise.resolve(null)
  };
  const empty = await L.webSearch({ query: "q" });
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.code, "bad_response");
});

test("searchErrorHint explains every search-side failure code", () => {
  assert.ok(L.searchErrorHint("no_key").indexOf("设置 → 模型") !== -1);
  assert.ok(L.searchErrorHint("credential_error").indexOf("凭据管理器") !== -1);
  assert.ok(L.searchErrorHint("invalid_key").indexOf("401") !== -1);
  assert.ok(L.searchErrorHint("insufficient_balance").indexOf("余额不足") !== -1);
  assert.ok(L.searchErrorHint("forbidden").indexOf("403") !== -1);
  assert.ok(L.searchErrorHint("not_found").indexOf("DeepSeek 官方地址") !== -1);
  assert.ok(L.searchErrorHint("timeout").indexOf("60 秒") !== -1);
  assert.ok(L.searchErrorHint("rate_limited").indexOf("429") !== -1);
  assert.ok(L.searchErrorHint("server_error").indexOf("暂时不可用") !== -1);
  assert.ok(L.searchErrorHint("network").indexOf("网络") !== -1);
  assert.ok(L.searchErrorHint("bad_response").indexOf("无法解析") !== -1);
  assert.ok(L.searchErrorHint("bad_request").indexOf("搜索词") !== -1);
  assert.ok(L.searchErrorHint("invoke_failed").indexOf("桌面通信") !== -1);
  assert.ok(L.searchErrorHint("mystery").indexOf("mystery") !== -1);
});

test("usageText and errorHint surface image-related 400 and 413 hints", () => {
  assert.strictEqual(L.usageText({ promptTokens: 10, completionTokens: 2, cacheHitTokens: 4 }),
    "输入 10 · 输出 2 · 缓存命中 4");
  assert.strictEqual(L.usageText(null), "");
  assert.ok(L.errorHint("too_large").indexOf("图片太多或太大") !== -1);
  assert.ok(L.errorHint("bad_request", "image not supported").indexOf("不支持图片") !== -1);
  assert.ok(L.errorHint("insufficient_balance").indexOf("余额不足") !== -1);
});

(async function main() {
  console.log("agent-llm tests");
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed += 1;
      console.log("  ok  " + name);
    } catch (err) {
      console.error("FAIL  " + name);
      console.error(err.stack || err);
      process.exitCode = 1;
    }
  }
  console.log("agent-llm.js: " + passed + " passed");
  if (process.exitCode) process.exit(process.exitCode);
})();
