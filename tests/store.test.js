"use strict";

const assert = require("assert");

function makeStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    _keys() {
      return Object.keys(data);
    },
    _raw() {
      return data;
    }
  };
}

function makeState(tag) {
  return {
    version: 1,
    settings: {
      traverse: { mode: "VA", c2Limit: 60, indexLimit: 60, halfDiffLimit: 20 },
      leveling: { grade: "IV" },
      angle: { limit: 40, font: "harmony" }
    },
    pages: {
      traverse: [{ tag: tag || "traverse" }],
      leveling: [{ tag: tag || "leveling" }, {}],
      angle: [{ tag: tag || "angle" }]
    },
    ui: {
      active: "traverse",
      pageIndex: { traverse: 0, leveling: 0, angle: 0 },
      zoom: { traverse: "width", leveling: "width", angle: "width" }
    }
  };
}

global.window = global;
global.localStorage = makeStorage();
require("../web/assets/store.js");
const S = global.JujinStore;
assert.ok(S, "store.js should expose window.JujinStore");

function load(storage) {
  global.localStorage = storage || makeStorage();
  return S.boot(() => makeState("factory"));
}

function envelope(storage) {
  return JSON.parse(storage.getItem(S.KEY));
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

console.log("store.js tests");

test("boot creates schemaVersion 2 default project", () => {
  const storage = makeStorage();
  const info = load(storage);
  assert.strictEqual(info.loaded, false);
  assert.strictEqual(info.migrated, false);
  assert.strictEqual(info.corrupt, false);
  assert.strictEqual(info.storageOk, true);

  const data = envelope(storage);
  assert.strictEqual(data.schemaVersion, 2);
  assert.strictEqual(data.projects.length, 1);
  assert.strictEqual(data.projects[0].name, "默认项目");
  assert.strictEqual(data.activeProjectId, data.projects[0].id);
  assert.strictEqual(data.ui.activeModule, "traverse");
  assert.strictEqual(data.projects[0].state.ui.active, "traverse");
});

test("saveActiveState persists data across reboot", () => {
  const storage = makeStorage();
  load(storage);
  const state = S.getActiveProject().state;
  state.pages.traverse[0].tag = "saved";
  S.saveActiveState(state);

  load(storage);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "saved");
});

test("createProject adds an active isolated project with unique name", () => {
  const storage = makeStorage();
  load(storage);
  const first = S.createProject("外业");
  assert.strictEqual(first.name, "外业");
  assert.strictEqual(S.getActiveProjectId(), first.id);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "factory");

  const second = S.createProject("外业");
  assert.strictEqual(second.name, "外业 2");
  assert.notStrictEqual(second.id, first.id);
  assert.strictEqual(S.listProjects().length, 3);
});

test("switchProject restores each project's own state", () => {
  const storage = makeStorage();
  load(storage);
  const originalId = S.getActiveProjectId();
  S.getActiveProject().state.pages.traverse[0].tag = "A";
  S.saveActiveState(S.getActiveProject().state);

  const b = S.createProject("B");
  S.getActiveProject().state.pages.traverse[0].tag = "B";
  S.saveActiveState(S.getActiveProject().state);

  assert.ok(S.switchProject(originalId));
  assert.strictEqual(S.getActiveProjectId(), originalId);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "A");
  assert.ok(S.switchProject(b.id));
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "B");

  load(storage);
  assert.strictEqual(S.getActiveProjectId(), b.id);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "B");
});

test("duplicateProject deep copies state and linkage", () => {
  const storage = makeStorage();
  load(storage);
  const source = S.getActiveProject();
  source.linkage.enabled = true;
  source.state.pages.traverse[0].tag = "source";
  S.saveActiveState(source.state);

  const copy = S.duplicateProject(source.id);
  assert.strictEqual(copy.name, "默认项目 副本");
  assert.strictEqual(copy.linkage.enabled, true);
  copy.state.pages.traverse[0].tag = "copy";
  assert.strictEqual(source.state.pages.traverse[0].tag, "source");
  S.saveActiveState(copy.state);

  load(storage);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "copy");
  const original = S.switchProject(source.id);
  assert.ok(original);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "source");
});

test("renameProject trims, rejects blank, and persists", () => {
  const storage = makeStorage();
  load(storage);
  const id = S.getActiveProjectId();
  assert.strictEqual(S.renameProject(id, "   "), null);
  assert.strictEqual(S.getActiveProject().name, "默认项目");

  const renamed = S.renameProject(id, "  新建   项目  ");
  assert.strictEqual(renamed.name, "新建 项目");
  load(storage);
  assert.strictEqual(S.getActiveProject().name, "新建 项目");
});

