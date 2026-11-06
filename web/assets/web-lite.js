/* 测量学局劲工具 · 网页轻量版启动补丁
   只在 dist-web 构建中加载；桌面版不加载本文件。
   作用：标记 lite、避免旧数据停在 AI 模块、提示浏览器数据边界、
   接管页面级拖放、记录最近一次“导出全部项目”的时间。 */
(function (global) {
  "use strict";

  global.__JUJIN_LITE__ = true;

  var KEY = "survey-jujin.dev.v1";
  var FIRST_SEEN_KEY = "survey-jujin.web.first-seen.v1";
  var LAST_EXPORT_KEY = "survey-jujin.web.last-export.v1";
  var LAST_REMIND_KEY = "survey-jujin.web.last-remind.v1";
  var WEEK = 7 * 24 * 60 * 60 * 1000;

  var booted = false;
  var waiting = 0;
  var persistAsked = false;
  var storageWarned = false;

  function read(key) {
    try {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, String(value));
    } catch (err) {
      /* 浏览器存储不可用时，提示本身不能影响表格使用。 */
    }
  }

  function now() {
    return Date.now();
  }

  function toast(text, kind) {
    try {
      if (global.__sheetApp && typeof global.__sheetApp.toast === "function") {
        global.__sheetApp.toast(text, kind || "ok");
      }
    } catch (err) {
      /* 宿主未就绪时静默跳过。 */
    }
  }

  function appReady() {
    return !!(global.__sheetApp && typeof global.__sheetApp.getModule === "function");
  }

  /* 旧浏览器数据可能保存了 ui.activeModule = "assistant"。app.js 自己也会
     回落一次；这里再兜一次，防止脚本顺序被改动后出现空白舞台。 */
  function fixModule() {
    try {
      if (global.__sheetApp.getModule() !== "assistant") return;
      var state = typeof global.__sheetApp.getState === "function"
        ? global.__sheetApp.getState()
        : null;
      var fallback = state && state.ui && state.ui.active ? state.ui.active : "traverse";
      if (typeof global.__sheetApp.setActiveModule === "function") {
        global.__sheetApp.setActiveModule(fallback);
      }
    } catch (err) {
      /* 回落失败时保留宿主当前状态，不阻断启动。 */
    }
  }

  function setMenuNote() {
    var note = document.querySelector(".project-menu-note");
    if (!note) return;
    note.textContent = "轻量版数据只保存在本浏览器；清理站点数据、换浏览器或换设备都会丢失，请定期「导出全部项目」备份。本软件以木兰 PSL v2 开源，许可见随附 LICENSE。";
  }

  function noteFirstRun() {
    var firstSeen = Number(read(FIRST_SEEN_KEY)) || 0;
    var lastExport = Number(read(LAST_EXPORT_KEY)) || 0;
    var lastRemind = Number(read(LAST_REMIND_KEY)) || 0;
    var stamp = now();

    if (!firstSeen) {
      write(FIRST_SEEN_KEY, stamp);
      toast("轻量版数据只保存在本浏览器；清理浏览器数据、换浏览器或换设备都会丢失。请定期用「项目 → 导出全部项目」备份。", "ok");
      return;
    }

    var basis = Math.max(firstSeen, lastExport, lastRemind);
    if (stamp - basis >= WEEK) {
      write(LAST_REMIND_KEY, stamp);
      toast("距上次导出已超过 7 天；建议用「项目 → 导出全部项目」把记录备份到本地文件。", "ok");
    }
  }

  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (global.navigator && global.navigator.storage &&
          typeof global.navigator.storage.persist === "function") {
        global.navigator.storage.persist().catch(function () { /* 拒绝也不影响使用 */ });
      }
    } catch (err) {
      /* 老浏览器没有 storage.persist。 */
    }
  }

  function isJsonFile(file) {
    return !!(file && /\.json$/i.test(String(file.name || "")));
  }

  function installDropGuard() {
    document.addEventListener("dragover", function (event) {
      event.preventDefault();
      try {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      } catch (err) { /* 某些浏览器只读 */ }
    }, true);

    document.addEventListener("drop", function (event) {
      event.preventDefault();
      var files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      if (files.length !== 1) {
        toast("一次只能拖入一个 JSON 文件。", "error");
        return;
      }
      var file = files[0];
      if (!isJsonFile(file)) {
        toast("只支持拖入 .json 记录文件。", "error");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          if (global.__sheetApp && typeof global.__sheetApp.importText === "function") {
            global.__sheetApp.importText(String(reader.result || ""), file);
          }
        } catch (err) {
          toast("导入失败：" + (err && err.message ? err.message : "文件无法读取"), "error");
        }
      };
      reader.onerror = function () {
        toast("读取文件失败。", "error");
      };
      reader.readAsText(file, "utf-8");
    }, true);
  }

  function installStorageWarning() {
    global.addEventListener("storage", function (event) {
      if (!event || event.key !== KEY || storageWarned) return;
      storageWarned = true;
      toast("另一个标签页已修改项目数据；请刷新本页，避免两边互相覆盖。", "error");
    });
  }

  function start() {
    if (booted) return;
    booted = true;
    fixModule();
    setMenuNote();
    noteFirstRun();
  }

  function whenReady(callback) {
    if (appReady()) {
      callback();
      return;
    }
    waiting += 1;
    if (waiting > 240) return;
    setTimeout(function () { whenReady(callback); }, 50);
  }

  global.__JUJIN_LITE_ON_EXPORT__ = function () {
    write(LAST_EXPORT_KEY, now());
  };

  document.addEventListener("DOMContentLoaded", function () {
    try { document.title = "测量学局劲工具 · 网页轻量版"; } catch (err) { /* ignore */ }
  }, { once: true });

  document.addEventListener("pointerdown", askPersist, { once: true, capture: true });
  document.addEventListener("keydown", askPersist, { once: true, capture: true });

  installDropGuard();
  installStorageWarning();
  whenReady(start);
})(typeof window !== "undefined" ? window : globalThis);
