"use strict";

const assert = require("assert");
const A = require("../web/assets/agent/attachments.js");
const Store = require("../web/assets/agent/attachment-store.js");

const DATA = "data:image/jpeg;base64,QUJD";
const DATA2 = "data:image/png;base64,REVG";

const tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function makeBridge(options) {
  const opts = Object.assign({
    available: true,
    indexOk: true,
    putOk: true,
    readOk: true,
    pruneOk: true,
    clearOk: true,
    putError: "attachment_quota: full",
    putDelay: 0
  }, options || {});
  const files = new Map();
  const calls = [];
  let activePuts = 0;
  let maxActivePuts = 0;

  function doPut(args) {
    const bytes = A.dataUrlBytes(args.dataUrl);
    files.set(args.id, { dataUrl: args.dataUrl, bytes: bytes });
    return {
      id: args.id,
      bytes: bytes,
      ext: "jpg",
      path: "C:/data/attachments/" + args.id + ".jpg"
    };
  }

  const bridge = {
    files: files,
    calls: calls,
    opts: opts,
    available: function () { return opts.available; },
    maxActivePuts: function () { return maxActivePuts; },
    call: function (command, args) {
      calls.push({ command: command, args: JSON.parse(JSON.stringify(args || {})) });
      if (command === "agent_attachment_index") {
        if (!opts.indexOk) return Promise.reject("attachment_io: index");
        const ids = Array.from(files.keys());
        let bytes = 0;
        files.forEach(function (one) { bytes += one.bytes; });
        return Promise.resolve({
          dir: "C:/data/attachments",
          ids: ids,
          count: ids.length,
          bytes: bytes,
          maxBytes: 512 * 1024 * 1024
        });
      }
      if (command === "agent_attachment_put") {
        if (!opts.putOk) return Promise.reject(opts.putError);
        if (!opts.putDelay) return Promise.resolve(doPut(args));
        return new Promise(function (resolve, reject) {
          activePuts += 1;
          maxActivePuts = Math.max(maxActivePuts, activePuts);
          setTimeout(function () {
            activePuts -= 1;
            try {
              resolve(doPut(args));
            } catch (err) {
              reject(err);
            }
          }, opts.putDelay);
        });
      }
      if (command === "agent_attachment_read") {
        if (!opts.readOk) return Promise.reject("attachment_io: read");
        const found = files.get(args.id);
        if (!found) return Promise.reject("attachment_not_found");
        return Promise.resolve({
          found: true,
          id: args.id,
          dataUrl: found.dataUrl,
          mime: "image/jpeg",
          bytes: found.bytes
        });
      }
      if (command === "agent_attachment_prune") {
        if (!opts.pruneOk) return Promise.reject("attachment_io: prune");
        return Promise.resolve({
          removed: 1,
          removedBytes: 100,
          kept: files.size,
          skipped: false,
          reason: ""
        });
      }
      if (command === "agent_attachment_clear") {
        if (!opts.clearOk) return Promise.reject("attachment_io: clear");
        const count = files.size;
        files.clear();
        return Promise.resolve({
          removed: count,
          removedBytes: count * 100,
          failed: []
        });
      }
      return Promise.reject(new Error("unexpected command: " + command));
    }
  };
  return bridge;
}

function seed(bridge, id, dataUrl) {
  bridge.files.set(id, { dataUrl: dataUrl, bytes: A.dataUrlBytes(dataUrl) });
}

function commands(bridge) {
  return bridge.calls.map(function (one) { return one.command; });
}

test("unavailable store degrades every disk operation to skipped", async function () {
  const bridge = makeBridge({ available: false });
  const store = Store.createStore(bridge);
  const boot = await store.boot({ prune: true });
  assert.strictEqual(boot.ready, false);
  assert.ok(boot.reason.indexOf("浏览器") !== -1, boot.reason);
  assert.strictEqual(store.available(), false);
  assert.strictEqual(store.ready(), false);
  assert.strictEqual(store.has("img_a"), false);
  assert.strictEqual(await store.get("img_a"), null);
  const loaded = await store.loadMany(["img_a"]);
  assert.deepStrictEqual(Object.keys(loaded.data), []);
  assert.deepStrictEqual(loaded.missing, []);
  const put = await store.put("img_a", DATA);
  assert.strictEqual(put.ok, false);
  assert.strictEqual(put.skipped, true);
  const many = await store.putMany([{ id: "img_a", dataUrl: DATA }, { id: "img_b" }]);
  assert.strictEqual(many.saved, 0);
  assert.strictEqual(many.skipped, 2);
  assert.deepStrictEqual(many.failed, []);
  assert.strictEqual((await store.prune()).skipped, true);
  assert.strictEqual((await store.clearAll()).skipped, true);
  await store.flush();
  assert.deepStrictEqual(commands(bridge), []);
});

