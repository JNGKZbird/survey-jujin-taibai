"use strict";

const assert = require("assert");
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

console.log("agent-markdown tests");

test("raw HTML is escaped, never emitted", () => {
  const html = M.render('<script>alert("x")</script><img src=x onerror=alert(1)>');
  assert.ok(html.indexOf("<script>") === -1);
  assert.ok(html.indexOf("<img") === -1);
  assert.ok(html.indexOf("&lt;script&gt;") !== -1);
  assert.ok(html.indexOf("&lt;img") !== -1);
});

test("only http/https links become anchors", () => {
  const ok = M.render("[站点](https://example.com/a?x=1&y=2)");
  assert.ok(ok.indexOf('<a href="https://example.com/a?x=1&amp;y=2"') !== -1);
  assert.ok(ok.indexOf('rel="noopener noreferrer"') !== -1);
  const bad = M.render("[坏链](javascript:alert(1))");
  assert.strictEqual(bad.indexOf("<a "), -1);
  assert.ok(bad.indexOf("javascript:alert(1)") !== -1);
  const file = M.render("[本地](file:///C:/secret.txt)");
  assert.strictEqual(file.indexOf("<a "), -1);
});

test("quote characters cannot break out of a link attribute", () => {
  const html = M.render('[x](https://example.com/"onmouseover="alert(1))');
  assert.strictEqual(html.indexOf('onmouseover="alert(1)"'), -1);
  assert.ok(html.indexOf("&quot;") !== -1);
});

test("autolinks only accept http(s)", () => {
  const ok = M.render("见 <https://example.com/doc>");
  assert.ok(ok.indexOf('<a href="https://example.com/doc"') !== -1);
  const bad = M.render("见 <javascript:alert(1)>");
  assert.strictEqual(bad.indexOf("<a "), -1);
});

test("inline formatting works after escaping", () => {
  const html = M.render("**粗体** 与 *斜体* 与 ~~删除~~ 与 `a<b`");
  assert.ok(html.indexOf("<strong>粗体</strong>") !== -1);
  assert.ok(html.indexOf("<em>斜体</em>") !== -1);
  assert.ok(html.indexOf("<del>删除</del>") !== -1);
  assert.ok(html.indexOf("<code>a&lt;b</code>") !== -1);
});

test("fenced code is escaped and language class is whitelisted", () => {
  const html = M.render("```js\nconst x = \"<b>\";\n```");
  assert.ok(html.indexOf('<pre class="md-code"><code class="language-js">') !== -1);
  assert.ok(html.indexOf("&lt;b&gt;") !== -1);
  const bad = M.render("```\"><img>\n1\n```");
  assert.strictEqual(bad.indexOf("<img"), -1);
});

test("headings, lists, quotes and rules render", () => {
  const html = M.render("# 标题\n\n- 一\n- 二\n\n> 引用\n\n---\n\n1. 甲\n2. 乙");
  assert.ok(html.indexOf("<h1>标题</h1>") !== -1);
  assert.ok(html.indexOf("<ul><li>一</li><li>二</li></ul>") !== -1);
  assert.ok(html.indexOf("<blockquote><p>引用</p></blockquote>") !== -1);
  assert.ok(html.indexOf("<hr>") !== -1);
  assert.ok(html.indexOf("<ol><li>甲</li><li>乙</li></ol>") !== -1);
});

test("tables render with alignment classes", () => {
  const html = M.render("| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |");
  assert.ok(html.indexOf('<div class="md-table-wrap"><table>') !== -1);
  assert.ok(html.indexOf('<th class="md-align-left">左</th>') !== -1);
  assert.ok(html.indexOf('<th class="md-align-center">中</th>') !== -1);
  assert.ok(html.indexOf('<th class="md-align-right">右</th>') !== -1);
  assert.ok(html.indexOf('<td class="md-align-left">1</td>') !== -1);
});

test("paragraphs keep single line breaks and blank lines split paragraphs", () => {
  assert.strictEqual(M.render("a\nb"), "<p>a<br>b</p>");
  assert.strictEqual(M.render("a\n\nb"), "<p>a</p><p>b</p>");
});

test("empty input is empty", () => {
  assert.strictEqual(M.render(""), "");
  assert.strictEqual(M.render(null), "");
});

console.log("agent-markdown.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
