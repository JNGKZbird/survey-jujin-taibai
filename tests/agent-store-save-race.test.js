"use strict";

/* 写入期间产生的新改动不能被旧写入的成功回调清成 clean。
   本文件单独起一个 Node 进程，用可控的假原生平台复现这个时序。 */

const assert = require("assert");

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const pending = [];
let saveCalls = 0;
global.JujinPlatform = {
  isDesktop: () => true,
  nativeReady: () => true,
  registerFlusher: () => {},
  call(name, params) {
    if (name === "agent_store_load") {
      return Promise.resolve({
        path: "C:/tmp/agent.json",
        backupPath: "C:/tmp/agent.json.bak",
        text: ""
      });
    }
    if (name === "agent_store_save") {
      saveCalls += 1;
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject, json: params && params.json });
      });
    }
    return Promise.reject(new Error("unexpected call: " + name));
  }
};

require("../web/assets/agent/prompt.js");
require("../web/assets/agent/attachments.js");
require("../web/assets/agent/tree.js");
require("../web/assets/agent/store.js");
const S = global.JujinAgentStore;
assert.ok(S, "store.js should expose JujinAgentStore");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

(async function run() {
  await S.load();
  assert.strictEqual(S.status().mode, "native");

  S.updateSettings({ model: "m1" });
  const first = S.flush();
  assert.strictEqual(S.status().pending, 1);
  await tick();
  assert.strictEqual(pending.length, 1);

  // 第一次写盘还没回来时又改了设置。
  S.updateSettings({ model: "m2" });
  assert.strictEqual(S.status().dirty, true);

  pending[0].resolve({ mode: "native", bytes: 1 });
  await first;
  assert.strictEqual(S.getSettings().model, "m2");
  assert.strictEqual(S.status().dirty, true,
    "写盘期间的新改动不能被这次成功回调清成 clean");
  assert.strictEqual(S.status().pending, 0);

  const second = S.flush();
  await tick();
  assert.strictEqual(pending.length, 2);
  assert.ok(String(pending[1].json).indexOf('"m2"') !== -1,
    "第二次写盘必须带上最新值");
  pending[1].resolve({ mode: "native", bytes: 1 });
  await second;
  assert.strictEqual(S.status().dirty, false);

  // 失败时保持 dirty，关窗冲刷还能重试。
  S.updateSettings({ model: "m3" });
  const third = S.flush();
  await tick();
  assert.strictEqual(pending.length, 3);
  pending[2].reject(new Error("disk full"));
  await third.catch(() => {});
  assert.strictEqual(S.status().dirty, true, "写盘失败后必须保持 dirty");
  assert.ok(String(S.status().error || "").indexOf("保存失败") !== -1);

  const retry = S.flush();
  await tick();
  assert.strictEqual(pending.length, 4, "关窗冲刷应重试失败的改动");
  assert.ok(String(pending[3].json).indexOf('"m3"') !== -1);
  pending[3].resolve({ mode: "native", bytes: 1 });
  await retry;
  assert.strictEqual(S.status().dirty, false);
  assert.strictEqual(saveCalls, 4);

  console.log("agent-store save race: 1 passed");
  process.exit(0);
})().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