test("uniqueName avoids collision when the base is 40 chars", () => {
  load(makeStorage());
  const base = "测".repeat(40);
  const first = S.createProject(base);
  const second = S.createProject(base);
  assert.strictEqual(first.name.length, 40);
  assert.strictEqual(second.name.length, 40);
  assert.notStrictEqual(first.name, second.name);
  assert.ok(second.name.endsWith(" 2"));
});

test("deleteProject keeps at least one project and re-selects after deleting active", () => {
  load(makeStorage());
  const firstId = S.getActiveProjectId();
  const second = S.createProject("临时");
  const result = S.deleteProject(second.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.wasActive, true);
  assert.strictEqual(S.getActiveProjectId(), firstId);
  assert.strictEqual(S.listProjects().length, 1);
  assert.deepStrictEqual(S.deleteProject(firstId), { ok: false, reason: "last" });
});

test("setActiveModule is persisted separately from state.ui.active", () => {
  const storage = makeStorage();
  load(storage);
  S.setActiveModule("assistant");
  S.saveActiveState(S.getActiveProject().state);
  assert.strictEqual(S.getActiveModule(), "assistant");
  assert.strictEqual(S.getActiveProject().state.ui.active, "traverse");

  load(storage);
  assert.strictEqual(S.getActiveModule(), "assistant");
  assert.strictEqual(S.getActiveProject().state.ui.active, "traverse");
});

test("listProjects reports page counts and metadata", () => {
  load(makeStorage());
  const entry = S.listProjects()[0];
  assert.strictEqual(entry.pageCount, 4);
  assert.strictEqual(entry.name, "默认项目");
  assert.strictEqual(entry.linkage, false);
  assert.ok(entry.createdAt);
  assert.ok(entry.updatedAt);

  const state = S.getActiveProject().state;
  state.pages.angle.push({});
  S.saveActiveState(state);
  assert.strictEqual(S.listProjects()[0].pageCount, 5);
});

test("exportAll is a deep copy", () => {
  load(makeStorage());
  const exported = S.exportAll();
  exported.projects[0].state.pages.traverse[0].tag = "mutated";
  exported.projects[0].name = "changed";
  assert.strictEqual(S.getActiveProject().name, "默认项目");
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "factory");
});

