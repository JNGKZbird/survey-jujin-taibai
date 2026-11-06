/* 测量学局劲工具 · Agent 传输层
   只负责和 Rust 命令说话：流式、取消、一次性补全、模型列表、凭据、外链。
   密钥明文永远不进入前端；这里只有 has/set/clear。 */
(function (global) {
  "use strict";

  var seq = 0;

  /* deepseek-flash（DeepSeek-V4.1-Flash-1017）官方最大输出：384K = 393,216 token。
     这是单次回复的上限，不是上下文窗口；提高它不会额外计费，只有真的生成才收费。
     第三方兼容网关若拒绝该值，Rust 的 400 降级会去掉 max_tokens，回落到服务端默认。 */
  var MAX_OUTPUT_TOKENS = 393216;

  function tauri() {
    try {
      return global.__TAURI__ || null;
    } catch (err) {
      return null;
    }
  }

  function platform() {
    return global.JujinPlatform || null;
  }

  function available() {
    var P = platform();
    return !!(P && P.isDesktop() && P.nativeReady());
  }

  function call(command, args) {
    var P = platform();
    if (!P || typeof P.call !== "function") {
      return Promise.reject(new Error("桌面接口未就绪。"));
    }
    return P.call(command, args || {});
  }

  function makeRequestId() {
    seq += 1;
    return "req_" + Date.now().toString(36) + "_" + seq.toString(36) + "_" +
      Math.random().toString(36).slice(2, 6);
  }

  function normalizeMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      return message && typeof message === "object" && typeof message.role === "string";
    });
  }

  function baseRequest(options) {
    options = options || {};
    return {
      providerId: String(options.providerId || "deepseek"),
      baseUrl: String(options.baseUrl || ""),
      model: String(options.model || ""),
      temperature: typeof options.temperature === "number" ? options.temperature : 1.0,
      maxTokens: options.maxTokens == null ? MAX_OUTPUT_TOKENS : Math.max(1, Math.floor(options.maxTokens)),
      messages: normalizeMessages(options.messages),
      thinking: options.thinking && typeof options.thinking === "object" ? options.thinking : null,
      tools: Array.isArray(options.tools) && options.tools.length ? options.tools : null,
      toolChoice: options.toolChoice == null ? null : options.toolChoice
    };
  }

  /* startStream(options, handlers) -> { requestId, cancel, promise }
     handlers: onDelta(text), onReasoning(text), onToolCalls(calls),
               onUsage(usage), onDone(info), onError(error) */
  function startStream(options, handlers) {
    handlers = handlers || {};
    var requestId = options && options.requestId ? String(options.requestId) : makeRequestId();
    var request = baseRequest(options);
    request.requestId = requestId;

    var ChannelClass = null;
    var T = tauri();
    if (T && T.core && typeof T.core.Channel === "function") ChannelClass = T.core.Channel;
    if (!ChannelClass) {
      var early = { code: "not_desktop", detail: "AI 助手需要桌面版。" };
      setTimeout(function () { if (handlers.onError) handlers.onError(early); }, 0);
      return {
        requestId: requestId,
        cancel: function () { return false; },
        promise: Promise.resolve(early)
      };
    }

    var channel = new ChannelClass();
    var settled = false;
    var aborted = false;
    var result = { requestId: requestId, aborted: false, toolsDropped: false, finishReason: null };

    function settle(error, info) {
      if (settled) return;
      settled = true;
      if (error && handlers.onError) {
        try { handlers.onError(error); } catch (err) { /* 回调出错不影响传输 */ }
      }
      if (info && handlers.onDone) {
        try { handlers.onDone(info); } catch (err) { /* 同上 */ }
      }
    }

    channel.onmessage = function (event) {
      if (!event || typeof event !== "object") return;
      switch (event.type) {
        case "delta":
          if (handlers.onDelta) handlers.onDelta(String(event.text || ""));
          break;
        case "reasoning":
          if (handlers.onReasoning) handlers.onReasoning(String(event.text || ""));
          break;
        case "tool_calls":
          if (handlers.onToolCalls) handlers.onToolCalls(Array.isArray(event.calls) ? event.calls : []);
          break;
        case "usage":
          if (handlers.onUsage) handlers.onUsage(event);
          break;
        case "done":
          result.aborted = !!event.aborted;
          result.toolsDropped = !!event.toolsDropped;
          result.finishReason = event.finishReason || null;
          settle(null, result);
          break;
        case "error":
          settle({ code: String(event.code || "unknown"), detail: event.detail || null });
          break;
        default:
          break;
      }
    };

    var promise = call("agent_stream", { channel: channel, request: request }).then(function () {
      // Rust 命令正常返回时，done 事件通常已经先到；补一次兜底。
      settle(null, result);
      return result;
    }, function (err) {
      var error = { code: "invoke_failed", detail: err && err.message ? err.message : String(err || "") };
      settle(error);
      return error;
    });

    function cancel() {
      if (settled || aborted) return Promise.resolve(false);
      aborted = true;
      return call("agent_cancel", { requestId: requestId }).catch(function () { return false; });
    }

    return { requestId: requestId, cancel: cancel, promise: promise };
  }

  function complete(options) {
    var request = baseRequest(options);
    return call("agent_complete", { request: request });
  }

  function listModels(options) {
    options = options || {};
    return call("agent_list_models", {
      providerId: String(options.providerId || "deepseek"),
      baseUrl: String(options.baseUrl || "")
    });
  }

  function keyHas(providerId, scope) {
    return call("agent_key_has", {
      providerId: String(providerId || "deepseek"),
      scope: scope || null
    });
  }

  function keySet(providerId, key, scope) {
    return call("agent_key_set", {
      providerId: String(providerId || "deepseek"),
      key: String(key == null ? "" : key),
      scope: scope || null
    });
  }

  function keyClear(providerId, scope) {
    return call("agent_key_clear", {
      providerId: String(providerId || "deepseek"),
      scope: scope || null
    });
  }

  function openUrl(url) {
    return call("agent_open_url", { url: String(url || "") });
  }

  /* 联网搜索。固定走 Rust 的 DeepSeek 官方端点；桌面通信失败也归一成
     {ok:false, code:"invoke_failed"}，不让 UI 出现未捕获的 rejection。 */
  function webSearch(options) {
    var opts = options || {};
    var args = { query: String(opts.query == null ? "" : opts.query) };
    if (opts.count !== undefined && opts.count !== null) args.count = opts.count;
    return call("agent_web_search", args).then(function (result) {
      if (!result || typeof result !== "object") {
        return { ok: false, code: "bad_response", detail: "搜索服务返回了空响应。" };
      }
      return result;
    }, function (error) {
      return {
        ok: false,
        code: "invoke_failed",
        detail: String(error && error.message ? error.message : error || "桌面通信失败。")
      };
    });
  }

  function usageText(usage) {
    if (!usage) return "";
    var parts = [];
    if (usage.promptTokens != null) parts.push("输入 " + usage.promptTokens);
    if (usage.completionTokens != null) parts.push("输出 " + usage.completionTokens);
    if (usage.cacheHitTokens) parts.push("缓存命中 " + usage.cacheHitTokens);
    return parts.join(" · ");
  }

  function errorHint(code, detail) {
    var c = String(code || "");
    if (c === "no_key" || c === "not_configured") return "还没有配置 API Key。请到设置 → 模型里填写。";
    if (c === "bad_url") return "Base URL 无效。需要 https；只有本机地址允许 http。";
    if (c === "invalid_key" || c === "unauthorized" || c === "401") return "密钥无效或已过期（401）。";
    if (c === "insufficient_balance" || c === "402") return "账户余额不足（402）。";
    if (c === "rate_limited" || c === "429") return "请求太频繁或额度用尽（429），稍后再试。";
    if (c === "model_not_found" || c === "404") return "模型不存在或不支持该接口（404），检查模型名与 Base URL。";
    if (c === "forbidden" || c === "403") return "没有权限访问该模型（403）。";
    if (c === "too_large" || c === "413") {
      return "请求体过大（413）。图片太多或太大，删减图片后重试。";
    }
    if (c === "bad_request") {
      var text = String(detail || "");
      if (/image|vision|multimodal|图片|视觉/i.test(text)) {
        return "请求被拒绝（400）。当前模型可能不支持图片，或图片格式/尺寸不被接受：换用支持视觉的模型，或配置视觉备用模型后重试。";
      }
      return "请求参数被拒绝（400），可以降低思考档位或换一个模型。";
    }
    if (c === "timeout") return "连接超时，检查网络或代理。";
    if (c === "network") return "网络请求失败，检查网络或代理。";
    if (c === "stream") return "流式响应中断。";
    if (c === "aborted") return "已停止。";
    if (c === "invoke_failed") return "桌面通信失败。";
    if (/^5\d\d$/.test(c)) return "服务端错误（" + c + "），可以稍后重试。";
    return "请求失败" + (c ? "（" + c + "）" : "") + "。";
  }

  function searchErrorHint(code) {
    var c = String(code || "");
    if (c === "no_key") return "还没有配置 DeepSeek API Key。搜索沿用对话 Key，请到设置 → 模型填写。";
    if (c === "credential_error") return "读取 Windows 凭据管理器失败，暂时无法搜索。";
    if (c === "invalid_key" || c === "401") return "DeepSeek Key 无效或已过期（401）。";
    if (c === "insufficient_balance" || c === "402") return "DeepSeek 账户余额不足（402）。";
    if (c === "forbidden" || c === "403") return "没有权限使用 DeepSeek 搜索（403）。";
    if (c === "not_found" || c === "404") return "搜索接口不存在（404）；当前只支持 DeepSeek 官方地址。";
    if (c === "timeout") return "搜索超时（60 秒），可以稍后再试。";
    if (c === "too_large") return "搜索结果过大，已放弃本次搜索。";
    if (c === "rate_limited" || c === "429") return "搜索请求太频繁（429），稍后再试。";
    if (c === "server_error" || /^5\d\d$/.test(c)) return "DeepSeek 搜索服务暂时不可用，稍后再试。";
    if (c === "network") return "搜索网络请求失败，检查网络或代理。";
    if (c === "bad_response") return "搜索服务返回了无法解析的结果。";
    if (c === "bad_request") return "搜索词被拒绝（400），换一个更短、更明确的搜索词。";
    if (c === "invoke_failed") return "搜索请求没有发出去，桌面通信失败。";
    return "搜索失败" + (c ? "（" + c + "）" : "") + "。";
  }

  var api = {
    available: available,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    makeRequestId: makeRequestId,
    startStream: startStream,
    complete: complete,
    listModels: listModels,
    keyHas: keyHas,
    keySet: keySet,
    keyClear: keyClear,
    openUrl: openUrl,
    webSearch: webSearch,
    usageText: usageText,
    errorHint: errorHint,
    searchErrorHint: searchErrorHint
  };

  global.JujinAgentLLM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
