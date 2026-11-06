"use strict";

const assert = require("assert");

const memory = new Map();
global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); }
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

S.load();

function customPersonas() {
  return S.getPersonas().filter((p) => !p.builtin);
}

console.log("agent-store tests");

test("fresh store has schema v1 and the locked builtin persona", () => {
  assert.strictEqual(S.VERSION, 1);
  const s = S.getSettings();
  assert.strictEqual(s.providerId, "deepseek");
  assert.strictEqual(s.model, "deepseek-flash");
  assert.strictEqual(s.thinkingLevel, "high");
  assert.strictEqual(s.agentMode, "work");
  assert.strictEqual(s.permissionMode, "manual");
  assert.strictEqual(s.contextSize, 20);
  assert.strictEqual(s.personas.length, 1);
  assert.strictEqual(s.personas[0].id, S.BUILTIN_ID);
  assert.strictEqual(s.personas[0].prompt, "You are a helpful assistant.");
  assert.strictEqual(s.personas[0].builtin, true);
  assert.strictEqual(s.activePersonaId, S.BUILTIN_ID);
  assert.strictEqual(S.status().loaded, true);
  assert.strictEqual(S.status().mode, "local");
});

test("settings normalize out-of-range and unknown values", () => {
  S.updateSettings({
    providerId: "BAD ID",
    contextSize: 999,
    maxToolRounds: 0,
    agentMode: "root",
    permissionMode: "root",
    thinkingLevel: "ultra",
    baseUrl: "  https://example.com/v1  ",
    model: "  m1  ",
    searchEnabled: false
  });
  const s = S.getSettings();
  assert.strictEqual(s.providerId, "deepseek");
  assert.strictEqual(s.contextSize, 100);
  assert.strictEqual(s.maxToolRounds, 1);
  assert.strictEqual(s.agentMode, "work");
  assert.strictEqual(s.permissionMode, "manual");
  assert.strictEqual(s.thinkingLevel, "high");
  assert.strictEqual(s.baseUrl, "https://example.com/v1");
  assert.strictEqual(s.model, "m1");
  assert.strictEqual(s.searchEnabled, false);
  S.updateSettings({ baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", searchEnabled: true });
});

test("image settings normalize and origin acknowledgements are bounded", () => {
  S.updateSettings({
    imageSupport: "always",
    imageDisclosureAcks: [
      "https://api.deepseek.com",
      "HTTPS://API.DEEPSEEK.COM",
      "http://127.0.0.1:8080",
      "not-a-url",
      "https://example.com/path",
      42,
      "  https://custom.example  "
    ]
  });
  const s = S.getSettings();
  assert.strictEqual(s.imageSupport, "auto");
  assert.deepStrictEqual(s.imageDisclosureAcks, [
    "https://api.deepseek.com",
    "http://127.0.0.1:8080",
    "https://custom.example"
  ]);
  S.updateSettings({ imageDisclosureAcks: [], imageSupport: "auto" });
});

test("builtin persona cannot be overwritten or deleted", () => {
  assert.deepStrictEqual(S.savePersona({ id: S.BUILTIN_ID, name: "x", prompt: "y" }), { ok: false, reason: "builtin" });
  assert.deepStrictEqual(S.deletePersona(S.BUILTIN_ID), { ok: false, reason: "builtin" });
  assert.strictEqual(S.getPersona(S.BUILTIN_ID).prompt, "You are a helpful assistant.");
});

test("a 3000-character persona is saved without truncation", () => {
  const prompt = "字".repeat(3000);
  const result = S.savePersona({ id: "p-long", name: "长人格", prompt });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.persona.prompt.length, 3000);
  assert.strictEqual(S.getPersona("p-long").prompt.length, 3000);
  const text = S.serialize();
  assert.ok(text.indexOf("p-long") !== -1);
  assert.ok(text.length > 3000);
});

test("active persona is used as a snapshot when a session is created", () => {
  S.setActivePersona("p-long");
  const session = S.createSession("workspace-a");
  assert.ok(session);
  assert.strictEqual(session.personaId, "p-long");
  assert.strictEqual(session.personaName, "长人格");
  assert.strictEqual(session.personaPrompt.length, 3000);
  S.setActivePersona(S.BUILTIN_ID);
});

test("switching persona updates the current session snapshot only", () => {
  const pid = "workspace-persona-switch";
  S.setActivePersona(S.BUILTIN_ID);
  const first = S.createSession(pid);
  const second = S.createSession(pid);
  assert.strictEqual(first.personaId, S.BUILTIN_ID);
  const result = S.applyPersonaToSession(pid, second.sid, "p-long");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.session.personaId, "p-long");
  assert.strictEqual(S.getSession(pid, second.sid).personaName, "长人格");
  assert.strictEqual(S.getSession(pid, second.sid).personaPrompt.length, 3000);
  assert.strictEqual(S.getSession(pid, first.sid).personaId, S.BUILTIN_ID);
  assert.strictEqual(S.getSession(pid, first.sid).personaName, "通用助手");
  S.setActivePersona(S.BUILTIN_ID);
});

