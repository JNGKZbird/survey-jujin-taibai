"use strict";

const assert = require("assert");
require("../web/assets/agent/prompt.js");
require("../web/assets/agent/attachments.js");
require("../web/assets/agent/tree.js");
const T = global.JujinAgentTree;
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

function round(text, answer) {
  return {
    user: { text, attachments: [] },
    assistant: { text: answer || "", reason: "", model: "deepseek-flash", steps: [], stats: null, error: null }
  };
}

console.log("agent-tree tests");

test("newSession carries the session-level settings and persona snapshot", () => {
  const s = T.newSession("proj-1", {
    model: "deepseek-flash",
    thinkingLevel: "max",
    permissionMode: "auto",
    contextSize: 12,
    searchEnabled: false,
    personaId: "p1",
    personaName: "测量老师",
    personaPrompt: "严格。"
  });
  assert.strictEqual(s.projectId, "proj-1");
  assert.strictEqual(s.model, "deepseek-flash");
  assert.strictEqual(s.thinkingLevel, "max");
  assert.strictEqual(s.permissionMode, "auto");
  assert.strictEqual(s.contextSize, 12);
  assert.strictEqual(s.searchEnabled, false);
  assert.strictEqual(s.personaName, "测量老师");
  assert.strictEqual(s.personaPrompt, "严格。");
  assert.deepStrictEqual(s.nodes, []);
  assert.deepStrictEqual(s.path, []);
  assert.strictEqual(s.title, "新对话");
});

test("appendRound chains parent, children and path", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("第一问", "第一答"));
  const b = T.appendRound(s, round("第二问", "第二答"));
  assert.strictEqual(a.parent, null);
  assert.strictEqual(b.parent, a.nid);
  assert.deepStrictEqual(a.children, [b.nid]);
  assert.deepStrictEqual(s.rootIds, [a.nid]);
  assert.deepStrictEqual(s.path, [a.nid, b.nid]);
  assert.strictEqual(s.title, "第一问");
  assert.strictEqual(s.titled, true);
});

test("appendRound does not overwrite a manually titled session", () => {
  const s = T.newSession("p", {});
  s.title = "我自己的标题";
  s.titled = true;
  T.appendRound(s, round("新的问题"));
  assert.strictEqual(s.title, "我自己的标题");
});

test("activeNodes follows the saved path, not array order", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  s.path = [a.nid];
  assert.deepStrictEqual(T.activeNodes(s).map((n) => n.nid), [a.nid]);
  assert.strictEqual(T.lastNode(s).nid, a.nid);
  s.path = [a.nid, b.nid];
  assert.strictEqual(T.lastNode(s).nid, b.nid);
});

test("updateAssistant and updateUser replace values without losing the node", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问"));
  T.updateAssistant(s, a.nid, { text: "答", reason: "想", stats: { elapsedMs: 12 } });
  T.updateUser(s, a.nid, { text: "改问" });
  const node = T.nodeById(s, a.nid);
  assert.strictEqual(node.assistant.text, "答");
  assert.strictEqual(node.assistant.reason, "想");
  assert.deepStrictEqual(node.assistant.stats, { elapsedMs: 12 });
  assert.strictEqual(node.user.text, "改问");
});

test("normalizeSession rebuilds a missing path to the last leaf", () => {
  const raw = {
    sid: "s1",
    title: "旧会话",
    nodes: [
      { nid: "a", parent: null, children: ["b"], user: { text: "A" } },
      { nid: "b", parent: "a", children: ["c"], user: { text: "B" } },
      { nid: "c", parent: "b", children: [], user: { text: "C" } }
    ],
    path: [],
    rootIds: ["a"]
  };
  const s = T.normalizeSession(raw, "p");
  assert.deepStrictEqual(s.path, ["a", "b", "c"]);
});

test("normalizeSession extends a truncated path to the last leaf", () => {
  const raw = {
    sid: "s1",
    nodes: [
      { nid: "a", parent: null, children: ["b"], user: { text: "A" } },
      { nid: "b", parent: "a", children: [], user: { text: "B" } }
    ],
    path: ["a"]
  };
  const s = T.normalizeSession(raw, "p");
  assert.deepStrictEqual(s.path, ["a", "b"]);
});

test("normalizeSession removes orphans and repairs rootIds", () => {
  const raw = {
    sid: "s1",
    nodes: [
      { nid: "a", parent: null, children: ["missing"], user: { text: "A" } },
      { nid: "b", parent: "missing", children: [], user: { text: "B" } }
    ],
    rootIds: ["a", "missing"],
    path: ["missing"]
  };
  const s = T.normalizeSession(raw, "p");
  assert.deepStrictEqual(s.nodes.map((n) => n.nid), ["a", "b"]);
  assert.strictEqual(T.nodeById(s, "b").parent, null);
  assert.deepStrictEqual(s.rootIds, ["a", "b"]);
  assert.deepStrictEqual(s.path, ["b"]);
});

test("normalizeSession deduplicates node ids and drops bad child links", () => {
  const raw = {
    sid: "s1",
    nodes: [
      { nid: "a", parent: null, children: ["a", "b"], user: { text: "A" } },
      { nid: "a", parent: null, children: [], user: { text: "duplicate" } },
      { nid: "b", parent: "a", children: [], user: { text: "B" } }
    ],
    path: ["a", "b"]
  };
  const s = T.normalizeSession(raw, "p");
  assert.strictEqual(s.nodes.length, 2);
  assert.deepStrictEqual(T.nodeById(s, "a").children, ["b"]);
  assert.deepStrictEqual(s.path, ["a", "b"]);
});

