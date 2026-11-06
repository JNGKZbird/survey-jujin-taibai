"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "jujin-web-lite-"));
const SINGLE = path.join(OUT, "测量学局劲-轻量版.html");
const CORE = [
  "sheet-data.js",
  "calc-traverse.js",
  "calc-leveling.js",
  "calc-angle-distance.js",
  "calc-summary.js",
  "calc-traverse-calc.js",
  "store.js",
  "transfer.js",
  "error-bands.js",
  "platform.js",
  "linkage.js",
  "app.js",
  "shell.js"
];

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

function read(relative) {
  return fs.readFileSync(path.join(OUT, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(OUT, relative));
}

function walk(dir) {
  const result = [];
  (function visit(current) {
    fs.readdirSync(current, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else result.push(full);
    });
  })(dir);
  return result;
}

function assertParses(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

let buildResult = null;
try {
  console.log("web-lite build tests");
  buildResult = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools", "build_web_lite.js"), "--out", OUT],
    { encoding: "utf8" }
  );

  test("build exits cleanly", () => {
    assert.strictEqual(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  });

  test("build emits the folder edition and the single file", () => {
    assert.ok(exists("index.html"));
    assert.ok(exists("LICENSE"));
    assert.ok(exists(path.basename(SINGLE)));
    assert.ok(fs.statSync(SINGLE).size > 500000);
  });

  test("agent, editor, KaTeX and font assets are absent", () => {
    assert.ok(!exists("assets/agent"));
    assert.ok(!exists("assets/agent.css"));
    assert.ok(!exists("assets/vendor"));
    assert.ok(!exists("assets/fonts"));
    const files = walk(OUT);
    assert.ok(files.every((file) => !/\.woff2?$/i.test(file)), "no font files");
    assert.ok(files.every((file) => !/[\\/]agent[\\/]/.test(file)), "no agent directory");
  });

  test("index.html has no Agent tab, stage, note or inputs", () => {
    const html = read("index.html");
    assert.ok(!html.includes('id="assistant"'));
    assert.ok(!html.includes('id="ai-tab"'));
    assert.ok(!html.includes('data-module="assistant"'));
    assert.ok(!html.includes('id="module-note"'));
    assert.ok(!html.includes('id="agent-image-input"'));
    assert.ok(!html.includes("agent.css"));
    assert.ok(!html.includes("katex"));
    assert.ok(!html.includes("assets/agent/"));
    assert.ok(!html.includes("lite:drop"));
  });

  test("no HarmonyOS font names or @font-face remain anywhere", () => {
    walk(OUT).forEach(function (file) {
      const text = fs.readFileSync(file, "utf8");
      assert.ok(!text.includes("HarmonyOS"), file + " still mentions HarmonyOS");
      assert.ok(!text.includes("@font-face"), file + " still has @font-face");
    });
  });

  test("CSS and inline SVG use the system font stack", () => {
    const css = read("assets/style.css");
    assert.ok(css.includes("system-ui"));
    assert.ok(css.includes('"Segoe UI"'));
    assert.ok(!css.includes("fonts/"));
    const data = read("assets/sheet-data.js");
    assert.ok(data.includes("system-ui"));
  });

  test("app.js no longer carries the Agent bridge", () => {
    const app = read("assets/app.js");
    assert.ok(!app.includes("JujinSheetAgent"));
    assert.ok(!app.includes("installAgentBridge"));
    assert.ok(!app.includes("lite:drop"));
    assert.ok(app.includes("__sheetApp"));
    assert.ok(app.includes("__JUJIN_LITE_ON_EXPORT__"));
  });

  test("core scripts exist in document order with web-lite before app.js", () => {
    const html = read("index.html");
    let last = -1;
    CORE.forEach(function (name) {
      const tag = '<script src="assets/' + name + '"></script>';
      const index = html.indexOf(tag);
      assert.ok(index > last, name + " missing or out of order");
      last = index;
    });
    const lite = html.indexOf('<script src="assets/web-lite.js"></script>');
    const app = html.indexOf('<script src="assets/app.js"></script>');
    assert.ok(lite >= 0 && lite < app, "web-lite.js must load before app.js");
  });

  test("every external reference in index.html resolves inside the output", () => {
    const html = read("index.html");
    const refs = html.match(/(?:src|href)="([^"]+)"/g) || [];
    refs.forEach(function (token) {
      const value = token.replace(/^[^"]+"/, "").replace(/"$/, "");
      if (value.startsWith("data:") || value.startsWith("#")) return;
      assert.ok(exists(value), "missing referenced file: " + value);
    });
  });

  test("single file is self-contained and embeds the license", () => {
    const html = fs.readFileSync(SINGLE, "utf8");
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes('name="license" content="MulanPSL-2.0"'));
    assert.ok(html.includes('id="license-text"'));
    assert.ok(html.includes("木兰宽松许可证， 第2版"));
    assert.ok(html.includes("Mulan Permissive Software License, Version 2"));
    assert.ok(!/(?:src|href)="assets\//.test(html));
    assert.ok(!/(?:src|href)="https?:/.test(html));
    assert.ok(html.includes("<style>"));
    assert.ok(html.includes("__JUJIN_LITE__"));
  });

  test("generated JavaScript parses", () => {
    CORE.concat(["theme.js", "web-lite.js"]).forEach(function (name) {
      assertParses(path.join(OUT, "assets", name));
    });
  });

  test("lite runtime marks the build and guards data loss", () => {
    const code = read("assets/web-lite.js");
    assert.ok(code.includes("__JUJIN_LITE__ = true"));
    assert.ok(code.includes("navigator.storage.persist"));
    assert.ok(code.includes("survey-jujin.web.first-seen.v1"));
    assert.ok(code.includes("survey-jujin.web.last-export.v1"));
    assert.ok(code.includes("addEventListener(\"storage\""));
    assert.ok(code.includes("FileReader"));
    assert.ok(code.includes("importText"));
  });
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}

console.log("web-lite build: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
