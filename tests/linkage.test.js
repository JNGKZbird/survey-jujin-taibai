"use strict";

const assert = require("assert");
require("../web/assets/linkage.js");
const L = global.JujinLinkage;
assert.ok(L, "linkage.js should expose JujinLinkage");

function dm(d, m, s) {
  return { d: String(d), m: String(m), s: String(s) };
}

function blankTarget() {
  return {
    name: "",
    prismHeight: "",
    readings: {
      L: { h: dm("", "", ""), v: dm("", "", ""), s: "" },
      R: { h: dm("", "", ""), v: dm("", "", ""), s: "" }
    }
  };
}

function target(name, left, right, leftS, rightS) {
  return {
    name,
    prismHeight: "1.500",
    readings: {
      L: { h: left || dm("", "", ""), v: dm("1", "30", "0"), s: leftS == null ? "100.000" : String(leftS) },
      R: { h: right || dm("", "", ""), v: dm("-1", "30", "0"), s: rightS == null ? "100.000" : String(rightS) }
    }
  };
}

function blankStation() {
  return { name: "", instrumentHeight: "", targets: [blankTarget(), blankTarget()] };
}

function station(name, first, second) {
  return {
    name,
    instrumentHeight: "1.600",
    targets: [
      first || blankTarget(),
      second || blankTarget()
    ]
  };
}

function page(stations, meta) {
  return {
    meta: meta || { year: "26", month: "10", day: "27", observer: "张三", recorder: "李四", group: "一组" },
    stations: stations
  };
}

function blankPages(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(page([blankStation(), blankStation(), blankStation(), blankStation()]));
  return out;
}

function angleRow(targetName, reading, distance) {
  return { target: targetName || "", reading: reading || dm("", "", ""), distance: distance || "" };
}

function angleStation(name, rows) {
  const list = rows || [];
  const out = { station: name || "", rows: [] };
  for (let i = 0; i < 4; i += 1) out.rows.push(list[i] || angleRow("", dm("", "", ""), ""));
  return out;
}

function anglePage(stations, meta) {
  const list = stations || [];
  const out = {
    meta: meta || { date: "", instrument: "", observer: "", weather: "", group: "", recorder: "" },
    stations: []
  };
  for (let i = 0; i < 6; i += 1) out.stations.push(list[i] || angleStation());
  return out;
}

function makeState(traverse, angles) {
  return {
    version: 1,
    settings: {},
    pages: {
      traverse: traverse,
      leveling: [page([])],
      angle: angles || [anglePage()]
    },
    ui: { active: "traverse", pageIndex: { traverse: 0, leveling: 0, angle: 0 } }
  };
}

function fakeFactory() {
  let created = 0;
  return {
    page() {
      created += 1;
      const out = anglePage();
      out.meta.fromFactory = "yes";
      return out;
    },
    station: () => angleStation(),
    count: () => created
  };
}

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

console.log("linkage.js tests");

test("auto station/page arithmetic crosses 6-station boundaries", () => {
  assert.deepStrictEqual(L.autoDest(5), { page: 0, station: 5 });
  assert.deepStrictEqual(L.autoDest(6), { page: 1, station: 0 });
  assert.deepStrictEqual(L.autoDest(11), { page: 1, station: 5 });
  assert.deepStrictEqual(L.autoDest(12), { page: 2, station: 0 });
  assert.strictEqual(L.autoPageCount(0), 1);
  assert.strictEqual(L.autoPageCount(1), 1);
  assert.strictEqual(L.autoPageCount(2), 2);
  assert.strictEqual(L.autoPageCount(3), 2);
  assert.strictEqual(L.autoPageCount(4), 3);
  assert.strictEqual(L.autoPageCount(5), 4);
});