test("applying a persona rejects unknown workspace, session or persona", () => {
  const pid = "workspace-persona-missing";
  const session = S.createSession(pid);
  const before = JSON.stringify(session);
  assert.deepStrictEqual(S.applyPersonaToSession("workspace-nope", session.sid, "p-long"), { ok: false, reason: "workspace" });
  assert.deepStrictEqual(S.applyPersonaToSession(pid, "sid-nope", "p-long"), { ok: false, reason: "session" });
  assert.deepStrictEqual(S.applyPersonaToSession(pid, session.sid, "p-nope"), { ok: false, reason: "persona" });
  assert.strictEqual(JSON.stringify(session), before);
});

test("saving a persona updates every conversation that uses it", () => {
  const pidA = "workspace-persona-all-a";
  const pidB = "workspace-persona-all-b";
  assert.strictEqual(S.savePersona({ id: "p-all", name: "全员人格", prompt: "旧提示词" }).ok, true);
  S.setActivePersona("p-all");
  const a1 = S.createSession(pidA);
  const a2 = S.createSession(pidA);
  const b1 = S.createSession(pidB);
  S.setActivePersona(S.BUILTIN_ID);
  const plain = S.createSession(pidB);
  assert.strictEqual(S.savePersona({ id: "p-all", name: "全员人格改", prompt: "新提示词" }).ok, true);
  const result = S.applyPersonaToAllSessions("p-all");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updated, 3);
  assert.strictEqual(result.matched, 3);
  assert.strictEqual(S.getSession(pidA, a1.sid).personaName, "全员人格改");
  assert.strictEqual(S.getSession(pidA, a2.sid).personaPrompt, "新提示词");
  assert.strictEqual(S.getSession(pidB, b1.sid).personaName, "全员人格改");
  assert.strictEqual(S.getSession(pidB, plain.sid).personaId, S.BUILTIN_ID);
  assert.strictEqual(S.getSession(pidB, plain.sid).personaName, "通用助手");
  const again = S.applyPersonaToAllSessions("p-all");
  assert.strictEqual(again.updated, 0);
  assert.strictEqual(again.matched, 3);
});

test("applyPersonaToAllSessions rejects unknown personas and reports zero matches", () => {
  assert.deepStrictEqual(S.applyPersonaToAllSessions("p-nope"),
    { ok: false, reason: "persona", updated: 0, matched: 0 });
  assert.strictEqual(S.savePersona({ id: "p-unused", name: "未使用", prompt: "x" }).ok, true);
  const none = S.applyPersonaToAllSessions("p-unused");
  assert.strictEqual(none.ok, true);
  assert.strictEqual(none.updated, 0);
  assert.strictEqual(none.matched, 0);
});

test("sessions are isolated by workspace", () => {
  const a = S.createSession("iso-a");
  const b = S.createSession("iso-b");
  assert.notStrictEqual(a.sid, b.sid);
  assert.strictEqual(S.getSessions("iso-a").length, 1);
  assert.strictEqual(S.getSessions("iso-b").length, 1);
  assert.strictEqual(S.getActiveSession("iso-a").sid, a.sid);
  assert.strictEqual(S.getActiveSession("iso-b").sid, b.sid);
  assert.strictEqual(S.getSession("iso-a", b.sid), null);
});

