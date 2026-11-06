(function (root) {
  "use strict";

  // 误差四色：按「|误差| ÷ 允许误差」的倍数分档。
  //   白 ≤1×；绿 >1～2×；黄 >2～3×；红 >3×。
  // 边界 2、3 归入「之内」；比较留 1e-9 浮点余量，避免 24/12 这类
  // 恰好落在整数倍上的值被二进制误差推到下一档。
  // 本模块只管比值与档位，不碰 DOM；颜色由 style.css 的四色变量决定。

  var EPS = 1e-9;

  function toNumberOrNull(value) {
    if (value == null) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // 没有值、值不是数字、限差缺失或 ≤0 时返回 null（不可判定，不上色）。
  function ratio(value, limit) {
    var v = toNumberOrNull(value);
    var l = toNumberOrNull(limit);
    if (v == null || l == null || l <= 0) return null;
    return Math.abs(v) / l;
  }

  // 返回 0（不可判定）/ 1（白）/ 2（绿）/ 3（黄）/ 4（红）。
  function band(value) {
    var r = toNumberOrNull(value);
    if (r == null || r < 0) return 0;
    if (r <= 1 + EPS) return 1;
    if (r <= 2 + EPS) return 2;
    if (r <= 3 + EPS) return 3;
    return 4;
  }

  var Api = {
    EPS: EPS,
    ratio: ratio,
    band: band
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Api;
  if (root) root.JujinBands = Api;
})(typeof window !== "undefined" ? window : globalThis);
