#!/usr/bin/env node
/* 测量学局劲工具 · 轻量版仓库同步
   把 tools/build_web_lite.js 的目录版产物同步进 lite/ 子仓库。
   只覆盖 index.html、LICENSE、assets/；README、tools、package.json 等维护文件不动。
   用法：node tools/sync_web_lite_repo.js [--from dist-web] [--to lite] [--dry-run] */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_FROM = path.join(ROOT, "dist-web");
const DEFAULT_TO = path.join(ROOT, "lite");
const REPO_NAME = "survey-jujin-lite";

function fail(message) {
  console.error("[sync-lite] " + message);
  process.exit(1);
}

function parseArgs(argv) {
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") {
      if (!argv[i + 1]) fail("--from 需要一个目录参数。");
      from = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--to") {
      if (!argv[i + 1]) fail("--to 需要一个目录参数。");
      to = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法：node tools/sync_web_lite_repo.js [--from 目录] [--to 目录] [--dry-run]");
      process.exit(0);
    } else {
      fail("未知参数：" + arg);
    }
  }
  return { from, to, dryRun };
}

function assertSource(from) {
  if (!fs.existsSync(path.join(from, "index.html"))) fail("源目录缺少 index.html：" + from);
  if (!fs.existsSync(path.join(from, "LICENSE"))) fail("源目录缺少 LICENSE：" + from);
  if (!fs.existsSync(path.join(from, "assets"))) fail("源目录缺少 assets/：" + from);
}

function assertTarget(to) {
  const pkgFile = path.join(to, "package.json");
  if (!fs.existsSync(pkgFile)) fail("目标不是轻量版仓库（缺少 package.json）：" + to);
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  } catch (err) {
    fail("目标 package.json 无法解析：" + pkgFile);
  }
  if (pkg.name !== REPO_NAME) {
    fail("目标 package.json 的 name 不是 " + REPO_NAME + "，拒绝写入：" + to);
  }
  if (!fs.existsSync(path.join(to, "assets"))) fail("目标缺少 assets/：" + to);
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
}

function main() {
  const { from, to, dryRun } = parseArgs(process.argv.slice(2));
  assertSource(from);
  assertTarget(to);

  const srcAssets = path.join(from, "assets");
  const dstAssets = path.join(to, "assets");
  const srcNames = listFiles(srcAssets);
  const dstNames = listFiles(dstAssets);
  if (!srcNames.length) fail("源 assets/ 为空：" + srcAssets);

  const stale = dstNames.filter((name) => srcNames.indexOf(name) < 0);
  const writes = ["index.html", "LICENSE"].concat(srcNames.map((name) => "assets/" + name));

  if (dryRun) {
    writes.forEach((name) => console.log("would write  " + name));
    stale.forEach((name) => console.log("would remove assets/" + name));
    console.log("dry-run：不写入任何文件。");
    return;
  }

  ["index.html", "LICENSE"].forEach(function (name) {
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  });
  srcNames.forEach(function (name) {
    fs.copyFileSync(path.join(srcAssets, name), path.join(dstAssets, name));
  });
  stale.forEach(function (name) {
    fs.unlinkSync(path.join(dstAssets, name));
  });

  console.log("已同步 " + writes.length + " 个文件 → " + to);
  if (stale.length) console.log("已移除过期文件：" + stale.join(", "));
}

main();