test("normalizeMeta keeps valid overrides and last, drops junk", () => {
  const meta = L.normalizeMeta({
    version: 9,
    stations: {
      "0:0": { page: 2, station: 4, swap: true },
      "0:1": { page: 100, station: 0, swap: true },
      "0:2": { page: 1, station: 6 },
      "x": { page: 0, station: 0 },
      "9:4": { page: 0, station: 0 }
    },
    last: {
      "0:0": { page: 1, station: 5 },
      "0:3": { page: 2, station: 6 }
    }
  });
  assert.deepStrictEqual(meta.stations["0:0"], { page: 2, station: 4, swap: true });
  assert.deepStrictEqual(meta.stations["0:1"], { swap: true });
  assert.strictEqual(meta.stations["0:2"], undefined);
  assert.strictEqual(meta.stations.x, undefined);
  assert.strictEqual(meta.stations["9:4"], undefined);
  assert.deepStrictEqual(meta.last["0:0"], { page: 1, station: 5 });
  assert.strictEqual(meta.last["0:3"], undefined);
  assert.strictEqual(L.mappingHasContent(L.normalizeMeta({})), false);
  assert.strictEqual(L.mappingHasContent(meta), true);
});

test("plan maps ①L ①R ②L ②R into L① L② R① R②", () => {
  const t1 = target("A", dm("10", "1", "2"), dm("190", "1", "2"), "80.100", "80.120");
  const t2 = target("B", dm("20", "3", "4"), dm("200", "3", "4"), "90.200", "90.220");
  const info = L.plan([page([station("S1", t1, t2), blankStation()])], null, { anglePageCount: 1 });
  const row = info.rows[0];
  assert.strictEqual(row.hasData, true);
  assert.deepStrictEqual(row.dest, { page: 0, station: 0 });
  assert.strictEqual(row.sourceRows[0].targetName, "A");
  assert.strictEqual(row.sourceRows[1].targetName, "B");
  assert.strictEqual(row.sourceRows[2].targetName, "A");
  assert.strictEqual(row.sourceRows[3].targetName, "B");
  assert.deepStrictEqual(row.sourceRows.map((item) => item.face), ["L", "L", "R", "R"]);
  assert.deepStrictEqual(row.sourceRows[0].reading, dm("10", "1", "2"));
  assert.deepStrictEqual(row.sourceRows[1].reading, dm("20", "3", "4"));
  assert.deepStrictEqual(row.sourceRows[2].reading, dm("190", "1", "2"));
  assert.deepStrictEqual(row.sourceRows[3].reading, dm("200", "3", "4"));
  assert.strictEqual(row.sourceRows[0].distance, "80.100");
  assert.strictEqual(row.sourceRows[2].distance, "80.120");
  assert.strictEqual(row.status, "synced");
});

test("plan spans two traverse pages across 表三 page boundary", () => {
  const t = (name) => target(name, dm("1", "0", "0"), dm("181", "0", "0"));
  const pages = [
    page([station("P0S0", t("a")), station("P0S1", t("b")), station("P0S2", t("c")), station("P0S3", t("d"))]),
    page([station("P1S0", t("e")), station("P1S1", t("f")), station("P1S2", t("g")), station("P1S3", t("h"))])
  ];
  const info = L.plan(pages, null, { anglePageCount: 1 });
  assert.strictEqual(info.rows.length, 8);
  assert.deepStrictEqual(info.rows[4].dest, { page: 0, station: 4 });
  assert.deepStrictEqual(info.rows[5].dest, { page: 0, station: 5 });
  assert.deepStrictEqual(info.rows[6].dest, { page: 1, station: 0 });
  assert.deepStrictEqual(info.rows[7].dest, { page: 1, station: 1 });
  assert.strictEqual(info.neededPages, 2);
  assert.strictEqual(info.willCreatePages, 1);
});

test("swap only swaps the two targets, never the faces", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"));
  const t2 = target("B", dm("20", "0", "0"), dm("200", "0", "0"));
  const meta = L.normalizeMeta({ stations: { "0:0": { swap: true } } });
  const info = L.plan([page([station("S", t1, t2)])], meta, { anglePageCount: 1 });
  const rows = info.rows[0].sourceRows;
  assert.deepStrictEqual(rows.map((item) => item.targetName), ["B", "A", "B", "A"]);
  assert.deepStrictEqual(rows.map((item) => item.face), ["L", "L", "R", "R"]);
  assert.deepStrictEqual(rows[0].reading, dm("20", "0", "0"));
  assert.deepStrictEqual(rows[2].reading, dm("200", "0", "0"));
});

