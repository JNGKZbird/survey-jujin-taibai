#!/usr/bin/env node
/* 测量学局劲工具 · 网页轻量版构建
   从 web/ 生成纯静态产物：目录版 + 单文件版。
   不打包 Agent、KaTeX、字体；只做裁剪、字体替换与内联。 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "web");
const DEFAULT_OUT = path.join(ROOT, "dist-web");
const MARKER = ".jujin-web-lite";
const SINGLE_NAME = "测量学局劲-轻量版.html";

const CORE_SCRIPTS = [
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

const SYSTEM_STACK = 'system-ui, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const SYSTEM_STACK_SINGLE = "system-ui, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";

function fail(message) {
  console.error("[build:web] " + message);
  process.exit(1);
}

function parseArgs(argv) {
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) fail("--out 需要一个目录参数。");
      out = path.resolve(value);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法：node tools/build_web_lite.js [--out 目录]");
      process.exit(0);
    } else {
      fail("未知参数：" + arg);
    }
  }
  return { out };
}

function assertSafeOut(out) {
  const resolved = path.resolve(out);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === ROOT || resolved === SRC) {
    fail("拒绝清理输出目录：" + resolved);
  }
  const rel = path.relative(SRC, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    fail("输出目录不能放在 web/ 里面：" + resolved);
  }
}

function prepareOut(out) {
  if (fs.existsSync(out)) {
    const entries = fs.readdirSync(out);
    if (entries.length &&
        path.basename(out) !== "dist-web" &&
        !fs.existsSync(path.join(out, MARKER))) {
      fail("输出目录非空且不是本工具生成的，拒绝清理：" + out);
    }
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, MARKER), "此目录由 tools/build_web_lite.js 生成，可整体删除后重建。\n", "utf8");
}

function readSource(relative) {
  return fs.readFileSync(path.join(SRC, relative), "utf8");
}

function stripFonts(text) {
  let out = text;
  // 删除 @font-face 块；字体文件不进入产物。
  out = out.replace(/@font-face\s*\{[^}]*\}\s*/g, "");
  // 先换整条字体栈，保留系统字体优先级。
  out = out.replace(/"HarmonyOS Sans SC",\s*"Microsoft YaHei",\s*"PingFang SC",\s*sans-serif/g, SYSTEM_STACK);
  out = out.replace(/"HarmonyOS Sans SC",\s*"Microsoft YaHei",\s*sans-serif/g, SYSTEM_STACK);
  out = out.replace(/'HarmonyOS Sans SC',\s*'Microsoft YaHei',\s*sans-serif/g, SYSTEM_STACK_SINGLE);
  // sheet-data.js 里的 SVG 使用 JSON 转义引号。
  out = out.replace(/\\"HarmonyOS Sans SC\\"/g, "system-ui");
  out = out.replace(/"HarmonyOS Sans SC"/g, "system-ui");
  out = out.replace(/'HarmonyOS Sans SC'/g, "system-ui");
  // 注释与文案中的残余名字。
  out = out.replace(/HarmonyOS Sans SC/g, "系统字体");
  out = out.replace(/HarmonyOS/g, "系统字体");
  return out;
}

function stripAgentBridge(code) {
  let out = code;
  out = out.replace(/\/\* lite:drop:start agent-bridge \*\/[\s\S]*?\/\* lite:drop:end agent-bridge \*\/[ \t]*\r?\n?/g, "");
  out = out.replace(/^[ \t]*installAgentBridge\(\); \/\* lite:drop-line \*\/[ \t]*\r?\n?/gm, "");
  return out;
}

function transformAsset(name, code) {
  let out = code;
  if (/\.(js|css)$/i.test(name)) out = stripFonts(out);
  if (name === "app.js") out = stripAgentBridge(out);
  return out;
}

function buildAssetMap() {
  const names = ["theme.js", "style.css", "web-lite.js"].concat(CORE_SCRIPTS);
  const map = new Map();
  names.forEach(function (name) {
    const source = readSource(path.join("assets", name));
    map.set(name, transformAsset(name, source));
  });
  return map;
}

function stripHtmlBlocks(html) {
  return html.replace(/[ \t]*<!--\s*lite:drop:start[^>]*-->[\s\S]*?<!--\s*lite:drop:end[^>]*-->[ \t]*\r?\n?/g, "");
}

