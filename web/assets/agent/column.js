/* 测量学局劲工具 · 聊天列宽
   列宽拖拽的算术集中在这里：不碰 DOM、不读存储，Node 测试与界面共用。
   列是居中的，宽度变化 ΔW 只会让被拖的那条边移动 ΔW/2；所以按下后按
   2×dx 计算，拖拽边才能 1:1 跟住指针，另一边镜像伸缩。 */
(function (global) {
  "use strict";

  var DEFAULT = 760;
  var MIN = 420;
  var MAX_STORED = 4000;

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    var lo = Number(min);
    var hi = Number(max);
    if (!isFinite(lo)) lo = DEFAULT;
    if (!isFinite(hi)) hi = lo;
    // 窗口比最小值还窄时先服从可用宽度，宁可低于 MIN 也不横向溢出
    if (hi < lo) return hi;
    return Math.max(lo, Math.min(n, hi));
  }

  function widthFromDrag(side, startWidth, dx, min, max) {
    var start = Number(startWidth);
    var delta = Number(dx);
    if (!isFinite(start)) start = DEFAULT;
    if (!isFinite(delta)) delta = 0;
    var next = side === "right" ? start + 2 * delta : start - 2 * delta;
    return Math.round(clamp(next, min, max));
  }

  function parseStored(raw, min, max) {
    if (raw === null || raw === undefined) return DEFAULT;
    var text = String(raw).trim();
    if (!text) return DEFAULT;
    var n = Number(text);
    if (!isFinite(n) || n <= 0) return DEFAULT;
    return Math.round(clamp(n, min, max));
  }

  var api = {
    DEFAULT: DEFAULT,
    MIN: MIN,
    MAX_STORED: MAX_STORED,
    clamp: clamp,
    widthFromDrag: widthFromDrag,
    parseStored: parseStored
  };

  global.JujinAgentColumn = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
