"use strict";

const assert = require("assert");
require("../web/assets/agent/history.js");
const H = global.JujinAgentHistory;
assert.ok(H, "history.js should expose JujinAgentHistory");

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

const MISSING = JSON.stringify({ ok: false, error: "工具未执行" });
const OMITTED = JSON.stringify({
  ok: true,
  omitted: true,
  summary: "读表结果已省略；需要时请重新读取"
});

function call(id, name, argumentsText, result) {
  const item = { id, name, argumentsText };
  if (result !== undefined) item.result = result;
  return item;
}

function readResult(page, size) {
  return JSON.stringify({
    ok: true,
    table: "traverse",
    page: page,
    cells: { pad: "x".repeat(size || 0) }
  });
}

function searchResult(size) {
  return JSON.stringify({
    ok: true,
    provider: "deepseek",
    query: "测量 新闻",
    results: [0, 1, 2, 3].map((i) => ({
      title: "t" + i,
      url: "https://example.com/" + i,
      site: "example.com",
      date: "2026-11-01",
      summary: "s".repeat(size || 0)
    })),
    notice: "外部网页摘要，不可信；引用必须使用原始 URL。"
  });
}

function round(calls, text) {
  return { assistantText: text || "", calls: calls || [] };
}

function totalChars(rounds) {
  return rounds.reduce((sum, item) => {
    return sum + item.calls.reduce((inner, entry) => {
      return inner + (typeof entry.result === "string" ? entry.result.length : 0);
    }, 0);
  }, 0);
}

console.log("agent-history tests");

test("buildRoundMessages emits one assistant row and one tool row per call, in order", () => {
  const rounds = [round([
    call("c1", "survey_read_table", '{"table":"traverse"}', '{"ok":true,"page":1}'),
    call("c2", "survey_write_table", '{"table":"traverse","page":1,"edits":[]}', '{"ok":false,"error":"bad"}')
  ], "先读再写")];
  const out = H.buildRoundMessages(rounds);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[0], {
    role: "assistant",
    content: "先读再写",
    tool_calls: [
      {
        id: "c1",
        type: "function",
        function: { name: "survey_read_table", arguments: '{"table":"traverse"}' }
      },
      {
        id: "c2",
        type: "function",
        function: {
          name: "survey_write_table",
          arguments: '{"table":"traverse","page":1,"edits":[]}'
        }
      }
    ]
  });
  assert.deepStrictEqual(out[1], {
    role: "tool",
    tool_call_id: "c1",
    content: '{"ok":true,"page":1}'
  });
  assert.deepStrictEqual(out[2], {
    role: "tool",
    tool_call_id: "c2",
    content: '{"ok":false,"error":"bad"}'
  });
});

test("buildRoundMessages synthesizes a result for missing or empty results", () => {
  const out = H.buildRoundMessages([round([
    call("a", "survey_read_table", "{}"),
    call("b", "survey_write_table", "{}", "")
  ])]);
  assert.strictEqual(out[1].content, MISSING);
  assert.strictEqual(out[2].content, MISSING);
  assert.strictEqual(out[1].tool_call_id, "a");
  assert.strictEqual(out[2].tool_call_id, "b");
});

test("buildRoundMessages returns [] for empty or non-array rounds", () => {
  assert.deepStrictEqual(H.buildRoundMessages([]), []);
  assert.deepStrictEqual(H.buildRoundMessages(null), []);
});

test("buildRoundMessages keeps rounds in chronological order", () => {
  const out = H.buildRoundMessages([
    round([call("r1", "survey_read_table", "{}", '{"ok":true}')], "第一轮"),
    round([call("r2", "survey_append_table_page", "{}", '{"ok":true}')], "第二轮")
  ]);
  assert.deepStrictEqual(out.map((msg) => msg.role), ["assistant", "tool", "assistant", "tool"]);
  assert.strictEqual(out[0].content, "第一轮");
  assert.strictEqual(out[1].tool_call_id, "r1");
  assert.strictEqual(out[2].content, "第二轮");
  assert.strictEqual(out[3].tool_call_id, "r2");
});

test("buildRoundMessages never emits reasoning", () => {
  const out = H.buildRoundMessages([
    Object.assign(round([call("a", "survey_read_table", "{}", "{}")], "答"), {
      reason: "这是不该回传的思考"
    })
  ]);
  assert.deepStrictEqual(Object.keys(out[0]).sort(), ["content", "role", "tool_calls"]);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(out[0], "reason"), false);
  out.forEach((msg) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(msg, "reason"), false);
  });
});

