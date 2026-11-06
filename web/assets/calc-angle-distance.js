(function (root) {
  "use strict";

  // 角度距离观测记录手簿
  //
  // 每个测站 4 行：前两行盘左，后两行盘右。
  //   左半测回 = 左盘目标② - 左盘目标①（顺时针，负值 +360°）
  //   右半测回 = 右盘目标② - 右盘目标①（同上）
  //   半测回角值之差 = |左 - 右|（秒）
  //   一测回角值 = (左 + 右) / 2（跨 0° 时按短弧平均）
  // 目标按名称跨盘配对；名称为空或重复时退回行序，并给出提示。

  var D2R = Math.PI / 180;

  function normalize360(deg) {
    var v = deg % 360;
    if (v < 0) v += 360;
    return v;
  }

  function normalize180(deg) {
    var v = normalize360(deg);
    if (v > 180) v -= 360;
    return v;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function result(state, value, extra) {
    var out = { state: state, value: value == null ? null : value };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    return out;
  }

  // parts: { d, m, s }; 度盘读数 0°–360°
  function readDms(parts) {
    parts = parts || {};
    var dRaw = parts.d == null ? "" : String(parts.d).trim();
    var mRaw = parts.m == null ? "" : String(parts.m).trim();
    var sRaw = parts.s == null ? "" : String(parts.s).trim();
    if (dRaw === "" && mRaw === "" && sRaw === "") return result("empty", null);
    if (dRaw === "" || mRaw === "" || sRaw === "") {
      return result("partial", null, { error: "度、分、秒未填全" });
    }
    if (!/^\d+$/.test(dRaw) || !/^\d+$/.test(mRaw) || !/^\d+$/.test(sRaw)) {
      return result("invalid", null, { error: "请填数字" });
    }
    var d = parseInt(dRaw, 10);
    var m = parseInt(mRaw, 10);
    var s = parseInt(sRaw, 10);
    if (m > 59 || s > 59) return result("invalid", null, { error: "分、秒须在 0–59" });
    var value = d + m / 60 + s / 3600;
    if (value < 0 || value > 360) return result("invalid", null, { error: "读数须在 0°–360°" });
    return result("ok", normalize360(value));
  }

  function formatSecondsPart(seconds, decimals) {
    var text = seconds.toFixed(decimals);
    if (decimals > 0) text = text.replace(/0+$/, "").replace(/\.$/, "");
    var bits = text.split(".");
    var whole = String(parseInt(bits[0], 10) || 0).padStart(2, "0");
    return bits.length > 1 ? whole + "." + bits[1] : whole;
  }

  // opts: { decimals=1, showPlus=false }
  function formatDms(deg, opts) {
    opts = opts || {};
    if (deg == null || !Number.isFinite(deg)) return "—";
    var decimals = opts.decimals == null ? 1 : opts.decimals;
    var value = normalize360(deg);
    var factor = Math.pow(10, decimals);
    var totalSec = Math.round(value * 3600 * factor) / factor;
    var d = Math.floor(totalSec / 3600);
    var rem = totalSec - d * 3600;
    var m = Math.floor(rem / 60);
    var s = rem - m * 60;
    if (s >= 60 - 0.5 / factor) {
      s = 0;
      m += 1;
    }
    if (m >= 60) {
      m = 0;
      d += 1;
    }
    d = d % 360;
    return d + "°" + pad2(m) + "′" + formatSecondsPart(s, decimals) + "″";
  }

  function formatSeconds(sec, opts) {
    opts = opts || {};
    if (sec == null || !Number.isFinite(sec)) return "—";
    var decimals = opts.decimals == null ? 1 : opts.decimals;
    var factor = Math.pow(10, decimals);
    var rounded = Math.round(sec * factor) / factor;
    if (Object.is(rounded, -0)) rounded = 0;
    var sign = "";
    if (rounded < 0) {
      sign = "-";
      rounded = -rounded;
    } else if (opts.showPlus && rounded > 0) {
      sign = "+";
    }
    var text = rounded.toFixed(decimals);
    if (decimals > 0) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return sign + text + "″";
  }

  function nameOf(row) {
    return row && row.target != null ? String(row.target).trim() : "";
  }

  function halfAngle(rows, aIndex, bIndex) {
    var a = rows[aIndex] ? rows[aIndex].reading : null;
    var b = rows[bIndex] ? rows[bIndex].reading : null;
    if (a && b && a.state === "ok" && b.state === "ok") {
      return result("ok", normalize360(b.value - a.value));
    }
    if ((a && a.state === "invalid") || (b && b.state === "invalid")) {
      return result("invalid", null);
    }
    if ((a && a.state === "partial") || (b && b.state === "partial")) {
      return result("partial", null);
    }
    if ((a && a.state !== "empty") || (b && b.state !== "empty")) {
      return result("waiting", null);
    }
    return result("empty", null);
  }

  function findByName(rows, indices, name) {
    if (!name) return -1;
    var hits = indices.filter(function (idx) {
      return nameOf(rows[idx]) === name;
    });
    return hits.length === 1 ? hits[0] : -1;
  }

  function computeStation(input, options) {
    input = input || {};
    options = options || {};
    // 默认按课程《指标限差》：水平角上下半测回较差 ≤20″。
    var limit = options.limit == null ? 20 : Number(options.limit);
    if (!Number.isFinite(limit)) limit = 20;

    var rawRows = Array.isArray(input.rows) ? input.rows.slice(0, 4) : [];
    while (rawRows.length < 4) rawRows.push({ target: "", reading: { d: "", m: "", s: "" } });

    var rows = rawRows.map(function (row) {
      return {
        target: nameOf(row),
        reading: readDms(row && row.reading)
      };
    });

    var started = rows.some(function (row) {
      return row.reading.state !== "empty";
    });

    var right = [2, 3];
    var leftA = nameOf(rows[0]);
    var leftB = nameOf(rows[1]);
    var pairMode = "row";
    var aIndex = 0;
    var bIndex = 1;
    var raIndex = 2;
    var rbIndex = 3;

    if (leftA && leftB && leftA !== leftB) {
      var rA = findByName(rows, right, leftA);
      var rB = findByName(rows, right, leftB);
      if (rA >= 0 && rB >= 0 && rA !== rB) {
        pairMode = "target";
        raIndex = rA;
        rbIndex = rB;
      }
    }

    var halfLeft = halfAngle(rows, aIndex, bIndex);
    var halfRight = halfAngle(rows, raIndex, rbIndex);

    var diff = result("empty", null);
    var mean = result("empty", null);
    if (halfLeft.state === "ok" && halfRight.state === "ok") {
      var signed = normalize180(halfRight.value - halfLeft.value);
      diff = result("ok", Math.abs(signed) * 3600);
      mean = result("ok", normalize360(halfLeft.value + signed / 2));
    } else if (halfLeft.state === "invalid" || halfRight.state === "invalid") {
      diff = result("invalid", null);
      mean = result("invalid", null);
    } else if (halfLeft.state === "partial" || halfRight.state === "partial") {
      diff = result("partial", null);
      mean = result("partial", null);
    } else if (halfLeft.state === "empty" && halfRight.state === "empty") {
      diff = result("empty", null);
      mean = result("empty", null);
    } else {
      diff = result("waiting", null);
      mean = result("waiting", null);
    }

    var issues = [];
    if (started) {
      var labels = ["第 1 行（左盘目标①）", "第 2 行（左盘目标②）", "第 3 行（右盘目标①）", "第 4 行（右盘目标②）"];
      if (pairMode === "row") {
        labels = ["第 1 行", "第 2 行", "第 3 行", "第 4 行"];
      }
      rows.forEach(function (row, idx) {
        var r = row.reading;
        if (r.state === "invalid") {
          issues.push({ level: "invalid", row: idx + 1, message: labels[idx] + "读数：" + r.error });
        } else if (r.state === "partial") {
          issues.push({ level: "missing", row: idx + 1, message: labels[idx] + "读数未填全" });
        } else if (r.state === "empty") {
          issues.push({ level: "missing", row: idx + 1, message: labels[idx] + "读数未填" });
        }
      });

      if (pairMode === "row" && halfLeft.state === "ok" && halfRight.state === "ok") {
        issues.push({
          level: "info",
          message: "右盘按行序配对（①→②）；若右盘是②→①观测，请把目标名填上"
        });
      }

      if (diff.state === "ok" && diff.value > limit + 1e-9) {
        issues.push({
          level: "warning",
          message: "半测回角值之差 " + formatSeconds(diff.value) + "，超限差 " + formatSeconds(limit)
        });
      }
    }

    return {
      rows: rows,
      pairMode: pairMode,
      halfLeft: halfLeft,
      halfRight: halfRight,
      halfDiff: diff,
      angleMean: mean,
      limit: limit,
      started: started,
      issues: issues
    };
  }

  var AngleDistanceCalc = {
    D2R: D2R,
    normalize360: normalize360,
    normalize180: normalize180,
    readDms: readDms,
    formatDms: formatDms,
    formatSeconds: formatSeconds,
    computeStation: computeStation
  };

  if (typeof module !== "undefined" && module.exports) module.exports = AngleDistanceCalc;
  if (root) root.AngleDistanceCalc = AngleDistanceCalc;
})(typeof window !== "undefined" ? window : globalThis);
