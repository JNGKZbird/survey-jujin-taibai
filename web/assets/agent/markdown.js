/* 测量学局劲工具 · 安全 Markdown
   先把整段文本转义，再生成我们自己的一组标签；不解析原始 HTML，链接只允许
   http/https。输出可直接塞进 innerHTML。 */
(function (global) {
  "use strict";

  var ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
      return ESCAPE[ch];
    });
  }

  function safeUrl(url) {
    return /^https?:\/\/[^\s]+$/i.test(url);
  }

  /* ---------------- 数学公式（KaTeX 0.19.0，助手回复专用） ----------------
     公式必须在 escapeHtml 之前换成占位符：KaTeX 输出的标签不能二次转义。
     代码围栏、行内代码先遮罩，公式提取看不到它们；提取完再把代码原样放回，
     交给原来的 Markdown 流程。 */
  var mathCache = new Map();
  var MATH_CACHE_MAX = 500;

  function katexApi() {
    return global.katex && typeof global.katex.renderToString === "function" ? global.katex : null;
  }

  function renderTex(tex, display) {
    var katex = katexApi();
    if (!katex) return null;
    var key = (display ? "D\u0000" : "I\u0000") + tex;
    if (mathCache.has(key)) return mathCache.get(key);
    var html = null;
    try {
      html = katex.renderToString(tex, {
        displayMode: !!display,
        throwOnError: false,
        strict: false,
        trust: false
      });
    } catch (err) {
      html = null;
    }
    // throwOnError:false 时错误会变成红色 katex-error；聊天里退回原文更干净。
    if (html && html.indexOf("katex-error") !== -1) html = null;
    if (mathCache.size >= MATH_CACHE_MAX) mathCache.clear();
    mathCache.set(key, html);
    return html;
  }

  /* 把围栏代码与行内代码换成占位符，保证公式提取不会碰到代码里的 $。 */
  function maskCode(source) {
    var lines = source.split("\n");
    var fences = [];
    var masked = [];
    var open = null;
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (open) {
        open.push(line);
        if (/^\s*```\s*$/.test(line)) {
          fences.push(open.join("\n"));
          masked.push("\u0000F" + (fences.length - 1) + "\u0000");
          open = null;
        }
        continue;
      }
      if (/^\s*```/.test(line)) {
        open = [line];
        continue;
      }
      masked.push(line);
    }
    if (open) {
      // 未闭合的围栏按原文一直吃到结尾，与 renderBlocks 的行为一致。
      fences.push(open.join("\n"));
      masked.push("\u0000F" + (fences.length - 1) + "\u0000");
    }

    var codes = [];
    var text = masked.join("\n").replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push("`" + code + "`");
      return "\u0000K" + (codes.length - 1) + "\u0000";
    });
    return { text: text, fences: fences, codes: codes };
  }

  function unmaskCode(text, masked) {
    return text
      .replace(/\u0000F(\d+)\u0000/g, function (_, index) {
        return masked.fences[Number(index)] || "";
      })
      .replace(/\u0000K(\d+)\u0000/g, function (_, index) {
        return masked.codes[Number(index)] || "";
      });
  }

  function onlySpacesBefore(text, index) {
    for (var i = index - 1; i >= 0; i -= 1) {
      var ch = text.charAt(i);
      if (ch === "\n") return true;
      if (ch !== " " && ch !== "\t") return false;
    }
    return true;
  }

  function onlySpacesAfter(text, index) {
    for (var i = index; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (ch === "\n") return true;
      if (ch !== " " && ch !== "\t") return false;
    }
    return true;
  }

  function isEscaped(text, index) {
    var slashes = 0;
    for (var i = index - 1; i >= 0 && text.charAt(i) === "\\"; i -= 1) slashes += 1;
    return slashes % 2 === 1;
  }

  function findBlockClose(text, from) {
    var at = from;
    while ((at = text.indexOf("$$", at)) !== -1) {
      // 闭合 $$ 必须独占行尾（后面只允许空白），且前面不是反斜杠。
      if (!isEscaped(text, at) && onlySpacesAfter(text, at + 2)) return at;
      at += 2;
    }
    return -1;
  }

  /* 行内 $...$：开 $ 后非空白、闭 $ 前非空白、内容不含 $ 且不跨行、前面不是 \$。
     额外拒绝「闭 $ 后紧跟数字」，避免把「$5 和 $10」这类价格当成公式。 */
  function matchInline(text, start) {
    var i = start + 1;
    if (i >= text.length) return null;
    var first = text.charAt(i);
    if (first === "$" || /\s/.test(first)) return null;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === "\n") return null;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "$") {
        var content = text.slice(start + 1, i);
        if (!content || /\s$/.test(content)) return null;
        if (content.indexOf("\u0000") !== -1) return null;
        if (i + 1 < text.length && /\d/.test(text.charAt(i + 1))) return null;
        return { raw: text.slice(start, i + 1), tex: content, end: i + 1 };
      }
      i += 1;
    }
    return null;
  }

  function extractMath(source) {
    var items = [];
    var out = [];
    var i = 0;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (ch === "\\") {
        out.push(source.substr(i, 2));
        i += 2;
        continue;
      }
      if (ch === "$" && source.charAt(i + 1) === "$") {
        if (!onlySpacesBefore(source, i)) {
          out.push("$$");
          i += 2;
          continue;
        }
        var close = findBlockClose(source, i + 2);
        if (close === -1) {
          // 流式输出到一半：未闭合的块级公式先按纯文本，等闭合后下一帧再渲染。
          out.push(source.slice(i));
          break;
        }
        var blockTex = source.slice(i + 2, close);
        if (blockTex.indexOf("\u0000") !== -1) {
          // 公式跨过了被遮罩的代码，保守地按原文输出。
          out.push(source.slice(i, close + 2));
          i = close + 2;
          continue;
        }
        items.push({ raw: source.slice(i, close + 2), tex: blockTex, display: true });
        out.push("\u0000M" + (items.length - 1) + "\u0000");
        i = close + 2;
        continue;
      }
      if (ch === "$") {
        var inline = matchInline(source, i);
        if (inline) {
          items.push({ raw: inline.raw, tex: inline.tex, display: false });
          out.push("\u0000M" + (items.length - 1) + "\u0000");
          i = inline.end;
          continue;
        }
      }
      out.push(ch);
      i += 1;
    }
    return { text: out.join(""), items: items };
  }

  function renderInline(value) {
    var text = String(value == null ? "" : value);
    var codes = [];
    var links = [];

    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push("<code>" + code + "</code>");
      return "\u0000C" + (codes.length - 1) + "\u0000";
    });

    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (whole, label, url) {
      if (!safeUrl(url)) return whole;
      links.push(
        '<a href="' + url + '" data-agent-external="1" target="_blank" rel="noopener noreferrer">' +
          label +
          "</a>"
      );
      return "\u0000L" + (links.length - 1) + "\u0000";
    });

    // 自动链接：<https://...> 已被转义成 &lt;https://...&gt;
    text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/gi, function (_, url) {
      links.push(
        '<a href="' + url + '" data-agent-external="1" target="_blank" rel="noopener noreferrer">' +
          url +
          "</a>"
      );
      return "\u0000L" + (links.length - 1) + "\u0000";
    });

    text = text
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    text = text.replace(/\u0000L(\d+)\u0000/g, function (_, index) {
      return links[Number(index)] || "";
    });
    text = text.replace(/\u0000C(\d+)\u0000/g, function (_, index) {
      return codes[Number(index)] || "";
    });
    return text;
  }

  function isFence(line) {
    return /^\s*```/.test(line);
  }

  function isHeading(line) {
    return /^\s{0,3}#{1,4}\s+/.test(line);
  }

  function isQuote(line) {
    // render() 先把整段文本转义，所以行首的 > 已经变成 &gt;。
    return /^\s{0,3}(?:>|&gt;)\s?/.test(line);
  }

  function isBullet(line) {
    return /^\s{0,3}[-*+]\s+/.test(line);
  }

  function isOrdered(line) {
    return /^\s{0,3}\d+[.)]\s+/.test(line);
  }

  function isRule(line) {
    return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  }

  function isTableSeparator(line) {
    var trimmed = String(line || "").trim();
    if (!trimmed || trimmed.indexOf("-") === -1) return false;
    if (!trimmed.split("|").length) return false;
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(trimmed);
  }

  function splitRow(line) {
    var trimmed = String(line || "").trim();
    if (trimmed.charAt(0) === "|") trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === "|") trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map(function (cell) { return cell.trim(); });
  }

  function startsBlock(line) {
    return isFence(line) || isHeading(line) || isQuote(line) || isBullet(line) ||
      isOrdered(line) || isRule(line);
  }

  function renderTable(lines, start) {
    var header = splitRow(lines[start]);
    var sep = splitRow(lines[start + 1]);
    var align = sep.map(function (cell) {
      var left = cell.charAt(0) === ":";
      var right = cell.charAt(cell.length - 1) === ":";
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return "";
    });
    var rows = [];
    var i = start + 2;
    while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) {
      rows.push(splitRow(lines[i]));
      i += 1;
    }

    function cell(tag, text, index) {
      var cls = align[index] ? ' class="md-align-' + align[index] + '"' : "";
      return "<" + tag + cls + ">" + renderInline(text) + "</" + tag + ">";
    }

    var html = "<div class=\"md-table-wrap\"><table><thead><tr>";
    for (var h = 0; h < header.length; h += 1) html += cell("th", header[h], h);
    html += "</tr></thead><tbody>";
    for (var r = 0; r < rows.length; r += 1) {
      html += "<tr>";
      for (var c = 0; c < header.length; c += 1) html += cell("td", rows[r][c] || "", c);
      html += "</tr>";
    }
    html += "</tbody></table></div>";
    return { html: html, next: i };
  }

  function renderBlocks(lines) {
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }

      if (isFence(line)) {
        var info = line.replace(/^\s*```/, "").trim();
        var code = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        var lang = /^[a-z0-9+#_-]{1,24}$/i.test(info) ? ' class="language-' + info + '"' : "";
        out.push("<pre class=\"md-code\"><code" + lang + ">" + code.join("\n") + "</code></pre>");
        continue;
      }

      var heading = /^\s{0,3}(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        var level = heading[1].length;
        out.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
        i += 1;
        continue;
      }

      if (isRule(line)) {
        out.push("<hr>");
        i += 1;
        continue;
      }

      if (isQuote(line)) {
        var quote = [];
        while (i < lines.length && isQuote(lines[i])) {
          quote.push(lines[i].replace(/^\s{0,3}(?:>|&gt;)\s?/, ""));
          i += 1;
        }
        out.push("<blockquote>" + renderBlocks(quote) + "</blockquote>");
        continue;
      }

      if (isBullet(line) || isOrdered(line)) {
        var ordered = isOrdered(line);
        var pattern = ordered ? /^\s{0,3}\d+[.)]\s+/ : /^\s{0,3}[-*+]\s+/;
        var items = [];
        while (i < lines.length && pattern.test(lines[i])) {
          var item = [lines[i].replace(pattern, "")];
          i += 1;
          while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) &&
                 !isBullet(lines[i]) && !isOrdered(lines[i])) {
            item.push(lines[i]);
            i += 1;
          }
          items.push("<li>" + renderInline(item.join("<br>")) + "</li>");
        }
        out.push(ordered ? "<ol>" + items.join("") + "</ol>" : "<ul>" + items.join("") + "</ul>");
        continue;
      }

      if (line.indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var table = renderTable(lines, i);
        out.push(table.html);
        i = table.next;
        continue;
      }

      var paragraph = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) &&
             !(lines[i].indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
        paragraph.push(lines[i]);
        i += 1;
      }
      out.push("<p>" + renderInline(paragraph.join("<br>")) + "</p>");
    }

    return out.join("");
  }

  function render(markdown, options) {
    var source = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n");
    var math = null;
    if (options && options.math) {
      var masked = maskCode(source);
      math = extractMath(masked.text);
      source = unmaskCode(math.text, masked);
    }
    var escaped = escapeHtml(source);
    var html = renderBlocks(escaped.split("\n"));
    if (math && math.items.length) {
      html = html.replace(/\u0000M(\d+)\u0000/g, function (_, index) {
        var item = math.items[Number(index)];
        if (!item) return "";
        // KaTeX 输出的标签直接回填；失败时把原始 $...$ 文本按普通文本转义。
        return renderTex(item.tex, item.display) || escapeHtml(item.raw);
      });
    }
    return html;
  }

  var api = {
    escapeHtml: escapeHtml,
    renderInline: renderInline,
    render: render
  };

  global.JujinAgentMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
