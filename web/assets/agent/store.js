/* 测量学局劲工具 · Agent 存储
   agent.json 与项目库 store.json 分开：会话、人格、非敏感设置在这里；API Key
   只在 Windows 凭据管理器。人格提示词不截断；超过 2000 字只做软提示。 */
(function (global) {
  "use strict";

  var KEY = "survey-jujin.agent.v1";
  var VERSION = 1;
  var MAX_PERSONAS = 50;
  var MAX_PERSONA_NAME = 30;
  var MAX_SERIALIZED_BYTES = 12 * 1024 * 1024;
  /* localStorage 的 5 MiB 配额按 UTF-16 计算；4.5 MiB 给键名与实现差异留余量。 */
  var MAX_LOCAL_SERIALIZED_BYTES = 4.5 * 1024 * 1024;
  var BUILTIN_ID = "builtin-helpful";
  var BUILTIN_PROMPT = "You are a helpful assistant.";
  var TREE = global.JujinAgentTree || null;

  var DEFAULT_SETTINGS = {
    providerId: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    visionModel: "",
    imageSupport: "auto",
    imageDisclosureAcks: [],
    thinkingLevel: "high",
    searchEnabled: true,
    searchProvider: "deepseek",
    contextSize: 20,
    maxToolRounds: 6,
    agentMode: "work",
    permissionMode: "manual",
    strictManualReads: false,
    personas: [
      {
        id: BUILTIN_ID,
        name: "通用助手",
        prompt: BUILTIN_PROMPT,
        builtin: true
      }
    ],
    activePersonaId: BUILTIN_ID
  };

  var data = defaultData();
  var loaded = false;
  var mode = "local"; // local | native | memory | future
  var futureVersion = null;
  var corrupt = false;
  var lastError = null;
  var agentPath = "";
  var backupPath = "";
  var saveTimer = null;
  var saveChain = Promise.resolve();
  var lastSaveResult = null;
  var pendingSaves = 0;
  var dirty = false;
  var changeSeq = 0;
  var listeners = [];
  var seq = 0;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function utf8Length(value) {
    var text = String(value == null ? "" : value);
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    seq += 1;
    return String(prefix || "p") + "_" + Date.now().toString(36) + "_" +
      seq.toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  }

  function defaultPersona() {
    return clone(DEFAULT_SETTINGS.personas[0]);
  }

  function defaultSettings() {
    var settings = clone(DEFAULT_SETTINGS);
    settings.personas = [defaultPersona()];
    return settings;
  }

  function defaultData() {
    return {
      version: VERSION,
      settings: defaultSettings(),
      workspaces: {}
    };
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function clampInt(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function cleanName(value, limit) {
    var chars = Array.from(String(value == null ? "" : value).replace(/\s+/g, " ").trim());
    return chars.slice(0, Math.max(1, limit || MAX_PERSONA_NAME)).join("");
  }

  function validProviderId(value) {
    return /^[a-z0-9_-]{1,32}$/.test(String(value || ""));
  }

  function normalizePersona(raw) {
    raw = isPlainObject(raw) ? raw : {};
    if (raw.id === BUILTIN_ID || raw.builtin === true && !raw.id) {
      return defaultPersona();
    }
    var id = typeof raw.id === "string" && raw.id ? raw.id : makeId("p");
    return {
      id: id,
      name: cleanName(raw.name) || "未命名人格",
      prompt: String(raw.prompt == null ? "" : raw.prompt),
      builtin: false
    };
  }

  function normalizePersonas(raw, activeId) {
    var list = [];
    var seen = {};
    var source = Array.isArray(raw) ? raw : [];
    source.forEach(function (one) {
      if (!isPlainObject(one)) return;
      if (one.id === BUILTIN_ID || one.builtin === true) return;
      var persona = normalizePersona(one);
      if (seen[persona.id]) persona.id = makeId("p");
      seen[persona.id] = true;
      list.push(persona);
    });
    // 内置人格永远在第一位，提示词锁定。
    list.unshift(defaultPersona());
    var active = typeof activeId === "string" ? activeId : "";
    if (!list.some(function (one) { return one.id === active; })) active = BUILTIN_ID;
    return { personas: list, activePersonaId: active };
  }

  /* 只记 origin（scheme://host[:port]），用于“这个站点已披露过图片发送”。 */
  function normalizeAcks(raw) {
    var list = [];
    var seen = {};
    (Array.isArray(raw) ? raw : []).forEach(function (one) {
      if (typeof one !== "string") return;
      var value = one.trim();
      if (!value || value.length > 200 || !/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(value)) return;
      var key = value.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      list.push(value);
    });
    return list.slice(-20);
  }

  function normalizeSettings(raw) {
    raw = isPlainObject(raw) ? raw : {};
    var thinking = ["off", "low", "high", "max", "default"].indexOf(raw.thinkingLevel) !== -1
      ? raw.thinkingLevel : "high";
    var searchProvider = ["deepseek", "tavily", "brave", "searxng"].indexOf(raw.searchProvider) !== -1
      ? raw.searchProvider : "deepseek";
    var permission = ["read", "manual", "auto"].indexOf(raw.permissionMode) !== -1
      ? raw.permissionMode : "manual";
    var agentMode = raw.agentMode === "chat" ? "chat" : "work";
    var imageSupport = ["auto", "on", "off"].indexOf(raw.imageSupport) !== -1
      ? raw.imageSupport : "auto";
    var personaResult = normalizePersonas(raw.personas, raw.activePersonaId);
    return {
      providerId: validProviderId(raw.providerId) ? raw.providerId : "deepseek",
      baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim()
        ? raw.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
      model: typeof raw.model === "string" ? raw.model.trim() : "",
      visionModel: typeof raw.visionModel === "string" ? raw.visionModel.trim() : "",
      imageSupport: imageSupport,
      imageDisclosureAcks: normalizeAcks(raw.imageDisclosureAcks),
      thinkingLevel: thinking,
      searchEnabled: raw.searchEnabled !== false,
      searchProvider: searchProvider,
      contextSize: clampInt(raw.contextSize, 1, 100, 20),
      maxToolRounds: clampInt(raw.maxToolRounds, 1, 20, 6),
      agentMode: agentMode,
      permissionMode: permission,
      strictManualReads: !!raw.strictManualReads,
      personas: personaResult.personas,
      activePersonaId: personaResult.activePersonaId
    };
  }

  function normalizeWorkspace(raw, projectId) {
    raw = isPlainObject(raw) ? raw : {};
    var sessions = [];
    var seen = {};
    (Array.isArray(raw.sessions) ? raw.sessions : []).forEach(function (one) {
      if (!isPlainObject(one)) return;
      var session = TREE ? TREE.normalizeSession(one, projectId) : one;
      if (seen[session.sid]) session.sid = makeId("s");
      seen[session.sid] = true;
      sessions.push(session);
    });
    var active = typeof raw.activeSessionId === "string" ? raw.activeSessionId : "";
    if (!sessions.some(function (session) { return session.sid === active; })) {
      active = sessions.length ? sessions[0].sid : "";
    }
    return {
      activeSessionId: active,
      sessions: sessions,
      undoStack: Array.isArray(raw.undoStack) ? raw.undoStack.slice(-20) : [],
      updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : nowIso()
    };
  }

  function normalizeData(raw) {
    raw = isPlainObject(raw) ? raw : {};
    var workspaces = {};
    if (isPlainObject(raw.workspaces)) {
      Object.keys(raw.workspaces).forEach(function (projectId) {
        if (!projectId) return;
        workspaces[projectId] = normalizeWorkspace(raw.workspaces[projectId], projectId);
      });
    }
    return {
      version: VERSION,
      settings: normalizeSettings(raw.settings),
      workspaces: workspaces
    };
  }

  function notify() {
    var snapshot = status();
    listeners.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (err) { /* 监听器出错不影响存储 */ }
    });
  }

  function status() {
    return {
      loaded: loaded,
      mode: mode,
      futureVersion: futureVersion,
      corrupt: corrupt,
      error: lastError,
      path: agentPath,
      backupPath: backupPath,
      pending: pendingSaves,
      dirty: dirty,
      lastSave: lastSaveResult
    };
  }

  function readLocal() {
    try {
      return global.localStorage ? global.localStorage.getItem(KEY) : null;
    } catch (err) {
      lastError = "浏览器本地存储不可用。";
      return null;
    }
  }

  function writeLocal(text) {
    try {
      if (!global.localStorage) throw new Error("no-local-storage");
      global.localStorage.setItem(KEY, text);
      return Promise.resolve({ mode: "local", bytes: text.length });
    } catch (err) {
      return Promise.reject(new Error("浏览器本地存储写入失败。"));
    }
  }

  function platform() {
    return global.JujinPlatform || null;
  }

  function load() {
    var P = platform();
    if (P && typeof P.isDesktop === "function" && P.isDesktop() &&
        typeof P.nativeReady === "function" && P.nativeReady()) {
      return P.call("agent_store_load").then(function (result) {
        loaded = true;
        agentPath = result && result.path ? result.path : "";
        backupPath = result && result.backupPath ? result.backupPath : "";
        futureVersion = result && result.futureVersion ? result.futureVersion : null;
        if (futureVersion) {
          mode = "future";
          lastError = "对话库来自更高版本（v" + futureVersion + "），本次不会写入。";
          data = defaultData();
          notify();
          return status();
        }
        corrupt = !!(result && result.corrupt);
        mode = "native";
        if (corrupt) lastError = "对话库损坏，已隔离并重建。";
        var text = result && typeof result.text === "string" ? result.text : "";
        if (text) {
          try {
            data = normalizeData(JSON.parse(text));
          } catch (err) {
            corrupt = true;
            lastError = "对话库无法解析，已按空库启动。";
            data = defaultData();
          }
        }
        notify();
        return status();
      }).catch(function (err) {
        loaded = true;
        mode = "memory";
        lastError = "对话库读取失败：" + (err && err.message ? err.message : "未知错误");
        data = defaultData();
        notify();
        return status();
      });
    }

    loaded = true;
    mode = "local";
    var text = readLocal();
    if (text) {
      try {
        data = normalizeData(JSON.parse(text));
      } catch (err) {
        corrupt = true;
        lastError = "浏览器内的对话库无法解析，已隔离。";
        try {
          global.localStorage.setItem(KEY + ".corrupt-" + Date.now(), text);
          global.localStorage.removeItem(KEY);
        } catch (backupError) { /* 隔离失败也只影响这次启动 */ }
        data = defaultData();
      }
    }
    notify();
    return Promise.resolve(status());
  }

  // 只用于序列化副本：按会话创建时间从旧到新排列。
  function sessionsForStorageProtection(root) {
    var entries = [];
    var workspaces = isPlainObject(root && root.workspaces) ? root.workspaces : {};
    Object.keys(workspaces).forEach(function (projectId) {
      var workspace = workspaces[projectId];
      if (!isPlainObject(workspace) || !Array.isArray(workspace.sessions)) return;
      workspace.sessions.forEach(function (session, index) {
        if (!isPlainObject(session)) return;
        var created = typeof session.createdAt === "string" ? session.createdAt : "";
        var updated = typeof session.updatedAt === "string" ? session.updatedAt : "";
        entries.push({
          workspace: workspace,
          session: session,
          index: index,
          order: created || updated,
          sid: typeof session.sid === "string" ? session.sid : ""
        });
      });
    });
    entries.sort(function (a, b) {
      if (a.order !== b.order) return a.order < b.order ? -1 : 1;
      if (a.sid !== b.sid) return a.sid < b.sid ? -1 : 1;
      return a.index - b.index;
    });
    return entries;
  }

  function dropSessionExtras(entry) {
    var changed = false;
    var nodes = Array.isArray(entry.session.nodes) ? entry.session.nodes : [];
    nodes.forEach(function (node) {
      if (!isPlainObject(node) || !isPlainObject(node.assistant)) return;
      if (Array.isArray(node.assistant.steps) && node.assistant.steps.length) {
        node.assistant.steps = [];
        changed = true;
      }
    });
    if (Array.isArray(entry.workspace.undoStack) && entry.workspace.undoStack.length) {
      entry.workspace.undoStack = [];
      changed = true;
    }
    return changed;
  }

  function dropSessionThumbs(entry) {
    var changed = false;
    var nodes = Array.isArray(entry.session.nodes) ? entry.session.nodes : [];
    nodes.forEach(function (node) {
      var list = node && node.user && node.user.attachments;
      if (!Array.isArray(list)) return;
      list.forEach(function (attachment) {
        if (attachment && attachment.thumb) {
          attachment.thumb = "";
          changed = true;
        }
      });
    });
    return changed;
  }

  /* 原生写盘按 UTF-8 估字节；localStorage 实际按 UTF-16 计，各自用各自的上限。 */
  function serializedSize(text) {
    return mode === "local" ? text.length * 2 : utf8Length(text);
  }

  function serializedLimit() {
    return mode === "local" ? MAX_LOCAL_SERIALIZED_BYTES : MAX_SERIALIZED_BYTES;
  }

  function serialize() {
    // localStorage 模式不保留缩略图；全尺寸原图本就只活在内存里。
    var copy = null;
    if (mode === "local") {
      copy = clone(data);
      sessionsForStorageProtection(copy).forEach(dropSessionThumbs);
    }
    var text = JSON.stringify(copy || data);
    if (serializedSize(text) <= serializedLimit()) return text;
    // 超限时在副本上先从最旧会话丢缩略图，再丢工具卡与撤销记录，内存数据保持不变。
    if (!copy) copy = clone(data);
    var entries = sessionsForStorageProtection(copy);
    var i;
    for (i = 0; i < entries.length; i += 1) {
      if (!dropSessionThumbs(entries[i])) continue;
      text = JSON.stringify(copy);
      if (serializedSize(text) <= serializedLimit()) return text;
    }
    for (i = 0; i < entries.length; i += 1) {
      if (!dropSessionExtras(entries[i])) continue;
      text = JSON.stringify(copy);
      if (serializedSize(text) <= serializedLimit()) return text;
    }
    return text;
  }

  function saveNow() {
    if (mode === "future" || mode === "memory") {
      return Promise.resolve(null);
    }
    var text = serialize();
    // 本次写入覆盖到哪一刻的改动：写盘期间再有修改，成功回调不能把 dirty 清掉。
    var changeVersion = changeSeq;
    pendingSaves += 1;
    notify();

    var P = platform();
    var job = function () {
      if (mode === "native" && P && typeof P.call === "function") {
        return P.call("agent_store_save", { json: text });
      }
      return writeLocal(text);
    };
    var current = saveChain.then(job, job);
    saveChain = current.catch(function () { /* 错误由本次 promise 返回给 flush */ });
    current.then(function (result) {
      lastSaveResult = result || null;
      lastError = null;
      // 保存期间又有新改动时，dirty 留给下一次写，不能被这次成功误清。
      if (changeVersion === changeSeq) dirty = false;
      pendingSaves = Math.max(0, pendingSaves - 1);
      notify();
    }, function (err) {
      lastError = "对话库保存失败：" + (err && err.message ? err.message : "未知错误");
      // 失败后保持 dirty，关窗冲刷时还会重试；不能静默丢掉这一批改动。
      if (changeVersion === changeSeq) dirty = true;
      pendingSaves = Math.max(0, pendingSaves - 1);
      notify();
    });
    return current;
  }

  function scheduleSave() {
    if (mode === "future" || mode === "memory") return;
    changeSeq += 1;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow();
    }, 400);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!dirty && pendingSaves === 0) return saveChain.then(function () { return lastSaveResult; });
    if (dirty) return saveNow();
    return saveChain.then(function () { return lastSaveResult; });
  }

  function registerFlush() {
    var P = platform();
    if (P && typeof P.registerFlusher === "function") {
      P.registerFlusher(flush);
    }
  }

  function getSettings() {
    return data.settings;
  }

  function updateSettings(patch) {
    if (!isPlainObject(patch)) return data.settings;
    var merged = Object.assign({}, data.settings, patch);
    data.settings = normalizeSettings(merged);
    scheduleSave();
    return data.settings;
  }

  function getPersonas() {
    return data.settings.personas;
  }

  function getPersona(id) {
    var target = id || data.settings.activePersonaId;
    for (var i = 0; i < data.settings.personas.length; i += 1) {
      if (data.settings.personas[i].id === target) return data.settings.personas[i];
    }
    return data.settings.personas[0];
  }

  function getActivePersona() {
    return getPersona(data.settings.activePersonaId);
  }

  function setActivePersona(id) {
    if (!getPersona(id) || !data.settings.personas.some(function (one) { return one.id === id; })) {
      return getActivePersona();
    }
    data.settings.activePersonaId = id;
    scheduleSave();
    return getPersona(id);
  }

  /* 把当前选中的人格写进一个已存在的会话。
     会话仍保存人格快照；点「设为当前」时更新的是这一份快照，不影响其他会话。 */
  function applyPersonaToSession(projectId, sid, personaId) {
    /* 不用 getWorkspace()：它会给未知项目建一个空工作区。切换人格不该产生新项目。 */
    var workspace = projectId ? data.workspaces[projectId] : null;
    if (!workspace) return { ok: false, reason: "workspace" };
    var session = getSession(projectId, sid);
    if (!session) return { ok: false, reason: "session" };
    var persona = null;
    var wanted = personaId || data.settings.activePersonaId;
    for (var i = 0; i < data.settings.personas.length; i += 1) {
      if (data.settings.personas[i].id === wanted) {
        persona = data.settings.personas[i];
        break;
      }
    }
    if (!persona) return { ok: false, reason: "persona" };
    session.personaId = persona.id;
    session.personaName = persona.name;
    session.personaPrompt = persona.prompt;
    workspace.updatedAt = nowIso();
    scheduleSave();
    return { ok: true, persona: persona, session: session };
  }

  /* 把人格的当前名称与提示词同步到所有使用它的会话（含旧对话）。
     只改 personaId 相同的会话；其他会话保留各自快照。 */
  function applyPersonaToAllSessions(personaId) {
    var persona = getPersona(personaId);
    if (!persona || persona.id !== personaId) {
      return { ok: false, reason: "persona", updated: 0, matched: 0 };
    }
    var updated = 0;
    var matched = 0;
    Object.keys(data.workspaces).forEach(function (projectId) {
      var workspace = data.workspaces[projectId];
      if (!workspace || !Array.isArray(workspace.sessions)) return;
      var touched = false;
      workspace.sessions.forEach(function (session) {
        if (session.personaId !== persona.id) return;
        matched += 1;
        if (session.personaName === persona.name && session.personaPrompt === persona.prompt) {
          return;
        }
        session.personaName = persona.name;
        session.personaPrompt = persona.prompt;
        updated += 1;
        touched = true;
      });
      if (touched) workspace.updatedAt = nowIso();
    });
    if (updated) scheduleSave();
    return { ok: true, persona: persona, updated: updated, matched: matched };
  }

  function savePersona(raw) {
    raw = isPlainObject(raw) ? raw : {};
    if (raw.id === BUILTIN_ID) return { ok: false, reason: "builtin" };
    var persona = normalizePersona(raw);
    var index = -1;
    for (var i = 0; i < data.settings.personas.length; i += 1) {
      if (data.settings.personas[i].id === persona.id) {
        index = i;
        break;
      }
    }
    if (index === -1 && data.settings.personas.length >= MAX_PERSONAS) {
      return { ok: false, reason: "limit" };
    }
    if (index === -1) {
      data.settings.personas.push(persona);
    } else {
      if (data.settings.personas[index].builtin) return { ok: false, reason: "builtin" };
      data.settings.personas[index] = persona;
    }
    scheduleSave();
    return { ok: true, persona: persona };
  }

  function deletePersona(id) {
    if (id === BUILTIN_ID) return { ok: false, reason: "builtin" };
    var index = -1;
    for (var i = 0; i < data.settings.personas.length; i += 1) {
      if (data.settings.personas[i].id === id) {
        index = i;
        break;
      }
    }
    if (index === -1) return { ok: false, reason: "missing" };
    data.settings.personas.splice(index, 1);
    if (data.settings.activePersonaId === id) data.settings.activePersonaId = BUILTIN_ID;
    scheduleSave();
    return { ok: true };
  }

  function newPersonaDraft() {
    return {
      id: makeId("p"),
      name: "新人格",
      prompt: "",
      builtin: false
    };
  }

  function getWorkspace(projectId) {
    if (!projectId) return null;
    var workspace = data.workspaces[projectId];
    if (!workspace) workspace = ensureWorkspace(projectId);
    return workspace;
  }

  function ensureWorkspace(projectId) {
    if (!projectId) return null;
    if (!data.workspaces[projectId]) {
      data.workspaces[projectId] = normalizeWorkspace({}, projectId);
      scheduleSave();
    }
    return data.workspaces[projectId];
  }

  function createSession(projectId, options) {
    options = options || {};
    var workspace = ensureWorkspace(projectId);
    if (!workspace) return null;
    var settings = data.settings;
    var persona = getActivePersona();
    var session = TREE ? TREE.newSession(projectId, {
      model: options.model || settings.model,
      thinkingLevel: options.thinkingLevel || settings.thinkingLevel,
      agentMode: options.agentMode || settings.agentMode,
      permissionMode: options.permissionMode || settings.permissionMode,
      contextSize: options.contextSize || settings.contextSize,
      searchEnabled: options.searchEnabled != null ? options.searchEnabled : settings.searchEnabled,
      personaId: persona.id,
      personaName: persona.name,
      personaPrompt: persona.prompt
    }) : null;
    if (!session) return null;
    workspace.sessions.push(session);
    workspace.activeSessionId = session.sid;
    workspace.updatedAt = nowIso();
    scheduleSave();
    return session;
  }

  function getSessions(projectId) {
    var workspace = getWorkspace(projectId);
    return workspace ? workspace.sessions.slice() : [];
  }

  function getSession(projectId, sid) {
    var workspace = getWorkspace(projectId);
    if (!workspace) return null;
    for (var i = 0; i < workspace.sessions.length; i += 1) {
      if (workspace.sessions[i].sid === sid) return workspace.sessions[i];
    }
    return null;
  }

  function getActiveSession(projectId) {
    var workspace = getWorkspace(projectId);
    if (!workspace) return null;
    var session = getSession(projectId, workspace.activeSessionId);
    if (session) return session;
    if (workspace.sessions.length) {
      workspace.activeSessionId = workspace.sessions[0].sid;
      scheduleSave();
      return workspace.sessions[0];
    }
    return null;
  }

  function setActiveSession(projectId, sid) {
    var workspace = ensureWorkspace(projectId);
    if (!workspace) return null;
    var session = getSession(projectId, sid);
    if (!session) return null;
    workspace.activeSessionId = sid;
    workspace.updatedAt = nowIso();
    scheduleSave();
    return session;
  }

  function touchSession(projectId) {
    var workspace = getWorkspace(projectId);
    if (!workspace) return;
    workspace.updatedAt = nowIso();
    scheduleSave();
  }

  function deleteSession(projectId, sid) {
    var workspace = getWorkspace(projectId);
    if (!workspace) return { ok: false };
    var index = -1;
    for (var i = 0; i < workspace.sessions.length; i += 1) {
      if (workspace.sessions[i].sid === sid) {
        index = i;
        break;
      }
    }
    if (index === -1) return { ok: false };
    workspace.sessions.splice(index, 1);
    if (workspace.activeSessionId === sid) {
      workspace.activeSessionId = workspace.sessions.length ? workspace.sessions[0].sid : "";
    }
    workspace.updatedAt = nowIso();
    scheduleSave();
    return { ok: true };
  }

  function clearSessions(projectId) {
    var workspace = getWorkspace(projectId);
    if (!workspace) return;
    workspace.sessions = [];
    workspace.activeSessionId = "";
    workspace.undoStack = [];
    workspace.updatedAt = nowIso();
    scheduleSave();
  }

  function deleteWorkspace(projectId) {
    if (!projectId || !data.workspaces[projectId]) return false;
    delete data.workspaces[projectId];
    scheduleSave();
    return true;
  }

  function onStatus(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  var api = {
    KEY: KEY,
    VERSION: VERSION,
    MAX_PERSONAS: MAX_PERSONAS,
    BUILTIN_ID: BUILTIN_ID,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    load: load,
    flush: flush,
    registerFlush: registerFlush,
    status: status,
    onStatus: onStatus,
    serialize: serialize,
    getSettings: getSettings,
    updateSettings: updateSettings,
    getPersonas: getPersonas,
    getPersona: getPersona,
    getActivePersona: getActivePersona,
    setActivePersona: setActivePersona,
    applyPersonaToSession: applyPersonaToSession,
    applyPersonaToAllSessions: applyPersonaToAllSessions,
    savePersona: savePersona,
    deletePersona: deletePersona,
    newPersonaDraft: newPersonaDraft,
    getWorkspace: getWorkspace,
    ensureWorkspace: ensureWorkspace,
    createSession: createSession,
    getSessions: getSessions,
    getSession: getSession,
    getActiveSession: getActiveSession,
    setActiveSession: setActiveSession,
    touchSession: touchSession,
    deleteSession: deleteSession,
    clearSessions: clearSessions,
    deleteWorkspace: deleteWorkspace
  };

  global.JujinAgentStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
