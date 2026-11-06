/* 测量学局劲工具 · 思考档位
   四档的线格式（wire payload）只在提供商方言层生成。DeepSeek 官方用
   thinking + reasoning_effort；其他能识别的提供商各自映射；识别不了就只留
   “默认 / 关闭”，绝不硬发未知字段。 */
(function (global) {
  "use strict";

  var META = {
    off: { label: "Off", short: "Off", hint: "不请求思考，最快" },
    low: { label: "Low", short: "Low", hint: "轻量思考，适合查数、改单格" },
    high: { label: "High", short: "High", hint: "默认档，兼顾质量与耗时" },
    max: { label: "Max", short: "Max", hint: "更久更慢，不保证更好" },
    default: { label: "Default", short: "Default", hint: "交给提供商自己的默认值" }
  };

  var DEEPSEEK_TOGGLE = {
    on: { thinking: { type: "enabled" } },
    off: { thinking: { type: "disabled" } }
  };

  var DIALECTS = [
    {
      dialectId: "deepseek",
      label: "DeepSeek",
      hosts: ["api.deepseek.com"],
      levels: ["off", "low", "high", "max"],
      defaultLevel: "high",
      levelKind: "effort",
      toggle: DEEPSEEK_TOGGLE
    },
    {
      dialectId: "qwen",
      label: "千问（百炼）",
      hosts: ["dashscope.aliyuncs.com"],
      levels: ["off", "low", "high", "max"],
      defaultLevel: "high",
      levelKind: "budget",
      budgetMap: { low: 1000, high: 8000, max: 32000 },
      toggle: {
        on: { enable_thinking: true },
        off: { enable_thinking: false }
      },
      note: "强度以思考预算（token 数）计"
    },
    {
      dialectId: "moonshot",
      label: "月之暗面 Kimi",
      hosts: ["api.moonshot.cn"],
      levels: ["off", "max"],
      defaultLevel: "max",
      levelKind: "effort",
      toggle: DEEPSEEK_TOGGLE,
      note: "开启思考后目前只有最高档",
      modelOverrides: [
        {
          test: /kimi[-_ ]?k(?:3|[4-9])/i,
          levels: ["max"],
          canDisable: false,
          note: "K3 恒思考，不可关闭"
        }
      ]
    },
    {
      dialectId: "zhipu",
      label: "智谱 GLM",
      hosts: ["open.bigmodel.cn"],
      levels: ["off", "low", "high", "max"],
      defaultLevel: "high",
      levelKind: "effort",
      toggle: DEEPSEEK_TOGGLE,
      modelOverrides: [
        {
          test: /glm[-_ ]?(?:5\.[3-9]|[6-9])/i,
          canDisable: false,
          note: "GLM 5.3 起思考不可关闭"
        }
      ]
    }
  ];

  var GENERIC = {
    dialectId: "generic",
    label: "通用 OpenAI 兼容",
    hosts: [],
    levels: ["off", "default"],
    defaultLevel: "default",
    levelKind: "none",
    toggle: { on: {}, off: {} },
    note: "该提供商的思考参数未识别，只提供默认与关闭"
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function hostOf(baseUrl) {
    try {
      var host = new URL(String(baseUrl || "")).hostname.toLowerCase();
      return host || "";
    } catch (err) {
      return "";
    }
  }

  function dialectFor(baseUrl) {
    var host = hostOf(baseUrl);
    if (!host) return null;
    for (var i = 0; i < DIALECTS.length; i += 1) {
      var dialect = DIALECTS[i];
      for (var h = 0; h < dialect.hosts.length; h += 1) {
        var candidate = dialect.hosts[h];
        if (host === candidate || host.endsWith("." + candidate)) return dialect;
      }
    }
    return null;
  }

  function capability(baseUrl, model) {
    var dialect = dialectFor(baseUrl);
    if (!dialect) return clone(GENERIC);

    var cap = {
      dialectId: dialect.dialectId,
      label: dialect.label,
      levels: dialect.levels.slice(),
      defaultLevel: dialect.defaultLevel,
      levelKind: dialect.levelKind,
      toggle: clone(dialect.toggle),
      canDisable: dialect.levels.indexOf("off") !== -1
    };
    if (dialect.budgetMap) cap.budgetMap = clone(dialect.budgetMap);
    if (dialect.note) cap.note = dialect.note;

    var overrides = dialect.modelOverrides || [];
    for (var i = 0; i < overrides.length; i += 1) {
      if (!model || !overrides[i].test.test(model)) continue;
      var override = overrides[i];
      if (override.levels) {
        cap.levels = override.levels.slice();
        if (cap.levels.indexOf(cap.defaultLevel) === -1) {
          cap.defaultLevel = cap.levels[cap.levels.length - 1] || "default";
        }
      }
      if (override.canDisable === false) {
        cap.canDisable = false;
        cap.levels = cap.levels.filter(function (level) { return level !== "off"; });
      }
      if (override.note) cap.note = override.note;
      break;
    }

    // 恒思考模型：确保默认档仍在支持列表里。
    if (cap.levels.indexOf(cap.defaultLevel) === -1 && cap.levels.length) {
      cap.defaultLevel = cap.levels[cap.levels.length - 1];
    }
    return cap;
  }

  function options(baseUrl, model) {
    var cap = capability(baseUrl, model);
    return cap.levels.map(function (id) {
      return {
        id: id,
        label: (META[id] || { label: id }).label,
        short: (META[id] || { short: id }).short,
        hint: (META[id] || { hint: "" }).hint
      };
    });
  }

  function normalizeLevel(level, cap) {
    var value = String(level || "");
    if (cap.levels.indexOf(value) !== -1) return value;
    return cap.defaultLevel;
  }

  function payload(baseUrl, model, level) {
    var cap = capability(baseUrl, model);
    var chosen = normalizeLevel(level, cap);
    if (chosen === "off") return clone(cap.toggle.off);
    if (chosen === "default") return {};
    var out = clone(cap.toggle.on);
    if (cap.levelKind === "effort") {
      out.reasoning_effort = chosen;
    } else if (cap.levelKind === "budget" && cap.budgetMap) {
      out.thinking_budget = cap.budgetMap[chosen];
    }
    return out;
  }

  function labelFor(level) {
    return (META[level] || { label: String(level || "") }).label;
  }

  function describe(baseUrl, model, level) {
    var cap = capability(baseUrl, model);
    var chosen = normalizeLevel(level, cap);
    return {
      capability: cap,
      level: chosen,
      label: labelFor(chosen),
      payload: payload(baseUrl, model, chosen),
      options: options(baseUrl, model)
    };
  }

  var api = {
    META: META,
    GENERIC: GENERIC,
    capability: capability,
    options: options,
    normalizeLevel: normalizeLevel,
    payload: payload,
    labelFor: labelFor,
    describe: describe,
    hostOf: hostOf
  };

  global.JujinAgentThinking = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
