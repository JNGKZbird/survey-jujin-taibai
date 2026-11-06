/* 测量学局劲工具 · Agent 图片附件落盘
   把压缩后的发送图写到 app_data_dir/attachments，并在启动时保留一份磁盘索引。
   不碰 DOM、不写 agent.json、不读项目库；浏览器模式整层退化为 skipped。 */
(function (global) {
  "use strict";

  var ATT = global.JujinAgentAttachments || null;
  var DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

  var ERROR_TEXT = {
    unavailable: "浏览器模式不落盘。",
    attachment_not_found: "图片不在本机。",
    attachment_invalid_id: "图片编号不合法。",
    attachment_reserved_id: "图片编号占用了系统保留名。",
    attachment_invalid_data_url: "图片数据不合法。",
    attachment_mime_mismatch: "图片格式与内容不一致。",
    attachment_unsupported_mime: "只支持 JPEG、PNG、WebP 图片。",
    attachment_too_large: "单张图片超过 2 MB。",
    attachment_quota: "图片缓存已满，请先清理。",
    attachment_io: "图片文件读写失败。",
    attachment_dir: "图片缓存目录不可用。",
    attachment_symlink: "拒绝通过符号链接访问图片。",
    attachment_not_file: "图片缓存路径不是普通文件。"
  };

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function errorText(err) {
    if (err == null) return "图片缓存操作失败。";
    var text = typeof err === "string"
      ? err
      : (err && err.message ? String(err.message) : String(err));
    var code = errorCode(err);
    if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return "图片缓存操作失败。";
    return ATT && ATT.truncateUtf8 ? ATT.truncateUtf8(text, 160) : text.slice(0, 160);
  }

  function errorCode(err) {
    var text = typeof err === "string"
      ? err
      : (err && err.message ? String(err.message) : String(err || ""));
    var match = text.match(/\battachment_[a-z0-9_]+\b/i);
    return match ? match[0].toLowerCase() : "";
  }

  function storageIdOk(id) {
    if (ATT && ATT.isStorageId) return ATT.isStorageId(id);
    return typeof id === "string" && /^[a-z0-9_-]{1,64}$/.test(id);
  }

  function imageDataUrlOk(value) {
    if (ATT && ATT.isImageDataUrl) return ATT.isImageDataUrl(value);
    return typeof value === "string" &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function platformBridge() {
    var P = global.JujinPlatform;
    if (!P) return null;
    return {
      available: function () {
        return typeof P.isDesktop === "function" && P.isDesktop() &&
          typeof P.nativeReady === "function" && P.nativeReady();
      },
      call: function (command, args) {
        if (typeof P.call !== "function") return Promise.reject(new Error("unavailable"));
        return P.call(command, args || {});
      }
    };
  }

  function createStore(bridge) {
    var b = bridge || global.JujinAgentAttachmentBridge || platformBridge();
    var state = {
      ready: false,
      reason: "",
      dir: "",
      ids: [],
      index: Object.create(null),
      missing: Object.create(null),
      bytes: 0,
      maxBytes: DEFAULT_MAX_BYTES,
      writeChain: Promise.resolve(),
      pendingWrites: 0,
      lastError: "",
      lastPrune: null
    };

    function isAvailable() {
      if (!b) return false;
      try {
        if (typeof b.available === "function") return !!b.available();
        if (typeof b.isAvailable === "function") return !!b.isAvailable();
        if (typeof b.available === "boolean") return b.available;
        return true;
      } catch (err) {
        return false;
      }
    }

    function rawCall(command, args) {
      if (!b || typeof b.call !== "function") {
        return Promise.reject(new Error("unavailable"));
      }
      try {
        return Promise.resolve(b.call(command, args || {}));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    function markMissing(id) {
      if (!id) return;
      state.missing[id] = true;
      if (state.index[id]) {
        delete state.index[id];
        var index = state.ids.indexOf(id);
        if (index !== -1) state.ids.splice(index, 1);
      }
    }

    function setIndex(result) {
      var ids = [];
      var seen = Object.create(null);
      var source = isRecord(result) && Array.isArray(result.ids) ? result.ids : [];
      source.forEach(function (id) {
        if (!storageIdOk(id) || seen[id]) return;
        seen[id] = true;
        ids.push(id);
      });
      state.ids = ids;
      state.index = seen;
      state.missing = Object.create(null);
      state.dir = isRecord(result) && typeof result.dir === "string" ? result.dir : "";
      state.bytes = Math.max(0, Number(isRecord(result) ? result.bytes : 0) || 0);
      state.maxBytes = Number(isRecord(result) ? result.maxBytes : 0) > 0
        ? Number(result.maxBytes)
        : DEFAULT_MAX_BYTES;
      state.ready = true;
      state.reason = "";
    }

    function refreshIndex() {
      if (!isAvailable()) {
        state.ready = false;
        state.reason = ERROR_TEXT.unavailable;
        return Promise.resolve({
          dir: state.dir,
          ids: [],
          count: 0,
          bytes: 0,
          maxBytes: state.maxBytes,
          available: false
        });
      }
      return rawCall("agent_attachment_index").then(function (result) {
        setIndex(result);
        return {
          dir: state.dir,
          ids: state.ids.slice(),
          count: state.ids.length,
          bytes: state.bytes,
          maxBytes: state.maxBytes,
          available: true
        };
      }, function (err) {
        state.ready = false;
        state.reason = errorText(err);
        state.lastError = state.reason;
        throw err;
      });
    }

    function boot(options) {
      var o = isRecord(options) ? options : {};
      if (!isAvailable()) {
        state.ready = false;
        state.reason = ERROR_TEXT.unavailable;
        return Promise.resolve({ ready: false, reason: state.reason });
      }
      var first = Promise.resolve();
      if (o.prune) {
        first = rawCall("agent_attachment_prune").then(function (result) {
          state.lastPrune = result;
        });
      }
      return first.then(refreshIndex).then(function () {
        state.ready = true;
        state.reason = "";
        return { ready: true, reason: "" };
      }, function (err) {
        state.ready = false;
        state.reason = errorText(err);
        return { ready: false, reason: state.reason };
      });
    }

    function has(id) {
      return !!(storageIdOk(id) && state.index[id] && !state.missing[id]);
    }

    function isKnownMissing(id) {
      return !!(id && state.missing[id]);
    }

    function put(id, dataUrl) {
      if (!isAvailable()) {
        return Promise.resolve({
          ok: false, skipped: true, error: ERROR_TEXT.unavailable
        });
      }
      if (!storageIdOk(id)) {
        return Promise.resolve({ ok: false, error: ERROR_TEXT.attachment_invalid_id });
      }
      if (!imageDataUrlOk(dataUrl)) {
        return Promise.resolve({ ok: false, error: ERROR_TEXT.attachment_invalid_data_url });
      }
      var job = function () {
        return rawCall("agent_attachment_put", { id: id, dataUrl: dataUrl })
          .then(function (result) {
            var bytes = Math.max(0, Number(result && result.bytes) || 0);
            if (!state.index[id]) {
              state.index[id] = true;
              state.ids.push(id);
              state.bytes += bytes;
            }
            delete state.missing[id];
            state.ready = true;
            return {
              ok: true,
              id: id,
              bytes: bytes,
              ext: isRecord(result) ? String(result.ext || "") : "",
              path: isRecord(result) ? String(result.path || "") : ""
            };
          }, function (err) {
            state.lastError = errorText(err);
            return {
              ok: false,
              code: errorCode(err),
              error: state.lastError
            };
          });
      };
      state.pendingWrites += 1;
      var current = state.writeChain.then(job, job);
      state.writeChain = current.then(function () {
        state.pendingWrites -= 1;
      }, function () {
        state.pendingWrites -= 1;
      });
      return current;
    }

    function putMany(attachments) {
      var list = Array.isArray(attachments) ? attachments : [];
      if (!isAvailable()) {
        return Promise.resolve({
          saved: 0, skipped: list.length, failed: []
        });
      }
      var seen = Object.create(null);
      var unique = [];
      list.forEach(function (attachment) {
        var id = attachment && attachment.id ? String(attachment.id) : "";
        if (!id || seen[id]) return;
        seen[id] = true;
        unique.push(attachment);
      });
      var saved = 0;
      var skipped = 0;
      var failed = [];
      // 同步排入全部 put：put 自身经 writeChain 串行，但 pendingWrites 必须在
      // 本函数返回前覆盖整批，否则 flush() 会在两张图之间看到 0 而提前放行。
      var jobs = unique.map(function (attachment) {
        var id = attachment && attachment.id ? String(attachment.id) : "";
        if (has(id)) {
          skipped += 1;
          return Promise.resolve();
        }
        var dataUrl = attachment && (attachment.dataUrl || attachment.url)
          ? String(attachment.dataUrl || attachment.url) : "";
        if (!dataUrl) {
          failed.push({ id: id, error: "图片数据不合法。" });
          return Promise.resolve();
        }
        return put(id, dataUrl).then(function (result) {
          if (result.ok) saved += 1;
          else if (result.skipped) skipped += 1;
          else failed.push({ id: id, error: result.error || "图片保存失败。" });
        });
      });
      return Promise.all(jobs).then(function () {
        return { saved: saved, skipped: skipped, failed: failed };
      });
    }

    function get(id) {
      if (!isAvailable() || !storageIdOk(id)) return Promise.resolve(null);
      return rawCall("agent_attachment_read", { id: id }).then(function (result) {
        if (!isRecord(result) || result.found === false || !imageDataUrlOk(result.dataUrl)) {
          markMissing(id);
          return null;
        }
        delete state.missing[id];
        return result.dataUrl;
      }, function (err) {
        var code = errorCode(err);
        if (code !== "attachment_not_found") state.lastError = errorText(err);
        markMissing(id);
        return null;
      });
    }

    function loadMany(ids) {
      if (!isAvailable()) return Promise.resolve({ data: Object.create(null), missing: [] });
      var seen = Object.create(null);
      var list = [];
      (Array.isArray(ids) ? ids : []).forEach(function (id) {
        if (!storageIdOk(id) || seen[id]) return;
        seen[id] = true;
        list.push(id);
      });
      list = list.slice(0, 8);
      var out = { data: Object.create(null), missing: [] };
      var chain = Promise.resolve();
      list.forEach(function (id) {
        chain = chain.then(function () {
          return get(id).then(function (dataUrl) {
            if (dataUrl) out.data[id] = dataUrl;
            else out.missing.push(id);
          });
        });
      });
      return chain.then(function () {
        return out;
      });
    }

    function prune() {
      if (!isAvailable()) {
        return Promise.resolve({
          skipped: true,
          reason: ERROR_TEXT.unavailable,
          removed: 0,
          removedBytes: 0,
          kept: 0
        });
      }
      return rawCall("agent_attachment_prune").then(function (result) {
        state.lastPrune = result;
        return refreshIndex().then(function () {
          return result;
        }, function (err) {
          return Object.assign({}, result, { refreshError: errorText(err) });
        });
      }, function (err) {
        state.lastError = errorText(err);
        return {
          skipped: true,
          code: errorCode(err),
          reason: state.lastError,
          removed: 0,
          removedBytes: 0,
          kept: 0
        };
      });
    }

    function clearAll() {
      if (!isAvailable()) {
        return Promise.resolve({
          skipped: true,
          reason: ERROR_TEXT.unavailable,
          removed: 0,
          removedBytes: 0,
          failed: []
        });
      }
      return rawCall("agent_attachment_clear").then(function (result) {
        return refreshIndex().then(function () {
          return result;
        }, function (err) {
          return Object.assign({}, result, { refreshError: errorText(err) });
        });
      }, function (err) {
        state.lastError = errorText(err);
        return {
          skipped: true,
          code: errorCode(err),
          reason: state.lastError,
          removed: 0,
          removedBytes: 0,
          failed: []
        };
      });
    }

    function flush() {
      function wait() {
        var current = state.writeChain;
        return current.then(function () {
          if (state.pendingWrites === 0) return;
          return wait();
        });
      }
      return wait();
    }

    function stats() {
      return {
        available: isAvailable(),
        ready: state.ready,
        dir: state.dir,
        count: state.ids.length,
        bytes: state.bytes,
        maxBytes: state.maxBytes
      };
    }

    return {
      boot: boot,
      refreshIndex: refreshIndex,
      has: has,
      available: isAvailable,
      ready: function () { return state.ready; },
      put: put,
      putMany: putMany,
      get: get,
      loadMany: loadMany,
      isKnownMissing: isKnownMissing,
      stats: stats,
      prune: prune,
      clearAll: clearAll,
      flush: flush,
      lastError: function () { return state.lastError; }
    };
  }

  var store = createStore(null);
  if (global.JujinPlatform && typeof global.JujinPlatform.registerFlusher === "function") {
    try {
      global.JujinPlatform.registerFlusher(function () {
        return store.flush();
      });
    } catch (err) {
      /* 关窗握手接不上不应阻塞聊天界面。 */
    }
  }

  var api = {
    createStore: createStore,
    defaultStore: store,
    DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES
  };
  global.JujinAgentAttachmentStore = store;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
