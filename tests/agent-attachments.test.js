"use strict";

const assert = require("assert");
const A = require("../web/assets/agent/attachments.js");
assert.ok(A, "attachments.js should export its API");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (err) {
    console.error("FAIL  " + name);
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "), Buffer.from([0x00, 0x00, 0x00, 0x00])
]);
const GIF = Buffer.from("GIF89a................");
const SVG = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");

function pngHeader(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpegWithSof(width, height) {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
  ]);
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
  ]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webpVP8X(width, height) {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBPVP8X", 8, "ascii");
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

function webpVP8(width, height) {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBPVP8 ", 8, "ascii");
  buf.writeUInt32LE(10, 16);
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

function webpVP8L(width, height) {
  const buf = Buffer.alloc(25);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(17, 4);
  buf.write("WEBPVP8L", 8, "ascii");
  buf.writeUInt32LE(5, 16);
  buf[20] = 0x2f;
  buf.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  return buf;
}

function thumb(seed) {
  return "data:image/jpeg;base64," + Buffer.from(String(seed || "thumb")).toString("base64");
}

function image(extra) {
  return Object.assign({
    id: "img_1",
    kind: "image",
    mime: "image/jpeg",
    name: "记录表.jpg",
    w: 2048,
    h: 1536,
    bytes: 300000,
    thumb: thumb("t"),
    transcript: ""
  }, extra || {});
}

console.log("agent-attachments tests");

test("sniffs PNG, JPEG and WebP by magic bytes only", () => {
  assert.strictEqual(A.sniffMime(PNG), "image/png");
  assert.strictEqual(A.sniffMime(JPEG), "image/jpeg");
  assert.strictEqual(A.sniffMime(WEBP), "image/webp");
  assert.strictEqual(A.sniffMime(GIF), "");
  assert.strictEqual(A.sniffMime(SVG), "");
  assert.strictEqual(A.sniffMime(PNG.slice(0, 6)), "");
  assert.strictEqual(A.sniffMime(null), "");
});

test("sniffDimensions reads PNG, JPEG and all three WebP headers before decode", () => {
  assert.deepStrictEqual(A.sniffDimensions(pngHeader(4032, 3024)), { width: 4032, height: 3024 });
  assert.deepStrictEqual(A.sniffDimensions(jpegWithSof(2048, 1536)), { width: 2048, height: 1536 });
  assert.deepStrictEqual(A.sniffDimensions(webpVP8X(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepStrictEqual(A.sniffDimensions(webpVP8(1280, 720)), { width: 1280, height: 720 });
  assert.deepStrictEqual(A.sniffDimensions(webpVP8L(800, 600)), { width: 800, height: 600 });
});

test("sniffDimensions refuses truncated or malformed headers instead of guessing", () => {
  assert.strictEqual(A.sniffDimensions(null), null);
  assert.strictEqual(A.sniffDimensions(GIF), null);
  assert.strictEqual(A.sniffDimensions(SVG), null);
  assert.strictEqual(A.sniffDimensions(PNG), null);
  assert.strictEqual(A.sniffDimensions(JPEG), null);
  assert.strictEqual(A.sniffDimensions(pngHeader(0, 100)), null);
  const badVP8 = webpVP8(1280, 720);
  badVP8[23] = 0x00;
  assert.strictEqual(A.sniffDimensions(badVP8), null);
});

test("declared dimensions are rejected before a bitmap is allocated", () => {
  const huge = pngHeader(50000, 10);
  assert.deepStrictEqual(A.validateCandidate({
    mime: A.sniffMime(huge), bytes: huge.length,
    width: A.sniffDimensions(huge).width, height: A.sniffDimensions(huge).height, count: 0
  }).code, "dimensions");
});

test("validateCandidate blocks type, size, dimensions and count", () => {
  assert.deepStrictEqual(A.validateCandidate({
    mime: "image/png", bytes: 100, width: 100, height: 100, count: 0
  }), { ok: true, mime: "image/png", bytes: 100, width: 100, height: 100 });
  assert.strictEqual(A.validateCandidate({ mime: "image/gif", bytes: 100, width: 1, height: 1 }).code, "type");
  assert.strictEqual(A.validateCandidate({ mime: "image/png", bytes: 0, width: 1, height: 1 }).code, "empty");
  assert.strictEqual(A.validateCandidate({
    mime: "image/png", bytes: A.LIMITS.maxFileBytes + 1, width: 1, height: 1
  }).code, "size");
  assert.strictEqual(A.validateCandidate({
    mime: "image/png", bytes: 100, width: 12001, height: 100
  }).code, "dimensions");
  assert.strictEqual(A.validateCandidate({
    mime: "image/png", bytes: 100, width: 7000, height: 7000
  }).code, "dimensions");
  assert.strictEqual(A.validateCandidate({
    mime: "image/png", bytes: 100, width: 100, height: 100, count: 4
  }).code, "count");
});

test("normalizeAttachment keeps only the whitelist and drops dataUrl", () => {
  const normalized = A.normalizeAttachment(image({
    dataUrl: "data:image/jpeg;base64,AAAA",
    path: "C:/secret.jpg",
    extra: { nested: true }
  }));
  assert.deepStrictEqual(Object.keys(normalized).sort(), [
    "bytes", "h", "id", "kind", "mime", "name", "thumb", "transcript", "w"
  ]);
  assert.strictEqual(normalized.dataUrl, undefined);
  assert.strictEqual(normalized.path, undefined);
  assert.strictEqual(normalized.extra, undefined);
  assert.strictEqual(normalized.kind, "image");
});

test("normalizeAttachment rejects unknown mime, bad dimensions and bad thumbs", () => {
  assert.strictEqual(A.normalizeAttachment({ mime: "image/gif", w: 1, h: 1 }), null);
  assert.strictEqual(A.normalizeAttachment({ mime: "image/png", w: 0, h: 10 }), null);
  assert.strictEqual(A.normalizeAttachment({ mime: "image/png" }), null);
  /* 落盘后可能只剩缩略图与元数据；bytes 允许为 0，不因缺字节数组丢附件。 */
  assert.strictEqual(A.normalizeAttachment({ mime: "image/png", w: 1, h: 1 }).bytes, 0);
  const normalized = A.normalizeAttachment(image({
    thumb: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    w: 5000, h: 5000
  }));
  assert.strictEqual(normalized.thumb, "");
  assert.strictEqual(normalized.w, 5000);
  assert.strictEqual(A.normalizeAttachment(image({ w: 8000, h: 8000 })), null);
});

test("transcript is trimmed and capped without splitting a surrogate pair", () => {
  const normalized = A.normalizeAttachment(image({
    transcript: "  " + "😀".repeat(3000) + "  "
  }));
  assert.ok(A.utf8Length(normalized.transcript) <= A.LIMITS.maxTranscriptBytes);
  assert.strictEqual(normalized.transcript.indexOf("\uFFFD"), -1);
  assert.notStrictEqual(normalized.transcript.slice(-2), "\uD83D\uDE00".slice(0, 1));
});

test("normalizeList caps at four images and keeps ids unique", () => {
  const list = A.normalizeList([
    image({ id: "a" }), image({ id: "a" }), image({ id: "c" }), image({ id: "d" }), image({ id: "e" })
  ]);
  assert.strictEqual(list.length, 4);
  assert.strictEqual(new Set(list.map((one) => one.id)).size, 4);
});

test("resolveVision follows explicit support, presets and the fallback model", () => {
  assert.strictEqual(A.resolveVision({ imageSupport: "off" }).mode, "none");
  assert.strictEqual(A.resolveVision({
    imageSupport: "auto", providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash"
  }).mode, "direct");
  assert.strictEqual(A.resolveVision({
    imageSupport: "auto", providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-pro", visionModel: "deepseek-flash"
  }).mode, "transcribe");
  assert.strictEqual(A.resolveVision({
    imageSupport: "auto", providerId: "deepseek", baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-pro"
  }).mode, "none");
  assert.strictEqual(A.resolveVision({
    imageSupport: "auto", providerId: "custom", baseUrl: "https://example.com/v1",
    model: "my-model"
  }).mode, "none");
  assert.strictEqual(A.resolveVision({
    imageSupport: "on", providerId: "custom", baseUrl: "https://example.com/v1",
    model: "my-model"
  }).mode, "direct");
  assert.strictEqual(A.resolveVision({
    imageSupport: "auto", providerId: "custom", baseUrl: "https://example.com/v1",
    model: "my-model", visionModel: "my-model"
  }).reason, "same-model");
});

test("hostOf extracts the host used for the privacy disclosure", () => {
  assert.strictEqual(A.hostOf("https://api.deepseek.com/v1"), "api.deepseek.com");
  assert.strictEqual(A.hostOf("http://127.0.0.1:8080/v1"), "127.0.0.1:8080");
  assert.strictEqual(A.hostOf("api.deepseek.com/v1"), "api.deepseek.com");
  assert.strictEqual(A.hostOf(""), "");
});

test("buildContentParts emits OpenAI-compatible text and image parts", () => {
  const parts = A.buildContentParts("请看记录表", [
    { dataUrl: thumb("1") },
    { dataUrl: thumb("2") }
  ]);
  assert.strictEqual(parts.length, 3);
  assert.deepStrictEqual(parts[0], { type: "text", text: "请看记录表" });
  assert.deepStrictEqual(parts[1], {
    type: "image_url", image_url: { url: thumb("1"), detail: "auto" }
  });
  assert.strictEqual(parts[2].type, "image_url");
});

test("buildContentParts returns null without a valid image", () => {
  assert.strictEqual(A.buildContentParts("只看文字", []), null);
  assert.strictEqual(A.buildContentParts("坏图", [
    { dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }
  ]), null);
});

test("image-only content keeps the image part first", () => {
  const parts = A.buildContentParts("", [{ dataUrl: thumb("1") }]);
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].type, "image_url");
  assert.ok(A.defaultImageText(2).indexOf("2 张") !== -1);
});

test("history block uses transcripts and never invents a visible original", () => {
  const block = A.attachmentHistoryBlock([
    image({ id: "a", transcript: "表一，第 1 站：123°45′36″" }),
    image({ id: "b", name: "第二张.png", transcript: "" })
  ]);
  assert.ok(block.indexOf("原图不在当前上下文中") !== -1);
  assert.ok(block.indexOf("123°45′36″") !== -1);
  assert.ok(block.indexOf("没有转写") !== -1);
  assert.ok(block.indexOf("第二张.png") !== -1);
});

test("history block is capped and user text keeps the transcript", () => {
  const block = A.attachmentHistoryBlock([
    image({ transcript: "字".repeat(3000) }),
    image({ id: "b", transcript: "字".repeat(3000) }),
    image({ id: "c", transcript: "字".repeat(3000) }),
    image({ id: "d", transcript: "字".repeat(3000) })
  ]);
  assert.ok(A.utf8Length(block) <= A.LIMITS.maxHistoryBlockBytes + 64);
  const text = A.userTextWithAttachments("请看", [image({ transcript: "读数 1.170" })]);
  assert.ok(text.indexOf("请看") === 0);
  assert.ok(text.indexOf("读数 1.170") !== -1);
  assert.ok(A.userTextWithAttachments("", []) .indexOf("用户发送了图片") !== -1);
});

test("data URL size and validation reject malformed payloads", () => {
  assert.strictEqual(A.dataUrlBytes(thumb("abc")), 3);
  assert.strictEqual(A.dataUrlBytes("data:image/jpeg;base64,"), 0);
  assert.strictEqual(A.dataUrlBytes("data:text/plain;base64,YWJj"), 0);
  assert.strictEqual(A.dataUrlBytes("data:image/jpeg;base64,@@@"), 0);
  assert.strictEqual(A.isImageDataUrl(thumb("abc")), true);
  assert.strictEqual(A.isImageDataUrl("data:image/gif;base64,R0lGODlh"), false);
  assert.strictEqual(A.isImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), false);
  assert.strictEqual(A.isImageDataUrl("javascript:alert(1)"), false);
  assert.strictEqual(A.isImageDataUrl("blob:https://example.com/1"), false);
  assert.strictEqual(A.isImageDataUrl("https://example.com/a.jpg"), false);
  assert.strictEqual(A.formatBytes(0), "—");
  assert.strictEqual(A.formatBytes(2048), "2 KB");
});

test("originOf ignores path, query and case but changes with scheme, host and port", () => {
  assert.strictEqual(A.originOf("https://api.deepseek.com/v1"), "https://api.deepseek.com");
  assert.strictEqual(A.originOf("HTTPS://API.DeepSeek.com/v1?x=1"), "https://api.deepseek.com");
  assert.strictEqual(A.originOf("https://api.deepseek.com.evil.example/v1"), "https://api.deepseek.com.evil.example");
  assert.strictEqual(A.originOf("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080");
  assert.notStrictEqual(A.originOf("http://127.0.0.1:8080/v1"), A.originOf("http://127.0.0.1:9090/v1"));
  assert.notStrictEqual(A.originOf("https://api.deepseek.com/v1"), A.originOf("http://api.deepseek.com/v1"));
  assert.strictEqual(A.originOf("  "), "");
  assert.strictEqual(A.originOf("https://user:pass@api.deepseek.com/v1"), "https://api.deepseek.com");
});

test("clipboardImageFiles keeps bitmap file items and ignores text and other files", () => {
  const png = { name: "shot.png", type: "image/png", size: 10 };
  const pdf = { name: "a.pdf", type: "application/pdf", size: 20 };
  const files = A.clipboardImageFiles({
    items: [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => png },
      { kind: "file", type: "application/pdf", getAsFile: () => pdf }
    ],
    files: []
  });
  assert.deepStrictEqual(files, [png]);
});

test("clipboardImageFiles trusts the decoded file type and lets empty types reach magic-byte sniffing", () => {
  const png = { name: "shot.png", type: "image/png" };
  const untyped = { name: "paste", type: "" };
  const files = A.clipboardImageFiles({
    items: [
      { kind: "file", type: "", getAsFile: () => png },
      { kind: "file", type: "", getAsFile: () => untyped }
    ],
    files: []
  });
  assert.deepStrictEqual(files, [png, untyped]);
});

test("clipboardImageFiles falls back to clipboardData.files and does not duplicate", () => {
  const jpg = { name: "a.jpg", type: "image/jpeg" };
  const txt = { name: "a.txt", type: "text/plain" };
  assert.deepStrictEqual(
    A.clipboardImageFiles({ items: [], files: [jpg, txt] }),
    [jpg]
  );
  assert.deepStrictEqual(
    A.clipboardImageFiles({ items: [{ kind: "file", type: "image/jpeg", getAsFile: () => jpg }], files: [jpg] }),
    [jpg]
  );
});

test("clipboardImageFiles tolerates missing payloads and null getAsFile results", () => {
  assert.deepStrictEqual(A.clipboardImageFiles(null), []);
  assert.deepStrictEqual(A.clipboardImageFiles(undefined), []);
  assert.deepStrictEqual(A.clipboardImageFiles({}), []);
  assert.deepStrictEqual(A.clipboardImageFiles({ items: [{ kind: "file", type: "image/png", getAsFile: () => null }], files: [] }), []);
});


function attachmentFixture(id, extra) {
  return Object.assign({
    id: id,
    kind: "image",
    mime: "image/jpeg",
    name: id + ".jpg",
    w: 100,
    h: 80,
    bytes: 1000,
    thumb: "",
    transcript: ""
  }, extra || {});
}

test("normalizeListMapped keeps original indexes and counts dropped entries", () => {
  const raw = [
    attachmentFixture("img_a"),
    { bad: true },
    attachmentFixture("img_a"),
    attachmentFixture("img_b"),
    attachmentFixture("img_c"),
    attachmentFixture("img_d")
  ];
  const out = A.normalizeListMapped(raw);
  assert.strictEqual(out.list.length, 4);
  assert.deepStrictEqual(out.sourceIndexes, [0, 2, 3, 4]);
  assert.strictEqual(out.dropped, 2);
  assert.strictEqual(out.list[0].id, "img_a");
  assert.notStrictEqual(out.list[1].id, "img_a");
  assert.strictEqual(out.list[2].id, "img_b");
  assert.strictEqual(out.list[3].id, "img_c");
  assert.strictEqual(out.list[1].dataUrl, undefined);
  assert.deepStrictEqual(A.normalizeListMapped("bad"), {
    list: [], sourceIndexes: [], dropped: 0
  });
});

test("isStorageId accepts lowercase safe ids and rejects reserved or unsafe names", () => {
  assert.strictEqual(A.isStorageId("img_abc123"), true);
  assert.strictEqual(A.isStorageId("a1_-"), true);
  assert.strictEqual(A.isStorageId("a"), true);
  assert.strictEqual(A.isStorageId("a".repeat(64)), true);
  assert.strictEqual(A.isStorageId("a".repeat(65)), false);
  assert.strictEqual(A.isStorageId("Img_abc"), false);
  assert.strictEqual(A.isStorageId("img.abc"), false);
  assert.strictEqual(A.isStorageId("img/abc"), false);
  assert.strictEqual(A.isStorageId("img abc"), false);
  assert.strictEqual(A.isStorageId(" img_abc"), false);
  assert.strictEqual(A.isStorageId(""), false);
  assert.strictEqual(A.isStorageId(null), false);
  assert.strictEqual(A.isStorageId(7), false);
  assert.strictEqual(A.isStorageId("con"), false);
  assert.strictEqual(A.isStorageId("PRN"), false);
  assert.strictEqual(A.isStorageId("aux"), false);
  assert.strictEqual(A.isStorageId("nul"), false);
  assert.strictEqual(A.isStorageId("com1"), false);
  assert.strictEqual(A.isStorageId("lpt9"), false);
  assert.strictEqual(A.isStorageId("con1"), true);
});

console.log("agent-attachments.js: " + passed + " passed");
if (process.exitCode) process.exit(process.exitCode);