test("active session switching and deletion stay inside the workspace", () => {
  const first = S.createSession("workspace-c");
  const second = S.createSession("workspace-c");
  assert.strictEqual(S.getActiveSession("workspace-c").sid, second.sid);
  assert.strictEqual(S.setActiveSession("workspace-c", first.sid).sid, first.sid);
  assert.deepStrictEqual(S.deleteSession("workspace-c", first.sid), { ok: true });
  assert.strictEqual(S.getActiveSession("workspace-c").sid, second.sid);
  S.clearSessions("workspace-c");
  assert.deepStrictEqual(S.getSessions("workspace-c"), []);
});

test("deleting the active persona falls back to the builtin", () => {
  S.savePersona({ id: "p-temp", name: "临时", prompt: "临时人格" });
  S.setActivePersona("p-temp");
  assert.strictEqual(S.getActivePersona().id, "p-temp");
  assert.deepStrictEqual(S.deletePersona("p-temp"), { ok: true });
  assert.strictEqual(S.getActivePersona().id, S.BUILTIN_ID);
});

test("persona count is capped at 50 including the builtin", () => {
  let custom = customPersonas().length;
  let index = 0;
  while (custom < 49) {
    const result = S.savePersona({ id: "p-fill-" + index, name: "填充" + index, prompt: "x" });
    assert.strictEqual(result.ok, true);
    custom += 1;
    index += 1;
  }
  assert.strictEqual(S.getPersonas().length, 50);
  const overflow = S.savePersona({ id: "p-overflow", name: "溢出", prompt: "x" });
  assert.deepStrictEqual(overflow, { ok: false, reason: "limit" });
  assert.strictEqual(S.getPersonas().length, 50);
});

test("deleting a workspace removes only its conversations", () => {
  S.createSession("workspace-b");
  assert.strictEqual(S.getSessions("workspace-a").length, 1);
  assert.strictEqual(S.getSessions("workspace-b").length, 1);
  assert.strictEqual(S.deleteWorkspace("workspace-a"), true);
  assert.strictEqual(S.getSessions("workspace-a").length, 0);
  assert.strictEqual(S.getSessions("workspace-b").length, 1);
});

test("serialized data carries no obvious key material", () => {
  const text = S.serialize();
  assert.strictEqual(text.indexOf("apiKey"), -1);
  assert.strictEqual(text.indexOf("api_key"), -1);
  assert.strictEqual(text.indexOf("Bearer "), -1);
  assert.strictEqual(text.indexOf("sk-"), -1);
  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.version, 1);
  assert.ok(parsed.settings);
  assert.ok(parsed.workspaces);
});

test("branch structure survives serialize and reload", () => {
  const session = S.createSession("workspace-branch");
  const a = T.appendRound(session, { user: { text: "A" }, assistant: { text: "答A" } });
  const b = T.appendRound(session, { user: { text: "B" }, assistant: { text: "答B" } });
  const f = T.forkRound(session, b.nid);
  T.updateAssistant(session, f.nid, { text: "新答" });
  assert.deepStrictEqual(session.path, [a.nid, f.nid]);
  S.touchSession("workspace-branch");
  memory.set(S.KEY, S.serialize());
  S.load();
  const loaded = S.getSession("workspace-branch", session.sid);
  assert.ok(loaded);
  assert.deepStrictEqual(loaded.path, [a.nid, f.nid]);
  assert.deepStrictEqual(loaded.rootIds, [a.nid]);
  assert.deepStrictEqual(T.nodeById(loaded, a.nid).children, [b.nid, f.nid]);
  assert.strictEqual(T.nodeById(loaded, b.nid).user.text, "B");
  assert.strictEqual(T.nodeById(loaded, b.nid).assistant.text, "答B");
  assert.strictEqual(T.nodeById(loaded, f.nid).user.text, "B");
  assert.strictEqual(T.nodeById(loaded, f.nid).assistant.text, "新答");
  assert.strictEqual(JSON.parse(S.serialize()).version, 1);
});

test("new sessions inherit the last chosen agent mode", () => {
  S.updateSettings({ agentMode: "work" });
  const work = S.createSession("workspace-mode");
  assert.strictEqual(work.agentMode, "work");
  S.updateSettings({ agentMode: "chat" });
  const chat = S.createSession("workspace-mode");
  assert.strictEqual(chat.agentMode, "chat");
});

