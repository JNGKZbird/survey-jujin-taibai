"use strict";

const assert = require("assert");
require("../web/assets/agent/tools.js");
const TOOLS = global.JujinAgentTools;
assert.ok(TOOLS, "tools.js should expose JujinAgentTools");

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

function toolNames(mode) {
  return TOOLS.definitions(mode).map((def) => def.function.name);
}

console.log("agent-tools tests");

test("exports the protocol constants", () => {
  assert.strictEqual(TOOLS.MAX_CALLS_PER_ROUND, 4);
  assert.strictEqual(TOOLS.MAX_EDITS, 40);
  assert.strictEqual(TOOLS.MAX_RESULT_CHARS, 12000);
  assert.strictEqual(TOOLS.MAX_SEARCH_COUNT, 8);
  assert.strictEqual(TOOLS.DEFAULT_SEARCH_COUNT, 6);
  assert.strictEqual(TOOLS.MAX_SEARCH_RESULTS, 8);
  assert.strictEqual(TOOLS.MAX_SEARCHES_PER_ROUND, 2);
  assert.strictEqual(TOOLS.MAX_SEARCHES_PER_JOB, 6);
});

test("search definitions are opt-in and appended after the table tools", () => {
  assert.deepStrictEqual(toolNames("read"), ["survey_read_table"]);
  assert.deepStrictEqual(TOOLS.definitions("read", { search: true })
    .map((def) => def.function.name), ["survey_read_table", "web_search"]);
  assert.deepStrictEqual(TOOLS.definitions("manual", { search: true })
    .map((def) => def.function.name), [
    "survey_read_table", "survey_write_table", "survey_append_table_page", "web_search"
  ]);
  assert.deepStrictEqual(TOOLS.definitions("auto", { search: true })
    .map((def) => def.function.name), [
    "survey_read_table", "survey_write_table", "survey_append_table_page", "web_search"
  ]);
  assert.deepStrictEqual(TOOLS.definitions("chat", { search: true })
    .map((def) => def.function.name), ["web_search"]);
  assert.deepStrictEqual(TOOLS.definitions("unknown", { search: true }), []);
});

test("search schema is a strict one-argument query with a bounded count", () => {
  const search = TOOLS.definitions("read", { search: true })[1];
  assert.strictEqual(search.type, "function");
  assert.strictEqual(search.function.name, "web_search");
  const params = search.function.parameters;
  assert.strictEqual(params.type, "object");
  assert.strictEqual(params.additionalProperties, false);
  assert.deepStrictEqual(params.required, ["query"]);
  assert.deepStrictEqual(Object.keys(params.properties), ["query", "count"]);
  assert.strictEqual(params.properties.query.type, "string");
  assert.strictEqual(params.properties.query.minLength, 1);
  assert.strictEqual(params.properties.query.maxLength, 128);
  assert.strictEqual(params.properties.count.type, "integer");
  assert.strictEqual(params.properties.count.minimum, 1);
  assert.strictEqual(params.properties.count.maximum, 8);
});

test("definitions('read') exposes only survey_read_table", () => {
  const defs = TOOLS.definitions("read");
  assert.strictEqual(defs.length, 1);
  assert.strictEqual(defs[0].type, "function");
  assert.strictEqual(defs[0].function.name, "survey_read_table");
});

test("definitions('manual'/'auto') expose read, write and append in order", () => {
  ["manual", "auto"].forEach((mode) => {
    assert.deepStrictEqual(toolNames(mode), [
      "survey_read_table",
      "survey_write_table",
      "survey_append_table_page"
    ]);
  });
});

test("definitions returns no tools for chat without search, and none for unknown modes", () => {
  assert.deepStrictEqual(TOOLS.definitions("chat"), []);
  assert.deepStrictEqual(TOOLS.definitions("chat", { search: false }), []);
  assert.deepStrictEqual(TOOLS.definitions(undefined), []);
});

test("every definition is a strict OpenAI function schema", () => {
  TOOLS.definitions("auto").forEach((def) => {
    assert.strictEqual(def.type, "function");
    assert.strictEqual(typeof def.function.name, "string");
    assert.ok(def.function.description.length > 0);
    const params = def.function.parameters;
    assert.strictEqual(params.type, "object");
    assert.strictEqual(params.additionalProperties, false);
    assert.ok(Array.isArray(params.required));
    assert.strictEqual(typeof params.properties, "object");
    Object.keys(params.properties).forEach((key) => {
      assert.ok(params.required.indexOf(key) !== -1 || key === "page");
    });
  });
});

