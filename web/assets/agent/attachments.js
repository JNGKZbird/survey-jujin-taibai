/* 测量学局劲工具 · Agent 图片附件
   纯函数：魔数校验、附件白名单、能力判定、多模态消息与历史占位。
   不碰 DOM、不读文件、不发起请求；压缩与文件选择在 ui.js。 */
(function (global) {
  "use strict";

  var LIMITS = {
    maxImages: 4,
    maxFileBytes: 20 * 1024 * 1024,
    maxPixels: 40000000,
    maxSide: 12000,
    maxTotalSendBytes: 4 * 1024 * 1024,
    maxSendBytesPerImage: 1536 * 1024,
    maxThumbChars: 24 * 1024,
    maxTranscriptBytes: 8 * 1024,
    maxHistoryBlockBytes: 16 * 1024,
    maxNameChars: 80,
    maxIdChars: 64,
    sendLongEdge: 2048,
    sendFallbackLongEdge: 1600,
    sendMinLongEdge: 1280,
    thumbSide: 320,
    sendQuality: 0.85,
    sendQualityFallback: 0.8,
    sendQualityMin: 0.75,
    thumbQuality: 0.7
  };

  var IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
  var IMAGE_SUPPORT = ["auto", "on", "off"];
  var DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  var STORAGE_ID_RE = /^[a-z0-9_-]{1,64}$/;
  var WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function toBytes(input) {
    if (!input) return null;
    if (typeof input.byteLength === "number" && typeof input.slice === "function") {
      return new Uint8Array(input);
    }
    if (typeof Uint8Array !== "undefined" && input instanceof Uint8Array) return input;
    return null;
  }

  /* 只认文件头，不信 file.type / 扩展名。SVG、GIF、BMP、HEIC 一律返回空串。 */
  function sniffMime(input) {
    var bytes = toBytes(input);
    if (!bytes || bytes.length < 12) return "";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return "image/webp";
    }
    return "";
  }

  function readU16BE(bytes, at) {
    return (bytes[at] << 8) | bytes[at + 1];
  }

  function readU16LE(bytes, at) {
    return bytes[at] | (bytes[at + 1] << 8);
  }

  function readU24LE(bytes, at) {
    return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  }

  function readU32BE(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  }

  function readU32LE(bytes, at) {
    return (bytes[at] | (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  }

  function asciiAt(bytes, at, text) {
    for (var i = 0; i < text.length; i += 1) {
      if (bytes[at + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  }

  /* 解码前先读容器头，避免小文件声明超大尺寸时先分配巨幅位图。
     PNG IHDR / JPEG SOF / WebP VP8X·VP8·VP8L；读不出返回 null，由调用方决定是否回退解码。 */
  function sniffDimensions(input) {
    var bytes = toBytes(input);
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      if (bytes.length < 24 || !asciiAt(bytes, 12, "IHDR")) return null;
      var pw = readU32BE(bytes, 16);
      var ph = readU32BE(bytes, 20);
      return pw > 0 && ph > 0 ? { width: pw, height: ph } : null;
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      var i = 2;
      while (i + 3 < bytes.length) {
        if (bytes[i] !== 0xff) { i += 1; continue; }
        var marker = bytes[i + 1];
        if (marker === 0xff) { i += 1; continue; }
        if (marker === 0xd8 || marker === 0xd9 ||
            (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        var size = readU16BE(bytes, i + 2);
        if (size < 2) return null;
        var sof = (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (sof) {
          if (i + 8 >= bytes.length) return null;
          var jh = readU16BE(bytes, i + 5);
          var jw = readU16BE(bytes, i + 7);
          return jw > 0 && jh > 0 ? { width: jw, height: jh } : null;
        }
        i += 2 + size;
      }
      return null;
    }
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      if (asciiAt(bytes, 12, "VP8X") && bytes.length >= 30) {
        return {
          width: readU24LE(bytes, 24) + 1,
          height: readU24LE(bytes, 27) + 1
        };
      }
      if (asciiAt(bytes, 12, "VP8 ") && bytes.length >= 30 &&
          bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        // VP8 关键帧的宽高是小端 14 位（高 2 位是缩放刻度）。
        return {
          width: readU16LE(bytes, 26) & 0x3fff,
          height: readU16LE(bytes, 28) & 0x3fff
        };
      }
      if (asciiAt(bytes, 12, "VP8L") && bytes.length >= 25 && bytes[20] === 0x2f) {
        var bits = readU32LE(bytes, 21);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >>> 14) & 0x3fff) + 1
        };
      }
      return null;
    }
    return null;
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

  function clampInt(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function makeId(prefix) {
    return String(prefix || "img") + "_" + Date.now().toString(36) + "_" +
      Math.random().toString(36).slice(2, 8);
  }

  function cleanName(value) {
    var text = String(value == null ? "" : value)
      .replace(/^.*[\\/]/, "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "图片";
    var chars = Array.from(text);
    return chars.length > LIMITS.maxNameChars
      ? chars.slice(0, LIMITS.maxNameChars).join("")
      : text;
  }

  function cleanId(value) {
    var id = String(value == null ? "" : value).trim();
    if (!id || id.length > LIMITS.maxIdChars) return "";
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
  }

  /* 磁盘文件名只接受小写 id，且不能撞 Windows 保留名（con.jpg 等）。 */
  function isStorageId(value) {
    if (typeof value !== "string") return false;
    if (!STORAGE_ID_RE.test(value)) return false;
    return !WINDOWS_RESERVED_RE.test(value);
  }

  function dataUrlBytes(value) {
    var text = String(value == null ? "" : value);
    var comma = text.indexOf(",");
    if (comma < 0 || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(text.slice(0, comma + 1))) {
      return 0;
    }
    var payload = text.slice(comma + 1);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return 0;
    var padding = payload.endsWith("==") ? 2 : (payload.endsWith("=") ? 1 : 0);
    return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
  }

  function isImageDataUrl(value) {
    var text = String(value == null ? "" : value);
    return DATA_URL_RE.test(text) && dataUrlBytes(text) > 0;
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    if (bytes <= 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fail(code, message) {
    return { ok: false, code: code, error: message };
  }

  /* 在解码前用文件头/大小先挡一遍；宽高由浏览器解码后传入。 */
  function validateCandidate(candidate) {
    var c = isRecord(candidate) ? candidate : {};
    var mime = String(c.mime || "");
    if (IMAGE_MIMES.indexOf(mime) === -1) {
      return fail("type", "只支持 PNG、JPEG、WebP 图片；SVG、GIF、BMP、HEIC 不接受。");
    }
    var bytes = Number(c.bytes) || 0;
    if (bytes <= 0) return fail("empty", "图片是空文件。");
    if (bytes > LIMITS.maxFileBytes) return fail("size", "单张图片不能超过 20 MB。");
    var width = Number(c.width);
    var height = Number(c.height);
    if (!isFinite(width) || !isFinite(height) || width < 1 || height < 1) {
      return fail("dimensions", "无法读取图片尺寸。");
    }
    if (width > LIMITS.maxSide || height > LIMITS.maxSide) {
      return fail("dimensions", "图片长边不能超过 12000 像素。");
    }
    if (width * height > LIMITS.maxPixels) {
      return fail("dimensions", "图片像素不能超过 4000 万。");
    }
    var count = Number(c.count) || 0;
    if (count >= LIMITS.maxImages) {
      return fail("count", "一条消息最多 " + LIMITS.maxImages + " 张图片。");
    }
    return {
      ok: true,
      mime: mime,
      bytes: bytes,
      width: Math.floor(width),
      height: Math.floor(height)
    };
  }

  /* 落盘/入树的显式白名单：dataUrl、路径、未知字段一律丢弃。 */
  function normalizeAttachment(raw) {
    if (!isRecord(raw)) return null;
    var mime = IMAGE_MIMES.indexOf(String(raw.mime || "")) !== -1 ? String(raw.mime) : "";
    if (!mime) return null;
    var width = clampInt(raw.w, 0, LIMITS.maxSide, 0);
    var height = clampInt(raw.h, 0, LIMITS.maxSide, 0);
    if (width < 1 || height < 1 || width * height > LIMITS.maxPixels) return null;
    var bytes = clampInt(raw.bytes, 0, LIMITS.maxFileBytes, 0);
    var id = cleanId(raw.id) || makeId("img");
    var thumb = typeof raw.thumb === "string" && isImageDataUrl(raw.thumb) &&
      raw.thumb.length <= LIMITS.maxThumbChars ? raw.thumb : "";
    var transcript = typeof raw.transcript === "string"
      ? truncateUtf8(raw.transcript.trim(), LIMITS.maxTranscriptBytes)
      : "";
    return {
      id: id,
      kind: "image",
      mime: mime,
      name: cleanName(raw.name),
      w: width,
      h: height,
      bytes: bytes,
      thumb: thumb,
      transcript: transcript
    };
  }

  /* sourceIndexes[i] 是 list[i] 在原数组里的下标；调用方据此把内存原图重映射到最终 id。
     dropped 统计无效项与超出 4 张上限的项；>0 时调用方应阻止发送/重发。 */
  function normalizeListMapped(raw) {
    var list = [];
    var sourceIndexes = [];
    var dropped = 0;
    var seen = {};
    (Array.isArray(raw) ? raw : []).forEach(function (one, index) {
      if (list.length >= LIMITS.maxImages) {
        dropped += 1;
        return;
      }
      var attachment = normalizeAttachment(one);
      if (!attachment) {
        dropped += 1;
        return;
      }
      if (seen[attachment.id]) attachment.id = makeId("img");
      seen[attachment.id] = true;
      list.push(attachment);
      sourceIndexes.push(index);
    });
    return { list: list, sourceIndexes: sourceIndexes, dropped: dropped };
  }

  function normalizeList(raw) {
    return normalizeListMapped(raw).list;
  }

  function hostOf(baseUrl) {
    var raw = String(baseUrl == null ? "" : baseUrl).trim();
    if (!raw) return "";
    try {
      if (typeof URL === "function") {
        var url = new URL(raw);
        if (url.host) return url.host.toLowerCase();
      }
    } catch (err) { /* 继续走正则兜底 */ }
    var match = raw.match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]+)/i);
    if (match) return match[1].replace(/^[^@]*@/, "").toLowerCase();
    return raw.replace(/[/?#].*$/, "").toLowerCase();
  }

  /* 真正接收字节的是 origin；换路径/换模型不改变接收方，换 scheme/host/port 才要重新确认。 */
  function originOf(baseUrl) {
    var raw = String(baseUrl == null ? "" : baseUrl).trim();
    if (!raw) return "";
    try {
      if (typeof URL === "function") {
        var url = new URL(raw);
        if (url.host) return (url.protocol || "https:") + "//" + url.host.toLowerCase();
      }
    } catch (err) { /* 继续走正则兜底 */ }
    var match = raw.match(/^([a-z][a-z0-9+.-]*:)\/\/([^/?#]+)/i);
    if (match) {
      return match[1].toLowerCase() + "//" + match[2].replace(/^[^@]*@/, "").toLowerCase();
    }
    return "https://" + hostOf(raw);
  }

  /* 错误详情与工具参数里不该出现图片 base64、密钥或超长密钥串。 */
  function redactSensitive(value, maxBytes) {
    var text = String(value == null ? "" : value);
    text = text.replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
      "[图片数据已省略]");
    text = text.replace(/[A-Za-z0-9+/]{120,}={0,2}/g, "[长串已省略]");
    text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [已省略]");
    text = text.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[已省略]");
    var limit = Number(maxBytes) > 0 ? Number(maxBytes) : 2048;
    return truncateUtf8(text, limit);
  }

  function supportsDirectVision(providerId, baseUrl, model) {
    var name = String(model == null ? "" : model).trim().toLowerCase();
    if (!name) return false;
    var provider = String(providerId == null ? "" : providerId).toLowerCase();
    var host = hostOf(baseUrl);
    var deepseek = provider === "deepseek" || /(^|\.)deepseek\.com$/.test(host);
    if (!deepseek) return false;
    /* 官方口径：deepseek-flash 接受图片；deepseek-v4-pro 纯文本。
       旧视觉实验模型仍可解析，保留直连；其余模型不猜，交给用户显式开启。 */
    if (name === "deepseek-flash") return true;
    if (name === "deepseek-v4-flash-vision-exp") return true;
    return false;
  }

  /* 返回 direct（主模型直接看图）、transcribe（视觉备用模型先转写）或 none。 */
  function resolveVision(options) {
    var o = isRecord(options) ? options : {};
    var support = IMAGE_SUPPORT.indexOf(String(o.imageSupport || "")) !== -1
      ? String(o.imageSupport) : "auto";
    var host = hostOf(o.baseUrl);
    var model = String(o.model == null ? "" : o.model).trim();
    var visionModel = String(o.visionModel == null ? "" : o.visionModel).trim();
    if (support === "off") {
      return { mode: "none", reason: "off", support: support, host: host, visionModel: "" };
    }
    var direct = support === "on" || supportsDirectVision(o.providerId, o.baseUrl, model);
    if (direct) {
      return { mode: "direct", reason: support === "on" ? "forced" : "preset", support: support, host: host, visionModel: visionModel };
    }
    if (visionModel && visionModel !== model) {
      return { mode: "transcribe", reason: "fallback", support: support, host: host, visionModel: visionModel };
    }
    return {
      mode: "none",
      reason: visionModel && visionModel === model ? "same-model" : "no-vision",
      support: support,
      host: host,
      visionModel: visionModel
    };
  }

  function attachmentHasTranscript(attachment) {
    return !!(attachment && String(attachment.transcript || "").trim());
  }

  /* 只决定“怎么发”，不读内存、不读磁盘、不改设置。
     hasData/hasStored 由调用方注入；stored 表示原图不在内存、但本机磁盘索引里有，
     调用方必须先水合再按 direct/transcribe 重算，不能直接拿 stored 计划发送。 */
  function planImageTurn(attachments, options) {
    var list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return { mode: "none", imageTurn: false, payloads: [] };
    var o = isRecord(options) ? options : {};
    var vision = resolveVision(o);
    var hasData = typeof o.hasData === "function" ? o.hasData : function () { return ""; };
    var hasStored = typeof o.hasStored === "function" ? o.hasStored : function () { return false; };
    var storageReady = !!o.storageReady;
    var allTranscribed = list.every(attachmentHasTranscript);

    function storedPlan(unresolved, sendCount) {
      var needs = [];
      var seen = {};
      unresolved.forEach(function (attachment) {
        var id = attachment && attachment.id ? attachment.id : "";
        if (!id || seen[id]) return;
        seen[id] = true;
        needs.push(id);
      });
      return {
        mode: "stored",
        imageTurn: true,
        payloads: [],
        vision: vision,
        needs: needs,
        sendCount: Math.max(0, Number(sendCount) || 0)
      };
    }

    function allOnDisk(unresolved) {
      return storageReady && unresolved.every(function (attachment) {
        return hasStored(attachment && attachment.id);
      });
    }

    if (vision.mode === "none") {
      if (allTranscribed) {
        return { mode: "transcript", imageTurn: true, payloads: [], vision: vision };
      }
      return { mode: "blocked", imageTurn: true, reason: vision.reason, vision: vision };
    }

    if (vision.mode === "direct") {
      var payloads = [];
      var noOriginal = [];
      list.forEach(function (attachment) {
        var dataUrl = hasData(attachment && attachment.id);
        if (dataUrl) payloads.push(dataUrl);
        else noOriginal.push(attachment);
      });
      if (!noOriginal.length) {
        return { mode: "direct", imageTurn: true, payloads: payloads, vision: vision };
      }
      // 每张都有转写时走文字，优先于磁盘；不需要为了重新生成去读原图。
      if (allTranscribed) {
        return {
          mode: "transcript", imageTurn: true, payloads: [], vision: vision, fallback: true
        };
      }
      if (allOnDisk(noOriginal)) return storedPlan(noOriginal, list.length);
      return { mode: "missing", imageTurn: true, vision: vision };
    }

    // 视觉备用模型通道：只有没转写的图才需要上传。
    var pending = list.filter(function (attachment) {
      return !attachmentHasTranscript(attachment);
    });
    if (!pending.length) {
      return { mode: "transcript", imageTurn: true, payloads: [], vision: vision };
    }
    var pendingMissing = pending.filter(function (attachment) {
      return !hasData(attachment && attachment.id);
    });
    if (!pendingMissing.length) {
      return {
        mode: "transcribe", imageTurn: true, payloads: [], vision: vision, pending: pending
      };
    }
    if (allOnDisk(pendingMissing)) return storedPlan(pendingMissing, pending.length);
    return { mode: "missing", imageTurn: true, vision: vision };
  }

  /* 当前轮直接发送：只接受我们白名单里的 data URL，坏图不静默混入。 */
  function buildContentParts(text, images) {
    var parts = [];
    var count = 0;
    (Array.isArray(images) ? images : []).forEach(function (image) {
      var url = typeof image === "string" ? image : (image && image.dataUrl);
      if (!isImageDataUrl(url)) return;
      parts.push({ type: "image_url", image_url: { url: url, detail: "auto" } });
      count += 1;
    });
    if (!count) return null;
    var body = String(text == null ? "" : text).trim();
    if (body) parts.unshift({ type: "text", text: body });
    return parts;
  }

  function defaultImageText(count) {
    var n = Math.max(1, Number(count) || 1);
    return "请看这 " + n + " 张记录表照片。先判断是表一还是表二，逐张读出能看清的读数；" +
      "看不清或不确定的列出来问我，不要猜。";
  }

  /* 历史消息只能带文字：有转写用转写，没有就明说原图不可见。 */
  function attachmentHistoryBlock(attachments, options) {
    var list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return "";
    var o = isRecord(options) ? options : {};
    var lines = [o.liveMissing
      ? "【本条消息的其余图片（原图不在当前上下文中）】"
      : "【本条消息附带的图片（原图不在当前上下文中，不能假装重新看过）】"];
    var used = utf8Length(lines[0]);
    list.forEach(function (attachment, index) {
      if (!attachment) return;
      var head = "[图片" + (index + 1) + "] " + cleanName(attachment.name) +
        "（" + (Number(attachment.w) || 0) + "×" + (Number(attachment.h) || 0) + "）";
      var transcript = String(attachment.transcript || "").trim();
      var body = transcript
        ? "转写/摘要：\n" + transcript
        : "（没有转写；原图已不在上下文中，不能假装看过。需要时请让用户重新发送。）";
      var chunk = head + "\n" + body;
      var room = LIMITS.maxHistoryBlockBytes - used;
      if (room <= 0) return;
      if (utf8Length(chunk) > room) chunk = truncateUtf8(chunk, room) + "…";
      lines.push(chunk);
      used += utf8Length(chunk);
    });
    return lines.join("\n\n");
  }

  function userTextWithAttachments(text, attachments, options) {
    var body = String(text == null ? "" : text).trim();
    var block = attachmentHistoryBlock(attachments, options);
    if (!body) return block || "（用户发送了图片，但没有文字说明。）";
    return block ? body + "\n\n" + block : body;
  }

  function hasImageAttachments(node) {
    return !!(node && node.user && Array.isArray(node.user.attachments) &&
      node.user.attachments.length);
  }

  /* 从 paste 事件的 clipboardData 取位图文件：先读 items（截图工具与浏览器
   * “复制图片”走这里），再回退到 files（WebView 若把 CF_HDROP 映射成 File）。 */
  function clipboardImageFiles(clipboardData) {
    var out = [];
    if (!clipboardData) return out;
    var items = clipboardData.items;
    var i;
    if (items && typeof items.length === "number") {
      for (i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!item || item.kind !== "file") continue;
        var itemType = String(item.type || "").toLowerCase();
        var file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
        var type = String((file && file.type) || itemType || "").toLowerCase();
        // 类型为空时交给魔数判断：部分剪贴板位图不给 MIME。
        if (type && type.indexOf("image/") !== 0) continue;
        if (file) out.push(file);
      }
    }
    var files = clipboardData.files;
    if (!out.length && files && typeof files.length === "number") {
      for (i = 0; i < files.length; i += 1) {
        var one = files[i];
        if (!one) continue;
        var oneType = String(one.type || "").toLowerCase();
        if (!oneType || oneType.indexOf("image/") === 0) out.push(one);
      }
    }
    return out;
  }

  var api = {
    LIMITS: LIMITS,
    IMAGE_MIMES: IMAGE_MIMES,
    sniffMime: sniffMime,
    sniffDimensions: sniffDimensions,
    dataUrlBytes: dataUrlBytes,
    isImageDataUrl: isImageDataUrl,
    formatBytes: formatBytes,
    utf8Length: utf8Length,
    truncateUtf8: truncateUtf8,
    cleanName: cleanName,
    makeId: makeId,
    isStorageId: isStorageId,
    validateCandidate: validateCandidate,
    normalizeAttachment: normalizeAttachment,
    normalizeList: normalizeList,
    normalizeListMapped: normalizeListMapped,
    hostOf: hostOf,
    originOf: originOf,
    redactSensitive: redactSensitive,
    supportsDirectVision: supportsDirectVision,
    resolveVision: resolveVision,
    planImageTurn: planImageTurn,
    buildContentParts: buildContentParts,
    defaultImageText: defaultImageText,
    attachmentHistoryBlock: attachmentHistoryBlock,
    userTextWithAttachments: userTextWithAttachments,
    hasImageAttachments: hasImageAttachments,
    clipboardImageFiles: clipboardImageFiles
  };

  global.JujinAgentAttachments = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