test("normalizeSession repairs an invalid permission mode and missing persona", () => {
  const s = T.normalizeSession({ sid: "s", permissionMode: "root", nodes: [] }, "p");
  assert.strictEqual(s.permissionMode, "manual");
  assert.strictEqual(s.personaPrompt, global.JujinAgentPrompt.BASE_PERSONA);
});

test("pathTo returns root-to-node order and null for a missing node", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  assert.deepStrictEqual(T.pathTo(s, b.nid), [a.nid, b.nid]);
  assert.deepStrictEqual(T.pathTo(s, a.nid), [a.nid]);
  assert.strictEqual(T.pathTo(s, "missing"), null);
});

test("pathTo refuses a parent cycle instead of hanging", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  T.nodeById(s, a.nid).parent = b.nid;
  assert.strictEqual(T.pathTo(s, b.nid), null);
});

test("siblingsOf keeps parent child order and appends a missing self", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  const f = T.forkRound(s, b.nid);
  assert.deepStrictEqual(T.siblingsOf(s, b.nid).map((n) => n.nid), [b.nid, f.nid]);
  T.nodeById(s, a.nid).children = [];
  assert.deepStrictEqual(T.siblingsOf(s, b.nid).map((n) => n.nid), [b.nid]);
});

test("siblingsOf handles roots and filters dangling ids", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const f = T.forkRound(s, a.nid);
  s.rootIds = [a.nid, "ghost", f.nid, a.nid];
  assert.deepStrictEqual(T.siblingsOf(s, f.nid).map((n) => n.nid), [a.nid, f.nid]);
  assert.deepStrictEqual(T.branchIndex(s, f.nid), { index: 2, total: 2 });
  assert.deepStrictEqual(T.branchIndex(s, a.nid), { index: 1, total: 2 });
  assert.deepStrictEqual(T.branchIndex(s, "missing"), { index: 0, total: 0 });
});

test("forkRound on a middle round keeps the old subtree and truncates the path", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b = T.appendRound(s, round("B", "答B"));
  const c = T.appendRound(s, round("C", "答C"));
  const f = T.forkRound(s, b.nid);
  assert.deepStrictEqual(s.path, [a.nid, f.nid]);
  assert.deepStrictEqual(T.nodeById(s, a.nid).children, [b.nid, f.nid]);
  assert.deepStrictEqual(T.nodeById(s, b.nid).children, [c.nid]);
  assert.strictEqual(T.nodeById(s, f.nid).parent, a.nid);
  assert.strictEqual(T.nodeById(s, f.nid).user.text, "B");
  assert.strictEqual(T.nodeById(s, f.nid).assistant.text, "");
  assert.strictEqual(T.nodeById(s, c.nid).parent, b.nid);
});

test("forkRound on a root adds a root sibling and respects the title rule", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("第一问"));
  s.titled = false;
  s.title = "新对话";
  const f = T.forkRound(s, a.nid, { user: { text: "改问" } });
  assert.deepStrictEqual(s.rootIds, [a.nid, f.nid]);
  assert.deepStrictEqual(s.path, [f.nid]);
  assert.strictEqual(f.parent, null);
  assert.strictEqual(s.title, "改问");
  assert.strictEqual(s.titled, true);
  T.appendRound(s, round("后续"));
  assert.strictEqual(s.title, "改问");
});

test("forkRound deep-copies attachments and accepts edited text", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const thumb = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ4cGQAAAABJRU5ErkJggg==";
  a.user.attachments = [{
    id: "img_a", kind: "image", mime: "image/png", name: "x.png",
    w: 100, h: 80, bytes: 1000, thumb, transcript: "读数 1.234",
    dataUrl: thumb
  }];
  const f = T.forkRound(s, a.nid);
  assert.notStrictEqual(f.user.attachments, a.user.attachments);
  assert.notStrictEqual(f.user.attachments[0], a.user.attachments[0]);
  assert.strictEqual(f.user.attachments[0].id, "img_a");
  assert.strictEqual(f.user.attachments[0].transcript, "读数 1.234");
  assert.strictEqual(f.user.attachments[0].dataUrl, undefined);
  f.user.attachments[0].transcript = "改过";
  assert.strictEqual(a.user.attachments[0].transcript, "读数 1.234");
  const g = T.forkRound(s, a.nid, { user: { text: "改问" } });
  assert.strictEqual(g.user.text, "改问");
  assert.strictEqual(g.user.attachments[0].id, "img_a");
  assert.strictEqual(g.user.attachments[0].dataUrl, undefined);
});

test("forkRound refuses missing sources and cycles without mutating", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  assert.strictEqual(T.forkRound(s, "missing"), null);
  T.nodeById(s, a.nid).parent = b.nid;
  const before = JSON.stringify(s);
  assert.strictEqual(T.forkRound(s, a.nid), null);
  assert.strictEqual(JSON.stringify(s), before);
});

test("switchBranch follows the first child and leaves updatedAt alone", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b1 = T.appendRound(s, round("B1", "答B1"));
  const c1 = T.appendRound(s, round("C1", "答C1"));
  s.path = [a.nid];
  const b2 = T.forkRound(s, b1.nid);
  s.path = [a.nid, b1.nid, c1.nid];
  s.updatedAt = "STAMP";
  assert.strictEqual(T.switchBranch(s, b2.nid), true);
  assert.deepStrictEqual(s.path, [a.nid, b2.nid]);
  assert.strictEqual(s.updatedAt, "STAMP");
  assert.strictEqual(T.switchBranch(s, b1.nid), true);
  assert.deepStrictEqual(s.path, [a.nid, b1.nid, c1.nid]);
  assert.strictEqual(s.updatedAt, "STAMP");
});

