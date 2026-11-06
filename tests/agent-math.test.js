"use strict";

const assert = require("assert");
const katex = require("../web/assets/vendor/katex/katex.min.js");
assert.strictEqual(katex.version, "0.19.0");
global.katex = katex;
require("../web/assets/agent/markdown.js");
const M = global.JujinAgentMarkdown;
assert.ok(M, "markdown.js should expose JujinAgentMarkdown");

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

console.log("agent-math tests");

test("inline $...$ renders with KaTeX when math is enabled", () => {
  const html = M.render("质心公式 $a^2+b^2=c^2$ 完", { math: true });
  assert.ok(html.indexOf('class="katex"') !== -1);
  assert.strictEqual(html.indexOf("$a^2"), -1);
});

test("math is opt-in: assistant calls pass it, plain renders keep dollars", () => {
  const html = M.render("$x$");
  assert.strictEqual(html.indexOf("katex"), -1);
  assert.ok(html.indexOf("$x$") !== -1);
});

test("block $$...$$ renders in display mode", () => {
  const html = M.render("$$\\frac{a}{b}$$", { math: true });
  assert.ok(html.indexOf("katex-display") !== -1);
  assert.ok(html.indexOf("katex") !== -1);
});

test("block math may span multiple lines", () => {
  const html = M.render("$$\n\\sum_{i=1}^{n} i\n$$", { math: true });
  assert.ok(html.indexOf("katex-display") !== -1);
  assert.strictEqual(html.indexOf("$$"), -1);
});

test("a block must close at the end of its line", () => {
  const html = M.render("$$x$$ tail", { math: true });
  assert.strictEqual(html.indexOf("katex-display"), -1);
  assert.ok(html.indexOf("$$x$$ tail") !== -1);
});

test("unclosed block stays literal until the closing $$ arrives", () => {
  const html = M.render("$$\n\\frac{a}{b}", { math: true });
  assert.strictEqual(html.indexOf("katex"), -1);
  assert.ok(html.indexOf("\\frac{a}{b}") !== -1);
});

test("escaped dollars are not formulas", () => {
  const html = M.render("价格 \\$5 元", { math: true });
  assert.strictEqual(html.indexOf("katex"), -1);
  assert.ok(html.indexOf("$5") !== -1);
});

test("currency pairs are not mistaken for formulas", () => {
  const html = M.render("价格 $5 和 $10", { math: true });
  assert.strictEqual(html.indexOf("katex"), -1);
});

test("a closing dollar followed by a digit does not open a formula", () => {
  const html = M.render("$x$2", { math: true });
  assert.strictEqual(html.indexOf("katex"), -1);
});

test("inline code is masked; math outside it still renders", () => {
  const html = M.render("`$x$` 和 $y$", { math: true });
  assert.ok(html.indexOf("<code>$x$</code>") !== -1);
  assert.strictEqual((html.match(/class="katex"/g) || []).length, 1);
});

test("fenced code is masked; math outside it still renders", () => {
  const html = M.render("```\n$$\nx\n$$\n```\n\n$y$", { math: true });
  assert.ok(html.indexOf("md-code") !== -1);
  assert.strictEqual(html.indexOf("katex-display"), -1);
  assert.ok(html.indexOf('class="katex"') !== -1);
});

test("invalid TeX falls back to the escaped source, not a red error", () => {
  const html = M.render("$\\notacommand{x}$", { math: true });
  assert.strictEqual(html.indexOf("katex-error"), -1);
  assert.ok(html.indexOf("\\notacommand{x}") !== -1);
});

test("trust:false blocks \\href and raw HTML cannot escape", () => {
  const link = M.render("$\\href{javascript:alert(1)}{x}$", { math: true });
  assert.strictEqual(link.indexOf("<a "), -1);
  assert.strictEqual(link.indexOf('href="javascript'), -1);
  const raw = M.render("$<img src=x onerror=alert(1)>$", { math: true });
  assert.strictEqual(raw.indexOf("<img"), -1);
});

test("math survives table cells and strong text", () => {
  const table = M.render("| 公式 |\n| --- |\n| $x^2$ |", { math: true });
  assert.ok(table.indexOf("<td") !== -1);
  assert.ok(table.indexOf('class="katex"') !== -1);
  const strong = M.render("**$x$**", { math: true });
  assert.ok(strong.indexOf("<strong>") !== -1);
  assert.ok(strong.indexOf('class="katex"') !== -1);
});

test("repeated renders are stable (cache path)", () => {
  const a = M.render("$x$ 和 $y$", { math: true });
  const b = M.render("$x$ 和 $y$", { math: true });
  assert.strictEqual(a, b);
});

console.log("agent-math.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