test("boot prunes first and then loads the disk index", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  const store = Store.createStore(bridge);
  const boot = await store.boot({ prune: true });
  assert.strictEqual(boot.ready, true);
  assert.deepStrictEqual(commands(bridge),
    ["agent_attachment_prune", "agent_attachment_index"]);
  const stats = store.stats();
  assert.strictEqual(stats.available, true);
  assert.strictEqual(stats.ready, true);
  assert.strictEqual(stats.dir, "C:/data/attachments");
  assert.strictEqual(stats.count, 1);
  assert.strictEqual(stats.bytes, 3);
  assert.strictEqual(stats.maxBytes, 512 * 1024 * 1024);
  assert.strictEqual(store.has("img_a"), true);
  assert.strictEqual(store.isKnownMissing("img_a"), false);
});

test("boot without prune only reads the index", async function () {
  const bridge = makeBridge();
  const store = Store.createStore(bridge);
  const boot = await store.boot({ prune: false });
  assert.strictEqual(boot.ready, true);
  assert.deepStrictEqual(commands(bridge), ["agent_attachment_index"]);
});

test("index failure leaves the store not ready but does not throw", async function () {
  const bridge = makeBridge({ indexOk: false });
  const store = Store.createStore(bridge);
  const boot = await store.boot({ prune: false });
  assert.strictEqual(boot.ready, false);
  assert.strictEqual(boot.reason, "图片文件读写失败。");
  assert.strictEqual(store.ready(), false);
});

test("prune failure blocks boot before the index is read", async function () {
  const bridge = makeBridge({ pruneOk: false });
  const store = Store.createStore(bridge);
  const boot = await store.boot({ prune: true });
  assert.strictEqual(boot.ready, false);
  assert.strictEqual(boot.reason, "图片文件读写失败。");
  assert.deepStrictEqual(commands(bridge), ["agent_attachment_prune"]);
});

test("put rejects bad ids and bad data URLs before calling the bridge", async function () {
  const bridge = makeBridge();
  const store = Store.createStore(bridge);
  await store.boot({});
  const badIds = ["IMG_A", "con", "a".repeat(65), "../img_a", ""];
  for (const id of badIds) {
    const result = await store.put(id, DATA);
    assert.strictEqual(result.ok, false, id);
    assert.strictEqual(result.error, "图片编号不合法。", id);
  }
  const badUrl = await store.put("img_a", "data:text/plain;base64,QUJD");
  assert.strictEqual(badUrl.ok, false);
  assert.strictEqual(badUrl.error, "图片数据不合法。");
  assert.deepStrictEqual(commands(bridge), ["agent_attachment_index"]);
});

test("put writes one file and updates the synchronous index", async function () {
  const bridge = makeBridge();
  const store = Store.createStore(bridge);
  await store.boot({});
  const result = await store.put("img_a", DATA);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.bytes, 3);
  assert.strictEqual(result.ext, "jpg");
  assert.strictEqual(result.path, "C:/data/attachments/img_a.jpg");
  assert.strictEqual(store.has("img_a"), true);
  assert.strictEqual(store.stats().count, 1);
  assert.strictEqual(store.stats().bytes, 3);
  assert.deepStrictEqual(bridge.calls[1].args, { id: "img_a", dataUrl: DATA });
});

test("put maps quota and oversized errors to Chinese reasons", async function () {
  const bridge = makeBridge({ putOk: false, putError: "attachment_quota: full" });
  const store = Store.createStore(bridge);
  await store.boot({});
  let result = await store.put("img_a", DATA);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "attachment_quota");
  assert.strictEqual(result.error, "图片缓存已满，请先清理。");
  assert.strictEqual(store.has("img_a"), false);

  const bridge2 = makeBridge({
    putOk: false,
    putError: new Error("attachment_too_large: 3 MB")
  });
  const store2 = Store.createStore(bridge2);
  await store2.boot({});
  result = await store2.put("img_a", DATA);
  assert.strictEqual(result.error, "单张图片超过 2 MB。");
});