test("switchBranch can select a sibling root", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  const f = T.forkRound(s, a.nid);
  s.path = [a.nid, b.nid];
  assert.strictEqual(T.switchBranch(s, f.nid), true);
  assert.deepStrictEqual(s.path, [f.nid]);
});

test("switchBranch rejects missing targets and parent cycles, and survives a self child", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b = T.appendRound(s, round("B"));
  const before = s.path.slice();
  assert.strictEqual(T.switchBranch(s, "missing"), false);
  assert.deepStrictEqual(s.path, before);
  T.nodeById(s, a.nid).parent = b.nid;
  T.nodeById(s, b.nid).parent = a.nid;
  const cyclic = s.path.slice();
  assert.strictEqual(T.switchBranch(s, a.nid), false);
  assert.deepStrictEqual(s.path, cyclic);
  T.nodeById(s, a.nid).parent = null;
  T.nodeById(s, a.nid).children = [a.nid];
  assert.strictEqual(T.switchBranch(s, a.nid), true);
  assert.deepStrictEqual(s.path, [a.nid]);
});

test("resetAssistant clears the answer but keeps the question and timestamps", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问"));
  T.updateAssistant(s, a.nid, {
    text: "答",
    reason: "想",
    steps: [{ tool: "x" }],
    stats: { elapsedMs: 1 },
    error: { code: "e" }
  });
  const user = JSON.stringify(a.user);
  const time = a.time;
  s.updatedAt = "OLD";
  const out = T.resetAssistant(s, a.nid, { model: "m2" });
  assert.strictEqual(out, a);
  assert.strictEqual(a.assistant.text, "");
  assert.strictEqual(a.assistant.reason, "");
  assert.deepStrictEqual(a.assistant.steps, []);
  assert.strictEqual(a.assistant.stats, null);
  assert.strictEqual(a.assistant.error, null);
  assert.strictEqual(a.assistant.model, "m2");
  assert.strictEqual(JSON.stringify(a.user), user);
  assert.strictEqual(a.time, time);
  assert.notStrictEqual(s.updatedAt, "OLD");
});

test("regenerateRound resets an empty leaf and forks everything else", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  let out = T.regenerateRound(s, a.nid, { model: "m" });
  assert.strictEqual(out.mode, "reset");
  assert.strictEqual(out.node.nid, a.nid);
  assert.strictEqual(s.nodes.length, 1);
  a.assistant.text = "答";
  out = T.regenerateRound(s, a.nid, { model: "m" });
  assert.strictEqual(out.mode, "fork");
  assert.strictEqual(s.nodes.length, 2);
  assert.deepStrictEqual(s.path, [out.node.nid]);
  assert.deepStrictEqual(s.rootIds, [a.nid, out.node.nid]);

  const s2 = T.newSession("p", {});
  const root = T.appendRound(s2, round("根"));
  T.appendRound(s2, round("子"));
  out = T.regenerateRound(s2, root.nid);
  assert.strictEqual(out.mode, "fork");
  assert.strictEqual(s2.nodes.length, 3);
  assert.strictEqual(T.regenerateRound(s2, "missing"), null);
});

test("appendRound after a switch attaches to the newly selected leaf", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  const b1 = T.appendRound(s, round("B1"));
  const c1 = T.appendRound(s, round("C1"));
  s.path = [a.nid];
  const b2 = T.forkRound(s, b1.nid);
  T.switchBranch(s, b1.nid);
  const d = T.appendRound(s, round("D"));
  assert.strictEqual(d.parent, c1.nid);
  assert.deepStrictEqual(s.path, [a.nid, b1.nid, c1.nid, d.nid]);
  T.switchBranch(s, b2.nid);
  const e = T.appendRound(s, round("E"));
  assert.strictEqual(e.parent, b2.nid);
  assert.deepStrictEqual(s.path, [a.nid, b2.nid, e.nid]);
});

test("normalize keeps an explicit first-child path while repair still uses the last child", () => {
  const raw = {
    sid: "s1",
    nodes: [
      { nid: "a", parent: null, children: ["b1", "b2"], user: { text: "A" } },
      { nid: "b1", parent: "a", children: ["c1", "c2"], user: { text: "B1" } },
      { nid: "b2", parent: "a", children: [], user: { text: "B2" } },
      { nid: "c1", parent: "b1", children: [], user: { text: "C1" } },
      { nid: "c2", parent: "b1", children: [], user: { text: "C2" } }
    ],
    path: ["a", "b1", "c1"],
    rootIds: ["a"]
  };
  const s = T.normalizeSession(raw, "p");
  assert.deepStrictEqual(s.path, ["a", "b1", "c1"]);
  const repaired = T.normalizeSession(Object.assign({}, raw, { path: ["a", "b1"] }), "p");
  assert.deepStrictEqual(repaired.path, ["a", "b1", "c2"]);
  const switched = T.normalizeSession(raw, "p");
  switched.path = ["a"];
  assert.strictEqual(T.switchBranch(switched, "b1"), true);
  assert.deepStrictEqual(switched.path, ["a", "b1", "c1"]);
});

test("newSession defaults to Work and accepts Chat", () => {
  assert.strictEqual(T.newSession("p", {}).agentMode, "work");
  assert.strictEqual(T.newSession("p", { agentMode: "chat" }).agentMode, "chat");
  assert.strictEqual(T.newSession("p", { agentMode: "unknown" }).agentMode, "work");
});

