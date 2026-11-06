/* 测量学局劲工具 · 项目存储 v2
   数据结构与界面不变；存储层有两种模式：
   - local：浏览器开发版，localStorage；
   - native：Tauri 桌面版，由 platform.js 串行写入 Rust 原生文件；
   - memory：原生存储不可用时的只读内存模式（不静默回退到 localStorage）。 */
(function (global) {
  "use strict";

  var KEY = "survey-jujin.dev.v1";
  var OLD_KEY = "survey-sheets.formal.v1";
  var SCHEMA_VERSION = 2;
  var MAX_NAME = 40;

  var store = null;
  var defaultStateFactory = null;
  var storageOk = true;
  var bootInfo = { loaded: false, migrated: false, corrupt: false, storageOk: true, mode: "local" };
  var idSeq = 0;

  var storageMode = "local"; // local | native | memory
  var saveSink = null;
  var saveListeners = [];
  var flushWaiters = [];
  var pendingWrites = 0;
  var writeSeq = 0;
  var lastSettledSeq = 0;
  var lastFailedSeq = 0;
  var lastSavedAt = null;
  var lastBackupAt = null;
  var lastSaveHadBackup = false;
  var lastBackupError = null;
  var lastError = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId() {
    idSeq += 1;
    return "p_" + Date.now().toString(36) + "_" + idSeq.toString(36) + "_" +
      Math.random().toString(36).slice(2, 6);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cleanName(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  }

  function defaultProjectState() {
    return defaultStateFactory ? defaultStateFactory() : {};
  }

  function pageCount(state) {
    if (!state || !state.pages || typeof state.pages !== "object") return 0;
    var total = 0;
    ["traverse", "leveling", "angle"].forEach(function (key) {
      if (Array.isArray(state.pages[key])) total += state.pages[key].length;
    });
    return total;
  }

  function defaultMapping() {
    return { version: 1, stations: {}, last: {} };
  }

  function normalizeLinkage(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var out = {
      enabled: !!raw.enabled,
      mapping: raw.mapping && typeof raw.mapping === "object" && !Array.isArray(raw.mapping)
        ? raw.mapping
        : defaultMapping()
    };
    if (raw.backup && typeof raw.backup === "object" &&
        raw.backup.state && typeof raw.backup.state === "object" &&
        !Array.isArray(raw.backup.state)) {
      out.backup = raw.backup;
    }
    return out;
  }

  function normalizeProject(raw, index) {
    raw = raw && typeof raw === "object" ? raw : {};
    var state = raw.state && typeof raw.state === "object" ? raw.state : defaultProjectState();
    if (state && state.data && typeof state.data === "object" && !state.pages) state = state.data;
    var createdAt = typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : nowIso();
    var updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : makeId(),
      name: cleanName(raw.name) || "项目 " + (index + 1),
      createdAt: createdAt,
      updatedAt: updatedAt,
      linkage: normalizeLinkage(raw.linkage),
      state: state
    };
  }

  function normalizeEnvelope(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (Number(raw.schemaVersion) !== SCHEMA_VERSION) return null;
    if (!Array.isArray(raw.projects) || raw.projects.length === 0) return null;

    var seen = {};
    var projects = raw.projects.map(function (one, index) {
      var project = normalizeProject(one, index);
      if (seen[project.id]) project.id = makeId();
      seen[project.id] = true;
      return project;
    });
    var activeProjectId = typeof raw.activeProjectId === "string" ? raw.activeProjectId : "";
    if (!projects.some(function (project) { return project.id === activeProjectId; })) {
      activeProjectId = projects[0].id;
    }
    var ui = raw.ui && typeof raw.ui === "object" ? raw.ui : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      activeProjectId: activeProjectId,
      ui: {
        activeModule: typeof ui.activeModule === "string" && ui.activeModule ? ui.activeModule : "traverse"
      },
      projects: projects
    };
  }

  function createFreshEnvelope() {
    var stamp = nowIso();
    var project = {
      id: makeId(),
      name: "默认项目",
      createdAt: stamp,
      updatedAt: stamp,
      linkage: normalizeLinkage(null),
      state: defaultProjectState()
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      activeProjectId: project.id,
      ui: { activeModule: "traverse" },
      projects: [project]
    };
  }

  function activeProject() {
    if (!store) return null;
    for (var i = 0; i < store.projects.length; i += 1) {
      if (store.projects[i].id === store.activeProjectId) return store.projects[i];
    }
    return store.projects[0] || null;
  }

  function findProject(id) {
    if (!store) return null;
    for (var i = 0; i < store.projects.length; i += 1) {
      if (store.projects[i].id === id) return store.projects[i];
    }
    return null;
  }

  function getSaveInfo() {
    return {
      mode: storageMode,
      pending: pendingWrites,
      lastError: lastError,
      lastSavedAt: lastSavedAt,
      lastBackupAt: lastBackupAt,
      lastSaveHadBackup: lastSaveHadBackup,
      lastBackupError: lastBackupError
    };
  }

  function notifySave() {
    var info = getSaveInfo();
    saveListeners.slice().forEach(function (listener) {
      try {
        listener(info);
      } catch (err) {
        if (global.console && console.error) console.error("[store] save listener", err);
      }
    });
    if (pendingWrites === 0 && flushWaiters.length) {
      var waiters = flushWaiters;
      flushWaiters = [];
      waiters.forEach(function (resolve) { resolve(info); });
    }
  }

  function onSaveStatus(listener) {
    if (typeof listener !== "function") return function () {};
    saveListeners.push(listener);
    return function () {
      var index = saveListeners.indexOf(listener);
      if (index >= 0) saveListeners.splice(index, 1);
    };
  }

  function flushWrites() {
    if (storageMode !== "native" || pendingWrites === 0) {
      return Promise.resolve(getSaveInfo());
    }
    return new Promise(function (resolve) {
      flushWaiters.push(resolve);
    });
  }

  function persist() {
    if (!store) throw new Error("项目库尚未载入。");

    var text;
    try {
      text = JSON.stringify(store);
    } catch (err) {
      storageOk = false;
      lastError = err;
      notifySave();
      throw err;
    }

    if (storageMode === "local") {
      try {
        global.localStorage.setItem(KEY, text);
        storageOk = true;
        lastError = null;
        lastSavedAt = new Date();
      } catch (err) {
        storageOk = false;
        lastError = err;
        notifySave();
        throw err;
      }
      return;
    }

    if (storageMode === "memory") {
      storageOk = false;
      if (!lastError) lastError = new Error("本机存储不可用。");
      notifySave();
      return;
    }

    if (!saveSink) {
      var missing = new Error("原生存储未配置。");
      storageOk = false;
      lastError = missing;
      notifySave();
      throw missing;
    }

    var seq = ++writeSeq;
    pendingWrites += 1;
    lastError = null;
    notifySave();

    var promise;
    try {
      promise = Promise.resolve(saveSink(text));
    } catch (err) {
      promise = Promise.reject(err);
    }

    promise.then(function (result) {
      if (seq > lastSettledSeq) {
        lastSettledSeq = seq;
        lastSavedAt = new Date();
        lastError = null;
        storageOk = true;
        lastSaveHadBackup = !!(result && result.backupWritten);
        lastBackupError = result && result.backupError ? String(result.backupError) : null;
        if (lastSaveHadBackup) lastBackupAt = new Date();
      }
      pendingWrites -= 1;
      notifySave();
    }, function (err) {
      if (seq >= lastSettledSeq && seq >= lastFailedSeq) {
        lastFailedSeq = seq;
        lastError = err instanceof Error ? err : new Error(String(err && err.message || err));
        storageOk = false;
      }
      pendingWrites -= 1;
      notifySave();
    });
  }

  function backupCorrupt(text) {
    try {
      global.localStorage.setItem(KEY + ".corrupt-" + Date.now(), text);
    } catch (err) {
      /* 备份失败时也不能阻塞开新库 */
    }
  }

  function readOldState() {
    var text;
    try {
      text = global.localStorage.getItem(OLD_KEY);
    } catch (err) {
      return null;
    }
    if (!text) return null;
    try {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") return null;
      var state = parsed.data && typeof parsed.data === "object" && !parsed.pages ? parsed.data : parsed;
      return state && typeof state === "object" ? state : null;
    } catch (err) {
      return null;
    }
  }

  function migrateOldState() {
    var state = readOldState();
    if (!state) return false;
    var stamp = nowIso();
    var project = {
      id: makeId(),
      name: "旧记录",
      createdAt: stamp,
      updatedAt: stamp,
      linkage: normalizeLinkage(null),
      state: state
    };
    store.projects = [project];
    store.activeProjectId = project.id;
    bootInfo.migrated = true;
    bootInfo.loaded = true;
    return true;
  }

  function boot(factory, options) {
    options = options || {};
    defaultStateFactory = typeof factory === "function" ? factory : function () { return {}; };

    storageMode = options.mode === "native" || options.mode === "memory" ? options.mode : "local";
    saveSink = typeof options.write === "function" ? options.write : null;
    if (storageMode === "native" && !saveSink) storageMode = "memory";

    store = null;
    bootInfo = {
      loaded: false,
      migrated: false,
      corrupt: !!options.corrupt,
      storageOk: true,
      mode: storageMode
    };
    storageOk = true;
    pendingWrites = 0;
    writeSeq = 0;
    lastSettledSeq = 0;
    lastFailedSeq = 0;
    lastSavedAt = null;
    lastBackupAt = null;
    lastSaveHadBackup = false;
    lastBackupError = null;
    lastError = null;

    var text = null;
    if (typeof options.text === "string") {
      text = options.text;
    } else if (typeof options.text === "undefined" && storageMode === "local") {
      try {
        text = global.localStorage ? global.localStorage.getItem(KEY) : null;
      } catch (err) {
        storageOk = false;
      }
    }

    if (text) {
      try {
        var parsed = normalizeEnvelope(JSON.parse(text));
        if (!parsed) throw new Error("项目库结构不符合 schemaVersion 2。");
        store = parsed;
        bootInfo.loaded = true;
      } catch (err) {
        bootInfo.corrupt = true;
        backupCorrupt(text);
      }
    }

    if (!store) {
      store = createFreshEnvelope();
      if (!migrateOldState()) {
        bootInfo.loaded = false;
      }
      try {
        persist();
      } catch (err) {
        storageOk = false;
      }
    } else if (storageOk) {
      try {
        persist();
      } catch (err) {
        storageOk = false;
      }
    }

    bootInfo.storageOk = storageOk;
    return {
      loaded: bootInfo.loaded,
      migrated: bootInfo.migrated,
      corrupt: bootInfo.corrupt,
      storageOk: bootInfo.storageOk,
      mode: bootInfo.mode
    };
  }

  function getActiveProject() {
    return activeProject();
  }

  function getActiveProjectId() {
    var project = activeProject();
    return project ? project.id : null;
  }

  function listProjects() {
    if (!store) return [];
    return store.projects.map(function (project) {
      return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        linkage: !!(project.linkage && project.linkage.enabled),
        pageCount: pageCount(project.state)
      };
    });
  }

  function saveActiveState(state) {
    var project = activeProject();
    if (!project) throw new Error("没有可写入的项目。");
    project.state = state;
    project.updatedAt = nowIso();
    persist();
    return project;
  }

  function switchProject(id) {
    var project = findProject(id);
    if (!project) return null;
    var previous = store.activeProjectId;
    store.activeProjectId = project.id;
    try {
      persist();
    } catch (err) {
      store.activeProjectId = previous;
      throw err;
    }
    return project;
  }

  function uniqueName(base) {
    var name = cleanName(base) || "项目";
    var names = {};
    store.projects.forEach(function (project) { names[project.name] = true; });
    if (!names[name]) return name;
    var n = 2;
    while (true) {
      var suffix = " " + n;
      var candidate = cleanName(name.slice(0, Math.max(1, MAX_NAME - suffix.length)) + suffix);
      if (!names[candidate]) return candidate;
      n += 1;
    }
  }

  function defaultNewName() {
    var n = store.projects.length + 1;
    var names = {};
    store.projects.forEach(function (project) { names[project.name] = true; });
    while (names["项目 " + n]) n += 1;
    return "项目 " + n;
  }

  function createProject(name, state) {
    var stamp = nowIso();
    var project = {
      id: makeId(),
      name: uniqueName(cleanName(name) || defaultNewName()),
      createdAt: stamp,
      updatedAt: stamp,
      linkage: normalizeLinkage(null),
      state: state && typeof state === "object" ? state : defaultProjectState()
    };
    var previousActive = store.activeProjectId;
    store.projects.push(project);
    store.activeProjectId = project.id;
    try {
      persist();
    } catch (err) {
      store.projects.pop();
      store.activeProjectId = previousActive;
      throw err;
    }
    return project;
  }

  function duplicateProject(sourceId, name) {
    var source = findProject(sourceId) || activeProject();
    if (!source) return null;
    var stamp = nowIso();
    var project = {
      id: makeId(),
      name: uniqueName(cleanName(name) || source.name + " 副本"),
      createdAt: stamp,
      updatedAt: stamp,
      linkage: normalizeLinkage(clone(source.linkage)),
      state: clone(source.state)
    };
    var previousActive = store.activeProjectId;
    store.projects.push(project);
    store.activeProjectId = project.id;
    try {
      persist();
    } catch (err) {
      store.projects.pop();
      store.activeProjectId = previousActive;
      throw err;
    }
    return project;
  }

  function renameProject(id, name) {
    var project = findProject(id);
    if (!project) return null;
    var next = cleanName(name);
    if (!next) return null;
    var previousName = project.name;
    var previousUpdated = project.updatedAt;
    project.name = next;
    project.updatedAt = nowIso();
    try {
      persist();
    } catch (err) {
      project.name = previousName;
      project.updatedAt = previousUpdated;
      throw err;
    }
    return project;
  }

  function deleteProject(id) {
    if (!store || store.projects.length <= 1) return { ok: false, reason: "last" };
    var index = -1;
    for (var i = 0; i < store.projects.length; i += 1) {
      if (store.projects[i].id === id) { index = i; break; }
    }
    if (index < 0) return { ok: false, reason: "missing" };
    var wasActive = store.activeProjectId === id;
    var previousActive = store.activeProjectId;
    var removed = store.projects[index];
    store.projects.splice(index, 1);
    if (wasActive) store.activeProjectId = store.projects[Math.min(index, store.projects.length - 1)].id;
    try {
      persist();
    } catch (err) {
      store.projects.splice(index, 0, removed);
      store.activeProjectId = previousActive;
      throw err;
    }
    return { ok: true, wasActive: wasActive, activeProjectId: store.activeProjectId };
  }

  function setActiveModule(module) {
    if (!store) return false;
    var next = String(module || "traverse");
    if (store.ui.activeModule === next) return true;
    var previous = store.ui.activeModule;
    store.ui.activeModule = next;
    try {
      persist();
      return true;
    } catch (err) {
      store.ui.activeModule = previous;
      return false;
    }
  }

  function getActiveModule() {
    return store && store.ui && store.ui.activeModule ? store.ui.activeModule : "traverse";
  }

  function getLinkage() {
    var project = activeProject();
    return normalizeLinkage(project ? clone(project.linkage) : null);
  }

  function setLinkage(source) {
    var project = activeProject();
    if (!project) throw new Error("没有可写入的项目。");
    var previousLinkage = project.linkage;
    var previousUpdated = project.updatedAt;
    project.linkage = normalizeLinkage(clone(source));
    project.updatedAt = nowIso();
    try {
      persist();
    } catch (err) {
      project.linkage = previousLinkage;
      project.updatedAt = previousUpdated;
      throw err;
    }
    return clone(project.linkage);
  }

  function exportAll() {
    if (!store) return null;
    return clone(store);
  }

  function replaceAll(projects, activeProjectId) {
    var envelope = normalizeEnvelope({
      schemaVersion: SCHEMA_VERSION,
      activeProjectId: activeProjectId,
      ui: { activeModule: "traverse" },
      projects: projects
    });
    if (!envelope) throw new Error("项目数据不符合 schemaVersion 2。");
    var previous = store;
    store = envelope;
    try {
      persist();
    } catch (err) {
      store = previous;
      throw err;
    }
    return activeProject();
  }

  function getStorageOk() {
    return storageOk;
  }

  function newId() {
    return makeId();
  }

  global.JujinStore = {
    KEY: KEY,
    OLD_KEY: OLD_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    boot: boot,
    getActiveProject: getActiveProject,
    getActiveProjectId: getActiveProjectId,
    listProjects: listProjects,
    saveActiveState: saveActiveState,
    switchProject: switchProject,
    createProject: createProject,
    duplicateProject: duplicateProject,
    renameProject: renameProject,
    deleteProject: deleteProject,
    setActiveModule: setActiveModule,
    getActiveModule: getActiveModule,
    getLinkage: getLinkage,
    setLinkage: setLinkage,
    exportAll: exportAll,
    replaceAll: replaceAll,
    getStorageOk: getStorageOk,
    getSaveInfo: getSaveInfo,
    onSaveStatus: onSaveStatus,
    flushWrites: flushWrites,
    newId: newId
  };
})(typeof window !== "undefined" ? window : globalThis);