test("replaceAll swaps every project and is atomic when invalid", () => {
  const storage = makeStorage();
  load(storage);
  S.createProject("keep");
  const before = S.listProjects().length;

  assert.throws(() => S.replaceAll([], "none"));
  assert.strictEqual(S.listProjects().length, before);

  const projects = [
    { id: "p_one", name: "一", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", linkage: { enabled: true }, state: makeState("one") },
    { id: "p_two", name: "二", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z", linkage: { enabled: false }, state: makeState("two") }
  ];
  S.replaceAll(projects, "p_two");
  assert.strictEqual(S.listProjects().length, 2);
  assert.strictEqual(S.getActiveProjectId(), "p_two");
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "two");

  load(storage);
  assert.strictEqual(S.listProjects().length, 2);
  assert.strictEqual(S.getActiveProject().name, "二");
});

test("project mutations roll back when persistence fails", () => {
  const storage = makeStorage();
  const originalSet = storage.setItem.bind(storage);
  let full = false;
  storage.setItem = function (key, value) {
    if (full) throw new Error("quota exceeded");
    originalSet(key, value);
  };
  global.localStorage = storage;
  S.boot(() => makeState("factory"));
  const firstId = S.getActiveProjectId();

  full = true;
  assert.throws(() => S.createProject("写不进去"), /quota/);
  assert.strictEqual(S.listProjects().length, 1);
  assert.strictEqual(S.getActiveProjectId(), firstId);

  assert.throws(() => S.renameProject(firstId, "改名"), /quota/);
  assert.strictEqual(S.getActiveProject().name, "默认项目");

  assert.throws(() => S.duplicateProject(firstId), /quota/);
  assert.strictEqual(S.listProjects().length, 1);

  assert.strictEqual(S.setActiveModule("assistant"), false);
  assert.strictEqual(S.getActiveModule(), "traverse");

  full = false;
  const second = S.createProject("第二");
  full = true;
  assert.throws(() => S.switchProject(firstId), /quota/);
  assert.strictEqual(S.getActiveProjectId(), second.id);

  assert.throws(() => S.deleteProject(second.id), /quota/);
  assert.strictEqual(S.listProjects().length, 2);
  assert.strictEqual(S.getActiveProjectId(), second.id);
  full = false;
});

test("replaceAll restores the previous store when persistence fails", () => {
  const storage = makeStorage();
  const originalSet = storage.setItem.bind(storage);
  let full = false;
  storage.setItem = function (key, value) {
    if (full) throw new Error("quota exceeded");
    originalSet(key, value);
  };
  global.localStorage = storage;
  S.boot(() => makeState("factory"));
  S.createProject("保留");

  full = true;
  assert.throws(() => S.replaceAll([
    { id: "p_new", name: "新库", state: makeState("new") }
  ], "p_new"), /quota/);
  full = false;

  assert.strictEqual(S.listProjects().length, 2);
  assert.ok(S.listProjects().some((project) => project.name === "保留"));
  assert.strictEqual(S.getActiveProject().name, "保留");
});

test("migrates the old v1 key into 旧记录 without modifying it", () => {
  const oldPayload = JSON.stringify({
    app: "survey-sheets-formal",
    version: 1,
    exportedAt: "2026-10-01T00:00:00.000Z",
    data: makeState("legacy")
  });
  const storage = makeStorage({ [S.OLD_KEY]: oldPayload });
  global.localStorage = storage;
  const info = S.boot(() => makeState("factory"));
  assert.strictEqual(info.migrated, true);
  assert.strictEqual(info.loaded, true);
  assert.strictEqual(S.listProjects().length, 1);
  assert.strictEqual(S.getActiveProject().name, "旧记录");
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "legacy");
  assert.strictEqual(storage.getItem(S.OLD_KEY), oldPayload);
  assert.strictEqual(envelope(storage).schemaVersion, 2);
});

test("corrupt v2 store is backed up and rebuilt", () => {
  const storage = makeStorage({ [S.KEY]: "{not json" });
  global.localStorage = storage;
  const info = S.boot(() => makeState("fresh"));
  assert.strictEqual(info.corrupt, true);
  assert.strictEqual(info.storageOk, true);
  const backups = storage._keys().filter((key) => key.indexOf(S.KEY + ".corrupt-") === 0);
  assert.strictEqual(backups.length, 1);
  assert.strictEqual(storage.getItem(backups[0]), "{not json");
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "fresh");
});

test("unknown activeProjectId falls back to the first project", () => {
  const storage = makeStorage();
  load(storage);
  S.createProject("second");
  const data = envelope(storage);
  data.activeProjectId = "p_missing";
  storage.setItem(S.KEY, JSON.stringify(data));

  load(storage);
  assert.strictEqual(S.getActiveProjectId(), data.projects[0].id);
  assert.strictEqual(S.getActiveProject().name, data.projects[0].name);
});

test("stores without localStorage still work in memory and report failure", () => {
  const failing = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); }
  };
  global.localStorage = failing;
  const info = S.boot(() => makeState("memory"));
  assert.strictEqual(info.storageOk, false);
  assert.strictEqual(S.getActiveProject().state.pages.traverse[0].tag, "memory");
  assert.strictEqual(S.listProjects().length, 1);
});

test("linkage defaults to off with an empty mapping", () => {
  load(makeStorage());
  assert.deepStrictEqual(S.getLinkage(), {
    enabled: false,
    mapping: { version: 1, stations: {}, last: {} }
  });
});

test("setLinkage persists mapping and backup, and returns a deep copy", () => {
  const storage = makeStorage();
  load(storage);
  const mapping = {
    version: 1,
    stations: { "0:0": { page: 1, station: 2, swap: true } },
    last: { "0:0": { page: 1, station: 2 } }
  };
  const backup = { at: "2026-10-27T12:00:00.000Z", reason: "enable", state: makeState("backup") };
  const saved = S.setLinkage({ enabled: true, mapping: mapping, backup: backup });
  assert.strictEqual(saved.enabled, true);
  assert.deepStrictEqual(saved.mapping, mapping);
  assert.deepStrictEqual(saved.backup, backup);
  assert.strictEqual(S.listProjects()[0].linkage, true);

  saved.mapping.stations["0:0"].page = 99;
  saved.backup.state.pages.traverse[0].tag = "mutated";
  assert.strictEqual(S.getLinkage().mapping.stations["0:0"].page, 1);
  assert.strictEqual(S.getLinkage().backup.state.pages.traverse[0].tag, "backup");

  load(storage);
  assert.strictEqual(S.getLinkage().enabled, true);
  assert.deepStrictEqual(S.getLinkage().mapping, mapping);
  assert.strictEqual(S.getLinkage().backup.state.pages.traverse[0].tag, "backup");
});