test("normalizeSession keeps Chat and safely defaults unknown modes to Work", () => {
  assert.strictEqual(T.normalizeSession({ agentMode: "chat" }, "p").agentMode, "chat");
  assert.strictEqual(T.normalizeSession({}, "p").agentMode, "work");
  assert.strictEqual(T.normalizeSession({ agentMode: "root" }, "p").agentMode, "work");
});

test("pathText renders only the active path", () => {
  const s = T.newSession("p", {});
  T.appendRound(s, round("A", "答A"));
  const b = T.appendRound(s, round("B", "答B"));
  const text = T.pathText(s);
  assert.ok(text.indexOf("用户：A") !== -1);
  assert.ok(text.indexOf("用户：B") !== -1);
  s.path = [b.nid];
  const only = T.pathText(s);
  assert.strictEqual(only.indexOf("用户：A"), -1);
  assert.ok(only.indexOf("用户：B") !== -1);
});

function sessionWithAssistant(assistant) {
  return {
    sid: "s-step",
    nodes: [{
      nid: "n1",
      parent: null,
      children: [],
      user: { text: "问题" },
      assistant: assistant
    }],
    path: ["n1"],
    rootIds: ["n1"]
  };
}

test("normalizeAssistant keeps only the persisted step whitelist", () => {
  const raw = {
    sid: "s-step-whitelist",
    nodes: [{
      nid: "n1",
      parent: null,
      children: [],
      user: { text: "写表" },
      assistant: {
        text: "完成",
        reason: "想一下",
        model: "deepseek-flash",
        steps: [{
          tool: "survey_write_table",
          status: "done",
          args: { table: "traverse", page: 1, edits: [{ cell: "s1-r1-h", value: "1°2′3″" }] },
          summary: "写表 · 表一 · 第 1 页",
          error: "无",
          edits: [{ cell: "s1-r1-h", before: "", after: "1°2′3″" }],
          undo: [{ table: "traverse", page: 1, pageHash: "abc", cells: [{ cell: "s1-r1-h", before: "", after: "1°2′3″" }] }],
          textBefore: "先读后写。",
          expanded: true,
          startedAt: "2026-11-04T00:00:00.000Z",
          finishedAt: "2026-11-04T00:00:01.000Z",
          undone: false,
          content: "不应保留",
          call: { id: "c1", function: { name: "survey_write_table", arguments: "{\"table\":\"traverse\"}" } },
          previewToken: "tok-1",
          snapshot: { cells: { huge: "x".repeat(64) } },
          rawArguments: "{\"table\":\"traverse\"}",
          name: "survey_write_table"
        }]
      }
    }],
    path: ["n1"],
    rootIds: ["n1"]
  };
  const assistant = T.normalizeSession(raw, "p").nodes[0].assistant;
  assert.deepStrictEqual(Object.keys(assistant).sort(), ["error", "model", "reason", "stats", "steps", "text"]);
  const step = assistant.steps[0];
  assert.deepStrictEqual(Object.keys(step).sort(), [
    "args", "edits", "error", "expanded", "finishedAt", "startedAt",
    "status", "summary", "textBefore", "tool", "undo", "undone"
  ].sort());
  assert.strictEqual(step.call, undefined);
  assert.strictEqual(step.content, undefined);
  assert.strictEqual(step.previewToken, undefined);
  assert.strictEqual(step.snapshot, undefined);
  assert.strictEqual(step.rawArguments, undefined);
  assert.strictEqual(step.name, undefined);
  assert.deepStrictEqual(step.args, { table: "traverse", page: 1, edits: [{ cell: "s1-r1-h", value: "1°2′3″" }] });
  assert.deepStrictEqual(step.undo, [{ table: "traverse", page: 1, pageHash: "abc", cells: [{ cell: "s1-r1-h", before: "", after: "1°2′3″" }] }]);
});

test("normalizeAssistant keeps only safe source metadata in step.results", () => {
  const results = [{
    title: "题".repeat(300),
    url: "https://www.example.com/a#frag",
    site: "spoofed.example",
    date: "2026-11-01",
    summary: "不应保留",
    content: "不应保留",
    rerank_score: 0.9
  }, {
    title: "duplicate",
    url: "https://www.example.com/a#other",
    site: "example.com"
  }, {
    title: "bad scheme",
    url: "javascript:alert(1)"
  }, {
    title: "private",
    url: "http://10.0.0.1/secret"
  }, {
    title: "userinfo",
    url: "https://user:pass@example.com/"
  }, {
    title: "",
    url: "https://b.example.com/x"
  }];
  const raw = sessionWithAssistant({
    steps: [{ tool: "web_search", status: "done", results: results }]
  });
  const step = T.normalizeSession(raw, "p").nodes[0].assistant.steps[0];
  assert.deepStrictEqual(Object.keys(step).sort(), ["results", "status", "tool"]);
  assert.strictEqual(step.results.length, 2);
  assert.strictEqual(Buffer.byteLength(step.results[0].title, "utf8") <= 200, true);
  assert.strictEqual(step.results[0].site, "example.com");
  assert.strictEqual(step.results[0].date, "2026-11-01");
  assert.strictEqual(step.results[0].summary, undefined);
  assert.strictEqual(step.results[0].content, undefined);
  assert.deepStrictEqual(Object.keys(step.results[0]).sort(), ["date", "site", "title", "url"]);
  assert.deepStrictEqual(Object.keys(step.results[1]).sort(), ["site", "title", "url"]);
  assert.strictEqual(step.results[1].title, "b.example.com");
});