test("putMany skips indexed files, dedupes ids and reports partial failures", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  const store = Store.createStore(bridge);
  await store.boot({});
  const result = await store.putMany([
    { id: "img_a", dataUrl: DATA },
    { id: "img_a", dataUrl: DATA },
    { id: "img_b", dataUrl: DATA2 },
    { id: "img_c" },
    { id: "img_d", dataUrl: "not-a-data-url" },
    { id: "IMG_E", dataUrl: DATA }
  ]);
  assert.strictEqual(result.saved, 1);
  assert.strictEqual(result.skipped, 1);
  assert.deepStrictEqual(result.failed.map(function (one) { return one.id; }).sort(),
    ["IMG_E", "img_c", "img_d"]);
  assert.strictEqual(bridge.files.has("img_b"), true);
  assert.strictEqual(bridge.files.size, 2, "一张失败不能回滚已成功的另一张");
  assert.strictEqual(store.has("img_b"), true);
  assert.strictEqual(store.has("img_c"), false);
});

test("get returns a valid data URL and marks a vanished file missing", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  const store = Store.createStore(bridge);
  await store.boot({});
  assert.strictEqual(await store.get("img_a"), DATA);
  bridge.files.delete("img_a");
  assert.strictEqual(await store.get("img_a"), null);
  assert.strictEqual(store.has("img_a"), false);
  assert.strictEqual(store.isKnownMissing("img_a"), true);
  assert.strictEqual(store.stats().count, 0);
});

test("a malformed data URL read is treated as missing", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", "data:image/jpeg;base64,@@@");
  const store = Store.createStore(bridge);
  await store.boot({});
  assert.strictEqual(store.has("img_a"), true);
  assert.strictEqual(await store.get("img_a"), null);
  assert.strictEqual(store.has("img_a"), false);
  assert.strictEqual(store.isKnownMissing("img_a"), true);
});

test("read IO errors are mapped and the id is removed from the index", async function () {
  const bridge = makeBridge({ readOk: false });
  seed(bridge, "img_a", DATA);
  const store = Store.createStore(bridge);
  await store.boot({});
  assert.strictEqual(await store.get("img_a"), null);
  assert.strictEqual(store.isKnownMissing("img_a"), true);
  assert.strictEqual(store.lastError(), "图片文件读写失败。");
});

test("loadMany dedupes, ignores bad ids and reports missing files", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  seed(bridge, "img_b", DATA2);
  const store = Store.createStore(bridge);
  await store.boot({});
  const result = await store.loadMany(["img_a", "img_a", "BAD", "img_b", "img_c"]);
  assert.deepStrictEqual(Object.keys(result.data).sort(), ["img_a", "img_b"]);
  assert.strictEqual(result.data.img_a, DATA);
  assert.strictEqual(result.data.img_b, DATA2);
  assert.deepStrictEqual(result.missing, ["img_c"]);
});

test("loadMany reads at most eight unique ids in input order", async function () {
  const bridge = makeBridge();
  for (let i = 1; i <= 10; i += 1) {
    seed(bridge, "img_" + String(i).padStart(2, "0"), DATA);
  }
  const store = Store.createStore(bridge);
  await store.boot({});
  const ids = Array.from(bridge.files.keys());
  const result = await store.loadMany(ids);
  assert.strictEqual(Object.keys(result.data).length, 8);
  assert.deepStrictEqual(result.missing, []);
  const reads = bridge.calls.filter(function (one) {
    return one.command === "agent_attachment_read";
  });
  assert.strictEqual(reads.length, 8);
  assert.deepStrictEqual(reads.map(function (one) { return one.args.id; }), ids.slice(0, 8));
});

test("refreshIndex clears the negative cache when a file comes back", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  const store = Store.createStore(bridge);
  await store.boot({});
  bridge.files.delete("img_a");
  await store.get("img_a");
  assert.strictEqual(store.has("img_a"), false);
  assert.strictEqual(store.isKnownMissing("img_a"), true);
  seed(bridge, "img_a", DATA);
  await store.refreshIndex();
  assert.strictEqual(store.has("img_a"), true);
  assert.strictEqual(store.isKnownMissing("img_a"), false);
});