test("malformed backup is dropped, unknown mapping fields survive", () => {
  load(makeStorage());
  const saved = S.setLinkage({
    enabled: true,
    mapping: { version: 1, stations: {}, last: {}, future: { keep: true } },
    backup: { at: "x", reason: "enable", state: "not an object" }
  });
  assert.strictEqual(saved.backup, undefined);
  assert.deepStrictEqual(saved.mapping.future, { keep: true });
});

test("setLinkage rolls back when persistence fails", () => {
  const storage = makeStorage();
  const originalSet = storage.setItem.bind(storage);
  let full = false;
  storage.setItem = function (key, value) {
    if (full) throw new Error("quota exceeded");
    originalSet(key, value);
  };
  global.localStorage = storage;
  S.boot(() => makeState("factory"));
  S.setLinkage({ enabled: true, mapping: { version: 1, stations: { "0:0": { swap: true } }, last: {} } });

  full = true;
  assert.throws(() => S.setLinkage({ enabled: false, mapping: {} }), /quota/);
  assert.strictEqual(S.getLinkage().enabled, true);
  assert.deepStrictEqual(S.getLinkage().mapping.stations["0:0"], { swap: true });
  full = false;
});

test("duplicateProject deep copies the linkage mapping and backup", () => {
  load(makeStorage());
  const source = S.getActiveProject();
  S.setLinkage({
    enabled: true,
    mapping: { version: 1, stations: { "0:0": { page: 1, station: 3 } }, last: { "0:0": { page: 1, station: 3 } } },
    backup: { at: "2026-10-27T12:00:00.000Z", reason: "enable", state: makeState("backup") }
  });
  const copy = S.duplicateProject(source.id);
  assert.deepStrictEqual(copy.linkage.mapping, source.linkage.mapping);
  assert.deepStrictEqual(copy.linkage.backup, source.linkage.backup);
  copy.linkage.mapping.stations["0:0"].page = 9;
  copy.linkage.backup.state.pages.traverse[0].tag = "copy";
  assert.strictEqual(source.linkage.mapping.stations["0:0"].page, 1);
  assert.strictEqual(source.linkage.backup.state.pages.traverse[0].tag, "backup");
});

test("replaceAll preserves linkage mapping and backup", () => {
  load(makeStorage());
  S.replaceAll([
    {
      id: "p_link",
      name: "联立项目",
      linkage: {
        enabled: true,
        mapping: { version: 1, stations: { "0:0": { page: 0, station: 5 } }, last: { "0:0": { page: 0, station: 5 } } },
        backup: { at: "2026-10-27T12:00:00.000Z", reason: "enable", state: makeState("backup") }
      },
      state: makeState("linked")
    }
  ], "p_link");
  assert.strictEqual(S.getLinkage().enabled, true);
  assert.deepStrictEqual(S.getLinkage().mapping.stations["0:0"], { page: 0, station: 5 });
  assert.strictEqual(S.getLinkage().backup.state.pages.traverse[0].tag, "backup");
});

/* ---------------- 原生存储（异步） ---------------- */

function makeNativeSink(options) {
  options = options || {};
  const calls = [];
  let fail = !!options.fail;
  return {
    calls,
    setFail(value) { fail = value; },
    write(text) {
      calls.push({ text, fail });
      if (fail) return Promise.reject(new Error("磁盘写入失败"));
      return Promise.resolve({
        storePath: "C:/x/store.json",
        backupWritten: calls.length === 1,
        backupError: null
      });
    }
  };
}

function nativeBoot(sink, options) {
  options = options || {};
  return S.boot(() => makeState("factory"), {
    mode: options.mode || "native",
    text: options.text,
    corrupt: options.corrupt,
    write: options.write === undefined ? sink.write.bind(sink) : options.write
  });
}