test("normalizeAssistant drops an all-invalid results list entirely", () => {
  const raw = sessionWithAssistant({
    steps: [{
      tool: "web_search",
      status: "error",
      results: [{ title: "x", url: "file:///C:/secret" }]
    }]
  });
  const step = T.normalizeSession(raw, "p").nodes[0].assistant.steps[0];
  assert.strictEqual(step.results, undefined);
});

test("normalizeAssistant caps step.results at eight entries", () => {
  const results = Array.from({ length: 12 }, (_, i) => ({
    title: "t" + i,
    url: "https://example.com/" + i,
    site: "example.com"
  }));
  const raw = sessionWithAssistant({
    steps: [{ tool: "web_search", status: "done", results: results }]
  });
  const step = T.normalizeSession(raw, "p").nodes[0].assistant.steps[0];
  assert.strictEqual(step.results.length, 8);
  assert.strictEqual(step.results[7].title, "t7");
});

test("normalizeAssistant maps transient statuses to interrupted and keeps applying undo", () => {
  const undo = [{ table: "traverse", page: 1, pageHash: "h", cells: [{ cell: "a", before: "", after: "1" }] }];
  const statuses = ["pending", "awaiting", "running", "applying", "done", "error", "canceled"];
  const raw = sessionWithAssistant({
    text: "收尾",
    steps: statuses.map((status, index) => ({
      tool: "tool-" + index,
      status,
      undo: status === "applying" ? undo : undefined,
      previewToken: status === "awaiting" ? "tok" : undefined
    }))
  });
  const assistant = T.normalizeSession(raw, "p").nodes[0].assistant;
  assert.deepStrictEqual(assistant.steps.map((step) => step.status), [
    "interrupted", "interrupted", "interrupted", "interrupted", "done", "error", "canceled"
  ]);
  assert.deepStrictEqual(assistant.steps[3].undo, undo);
  assert.deepStrictEqual(assistant.steps[1].undo, undefined);
  assert.strictEqual(assistant.steps[1].previewToken, undefined);
  assert.ok(assistant.steps.every((step) => step.status !== "awaiting"));
});

test("normalizeAssistant caps steps, textBefore, reason, edits, error and undo", () => {
  const finalText = "终".repeat(5000);
  const steps = [];
  for (let i = 0; i < 44; i += 1) steps.push({ tool: "t" + i, status: "done" });
  steps.push({
    tool: "survey_write_table",
    status: "done",
    textBefore: "型".repeat(4000),
    edits: Array.from({ length: 50 }, (_, i) => ({ cell: "c" + i, before: "", after: "1" })),
    error: "错".repeat(2000),
    undo: Array.from({ length: 30 }, (_, i) => ({ id: i }))
  });
  const raw = sessionWithAssistant({
    text: finalText,
    reason: "想".repeat(8000),
    steps
  });
  const assistant = T.normalizeSession(raw, "p").nodes[0].assistant;
  assert.strictEqual(assistant.steps.length, 40);
  assert.strictEqual(assistant.steps[0].tool, "t5");
  assert.strictEqual(assistant.steps[39].tool, "survey_write_table");
  assert.ok(Buffer.byteLength(assistant.steps[39].textBefore, "utf8") <= 8 * 1024);
  assert.ok(Buffer.byteLength(assistant.reason, "utf8") <= 20 * 1024);
  assert.ok(Buffer.byteLength(assistant.steps[39].error, "utf8") <= 2 * 1024);
  assert.strictEqual(assistant.steps[39].edits.length, 40);
  assert.strictEqual(assistant.steps[39].edits[0].cell, "c0");
  assert.strictEqual(assistant.steps[39].edits[39].cell, "c39");
  assert.strictEqual(assistant.steps[39].undo.length, 20);
  assert.strictEqual(assistant.steps[39].undo[0].id, 10);
  assert.strictEqual(assistant.steps[39].undo[19].id, 29);
  assert.strictEqual(assistant.text, finalText);
});

test("normalizeAssistant redacts secrets in persisted args, summary, edits, undo and error", () => {
  const dataUrl = "data:image/jpeg;base64," + "A".repeat(400);
  const raw = sessionWithAssistant({
    steps: [{
      tool: "survey_write_table",
      status: "done",
      args: {
        table: "traverse",
        page: 1,
        edits: [{ cell: "s1-r1-h", value: dataUrl }],
        note: "sk-abcdefgh12345678"
      },
      summary: "Bearer abc.def.ghi " + "x".repeat(3000),
      edits: [{ cell: "s1-r1-h", before: dataUrl, after: "1" }],
      undo: [{ table: "traverse", page: 1, cells: [{ cell: "s1-r1-h", before: dataUrl }] }],
      error: dataUrl
    }]
  });
  const step = T.normalizeSession(raw, "p").nodes[0].assistant.steps[0];
  const text = JSON.stringify(step);
  assert.strictEqual(text.indexOf("base64,"), -1);
  assert.strictEqual(text.indexOf("sk-abcdefgh"), -1);
  assert.strictEqual(text.indexOf("Bearer abc.def.ghi"), -1);
  assert.ok(Buffer.byteLength(step.summary, "utf8") <= 2 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(step), "utf8") <= 48 * 1024);
  assert.strictEqual(step.args.table, "traverse");
  assert.strictEqual(step.args.page, 1);
});

