"use strict";

const assert = require("assert");
const T = require("../web/assets/transfer.js");

function blankPage(key) {
  return { meta: {}, stations: [], marker: key + "-blank" };
}

function makeDefaultState() {
  return {
    version: 1,
    settings: {
      traverse: { mode: "VA", c2Limit: 60, indexLimit: 60, halfDiffLimit: 20 },
      leveling: { grade: "IV" },
      angle: { limit: 40, font: "harmony" },
      traverseSummary: {},
      levelingSummary: { legPages: 1 },
      trigSummary: { sideLimit: 60, closureLimit: 40 },
      traverseCalc: { angleDir: "cw", fBetaCoef: 40, kDen: 4000 }
    },
    pages: {
      traverse: [blankPage("traverse")],
      leveling: [blankPage("leveling")],
      angle: [blankPage("angle")],
      traverseSummary: [blankPage("traverseSummary")],
      levelingSummary: [blankPage("levelingSummary")],
      trigSummary: [blankPage("trigSummary")],
      traverseCalc: [blankPage("traverseCalc")]
    },
    ui: {
      active: "traverse",
      pageIndex: { traverse: 0, leveling: 0, angle: 0, traverseSummary: 0, levelingSummary: 0, trigSummary: 0, traverseCalc: 0 },
      zoom: { traverse: "page", leveling: "page", angle: "page", traverseSummary: "page", levelingSummary: "page", trigSummary: "page", traverseCalc: "page" },
      scale: { traverse: 100, leveling: 100, angle: 100, traverseSummary: 100, levelingSummary: 100, trigSummary: 100, traverseCalc: 100 }
    }
  };
}

