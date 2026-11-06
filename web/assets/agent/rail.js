/* 测量学局劲工具 · 右侧导航轨
   可露希尔同款：一轮一根横条，光标邻近的条按距离伸长、变深；当前可见轮蓝色，
   点击驻场琥珀色。这里只放算术，不碰 DOM、不读存储。 */
(function (global) {
  "use strict";

  var CAP = 32;
  var ROW_H = 8;
  var BAR_MIN = 10;
  var BAR_GROW = 14;
  var ALPHA_BASE = 0.16;
  var ALPHA_GROW = 0.3;
  var JUMP_GAP = 8;

  function growAt(index, hoverIndex) {
    if (hoverIndex === null || hoverIndex === undefined || hoverIndex < 0) return 0;
    var dist = Math.abs(Number(index) - Number(hoverIndex));
    if (!isFinite(dist)) return 0;
    if (dist === 0) return 1;
    if (dist === 1) return 0.72;
    if (dist === 2) return 0.45;
    if (dist === 3) return 0.2;
    return 0;
  }

  function barWidth(grow) {
    var g = Number(grow);
    if (!isFinite(g)) g = 0;
    g = Math.max(0, Math.min(1, g));
    return BAR_MIN + g * BAR_GROW;
  }

  function barAlpha(grow) {
    var g = Number(grow);
    if (!isFinite(g)) g = 0;
    g = Math.max(0, Math.min(1, g));
    return ALPHA_BASE + g * ALPHA_GROW;
  }

  function tail(items, cap) {
    var list = Array.isArray(items) ? items : [];
    var limit = Number(cap);
    if (!isFinite(limit) || limit <= 0) limit = CAP;
    return list.length > limit ? list.slice(list.length - limit) : list.slice();
  }

  /** rows: [{nid, top, bottom}]，视口上下边为视口坐标；相交即算可见。 */
  function visibleNids(rows, viewTop, viewBottom) {
    var out = {};
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      if (!row || !row.nid) continue;
      if (row.bottom > viewTop && row.top < viewBottom) out[row.nid] = true;
    }
    return out;
  }

  /** 目标轮顶端贴到滚动容器顶端下方 JUMP_GAP 处的 scrollTop。 */
  function jumpTop(targetTop, hostTop, scrollTop) {
    var value = Number(targetTop) - Number(hostTop) + Number(scrollTop) - JUMP_GAP;
    if (!isFinite(value)) return 0;
    return Math.max(0, value);
  }

  var api = {
    CAP: CAP,
    ROW_H: ROW_H,
    BAR_MIN: BAR_MIN,
    BAR_GROW: BAR_GROW,
    ALPHA_BASE: ALPHA_BASE,
    ALPHA_GROW: ALPHA_GROW,
    JUMP_GAP: JUMP_GAP,
    growAt: growAt,
    barWidth: barWidth,
    barAlpha: barAlpha,
    tail: tail,
    visibleNids: visibleNids,
    jumpTop: jumpTop
  };

  global.JujinAgentRail = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
