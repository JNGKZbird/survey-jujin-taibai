(function (root) {
  "use strict";

  // 表四「导线测量原始数据汇总」、表五「支水准测量原始数据汇总」与
  // 表六「三角高程测量平差表」的推导。
  //
  // 三张汇总表都不接受正文手填：表四逐行取表一实际测过的测站，表五按
  // 「每人 4 段（BM1-BM0 往 / 返、BM0-1号点 往 / 返）」的顺序切表二页，
  // 表六逐行取表一每条边的往测（本站目标②）与返测（下一站目标①）。
  // 这里只做纯计算，不碰 DOM；格式化与落格由 app.js 负责。

  var TC = root.TraverseCalc;
  var LC = root.LevelingCalc;

  var TRAVERSE_ROWS = 17;
  var LEVELING_ROWS = 8;
  var LEG_PAGES_DEFAULT = 1;
  var LEG_PAGES_MIN = 1;
  var LEG_PAGES_MAX = 20;
  var LEGS_PER_PERSON = 4;
  // 表五最多 100 页 × 每页 8 人；归属里的人员序号不能超过这个上限。
  var MAX_PEOPLE = 800;
  var LEG_LABELS = [
    "BM1–BM0 往测",
    "BM1–BM0 返测",
    "BM0–1号点 往测",
    "BM0–1号点 返测"
  ];

  function str(value) {
    return value == null ? "" : String(value);
  }

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function roundTo(value, digits) {
    if (value == null || !Number.isFinite(value)) return null;
    // 十进制“半值远离零”取整。toFixed 和裸 Math.round 都会被二进制表示带偏：
    // 98.7705 实际存成 98.770499999999998，toFixed(3) 得 98.770；
    // 98.7705 × 1000 同样可能落在 98770.49999999999。先把缩放后的值加一个
    // 远小于半个末位的 epsilon，再按绝对值取整，和 Excel/Python 一致。
    var p = Math.pow(10, digits);
    var scaled = value * p;
    var eps = Math.max(1e-9, Math.abs(scaled) * 1e-12);
    var rounded = scaled < 0
      ? -Math.round(-scaled + eps)
      : Math.round(scaled + eps);
    return rounded === 0 ? 0 : rounded / p;
  }

  function round3(value) {
    return roundTo(value, 3);
  }

  function cell(value, state, note) {
    if (value == null || !Number.isFinite(value)) {
      return { value: null, state: "empty", note: "" };
    }
    return {
      value: value,
      state: state || "ok",
      note: note || ""
    };
  }

  function emptyCell() {
    return { value: null, state: "empty", note: "" };
  }

  // 表四第一列的测站名是文字，不是数值；同样用 {value,state,note} 承载，
  // 但 value 允许字符串，落格时由 app.js 决定显示。
  function textCell(text) {
    var value = str(text).trim();
    if (!value) return emptyCell();
    return { value: value, state: "ok", note: "" };
  }

  function stateOf(result) {
    if (!result) return "empty";
    if (result.state === "ok") return "ok";
    if (result.state === "partial") return "partial";
    return "empty";
  }

  function valueOf(result) {
    if (!result) return null;
    if (result.state !== "ok" && result.state !== "partial") return null;
    return num(result.value);
  }

  function combineState(a, b) {
    return a === "partial" || b === "partial" ? "partial" : "ok";
  }

  // 1°02′03″ 记作 1.0203：整数厘秒，秒 ≥59.50″ 时进位到分。
  // 与表一实习脚本 packed_dms 的口径一致。
  function packedDms(deg) {
    if (deg == null || !Number.isFinite(deg)) return null;
    var v = deg % 360;
    if (v < 0) v += 360;
    var cs = Math.round(v * 360000);
    var dd = Math.floor(cs / 360000);
    var rem = cs - dd * 360000;
    var mm = Math.floor(rem / 6000);
    var cs2 = rem - mm * 6000;
    if (cs2 >= 5950) {
      mm += 1;
      cs2 = 0;
      if (mm >= 60) {
        mm -= 60;
        dd += 1;
      }
    }
    // 359°59′59.5″ 秒进位后是 360°：按方位角口径回绕成 0°，
    // 否则会写出一格 parseDms 不接受的「360.0000」，表G 整页停算。
    if (dd >= 360) dd -= 360;
    var ss = cs2 / 100;
    return roundTo(dd + mm / 100 + ss / 10000, 4);
  }

  function packedParts(value) {
    if (value == null || !Number.isFinite(value)) return null;
    var v = Math.abs(value);
    var dd = Math.floor(v);
    var frac = v - dd;
    var mm = Math.floor(frac * 100 + 1e-9);
    // 打包值只保留四位小数，秒最多两位；不做这一步时 3.0507 会
    // 拆出 6.999999999999673 这样的浮点尾巴，六十进制累加就会少一秒。
    var ss = roundTo((frac * 100 - mm) * 100, 2);
    if (ss < 0) ss = 0;
    if (value < 0) dd = -dd;
    return { d: dd, m: mm, s: ss };
  }

  // 把若干「度.分秒」打包值按六十进制相加（不是当十进制小数直接加）。
  function sumPackedDms(values) {
    var dd = 0;
    var mm = 0;
    var ss = 0;
    var any = false;
    (values || []).forEach(function (value) {
      var parts = packedParts(value);
      if (!parts) return;
      any = true;
      dd += parts.d;
      mm += parts.m;
      ss += parts.s;
    });
    if (!any) return null;
    var cs = Math.round(ss * 100);
    var addMin = Math.floor(cs / 6000);
    cs -= addMin * 6000;
    mm += addMin;
    var addDeg = Math.floor(mm / 60);
    mm -= addDeg * 60;
    dd += addDeg;
    var sec = cs / 100;
    return roundTo(dd + mm / 100 + sec / 10000, 4);
  }

  function traverseComputationOptions(settings) {
    settings = settings || {};
    return {
      c2Limit: settings.c2Limit,
      indexLimit: settings.indexLimit,
      halfDiffLimit: settings.halfDiffLimit
    };
  }

  function collectTraverseStations(pages, settings) {
    var mode = settings && settings.mode === "ZA" ? "ZA" : "VA";
    var options = traverseComputationOptions(settings);
    var list = [];
    (Array.isArray(pages) ? pages : []).forEach(function (page, pageIndex) {
      var stations = page && Array.isArray(page.stations) ? page.stations : [];
      stations.forEach(function (station, stationIndex) {
        var res = TC.computeStation(station, mode, options);
        if (!res.stationStarted) return;
        list.push({
          pageIndex: pageIndex,
          stationIndex: stationIndex,
          station: station,
          res: res,
          name: str(station && station.name).trim()
        });
      });
    });
    return list;
  }

  function targetResult(stationEntry, index) {
    if (!stationEntry) return null;
    return stationEntry.res.targets[index] || null;
  }

  function distCell(target) {
    if (!target) return emptyCell();
    var value = valueOf(target.horizDist);
    if (value == null) return emptyCell();
    return cell(round3(value), stateOf(target.horizDist), target.horizDist.provisional ? "单盘或读数未全，暂按现有值计算" : "");
  }

  function dhCell(target) {
    if (!target) return emptyCell();
    var value = valueOf(target.heightDiff);
    if (value == null) return emptyCell();
    var note = "";
    if (target.heightDiff.provisional) {
      if (target.heightDiff.assumedI || target.heightDiff.assumedP) note = "仪器高或棱镜高未填，暂按 0 计";
      else note = "单盘或读数未全，暂按现有值计算";
    }
    return cell(round3(value), stateOf(target.heightDiff), note);
  }

  function angleCell(entry) {
    if (!entry) return emptyCell();
    var angle = entry.res.angleMean;
    var value = valueOf(angle);
    if (value == null) return emptyCell();
    return cell(packedDms(360 - value), stateOf(angle), angle.provisional ? "只有一盘水平角，暂按该盘计算" : "");
  }

  function absDiffCell(a, b, factor, note) {
    if (a.value == null || b.value == null) return emptyCell();
    return cell(Math.abs(a.value - b.value) * factor, combineState(a.state, b.state), note || "");
  }

  function sumCell(a, b, factor, note) {
    if (a.value == null || b.value == null) return emptyCell();
    return cell((a.value + b.value) * factor, combineState(a.state, b.state), note || "");
  }

  function halfDiffCell(a, b, note) {
    if (a.value == null || b.value == null) return emptyCell();
    return cell((a.value - b.value) / 2, combineState(a.state, b.state), note || "");
  }

  function meanCell(a, b, note) {
    if (a.value == null || b.value == null) return emptyCell();
    return cell((a.value + b.value) / 2, combineState(a.state, b.state), note || "");
  }

  function blankTraverseRow(index) {
    return {
      index: index,
      source: null,
      id: emptyCell(),
      angle: emptyCell(),
      distFwd: emptyCell(),
      distBack: emptyCell(),
      distErr: emptyCell(),
      distMean: emptyCell(),
      dhFwd: emptyCell(),
      dhBack: emptyCell(),
      dhMis: emptyCell(),
      dhMean: emptyCell()
    };
  }

  // 一条边 = 本站目标②（往测）+ 下一站目标①（返测）。表四与表六共用。
  function edgeObservation(cur, next) {
    var curFwd = targetResult(cur, 1);
    var nextBack = targetResult(next, 0);
    return {
      distFwd: distCell(curFwd),
      distBack: distCell(nextBack),
      dhFwd: dhCell(curFwd),
      dhBack: dhCell(nextBack)
    };
  }

  function traverseRows(pages, settings, options) {
    options = options || {};
    // 表四固定 17 行；表G 带入一条跨页导线时按页容量要更多行。
    var rowCount = options.rows == null ? TRAVERSE_ROWS : Math.floor(Number(options.rows));
    if (!Number.isFinite(rowCount) || rowCount < 1) rowCount = TRAVERSE_ROWS;
    var stations = collectTraverseStations(pages, settings);
    var count = stations.length;
    var overflow = Math.max(0, count - rowCount);
    var shown = stations.slice(0, rowCount);
    var rows = [];
    var i;
    for (i = 0; i < rowCount; i += 1) {
      if (i >= shown.length) {
        rows.push(blankTraverseRow(i + 1));
        continue;
      }
      var cur = shown[i];
      // 返测取「下一站」的目标①。正常闭合时最后一站接回第 1 站；
      // 超过行数时最后一行仍取真实下一站，避免把返测错接到第 1 站。
      var next = null;
      if (count > 1) {
        if (count <= rowCount) next = stations[(i + 1) % count];
        else if (i + 1 < count) next = stations[i + 1];
      }
      var obs = edgeObservation(cur, next);
      var angle = angleCell(cur);
      rows.push({
        index: i + 1,
        source: {
          pageIndex: cur.pageIndex,
          stationIndex: cur.stationIndex,
          name: cur.name
        },
        id: textCell(cur.name),
        angle: angle,
        distFwd: obs.distFwd,
        distBack: obs.distBack,
        distErr: absDiffCell(obs.distFwd, obs.distBack, 1000, ""),
        distMean: meanCell(obs.distFwd, obs.distBack, ""),
        dhFwd: obs.dhFwd,
        dhBack: obs.dhBack,
        dhMis: sumCell(obs.dhFwd, obs.dhBack, 1000, ""),
        dhMean: halfDiffCell(obs.dhFwd, obs.dhBack, "")
      });
    }

    var filled = rows.filter(function (row) { return row.source; });
    var angles = filled.map(function (row) { return row.angle.value; }).filter(function (v) { return v != null; });
    var totalAngle = sumPackedDms(angles);
    var totalDist = null;
    var totalDh = null;
    if (filled.length) {
      var distValues = filled.map(function (row) { return row.distMean.value; }).filter(function (v) { return v != null; });
      var dhValues = filled.map(function (row) { return row.dhMean.value; }).filter(function (v) { return v != null; });
      if (distValues.length) {
        // 合计按列内显示值相加：每个平均值先 round3，再求和。先加后取整会
        // 让纸面上「列加一遍」和 Σ 格差出每行 0.5 mm（.0005 边界行）。
        totalDist = distValues.reduce(function (sum, v) { return sum + round3(v); }, 0);
      }
      if (dhValues.length) {
        totalDh = dhValues.reduce(function (sum, v) { return sum + round3(v); }, 0);
      }
    }

    return {
      rows: rows,
      count: count,
      filled: filled.length,
      overflow: overflow,
      totalAngle: totalAngle == null ? emptyCell() : cell(totalAngle, "ok"),
      totalDist: totalDist == null ? emptyCell() : cell(round3(totalDist), "ok"),
      totalDh: totalDh == null ? emptyCell() : cell(round3(totalDh), "ok"),
      stations: stations.map(function (entry) {
        return {
          pageIndex: entry.pageIndex,
          stationIndex: entry.stationIndex,
          name: entry.name
        };
      })
    };
  }

  /* ------------------------------------------------------------------ *
   * 表六：三角高程测量平差表
   *
   * 与表四同源：每条边取「本站目标②」为往测、「下一站目标①」为返测。
   * 与表四不同的是这里要把往返观测合成一条边的成果并做闭合差分配：
   *   平距平均 = (往+返)/2；相对误差 = |往−返| ÷ 平均平距（记作 1/N）
   *   高差平均 = (往−返)/2；较差 = (往+返)×1000 mm
   *   较差允许值两档（options.sideFormula）：
   *     "sqrt"（默认）= K·√D（mm，D 以 km 计，K 默认 60）
   *     "linear"      = K·S （mm，S 为平距、以 m 计，K 默认 0.4；
   *                     等价于教材的 0.4S m、S 以 km 计）
   *   闭合差 f_h = Σ高差平均；允许值 = K·√ΣD（mm，K 默认 40）
   *   改正值按平距比例反号分配，取整到 mm，余数给最长边
   *   改正后高差 = 高差平均 + 改正值/1000；最终高程从起点高程逐条累加
   * 路线有两档：闭合回起点（默认，最后一站接回第 1 站）与非闭合
   * （最后一站没有回程边，不分配闭合差，改正值按 0 计）。
   * 表六可以多页：options.pageCount 决定能显示多少条边，超出的边进入 overflow。
   * 所有参与下游计算的数都取「已取整到 3 位小数」的显示值，保证表内自洽。
   * ------------------------------------------------------------------ */

  var TRIG_ROWS = TRAVERSE_ROWS;

  function optionalNumber(value) {
    if (value == null) return null;
    var text = String(value).trim();
    if (!text) return null;
    var n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function blankTrigRow(index) {
    return {
      index: index,
      source: null,
      id: emptyCell(),
      distFwd: emptyCell(),
      distBack: emptyCell(),
      dhFwd: emptyCell(),
      dhBack: emptyCell(),
      distMean: emptyCell(),
      distRel: emptyCell(),
      dhMean: emptyCell(),
      dhDiff: emptyCell(),
      dhAllow: emptyCell(),
      corr: emptyCell(),
      dhAdj: emptyCell(),
      elev: emptyCell()
    };
  }

  function roundInteger(value) {
    if (value == null || !Number.isFinite(value)) return null;
    // 与 roundTo / roundHalfAway 同口径：先消掉 .5 边界上的二进制噪声，
    // 再按绝对值半值远离零。50×√0.0841 在 JS 里是 14.499999999999998，
    // 裸 Math.round 会得到 14，而公式值是 14.5，应进位到 15。
    var eps = Math.max(1e-9, Math.abs(value) * 1e-12);
    return value < 0 ? -Math.round(-value + eps) : Math.round(value + eps);
  }

  // 闭合差按平距比例反号分配；逐条四舍五入到 mm，余数全部给最长边。
  function allocateCorrections(rows, closureMm) {
    var total = 0;
    rows.forEach(function (row) {
      if (row.distMean.value != null) total += row.distMean.value;
    });
    if (!(total > 0)) return null;
    var out = {};
    var sum = 0;
    var largest = null;
    rows.forEach(function (row) {
      if (row.distMean.value == null) return;
      var raw = -closureMm * row.distMean.value / total;
      var value = roundInteger(raw);
      out[row.index] = value;
      sum += value;
      if (!largest || row.distMean.value > largest.distMean.value) largest = row;
    });
    var residual = -closureMm - sum;
    if (residual && largest) out[largest.index] += residual;
    return out;
  }

  function signedMeters(value) {
    if (value == null || !Number.isFinite(value)) return "";
    return (value >= 0 ? "+" : "") + value.toFixed(3);
  }

  // 只数边数，不构造 17 行结果；翻页栏显示「第 a–b 条边」时用。
  function trigEdgeCount(pages, settings, options) {
    options = options || {};
    var count = collectTraverseStations(pages, settings).length;
    if (options.closed === false) return Math.max(0, count - 1);
    return count;
  }

  function trigRows(pages, settings, options) {
    options = options || {};
    var closed = options.closed !== false;
    var sideFormula = options.sideFormula === "linear" ? "linear" : "sqrt";
    var sideK = optionalNumber(options.sideLimit);
    if (sideK == null || sideK <= 0) sideK = 60;
    // 0.4×S 口径：S 以 m 计、结果按 mm（0.4 m/km = 0.4 mm/m）。
    var sideLinear = optionalNumber(options.sideLinear);
    if (sideLinear == null || sideLinear <= 0) sideLinear = 0.4;
    var closureK = optionalNumber(options.closureLimit);
    if (closureK == null || closureK <= 0) closureK = 40;
    var startElev = optionalNumber(options.startElev);
    var stations = collectTraverseStations(pages, settings);
    var count = stations.length;
    // 闭合回起点：n 个测站对应 n 条边（最后一站接回第 1 站）。
    // 非闭合：最后一站没有回程边，n 个测站只有 n−1 条边。
    var edgeCount = closed ? count : Math.max(0, count - 1);
    var pageCount = Math.max(1, Math.floor(Number(options.pageCount) || 1));
    var capacity = TRIG_ROWS * pageCount;
    var overflow = Math.max(0, edgeCount - capacity);
    // 至少铺满一页 17 行，页面才有完整的纸面与前 17 个计算格可以落。
    var rowCount = Math.max(TRIG_ROWS, edgeCount);
    var rows = [];
    var i;

    for (i = 0; i < rowCount; i += 1) {
      if (i >= edgeCount) {
        rows.push(blankTrigRow(i + 1));
        continue;
      }
      var cur = stations[i];
      var next = null;
      if (i + 1 < count) next = stations[i + 1];
      else if (closed && count > 1) next = stations[0];
      var obs = edgeObservation(cur, next);
      var row = {
        index: i + 1,
        source: { pageIndex: cur.pageIndex, stationIndex: cur.stationIndex, name: cur.name },
        id: textCell(next ? next.name : ""),
        distFwd: obs.distFwd,
        distBack: obs.distBack,
        dhFwd: obs.dhFwd,
        dhBack: obs.dhBack,
        distMean: emptyCell(),
        distRel: emptyCell(),
        dhMean: emptyCell(),
        dhDiff: emptyCell(),
        dhAllow: emptyCell(),
        corr: emptyCell(),
        dhAdj: emptyCell(),
        elev: emptyCell()
      };
      if (obs.distFwd.value != null && obs.distBack.value != null) {
        var mean = (obs.distFwd.value + obs.distBack.value) / 2;
        row.distMean = cell(round3(mean), combineState(obs.distFwd.state, obs.distBack.state), "");
        if (row.distMean.value > 0) {
          var delta = Math.abs(obs.distFwd.value - obs.distBack.value);
          row.distRel = cell(delta / row.distMean.value,
            combineState(obs.distFwd.state, obs.distBack.state), "");
        }
      }
      if (obs.dhFwd.value != null && obs.dhBack.value != null) {
        row.dhMean = cell(round3((obs.dhFwd.value - obs.dhBack.value) / 2),
          combineState(obs.dhFwd.state, obs.dhBack.state), "");
        row.dhDiff = cell(roundInteger((obs.dhFwd.value + obs.dhBack.value) * 1000),
          combineState(obs.dhFwd.state, obs.dhBack.state), "");
      }
      if (row.distMean.value != null && row.distMean.value > 0) {
        var allowMm = sideFormula === "linear"
          ? sideLinear * row.distMean.value
          : sideK * Math.sqrt(row.distMean.value / 1000);
        row.dhAllow = cell(roundInteger(allowMm), "ok", "");
      }
      rows.push(row);
    }

    var filled = rows.filter(function (row) { return row.source; });
    var incomplete = 0;
    var sumDist = 0;
    var sumDh = 0;
    var anyDist = false;
    var anyDh = false;
    var sideOver = 0;
    filled.forEach(function (row) {
      var complete = row.distMean.value != null && row.distMean.state === "ok" &&
        row.dhMean.value != null && row.dhMean.state === "ok";
      if (!complete) incomplete += 1;
      if (row.distMean.value != null) {
        sumDist += row.distMean.value;
        anyDist = true;
      }
      if (row.dhMean.value != null) {
        sumDh += row.dhMean.value;
        anyDh = true;
      }
      if (row.dhDiff.value != null && row.dhAllow.value != null &&
          Math.abs(row.dhDiff.value) > row.dhAllow.value) {
        sideOver += 1;
      }
    });

    var totalDist = anyDist ? round3(sumDist) : null;
    var closure = anyDh ? round3(sumDh) : null;
    var closureMm = closure == null ? null : roundInteger(closure * 1000);
    var closureAllow = (anyDist && sumDist > 0)
      ? roundInteger(closureK * Math.sqrt(sumDist / 1000))
      : null;
    // 所有边都完整、且没有超出当前页数时，闭合差比较与平差才有意义。
    // 非闭合路线没有闭合条件可比较，只要边都算全就能推高程。
    var routeReady = overflow === 0 && filled.length === edgeCount &&
      incomplete === 0 && sumDist > 0 &&
      (closed ? edgeCount >= 3 : edgeCount >= 1);
    var completeLoop = closed && routeReady;
    var closureOver = completeLoop && closureMm != null && closureAllow != null &&
      Math.abs(closureMm) > closureAllow;

    var corrections = completeLoop ? allocateCorrections(filled, closureMm) : null;
    var elevationsReady = routeReady && startElev != null;
    var acc = startElev;
    rows.forEach(function (row) {
      if (!row.source) return;
      if (closed) {
        if (!corrections) return;
        var value = corrections[row.index];
        if (value == null) return;
        row.corr = cell(value, "ok", "");
        if (row.dhMean.value == null) return;
        row.dhAdj = cell(round3(row.dhMean.value + row.corr.value / 1000), "ok", "");
      } else {
        // 非闭合路线没有闭合差可分，改正值按 0 计；改正后高差 = 高差平均值。
        if (!routeReady) return;
        row.corr = cell(0, "ok", "");
        if (row.dhMean.value == null) return;
        row.dhAdj = cell(round3(row.dhMean.value), "ok", "");
      }
      if (elevationsReady) {
        acc = round3(acc + row.dhAdj.value);
        row.elev = cell(acc, "ok", "");
      }
    });

    var totalCorr = null;
    var totalAdj = null;
    if (corrections || (!closed && routeReady)) {
      totalCorr = 0;
      totalAdj = 0;
      filled.forEach(function (row) {
        if (row.corr.value != null) totalCorr += row.corr.value;
        if (row.dhAdj.value != null) totalAdj += row.dhAdj.value;
      });
      totalAdj = round3(totalAdj);
    }

    var evalText = "";
    if (count > 0) {
      if (overflow > 0) {
        evalText = "表一已开始 " + count + " 个测站，本表 " + pageCount + " 页共可显示 " +
          capacity + " 条边，还有 " + overflow + " 条未显示；补「新页」后再" +
          (closed ? "平差" : "推高程") + "。";
      } else if (!closed) {
        if (edgeCount < 1) {
          evalText = "表一只有 " + count + " 个测站，非闭合路线至少需要 2 个测站（1 条边）。";
        } else if (!routeReady) {
          evalText = "表一还有 " + Math.max(1, incomplete) + " 条边的往返观测未算全，暂不推高程。" +
            (closure != null ? " 当前 Σ高差 = " + signedMeters(closure) + " m。" : "");
        } else {
          var openParts = [];
          openParts.push("非闭合路线（不闭合回起点）");
          openParts.push("共 " + edgeCount + " 条边");
          openParts.push("ΣD = " + (round3(sumDist) / 1000).toFixed(3) + " km");
          openParts.push("Σ高差 = " + signedMeters(closure) + " m");
          openParts.push("不分配闭合差（改正值按 0 计）");
          openParts.push(sideOver > 0 ? "对向较差 " + sideOver + " 条超限" : "对向较差全部合格");
          if (!elevationsReady) openParts.push("起点高程未填，未推高程");
          else openParts.push("终于 " + acc.toFixed(3) + " m");
          evalText = openParts.join("；") + "。";
        }
      } else if (edgeCount < 3) {
        evalText = "表一只有 " + edgeCount + " 条边，闭合环至少需要 3 条边。";
      } else if (!completeLoop) {
        evalText = "表一还有 " + Math.max(1, incomplete) + " 条边的往返观测未算全，暂不平差。" +
          (closureMm != null && closureAllow != null
            ? " 当前 f_h = " + signedMeters(closure) + " m，允许 ±" + (closureAllow / 1000).toFixed(3) + " m。"
            : "");
      } else {
        var parts = [];
        parts.push("f_h = " + signedMeters(closure) + " m");
        parts.push("允许 ±" + (closureAllow / 1000).toFixed(3) + " m（" + closureK + "√ΣD，ΣD = " +
          (round3(sumDist) / 1000).toFixed(3) + " km）");
        parts.push(closureOver ? "闭合差超限" : "闭合差合格");
        parts.push(sideOver > 0 ? "对向较差 " + sideOver + " 条超限" : "对向较差全部合格");
        if (!elevationsReady) parts.push("起点高程未填，未推高程");
        else parts.push("闭合于 " + acc.toFixed(3) + " m");
        evalText = parts.join("；") + "。";
      }
    }

    return {
      rows: rows,
      count: count,
      edgeCount: edgeCount,
      capacity: capacity,
      closed: closed,
      filled: filled.length,
      overflow: overflow,
      incomplete: incomplete,
      totalDist: totalDist == null ? emptyCell() : cell(totalDist, "ok"),
      totalDh: closure == null ? emptyCell() : cell(closure, "ok"),
      totalCorr: totalCorr == null ? emptyCell() : cell(totalCorr, "ok"),
      totalAdj: totalAdj == null ? emptyCell() : cell(totalAdj, "ok"),
      closure: closure,
      closureMm: closureMm,
      closureAllow: closureAllow,
      closureOver: closureOver,
      completeLoop: completeLoop,
      routeReady: routeReady,
      sideFormula: sideFormula,
      sideK: sideK,
      sideLinear: sideLinear,
      sideOver: sideOver,
      adjustable: !!corrections,
      elevationsReady: elevationsReady,
      startElev: startElev,
      finalElev: elevationsReady ? acc : null,
      evalText: evalText
    };
  }

  function normalizeLegPages(value) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) n = LEG_PAGES_DEFAULT;
    return Math.min(LEG_PAGES_MAX, Math.max(LEG_PAGES_MIN, n));
  }

  // 表二每页的归属：第 person 人的第 leg 段。无效归属一律返回 null。
  function normalizeOwner(raw) {
    if (!raw || typeof raw !== "object") return null;
    var person = Math.floor(Number(raw.person));
    var leg = Math.floor(Number(raw.leg));
    if (!Number.isFinite(person) || person < 1 || person > MAX_PEOPLE) return null;
    if (!Number.isFinite(leg) || leg < 0 || leg >= LEGS_PER_PERSON) return null;
    return { person: person, leg: leg };
  }

  function ownerLabel(raw) {
    var owner = normalizeOwner(raw);
    if (!owner) return "";
    return "第 " + owner.person + " 人 · " + LEG_LABELS[owner.leg];
  }

  // 把若干表二页（可以不连续）里所有已开始测站的高差中数相加。
  // 表五的「逐页归属」模式用这个函数；旧「页块」模式也复用它。
  function levelingSumPages(pages, grade, indices) {
    var sum = 0;
    var any = false;
    var partial = false;
    (indices || []).forEach(function (pageIndex) {
      var page = pages[pageIndex];
      var stations = page && Array.isArray(page.stations) ? page.stations : [];
      stations.forEach(function (station) {
        var res = LC.computeStation(station, { grade: grade });
        if (!res.started) return;
        any = true;
        if (res.mean && res.mean.state === "ok" && res.mean.value != null) {
          sum += res.mean.value;
        } else {
          partial = true;
        }
      });
    });
    return { sum: sum, any: any, partial: partial };
  }

  function levelingRunNote(partial) {
    return partial ? "本段有测站未算完，暂按已算出的测站合计" : "";
  }

  // 旧规则：一段固定占 legPages 张表二页，从 start 开始。
  function levelingRun(pages, grade, start, legPages) {
    if (!Array.isArray(pages) || start >= pages.length) return emptyCell();
    var indices = [];
    var missingPages = 0;
    for (var offset = 0; offset < legPages; offset += 1) {
      var pageIndex = start + offset;
      if (pageIndex >= pages.length) {
        missingPages += 1;
        continue;
      }
      indices.push(pageIndex);
    }
    var res = levelingSumPages(pages, grade, indices);
    if (!res.any) return emptyCell();
    var note = levelingRunNote(res.partial);
    if (missingPages) {
      note = note ? note + "；" : "";
      note += "还缺 " + missingPages + " 页";
    }
    return cell(res.sum / 1000, res.partial || missingPages ? "partial" : "ok", note);
  }

  // 逐页归属：一段由若干张页组成，页可以不连续。
  function levelingRunOwner(pages, grade, indices) {
    if (!indices || !indices.length) return emptyCell();
    var res = levelingSumPages(pages, grade, indices);
    if (!res.any) return emptyCell();
    return cell(res.sum / 1000, res.partial ? "partial" : "ok", levelingRunNote(res.partial));
  }

  function sectionFromRuns(fwd, back) {
    var mis = emptyCell();
    var mean = emptyCell();
    if (fwd.value != null && back.value != null) {
      mis = cell((fwd.value + back.value) * 1000, combineState(fwd.state, back.state),
        fwd.state === "partial" || back.state === "partial" ? "往返值含未完成测站" : "");
      mean = cell((fwd.value - back.value) / 2, combineState(fwd.state, back.state),
        fwd.state === "partial" || back.state === "partial" ? "往返值含未完成测站" : "");
    }
    return { fwd: fwd, back: back, mis: mis, mean: mean };
  }

  function averageAndError(values) {
    if (!values.length) return { avg: emptyCell(), err: emptyCell() };
    var sum = values.reduce(function (acc, v) { return acc + v; }, 0);
    var avg = sum / values.length;
    var err = null;
    if (values.length >= 2) {
      var sq = values.reduce(function (acc, v) {
        var d = v - avg;
        return acc + d * d;
      }, 0);
      // 中误差取样本标准差（n−1），单位 mm。
      err = Math.sqrt(sq / (values.length - 1)) * 1000;
    }
    return {
      avg: cell(avg, "ok"),
      err: err == null ? emptyCell() : cell(err, "ok")
    };
  }

  function normalizeSummaryPageIndex(value) {
    var n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function normalizeSummaryPageCount(value, pageIndex) {
    var n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) n = pageIndex + 1;
    return Math.max(n, pageIndex + 1);
  }

  function levelingFooter(rows) {
    var means1 = rows.map(function (row) { return row.s1.mean.value; }).filter(function (v) { return v != null; });
    var means2 = rows.map(function (row) { return row.s2.mean.value; }).filter(function (v) { return v != null; });
    var f1 = averageAndError(means1);
    var f2 = averageAndError(means2);
    return {
      avg1: f1.avg,
      err1: f1.err,
      avg2: f2.avg,
      err2: f2.err,
      n1: means1.length,
      n2: means2.length
    };
  }

  /*
   * 旧规则（页块）：表五每页 8 人。第 p 页（0 起）对应第 p×8+1 至 p×8+8 人，
   * 每人固定 perPerson = 4×legPages 页，在表二中从第 p×8×perPerson 页开始取。
   * pageCount 只用于判断表二末尾有多少页超出全部表五页的容量。
   */
  function levelingRowsByBlocks(sourcePages, grade, names, options) {
    var legPages = normalizeLegPages(options.legPages);
    var pageIndex = normalizeSummaryPageIndex(options.pageIndex);
    var pageCount = normalizeSummaryPageCount(options.pageCount, pageIndex);
    var perPerson = LEGS_PER_PERSON * legPages;
    var pagesNeeded = LEVELING_ROWS * perPerson;
    var sourceStart = pageIndex * pagesNeeded;
    var capacityPages = pageCount * pagesNeeded;
    var rangeAvailable = Math.min(pagesNeeded, Math.max(0, sourcePages.length - sourceStart));
    var rows = [];
    var i;

    for (i = 0; i < LEVELING_ROWS; i += 1) {
      var base = sourceStart + i * perPerson;
      var runs = [];
      for (var leg = 0; leg < LEGS_PER_PERSON; leg += 1) {
        runs.push(levelingRun(sourcePages, grade, base + leg * legPages, legPages));
      }
      rows.push({
        index: i + 1,
        personIndex: pageIndex * LEVELING_ROWS + i + 1,
        name: str(names[i]).trim(),
        source: {
          startPage: base,
          endPage: base + perPerson - 1,
          legs: null,
          pages: null
        },
        s1: sectionFromRuns(runs[0], runs[1]),
        s2: sectionFromRuns(runs[2], runs[3])
      });
    }

    return {
      mode: "blocks",
      pageIndex: pageIndex,
      pageCount: pageCount,
      personStart: pageIndex * LEVELING_ROWS + 1,
      personEnd: (pageIndex + 1) * LEVELING_ROWS,
      sourceStartPage: sourceStart + 1,
      sourceEndPage: sourceStart + pagesNeeded,
      rows: rows,
      legPages: legPages,
      perPerson: perPerson,
      pagesNeeded: pagesNeeded,
      pagesAvailable: sourcePages.length,
      rangeAvailable: rangeAvailable,
      missingPages: Math.max(0, pagesNeeded - rangeAvailable),
      capacityPages: capacityPages,
      ignoredPages: Math.max(0, sourcePages.length - capacityPages),
      assignedPages: null,
      unassignedPages: null,
      outOfRangePages: null,
      outOfRangeMaxPerson: null,
      outOfRangePeople: 0,
      emptyLegs: 0,
      footer: levelingFooter(rows)
    };
  }

  /*
   * 新规则（逐页归属）：每张表二页自带 {person, leg} 标签。
   * 第 p 页汇总第 p×8+1 至 p×8+8 人；每个人的每段取所有打上该标签的页，
   * 页可以不连续、可以一页以上。没有标签的页不参与汇总，只计数提示。
   */
  function levelingRowsByOwner(sourcePages, grade, names, options) {
    var pageIndex = normalizeSummaryPageIndex(options.pageIndex);
    var pageCount = normalizeSummaryPageCount(options.pageCount, pageIndex);
    var buckets = {};
    var assignedPages = 0;
    var unassignedPages = 0;
    var outOfRangePages = 0;
    var outOfRangeMaxPerson = 0;

    sourcePages.forEach(function (page, index) {
      var raw = page && page.owner;
      var owner = normalizeOwner(raw);
      if (!owner) {
        if (raw && typeof raw === "object") {
          outOfRangePages += 1;
          var person = Math.floor(Number(raw.person));
          if (Number.isFinite(person) && person > outOfRangeMaxPerson) outOfRangeMaxPerson = person;
        } else {
          unassignedPages += 1;
        }
        return;
      }
      assignedPages += 1;
      if (!buckets[owner.person]) buckets[owner.person] = [[], [], [], []];
      buckets[owner.person][owner.leg].push(index);
    });

    var rows = [];
    var outOfRangePeople = 0;
    var i;
    for (i = 0; i < LEVELING_ROWS; i += 1) {
      var personIndex = pageIndex * LEVELING_ROWS + i + 1;
      if (personIndex > MAX_PEOPLE) outOfRangePeople += 1;
      var bucket = buckets[personIndex] || [[], [], [], []];
      var runs = [];
      var legs = [];
      var union = [];
      for (var leg = 0; leg < LEGS_PER_PERSON; leg += 1) {
        var indices = bucket[leg].slice().sort(function (a, b) { return a - b; });
        runs.push(levelingRunOwner(sourcePages, grade, indices));
        legs.push({
          leg: leg,
          label: LEG_LABELS[leg],
          pages: indices.map(function (n) { return n + 1; })
        });
        indices.forEach(function (n) {
          if (union.indexOf(n) < 0) union.push(n);
        });
      }
      union.sort(function (a, b) { return a - b; });
      rows.push({
        index: i + 1,
        personIndex: personIndex,
        name: str(names[i]).trim(),
        source: {
          startPage: null,
          endPage: null,
          legs: legs,
          pages: union.map(function (n) { return n + 1; })
        },
        s1: sectionFromRuns(runs[0], runs[1]),
        s2: sectionFromRuns(runs[2], runs[3])
      });
    }

    var emptyLegs = 0;
    rows.forEach(function (row) {
      if (row.personIndex > MAX_PEOPLE) return;
      row.source.legs.forEach(function (entry) {
        if (!entry.pages.length) emptyLegs += 1;
      });
    });

    return {
      mode: "owners",
      pageIndex: pageIndex,
      pageCount: pageCount,
      personStart: pageIndex * LEVELING_ROWS + 1,
      personEnd: (pageIndex + 1) * LEVELING_ROWS,
      sourceStartPage: null,
      sourceEndPage: null,
      rows: rows,
      legPages: null,
      perPerson: null,
      pagesNeeded: null,
      pagesAvailable: sourcePages.length,
      rangeAvailable: 0,
      missingPages: 0,
      capacityPages: null,
      ignoredPages: 0,
      assignedPages: assignedPages,
      unassignedPages: unassignedPages,
      outOfRangePages: outOfRangePages,
      outOfRangeMaxPerson: outOfRangeMaxPerson,
      outOfRangePeople: outOfRangePeople,
      emptyLegs: emptyLegs,
      footer: levelingFooter(rows)
    };
  }

  // 默认自动识别：只要有一页带归属，就按逐页归属算；全部没有归属时仍走旧页块规则。
  function levelingRows(pages, settings, options) {
    options = options || {};
    var sourcePages = Array.isArray(pages) ? pages : [];
    var grade = settings && settings.grade === "III" ? "III" : "IV";
    var names = Array.isArray(options.names) ? options.names : [];
    var ownerMode = options.mode === "owners";
    if (!ownerMode && options.mode !== "blocks") {
      ownerMode = sourcePages.some(function (page) {
        return normalizeOwner(page && page.owner) != null;
      });
    }
    return ownerMode
      ? levelingRowsByOwner(sourcePages, grade, names, options)
      : levelingRowsByBlocks(sourcePages, grade, names, options);
  }

  var Summary = {
    TRAVERSE_ROWS: TRAVERSE_ROWS,
    LEVELING_ROWS: LEVELING_ROWS,
    LEGS_PER_PERSON: LEGS_PER_PERSON,
    LEG_PAGES_DEFAULT: LEG_PAGES_DEFAULT,
    LEG_PAGES_MIN: LEG_PAGES_MIN,
    LEG_PAGES_MAX: LEG_PAGES_MAX,
    MAX_PEOPLE: MAX_PEOPLE,
    LEG_LABELS: LEG_LABELS,
    packedDms: packedDms,
    packedParts: packedParts,
    sumPackedDms: sumPackedDms,
    roundTo: roundTo,
    round3: round3,
    roundInteger: roundInteger,
    normalizeLegPages: normalizeLegPages,
    normalizeOwner: normalizeOwner,
    ownerLabel: ownerLabel,
    traverseRows: traverseRows,
    trigRows: trigRows,
    trigEdgeCount: trigEdgeCount,
    TRIG_ROWS: TRIG_ROWS,
    levelingRows: levelingRows
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Summary;
  if (root) root.JujinSummary = Summary;
})(typeof window !== "undefined" ? window : globalThis);
