/* 测量学局劲工具 · 平台适配
   Tauri 桌面版走 Rust 原生文件存储与对话框；浏览器开发版保留 localStorage。
   本文件只负责“桌面/浏览器”的差异，不碰项目库数据结构。 */
(function (global) {
  "use strict";

  var tauri = null;
  try {
    tauri = global.__TAURI__ || null;
  } catch (err) {
    tauri = null;
  }

  var hasTauri = !!(global.__TAURI_INTERNALS__ || tauri);
  var invoke = tauri && tauri.core && typeof tauri.core.invoke === "function"
    ? tauri.core.invoke.bind(tauri.core)
    : null;
  var listen = tauri && tauri.event && typeof tauri.event.listen === "function"
    ? tauri.event.listen.bind(tauri.event)
    : null;

  var saveChain = Promise.resolve();
  var lastResult = null;
  var flushUnlisten = null;
  var flushHooks = [];

  function call(command, args) {
    if (!invoke) {
      return Promise.reject(new Error("桌面接口未就绪。"));
    }
    return invoke(command, args || {});
  }

  function isDesktop() {
    return hasTauri;
  }

  function nativeReady() {
    return !!invoke;
  }

  function loadStore() {
    return call("load_store");
  }

  /* 串行写入：上一次保存失败也要继续执行下一次；
     返回给 store.js 的 promise 会按本次调用的成败 settle。 */
  function saveStore(text) {
    var job = function () {
      return call("save_store", { json: String(text == null ? "" : text) });
    };
    var current = saveChain.then(job, job);
    saveChain = current;
    current.then(function (result) {
      lastResult = result;
    }, function () {
      /* 失败由 store.js 观察；这里只防止未处理拒绝。 */
    });
    return current;
  }

  function backupStore(reason) {
    // 跟保存共用一条串行链：先落盘当前状态，再备份，之后才轮到破坏性操作的保存。
    var job = function () {
      return call("backup_store", { reason: String(reason || "manual") });
    };
    var current = saveChain.then(job, job);
    saveChain = current;
    return current;
  }

  function exportJson(defaultName, content) {
    return call("export_json", {
      defaultName: String(defaultName || "测量学七表.json"),
      content: String(content == null ? "" : content)
    });
  }

  function importJson() {
    return call("import_json");
  }

  function getPaths() {
    return call("get_paths");
  }

  function openBackupDir() {
    return call("open_backup_dir");
  }

  function confirmClose() {
    return call("confirm_close");
  }

  function cancelClose() {
    return call("cancel_close");
  }

  function onFlushRequested(callback) {
    if (!isDesktop() || !listen || typeof callback !== "function") {
      return Promise.resolve(function () {});
    }
    return listen("app://flush", function () {
      try {
        callback();
      } catch (err) {
        if (global.console && console.error) console.error("[platform] flush", err);
      }
    }).then(function (unlisten) {
      flushUnlisten = unlisten;
      return unlisten;
    });
  }

  /* 其它存储（如 Agent 的 agent.json）把自己的写链挂进来；
     关窗握手会先把所有写链等完，再确认关闭。 */
  function registerFlusher(hook) {
    if (typeof hook !== "function") return function () {};
    flushHooks.push(hook);
    return function () {
      var index = flushHooks.indexOf(hook);
      if (index !== -1) flushHooks.splice(index, 1);
    };
  }

  function flush() {
    var project = saveChain.then(function () { return lastResult; }, function () { return lastResult; });
    var extra = flushHooks.map(function (hook) {
      try {
        return Promise.resolve(hook()).catch(function () { return null; });
      } catch (err) {
        return Promise.resolve(null);
      }
    });
    return Promise.all([project].concat(extra)).then(function (results) {
      return results[0];
    });
  }

  global.JujinPlatform = {
    call: call,
    listen: listen,
    isDesktop: isDesktop,
    nativeReady: nativeReady,
    loadStore: loadStore,
    saveStore: saveStore,
    backupStore: backupStore,
    exportJson: exportJson,
    importJson: importJson,
    getPaths: getPaths,
    openBackupDir: openBackupDir,
    confirmClose: confirmClose,
    cancelClose: cancelClose,
    onFlushRequested: onFlushRequested,
    registerFlusher: registerFlusher,
    flush: flush,
    lastResult: function () { return lastResult; },
    dispose: function () {
      if (flushUnlisten) {
        try { flushUnlisten(); } catch (err) { /* ignore */ }
        flushUnlisten = null;
      }
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