test("read schema requires table and limits page to 1+", () => {
  const params = TOOLS.definitions("read")[0].function.parameters;
  assert.deepStrictEqual(params.required, ["table"]);
  assert.deepStrictEqual(params.properties.table.enum, ["traverse", "leveling"]);
  assert.strictEqual(params.properties.page.type, "integer");
  assert.strictEqual(params.properties.page.minimum, 1);
});

test("write schema requires table/page/edits and caps edits at 40", () => {
  const params = TOOLS.definitions("manual")[1].function.parameters;
  assert.deepStrictEqual(params.required, ["table", "page", "edits"]);
  assert.strictEqual(params.properties.page.type, "integer");
  assert.strictEqual(params.properties.page.minimum, 1);
  const edits = params.properties.edits;
  assert.strictEqual(edits.type, "array");
  assert.strictEqual(edits.minItems, 1);
  assert.strictEqual(edits.maxItems, 40);
  assert.strictEqual(edits.items.type, "object");
  assert.strictEqual(edits.items.additionalProperties, false);
  assert.deepStrictEqual(edits.items.required, ["cell", "value"]);
  assert.strictEqual(edits.items.properties.cell.type, "string");
  assert.strictEqual(edits.items.properties.cell.minLength, 1);
  assert.strictEqual(edits.items.properties.value.type, "string");
});

test("append schema requires only table", () => {
  const params = TOOLS.definitions("auto")[2].function.parameters;
  assert.deepStrictEqual(params.required, ["table"]);
  assert.deepStrictEqual(Object.keys(params.properties), ["table"]);
  assert.deepStrictEqual(params.properties.table.enum, ["traverse", "leveling"]);
});

test("parseCall accepts a JSON string and preserves rawArguments byte for byte", () => {
  const raw = '{ "table" : "traverse", "page": 2 }';
  const out = TOOLS.parseCall({
    id: "call_a",
    type: "function",
    function: { name: "survey_read_table", arguments: raw }
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.id, "call_a");
  assert.strictEqual(out.name, "survey_read_table");
  assert.deepStrictEqual(out.args, { table: "traverse", page: 2 });
  assert.strictEqual(out.rawArguments, raw);
});

test("parseCall accepts an object and stringifies it", () => {
  const args = { table: "leveling", page: 1 };
  const out = TOOLS.parseCall({
    id: "call_b",
    function: { name: "survey_read_table", arguments: args }
  });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.args, args);
  assert.strictEqual(out.rawArguments, JSON.stringify(args));
});

test("parseCall defaults missing arguments to {}", () => {
  const out = TOOLS.parseCall({ id: "call_c", function: { name: "survey_read_table" } });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.args, {});
  assert.strictEqual(out.rawArguments, "{}");
});

test("parseCall keeps an empty id for normalizeCallIds to fill", () => {
  const out = TOOLS.parseCall({ function: { name: "survey_read_table", arguments: "{}" } });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.id, "");
});