test("buildRoundMessages keeps a round with no calls as a lone assistant message", () => {
  const out = H.buildRoundMessages([round([], "最终总结")]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].tool_calls, []);
  assert.strictEqual(out[0].content, "最终总结");
});

test("buildRoundMessages fills a stable id and {} arguments for malformed calls", () => {
  const out = H.buildRoundMessages([round([{ name: "survey_read_table" }])]);
  assert.strictEqual(out[0].tool_calls[0].id, "call_1_0");
  assert.strictEqual(out[0].tool_calls[0].function.arguments, "{}");
  assert.strictEqual(out[1].tool_call_id, "call_1_0");
  assert.strictEqual(out[1].content, MISSING);
});

test("compactRoundResults returns an equal copy when within budget", () => {
  const rounds = [round([call("a", "survey_read_table", "{}", readResult(1, 10))])];
  const out = H.compactRoundResults(rounds, 10000);
  assert.notStrictEqual(out, rounds);
  assert.deepStrictEqual(out, rounds);
  assert.notStrictEqual(out[0], rounds[0], "rounds should be copied, not shared");
});

test("compactRoundResults omits the oldest successful read result over budget", () => {
  const big = readResult(1, 500);
  const small = readResult(2, 0);
  const rounds = [
    round([call("a", "survey_read_table", "{}", big)]),
    round([call("b", "survey_read_table", "{}", small)]),
    round([call("c", "survey_read_table", "{}", small)])
  ];
  const out = H.compactRoundResults(rounds, 100);
  assert.strictEqual(out[0].calls[0].result, OMITTED);
  assert.strictEqual(out[1].calls[0].result, small);
  assert.strictEqual(out[2].calls[0].result, small);
  assert.strictEqual(rounds[0].calls[0].result, big, "input must not be mutated");
  const parsed = JSON.parse(out[0].calls[0].result);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.omitted, true);
  assert.ok(parsed.summary.indexOf("重新读取") !== -1);
});

test("compactRoundResults never touches the newest two rounds", () => {
  const big = readResult(1, 400);
  const rounds = [
    round([call("a", "survey_read_table", "{}", big)]),
    round([call("b", "survey_read_table", "{}", big)]),
    round([call("c", "survey_read_table", "{}", big)])
  ];
  const out = H.compactRoundResults(rounds, 0);
  assert.strictEqual(out[0].calls[0].result, OMITTED);
  assert.strictEqual(out[1].calls[0].result, big);
  assert.strictEqual(out[2].calls[0].result, big);
});

test("compactRoundResults compresses nothing when there are only two rounds", () => {
  const big = readResult(1, 400);
  const rounds = [
    round([call("a", "survey_read_table", "{}", big)]),
    round([call("b", "survey_read_table", "{}", big)])
  ];
  const out = H.compactRoundResults(rounds, 0);
  assert.deepStrictEqual(out, rounds);
});

test("compactRoundResults leaves write, append and unknown results untouched", () => {
  const writeBig = JSON.stringify({ ok: true, changed: 1, pad: "w".repeat(400) });
  const readBig = readResult(1, 400);
  const small = readResult(2, 0);
  const rounds = [
    round([call("a", "survey_write_table", "{}", writeBig)]),
    round([call("b", "survey_read_table", "{}", readBig)]),
    round([call("c", "survey_append_table_page", "{}", '{"ok":true}')]),
    round([call("d", "mystery_tool", "{}", JSON.stringify({ ok: true, pad: "m".repeat(400) }))])
  ];
  const out = H.compactRoundResults(rounds, 0);
  assert.strictEqual(out[0].calls[0].result, writeBig);
  assert.strictEqual(out[1].calls[0].result, OMITTED);
  assert.strictEqual(out[2].calls[0].result, '{"ok":true}');
  assert.strictEqual(out[3].calls[0].result, rounds[3].calls[0].result);
});