test("prune reports its result and refreshes the index", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  const store = Store.createStore(bridge);
  await store.boot({});
  const result = await store.prune();
  assert.strictEqual(result.removed, 1);
  assert.strictEqual(result.removedBytes, 100);
  assert.deepStrictEqual(commands(bridge),
    ["agent_attachment_index", "agent_attachment_prune", "agent_attachment_index"]);
});

test("clearAll deletes files, refreshes the index and reports failures", async function () {
  const bridge = makeBridge();
  seed(bridge, "img_a", DATA);
  seed(bridge, "img_b", DATA2);
  const store = Store.createStore(bridge);
  await store.boot({});
  const result = await store.clearAll();
  assert.strictEqual(result.removed, 2);
  assert.deepStrictEqual(result.failed, []);
  assert.strictEqual(bridge.files.size, 0);
  assert.strictEqual(store.stats().count, 0);
  assert.deepStrictEqual(commands(bridge),
    ["agent_attachment_index", "agent_attachment_clear", "agent_attachment_index"]);
});

test("prune and clear surface bridge errors as skipped results", async function () {
  const pruneBridge = makeBridge({ pruneOk: false });
  const pruneStore = Store.createStore(pruneBridge);
  await pruneStore.boot({});
  const pruned = await pruneStore.prune();
  assert.strictEqual(pruned.skipped, true);
  assert.strictEqual(pruned.reason, "图片文件读写失败。");

  const clearBridge = makeBridge({ clearOk: false });
  const clearStore = Store.createStore(clearBridge);
  await clearStore.boot({});
  const cleared = await clearStore.clearAll();
  assert.strictEqual(cleared.skipped, true);
  assert.strictEqual(cleared.reason, "图片文件读写失败。");
  assert.deepStrictEqual(cleared.failed, []);
});

test("writes are serialized and flush waits for every queued put", async function () {
  const bridge = makeBridge({ putDelay: 20 });
  const store = Store.createStore(bridge);
  await store.boot({});
  const first = store.put("img_a", DATA);
  const second = store.put("img_b", DATA2);
  await store.flush();
  const results = await Promise.all([first, second]);
  assert.strictEqual(results[0].ok, true);
  assert.strictEqual(results[1].ok, true);
  assert.strictEqual(bridge.maxActivePuts(), 1, "写入必须串行");
  assert.strictEqual(bridge.files.size, 2);
  assert.strictEqual(store.stats().count, 2);
});

test("flush also waits for a write queued while it is already waiting", async function () {
  const bridge = makeBridge({ putDelay: 20 });
  const store = Store.createStore(bridge);
  await store.boot({});
  const first = store.put("img_a", DATA);
  const flushed = store.flush();
  let second = null;
  setTimeout(function () {
    second = store.put("img_b", DATA2);
  }, 5);
  await flushed;
  await first;
  await second;
  assert.strictEqual(bridge.files.size, 2, "关窗冲刷期间新排入的写入也要等完");
});

test("putMany queues every image before flush checks pending writes", async function () {
  const bridge = makeBridge({ putDelay: 20 });
  const store = Store.createStore(bridge);
  await store.boot({});
  const batch = store.putMany([
    { id: "img_a", dataUrl: DATA },
    { id: "img_b", dataUrl: DATA2 },
    { id: "img_c", dataUrl: DATA }
  ]);
  await store.flush();
  const result = await batch;
  assert.strictEqual(result.saved, 3);
  assert.strictEqual(result.failed.length, 0);
  assert.strictEqual(bridge.files.size, 3, "flush 返回时整批图片都必须已派发并写完");
  assert.strictEqual(bridge.maxActivePuts(), 1, "整批写入仍然串行");
});

(async function run() {
  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log("  ok  " + item.name);
    } catch (err) {
      failed += 1;
      console.error("FAIL  " + item.name);
      console.error(err.stack || err);
      process.exitCode = 1;
    }
  }
  console.log("agent-attachment-store.js: " + passed + " passed" +
    (failed ? "，" + failed + " failed" : ""));
})().catch(function (err) {
  console.error(err.stack || err);
  process.exit(1);
});