test("corrupt localStorage is quarantined and rebuilt as an empty store", () => {
  memory.set(S.KEY, "{not valid json");
  S.load();
  assert.strictEqual(S.status().corrupt, true);
  assert.strictEqual(S.status().mode, "local");
  assert.strictEqual(S.getSettings().personas.length, 1);
  assert.strictEqual(S.getActivePersona().id, S.BUILTIN_ID);
  const backups = Array.from(memory.keys()).filter((key) => key.indexOf(S.KEY + ".corrupt-") === 0);
  assert.strictEqual(backups.length, 1);
  assert.strictEqual(memory.get(backups[0]), "{not valid json");
  assert.strictEqual(memory.has(S.KEY), false);
});

test("serialize leaves live sessions untouched while keeping persisted steps", () => {
  const session = S.createSession("workspace-serialize");
  const undo = [{ table: "traverse", page: 1, pageHash: "h", cells: [{ cell: "a", before: "", after: "1" }] }];
  T.appendRound(session, {
    user: { text: "Q" },
    assistant: {
      text: "A",
      steps: [{
        tool: "survey_write_table",
        status: "interrupted",
        args: { table: "traverse", page: 1 },
        undo
      }]
    }
  });
  const before = JSON.stringify(session);
  const text = S.serialize();
  assert.strictEqual(JSON.stringify(session), before);
  const parsed = JSON.parse(text);
  const stored = parsed.workspaces["workspace-serialize"].sessions
    .filter((one) => one.sid === session.sid)[0];
  assert.ok(stored);
  assert.strictEqual(stored.nodes[0].assistant.text, "A");
  assert.strictEqual(stored.nodes[0].assistant.steps.length, 1);
  assert.deepStrictEqual(stored.nodes[0].assistant.steps[0].undo, undo);
});

test("local serialization strips thumbnails but keeps transcripts and live data", () => {
  const thumb = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ4cGQAAAABJRU5ErkJggg==";
  const session = S.createSession("workspace-thumbs");
  T.appendRound(session, {
    user: {
      text: "看图",
      attachments: [{
        id: "img_thumb", kind: "image", mime: "image/png", name: "record.png",
        w: 800, h: 600, bytes: 120000, thumb, transcript: "站1：后视 1.234"
      }]
    },
    assistant: { text: "收到" }
  });
  const parsed = JSON.parse(S.serialize());
  const stored = parsed.workspaces["workspace-thumbs"].sessions
    .filter((one) => one.sid === session.sid)[0];
  assert.ok(stored);
  assert.strictEqual(stored.nodes[0].user.attachments[0].thumb, "");
  assert.strictEqual(stored.nodes[0].user.attachments[0].transcript, "站1：后视 1.234");
  assert.strictEqual(session.nodes[0].user.attachments[0].thumb, thumb);
});

test("local serialize trims oldest sessions to the UTF-16 budget without mutating memory", () => {
  // localStorage 按 UTF-16 计，上限 4.5 MiB；直接构造原始节点，避开步骤规整上限。
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
  const projectId = "workspace-trim";
  const stamps = Array.from({ length: 3 }, (_, i) => "2020-0" + (i + 1) + "-01T00:00:00.000Z");
  const sessions = stamps.map((stamp, index) => {
    const session = S.createSession(projectId);
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
  assert.strictEqual(S.status().mode, "local");
  assert.ok(text.length * 2 <= 4.5 * 1024 * 1024, text.length * 2);
  const parsed = JSON.parse(text);
  const stored = parsed.workspaces[projectId].sessions;
  const oldest = stored.filter((one) => one.sid === sessions[0].sid)[0];
  assert.deepStrictEqual(oldest.nodes[0].assistant.steps, []);
  assert.strictEqual(oldest.nodes[0].assistant.text, "答0");
  const middle = stored.filter((one) => one.sid === sessions[1].sid)[0];
  assert.deepStrictEqual(middle.nodes[0].assistant.steps, []);
  const newest = stored.filter((one) => one.sid === sessions[2].sid)[0];
  assert.strictEqual(newest.nodes[0].assistant.steps.length, 12);
  assert.strictEqual(newest.nodes[1].assistant.steps.length, 12);
  assert.strictEqual(newest.nodes[0].assistant.text, "答2");
  // 内存中的原对象没有被裁剪。
  assert.strictEqual(sessions[0].nodes[0].assistant.steps.length, 12);
  assert.ok(sessions[0].nodes[0].assistant.steps[0].summary.indexOf("测") === 0);
  assert.strictEqual(JSON.parse(S.serialize()).version, 1);
});

console.log("agent-store.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