test("normalizeAssistant drops an oversized append undo instead of persisting a huge baseline", () => {
  const baseline = {};
  for (let i = 0; i < 10; i += 1) baseline["c" + i] = "测".repeat(2000);
  const raw = sessionWithAssistant({
    steps: [{
      tool: "survey_append_table_page",
      status: "applied",
      undo: {
        table: "traverse",
        pageIndex: 2,
        pageHash: "h",
        baseline: baseline
      }
    }]
  });
  const step = T.normalizeSession(raw, "p").nodes[0].assistant.steps[0];
  assert.strictEqual(step.undo, undefined);
  assert.strictEqual(step.status, "applied");
});

test("normalizeAssistant drops non-object steps and tolerates a non-array steps value", () => {
  const assistant = T.normalizeSession(sessionWithAssistant({
    steps: [null, "x", 7, [], { tool: "ok", status: "done" }, {}]
  }), "p").nodes[0].assistant;
  assert.deepStrictEqual(assistant.steps.map((step) => step.tool), ["ok"]);
  assert.deepStrictEqual(T.normalizeSession(sessionWithAssistant({ steps: "bad" }), "p")
    .nodes[0].assistant.steps, []);
});

function imageAttachment(id, extra) {
  return Object.assign({
    id: id,
    kind: "image",
    mime: "image/jpeg",
    name: id + ".jpg",
    w: 640,
    h: 480,
    bytes: 2048,
    thumb: "",
    transcript: "读数 1.234"
  }, extra || {});
}

test("deleteMessageSide clears the user side and keeps the assistant orphan", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问", "答"));
  T.updateUser(s, a.nid, { attachments: [imageAttachment("img_a")] });
  T.updateAssistant(s, a.nid, {
    reason: "想", steps: [{ tool: "x" }], stats: { elapsedMs: 1 }, error: { code: "e" }
  });
  const out = T.deleteMessageSide(s, a.nid, "user");
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.roundDeleted, false);
  assert.strictEqual(a.user.text, "");
  assert.deepStrictEqual(a.user.attachments, []);
  assert.strictEqual(a.assistant.text, "答");
  assert.strictEqual(a.assistant.reason, "想");
  assert.strictEqual(a.assistant.steps.length, 1);
  assert.strictEqual(s.nodes.length, 1);
  assert.strictEqual(T.userHasContent(a), false);
  assert.strictEqual(T.assistantVisible(a), true);
});

test("deleteMessageSide clears the whole assistant block and keeps the user side", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问", "答"));
  T.updateUser(s, a.nid, { attachments: [imageAttachment("img_a")] });
  T.updateAssistant(s, a.nid, {
    reason: "想", steps: [{ tool: "x" }], stats: { elapsedMs: 1 }, error: { code: "e" }
  });
  const out = T.deleteMessageSide(s, a.nid, "assistant");
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.roundDeleted, false);
  assert.strictEqual(a.assistant.text, "");
  assert.strictEqual(a.assistant.reason, "");
  assert.strictEqual(a.assistant.model, "");
  assert.deepStrictEqual(a.assistant.steps, []);
  assert.strictEqual(a.assistant.stats, null);
  assert.strictEqual(a.assistant.error, null);
  assert.strictEqual(a.user.text, "问");
  assert.strictEqual(a.user.attachments.length, 1);
  assert.strictEqual(s.nodes.length, 1);
});

test("deleteMessageSide deletes the round when the other side is empty", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("只有提问", ""));
  const out = T.deleteMessageSide(s, a.nid, "user");
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.roundDeleted, true);
  assert.strictEqual(out.deleteMode, "leaf");
  assert.strictEqual(s.nodes.length, 0);
  assert.deepStrictEqual(s.path, []);
  assert.deepStrictEqual(s.rootIds, []);
});

test("deleteMessageSide keeps an error-only assistant orphan", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问", ""));
  a.assistant.error = { code: "x", hint: "失败" };
  const out = T.deleteMessageSide(s, a.nid, "user");
  assert.strictEqual(out.roundDeleted, false);
  assert.strictEqual(s.nodes.length, 1);
  assert.strictEqual(a.assistant.error.code, "x");
});

test("deleteRound on a leaf with a previous sibling switches to that branch", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b1 = T.appendRound(s, round("B1", "答B1"));
  const c1 = T.appendRound(s, round("C1", "答C1"));
  s.path = [a.nid];
  const b2 = T.forkRound(s, b1.nid);
  assert.deepStrictEqual(s.path, [a.nid, b2.nid]);
  const out = T.deleteRound(s, b2.nid);
  assert.strictEqual(out.mode, "leaf");
  assert.strictEqual(out.removedCount, 1);
  assert.strictEqual(out.pathMoved, true);
  assert.deepStrictEqual(s.path, [a.nid, b1.nid, c1.nid]);
  assert.deepStrictEqual(T.nodeById(s, a.nid).children, [b1.nid]);
  assert.strictEqual(T.nodeById(s, c1.nid).parent, b1.nid);
});

test("deleteRound on a leaf with no sibling stays on the parent", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b = T.appendRound(s, round("B", "答B"));
  const out = T.deleteRound(s, b.nid);
  assert.strictEqual(out.mode, "leaf");
  assert.deepStrictEqual(s.path, [a.nid]);
  assert.deepStrictEqual(T.nodeById(s, a.nid).children, []);
  assert.strictEqual(T.nodeById(s, b.nid), null);
});