test("parseCall rejects malformed JSON and keeps the original text", () => {
  const raw = '{"table":';
  const out = TOOLS.parseCall({
    id: "call_bad",
    function: { name: "survey_read_table", arguments: raw }
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.id, "call_bad");
  assert.strictEqual(out.name, "survey_read_table");
  assert.strictEqual(out.rawArguments, raw);
  assert.ok(/JSON/.test(out.error), "error should mention JSON: " + out.error);
});

test("parseCall rejects JSON values that are not plain objects", () => {
  ["[]", "null", '"text"', "3", "true"].forEach((raw) => {
    const out = TOOLS.parseCall({
      id: "x",
      function: { name: "survey_read_table", arguments: raw }
    });
    assert.strictEqual(out.ok, false, "should reject " + raw);
    assert.ok(out.error.length > 0);
    assert.strictEqual(out.rawArguments, raw);
  });
});

test("parseCall rejects a non-object arguments value passed directly", () => {
  const out = TOOLS.parseCall({
    id: "x",
    function: { name: "survey_read_table", arguments: ["traverse"] }
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.rawArguments, '["traverse"]');
});

test("normalizeCallIds fills empty ids with round-scoped ids", () => {
  const out = TOOLS.normalizeCallIds([{ id: "" }, { id: null }, { name: "x" }], 3);
  assert.deepStrictEqual(out.map((call) => call.id), [
    "call_3_0",
    "call_3_1",
    "call_3_2"
  ]);
});

test("normalizeCallIds keeps the first duplicate and renames later ones", () => {
  const out = TOOLS.normalizeCallIds([{ id: "dup" }, { id: "dup" }, { id: "" }], 1);
  assert.deepStrictEqual(out.map((call) => call.id), ["dup", "call_1_1", "call_1_2"]);
});

test("normalizeCallIds returns new objects and leaves inputs untouched", () => {
  const calls = [{ id: "", name: "survey_read_table" }];
  const before = JSON.parse(JSON.stringify(calls));
  const out = TOOLS.normalizeCallIds(calls, 1);
  assert.deepStrictEqual(calls, before);
  assert.notStrictEqual(out, calls);
  assert.notStrictEqual(out[0], calls[0]);
  assert.strictEqual(out[0].name, "survey_read_table");
});

test("normalizeCallIds stays unique when a generated id is already taken", () => {
  const out = TOOLS.normalizeCallIds([{ id: "call_2_1" }, { id: "" }], 2);
  assert.strictEqual(out[0].id, "call_2_1");
  assert.notStrictEqual(out[1].id, "call_2_1");
  assert.ok(out[1].id);
  assert.strictEqual(new Set(out.map((call) => call.id)).size, 2);
});

test("normalizeCallIds treats a non-array input as empty", () => {
  assert.deepStrictEqual(TOOLS.normalizeCallIds(null, 1), []);
});

test("validateReadArgs accepts a table and defaults page to null", () => {
  assert.deepStrictEqual(TOOLS.validateReadArgs({ table: "traverse" }), {
    ok: true,
    table: "traverse",
    page: null
  });
  assert.deepStrictEqual(TOOLS.validateReadArgs({ table: "leveling", page: 2 }), {
    ok: true,
    table: "leveling",
    page: 2
  });
});

test("validateReadArgs rejects unknown tables", () => {
  const out = TOOLS.validateReadArgs({ table: "sheet3" });
  assert.strictEqual(out.ok, false);
  assert.ok(out.error.indexOf("traverse") !== -1 && out.error.indexOf("leveling") !== -1);
});

test("validateReadArgs rejects page 0, negatives, fractions and strings", () => {
  [0, -1, 1.5, "1"].forEach((page) => {
    const out = TOOLS.validateReadArgs({ table: "traverse", page: page });
    assert.strictEqual(out.ok, false, "page " + page + " should be rejected");
    assert.ok(out.error.length > 0);
  });
});

test("validateReadArgs rejects non-object arguments", () => {
  [null, [], "traverse", 3].forEach((args) => {
    assert.strictEqual(TOOLS.validateReadArgs(args).ok, false);
  });
});

test("validateWriteArgs accepts edits and normalizes cell ids", () => {
  const out = TOOLS.validateWriteArgs({
    table: "traverse",
    page: 2,
    edits: [
      { cell: "s1-r1-h", value: "12°34′56″" },
      { cell: "meta-date", value: "" }
    ]
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.table, "traverse");
  assert.strictEqual(out.page, 2);
  assert.deepStrictEqual(out.edits, [
    { cell: "s1-r1-h", value: "12°34′56″" },
    { cell: "meta-date", value: "" }
  ]);
});

test("validateWriteArgs rejects a missing or invalid page", () => {
  const base = { table: "traverse", edits: [{ cell: "a", value: "1" }] };
  [undefined, null, 0, -2, 1.5, "1"].forEach((page) => {
    const args = Object.assign({}, base, page === undefined ? {} : { page: page });
    const out = TOOLS.validateWriteArgs(args);
    assert.strictEqual(out.ok, false, "page " + page + " should be rejected");
    assert.ok(/page|页码/.test(out.error));
  });
});

test("validateWriteArgs rejects empty and oversized edit lists", () => {
  const empty = TOOLS.validateWriteArgs({ table: "traverse", page: 1, edits: [] });
  assert.strictEqual(empty.ok, false);
  assert.ok(empty.error.indexOf("1") !== -1);

  const many = Array.from({ length: 41 }, (_, i) => ({ cell: "c" + i, value: "1" }));
  const over = TOOLS.validateWriteArgs({ table: "traverse", page: 1, edits: many });
  assert.strictEqual(over.ok, false);
  assert.ok(over.error.indexOf("40") !== -1);
});

test("validateWriteArgs rejects duplicate cells in one call", () => {
  const out = TOOLS.validateWriteArgs({
    table: "leveling",
    page: 1,
    edits: [{ cell: "s1-r1-back", value: "1" }, { cell: "s1-r1-back", value: "2" }]
  });
  assert.strictEqual(out.ok, false);
  assert.ok(out.error.indexOf("s1-r1-back") !== -1);
});

test("validateWriteArgs rejects empty cells and non-string values", () => {
  const emptyCell = TOOLS.validateWriteArgs({
    table: "traverse",
    page: 1,
    edits: [{ cell: "", value: "1" }]
  });
  assert.strictEqual(emptyCell.ok, false);

  const blankCell = TOOLS.validateWriteArgs({
    table: "traverse",
    page: 1,
    edits: [{ cell: "   ", value: "1" }]
  });
  assert.strictEqual(blankCell.ok, false);

  const numberValue = TOOLS.validateWriteArgs({
    table: "traverse",
    page: 1,
    edits: [{ cell: "s1-r1-h", value: 123 }]
  });
  assert.strictEqual(numberValue.ok, false);
  assert.ok(numberValue.error.indexOf("s1-r1-h") !== -1);
});

test("validateWriteArgs rejects non-array edits and non-object args", () => {
  assert.strictEqual(
    TOOLS.validateWriteArgs({ table: "traverse", page: 1, edits: "nope" }).ok,
    false
  );
  assert.strictEqual(
    TOOLS.validateWriteArgs({ table: "traverse", page: 1, edits: [null] }).ok,
    false
  );
  assert.strictEqual(TOOLS.validateWriteArgs(null).ok, false);
});

test("validateAppendArgs accepts both tables", () => {
  assert.deepStrictEqual(TOOLS.validateAppendArgs({ table: "traverse" }), {
    ok: true,
    table: "traverse"
  });
  assert.deepStrictEqual(TOOLS.validateAppendArgs({ table: "leveling" }), {
    ok: true,
    table: "leveling"
  });
});

test("validateAppendArgs rejects a missing or unknown table", () => {
  assert.strictEqual(TOOLS.validateAppendArgs({}).ok, false);
  assert.strictEqual(TOOLS.validateAppendArgs({ table: "traverse", extra: true }).ok, true);
  assert.strictEqual(TOOLS.validateAppendArgs({ table: "sheet3" }).ok, false);
});

test("labelFor maps the four tools and falls back to the raw name", () => {
  assert.strictEqual(TOOLS.labelFor("survey_read_table"), "读表");
  assert.strictEqual(TOOLS.labelFor("survey_write_table"), "写表");
  assert.strictEqual(TOOLS.labelFor("survey_append_table_page"), "加页");
  assert.strictEqual(TOOLS.labelFor("web_search"), "联网搜索");
  assert.strictEqual(TOOLS.labelFor("mystery_tool"), "mystery_tool");
});

test("isWriteTool flags write and append only", () => {
  assert.strictEqual(TOOLS.isWriteTool("survey_write_table"), true);
  assert.strictEqual(TOOLS.isWriteTool("survey_append_table_page"), true);
  assert.strictEqual(TOOLS.isWriteTool("survey_read_table"), false);
  assert.strictEqual(TOOLS.isWriteTool("mystery_tool"), false);
  assert.strictEqual(TOOLS.isWriteTool(undefined), false);
});

test("tableLabel maps the two tables and leaves unknown names blank", () => {
  assert.strictEqual(TOOLS.tableLabel("traverse"), "表一");
  assert.strictEqual(TOOLS.tableLabel("leveling"), "表二");
  assert.strictEqual(TOOLS.tableLabel("sheet3"), "");
});

test("validateSearchArgs trims, defaults count and enforces bounds", () => {
  assert.deepStrictEqual(TOOLS.validateSearchArgs({ query: "  测 量  " }), {
    ok: true, query: "测 量", count: 6
  });
  assert.deepStrictEqual(TOOLS.validateSearchArgs({ query: "x", count: 1 }), {
    ok: true, query: "x", count: 1
  });
  assert.deepStrictEqual(TOOLS.validateSearchArgs({ query: "x", count: 8 }), {
    ok: true, query: "x", count: 8
  });
  assert.strictEqual(TOOLS.validateSearchArgs({}).ok, false);
  assert.strictEqual(TOOLS.validateSearchArgs({ query: "   " }).ok, false);
  assert.strictEqual(TOOLS.validateSearchArgs({ query: "x".repeat(129) }).ok, false);
  assert.strictEqual(TOOLS.validateSearchArgs({ query: "x".repeat(128) }).ok, true);
  [0, 9, 1.5, "3"].forEach((count) => {
    assert.strictEqual(TOOLS.validateSearchArgs({ query: "x", count: count }).ok, false,
      "count " + count + " should be rejected");
  });
  assert.strictEqual(TOOLS.validateSearchArgs(null).ok, false);
});

test("searchSources keeps only safe public source metadata", () => {
  const out = TOOLS.searchSources({
    ok: true,
    results: [
      {
        title: "  A \n title ",
        url: "https://www.example.com/a#frag",
        site: "spoofed.example",
        date: "2026-11-01",
        summary: "must not persist"
      },
      { title: "dup", url: "https://www.example.com/a#other" },
      { title: "bad scheme", url: "javascript:alert(1)" },
      { title: "private", url: "http://127.0.0.1/secret" },
      { title: "userinfo", url: "https://user:pass@example.com/" },
      { title: "", url: "https://b.example.com/x" }
    ]
  });
  assert.deepStrictEqual(out, [
    { title: "A title", url: "https://www.example.com/a", site: "example.com", date: "2026-11-01" },
    { title: "b.example.com", url: "https://b.example.com/x", site: "b.example.com" }
  ]);
  assert.strictEqual(out[0].summary, undefined);
  assert.strictEqual(out[0].site, "example.com");
  assert.deepStrictEqual(TOOLS.searchSources({ ok: false, code: "network" }), []);
});

test("searchSources caps results at eight", () => {
  const results = Array.from({ length: 12 }, (_, i) => ({
    title: "t" + i,
    url: "https://example.com/" + i
  }));
  assert.strictEqual(TOOLS.searchSources({ ok: true, results: results }).length, 8);
});

test("formatSearchResult marks untrusted content and handles empty results", () => {
  const empty = JSON.parse(TOOLS.formatSearchResult({ ok: true, query: "q", results: [] }));
  assert.strictEqual(empty.ok, true);
  assert.deepStrictEqual(empty.results, []);
  assert.strictEqual(empty.note, "没有找到结果。");
  assert.ok(empty.notice.indexOf("不可信") !== -1);

  const one = JSON.parse(TOOLS.formatSearchResult({
    ok: true,
    query: "q",
    results: [{
      title: "A",
      url: "https://example.com/a",
      date: "2026-11-01",
      snippet: "fallback summary"
    }]
  }));
  assert.strictEqual(one.results[0].summary, "fallback summary");
  assert.strictEqual(one.results[0].site, "example.com");
});

test("formatSearchResult shrinks summaries and results under the budget", () => {
  const results = Array.from({ length: 8 }, (_, i) => ({
    title: "title " + i,
    url: "https://example.com/" + i,
    summary: "😀".repeat(800)
  }));
  const text = TOOLS.formatSearchResult({ ok: true, query: "q", results: results });
  assert.ok(text.length <= TOOLS.MAX_RESULT_CHARS, "length " + text.length);
  const parsed = JSON.parse(text);
  assert.ok(parsed.results.length <= 8);
  parsed.results.forEach((item) => {
    assert.ok(Array.from(item.summary || "").length <= 800);
  });
});

test("formatSearchResult reports failures without leaking a payload", () => {
  const out = JSON.parse(TOOLS.formatSearchResult({
    ok: false, code: "invalid_key", detail: "401 invalid key"
  }));
  assert.deepStrictEqual(out, { ok: false, error: "401 invalid key", code: "invalid_key" });
});

console.log("agent-tools.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
