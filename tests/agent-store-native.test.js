"use strict";

const assert = require("assert");

const native = { text: "", saves: [], path: "C:/Users/test/AppData/Roaming/test/agent.json" };

global.JujinPlatform = {
  isDesktop: () => true,
  nativeReady: () => true,
  registerFlusher() {},
  call(command, args) {
    if (command === "agent_store_load") {
      return Promise.resolve({
        path: native.path,
        backupPath: native.path + ".bak",
        text: native.text
      });
    }
    if (command === "agent_store_save") {
      native.text = args.json;
      native.saves.push(args.json);
      return Promise.resolve({ path: native.path, bytes: args.json.length });
    }
    return Promise.resolve(null);
  }
};

require("../web/assets/agent/prompt.js");
require("../web/assets/agent/attachments.js");
require("../web/assets/agent/tree.js");
require("../web/assets/agent/store.js");
const S = global.JujinAgentStore;
const T = global.JujinAgentTree;
assert.ok(S, "store.js should expose JujinAgentStore");
assert.ok(T, "tree.js should expose JujinAgentTree");

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

function findSession(projectId, sid) {
  const workspace = S.getWorkspace(projectId);
  return workspace && workspace.sessions.filter((one) => one.sid === sid)[0];
}

test("native load selects native mode and reports paths", async () => {
  const status = await S.load();
  assert.strictEqual(status.mode, "native");
  assert.strictEqual(S.status().mode, "native");
  assert.strictEqual(S.status().path, native.path);
  assert.strictEqual(S.status().backupPath, native.path + ".bak");
});

test("native serialize keeps thumbnails and writes them through agent_store_save", async () => {
  const thumb = "data:image/jpeg;base64," + "A".repeat(400);
  const session = S.createSession("workspace-native");
  T.appendRound(session, {
    user: {
      text: "看图",
      attachments: [{
        id: "img_native", kind: "image", mime: "image/jpeg", name: "record.jpg",
        w: 800, h: 600, bytes: 120000, thumb, transcript: "站1：后视 1.234"
      }]
    },
    assistant: { text: "收到" }
  });
  const text = S.serialize();
  const parsed = JSON.parse(text);
  const stored = parsed.workspaces["workspace-native"].sessions
    .filter((one) => one.sid === session.sid)[0];
  assert.strictEqual(stored.nodes[0].user.attachments[0].thumb, thumb);
  assert.strictEqual(stored.nodes[0].user.attachments[0].transcript, "站1：后视 1.234");
  await S.flush();
  assert.ok(native.saves.length >= 1);
  const saved = JSON.parse(native.saves[native.saves.length - 1]);
  const savedSession = saved.workspaces["workspace-native"].sessions
    .filter((one) => one.sid === session.sid)[0];
  assert.strictEqual(savedSession.nodes[0].user.attachments[0].thumb, thumb);
  assert.strictEqual(S.status().lastSave.path, native.path);
});

test("native reload restores attachment fields from the saved JSON", async () => {
  const status = await S.load();
  assert.strictEqual(status.mode, "native");
  const workspace = S.getWorkspace("workspace-native");
  assert.ok(workspace);
  const session = workspace.sessions[0];
  const attachment = session.nodes[0].user.attachments[0];
  assert.strictEqual(attachment.id, "img_native");
  assert.strictEqual(attachment.kind, "image");
  assert.strictEqual(attachment.w, 800);
  assert.strictEqual(attachment.h, 600);
  assert.ok(attachment.thumb.indexOf("data:image/jpeg;base64,") === 0);
  assert.strictEqual(attachment.transcript, "站1：后视 1.234");
});

test("native budget stays 12 MB even when the same text would bust localStorage", () => {
  // 两个会话各 2 个节点，总量约 5.9 MB UTF-16（会超 localStorage 的 4.5 MiB），
  // 但 UTF-8 约 8.8 MB，仍在原生 12 MB 之内，因此一个步骤都不该丢。
  const bloat = "测".repeat(1000);
  const heavySteps = Array.from({ length: 12 }, () => ({
    tool: "survey_write_table",
    status: "done",
    summary: bloat,
    edits: Array.from({ length: 40 }, (_, i) => ({ cell: "c" + i, before: bloat, after: "1" })),
    undo: Array.from({ length: 20 }, (_, i) => ({
      table: "traverse", page: 1, cells: [{ cell: "c" + i, before: bloat, after: "1" }]
    }))
  }));
  const stamps = ["2020-01-01T00:00:00.000Z", "2020-02-01T00:00:00.000Z"];
  const sessions = stamps.map((stamp, index) => {
    const session = S.createSession("workspace-native-budget");
    session.createdAt = stamp;
    [0, 1].forEach((nodeIndex) => {
      session.nodes.push({
        nid: "n" + index + "-" + nodeIndex,
        user: { text: "q" + index },
        assistant: { text: "答" + index, steps: JSON.parse(JSON.stringify(heavySteps)) }
      });
    });
    return session;
  });
  const text = S.serialize();
  assert.ok(text.length * 2 > 4.5 * 1024 * 1024, text.length * 2);
  assert.ok(Buffer.byteLength(text, "utf8") <= 12 * 1024 * 1024);
  const parsed = JSON.parse(text);
  const stored = parsed.workspaces["workspace-native-budget"].sessions;
  const oldest = stored.filter((one) => one.sid === sessions[0].sid)[0];
  const newest = stored.filter((one) => one.sid === sessions[1].sid)[0];
  assert.strictEqual(oldest.nodes[0].assistant.steps.length, 12);
  assert.strictEqual(oldest.nodes[1].assistant.steps.length, 12);
  assert.strictEqual(newest.nodes[0].assistant.steps.length, 12);
  assert.strictEqual(newest.nodes[1].assistant.steps.length, 12);
  assert.strictEqual(findSession("workspace-native-budget", sessions[0].sid).nodes[0].assistant.steps.length, 12);
});

(async function main() {
  console.log("agent-store native tests");
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
  console.log("agent-store-native.js: " + passed + " passed");
  if (process.exitCode) process.exit(process.exitCode);
})();