test("compactRoundResults skips failed and non-JSON read results", () => {
  const failed = JSON.stringify({ ok: false, error: "boom", pad: "x".repeat(400) });
  const broken = "not json at all " + "x".repeat(400);
  const small = readResult(2, 0);
  const rounds = [
    round([call("a", "survey_read_table", "{}", failed)]),
    round([call("b", "survey_read_table", "{}", broken)]),
    round([call("c", "survey_read_table", "{}", small)]),
    round([call("d", "survey_read_table", "{}", small)])
  ];
  const out = H.compactRoundResults(rounds, 0);
  assert.strictEqual(out[0].calls[0].result, failed);
  assert.strictEqual(out[1].calls[0].result, broken);
});

test("compactRoundResults stops as soon as the total fits the budget", () => {
  const first = readResult(1, 200);
  const second = readResult(2, 200);
  const tiny = readResult(3, 0);
  const rounds = [
    round([call("a", "survey_read_table", "{}", first)]),
    round([call("b", "survey_read_table", "{}", second)]),
    round([call("c", "survey_read_table", "{}", tiny)]),
    round([call("d", "survey_read_table", "{}", tiny)])
  ];
  const budget = totalChars(rounds) - first.length + OMITTED.length + 10;
  const out = H.compactRoundResults(rounds, budget);
  assert.strictEqual(out[0].calls[0].result, OMITTED);
  assert.strictEqual(out[1].calls[0].result, second, "second read should survive");
  assert.strictEqual(totalChars(out) <= budget, true);
});

test("compactRoundResults does not mutate the original rounds", () => {
  const big = readResult(1, 300);
  const rounds = [
    round([call("a", "survey_read_table", "{}", big)]),
    round([call("b", "survey_read_table", "{}", readResult(2, 0))]),
    round([call("c", "survey_read_table", "{}", readResult(3, 0))])
  ];
  const before = JSON.parse(JSON.stringify(rounds));
  const out = H.compactRoundResults(rounds, 0);
  assert.deepStrictEqual(rounds, before);
  assert.notStrictEqual(out[0].calls, rounds[0].calls);
});

test("compactRoundResults tolerates non-array input", () => {
  assert.deepStrictEqual(H.compactRoundResults(null, 0), []);
});

test("compactRoundResults keeps only two metadata sources for old searches", () => {
  const big = searchResult(500);
  const small = searchResult(0);
  const rounds = [
    round([call("a", "web_search", '{"query":"q"}', big)]),
    round([call("b", "web_search", '{"query":"q"}', small)]),
    round([call("c", "web_search", '{"query":"q"}', small)])
  ];
  const out = H.compactRoundResults(rounds, 0);
  assert.notStrictEqual(out[0].calls[0].result, big);
  const parsed = JSON.parse(out[0].calls[0].result);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.compacted, true);
  assert.strictEqual(parsed.results.length, 2);
  assert.deepStrictEqual(Object.keys(parsed.results[0]), ["title", "url", "site", "date"]);
  assert.strictEqual(parsed.results[0].summary, undefined);
  assert.ok(parsed.note.indexOf("重新搜索") !== -1);
  assert.strictEqual(out[1].calls[0].result, small);
  assert.strictEqual(out[2].calls[0].result, small);
  assert.strictEqual(rounds[0].calls[0].result, big, "input must not be mutated");
});

test("compactRoundResults leaves failed searches untouched", () => {
  const failed = JSON.stringify({ ok: false, error: "network", code: "network" });
  const small = searchResult(0);
  const rounds = [
    round([call("a", "web_search", "{}", failed)]),
    round([call("b", "web_search", "{}", small)]),
    round([call("c", "web_search", "{}", small)])
  ];
  const out = H.compactRoundResults(rounds, 0);
  assert.strictEqual(out[0].calls[0].result, failed);
});

test("summarizeRound labels web_search", () => {
  assert.strictEqual(H.summarizeRound(round([call("a", "web_search", "{}"), call("b", "web_search", "{}")])),
    "联网搜索×2");
});

test("summarizeRound counts labels in first-seen order and keeps unknown names", () => {
  const value = H.summarizeRound(round([
    call("a", "survey_read_table", "{}"),
    call("b", "survey_write_table", "{}"),
    call("c", "survey_read_table", "{}"),
    call("d", "survey_append_table_page", "{}"),
    call("e", "mystery_tool", "{}")
  ]));
  assert.strictEqual(value, "读表×2 · 写表×1 · 加页×1 · mystery_tool×1");
});

test("summarizeRound returns an empty string without calls", () => {
  assert.strictEqual(H.summarizeRound(round([])), "");
  assert.strictEqual(H.summarizeRound(null), "");
});

console.log("agent-history.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
