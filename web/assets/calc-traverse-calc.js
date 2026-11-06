(function (root) {
  "use strict";

  /* 表G「导线计算表」的纯计算。
   *
   * 一条闭合导线可以跨页：
   *   - 第 1 页是开始页（role "start"），首行是已知点，x / y / 方位角由页面
   *     手填，或由 solveConnection() 从 P/T 起算坐标、连接角 β1/β2 与连接边 d
   *     解算后填入；
   *   - 第 2 页起是续页（role "cont"），首行沿用上一页推算出的坐标与方位角，
   *     不读本页的 x / y / az；
   *   - 每页固定 11 行，全局行号 g = 页序号 × 11 + 行序号；角度闭合差、改正数、
   *     方位角、坐标增量与坐标都按整条导线算一次；
   *   - 每行的角度是内角（表四口径，表一水平角均值取 360−value）；
   *   - 每行的边长是该点到下一点的平距，最后一行回到首行。
   *
   * 角度闭合差 fβ = Σβ − (n−2)×180°，限值 ±40″√n；
   * 改正数按角数等分反号，不取整；每个角用同一个原值参与方位角与坐标，
   * 纸面显示时再按整秒四舍五入。
   * 顺时针（内角在右）α_next = α_prev + 180° − β；
   * 逆时针（内角在左）α_next = α_prev + 180° + β。
   * 注意：settings.angleDir 的 "cw" / "ccw" 是历史命名，与实际多边形
   * 方向相反——"ccw" 表示顺时针点序（内角在右），"cw" 表示逆时针点序。
   * 坐标增量 Δx = D·cos α、Δy = D·sin α，取整到 mm；
   * 闭合差按边长比例反号分配，余数给最长边；K = f / ΣD ≤ 1/K分母。
   *
   * 这里只做计算，不碰 DOM；格式化与落格由 app.js 负责。
   */

  var SC = root.JujinSummary;
  if (!SC && typeof require === "function") {
    SC = require("./calc-summary.js");
  }

  var ROWS = 11;
  var FULL = 360 * 360000; // 0.01″ 为单位的整圆
  var HALF = 180 * 360000;
  var DEFAULTS = { angleDir: "ccw", fBetaCoef: 40, kDen: 4000 };

  function str(value) {
    return value == null ? "" : String(value);
  }

  function roundTo(value, digits) {
    if (value == null || !Number.isFinite(value)) return null;
    var p = Math.pow(10, digits);
    var scaled = value * p;
    // 与 calc-summary.js、app.js summaryFixed 同口径：先消掉 .5 边界上的
    // 二进制噪声（98.7705 × 1000 = 98770.49999999999），再按绝对值取整。
    var eps = Math.max(1e-9, Math.abs(scaled) * 1e-12);
    var rounded = scaled < 0
      ? -Math.round(-scaled + eps)
      : Math.round(scaled + eps);
    return rounded === 0 ? 0 : rounded / p;
  }

  // 与表六/表四一致：半值向远离 0 的方向取整。
  function roundHalfAway(value) {
    if (value == null || !Number.isFinite(value)) return null;
    var eps = Math.max(1e-9, Math.abs(value) * 1e-12);
    var result = Math.round(Math.abs(value) + eps);
    // 负零会跟着 cos(90°) 这类浮点尾巴混进数组，落格时变成 "-0.000"。
    if (result === 0) return 0;
    return value < 0 ? -result : result;
  }

  function normalizeCs(cs) {
    return ((cs % FULL) + FULL) % FULL;
  }

  // 把「0.01″ 为单位的整数」写成 D.MMSSss 四位小数。
  // total=true 时保留超过 360° 的度数（Σβ 用），否则规范到 [0,360)。
  function packedTextFromCs(cs, total) {
    if (cs == null || !Number.isFinite(cs)) return "";
    var value = total ? Math.round(cs) : normalizeCs(Math.round(cs));
    var sign = value < 0 ? -1 : 1;
    value = Math.abs(value);
    var dd = Math.floor(value / 360000);
    var rem = value - dd * 360000;
    var mm = Math.floor(rem / 6000);
    var ssCs = rem - mm * 6000;
    // 与 SC.packedDms 同口径：秒 ≥59.50″ 进位到分，避免四位小数写出
    // 「xx.xx60」这种自己都解析不了的秒数。
    if (ssCs >= 5950) {
      mm += 1;
      ssCs = 0;
      if (mm >= 60) {
        mm -= 60;
        dd += 1;
      }
    }
    if (!total && dd >= 360) dd -= 360;
    // 四位小数就是整秒；厘秒只在第五位之后。用整数直接拼串，半值进位
    // 不经过浮点：150 cs = 1.50″，应写成 0.0002，toFixed(4) 会写成 0.0001。
    var secWhole = Math.floor(ssCs / 100 + 0.5);
    var units = dd * 10000 + mm * 100 + secWhole;
    var text = String(units);
    while (text.length < 5) text = "0" + text;
    return (sign < 0 ? "-" : "") +
      text.slice(0, text.length - 4) + "." + text.slice(-4);
  }

  // 解析「度.分秒」文本；分/秒必须 < 60。azimuth=true 时允许 360.0000 并折叠成 0。
  function parseDms(value, options) {
    options = options || {};
    var text = str(value).trim();
    if (!text) return null;
    var n = Number(text);
    if (!Number.isFinite(n) || n < 0) return null;
    var parts = SC.packedParts(n);
    if (!parts) return null;
    if (parts.m > 59) return null;
    if (parts.s >= 60) return null;
    var cs = parts.d * 360000 + parts.m * 6000 + Math.round(parts.s * 100);
    if (cs > FULL) return null;
    if (cs === FULL) {
      if (!options.azimuth) return null;
      cs = 0;
    }
    return { cs: cs, deg: cs / 360000, packed: packedTextFromCs(cs) };
  }

  function parseMeters(value) {
    var text = str(value).trim();
    if (!text) return null;
    var n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeSettings(settings) {
    settings = settings && typeof settings === "object" ? settings : {};
    var coef = Number(settings.fBetaCoef);
    if (!Number.isFinite(coef) || coef <= 0) coef = DEFAULTS.fBetaCoef;
    var kDen = Number(settings.kDen);
    if (!Number.isFinite(kDen) || kDen <= 0) kDen = DEFAULTS.kDen;
    return {
      angleDir: settings.angleDir === "cw" ? "cw" : "ccw",
      fBetaCoef: coef,
      kDen: kDen
    };
  }

  // 连接数据解算：已知边 T–P、连接角 β1（在 P）、β2（在 1）与连接边 d（P–1），
  // 求导线首行（点 1）的 X / Y 与 1→2 方位角。课程示意图把 β 画在导线左侧，
  // 左角 α_P1 = α_PT − β1、α_12 = α_P1 + 180° − β2；右角两处都取加号。
  // 输入不全时能做多少做多少，ok 只在六项输出全部得到时为 true。
  function solveConnection(input) {
    input = input && typeof input === "object" ? input : {};
    var dir = input.dir === "right" ? "right" : "left";
    var out = {
      ok: false,
      dir: dir,
      issues: [],
      azPT: null,
      distPT: null,
      azP1: null,
      x1: null,
      y1: null,
      az12: null
    };
    function bad(code, message) {
      out.issues.push({ code: code, message: message });
    }

    var values = {
      pn: parseMeters(input.pn),
      pe: parseMeters(input.pe),
      tn: parseMeters(input.tn),
      te: parseMeters(input.te)
    };
    var labels = {
      pn: "P 北坐标 N",
      pe: "P 东坐标 E",
      tn: "T 北坐标 N",
      te: "T 东坐标 E"
    };
    ["pn", "pe", "tn", "te"].forEach(function (key) {
      var text = str(input[key]).trim();
      if (text === "") bad("coord-missing", "起算坐标缺少 " + labels[key] + "。");
      else if (values[key] == null) bad("coord-invalid", labels[key] + "「" + text + "」不是有效数字。");
    });

    var pn = values.pn;
    var pe = values.pe;
    if (values.pn != null && values.pe != null && values.tn != null && values.te != null) {
      var dN = values.tn - values.pn;
      var dE = values.te - values.pe;
      var dist = Math.sqrt(dN * dN + dE * dE);
      if (dist < 0.0005) {
        bad("pt-same", "P 与 T 的坐标重合，无法确定 α_PT。");
      } else {
        var azCs = normalizeCs(Math.round(Math.atan2(dE, dN) * 180 / Math.PI * 360000));
        out.azPT = { cs: azCs, deg: azCs / 360000, packed: packedTextFromCs(azCs) };
        out.distPT = roundTo(dist, 3);
      }
    }

    var b1 = parseDms(input.b1);
    var b2 = parseDms(input.b2);
    if (str(input.b1).trim() === "") bad("b1-missing", "表四的连接角 β1 还没有填。");
    else if (!b1) bad("b1-invalid", "表四的连接角 β1「" + str(input.b1).trim() + "」不是有效的度.分秒（分、秒都要小于 60，且小于 360°）。");
    if (str(input.b2).trim() === "") bad("b2-missing", "表四的连接角 β2 还没有填。");
    else if (!b2) bad("b2-invalid", "表四的连接角 β2「" + str(input.b2).trim() + "」不是有效的度.分秒（分、秒都要小于 60，且小于 360°）。");

    var d = parseMeters(input.d);
    if (str(input.d).trim() === "") bad("d-missing", "表四的连接边 d(P−1) 还没有填。");
    else if (d == null || d <= 0) bad("d-invalid", "表四的连接边 d(P−1) 必须是大于 0 的米数。");

    var sign = dir === "right" ? 1 : -1;
    if (out.azPT && b1) {
      var p1cs = normalizeCs(out.azPT.cs + sign * b1.cs);
      out.azP1 = { cs: p1cs, deg: p1cs / 360000, packed: packedTextFromCs(p1cs) };
    }
    if (out.azP1 && d != null && d > 0) {
      var rad = (out.azP1.cs / 360000) * Math.PI / 180;
      out.x1 = roundHalfAway((pn + d * Math.cos(rad)) * 1000) / 1000;
      out.y1 = roundHalfAway((pe + d * Math.sin(rad)) * 1000) / 1000;
    }
    if (out.azP1 && b2) {
      var az12cs = normalizeCs(out.azP1.cs + HALF + sign * b2.cs);
      out.az12 = { cs: az12cs, deg: az12cs / 360000, packed: packedTextFromCs(az12cs) };
    }
    out.ok = out.issues.length === 0 && !!out.azPT && !!out.azP1 &&
      out.x1 != null && out.y1 != null && !!out.az12;
    return out;
  }

  function blankRows(count) {
    var list = [];
    var len = count == null ? ROWS : count;
    for (var i = 0; i < len; i += 1) list.push(null);
    return list;
  }

  // 行是否算「有数据」，决定 used 与断行。只有点号/角度/边长是行输入；
  // 高程只记录，不参与闭合，只填高程的空行不能把导线拉长。开始页首行的
  // x / y / 方位角是起算数据，算输入；续页首行及以后行的三格是计算值，
  // 即使残留旧输入也不参与判定。
  function rowHasAny(row, allowStart) {
    return !!(row && (row.id || row.ang || row.len ||
      (allowStart && (row.x || row.y || row.az))));
  }

  // row 是导线全局行号（0 基）。cells/focus 用页内 cellId，跳转才能落到
  // 正确那页的正确格子；没有具体行的提示（fβ、K、源导线截断）记 null。
  function issue(level, message, cells, focus, code, row) {
    var hasRow = typeof row === "number" && Number.isFinite(row);
    return {
      level: level,
      message: message,
      cells: cells || [],
      focus: focus || "",
      code: code || "",
      row: hasRow ? row : null,
      pageIndex: hasRow ? Math.floor(row / ROWS) : 0
    };
  }

  // 全局行号 → 本页第几行（1 基）的 cellId。
  function cellId(globalRow, suffix) {
    return "s" + ((globalRow % ROWS) + 1) + "-" + suffix;
  }

  // 单页保持「第 r 行」；跨页写成「第 p 页第 r 行」。
  function rowLabel(globalRow, pageCount) {
    if (pageCount <= 1) return "第 " + (globalRow + 1) + " 行";
    var page = Math.floor(globalRow / ROWS);
    return "第 " + (page + 1) + " 页第 " + (globalRow - page * ROWS + 1) + " 行";
  }

  function normalizeRow(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      id: str(raw.id).trim(),
      ang: str(raw.ang).trim(),
      len: str(raw.len).trim(),
      h: str(raw.h).trim(),
      x: str(raw.x).trim(),
      y: str(raw.y).trim(),
      az: str(raw.az).trim()
    };
  }

  // 一条导线可以有多页：第 1 页是开始页，其余是续页。引擎把各页 rows 摊平，
  // 只算一次整条导线，再把九个按行的数组切回各页给渲染层。
  function computePages(pages, settings) {
    settings = normalizeSettings(settings);
    var list = Array.isArray(pages) && pages.length ? pages : [{}];
    var pageCount = list.length;
    var rows = [];
    var data = [];
    var p;
    var i;
    for (p = 0; p < pageCount; p += 1) {
      var rawRows = list[p] && Array.isArray(list[p].rows) ? list[p].rows : [];
      // 第 1 页是开始页；若单页本身被标成续页，首行三格也不当输入。
      var contPage = p > 0 || (list[0] && list[0].role === "cont");
      for (i = 0; i < ROWS; i += 1) {
        var normalized = normalizeRow(rawRows[i]);
        rows.push(normalized);
        data.push(rowHasAny(normalized, !contPage && i === 0));
      }
    }
    var first = list[0] && typeof list[0] === "object" ? list[0] : {};
    var result = computeFlat(rows, first.source, settings, pageCount, data);
    result.pages = [];
    for (p = 0; p < pageCount; p += 1) {
      result.pages.push({ pageIndex: p, calc: slicePage(result, p, pageCount) });
    }
    result.pageCount = pageCount;
    return result;
  }

  function slicePage(result, pageIndex, pageCount) {
    var from = pageIndex * ROWS;
    function cut(list) {
      var slice = list.slice(from, from + ROWS);
      while (slice.length < ROWS) slice.push(null);
      return slice;
    }
    return {
      state: result.state,
      settings: result.settings,
      n: result.n,
      used: result.used,
      angles: cut(result.angles),
      az: cut(result.az),
      dxMm: cut(result.dxMm),
      dyMm: cut(result.dyMm),
      dxAdjMm: cut(result.dxAdjMm),
      dyAdjMm: cut(result.dyAdjMm),
      xMm: cut(result.xMm),
      yMm: cut(result.yMm),
      heights: cut(result.heights),
      sumBetaPacked: result.sumBetaPacked,
      fBetaSec: result.fBetaSec,
      fBetaAllowSec: result.fBetaAllowSec,
      angleOk: result.angleOk,
      fxMm: result.fxMm,
      fyMm: result.fyMm,
      fMm: result.fMm,
      sumD: result.sumD,
      kDenActual: result.kDenActual,
      kOk: result.kOk,
      issues: result.issues.filter(function (item) {
        return item.pageIndex === pageIndex;
      }),
      pageIndex: pageIndex,
      pageCount: pageCount,
      // 本页参与计算的连续行数（从本页首行算起）。
      pageUsed: Math.max(0, Math.min(ROWS, result.used - pageIndex * ROWS))
    };
  }

  function computeFlat(rows, source, settings, pageCount, data) {
    var i;
    var total = pageCount * ROWS;
    var out = {
      state: "empty",
      settings: settings,
      n: 0,
      used: 0,
      angles: blankRows(total),
      az: blankRows(total),
      dxMm: blankRows(total),
      dyMm: blankRows(total),
      dxAdjMm: blankRows(total),
      dyAdjMm: blankRows(total),
      xMm: blankRows(total),
      yMm: blankRows(total),
      heights: blankRows(total),
      sumBetaPacked: "",
      fBetaSec: null,
      fBetaAllowSec: null,
      angleOk: null,
      fxMm: null,
      fyMm: null,
      fMm: null,
      sumD: null,
      kDenActual: null,
      kOk: null,
      issues: []
    };

    if (!Array.isArray(data) || data.length !== total) {
      data = rows.map(function (item, index) { return rowHasAny(item, index === 0); });
    }
    var any = false;
    for (i = 0; i < total; i += 1) {
      if (data[i]) { any = true; break; }
    }
    if (!any) return out;

    var used = 0;
    while (used < total && data[used]) used += 1;
    out.used = used;

    for (i = used; i < total; i += 1) {
      if (data[i]) {
        var gapText = rowLabel(used, pageCount) +
          "是空的，后面的数据没有参与计算；请把导线写成连续的行。";
        if (pageCount > 1) gapText += "续页按每页 11 行整页承接，空行也占位。";
        out.issues.push(issue("warning", gapText,
          [cellId(used, "id")], cellId(used, "id"), "row-gap", used));
        break;
      }
    }
    if (used === 0) {
      // 首行就空着、后面却有数据：只报断行，不再拿第 0 行去套 n<3 的提示。
      out.state = "partial";
      return out;
    }

    source = source && typeof source === "object" ? source : {};
    var overflow = Number(source.overflow);
    if (Number.isFinite(overflow) && overflow > 0) {
      out.state = "partial";
      out.issues.push(issue("warning",
        "源导线有 " + (Number(source.sourceCount) || (used + overflow)) + " 站，" +
        (pageCount > 1
          ? "本表 " + pageCount + " 页共 " + total + " 行"
          : "本表只有 " + ROWS + " 行") +
        "；只带入了前 " + used + " 行，闭合差没有计算。" +
        (pageCount > 1
          ? "请重新带入让程序自动分页，或清除来源记录后手改。"
          : "请改用 11 站以内的导线，或清除来源记录后手改。"),
        [], "", "source-overflow"));
      return out;
    }

    var parsed = [];
    var complete = true;
    for (i = 0; i < used; i += 1) {
      var row = rows[i];
      var p = {
        index: i,
        id: row.id,
        ang: null,
        angError: "",
        len: null,
        lenError: "",
        h: null,
        hError: ""
      };
      if (!row.id) {
        // 点号只是说明列：缺了照常算角度、方位角与坐标，不再让整条导线停算。
        out.issues.push(issue("warning",
          rowLabel(i, pageCount) + "缺少点号；点号只作标注，不影响角度与坐标计算。",
          [cellId(i, "id")], cellId(i, "id"), "id-missing-" + (i + 1), i));
      }
      if (!row.ang) {
        complete = false;
        out.issues.push(issue("missing",
          rowLabel(i, pageCount) + "缺少角度观测值。",
          [cellId(i, "ang")], cellId(i, "ang"), "ang-missing-" + (i + 1), i));
      } else {
        p.ang = parseDms(row.ang);
        if (!p.ang) {
          complete = false;
          p.angError = "角度不是有效的度.分秒（分、秒都要小于 60，且小于 360°）。";
          out.issues.push(issue("invalid",
            rowLabel(i, pageCount) + "角度「" + row.ang + "」无效：" + p.angError,
            [cellId(i, "ang")], cellId(i, "ang"), "ang-invalid-" + (i + 1), i));
        }
      }
      if (!row.len) {
        complete = false;
        out.issues.push(issue("missing",
          rowLabel(i, pageCount) + "缺少导线长。",
          [cellId(i, "len")], cellId(i, "len"), "len-missing-" + (i + 1), i));
      } else {
        p.len = parseMeters(row.len);
        if (p.len == null || p.len <= 0) {
          complete = false;
          p.lenError = "导线长必须是大于 0 的米数。";
          out.issues.push(issue("invalid",
            rowLabel(i, pageCount) + "导线长「" + row.len + "」无效：" + p.lenError,
            [cellId(i, "len")], cellId(i, "len"), "len-invalid-" + (i + 1), i));
        }
      }
      if (row.h) {
        p.h = parseMeters(row.h);
        if (p.h == null) {
          p.hError = "高程不是有效数字。";
          out.issues.push(issue("warning",
            rowLabel(i, pageCount) + "高程「" + row.h + "」不是数字；高程只记录，不影响导线闭合。",
            [cellId(i, "h")], cellId(i, "h"), "h-invalid-" + (i + 1), i));
        }
      }
      out.heights[i] = p.h;
      parsed.push(p);
    }

    if (!complete) {
      out.state = "partial";
      return out;
    }

    var n = used;
    out.n = n;
    if (n < 3) {
      out.state = "partial";
      out.issues.push(issue("warning",
        "至少要 3 个角才能组成闭合导线；现在只有 " + n + " 行。",
        [cellId(n - 1, "ang")], cellId(n - 1, "ang"), "too-few-rows", n - 1));
      return out;
    }

    var sumCs = 0;
    parsed.forEach(function (item) { sumCs += item.ang.cs; });
    var fBetaCs = sumCs - (n - 2) * HALF;
    // 与老师表的算法一致：改正数按原值等分反号，不取整，也不把余数
    // 堆到首行；每个角用同一个未取整的值参与方位角与坐标。纸面
    // （D.MMSS，整秒）只在显示时四舍五入，不能反过来用落格值回算。
    var corrCs = -fBetaCs / n;
    var corrections = parsed.map(function () { return corrCs; });
    // 等分除不尽时把浮点尾巴（量级 <1e-9″）并到最后一行，保证
    // Σ改正数恰好 = −fβ；它远小于厘秒，不改变任何显示值。
    corrections[n - 1] += -fBetaCs - corrCs * n;

    out.angles = parsed.map(function (item, index) {
      var adjCs = item.ang.cs + corrections[index];
      return {
        rawCs: item.ang.cs,
        corrCs: corrections[index],
        adjCs: adjCs,
        adjPacked: packedTextFromCs(adjCs)
      };
    });
    out.sumBetaPacked = packedTextFromCs(sumCs, true);
    out.fBetaSec = fBetaCs / 100;
    out.fBetaAllowSec = settings.fBetaCoef * Math.sqrt(n);
    out.angleOk = Math.abs(fBetaCs) <= out.fBetaAllowSec * 100 + 1e-9;

    if (!out.angleOk) {
      out.issues.push(issue("warning",
        "角度闭合差 " + (out.fBetaSec >= 0 ? "+" : "") + out.fBetaSec.toFixed(2) +
        "″ 超过允许值 ±" + out.fBetaAllowSec.toFixed(2) + "″（" +
        settings.fBetaCoef + "″√" + n + "）。",
        [], "", "fbeta-over"));
    }

    var sumD = 0;
    parsed.forEach(function (item) { sumD += item.len; });
    out.sumD = roundTo(sumD, 3);

    var startAz = parseDms(rows[0].az, { azimuth: true });
    if (!startAz) {
      out.state = "partial";
      if (!rows[0].az) {
        out.issues.push(issue("missing",
          "首行（" + (rows[0].id || "已知点") + "）的起算方位角还没有填。",
          [cellId(0, "az")], cellId(0, "az"), "az-missing", 0));
      } else {
        out.issues.push(issue("invalid",
          "首行起算方位角「" + rows[0].az + "」无效：请用度.分秒，例如 45.3000。",
          [cellId(0, "az")], cellId(0, "az"), "az-invalid", 0));
      }
    } else {
      var az = blankRows(total);
      az[0] = { cs: startAz.cs, packed: startAz.packed };
      for (i = 1; i < n; i += 1) {
        if (!az[i - 1]) continue;
        var step = settings.angleDir === "ccw"
          ? HALF - out.angles[i].adjCs
          : HALF + out.angles[i].adjCs;
        var next = normalizeCs(az[i - 1].cs + step);
        az[i] = { cs: next, packed: packedTextFromCs(next) };
      }
      out.az = az;

      var dx = blankRows(total);
      var dy = blankRows(total);
      for (i = 0; i < n; i += 1) {
        if (!az[i]) continue;
        var rad = (az[i].cs / 360000) * Math.PI / 180;
        dx[i] = roundHalfAway(parsed[i].len * 1000 * Math.cos(rad));
        dy[i] = roundHalfAway(parsed[i].len * 1000 * Math.sin(rad));
      }
      out.dxMm = dx;
      out.dyMm = dy;

      var allIncrements = true;
      for (i = 0; i < n; i += 1) {
        if (dx[i] == null || dy[i] == null) { allIncrements = false; break; }
      }
      if (allIncrements) {
        var fx = 0;
        var fy = 0;
        for (i = 0; i < n; i += 1) { fx += dx[i]; fy += dy[i]; }
        out.fxMm = fx;
        out.fyMm = fy;
        out.fMm = Math.sqrt(fx * fx + fy * fy);
        if (sumD > 0) {
          out.kDenActual = out.fMm > 0 ? sumD * 1000 / out.fMm : Infinity;
          out.kOk = out.fMm === 0 ||
            (out.fMm / 1000 / sumD) <= 1 / settings.kDen + 1e-12;
        }
        if (out.kOk === false) {
          out.issues.push(issue("warning",
            "导线全长相对闭合差 " +
            (out.kDenActual === Infinity ? "0" : "1/" + Math.floor(out.kDenActual)) +
            " 超过 1/" + settings.kDen + "。",
            [], "", "k-over"));
        }

        var dxAdj = dx.slice();
        var dyAdj = dy.slice();
        var corrDx = allocate(dx, parsed, -fx);
        var corrDy = allocate(dy, parsed, -fy);
        for (i = 0; i < n; i += 1) {
          if (corrDx) dxAdj[i] = dx[i] + corrDx[i];
          if (corrDy) dyAdj[i] = dy[i] + corrDy[i];
        }
        out.dxAdjMm = dxAdj;
        out.dyAdjMm = dyAdj;
      }
    }

    var startX = parseMeters(rows[0].x);
    var startY = parseMeters(rows[0].y);
    var hasStart = startX != null && startY != null;
    if (!hasStart) {
      out.state = "partial";
      if (rows[0].x === "" && rows[0].y === "") {
        out.issues.push(issue("missing",
          "首行的 x、y 起算坐标还没有填，坐标值无法推算。",
          [cellId(0, "x"), cellId(0, "y")], cellId(0, "x"), "xy-missing", 0));
      } else {
        out.issues.push(issue("missing",
          "首行的 x、y 起算坐标要成对填写；现在缺 " +
          (rows[0].x === "" ? "x" : "y") + "。",
          [cellId(0, "x"), cellId(0, "y")],
          cellId(0, rows[0].x === "" ? "x" : "y"), "xy-pair", 0));
      }
    } else {
      var x = blankRows(total);
      var y = blankRows(total);
      x[0] = roundHalfAway(startX * 1000);
      y[0] = roundHalfAway(startY * 1000);
      for (i = 1; i < n; i += 1) {
        if (x[i - 1] == null || out.dxAdjMm[i - 1] == null) continue;
        x[i] = x[i - 1] + out.dxAdjMm[i - 1];
        y[i] = y[i - 1] + out.dyAdjMm[i - 1];
      }
      out.xMm = x;
      out.yMm = y;
    }

    out.state = out.issues.some(function (item) {
      return item.level === "missing" || item.level === "invalid";
    }) ? "partial" : "ok";
    return out;
  }

  // 单页包装：现有调用（规格渲染、摘要卡、旧测试）只关心当前页的切片。
  function compute(page, settings) {
    return computePages([page], settings).pages[0].calc;
  }

  // 闭合差按边长比例反号分配；逐条 mm 取整，余数给最长边。
  // amountMm 是「要分配的负闭合差」：corrDx 传 −fx。
  function allocate(dx, parsed, amountMm) {
    var total = 0;
    var longest = -1;
    parsed.forEach(function (item, index) {
      total += item.len;
      if (longest < 0 || item.len > parsed[longest].len) longest = index;
    });
    if (!(total > 0)) return null;
    var out = [];
    var sum = 0;
    parsed.forEach(function (item, index) {
      var value = roundHalfAway(amountMm * item.len / total);
      out[index] = value;
      sum += value;
      if (dx[index] == null) out[index] = 0;
    });
    var residual = amountMm - sum;
    if (residual && longest >= 0) out[longest] += residual;
    return out;
  }

  var Engine = {
    ROWS: ROWS,
    DEFAULTS: DEFAULTS,
    parseDms: parseDms,
    packedTextFromCs: packedTextFromCs,
    solveConnection: solveConnection,
    roundTo: roundTo,
    roundHalfAway: roundHalfAway,
    computePages: computePages,
    compute: compute
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  if (root) root.JujinTraverseCalc = Engine;
})(typeof window !== "undefined" ? window : globalThis);