test("deleteRound on a non-active leaf leaves the active path alone", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b1 = T.appendRound(s, round("B1", "答B1"));
  const c1 = T.appendRound(s, round("C1", "答C1"));
  s.path = [a.nid];
  const b2 = T.forkRound(s, b1.nid);
  s.path = [a.nid, b1.nid, c1.nid];
  const before = s.path.slice();
  const out = T.deleteRound(s, b2.nid);
  assert.strictEqual(out.mode, "leaf");
  assert.strictEqual(out.pathMoved, false);
  assert.deepStrictEqual(s.path, before);
  assert.strictEqual(s.nodes.indexOf(b2), -1);
});

test("deleteRound relinks a single child through its parent", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b = T.appendRound(s, round("B", "答B"));
  const c = T.appendRound(s, round("C", "答C"));
  const out = T.deleteRound(s, b.nid);
  assert.strictEqual(out.mode, "relink");
  assert.strictEqual(out.branches, 1);
  assert.strictEqual(out.removedCount, 1);
  assert.deepStrictEqual(s.nodes.map((n) => n.nid), [a.nid, c.nid]);
  assert.strictEqual(T.nodeById(s, c.nid).parent, a.nid);
  assert.deepStrictEqual(T.nodeById(s, a.nid).children, [c.nid]);
  assert.deepStrictEqual(s.path, [a.nid, c.nid]);
});

test("deleteRound promotes a root's single child and keeps root order", () => {
  const s = T.newSession("p", {});
  const root1 = T.appendRound(s, round("根一", "答"));
  const child = T.appendRound(s, round("子", "答"));
  const root2 = T.forkRound(s, root1.nid, { user: { text: "根二" } });
  assert.deepStrictEqual(s.rootIds, [root1.nid, root2.nid]);
  assert.deepStrictEqual(s.path, [root2.nid]);
  const out = T.deleteRound(s, root1.nid);
  assert.strictEqual(out.mode, "relink");
  assert.strictEqual(out.pathMoved, false);
  assert.deepStrictEqual(s.rootIds, [child.nid, root2.nid]);
  assert.strictEqual(T.nodeById(s, child.nid).parent, null);
  assert.deepStrictEqual(s.path, [root2.nid]);
  assert.strictEqual(T.nodeById(s, child.nid).children.length, 0);
});

test("deleteRound on an active anchor removes the subtree and switches to a root sibling", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b1 = T.appendRound(s, round("B1", "答B1"));
  const c1 = T.appendRound(s, round("C1", "答C1"));
  s.path = [a.nid];
  const b2 = T.forkRound(s, b1.nid);
  s.path = [a.nid, b1.nid, c1.nid];
  const c2 = T.forkRound(s, c1.nid);
  assert.deepStrictEqual(s.path, [a.nid, b1.nid, c2.nid]);
  assert.deepStrictEqual(T.nodeById(s, b1.nid).children, [c1.nid, c2.nid]);
  const out = T.deleteRound(s, b1.nid);
  assert.strictEqual(out.mode, "anchor");
  assert.strictEqual(out.branches, 2);
  assert.strictEqual(out.removedCount, 3);
  assert.deepStrictEqual(s.nodes.map((n) => n.nid), [a.nid, b2.nid]);
  assert.deepStrictEqual(T.nodeById(s, a.nid).children, [b2.nid]);
  assert.deepStrictEqual(s.path, [a.nid, b2.nid]);
  assert.strictEqual(T.nodeById(s, c1.nid), null);
  assert.strictEqual(T.nodeById(s, c2.nid), null);
});

test("deleteRound on an anchor without siblings stops on the parent", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b = T.appendRound(s, round("B", "答B"));
  const c1 = T.appendRound(s, round("C1", "答C1"));
  s.path = [a.nid, b.nid];
  const c2 = T.forkRound(s, c1.nid);
  assert.deepStrictEqual(s.path, [a.nid, b.nid, c2.nid]);
  const out = T.deleteRound(s, b.nid);
  assert.strictEqual(out.mode, "anchor");
  assert.deepStrictEqual(s.nodes.map((n) => n.nid), [a.nid]);
  assert.deepStrictEqual(s.path, [a.nid]);
});

test("deleteRound keeps reloaded structure valid and does not invent a deleted field", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A", "答A"));
  const b = T.appendRound(s, round("B", "答B"));
  const c = T.appendRound(s, round("C", "答C"));
  T.deleteRound(s, b.nid);
  const reloaded = T.normalizeSession(JSON.parse(JSON.stringify(s)), "p");
  assert.deepStrictEqual(reloaded.nodes.map((n) => n.nid), [a.nid, c.nid]);
  assert.strictEqual(reloaded.nodes.some((n) => "deleted" in n), false);
  reloaded.nodes.forEach((node) => {
    node.children.forEach((id) => assert.ok(T.nodeById(reloaded, id)));
  });
  assert.deepStrictEqual(reloaded.path, [a.nid, c.nid]);
  assert.strictEqual(T.pathTo(reloaded, reloaded.path[reloaded.path.length - 1]).length,
    reloaded.path.length);
});

test("editRoundContent edits user text and replaces attachments in place", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("旧问", ""));
  T.updateUser(s, a.nid, { attachments: [imageAttachment("img_old")] });
  const beforeCount = s.nodes.length;
  s.updatedAt = "OLD";
  const out = T.editRoundContent(s, a.nid, "user", "新问", [{
    id: "img_new",
    kind: "image",
    mime: "image/jpeg",
    name: "new.jpg",
    w: 100,
    h: 80,
    bytes: 900,
    thumb: "",
    transcript: "新读数",
    dataUrl: "data:image/jpeg;base64,AAAA",
    path: "C:/secret.jpg",
    unknown: true
  }]);
  assert.strictEqual(out, a);
  assert.strictEqual(a.user.text, "新问");
  assert.strictEqual(a.user.attachments.length, 1);
  assert.strictEqual(a.user.attachments[0].id, "img_new");
  assert.strictEqual(a.user.attachments[0].dataUrl, undefined);
  assert.strictEqual(a.user.attachments[0].path, undefined);
  assert.strictEqual(a.user.attachments[0].unknown, undefined);
  assert.strictEqual(s.nodes.length, beforeCount);
  assert.notStrictEqual(s.updatedAt, "OLD");
  const unchanged = T.editRoundContent(s, a.nid, "user", "只改文字");
  assert.strictEqual(unchanged.user.attachments.length, 1);
  assert.strictEqual(unchanged.user.attachments[0].id, "img_new");
});

