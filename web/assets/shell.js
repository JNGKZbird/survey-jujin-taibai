/* 测量学局劲工具 · 桌面外壳
   自绘标题栏的窗口控制、项目切换菜单。
   浏览器里打开时窗口按钮保持禁用，项目菜单照常工作。 */
(function () {
  "use strict";

  var BROWSER_TITLE = "在应用窗口中可用";
  var LITE = !!(typeof window !== "undefined" && window.__JUJIN_LITE__);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function app() {
    return window.__sheetApp || null;
  }

  function notify(message, kind) {
    var api = app();
    if (api && typeof api.toast === "function") {
      api.toast(message, kind);
      return;
    }
    if (window.console && console.warn) console.warn("[shell] " + message);
  }

  function errorText(err) {
    if (err && err.message) return err.message;
    var text = String(err == null ? "" : err);
    return text || "未知错误";
  }

  function getTauriWindow() {
    try {
      var tauri = window.__TAURI__;
      if (tauri && tauri.window && typeof tauri.window.getCurrentWindow === "function") {
        return tauri.window.getCurrentWindow();
      }
    } catch (err) { /* 浏览器环境 */ }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 窗口按钮
   * ------------------------------------------------------------------ */

  function setupWindowControls() {
    var minBtn = document.getElementById("win-min");
    var maxBtn = document.getElementById("win-max");
    var closeBtn = document.getElementById("win-close");
    var dragRegion = document.getElementById("titlebar-drag");
    if (!minBtn || !maxBtn || !closeBtn) return;

    var win = getTauriWindow();
    var canMinimize = !!(win && typeof win.minimize === "function");
    var canMaximize = !!(win && typeof win.maximize === "function" && typeof win.unmaximize === "function");
    var canClose = !!(win && typeof win.close === "function");

    if (!canMinimize && !canMaximize && !canClose) {
      minBtn.disabled = true;
      maxBtn.disabled = true;
      closeBtn.disabled = true;
      minBtn.title = BROWSER_TITLE;
      maxBtn.title = BROWSER_TITLE;
      closeBtn.title = BROWSER_TITLE;
      return;
    }

    minBtn.disabled = !canMinimize;
    maxBtn.disabled = !canMaximize;
    closeBtn.disabled = !canClose;
    minBtn.title = canMinimize ? "最小化" : BROWSER_TITLE;
    maxBtn.title = canMaximize ? "最大化" : BROWSER_TITLE;
    closeBtn.title = canClose ? "关闭" : BROWSER_TITLE;

    function applyMaximizedVisual(isMaximized) {
      var max = !!isMaximized;
      document.body.classList.toggle("win-maximized", max);
      maxBtn.setAttribute("aria-label", max ? "还原" : "最大化");
      if (canMaximize) maxBtn.title = max ? "还原" : "最大化";
      if (dragRegion) {
        if (max) {
          dragRegion.removeAttribute("data-tauri-drag-region");
        } else {
          dragRegion.setAttribute("data-tauri-drag-region", "");
        }
      }
    }

    var maxRefreshTimer = null;

    function refreshMaximized() {
      if (!win || typeof win.isMaximized !== "function") return;
      var reading;
      try {
        reading = win.isMaximized();
      } catch (err) {
        return;
      }
      Promise.resolve(reading).then(function (value) {
        applyMaximizedVisual(value);
      }).catch(function () { /* 读不到就保持现状 */ });
    }

    function scheduleMaxRefresh() {
      if (maxRefreshTimer) clearTimeout(maxRefreshTimer);
      maxRefreshTimer = setTimeout(function () {
        maxRefreshTimer = null;
        refreshMaximized();
      }, 100);
    }

    if (canMinimize) {
      minBtn.addEventListener("click", function () {
        var api = app();
        if (api && typeof api.flush === "function") api.flush();
        var result;
        try {
          result = win.minimize();
        } catch (err) {
          notify("最小化失败：" + errorText(err), "error");
          return;
        }
        Promise.resolve(result).catch(function (err) {
          notify("最小化失败：" + errorText(err), "error");
        });
      });
    }

    if (canMaximize) {
      maxBtn.addEventListener("click", function () {
        var isMax;
        try {
          isMax = typeof win.isMaximized === "function" ? win.isMaximized() : false;
        } catch (err) {
          isMax = false;
        }
        Promise.resolve(isMax).then(function (value) {
          var action = value
            ? (typeof win.unmaximize === "function" ? win.unmaximize() : null)
            : win.maximize();
          return Promise.resolve(action).then(function () {
            applyMaximizedVisual(!value);
            setTimeout(refreshMaximized, 120);
          });
        }).catch(function (err) {
          notify("窗口操作失败：" + errorText(err), "error");
          refreshMaximized();
        });
      });
    }

    if (canClose) {
      closeBtn.addEventListener("click", function () {
        var api = app();
        if (api && typeof api.flush === "function") api.flush();
        var result;
        try {
          result = win.close();
        } catch (err) {
          notify("关闭失败：" + errorText(err), "error");
          return;
        }
        Promise.resolve(result).catch(function (err) {
          notify("关闭失败：" + errorText(err), "error");
        });
      });
    }

    if (canMaximize && dragRegion && typeof win.unmaximize === "function") {
      dragRegion.addEventListener("dblclick", function () {
        // 最大化后拖拽区属性被移除，Tauri 自带的双击还原不再生效；
        // 这里补上双击标题栏还原，按钮路径仍然照常可用。
        if (!document.body.classList.contains("win-maximized")) return;
        var result;
        try {
          result = win.unmaximize();
        } catch (err) {
          notify("还原失败：" + errorText(err), "error");
          return;
        }
        Promise.resolve(result).then(function () {
          applyMaximizedVisual(false);
          setTimeout(refreshMaximized, 120);
        }).catch(function (err) {
          notify("还原失败：" + errorText(err), "error");
        });
      });
    }

    window.addEventListener("resize", scheduleMaxRefresh);
    window.addEventListener("focus", scheduleMaxRefresh);
    refreshMaximized();
  }

  /* ------------------------------------------------------------------ *
   * 项目菜单
   * ------------------------------------------------------------------ */

  function setupProjectMenu() {
    var area = document.getElementById("project-area");
    var switchBtn = document.getElementById("project-switch");
    var nameNode = document.getElementById("project-name");
    var menu = document.getElementById("project-menu");
    var list = document.getElementById("project-list");
    var countNode = document.getElementById("project-count");
    var renameForm = document.getElementById("project-rename-form");
    var renameInput = document.getElementById("project-rename-input");
    var renameCancel = document.getElementById("project-rename-cancel");
    var newBtn = document.getElementById("project-new");
    var duplicateBtn = document.getElementById("project-duplicate");
    var renameBtn = document.getElementById("project-rename");
    var deleteBtn = document.getElementById("project-delete");
    var exportCurrentBtn = document.getElementById("project-export-current");
    var exportAllBtn = document.getElementById("project-export-all");
    var backupDirBtn = document.getElementById("project-backup-dir");
    if (!area || !switchBtn || !menu || !list) return;

    var open = false;
    var renamingId = null;

    function api() {
      return window.__sheetApp || null;
    }

    function projects() {
      var shell = api();
      if (!shell || typeof shell.getProjects !== "function") return [];
      try {
        return shell.getProjects() || [];
      } catch (err) {
        return [];
      }
    }

    function activeId() {
      var shell = api();
      if (!shell || typeof shell.getActiveProjectId !== "function") return null;
      try {
        return shell.getActiveProjectId();
      } catch (err) {
        return null;
      }
    }

    function findActive() {
      var id = activeId();
      var all = projects();
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].id === id) return all[i];
      }
      return all[0] || null;
    }

    function pad(value) {
      return value < 10 ? "0" + value : String(value);
    }

    function formatTime(iso) {
      var date = new Date(iso);
      if (isNaN(date.getTime())) return "";
      return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " +
        pad(date.getHours()) + ":" + pad(date.getMinutes());
    }

    function syncLabel() {
      var active = findActive();
      if (nameNode) nameNode.textContent = active ? active.name : "默认项目";
      if (countNode) countNode.textContent = projects().length + " 个";
      document.title = active
        ? active.name + (LITE ? " · 测量学局劲工具 轻量版" : " · 测量学局劲工具")
        : (LITE ? "测量学局劲工具 · 网页轻量版" : "测量学局劲工具");
      switchBtn.title = active ? "当前项目：" + active.name : "切换或管理项目";
      deleteBtn.disabled = projects().length <= 1;
      deleteBtn.title = projects().length <= 1 ? "至少保留一个项目" : "删除当前项目";
    }

    function endRename() {
      renamingId = null;
      if (renameForm) renameForm.hidden = true;
      if (renameInput) renameInput.value = "";
    }

    function beginRename(project) {
      if (!project || !renameForm || !renameInput) return;
      renamingId = project.id;
      renameForm.hidden = false;
      renameInput.value = project.name;
      renameInput.focus();
      renameInput.select();
    }

    function makeRow(project, currentId) {
      var isActive = project.id === currentId;
      var row = document.createElement("button");
      row.type = "button";
      row.className = "project-row" + (isActive ? " is-active" : "");
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("aria-checked", isActive ? "true" : "false");
      row.tabIndex = 0;

      var check = document.createElement("span");
      check.className = "project-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";

      var main = document.createElement("span");
      main.className = "project-row-main";

      var name = document.createElement("span");
      name.className = "project-row-name";
      name.textContent = project.name;

      var meta = document.createElement("span");
      meta.className = "project-row-meta";
      var bits = [project.pageCount + " 页"];
      var updated = formatTime(project.updatedAt);
      if (updated) bits.push(updated);
      if (project.linkage) bits.push("联立");
      meta.textContent = bits.join(" · ");

      main.appendChild(name);
      main.appendChild(meta);
      row.appendChild(check);
      row.appendChild(main);

      row.addEventListener("click", function () {
        var shell = api();
        if (!shell) return;
        if (project.id === activeId()) {
          closeMenu(true);
          return;
        }
        if (typeof shell.switchProject !== "function") return;
        var switched;
        try {
          switched = shell.switchProject(project.id);
        } catch (err) {
          notify("切换项目失败：" + errorText(err), "error");
          return;
        }
        if (switched) {
          endRename();
          closeMenu(true);
        }
      });

      return row;
    }

    function renderProjects() {
      if (!list) return;
      var shell = api();
      var all = projects();
      var currentId = activeId();
      list.textContent = "";
      if (!shell || all.length === 0) {
        var empty = document.createElement("div");
        empty.className = "project-row-meta";
        empty.textContent = "项目库尚未载入。";
        list.appendChild(empty);
        return;
      }
      all.forEach(function (project) {
        list.appendChild(makeRow(project, currentId));
      });
    }

    function renderAll() {
      syncLabel();
      renderProjects();
    }

    function openMenu(focusActive) {
      if (open) return;
      open = true;
      renderAll();
      menu.hidden = false;
      switchBtn.setAttribute("aria-expanded", "true");
      if (focusActive) {
        var currentId = activeId();
        var rows = list.querySelectorAll(".project-row");
        var target = null;
        for (var i = 0; i < rows.length; i += 1) {
          var rowButton = rows[i];
          if (rowButton.getAttribute("aria-checked") === "true") {
            target = rowButton;
            break;
          }
        }
        if (!target && rows.length) target = rows[0];
        if (target) target.focus();
      }
    }

    function closeMenu(returnFocus) {
      if (!open) return;
      open = false;
      menu.hidden = true;
      switchBtn.setAttribute("aria-expanded", "false");
      endRename();
      if (returnFocus) switchBtn.focus();
    }

    switchBtn.addEventListener("click", function () {
      if (open) closeMenu(true);
      else openMenu(false);
    });

    switchBtn.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu(true);
      }
    });

    list.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" &&
          event.key !== "Home" && event.key !== "End") {
        return;
      }
      var rows = Array.prototype.slice.call(list.querySelectorAll(".project-row"));
      if (!rows.length) return;
      var index = rows.indexOf(document.activeElement);
      var next = 0;
      if (event.key === "End") next = rows.length - 1;
      else if (event.key !== "Home" && index >= 0) {
        next = event.key === "ArrowDown"
          ? (index + 1) % rows.length
          : (index - 1 + rows.length) % rows.length;
      }
      event.preventDefault();
      rows[next].focus();
    });

    newBtn.addEventListener("click", function () {
      var shell = api();
      if (!shell || typeof shell.createProject !== "function") return;
      var project;
      try {
        project = shell.createProject();
      } catch (err) {
        notify("新建项目失败：" + errorText(err), "error");
        return;
      }
      if (!project) return;
      renderAll();
      beginRename(project);
    });

    duplicateBtn.addEventListener("click", function () {
      var shell = api();
      if (!shell || typeof shell.duplicateProject !== "function") return;
      var project;
      try {
        project = shell.duplicateProject();
      } catch (err) {
        notify("复制项目失败：" + errorText(err), "error");
        return;
      }
      if (!project) return;
      endRename();
      renderAll();
      notify("已复制为「" + project.name + "」。", "ok");
    });

    renameBtn.addEventListener("click", function () {
      var active = findActive();
      if (active) beginRename(active);
    });

    renameForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!renamingId) return;
      var shell = api();
      if (!shell || typeof shell.renameProject !== "function") return;
      var next = renameInput.value.replace(/\s+/g, " ").trim();
      if (!next) {
        notify("项目名称不能为空。", "error");
        renameInput.focus();
        return;
      }
      var project;
      try {
        project = shell.renameProject(renamingId, next);
      } catch (err) {
        notify("重命名失败：" + errorText(err), "error");
        return;
      }
      if (!project) {
        notify("重命名失败：名称不可用。", "error");
        return;
      }
      endRename();
      renderAll();
    });

    renameCancel.addEventListener("click", function () {
      endRename();
      renameBtn.focus();
    });

    renameInput.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        endRename();
        renameBtn.focus();
      }
    });

    deleteBtn.addEventListener("click", function () {
      var shell = api();
      if (!shell) return;
      var active = findActive();
      if (!active) return;
      if (projects().length <= 1) {
        notify("至少保留一个项目。", "error");
        return;
      }
      closeMenu(false);
      if (typeof shell.confirm !== "function" || typeof shell.deleteProject !== "function") return;
      shell.confirm(
        "删除项目",
        LITE
          ? "将删除项目「" + active.name + "」及其七表记录。\n此操作无法撤销；建议先「导出全部项目」备份。"
          : "将删除项目「" + active.name + "」及其七表记录，该工作区的 AI 对话也会删除。\n此操作无法撤销；建议先「导出全部项目」备份。",
        { confirmLabel: "删除项目", danger: true }
      ).then(function (ok) {
        if (!ok) return;
        var result;
        try {
          result = shell.deleteProject(active.id);
        } catch (err) {
          notify("删除失败：" + errorText(err), "error");
          return;
        }
        if (!result || !result.ok) {
          notify(result && result.reason === "last" ? "至少保留一个项目。" : "删除失败。", "error");
          return;
        }
        syncLabel();
        notify("已删除项目「" + active.name + "」。", "ok");
      });
    });

    if (exportCurrentBtn) {
      exportCurrentBtn.addEventListener("click", function () {
        var shell = api();
        if (!shell || typeof shell.exportJson !== "function") return;
        closeMenu(false);
        shell.exportJson();
      });
    }

    if (exportAllBtn) {
      exportAllBtn.addEventListener("click", function () {
        var shell = api();
        if (!shell || typeof shell.exportAllProjects !== "function") return;
        closeMenu(false);
        shell.exportAllProjects();
      });
    }

    if (backupDirBtn) {
      var desktop = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
      backupDirBtn.hidden = !desktop;
      backupDirBtn.addEventListener("click", function () {
        var shell = api();
        if (!shell || typeof shell.openBackupDir !== "function") return;
        closeMenu(false);
        shell.openBackupDir();
      });
    }

    document.addEventListener("pointerdown", function (event) {
      if (!open) return;
      if (area.contains(event.target)) return;
      closeMenu(false);
    }, true);

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !open) return;
      var modal = document.getElementById("modal-backdrop");
      if (modal && !modal.hidden) return;
      var drawer = document.getElementById("drawer");
      if (drawer && !drawer.hidden) return;
      event.preventDefault();
      if (renameForm && !renameForm.hidden) {
        endRename();
        renameBtn.focus();
      } else {
        closeMenu(true);
      }
    });

    document.addEventListener("jujin:projects-changed", function () {
      if (open) renderAll();
      else syncLabel();
    });

    syncLabel();
  }

  ready(function () {
    setupWindowControls();
    setupProjectMenu();
  });
})();