async function asyncTest(name, fn) {
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

(async function runNativeTests() {
  await asyncTest("native boot writes the store through the sink, never localStorage", async () => {
    const storage = makeStorage();
    global.localStorage = storage;
    const sink = makeNativeSink();
    const boot = nativeBoot(sink);
    assert.strictEqual(boot.mode, "native");
    assert.strictEqual(boot.loaded, false);
    assert.strictEqual(S.getSaveInfo().pending, 1);
    const info = await S.flushWrites();
    assert.strictEqual(info.pending, 0);
    assert.strictEqual(info.lastError, null);
    assert.ok(info.lastSavedAt instanceof Date);
    assert.strictEqual(info.lastSaveHadBackup, true);
    assert.strictEqual(sink.calls.length, 1);
    assert.strictEqual(JSON.parse(sink.calls[0].text).schemaVersion, 2);
    assert.strictEqual(storage.getItem(S.KEY), null);
  });

  await asyncTest("native boot loads provided text without touching localStorage", async () => {
    global.localStorage = makeStorage();
    let text = null;
    S.boot(() => makeState("factory"), { mode: "native", write: (json) => { text = json; } });
    await S.flushWrites();
    assert.ok(text && JSON.parse(text).projects.length === 1);

    const storage = makeStorage({ [S.KEY]: "{\"doNot\":\"read\"}" });
    global.localStorage = storage;
    const sink = makeNativeSink();
    const boot = nativeBoot(sink, { text });
    assert.strictEqual(boot.loaded, true);
    assert.strictEqual(S.getActiveProject().name, "默认项目");
    assert.strictEqual(storage.getItem(S.KEY), "{\"doNot\":\"read\"}");
    const info = await S.flushWrites();
    assert.strictEqual(info.lastError, null);
  });

  await asyncTest("native save failure surfaces in save info and later success clears it", async () => {
    global.localStorage = makeStorage();
    const sink = makeNativeSink({ fail: true });
    nativeBoot(sink);
    let info = await S.flushWrites();
    assert.ok(info.lastError, "expected an error");
    assert.strictEqual(S.getStorageOk(), false);

    sink.setFail(false);
    const before = S.getSaveInfo().lastSavedAt;
    S.saveActiveState(Object.assign(makeState("after-error"), {
      pages: { traverse: [{ tag: "x" }], leveling: [], angle: [] }
    }));
    info = await S.flushWrites();
    assert.strictEqual(info.lastError, null);
    assert.strictEqual(S.getStorageOk(), true);
    assert.ok(info.lastSavedAt instanceof Date);
    assert.notStrictEqual(info.lastSavedAt, before);
    assert.strictEqual(JSON.parse(sink.calls[sink.calls.length - 1].text).projects[0].state.pages.traverse[0].tag, "x");
  });

  await asyncTest("flushWrites waits for pending writes and reports backup errors", async () => {
    global.localStorage = makeStorage();
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const write = () => blocked.then(() => ({
      storePath: "C:/x/store.json",
      backupWritten: false,
      backupError: "备份目录不可写"
    }));
    nativeBoot({ write });
    const flushing = S.flushWrites();
    let settled = false;
    flushing.then(() => { settled = true; });
    await Promise.resolve();
    assert.strictEqual(settled, false);
    release();
    const info = await flushing;
    assert.strictEqual(settled, true);
    assert.strictEqual(info.pending, 0);
    assert.strictEqual(info.lastBackupError, "备份目录不可写");
    assert.strictEqual(info.lastSaveHadBackup, false);
  });

  await asyncTest("memory mode never silently falls back to localStorage", async () => {
    const storage = makeStorage();
    global.localStorage = storage;
    S.boot(() => makeState("factory"), { mode: "memory" });
    assert.strictEqual(S.getSaveInfo().mode, "memory");
    S.saveActiveState(makeState("memory"));
    const info = await S.flushWrites();
    assert.strictEqual(info.mode, "memory");
    assert.ok(info.lastError);
    assert.strictEqual(storage.getItem(S.KEY), null);
  });

  await asyncTest("onSaveStatus listeners see pending and settled states", async () => {
    global.localStorage = makeStorage();
    const sink = makeNativeSink();
    nativeBoot(sink);
    const seen = [];
    const off = S.onSaveStatus((info) => seen.push(info.pending));
    S.saveActiveState(makeState("status"));
    await S.flushWrites();
    off();
    assert.ok(seen.indexOf(1) >= 0, "expected a pending notification");
    assert.strictEqual(seen[seen.length - 1], 0);
  });

  console.log("\n" + passed + " tests passed.");
})();
