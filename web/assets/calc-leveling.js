(function (root) {
  "use strict";

  // 三、四等水准测量记录、计算表（双面尺法）
  //
  // 每个测站 4 行，行 1/2 是后尺/前尺的上、下丝与黑红面读数：
  //   行 1：后尺下丝、前尺下丝、后尺黑面、后尺红面
  //   行 2：后尺上丝、前尺上丝、前尺黑面、前尺红面
  //   行 3：后视距、前视距、黑面高差、红面高差、K 检核、高差中数
  //   行 4：视距差 d、Σd
  // 尺读数按米录入（1.170），计算一律换成 mm 整数。

  var LIMITS = {
    III: { label: "三等", sight: 75, d: 3.0, sumD: 6.0, reading: 2.0, height: 3.0 },
    IV: { label: "四等", sight: 100, d: 5.0, sumD: 10.0, reading: 3.0, height: 5.0 }
  };

  function result(state, value, extra) {
    var out = { state: state, value: value == null ? null : value };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    return out;
  }

  // 尺读数按米写、内部按 mm 整数算。四位小数只出现在旧项目/旧单表里；
  // 统一按半值远离零取整到 mm，消掉 0.1025 这类二进制尾巴，否则失焦前后
  // 会差 1 mm（0.1025 → 102 mm，而计算用 103 mm）。
  function staffToMm(text) {
    var scaled = parseFloat(text) * 1000;
    var eps = Math.max(1e-9, Math.abs(scaled) * 1e-12);
    return scaled < 0 ? -Math.round(-scaled + eps) : Math.round(scaled + eps);
  }

  // Staff reading: meters with up to 3 decimals (1.170), converted to mm here.
  // 老项目里存的是 mm 整数（1170），照旧收，保证旧文件与旧表五能算。
  function readStaff(value) {
    var raw = value == null ? "" : String(value).trim();
    if (raw === "") return result("empty", null);
    raw = raw.replace(/\s+/g, "").replace(",", ".");
    if (/^\d\.\d{1,4}$/.test(raw)) {
      return result("ok", staffToMm(raw));
    }
    if (!/^\d{1,6}$/.test(raw)) {
      return result("invalid", null, { error: "请填米制读数（如 1.170）" });
    }
    return result("ok", parseInt(raw, 10));
  }

  // 把尺读数统一成三位小数的米制文本：输入、失焦、载入、打印、旧版导出
  // 都走这一处。旧项目里的 mm 整数（1170）换成米；四位小数按半值取整到 mm。
  function staffMeters(value) {
    var raw = value == null ? "" : String(value).trim().replace(/,/g, ".");
    if (raw === "") return raw;
    if (/^\d\.\d{0,4}$/.test(raw)) return (staffToMm(raw) / 1000).toFixed(3);
    if (/^\d{1,6}$/.test(raw)) return (parseInt(raw, 10) / 1000).toFixed(3);
    return raw;
  }

  function readDecimal(value) {
    var raw = value == null ? "" : String(value).trim();
    if (raw === "") return result("empty", null);
    raw = raw.replace(/,/g, ".");
    if (!/^\d+(\.\d+)?$/.test(raw)) return result("invalid", null, { error: "请填数字" });
    return result("ok", parseFloat(raw));
  }

  function gradeOf(grade) {
    return LIMITS[grade] ? grade : "IV";
  }

  function normalizeK(k) {
    var n = Number(k);
    return n === 4.687 || n === 4687 ? 4687 : 4787;
  }

  function computeStation(input, options) {
    input = input || {};
    options = options || {};
    var grade = gradeOf(options.grade || input.grade);
    var limits = LIMITS[grade];
    var kBack = normalizeK(input.kBack);
    var kFront = normalizeK(input.kFront);
    // undefined = 首站（从 0 起算）；null = 前面有站未算完，Σd 暂无依据
    var hasPrevSum = options.prevSumD !== null;
    var prevSumD = options.prevSumD == null ? 0 : Number(options.prevSumD);
    if (!Number.isFinite(prevSumD)) {
      hasPrevSum = false;
      prevSumD = 0;
    }

    var back = input.back || {};
    var front = input.front || {};
    var fields = {
      "back.lower": readStaff(back.lower),
      "back.upper": readStaff(back.upper),
      "back.black": readStaff(back.black),
      "back.red": readStaff(back.red),
      "front.lower": readStaff(front.lower),
      "front.upper": readStaff(front.upper),
      "front.black": readStaff(front.black),
      "front.red": readStaff(front.red)
    };

    var started = Object.keys(fields).some(function (key) {
      return fields[key].state !== "empty";
    });

    function sight(lowerKey, upperKey) {
      var lo = fields[lowerKey];
      var hi = fields[upperKey];
      if (lo.state === "ok" && hi.state === "ok") {
        if (lo.value <= hi.value) {
          return result("invalid", null, { error: "下丝应大于上丝" });
        }
        return result("ok", (lo.value - hi.value) * 0.1);
      }
      if (lo.state === "invalid" || hi.state === "invalid") return result("invalid", null);
      if (lo.state === "empty" && hi.state === "empty") return result("empty", null);
      return result("waiting", null);
    }

    var backDist = sight("back.lower", "back.upper");
    var frontDist = sight("front.lower", "front.upper");

    var d, sumD, blackDiff, redDiff, k1, k2, k3, mean;

    if (backDist.state === "ok" && frontDist.state === "ok") {
      d = result("ok", backDist.value - frontDist.value);
      sumD = hasPrevSum ? result("ok", prevSumD + d.value) : result("waiting", null);
    } else if (backDist.state === "invalid" || frontDist.state === "invalid") {
      d = result("invalid", null);
      sumD = result("invalid", null);
    } else if (backDist.state === "empty" && frontDist.state === "empty") {
      d = result("empty", null);
      sumD = result("empty", null);
    } else {
      d = result("waiting", null);
      sumD = result("waiting", null);
    }

    // K + 黑 - 红，按尺分别检核（mm）
    function kCheck(blackKey, redKey, k) {
      var b = fields[blackKey];
      var r = fields[redKey];
      if (b.state === "ok" && r.state === "ok") return result("ok", k + b.value - r.value);
      if (b.state === "invalid" || r.state === "invalid") return result("invalid", null);
      if (b.state === "empty" && r.state === "empty") return result("empty", null);
      return result("waiting", null);
    }

    k1 = kCheck("back.black", "back.red", kBack);
    k2 = kCheck("front.black", "front.red", kFront);

    function diffOf(backKey, frontKey) {
      var b = fields[backKey];
      var f = fields[frontKey];
      if (b.state === "ok" && f.state === "ok") return result("ok", b.value - f.value);
      if (b.state === "invalid" || f.state === "invalid") return result("invalid", null);
      if (b.state === "empty" && f.state === "empty") return result("empty", null);
      return result("waiting", null);
    }

    blackDiff = diffOf("back.black", "front.black");
    redDiff = diffOf("back.red", "front.red");

    if (k1.state === "ok" && k2.state === "ok") {
      k3 = result("ok", k1.value - k2.value);
    } else if (k1.state === "invalid" || k2.state === "invalid") {
      k3 = result("invalid", null);
    } else if (k1.state === "empty" && k2.state === "empty") {
      k3 = result("empty", null);
    } else {
      k3 = result("waiting", null);
    }

    if (blackDiff.state === "ok" && redDiff.state === "ok") {
      mean = result("ok", (blackDiff.value + redDiff.value - (kBack - kFront)) / 2);
    } else if (blackDiff.state === "invalid" || redDiff.state === "invalid") {
      mean = result("invalid", null);
    } else if (blackDiff.state === "empty" && redDiff.state === "empty") {
      mean = result("empty", null);
    } else {
      mean = result("waiting", null);
    }

    var issues = [];
    if (started) {
      var labels = {
        "back.lower": "后尺下丝",
        "back.upper": "后尺上丝",
        "back.black": "后尺黑面",
        "back.red": "后尺红面",
        "front.lower": "前尺下丝",
        "front.upper": "前尺上丝",
        "front.black": "前尺黑面",
        "front.red": "前尺红面"
      };
      Object.keys(fields).forEach(function (key) {
        var f = fields[key];
        if (f.state === "invalid") {
          issues.push({ level: "invalid", field: key, message: labels[key] + "：" + f.error });
        } else if (f.state === "empty") {
          issues.push({ level: "missing", field: key, message: labels[key] + "未填" });
        }
      });

      if (backDist.state === "invalid" && backDist.error) {
        issues.push({ level: "invalid", field: "back.dist", message: "后视距：" + backDist.error });
      }
      if (frontDist.state === "invalid" && frontDist.error) {
        issues.push({ level: "invalid", field: "front.dist", message: "前视距：" + frontDist.error });
      }

      function limitIssue(label, field, res, limit, unit, digits) {
        if (res.state !== "ok") return;
        if (Math.abs(res.value) <= limit + 1e-9) return;
        issues.push({
          level: "warning",
          field: field,
          message: label + " = " + fmt(res.value, digits) + unit +
            "，超" + limits.label + "限差 " + limit + unit
        });
      }

      if (backDist.state === "ok" && backDist.value > limits.sight + 1e-9) {
        issues.push({
          level: "warning", field: "back.dist",
          message: "后视距 " + fmt(backDist.value, 1) + " m，超" + limits.label + "限差 " + limits.sight + " m"
        });
      }
      if (frontDist.state === "ok" && frontDist.value > limits.sight + 1e-9) {
        issues.push({
          level: "warning", field: "front.dist",
          message: "前视距 " + fmt(frontDist.value, 1) + " m，超" + limits.label + "限差 " + limits.sight + " m"
        });
      }
      limitIssue("前后视距差 d", "d", d, limits.d, " m", 1);
      limitIssue("Σd", "sumD", sumD, limits.sumD, " m", 1);
      if (k1.state === "ok" && Math.abs(k1.value) > limits.reading + 1e-9) {
        issues.push({
          level: "warning", field: "back.k",
          message: "后尺 K+黑−红 = " + fmt(k1.value, 0) + " mm，超" + limits.label + "限差 " + limits.reading + " mm"
        });
      }
      if (k2.state === "ok" && Math.abs(k2.value) > limits.reading + 1e-9) {
        issues.push({
          level: "warning", field: "front.k",
          message: "前尺 K+黑−红 = " + fmt(k2.value, 0) + " mm，超" + limits.label + "限差 " + limits.reading + " mm"
        });
      }
      limitIssue("黑红面高差之差", "k3", k3, limits.height, " mm", 0);
    }

    return {
      grade: grade,
      limits: limits,
      kBack: kBack,
      kFront: kFront,
      started: started,
      fields: fields,
      backDist: backDist,
      frontDist: frontDist,
      d: d,
      sumD: sumD,
      k1: k1,
      k2: k2,
      k3: k3,
      blackDiff: blackDiff,
      redDiff: redDiff,
      mean: mean,
      issues: issues
    };
  }

  function fmt(value, digits) {
    if (value == null || !Number.isFinite(value)) return "—";
    var text = Number(value).toFixed(digits);
    if (digits > 0) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text;
  }

  function formatMeters(value, digits) {
    if (value == null || !Number.isFinite(value)) return "—";
    return Number(value).toFixed(digits == null ? 1 : digits);
  }

  function formatMm(value, digits) {
    if (value == null || !Number.isFinite(value)) return "—";
    var d = digits == null ? 0 : digits;
    var text = Number(value).toFixed(d);
    if (d > 0) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text;
  }

  var LevelingCalc = {
    LIMITS: LIMITS,
    readStaff: readStaff,
    staffMeters: staffMeters,
    readDecimal: readDecimal,
    computeStation: computeStation,
    formatMeters: formatMeters,
    formatMm: formatMm
  };

  if (typeof module !== "undefined" && module.exports) module.exports = LevelingCalc;
  if (root) root.LevelingCalc = LevelingCalc;
})(typeof window !== "undefined" ? window : globalThis);