function sourceState() {
  const state = makeDefaultState();
  state.pages.traverse = [{ meta: { group: "A" }, stations: [{ name: "S1" }] }];
  state.pages.leveling = [{ meta: { weather: "晴" }, stations: [{ stationNo: "1" }] }];
  state.pages.angle = [{ meta: { date: "2026-10-28" }, stations: [{ station: "A" }] }];
  state.pages.traverseSummary = [{ meta: { year: "2026" }, marker: "summary-D" }];
  state.pages.levelingSummary = [{ meta: { leader: "甲" }, names: ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"] }];
  state.settings.traverse = { mode: "ZA", c2Limit: 30, indexLimit: 40, halfDiffLimit: 10 };
  state.settings.levelingSummary = { legPages: 2 };
  state.pages.trigSummary = [{ meta: { "start-elev": "603.363" }, remark: "环 1 附合到 P 点" }];
  state.settings.trigSummary = { sideLimit: 60, closureLimit: 30 };
  state.pages.traverseCalc = [{
    meta: { calc: "张三" },
    source: { capturedAt: FIXED_TIME, sourceCount: 4, overflow: 0, heightCount: 3 },
    rows: [{ id: "A", ang: "90.0000", len: "10.000", h: "", x: "0.000", y: "0.000", az: "90.0000" }]
  }];
  state.settings.traverseCalc = { angleDir: "ccw", fBetaCoef: 60, kDen: 2000 };
  return state;
}

const FIXED_TIME = "2026-10-28T12:00:00.000Z";

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

console.log("transfer.js tests");

test("detect rejects non-object input", () => {
  assert.strictEqual(T.detect(null).kind, "unknown");
  assert.strictEqual(T.detect("text").kind, "unknown");
  assert.strictEqual(T.detect([]).kind, "unknown");
  assert.strictEqual(T.detect(42).kind, "unknown");
});

test("detect treats the old v1 envelope as a project", () => {
  const info = T.detect({
    app: "survey-sheets-formal",
    version: 1,
    exportedAt: FIXED_TIME,
    data: makeDefaultState()
  });
  assert.strictEqual(info.kind, "project");
});

test("detect treats a bare v1 state as a project", () => {
  assert.strictEqual(T.detect(makeDefaultState()).kind, "project");
});

test("detect treats schemaVersion 2 as all projects", () => {
  assert.strictEqual(T.detect({ schemaVersion: 2, projects: [] }).kind, "all-projects");
  assert.strictEqual(T.detect({ schemaVersion: "2", projects: [] }).kind, "all-projects");
});

test("detect rejects a higher schemaVersion", () => {
  assert.deepStrictEqual(T.detect({ schemaVersion: 3 }), { kind: "future", version: 3 });
  assert.deepStrictEqual(T.detect({ schemaVersion: "4" }), { kind: "future", version: 4 });
});

test("schemaVersion is checked before kind", () => {
  const info = T.detect({
    schemaVersion: 2,
    kind: "table",
    formatVersion: 1,
    table: "traverse",
    state: makeDefaultState()
  });
  assert.strictEqual(info.kind, "all-projects");
});

test("detect recognizes each single-table key", () => {
  for (const table of ["traverse", "leveling", "angle", "traverseSummary", "levelingSummary", "trigSummary", "traverseCalc"]) {
    const info = T.detect({
      app: "survey-jujin",
      kind: "table",
      formatVersion: 1,
      table,
      state: makeDefaultState()
    });
    assert.deepStrictEqual(info, { kind: "table", table });
  }
});

test("detect accepts formatVersion as a numeric string", () => {
  const info = T.detect({
    kind: "table",
    formatVersion: "1",
    table: "leveling",
    state: makeDefaultState()
  });
  assert.strictEqual(info.kind, "table");
});

test("detect rejects a higher single-table formatVersion", () => {
  assert.deepStrictEqual(
    T.detect({ kind: "table", formatVersion: 2, table: "traverse", state: {} }),
    { kind: "future-table", version: 2 }
  );
});

test("detect rejects a missing or invalid formatVersion", () => {
  assert.strictEqual(T.detect({ kind: "table", table: "traverse", state: {} }).kind, "bad-table");
  assert.strictEqual(
    T.detect({ kind: "table", formatVersion: 0, table: "traverse", state: {} }).kind,
    "bad-table"
  );
});

test("detect rejects an unknown table name", () => {
  const info = T.detect({
    kind: "table",
    formatVersion: 1,
    table: "Traverse",
    state: makeDefaultState()
  });
  assert.strictEqual(info.kind, "bad-table");
  assert.ok(/表名/.test(info.reason));
});

test("detect rejects a non-object state", () => {
  for (const state of [null, [], "x", 1]) {
    const info = T.detect({ kind: "table", formatVersion: 1, table: "traverse", state });
    assert.strictEqual(info.kind, "bad-table");
    assert.ok(/state/.test(info.reason));
  }
});

test("detect rejects an unknown kind instead of treating it as v1", () => {
  const info = T.detect({ kind: "workbook", version: 1, data: makeDefaultState() });
  assert.strictEqual(info.kind, "unknown-kind");
  assert.strictEqual(info.value, "workbook");
});

test("buildTablePayload writes the envelope fields", () => {
  const payload = T.buildTablePayload(sourceState(), "traverse", makeDefaultState, FIXED_TIME);
  assert.strictEqual(payload.app, "survey-jujin");
  assert.strictEqual(payload.kind, "table");
  assert.strictEqual(payload.formatVersion, 1);
  assert.strictEqual(payload.table, "traverse");
  assert.strictEqual(payload.exportedAt, FIXED_TIME);
  assert.ok(payload.state && typeof payload.state === "object");
});

test("buildTablePayload keeps the table file out of the old v1 envelope", () => {
  const payload = T.buildTablePayload(sourceState(), "traverse", makeDefaultState, FIXED_TIME);
  assert.strictEqual(payload.version, undefined);
  assert.strictEqual(payload.data, undefined);
  assert.strictEqual(payload.schemaVersion, undefined);
});

test("buildTablePayload copies only the target table's pages and settings", () => {
  const source = sourceState();
  const payload = T.buildTablePayload(source, "leveling", makeDefaultState, FIXED_TIME);
  const blank = makeDefaultState();

  assert.deepStrictEqual(payload.state.pages.leveling, source.pages.leveling);
  assert.deepStrictEqual(payload.state.settings.leveling, source.settings.leveling);
  assert.deepStrictEqual(payload.state.pages.traverse, blank.pages.traverse);
  assert.deepStrictEqual(payload.state.pages.angle, blank.pages.angle);
  assert.deepStrictEqual(payload.state.settings.traverse, blank.settings.traverse);
  assert.deepStrictEqual(payload.state.settings.angle, blank.settings.angle);
  assert.strictEqual(payload.state.ui.active, "leveling");
  assert.strictEqual(payload.state.ui.pageIndex.leveling, 0);
});

test("buildTablePayload deep-copies pages and settings", () => {
  const source = sourceState();
  const payload = T.buildTablePayload(source, "traverse", makeDefaultState, FIXED_TIME);
  source.pages.traverse[0].meta.group = "B";
  source.settings.traverse.mode = "VA";
  assert.strictEqual(payload.state.pages.traverse[0].meta.group, "A");
  assert.strictEqual(payload.state.settings.traverse.mode, "ZA");
});

test("buildTablePayload does not add Chinese display fields", () => {
  const payload = T.buildTablePayload(sourceState(), "angle", makeDefaultState, FIXED_TIME);
  assert.strictEqual(payload.tableName, undefined);
  assert.strictEqual(payload.projectName, undefined);
});

test("buildTablePayload exports a summary sheet and blanks the other four", () => {
  const source = sourceState();
  const payload = T.buildTablePayload(source, "levelingSummary", makeDefaultState, FIXED_TIME);
  const blank = makeDefaultState();
  assert.deepStrictEqual(payload.state.pages.levelingSummary, source.pages.levelingSummary);
  assert.deepStrictEqual(payload.state.settings.levelingSummary, source.settings.levelingSummary);
  assert.deepStrictEqual(payload.state.pages.traverseSummary, blank.pages.traverseSummary);
  assert.deepStrictEqual(payload.state.pages.traverse, blank.pages.traverse);
  assert.deepStrictEqual(payload.state.pages.leveling, blank.pages.leveling);
  assert.deepStrictEqual(payload.state.pages.angle, blank.pages.angle);
  assert.strictEqual(payload.state.ui.active, "levelingSummary");
  assert.strictEqual(payload.state.ui.pageIndex.levelingSummary, 0);
});

test("buildTablePayload keeps every leveling summary page", () => {
  const source = sourceState();
  source.pages.levelingSummary.push({
    meta: { leader: "乙" },
    names: ["壬", "癸", "子", "丑", "寅", "卯", "辰", "巳"]
  });
  const payload = T.buildTablePayload(source, "levelingSummary", makeDefaultState, FIXED_TIME);
  assert.strictEqual(payload.state.pages.levelingSummary.length, 2);
  assert.deepStrictEqual(payload.state.pages.levelingSummary[1].names,
    ["壬", "癸", "子", "丑", "寅", "卯", "辰", "巳"]);
  assert.deepStrictEqual(payload.state.pages.levelingSummary, source.pages.levelingSummary);
  assert.strictEqual(payload.state.ui.pageIndex.levelingSummary, 0);
});

test("buildTablePayload carries 表二 page ownership without aliasing the source", () => {
  const source = sourceState();
  source.pages.leveling = [
    { meta: {}, owner: { person: 1, leg: 0 }, stations: [] },
    { meta: {}, owner: { person: 1, leg: 1 }, stations: [] }
  ];
  const payload = T.buildTablePayload(source, "leveling", makeDefaultState, FIXED_TIME);
  assert.deepStrictEqual(payload.state.pages.leveling[0].owner, { person: 1, leg: 0 });
  assert.deepStrictEqual(payload.state.pages.leveling[1].owner, { person: 1, leg: 1 });
  // 走一遍 JSON 往返（真实的导出/导入路径）后归属还在。
  const round = JSON.parse(JSON.stringify(payload));
  assert.deepStrictEqual(round.state.pages.leveling[1].owner, { person: 1, leg: 1 });
  // 改信封里的归属不能反过来改到源状态。
  round.state.pages.leveling[0].owner.person = 9;
  assert.deepStrictEqual(source.pages.leveling[0].owner, { person: 1, leg: 0 });
});

test("buildTablePayload accepts the traverse summary", () => {
  const payload = T.buildTablePayload(sourceState(), "traverseSummary", makeDefaultState, FIXED_TIME);
  assert.strictEqual(payload.table, "traverseSummary");
  assert.deepStrictEqual(payload.state.pages.traverseSummary, sourceState().pages.traverseSummary);
});

test("buildTablePayload accepts the trig summary", () => {
  const source = sourceState();
  const payload = T.buildTablePayload(source, "trigSummary", makeDefaultState, FIXED_TIME);
  const blank = makeDefaultState();
  assert.strictEqual(payload.table, "trigSummary");
  assert.deepStrictEqual(payload.state.pages.trigSummary, source.pages.trigSummary);
  assert.deepStrictEqual(payload.state.settings.trigSummary, source.settings.trigSummary);
  assert.deepStrictEqual(payload.state.pages.traverse, blank.pages.traverse);
  assert.deepStrictEqual(payload.state.pages.leveling, blank.pages.leveling);
  assert.strictEqual(payload.state.ui.active, "trigSummary");
  assert.strictEqual(payload.state.ui.pageIndex.trigSummary, 0);
});

test("buildTablePayload accepts the traverse calc sheet", () => {
  const source = sourceState();
  const payload = T.buildTablePayload(source, "traverseCalc", makeDefaultState, FIXED_TIME);
  const blank = makeDefaultState();
  assert.strictEqual(payload.table, "traverseCalc");
  assert.deepStrictEqual(payload.state.pages.traverseCalc, source.pages.traverseCalc);
  assert.deepStrictEqual(payload.state.settings.traverseCalc, source.settings.traverseCalc);
  assert.deepStrictEqual(payload.state.pages.trigSummary, blank.pages.trigSummary);
  assert.deepStrictEqual(payload.state.settings.trigSummary, blank.settings.trigSummary);
  assert.strictEqual(payload.state.ui.active, "traverseCalc");
  assert.strictEqual(payload.state.ui.pageIndex.traverseCalc, 0);
  // 来源快照是数据的一部分，单表导出必须原样带走。
  const round = JSON.parse(JSON.stringify(payload));
  assert.deepStrictEqual(round.state.pages.traverseCalc[0].source, source.pages.traverseCalc[0].source);
});

test("buildTablePayload rejects an unknown table", () => {
  assert.throws(
    () => T.buildTablePayload(sourceState(), "other", makeDefaultState, FIXED_TIME),
    /未知的表/
  );
});

test("buildTablePayload rejects an empty target table", () => {
  const source = sourceState();
  source.pages.traverse = [];
  assert.throws(
    () => T.buildTablePayload(source, "traverse", makeDefaultState, FIXED_TIME),
    /没有可导出的页面数据/
  );
});

console.log("transfer.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