test("360 and raw strings are copied, vertical readings never enter 表三", () => {
  const t1 = target("A", dm("360", "0", "0"), dm("0", "0", "0"));
  t1.readings.L.v = dm("-2", "15", "0");
  t1.readings.R.v = dm("-2", "16", "0");
  const pages = [page([station("S", t1)])];
  const state = makeState(pages);
  const res = L.sync(state, null, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle[0].stations[0].rows[0].reading.d, "360");
  assert.strictEqual(state.pages.angle[0].stations[0].rows[2].reading.d, "0");
  assert.strictEqual(state.pages.angle[0].stations[0].rows[1].reading.d, "");
  const text = JSON.stringify(state.pages.angle);
  assert.ok(text.indexOf('"-2"') === -1, "negative vertical must not be written");
  assert.ok(text.indexOf('"v"') === -1, "表三 rows must not gain a vertical field");
  assert.ok(res.changed);
});

test("partial readings copy as-is and produce soft warnings", () => {
  const t1 = target("A", dm("10", "", ""), dm("190", "1", "2"), "100.000", "100.000");
  t1.readings.R.s = "";
  const info = L.plan([page([station("S", t1)])], null, { anglePageCount: 1 });
  const row = info.rows[0];
  assert.strictEqual(row.status, "partial");
  assert.ok(row.warnings.some((item) => item.code === "partial-reading"));
  assert.ok(row.warnings.some((item) => item.code === "missing-distance"));
  assert.strictEqual(row.sourceRows[0].reading.d, "10");
  assert.strictEqual(row.sourceRows[0].reading.m, "");
});

test("slant mismatch above 1/10000 is a soft warning", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"), "100.000", "100.020");
  const info = L.plan([page([station("S", t1)])], null, { anglePageCount: 1 });
  assert.ok(info.rows[0].warnings.some((item) => item.code === "slant-mismatch"));
});

test("sync writes tables, truncates by code point, leaves source untouched", () => {
  const longName = "一二三四五六七八九";
  const longTarget = "ABCDEFGHIJKLMNOPQRSTU";
  const t1 = target(longTarget, dm("10", "0", "0"), dm("190", "0", "0"));
  const source = page([station(longName, t1)]);
  const state = makeState([source]);
  const res = L.sync(state, null, { makeAnglePage: () => anglePage() });
  const st = state.pages.angle[0].stations[0];
  assert.strictEqual(st.station, "一二三四五六七八");
  assert.strictEqual(st.rows[0].target, "ABCDEFGHIJKLMNOPQRST");
  assert.strictEqual(st.rows[1].target, "");
  assert.strictEqual(st.rows[0].reading.d, "10");
  assert.strictEqual(st.rows[2].reading.d, "190");
  assert.strictEqual(st.rows[0].distance, "100.000");
  assert.strictEqual(source.stations[0].name, longName, "source stays intact");
  assert.strictEqual(source.stations[0].targets[0].name, longTarget);
  assert.strictEqual(res.wrote, 1);
  assert.strictEqual(res.created, 0);
});

test("sync fills only empty meta from the first contributing source page", () => {
  const t = (name) => target(name, dm("10", "0", "0"), dm("190", "0", "0"));
  const pages = [
    page([station("A", t("a")), station("B", t("b")), station("C", t("c")), station("D", t("d"))],
      { year: "26", month: "10", day: "27", observer: "张三", recorder: "李四", group: "一组" }),
    page([station("E", t("e")), station("F", t("f")), station("G", t("g")), station("H", t("h"))],
      { year: "2026", month: "11", day: "2", observer: "王五", recorder: "赵六", group: "二组" })
  ];
  const prefill = anglePage([], { date: "", instrument: "已有仪器", observer: "原观测", weather: "", group: "", recorder: "" });
  const state = makeState(pages, [prefill, anglePage()]);
  L.sync(state, null, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle[0].meta.date, "2026-10-27");
  assert.strictEqual(state.pages.angle[0].meta.observer, "原观测", "existing value is never overwritten");
  assert.strictEqual(state.pages.angle[0].meta.recorder, "李四");
  assert.strictEqual(state.pages.angle[0].meta.group, "一组");
  assert.strictEqual(state.pages.angle[0].meta.instrument, "已有仪器");
  assert.strictEqual(state.pages.angle[0].meta.weather, "");
  assert.strictEqual(state.pages.angle[1].meta.date, "2026-11-02");
  assert.strictEqual(state.pages.angle[1].meta.observer, "王五");
});

