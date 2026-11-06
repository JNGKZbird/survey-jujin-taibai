/* 测量学局劲工具 · 对话树
   数据结构是“轮次节点 + 当前路径”：分支以轮为单位，分叉保留旧子树，切换分支
   改写 path。M2 已开放分叉、重新生成、编辑重发与切换；删除子树仍未做。 */
(function (global) {
  "use strict";

  var seq = 0;
  var PROMPT = global.JujinAgentPrompt || null;
  var ATT = global.JujinAgentAttachments || null;

  // 加载持久化数据时的容量上限：只保留可回放的工具卡，超大字段按字节截断。
  var MAX_STEPS = 40;
  var MAX_TEXT_BEFORE_BYTES = 8 * 1024;
  var MAX_REASON_BYTES = 20 * 1024;
  var MAX_STEP_EDITS = 40;
  var MAX_STEP_ERROR_BYTES = 2 * 1024;
  var MAX_STEP_UNDO = 20;
  var MAX_STEP_STRING_BYTES = 4 * 1024;
  var MAX_STEP_JSON_BYTES = 24 * 1024;
  var MAX_STEP_NESTED_ITEMS = 200;
  var MAX_STEP_RESULTS = 8;
  var MAX_RESULT_TITLE_BYTES = 200;
  var MAX_RESULT_URL_BYTES = 1024;
  var MAX_RESULT_SITE_BYTES = 80;
  var MAX_RESULT_DATE_BYTES = 32;
  var TRANSIENT_STEP_STATUS = {
    pending: true,
    awaiting: true,
    running: true,
    applying: true
  };

  function nowIso() {
    return new Date().toISOString();
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

  function truncateUtf8(value, limit) {
    var text = String(value == null ? "" : value);
    if (utf8Length(text) <= limit) return text;
    var out = "";
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      var size;
      if (code < 0x80) {
        size = 1;
      } else if (code < 0x800) {
        size = 2;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        size = 4;
      } else {
        size = 3;
      }
      if (bytes + size > limit) break;
      bytes += size;
      if (size === 4) {
        out += text.charAt(i) + text.charAt(i + 1);
        i += 1;
      } else {
        out += text.charAt(i);
      }
    }
    return out;
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function makeId(prefix) {
    seq += 1;
    return String(prefix || "n") + "_" + Date.now().toString(36) + "_" +
      seq.toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cleanText(value) {
    return String(value == null ? "" : value);
  }

  function isPrivateResultHost(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (!host) return true;
    if (host === "localhost" || /\.localhost$/.test(host) || /\.local$/.test(host)) {
      return true;
    }
    var ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      var a = Number(ipv4[1]);
      var b = Number(ipv4[2]);
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
      return false;
    }
    if (host.charAt(0) === "[" && host.charAt(host.length - 1) === "]") {
      var ipv6 = host.slice(1, -1);
      if (ipv6 === "::" || ipv6 === "::1") return true;
      if (/^f[cd]/i.test(ipv6)) return true;
      if (/^fe[89ab]/i.test(ipv6)) return true;
    }
    return false;
  }

  function safeResultUrl(value) {
    var text = truncateUtf8(cleanText(value).trim(), MAX_RESULT_URL_BYTES);
    if (!text) return null;
    var parsed;
    try {
      parsed = new URL(text);
    } catch (err) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    if (isPrivateResultHost(parsed.hostname)) return null;
    if (utf8Length(parsed.href) > MAX_RESULT_URL_BYTES) return null;
    return parsed;
  }

  // 来源只留标题/链接/站点/日期；摘要、正文、图标一律不落盘。
  function normalizeStepResults(value) {
    if (!Array.isArray(value)) return undefined;
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < value.length && out.length < MAX_STEP_RESULTS; i += 1) {
      var source = value[i];
      if (!isRecord(source)) continue;
      var parsed = safeResultUrl(source.url);
      if (!parsed) continue;
      var dedup = new URL(parsed.href);
      dedup.hash = "";
      var key = dedup.href;
      if (seen[key]) continue;
      seen[key] = true;
      var site = String(parsed.hostname || "").replace(/\.$/, "");
      if (site.indexOf("www.") === 0) site = site.slice(4);
      site = truncateUtf8(site, MAX_RESULT_SITE_BYTES);
      var title = cleanText(source.title).replace(/\s+/g, " ").trim();
      title = title
        ? truncateUtf8(redactText(title, MAX_RESULT_TITLE_BYTES), MAX_RESULT_TITLE_BYTES)
        : site;
      if (!title) continue;
      var one = { title: title, url: parsed.href, site: site };
      var date = cleanText(source.date).replace(/\s+/g, " ").trim();
      if (date) one.date = truncateUtf8(redactText(date, MAX_RESULT_DATE_BYTES), MAX_RESULT_DATE_BYTES);
      out.push(one);
    }
    while (out.length && jsonBytes(out) > MAX_STEP_JSON_BYTES) out.pop();
    return out.length ? out : undefined;
  }

  /* 附件只留白名单元数据；dataUrl/字节/路径绝不入树。附件模块未加载时宁可不存。 */
  function normalizeUser(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      text: cleanText(raw.text),
      attachments: ATT ? ATT.normalizeList(raw.attachments) : []
    };
  }

  function redactText(value, limit) {
    var text = String(value == null ? "" : value);
    return ATT ? ATT.redactSensitive(text, limit) : truncateUtf8(text, limit);
  }

  // 落盘前递归脱敏：base64、长串、Bearer/sk- 密钥都不进 agent.json。
  function redactValue(value, depth) {
    if (typeof value === "string") return redactText(value, MAX_STEP_STRING_BYTES);
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (depth > 8) return "[层级过深]";
    if (Array.isArray(value)) {
      return value.slice(0, MAX_STEP_NESTED_ITEMS).map(function (one) {
        return redactValue(one, depth + 1);
      });
    }
    if (!isRecord(value)) return undefined;
    var out = {};
    Object.keys(value).slice(0, MAX_STEP_NESTED_ITEMS).forEach(function (key) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return;
      var one = redactValue(value[key], depth + 1);
      if (one !== undefined) out[key] = one;
    });
    return out;
  }

  function jsonBytes(value) {
    try {
      return utf8Length(JSON.stringify(value));
    } catch (err) {
      return Infinity;
    }
  }

  function normalizeStepError(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string") return redactText(value, MAX_STEP_ERROR_BYTES);
    var redacted = redactValue(value, 0);
    var text;
    try {
      text = JSON.stringify(redacted);
    } catch (err) {
      text = String(value);
    }
    if (typeof text !== "string") text = String(value);
    if (utf8Length(text) <= MAX_STEP_ERROR_BYTES) return redacted;
    return truncateUtf8(text, MAX_STEP_ERROR_BYTES);
  }

  function normalizeStepArgs(value) {
    if (!isRecord(value)) return undefined;
    var redacted = redactValue(value, 0);
    if (jsonBytes(redacted) <= MAX_STEP_JSON_BYTES) return redacted;
    // 超限时只留卡片定位需要的字段；完整参数可由用户重新展开工具结果查看。
    var slim = {};
    if (typeof value.table === "string") slim.table = truncateUtf8(value.table, 64);
    if (typeof value.page === "number" && isFinite(value.page)) slim.page = value.page;
    return Object.keys(slim).length ? slim : undefined;
  }

  function normalizeStepEdits(value) {
    if (!Array.isArray(value)) return undefined;
    var list = value.slice(0, MAX_STEP_EDITS).map(function (one) {
      return redactValue(one, 0);
    }).filter(function (one) { return one !== undefined; });
    while (list.length && jsonBytes(list) > MAX_STEP_JSON_BYTES) list.pop();
    return list.length ? list : undefined;
  }

  function normalizeStepUndo(value) {
    if (Array.isArray(value)) {
      var list = value.slice(-MAX_STEP_UNDO).map(function (one) {
        return redactValue(one, 0);
      }).filter(function (one) { return one !== undefined; });
      while (list.length && jsonBytes(list) > MAX_STEP_JSON_BYTES) list.shift();
      return list.length ? list : undefined;
    }
    if (isRecord(value)) {
      var redacted = redactValue(value, 0);
      return jsonBytes(redacted) <= MAX_STEP_JSON_BYTES ? redacted : undefined;
    }
    return undefined;
  }

  // 显式白名单：content / call / previewToken / 读表快照 / arguments 原文一律不落盘。
  function normalizeStep(raw) {
    if (!isRecord(raw)) return null;
    var step = {};
    if (typeof raw.tool === "string" && raw.tool) step.tool = raw.tool;
    if (typeof raw.status === "string" && raw.status) {
      step.status = TRANSIENT_STEP_STATUS[raw.status] ? "interrupted" : raw.status;
    }
    var args = normalizeStepArgs(raw.args);
    if (args) step.args = args;
    if (typeof raw.summary === "string") {
      step.summary = redactText(raw.summary, MAX_STEP_ERROR_BYTES);
    }
    var error = normalizeStepError(raw.error);
    if (error !== undefined) step.error = error;
    var results = normalizeStepResults(raw.results);
    if (results) step.results = results;
    var edits = normalizeStepEdits(raw.edits);
    if (edits) step.edits = edits;
    var undo = normalizeStepUndo(raw.undo);
    if (undo !== undefined) step.undo = undo;
    if (typeof raw.textBefore === "string") {
      step.textBefore = truncateUtf8(raw.textBefore, MAX_TEXT_BEFORE_BYTES);
    }
    if (typeof raw.expanded === "boolean") step.expanded = raw.expanded;
    if (typeof raw.startedAt === "string" || typeof raw.startedAt === "number") {
      step.startedAt = raw.startedAt;
    }
    if (typeof raw.finishedAt === "string" || typeof raw.finishedAt === "number") {
      step.finishedAt = raw.finishedAt;
    }
    if (typeof raw.undone === "boolean") step.undone = raw.undone;
    return step;
  }

  // 错误详情可能夹带 base64 / 密钥；落盘与展示前统一脱敏并封顶。
  function normalizeAssistantError(raw) {
    if (!isRecord(raw)) return null;
    var out = {};
    if (typeof raw.code === "string" && raw.code) out.code = truncateUtf8(raw.code, 80);
    ["hint", "detail"].forEach(function (key) {
      if (typeof raw[key] !== "string" || !raw[key]) return;
      out[key] = ATT
        ? ATT.redactSensitive(raw[key], MAX_STEP_ERROR_BYTES)
        : truncateUtf8(raw[key], MAX_STEP_ERROR_BYTES);
    });
    return Object.keys(out).length ? out : null;
  }

  function normalizeAssistant(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var reason = truncateUtf8(cleanText(raw.reason), MAX_REASON_BYTES);
    var steps = [];
    if (Array.isArray(raw.steps)) {
      raw.steps.forEach(function (one) {
        var step = normalizeStep(one);
        if (step && Object.keys(step).length) steps.push(step);
      });
      // 超限丢最旧卡片；最终文本在 assistant.text，不受影响。
      if (steps.length > MAX_STEPS) steps = steps.slice(-MAX_STEPS);
    }
    return {
      text: cleanText(raw.text),
      reason: reason,
      model: cleanText(raw.model),
      steps: steps,
      stats: raw.stats && typeof raw.stats === "object" ? clone(raw.stats) : null,
      error: normalizeAssistantError(raw.error)
    };
  }

  function normalizeRound(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      nid: typeof raw.nid === "string" && raw.nid ? raw.nid : makeId("n"),
      parent: typeof raw.parent === "string" && raw.parent ? raw.parent : null,
      children: Array.isArray(raw.children) ? raw.children.filter(function (id) {
        return typeof id === "string" && id;
      }) : [],
      user: normalizeUser(raw.user),
      assistant: normalizeAssistant(raw.assistant),
      time: typeof raw.time === "string" && raw.time ? raw.time : nowIso()
    };
  }

  function newNode(options) {
    options = options || {};
    return normalizeRound({
      nid: makeId("n"),
      user: options.user,
      assistant: options.assistant,
      time: nowIso()
    });
  }

  function newSession(projectId, options) {
    options = options || {};
    var persona = options.persona && typeof options.persona === "object" ? options.persona : {};
    var stamp = nowIso();
    return {
      sid: makeId("s"),
      title: "新对话",
      projectId: cleanText(projectId),
      createdAt: stamp,
      updatedAt: stamp,
      nodes: [],
      path: [],
      rootIds: [],
      contextSize: Number(options.contextSize) > 0 ? Math.floor(Number(options.contextSize)) : 20,
      model: cleanText(options.model),
      thinkingLevel: cleanText(options.thinkingLevel) || "high",
      agentMode: options.agentMode === "chat" ? "chat" : "work",
      permissionMode: cleanText(options.permissionMode) || "manual",
      personaId: cleanText(options.personaId || persona.id),
      personaName: cleanText(options.personaName || persona.name || "通用助手"),
      personaPrompt: cleanText(options.personaPrompt || persona.prompt),
      searchEnabled: options.searchEnabled !== false,
      titled: false
    };
  }

  function nodeById(session, nid) {
    if (!session || !Array.isArray(session.nodes)) return null;
    for (var i = 0; i < session.nodes.length; i += 1) {
      if (session.nodes[i].nid === nid) return session.nodes[i];
    }
    return null;
  }

  function activeNodes(session) {
    if (!session) return [];
    var out = [];
    var path = Array.isArray(session.path) ? session.path : [];
    for (var i = 0; i < path.length; i += 1) {
      var node = nodeById(session, path[i]);
      if (node) out.push(node);
    }
    return out;
  }

  function applyTitle(session, text, attachments) {
    var value = cleanText(text).trim();
    var images = Array.isArray(attachments) ? attachments.length : 0;
    if (!session.titled && !value && images) value = "图片 " + images + " 张";
    if (!session.titled && value) {
      session.title = PROMPT ? PROMPT.titleFrom(value, 16) : value.slice(0, 16);
      session.titled = true;
    }
  }

  function appendRound(session, round) {
    var node = normalizeRound(round);
    var parentId = session.path.length ? session.path[session.path.length - 1] : null;
    node.parent = parentId;
    node.children = [];
    session.nodes.push(node);
    if (parentId) {
      var parent = nodeById(session, parentId);
      if (parent) parent.children.push(node.nid);
      else session.rootIds.push(node.nid);
    } else {
      session.rootIds.push(node.nid);
    }
    session.path.push(node.nid);
    session.updatedAt = nowIso();
    applyTitle(session, node.user.text, node.user.attachments);
    return node;
  }

  function pathTo(session, nid) {
    if (!session || !Array.isArray(session.nodes) || typeof nid !== "string" || !nid) return null;
    var node = nodeById(session, nid);
    if (!node) return null;
    var out = [];
    var seen = {};
    var guard = 0;
    var current = node;
    while (current) {
      guard += 1;
      if (guard > session.nodes.length + 1) return null;
      if (seen[current.nid]) return null;
      seen[current.nid] = true;
      out.unshift(current.nid);
      if (!current.parent) return out;
      current = nodeById(session, current.parent);
      if (!current) return null;
    }
    return null;
  }

  function siblingsOf(session, nid) {
    var node = nodeById(session, nid);
    if (!node) return [];
    var ids = null;
    if (node.parent) {
      var parent = nodeById(session, node.parent);
      if (parent) ids = parent.children;
    }
    if (!ids) ids = session.rootIds;
    var out = [];
    var seen = {};
    if (Array.isArray(ids)) {
      ids.forEach(function (id) {
        if (seen[id]) return;
        var sibling = nodeById(session, id);
        if (!sibling) return;
        seen[id] = true;
        out.push(sibling);
      });
    }
    if (!seen[node.nid]) out.push(node);
    return out;
  }

  function branchIndex(session, nid) {
    var siblings = siblingsOf(session, nid);
    for (var i = 0; i < siblings.length; i += 1) {
      if (siblings[i].nid === nid) return { index: i + 1, total: siblings.length };
    }
    return { index: 0, total: 0 };
  }

  function forkRound(session, sourceNid, options) {
    if (!session || !Array.isArray(session.nodes)) return null;
    var source = nodeById(session, sourceNid);
    if (!source) return null;
    var parentId = source.parent;
    var parent = null;
    var parentPath = [];
    if (parentId) {
      parent = nodeById(session, parentId);
      if (!parent) return null;
      parentPath = pathTo(session, parentId);
      if (!parentPath) return null;
    }
    var next = options && typeof options === "object" ? options : {};
    var userPatch = next.user && typeof next.user === "object" ? next.user : {};
    var text = typeof userPatch.text === "string" ? userPatch.text : source.user.text;
    var sourceAttachments = Array.isArray(userPatch.attachments)
      ? userPatch.attachments
      : source.user.attachments;
    var attachments = ATT ? ATT.normalizeList(sourceAttachments) : clone(sourceAttachments);
    var node = normalizeRound({
      user: { text: text, attachments: attachments },
      assistant: { model: cleanText(next.model) },
      time: nowIso()
    });
    node.parent = parentId;

    if (parent) {
      if (parent.children.indexOf(sourceNid) === -1) parent.children.push(sourceNid);
      parent.children.push(node.nid);
    } else {
      if (session.rootIds.indexOf(sourceNid) === -1) session.rootIds.push(sourceNid);
      session.rootIds.push(node.nid);
    }
    session.nodes.push(node);
    session.path = parentPath.concat([node.nid]);
    session.updatedAt = nowIso();
    applyTitle(session, node.user.text, node.user.attachments);
    return node;
  }

  function switchBranch(session, nid) {
    if (!session || !Array.isArray(session.nodes)) return false;
    var node = nodeById(session, nid);
    if (!node) return false;
    var parentPath = [];
    if (node.parent) {
      parentPath = pathTo(session, node.parent);
      if (!parentPath) return false;
    }
    var candidate = parentPath.concat([nid]);
    var seen = {};
    candidate.forEach(function (id) { seen[id] = true; });
    var current = node;
    var guard = 0;
    while (current) {
      guard += 1;
      if (guard > session.nodes.length + 1) return false;
      var nextId = null;
      var children = Array.isArray(current.children) ? current.children : [];
      for (var i = 0; i < children.length; i += 1) {
        var child = nodeById(session, children[i]);
        if (!child) continue;
        if (seen[child.nid]) break;
        nextId = child.nid;
        break;
      }
      if (!nextId) break;
      seen[nextId] = true;
      candidate.push(nextId);
      current = nodeById(session, nextId);
      if (!current) break;
    }
    session.path = candidate;
    return true;
  }

  function resetAssistant(session, nid, options) {
    var node = nodeById(session, nid);
    if (!node) return null;
    var next = options && typeof options === "object" ? options : {};
    var model = cleanText(next.model) || node.assistant.model;
    node.assistant = normalizeAssistant({ model: model });
    session.updatedAt = nowIso();
    return node;
  }

  function assistantHasContent(value) {
    var assistant = value && typeof value === "object" && value.assistant
      ? value.assistant : value;
    if (!assistant || typeof assistant !== "object") return false;
    if (cleanText(assistant.text).trim()) return true;
    if (cleanText(assistant.reason).trim()) return true;
    return Array.isArray(assistant.steps) && assistant.steps.length > 0;
  }

  function regenerateRound(session, nid, options) {
    var node = nodeById(session, nid);
    if (!node) return null;
    // 没有用户提问（文字与图片都为空）的孤儿轮不能凭空生成。
    if (!userHasContent(node)) return null;
    var isLeaf = session.path.length > 0 && session.path[session.path.length - 1] === nid;
    if (isLeaf && !assistantHasContent(node)) {
      var reset = resetAssistant(session, nid, options);
      return reset ? { node: reset, mode: "reset" } : null;
    }
    var forked = forkRound(session, nid, options);
    return forked ? { node: forked, mode: "fork" } : null;
  }

  function lastNode(session) {
    var nodes = activeNodes(session);
    return nodes.length ? nodes[nodes.length - 1] : null;
  }

  function updateAssistant(session, nid, patch) {
    var node = nodeById(session, nid);
    if (!node) return null;
    var next = patch && typeof patch === "object" ? patch : {};
    Object.keys(next).forEach(function (key) {
      if (key === "steps" || key === "stats" || key === "error") {
        node.assistant[key] = clone(next[key]);
      } else {
        node.assistant[key] = next[key];
      }
    });
    session.updatedAt = nowIso();
    return node;
  }

  function updateUser(session, nid, patch) {
    var node = nodeById(session, nid);
    if (!node) return null;
    var next = patch && typeof patch === "object" ? patch : {};
    if (typeof next.text === "string") node.user.text = next.text;
    if (Array.isArray(next.attachments)) {
      node.user.attachments = ATT
        ? ATT.normalizeList(next.attachments)
        : clone(next.attachments);
    }
    session.updatedAt = nowIso();
    return node;
  }

  /* 原地编辑：不 fork、不改标题。用户侧可同时替换附件；助手侧只改正文，
     reason/steps/model/stats/error 与 Closure 一样保留。 */
  function editRoundContent(session, nid, side, text, attachments) {
    var node = nodeById(session, nid);
    if (!node || (side !== "user" && side !== "assistant")) return null;
    if (side === "user") {
      node.user.text = cleanText(text);
      if (attachments !== undefined) {
        node.user.attachments = ATT
          ? ATT.normalizeList(attachments)
          : clone(Array.isArray(attachments) ? attachments : []);
      }
    } else {
      node.assistant.text = cleanText(text);
    }
    session.updatedAt = nowIso();
    return node;
  }

  function userHasContent(node) {
    if (!node || !node.user) return false;
    if (cleanText(node.user.text).trim()) return true;
    return Array.isArray(node.user.attachments) && node.user.attachments.length > 0;
  }

  /* 助手“可见内容”含错误：错误-only 的孤儿行不能被静默删掉。 */
  function assistantVisible(node) {
    var assistant = node && node.assistant;
    if (!assistant || typeof assistant !== "object") return false;
    if (cleanText(assistant.text).trim()) return true;
    if (cleanText(assistant.reason).trim()) return true;
    if (Array.isArray(assistant.steps) && assistant.steps.length) return true;
    return !!assistant.error;
  }

  function validChildIds(session, node) {
    var out = [];
    var seen = {};
    (Array.isArray(node.children) ? node.children : []).forEach(function (id) {
      if (!id || id === node.nid || seen[id]) return;
      if (!nodeById(session, id)) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  /* 只沿实际存在的子节点延伸到叶；用于删除/重连后的路径修复。 */
  function completePath(session) {
    if (!Array.isArray(session.path) || !session.path.length) return;
    var current = nodeById(session, session.path[session.path.length - 1]);
    var guard = 0;
    while (current && guard < session.nodes.length + 1) {
      guard += 1;
      var children = validChildIds(session, current);
      var nextId = null;
      for (var i = 0; i < children.length; i += 1) {
        if (session.path.indexOf(children[i]) === -1) {
          nextId = children[i];
          break;
        }
      }
      if (!nextId) break;
      session.path.push(nextId);
      current = nodeById(session, nextId);
    }
  }

  function sanitizeAfterDelete(session, killed) {
    session.nodes = session.nodes.filter(function (node) {
      return !killed[node.nid];
    });
    session.nodes.forEach(function (node) {
      if (!Array.isArray(node.children)) node.children = [];
      node.children = node.children.filter(function (id) {
        return !killed[id] && !!nodeById(session, id);
      });
      if (node.parent && killed[node.parent]) node.parent = null;
    });
    session.rootIds = (Array.isArray(session.rootIds) ? session.rootIds : []).filter(function (id) {
      return !killed[id] && !!nodeById(session, id);
    });
    // 父节点被删但自身存活的节点升为根，不能从 rootIds 消失。
    session.nodes.forEach(function (node) {
      if (!node.parent && session.rootIds.indexOf(node.nid) === -1) {
        session.rootIds.push(node.nid);
      }
    });
    session.path = (Array.isArray(session.path) ? session.path : []).filter(function (id) {
      return !killed[id] && !!nodeById(session, id);
    });
  }

  /* 删除一整轮（含后续子树）。返回 mode/removedCount/branches 供 UI 提示与测试断言。 */
  function deleteRound(session, nid) {
    if (!session || !Array.isArray(session.nodes)) return null;
    var node = nodeById(session, nid);
    if (!node) return null;
    var oldPath = Array.isArray(session.path) ? session.path.slice() : [];
    var wasOnPath = oldPath.indexOf(nid) !== -1;
    var parentId = node.parent && nodeById(session, node.parent) ? node.parent : null;
    var parent = parentId ? nodeById(session, parentId) : null;
    var childIds = validChildIds(session, node);
    var mode = childIds.length > 1 ? "anchor" : (childIds.length === 1 ? "relink" : "leaf");
    var refs = parent ? (Array.isArray(parent.children) ? parent.children : []) :
      (Array.isArray(session.rootIds) ? session.rootIds : []);
    var siblingIds = [];
    refs.forEach(function (id) {
      if (!id || id === nid) return;
      if (!nodeById(session, id)) return;
      if (siblingIds.indexOf(id) === -1) siblingIds.push(id);
    });

    // 仅在删掉活跃路径上的节点且没有孩子可接续时，才切到相邻兄弟。
    var siblingTo = null;
    if (mode !== "relink" && wasOnPath && siblingIds.length) {
      var at = refs.indexOf(nid);
      if (at === -1) at = 0;
      for (var i = at - 1; i >= 0; i -= 1) {
        if (refs[i] !== nid && nodeById(session, refs[i])) {
          siblingTo = refs[i];
          break;
        }
      }
      if (!siblingTo) {
        for (var j = at + 1; j < refs.length; j += 1) {
          if (refs[j] !== nid && nodeById(session, refs[j])) {
            siblingTo = refs[j];
            break;
          }
        }
      }
    }

    var oldRootIndex = parent ? -1 : (Array.isArray(session.rootIds)
      ? session.rootIds.indexOf(nid) : -1);
    var childId = mode === "relink" ? childIds[0] : null;
    var killed = {};
    if (mode === "anchor") {
      var queue = [nid];
      while (queue.length) {
        var currentId = queue.shift();
        if (!currentId || killed[currentId]) continue;
        var current = nodeById(session, currentId);
        if (!current) continue;
        killed[currentId] = true;
        (Array.isArray(current.children) ? current.children : []).forEach(function (id) {
          if (id && !killed[id] && nodeById(session, id)) queue.push(id);
        });
      }
    } else {
      killed[nid] = true;
    }

    sanitizeAfterDelete(session, killed);

    if (mode === "relink" && childId) {
      var child = nodeById(session, childId);
      if (child) {
        if (parent) {
          child.parent = parentId;
          session.rootIds = session.rootIds.filter(function (id) { return id !== childId; });
          if (parent.children.indexOf(childId) === -1) parent.children.push(childId);
        } else {
          child.parent = null;
          session.rootIds = session.rootIds.filter(function (id) { return id !== childId; });
          var insertAt = oldRootIndex < 0
            ? session.rootIds.length
            : Math.min(oldRootIndex, session.rootIds.length);
          session.rootIds.splice(insertAt, 0, childId);
        }
        if (wasOnPath && session.path.indexOf(childId) === -1) {
          session.path.push(childId);
        }
      }
    } else if (wasOnPath && siblingTo && !switchBranch(session, siblingTo)) {
      session.path = parent ? (pathTo(session, parentId) || []) : [];
    }

    if (session.path.length) {
      var tail = session.path[session.path.length - 1];
      var checked = pathTo(session, tail);
      session.path = checked || (parent ? (pathTo(session, parentId) || []) : []);
      completePath(session);
    }
    session.updatedAt = nowIso();
    return {
      ok: true,
      mode: mode,
      removedCount: Object.keys(killed).length,
      branches: childIds.length,
      pathMoved: oldPath.join("\u0000") !== session.path.join("\u0000")
    };
  }

  /* 删除单侧；两侧都空才删轮。空侧本身就是“已删除”，不引入节点级 deleted 标记。 */
  function deleteMessageSide(session, nid, side) {
    var node = nodeById(session, nid);
    if (!node || (side !== "user" && side !== "assistant")) return null;
    if (side === "user") {
      node.user.text = "";
      node.user.attachments = [];
    } else {
      node.assistant = normalizeAssistant({});
    }
    session.updatedAt = nowIso();
    if (!userHasContent(node) && !assistantVisible(node)) {
      var out = deleteRound(session, nid);
      if (!out) return { ok: false, side: side, roundDeleted: false };
      return { ok: true, side: side, roundDeleted: true, deleteMode: out.mode };
    }
    return { ok: true, side: side, roundDeleted: false };
  }

  function normalizeSession(raw, projectId) {
    raw = raw && typeof raw === "object" ? raw : {};
    var session = {
      sid: typeof raw.sid === "string" && raw.sid ? raw.sid : makeId("s"),
      title: typeof raw.title === "string" && raw.title ? raw.title : "新对话",
      projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : cleanText(projectId),
      createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : nowIso(),
      updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : nowIso(),
      nodes: Array.isArray(raw.nodes) ? raw.nodes.map(normalizeRound) : [],
      path: Array.isArray(raw.path) ? raw.path.filter(function (id) { return typeof id === "string"; }) : [],
      rootIds: Array.isArray(raw.rootIds) ? raw.rootIds.filter(function (id) { return typeof id === "string"; }) : [],
      contextSize: Number(raw.contextSize) > 0 ? Math.floor(Number(raw.contextSize)) : 20,
      model: cleanText(raw.model),
      thinkingLevel: cleanText(raw.thinkingLevel) || "high",
      agentMode: raw.agentMode === "chat" ? "chat" : "work",
      permissionMode: ["read", "manual", "auto"].indexOf(raw.permissionMode) !== -1 ? raw.permissionMode : "manual",
      personaId: cleanText(raw.personaId),
      personaName: cleanText(raw.personaName) || "通用助手",
      personaPrompt: cleanText(raw.personaPrompt) ||
        (PROMPT ? PROMPT.BASE_PERSONA : "You are a helpful assistant."),
      searchEnabled: raw.searchEnabled !== false,
      titled: !!raw.titled
    };

    var seen = {};
    session.nodes = session.nodes.filter(function (node) {
      if (seen[node.nid]) return false;
      seen[node.nid] = true;
      return true;
    });
    session.nodes.forEach(function (node) {
      node.children = node.children.filter(function (id) {
        return id !== node.nid && !!nodeById(session, id);
      });
      if (node.parent && !nodeById(session, node.parent)) node.parent = null;
    });
    session.rootIds = session.rootIds.filter(function (id) { return !!nodeById(session, id); });
    // 任何没有父节点的节点都必须是根；损坏的 rootIds 不能把分支藏起来。
    session.nodes.forEach(function (node) {
      if (!node.parent && session.rootIds.indexOf(node.nid) === -1) {
        session.rootIds.push(node.nid);
      }
    });
    function followLastChild(startId) {
      var current = startId;
      var guard = 0;
      while (current && guard < session.nodes.length + 1) {
        guard += 1;
        if (session.path.indexOf(current) === -1) session.path.push(current);
        var node = nodeById(session, current);
        current = node && node.children.length ? node.children[node.children.length - 1] : null;
      }
    }
    if (!session.path.length) {
      followLastChild(session.rootIds.length ? session.rootIds[session.rootIds.length - 1] : null);
    } else {
      session.path = session.path.filter(function (id) { return !!nodeById(session, id); });
      if (!session.path.length && session.rootIds.length) {
        followLastChild(session.rootIds[session.rootIds.length - 1]);
      } else if (session.path.length) {
        // 损坏的 path 可能只到中间节点；沿最后一个孩子补到叶子。
        followLastChild(session.path[session.path.length - 1]);
      }
    }
    return session;
  }

  function pathText(session) {
    return activeNodes(session).map(function (node) {
      return "用户：" + node.user.text + "\n助手：" + node.assistant.text;
    }).join("\n\n");
  }

  function lastAssistant(session) {
    var node = lastNode(session);
    return node ? node.assistant : null;
  }

  var api = {
    nowIso: nowIso,
    makeId: makeId,
    newNode: newNode,
    newSession: newSession,
    normalizeSession: normalizeSession,
    nodeById: nodeById,
    activeNodes: activeNodes,
    appendRound: appendRound,
    lastNode: lastNode,
    lastAssistant: lastAssistant,
    updateAssistant: updateAssistant,
    updateUser: updateUser,
    editRoundContent: editRoundContent,
    deleteMessageSide: deleteMessageSide,
    deleteRound: deleteRound,
    userHasContent: userHasContent,
    assistantVisible: assistantVisible,
    pathTo: pathTo,
    siblingsOf: siblingsOf,
    branchIndex: branchIndex,
    forkRound: forkRound,
    switchBranch: switchBranch,
    resetAssistant: resetAssistant,
    assistantHasContent: assistantHasContent,
    regenerateRound: regenerateRound,
    pathText: pathText
  };

  global.JujinAgentTree = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