test("editRoundContent edits assistant text and keeps the rest of the block", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问", "旧答"));
  T.updateAssistant(s, a.nid, {
    reason: "思考", steps: [{ tool: "x", status: "done" }],
    stats: { elapsedMs: 12 }, error: { code: "e", hint: "旧错误" }
  });
  const out = T.editRoundContent(s, a.nid, "assistant", "新答");
  assert.strictEqual(out, a);
  assert.strictEqual(a.assistant.text, "新答");
  assert.strictEqual(a.assistant.reason, "思考");
  assert.strictEqual(a.assistant.steps.length, 1);
  assert.deepStrictEqual(a.assistant.stats, { elapsedMs: 12 });
  assert.strictEqual(a.assistant.error.hint, "旧错误");
  assert.strictEqual(T.editRoundContent(s, a.nid, "bad", "x"), null);
  assert.strictEqual(T.editRoundContent(s, "missing", "user", "x"), null);
});

test("deleteMessageSide then editRoundContent restores a side without a deleted flag", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问", "答"));
  T.deleteMessageSide(s, a.nid, "user");
  assert.strictEqual(a.user.text, "");
  T.editRoundContent(s, a.nid, "user", "重新写的问题", [imageAttachment("img_new")]);
  assert.strictEqual(a.user.text, "重新写的问题");
  assert.strictEqual(a.user.attachments.length, 1);
  assert.strictEqual("deleted" in a, false);
  const reloaded = T.normalizeSession(JSON.parse(JSON.stringify(s)), "p");
  assert.strictEqual(reloaded.nodes[0].user.text, "重新写的问题");
  assert.strictEqual(reloaded.nodes[0].assistant.text, "答");
});

test("forkRound and updateUser normalize explicit attachments", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("A"));
  T.updateUser(s, a.nid, {
    attachments: [{
      id: "img_x", kind: "image", mime: "image/jpeg", name: "x.jpg",
      w: 100, h: 80, bytes: 500, thumb: "", transcript: "t",
      dataUrl: "data:image/jpeg;base64,AAAA", localPath: "D:/x.jpg"
    }]
  });
  assert.strictEqual(a.user.attachments[0].dataUrl, undefined);
  assert.strictEqual(a.user.attachments[0].localPath, undefined);
  const f = T.forkRound(s, a.nid, {
    user: {
      text: "改",
      attachments: [{
        id: "img_y", kind: "image", mime: "image/png", name: "y.png",
        w: 10, h: 20, bytes: 30, thumb: "", transcript: "", dataUrl: "data:image/png;base64,AAAA"
      }]
    }
  });
  assert.strictEqual(f.user.attachments.length, 1);
  assert.strictEqual(f.user.attachments[0].id, "img_y");
  assert.strictEqual(f.user.attachments[0].dataUrl, undefined);
});

test("regenerateRound refuses an empty user side but allows image-only rounds", () => {
  const s = T.newSession("p", {});
  const a = T.appendRound(s, round("问", "答"));
  T.deleteMessageSide(s, a.nid, "user");
  assert.strictEqual(T.regenerateRound(s, a.nid), null);

  const imageOnly = T.newSession("p", {});
  const b = T.appendRound(imageOnly, round("", ""));
  T.updateUser(imageOnly, b.nid, { attachments: [imageAttachment("img_only")] });
  const out = T.regenerateRound(imageOnly, b.nid, { model: "m" });
  assert.strictEqual(out.mode, "reset");
  assert.strictEqual(out.node.nid, b.nid);

  const withContent = T.newSession("p", {});
  const c = T.appendRound(withContent, round("", "答"));
  T.updateUser(withContent, c.nid, { attachments: [imageAttachment("img_only")] });
  const forked = T.regenerateRound(withContent, c.nid, { model: "m" });
  assert.strictEqual(forked.mode, "fork");
  assert.strictEqual(forked.node.user.attachments.length, 1);
});

test("normalizeSession keeps orphan rounds in both directions", () => {
  const raw = {
    sid: "s-orphan",
    nodes: [
      { nid: "a", parent: null, children: ["b"], user: { text: "问" }, assistant: { text: "" } },
      { nid: "b", parent: "a", children: [], user: { text: "", attachments: [] }, assistant: { text: "答" } }
    ],
    path: ["a", "b"],
    rootIds: ["a"]
  };
  const s = T.normalizeSession(raw, "p");
  assert.strictEqual(s.nodes.length, 2);
  assert.strictEqual(T.userHasContent(s.nodes[0]), true);
  assert.strictEqual(T.assistantVisible(s.nodes[0]), false);
  assert.strictEqual(T.userHasContent(s.nodes[1]), false);
  assert.strictEqual(T.assistantVisible(s.nodes[1]), true);
  assert.strictEqual(JSON.stringify(s).indexOf("\"deleted\""), -1);
});

console.log("agent-tree.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