test("blank source never clears pre-existing 表三 data", () => {
  const existing = angleStation("原有站", [angleRow("原有目标", dm("1", "2", "3"), "50.000")]);
  const angles = [anglePage([existing])];
  const state = makeState(blankPages(1), angles);
  const res = L.sync(state, null, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle[0].stations[0].station, "原有站");
  assert.strictEqual(state.pages.angle[0].stations[0].rows[0].target, "原有目标");
  assert.strictEqual(res.wrote, 0);
  assert.strictEqual(res.cleared, 0);
  assert.strictEqual(res.changed, false);
});

test("a source that becomes blank clears only what linkage wrote", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"));
  const pages = [page([station("S", t1)])];
  const state = makeState(pages);
  const first = L.sync(state, null, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle[0].stations[0].station, "S");
  assert.ok(first.meta.last["0:0"]);
  pages[0].stations[0] = blankStation();
  const second = L.sync(state, first.meta, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle[0].stations[0].station, "");
  assert.strictEqual(state.pages.angle[0].stations[0].rows[0].target, "");
  assert.strictEqual(second.cleared, 1);
  assert.strictEqual(second.meta.last["0:0"], undefined);
});

test("conflicting destinations are skipped and existing values survive", () => {
  const t = (name) => target(name, dm("10", "0", "0"), dm("190", "0", "0"));
  const pages = [page([station("S0", t("a")), station("S1", t("b"))])];
  const meta = L.normalizeMeta({ stations: { "0:0": { page: 0, station: 0 }, "0:1": { page: 0, station: 0 } } });
  const info = L.plan(pages, meta, { anglePageCount: 1 });
  assert.strictEqual(info.rows[0].conflict, true);
  assert.strictEqual(info.rows[1].conflict, true);
  assert.strictEqual(info.rows[0].status, "conflict");
  const existing = angleStation("KEEP", [angleRow("K", dm("9", "9", "9"), "9.999")]);
  const state = makeState(pages, [anglePage([existing])]);
  const res = L.sync(state, meta, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle[0].stations[0].station, "KEEP");
  assert.strictEqual(state.pages.angle[0].stations[0].rows[0].target, "K");
  assert.strictEqual(res.wrote, 0);
});

test("destination override moves data and clears the old destination", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"));
  const state = makeState([page([station("S", t1)])]);
  const first = L.sync(state, null, {});
  assert.strictEqual(state.pages.angle[0].stations[0].station, "S");
  const meta = L.normalizeMeta(first.meta);
  meta.stations["0:0"] = { page: 0, station: 3 };
  const second = L.sync(state, meta, {});
  assert.strictEqual(state.pages.angle[0].stations[0].station, "");
  assert.strictEqual(state.pages.angle[0].stations[3].station, "S");
  assert.strictEqual(second.cleared, 1);
  assert.deepStrictEqual(second.meta.last["0:0"], { page: 0, station: 3 });
});

test("manual destination beyond current 表三 pages creates blank pages", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"));
  const state = makeState([page([station("S", t1)])])
  state.pages.angle = [anglePage()]
  const meta = L.normalizeMeta({ stations: { "0:0": { page: 2, station: 4 } } });
  const res = L.sync(state, meta, { makeAnglePage: () => anglePage() });
  assert.strictEqual(state.pages.angle.length, 3);
  assert.strictEqual(res.created, 2);
  assert.strictEqual(state.pages.angle[2].stations[4].station, "S");
  assert.strictEqual(state.pages.angle[0].stations[0].station, "");
});