function prepareHtml(html) {
  let out = stripHtmlBlocks(html);
  out = out.replace("<title>测量学局劲工具</title>", "<title>测量学局劲工具 · 网页轻量版</title>");
  out = out.replace(
    '<meta name="color-scheme" content="light dark">',
    '<meta name="color-scheme" content="light dark">\n<meta name="license" content="MulanPSL-2.0">'
  );
  const appTag = '<script src="assets/app.js"></script>';
  if (out.indexOf(appTag) < 0) fail("index.html 中找不到 app.js 脚本标签。");
  out = out.replace(appTag, '<script src="assets/web-lite.js"></script>\n' + appTag);
  if ((out.match(/lite:drop/g) || []).length > 0) fail("index.html 仍有未处理的 lite:drop 标记。");
  return out;
}

function inlineJs(code) {
  return code.replace(/<\/script/gi, "<\\/script");
}

function inlineCss(code) {
  return code.replace(/<\/style/gi, "<\\/style");
}

function toSingleFile(dirHtml, assets) {
  let out = dirHtml;

  const themeTag = '<script src="assets/theme.js"></script>';
  if (out.indexOf(themeTag) < 0) fail("单文件版找不到 theme.js 标签。");
  out = out.replace(themeTag, "<script>\n" + inlineJs(assets.get("theme.js")) + "\n</script>");

  const styleTag = '<link rel="stylesheet" href="assets/style.css">';
  if (out.indexOf(styleTag) < 0) fail("单文件版找不到 style.css 标签。");
  out = out.replace(styleTag, "<style>\n" + inlineCss(assets.get("style.css")) + "\n</style>");

  out = out.replace(/<script src="assets\/([^"]+)"><\/script>/g, function (match, name) {
    if (!assets.has(name)) fail("单文件版缺少脚本：" + name);
    return "<script>\n" + inlineJs(assets.get(name)) + "\n</script>";
  });

  if (/<(?:script|link)\b[^>]*(?:src|href)="assets\//i.test(out)) {
    fail("单文件版仍有指向 assets/ 的外部引用。");
  }

  const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
  if (/<\/script/i.test(license)) fail("LICENSE 含有 </script，无法安全内嵌。");

  const header = "<!--\n" +
    "  测量学局劲工具 · 网页轻量版\n" +
    "  Copyright (c) 2026 JNGKZbird\n" +
    "  Licensed under Mulan PSL v2. Full license text is embedded at the end of this file.\n" +
    "-->";
  out = out.replace("<!doctype html>", "<!doctype html>\n" + header);

  const licenseBlock = '<script type="text/plain" id="license-text">\n' + license + "\n</script>";
  if (out.indexOf("</body>") < 0) fail("单文件版找不到 </body>。");
  out = out.replace("</body>", licenseBlock + "\n</body>");
  return out;
}

function writeAssets(outDir, assets) {
  const dir = path.join(outDir, "assets");
  fs.mkdirSync(dir, { recursive: true });
  assets.forEach(function (code, name) {
    fs.writeFileSync(path.join(dir, name), code, "utf8");
  });
}

function listFiles(dir) {
  const result = [];
  (function walk(current) {
    fs.readdirSync(current, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else result.push(full);
    });
  })(dir);
  return result;
}

function bytesOf(files) {
  return files.reduce(function (sum, file) {
    return sum + fs.statSync(file).size;
  }, 0);
}

function kib(bytes) {
  return (bytes / 1024).toFixed(1) + " KiB";
}

function checkSyntax(outDir) {
  ["app.js", "web-lite.js", "shell.js"].forEach(function (name) {
    const file = path.join(outDir, "assets", name);
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (err) {
      const detail = err && err.stderr ? String(err.stderr) : String(err);
      fail("语法检查失败：" + file + "\n" + detail);
    }
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out;
  assertSafeOut(out);
  prepareOut(out);

  const sourceHtml = readSource("index.html");
  const assets = buildAssetMap();
  const dirHtml = prepareHtml(sourceHtml);

  writeAssets(out, assets);
  fs.writeFileSync(path.join(out, "index.html"), dirHtml, "utf8");

  const single = toSingleFile(dirHtml, assets);
  const singlePath = path.join(out, SINGLE_NAME);
  fs.writeFileSync(singlePath, single, "utf8");

  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(out, "LICENSE"));
  checkSyntax(out);

  const files = listFiles(out);
  const singleBytes = fs.statSync(singlePath).size;
  const folderBytes = bytesOf(files) - singleBytes;
  console.log("网页轻量版构建完成：");
  console.log("  目录版：" + out);
  console.log("    " + files.length + " 个文件，共 " + kib(bytesOf(files)) + "（含单文件版）");
  console.log("  单文件版：" + singlePath);
  console.log("    " + kib(singleBytes));
  console.log("  目录资源：" + kib(folderBytes));
}

main();
