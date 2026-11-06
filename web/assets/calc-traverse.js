(function (root) {
  "use strict";

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

  // parts: { d, m, s } as strings. kind: "horizontal" | "za" | "va"
  function readDms(parts, kind) {
    parts = parts || {};
    kind = kind || "horizontal";
    var dRaw = parts.d == null ? "" : String(parts.d).trim();
    var mRaw = parts.m == null ? "" : String(parts.m).trim();
    var sRaw = parts.s == null ? "" : String(parts.s).trim();
    var allEmpty = dRaw === "" && mRaw === "" && sRaw === "";
    if (allEmpty) return { state: "empty", value: null, error: "" };
    if (dRaw === "" || mRaw === "" || sRaw === "") {
      return { state: "partial", value: null, error: "度、分、秒未填全" };
    }

    var allowNegative = kind === "va";
    var negative = false;
    var dText = dRaw;
    if (allowNegative && dText.charAt(0) === "-") {
      negative = true;
      dText = dText.slice(1);
    }
    if (!/^\d+$/.test(dText) || !/^\d+$/.test(mRaw) || !/^\d+$/.test(sRaw)) {
      return { state: "invalid", value: null, error: "请填数字" };
    }
    if (!allowNegative && dRaw.charAt(0) === "-") {
      return { state: "invalid", value: null, error: "该读数不能为负" };
    }

    var d = parseInt(dText, 10);
    var m = parseInt(mRaw, 10);
    var s = parseInt(sRaw, 10);
    if (m > 59 || s > 59) {
      return { state: "invalid", value: null, error: "分、秒须在 0–59" };
    }

    var value = d + m / 60 + s / 3600;
    if (negative) value = -value;

    if (kind === "horizontal" && (value < 0 || value > 360)) {
      return { state: "invalid", value: null, error: "水平读数须在 0°–360°" };
    }
    if (kind === "za" && (value < 0 || value > 360)) {
      return { state: "invalid", value: null, error: "天顶距须在 0°–360°" };
    }
    if (kind === "va" && Math.abs(value) > 90) {
      return { state: "invalid", value: null, error: "竖直角须在 -90°–+90°" };
    }

    return { state: "ok", value: kind === "horizontal" ? normalize360(value) : value, error: "", negative: negative };
  }

  // Non-negative decimal number input. opts: { min, exclusiveMin }
  function readNumber(value, opts) {
    opts = opts || {};
    var raw = value == null ? "" : String(value).trim();
    if (raw === "") return { state: "empty", value: null, error: "" };
    raw = raw.replace(/,/g, ".");
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      return { state: "invalid", value: null, error: "请填非负数字" };
    }
    var n = parseFloat(raw);
    if (!Number.isFinite(n)) return { state: "invalid", value: null, error: "数值无效" };
    var min = opts.min == null ? 0 : opts.min;
    if (opts.exclusiveMin ? n <= min : n < min) {
      return { state: "invalid", value: null, error: opts.error || "数值须大于 " + min };
    }
    return { state: "ok", value: n, error: "" };
  }

  function formatSecondsPart(seconds, decimals) {
    var text = seconds.toFixed(decimals);
    if (decimals > 0) {
      text = text.replace(/0+$/, "").replace(/\.$/, "");
    }
    var bits = text.split(".");
    var whole = String(parseInt(bits[0], 10) || 0).padStart(2, "0");
    return bits.length > 1 ? whole + "." + bits[1] : whole;
  }

  // opts: { normalize=true, showPlus=false, decimals=1 }
  function formatDms(deg, opts) {
    opts = opts || {};
    if (deg == null || !Number.isFinite(deg)) return "—";
    var decimals = opts.decimals == null ? 1 : opts.decimals;
    var value = deg;
    if (opts.normalize !== false) value = normalize360(value);

    var sign = "";
    if (value < 0) {
      sign = "-";
      value = -value;
    } else if (opts.showPlus && value > 0) {
      sign = "+";
    }

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
    if (opts.normalize !== false) d = d % 360;

    return sign + d + "°" + pad2(m) + "′" + formatSecondsPart(s, decimals) + "″";
  }

  // opts: { showPlus=false, decimals=1 }
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

  function hasAnyReading(target) {
    var reading = target && target.readings ? target.readings : {};
    var faces = ["L", "R"];
    for (var i = 0; i < faces.length; i++) {
      var row = reading[faces[i]] || {};
      var h = row.h || {};
      var v = row.v || {};
      if (h.d || h.m || h.s) return true;
      if (v.d || v.m || v.s) return true;
      if (row.s != null && String(row.s).trim() !== "") return true;
    }
    return false;
  }

  function targetHasReadings(target) {
    return hasAnyReading(target);
  }

  function computeTarget(target, mode, station, options) {
    options = options || {};
    // 默认值按课程《指标限差》：2C ≤12″、竖直角指标差 ≤25″。
    var c2Limit = options.c2Limit == null ? 12 : Number(options.c2Limit);
    var indexLimit = options.indexLimit == null ? 25 : Number(options.indexLimit);
    var sRelLimit = options.sRelLimit == null ? 1 / 10000 : Number(options.sRelLimit);
    if (!Number.isFinite(c2Limit)) c2Limit = 12;
    if (!Number.isFinite(indexLimit)) indexLimit = 25;
    if (!Number.isFinite(sRelLimit)) sRelLimit = 1 / 10000;
    var readings = (target && target.readings) || {};
    var rowL = readings.L || {};
    var rowR = readings.R || {};
    var vKind = mode === "ZA" ? "za" : "va";

    var h = {
      L: readDms(rowL.h, "horizontal"),
      R: readDms(rowR.h, "horizontal")
    };
    var v = {
      L: readDms(rowL.v, vKind),
      R: readDms(rowR.v, vKind)
    };
    // 天顶距按盘位分工：盘左 0°–180°，盘右 180°–360°。不校验会让
    // ZA_L=200°/ZA_R=160° 这种组合算出 α=−110°、负平距，还标成“正常”。
    if (mode === "ZA") {
      if (v.L.state === "ok" && v.L.value > 180) {
        v.L = {
          state: "invalid", value: null, negative: false,
          error: "盘左天顶距须在 0°–180°（盘左望远镜正镜）"
        };
      }
      if (v.R.state === "ok" && v.R.value < 180) {
        v.R = {
          state: "invalid", value: null, negative: false,
          error: "盘右天顶距须在 180°–360°（盘右望远镜倒镜）"
        };
      }
    }
    var s = {
      L: readNumber(rowL.s, { min: 0, exclusiveMin: true, error: "斜距须大于 0" }),
      R: readNumber(rowR.s, { min: 0, exclusiveMin: true, error: "斜距须大于 0" })
    };

    var targetStarted = [h.L, h.R, v.L, v.R, s.L, s.R].some(function (r) {
      return r.state !== "empty";
    });

    var c2 = { state: "empty", value: null };
    if (h.L.state === "ok" && h.R.state === "ok") {
      c2 = { state: "ok", value: normalize180(h.L.value - h.R.value + 180) * 3600 };
    } else if (h.L.state !== "empty" || h.R.state !== "empty") {
      c2 = { state: "waiting", value: null };
    }

    var alphaL = null;
    var alphaR = null;
    if (v.L.state === "ok") alphaL = mode === "ZA" ? 90 - v.L.value : v.L.value;
    if (v.R.state === "ok") alphaR = mode === "ZA" ? v.R.value - 270 : v.R.value;

    var alphaMean = { state: "empty", value: null, provisional: false };
    var indexError = { state: "empty", value: null };
    if (alphaL != null && alphaR != null) {
      alphaMean = { state: "ok", value: (alphaL + alphaR) / 2, provisional: false };
      indexError = { state: "ok", value: (alphaR - alphaL) * 1800 };
    } else if (alphaL != null || alphaR != null) {
      alphaMean = { state: "partial", value: alphaL != null ? alphaL : alphaR, provisional: true };
      indexError = { state: "waiting", value: null };
    } else if (v.L.state !== "empty" || v.R.state !== "empty" || targetStarted) {
      alphaMean = { state: "waiting", value: null, provisional: false };
      indexError = { state: "waiting", value: null };
    }

    var sMean = { state: "empty", value: null, provisional: false };
    if (s.L.state === "ok" && s.R.state === "ok") {
      sMean = { state: "ok", value: (s.L.value + s.R.value) / 2, provisional: false };
    } else if (s.L.state === "ok" || s.R.state === "ok") {
      sMean = { state: "partial", value: s.L.state === "ok" ? s.L.value : s.R.value, provisional: true };
    } else if (s.L.state !== "empty" || s.R.state !== "empty" || targetStarted) {
      sMean = { state: "waiting", value: null, provisional: false };
    }

    var iHeight = readNumber(station && station.instrumentHeight, { min: 0 });
    var pHeight = readNumber(target && target.prismHeight, { min: 0 });

    var horizDist = { state: "empty", value: null, provisional: false };
    var heightDiff = { state: "empty", value: null, provisional: false, assumedI: false, assumedP: false };
    if (alphaMean.value != null && sMean.value != null) {
      var alphaRad = alphaMean.value * D2R;
      horizDist = {
        state: alphaMean.state === "ok" && sMean.state === "ok" ? "ok" : "partial",
        value: sMean.value * Math.cos(alphaRad),
        provisional: alphaMean.provisional || sMean.provisional
      };

      if (iHeight.state === "invalid" || pHeight.state === "invalid") {
        heightDiff = { state: "invalid", value: null, provisional: false, assumedI: false, assumedP: false };
      } else {
        var assumedI = iHeight.state === "empty";
        var assumedP = pHeight.state === "empty";
        var iVal = iHeight.state === "ok" ? iHeight.value : 0;
        var pVal = pHeight.state === "ok" ? pHeight.value : 0;
        var provisional = alphaMean.provisional || sMean.provisional || assumedI || assumedP;
        heightDiff = {
          state: provisional ? "partial" : "ok",
          value: sMean.value * Math.sin(alphaRad) + iVal - pVal,
          provisional: provisional,
          assumedI: assumedI,
          assumedP: assumedP
        };
      }
    } else if (alphaMean.state !== "empty" || sMean.state !== "empty") {
      horizDist = { state: "waiting", value: null, provisional: false };
      heightDiff = { state: "waiting", value: null, provisional: false, assumedI: false, assumedP: false };
    }

    var issues = [];
    if (targetStarted) {
      var missingLabels = {
        "h.L": "盘左水平读数",
        "h.R": "盘右水平读数",
        "v.L": "盘左竖盘读数",
        "v.R": "盘右竖盘读数",
        "s.L": "盘左斜距",
        "s.R": "盘右斜距"
      };
      [["h", h], ["v", v], ["s", s]].forEach(function (pair) {
        ["L", "R"].forEach(function (face) {
          var part = pair[1][face];
          var key = pair[0] + "." + face;
          if (part.state === "invalid") {
            issues.push({
              level: "invalid",
              targetId: target.id,
              code: key,
              face: face,
              field: pair[0],
              message: missingLabels[key] + "：" + part.error
            });
          } else if (part.state === "partial") {
            issues.push({
              level: "missing",
              targetId: target.id,
              code: key,
              face: face,
              field: pair[0],
              message: missingLabels[key] + "未填全"
            });
          } else if (part.state === "empty") {
            issues.push({
              level: "missing",
              targetId: target.id,
              code: key,
              face: face,
              field: pair[0],
              message: missingLabels[key] + "未填"
            });
          }
        });
      });

      if (pHeight.state === "invalid") {
        issues.push({ level: "invalid", targetId: target.id, code: "p", field: "p", message: "棱镜高：" + pHeight.error });
      } else if (pHeight.state === "empty") {
        issues.push({ level: "missing", targetId: target.id, code: "p", field: "p", message: "棱镜高未填（高差暂按 0 计）" });
      }

      if (c2.state === "ok" && Math.abs(c2.value) > c2Limit + 1e-9) {
        issues.push({
          level: "warning",
          targetId: target.id,
          code: "c2",
          field: "h",
          message: "2C = " + formatSeconds(c2.value, { showPlus: true }) + "，超参考限差 " + formatSeconds(c2Limit)
        });
      }
      if (indexError.state === "ok" && Math.abs(indexError.value) > indexLimit + 1e-9) {
        issues.push({
          level: "warning",
          targetId: target.id,
          code: "x",
          field: "v",
          message: "指标差 = " + formatSeconds(indexError.value, { showPlus: true }) + "，超参考限差 " + formatSeconds(indexLimit)
        });
      }
      if (s.L.state === "ok" && s.R.state === "ok" && sMean.value) {
        var sDiff = Math.abs(s.L.value - s.R.value);
        if (sDiff / sMean.value > sRelLimit + 1e-12) {
          issues.push({
            level: "warning",
            targetId: target.id,
            code: "sdiff",
            field: "s",
            message: "两盘斜距较差 " + (sDiff * 1000).toFixed(1) + " mm，超过 " +
              (sRelLimit < 1 ? "1/" + Math.round(1 / sRelLimit) : String(sRelLimit)) + "（参考）"
          });
        }
      }
    }

    return {
      id: target.id,
      name: target.name || "",
      targetStarted: targetStarted,
      h: h,
      v: v,
      s: s,
      c2: c2,
      indexError: indexError,
      alphaL: alphaL,
      alphaR: alphaR,
      alphaMean: alphaMean,
      sMean: sMean,
      horizDist: horizDist,
      heightDiff: heightDiff,
      instrumentHeight: iHeight,
      prismHeight: pHeight,
      issues: issues
    };
  }

  function halfAngle(a, b, face) {
    var h1 = a && a.h ? a.h[face] : null;
    var h2 = b && b.h ? b.h[face] : null;
    if (h1 && h2 && h1.state === "ok" && h2.state === "ok") {
      return { state: "ok", value: normalize360(h2.value - h1.value) };
    }
    if ((h1 && h1.state !== "empty") || (h2 && h2.state !== "empty")) {
      return { state: "waiting", value: null };
    }
    return { state: "empty", value: null };
  }

  function computeStation(station, mode, options) {
    options = options || {};
    var halfLimit = options.halfDiffLimit == null ? 20 : Number(options.halfDiffLimit);
    if (!Number.isFinite(halfLimit)) halfLimit = 20;
    var targets = (station && station.targets ? station.targets : []).slice(0, 2);
    var targetResults = targets.map(function (t) {
      return computeTarget(t, mode, station, options);
    });
    while (targetResults.length < 2) {
      targetResults.push(computeTarget({ id: "missing", readings: {} }, mode, station, options));
    }

    var stationStarted = targetResults.some(function (t) { return t.targetStarted; });
    var angleL = halfAngle(targetResults[0], targetResults[1], "L");
    var angleR = halfAngle(targetResults[0], targetResults[1], "R");
    if (stationStarted) {
      if (angleL.state === "empty") angleL = { state: "waiting", value: null };
      if (angleR.state === "empty") angleR = { state: "waiting", value: null };
    }
    var angleMean = { state: "empty", value: null, provisional: false };
    var halfDiff = null;
    if (angleL.state === "ok" && angleR.state === "ok") {
      var diff = normalize180(angleR.value - angleL.value);
      angleMean = { state: "ok", value: normalize360(angleL.value + diff / 2), provisional: false };
      halfDiff = Math.abs(diff) * 3600;
    } else if (angleL.state === "ok" || angleR.state === "ok") {
      angleMean = { state: "partial", value: angleL.state === "ok" ? angleL.value : angleR.value, provisional: true };
    } else if (angleL.state !== "empty" || angleR.state !== "empty") {
      angleMean = { state: "waiting", value: null, provisional: false };
    }

    var issues = [];
    targetResults.forEach(function (t) {
      issues = issues.concat(t.issues);
    });

    if (stationStarted && targetResults[0].instrumentHeight.state === "invalid") {
      issues.push({ level: "invalid", code: "i", field: "i", message: "仪器高：" + targetResults[0].instrumentHeight.error });
    } else if (stationStarted && targetResults[0].instrumentHeight.state === "empty") {
      issues.push({ level: "missing", code: "i", field: "i", message: "仪器高未填（高差暂按 0 计）" });
    }

    if (stationStarted && !String(station && station.name || "").trim()) {
      issues.push({ level: "info", code: "sname", field: "stationName", message: "测站名称未填" });
    }

    targetResults.forEach(function (t, ti) {
      if (!t.targetStarted) {
        if (stationStarted && t.id !== "missing") {
          issues.push({
            level: "info",
            targetId: t.id,
            code: "t" + t.id + "empty",
            message: "目标" + (ti === 0 ? "①" : "②") + "尚未录入读数"
          });
        }
      } else if (!String(t.name || "").trim()) {
        issues.push({ level: "info", targetId: t.id, code: "t" + t.id + "name", message: "目标名称未填" });
      }
    });

    if (halfDiff != null && halfDiff > halfLimit + 1e-9) {
      issues.push({
        level: "warning",
        code: "halfdiff",
        message: "半测回水平角较差 " + formatSeconds(halfDiff) +
          "，超参考限差 " + formatSeconds(halfLimit)
      });
    } else if (halfDiff != null) {
      issues.push({
        level: "info",
        code: "halfdiff-ok",
        message: "半测回水平角较差 " + formatSeconds(halfDiff)
      });
    }

    return {
      targets: targetResults,
      angleL: angleL,
      angleR: angleR,
      angleMean: angleMean,
      halfDiff: halfDiff,
      halfDiffLimit: halfLimit,
      stationStarted: stationStarted,
      issues: issues
    };
  }

  var Calc = {
    D2R: D2R,
    normalize360: normalize360,
    normalize180: normalize180,
    readDms: readDms,
    readNumber: readNumber,
    formatDms: formatDms,
    formatSeconds: formatSeconds,
    computeTarget: computeTarget,
    computeStation: computeStation
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Calc;
  if (root) root.TraverseCalc = Calc;
})(typeof window !== "undefined" ? window : globalThis);
