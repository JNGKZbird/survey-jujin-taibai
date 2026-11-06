/* 测量学局劲工具 · Agent 启动
   等宿主 app.js 装好 __sheetApp，再读 agent.json、初始化聊天界面，并把顶部
   的模块说明同步成「AI 助手 · 工作区 · 模型 · 模式」。 */
(function (global) {
  "use strict";

  var STORE = global.JujinAgentStore;
  var UI = global.JujinAgentUI;
  var LLM = global.JujinAgentLLM;
  var ATT_STORE = global.JujinAgentAttachmentStore || null;

  var booted = false;
  var waiting = 0;

  function moduleNote() {
    return document.getElementById("module-note");
  }

  function activeModule() {
    try {
      return global.__sheetApp && typeof global.__sheetApp.getModule === "function"
        ? String(global.__sheetApp.getModule() || "")
        : "";
    } catch (err) {
      return "";
    }
  }

  function updateNote() {
    var host = moduleNote();
    if (!host) return;
    var summary = UI && typeof UI.summary === "function" ? UI.summary() : null;
    if (!summary) return;
    var modeText = summary.agentMode === "work"
      ? ({ read: "Only Read", manual: "Manual", auto: "Auto" }[summary.mode] || "Manual")
      : "Chat";
    var text = "AI 助手 · " + summary.workspaceName + " · " +
      (summary.model || "未配置模型") + " · " + modeText;
    host.textContent = "";
    var dot = document.createElement("span");
    dot.className = "module-dot";
    dot.setAttribute("aria-hidden", "true");
    host.appendChild(dot);
    host.appendChild(document.createTextNode(text));
  }

  function whenAppReady(callback) {
    if (global.__sheetApp) {
      callback();
      return;
    }
    waiting += 1;
    if (waiting > 240) {
      if (global.console && console.warn) console.warn("[agent] 宿主界面未就绪，AI 助手未启动。");
      return;
    }
    setTimeout(function () { whenAppReady(callback); }, 50);
  }

  function startUi() {
    UI.init();
    updateNote();
    global.__jujinAgent = {
      version: 1,
      store: STORE,
      ui: UI,
      llm: LLM,
      attachments: ATT_STORE,
      status: function () { return STORE.status(); },
      summary: function () { return UI.summary(); }
    };
  }

  /* 图片索引失败只让附件退回 M4a 行为，不能阻塞聊天界面。 */
  function bootAttachments() {
    if (!ATT_STORE || typeof ATT_STORE.boot !== "function") return Promise.resolve();
    var status = STORE.status();
    var native = !!(global.JujinPlatform && global.JujinPlatform.isDesktop &&
      global.JujinPlatform.isDesktop() && global.JujinPlatform.nativeReady &&
      global.JujinPlatform.nativeReady());
    var prune = native && status.mode !== "future" && !status.corrupt;
    return ATT_STORE.boot({ prune: prune }).catch(function (err) {
      if (global.console && console.warn) console.warn("[agent] 图片缓存启动失败", err);
    });
  }

  function boot() {
    if (booted) return;
    booted = true;
    STORE.load().then(function () {
      return bootAttachments();
    }).then(startUi, function (err) {
      if (global.console && console.error) console.error("[agent] 启动失败", err);
    });
  }

  document.addEventListener("jujin:module-changed", function () {
    if (activeModule() === "assistant" && UI) UI.onShown();
    updateNote();
  });
  document.addEventListener("jujin:projects-changed", function () {
    updateNote();
  });
  document.addEventListener("jujin:agent-state-changed", function () {
    updateNote();
  });

  whenAppReady(boot);
})(typeof window !== "undefined" ? window : globalThis);