test("sync is idempotent and never deletes extra 表三 pages", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"));
  const state = makeState([page([station("S", t1)])], [anglePage(), anglePage(), anglePage()]);
  const first = L.sync(state, null, {});
  assert.strictEqual(state.pages.angle.length, 3);
  assert.ok(first.changed);
  const second = L.sync(state, first.meta, {});
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.created, 0);
  assert.strictEqual(second.wrote, 1);
  assert.strictEqual(state.pages.angle.length, 3);
});

test("free columns and computed cells are not created", () => {
  const t1 = target("A", dm("10", "0", "0"), dm("190", "0", "0"));
  const state = makeState([page([station("S", t1)])]);
  L.sync(state, null, {});
  const written = state.pages.angle[0].stations[0];
  assert.deepStrictEqual(Object.keys(written).sort(), ["rows", "station"]);
  written.rows.forEach((row) => {
    assert.deepStrictEqual(Object.keys(row).sort(), ["distance", "reading", "target"]);
    assert.deepStrictEqual(Object.keys(row.reading).sort(), ["d", "m", "s"]);
  });
});

test("source page deletion shifts mapping keys", () => {
  const meta = L.normalizeMeta({
    stations: {
      "0:0": { page: 0, station: 1 },
      "1:2": { swap: true },
      "2:3": { page: 2, station: 5 }
    },
    last: {
      "0:0": { page: 0, station: 1 },
      "1:1": { page: 0, station: 2 },
      "2:0": { page: 1, station: 0 }
    }
  });
  const next = L.shiftSourcePagesAfterDelete(meta, 1);
  assert.deepStrictEqual(next.stations["0:0"], { page: 0, station: 1 });
  assert.strictEqual(next.stations["1:2"], undefined);
  assert.deepStrictEqual(next.stations["1:3"], { page: 2, station: 5 });
  assert.deepStrictEqual(next.last["0:0"], { page: 0, station: 1 });
  assert.strictEqual(next.last["1:1"], undefined);
  assert.deepStrictEqual(next.last["1:0"], { page: 1, station: 0 });
});

test("destination page deletion shifts and drops destination references", () => {
  const meta = L.normalizeMeta({
    stations: {
      "0:0": { page: 0, station: 1 },
      "0:1": { page: 1, station: 2, swap: true },
      "0:2": { page: 2, station: 3 }
    },
    last: {
      "0:0": { page: 0, station: 1 },
      "0:1": { page: 1, station: 2 },
      "0:2": { page: 2, station: 3 }
    }
  });
  const next = L.shiftDestinationPagesAfterDelete(meta, 1);
  assert.deepStrictEqual(next.stations["0:0"], { page: 0, station: 1 });
  assert.deepStrictEqual(next.stations["0:1"], { swap: true });
  assert.deepStrictEqual(next.stations["0:2"], { page: 1, station: 3 });
  assert.deepStrictEqual(next.last["0:0"], { page: 0, station: 1 });
  assert.strictEqual(next.last["0:1"], undefined);
  assert.deepStrictEqual(next.last["0:2"], { page: 1, station: 3 });
});

test("page and station data detectors distinguish heights from mapped data", () => {
  const heightOnly = blankStation();
  heightOnly.instrumentHeight = "1.600";
  heightOnly.targets[0].prismHeight = "1.500";
  assert.strictEqual(L.stationHasLinkableData(heightOnly), false);
  const nameOnly = blankStation();
  nameOnly.name = "S";
  assert.strictEqual(L.stationHasLinkableData(nameOnly), true);
  const verticalOnly = blankStation();
  verticalOnly.targets[0].readings.L.v = dm("90", "0", "0");
  assert.strictEqual(L.stationHasLinkableData(verticalOnly), true);
  assert.strictEqual(L.anglePageHasData(anglePage()), false);
  assert.strictEqual(L.anglePageHasData(anglePage([], { date: "2026-10-27" })), true);
  assert.strictEqual(L.anglePageHasData(anglePage([angleStation("S")])), true);
  assert.strictEqual(L.angleStationHasData({ station: "", rows: [] }), false);
});

test("station and target truncation counts code points", () => {
  assert.strictEqual(L.truncate("😀😀😀😀😀😀😀😀😀", 8), "😀😀😀😀😀😀😀😀");
  assert.strictEqual(L.truncate("abc", 8), "abc");
});

console.log("linkage.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
