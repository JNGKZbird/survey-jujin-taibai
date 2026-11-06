/* 测量学局劲工具 · 工具消息历史
   纯函数：把已完成的工具回合还原成 OpenAI messages（assistant.tool_calls +
   每个 call 一条 role:"tool"），并在结果总量超预算时省略最旧的读表结果。
   不碰 DOM、不碰应用状态；调用 ID 与结果都由调用方提供。 */
(function (global) {
  "use strict";

  var MISSING_RESULT = JSON.stringify({ ok: false, error: "工具未执行" });
  var OMITTED_RESULT = JSON.stringify({
    ok: true,
    omitted: true,
    summary: "读表结果已省略；需要时请重新读取"
  });
  var COMPACTED_SEARCH_NOTE = "较早的搜索结果已压缩，需要时请重新搜索";

  var TOOL_LABELS = {
    survey_read_table: "读表",
    survey_write_table: "写表",
    survey_append_table_page: "加页",
    web_search: "联网搜索"
  };

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function asText(value) {
    return typeof value === "string" ? value : (value == null ? "" : String(value));
  }

  function callLabel(name) {
    if (typeof name !== "string" || !name) return "未知工具";
    return Object.prototype.hasOwnProperty.call(TOOL_LABELS, name) ? TOOL_LABELS[name] : name;
  }

  function resultText(value) {
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (err) {
        return MISSING_RESULT;
      }
    }
    return MISSING_RESULT;
  }

  /* 每个 round → 一条 assistant（content 为该轮正文，tool_calls 为全部 calls）
     + 每个 call 一条 role:"tool"，ID 与顺序严格对应。失败/取消的 call 也必须有
     结果；调用方没给 result 时合成“工具未执行”。不输出 reason。 */
  function buildRoundMessages(rounds) {
    var list = Array.isArray(rounds) ? rounds : [];
    var messages = [];
    list.forEach(function (round, roundIndex) {
      var source = isObject(round) ? round : {};
      var calls = Array.isArray(source.calls) ? source.calls : [];
      var toolCalls = [];
      var toolMessages = [];
      calls.forEach(function (call, callIndex) {
        var item = isObject(call) ? call : {};
        var id = typeof item.id === "string" && item.id
          ? item.id
          : "call_" + (roundIndex + 1) + "_" + callIndex;
        toolCalls.push({
          id: id,
          type: "function",
          function: {
            name: typeof item.name === "string" ? item.name : "",
            arguments: typeof item.argumentsText === "string" ? item.argumentsText : "{}"
          }
        });
        toolMessages.push({
          role: "tool",
          tool_call_id: id,
          content: resultText(item.result)
        });
      });
      messages.push({
        role: "assistant",
        content: asText(source.assistantText),
        tool_calls: toolCalls
      });
      Array.prototype.push.apply(messages, toolMessages);
    });
    return messages;
  }

  function cloneRound(round) {
    var source = isObject(round) ? round : {};
    var copy = {};
    Object.keys(source).forEach(function (key) {
      copy[key] = source[key];
    });
    var calls = Array.isArray(source.calls) ? source.calls : [];
    copy.calls = calls.map(function (call) {
      var item = isObject(call) ? call : {};
      var callCopy = {};
      Object.keys(item).forEach(function (key) {
        callCopy[key] = item[key];
      });
      return callCopy;
    });
    return copy;
  }

  function resultLength(value) {
    return typeof value === "string" ? value.length : 0;
  }

  function totalResultChars(rounds) {
    var total = 0;
    rounds.forEach(function (round) {
      var calls = Array.isArray(round.calls) ? round.calls : [];
      calls.forEach(function (call) {
        total += resultLength(call.result);
      });
    });
    return total;
  }

  function isSuccessfulReadResult(value) {
    if (typeof value !== "string" || !value) return false;
    var parsed;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      return false;
    }
    return isObject(parsed) && parsed.ok === true;
  }

  /* 较早的搜索结果只保留前 2 条来源元数据，去掉摘要；比原文短才替换。 */
  function compactSearchResult(value) {
    if (typeof value !== "string" || !value) return "";
    var parsed;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      return "";
    }
    if (!isObject(parsed) || parsed.ok !== true || !Array.isArray(parsed.results)) return "";
    var results = parsed.results.slice(0, 2).map(function (item) {
      var source = isObject(item) ? item : {};
      var one = {
        title: asText(source.title),
        url: asText(source.url),
        site: asText(source.site)
      };
      if (source.date) one.date = asText(source.date);
      return one;
    });
    return JSON.stringify({
      ok: true,
      provider: asText(parsed.provider) || "deepseek",
      query: asText(parsed.query),
      results: results,
      compacted: true,
      note: COMPACTED_SEARCH_NOTE
    });
  }

  /* 结果总量超过 budget 时，从最旧的 round 起把成功的读表结果换成
     {ok:true,omitted:true,summary:"…"}；搜索只留前 2 条来源。最近 2 个
     round 永不压缩。返回新数组/新 round 对象，不改入参；预算足够时是等值
     浅拷贝。 */
  function compactRoundResults(rounds, budget) {
    var list = Array.isArray(rounds) ? rounds : [];
    var copy = list.map(cloneRound);
    if (typeof budget !== "number" || !isFinite(budget)) return copy;

    var total = totalResultChars(copy);
    if (total <= budget) return copy;

    var cutoff = copy.length - 2;
    for (var roundIndex = 0; roundIndex < cutoff && total > budget; roundIndex += 1) {
      var calls = copy[roundIndex].calls;
      for (var callIndex = 0; callIndex < calls.length && total > budget; callIndex += 1) {
        var call = calls[callIndex];
        if (call.name === "web_search") {
          var compacted = compactSearchResult(call.result);
          if (!compacted || compacted.length >= resultLength(call.result)) continue;
          total -= resultLength(call.result);
          call.result = compacted;
          total += compacted.length;
          continue;
        }
        if (call.name !== "survey_read_table") continue;
        if (!isSuccessfulReadResult(call.result)) continue;
        total -= resultLength(call.result);
        call.result = OMITTED_RESULT;
        total += OMITTED_RESULT.length;
      }
    }
    return copy;
  }

  /* 供 UI 思考摘要使用，例如 "读表×1 · 写表×1"；未知工具用原名。 */
  function summarizeRound(round) {
    var source = isObject(round) ? round : {};
    var calls = Array.isArray(source.calls) ? source.calls : [];
    var order = [];
    var counts = Object.create(null);
    calls.forEach(function (call) {
      var item = isObject(call) ? call : {};
      var name = typeof item.name === "string" && item.name ? item.name : "未知工具";
      if (!counts[name]) {
        counts[name] = 0;
        order.push(name);
      }
      counts[name] += 1;
    });
    return order.map(function (name) {
      return callLabel(name) + "×" + counts[name];
    }).join(" · ");
  }

  var api = {
    buildRoundMessages: buildRoundMessages,
    compactRoundResults: compactRoundResults,
    summarizeRound: summarizeRound
  };

  global.JujinAgentHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
