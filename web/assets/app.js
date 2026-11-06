(function () {
  "use strict";

  var DATA = window.SHEET_DATA;
  var TC = window.TraverseCalc;
  var LC = window.LevelingCalc;
  var AC = window.AngleDistanceCalc;
  var SC = window.JujinSummary;
  var TCALC = window.JujinTraverseCalc;
  var STORE = window.JujinStore;
  var LINKAGE = window.JujinLinkage;
  var TRANSFER = window.JujinTransfer;
  var BANDS = window.JujinBands || null;
  var THEME = window.JujinTheme || null;

  var VERSION = 1;
  // 限差默认值的版本号。老项目没有这个键，载入时把仍是旧内置默认值的限差
  // 换成本课程《指标限差》的口径；用户改过的值不动。
  var LIMITS_REV = 1;
  var MAX_PAGES = 100;
  // 表四/表五是由表一/表二强制推导的汇总页，不是独立记录页，不参与「三表」的旧版兼容校验。
  // 表四固定一页；表五每页 8 人，可以像表一一样新增页来容纳更多人。
  var TABLE_KEYS = ["traverse", "leveling", "angle", "traverseSummary", "levelingSummary", "trigSummary", "traverseCalc"];
  var RECORD_KEYS = ["traverse", "leveling", "angle"];
  var SUMMARY_KEYS = ["traverseSummary", "levelingSummary", "trigSummary"];

  function isSummaryKey(key) {
    return SUMMARY_KEYS.indexOf(key) !== -1;
  }

  // 表G 导线计算不是表一~表六那种「固定映射汇总页」：它一页记一条导线，
  // 数据可以从当前项目的表一＋表六带入，也可以手填。
  // 因此它既不进 SUMMARY_KEYS（不受一页限制、不参与联立），也不进
  // RECORD_KEYS（页容量的含义不同）。
  function isCalcKey(key) {
    return key === "traverseCalc";
  }

  // 表五每页 8 人、表六每页 17 条边，都可以新增页；表四固定一页。
  function summaryAllowsPages(key) {
    return key === "levelingSummary" || key === "trigSummary";
  }
  var LINKAGE_LOCK_TITLE = "联立中：本格由表一自动填入；解除联立后可编辑。";

  function showFatal(message) {
    var stage = document.getElementById("stage");
    if (!stage) {
      window.alert(message);
      return;
    }
    stage.textContent = "";
    var box = document.createElement("div");
    box.style.cssText = "margin:60px auto;max-width:620px;padding:22px 24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;color:#111827;font:13px/1.7 'HarmonyOS Sans SC','Microsoft YaHei',sans-serif";
    box.textContent = message;
    stage.appendChild(box);
  }

  if (!DATA || !DATA.sheets || !DATA.sheets.traverse || !DATA.sheets.leveling ||
      !DATA.sheets.angle || !DATA.sheets.traverseSummary || !DATA.sheets.levelingSummary ||
      !DATA.sheets.trigSummary || !DATA.sheets.traverseCalc ||
      !TC || !LC || !AC || !SC || !TCALC) {
    showFatal("记录表数据或计算引擎未能载入。请确认 index.html 同目录下的 assets 文件夹完整（sheet-data.js 与五个 calc-*.js）。");
    return;
  }
  if (!STORE) {
    showFatal("项目存储模块未能载入。请确认 assets/store.js 存在，且脚本顺序没有被改动。");
    return;
  }
  if (!TRANSFER) {
    showFatal("导入导出模块未能载入。请确认 assets/transfer.js 存在，且脚本顺序没有被改动。");
    return;
  }

  var TABLES = {
    traverse: {
      key: "traverse",
      short: "表一",
      tab: "表一 导线",
      name: "全站仪导线观测记录表",
      sheet: DATA.sheets.traverse,
      capacity: 4,
      metaKeys: ["year", "month", "day", "observer", "recorder", "calculator", "group"],
      metaLabels: {
        year: "年份后两位",
        month: "月份",
        day: "日期",
        observer: "观测者",
        recorder: "记录者",
        calculator: "计算者",
        group: "班组"
      },
      metaDigits: { year: 2, month: 2, day: 2 }
    },
    leveling: {
      key: "leveling",
      short: "表二",
      tab: "表二 水准",
      name: "三、四等水准测量记录、计算表（双面尺法）",
      sheet: DATA.sheets.leveling,
      capacity: 8,
      metaKeys: ["date", "weather", "instrument", "class", "group"],
      metaLabels: {
        date: "日期",
        weather: "天气",
        instrument: "仪器",
        "class": "班级",
        group: "班组"
      },
      metaDigits: {}
    },
    angle: {
      key: "angle",
      short: "表三",
      tab: "表三 角度",
      name: "角度距离观测记录手簿",
      sheet: DATA.sheets.angle,
      capacity: 6,
      metaKeys: ["date", "instrument", "observer", "weather", "group", "recorder"],
      metaLabels: {
        date: "日期",
        instrument: "仪器",
        observer: "观测者",
        weather: "天气",
        group: "班组",
        recorder: "记录者"
      },
      metaDigits: {}
    },
    traverseSummary: {
      key: "traverseSummary",
      short: "表四",
      tab: "表四 导线汇总",
      name: "导线测量原始数据汇总",
      sheet: DATA.sheets.traverseSummary,
      capacity: 0,
      summary: true,
      metaKeys: ["year", "base", "control", "batch", "team", "leader", "conn-b1", "conn-b2", "conn-d"],
      metaLabels: {
        year: "年份",
        base: "基地",
        control: "控制点",
        batch: "批次",
        team: "队/组",
        leader: "组长",
        "conn-b1": "连接角 β1（度.分秒）",
        "conn-b2": "连接角 β2（度.分秒）",
        "conn-d": "连接边 d(P−1)（米）"
      },
      metaDigits: {}
    },
    levelingSummary: {
      key: "levelingSummary",
      short: "表五",
      tab: "表五 水准汇总",
      name: "支水准测量原始数据汇总",
      sheet: DATA.sheets.levelingSummary,
      capacity: 0,
      summary: true,
      metaKeys: ["leader", "vice", "date"],
      metaLabels: {
        leader: "组长",
        vice: "副组长",
        date: "日期"
      },
      metaDigits: {}
    },
    // 表六与表四同属「表一 → 汇总表」的强制映射；区别是它要把往返观测
    // 合成一条边的成果并做闭合差分配，所以正文全是计算格，只有表头
    // （含起点高程）与整列合一的备注可编辑。
    trigSummary: {
      key: "trigSummary",
      short: "表六",
      tab: "表六 高程",
      name: "三角高程测量平差表",
      sheet: DATA.sheets.trigSummary,
      capacity: 0,
      summary: true,
      metaKeys: ["start-elev", "calc", "check", "group"],
      metaLabels: {
        "start-elev": "起点高程（米）",
        calc: "计算",
        check: "检核",
        group: "班/组"
      },
      metaDigits: {}
    },
    // 表G 导线计算表：一页 = 一条导线。表头四格照空白表，
    // 首行是已知点（x / y / 方位角为输入），其余 10 行的角度、边长、高程
    // 手填或从当前项目的表一＋表六带入，中间各列全部由引擎推算。
    traverseCalc: {
      key: "traverseCalc",
      short: "表G",
      tab: "表G 计算",
      name: "导线计算表",
      sheet: DATA.sheets.traverseCalc,
      capacity: 0,
      calc: true,
      metaKeys: ["date", "group", "calc", "check"],
      metaLabels: {
        date: "日期",
        group: "班·组",
        calc: "计算人",
        check: "复核人"
      },
      metaDigits: {}
    }
  };

  var CELLS = {};
  TABLE_KEYS.forEach(function (key) {
    var map = {};
    TABLES[key].sheet.cells.forEach(function (cell) {
      map[cell.id] = cell;
    });
    CELLS[key] = map;
  });

  /* 打印用 A4 纸面与表格在纸上的实际宽度（mm）。
     表一按设计规格整体 260 mm；表二、表三沿用现有打印宽度。
     表格比例不动，剩余部分作为纸边留白。 */
  var PAPER = {
    traverse: { widthMm: 297, heightMm: 210, contentWidthMm: 260 },
    leveling: { widthMm: 210, heightMm: 297, contentWidthMm: 175 },
    angle: { widthMm: 210, heightMm: 297, contentWidthMm: 190 },
    // 表四 / 表五都是矮横表，按 A4 横向可用宽度 277 mm 排，比例保持设计稿。
    traverseSummary: { widthMm: 297, heightMm: 210, contentWidthMm: 277 },
    levelingSummary: { widthMm: 297, heightMm: 210, contentWidthMm: 277 },
    // 表六画布 1548×1356.5（比例 1.14），277 mm 宽会折出 243 mm 高，
    // 被 210 mm 的纸面裁掉；226 mm 宽对应约 198 mm 高，整表落在纸内。
    trigSummary: { widthMm: 297, heightMm: 210, contentWidthMm: 226 },
    // 表G 画布 1548×1130（比例 1.37），277 mm 宽折出约 202.2 mm 高，
    // 落在 A4 横向 210 mm 以内。
    traverseCalc: { widthMm: 297, heightMm: 210, contentWidthMm: 277 }
  };
  // 3：屏幕改为原生暖白工作表，不再模拟 A4 纸框；PAPER 只留给打印。
  var PAPER_LAYOUT = 3;
  var SCALE_MIN = 60;
  var SCALE_MAX = 500;
  var SCALE_KEY_STEP = 10;
  var SCALE_DEFAULT = 100;
  var SCALE_BASE_MIN = 10;
  var SCALE_BASE_MAX = 500;
  // 2026-10-27 目视校准：表一 110%、表二 250%、表三 200% 的旧放大倍率
  // 从本版起作为各自 100% 的基准；fitSheet 先乘基准，再乘底栏百分比。
  var SCALE_BASE_DEFAULTS = {
    traverse: 110,
    leveling: 250,
    angle: 200,
    traverseSummary: 100,
    levelingSummary: 100,
    trigSummary: 100,
    traverseCalc: 100
  };
  var SCALE_BASE_TEXT = "表一 110%、表二 250%、表三 200%，表四 / 表五 / 表六 / 表G 100%";
  // 2：旧记录首次载入时把旧大小固化为 100% 基准，而不是压回统一的 100%。
  var SCALE_REVISION = 2;
  // 右键 + 滚轮：约 100 px 滚动量缩放 10%。
  var ZOOM_WHEEL_RATE = 0.001;
  // Chromium 把触控板捏合合成为 ctrl + wheel，deltaY = -100 * ln(scale)。
  // 用 0.01 才能还原真实捏合比例；离散鼠标滚轮仍走上面的 0.001。
  var ZOOM_PINCH_RATE = 0.01;
  var ZOOM_PINCH_MAX_DELTA = 80;

  function normalizeScale(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = SCALE_DEFAULT;
    // 允许任意整数百分比；键盘快捷键按 10% 步进。
    n = Math.round(n);
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
  }

  function normalizeBaseScale(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = SCALE_DEFAULT;
    n = Math.round(n);
    return Math.min(SCALE_BASE_MAX, Math.max(SCALE_BASE_MIN, n));
  }

  var dom = {};
  var state = null;
  var activeModule = null;
  var LITE = !!window.__JUJIN_LITE__;
  var analysis = null;
  var runtime = null;
  var storageOk = true;
  var checksOpen = false;
  var checksTab = "issues";
  var drawerOpen = false;
  var ownerPopoverOpen = false;
  var modalResolve = null;
  var modalLastFocus = null;
  var modalAppInert = false;
  var modalDrawerInert = false;
  var saveTimer = null;
  var recomputeTimer = null;
  var linkageTimer = null;
  var linkageLockToastAt = 0;
  var lastSavedAt = null;
  var storagePaths = null;
  var closeHandling = false;
  var saveErrorToastAt = 0;
  var nativeLoadMeta = null;
  var printTitleBackup = null;
  var printBusy = false;
  var toastTimer = null;
  var initialized = false;
  var wheelZoomTarget = null;
  var wheelZoomAnchor = null;
  var wheelZoomRaf = 0;
  var wheelZoomIdleTimer = null;
  var zoomHudTimer = null;
  var rightZoomHeld = false;

  // 「误差色」是显示偏好，和主题一样记在本机，不写入项目库、不随导出。
  var BAND_KEY = "survey-jujin.errorBands";
  var bandsOn = readBandPreference();

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function readBandPreference() {
    try {
      return !!window.localStorage && window.localStorage.getItem(BAND_KEY) === "1";
    } catch (err) {
      return false;
    }
  }


  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function hhmmss(d) {
    if (!d) return "";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function stamp() {
    var d = new Date();
    return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      "-" + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function str(v) {
    return v == null ? "" : String(v);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function errorText(err) {
    if (err && err.message) return err.message;
    var text = String(err == null ? "" : err);
    return text || "未知错误";
  }

  function clamp(n, low, high) {
    return Math.min(high, Math.max(low, n));
  }

  function dmsAny(parts) {
    if (!parts || typeof parts !== "object") return false;
    return str(parts.d).trim() !== "" || str(parts.m).trim() !== "" || str(parts.s).trim() !== "";
  }

  function blankDms() {
    return { d: "", m: "", s: "" };
  }

  function blankReading() {
    return { h: blankDms(), v: blankDms(), s: "" };
  }

  function cleanSvg(svg) {
    return str(svg)
      .replace(/^\uFEFF/, "")
      .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, "");
  }

  function sanitizeDigits(value, allowMinus, maxDigits, allowLoneMinus) {
    var raw = value == null ? "" : String(value);
    var negative = !!allowMinus && /^\s*-/.test(raw);
    var digits = raw.replace(/\D/g, "");
    if (maxDigits) digits = digits.slice(0, maxDigits);
    if (!digits) return negative && allowLoneMinus ? "-" : "";
    return (negative ? "-" : "") + digits;
  }

  function sanitizeDecimal(value, allowMinus) {
    var raw = value == null ? "" : String(value);
    var negative = !!allowMinus && /^\s*-/.test(raw);
    raw = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
    var parts = raw.split(".");
    if (parts.length > 2) raw = parts[0] + "." + parts.slice(1).join("");
    if (raw.charAt(0) === ".") raw = "0" + raw;
    // 只留前导负号：负高程、负坐标要能输，且先敲「-」时不能当场被吃掉。
    if (negative) raw = "-" + raw;
    return raw;
  }

  // 水准尺读数按米填（1.170）。输入过程中保留小数点，失焦时补成三位小数；
  // 老项目里存的 mm 整数（1170）在载入时换成米，见 staffMeters。
  function sanitizeStaffInput(value, maxLength) {
    var raw = value == null ? "" : String(value);
    raw = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
    var dot = raw.indexOf(".");
    if (dot >= 0) {
      var head = raw.slice(0, dot);
      var tail = raw.slice(dot + 1).replace(/\./g, "");
      // 尺读数按米写时整数只有一位（1.170）；多位数里的小数点当作没按，
      // 不能把已有的数字吃掉。
      // 尺读数只到 mm（三位小数）。第四位不放开，避免 0.1025 失焦时
      // 被 toFixed 截成 0.102、计算却按 103 mm 的两套结果。
      raw = head.length > 1 ? head + tail : (head || "0") + "." + tail.slice(0, 3);
    }
    if (maxLength && raw.length > maxLength) raw = raw.slice(0, maxLength);
    return raw;
  }

  function formatDmsParts(parts) {
    if (!parts) return "";
    var d = str(parts.d).trim();
    var m = str(parts.m).trim();
    var s = str(parts.s).trim();
    if (!d && !m && !s) return "";
    var out = "";
    if (d) out += d + "°";
    if (m) out += m + "′";
    if (s) out += s + "″";
    return out;
  }

  function parseDmsText(text, allowMinus) {
    var raw = str(text).trim();
    if (!raw) return null;
    var match = raw.match(/^([+\-]?)\s*(\d{1,3})\s*[°度d:\s]\s*(\d{1,2})\s*[′'分:\s]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:″|"|秒)?\s*$/);
    if (!match) return null;
    var negative = match[1] === "-";
    if (negative && !allowMinus) negative = false;
    var d = parseInt(match[2], 10);
    var m = parseInt(match[3], 10);
    var s = Math.round(parseFloat(match[4].replace(",", ".")));
    if (!isFinite(d) || !isFinite(m) || !isFinite(s)) return null;
    if (s >= 60) {
      s -= 60;
      m += 1;
    }
    if (m >= 60) {
      m -= 60;
      d += 1;
    }
    if (negative) d = -d;
    return { d: String(d), m: pad2(m), s: pad2(s) };
  }

  function hasData(v) {
    return str(v).trim() !== "";
  }

  /* ------------------------------------------------------------------ *
   * 默认状态
   * ------------------------------------------------------------------ */

  function defaultK(pageIndex, stationIndex) {
    var global = pageIndex * 8 + stationIndex;
    if (global % 2 === 0) return { kBack: "4787", kFront: "4687" };
    return { kBack: "4687", kFront: "4787" };
  }

  function blankTarget(index) {
    return {
      id: String(index + 1),
      name: "",
      prismHeight: "",
      readings: { L: blankReading(), R: blankReading() }
    };
  }

  function blankTraverseStation() {
    return {
      name: "",
      instrumentHeight: "",
      targets: [blankTarget(0), blankTarget(1)]
    };
  }

  function blankLevelingStation(pageIndex, stationIndex) {
    var k = defaultK(pageIndex, stationIndex);
    return {
      stationNo: "",
      observer: "",
      back: { lower: "", upper: "", black: "", red: "" },
      front: { lower: "", upper: "", black: "", red: "" },
      dirs: ["", "", ""],
      wide: "",
      kBack: k.kBack,
      kFront: k.kFront
    };
  }

  function blankAngleStation() {
    return {
      station: "",
      rows: [
        { target: "", reading: blankDms(), distance: "" },
        { target: "", reading: blankDms(), distance: "" },
        { target: "", reading: blankDms(), distance: "" },
        { target: "", reading: blankDms(), distance: "" }
      ]
    };
  }

  function blankMeta(keys) {
    var meta = {};
    keys.forEach(function (key) { meta[key] = ""; });
    return meta;
  }

  function blankCalcRow() {
    return { id: "", ang: "", len: "", h: "", x: "", y: "", az: "" };
  }

  // 表G 一页是一次带入的快照。来源固定为本项目，不再记录组员或项目 id；
  // capturedAt / sourceCount / overflow 记录带入当时的表一状态，
  // 只在提示「表一站数变了」「源导线被截断」时用，不参与计算。
  function blankCalcSource() {
    return {
      capturedAt: "",
      sourceCount: 0,
      overflow: 0,
      // 表六带入的高程个数（含首行起点高程），只用于抽屉里的来源说明。
      heightCount: 0
    };
  }

  function blankPage(key, pageIndex) {
    var cfg = TABLES[key];
    if (key === "traverseSummary") {
      return { meta: blankMeta(cfg.metaKeys) };
    }
    if (key === "traverseCalc") {
      // role 决定这一页是导线的开始页还是续页：续页的首行坐标与方位角由上一页推算。
      var calcPage = {
        meta: blankMeta(cfg.metaKeys),
        role: "start",
        source: blankCalcSource(),
        rows: []
      };
      for (var c = 0; c < TCALC.ROWS; c += 1) calcPage.rows.push(blankCalcRow());
      return calcPage;
    }
    if (key === "trigSummary") {
      // 表六正文全部推导；只有表头与整列合一的备注是手填的。
      return { meta: blankMeta(cfg.metaKeys), remark: "" };
    }
    if (key === "levelingSummary") {
      var page = { meta: blankMeta(cfg.metaKeys), names: [] };
      for (var n = 0; n < SC.LEVELING_ROWS; n += 1) page.names.push("");
      return page;
    }
    var record = { meta: blankMeta(cfg.metaKeys), stations: [] };
    if (key === "traverse") {
      for (var i = 0; i < cfg.capacity; i += 1) record.stations.push(blankTraverseStation());
    } else if (key === "leveling") {
      record.remark = "";
      // 表五「逐页归属」用：本页记第几人的第几段；null 表示还没归属。
      record.owner = null;
      for (var j = 0; j < cfg.capacity; j += 1) record.stations.push(blankLevelingStation(pageIndex, j));
    } else {
      for (var k = 0; k < cfg.capacity; k += 1) record.stations.push(blankAngleStation());
    }
    return record;
  }

  function defaultZoom() {
    return "page";
  }

  function defaultSettings() {
    return {
      limitsRev: LIMITS_REV,
      // 课程《指标限差》：水平角 2C ≤12″、上下半测回较差 ≤20″；竖直角指标差 ≤25″。
      traverse: { mode: "VA", c2Limit: 12, indexLimit: 25, halfDiffLimit: 20 },
      leveling: { grade: "IV" },
      // 表三半测回角值之差对应课程「水平角上下半测回较差 ≤20″」。
      angle: { limit: 20, font: "harmony" },
      traverseSummary: {},
      levelingSummary: { legPages: SC.LEG_PAGES_DEFAULT, ownerMode: false },
      // 表六平差口径：对向高差较差有三档预设（系数仍可在抽屉里改）——
      //   sideFormula = "sqrt"  ：K·√D（mm，D 以 km 计，K = sideLimit；预设 60 或 40）
      //   sideFormula = "linear"：K·S （mm，S 为平距、以 m 计，K = sideLinear，默认 0.4；
      //                          等价于教材的 0.4S 米、S 以 km 计）
      // 闭合差固定按 K·√ΣD（mm，ΣD 以 km 计）。
      // closed = false 时按非闭合路线推高程，不做闭合差分配。
      trigSummary: {
        sideFormula: "sqrt",
        sideLimit: 60,
        sideLinear: 0.4,
        closureLimit: 40,
        closed: true
      },
      // 表G 口径：默认顺时针（表四内角在导线右侧；内部值 ccw，历史命名与
      // 实际多边形方向相反），fβ 限值 ±40″√n，全长相对闭合差 1/4000。
      // 起算坐标属于表G：P 给课程固定值，T 按队号/组号/学号生成；connDir 是
      // 连接角方向（课程示意图画在导线左侧，默认 left）。
      // coordsPrompt = "pending" 时在表G 选项里保留软提示，dismissed 后不再劝。
      traverseCalc: {
        angleDir: "ccw",
        fBetaCoef: 40,
        kDen: 4000,
        connDir: "left",
        coords: { pn: "35958.860", pe: "6010.070", tn: "", te: "" },
        coordsPrompt: "pending"
      }
    };
  }

  function makeDefaultState() {
    var pages = {
      traverse: [blankPage("traverse", 0)],
      leveling: [blankPage("leveling", 0)],
      angle: [blankPage("angle", 0)],
      traverseSummary: [blankPage("traverseSummary", 0)],
      levelingSummary: [blankPage("levelingSummary", 0)],
      trigSummary: [blankPage("trigSummary", 0)],
      traverseCalc: [blankPage("traverseCalc", 0)]
    };
    var pageIndex = {};
    var zoom = {};
    var scale = {};
    var scaleBase = {};
    TABLE_KEYS.forEach(function (key) {
      pageIndex[key] = 0;
      zoom[key] = defaultZoom(key);
      scale[key] = SCALE_DEFAULT;
      scaleBase[key] = SCALE_BASE_DEFAULTS[key];
    });
    return {
      version: VERSION,
      settings: defaultSettings(),
      pages: pages,
      ui: {
        active: "traverse",
        pageIndex: pageIndex,
        zoom: zoom,
        scale: scale,
        scaleBase: scaleBase,
        paperLayout: PAPER_LAYOUT,
        scaleRevision: SCALE_REVISION
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 规范化 / 导入校验
   * ------------------------------------------------------------------ */

  function normalizeDmsParts(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return { d: str(raw.d), m: str(raw.m), s: str(raw.s) };
  }

  function normalizeTarget(raw, index) {
    raw = raw && typeof raw === "object" ? raw : {};
    var readings = raw.readings && typeof raw.readings === "object" ? raw.readings : {};
    function normalizeReading(face) {
      var row = readings[face] && typeof readings[face] === "object" ? readings[face] : {};
      return {
        h: normalizeDmsParts(row.h),
        v: normalizeDmsParts(row.v),
        s: str(row.s)
      };
    }
    return {
      id: String(index + 1),
      name: str(raw.name),
      prismHeight: str(raw.prismHeight),
      readings: { L: normalizeReading("L"), R: normalizeReading("R") }
    };
  }

  function normalizeTraverseStation(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var targetsRaw = Array.isArray(raw.targets) ? raw.targets : [];
    var station = blankTraverseStation();
    station.name = str(raw.name);
    station.instrumentHeight = str(raw.instrumentHeight);
    station.targets = [normalizeTarget(targetsRaw[0], 0), normalizeTarget(targetsRaw[1], 1)];
    return station;
  }

  function normalizeK(value, fallback) {
    var n = Number(value);
    if (n === 4687 || n === 4.687) return "4687";
    if (n === 4787 || n === 4.787) return "4787";
    return fallback;
  }

  function normalizeLevelingStation(raw, pageIndex, stationIndex) {
    raw = raw && typeof raw === "object" ? raw : {};
    var fallback = defaultK(pageIndex, stationIndex);
    function staff(value) {
      value = value && typeof value === "object" ? value : {};
      // 老项目存的是 mm 整数（1170），这里统一换成米（1.170），存回去也是米。
      return {
        lower: staffMeters(str(value.lower)),
        upper: staffMeters(str(value.upper)),
        black: staffMeters(str(value.black)),
        red: staffMeters(str(value.red))
      };
    }
    var dirs = Array.isArray(raw.dirs) ? raw.dirs : [];
    return {
      stationNo: str(raw.stationNo),
      observer: str(raw.observer),
      back: staff(raw.back),
      front: staff(raw.front),
      dirs: [str(dirs[0]), str(dirs[1]), str(dirs[2])],
      wide: str(raw.wide),
      kBack: normalizeK(raw.kBack, fallback.kBack),
      kFront: normalizeK(raw.kFront, fallback.kFront)
    };
  }

  function normalizeAngleStation(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var rowsRaw = Array.isArray(raw.rows) ? raw.rows : [];
    var rows = [];
    for (var i = 0; i < 4; i += 1) {
      var row = rowsRaw[i] && typeof rowsRaw[i] === "object" ? rowsRaw[i] : {};
      rows.push({
        target: str(row.target),
        reading: normalizeDmsParts(row.reading),
        distance: str(row.distance)
      });
    }
    return { station: str(raw.station), rows: rows };
  }

  function normalizeCalcRow(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      id: str(raw.id),
      ang: str(raw.ang),
      len: str(raw.len),
      h: str(raw.h),
      x: str(raw.x),
      y: str(raw.y),
      az: str(raw.az)
    };
  }

  function normalizePage(key, raw, pageIndex, strict) {
    raw = raw && typeof raw === "object" ? raw : {};
    var cfg = TABLES[key];
    var page = blankPage(key, pageIndex);
    var metaRaw = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
    cfg.metaKeys.forEach(function (k) {
      page.meta[k] = str(metaRaw[k]);
    });
    if (key === "traverseCalc") {
      // 第 1 页永远是开始页；其余页只有显式写了 role:"cont" 才是续页。
      // 旧项目/旧单表文件没有 role，全部按开始页载入，数据不动。
      page.role = pageIndex > 0 && raw.role === "cont" ? "cont" : "start";
      // 新页读 source；旧版（一页一个组员）的 member 只迁带入计数，
      // 姓名与项目 id 不再保留——来源现在固定是当前项目。
      var sourceRaw = raw.source && typeof raw.source === "object"
        ? raw.source
        : (raw.member && typeof raw.member === "object" ? raw.member : {});
      page.source.capturedAt = str(sourceRaw.capturedAt);
      var countRaw = Number(sourceRaw.sourceCount);
      page.source.sourceCount = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 0;
      var overflowRaw = Number(sourceRaw.overflow);
      page.source.overflow = Number.isFinite(overflowRaw) && overflowRaw > 0 ? Math.floor(overflowRaw) : 0;
      var heightRaw = Number(sourceRaw.heightCount);
      page.source.heightCount = Number.isFinite(heightRaw) && heightRaw > 0 ? Math.floor(heightRaw) : 0;
      var calcRows = Array.isArray(raw.rows) ? raw.rows : [];
      if (calcRows.length > TCALC.ROWS && strict) {
        throw new Error(cfg.short + "每页固定 " + TCALC.ROWS + " 行，导入数据中有 " + calcRows.length + " 行。");
      }
      for (var cr = 0; cr < TCALC.ROWS; cr += 1) {
        page.rows[cr] = normalizeCalcRow(calcRows[cr]);
      }
      return page;
    }
    if (key === "traverseSummary") return page;
    if (key === "trigSummary") {
      page.remark = str(raw.remark);
      return page;
    }
    if (key === "levelingSummary") {
      var namesRaw = Array.isArray(raw.names) ? raw.names : [];
      if (namesRaw.length > SC.LEVELING_ROWS && strict) {
        throw new Error(cfg.short + "每页最多 " + SC.LEVELING_ROWS + " 人，导入数据中有 " + namesRaw.length + " 个姓名。");
      }
      for (var n = 0; n < SC.LEVELING_ROWS; n += 1) {
        page.names[n] = str(namesRaw[n]);
      }
      return page;
    }
    if (key === "leveling") {
      page.remark = str(raw.remark);
      // 越界或残缺的归属当作没设置，不阻断导入；重新归属即可。
      page.owner = SC.normalizeOwner(raw.owner);
    }

    var stationsRaw = Array.isArray(raw.stations) ? raw.stations : [];
    if (stationsRaw.length > cfg.capacity) {
      if (strict) throw new Error(cfg.short + "的一页最多 " + cfg.capacity + " 个测站，导入数据中有 " + stationsRaw.length + " 个。");
      stationsRaw = stationsRaw.slice(0, cfg.capacity);
    }
    for (var i = 0; i < cfg.capacity; i += 1) {
      var one = stationsRaw[i];
      if (!one || typeof one !== "object") continue;
      if (key === "traverse") {
        var targets = Array.isArray(one.targets) ? one.targets : [];
        if (targets.length > 2) {
          if (strict) throw new Error(cfg.short + "每站最多两个目标，导入数据不符合。");
        }
        page.stations[i] = normalizeTraverseStation(one);
      } else if (key === "leveling") {
        page.stations[i] = normalizeLevelingStation(one, pageIndex, i);
      } else {
        var rows = Array.isArray(one.rows) ? one.rows : [];
        if (rows.length > 4) {
          if (strict) throw new Error(cfg.short + "每站最多四行，导入数据不符合。");
        }
        page.stations[i] = normalizeAngleStation(one);
      }
    }
    return page;
  }

  // 旧表六/表四的 P 都有课程默认值，不能拿「pn/pe 有没有值」判断新旧；
  // 只有 T 的北/东能区分「那一处自己填过」与「别处的旧默认值」。
  function coordsHaveT(coords) {
    return !!(coords && typeof coords === "object" &&
      (str(coords.tn).trim() !== "" || str(coords.te).trim() !== ""));
  }

  function numberSetting(value, fallback, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) return fallback;
    return n;
  }

  function normalizeSettings(raw) {
    var out = defaultSettings();
    if (!raw || typeof raw !== "object") return out;
    var t = raw.traverse && typeof raw.traverse === "object" ? raw.traverse : {};
    var l = raw.leveling && typeof raw.leveling === "object" ? raw.leveling : {};
    var a = raw.angle && typeof raw.angle === "object" ? raw.angle : {};
    out.traverse.mode = t.mode === "ZA" ? "ZA" : "VA";
    out.traverse.c2Limit = numberSetting(t.c2Limit, 12, 0, 36000);
    out.traverse.indexLimit = numberSetting(t.indexLimit, 25, 0, 36000);
    out.traverse.halfDiffLimit = numberSetting(t.halfDiffLimit, 20, 0, 36000);
    out.leveling.grade = l.grade === "III" ? "III" : "IV";
    out.angle.limit = numberSetting(a.limit, 20, 0, 36000);
    // 老项目没有 limitsRev：仍是旧内置默认值的限差换成本课程口径，
    // 用户改过的值原样保留。新项目带 limitsRev，不再迁移。
    if (!(Number(raw.limitsRev) >= LIMITS_REV)) {
      if (Number(t.c2Limit) === 60) out.traverse.c2Limit = 12;
      if (Number(t.indexLimit) === 60) out.traverse.indexLimit = 25;
      if (Number(a.limit) === 40) out.angle.limit = 20;
    }
    out.limitsRev = LIMITS_REV;
    // 新版表三与表一、表二统一 HarmonyOS Sans SC；旧数据里的 song 也在载入时收敛。
    out.angle.font = "harmony";
    var ls = raw.levelingSummary && typeof raw.levelingSummary === "object" ? raw.levelingSummary : {};
    out.levelingSummary.legPages = SC.normalizeLegPages(ls.legPages);
    var ts = raw.trigSummary && typeof raw.trigSummary === "object" ? raw.trigSummary : {};
    // 老项目没有 sideFormula / sideLinear：保持原来的 60√D 口径。
    out.trigSummary.sideFormula = ts.sideFormula === "linear" ? "linear" : "sqrt";
    out.trigSummary.sideLimit = numberSetting(ts.sideLimit, 60, 1, 10000);
    out.trigSummary.sideLinear = numberSetting(ts.sideLinear, 0.4, 0.001, 1000);
    out.trigSummary.closureLimit = numberSetting(ts.closureLimit, 40, 1, 10000);
    // 老项目没有 closed 键：保持原来的闭合回起点口径。
    out.trigSummary.closed = ts.closed !== false;
    // 起算坐标属于表G。沿革：最早误放在表四，后来搬到表六，本版搬到表G。
    // 新位置 gc.coords 一旦存在就权威；否则按「表六有 T → 表四有 T → 任意」
    // 的顺序迁移，P 缺省补课程固定值。
    var trs = raw.traverseSummary && typeof raw.traverseSummary === "object" ? raw.traverseSummary : {};
    var gc = raw.traverseCalc && typeof raw.traverseCalc === "object" ? raw.traverseCalc : {};
    var gcCoords = gc.coords && typeof gc.coords === "object" ? gc.coords : null;
    var tsCoords = ts.coords && typeof ts.coords === "object" ? ts.coords : null;
    var trsCoords = trs.coords && typeof trs.coords === "object" ? trs.coords : null;
    // 旧表六/表四默认都带着 P 的两项默认值，只有 T 真正填过才算「那一处填过」。
    var coordRaw = gcCoords || (coordsHaveT(tsCoords) ? tsCoords
      : (coordsHaveT(trsCoords) ? trsCoords : (tsCoords || trsCoords || {})));
    out.traverseCalc.coords = {
      pn: coordRaw.pn == null ? out.traverseCalc.coords.pn : str(coordRaw.pn),
      pe: coordRaw.pe == null ? out.traverseCalc.coords.pe : str(coordRaw.pe),
      tn: coordRaw.tn == null ? "" : str(coordRaw.tn),
      te: coordRaw.te == null ? "" : str(coordRaw.te)
    };
    var coordPrompt = gc.coordsPrompt != null ? gc.coordsPrompt
      : (ts.coordsPrompt != null ? ts.coordsPrompt : trs.coordsPrompt);
    out.traverseCalc.coordsPrompt = coordPrompt === "dismissed"
      ? "dismissed"
      : (coordPrompt === "filled" ? "filled" : "pending");
    // 三态：true = 逐页归属；"blocks" = 强制按页块（要在刷新后仍压住已有的归属标签）；false = 未决定。
    out.levelingSummary.ownerMode = ls.ownerMode === true ? true : (ls.ownerMode === "blocks" ? "blocks" : false);
    out.traverseCalc.angleDir = gc.angleDir === "cw" ? "cw" : "ccw";
    out.traverseCalc.fBetaCoef = numberSetting(gc.fBetaCoef, 40, 1, 1000);
    out.traverseCalc.kDen = numberSetting(gc.kDen, 4000, 100, 1000000);
    out.traverseCalc.connDir = gc.connDir === "right" ? "right" : "left";
    return out;
  }

  function normalizeState(raw, options) {
    options = options || {};
    var strict = !!options.strict;
    if (raw && raw.data && typeof raw.data === "object" && !raw.pages) raw = raw.data;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("这不是可识别的记录 JSON。");
    }
    if (Number(raw.version) !== VERSION) {
      throw new Error("JSON 版本不支持（需要 version: 1）。");
    }
    var out = makeDefaultState();
    out.settings = normalizeSettings(raw.settings);

    var pagesRaw = raw.pages && typeof raw.pages === "object" ? raw.pages : {};
    TABLE_KEYS.forEach(function (key) {
      var summary = isSummaryKey(key);
      var arr = pagesRaw[key];
      if (!Array.isArray(arr) || arr.length === 0) {
        // 旧 v1 文件（以及旧「正式版」导出的三表文件）没有表四/表五；
        // 汇总页缺失时补一张空白页。表G 是后加的第七张表，旧项目同样
        // 没有它，载入时补空页即可，strict 也不报错。
        if (strict && !summary && !isCalcKey(key)) throw new Error("缺少" + TABLES[key].short + "的页面数据。");
        arr = [blankPage(key, 0)];
      }
      if (summary) {
        if (!summaryAllowsPages(key) && arr.length > 1) {
          if (strict) throw new Error(TABLES[key].short + "是自动汇总页，只能有一页，导入数据中有 " + arr.length + " 页。");
          arr = arr.slice(0, 1);
        } else if (arr.length > MAX_PAGES) {
          if (strict) throw new Error(TABLES[key].short + "超过 " + MAX_PAGES + " 页，无法导入。");
          arr = arr.slice(0, MAX_PAGES);
        }
      } else if (arr.length > MAX_PAGES) {
        if (strict) throw new Error(TABLES[key].short + "超过 " + MAX_PAGES + " 页，无法导入。");
        arr = arr.slice(0, MAX_PAGES);
      }
      out.pages[key] = arr.map(function (page, index) {
        return normalizePage(key, page, index, strict);
      });
    });

    var ui = raw.ui && typeof raw.ui === "object" ? raw.ui : {};
    out.ui.active = TABLES[ui.active] ? ui.active : "traverse";
    // 旧版 A4 纸框记录首次载入时切到原生整表，并使用新的 100% 基准。
    var hasPaperLayout = Number(ui.paperLayout) >= PAPER_LAYOUT;
    // 旧记录没有 scaleBase：从项目库载入时使用目视校准值（110 / 250 / 200），
    // 导入外部 JSON 时则把它原来的大小固化为基准，避免改变文件里的显示。
    var hasScaleRevision = Number(ui.scaleRevision) >= SCALE_REVISION;
    var applyDefaultBase = !!options.resetScale && !hasScaleRevision;
    var baseRaw = ui.scaleBase && typeof ui.scaleBase === "object" ? ui.scaleBase : {};
    TABLE_KEYS.forEach(function (key) {
      var pageIndex = Number(ui.pageIndex && ui.pageIndex[key]);
      if (!Number.isFinite(pageIndex)) pageIndex = 0;
      pageIndex = Math.floor(pageIndex);
      if (pageIndex < 0 || pageIndex >= out.pages[key].length) pageIndex = 0;
      out.ui.pageIndex[key] = pageIndex;
      if (!hasPaperLayout) {
        out.ui.zoom[key] = defaultZoom(key);
        out.ui.scale[key] = SCALE_DEFAULT;
        out.ui.scaleBase[key] = SCALE_BASE_DEFAULTS[key];
      } else {
        var zoom = ui.zoom && ui.zoom[key];
        out.ui.zoom[key] = zoom === "page" || zoom === "width" ? zoom : defaultZoom(key);
        if (hasScaleRevision) {
          out.ui.scaleBase[key] = normalizeBaseScale(baseRaw[key]);
          out.ui.scale[key] = normalizeScale(ui.scale && ui.scale[key]);
        } else if (applyDefaultBase) {
          out.ui.scaleBase[key] = SCALE_BASE_DEFAULTS[key];
          out.ui.scale[key] = SCALE_DEFAULT;
        } else {
          out.ui.scaleBase[key] = normalizeBaseScale(ui.scale && ui.scale[key]);
          out.ui.scale[key] = SCALE_DEFAULT;
        }
      }
    });
    out.ui.paperLayout = PAPER_LAYOUT;
    out.ui.scaleRevision = SCALE_REVISION;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 本地保存
   * ------------------------------------------------------------------ */

  function setSaveStatus(text, isError) {
    if (!dom.saveStatus || !dom.saveText) return;
    dom.saveText.textContent = text;
    dom.saveStatus.classList.toggle("is-error", !!isError);
  }

  function saveInfo() {
    return STORE && typeof STORE.getSaveInfo === "function" ? STORE.getSaveInfo() : null;
  }

  function nativeMode() {
    var info = saveInfo();
    return !!(info && info.mode === "native");
  }

  function memoryMode() {
    var info = saveInfo();
    return !!(info && info.mode === "memory");
  }

  function saveNow(quiet) {
    if (!state) return;
    if (memoryMode()) {
      storageOk = false;
      setSaveStatus("本机存储不可用（请导出 JSON 备份）", true);
      return;
    }
    try {
      STORE.saveActiveState(state);
      storageOk = true;
      lastSavedAt = new Date();
      if (nativeMode()) {
        if (!quiet) setSaveStatus("保存中…", false);
        return;
      }
      if (!quiet) setSaveStatus("已自动保存 " + hhmmss(lastSavedAt), false);
    } catch (err) {
      storageOk = false;
      setSaveStatus("项目库保存失败（请导出 JSON 备份）", true);
      if (!quiet) toast("项目库保存失败，记录仍在本页内存中；请用「导出」备份 JSON。", "error");
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow(false);
    }, 380);
  }

  function flushSave() {
    flushLinkageSync();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveNow(false);
    var infoPromise = STORE && typeof STORE.flushWrites === "function"
      ? STORE.flushWrites()
      : Promise.resolve(saveInfo());
    var P = window.JujinPlatform;
    var platformPromise = P && typeof P.flush === "function"
      ? Promise.resolve(P.flush()).catch(function () { return null; })
      : Promise.resolve(null);
    return Promise.all([infoPromise, platformPromise]).then(function (results) {
      return results[0];
    });
  }

  function bindSaveStatus() {
    if (!STORE || typeof STORE.onSaveStatus !== "function") return;
    STORE.onSaveStatus(function (info) {
      if (!info || info.mode !== "native") return;
      storageOk = !info.lastError;
      if (info.lastError) {
        setSaveStatus("项目库保存失败（请导出 JSON 备份）", true);
        var now = Date.now();
        if (now - saveErrorToastAt > 8000) {
          saveErrorToastAt = now;
          toast("项目库写入本机失败，记录仍在本页内存中；请用「导出」备份 JSON。", "error");
        }
        return;
      }
      if (info.pending > 0) {
        setSaveStatus("保存中…", false);
        return;
      }
      if (info.lastSavedAt) {
        var suffix = "";
        if (info.lastBackupError) suffix = " · 备份未写入";
        else if (info.lastSaveHadBackup) suffix = " · 已备份";
        setSaveStatus("已自动保存 " + hhmmss(info.lastSavedAt) + suffix, false);
      }
    });
  }

  function uiOfState(raw) {
    if (raw && raw.data && typeof raw.data === "object" && !raw.pages) raw = raw.data;
    return raw && raw.ui && typeof raw.ui === "object" ? raw.ui : null;
  }

  function projectNeedsScaleRevision(project) {
    var ui = uiOfState(project && project.state);
    return !(ui && Number(ui.scaleRevision) >= SCALE_REVISION);
  }

  function loadInitialState(options) {
    var boot = STORE.boot(makeDefaultState, options || {});
    var project = STORE.getActiveProject();
    var raw = project && project.state ? project.state : makeDefaultState();
    var rawUi = uiOfState(raw) || {};
    var scaleRevisionMissing = !(Number(rawUi.scaleRevision) >= SCALE_REVISION);
    try {
      return {
        state: normalizeState(raw, { strict: false, resetScale: true }),
        loaded: boot.loaded,
        storageOk: boot.storageOk,
        corrupt: boot.corrupt,
        migrated: boot.migrated,
        mode: boot.mode,
        scaleRevisionMissing: scaleRevisionMissing,
        projectName: project ? project.name : "默认项目"
      };
    } catch (err) {
      if (boot.mode === "local") {
        try {
          localStorage.setItem(
            STORE.KEY + ".corrupt-state-" + Date.now(),
            JSON.stringify(STORE.exportAll())
          );
        } catch (backupError) { /* 备份失败时仍继续开空白表 */ }
      }
      return {
        state: makeDefaultState(),
        loaded: false,
        storageOk: boot.storageOk,
        corrupt: true,
        migrated: boot.migrated,
        mode: boot.mode,
        scaleRevisionMissing: false,
        projectName: project ? project.name : "默认项目",
        error: err && err.message ? err.message : "无法解析"
      };
    }
  }

  /* ------------------------------------------------------------------ *
   * 桌面存储 / 原生对话框
   * ------------------------------------------------------------------ */

  function readLegacyLocalText() {
    try {
      return window.localStorage ? window.localStorage.getItem(STORE.KEY) : null;
    } catch (err) {
      return null;
    }
  }

  function initStorage() {
    var P = window.JujinPlatform;
    var meta = {
      desktop: false,
      error: null,
      corrupt: false,
      futureVersion: null,
      migratedLocal: false,
      load: null
    };
    if (!P || typeof P.isDesktop !== "function" || !P.isDesktop()) {
      return Promise.resolve({ options: { mode: "local" }, meta: meta });
    }
    meta.desktop = true;
    if (typeof P.nativeReady === "function" && !P.nativeReady()) {
      meta.error = "桌面存储接口未就绪";
      return Promise.resolve({ options: { mode: "memory" }, meta: meta });
    }

    return P.loadStore().then(function (loaded) {
      meta.load = loaded;
      if (loaded && loaded.storePath) {
        storagePaths = {
          appDataDir: loaded.appDataDir || "",
          storePath: loaded.storePath,
          backupDir: loaded.backupDir || ""
        };
      }
      if (loaded && loaded.futureVersion) {
        meta.futureVersion = loaded.futureVersion;
        return { options: { mode: "memory" }, meta: meta };
      }

      var text = loaded && typeof loaded.text === "string" ? loaded.text : null;
      if (!text) {
        var legacy = readLegacyLocalText();
        if (legacy) {
          text = legacy;
          meta.migratedLocal = true;
        }
      }
      if (loaded && loaded.corrupt) meta.corrupt = true;
      return {
        options: {
          mode: "native",
          text: text,
          corrupt: !!meta.corrupt,
          write: function (json) { return P.saveStore(json); }
        },
        meta: meta
      };
    }).catch(function (err) {
      meta.error = errorText(err);
      if (typeof P.getPaths === "function") {
        P.getPaths().then(function (paths) {
          if (!paths) return;
          storagePaths = {
            appDataDir: paths.appDataDir || "",
            storePath: paths.storePath || "",
            backupDir: paths.backupDir || ""
          };
        }).catch(function () { /* 路径读不到时只是不显示 */ });
      }
      return { options: { mode: "memory" }, meta: meta };
    });
  }

  function noteDestructive(reason) {
    var P = window.JujinPlatform;
    if (!P || typeof P.isDesktop !== "function" || !P.isDesktop()) return;
    if (memoryMode() || typeof P.backupStore !== "function") return;
    flushSave();
    P.backupStore(reason).then(function () {
      /* 备份成功时由保存状态自然显示；这里不抢状态栏。 */
    }, function (err) {
      toast("操作前备份失败：" + errorText(err) + "；本次操作仍会继续。", "error");
    });
  }

  function handleCloseRequest() {
    if (closeHandling) return;
    var P = window.JujinPlatform;
    if (!P || typeof P.isDesktop !== "function" || !P.isDesktop()) return;

    if (memoryMode()) {
      closeHandling = true;
      confirmDialog(
        "本机存储不可用",
        "当前改动只在本页内存中，关闭窗口会丢失本次改动。\n建议先「导出」备份 JSON。仍要关闭吗？",
        { confirmLabel: "仍要关闭", danger: true }
      ).then(function (ok) {
        if (ok) {
          Promise.resolve(P.confirmClose()).then(function () {
            closeHandling = false;
          }, function (err) {
            closeHandling = false;
            P.cancelClose();
            toast("关闭窗口失败：" + errorText(err), "error");
          });
        } else {
          closeHandling = false;
          P.cancelClose();
        }
      });
      return;
    }

    closeHandling = true;
    flushSave().then(function (info) {
      if (info && info.lastError) {
        closeHandling = false;
        P.cancelClose();
        setSaveStatus("保存失败，窗口未关闭（请导出 JSON 备份）", true);
        toast("保存失败，已取消关闭；请先「导出」备份 JSON，再关闭。", "error");
        return;
      }
      Promise.resolve(P.confirmClose()).then(function () {
        closeHandling = false;
      }, function (err) {
        closeHandling = false;
        P.cancelClose();
        setSaveStatus("关闭窗口失败：" + errorText(err), true);
        toast("关闭窗口失败：" + errorText(err), "error");
      });
    }, function (err) {
      closeHandling = false;
      P.cancelClose();
      setSaveStatus("关闭前保存失败（请导出 JSON 备份）", true);
      toast("关闭前保存失败：" + errorText(err), "error");
    });
  }

  function openBackupDirectory() {
    var P = window.JujinPlatform;
    if (!P || typeof P.openBackupDir !== "function" ||
        typeof P.isDesktop !== "function" || !P.isDesktop()) {
      toast("浏览器版没有本机备份目录；请用「导出 JSON」备份。", "error");
      return;
    }
    P.openBackupDir().then(function (dir) {
      toast("已打开备份目录" + (dir ? "：" + dir : "。"), "ok");
    }, function (err) {
      toast("打开备份目录失败：" + errorText(err), "error");
    });
  }

  function requestImport() {
    var P = window.JujinPlatform;
    if (P && typeof P.isDesktop === "function" && P.isDesktop()) {
      P.importJson().then(function (result) {
        if (!result) return;
        importText(result.text, {
          name: result.name,
          size: result.size,
          path: result.path
        });
      }).catch(function (err) {
        toast("导入失败：" + errorText(err), "error");
      });
      return;
    }
    if (dom.importFile) dom.importFile.click();
  }

  /* ------------------------------------------------------------------ *
   * geometry / 输入规格
   * ------------------------------------------------------------------ */

  function geometryFor(key, cellId) {
    var cell = CELLS[key][cellId];
    if (!cell) return null;
    var inset = key === "angle" && cell.role !== "meta" ? 2.2 : 0;
    return {
      x: cell.x + inset,
      y: cell.y + inset,
      w: cell.w - inset * 2,
      h: cell.h - inset * 2
    };
  }

  function levelingStationCellId(stationIndex) {
    return stationIndex === 0 ? "extra-s1-station" : "s" + (stationIndex + 1) + "-station-no";
  }

  function stationLabel(key, page, stationIndex) {
    var label = "第" + (stationIndex + 1) + "站";
    var station = page.stations[stationIndex];
    if (key === "leveling" && station && hasData(station.stationNo)) {
      label += " · " + str(station.stationNo).trim();
    }
    if (key === "angle" && station && hasData(station.station)) {
      label += " · " + str(station.station).trim();
    }
    return label;
  }

  function makeSimpleSpec(key, cellId, opts) {
    opts = opts || {};
    var kind = opts.kind || "text";
    var spec = {
      cellId: cellId,
      kind: kind,
      font: opts.font == null ? 20 : opts.font,
      align: opts.align || "center",
      placeholder: opts.placeholder || "",
      maxlength: opts.maxlength == null ? 40 : opts.maxlength,
      inputmode: opts.inputmode || "text",
      plain: !!opts.plain,
      meta: !!opts.meta,
      readOnly: !!opts.readOnly,
      wrap: !!opts.wrap,
      maxDigits: opts.maxDigits || 0,
      padDigits: opts.padDigits || 0,
      // 小数格是否接受前导负号（负高程、负坐标）；默认不收，边长等必须为正。
      signed: !!opts.signed,
      box: opts.box || null,
      aria: opts.aria || "",
      selectAll: opts.selectAll != null ? !!opts.selectAll :
        (kind !== "text" && kind !== "textarea"),
      getValue: opts.getValue || function () { return ""; },
      setValue: opts.setValue || function () {},
      printText: opts.printText || function () { return str(spec.getValue()); }
    };
    // 尺读数两种写法都收（1170 / 1.170），触屏键盘也要给小数点。
    if (kind === "decimal" || kind === "staff" || kind === "packed") spec.inputmode = "decimal";
    if (kind === "digits") spec.inputmode = "numeric";
    // 文本格放不下时有两套对策：单行格（表头、表一测站/目标、表五姓名……）
    // 按宽度缩字；高位格（表二测站编号、表三测站）改用会换行的格，不缩字。
    spec.fit = opts.fit != null ? !!opts.fit : (kind === "text" && !spec.wrap);
    return spec;
  }

  function makeDmsSpec(key, cellId, parts, opts) {
    opts = opts || {};
    return {
      cellId: cellId,
      kind: "dms",
      font: opts.font == null ? 21.5 : opts.font,
      align: "center",
      placeholder: "",
      allowMinus: !!opts.allowMinus,
      readOnly: !!opts.readOnly,
      aria: opts.aria || "",
      parts: parts,
      selectAll: true,
      printText: function () { return formatDmsParts(parts); }
    };
  }

  function metaSpecs(key, page, options) {
    var cfg = TABLES[key];
    var skip = (options && options.skip) || [];
    var out = [];
    cfg.metaKeys.forEach(function (metaKey) {
      if (skip.indexOf(metaKey) !== -1) return;
      var cellId = "meta-" + metaKey;
      if (!CELLS[key][cellId]) return;
      var digits = cfg.metaDigits[metaKey] || 0;
      // 表二的「日期」格只有 116 单位宽；22 号字放不下
      // 「2026-10-25」（实测会横向滚动并在打印时截断），单格降一档。
      var font;
      if (key === "traverse") font = digits ? 19.7 : 23;
      else if (key === "leveling") font = metaKey === "date" ? 19.5 : 22;
      else if (key === "traverseSummary") font = 21.5;
      else if (key === "levelingSummary") font = 22;
      else if (key === "trigSummary") font = metaKey === "start-elev" ? 20 : 21.5;
      else if (key === "traverseCalc") font = 21;
      else font = 21;
      // 表六的起点高程要带小数点，触屏键盘给数字+小数点；其余表头仍是文本。
      var decimal = key === "trigSummary" && metaKey === "start-elev";
      // 表一的年份格紧接印刷的「20」；居中会把「26」推成「20 26」。
      // 年份左对齐后，读起来才是连续的「2026 年」。
      var align = key === "traverse" && digits && metaKey !== "year" ? "center" : "left";
      out.push(makeSimpleSpec(key, cellId, {
        kind: digits ? "digits" : (decimal ? "decimal" : "text"),
        // 起点高程可以是负值（低于基准面），其余表头仍是文本/整数。
        signed: decimal,
        font: font,
        align: align,
        maxlength: digits ? 2 : 40,
        inputmode: digits ? "numeric" : (decimal ? "decimal" : "text"),
        maxDigits: digits,
        padDigits: digits,
        selectAll: !!digits,
        meta: true,
        plain: true,
        aria: cfg.metaLabels[metaKey] || metaKey,
        getValue: function () { return page.meta[metaKey] || ""; },
        setValue: function (value) { page.meta[metaKey] = value; },
        printText: function () { return page.meta[metaKey] || ""; }
      }));
    });
    return out;
  }

  function buildTraverseSpecs(page) {
    var specs = { meta: metaSpecs("traverse", page), inputs: [], computed: [] };
    var mode = state.settings.traverse.mode;

    page.stations.forEach(function (station, stationIndex) {
      var sid = "s" + (stationIndex + 1);
      specs.inputs.push(makeSimpleSpec("traverse", sid + "-station", {
        font: 19.5,
        placeholder: "测站",
        maxlength: 20,
        aria: "第" + (stationIndex + 1) + "站 测站名称",
        getValue: function () { return station.name; },
        setValue: function (value) { station.name = value; }
      }));
      specs.inputs.push(makeSimpleSpec("traverse", sid + "-instrument-height", {
        kind: "decimal",
        font: 19.5,
        placeholder: "m",
        maxlength: 12,
        aria: "第" + (stationIndex + 1) + "站 仪器高（米）",
        getValue: function () { return station.instrumentHeight; },
        setValue: function (value) { station.instrumentHeight = value; }
      }));

      station.targets.forEach(function (target, targetIndex) {
        var base = targetIndex === 0 ? 1 : 3;
        var targetName = targetIndex === 0 ? "目标①" : "目标②";
        var targetCell = sid + "-r" + base + "-target";
        var prismCell = sid + "-r" + base + "-prism";
        specs.inputs.push(makeSimpleSpec("traverse", targetCell, {
          font: 19.5,
          placeholder: targetName,
          maxlength: 20,
          aria: "第" + (stationIndex + 1) + "站 " + targetName + "名称",
          getValue: function () { return target.name; },
          setValue: function (value) { target.name = value; }
        }));
        specs.inputs.push(makeSimpleSpec("traverse", prismCell, {
          kind: "decimal",
          font: 19.5,
          placeholder: "m",
          maxlength: 12,
          aria: "第" + (stationIndex + 1) + "站 " + targetName + "棱镜高（米）",
          getValue: function () { return target.prismHeight; },
          setValue: function (value) { target.prismHeight = value; }
        }));

        ["L", "R"].forEach(function (face) {
          var row = base + (face === "R" ? 1 : 0);
          var faceName = face === "L" ? "盘左" : "盘右";
          specs.inputs.push(makeDmsSpec("traverse", sid + "-r" + row + "-h", target.readings[face].h, {
            font: 21.5,
            allowMinus: false,
            aria: "第" + (stationIndex + 1) + "站 " + targetName + " " + faceName + " 水平度盘读数"
          }));
          specs.inputs.push(makeDmsSpec("traverse", sid + "-r" + row + "-v", target.readings[face].v, {
            font: 21.5,
            allowMinus: mode === "VA",
            aria: "第" + (stationIndex + 1) + "站 " + targetName + " " + faceName + " 竖盘读数"
          }));
          specs.inputs.push(makeSimpleSpec("traverse", sid + "-r" + row + "-s", {
            kind: "decimal",
            font: 21,
            placeholder: "m",
            maxlength: 12,
            aria: "第" + (stationIndex + 1) + "站 " + targetName + " " + faceName + " 斜距（米）",
            getValue: function () { return target.readings[face].s; },
            setValue: function (value) { target.readings[face].s = value; }
          }));
        });

        specs.computed.push({
          cellId: sid + "-r" + base + "-c2",
          font: 20,
          title: "2C（盘左水平读数 − 盘右水平读数 ± 180°）",
          getResult: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].c2; },
          format: function (value) { return TC.formatSeconds(value, { showPlus: true }); },
          band: function (result) { return limitRatio(result.value, state.settings.traverse.c2Limit); },
          isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].targetStarted; }
        });
        specs.computed.push({
          cellId: sid + "-r" + base + "-x",
          font: 20,
          title: "指标差 x（秒）",
          getResult: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].indexError; },
          format: function (value) { return TC.formatSeconds(value, { showPlus: true }); },
          band: function (result) { return limitRatio(result.value, state.settings.traverse.indexLimit); },
          isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].targetStarted; }
        });
        specs.computed.push({
          cellId: sid + "-r" + base + "-alpha",
          font: 20,
          title: "竖直角 α（度分秒）",
          getResult: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].alphaMean; },
          format: function (value) { return TC.formatDms(value, { normalize: false, showPlus: true }); },
          note: function (result) { return result && result.state === "partial" ? "单盘" : ""; },
          isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].targetStarted; }
        });
        specs.computed.push({
          cellId: sid + "-r" + base + "-d",
          font: 20,
          title: "水平距离 D（米）",
          getResult: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].horizDist; },
          format: function (value) { return summaryFixed(value, 3); },
          note: function (result, pageRes) {
            var target = pageRes.stations[stationIndex].res.targets[targetIndex];
            return target.alphaMean.state === "partial" || target.sMean.state === "partial" ? "单盘" : "";
          },
          isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].targetStarted; }
        });
        specs.computed.push({
          cellId: sid + "-r" + base + "-hgt",
          font: 20,
          title: "高差（米）= S·sinα + i − v",
          getResult: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].heightDiff; },
          format: function (value) { return summaryFixed(value, 3); },
          note: function (result, pageRes) {
            var target = pageRes.stations[stationIndex].res.targets[targetIndex];
            var bits = [];
            if (target.alphaMean.state === "partial" || target.sMean.state === "partial") bits.push("单盘");
            if (result.assumedI || result.assumedP) bits.push("缺高");
            return bits.join("·");
          },
          isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.targets[targetIndex].targetStarted; }
        });
      });

      specs.computed.push({
        cellId: sid + "-angle-l",
        font: 20,
        title: "盘左半测回水平角值",
        getResult: function (pageRes) { return pageRes.stations[stationIndex].res.angleL; },
        format: function (value) { return TC.formatDms(value, { decimals: 1 }); },
        isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.stationStarted; }
      });
      specs.computed.push({
        cellId: sid + "-angle-avg",
        font: 14.5,
        top: true,
        title: "一测回平均水平角值",
        getResult: function (pageRes) { return pageRes.stations[stationIndex].res.angleMean; },
        format: function (value) { return TC.formatDms(value, { decimals: 1 }); },
        note: function (result) { return result && result.state === "partial" ? "单盘" : ""; },
        isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.stationStarted; }
      });
      specs.computed.push({
        cellId: sid + "-angle-r",
        font: 20,
        title: "盘右半测回水平角值",
        getResult: function (pageRes) { return pageRes.stations[stationIndex].res.angleR; },
        format: function (value) { return TC.formatDms(value, { decimals: 1 }); },
        isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.stationStarted; }
      });
    });

    return specs;
  }

  function buildLevelingSpecs(page) {
    var specs = { meta: metaSpecs("leveling", page), inputs: [], computed: [] };

    page.stations.forEach(function (station, stationIndex) {
      var sid = "s" + (stationIndex + 1);
      if (stationIndex === 0) {
        specs.inputs.push(makeSimpleSpec("leveling", "extra-s1-observer", {
          font: 20,
          placeholder: "观测者",
          maxlength: 20,
          plain: true,
          wrap: true,
          box: { x: 16, y: 352, w: 84, h: 94.89 },
          aria: "第1站 观测者",
          getValue: function () { return station.observer; },
          setValue: function (value) { station.observer = value; }
        }));
        specs.inputs.push(makeSimpleSpec("leveling", "extra-s1-station", {
          font: 22,
          placeholder: "站号",
          maxlength: 8,
          plain: true,
          wrap: true,
          box: { x: 100, y: 352, w: 85, h: 94.89 },
          aria: "第1站 测站编号",
          getValue: function () { return station.stationNo; },
          setValue: function (value) { station.stationNo = value; }
        }));
      } else {
        var stationCell = CELLS.leveling[sid + "-station-no"];
        specs.inputs.push(makeSimpleSpec("leveling", sid + "-station-no", {
          font: 22,
          placeholder: "站号",
          maxlength: 8,
          plain: true,
          wrap: true,
          box: stationCell ? { x: stationCell.x + 2, y: stationCell.y + 2, w: stationCell.w - 4, h: stationCell.h - 4 } : null,
          aria: "第" + (stationIndex + 1) + "站 测站编号",
          getValue: function () { return station.stationNo; },
          setValue: function (value) { station.stationNo = value; }
        }));
      }

      function staffSpec(cellId, side, field, label) {
        specs.inputs.push(makeSimpleSpec("leveling", cellId, {
          kind: "staff",
          font: 20,
          placeholder: "m",
          maxlength: 6,
          maxDigits: 6,
          aria: "第" + (stationIndex + 1) + "站 " + label + "（米，如 1.170）",
          getValue: function () { return station[side][field]; },
          setValue: function (value) { station[side][field] = value; },
          printText: function () {
            return staffMeters(str(station[side][field]));
          }
        }));
      }

      function dirSpec(cellId, dirIndex, label) {
        specs.inputs.push(makeSimpleSpec("leveling", cellId, {
          font: 20,
          placeholder: "方向",
          maxlength: 12,
          aria: "第" + (stationIndex + 1) + "站 " + label,
          getValue: function () { return station.dirs[dirIndex]; },
          setValue: function (value) { station.dirs[dirIndex] = value; }
        }));
      }

      staffSpec(sid + "-r1-back", "back", "lower", "后尺下丝");
      staffSpec(sid + "-r1-front", "front", "lower", "前尺下丝");
      staffSpec(sid + "-r1-black", "back", "black", "后尺黑面读数");
      staffSpec(sid + "-r1-red", "back", "red", "后尺红面读数");

      staffSpec(sid + "-r2-back", "back", "upper", "后尺上丝");
      staffSpec(sid + "-r2-front", "front", "upper", "前尺上丝");
      staffSpec(sid + "-r2-black", "front", "black", "前尺黑面读数");
      staffSpec(sid + "-r2-red", "front", "red", "前尺红面读数");

      // 第 1 站在「方向及尺号」内印有 后/前/后−前 三个字形；
      // 三格保持印刷体，不叠输入框（第 2 站起才需要手填）。
      if (stationIndex > 0) {
        dirSpec(sid + "-r1-dir", 0, "第1行方向/尺号");
        dirSpec(sid + "-r2-dir", 1, "第2行方向/尺号");
        dirSpec(sid + "-r3-dir", 2, "第3行方向/尺号");
      }
      specs.inputs.push(makeSimpleSpec("leveling", sid + "-r4-wide", {
        font: 17,
        align: "left",
        placeholder: "备注/说明",
        maxlength: 200,
        selectAll: false,
        aria: "第" + (stationIndex + 1) + "站 第4行备注",
        getValue: function () { return station.wide; },
        setValue: function (value) { station.wide = value; }
      }));

      function addComputed(cellId, getter, formatter, title, band) {
        specs.computed.push({
          cellId: cellId,
          font: 20,
          realOnly: true,
          title: title,
          getResult: function (pageRes) { return getter(pageRes.stations[stationIndex].res); },
          format: formatter,
          band: band
        });
      }

      // 表二的限差随三等/四等切换，直接从本页计算结果里取。
      function bandWithLimit(limitKey) {
        return function (result, pageRes) {
          var res = pageRes.stations[stationIndex].res;
          return limitRatio(result.value, res.limits[limitKey]);
        };
      }

      addComputed(sid + "-r1-k", function (res) { return res.k1; }, function (v) { return LC.formatMm(v, 0); }, "后尺 K+黑−红（mm）", bandWithLimit("reading"));
      addComputed(sid + "-r2-k", function (res) { return res.k2; }, function (v) { return LC.formatMm(v, 0); }, "前尺 K+黑−红（mm）", bandWithLimit("reading"));
      addComputed(sid + "-r3-back", function (res) { return res.backDist; }, function (v) { return LC.formatMeters(v, 1); }, "后视距（m）", bandWithLimit("sight"));
      addComputed(sid + "-r3-front", function (res) { return res.frontDist; }, function (v) { return LC.formatMeters(v, 1); }, "前视距（m）", bandWithLimit("sight"));
      addComputed(sid + "-r3-black", function (res) { return res.blackDiff; }, function (v) { return LC.formatMm(v, 0); }, "黑面高差（mm）");
      addComputed(sid + "-r3-red", function (res) { return res.redDiff; }, function (v) { return LC.formatMm(v, 0); }, "红面高差（mm）");
      addComputed(sid + "-r3-k", function (res) { return res.k3; }, function (v) { return LC.formatMm(v, 0); }, "K+黑−红（第1行−第2行，mm）", bandWithLimit("height"));
      addComputed(sid + "-r3-mean", function (res) { return res.mean; }, function (v) { return LC.formatMm(v, 1); }, "高差中数（mm）");
      addComputed(sid + "-r4-back", function (res) { return res.d; }, function (v) { return LC.formatMeters(v, 1); }, "前后视距差 d（m）", bandWithLimit("d"));
      addComputed(sid + "-r4-front", function (res) { return res.sumD; }, function (v) { return LC.formatMeters(v, 1); }, "累计视距差 Σd（m）", bandWithLimit("sumD"));
    });

    specs.inputs.push(makeSimpleSpec("leveling", "remark", {
      kind: "textarea",
      font: 16.5,
      align: "left",
      placeholder: "备注",
      maxlength: 2000,
      plain: true,
      selectAll: false,
      aria: "整列备注",
      getValue: function () { return page.remark || ""; },
      setValue: function (value) { page.remark = value; }
    }));

    return specs;
  }

  function buildAngleSpecs(page) {
    var specs = { meta: metaSpecs("angle", page), inputs: [], computed: [] };

    page.stations.forEach(function (station, stationIndex) {
      var sid = "s" + (stationIndex + 1);
      specs.inputs.push(makeSimpleSpec("angle", sid + "-station", {
        font: 22,
        placeholder: "站号",
        maxlength: 8,
        wrap: true,
        aria: "第" + (stationIndex + 1) + "站 测站号",
        getValue: function () { return station.station; },
        setValue: function (value) { station.station = value; }
      }));

      station.rows.forEach(function (row, rowIndex) {
        var rowNumber = rowIndex + 1;
        var placeholder = rowIndex === 0 ? "目标①" : (rowIndex === 1 ? "目标②" : "目标");
        specs.inputs.push(makeSimpleSpec("angle", sid + "-r" + rowNumber + "-target", {
          font: 21,
          placeholder: placeholder,
          maxlength: 20,
          aria: "第" + (stationIndex + 1) + "站 第" + rowNumber + "行目标",
          getValue: function () { return row.target; },
          setValue: function (value) { row.target = value; }
        }));
        specs.inputs.push(makeDmsSpec("angle", sid + "-r" + rowNumber + "-reading", row.reading, {
          font: 22,
          allowMinus: false,
          aria: "第" + (stationIndex + 1) + "站 第" + rowNumber + "行 度盘读数"
        }));
        specs.inputs.push(makeSimpleSpec("angle", sid + "-r" + rowNumber + "-distance", {
          kind: "decimal",
          font: 21,
          placeholder: "m",
          maxlength: 12,
          aria: "第" + (stationIndex + 1) + "站 第" + rowNumber + "行距离（米）",
          getValue: function () { return row.distance; },
          setValue: function (value) { row.distance = value; }
        }));
      });

      function addAngleComputed(cellId, getter, formatter, title, band) {
        specs.computed.push({
          cellId: cellId,
          font: 22,
          title: title,
          getResult: function (pageRes) { return getter(pageRes.stations[stationIndex].res); },
          format: formatter,
          band: band,
          isStarted: function (pageRes) { return pageRes.stations[stationIndex].res.started; }
        });
      }

      addAngleComputed(sid + "-half-left", function (res) { return res.halfLeft; },
        function (v) { return AC.formatDms(v, { decimals: 1 }); }, "左半测回角值");
      addAngleComputed(sid + "-half-right", function (res) { return res.halfRight; },
        function (v) { return AC.formatDms(v, { decimals: 1 }); }, "右半测回角值");
      addAngleComputed(sid + "-halfdiff", function (res) { return res.halfDiff; },
        function (v) { return AC.formatSeconds(v, { decimals: 1 }); }, "半测回角值之差（秒）",
        function (result, pageRes) {
          return limitRatio(result.value, pageRes.stations[stationIndex].res.limit);
        });
      addAngleComputed(sid + "-angle", function (res) { return res.angleMean; },
        function (v) { return AC.formatDms(v, { decimals: 1 }); }, "一测回角值");
    });

    // 联立期间只锁数据格；表头仍可编辑，计算格本来只读。
    if (linkageEnabled()) {
      specs.inputs.forEach(function (spec) { spec.readOnly = true; });
    }

    return specs;
  }

  function summaryFixed(value, digits) {
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    var scale = Math.pow(10, digits);
    var scaled = n * scale;
    // 汇总值来自 mm 整数再除 1000，恰好落在 0.5 个末位上的情况很常见。
    // 先消掉二进制噪声，再按绝对值四舍五入，避免同一列里 -0.0005
    // 有的行显示 -0.000、有的行显示 -0.001。
    var rounded = scaled < 0
      ? -Math.round(-scaled + 1e-9)
      : Math.round(scaled + 1e-9);
    return (rounded / scale).toFixed(digits);
  }

  function summaryInteger(value) {
    var rounded = SC.roundInteger(Number(value));
    return rounded == null ? String(value) : String(rounded);
  }

  function summaryComputed(cellId, font, title, getResult, format, band) {
    return {
      cellId: cellId,
      font: font,
      title: title,
      realOnly: true,
      getResult: getResult,
      format: format,
      band: band,
      note: function (result) { return result && result.note ? result.note : ""; }
    };
  }

  function buildTraverseSummarySpecs(page) {
    var specs = { meta: metaSpecs("traverseSummary", page), inputs: [], computed: [] };
    var i;

    function rowSpec(rowIndex, suffix, font, title, field, format, band) {
      // band 由调用处写在循环里，这里把本排的 rowIndex 传回去，
      // 免得闭包引用循环变量 i（循环结束后 i 已经不是本排）。
      var bandFor = band
        ? function (result, pageRes) { return band(result, pageRes, rowIndex); }
        : null;
      specs.computed.push(summaryComputed("s" + (rowIndex + 1) + "-" + suffix, font, title,
        function (pageRes) {
          var rows = pageRes && pageRes.rows ? pageRes.rows : [];
          return rows[rowIndex] ? rows[rowIndex][field] : null;
        }, format, bandFor));
    }

    function totalSpec(cellId, title, key, format) {
      specs.computed.push(summaryComputed(cellId, 20, title, function (pageRes) {
        return pageRes && pageRes.totals ? pageRes.totals[key] : null;
      }, format));
    }

    for (i = 0; i < SC.TRAVERSE_ROWS; i += 1) {
      rowSpec(i, "id", 20, "点号（取表一测站名）", "id", function (v) { return str(v); });
      rowSpec(i, "angle", 20, "内角 = 360° − 本站观测角（度.分秒）", "angle",
        function (v) { return summaryFixed(v, 4); });
      rowSpec(i, "dist-fwd", 19.5, "平距往测（本站目标②）", "distFwd",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dist-back", 19.5, "平距返测（下一站目标①）", "distBack",
        function (v) { return summaryFixed(v, 3); });
      // 表四没有现成限差，这里按课程口径给误差色：
      //   平距往返相对误差 1/4000 → 允许值（mm）= 平距平均值（m）÷ 4；
      //   对向高差跟随表六「平差口径」里选的公式（60√D、40√D 或 0.4×S）。
      rowSpec(i, "dist-err", 19.5, "平距绝对误差 = |往−返|×1000（mm）", "distErr",
        summaryInteger, function (result, pageRes, rowIndex) {
          var row = pageRes && pageRes.rows ? pageRes.rows[rowIndex] : null;
          var mean = row && row.distMean ? Number(row.distMean.value) : null;
          if (!Number.isFinite(mean) || mean <= 0) return null;
          return limitRatio(result.value, mean / 4);
        });
      rowSpec(i, "dist-mean", 19.5, "平距平均值 = (往+返)/2（m）", "distMean",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dh-fwd", 19.5, "高差往测（本站目标②）", "dhFwd",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dh-back", 19.5, "高差返测（下一站目标①）", "dhBack",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dh-mis", 19.5, "高差闭合差 = (往+返)×1000（mm）", "dhMis",
        summaryInteger, function (result, pageRes, rowIndex) {
          var row = pageRes && pageRes.rows ? pageRes.rows[rowIndex] : null;
          var mean = row && row.distMean ? Number(row.distMean.value) : null;
          if (!Number.isFinite(mean) || mean <= 0) return null;
          var tg = state.settings.trigSummary;
          // 与表六同口径：先取整到 mm 再比，否则同一条边会出现表六「合格」、
          // 表四按未取整允许值算出 1.0016 倍而铺绿底的相反结论。
          var allow = tg.sideFormula === "linear"
            ? tg.sideLinear * mean
            : tg.sideLimit * Math.sqrt(mean / 1000);
          return limitRatio(result.value, SC.roundInteger(allow));
        });
      rowSpec(i, "dh-mean", 19.5, "高差平均值 = (往−返)/2（m）", "dhMean",
        function (v) { return summaryFixed(v, 3); });
    }

    totalSpec("sigma-angle", "内角合计（六十进制）", "angle", function (v) { return summaryFixed(v, 4); });
    totalSpec("sigma-dist-mean", "平距平均值合计（m）", "dist", function (v) { return summaryFixed(v, 3); });
    totalSpec("sigma-dh-mean", "高差平均值合计（m）", "dh", function (v) { return summaryFixed(v, 3); });
    return specs;
  }

  function buildLevelingSummarySpecs(page) {
    var specs = { meta: metaSpecs("levelingSummary", page), inputs: [], computed: [] };
    var i;

    function nameSpec(index) {
      specs.inputs.push(makeSimpleSpec("levelingSummary", "s" + (index + 1) + "-name", {
        font: 21,
        align: "center",
        placeholder: "姓名",
        maxlength: 20,
        aria: "第" + (index + 1) + "人姓名",
        getValue: function () { return page.names[index] || ""; },
        setValue: function (value) { page.names[index] = value; }
      }));
    }

    function cellSpec(rowIndex, section, field, suffix, font, title, format) {
      specs.computed.push(summaryComputed(
        "s" + (rowIndex + 1) + "-" + section + "-" + suffix, font, title,
        function (pageRes) {
          var rows = pageRes && pageRes.rows ? pageRes.rows : [];
          if (!rows[rowIndex]) return null;
          return rows[rowIndex][section][field];
        }, format));
    }

    for (i = 0; i < SC.LEVELING_ROWS; i += 1) {
      nameSpec(i);
      ["s1", "s2"].forEach(function (section) {
        var label = section === "s1" ? "BM1-BM0" : "BM0-1号点";
        cellSpec(i, section, "fwd", "fwd", 20, label + " 往测（m）", function (v) { return summaryFixed(v, 3); });
        cellSpec(i, section, "back", "back", 20, label + " 返测（m）", function (v) { return summaryFixed(v, 3); });
        cellSpec(i, section, "mis", "mis", 20, label + " 闭合差 = (往+返)×1000（mm）", summaryInteger);
        cellSpec(i, section, "mean", "mean", 20, label + " 平均值 = (往−返)/2（m）", function (v) { return summaryFixed(v, 3); });
      });
    }

    function footerSpec(cellId, title, key, format) {
      specs.computed.push(summaryComputed(cellId, 20, title, function (pageRes) {
        return pageRes && pageRes.footer ? pageRes.footer[key] : null;
      }, format));
    }

    footerSpec("sum-avg-s1", "BM1-BM0 各人平均值的算术平均（m）", "avg1", function (v) { return summaryFixed(v, 3); });
    footerSpec("sum-avg-s2", "BM0-1号点 各人平均值的算术平均（m）", "avg2", function (v) { return summaryFixed(v, 3); });
    footerSpec("sum-err-s1", "BM1-BM0 中误差（样本标准差，mm）", "err1", function (v) { return summaryFixed(v, 2); });
    footerSpec("sum-err-s2", "BM0-1号点 中误差（样本标准差，mm）", "err2", function (v) { return summaryFixed(v, 2); });
    return specs;
  }

  // 平距相对误差按 1/N 显示；往返完全一致时写作 1/∞。
  function summaryReciprocal(value) {
    var ratio = Number(value);
    if (!Number.isFinite(ratio)) return "";
    if (ratio <= 0) return "1/∞";
    return "1/" + Math.round(1 / ratio);
  }

  function buildTrigSummarySpecs(page, pageIndex) {
    pageIndex = Math.max(0, Math.floor(Number(pageIndex) || 0));
    var offset = pageIndex * SC.TRIG_ROWS;
    // 第 1 页的起点高程是手填的起算数据；后续页的「起点高程」由上一页
    // 最后一点推算而来，改成计算格，避免同一个表头字段在两页各说各话。
    var specs = {
      meta: metaSpecs("trigSummary", page, pageIndex > 0 ? { skip: ["start-elev"] } : null),
      inputs: [],
      computed: []
    };
    var i;

    if (pageIndex > 0) {
      specs.computed.push({
        cellId: "meta-start-elev",
        font: 20,
        title: "起点高程（接上一页最后一点推算，不可编辑；要改起算高程请到第 1 页）",
        realOnly: true,
        plain: true,
        align: "left",
        getResult: function (pageRes) {
          var rows = pageRes && pageRes.rows ? pageRes.rows : [];
          var prev = rows[offset - 1];
          return prev && prev.elev && prev.elev.value != null ? prev.elev : null;
        },
        format: function (v) { return summaryFixed(v, 3); },
        note: null
      });
    }

    // 备注整列一格：从表头下沿通到表底，避开印刷的「备 注」二字。
    specs.inputs.push(makeSimpleSpec("trigSummary", "remark", {
      kind: "textarea",
      font: 15,
      align: "left",
      maxlength: 600,
      placeholder: "备注",
      box: { x: 1408, y: 257, w: 113.5, h: 1057 },
      aria: "备注（整列合并）",
      getValue: function () { return page.remark || ""; },
      setValue: function (value) { page.remark = value; }
    }));

    function rowSpec(rowIndex, suffix, font, title, field, format, band) {
      var globalIndex = offset + rowIndex;
      var bandFor = band
        ? function (result, pageRes) { return band(result, pageRes, globalIndex); }
        : null;
      specs.computed.push(summaryComputed("s" + (rowIndex + 1) + "-" + suffix, font, title,
        function (pageRes) {
          var rows = pageRes && pageRes.rows ? pageRes.rows : [];
          return rows[globalIndex] ? rows[globalIndex][field] : null;
        }, format, bandFor));
    }

    // Σ 行与精度评定只出现在最后一页有数据的纸上；中间页的 Σ 留空。
    function onLastDataPage(pageRes) {
      return !!pageRes && pageRes.pageIndex === pageRes.lastPage;
    }

    function totalSpec(cellId, title, field, format, band) {
      specs.computed.push(summaryComputed(cellId, 19.5, title, function (pageRes) {
        if (!onLastDataPage(pageRes)) return null;
        return pageRes && pageRes.summary ? pageRes.summary[field] : null;
      }, format, band));
    }

    // 对向高差较差的允许值就在本排；相对误差的允许值固定为往返 1/4000。
    function sideBand(result, pageRes, rowIndex) {
      var row = pageRes && pageRes.rows ? pageRes.rows[rowIndex] : null;
      var allow = row && row.dhAllow ? Number(row.dhAllow.value) : null;
      if (!Number.isFinite(allow) || allow <= 0) return null;
      return limitRatio(result.value, allow);
    }

    function relBand(result) {
      return limitRatio(result.value, 1 / 4000);
    }

    // 闭合差是米，允许值是 mm；只在能够比较（整个环都算全）时上色。
    function closureBand(result, pageRes) {
      var summary = pageRes && pageRes.summary;
      if (!summary || !summary.completeLoop) return null;
      if (!Number.isFinite(summary.closureAllow) || summary.closureAllow <= 0) return null;
      return limitRatio(Number(result.value) * 1000, summary.closureAllow);
    }

    for (i = 0; i < SC.TRIG_ROWS; i += 1) {
      rowSpec(i, "id", 18, "点名（本条边的终点，取下一站站名）", "id", function (v) { return str(v); });
      rowSpec(i, "fwd-dh", 14, "往测高差 = 表一本站目标②（m）", "dhFwd",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "fwd-s", 14, "往测平距 = 表一本站目标②（m）", "distFwd",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "ret-dh", 14, "返测高差 = 表一下一站目标①（m）", "dhBack",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "ret-s", 14, "返测平距 = 表一下一站目标①（m）", "distBack",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dist-mean", 19.5, "平距平均值 = (往+返)/2（m）", "distMean",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dist-rel", 19.5, "相对误差 = |往−返| ÷ 平距平均值，记作 1/N", "distRel",
        summaryReciprocal, relBand);
      rowSpec(i, "dh-mean", 19.5, "高差平均值 = (往−返)/2（m）", "dhMean",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "dh-diff", 19.5, "对向高差较差 = (往+返)×1000（mm）", "dhDiff",
        summaryInteger, sideBand);
      rowSpec(i, "dh-allow", 19.5, state.settings.trigSummary.sideFormula === "linear"
        ? "较差允许值 = K·S（mm，S 为平距、以 m 计；K = 0.4 时即教材的 0.4S mm、S 以 km 计）"
        : "较差允许值 = K·√D（mm，D 以 km 计）", "dhAllow", summaryInteger);
      rowSpec(i, "dh-corr", 19.5, "高差改正值（mm，按平距比例反号分配）", "corr",
        summaryInteger);
      rowSpec(i, "dh-adj", 19.5, "改正后的高差 = 高差平均值 + 改正值/1000（m）", "dhAdj",
        function (v) { return summaryFixed(v, 3); });
      rowSpec(i, "elev", 19.5, "最终高程 = 起点高程 + 逐条改正后高差（m）", "elev",
        function (v) { return summaryFixed(v, 3); });
    }

    totalSpec("sigma-dist-mean", "Σ 平距平均值（m）", "totalDist",
      function (v) { return summaryFixed(v, 3); });
    totalSpec("sigma-dh-mean", "Σ 高差平均值 = 闭合差（m）", "totalDh",
      function (v) { return summaryFixed(v, 3); }, closureBand);
    totalSpec("sigma-corr", "Σ 改正值（mm，= −闭合差）", "totalCorr", summaryInteger);
    totalSpec("sigma-adj", "Σ 改正后高差（m，闭合环应为 0.000）", "totalAdj",
      function (v) { return summaryFixed(v, 3); });

    // 精度评定整行一格；避开印刷的「精度评定:」标签，从它右侧起排。
    specs.computed.push({
      cellId: "eval",
      font: 15.5,
      title: "精度评定（自动生成：闭合差、允许值、是否合格与闭合高程）",
      realOnly: true,
      plain: true,
      align: "left",
      wrap: true,
      box: { x: 150.5, y: 1257, w: 1252.5, h: 57 },
      getResult: function (pageRes) {
        if (!onLastDataPage(pageRes)) return null;
        var text = pageRes && pageRes.summary ? pageRes.summary.evalText : "";
        return text ? { value: text, state: "ok" } : null;
      },
      format: function (v) { return str(v); },
      note: null
    });
    return specs;
  }

  /* 表G 导线计算表：一条导线可跨页。
     开始页首行的点号、角度、边长、高程是手填，x / y / 方位角是起算数据；
     续页首行的 x / y / 方位角改由上一页推算（不读本页存储值）；
     其余各行的中间列全部由 TCALC 推算，落格时把 mm 换回米。 */
  function buildTraverseCalcSpecs(page) {
    var specs = { meta: metaSpecs("traverseCalc", page), inputs: [], computed: [] };
    var clockwise = state.settings.traverseCalc.angleDir === "ccw";
    var i;

    function inputSpec(rowIndex, suffix, opts) {
      var cellId = "s" + (rowIndex + 1) + "-" + suffix;
      specs.inputs.push(makeSimpleSpec("traverseCalc", cellId, {
        kind: opts.kind || "text",
        signed: !!opts.signed,
        font: opts.font,
        placeholder: opts.placeholder || "",
        maxlength: opts.maxlength || 16,
        aria: "第" + (rowIndex + 1) + "行" + (opts.aria || ""),
        getValue: function () { return page.rows[rowIndex][suffix]; },
        setValue: function (value) { page.rows[rowIndex][suffix] = value; }
      }));
    }

    function computedSpec(rowIndex, suffix, font, title, getter, format) {
      specs.computed.push(summaryComputed("s" + (rowIndex + 1) + "-" + suffix, font, title,
        function (pageRes) {
          var calc = pageRes && pageRes.calc;
          if (!calc) return null;
          var value = getter(calc, rowIndex);
          if (value == null || value === "") return null;
          return { value: value, state: "ok" };
        }, format));
    }

    function meters(mm) {
      return summaryFixed(Number(mm) / 1000, 3);
    }

    for (i = 0; i < TCALC.ROWS; i += 1) {
      inputSpec(i, "id", { font: 19, placeholder: "点号", aria: "点号" });
      inputSpec(i, "ang", {
        kind: "packed", font: 20.5, placeholder: "度.分秒", maxlength: 12,
        aria: "内角观测值（度.分秒）"
      });
      inputSpec(i, "len", {
        kind: "decimal", font: 19.5, placeholder: "m", aria: "导线长（米）"
      });
      inputSpec(i, "h", {
        kind: "decimal", signed: true, font: 19.5, placeholder: "m", aria: "高程（米，只记录）"
      });

      computedSpec(i, "ang-adj", 20.5,
        "改正后的内角 = 观测角 + 改正数（度.分秒）；改正数按角数等分反号，计算用原值、显示到整秒",
        function (calc, index) {
          return calc.angles[index] ? calc.angles[index].adjPacked : null;
        }, function (v) { return str(v); });
      computedSpec(i, "dx", 19.5, "坐标增量 Δx = D·cos α（米，取整到 mm）",
        function (calc, index) {
          return calc.dxMm[index] == null ? null : calc.dxMm[index];
        }, meters);
      computedSpec(i, "dy", 19.5, "坐标增量 Δy = D·sin α（米，取整到 mm）",
        function (calc, index) {
          return calc.dyMm[index] == null ? null : calc.dyMm[index];
        }, meters);
      computedSpec(i, "dx-adj", 19.5, "改正后 Δx = Δx − fx·D/ΣD（米；余数给最长边）",
        function (calc, index) {
          return calc.dxAdjMm[index] == null ? null : calc.dxAdjMm[index];
        }, meters);
      computedSpec(i, "dy-adj", 19.5, "改正后 Δy = Δy − fy·D/ΣD（米；余数给最长边）",
        function (calc, index) {
          return calc.dyAdjMm[index] == null ? null : calc.dyAdjMm[index];
        }, meters);

      if (i === 0 && page.role !== "cont") {
        inputSpec(i, "x", {
          kind: "decimal", signed: true, font: 19.5, placeholder: "X", aria: "起算 X 坐标（米）"
        });
        inputSpec(i, "y", {
          kind: "decimal", signed: true, font: 19.5, placeholder: "Y", aria: "起算 Y 坐标（米）"
        });
        inputSpec(i, "az", {
          kind: "packed", font: 19.5, placeholder: "度.分秒", maxlength: 12,
          aria: "起算方位角（度.分秒）"
        });
      } else {
        computedSpec(i, "az", 19.5,
          "推算方位角（" + (clockwise ? "顺时针：α = α前 + 180° − β" : "逆时针：α = α前 + 180° + β") +
          "，规范到 0°～360°）",
          function (calc, index) {
            return calc.az[index] ? calc.az[index].packed : null;
          }, function (v) { return str(v); });
        computedSpec(i, "x", 19.5, "坐标 X = 上一点 X + 改正后 Δx（米）",
          function (calc, index) {
            return calc.xMm[index] == null ? null : calc.xMm[index];
          }, meters);
        computedSpec(i, "y", 19.5, "坐标 Y = 上一点 Y + 改正后 Δy（米）",
          function (calc, index) {
            return calc.yMm[index] == null ? null : calc.yMm[index];
          }, meters);
      }
    }
    return specs;
  }

  function buildSpecs(key, page, pageIndex) {
    if (key === "traverse") return buildTraverseSpecs(page);
    if (key === "leveling") return buildLevelingSpecs(page);
    if (key === "traverseSummary") return buildTraverseSummarySpecs(page);
    if (key === "levelingSummary") return buildLevelingSummarySpecs(page);
    if (key === "trigSummary") return buildTrigSummarySpecs(page, pageIndex);
    if (key === "traverseCalc") return buildTraverseCalcSpecs(page, pageIndex);
    return buildAngleSpecs(page);
  }

  /* ------------------------------------------------------------------ *
   * 数据页判定 / 分析
   * ------------------------------------------------------------------ */

  function stationHasData(key, station) {
    if (!station) return false;
    if (key === "traverse") {
      if (hasData(station.name) || hasData(station.instrumentHeight)) return true;
      return station.targets.some(function (target) {
        if (hasData(target.name) || hasData(target.prismHeight)) return true;
        return ["L", "R"].some(function (face) {
          var reading = target.readings[face];
          return dmsAny(reading.h) || dmsAny(reading.v) || hasData(reading.s);
        });
      });
    }
    if (key === "leveling") {
      if (hasData(station.stationNo) || hasData(station.observer) || hasData(station.wide)) return true;
      if (station.dirs.some(function (dir) { return hasData(dir); })) return true;
      return ["back", "front"].some(function (side) {
        return ["lower", "upper", "black", "red"].some(function (field) {
          return hasData(station[side][field]);
        });
      });
    }
    if (hasData(station.station)) return true;
    return station.rows.some(function (row) {
      return hasData(row.target) || hasData(row.distance) || dmsAny(row.reading);
    });
  }

  function pageHasData(key, page) {
    if (!page) return false;
    if (page.meta && Object.keys(page.meta).some(function (k) { return hasData(page.meta[k]); })) return true;
    if (key === "leveling" && hasData(page.remark)) return true;
    if (key === "traverseCalc") {
      return (page.rows || []).some(function (row) {
        return row && ["id", "ang", "len", "h", "x", "y", "az"].some(function (field) {
          return hasData(row[field]);
        });
      });
    }
    if (isSummaryKey(key)) {
      if (key === "levelingSummary") {
        return (page.names || []).some(function (name) { return hasData(name); });
      }
      // 表六除了表头，整列合一的备注也是手填的。
      if (key === "trigSummary") return hasData(page.remark);
      return false;
    }
    return page.stations.some(function (station) { return stationHasData(key, station); });
  }

  // 表G：数一页里真正录了读数的行。表头（日期、班·组）和只有来源记录不算，
  // 否则只填了表头的空页也会被当成「已有数据」，状态条误报「✓ 已完整」。
  function traverseCalcRowsFilled(page) {
    var filled = 0;
    ((page && page.rows) || []).forEach(function (row) {
      if (row && ["id", "ang", "len", "h", "x", "y", "az"].some(function (field) {
        return hasData(row[field]);
      })) {
        filled += 1;
      }
    });
    return filled;
  }

  // 只数「参与导线计算」的行：点号/角度/边长；开始页首行的 X/Y/方位角算
  // 起算数据。高程只记录，续页首行的三格是计算值，都不算。用于分页标签的
  // 「空白」判断，避免只残留休眠坐标的续页被写成「第 12 站」。
  function traverseCalcRowIsCalcData(row, isCont, isFirst) {
    if (!row) return false;
    if (hasData(row.id) || hasData(row.ang) || hasData(row.len)) return true;
    return !isCont && isFirst &&
      (hasData(row.x) || hasData(row.y) || hasData(row.az));
  }

  // 表G 的一条导线跨页存放：开始页之后连续的续页属于它。
  // 第 1 页永远是开始页，所以向前找 start 一定能停住。
  function calcConductorGroup(index) {
    var list = state.pages.traverseCalc;
    index = clamp(Math.floor(Number(index) || 0), 0, list.length - 1);
    var start = index;
    while (start > 0 && list[start].role === "cont") start -= 1;
    var end = start;
    while (end + 1 < list.length && list[end + 1].role === "cont") end += 1;
    return { start: start, end: end, pages: list.slice(start, end + 1) };
  }

  function calcConductorPages(index) {
    return calcConductorGroup(index).pages;
  }

  function calcGroupHasData(group) {
    var first = group.pages[0] || {};
    var source = first.source || {};
    if (hasData(source.capturedAt) || Number(source.sourceCount) > 0) return true;
    return group.pages.some(function (page) { return traverseCalcRowsFilled(page) > 0; });
  }

  function calcGroupFilledRows(group) {
    return group.pages.reduce(function (sum, page) {
      return sum + traverseCalcRowsFilled(page);
    }, 0);
  }

  /* ------------------------------------------------------------------ *
   * 表一 → 表三 联立
   * ------------------------------------------------------------------ */

  function linkageEnabled() {
    if (!LINKAGE || !STORE || !STORE.getLinkage) return false;
    try {
      return !!STORE.getLinkage().enabled;
    } catch (err) {
      return false;
    }
  }

  function linkageWithoutLast(rawMeta) {
    var meta = LINKAGE.normalizeMeta(rawMeta);
    meta.last = {};
    return meta;
  }

  function sameMeta(a, b) {
    return JSON.stringify(LINKAGE.normalizeMeta(a)) === JSON.stringify(LINKAGE.normalizeMeta(b));
  }

  function saveLinkageState(patch) {
    patch = patch || {};
    var info = STORE.getLinkage();
    var next = {
      enabled: patch.enabled == null ? info.enabled : !!patch.enabled,
      mapping: patch.mapping === undefined ? info.mapping : patch.mapping
    };
    if (Object.prototype.hasOwnProperty.call(patch, "backup")) next.backup = patch.backup;
    else if (info.backup) next.backup = info.backup;
    try {
      var saved = STORE.setLinkage(next);
      storageOk = true;
      return saved;
    } catch (err) {
      storageOk = false;
      setSaveStatus("联立设置保存失败（请导出 JSON 备份）", true);
      toast("联立设置写入失败，映射可能没有保存。", "error");
      return null;
    }
  }

  function runLinkageSync(options) {
    options = options || {};
    if (!state || !LINKAGE || !linkageEnabled()) return null;
    var info = STORE.getLinkage();
    var result;
    try {
      result = LINKAGE.sync(state, info.mapping, {
        maxPages: MAX_PAGES,
        makeAnglePage: function (pageIndex) { return blankPage("angle", pageIndex); },
        makeAngleStation: blankAngleStation
      });
    } catch (err) {
      toast("联立同步失败：" + (err && err.message ? err.message : "引擎异常"), "error");
      return null;
    }
    var after = LINKAGE.normalizeMeta(result.meta);
    if (!sameMeta(info.mapping, after)) saveLinkageState({ mapping: after });
    if (result.dataChanged) scheduleSave();
    if (options.render && activeModule === "linkage") renderLinkage();
    return result;
  }

  function scheduleLinkageSync() {
    if (!state || state.ui.active !== "traverse" || !linkageEnabled()) return;
    if (linkageTimer) clearTimeout(linkageTimer);
    linkageTimer = setTimeout(function () {
      linkageTimer = null;
      runLinkageSync({ render: false });
    }, 180);
  }

  function flushLinkageSync(options) {
    if (!linkageTimer) return null;
    clearTimeout(linkageTimer);
    linkageTimer = null;
    return runLinkageSync(options || { render: false });
  }

  function linkageAngleHasData() {
    if (!LINKAGE || !state) return false;
    return state.pages.angle.some(function (page) {
      return LINKAGE.anglePageHasData(page);
    });
  }

  function backupReasonLabel(reason) {
    var labels = {
      enable: "开启联立前",
      "traverse-delete": "删除表一页前",
      "traverse-clear": "清空表一页前",
      import: "导入前",
      auto: "恢复自动映射前"
    };
    return labels[reason] || "操作前";
  }

  function formatBackupTime(value) {
    var date = new Date(value);
    if (!date || isNaN(date.getTime())) return "时间未知";
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
      " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function backupLinkage(reason) {
    if (!state) return null;
    var backup = {
      at: new Date().toISOString(),
      reason: reason || "manual",
      state: clone(state)
    };
    var saved = saveLinkageState({ backup: backup });
    return saved ? saved.backup : null;
  }

  function linkageBackupText(info) {
    if (!info || !info.backup) return "";
    return "已有备份：" + backupReasonLabel(info.backup.reason) +
      "（" + formatBackupTime(info.backup.at) + "）。";
  }

  function setLinkageEnabled(enabled, options) {
    options = options || {};
    if (!LINKAGE) return Promise.resolve(false);
    var info = STORE.getLinkage();
    if (!!info.enabled === !!enabled) return Promise.resolve(true);

    if (!enabled) {
      return confirmDialog(
        "解除联立",
        "关闭后表三不再随表一更新。已经写入的数值会保留，并恢复为可编辑；映射表与备份也保留，下次开启继续使用。\n" +
          "解除时会清空「上次写入位置」记录，重新开启后不会再自动删除你在解除期间改过的表三格。",
        { confirmLabel: "解除联立", danger: true }
      ).then(function (ok) {
        if (!ok) return false;
        var saved = saveLinkageState({ enabled: false, mapping: linkageWithoutLast(info.mapping) });
        if (!saved) return false;
        closeDrawer();
        notifyProjectsChanged();
        if (activeModule === "linkage") {
          setActiveTable("angle");
        } else {
          updateTabs();
          renderQuickOptions();
          renderStage();
          updatePager();
          if (drawerOpen) renderDrawer(true);
        }
        toast("已解除联立；表三数值保留，可继续编辑。", "ok");
        return true;
      });
    }

    var hasAngle = linkageAngleHasData();
    var message = hasAngle
      ? "开启后，表一每个测站会按映射表写入表三；表三同格已有内容会被覆盖，表头只补空值。\n开启前会自动备份当前项目的七表数据。"
      : "开启后，表一每个测站会按映射表写入表三；表头只补空值。\n开启前会自动备份当前项目的七表数据。";
    return confirmDialog("开启联立", message, { confirmLabel: "开启并写入" }).then(function (ok) {
      if (!ok) return false;
      noteDestructive("linkage-enable");
      if (!backupLinkage("enable")) return false;
      var saved = saveLinkageState({ enabled: true, mapping: info.mapping });
      if (!saved) return false;
      var result = runLinkageSync({ render: false });
      closeDrawer();
      notifyProjectsChanged();
      setActiveModule("linkage");
      if (result) {
        toast("联立已开启，表三按映射写入完成。", "ok");
      } else {
        toast("联立已开启，但本次同步没有完成；可点「重新同步」再试。", "error");
      }
      return true;
    });
  }

  function resyncLinkage() {
    var result = runLinkageSync({ render: true });
    if (!result) {
      toast("联立未开启。", "error");
      return null;
    }
    toast(result.dataChanged ? "已按当前映射重新同步表三。" : "表三已与表一一致，无需改写。", "ok");
    return result;
  }

  function resetLinkageMapping() {
    var info = STORE.getLinkage();
    var meta = LINKAGE.normalizeMeta(info.mapping);
    if (Object.keys(meta.stations).length === 0) {
      toast("当前已经是自动映射。");
      return;
    }
    confirmDialog(
      "恢复自动映射",
      "将清除所有手工指定的表三位置与目标交换，按全局站号重新排布。\n" +
        "手工挪走的旧表三格会在同步时清理；操作前会先备份当前项目的七表数据。",
      { confirmLabel: "恢复自动", danger: true }
    ).then(function (ok) {
      if (!ok) return;
      noteDestructive("reset-linkage");
      if (!backupLinkage("auto")) return;
      meta.stations = {};
      if (!saveLinkageState({ mapping: meta })) return;
      runLinkageSync({ render: false });
      renderLinkage();
      toast("已恢复自动映射。", "ok");
    });
  }

  function restoreLinkageBackup() {
    if (!LINKAGE) return Promise.resolve(false);
    var info = STORE.getLinkage();
    if (!info.backup || !info.backup.state) {
      toast("当前没有可恢复的联立备份。", "error");
      return Promise.resolve(false);
    }
    var label = backupReasonLabel(info.backup.reason);
    var time = formatBackupTime(info.backup.at);
    return confirmDialog(
      "恢复联立备份",
      "将把七张表恢复为「" + label + "」的完整状态（" + time + "）。\n" +
        "当前未备份的修改会丢失，且无法撤销。",
      { confirmLabel: "恢复备份", danger: true }
    ).then(function (ok) {
      if (!ok) return false;
      noteDestructive("restore-linkage");
      var restored;
      try {
        restored = normalizeState(info.backup.state, { strict: false, resetScale: true });
      } catch (err) {
        toast("备份内容无法解析：" + (err && err.message ? err.message : "结构不符"), "error");
        return false;
      }
      var wasEnable = info.backup.reason === "enable";
      var mapping = linkageWithoutLast(info.mapping);
      var saved = saveLinkageState({
        enabled: wasEnable ? false : info.enabled,
        mapping: mapping,
        backup: info.backup
      });
      if (!saved) return false;

      state = restored;
      if (wasEnable) {
        state.ui.active = "angle";
        activeModule = "angle";
      } else if (info.enabled && activeModule === "linkage") {
        activeModule = "linkage";
      } else {
        activeModule = state.ui.active;
      }
      STORE.setActiveModule(activeModule);
      closeDrawer();
      setChecksOpen(false);
      if (activeModule === "linkage" && saved.enabled) runLinkageSync({ render: false });
      renderAll();
      saveNow(false);
      toast(wasEnable
        ? "已恢复开启联立前的数据，并保持联立关闭。"
        : "已恢复备份；联立保持开启，表三已按表一重新同步。", "ok");
      return true;
    });
  }

  function setLinkageMapping(key, override, focusKind) {
    if (!LINKAGE) return false;
    var info = STORE.getLinkage();
    var meta = LINKAGE.normalizeMeta(info.mapping);
    if (override) meta.stations[key] = override;
    else delete meta.stations[key];
    meta = LINKAGE.normalizeMeta(meta);
    if (sameMeta(info.mapping, meta)) return true;
    if (!saveLinkageState({ mapping: meta })) return false;
    runLinkageSync({ render: false });
    renderLinkage();
    if (focusKind) focusLinkageControl(key, focusKind);
    return true;
  }

  function focusLinkageControl(key, kind) {
    if (!dom.linkageRows) return;
    var nodes = dom.linkageRows.querySelectorAll("[data-linkage-key]");
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute("data-linkage-key") === key &&
          nodes[i].getAttribute("data-linkage-focus") === kind) {
        try { nodes[i].focus(); } catch (err) { /* ignore */ }
        return;
      }
    }
  }

  function linkageDmsText(parts) {
    parts = parts || {};
    var d = str(parts.d).trim();
    var m = str(parts.m).trim();
    var s = str(parts.s).trim();
    if (!d && !m && !s) return "—";
    return (d || "–") + "°" + (m || "–") + "′" + (s || "–") + "″";
  }

  function linkageStatusLabel(status) {
    if (status === "partial") return "有缺项";
    if (status === "blank") return "空白";
    if (status === "cleared") return "已清理";
    if (status === "conflict") return "冲突停写";
    return "已同步";
  }

  function linkageStatusClass(status) {
    if (status === "partial") return "is-partial";
    if (status === "blank") return "is-blank";
    if (status === "cleared") return "is-cleared";
    if (status === "conflict") return "is-conflict";
    return "";
  }

  function addLinkageStat(label, value, cls) {
    var stat = el("span", "linkage-stat" + (cls ? " " + cls : ""));
    stat.appendChild(document.createTextNode(label + " "));
    stat.appendChild(el("strong", "", value));
    dom.linkageSummary.appendChild(stat);
  }

  function renderLinkageSummary(plan) {
    if (!dom.linkageSummary) return;
    dom.linkageSummary.textContent = "";
    var counts = plan.summary;
    addLinkageStat("供数站", counts.data + " / " + counts.total);
    addLinkageStat("已同步", String(counts.synced));
    if (counts.partial) addLinkageStat("有缺项", String(counts.partial), "is-warn");
    if (counts.blank) addLinkageStat("空白", String(counts.blank));
    if (counts.conflicts) addLinkageStat("冲突", String(counts.conflicts), "is-bad");
    if (counts.manual) addLinkageStat("手工", String(counts.manual));
    var angleCount = state.pages.angle.length;
    addLinkageStat("表三页", angleCount + (plan.neededPages > angleCount ? " → " + plan.neededPages : ""));
    if (plan.willCreatePages) addLinkageStat("将新建", plan.willCreatePages + " 页", "is-warn");
  }

  function renderLinkageNotice(plan, info) {
    if (!dom.linkageNotice) return;
    var text = "";
    var cls = "";
    if (plan.summary.conflicts) {
      text = "有 " + plan.summary.conflicts + " 个表一站争用同一表三格，相关站已暂停写入；请改动「表三位置」或「目标配对」。";
      cls = " is-bad";
    } else if (plan.willCreatePages) {
      text = "同步时会自动新建 " + plan.willCreatePages + " 页表三（当前 " + state.pages.angle.length +
        " 页，需要 " + plan.neededPages + " 页）；不会删除已有页。";
      cls = " is-warn";
    }
    var backupText = linkageBackupText(info);
    if (backupText) text += (text ? " " : "") + backupText;
    dom.linkageNotice.hidden = !text;
    dom.linkageNotice.className = "linkage-notice" + cls;
    dom.linkageNotice.textContent = text;
  }

  function renderLinkage() {
    if (!LINKAGE || !state || !dom.linkageRows || !linkageEnabled()) return;
    var info = STORE.getLinkage();
    var plan = LINKAGE.plan(state.pages.traverse, info.mapping, {
      anglePageCount: state.pages.angle.length,
      maxPages: MAX_PAGES
    });
    var meta = plan.meta;
    var currentAnglePages = state.pages.angle.length;

    dom.linkageRestore.disabled = !info.backup;
    dom.linkageRestore.title = info.backup
      ? "恢复" + backupReasonLabel(info.backup.reason) + "的完整备份（" + formatBackupTime(info.backup.at) + "）"
      : "当前没有备份";
    dom.linkageAuto.disabled = Object.keys(meta.stations).length === 0;
    dom.linkageAuto.title = dom.linkageAuto.disabled
      ? "当前已经是自动映射"
      : "清除所有手工目标位置与目标交换，恢复按站号自动排布";
    dom.linkageDisable.disabled = false;

    renderLinkageSummary(plan);
    renderLinkageNotice(plan, info);

    dom.linkageRows.textContent = "";
    var currentPage = -1;
    plan.rows.forEach(function (row) {
      if (row.sourcePage !== currentPage) {
        currentPage = row.sourcePage;
        var groupRow = el("tr", "linkage-group-row");
        var groupHead = el("th", "", "表一第 " + (row.sourcePage + 1) + " 页");
        groupHead.colSpan = 6;
        groupHead.appendChild(el("span", "", "全局站 g = " + (row.sourcePage * 4) + "–" + (row.sourcePage * 4 + 3)));
        groupRow.appendChild(groupHead);
        dom.linkageRows.appendChild(groupRow);
      }

      var tr = el("tr", "linkage-row" + (row.hasData ? "" : " is-empty"));
      var override = meta.stations[row.key] || null;
      var pageOverride = !!(override && override.page != null);
      var swapped = !!(override && override.swap);

      var tdSource = el("td");
      var source = el("div", "linkage-source");
      source.appendChild(el("strong", "", "第" + (row.sourceStation + 1) + "站"));
      var nameNode = el("span", "linkage-station-name", row.stationOut || "未填站名");
      if (!row.stationOut) nameNode.classList.add("is-empty");
      if (row.stationName) nameNode.title = row.stationName;
      source.appendChild(nameNode);
      source.appendChild(el("span", "", "g = 4×" + row.sourcePage + " + " + row.sourceStation + " = " + row.globalIndex));
      tdSource.appendChild(source);
      tr.appendChild(tdSource);

      var tdTargets = el("td");
      var targets = el("div", "linkage-targets");
      [row.targetNames[0], row.targetNames[1]].forEach(function (rawName, targetIndex) {
        var item = el("span", !str(rawName).trim() ? "is-empty" : "");
        item.appendChild(el("b", "", targetIndex === 0 ? "①" : "②"));
        item.appendChild(el("em", "", str(rawName).trim() ? LINKAGE.truncate(rawName, LINKAGE.TARGET_MAX) : "未填"));
        if (str(rawName).trim()) item.title = rawName;
        targets.appendChild(item);
      });
      tdTargets.appendChild(targets);
      tr.appendChild(tdTargets);

      var tdLines = el("td");
      var lines = el("div", "linkage-lines");
      if (!row.hasData) {
        lines.appendChild(el("div", "linkage-empty-line", "空白站：暂不写入表三"));
      } else {
        row.sourceRows.forEach(function (sourceRow, index) {
          var line = el("div", "linkage-line");
          var distance = str(sourceRow.distance).trim();
          var hasReading = !!(str(sourceRow.reading.d).trim() || str(sourceRow.reading.m).trim() || str(sourceRow.reading.s).trim());
          if (!hasReading && !distance) line.classList.add("is-blank");
          line.appendChild(el("span", "line-no", String(index + 1)));
          line.appendChild(el("span", "line-face", sourceRow.face + (sourceRow.targetIndex === 0 ? "①" : "②")));
          var targetText = str(sourceRow.targetName).trim()
            ? LINKAGE.truncate(sourceRow.targetName, LINKAGE.TARGET_MAX) : "未填目标";
          var targetNode = el("span", "line-target", targetText);
          if (str(sourceRow.targetName).trim()) targetNode.title = sourceRow.targetName;
          line.appendChild(targetNode);
          line.appendChild(el("span", "line-reading", linkageDmsText(sourceRow.reading)));
          line.appendChild(el("span", "line-distance", distance ? distance + " m" : "—"));
          lines.appendChild(line);
        });
      }
      tdLines.appendChild(lines);
      tr.appendChild(tdLines);

      var tdDest = el("td");
      var position = el("div", "linkage-position");
      var pageSelect = el("select");
      pageSelect.setAttribute("aria-label", "第" + (row.sourceStation + 1) + "站 表三页");
      pageSelect.setAttribute("data-linkage-key", row.key);
      pageSelect.setAttribute("data-linkage-focus", "dest-page");
      pageSelect.title = "目标表三页；选到没有的页会在同步时新建";
      var topPage = Math.max(currentAnglePages - 1, plan.neededPages - 1, row.dest.page, 0);
      if (topPage < MAX_PAGES - 1) topPage += 1;
      for (var pageIndex = 0; pageIndex <= topPage; pageIndex += 1) {
        var pageOption = el("option", "", "第 " + (pageIndex + 1) + " 页" + (pageIndex >= currentAnglePages ? "（新建）" : ""));
        pageOption.value = String(pageIndex);
        pageSelect.appendChild(pageOption);
      }
      pageSelect.value = String(row.dest.page);
      position.appendChild(pageSelect);

      var stationSelect = el("select");
      stationSelect.setAttribute("aria-label", "第" + (row.sourceStation + 1) + "站 表三站");
      stationSelect.setAttribute("data-linkage-key", row.key);
      stationSelect.setAttribute("data-linkage-focus", "dest-station");
      stationSelect.title = "目标表三站";
      for (var stationIndex = 0; stationIndex < LINKAGE.ANGLE_CAPACITY; stationIndex += 1) {
        var stationOption = el("option", "", "第 " + (stationIndex + 1) + " 站");
        stationOption.value = String(stationIndex);
        stationSelect.appendChild(stationOption);
      }
      stationSelect.value = String(row.dest.station);
      position.appendChild(stationSelect);

      var autoButton = el("button", "linkage-auto-btn", "自动");
      autoButton.type = "button";
      autoButton.disabled = !pageOverride;
      autoButton.setAttribute("data-linkage-key", row.key);
      autoButton.setAttribute("data-linkage-focus", "dest-auto");
      autoButton.title = pageOverride ? "恢复按全局站号自动定位（保留目标交换）" : "当前已是自动定位";
      position.appendChild(autoButton);
      position.appendChild(el("span", "linkage-auto-flag", pageOverride ? "手工" : "自动"));
      tdDest.appendChild(position);
      tr.appendChild(tdDest);

      pageSelect.addEventListener("change", function () {
        var next = {
          page: Number(pageSelect.value),
          station: Number(stationSelect.value)
        };
        if (swapped) next.swap = true;
        setLinkageMapping(row.key, next, "dest-page");
      });
      stationSelect.addEventListener("change", function () {
        var next = {
          page: Number(pageSelect.value),
          station: Number(stationSelect.value)
        };
        if (swapped) next.swap = true;
        setLinkageMapping(row.key, next, "dest-station");
      });
      autoButton.addEventListener("click", function () {
        setLinkageMapping(row.key, swapped ? { swap: true } : null, "dest-page");
      });

      var tdPair = el("td");
      var pairWrap = el("div", "linkage-pair");
      var pairSelect = el("select");
      pairSelect.setAttribute("aria-label", "第" + (row.sourceStation + 1) + "站 目标配对");
      pairSelect.setAttribute("data-linkage-key", row.key);
      pairSelect.setAttribute("data-linkage-focus", "pair");
      pairSelect.title = "只交换目标①②，不反转盘左/盘右";
      var normalOption = el("option", "", "①→1 ②→2");
      normalOption.value = "normal";
      var swapOption = el("option", "", "②→1 ①→2");
      swapOption.value = "swap";
      pairSelect.appendChild(normalOption);
      pairSelect.appendChild(swapOption);
      pairSelect.value = swapped ? "swap" : "normal";
      pairSelect.addEventListener("change", function () {
        var next = {};
        if (override && override.page != null) {
          next.page = override.page;
          next.station = override.station;
        }
        if (pairSelect.value === "swap") next.swap = true;
        setLinkageMapping(row.key, (next.page != null || next.swap) ? next : null, "pair");
      });
      pairWrap.appendChild(pairSelect);
      tdPair.appendChild(pairWrap);
      tr.appendChild(tdPair);

      var tdStatus = el("td");
      var statusWrap = el("div", "linkage-status");
      var chip = el("span", "linkage-chip" + (linkageStatusClass(row.status) ? " " + linkageStatusClass(row.status) : ""),
        linkageStatusLabel(row.status));
      statusWrap.appendChild(chip);
      var hints = el("div", "linkage-hints");
      var hintTexts = row.warnings.map(function (warning) {
        return { text: warning.text, bad: warning.code === "conflict" };
      });
      if (row.status === "cleared") {
        hintTexts.push({ text: "表一源站已清空，上次写入的表三格已清理", bad: false });
      } else if (row.status === "blank") {
        hintTexts.push({ text: "表一未填写，暂不写入表三", bad: false });
      }
      hintTexts.forEach(function (hint) {
        var hintNode = el("span", "linkage-hint" + (hint.bad ? " is-bad" : ""), hint.text);
        hints.appendChild(hintNode);
      });
      if (hints.childNodes.length) statusWrap.appendChild(hints);
      tdStatus.appendChild(statusWrap);
      tr.appendChild(tdStatus);

      dom.linkageRows.appendChild(tr);
    });
  }

  function makeIssue(level, message, opts) {
    opts = opts || {};
    return {
      level: level,
      message: message,
      pageIndex: opts.pageIndex,
      stationIndex: opts.stationIndex == null ? -1 : opts.stationIndex,
      stationLabel: opts.stationLabel || "",
      cellIds: opts.cells || [],
      focusCell: opts.focus || null,
      code: opts.code || ""
    };
  }

  var ISSUE_RANK = { invalid: 0, warning: 1, missing: 2, info: 3 };

  function compareIssues(a, b) {
    if (a.stationIndex !== b.stationIndex) return a.stationIndex - b.stationIndex;
    var ra = ISSUE_RANK[a.level] == null ? 9 : ISSUE_RANK[a.level];
    var rb = ISSUE_RANK[b.level] == null ? 9 : ISSUE_RANK[b.level];
    if (ra !== rb) return ra - rb;
    return a.message.localeCompare(b.message, "zh-CN");
  }

  function finalizeAnalysis(key, pages, hasMeasurements) {
    var counts = { missing: 0, warning: 0, invalid: 0, info: 0 };
    pages.forEach(function (page) {
      page.issues.forEach(function (issue) {
        if (counts[issue.level] != null) counts[issue.level] += 1;
      });
      page.issues.sort(compareIssues);
    });
    counts.actionable = counts.missing + counts.warning + counts.invalid;
    return {
      key: key,
      pages: pages,
      counts: counts,
      hasMeasurements: !!hasMeasurements,
      startedAny: !!hasMeasurements || counts.actionable > 0
    };
  }

  function mapTraverseIssue(issue, sid) {
    var code = issue.code || "";
    var targetIndex = issue.targetId === "2" ? 1 : 0;
    var base = targetIndex === 0 ? 1 : 3;
    var cid;
    if (/^[hvs]\.[LR]$/.test(code)) {
      var bits = code.split(".");
      var row = base + (bits[1] === "R" ? 1 : 0);
      cid = sid + "-r" + row + "-" + bits[0];
      return { cells: [cid], focus: cid };
    }
    if (code === "p") {
      cid = sid + "-r" + base + "-prism";
      return { cells: [cid], focus: cid };
    }
    if (code === "i") {
      cid = sid + "-instrument-height";
      return { cells: [cid], focus: cid };
    }
    if (code === "sname") {
      cid = sid + "-station";
      return { cells: [cid], focus: cid };
    }
    if (code === "c2") {
      return { cells: [sid + "-r" + base + "-c2"], focus: sid + "-r" + base + "-h" };
    }
    if (code === "x") {
      return { cells: [sid + "-r" + base + "-x"], focus: sid + "-r" + base + "-v" };
    }
    if (code === "sdiff") {
      return {
        cells: [sid + "-r" + base + "-s", sid + "-r" + (base + 1) + "-s"],
        focus: sid + "-r" + base + "-s"
      };
    }
    if (code === "halfdiff") {
      return { cells: [sid + "-angle-avg"], focus: sid + "-r1-h" };
    }
    if (code === "t1empty" || code === "t1name") {
      return { cells: [sid + "-r1-target"], focus: sid + "-r1-target" };
    }
    if (code === "t2empty" || code === "t2name") {
      return { cells: [sid + "-r3-target"], focus: sid + "-r3-target" };
    }
    return null;
  }

  function mapLevelingIssue(issue, sid) {
    var field = issue.field;
    var direct = {
      "back.lower": sid + "-r1-back",
      "back.upper": sid + "-r2-back",
      "back.black": sid + "-r1-black",
      "back.red": sid + "-r1-red",
      "front.lower": sid + "-r1-front",
      "front.upper": sid + "-r2-front",
      "front.black": sid + "-r2-black",
      "front.red": sid + "-r2-red"
    };
    if (direct[field]) return { cells: [direct[field]], focus: direct[field] };
    if (field === "back.dist" || field === "front.dist") {
      var side = field.split(".")[0];
      var target = sid + "-r3-" + side;
      var lower = sid + "-r1-" + side;
      var upper = sid + "-r2-" + side;
      if (issue.level === "invalid") return { cells: [target, lower, upper], focus: lower };
      return { cells: [target], focus: lower };
    }
    if (field === "d") return { cells: [sid + "-r4-back"], focus: sid + "-r1-back" };
    if (field === "sumD") return { cells: [sid + "-r4-front"], focus: sid + "-r1-back" };
    if (field === "back.k") return { cells: [sid + "-r1-k"], focus: sid + "-r1-black" };
    if (field === "front.k") return { cells: [sid + "-r2-k"], focus: sid + "-r2-black" };
    if (field === "k3") return { cells: [sid + "-r3-k"], focus: sid + "-r1-black" };
    return null;
  }

  function analyseTraverse() {
    var settings = state.settings.traverse;
    var anyMeasurements = false;
    var pages = state.pages.traverse.map(function (page, pageIndex) {
      var entries = [];
      var issues = [];
      page.stations.forEach(function (station, stationIndex) {
        var res = TC.computeStation(station, settings.mode, {
          c2Limit: settings.c2Limit,
          indexLimit: settings.indexLimit,
          halfDiffLimit: settings.halfDiffLimit
        });
        entries.push({ res: res });
        if (res.stationStarted) anyMeasurements = true;
        var sid = "s" + (stationIndex + 1);
        var label = stationLabel("traverse", page, stationIndex);
        res.issues.forEach(function (issue) {
          if (issue.code === "halfdiff-ok") return;
          var mapped = mapTraverseIssue(issue, sid);
          if (!mapped) return;
          issues.push(makeIssue(issue.level, issue.message, {
            pageIndex: pageIndex,
            stationIndex: stationIndex,
            stationLabel: label,
            cells: mapped.cells,
            focus: mapped.focus,
            code: issue.code
          }));
        });
      });
      return {
        pageIndex: pageIndex,
        page: page,
        stations: entries,
        issues: issues,
        started: pageHasData("traverse", page)
      };
    });
    return finalizeAnalysis("traverse", pages, anyMeasurements);
  }

  function analyseLeveling() {
    var grade = state.settings.leveling.grade;
    var anyMeasurements = false;
    var prevSumD = 0;

    var pages = state.pages.leveling.map(function (page, pageIndex) {
      var entries = [];
      var issues = [];
      var waitingInfoAdded = false;

      page.stations.forEach(function (station, stationIndex) {
        var res = LC.computeStation(station, { grade: grade, prevSumD: prevSumD });
        entries.push({ res: res });
        if (res.started) anyMeasurements = true;
        var sid = "s" + (stationIndex + 1);
        var label = stationLabel("leveling", page, stationIndex);

        if (res.started) {
          if (res.d.state === "ok" && res.sumD.state === "ok") {
            prevSumD = res.sumD.value;
          } else {
            prevSumD = null;
          }
        }

        if (res.started && res.d.state === "ok" && res.sumD.state === "waiting" && !waitingInfoAdded) {
          issues.push(makeIssue("info", "累计视距差 Σd 需等前面测站视距补全后自动累计。", {
            pageIndex: pageIndex,
            stationIndex: stationIndex,
            stationLabel: label,
            cells: [sid + "-r4-front"],
            focus: sid + "-r1-back",
            code: "chain-wait"
          }));
          waitingInfoAdded = true;
        }

        res.issues.forEach(function (issue) {
          var mapped = mapLevelingIssue(issue, sid);
          if (!mapped) return;
          issues.push(makeIssue(issue.level, issue.message, {
            pageIndex: pageIndex,
            stationIndex: stationIndex,
            stationLabel: label,
            cells: mapped.cells,
            focus: mapped.focus,
            code: issue.field || "reading"
          }));
        });

        if (res.started && !hasData(station.stationNo)) {
          var stationCell = levelingStationCellId(stationIndex);
          issues.push(makeIssue("missing", "测站编号未填。", {
            pageIndex: pageIndex,
            stationIndex: stationIndex,
            stationLabel: label,
            cells: [stationCell],
            focus: stationCell,
            code: "station-no"
          }));
        }

        if (res.started && stationIndex > 0) {
          ["第1行", "第2行", "第3行"].forEach(function (rowName, dirIndex) {
            if (!hasData(station.dirs[dirIndex])) {
              var cell = sid + "-r" + (dirIndex + 1) + "-dir";
              issues.push(makeIssue("missing", rowName + "方向/尺号未填。", {
                pageIndex: pageIndex,
                stationIndex: stationIndex,
                stationLabel: label,
                cells: [cell],
                focus: cell,
                code: "dir-" + (dirIndex + 1)
              }));
            }
          });
        }
      });

      return {
        pageIndex: pageIndex,
        page: page,
        stations: entries,
        issues: issues,
        started: pageHasData("leveling", page)
      };
    });

    return finalizeAnalysis("leveling", pages, anyMeasurements);
  }

  function analyseAngle() {
    var limit = state.settings.angle.limit;
    var anyMeasurements = false;

    var pages = state.pages.angle.map(function (page, pageIndex) {
      var entries = [];
      var issues = [];

      page.stations.forEach(function (station, stationIndex) {
        var rowsForEngine = station.rows.map(function (row) {
          return { target: row.target, reading: row.reading };
        });
        var res = AC.computeStation({ rows: rowsForEngine }, { limit: limit });
        entries.push({ res: res });
        if (res.started) anyMeasurements = true;

        var sid = "s" + (stationIndex + 1);
        var label = stationLabel("angle", page, stationIndex);
        var stationActive = hasData(station.station) || station.rows.some(function (row) {
          return hasData(row.target) || hasData(row.distance) || dmsAny(row.reading);
        });

        if (stationActive && !hasData(station.station)) {
          issues.push(makeIssue("missing", "测站号未填。", {
            pageIndex: pageIndex,
            stationIndex: stationIndex,
            stationLabel: label,
            cells: [sid + "-station"],
            focus: sid + "-station",
            code: "station"
          }));
        }

        station.rows.forEach(function (row, rowIndex) {
          var rowNumber = rowIndex + 1;
          var readingActive = dmsAny(row.reading);
          var rowActive = hasData(row.target) || hasData(row.distance) || readingActive;

          if (rowActive && !hasData(row.target)) {
            issues.push(makeIssue("missing", "第" + rowNumber + "行目标未填。", {
              pageIndex: pageIndex,
              stationIndex: stationIndex,
              stationLabel: label,
              cells: [sid + "-r" + rowNumber + "-target"],
              focus: sid + "-r" + rowNumber + "-target",
              code: "target-" + rowNumber
            }));
          }
          if (readingActive && !hasData(row.distance)) {
            issues.push(makeIssue("missing", "第" + rowNumber + "行已录读数，距离未填。", {
              pageIndex: pageIndex,
              stationIndex: stationIndex,
              stationLabel: label,
              cells: [sid + "-r" + rowNumber + "-distance"],
              focus: sid + "-r" + rowNumber + "-distance",
              code: "distance-" + rowNumber
            }));
          }
        });

        if (!res.started && stationActive) {
          station.rows.forEach(function (row, rowIndex) {
            if ((hasData(row.target) || hasData(row.distance)) && !dmsAny(row.reading)) {
              issues.push(makeIssue("missing", "第" + (rowIndex + 1) + "行已有目标/距离，度盘读数未填。", {
                pageIndex: pageIndex,
                stationIndex: stationIndex,
                stationLabel: label,
                cells: [sid + "-r" + (rowIndex + 1) + "-reading"],
                focus: sid + "-r" + (rowIndex + 1) + "-reading",
                code: "reading-" + (rowIndex + 1)
              }));
            }
          });
        }

        res.issues.forEach(function (issue) {
          if (issue.level === "info") {
            var cells = [];
            var focus = null;
            if (res.pairMode === "row") {
              cells = [sid + "-r3-target", sid + "-r4-target"];
              focus = sid + "-r3-target";
            }
            issues.push(makeIssue("info", issue.message, {
              pageIndex: pageIndex,
              stationIndex: stationIndex,
              stationLabel: label,
              cells: cells,
              focus: focus,
              code: "pairing-info"
            }));
            return;
          }
          if (issue.row) {
            var cell = sid + "-r" + issue.row + "-reading";
            issues.push(makeIssue(issue.level, issue.message, {
              pageIndex: pageIndex,
              stationIndex: stationIndex,
              stationLabel: label,
              cells: [cell],
              focus: cell,
              code: "reading-" + issue.row
            }));
            return;
          }
          if (issue.level === "warning") {
            issues.push(makeIssue("warning", issue.message, {
              pageIndex: pageIndex,
              stationIndex: stationIndex,
              stationLabel: label,
              cells: [sid + "-halfdiff"],
              focus: sid + "-r1-reading",
              code: "halfdiff"
            }));
            return;
          }
          issues.push(makeIssue(issue.level, issue.message, {
            pageIndex: pageIndex,
            stationIndex: stationIndex,
            stationLabel: label,
            code: "engine"
          }));
        });
      });

      return {
        pageIndex: pageIndex,
        page: page,
        stations: entries,
        issues: issues,
        started: pageHasData("angle", page)
      };
    });

    return finalizeAnalysis("angle", pages, anyMeasurements);
  }

  // 表G 的 P/T 起算坐标：课程只给 P 的固定值与 T 的生成规则，
  // T 的后几位要自己补；它们不参与闭合计算，只用于解算首行。
  function traverseCoords() {
    var c = state.settings.traverseCalc.coords || {};
    return {
      pn: str(c.pn).trim(),
      pe: str(c.pe).trim(),
      tn: str(c.tn).trim(),
      te: str(c.te).trim()
    };
  }

  function coordsNumbers(coords) {
    coords = coords || traverseCoords();
    var out = {};
    Object.keys(coords).forEach(function (key) {
      var text = coords[key];
      var n = text === "" ? NaN : Number(text);
      out[key] = Number.isFinite(n) ? n : null;
    });
    return out.pn != null && out.pe != null && out.tn != null && out.te != null ? out : null;
  }

  function coordsFilled(coords) {
    return !!coordsNumbers(coords);
  }

  function coordsPreview() {
    var n = coordsNumbers();
    if (!n) return null;
    var dN = n.tn - n.pn;
    var dE = n.te - n.pe;
    var az = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
    return { azimuth: az, distance: Math.sqrt(dN * dN + dE * dE) };
  }

  // 起算数据解算：P/T 坐标 + 表四表头的连接角 β1/β2 + 连接边 d，
  // 求首行（点 1）的 X / Y 与 1→2 方位角。纯计算在 TCALC.solveConnection。
  function calcConnectionPreview() {
    var page = state.pages.traverseSummary[0];
    var meta = page && page.meta ? page.meta : {};
    var c = traverseCoords();
    return TCALC.solveConnection({
      pn: c.pn,
      pe: c.pe,
      tn: c.tn,
      te: c.te,
      b1: meta["conn-b1"],
      b2: meta["conn-b2"],
      d: meta["conn-d"],
      dir: state.settings.traverseCalc.connDir
    });
  }

  // 把解算结果写进表G 当前页的首行：只动 X / Y / 方位角三格，点号/角度/边长/高程不动。
  // 首行已有数值时先确认；返回 Promise<boolean>，抽屉按钮与调试 API 共用。
  function fillCalcStart() {
    var preview = calcConnectionPreview();
    if (!preview.ok) {
      toast("起算数据还不全：" + preview.issues.map(function (item) { return item.message; }).join(""), "error");
      return Promise.resolve(false);
    }
    // 起算数据永远写这条导线的开始页（当前页是续页时也一样）。
    var page = calcConductorGroup(state.ui.pageIndex.traverseCalc).pages[0];
    var row = page.rows[0];
    var write = function () {
      row.x = preview.x1.toFixed(3);
      row.y = preview.y1.toFixed(3);
      row.az = preview.az12.packed;
      saveNow(false);
      renderStage();
      if (drawerOpen) renderDrawer(true);
      toast("首行已填入：X = " + row.x + "，Y = " + row.y + "，方位角 = " + row.az + "。", "ok");
      return true;
    };
    if (hasData(row.x) || hasData(row.y) || hasData(row.az)) {
      var shown = function (value) { return hasData(value) ? value : "空"; };
      return confirmDialog(
        "计算并填入首行",
        "首行已有数值（X = " + shown(row.x) + "，Y = " + shown(row.y) + "，方位角 = " +
        shown(row.az) + "）。解算结果会覆盖这三格；点号、角度、边长、高程不动。",
        { confirmLabel: "覆盖" }
      ).then(function (ok) { return ok ? write() : false; });
    }
    return Promise.resolve(write());
  }

  // 每次会话只在第一次进入表G 时提一次；填全后不再出现。
  var coordsToastShown = false;
  // 启动阶段先让迁移/损坏提示占住 toast；启动完成后再补表G 软提示。
  var startupReady = false;
  function maybeOfferCoordsHint() {
    // 只有表G 真正在前台时才提示；助手页/联立页虽然沿用 ui.active，但舞台是隐藏的。
    if (!startupReady) return;
    if (activeModule !== "traverseCalc" || state.ui.active !== "traverseCalc" || coordsToastShown) return;
    if (state.settings.traverseCalc.coordsPrompt !== "pending" || coordsFilled()) return;
    coordsToastShown = true;
    toast("表G 的首行可以由 P/T 起算坐标与表四的 β1 / β2 / d 解算：在「选项 → 起算数据」里填好后可一键填入首行。");
  }

  function analyseTraverseSummary() {
    var summary = SC.traverseRows(state.pages.traverse, state.settings.traverse);
    var page = state.pages.traverseSummary[0];
    var issues = [];
    if (summary.overflow > 0) {
      issues.push(makeIssue("warning",
        "表一共有 " + summary.count + " 个已开始的测站，表四只有 " + SC.TRAVERSE_ROWS +
        " 行；第 " + (SC.TRAVERSE_ROWS + 1) + " 站起没有显示。",
        {
          pageIndex: 0,
          stationLabel: "汇总行数",
          code: "summary-overflow"
        }));
    }
    return finalizeAnalysis("traverseSummary", [{
      pageIndex: 0,
      page: page,
      stations: [],
      issues: issues,
      started: pageHasData("traverseSummary", page),
      rows: summary.rows,
      totals: {
        angle: summary.totalAngle,
        dist: summary.totalDist,
        dh: summary.totalDh
      },
      summary: summary
    }], summary.count > 0);
  }

  /* ------------------------------------------------------------------ *
   * 表五：逐页归属
   * ------------------------------------------------------------------ */

  // 旧页块规则下，第 pageIndex 张表二页本应属于谁：每人 4 段，每段 legPages 页。
  function blockLevelingOwner(pageIndex, legPages) {
    var per = SC.LEGS_PER_PERSON * SC.normalizeLegPages(legPages);
    var n = Math.max(0, Math.floor(Number(pageIndex) || 0));
    return { person: Math.floor(n / per) + 1, leg: Math.floor((n % per) / SC.normalizeLegPages(legPages)) };
  }

  // ownerMode 设置：false = 还没决定（有标签就按标签）、true = 逐页归属、"blocks" = 强制页块。
  function levelingOwnerModeActive() {
    var flag = state.settings.levelingSummary.ownerMode;
    if (flag === "blocks") return false;
    if (flag === true) return true;
    return state.pages.leveling.some(function (page) {
      return SC.normalizeOwner(page && page.owner) != null;
    });
  }

  // 第一次设置归属前，先把现有页按旧页块规则补齐；否则切到逐页归属会把这些页当成无归属。
  function materializeLevelingOwners() {
    var legPages = state.settings.levelingSummary.legPages;
    state.pages.leveling.forEach(function (page, index) {
      if (SC.normalizeOwner(page && page.owner)) return;
      page.owner = blockLevelingOwner(index, legPages);
    });
    state.settings.levelingSummary.ownerMode = true;
  }

  function stepLevelingOwner(owner, delta) {
    var person = owner.person;
    var leg = owner.leg + delta;
    while (leg < 0) {
      person -= 1;
      leg += SC.LEGS_PER_PERSON;
    }
    while (leg >= SC.LEGS_PER_PERSON) {
      person += 1;
      leg -= SC.LEGS_PER_PERSON;
    }
    if (person < 1) return { person: 1, leg: 0 };
    if (person > SC.MAX_PEOPLE) return { person: SC.MAX_PEOPLE, leg: SC.LEGS_PER_PERSON - 1 };
    return { person: person, leg: leg };
  }

  function setLevelingOwner(owner) {
    var index = state.ui.pageIndex.leveling;
    var page = state.pages.leveling[index];
    if (!page) return;
    var normalized = SC.normalizeOwner(owner);
    materializeLevelingOwners();
    page.owner = normalized;
    saveNow(false);
    recompute();
    updatePager();
    if (drawerOpen) renderDrawer(true);
    renderOwnerPopover();
  }

  function analyseLevelingSummary() {
    var pages = state.pages.levelingSummary;
    var pageCount = pages.length;
    var lastIndex = pageCount - 1;
    var ownerMode = levelingOwnerModeActive();
    var activeSummaryIndex = state.ui.pageIndex.levelingSummary;
    var summaries = pages.map(function (page, index) {
      var summary = SC.levelingRows(state.pages.leveling, state.settings.leveling, {
        mode: ownerMode ? "owners" : "blocks",
        legPages: state.settings.levelingSummary.legPages,
        names: page.names,
        pageIndex: index,
        pageCount: pageCount
      });
      var hasMeasurements = summary.rows.some(function (row) {
        return row.s1.fwd.value != null || row.s1.back.value != null ||
          row.s2.fwd.value != null || row.s2.back.value != null;
      });
      return { page: page, index: index, summary: summary, hasMeasurements: hasMeasurements };
    });
    var hasAnyMeasurements = summaries.some(function (item) { return item.hasMeasurements; });

    var results = summaries.map(function (item) {
      var summary = item.summary;
      var issues = [];
      if (ownerMode) {
        if (summary.emptyLegs > 0 && (item.hasMeasurements || summary.assignedPages > 0)) {
          issues.push(makeIssue("warning",
            "本页第 " + summary.personStart + "–" + summary.personEnd + " 人中，还有 " +
            summary.emptyLegs + " 段没有任何表二页；这些段的往返合计先空着，给表二页设置归属后自动重算。",
            {
              pageIndex: item.index,
              stationLabel: "逐页归属",
              code: "summary-owner-empty-legs"
            }));
        }
        if (summary.outOfRangePeople > 0) {
          issues.push(makeIssue("warning",
            "本页人员序号超过 " + SC.MAX_PEOPLE + "（表五最多 100 页 × 每页 8 人），超出的 " +
            summary.outOfRangePeople + " 人不会汇总。",
            {
              pageIndex: item.index,
              stationLabel: "人员序号",
              code: "summary-owner-people"
            }));
        }
        // 归属页数是整张表二的事实，只挂在当前页，避免每页重复报一次。
        if (item.index === activeSummaryIndex) {
          if (summary.assignedPages === 0) {
            issues.push(makeIssue("info",
              "逐页归属已开启，但表二还没有任何页设置归属。到表二底栏点「归属」，给每张页选第几人的第几段。",
              {
                pageIndex: item.index,
                stationLabel: "逐页归属",
                code: "summary-owner-none"
              }));
          } else if (summary.unassignedPages > 0 || summary.outOfRangePages > 0) {
            var ownerParts = [];
            if (summary.unassignedPages > 0) ownerParts.push(summary.unassignedPages + " 页没有归属");
            if (summary.outOfRangePages > 0) ownerParts.push(summary.outOfRangePages + " 页归属无效");
            issues.push(makeIssue("warning",
              "表二有 " + ownerParts.join("、") + "，这些页不计入表五。",
              {
                pageIndex: item.index,
                stationLabel: "逐页归属",
                code: "summary-owner-pages"
              }));
          }
        }
      } else if (item.hasMeasurements && summary.missingPages > 0) {
        issues.push(makeIssue("warning",
          "本页第 " + summary.personStart + "–" + summary.personEnd + " 人对应表二第 " +
          summary.sourceStartPage + "–" + summary.sourceEndPage + " 页；这一段只有 " +
          summary.rangeAvailable + " 页，还缺 " + summary.missingPages +
          " 页。缺页的段先空着，补页后自动重算。",
          {
            pageIndex: item.index,
            stationLabel: "表二页数",
            code: "summary-pages"
          }));
      }
      if (!ownerMode && hasAnyMeasurements && item.index === lastIndex && summary.ignoredPages > 0) {
        issues.push(makeIssue("info",
          "表二有 " + summary.pagesAvailable + " 页；表五现有 " + summary.pageCount +
          " 页，最多计入前 " + summary.capacityPages + " 页，后面 " + summary.ignoredPages +
          " 页没有计入。需要汇总更多人时，在表五新增一页。",
          {
            pageIndex: item.index,
            stationLabel: "表二页数",
            code: "summary-extra-pages"
          }));
      }
      return {
        pageIndex: item.index,
        page: item.page,
        stations: [],
        issues: issues,
        started: pageHasData("levelingSummary", item.page),
        rows: summary.rows,
        footer: summary.footer,
        summary: summary
      };
    });

    return finalizeAnalysis("levelingSummary", results, hasAnyMeasurements);
  }

  // 表六较差允许值的口径文字：两种公式分别带自己的系数与单位。
  function trigSideFormulaLabel(settings) {
    return settings.sideFormula === "linear"
      ? settings.sideLinear + "×S mm（S 为平距，以 m 计）"
      : settings.sideLimit + "√D mm（D 以 km 计）";
  }

  function analyseTrigSummary() {
    var pages = state.pages.trigSummary;
    var settings = state.settings.trigSummary;
    var closed = settings.closed !== false;
    var first = pages[0];
    var summary = SC.trigRows(state.pages.traverse, state.settings.traverse, {
      sideFormula: settings.sideFormula,
      sideLimit: settings.sideLimit,
      sideLinear: settings.sideLinear,
      closureLimit: settings.closureLimit,
      closed: closed,
      pageCount: pages.length,
      startElev: first && first.meta ? first.meta["start-elev"] : ""
    });
    var issues = [];
    var lastIndex = pages.length - 1;
    if (summary.overflow > 0) {
      var needPages = Math.ceil(summary.edgeCount / SC.TRIG_ROWS);
      issues.push(makeIssue("warning",
        "表一共有 " + summary.count + " 个已开始的测站" +
        (closed ? "" : "（非闭合路线 " + summary.edgeCount + " 条边）") +
        "，表六 " + pages.length + " 页只能显示 " + summary.capacity +
        " 条边；还有 " + summary.overflow + " 条没有显示。用底栏「新页」补到 " +
        needPages + " 页后自动" + (closed ? "平差。" : "推高程。"),
        {
          pageIndex: lastIndex,
          stationLabel: "汇总页数",
          code: "trig-overflow"
        }));
    } else if (summary.count > 0 && closed && summary.edgeCount < 3) {
      issues.push(makeIssue("info",
        "表一只有 " + summary.edgeCount + " 条边（" + summary.count +
        " 个已开始测站），闭合环至少需要 3 条边；补齐后再平差。",
        {
          pageIndex: 0,
          stationLabel: "闭合环",
          code: "trig-loop"
        }));
    } else if (summary.count > 0 && !closed && summary.edgeCount < 1) {
      issues.push(makeIssue("info",
        "表一只有 " + summary.count + " 个已开始测站，非闭合路线至少需要 2 个测站（1 条边）。",
        {
          pageIndex: 0,
          stationLabel: "非闭合路线",
          code: "trig-route"
        }));
    } else if (summary.filled > 0 && !summary.routeReady) {
      issues.push(makeIssue("info",
        "表一还有 " + summary.incomplete + " 条边的往返观测没有算全，表六暂不" +
        (closed ? "平差" : "推高程") + "；补齐后自动重算。",
        {
          pageIndex: 0,
          stationLabel: "往返观测",
          code: "trig-incomplete"
        }));
    }
    if (summary.sideOver > 0) {
      issues.push(makeIssue("warning",
        "对向高差较差有 " + summary.sideOver + " 条超过允许值（" +
        trigSideFormulaLabel(settings) + "）；" +
        (closed ? "改正值照常分配，请先复核往返观测。" : "非闭合路线不分配闭合差，请先复核往返观测。"),
        {
          pageIndex: 0,
          stationLabel: "对向高差",
          code: "trig-side"
        }));
    }
    if (summary.closureOver) {
      issues.push(makeIssue("warning",
        "三角高程闭合差 " + (summary.closureMm > 0 ? "+" : "") + summary.closureMm +
        " mm，超过允许值 ±" + summary.closureAllow + " mm（" + settings.closureLimit +
        "√ΣD，ΣD = " + (summary.totalDist.value / 1000).toFixed(3) + " km）。",
        {
          pageIndex: 0,
          stationLabel: "闭合差",
          code: "trig-closure"
        }));
    }
    if (summary.routeReady && !summary.elevationsReady) {
      issues.push(makeIssue("info",
        closed
          ? "改正值已分配；在第 1 页表头填写「起点高程」后自动推出各点最终高程。"
          : "非闭合路线已算全；在第 1 页表头填写「起点高程」后自动推出各点高程。",
        {
          pageIndex: 0,
          stationLabel: "起点高程",
          cells: ["meta-start-elev"],
          focus: "meta-start-elev",
          code: "trig-start-elev"
        }));
    }
    // Σ 行与精度评定落在最后一页有数据的纸上；额外新增的空白页不显示合计。
    var shownEdges = Math.min(summary.edgeCount, summary.capacity);
    var lastPage = Math.max(0, Math.min(lastIndex,
      Math.ceil(shownEdges / SC.TRIG_ROWS) - 1));
    var results = pages.map(function (page, pageIndex) {
      return {
        pageIndex: pageIndex,
        page: page,
        stations: [],
        issues: pageIndex === 0 ? issues : [],
        started: pageHasData("trigSummary", page),
        rows: summary.rows,
        summary: summary,
        rowOffset: pageIndex * SC.TRIG_ROWS,
        lastPage: lastPage
      };
    });
    return finalizeAnalysis("trigSummary", results, summary.count > 0);
  }

  // 表G：一条导线可以跨页，按「开始页 + 连续续页」分组，每组只算一次。
  // 每条提示只挂在实际页一次，检查面板不会重复计数。
  function analyseTraverseCalc() {
    var settings = state.settings.traverseCalc;
    var pages = state.pages.traverseCalc;
    var results = [];
    var start = 0;
    while (start < pages.length) {
      var group = calcConductorGroup(start);
      var computed = TCALC.computePages(group.pages, settings);
      group.pages.forEach(function (page, offset) {
        var pageIndex = group.start + offset;
        var calc = computed.pages[offset].calc;
        var issues = calc.issues.map(function (item) {
          return makeIssue(item.level, item.message, {
            pageIndex: pageIndex,
            // 有行的提示按导线全局行号排序；fβ / K / 截断这类整条提示排在本页最前。
            stationIndex: item.row == null ? -1 : item.row,
            stationLabel: "第 " + (pageIndex + 1) + " 页",
            cells: item.cells,
            focus: item.focus,
            code: item.code
          });
        });
        results[pageIndex] = {
          pageIndex: pageIndex,
          page: page,
          stations: [],
          issues: issues,
          started: traverseCalcRowsFilled(page) > 0 ||
            (offset === 0 && calcGroupHasData(group)),
          calc: calc,
          conductor: {
            start: group.start,
            end: group.end,
            pageCount: group.pages.length,
            offset: offset,
            role: page.role === "cont" ? "cont" : "start",
            source: group.pages[0].source
          }
        };
      });
      start = group.end + 1;
    }
    var any = results.some(function (item) { return item.started; });
    return finalizeAnalysis("traverseCalc", results, any);
  }

  function analyseActive() {
    if (state.ui.active === "traverse") return analyseTraverse();
    if (state.ui.active === "leveling") return analyseLeveling();
    if (state.ui.active === "traverseSummary") return analyseTraverseSummary();
    if (state.ui.active === "levelingSummary") return analyseLevelingSummary();
    if (state.ui.active === "trigSummary") return analyseTrigSummary();
    if (state.ui.active === "traverseCalc") return analyseTraverseCalc();
    return analyseAngle();
  }

  /* ------------------------------------------------------------------ *
   * 挂载 / 输入层
   * ------------------------------------------------------------------ */

  function setBox(node, spec, key) {
    var box = spec.box || geometryFor(key, spec.cellId);
    if (!box) return false;
    var sheet = TABLES[key].sheet;
    node.style.left = (box.x / sheet.width * 100).toFixed(5) + "%";
    node.style.top = (box.y / sheet.height * 100).toFixed(5) + "%";
    node.style.width = (box.w / sheet.width * 100).toFixed(5) + "%";
    node.style.height = (box.h / sheet.height * 100).toFixed(5) + "%";
    return true;
  }

  function setCellHover(owner, cellId, on) {
    if (!owner || runtime !== owner) return;
    var node = owner.nodes[cellId];
    if (node) node.classList.toggle("is-cell-hover", on);
    var hit = owner.hits[cellId];
    if (hit) hit.classList.toggle("is-cell-hover", on);
    var fill = owner.fills[cellId];
    if (fill) fill.classList.toggle("is-cell-hover", on);
  }

  function bindCellHover(owner, cellId) {
    var node = owner.nodes[cellId];
    if (!node) return;
    function on() { setCellHover(owner, cellId, true); }
    function off() { setCellHover(owner, cellId, false); }
    node.addEventListener("pointerenter", on);
    node.addEventListener("pointerleave", off);
    node.addEventListener("pointercancel", off);
  }

  // 表一斜线格的输入框保持原位；三角形里除输入框以外的部分也能悬浮/点击。
  function buildCellHit(hit) {
    if (!hit || !hit.input) return null;
    var owner = runtime;
    var node = el("div", "cell-hit");
    node.dataset.cell = hit.input;
    node.dataset.shape = hit.shape || "";
    node.setAttribute("aria-hidden", "true");
    node.style.left = hit.px + "%";
    node.style.top = hit.py + "%";
    node.style.width = hit.pw + "%";
    node.style.height = hit.ph + "%";

    var points = hit.points;
    if (!points || points.length < 3) {
      points = hit.shape === "br"
        ? [[100, 0], [100, 100], [0, 100]]
        : [[0, 0], [100, 0], [0, 100]];
    }
    var clip = "polygon(" + points.map(function (point) {
      return point[0] + "% " + point[1] + "%";
    }).join(", ") + ")";
    node.style.clipPath = clip;
    node.style.webkitClipPath = clip;

    function leave() {
      setCellHover(owner, hit.input, false);
    }
    node.addEventListener("pointerenter", function () {
      setCellHover(owner, hit.input, true);
    });
    node.addEventListener("pointerleave", leave);
    node.addEventListener("pointercancel", leave);
    node.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      if (runtime !== owner) return;
      var focus = runtime.focusMethods[hit.input];
      if (focus) focus();
    });
    owner.hits[hit.input] = node;
    return node;
  }

  // 色块必须画在 SVG 内部、所有描边之下：整张表只有描边没有填充，色块若盖在
  // SVG 上方，会把斜线和格线落在三角形内侧的那一半线宽一起盖掉。
  function buildCellFill(hit) {
    if (!hit || !hit.input) return null;
    var x = Number(hit.x);
    var y = Number(hit.y);
    var w = Number(hit.w);
    var h = Number(hit.h);
    if (!isFinite(x) || !isFinite(y) || !(w > 0) || !(h > 0)) return null;

    var points = hit.shape === "br"
      ? [[x + w, y], [x + w, y + h], [x, y + h]]
      : [[x, y], [x + w, y], [x, y + h]];
    var poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", points.map(function (point) {
      return point[0].toFixed(2) + "," + point[1].toFixed(2);
    }).join(" "));
    // 静止时 fill="none"；高亮由样式表按 is-cell-hover 打开。
    poly.setAttribute("fill", "none");
    poly.setAttribute("pointer-events", "none");
    poly.classList.add("cell-fill");
    poly.dataset.cell = hit.input;
    runtime.fills[hit.input] = poly;
    return poly;
  }

  /* 整格热区：一张印刷数据格里可能有一个输入（或一个输入组）。构建期已把
     印刷格的矩形算好；运行时按每个输入的实际矩形找到最小的那个印刷格，
     同格输入共用一块热区和一块色块。斜线格已有三角形热区，不再重复。 */
  function printedKey(rect) {
    return rect.x + "," + rect.y + "," + rect.w + "," + rect.h;
  }

  function rectCoversBox(rect, box) {
    var eps = 0.05;
    return box.x >= rect.x - eps && box.y >= rect.y - eps &&
      box.x + box.w <= rect.x + rect.w + eps &&
      box.y + box.h <= rect.y + rect.h + eps;
  }

  function specHitBox(key, spec) {
    return spec.box || geometryFor(key, spec.cellId);
  }

  function collectWholeCellHits(key, specs, printed, triangleHits) {
    if (!printed || !printed.length) return [];
    var split = {};
    (triangleHits || []).forEach(function (hit) {
      split[printedKey(hit)] = true;
    });
    var groups = [];
    var byIndex = {};
    specs.forEach(function (spec) {
      var box = specHitBox(key, spec);
      if (!box) return;
      var best = -1;
      var bestArea = Infinity;
      printed.forEach(function (rect, index) {
        if (split[printedKey(rect)]) return;
        if (!(rect.w > 0) || !(rect.h > 0)) return;
        if (!rectCoversBox(rect, box)) return;
        var area = rect.w * rect.h;
        if (area < bestArea) {
          bestArea = area;
          best = index;
        }
      });
      if (best < 0) {
        var inTriangle = (triangleHits || []).some(function (hit) {
          return rectCoversBox(hit, box);
        });
        if (!inTriangle) console.warn("没有可用的整格热区：" + spec.cellId);
        return;
      }
      var group = byIndex[best];
      if (!group) {
        group = byIndex[best] = { rect: printed[best], specs: [] };
        groups.push(group);
      }
      group.specs.push(spec);
    });
    groups.forEach(function (group) {
      group.cells = group.specs.map(function (spec) { return spec.cellId; });
    });
    return groups;
  }

  // 一格里有多个输入时，按点击点离哪个输入中心最近来定焦。
  function nearestSpec(key, specs, event) {
    if (specs.length < 2 || !runtime || !runtime.paper) return specs[0];
    var bounds = runtime.paper.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return specs[0];
    var sheet = TABLES[key].sheet;
    var px = (event.clientX - bounds.left) / bounds.width * sheet.width;
    var py = (event.clientY - bounds.top) / bounds.height * sheet.height;
    var best = specs[0];
    var bestDist = Infinity;
    specs.forEach(function (spec) {
      var box = specHitBox(key, spec);
      if (!box) return;
      var dx = px - (box.x + box.w / 2);
      var dy = py - (box.y + box.h / 2);
      var dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = spec;
      }
    });
    return best;
  }

  function buildWholeCellHit(group, key) {
    if (!group || !group.cells || !group.cells.length) return null;
    var owner = runtime;
    var sheet = TABLES[key].sheet;
    var node = el("div", "cell-hit");
    node.dataset.cell = group.cells[0];
    node.dataset.kind = "cell";
    node.setAttribute("aria-hidden", "true");
    node.style.left = (group.rect.x / sheet.width * 100).toFixed(5) + "%";
    node.style.top = (group.rect.y / sheet.height * 100).toFixed(5) + "%";
    node.style.width = (group.rect.w / sheet.width * 100).toFixed(5) + "%";
    node.style.height = (group.rect.h / sheet.height * 100).toFixed(5) + "%";

    function off() {
      if (runtime !== owner) return;
      group.cells.forEach(function (cellId) { setCellHover(owner, cellId, false); });
    }
    node.addEventListener("pointerenter", function () {
      if (runtime !== owner) return;
      group.cells.forEach(function (cellId) { setCellHover(owner, cellId, true); });
    });
    node.addEventListener("pointerleave", off);
    node.addEventListener("pointercancel", off);
    node.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      if (runtime !== owner) return;
      var spec = nearestSpec(key, group.specs, event);
      if (!spec) return;
      var focus = runtime.hitFocusMethods[spec.cellId] || runtime.focusMethods[spec.cellId];
      if (focus) focus();
    });
    group.cells.forEach(function (cellId) { owner.hits[cellId] = node; });
    group.node = node;
    return node;
  }

  function buildWholeCellFill(group) {
    if (!group || !group.cells || !group.cells.length) return null;
    var rect = group.rect;
    var node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    node.setAttribute("x", Number(rect.x).toFixed(2));
    node.setAttribute("y", Number(rect.y).toFixed(2));
    node.setAttribute("width", Number(rect.w).toFixed(2));
    node.setAttribute("height", Number(rect.h).toFixed(2));
    // 与斜线格色块同一层级：SVG 内部、所有描边之下。
    node.setAttribute("fill", "none");
    node.setAttribute("pointer-events", "none");
    node.classList.add("cell-fill");
    node.dataset.cell = group.cells[0];
    group.cells.forEach(function (cellId) { runtime.fills[cellId] = node; });
    return node;
  }

  function syncFieldValue(spec, field) {
    var has = spec.kind === "dms" ? dmsAny(spec.parts) : hasData(spec.getValue());
    field.ov.classList.toggle("has-value", has);
  }

  function onFieldChanged() {
    scheduleSave();
    scheduleLinkageSync();
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(function () {
      recomputeTimer = null;
      recompute();
    }, 24);
  }

  function focusNextFrom(input) {
    if (!runtime) return;
    var index = -1;
    for (var i = 0; i < runtime.focusables.length; i += 1) {
      if (runtime.focusables[i].input === input) {
        index = i;
        break;
      }
    }
    if (index >= 0 && index < runtime.focusables.length - 1) {
      runtime.focusables[index + 1].input.focus();
    } else {
      input.blur();
    }
  }

  function inputKeydown(event, input, isTextarea) {
    if (event.key !== "Enter" || event.isComposing) return;
    if (isTextarea) return;
    event.preventDefault();
    focusNextFrom(input);
  }

  function cleanSimpleValue(spec, raw) {
    if (spec.kind === "digits") return sanitizeDigits(raw, false, spec.maxDigits || 2, false);
    if (spec.kind === "staff") return sanitizeStaffInput(raw, spec.maxlength || 0);
    if (spec.kind === "decimal") return sanitizeDecimal(raw, spec.signed);
    // 表G 的角度/方位角是一个格子填「度.分秒」打包值（123.4536）；
    // 输入时按小数清洗，失焦后再补齐四位。
    if (spec.kind === "packed") return sanitizeDecimal(raw);
    return raw;
  }

  // 尺读数统一按米存：1.17 -> 1.170，1.1705 -> 1.171。具体取整在
  // calc-leveling.js 的 staffMeters 里，和 readStaff 用同一个半值函数。
  // 早先的项目存的是 mm 整数（1170），载入或失焦时一并换成米。
  function staffMeters(text) {
    return LC.staffMeters(text);
  }

  // 旧「正式版」的尺读数只认 mm 整数：给它导出的 v1 项目文件换回 mm，
  // 文件再导回本软件时又会被 staffMeters 换成米。单表文件只给本软件，保持米。
  function staffMm(text) {
    var meters = staffMeters(text);
    if (meters === "") return "";
    var n = parseFloat(meters);
    return isFinite(n) ? String(Math.round(n * 1000)) : meters;
  }

  function staffReadingsToMm(data) {
    var pages = data && data.pages ? data.pages.leveling : null;
    if (!Array.isArray(pages)) return data;
    pages.forEach(function (page) {
      var stations = page && Array.isArray(page.stations) ? page.stations : [];
      stations.forEach(function (station) {
        ["back", "front"].forEach(function (side) {
          var cells = station && station[side];
          if (!cells || typeof cells !== "object") return;
          ["lower", "upper", "black", "red"].forEach(function (field) {
            cells[field] = staffMm(cells[field]);
          });
        });
      });
    });
    return data;
  }

  function normalizeSimpleValue(spec, raw) {
    var value = raw;
    if (spec.kind === "digits" && spec.padDigits && /^\d+$/.test(value) && value.length < spec.padDigits) {
      value = value.padStart(spec.padDigits, "0");
    }
    if (spec.kind === "staff") value = staffMeters(value);
    if (spec.kind === "decimal") {
      // 只敲了一个负号、或是「-0.」这种半截输入，失焦时收拾干净。
      if (value === "-") value = "";
      else if (value === "-0" || value === "-0.") value = "0";
      else if (value === "0.") value = "0";
      else if (/\.$/.test(value)) value = value.slice(0, -1);
    }
    if (spec.kind === "packed") {
      var packed = str(value).trim();
      if (!packed) return "";
      // 无效值原样留着，让计算引擎去报「第 N 行角度无效」，
      // 失焦时把它悄悄改成 0 反而看不出错。
      var n = Number(packed);
      if (!Number.isFinite(n) || n < 0) return packed;
      return summaryFixed(n, 4);
    }
    return value;
  }

  function notifyLinkedLock() {
    var now = Date.now();
    if (now - linkageLockToastAt < 1600) return;
    linkageLockToastAt = now;
    toast("联立中：本格由表一自动填入，解除联立后可编辑。");
  }

  function applyLinkedReadOnly(ov, input, spec) {
    if (!spec.readOnly) return;
    ov.classList.add("is-linked");
    if (input.getAttribute("contenteditable") != null) {
      input.setAttribute("contenteditable", "false");
      input.classList.add("is-locked");
    } else {
      input.readOnly = true;
    }
    input.title = LINKAGE_LOCK_TITLE;
    input.setAttribute("aria-readonly", "true");
    // 触屏没有 hover 提示；点进只读格或试着输入时，给一次可见的承接。
    input.addEventListener("focus", notifyLinkedLock);
    input.addEventListener("keydown", function (event) {
      if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
        notifyLinkedLock();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 单行文本缩字：<input> 不会换行，超出格宽只能被裁掉。按格宽与字宽
   * 算一个字号倍率写进 --fit，屏幕与打印用同一个公式，结果一致。
   * ------------------------------------------------------------------ */

  var measureContext = null;
  var sheetFontFamilyCache = "";

  function sheetFontFamily() {
    if (!sheetFontFamilyCache) {
      var value = "";
      try {
        value = getComputedStyle(document.documentElement).getPropertyValue("--font-sheet").trim();
      } catch (err) { value = ""; }
      sheetFontFamilyCache = value || "sans-serif";
    }
    return sheetFontFamilyCache;
  }

  function measureTextWidth(font, text) {
    if (!measureContext) {
      var canvas = document.createElement("canvas");
      measureContext = canvas.getContext ? canvas.getContext("2d") : null;
    }
    if (!measureContext || !text) return 0;
    measureContext.font = font;
    return measureContext.measureText(text).width || 0;
  }

  // 缩到 0.62 倍还放不下就停在下限：再小就认不出字了，宁可留着格内滚动。
  var FIT_FLOOR = 0.62;

  function textFitScale(spec, key, text) {
    if (!spec || !spec.fit) return 1;
    if (text == null) text = str(spec.printText ? spec.printText() : spec.getValue());
    text = str(text);
    if (!text) return 1;
    var box = spec.box || geometryFor(key, spec.cellId);
    if (!box || !box.w) return 1;
    // .ov-input 左右各 2% 内边距；左对齐格是固定 3 单位。
    var available = spec.align === "left" ? box.w - 6 : box.w * 0.96;
    if (available <= 0) return 1;
    var width = measureTextWidth("400 " + spec.font + "px " + sheetFontFamily(), text);
    if (!width) return 1;
    var scale = (available * 0.99) / width;
    if (scale >= 0.995) return 1;
    return Math.max(FIT_FLOOR, Math.round(scale * 1000) / 1000);
  }

  function applyFitScale(spec, input, key) {
    if (!input) return 1;
    var scale = textFitScale(spec, key);
    if (scale >= 1) {
      if (input.style.getPropertyValue("--fit")) input.style.removeProperty("--fit");
    } else {
      input.style.setProperty("--fit", String(scale));
    }
    spec.fitScale = scale;
    return scale;
  }

  // 字体是 woff2（font-display: swap），首帧量到的是后备字体；
  // 字体就绪后按真字宽重算一遍。
  function refitTextFields() {
    if (!runtime) return;
    runtime.inputs.forEach(function (field) {
      if (field.kind === "simple") applyFitScale(field.spec, field.input, field.key);
    });
  }

  // 换行格一般不需要缩字；但表二观测者允许 20 字，真写满会比格子高。
  // 这里只在已溢出时按 0.06 一档往回收，仍然以 FIT_FLOOR 为底。
  function fitWrappedField(field) {
    var input = field && field.input;
    if (!input || !input.clientHeight) return;
    input.style.removeProperty("--fit");
    var scale = 1;
    var guard = 0;
    while (input.scrollHeight > input.clientHeight + 1 && scale > FIT_FLOOR && guard < 16) {
      scale = Math.max(FIT_FLOOR, Math.round((scale - 0.06) * 100) / 100);
      input.style.setProperty("--fit", String(scale));
      guard += 1;
    }
    field.spec.fitScale = scale;
  }

  function fitAllWrappedFields() {
    if (!runtime) return;
    runtime.inputs.forEach(function (field) {
      if (field.kind === "wrapped") fitWrappedField(field);
    });
  }

  function buildSimpleField(key, spec) {
    var ov = el("div", "ov");
    if (spec.meta) ov.classList.add("meta");
    if (spec.plain) ov.classList.add("plain");
    if (spec.align === "left") ov.classList.add("text-left");
    if (!setBox(ov, spec, key)) {
      console.warn("缺少单元格 geometry：" + spec.cellId);
      return null;
    }
    ov.style.setProperty("--fs", String(spec.font));
    ov.dataset.cell = spec.cellId;

    var input = el("input", "ov-input");
    input.type = "text";
    input.value = str(spec.getValue());
    input.maxLength = spec.maxlength;
    input.inputMode = spec.inputmode;
    input.placeholder = spec.placeholder || "";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("enterkeyhint", spec.kind === "textarea" ? "enter" : "next");
    input.setAttribute("aria-label", spec.aria || spec.cellId);
    applyLinkedReadOnly(ov, input, spec);
    input.addEventListener("focus", function () {
      if (runtime) runtime.activeCell = spec.cellId;
      if (spec.selectAll) {
        try { input.select(); } catch (err) { /* ignore */ }
      }
    });
    input.addEventListener("input", function () {
      if (spec.readOnly) return;
      var raw = input.value;
      var cleaned = cleanSimpleValue(spec, raw);
      if (cleaned !== raw) input.value = cleaned;
      spec.setValue(cleaned);
      syncFieldValue(spec, field);
      applyFitScale(spec, input, key);
      onFieldChanged();
    });
    input.addEventListener("blur", function () {
      if (spec.readOnly) return;
      var normalized = normalizeSimpleValue(spec, input.value);
      if (normalized !== input.value) input.value = normalized;
      spec.setValue(normalized);
      syncFieldValue(spec, field);
      applyFitScale(spec, input, key);
      onFieldChanged();
    });
    input.addEventListener("keydown", function (event) {
      inputKeydown(event, input, false);
    });
    ov.appendChild(input);

    var field = { spec: spec, ov: ov, input: input, kind: "simple", key: key };
    field.ov.dataset.cell = spec.cellId;
    runtime.fields[spec.cellId] = field;
    runtime.nodes[spec.cellId] = ov;
    runtime.focusMethods[spec.cellId] = function () {
      try {
        input.focus();
        if (spec.selectAll) input.select();
      } catch (err) { /* ignore */ }
    };
    runtime.focusables.push({ input: input, spec: spec, part: null });
    runtime.inputs.push(field);
    syncFieldValue(spec, field);
    applyFitScale(spec, input, key);
    return { ov: ov, field: field };
  }

  /* 高位文本格：表二的测站编号只有 85 单位宽、却有一百多单位高，
     「BM1-BP1」这种 7 个字的编号在 <input> 里只会被右边界裁掉。
     改用 contenteditable 排成居中的可换行文本；存进项目的仍是纯文本，
     不会带进换行符（合并没有意义，编号是一整个名字）。 */

  function readWrappedText(node) {
    var text = node.innerText != null ? node.innerText : node.textContent;
    return str(text).replace(/\r/g, "").replace(/\n+/g, " ");
  }

  function setWrappedText(node, text) {
    text = str(text);
    if (node.textContent === text) return;
    node.textContent = text;
    // 清空后 Chromium 会留一个 <br>，:empty 的占位提示就失效了。
    if (!text && node.innerHTML) node.innerHTML = "";
  }

  function placeCaretAtEnd(node) {
    try {
      var range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (err) { /* ignore */ }
  }

  function buildWrappedField(key, spec) {
    var ov = el("div", "ov");
    if (spec.meta) ov.classList.add("meta");
    if (spec.plain) ov.classList.add("plain");
    if (spec.align === "left") ov.classList.add("text-left");
    if (!setBox(ov, spec, key)) {
      console.warn("缺少单元格 geometry：" + spec.cellId);
      return null;
    }
    ov.style.setProperty("--fs", String(spec.font));
    ov.dataset.cell = spec.cellId;

    var input = el("div", "ov-text");
    input.setAttribute("contenteditable", spec.readOnly ? "false" : "plaintext-only");
    input.setAttribute("role", "textbox");
    input.setAttribute("aria-multiline", "false");
    input.setAttribute("enterkeyhint", "next");
    input.setAttribute("aria-label", spec.aria || spec.cellId);
    input.spellcheck = false;
    if (spec.placeholder) input.dataset.placeholder = spec.placeholder;
    setWrappedText(input, str(spec.getValue()));
    applyLinkedReadOnly(ov, input, spec);

    function commitWrapped() {
      if (spec.readOnly) return;
      var raw = readWrappedText(input);
      var cleaned = cleanSimpleValue(spec, raw);
      if (spec.maxlength && cleaned.length > spec.maxlength) {
        cleaned = cleaned.slice(0, spec.maxlength);
      }
      if (cleaned !== raw) {
        setWrappedText(input, cleaned);
        placeCaretAtEnd(input);
      }
      spec.setValue(cleaned);
      syncFieldValue(spec, field);
      fitWrappedField(field);
      onFieldChanged();
    }

    input.addEventListener("focus", function () {
      if (runtime) runtime.activeCell = spec.cellId;
    });
    input.addEventListener("input", function (event) {
      // 输入法组合中途重写文本会打断候选词，等 compositionend 再收尾。
      if (event && event.isComposing) return;
      commitWrapped();
    });
    input.addEventListener("compositionend", commitWrapped);
    input.addEventListener("blur", function () {
      if (spec.readOnly) return;
      var normalized = normalizeSimpleValue(spec, readWrappedText(input)).trim();
      setWrappedText(input, normalized);
      spec.setValue(normalized);
      syncFieldValue(spec, field);
      onFieldChanged();
    });
    input.addEventListener("keydown", function (event) {
      inputKeydown(event, input, false);
    });
    // 换行后文字只占中间一条，点格子上下空白也要能进格。
    ov.addEventListener("mousedown", function (event) {
      if (event.target !== ov || spec.readOnly) return;
      event.preventDefault();
      try {
        input.focus();
        placeCaretAtEnd(input);
      } catch (err) { /* ignore */ }
    });
    input.addEventListener("paste", function (event) {
      if (spec.readOnly) return;
      event.preventDefault();
      var clip = event.clipboardData || window.clipboardData;
      var text = clip ? str(clip.getData("text")).replace(/\s+/g, " ").trim() : "";
      if (text) document.execCommand("insertText", false, text);
    });
    ov.appendChild(input);

    var field = { spec: spec, ov: ov, input: input, kind: "wrapped", key: key };
    field.ov.dataset.cell = spec.cellId;
    runtime.fields[spec.cellId] = field;
    runtime.nodes[spec.cellId] = ov;
    runtime.focusMethods[spec.cellId] = function () {
      try {
        input.focus();
        placeCaretAtEnd(input);
      } catch (err) { /* ignore */ }
    };
    runtime.focusables.push({ input: input, spec: spec, part: null });
    runtime.inputs.push(field);
    syncFieldValue(spec, field);
    return { ov: ov, field: field };
  }

  function buildTextareaField(key, spec) {
    var ov = el("div", "ov");
    if (spec.meta) ov.classList.add("meta");
    if (spec.plain) ov.classList.add("plain");
    if (spec.align === "left") ov.classList.add("text-left");
    if (!setBox(ov, spec, key)) {
      console.warn("缺少单元格 geometry：" + spec.cellId);
      return null;
    }
    ov.style.setProperty("--fs", String(spec.font));
    ov.dataset.cell = spec.cellId;

    var input = el("textarea", "ov-textarea");
    input.value = str(spec.getValue());
    input.maxLength = spec.maxlength;
    input.placeholder = spec.placeholder || "";
    input.spellcheck = false;
    input.setAttribute("aria-label", spec.aria || spec.cellId);
    applyLinkedReadOnly(ov, input, spec);
    input.addEventListener("focus", function () {
      if (runtime) runtime.activeCell = spec.cellId;
    });
    input.addEventListener("input", function () {
      if (spec.readOnly) return;
      spec.setValue(input.value);
      syncFieldValue(spec, field);
      onFieldChanged();
    });
    input.addEventListener("blur", function () {
      if (spec.readOnly) return;
      spec.setValue(input.value);
      syncFieldValue(spec, field);
      onFieldChanged();
    });
    input.addEventListener("keydown", function (event) {
      inputKeydown(event, input, true);
    });
    ov.appendChild(input);

    var field = { spec: spec, ov: ov, input: input, kind: "textarea" };
    field.ov.dataset.cell = spec.cellId;
    runtime.fields[spec.cellId] = field;
    runtime.nodes[spec.cellId] = ov;
    runtime.focusMethods[spec.cellId] = function () {
      try { input.focus(); } catch (err) { /* ignore */ }
    };
    runtime.focusables.push({ input: input, spec: spec, part: null });
    runtime.inputs.push(field);
    syncFieldValue(spec, field);
    return { ov: ov, field: field };
  }

  function focusDmsPart(field, part, select) {
    var index = part === "d" ? 0 : (part === "m" ? 1 : 2);
    var input = field.inputs[index];
    if (!input) return;
    try {
      input.focus();
      if (select) input.select();
    } catch (err) { /* ignore */ }
  }

  function focusFirstDmsInput(field) {
    var order = ["d", "m", "s"];
    var parts = field.spec.parts;
    for (var i = 0; i < order.length; i += 1) {
      if (!str(parts[order[i]]).trim()) {
        focusDmsPart(field, order[i], true);
        return;
      }
    }
    focusDmsPart(field, "d", true);
  }

  function buildDmsField(key, spec) {
    var ov = el("div", "ov");
    if (spec.meta) ov.classList.add("meta");
    if (!setBox(ov, spec, key)) {
      console.warn("缺少单元格 geometry：" + spec.cellId);
      return null;
    }
    ov.style.setProperty("--fs", String(spec.font));
    ov.dataset.cell = spec.cellId;

    var group = el("div", "ov-dms");
    var field = { spec: spec, ov: ov, inputs: [], kind: "dms" };
    field.ov.dataset.cell = spec.cellId;
    runtime.fields[spec.cellId] = field;
    var partNames = [
      { key: "d", label: "度", max: 4, cls: "deg" },
      { key: "m", label: "分", max: 2, cls: "" },
      { key: "s", label: "秒", max: 2, cls: "" }
    ];

    partNames.forEach(function (partInfo, index) {
      var input = el("input", partInfo.cls);
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = partInfo.max;
      input.placeholder = partInfo.label;
      input.value = str(spec.parts[partInfo.key]);
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("enterkeyhint", "next");
      input.setAttribute("aria-label", (spec.aria || "角度") + " " + partInfo.label);
      applyLinkedReadOnly(ov, input, spec);

      input.addEventListener("focus", function () {
        if (runtime) runtime.activeCell = spec.cellId;
        try { input.select(); } catch (err) { /* ignore */ }
      });
      input.addEventListener("input", function (event) {
        if (spec.readOnly) return;
        var allowMinus = partInfo.key === "d" && spec.allowMinus;
        var max = partInfo.key === "d" ? 3 : 2;
        var cleaned = sanitizeDigits(input.value, allowMinus, max, allowMinus);
        if (cleaned !== input.value) input.value = cleaned;
        spec.parts[partInfo.key] = cleaned;
        syncFieldValue(spec, field);
        onFieldChanged();
        if (event && event.inputType && event.inputType.indexOf("delete") === 0) return;
        if (partInfo.key === "d" && /^-?\d{3}$/.test(cleaned)) {
          focusDmsPart(field, "m", true);
        } else if (partInfo.key === "m" && /^\d{2}$/.test(cleaned)) {
          focusDmsPart(field, "s", true);
        } else if (partInfo.key === "s" && /^\d{2}$/.test(cleaned)) {
          focusNextFrom(input);
        }
      });
      input.addEventListener("blur", function () {
        if (spec.readOnly) return;
        var value = input.value;
        if (partInfo.key === "d" && value === "-") value = "";
        if (partInfo.key !== "d" && /^\d$/.test(value)) value = pad2(Number(value));
        if (value !== input.value) input.value = value;
        spec.parts[partInfo.key] = value;
        syncFieldValue(spec, field);
        onFieldChanged();
      });
      input.addEventListener("keydown", function (event) {
        inputKeydown(event, input, false);
      });
      input.addEventListener("paste", function (event) {
        if (spec.readOnly) return;
        var clipboard = event.clipboardData || window.clipboardData;
        var text = clipboard ? clipboard.getData("text") : "";
        var parsed = parseDmsText(text, spec.allowMinus);
        if (!parsed) return;
        event.preventDefault();
        field.inputs[0].value = parsed.d;
        field.inputs[1].value = parsed.m;
        field.inputs[2].value = parsed.s;
        spec.parts.d = parsed.d;
        spec.parts.m = parsed.m;
        spec.parts.s = parsed.s;
        syncFieldValue(spec, field);
        onFieldChanged();
        focusDmsPart(field, "s", true);
      });

      group.appendChild(input);
      field.inputs.push(input);
      runtime.focusables.push({ input: input, spec: spec, part: partInfo.key });
    });

    group.addEventListener("click", function (event) {
      if (event.target === group) focusFirstDmsInput(field);
    });
    ov.appendChild(group);

    runtime.nodes[spec.cellId] = ov;
    runtime.focusMethods[spec.cellId] = function () { focusDmsPart(field, "d", true); };
    // 整格点击与组内空白一致：落到第一个空段，而不是永远回到「度」。
    runtime.hitFocusMethods[spec.cellId] = function () { focusFirstDmsInput(field); };
    runtime.inputs.push(field);
    syncFieldValue(spec, field);
    return { ov: ov, field: field };
  }

  function buildInputNode(key, spec) {
    if (!spec || !spec.cellId) return null;
    if (spec.kind === "dms") return buildDmsField(key, spec);
    if (spec.kind === "textarea") return buildTextareaField(key, spec);
    if (spec.wrap) return buildWrappedField(key, spec);
    return buildSimpleField(key, spec);
  }

  function renderStage() {
    var key = state.ui.active;
    var cfg = TABLES[key];
    var pageIndex = state.ui.pageIndex[key];
    var page = state.pages[key][pageIndex];

    runtime = {
      key: key,
      pageIndex: pageIndex,
      paper: null,
      nodes: {},
      hits: {},
      fills: {},
      inputs: [],
      focusables: [],
      focusMethods: {},
      hitFocusMethods: {},
      computed: [],
      fields: {},
      activeCell: null
    };

    var specs = buildSpecs(key, page, pageIndex);
    var paper = el("div", "paper");
    paper.dataset.table = key;
    paper.style.aspectRatio = cfg.sheet.width + " / " + cfg.sheet.height;
    paper.style.setProperty("--vbw", String(cfg.sheet.width));
    if (key === "angle") paper.classList.add("font-harmony");

    paper.innerHTML = cleanSvg(cfg.sheet.svg);
    var svg = paper.querySelector("svg");
    if (svg) {
      svg.setAttribute("aria-hidden", "true");
      svg.removeAttribute("tabindex");
    }

    var wholeHits = collectWholeCellHits(key, specs.inputs, cfg.sheet.printed,
      cfg.sheet.hits || []);

    // 高亮色块属于表格本身：放进 #sheet 最底层，印刷描边画在它上面。
    var sheetRoot = paper.querySelector("#sheet");
    var fillLayer = null;
    if (sheetRoot && ((cfg.sheet.hits || []).length || wholeHits.length)) {
      fillLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      fillLayer.setAttribute("id", "cell-fills");
      fillLayer.setAttribute("aria-hidden", "true");
      sheetRoot.insertBefore(fillLayer, sheetRoot.firstChild);
    }

    var overlay = el("div", "overlay");
    // hit 必须排在输入层下面，输入框内仍由 input 自己接收指针。
    (cfg.sheet.hits || []).forEach(function (hit) {
      var node = buildCellHit(hit);
      if (node) overlay.appendChild(node);
      var fill = buildCellFill(hit);
      if (fill && fillLayer) fillLayer.appendChild(fill);
    });
    wholeHits.forEach(function (group) {
      var node = buildWholeCellHit(group, key);
      if (node) overlay.appendChild(node);
      var fill = buildWholeCellFill(group);
      if (fill && fillLayer) fillLayer.appendChild(fill);
    });
    specs.meta.forEach(function (spec) {
      var result = buildInputNode(key, spec);
      if (result) overlay.appendChild(result.ov);
    });
    specs.inputs.forEach(function (spec) {
      var result = buildInputNode(key, spec);
      if (result) overlay.appendChild(result.ov);
    });
    specs.computed.forEach(function (spec) {
      var result = buildComputedNode(key, spec);
      if (result) overlay.appendChild(result.ov);
    });
    // 输入框自己也在三角形里：把输入框上的悬浮也转给同一块三角热区。
    Object.keys(runtime.hits).forEach(function (cellId) {
      bindCellHover(runtime, cellId);
    });
    paper.appendChild(overlay);

    // 表G 的空白表脚只有「第 1 页」；每页是一条导线，页码跟着分页走。
    if (isCalcKey(key)) {
      syncSheetFooter(svg, pageIndex + 1);
      var card = el("button", "calc-card");
      card.type = "button";
      card.title = "计算摘要（点开填写检查）";
      card.setAttribute("aria-label", "表G 计算摘要");
      card.addEventListener("click", function () { openChecks("issues"); });
      paper.appendChild(card);
      runtime.calcCard = card;
    }

    dom.stage.replaceChildren(paper);
    runtime.paper = paper;
    dom.stage.classList.toggle("is-page", state.ui.zoom[key] === "page");
    dom.stage.setAttribute("aria-label", cfg.name + "，第 " + (pageIndex + 1) + " 页");
    fitSheet();
    fitAllWrappedFields();
    updateZoomControls();
    recompute();
    updateBandsButton();
    maybeOfferCoordsHint();
  }

  var fitRaf = 0;

  function scheduleFit() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitSheet();
    });
  }

  function fitSheet() {
    if (!runtime || !runtime.paper || !dom.stage) return;
    var key = runtime.key;
    var cfg = TABLES[key];
    // 屏幕直接按 SVG 自身比例铺在工作区上，不再套 A4 纸框。
    var sheetRatio = cfg.sheet.width / cfg.sheet.height;
    var mode = state.ui.zoom[key];
    var stageStyle = window.getComputedStyle(dom.stage);
    var padX = (parseFloat(stageStyle.paddingLeft) || 0) + (parseFloat(stageStyle.paddingRight) || 0);
    var padY = (parseFloat(stageStyle.paddingTop) || 0) + (parseFloat(stageStyle.paddingBottom) || 0);
    // 横向滚动条占掉的高度要补回来，否则放大到出现横条时基准尺寸会被压缩。
    var borderY = (parseFloat(stageStyle.borderTopWidth) || 0) + (parseFloat(stageStyle.borderBottomWidth) || 0);
    var hScrollbar = Math.max(0, dom.stage.offsetHeight - dom.stage.clientHeight - borderY);
    var availableWidth = Math.max(1, dom.stage.clientWidth - padX);
    var availableHeight = Math.max(1, dom.stage.clientHeight + hScrollbar - padY);

    var sheetWidth = availableWidth;
    if (mode === "page") sheetWidth = Math.min(sheetWidth, availableHeight * sheetRatio);
    // 每张表的 100% 有自己的基准（旧版的 110% / 250% / 200%），底栏百分比再乘上去。
    sheetWidth = sheetWidth
      * normalizeBaseScale(state.ui.scaleBase && state.ui.scaleBase[key]) / 100
      * normalizeScale(state.ui.scale[key]) / 100;
    sheetWidth = Math.max(1, Math.floor(sheetWidth));
    var sheetHeight = sheetWidth / sheetRatio;

    runtime.paper.style.width = sheetWidth + "px";
    dom.stage.classList.toggle("is-page", mode === "page");
    dom.stage.classList.toggle("is-overflow-x", sheetWidth > availableWidth + 0.5);
    dom.stage.classList.toggle("is-overflow-y", sheetHeight > availableHeight + 0.5);
  }

  function recompute() {
    if (!runtime) return;
    analysis = analyseActive();
    renderComputed();
    applyDecorations();
    updateStatus();
    updateCalcCard();
    if (checksOpen) renderCheck(true);
  }

  function syncSheetFooter(svg, pageNumber) {
    if (!svg) return;
    var text = svg.querySelector("#footer text");
    if (text) text.textContent = "第 " + pageNumber + " 页";
  }

  function signedFixed(value, digits) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "—";
    var text = Math.abs(n).toFixed(digits);
    if (Number(text) === 0) return text;
    return (n < 0 ? "-" : "+") + text;
  }

  function formatCapturedAt(value) {
    var raw = str(value);
    if (!raw) return "";
    var d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return String(d.getFullYear()) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  // 屏幕专用摘要卡：纸面右上空白，不打印。四行就是验收时要一眼看到的四个数。
  // 一条导线跨页时，每一页都显示整条导线的 n / ΣD / fβ / fx fy f / K。
  function calcCardRows(pageRes) {
    var rows = [];
    var calc = pageRes && pageRes.calc;
    var conductor = pageRes && pageRes.conductor;
    var cardSource = conductor && conductor.source ? conductor.source : null;
    // 源导线超过本表页容量时，计算在解析前就停了：卡片要直说「截断、未算」，
    // 不能显示成普通的「待填」——那会让人以为是没填数据。
    if (cardSource && Number(cardSource.overflow) > 0) {
      // 截断是带入当时的快照：后来手动加页也不会把旧数据补全，
      // 所以按 source 记录写「上次带入多少行」，不拿当前页数反推容量。
      var srcCount = Number(cardSource.sourceCount);
      var srcOverflow = Number(cardSource.overflow) || 0;
      var importedRows = Number.isFinite(srcCount) && srcCount > 0
        ? Math.max(0, srcCount - srcOverflow)
        : 0;
      return {
        pending: true,
        over: true,
        rows: [
          { label: "源导线", value: (Number.isFinite(srcCount) && srcCount > 0 ? srcCount + " 站" : "站数未知") + " · 截断", cls: "is-over" },
          { label: "带入", value: "上次只带入 " + importedRows + " 行", cls: "" },
          { label: "闭合差", value: "未计算", cls: "is-over" },
          { label: "K", value: "—", cls: "" }
        ]
      };
    }
    if (!calc || calc.state === "empty") {
      return {
        pending: true,
        over: false,
        rows: [
          { label: "n · ΣD", value: "待填", cls: "" },
          { label: "fβ", value: "—", cls: "" },
          { label: "fx fy f", value: "—", cls: "" },
          { label: "K", value: "—", cls: "" }
        ]
      };
    }
    var over = false;
    var sumText = calc.sumD == null ? "—" : summaryFixed(calc.sumD, 3) + " m";
    rows.push({ label: "n · ΣD", value: (calc.n || 0) + " · " + sumText, cls: "" });

    var fBetaText = "—";
    var fBetaCls = "";
    if (Number.isFinite(calc.fBetaSec) && Number.isFinite(calc.fBetaAllowSec)) {
      fBetaText = signedFixed(calc.fBetaSec, 2) + "″ / ±" + calc.fBetaAllowSec.toFixed(2) + "″";
      if (calc.angleOk === false) { fBetaCls = "is-over"; over = true; }
      else if (calc.angleOk === true) fBetaCls = "is-ok";
    }
    rows.push({ label: "fβ", value: fBetaText, cls: fBetaCls });

    var fText = "—";
    var fCls = "";
    if (Number.isFinite(calc.fxMm) && Number.isFinite(calc.fyMm)) {
      fText = signedFixed(calc.fxMm, 0) + " " + signedFixed(calc.fyMm, 0) + " " +
        Number(calc.fMm).toFixed(1) + " mm";
      if (calc.kOk === false) { fCls = "is-over"; over = true; }
      else if (calc.kOk === true) fCls = "is-ok";
    }
    rows.push({ label: "fx fy f", value: fText, cls: fCls });

    var kText = "—";
    var kCls = "";
    if (calc.kDenActual != null) {
      // 用 floor：K 略超 1/4000（如 1/3999.81）时四舍五入会显示「1/4000」，
      // 与「超过 1/4000」自相矛盾；向下取整保证显示值不夸大精度。
      kText = calc.kDenActual === Infinity ? "0" : "1/" + Math.floor(calc.kDenActual);
      kText += " / 1/" + state.settings.traverseCalc.kDen;
      if (calc.kOk === false) { kCls = "is-over"; over = true; }
      else if (calc.kOk === true) kCls = "is-ok";
    }
    rows.push({ label: "K", value: kText, cls: kCls });

    return { pending: calc.state === "partial", over: over, rows: rows };
  }

  function updateCalcCard() {
    if (!runtime || !runtime.calcCard || !analysis) return;
    var pageRes = analysis.pages[runtime.pageIndex];
    var view = calcCardRows(pageRes);
    var card = runtime.calcCard;
    card.textContent = "";
    card.classList.toggle("is-pending", view.pending);
    card.classList.toggle("is-over", view.over);
    var head = el("span", "calc-card-head", "计算摘要");
    card.appendChild(head);
    view.rows.forEach(function (row) {
      var line = el("span", "calc-card-row");
      line.appendChild(el("span", "k", row.label));
      var value = el("span", "v", row.value);
      if (row.cls) value.classList.add(row.cls);
      line.appendChild(value);
      card.appendChild(line);
    });
  }

  /* ------------------------------------------------------------------ *
   * 计算值渲染 / 软提示
   * ------------------------------------------------------------------ */

  function buildComputedNode(key, spec) {
    var ov = el("div", "ov calc");
    if (spec.top) ov.classList.add("top");
    // 表六的精度评定行：不铺底色、左对齐、会换行，排版像一段说明文字。
    if (spec.plain) ov.classList.add("plain");
    if (spec.align === "left") ov.classList.add("text-left");
    if (spec.wrap) ov.classList.add("wrap");
    if (!setBox(ov, spec, key)) {
      console.warn("缺少计算单元格 geometry：" + spec.cellId);
      return null;
    }
    ov.style.setProperty("--fs", String(spec.font));
    ov.dataset.cell = spec.cellId;
    if (spec.title) ov.title = spec.title;

    var main = el("div", "calc-main");
    var note = el("div", "calc-note");
    main.hidden = true;
    note.hidden = true;
    ov.appendChild(main);
    ov.appendChild(note);

    runtime.nodes[spec.cellId] = ov;
    var item = { spec: spec, ov: ov, main: main, note: note };
    runtime.computed.push(item);
    return { ov: ov, item: item };
  }

  function resolveComputed(spec, result, pageRes) {
    var out = { text: "", note: "", hasValue: false, invalid: false, placeholder: false };
    if (result && result.value != null && (result.state === "ok" || result.state === "partial")) {
      out.text = str(spec.format(result.value));
      out.hasValue = true;
      if (result.state === "partial" && spec.note) {
        out.note = str(spec.note(result, pageRes) || "");
      }
      return out;
    }
    if (spec.realOnly) return out;
    if (result && result.state === "invalid") {
      out.text = "—";
      out.invalid = true;
      return out;
    }
    if (spec.isStarted && spec.isStarted(pageRes)) {
      out.text = "待填";
      out.placeholder = true;
    }
    return out;
  }

  function limitRatio(value, limit) {
    return BANDS ? BANDS.ratio(value, limit) : null;
  }

  // 只在开关打开、值已算出时给计算格定档；任何异常都不上色。
  function bandForSpec(spec, result, pageRes) {
    if (!bandsOn || !BANDS || !spec || typeof spec.band !== "function") return 0;
    if (!result || result.value == null) return 0;
    if (result.state !== "ok" && result.state !== "partial") return 0;
    var ratio;
    try {
      ratio = spec.band(result, pageRes);
    } catch (err) {
      return 0;
    }
    return BANDS.band(ratio);
  }

  function updateBandsButton() {
    if (!dom.bandsBtn) return;
    if (!BANDS) {
      dom.bandsBtn.hidden = true;
      return;
    }
    // 表五没有课程限差、表G 只在摘要里比较 fβ 与 K，误差色按钮在这两张表隐藏；
    // 开关状态仍保留，切回其他表继续生效。
    dom.bandsBtn.hidden = !!(state && (state.ui.active === "levelingSummary" ||
      isCalcKey(state.ui.active)));
    dom.bandsBtn.setAttribute("aria-pressed", bandsOn ? "true" : "false");
    dom.bandsBtn.classList.toggle("is-on", bandsOn);
    dom.bandsBtn.title = bandsOn
      ? "误差色已开：默认 ≤1× · 绿底 1～2× · 黄底 2～3× · 红底 >3×；再点关闭"
      : "给有允许误差的计算值按倍数铺底色：默认 ≤1× · 绿底 1～2× · 黄底 2～3× · 红底 >3×";
  }

  function setErrorBands(on) {
    bandsOn = !!on;
    try {
      if (window.localStorage) window.localStorage.setItem(BAND_KEY, bandsOn ? "1" : "0");
    } catch (err) {
      /* 存储不可用时只在本次会话生效 */
    }
    updateBandsButton();
    renderComputed();
    return bandsOn;
  }

  function renderComputed() {
    if (!runtime || !analysis) return;
    var pageRes = analysis.pages[runtime.pageIndex];
    runtime.computed.forEach(function (item) {
      var result = null;
      try {
        result = pageRes ? item.spec.getResult(pageRes) : null;
      } catch (err) {
        result = null;
      }
      var out = resolveComputed(item.spec, result, pageRes);
      item.main.textContent = out.text;
      item.main.hidden = !out.text;
      item.main.classList.toggle("is-placeholder", out.placeholder);
      item.main.classList.toggle("is-invalid", out.invalid);
      item.note.textContent = out.note;
      item.note.hidden = !out.note;
      item.ov.classList.toggle("has-value", out.hasValue);
      var band = bandForSpec(item.spec, result, pageRes);
      item.ov.classList.toggle("band-2", band === 2);
      item.ov.classList.toggle("band-3", band === 3);
      item.ov.classList.toggle("band-4", band === 4);
    });
  }

  function applyDecorations() {
    if (!runtime || !analysis) return;
    Object.keys(runtime.nodes).forEach(function (id) {
      var node = runtime.nodes[id];
      node.classList.remove("cell-missing", "cell-warning", "cell-invalid");
    });
    var pageRes = analysis.pages[runtime.pageIndex];
    if (!pageRes) return;
    var levelFor = { missing: 1, warning: 2, invalid: 3 };
    var levels = {};
    pageRes.issues.forEach(function (issue) {
      if (issue.level === "info") return;
      (issue.cellIds || []).forEach(function (id) {
        var rank = levelFor[issue.level] || 0;
        if (!levels[id] || levels[id] < rank) levels[id] = rank;
      });
    });
    Object.keys(levels).forEach(function (id) {
      var node = runtime.nodes[id];
      if (!node) return;
      var level = levels[id];
      node.classList.add(level === 3 ? "cell-invalid" : (level === 2 ? "cell-warning" : "cell-missing"));
    });
  }

  function updateStatus() {
    if (!analysis || !dom.statusChip) return;
    var counts = analysis.counts;
    var chip = dom.statusChip;
    var summary = isSummaryKey(analysis.key);
    chip.classList.remove("is-blank", "is-ok", "is-warn", "is-bad");
    var text = "空白";
    var summarySource = analysis.key === "levelingSummary" ? "表二" : "表一";
    var title = summary
      ? summarySource + "还没有可汇总的测站。"
      : "本表尚未录入读数。";

    if (!analysis.startedAny) {
      text = "空白";
      chip.classList.add("is-blank");
    } else if (counts.actionable === 0) {
      text = summary ? "✓ 已推导" : "✓ 已完整";
      chip.classList.add("is-ok");
      title = summary
        ? "本表数据全部由来源表自动推导，没有需要处理的提示。"
        : "本表没有缺项、超限或计算错误。";
    } else {
      var pieces = [];
      if (counts.missing) pieces.push("待填 " + counts.missing);
      if (counts.warning) pieces.push("超限 " + counts.warning);
      if (counts.invalid) pieces.push("错误 " + counts.invalid);
      text = pieces.join(" · ");
      chip.classList.add(counts.invalid ? "is-bad" : "is-warn");
      title = "待填 " + counts.missing + " 处，超限 " + counts.warning + " 处，错误 " + counts.invalid + " 处。点击查看。";
    }
    chip.textContent = text;
    chip.title = title;
    chip.setAttribute("aria-label", "填写检查：" + text);

    if (dom.checkBtn) {
      dom.checkBtn.textContent = counts.actionable > 0 ? "填写检查（" + counts.actionable + "）" : "填写检查";
      dom.checkBtn.setAttribute("aria-expanded", checksOpen ? "true" : "false");
    }
    if (dom.checkTabBadge) {
      dom.checkTabBadge.textContent = counts.actionable > 0 ? String(counts.actionable) : "";
    }
  }

  /* ------------------------------------------------------------------ *
   * 填写检查面板
   * ------------------------------------------------------------------ */

  function updateCheckTabs() {
    $all("[data-check-tab]", dom.checkPanel).forEach(function (button) {
      var selected = button.getAttribute("data-check-tab") === checksTab;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.classList.toggle("is-active", selected);
    });
  }

  function summaryLine(counts, pageCount) {
    var wrap = el("div", "check-summary-line");
    wrap.appendChild(el("span", "muted", "本表 " + pageCount + " 页"));
    if (counts.actionable === 0) {
      wrap.appendChild(el("span", "ok", "✓ 无待处理项"));
    } else {
      wrap.appendChild(el("span", "warn", "待填 " + counts.missing));
      wrap.appendChild(el("span", "warn", "超限 " + counts.warning));
      wrap.appendChild(el("span", "bad", "错误 " + counts.invalid));
    }
    if (counts.info) wrap.appendChild(el("span", "muted", "提示 " + counts.info));
    return wrap;
  }

  function issueTag(level) {
    if (level === "invalid") return { text: "错" };
    if (level === "warning") return { text: "超" };
    if (level === "missing") return { text: "缺" };
    return { text: "提" };
  }

  function renderIssuesBody(issues) {
    var fragment = document.createDocumentFragment();
    if (!issues.length) {
      var empty = el("div", "check-empty");
      empty.textContent = analysis.hasMeasurements
        ? "没有缺项、超限或计算错误。"
        : "本表尚未录入读数；空白表格不提示。";
      fragment.appendChild(empty);
      return fragment;
    }

    var groups = [];
    var lastKey = null;
    issues.forEach(function (issue) {
      var key = issue.pageIndex + ":" + issue.stationIndex;
      if (key !== lastKey || !groups.length) {
        groups.push({ key: key, issue: issue, items: [] });
        lastKey = key;
      }
      groups[groups.length - 1].items.push(issue);
    });

    groups.forEach(function (group) {
      var section = el("section", "check-group");
      var head = el("div", "check-group-head");
      var label = "第 " + (group.issue.pageIndex + 1) + " 页";
      if (group.issue.stationIndex >= 0) label += " · " + (group.issue.stationLabel || ("第" + (group.issue.stationIndex + 1) + "站"));
      head.textContent = label;
      section.appendChild(head);

      group.items.forEach(function (issue) {
        var tag = issueTag(issue.level);
        var button = el("button", "check-item level-" + issue.level);
        button.type = "button";
        var tagNode = el("span", "tag", tag.text);
        var textNode = el("span", "msg", issue.message);
        var arrow = el("span", "arrow", "›");
        button.appendChild(tagNode);
        button.appendChild(textNode);
        button.appendChild(arrow);
        button.addEventListener("click", function () { jumpToIssue(issue); });
        section.appendChild(button);
      });
      fragment.appendChild(section);
    });
    return fragment;
  }

  function ruleGroups(key) {
    var groups = [];
    if (key === "traverse") {
      var settings = state.settings.traverse;
      groups.push({
        title: "本表（导线）",
        lines: [
          "2C = 盘左水平读数 − 盘右水平读数 ± 180°；指标差 x = (αR − αL) / 2。",
          "竖直角模式：" + (settings.mode === "VA" ? "VA（竖直角）" : "ZA（天顶距）") +
            "。VA：αL=L、αR=R；ZA：αL=90°−L、αR=R−270°。负竖直角在「度」格直接输入负号。",
          "平距 D = S·cos α；高差 = S·sin α + i − v（S 为斜距，i 为仪器高，v 为棱镜高）。",
          "水平角 = 目标② − 目标①（顺时针，负值加 360°）；一测回 = 盘左、盘右水平角的平均。",
          "课程《指标限差》：2C ≤ " + settings.c2Limit + "″，指标差 ≤ " + settings.indexLimit +
            "″，水平角上下半测回较差 ≤ " + settings.halfDiffLimit + "″（可在「选项」中改）。",
          "「单盘」= 只有一盘数据，暂按单盘显示；「缺高」= 仪器高或棱镜高未填，高差暂按 0 计。"
        ]
      });
    } else if (key === "leveling") {
      var grade = state.settings.leveling.grade;
      var gradeLabel = grade === "III" ? "三等" : "四等";
      var limits = grade === "III"
        ? "视距 ≤ 75 m，前后视距差 ≤ 3.0 m，Σd ≤ 6.0 m，黑红面读数差 ≤ 2.0 mm，黑红面高差之差 ≤ 3.0 mm"
        : "视距 ≤ 100 m，前后视距差 ≤ 5.0 m，Σd ≤ 10.0 m，黑红面读数差 ≤ 3.0 mm，黑红面高差之差 ≤ 5.0 mm";
      groups.push({
        title: "本表（水准）",
        lines: [
          "读数按 mm 录入；可只写后三位，失焦时自动补成四位（如 575 → 0575）。",
          "后视距 =（后尺下丝 − 后尺上丝）× 0.1 m；前视距同理。",
          "d = 后视距 − 前视距；Σd 逐站累计，本页第一站承接上一页末站。",
          "第 1/2 行 K + 黑 − 红 = K + 黑面读数 − 红面读数（mm）。",
          "黑面高差 = 后黑 − 前黑；红面高差 = 后红 − 前红。",
          "高差中数 = [黑面高差 + 红面高差 − (K后 − K前)] ÷ 2。",
          "当前等级：" + gradeLabel + "。" + limits + "。",
          "尺常数 K 在「选项」中按站选择，默认 4.787（K₁）/ 4.687（K₂）逐站交替。"
        ]
      });
    } else if (key === "traverseSummary") {
      var dInfo = SC.traverseRows(state.pages.traverse, state.settings.traverse);
      groups.push({
        title: "本表（表四 · 导线汇总）",
        lines: [
          "正文全部由表一自动推导，不接受手填；可编辑的只有顶部表头。",
          "逐行取表一所有页中已经开始的测站，按页序、站序排列；表四固定 17 行。超过 17 站时只显示前 17 行并提示，多出的测站不会挤掉返测的下一站。",
          "每行往测取「本站目标②」的平距与高差，返测取「下一站目标①」；正常闭合时最后一站接回第 1 站。",
          "内角 = 360° − 表一一测回平均水平角。角度按「度.分秒」打包显示（1°02′03″ 记作 1.0203，保留 4 位），合计按六十进制累加，不是十进制小数相加。",
          "平距、高差保留 3 位小数。平距绝对误差 = |往−返|×1000 mm；平距平均值 = (往+返)/2。",
          "高差闭合差 = (往+返)×1000 mm；高差平均值 = (往−返)/2。注意距离取「和÷2」，高差取「差÷2」。",
          "表一某站读数未全时，汇总格先按已有值显示并标出说明；单盘、缺高等情况沿用表一的暂定口径。"
        ]
      });
      groups.push({
        title: "来源核对",
        lines: [
          "表一当前 " + state.pages.traverse.length + " 页，已开始测站 " + dInfo.count + " 个。",
          "表四可显示 " + SC.TRAVERSE_ROWS + " 行，当前显示 " + dInfo.filled + " 行" +
            (dInfo.overflow ? "，超出 " + dInfo.overflow + " 站。" : "。"),
          "改表一数据后，表四立即重算；表四本身的表头不参与计算。"
        ]
      });
    } else if (key === "levelingSummary") {
      var ePages = state.pages.levelingSummary;
      var eIndex = state.ui.pageIndex.levelingSummary;
      var eOwnerMode = levelingOwnerModeActive();
      var eInfo = SC.levelingRows(state.pages.leveling, state.settings.leveling, {
        mode: eOwnerMode ? "owners" : "blocks",
        legPages: state.settings.levelingSummary.legPages,
        names: ePages[eIndex].names,
        pageIndex: eIndex,
        pageCount: ePages.length
      });
      var mappingLine = eOwnerMode
        ? "人员按「逐页归属」划分：表二每张页在底栏「归属」里标记第几人的第几段；同一段有多页时自动合计，页可以不连续。没有归属的页不计入。"
        : "人员按页分块：每人在表二中占 4 段，顺序固定为 BM1-BM0 往测、BM1-BM0 返测、BM0-1号点 往测、BM0-1号点 返测。默认每人每段 1 页，共 4 页；一页写不完时可在「选项 → 分段」把每段改成多页。";
      var sourceLine = eOwnerMode
        ? "当前第 " + (eIndex + 1) + " / " + ePages.length + " 页：第 " + eInfo.personStart +
          "–" + eInfo.personEnd + " 人。表二共 " + eInfo.pagesAvailable + " 页，已归属 " +
          eInfo.assignedPages + " 页" +
          (eInfo.unassignedPages ? "，未归属 " + eInfo.unassignedPages + " 页（不计入）" : "") +
          (eInfo.outOfRangePages ? "，归属无效 " + eInfo.outOfRangePages + " 页（不计入）" : "") +
          (eInfo.emptyLegs ? "；本页还有 " + eInfo.emptyLegs + " 段没有表二页。" : "。")
        : "当前第 " + (eIndex + 1) + " / " + ePages.length + " 页：第 " + eInfo.personStart +
          "–" + eInfo.personEnd + " 人对应表二第 " + eInfo.sourceStartPage +
          "–" + eInfo.sourceEndPage + " 页；这一段有 " + eInfo.rangeAvailable + " 页" +
          (eInfo.missingPages ? "，还缺 " + eInfo.missingPages + " 页。" : "。") +
          " 表五共可计入表二前 " + eInfo.capacityPages + " 页" +
          (eInfo.ignoredPages ? "，多出的 " + eInfo.ignoredPages + " 页未计入。" : "。");
      groups.push({
        title: "本表（表五 · 支水准汇总）",
        lines: [
          "正文全部由表二自动推导，不接受手填；可编辑的只有本页 8 个姓名与顶部表头。",
          "表五一页 8 人；人数更多时用底栏「新页」追加，第 2 页接第 9–16 人，以此类推。删页会让后面的人员序号前移。",
          mappingLine,
          "每段合计 = 该段所有测站「高差中数」之和 ÷ 1000（m）。",
          "闭合差 = (往测合计 + 返测合计)×1000 mm；平均值 = (往测合计 − 返测合计)/2 m。",
          "表底「平均值」取本页已算出人员的算术平均；「中误差」按样本标准差（n−1）计算后乘 1000，单位 mm；少于 2 人时留空。",
          sourceLine
        ]
      });
    } else if (key === "trigSummary") {
      var tPageRule = state.pages.trigSummary[0];
      var tClosedRule = state.settings.trigSummary.closed !== false;
      var tRule = SC.trigRows(state.pages.traverse, state.settings.traverse, {
        sideFormula: state.settings.trigSummary.sideFormula,
        sideLimit: state.settings.trigSummary.sideLimit,
        sideLinear: state.settings.trigSummary.sideLinear,
        closureLimit: state.settings.trigSummary.closureLimit,
        closed: tClosedRule,
        pageCount: state.pages.trigSummary.length,
        startElev: tPageRule && tPageRule.meta ? tPageRule.meta["start-elev"] : ""
      });
      var tLines = [
        "正文全部由表一自动推导，不接受手填；可编辑的只有表头（起点高程 / 计算 / 检核 / 班·组）与整列合一的备注。",
        "每条边：往测取表一「本站目标②」的高差与平距，返测取「下一站目标①」；" +
          (tClosedRule ? "闭合回起点时最后一站接回第 1 站。" : "非闭合路线最后一站没有回程边。"),
        "平距平均值 = (往+返)/2；相对误差 = |往−返| ÷ 平距平均值，写作 1/N（往返完全一致记作 1/∞）。",
        "高差平均值 = (往−返)/2（返测符号与往测相反）；对向高差较差 = (往+返)×1000 mm。",
        "较差允许值 = " + trigSideFormulaLabel(state.settings.trigSummary) +
          "（三档：K·√D 的 60/40 或 K·S；S 为平距）。"
      ];
      if (tClosedRule) {
        tLines.push("闭合差 f_h = Σ高差平均值；允许值 = K·√ΣD mm（默认 40√ΣD）。");
        tLines.push("改正值按平距比例反号分配，逐条取整到 mm，余数给最长边，所以 Σ改正值恰好 = −f_h。");
      } else {
        tLines.push("非闭合路线没有闭合差可分：改正值记 0，改正后高差 = 高差平均值，闭合差系数不参与判定。");
      }
      tLines.push("改正后高差 = 高差平均值 + 改正值 ÷ 1000；最终高程从第 1 页的起点高程起逐条累加" +
        (tClosedRule ? "，闭合环最后一行的点应回到起点。" : "，一直推到路线终点。"));
      tLines.push("表六每页 17 条边；超过时用底栏「新页」追加，续页的起点高程自动承接上一页末点。");
      tLines.push((tClosedRule ? "少于 3 条边" : "少于 1 条边") +
        "、有边的往返观测未算全、或超出当前页数容量时不" + (tClosedRule ? "平差" : "推高程") +
        "；改正值与高程留空。");
      tLines.push("「超限」指严格大于允许值：闭合差正好等于允许值时判合格。");
      groups.push({ title: "本表（表六 · 三角高程平差）", lines: tLines });
      groups.push({
        title: "来源核对",
        lines: [
          "表一当前 " + state.pages.traverse.length + " 页，已开始测站 " + tRule.count + " 个；" +
            (tClosedRule ? "闭合环 " : "非闭合路线 ") + tRule.edgeCount + " 条边。",
          "表六当前 " + state.pages.trigSummary.length + " 页，可显示 " + tRule.capacity +
            " 条边，当前显示 " + tRule.filled + " 条" +
            (tRule.overflow ? "；还有 " + tRule.overflow + " 条未显示，需要新增页。" : "。"),
          tRule.routeReady
            ? (tClosedRule ? "整环已算全，改正值已分配。" : "各边已算全，可按起点高程推高程。")
            : (tClosedRule ? "整环尚未算全，暂不分配改正值。" : "各边尚未算全，暂不推高程。"),
          tRule.elevationsReady ? "起点高程已填，最终高程已推出。" : "起点高程未填，最终高程留空。"
        ]
      });
    } else if (key === "traverseCalc") {
      var gcSet = state.settings.traverseCalc;
      var gcGroup = calcConductorGroup(state.ui.pageIndex.traverseCalc);
      var gcPage = gcGroup.pages[0];
      var gcCalc = TCALC.computePages(gcGroup.pages, gcSet);
      var gcSource = gcPage && gcPage.source ? gcPage.source : {};
      groups.push({
        title: "本表（表G · 导线计算）",
        lines: [
          "一条导线可以跨页：第 1 页是开始页，第 2 页起是续页；每页固定 11 行，整条导线的 fβ、改正数、方位角与坐标一次算完。",
          "开始页首行是已知点：x / y / 方位角是起算数据；续页首行的 x / y / 方位角由上一页推算，不再手填。",
          "首行也可以由 P/T 起算坐标与表四表头的连接角 β1、β2、连接边 d 解算（选项 → 起算数据），解算后一键写入开始页首行的 x / y / 方位角。",
          "角度按「度.分秒」打包输入（45°30′00″ 记作 45.3000）；分、秒都要小于 60，否则该行按无效处理并停算。",
          "fβ = Σβ − (n−2)×180°，限值 ±" + gcSet.fBetaCoef + "″√n。改正数按角数等分反号、不取整；改后角显示到整秒，计算用原值。",
          "转向：" + (gcSet.angleDir === "ccw"
            ? "顺时针（内角在右）：α = α前 + 180° − β。"
            : "逆时针（内角在左）：α = α前 + 180° + β。") + "方位角规范到 0°～360°。",
          "Δx = D·cos α、Δy = D·sin α，取整到 mm；fx = ΣΔx、fy = ΣΔy、f = √(fx²+fy²)，K = f/ΣD ≤ 1/" + gcSet.kDen + "。",
          "坐标改正按边长比例反号分配，逐条取整到 mm，余数给最长边；坐标从首行起逐行累加。",
          "高程只记录，不参与导线闭合，也不检查限差。",
          "带入时按表一站数自动分页；只有表一站数超过本表页容量（每页 11 行）时才截断，并暂停闭合差计算。",
          "「超限」指严格大于允许值：fβ 或 K 正好等于允许值时判合格。"
        ]
      });
      var gcLines = [];
      if (gcSource.capturedAt || gcSource.sourceCount) {
        gcLines.push("本条导线来源：当前项目表一" +
          (gcSource.capturedAt ? "（" + formatCapturedAt(gcSource.capturedAt) + " 带入）" : "") + "。");
        if (gcSource.overflow > 0) {
          gcLines.push("表一导线 " + gcSource.sourceCount + " 站，超过本表 " +
            gcGroup.pages.length + " 页共 " + gcGroup.pages.length * TCALC.ROWS + " 行；只带入了前 " +
            Math.max(0, gcSource.sourceCount - gcSource.overflow) + " 行，闭合差没有计算。");
        }
      } else {
        gcLines.push("本条导线没有来源记录，按手填处理。");
      }
      gcLines.push("本条导线 " + gcGroup.pages.length + " 页；已填 " + gcCalc.used +
        " 行，参与计算 " + gcCalc.n + " 行（" +
        (gcCalc.state === "empty" ? "空白" : (gcCalc.state === "ok" ? "已算全" : "尚未算全")) + "）。");
      gcLines.push(gcCalc.fBetaSec == null ? "fβ 尚未算出。"
        : "fβ = " + signedFixed(gcCalc.fBetaSec, 2) + "″，允许 ±" + gcCalc.fBetaAllowSec.toFixed(2) +
          "″" + (gcCalc.angleOk ? "，合格。" : "，超限。"));
      if (gcCalc.fMm == null) {
        gcLines.push("fx / fy / K 尚未算出：还需要首行方位角、首行坐标，以及连续填满的行。");
      } else {
        gcLines.push("fx = " + signedFixed(gcCalc.fxMm, 0) + " mm，fy = " + signedFixed(gcCalc.fyMm, 0) +
          " mm，f = " + gcCalc.fMm.toFixed(1) + " mm；K = " +
          (gcCalc.kDenActual === Infinity ? "0" : "1/" + Math.floor(gcCalc.kDenActual)) +
          "（要求 ≤ 1/" + gcSet.kDen + "）。");
      }
      groups.push({ title: "来源核对", lines: gcLines });
    } else {
      var limit = state.settings.angle.limit;
      groups.push({
        title: "本表（角度）",
        lines: [
          "左半测回 = 左盘目标② − 目标①（顺时针，负值加 360°）；右半测回同理。",
          "半测回角值之差 = |左 − 右|（秒）；一测回 =（左 + 右）÷ 2。",
          "右盘目标名留空时，若左盘两个目标名已填，自动按反向（②→①）试算；补填目标名后改为按目标名配对。",
          "四个目标名都为空时按行序配对（1↔3、2↔4）；检查面板会提示。",
          "距离只录入；「距离及相对误差」栏留空，按指导书手写。",
          "半测回角值之差参考限差：" + limit + "″（可在「选项」中改）。"
        ]
      });
    }
    groups.push({
      title: "通用",
      lines: [
        "所有缺项、超限、错误提示都是参考，不阻断输入；计算格显示「待填」表示还差必要数据。",
        "「超限」指严格大于限差；计算值恰好等于限差（如 2C = 20″、上限 20″）时不报超限。",
        "「误差色」打开后，带允许误差的计算值按 |误差| ÷ 允许误差 铺底色并换字色：默认（白）≤1×，绿底 1～2×，黄底 2～3×，红底 >3×。",
        "数据只保存在本机，不上传网络；桌面版写入应用数据目录的 store.json。",
        "「导出」生成七表全部页面与设置的 JSON 备份；「导入」会整体替换现有记录，需先确认。",
        "打印只输出真实值：计算格的「待填」「—」「单盘」「缺高」等提示不会印出。表四、表五、表六、表G 按 A4 横向打印。"
      ]
    });
    return groups;
  }

  function renderRules() {
    var rules = el("div", "rules");
    ruleGroups(state.ui.active).forEach(function (group) {
      rules.appendChild(el("h3", "", group.title));
      var list = el("ul");
      group.lines.forEach(function (line) {
        list.appendChild(el("li", "", line));
      });
      rules.appendChild(list);
    });
    return rules;
  }

  function renderCheck(preserveScroll) {
    if (!checksOpen || !analysis || !dom.checkBody) return;
    var scrollTop = preserveScroll ? dom.checkBody.scrollTop : 0;
    dom.checkBody.textContent = "";
    dom.checkSummary.textContent = "";

    if (!analysis.hasMeasurements && analysis.counts.actionable === 0) {
      dom.checkSummary.textContent = "本表尚未录入读数；空白表格不提示。";
    } else {
      dom.checkSummary.appendChild(summaryLine(analysis.counts, analysis.pages.length));
    }

    updateCheckTabs();
    if (checksTab === "rules") {
      dom.checkBody.appendChild(renderRules());
    } else {
      var issues = [];
      analysis.pages.forEach(function (page) {
        page.issues.forEach(function (issue) { issues.push(issue); });
      });
      issues.sort(function (a, b) {
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return compareIssues(a, b);
      });
      dom.checkBody.appendChild(renderIssuesBody(issues));
    }
    dom.checkBody.scrollTop = scrollTop;
  }

  function setChecksOpen(open) {
    var focusInside = !!(dom.checkPanel && dom.checkPanel.contains(document.activeElement));
    checksOpen = !!open;
    if (dom.checkPanel) dom.checkPanel.hidden = !checksOpen;
    if (checksOpen) {
      renderCheck(false);
    }
    if (dom.checkBtn) {
      dom.checkBtn.setAttribute("aria-expanded", checksOpen ? "true" : "false");
      dom.checkBtn.classList.toggle("is-open", checksOpen);
    }
    if (dom.statusChip) dom.statusChip.setAttribute("aria-expanded", checksOpen ? "true" : "false");
    if (!checksOpen && focusInside && dom.checkBtn) {
      try { dom.checkBtn.focus(); } catch (err) { /* ignore */ }
    }
    scheduleFit();
  }

  function openChecks(tab) {
    if (tab) checksTab = tab;
    setChecksOpen(true);
  }

  function jumpToIssue(issue) {
    if (!issue || !analysis) return;
    var key = state.ui.active;
    var pages = state.pages[key];
    if (!pages[issue.pageIndex]) return;
    state.ui.pageIndex[key] = issue.pageIndex;
    saveNow(true);
    setChecksOpen(false);
    renderStage();
    updateTabs();
    updatePager();
    var focusCell = issue.focusCell;
    var focusMethod = focusCell && runtime.focusMethods[focusCell];
    if (!focusMethod) {
      for (var i = 0; i < issue.cellIds.length; i += 1) {
        if (runtime.focusMethods[issue.cellIds[i]]) {
          focusCell = issue.cellIds[i];
          focusMethod = runtime.focusMethods[focusCell];
          break;
        }
      }
    }
    setTimeout(function () {
      if (!runtime) return;
      fitSheet();
      var node = focusCell ? runtime.nodes[focusCell] : null;
      if (node && node.scrollIntoView) {
        try { node.scrollIntoView({ block: "center", inline: "nearest" }); } catch (err) { node.scrollIntoView(); }
      }
      if (focusMethod) focusMethod();
    }, 40);
  }

  /* ------------------------------------------------------------------ *
   * 外壳状态 / 翻页
   * ------------------------------------------------------------------ */

  function updateTabs() {
    $all("#tabs .tab[data-table]").forEach(function (button) {
      var key = button.getAttribute("data-table");
      var active = activeModule === key && state.ui.active === key;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.classList.toggle("is-active", active);
      button.tabIndex = active ? 0 : -1;
    });
    if (dom.aiTab) {
      var aiActive = activeModule === "assistant";
      dom.aiTab.setAttribute("aria-selected", aiActive ? "true" : "false");
      dom.aiTab.classList.toggle("is-active", aiActive);
      dom.aiTab.tabIndex = aiActive ? 0 : -1;
    }
    if (dom.linkageTab) {
      var enabled = linkageEnabled();
      var linkActive = enabled && activeModule === "linkage";
      dom.linkageTab.hidden = !enabled;
      dom.linkageTab.setAttribute("aria-selected", linkActive ? "true" : "false");
      dom.linkageTab.classList.toggle("is-active", linkActive);
      dom.linkageTab.tabIndex = linkActive ? 0 : -1;
    }
  }

  function applyModuleChrome() {
    var assistant = activeModule === "assistant";
    var linkage = activeModule === "linkage";
    var stageHidden = assistant || linkage;
    if (dom.app) {
      dom.app.classList.toggle("is-assistant", assistant);
      dom.app.classList.toggle("is-linkage", linkage);
    }
    if (dom.assistant) dom.assistant.hidden = !assistant;
    if (dom.linkage) dom.linkage.hidden = !linkage;
    if (dom.stage) {
      dom.stage.inert = stageHidden;
      dom.stage.setAttribute("aria-hidden", stageHidden ? "true" : "false");
    }
    if (dom.bottombar) dom.bottombar.inert = stageHidden;
    if (dom.tableTools) {
      dom.tableTools.inert = stageHidden;
      dom.tableTools.setAttribute("aria-hidden", stageHidden ? "true" : "false");
    }
    if (dom.moduleNote) dom.moduleNote.hidden = !assistant;
  }

  function setTraverseMode(mode) {
    if (mode !== "VA" && mode !== "ZA") return;
    if (state.settings.traverse.mode === mode) return;
    state.settings.traverse.mode = mode;
    saveNow(false);
    renderQuickOptions();
    renderStage();
    if (drawerOpen) renderDrawer(true);
    if (mode === "ZA" && traverseHasNegativeVertical()) {
      toast("已切换到天顶距（ZA）。已有负竖直角会被标红，数据未改动。");
    }
  }

  function setTrigRoute(value) {
    var closed = value !== "open";
    if (closed === (state.settings.trigSummary.closed !== false)) return;
    state.settings.trigSummary.closed = closed;
    saveNow(false);
    renderQuickOptions();
    renderStage();
    updatePager();
    if (drawerOpen) renderDrawer(true);
    toast(closed
      ? "表六已切到闭合回起点：最后一站接回第 1 站，按闭合差平差。"
      : "表六已切到非闭合：最后一站没有回程边，改正值按 0 计。", "ok");
  }

  function traverseHasNegativeVertical() {
    var pages = state.pages.traverse;
    for (var p = 0; p < pages.length; p += 1) {
      for (var s = 0; s < pages[p].stations.length; s += 1) {
        var targets = pages[p].stations[s].targets;
        for (var t = 0; t < targets.length; t += 1) {
          for (var f = 0; f < 2; f += 1) {
            var parts = targets[t].readings[f === 0 ? "L" : "R"].v;
            if (str(parts.d).charAt(0) === "-") return true;
          }
        }
      }
    }
    return false;
  }

  function setLevelingGrade(grade) {
    if (grade !== "III" && grade !== "IV") return;
    if (state.settings.leveling.grade === grade) return;
    state.settings.leveling.grade = grade;
    saveNow(false);
    renderQuickOptions();
    renderStage();
    if (drawerOpen) renderDrawer(true);
  }

  function setCalcConnDir(value) {
    if (value !== "left" && value !== "right") return;
    if (state.settings.traverseCalc.connDir === value) return;
    state.settings.traverseCalc.connDir = value;
    saveNow(false);
    if (drawerOpen) renderDrawer(true);
    toast(value === "right"
      ? "连接角按右角解算：α_P1 = α_PT + β1，α_12 = α_P1 + 180° + β2。"
      : "连接角按左角解算：α_P1 = α_PT − β1，α_12 = α_P1 + 180° − β2。", "ok");
  }

  // 表G 页角色：续页接在上一页之后，开始页另起一条导线。第 1 页永远是开始页。
  function setCalcPageRole(value) {
    var key = "traverseCalc";
    var index = state.ui.pageIndex[key];
    if (index <= 0) {
      if (value === "start") toast("第 1 页永远是开始页。");
      return;
    }
    var page = state.pages[key][index];
    var role = value === "cont" ? "cont" : "start";
    if ((page.role === "cont" ? "cont" : "start") === role) return;
    page.role = role;
    saveNow(false);
    renderStage();
    updatePager();
    if (drawerOpen) renderDrawer(true);
    toast(role === "cont"
      ? "本页已改为续页：首行 X / Y / 方位角由上一页推算，本页原有的这三格不再参与计算。"
      : "本页已改为独立导线的开始页：首行 X / Y / 方位角需要自己填写或解算。", "ok");
  }

  function setCalcAngleDir(value) {
    if (value !== "cw" && value !== "ccw") return;
    if (state.settings.traverseCalc.angleDir === value) return;
    state.settings.traverseCalc.angleDir = value;
    saveNow(false);
    renderQuickOptions();
    renderStage();
    if (drawerOpen) renderDrawer(true);
    toast(value === "ccw"
      ? "表G 已切到顺时针：内角在导线右侧，α = α前 + 180° − β。"
      : "表G 已切到逆时针：内角在导线左侧，α = α前 + 180° + β。", "ok");
  }

  function quickClick(value) {
    if (state.ui.active === "traverse") setTraverseMode(value);
    else if (state.ui.active === "leveling") setLevelingGrade(value);
    else if (state.ui.active === "trigSummary") setTrigRoute(value);
    else if (state.ui.active === "traverseCalc") setCalcAngleDir(value);
  }

  function renderQuickOptions() {
    if (!dom.quick) return;
    dom.quick.textContent = "";
    var key = state.ui.active;
    var defs = null;
    var current = null;
    if (key === "traverse") {
      defs = [{ value: "VA", label: "VA" }, { value: "ZA", label: "ZA" }];
      current = state.settings.traverse.mode;
    } else if (key === "leveling") {
      defs = [{ value: "III", label: "三等" }, { value: "IV", label: "四等" }];
      current = state.settings.leveling.grade;
    } else if (key === "traverseCalc") {
      defs = [{ value: "ccw", label: "顺时针" }, { value: "cw", label: "逆时针" }];
      current = state.settings.traverseCalc.angleDir;
    } else if (key === "traverseSummary" || key === "levelingSummary" || key === "trigSummary") {
      if (key === "trigSummary") {
        defs = [{ value: "closed", label: "闭合回起点" }, { value: "open", label: "非闭合" }];
        current = state.settings.trigSummary.closed !== false ? "closed" : "open";
      } else {
        var source = key === "levelingSummary" ? "表二" : "表一";
        var fixedSummary = el("span", "quick-fixed", "按" + source + "自动汇总 · 只读");
        fixedSummary.title = key === "traverseSummary"
          ? "表四逐行取表一已开始的测站；正文全部自动推导，不能手填"
          : "表五每页 8 人，每人 4 段切分表二页面；正文全部自动推导，不能手填";
        dom.quick.appendChild(fixedSummary);
      }
    } else {
      // 表三只使用统一字体，不再提供宋体切换。
      var fixed = el("span", "quick-fixed", LITE ? "系统字体" : "HarmonyOS 字体");
      fixed.title = LITE
        ? "表三统一使用系统字体，与表一、表二一致"
        : "表三统一使用 HarmonyOS Sans SC，与表一、表二一致";
      dom.quick.appendChild(fixed);
    }
    if (defs) {
      defs.forEach(function (item) {
        var button = el("button", item.value === current ? "is-active" : "", item.label);
        button.type = "button";
        button.setAttribute("aria-pressed", item.value === current ? "true" : "false");
        button.addEventListener("click", function () { quickClick(item.value); });
        dom.quick.appendChild(button);
      });
    }

    if (key === "traverseCalc") {
      dom.quick.appendChild(el("span", "quick-sep"));
      var startBtn = el("button", coordsFilled() ? "is-active" : "", "起算数据");
      startBtn.type = "button";
      startBtn.title = "P/T 起算坐标与表四的 β1 / β2 / d：解算首行 X / Y / 方位角（续页会先回到开始页）";
      startBtn.addEventListener("click", function () {
        var group = calcConductorGroup(state.ui.pageIndex.traverseCalc);
        if (state.ui.pageIndex.traverseCalc !== group.start) gotoPage(group.start);
        openDrawer();
      });
      dom.quick.appendChild(startBtn);
    }

    if (key === "traverse" || key === "angle") {
      dom.quick.appendChild(el("span", "quick-sep"));
      var on = linkageEnabled();
      var toggle = el("button", on ? "is-active" : "", on ? "联立 开" : "联立 关");
      toggle.type = "button";
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      toggle.title = on
        ? "表一正在联立表三；点击关闭（表三数值保留）"
        : "开启表一 → 表三联立，并显示联立映射表";
      toggle.addEventListener("click", function () { setLinkageEnabled(!linkageEnabled()); });
      dom.quick.appendChild(toggle);
    }

    var labels = {
      traverse: "表一快捷选项",
      leveling: "表二快捷选项",
      angle: "表三快捷选项，字体固定为 " + (LITE ? "系统字体" : "HarmonyOS") + "，可切换联立",
      traverseSummary: "表四自动汇总",
      levelingSummary: "表五自动汇总；表二每页的归属在底栏设置",
      trigSummary: "表六自动汇总；可切换闭合回起点或非闭合",
      traverseCalc: "表G 导线计算；可切换顺时针/逆时针，起算数据在选项里"
    };
    dom.quick.setAttribute("aria-label", labels[key] || "本表快捷选项");
  }

  function ownerChipLabel() {
    if (!levelingOwnerModeActive()) return "归属：按页块";
    var page = state.pages.leveling[state.ui.pageIndex.leveling];
    var owner = SC.normalizeOwner(page && page.owner);
    if (!owner) return "归属：未设置";
    return "第 " + owner.person + " 人 · " + SC.LEG_LABELS[owner.leg];
  }

  function updateOwnerChip(key) {
    if (!dom.ownerChip) return;
    if (key !== "leveling") {
      dom.ownerChip.hidden = true;
      closeOwnerPopover();
      return;
    }
    dom.ownerChip.hidden = false;
    dom.ownerChip.textContent = ownerChipLabel();
    dom.ownerChip.title = levelingOwnerModeActive()
      ? "本页在表五中的归属；点此选择第几人的第几段"
      : "现在按页块规则自动分给表五；点此改为逐页归属";
  }

  function openOwnerPopover() {
    if (state.ui.active !== "leveling" || !dom.ownerPopover) return;
    ownerPopoverOpen = true;
    dom.ownerPopover.hidden = false;
    if (dom.ownerChip) dom.ownerChip.setAttribute("aria-expanded", "true");
    renderOwnerPopover();
  }

  function closeOwnerPopover() {
    if (!ownerPopoverOpen) return;
    ownerPopoverOpen = false;
    if (dom.ownerPopover) dom.ownerPopover.hidden = true;
    if (dom.ownerChip) dom.ownerChip.setAttribute("aria-expanded", "false");
  }

  function renderOwnerPopover() {
    if (!ownerPopoverOpen || !dom.ownerPopoverBody) return;
    var body = dom.ownerPopoverBody;
    body.textContent = "";
    var index = state.ui.pageIndex.leveling;
    var page = state.pages.leveling[index];
    var ownerMode = levelingOwnerModeActive();

    if (!ownerMode) {
      body.appendChild(el("p", "owner-note",
        "表二现在按旧「页块」规则自动分给表五：每人 4 段，每段 " +
        state.settings.levelingSummary.legPages + " 页。开启逐页归属后，每张表二页可以单独选择第几人的第几段。"));
      var convert = el("button", "owner-primary", "改为逐页归属");
      convert.type = "button";
      convert.addEventListener("click", function () {
        materializeLevelingOwners();
        saveNow(false);
        recompute();
        updatePager();
        if (drawerOpen) renderDrawer(true);
        renderOwnerPopover();
        toast("已改为逐页归属：现有 " + state.pages.leveling.length + " 页按原页块规则补齐。", "ok");
      });
      body.appendChild(convert);
      body.appendChild(el("p", "owner-note", "补齐后计算结果不变；之后就可以逐页调整。"));
      return;
    }

    var stored = SC.normalizeOwner(page && page.owner);
    var previous = index > 0 ? SC.normalizeOwner(state.pages.leveling[index - 1] && state.pages.leveling[index - 1].owner) : null;
    var draft = stored || previous || blockLevelingOwner(index, state.settings.levelingSummary.legPages);

    body.appendChild(stored
      ? el("p", "owner-note", "本页归属：第 " + stored.person + " 人 · " + SC.LEG_LABELS[stored.leg] + "。")
      : el("p", "owner-note owner-note-warn", "本页还没有归属，不参与表五汇总。"));

    var personRow = el("div", "owner-person");
    var minus = el("button", "owner-step", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", "上一段");
    minus.disabled = draft.person <= 1 && draft.leg === 0;
    minus.addEventListener("click", function () {
      setLevelingOwner(stepLevelingOwner(draft, -1));
    });
    var personLabel = el("label", "owner-person-label");
    personLabel.appendChild(document.createTextNode("第"));
    var input = el("input", "owner-person-input");
    input.type = "number";
    input.min = "1";
    input.max = String(SC.MAX_PEOPLE);
    input.step = "1";
    input.value = String(draft.person);
    input.setAttribute("aria-label", "人员序号");
    input.addEventListener("change", function () {
      var n = Math.floor(Number(input.value));
      if (!Number.isFinite(n)) {
        renderOwnerPopover();
        return;
      }
      n = Math.min(SC.MAX_PEOPLE, Math.max(1, n));
      setLevelingOwner({ person: n, leg: draft.leg });
    });
    personLabel.appendChild(input);
    personLabel.appendChild(document.createTextNode("人"));
    var plus = el("button", "owner-step", "＋");
    plus.type = "button";
    plus.setAttribute("aria-label", "下一段");
    plus.disabled = draft.person >= SC.MAX_PEOPLE && draft.leg === SC.LEGS_PER_PERSON - 1;
    plus.addEventListener("click", function () {
      setLevelingOwner(stepLevelingOwner(draft, 1));
    });
    personRow.appendChild(minus);
    personRow.appendChild(personLabel);
    personRow.appendChild(plus);
    body.appendChild(personRow);

    var legs = el("div", "owner-legs");
    SC.LEG_LABELS.forEach(function (label, leg) {
      var active = !!stored && stored.person === draft.person && stored.leg === leg;
      var button = el("button", "owner-leg" + (active ? " is-active" : ""), label);
      button.type = "button";
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.addEventListener("click", function () {
        setLevelingOwner({ person: draft.person, leg: leg });
      });
      legs.appendChild(button);
    });
    body.appendChild(legs);

    var navRow = el("div", "owner-nav");
    var prev = el("button", "owner-nav-btn", "上一段");
    prev.type = "button";
    prev.addEventListener("click", function () { setLevelingOwner(stepLevelingOwner(draft, -1)); });
    var next = el("button", "owner-nav-btn", "下一段");
    next.type = "button";
    next.addEventListener("click", function () { setLevelingOwner(stepLevelingOwner(draft, 1)); });
    navRow.appendChild(prev);
    navRow.appendChild(next);
    body.appendChild(navRow);

    if (stored) {
      var clear = el("button", "owner-clear", "本页不归属（不参与表五汇总）");
      clear.type = "button";
      clear.addEventListener("click", function () { setLevelingOwner(null); });
      body.appendChild(clear);
    }

    body.appendChild(el("p", "owner-note",
      "一张表二页最多 8 个测站，每人 7 组信息正好占一页。同一人同一段可以有多页，表五会把它们合计；" +
      "若某人的测站在本页跨了段，就把另一段另起一页单独标归属。新增表二页时沿用当前页的归属。"));
  }

  function updatePager() {
    var key = state.ui.active;
    var pages = state.pages[key];
    var index = state.ui.pageIndex[key];
    var linkedAngle = key === "angle" && linkageEnabled();
    updateOwnerChip(key);
    if (key === "traverseSummary") {
      dom.pageLabel.textContent = "唯一页 · 自动汇总";
      dom.prevPage.disabled = true;
      dom.nextPage.disabled = true;
      dom.deletePage.disabled = true;
      dom.addPage.disabled = true;
      dom.addPage.title = "表四固定一页，页数由表一数据量决定";
      dom.deletePage.title = "表四固定一页，不能删除";
      return;
    }
    dom.pageLabel.textContent = "第 " + (index + 1) + " / " + pages.length + " 页";
    dom.prevPage.disabled = index <= 0;
    dom.nextPage.disabled = index >= pages.length - 1;
    dom.deletePage.disabled = pages.length <= 1 || linkedAngle;
    dom.addPage.disabled = linkedAngle;
    if (key === "levelingSummary") {
      var personStart = index * SC.LEVELING_ROWS + 1;
      var personEnd = personStart + SC.LEVELING_ROWS - 1;
      dom.pageLabel.textContent += " · 第 " + personStart + "–" + personEnd + " 人";
      dom.addPage.title = "在表五末尾新增一页（再汇总 8 人）";
      dom.deletePage.title = "删除本页：只移除本页姓名与人员映射，表二数据不动";
      return;
    }
    if (key === "trigSummary") {
      var edgeStart = index * SC.TRIG_ROWS + 1;
      var edgeEnd = edgeStart + SC.TRIG_ROWS - 1;
      dom.pageLabel.textContent += " · 第 " + edgeStart + "–" + edgeEnd + " 条边";
      dom.addPage.title = "在表六末尾新增一页（再接 17 条边；起点高程仍在第 1 页填）";
      dom.deletePage.title = "删除本页：正文由表一自动推导，删除只影响纸张分配";
      return;
    }
    if (key === "traverseCalc") {
      var calcGroup = calcConductorGroup(index);
      var calcOffset = index - calcGroup.start;
      var calcFrom = calcOffset * TCALC.ROWS + 1;
      // 用「连续参与计算的行数」而不是总填充数：中间有空行时，它后面的数据不参与，
      // 分页标签不能把它们算成本页已用的站。
      var calcUsed = TCALC.computePages(calcGroup.pages, state.settings.traverseCalc).used;
      var calcPageHasData = (pages[index].rows || []).some(function (row, r) {
        return traverseCalcRowIsCalcData(row, pages[index].role === "cont", r === 0);
      });
      if (!calcPageHasData) {
        dom.pageLabel.textContent += " · 第 " + calcFrom + "–" +
          (calcFrom + TCALC.ROWS - 1) + " 站（空白）";
      } else if (calcFrom > calcUsed) {
        dom.pageLabel.textContent += " · 第 " + calcFrom + " 站起（未参与计算）";
      } else {
        var calcTo = Math.min(calcFrom + TCALC.ROWS - 1, calcUsed);
        dom.pageLabel.textContent += calcTo > calcFrom
          ? " · 第 " + calcFrom + "–" + calcTo + " 站"
          : " · 第 " + calcFrom + " 站";
      }
      dom.addPage.title = "在表G 末尾新增一页（默认接续当前导线，每页 11 站；要另起导线在选项里切）";
      dom.deletePage.title = pages[index].role === "cont"
        ? "删除本页：本页是续页，后面的续页会前移 11 站"
        : "删除本页：本页是开始页，后面的续页会成为新的开始页";
      return;
    }
    dom.addPage.title = linkedAngle
      ? "联立期间表三页数由表一与映射决定，不能手动新增页"
      : "在本表末尾新增一页（站数固定）";
    dom.deletePage.title = linkedAngle
      ? "联立期间表三页数与表一联动，不能手动删除页；先解除联立"
      : "删除本页";
  }

  function gotoPage(index) {
    var key = state.ui.active;
    var pages = state.pages[key];
    index = clamp(Math.floor(index), 0, pages.length - 1);
    if (index === state.ui.pageIndex[key]) return;
    state.ui.pageIndex[key] = index;
    saveNow(true);
    renderStage();
    updateTabs();
    updatePager();
    dom.stage.scrollTop = 0;
  }

  function setActiveModule(module) {
    if (LITE && module === "assistant") return false;
    if (module !== "assistant" && module !== "linkage" && !TABLES[module]) return false;
    if (module === "linkage" && !linkageEnabled()) return false;
    var same = module === activeModule &&
      (module === "assistant" || module === "linkage" || state.ui.active === module);
    if (same) {
      applyModuleChrome();
      updateTabs();
      if (module === "linkage") renderLinkage();
      return true;
    }
    var focused = document.activeElement;
    if (focused && focused.blur && !(dom.tabs && dom.tabs.contains(focused))) focused.blur();
    activeModule = module;
    STORE.setActiveModule(module);

    if (module === "assistant") {
      closeDrawer();
      setChecksOpen(false);
      applyModuleChrome();
      updateTabs();
      notifyModuleChanged();
      return true;
    }

    if (module === "linkage") {
      closeDrawer();
      setChecksOpen(false);
      applyModuleChrome();
      updateTabs();
      renderLinkage();
      if (dom.linkage) dom.linkage.scrollTop = 0;
      notifyModuleChanged();
      return true;
    }

    state.ui.active = module;
    renderQuickOptions();
    applyModuleChrome();
    updateTabs();
    renderStage();
    updatePager();
    dom.stage.scrollTop = 0;
    // 提示挂在「用户主动切到表六」上，避免启动迁移提示/助手页把一次性名额吃掉。
    if (module === "trigSummary") maybeOfferCoordsHint();
    saveNow(false);
    notifyModuleChanged();
    return true;
  }

  function setActiveTable(key) {
    if (!TABLES[key]) return false;
    return setActiveModule(key);
  }

  /* ------------------------------------------------------------------ *
   * 项目
   * ------------------------------------------------------------------ */

  function activeProjectName() {
    var project = STORE.getActiveProject();
    return project ? project.name : "默认项目";
  }

  function notifyProjectsChanged() {
    try {
      document.dispatchEvent(new CustomEvent("jujin:projects-changed"));
    } catch (err) { /* 旧环境没有 CustomEvent 时忽略 */ }
  }

  function notifyModuleChanged() {
    try {
      document.dispatchEvent(new CustomEvent("jujin:module-changed", {
        detail: { module: activeModule }
      }));
    } catch (err) { /* 旧环境没有 CustomEvent 时忽略 */ }
  }

  function notifyWorkspaceDeleted(id) {
    try {
      document.dispatchEvent(new CustomEvent("jujin:workspace-deleted", {
        detail: { id: String(id || "") }
      }));
    } catch (err) { /* 旧环境没有 CustomEvent 时忽略 */ }
  }

  function normalizeProjectState(project) {
    var raw = project && project.state ? project.state : makeDefaultState();
    return normalizeState(raw, { strict: false, resetScale: true });
  }

  function showProject(project, options) {
    options = options || {};
    var scaleRevisionMissing = !!(project && project.state) && projectNeedsScaleRevision(project);
    state = normalizeProjectState(project);
    if (options.forceTable) {
      activeModule = state.ui.active;
    } else if (activeModule === "assistant" && !LITE) {
      activeModule = "assistant";
    } else if (activeModule === "linkage" && linkageEnabled()) {
      activeModule = "linkage";
    } else {
      activeModule = state.ui.active;
    }
    STORE.setActiveModule(activeModule);
    if (linkageEnabled()) runLinkageSync({ render: false });
    closeDrawer();
    setChecksOpen(false);
    renderAll();
    if (dom.stage) dom.stage.scrollTop = 0;
    if (activeModule !== "linkage") scheduleFit();
    if (scaleRevisionMissing) saveNow(true);
    notifyProjectsChanged();
    notifyModuleChanged();
  }

  function switchProject(id) {
    if (!id || id === STORE.getActiveProjectId()) return false;
    flushSave();
    var project = STORE.switchProject(id);
    if (!project) return false;
    showProject(project, { forceTable: false });
    setSaveStatus("已切换到项目「" + project.name + "」", false);
    return true;
  }

  function createProject(name) {
    flushSave();
    var project = STORE.createProject(name, makeDefaultState());
    showProject(project, { forceTable: true });
    setSaveStatus("已新建项目「" + project.name + "」", false);
    return project;
  }

  function duplicateProject(name) {
    flushSave();
    var project = STORE.duplicateProject(STORE.getActiveProjectId(), name);
    if (!project) return null;
    showProject(project, { forceTable: true });
    setSaveStatus("已复制为「" + project.name + "」", false);
    return project;
  }

  function renameProject(id, name) {
    var project = STORE.renameProject(id, name);
    if (project) {
      if (id === STORE.getActiveProjectId()) {
        setSaveStatus("项目已重命名为「" + project.name + "」", false);
      }
      notifyProjectsChanged();
    }
    return project;
  }

  function deleteProject(id) {
    if (STORE.listProjects().length <= 1) return { ok: false, reason: "last" };
    flushSave();
    noteDestructive("delete-project");
    var wasActive = id === STORE.getActiveProjectId();
    var result = STORE.deleteProject(id);
    if (!result.ok) return result;
    if (wasActive) {
      var project = STORE.getActiveProject();
      if (project) showProject(project, { forceTable: false });
      setSaveStatus("当前项目已删除", false);
    } else {
      notifyProjectsChanged();
    }
    notifyWorkspaceDeleted(id);
    return result;
  }

  function projectList() {
    return STORE.listProjects();
  }

  function renderAll() {
    if (activeModule === "linkage" && !linkageEnabled()) activeModule = state.ui.active;
    updateTabs();
    renderQuickOptions();
    applyModuleChrome();
    if (activeModule === "linkage") renderLinkage();
    else renderStage();
    updatePager();
  }

  /* ------------------------------------------------------------------ *
   * 提示 / 模态
   * ------------------------------------------------------------------ */

  function toast(message, kind) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.className = kind === "error" ? "is-error" : (kind === "ok" ? "is-ok" : "");
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      if (dom.toast) dom.toast.hidden = true;
    }, 3200);
  }

  function openModal(options) {
    if (modalResolve) return Promise.resolve(null);
    options = options || {};
    return new Promise(function (resolve) {
      modalResolve = resolve;
      modalLastFocus = document.activeElement;
      modalAppInert = !!dom.app.inert;
      modalDrawerInert = !!dom.drawer.inert;
      dom.app.inert = true;
      dom.drawer.inert = true;

      dom.modalTitle.textContent = options.title || "请确认";
      dom.modalMessage.textContent = options.message || "";
      dom.modalActions.textContent = "";
      var actions = options.actions || [];
      actions.forEach(function (action) {
        var button = el("button", action.kind || "", action.label || "确定");
        button.type = "button";
        button.addEventListener("click", function () { settleModal(action.value); });
        dom.modalActions.appendChild(button);
      });
      dom.modalBackdrop.hidden = false;
      var buttons = dom.modalActions.querySelectorAll("button");
      var focusIndex = options.focusIndex == null ? 0 : options.focusIndex;
      if (buttons[focusIndex]) {
        setTimeout(function () {
          if (modalResolve && buttons[focusIndex]) {
            try { buttons[focusIndex].focus(); } catch (err) { /* ignore */ }
          }
        }, 0);
      }
    });
  }

  function settleModal(value) {
    if (!modalResolve) return;
    var resolve = modalResolve;
    modalResolve = null;
    dom.modalBackdrop.hidden = true;
    dom.modalActions.textContent = "";
    dom.app.inert = modalAppInert;
    dom.drawer.inert = modalDrawerInert;
    if (modalLastFocus && document.contains(modalLastFocus)) {
      try { modalLastFocus.focus(); } catch (err) { /* ignore */ }
    }
    modalLastFocus = null;
    resolve(value);
  }

  function confirmDialog(title, message, options) {
    options = options || {};
    return openModal({
      title: title,
      message: message,
      actions: [
        { value: false, label: "取消" },
        { value: true, label: options.confirmLabel || "确定", kind: options.danger ? "danger" : "primary" }
      ],
      focusIndex: options.danger ? 0 : 1
    });
  }

  function choiceDialog(title, message, choices) {
    var actions = choices.map(function (choice) {
      return { value: choice.value, label: choice.label, kind: choice.kind || "" };
    });
    actions.push({ value: null, label: "取消" });
    return openModal({ title: title, message: message, actions: actions, focusIndex: 0 });
  }

  /* ------------------------------------------------------------------ *
   * 选项抽屉
   * ------------------------------------------------------------------ */

  function drawerSection(title, hint) {
    var section = el("section", "setting-section");
    var heading = el("h3", "", title);
    if (hint) heading.appendChild(el("span", "hint-inline", hint));
    section.appendChild(heading);
    return section;
  }

  function drawerNote(section, text, className) {
    var note = el("p", "setting-note" + (className ? " " + className : ""), text);
    section.appendChild(note);
    return note;
  }

  function drawerSegmented(items, current, onPick) {
    var wrap = el("div", "segmented");
    items.forEach(function (item) {
      var button = el("button", item.value === current ? "is-active" : "", item.label);
      button.type = "button";
      button.setAttribute("aria-pressed", item.value === current ? "true" : "false");
      button.addEventListener("click", function () { onPick(item.value); });
      wrap.appendChild(button);
    });
    return wrap;
  }

  function numberField(grid, labelText, getCurrent, unit, min, max, step, commit) {
    var label = el("label");
    label.appendChild(document.createTextNode(labelText));
    var input = el("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(getCurrent());
    input.addEventListener("change", function () {
      var n = Number(input.value);
      if (!Number.isFinite(n) || n < min || n > max) {
        input.value = String(getCurrent());
        toast("该限差需在 " + min + " 到 " + max + " 之间。", "error");
        return;
      }
      commit(n);
    });
    label.appendChild(input);
    label.appendChild(el("span", "unit", unit));
    grid.appendChild(label);
    return input;
  }

  // 抽屉里的自由文本格：起算坐标要允许只填整数部分、允许留空，不能用 numberField。
  function textField(grid, labelText, inputmode, placeholder, onInput) {
    var label = el("label");
    label.appendChild(document.createTextNode(labelText));
    var input = el("input");
    input.type = "text";
    input.inputMode = inputmode || "text";
    input.placeholder = placeholder || "";
    input.addEventListener("input", function () {
      if (typeof onInput === "function") onInput(input.value);
    });
    label.appendChild(input);
    grid.appendChild(label);
    return input;
  }

  function addDisplaySection(body, key) {
    var section = drawerSection("显示");
    section.appendChild(drawerSegmented([
      { value: "page", label: "整表" },
      { value: "width", label: "适宽" }
    ], state.ui.zoom[key], function (value) { setZoom(value); }));
    drawerNote(section, "「整表」按窗口内完整表格计算基准宽度；「适宽」按窗口宽度计算基准宽度，可上下滚动。每张表的 100% 是这个基准再乘各自的校准倍率（" + SCALE_BASE_TEXT + "），所以「整表」下的 100% 可能比窗口大。底栏百分比相对各自的 100% 计算，可直接输入 60–500 的整数：回车或点开别处生效，Esc 取消。在表格上捏合触控板，或按住右键滚动滚轮，或按住 Ctrl 滚动滚轮，都能围绕指针缩放；普通滚轮仍是滚动表格。键盘 Ctrl + = / - 每次 10%，Ctrl + 0 回到 100%。打印仍按纸面尺寸输出。");
    body.appendChild(section);
  }

  function addLinkageSection(body) {
    var enabled = linkageEnabled();
    var info = STORE.getLinkage();
    var section = drawerSection("联立", "表一 → 表三");
    var row = el("div", "button-row");

    var toggle = el("button", "drawer-btn" + (enabled ? " danger" : " primary"), enabled ? "解除联立" : "开启联立");
    toggle.type = "button";
    toggle.addEventListener("click", function () { setLinkageEnabled(!linkageEnabled()); });
    row.appendChild(toggle);

    var open = el("button", "drawer-btn", "联立映射表");
    open.type = "button";
    open.disabled = !enabled;
    open.title = enabled ? "打开独立的联立映射表" : "开启联立后才会出现映射表";
    open.addEventListener("click", function () {
      closeDrawer();
      setActiveModule("linkage");
    });
    row.appendChild(open);
    section.appendChild(row);

    drawerNote(section, enabled
      ? "联立中：表三数据格只读，表头仍可编辑。映射表可逐站改表三位置与目标配对；解除联立后表三数值保留并可编辑。"
      : "开启后，表一每个测站按映射表写入表三；联立期间表三只读，顶部才会出现「联立映射」标签页。");
    if (info.backup) {
      drawerNote(section, linkageBackupText(info) + "可在联立映射表里恢复。");
    }
    body.appendChild(section);
  }

  function addAppearanceSection(body) {
    var section = drawerSection("外观", "全局");
    if (!THEME) {
      drawerNote(section, "主题模块未载入；当前固定使用白色主题。请确认 assets/theme.js 存在。");
      body.appendChild(section);
      return;
    }
    section.appendChild(drawerSegmented([
      { value: "light", label: "白" },
      { value: "dark", label: "黑" },
      { value: "system", label: "跟随系统" }
    ], THEME.getPreference(), function (value) {
      THEME.setPreferenceAnimated(value, function () {
        renderDrawer(true);
      });
    }));
    drawerNote(section, "只改界面配色，不改表格数据，也不影响打印；选择记在本机，切换项目不变。跟随系统只跟随 Windows 的深/浅色应用模式，不跟随护眼模式的暖色滤镜。");
    body.appendChild(section);
  }

  function addDataSection(body) {
    var key = state.ui.active;
    var section = drawerSection("数据", nativeMode() ? "本机文件" : "本机");

    var exportRow = el("div", "button-row");
    var exportTableBtn = el("button", "drawer-btn", "导出本表 JSON");
    exportTableBtn.type = "button";
    exportTableBtn.title = "只导出当前表；其余各表在文件里是空白页";
    exportTableBtn.addEventListener("click", exportTableJson);
    exportRow.appendChild(exportTableBtn);

    var exportProjectBtn = el("button", "drawer-btn", "导出整个项目（七表）");
    exportProjectBtn.type = "button";
    exportProjectBtn.title = "七张表一起导出；旧版软件会忽略表G 与汇总表";
    exportProjectBtn.addEventListener("click", exportJson);
    exportRow.appendChild(exportProjectBtn);
    section.appendChild(exportRow);

    var fileRow = el("div", "button-row");
    var importBtn = el("button", "drawer-btn", "导入 JSON");
    importBtn.type = "button";
    importBtn.title = "自动识别单表、七表或全部项目";
    importBtn.addEventListener("click", requestImport);
    fileRow.appendChild(importBtn);

    var linkedAngle = key === "angle" && linkageEnabled();
    var clearText = key === "levelingSummary" ? "清空姓名"
      : (key === "trigSummary" ? "清空备注" : "清空本页");
    var clearBtn = el("button", "drawer-btn danger", clearText);
    clearBtn.type = "button";
    clearBtn.disabled = linkedAngle || key === "traverseSummary";
    if (key === "traverseSummary") clearBtn.title = "表四正文由表一自动推导，没有可清空的正文";
    else if (key === "trigSummary") clearBtn.title = "只清空整列合一的备注，表头保留；正文由表一自动推导";
    else if (linkedAngle) clearBtn.title = "联立期间表三只读；先解除联立再清空";
    else if (key === "levelingSummary") clearBtn.title = "只清空本页 8 个姓名，表头保留";
    else if (key === "traverseCalc") clearBtn.title = "清空本页的来源记录与 11 行数据；表头保留，表一/表六不受影响";
    else clearBtn.title = "清空本页数据";
    clearBtn.addEventListener("click", clearCurrentPage);
    fileRow.appendChild(clearBtn);

    section.appendChild(fileRow);
    drawerNote(section, "单表文件只含当前表，其余各表在文件里是空白页。导入会自动识别单表/七表/全部项目，单表只替换对应表；联立时表一/表三需先解除联立。汇总表不接受正文手填，但可以单独导出/导入表头、姓名与备注。");

    var P = window.JujinPlatform;
    var desktop = !!(P && typeof P.isDesktop === "function" && P.isDesktop());
    if (desktop && nativeMode()) {
      var backupBtn = el("button", "drawer-btn", "打开备份目录");
      backupBtn.type = "button";
      backupBtn.addEventListener("click", openBackupDirectory);
      section.appendChild(backupBtn);
    }

    var note;
    if (nativeMode()) {
      note = "输入即自动写入本机 JSON 文件，并按「最近 20 份 + 每日 1 份 14 天 + 破坏性操作前」自动备份；数据不上传网络。";
    } else if (memoryMode()) {
      note = "本机存储不可用，当前改动只在内存中。请用「导出 JSON」备份；关闭窗口前务必先导出。";
    } else if (storageOk) {
      note = "输入即自动保存在本机浏览器（localStorage，键 survey-jujin.dev.v1），不上传网络。换电脑或换浏览器前请导出备份。";
    } else {
      note = "当前浏览器不允许本地保存；请用「导出 JSON」备份，刷新后本页数据可能丢失。";
    }
    drawerNote(section, note);
    if (desktop && storagePaths && storagePaths.storePath) {
      drawerNote(section, "项目库：" + storagePaths.storePath, "path-note");
      drawerNote(section, "备份目录：" + storagePaths.backupDir, "path-note");
    }
    body.appendChild(section);
  }

  function addKSelect(row, current, onChange) {
    var select = el("select");
    [["4787", "4.787（K₁）"], ["4687", "4.687（K₂）"]].forEach(function (item) {
      var option = el("option", "", item[1]);
      option.value = item[0];
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener("change", function () { onChange(select.value); });
    row.appendChild(select);
  }

  /* ------------------------------------------------------------------ *
   * 表G 数据来源：把当前项目的表一＋表六带进一条导线（可跨页）
   * ------------------------------------------------------------------ */

  // 从当前项目的表一取出全部已开始测站（受页容量限制）。角度取表四口径的
  // 内角（360−观测角），边长取往返平距平均值，与表四同一套数字，避免对不上。
  function buildCalcMapping(withHeights, capacityRows) {
    var capacity = Number.isFinite(capacityRows) && capacityRows > 0
      ? Math.floor(capacityRows)
      : TCALC.ROWS;
    // 表四只铺 17 行；表G 跨页时要按页容量取够行数。
    var summary = SC.traverseRows(state.pages.traverse, state.settings.traverse, { rows: capacity });
    if (!summary.count) {
      return { ok: false, error: "当前项目的表一还没有已开始的测站，无从带入。" };
    }
    var used = Math.min(summary.count, capacity);
    var flat = [];
    var provisional = 0;
    var incomplete = 0;
    var missingNames = 0;
    for (var i = 0; i < used; i += 1) {
      var row = blankCalcRow();
      var src = summary.rows[i];
      if (src) {
        if (src.id.value) row.id = str(src.id.value);
        else missingNames += 1;
        if (src.angle.value != null) row.ang = summaryFixed(src.angle.value, 4);
        if (src.distMean.value != null) row.len = summaryFixed(src.distMean.value, 3);
        if (src.angle.state === "partial" || src.distMean.state === "partial") provisional += 1;
        if (src.angle.value == null || src.distMean.value == null) incomplete += 1;
      }
      flat.push(row);
    }

    var heightsFilled = 0;
    var heightsAvailable = false;
    if (withHeights) {
      var trig = SC.trigRows(state.pages.traverse, state.settings.traverse, {
        sideFormula: state.settings.trigSummary.sideFormula,
        sideLimit: state.settings.trigSummary.sideLimit,
        sideLinear: state.settings.trigSummary.sideLinear,
        closureLimit: state.settings.trigSummary.closureLimit,
        closed: state.settings.trigSummary.closed !== false,
        pageCount: state.pages.trigSummary.length,
        startElev: state.pages.trigSummary[0] && state.pages.trigSummary[0].meta
          ? state.pages.trigSummary[0].meta["start-elev"] : ""
      });
      heightsAvailable = trig.startElev != null;
      if (heightsAvailable) {
        flat[0].h = summaryFixed(trig.startElev, 3);
        heightsFilled += 1;
        // 表G 的一行是一个点：第 j 行的高程 = 表六第 j−1 条边推到的点。
        // 闭合导线的最后一条边回到首点，那一份高程没有对应的表G 行，不写入。
        for (var j = 1; j < used; j += 1) {
          var edge = trig.rows[j - 1];
          if (edge && edge.elev && edge.elev.value != null) {
            flat[j].h = summaryFixed(edge.elev.value, 3);
            heightsFilled += 1;
          }
        }
      }
    }

    var pages = [];
    for (var p = 0; p * TCALC.ROWS < used; p += 1) {
      var rows = [];
      for (var r = 0; r < TCALC.ROWS; r += 1) {
        rows.push(flat[p * TCALC.ROWS + r] || blankCalcRow());
      }
      pages.push(rows);
    }
    if (!pages.length) pages.push([blankCalcRow()]);

    return {
      ok: true,
      pages: pages,
      used: used,
      sourceCount: summary.count,
      overflow: Math.max(0, summary.count - used),
      provisional: provisional,
      incomplete: incomplete,
      missingNames: missingNames,
      heightsRequested: !!withHeights,
      heightsAvailable: heightsAvailable,
      heightsFilled: heightsFilled
    };
  }

  function applyCalcMapping(withHeights) {
    var key = "traverseCalc";
    var index = state.ui.pageIndex[key];
    var pages = state.pages[key];
    var group = calcConductorGroup(index);
    var anchor = group.start;
    var groupLen = group.pages.length;
    // 一条导线必须连续，而且全表不能超过 100 页：两个上限一起夹。
    var maxPages = Math.min(MAX_PAGES - anchor, MAX_PAGES - (pages.length - groupLen));
    var built = buildCalcMapping(withHeights, Math.max(1, maxPages) * TCALC.ROWS);
    if (!built.ok) {
      toast(built.error, "error");
      if (drawerOpen) renderDrawer(true);
      return Promise.resolve(false);
    }
    var commit = function () {
      var needed = built.pages.length;
      var source = {
        capturedAt: new Date().toISOString(),
        sourceCount: built.sourceCount,
        overflow: built.overflow,
        heightCount: built.heightsFilled
      };
      for (var k = 0; k < needed; k += 1) {
        var page = group.pages[k];
        if (!page) {
          page = blankPage(key, anchor + k);
          page.meta = Object.assign({}, group.pages[0].meta);
          pages.splice(anchor + k, 0, page);
        }
        page.role = k === 0 ? "start" : "cont";
        page.rows = built.pages[k];
        page.source = k === 0 ? source : blankCalcSource();
      }
      if (groupLen > needed) pages.splice(anchor + needed, groupLen - needed);
      // 当前页若落在被删掉的续页上，回到开始页。
      if (index > anchor + needed - 1) state.ui.pageIndex[key] = anchor;
      saveNow(false);
      renderStage();
      updateTabs();
      updatePager();
      if (drawerOpen) renderDrawer(true);
      var msg = "已从本项目的表一带入 " + built.used + " 站（" + needed + " 页）";
      if (built.heightsRequested && built.heightsFilled > 0) {
        msg += "、表六高程 " + built.heightsFilled + " 个";
      }
      if (built.overflow > 0) {
        msg += "（表一 " + built.sourceCount + " 站，超过本表 " + needed + " 页容量 " +
          needed * TCALC.ROWS + " 行，只带前 " + built.used + " 站，闭合差未计算）";
      }
      toast(msg + "。", built.overflow > 0 ? "error" : "ok");
      if (built.provisional > 0) {
        toast("源表有 " + built.provisional + " 处单盘或读数未全（暂定值），请回表一核对。", "error");
      }
      if (built.missingNames > 0) {
        toast("源表有 " + built.missingNames + " 个测站没有点名，点号列会留空，角度与坐标照常计算。", "error");
      }
      if (withHeights && !built.heightsAvailable) {
        toast("本项目没有可用的起点高程（表六第 1 页未填），高程列保持空白。", "error");
      }
      return built;
    };
    var filled = calcGroupFilledRows(group);
    if (calcGroupHasData(group)) {
      var extra = Math.max(0, groupLen - built.pages.length);
      var message = "第 " + (anchor + 1) + " 页开始的导线已有数据（共 " + filled +
        " 行，" + groupLen + " 页）。带入会重写前 " + built.pages.length + " 页";
      message += extra > 0
        ? "；多余的 " + extra + " 页续页会删除；表头不动。后面的页会顺延。"
        : "；表头不动。后面的页会顺延。";
      return confirmDialog("带入表一＋表六", message, { confirmLabel: "带入" })
        .then(function (ok) {
          if (!ok) {
            if (drawerOpen) renderDrawer(true);
            return false;
          }
          return commit();
        });
    }
    return Promise.resolve(commit());
  }

  function clearCalcMapping(page) {
    var list = state.pages.traverseCalc;
    var idx = list.indexOf(page);
    var target = idx >= 0 ? calcConductorGroup(idx).pages[0] : page;
    var source = target.source;
    var had = !!(source.capturedAt || source.sourceCount);
    source.capturedAt = "";
    source.sourceCount = 0;
    source.overflow = 0;
    source.heightCount = 0;
    saveNow(false);
    renderStage();
    updatePager();
    if (drawerOpen) renderDrawer(true);
    if (had) toast("已清除本条导线的来源记录；数据保留，可直接手改。", "ok");
  }

  function renderDrawer(preserveScroll) {
    if (!drawerOpen || !dom.drawerBody) return;
    var key = state.ui.active;
    var cfg = TABLES[key];
    var scrollTop = preserveScroll ? dom.drawerBody.scrollTop : 0;
    dom.drawerTitle.textContent = cfg.short + " · 选项";
    dom.drawerBody.textContent = "";

    if (key === "traverse") {
      var modeSection = drawerSection("竖直角模式", "VA / ZA");
      modeSection.appendChild(drawerSegmented([
        { value: "VA", label: "VA 竖直角" },
        { value: "ZA", label: "ZA 天顶距" }
      ], state.settings.traverse.mode, setTraverseMode));
      drawerNote(modeSection, "VA：αL=L、αR=R；ZA：αL=90°−L、αR=R−270°。切换不清数据；负值在「度」格输入。");
      dom.drawerBody.appendChild(modeSection);

      var limitSection = drawerSection("参考限差", "只提示，不阻断");
      var grid = el("div", "field-grid");
      numberField(grid, "2C", function () { return state.settings.traverse.c2Limit; }, "″", 0, 36000, 1, function (n) {
        state.settings.traverse.c2Limit = n;
        saveNow(false);
        recompute();
      });
      numberField(grid, "指标差", function () { return state.settings.traverse.indexLimit; }, "″", 0, 36000, 1, function (n) {
        state.settings.traverse.indexLimit = n;
        saveNow(false);
        recompute();
      });
      numberField(grid, "半测回较差", function () { return state.settings.traverse.halfDiffLimit; }, "″", 0, 36000, 1, function (n) {
        state.settings.traverse.halfDiffLimit = n;
        saveNow(false);
        recompute();
      });
      limitSection.appendChild(grid);
      drawerNote(limitSection, "默认按课程《指标限差》：2C ≤12″、指标差 ≤25″、水平角上下半测回较差 ≤20″。超限只标琥珀色并在检查面板提示，数仍照常保留。");
      dom.drawerBody.appendChild(limitSection);

      addDisplaySection(dom.drawerBody, key);
    } else if (key === "leveling") {
      var gradeSection = drawerSection("等级");
      gradeSection.appendChild(drawerSegmented([
        { value: "III", label: "三等" },
        { value: "IV", label: "四等" }
      ], state.settings.leveling.grade, setLevelingGrade));
      drawerNote(gradeSection, state.settings.leveling.grade === "III"
        ? "三等限差：视距 75 m / 视距差 3.0 m / Σd 6.0 m / 读数差 2.0 mm / 高差差 3.0 mm。"
        : "四等限差：视距 100 m / 视距差 5.0 m / Σd 10.0 m / 读数差 3.0 mm / 高差差 5.0 mm。");
      dom.drawerBody.appendChild(gradeSection);

      var page = state.pages.leveling[state.ui.pageIndex.leveling];
      var ownerMode = levelingOwnerModeActive();
      var currentOwner = SC.normalizeOwner(page && page.owner);
      var ownerSection = drawerSection("汇总归属（本页）", "表五用");
      if (!ownerMode) {
        drawerNote(ownerSection, "表五现在按旧「页块」规则取数：每人 4 段，每段 " +
          state.settings.levelingSummary.legPages + " 页。开启逐页归属后，本页可以单独指定第几人的第几段。");
      } else if (currentOwner) {
        drawerNote(ownerSection, "本页属于第 " + currentOwner.person + " 人 · " + SC.LEG_LABELS[currentOwner.leg] +
          "。同一人同一段可以有多页，表五会自动合计。");
      } else {
        drawerNote(ownerSection, "本页还没有归属，不参与表五汇总。");
      }
      var ownerRow = el("div", "button-row");
      var ownerBtn = el("button", "drawer-btn", ownerMode ? "设置本页归属" : "改为逐页归属");
      ownerBtn.type = "button";
      ownerBtn.addEventListener("click", function () {
        if (!levelingOwnerModeActive()) {
          materializeLevelingOwners();
          saveNow(false);
          recompute();
          updatePager();
          toast("已改为逐页归属：现有表二页按原页块规则补齐。", "ok");
        }
        closeDrawer();
        openOwnerPopover();
      });
      ownerRow.appendChild(ownerBtn);
      ownerSection.appendChild(ownerRow);
      drawerNote(ownerSection, "归属只用于表五取数，不会打印在表二纸面上。");
      dom.drawerBody.appendChild(ownerSection);

      var kSection = drawerSection("尺常数（本页）", "K₁ 4.787 / K₂ 4.687");
      var kList = el("div", "k-list");
      page.stations.forEach(function (station, stationIndex) {
        var row = el("div", "k-row");
        row.appendChild(el("span", "k-station", "第" + (stationIndex + 1) + "站"));
        var backLabel = el("label");
        backLabel.appendChild(document.createTextNode("后"));
        addKSelect(backLabel, station.kBack, function (value) {
          station.kBack = value;
          saveNow(false);
          recompute();
        });
        row.appendChild(backLabel);
        var frontLabel = el("label");
        frontLabel.appendChild(document.createTextNode("前"));
        addKSelect(frontLabel, station.kFront, function (value) {
          station.kFront = value;
          saveNow(false);
          recompute();
        });
        row.appendChild(frontLabel);
        kList.appendChild(row);
      });
      kSection.appendChild(kList);
      var resetRow = el("div", "button-row");
      var resetBtn = el("button", "drawer-btn", "按交替重置本页 K");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", resetPageK);
      resetRow.appendChild(resetBtn);
      kSection.appendChild(resetRow);
      drawerNote(kSection, "默认首站后 K₁、前 K₂，逐站交替；现场尺序不同时可逐站改。");
      dom.drawerBody.appendChild(kSection);

      addDisplaySection(dom.drawerBody, key);
    } else if (key === "traverseSummary") {
      var dSummary = SC.traverseRows(state.pages.traverse, state.settings.traverse);
      var mapSection = drawerSection("自动汇总", "表一 → 表四");
      drawerNote(mapSection, "逐行取表一所有页中已经开始的测站，按出现顺序排列。每行往测取本站目标②，返测取下一站目标①；正常闭合时最后一站接回第 1 站。");
      drawerNote(mapSection, "当前表一有 " + state.pages.traverse.length + " 页、" + dSummary.count +
        " 个已开始测站，表四显示 " + dSummary.filled + " / " + SC.TRAVERSE_ROWS + " 行" +
        (dSummary.overflow ? "；另有 " + dSummary.overflow + " 站因超出 17 行未显示。" : "。"));
      drawerNote(mapSection, "内角 = 360° − 表一一测回平均；角度按「度.分秒」打包，角度合计按六十进制累加。距离、高差保留 3 位小数；误差与闭合差乘 1000 后取整到 mm。");
      var dRow = el("div", "button-row");
      var dOpen = el("button", "drawer-btn", "去表一核对");
      dOpen.type = "button";
      dOpen.addEventListener("click", function () {
        closeDrawer();
        setActiveModule("traverse");
      });
      dRow.appendChild(dOpen);
      mapSection.appendChild(dRow);
      dom.drawerBody.appendChild(mapSection);

      var dLimit = drawerSection("课程限差（参考）", "表四暂不判超限");
      drawerNote(dLimit, "平距往返 ≤1/4000；三角高程对向高差按表六「平差口径」里选的公式（60√D、40√D 或 0.4×S）。");
      drawerNote(dLimit, "闭合导线：角度闭合差 ≤40″√n；导线全长相对闭合差 ≤1/4000；三角高程闭合差 ≤40√ΣD mm。表四不进入检查面板；打开「误差色」时，平距绝对误差按往返 1/4000、高差闭合差按表六当前的对向高差允许值上色。");
      dom.drawerBody.appendChild(dLimit);

      addDisplaySection(dom.drawerBody, key);
    } else if (key === "levelingSummary") {
      var ePages = state.pages.levelingSummary;
      var eIndex = state.ui.pageIndex.levelingSummary;
      var ePage = ePages[eIndex];
      var eOwnerMode = levelingOwnerModeActive();
      var eSummary = SC.levelingRows(state.pages.leveling, state.settings.leveling, {
        mode: eOwnerMode ? "owners" : "blocks",
        legPages: state.settings.levelingSummary.legPages,
        names: ePage.names,
        pageIndex: eIndex,
        pageCount: ePages.length
      });
      var legSection = drawerSection(eOwnerMode ? "逐页归属" : "分段",
        eOwnerMode ? "表二每页标人/段" : "每人 4 段");
      if (eOwnerMode) {
        drawerNote(legSection, "表二每张页在底栏「归属」里标记第几人的第几段；同一段有多页时自动合计，页可以不连续。");
        drawerNote(legSection, "本页第 " + eSummary.personStart + "–" + eSummary.personEnd + " 人；表二共 " +
          eSummary.pagesAvailable + " 页，已归属 " + eSummary.assignedPages + " 页" +
          (eSummary.unassignedPages ? "，未归属 " + eSummary.unassignedPages + " 页（不计入）" : "") +
          (eSummary.outOfRangePages ? "，归属无效 " + eSummary.outOfRangePages + " 页（不计入）" : "") + "。");
        if (eSummary.emptyLegs) {
          drawerNote(legSection, "本页还有 " + eSummary.emptyLegs + " 段没有对应的表二页；给表二页设置归属后自动补齐。");
        }
        drawerNote(legSection, "表五仍然每页 8 人；人数更多时用底栏「新页」追加。姓名按人员序号对应，不看表二页序。");
      } else {
        var legGrid = el("div", "field-grid");
        numberField(legGrid, "每段页数", function () { return state.settings.levelingSummary.legPages; }, "页", 1, 20, 1, function (n) {
          state.settings.levelingSummary.legPages = SC.normalizeLegPages(n);
          saveNow(false);
          renderDrawer(true);
          recompute();
        });
        legSection.appendChild(legGrid);
        drawerNote(legSection, "每人依次对应表二 4 段：BM1-BM0 往测、BM1-BM0 返测、BM0-1号点 往测、BM0-1号点 返测。每段默认 1 页；一页写不完时可改成 2 页或更多，整段合计后再计算。");
        drawerNote(legSection, "当前第 " + (eIndex + 1) + " / " + ePages.length + " 页：第 " +
          eSummary.personStart + "–" + eSummary.personEnd + " 人；每人 " + eSummary.perPerson +
          " 页（4 段 × " + eSummary.legPages + " 页），本页 8 人对应表二第 " +
          eSummary.sourceStartPage + "–" + eSummary.sourceEndPage + " 页。这一段有 " +
          eSummary.rangeAvailable + " 页" +
          (eSummary.missingPages ? "，还缺 " + eSummary.missingPages + " 页，补页后自动重算。" : "。"));
        drawerNote(legSection, "表五共 " + ePages.length + " 页，最多计入表二前 " +
          eSummary.capacityPages + " 页；表二现有 " + eSummary.pagesAvailable + " 页" +
          (eSummary.ignoredPages ? "，多出的 " + eSummary.ignoredPages + " 页不计入。" : "。") +
          " 人数超过 8 人时，在底栏新增表五页。");
        var convertRow = el("div", "button-row");
        var convertBtn = el("button", "drawer-btn", "改为逐页归属");
        convertBtn.type = "button";
        convertBtn.addEventListener("click", function () {
          materializeLevelingOwners();
          saveNow(false);
          renderDrawer(true);
          recompute();
          updatePager();
          toast("已改为逐页归属：现有表二页按原页块规则补齐，计算结果不变。", "ok");
        });
        convertRow.appendChild(convertBtn);
        legSection.appendChild(convertRow);
      }
      drawerNote(legSection, "闭合差 = (往+返)×1000 mm；平均值 = (往−返)/2 m。表底平均值取本页已算出人员的算术平均，中误差取样本标准差（n−1），单位 mm。");
      var eRow = el("div", "button-row");
      var eOpen = el("button", "drawer-btn", "去表二核对");
      eOpen.type = "button";
      eOpen.addEventListener("click", function () {
        closeDrawer();
        setActiveModule("leveling");
      });
      eRow.appendChild(eOpen);
      if (eOwnerMode) {
        var backBtn = el("button", "drawer-btn", "改回按页块分配");
        backBtn.type = "button";
        backBtn.addEventListener("click", function () {
          confirmDialog(
            "改回按页块分配",
            "表五会改回旧规则：每人 4 段、每段 " + state.settings.levelingSummary.legPages +
            " 页，按表二页序自动切分。页上的归属标签会保留，下次改为逐页归属时还在。",
            { confirmLabel: "改回" }
          ).then(function (ok) {
            if (!ok) return;
            state.settings.levelingSummary.ownerMode = "blocks";
            saveNow(false);
            renderDrawer(true);
            recompute();
            updatePager();
            toast("已改回页块规则。", "ok");
          });
        });
        eRow.appendChild(backBtn);
      }
      legSection.appendChild(eRow);
      dom.drawerBody.appendChild(legSection);

      addDisplaySection(dom.drawerBody, key);
    } else if (key === "trigSummary") {
      var tPage = state.pages.trigSummary[0];
      var tClosed = state.settings.trigSummary.closed !== false;
      var tInfo = SC.trigRows(state.pages.traverse, state.settings.traverse, {
        sideFormula: state.settings.trigSummary.sideFormula,
        sideLimit: state.settings.trigSummary.sideLimit,
        sideLinear: state.settings.trigSummary.sideLinear,
        closureLimit: state.settings.trigSummary.closureLimit,
        closed: tClosed,
        pageCount: state.pages.trigSummary.length,
        startElev: tPage && tPage.meta ? tPage.meta["start-elev"] : ""
      });
      var tMap = drawerSection("自动汇总", "表一 → 表六");
      drawerNote(tMap, "与表四同源：每条边取「本站目标②」为往测、「下一站目标①」为返测。闭合回起点时最后一站接回第 1 站；非闭合路线最后一站没有回程边。正文全部自动推导，可编辑的只有表头（含起点高程）与整列合一的备注。");
      var tRoute = el("div", "button-row");
      tRoute.appendChild(drawerSegmented([
        { value: "closed", label: "闭合回起点" },
        { value: "open", label: "非闭合" }
      ], tClosed ? "closed" : "open", function (value) {
        var next = value !== "open";
        if (next === (state.settings.trigSummary.closed !== false)) return;
        state.settings.trigSummary.closed = next;
        saveNow(false);
        renderDrawer(true);
        renderQuickOptions();
        recompute();
      }));
      tMap.appendChild(tRoute);
      drawerNote(tMap, tClosed
        ? "闭合回起点：n 个已开始测站对应 n 条边，有闭合差，改正值按平距比例反号分配、取整到 mm，余数给最长边。"
        : "非闭合：n 个已开始测站只有 n−1 条边，没有闭合差可分，改正值记 0，改正后高差 = 高差平均值。");
      drawerNote(tMap, "表一当前有 " + state.pages.traverse.length + " 页、" + tInfo.count +
        " 个已开始测站；" + (tClosed ? "闭合环 " : "非闭合路线 ") + tInfo.edgeCount + " 条边。" +
        "表六当前 " + state.pages.trigSummary.length + " 页，共可显示 " + tInfo.capacity + " 条边" +
        (tInfo.overflow ? "；还有 " + tInfo.overflow + " 条未显示，用底栏「新页」补页。" : "。"));
      drawerNote(tMap, "表六每页 17 条边，续页的「起点高程」自动承接上一页最后一点；要改起算高程请回第 1 页。");
      drawerNote(tMap, "平距平均 = (往+返)/2；高差平均 = (往−返)/2（返测与往测符号相反）；较差 = (往+返)×1000 mm；改正后高差从起点高程逐条累加得到最终高程。");
      var tRow = el("div", "button-row");
      var tOpen = el("button", "drawer-btn", "去表一核对");
      tOpen.type = "button";
      tOpen.addEventListener("click", function () {
        closeDrawer();
        setActiveModule("traverse");
      });
      tRow.appendChild(tOpen);
      tMap.appendChild(tRow);
      dom.drawerBody.appendChild(tMap);

      var tLimit = drawerSection("平差口径", "可改");
      var tFormula = el("div", "button-row");
      // 三档预设：60√D、40√D、0.4×S。系数被手改成其它值时三档都不点亮，
      // 但下方的系数框仍显示当前值，避免把自定义口径误显示成某一档。
      var tSettings = state.settings.trigSummary;
      var tPreset = tSettings.sideFormula === "linear"
        ? "linear"
        : (tSettings.sideLimit === 60 ? "60" : (tSettings.sideLimit === 40 ? "40" : ""));
      tFormula.appendChild(drawerSegmented([
        { value: "60", label: "60√D" },
        { value: "40", label: "40√D" },
        { value: "linear", label: "0.4×S" }
      ], tPreset, function (value) {
        var next = value === "linear" ? "linear" : "sqrt";
        var coef = value === "40" ? 40 : 60;
        if (tSettings.sideFormula === next && (next === "linear" || tSettings.sideLimit === coef)) return;
        tSettings.sideFormula = next;
        if (next === "sqrt") tSettings.sideLimit = coef;
        saveNow(false);
        renderDrawer(true);
        // 较差允许值这一列的悬浮说明是按公式拼的，只 recompute 会留着旧口径；
        // renderStage 重建 spec 才会一起换掉。
        renderStage();
      }));
      tLimit.appendChild(tFormula);
      var tGrid = el("div", "field-grid");
      if (state.settings.trigSummary.sideFormula === "linear") {
        numberField(tGrid, "较差系数 K", function () { return state.settings.trigSummary.sideLinear; }, "×S(m)", 0.001, 1000, 0.1, function (n) {
          state.settings.trigSummary.sideLinear = n;
          saveNow(false);
          renderDrawer(true);
          renderStage();
        });
      } else {
        numberField(tGrid, "较差系数 K", function () { return state.settings.trigSummary.sideLimit; }, "√D", 1, 10000, 1, function (n) {
          state.settings.trigSummary.sideLimit = n;
          saveNow(false);
          renderDrawer(true);
          renderStage();
        });
      }
      numberField(tGrid, "闭合差系数 K", function () { return state.settings.trigSummary.closureLimit; }, "√ΣD", 1, 10000, 1, function (n) {
        state.settings.trigSummary.closureLimit = n;
        saveNow(false);
        renderDrawer(true);
        recompute();
      });
      tLimit.appendChild(tGrid);
      drawerNote(tLimit, "较差允许值三档可选：60√D、40√D（D 以 km 计；40√D 是此前用过的口径）或 0.4×S（S 为平距、以 m 计；等价于教材的 0.4S 米、S 以 km 计），也可直接改下面的系数 K。闭合差允许值 = K·√ΣD mm（ΣD 以 km 计，默认 40√ΣD）；指导书不同就在这里改。");
      drawerNote(tLimit, tClosed
        ? "闭合差与对向较差只在整条闭合环算全时判定；「超限」指严格大于允许值，正好等于允许值不报超限。"
        : "非闭合路线没有闭合条件：闭合差系数不参与判定，只判定对向较差；「超限」指严格大于允许值，正好等于允许值不报超限。");
      dom.drawerBody.appendChild(tLimit);

      addDisplaySection(dom.drawerBody, key);
    } else if (key === "traverseCalc") {
      var gIndex = state.ui.pageIndex.traverseCalc;
      var gGroup = calcConductorGroup(gIndex);
      var gStartPage = gGroup.pages[0];
      var gPage = state.pages.traverseCalc[gIndex];
      var gSource = gStartPage.source;
      var gSet = state.settings.traverseCalc;
      var gIsCont = gPage.role === "cont";

      var gMapSection = drawerSection("数据来源", "本项目");
      drawerNote(gMapSection, "表G 由当前项目的表一与表六带入：点号、角度、导线长取表一（内角为表四口径，边长为往返平距平均值），高程列取表六的最终高程；表一的数据是根基。一条导线可以跨页：第 1 页是开始页，后面连续的续页属于同一条导线；要另算一条导线，把某一页切到「独立导线」。带入的是快照，带进来之后可以逐格手改。");

      if (gIndex > 0) {
        gMapSection.appendChild(drawerSegmented([
          { value: "cont", label: "接续上一页" },
          { value: "start", label: "独立导线" }
        ], gIsCont ? "cont" : "start", setCalcPageRole));
        drawerNote(gMapSection, gIsCont
          ? "本页是第 " + (gGroup.start + 1) + " 页开始的导线的续页（导线第 " +
            ((gIndex - gGroup.start) * TCALC.ROWS + 1) + " 行起）；首行 X / Y / 方位角由上一页推算。"
          : "本页是独立导线的开始页；首行 X / Y / 方位角需要自己填或解算。");
      } else {
        drawerNote(gMapSection, "第 1 页永远是开始页。");
      }

      var gFields = el("div", "field-grid is-stacked");
      var gHeightLabel = el("label", "drawer-check");
      var gHeightsInput = el("input");
      gHeightsInput.type = "checkbox";
      // 表六高程是联合带入的一部分，默认就带；本项目没有表六起点高程时会在带入后提示。
      gHeightsInput.checked = true;
      gHeightsInput.title = "勾选只在下次「带入本项目表一＋表六」时生效，不会改动本条导线已带入的高程";
      gHeightLabel.appendChild(gHeightsInput);
      gHeightLabel.appendChild(document.createTextNode("高程列同时取表六（只记录）"));
      gFields.appendChild(gHeightLabel);
      gMapSection.appendChild(gFields);
      drawerNote(gMapSection, "高程勾选只在下次「带入本项目表一＋表六」时生效；只改勾选不会动本条导线已有的高程。");

      var gMapRow = el("div", "button-row");
      var gImportBtn = el("button", "drawer-btn primary", "带入本项目表一＋表六");
      gImportBtn.type = "button";
      gImportBtn.title = "把当前项目表一按站数自动分页带入本条导线（覆盖本条导线现有数据）";
      gImportBtn.addEventListener("click", function () {
        applyCalcMapping(gHeightsInput.checked);
      });
      gMapRow.appendChild(gImportBtn);

      if (!gIsCont) {
        var gClearBtn = el("button", "drawer-btn", "清除来源记录");
        gClearBtn.type = "button";
        gClearBtn.disabled = !(gSource.capturedAt || gSource.sourceCount);
        gClearBtn.title = "只清除来源记录；本条导线数据保留，可直接手改";
        gClearBtn.addEventListener("click", function () { clearCalcMapping(gPage); });
        gMapRow.appendChild(gClearBtn);
      }
      gMapSection.appendChild(gMapRow);

      if (gSource.capturedAt || gSource.sourceCount) {
        drawerNote(gMapSection, "来源：本项目 · 表一 " + gSource.sourceCount + " 站 · 本条导线 " +
          gGroup.pages.length + " 页" +
          (gSource.heightCount > 0 ? " · 表六高程 " + gSource.heightCount + " 个" : "") +
          (gSource.capturedAt ? " · " + formatCapturedAt(gSource.capturedAt) + " 带入" : "") + "。");
        if (gSource.overflow > 0) {
          // 截断是带入当时的快照：之后再手动加页也不会补上旧数据，
          // 所以只说「上次只写入了多少行」，不拿当前页数当容量。
          drawerNote(gMapSection, "表一有 " + gSource.sourceCount +
            " 站，上次带入只写入了前 " +
            Math.max(0, gSource.sourceCount - gSource.overflow) +
            " 行（当时页容量不够），闭合差因此没有计算。点「带入本项目表一＋表六」可自动补页。",
            "owner-note-warn");
        }
        var gNowCount = SC.traverseRows(state.pages.traverse, state.settings.traverse).count;
        if (gNowCount !== gSource.sourceCount) {
          drawerNote(gMapSection, "表一现在 " + gNowCount + " 站（上次带入 " + gSource.sourceCount +
            " 站）；需要新数据时点「带入本项目表一＋表六」重新带入。", "owner-note-warn");
        }
      } else {
        drawerNote(gMapSection, gIsCont
          ? "这条导线还没有带入记录；来源记录与起算数据在开始页。"
          : "本页还没有带入记录：可以直接手填 11 行，也可以点「带入本项目表一＋表六」。");
      }
      if (gIsCont) {
        var gGoStartRow = el("div", "button-row");
        var gGoStartBtn = el("button", "drawer-btn", "打开开始页");
        gGoStartBtn.type = "button";
        gGoStartBtn.title = "来源记录与 P/T 起算数据在开始页";
        gGoStartBtn.addEventListener("click", function () {
          closeDrawer();
          gotoPage(gGroup.start);
        });
        gGoStartRow.appendChild(gGoStartBtn);
        gMapSection.appendChild(gGoStartRow);
      }
      dom.drawerBody.appendChild(gMapSection);

      if (gIsCont) {
        // 续页不渲染起算输入：首行坐标由上一页推算，P/T 与连接角都归开始页。
        var gStartCont = drawerSection("起算数据", "在开始页");
        drawerNote(gStartCont, "本页是续页：首行 X / Y / 方位角由上一页推算，不需要起算数据。P/T 起算坐标、表四连接角 β1 / β2 与连接边 d 都在开始页解算并写入首行。");
        var gStartContRow = el("div", "button-row");
        var gStartContBtn = el("button", "drawer-btn", "打开开始页");
        gStartContBtn.type = "button";
        gStartContBtn.addEventListener("click", function () {
          closeDrawer();
          gotoPage(gGroup.start);
        });
        gStartContRow.appendChild(gStartContBtn);
        gStartCont.appendChild(gStartContRow);
        dom.drawerBody.appendChild(gStartCont);
      } else {
      // 起算数据：P 是课程固定点，T 按队号/组号/学号生成；连接角与连接边
      // 填在表四表头，这里只读取。解算结果只写首行的 X / Y / 方位角。
      var gStart = drawerSection("起算数据", "P / T → 首行");
      drawerNote(gStart, "表G 只有首行是已知点。P 是课程给定的固定点；T 按队号/组号/学号生成。连接角 β1、β2 与连接边 d 填在表四的表头，这里读取后解算首行（点 1）的 X / Y 与 1→2 方位角；数据齐了才能一键填入。");

      var gCoordGrid = el("div", "field-grid is-stacked");
      var gCoordInputs = {};
      function gCoordInput(key, labelText, placeholder) {
        var input = textField(gCoordGrid, labelText, "decimal", placeholder, function (value) {
          gSet.coords[key] = value;
          onCalcCoordsChanged();
        });
        input.value = gSet.coords[key] == null ? "" : String(gSet.coords[key]);
        gCoordInputs[key] = input;
        return input;
      }
      function onCalcCoordsChanged() {
        if (coordsFilled()) {
          if (gSet.coordsPrompt !== "filled") gSet.coordsPrompt = "filled";
        } else if (gSet.coordsPrompt === "filled") {
          gSet.coordsPrompt = "pending";
        }
        saveNow(false);
        refreshStartPreview();
        renderQuickOptions();
      }
      gCoordInput("pn", "P 北坐标 N", "35958.860");
      gCoordInput("pe", "P 东坐标 E", "6010.070");
      gCoordInput("tn", "T 北坐标 N", "留空或整数");
      gCoordInput("te", "T 东坐标 E", "留空或整数");
      gStart.appendChild(gCoordGrid);

      var genLabel = el("div", "setting-note", "T 按课程公式生成：N = 35600 + 队号×10 + 组号，E = 6200 + 学号后 2 位。");
      gStart.appendChild(genLabel);
      var genGrid = el("div", "field-grid");
      var teamInput = textField(genGrid, "队号", "numeric", "如 3");
      var groupInput = textField(genGrid, "组号", "numeric", "如 4");
      var studentInput = textField(genGrid, "学号后 2 位", "numeric", "如 56");
      gStart.appendChild(genGrid);
      var genRow = el("div", "button-row");
      var genBtn = el("button", "drawer-btn", "生成 T 坐标");
      genBtn.type = "button";
      genBtn.addEventListener("click", function () {
        var team = Math.floor(Number(teamInput.value));
        var group = Math.floor(Number(groupInput.value));
        var student = Math.floor(Number(studentInput.value));
        if (!Number.isFinite(team) || team < 1 || !Number.isFinite(group) || group < 1 ||
            !Number.isFinite(student) || student < 0 || student > 99) {
          toast("队号、组号从 1 起，学号后 2 位填 0–99。", "error");
          return;
        }
        var tn = String(35600 + team * 10 + group);
        var te = String(6200 + student);
        gSet.coords.tn = tn;
        gSet.coords.te = te;
        gCoordInputs.tn.value = tn;
        gCoordInputs.te.value = te;
        onCalcCoordsChanged();
        toast("已生成 T：N = " + tn + "，E = " + te + "；小数部分可自己补。", "ok");
      });
      genRow.appendChild(genBtn);
      gStart.appendChild(genRow);

      var gConnNote = drawerNote(gStart, "");
      var gConnRow = el("div", "button-row");
      var gConnOpen = el("button", "drawer-btn", "打开表四表头");
      gConnOpen.type = "button";
      gConnOpen.title = "β1 / β2 填在表四表头的「连接角」两格，d 填在「连接边」格";
      gConnOpen.addEventListener("click", function () {
        closeDrawer();
        setActiveModule("traverseSummary");
      });
      gConnRow.appendChild(gConnOpen);
      gStart.appendChild(gConnRow);

      gStart.appendChild(drawerSegmented([
        { value: "left", label: "左角" },
        { value: "right", label: "右角" }
      ], gSet.connDir, setCalcConnDir));
      drawerNote(gStart, "左角（课程示意图的画法）：α_P1 = α_PT − β1，α_12 = α_P1 + 180° − β2；右角两处都取加号。这与闭合导线的顺/逆时针是两回事：那边管的是内角改正与方位角推进，这边只负责从 P/T 解出首行。");

      var gPreviewNote = drawerNote(gStart, "");
      var gFillRow = el("div", "button-row");
      var gFillBtn = el("button", "drawer-btn primary", "计算并填入首行 X / Y / 方位角");
      gFillBtn.type = "button";
      gFillBtn.addEventListener("click", function () { fillCalcStart(); });
      gFillRow.appendChild(gFillBtn);
      gStart.appendChild(gFillRow);

      function refreshStartPreview() {
        var meta = (state.pages.traverseSummary[0] && state.pages.traverseSummary[0].meta) || {};
        var connBits = [["β1", "conn-b1"], ["β2", "conn-b2"], ["d", "conn-d"]].map(function (pair) {
          var text = str(meta[pair[1]]).trim();
          return pair[0] + " " + (text === "" ? "未填" : text);
        });
        gConnNote.textContent = "表四表头：" + connBits.join(" · ") + "。";

        var preview = calcConnectionPreview();
        var bits = [];
        if (preview.azPT) {
          bits.push("α_PT = " + TC.formatDms(preview.azPT.deg, { decimals: 1 }) +
            "（" + preview.azPT.packed + "），P–T = " + preview.distPT.toFixed(3) + " m");
        }
        if (preview.azP1) bits.push("α_P1 = " + TC.formatDms(preview.azP1.deg, { decimals: 1 }) + "（" + preview.azP1.packed + "）");
        if (preview.x1 != null) bits.push("x1 = " + preview.x1.toFixed(3) + " m");
        if (preview.y1 != null) bits.push("y1 = " + preview.y1.toFixed(3) + " m");
        if (preview.az12) bits.push("α_12 = " + TC.formatDms(preview.az12.deg, { decimals: 1 }) + "（" + preview.az12.packed + "）");
        var missing = preview.issues.map(function (item) { return item.message; }).join("");
        var msg;
        if (preview.ok) msg = "解算结果：" + bits.join("；") + "。";
        else if (bits.length) msg = "已解出：" + bits.join("；") + "。还差：" + missing;
        else msg = "还差：" + missing;
        gPreviewNote.textContent = msg;
        gFillBtn.disabled = !preview.ok;
        gFillBtn.title = preview.ok ? "只写首行的 X / Y / 方位角三格" : "起算数据还不全";
      }
      refreshStartPreview();
      dom.drawerBody.appendChild(gStart);

      var gConverter = drawerSection("方位角换算", "手填备用");
      drawerNote(gConverter, "手上是十进制度、又不想用 P/T 解算时，在这里把十进制度换成「度.分秒」直接写入首行方位角。这一步不依赖 P/T。");
      var gStartGrid = el("div", "field-grid");
      var gDeg = textField(gStartGrid, "十进制度", "decimal", "如 123.4567");
      var gDegBtn = el("button", "drawer-btn", "换算并填入首行方位角");
      gDegBtn.type = "button";
      gDegBtn.addEventListener("click", function () {
        // Number("") 是 0：空框不能当成 0° 直接写进首行方位角。
        var degText = str(gDeg.value).trim();
        var n = degText === "" ? NaN : Number(degText);
        if (!Number.isFinite(n) || n < 0 || n >= 360) {
          toast("先填一个 0–359.9999 之间的十进制度数。", "error");
          return;
        }
        var packed = TCALC.packedTextFromCs(Math.round(n * 360000));
        gPage.rows[0].az = packed;
        saveNow(false);
        renderStage();
        if (drawerOpen) renderDrawer(true);
        toast("首行方位角已填为 " + packed + "（度.分秒）。", "ok");
      });
      gConverter.appendChild(gStartGrid);
      var gDegRow = el("div", "button-row");
      gDegRow.appendChild(gDegBtn);
      gConverter.appendChild(gDegRow);
      dom.drawerBody.appendChild(gConverter);
      }

      var gCaliber = drawerSection("计算口径", "可改");
      gCaliber.appendChild(drawerSegmented([
        { value: "ccw", label: "顺时针" },
        { value: "cw", label: "逆时针" }
      ], gSet.angleDir, setCalcAngleDir));
      var gCalGrid = el("div", "field-grid");
      numberField(gCalGrid, "fβ 系数", function () { return state.settings.traverseCalc.fBetaCoef; }, "″√n", 1, 1000, 1, function (n) {
        state.settings.traverseCalc.fBetaCoef = n;
        saveNow(false);
        renderStage();
        if (drawerOpen) renderDrawer(true);
      });
      numberField(gCalGrid, "K 分母", function () { return state.settings.traverseCalc.kDen; }, "1/N", 100, 1000000, 100, function (n) {
        state.settings.traverseCalc.kDen = n;
        saveNow(false);
        renderStage();
        if (drawerOpen) renderDrawer(true);
      });
      gCaliber.appendChild(gCalGrid);
      drawerNote(gCaliber, "顺时针（内角在右）：α = α前 + 180° − β；逆时针（内角在左）：α = α前 + 180° + β。角度改正按角数等分反号、不取整；坐标改正按边长比例反号、余数给最长边。改口径只重算，不改数据。");
      dom.drawerBody.appendChild(gCaliber);

      var gCalc = TCALC.computePages(gGroup.pages, gSet);
      var gSlice = gCalc.pages[gIndex - gGroup.start].calc;
      var gSumSection = drawerSection("计算摘要", "仅屏幕");
      if (gCalc.state === "empty") {
        drawerNote(gSumSection, "本条导线还没有数据。");
      } else {
        drawerNote(gSumSection, "本条导线 " + gGroup.pages.length + " 页；已填 " + gCalc.used +
          " 行（本页 " + gSlice.pageUsed + " 行），参与计算 " + gCalc.n + " 行。");
        if (gCalc.sumBetaPacked) {
          drawerNote(gSumSection, "Σβ = " + gCalc.sumBetaPacked + "（度.分秒打包值），(n−2)×180° = " +
            (gCalc.n - 2) * 180 + "°。");
        }
        if (gCalc.fBetaSec != null) {
          drawerNote(gSumSection, "fβ = " + signedFixed(gCalc.fBetaSec, 2) + "″，允许 ±" +
            gCalc.fBetaAllowSec.toFixed(2) + "″（" + gSet.fBetaCoef + "″√" + gCalc.n + "）" +
            (gCalc.angleOk ? "，合格。" : "，超限。"));
        }
        if (gCalc.fMm != null) {
          drawerNote(gSumSection, "fx = " + signedFixed(gCalc.fxMm, 0) + " mm，fy = " +
            signedFixed(gCalc.fyMm, 0) + " mm，f = " + gCalc.fMm.toFixed(1) + " mm；ΣD = " +
            summaryFixed(gCalc.sumD, 3) + " m。");
          drawerNote(gSumSection, "K = " + (gCalc.kDenActual === Infinity ? "0" : "1/" + Math.floor(gCalc.kDenActual)) +
            "，要求 ≤ 1/" + gSet.kDen + (gCalc.kOk ? "，合格。" : "，超限。"));
        }
        if (gCalc.az[0]) {
          drawerNote(gSumSection, "起始方位角 " + gCalc.az[0].packed + "（度.分秒）。");
        }
      }
      dom.drawerBody.appendChild(gSumSection);

      addDisplaySection(dom.drawerBody, key);
    } else {
      var fontSection = drawerSection("字体");
      drawerNote(fontSection, LITE
        ? "表三统一使用系统字体，与表一、表二一致；本版本不再提供宋体切换。只影响本表显示与打印。"
        : "表三统一使用 HarmonyOS Sans SC，与表一、表二一致；本版本不再提供宋体切换。只影响本表显示与打印。");
      dom.drawerBody.appendChild(fontSection);

      var limitSection2 = drawerSection("参考限差", "只提示，不阻断");
      var grid2 = el("div", "field-grid");
      numberField(grid2, "半测回角值之差", function () { return state.settings.angle.limit; }, "″", 0, 36000, 1, function (n) {
        state.settings.angle.limit = n;
        saveNow(false);
        recompute();
      });
      limitSection2.appendChild(grid2);
      drawerNote(limitSection2, "默认按课程标准：水平角上下半测回较差 ≤20″；超过此值只标琥珀色。");
      dom.drawerBody.appendChild(limitSection2);

      addDisplaySection(dom.drawerBody, key);
    }

    addAppearanceSection(dom.drawerBody);
    // 表G 不参与表一 ↔ 表三联立，不给它挂联立段。
    if (!isSummaryKey(key) && !isCalcKey(key)) addLinkageSection(dom.drawerBody);
    addDataSection(dom.drawerBody);
    dom.drawerBody.scrollTop = scrollTop;
  }

  function openDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;
    renderDrawer(false);
    dom.drawerBackdrop.hidden = false;
    dom.drawer.hidden = false;
    dom.app.inert = true;
    dom.settingsBtn.setAttribute("aria-expanded", "true");
    setTimeout(function () {
      if (drawerOpen) {
        try { dom.drawerClose.focus(); } catch (err) { /* ignore */ }
      }
    }, 0);
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    var focusInside = dom.drawer.contains(document.activeElement);
    drawerOpen = false;
    dom.drawer.hidden = true;
    dom.drawerBackdrop.hidden = true;
    dom.app.inert = false;
    dom.settingsBtn.setAttribute("aria-expanded", "false");
    if (focusInside) {
      try { dom.settingsBtn.focus(); } catch (err) { /* ignore */ }
    }
  }

  function setZoom(value) {
    if (value !== "width" && value !== "page") return;
    var key = state.ui.active;
    if (state.ui.zoom[key] === value) return;
    state.ui.zoom[key] = value;
    saveNow(false);
    fitSheet();
    if (value === "page") dom.stage.scrollTop = 0;
    scheduleFit();
    if (drawerOpen) renderDrawer(true);
  }

  function updateZoomControls() {
    if (!dom.zoomValue) return;
    var scale = normalizeScale(state.ui.scale[state.ui.active]);
    dom.zoomValue.value = scale + "%";
    dom.zoomValue.title = "当前表格大小 " + scale + "%（相对本表的 100% 基准）；可输入 " + SCALE_MIN + "–" + SCALE_MAX + "，回车生效，Esc 取消。也可在表格上捏合触控板，或按住右键滚动滚轮";
    dom.zoomValue.setAttribute("aria-label", "表格大小 " + scale + "%（相对本表基准），可输入 " + SCALE_MIN + " 到 " + SCALE_MAX + " 后回车；在表格上捏合触控板或按住右键滚动滚轮缩放");
  }

  function commitZoomValue() {
    if (!dom.zoomValue) return;
    var parsed = parseFloat(String(dom.zoomValue.value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(parsed)) {
      updateZoomControls();
      return;
    }
    setScale(parsed);
    updateZoomControls();
  }

  function setScale(value, options) {
    options = options || {};
    if (!state || !dom.stage) return;
    var key = state.ui.active;
    var scale = normalizeScale(value);
    if (state.ui.scale[key] === scale) {
      updateZoomControls();
      return;
    }
    var stage = dom.stage;
    var paper = runtime && runtime.paper;
    var anchor = options.anchor || null;
    var anchorX = 0.5;
    var anchorY = 0.5;
    if (anchor && paper) {
      var before = paper.getBoundingClientRect();
      anchorX = before.width ? Math.max(0, Math.min(1, (anchor.x - before.left) / before.width)) : 0.5;
      anchorY = before.height ? Math.max(0, Math.min(1, (anchor.y - before.top) / before.height)) : 0.5;
    }
    var oldWidth = stage.scrollWidth;
    var oldHeight = stage.scrollHeight;
    var centerX = oldWidth > stage.clientWidth
      ? (stage.scrollLeft + stage.clientWidth / 2) / oldWidth
      : 0.5;
    var centerY = oldHeight > stage.clientHeight
      ? (stage.scrollTop + stage.clientHeight / 2) / oldHeight
      : 0.5;

    state.ui.scale[key] = scale;
    if (options.live) scheduleSave();
    else saveNow(false);
    fitSheet();

    var maxX = Math.max(0, stage.scrollWidth - stage.clientWidth);
    var maxY = Math.max(0, stage.scrollHeight - stage.clientHeight);
    if (anchor && paper) {
      // 围绕指针缩放：保持指针下的表格位置不动。
      var after = paper.getBoundingClientRect();
      var targetLeft = anchor.x - anchorX * after.width;
      var targetTop = anchor.y - anchorY * after.height;
      stage.scrollLeft = Math.min(maxX, Math.max(0, stage.scrollLeft + after.left - targetLeft));
      stage.scrollTop = Math.min(maxY, Math.max(0, stage.scrollTop + after.top - targetTop));
    } else if (options.center !== false) {
      stage.scrollLeft = Math.min(maxX, Math.max(0, centerX * stage.scrollWidth - stage.clientWidth / 2));
      stage.scrollTop = Math.min(maxY, Math.max(0, centerY * stage.scrollHeight - stage.clientHeight / 2));
    }
    updateZoomControls();
    if (drawerOpen) renderDrawer(true);
  }

  function formatZoomLabel(value) {
    var shown = normalizeScale(value);
    var label = shown + "%";
    if (shown <= SCALE_MIN) label += " · 最小";
    else if (shown >= SCALE_MAX) label += " · 最大";
    return label;
  }

  function showZoomHudAtStage(label) {
    if (!dom.stage) return;
    var rect = dom.stage.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + Math.min(140, Math.max(80, rect.height / 2));
    showZoomHud(label, x, y);
  }

  function handleZoomKeys(event) {
    if (!state || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
    var key = event.key;
    var current = normalizeScale(state.ui.scale[state.ui.active]);
    var next = null;
    if (key === "+" || key === "=" || event.code === "NumpadAdd") next = current + SCALE_KEY_STEP;
    else if (key === "-" || key === "_" || event.code === "NumpadSubtract") next = current - SCALE_KEY_STEP;
    else if (key === "0" || event.code === "Numpad0") next = SCALE_DEFAULT;
    if (next === null) return;
    // Ctrl + / - / 0 默认会缩放整个 WebView；这里改为只缩放当前表格。
    event.preventDefault();
    if (event.repeat) return;
    setScale(next);
    showZoomHudAtStage(formatZoomLabel(next));
  }

  function suppressNativeWheelZoom(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    // 触控板捏合会以 ctrl + wheel 到达；先拦掉 WebView2 的整页缩放。
    event.preventDefault();
  }

  function showZoomHud(label, x, y) {
    if (!dom.zoomHud) return;
    dom.zoomHud.textContent = label;
    dom.zoomHud.hidden = false;
    dom.zoomHud.style.left = Math.min(window.innerWidth - 50, Math.max(50, x)) + "px";
    dom.zoomHud.style.top = Math.min(window.innerHeight - 12, Math.max(52, y)) + "px";
    if (zoomHudTimer) clearTimeout(zoomHudTimer);
    zoomHudTimer = setTimeout(function () {
      zoomHudTimer = null;
      if (dom.zoomHud) dom.zoomHud.hidden = true;
    }, 700);
  }

  function applyWheelZoom() {
    wheelZoomRaf = 0;
    if (wheelZoomTarget === null || !state || !dom.stage) return;
    var anchor = wheelZoomAnchor || { x: 0, y: 0 };
    // HUD 每帧只更新一次，避免高精度捏合时每个 wheel 事件都写一遍 DOM。
    showZoomHud(formatZoomLabel(wheelZoomTarget), anchor.x, anchor.y);
    var current = normalizeScale(state.ui.scale[state.ui.active]);
    var next = normalizeScale(wheelZoomTarget);
    if (next === current) return;
    setScale(next, { anchor: wheelZoomAnchor, live: true });
  }

  function beginRightZoom(event) {
    if (event.button !== 2) return;
    event.preventDefault();
    rightZoomHeld = true;
    if (dom.stage) dom.stage.classList.add("is-zoom-held");
  }

  function endRightZoom() {
    rightZoomHeld = false;
    if (dom.stage) dom.stage.classList.remove("is-zoom-held");
  }

  function handleStageWheel(event) {
    var rightZoom = rightZoomHeld || (event.buttons & 2) === 2;
    if (!event.ctrlKey && !event.metaKey && !rightZoom) return;
    if (!state || !runtime || !runtime.paper || !dom.stage) return;
    // 右键 + 滚轮、Ctrl + 滚轮与触控板捏合都走这里；普通滚轮保持滚动。
    if (rightZoom && dom.stage) dom.stage.classList.add("is-zoom-held");
    event.preventDefault();
    var delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= Math.max(1, dom.stage.clientHeight);
    if (!delta) return;
    delta = Math.max(-240, Math.min(240, delta));
    // 触控板捏合在 Chromium / WebView2 里表现为高精度 ctrl + wheel，
    // deltaY = -100 * ln(scale)；离散鼠标滚轮的一次滚动通常是 100 或 120。
    // 大而快的捏合事件可能超过 80，但合成值通常带小数，用它和离散滚轮区分。
    var absDelta = Math.abs(delta);
    var fineDelta = event.deltaMode === 0 &&
      (absDelta < ZOOM_PINCH_MAX_DELTA || absDelta !== Math.floor(absDelta));
    var rate = fineDelta ? ZOOM_PINCH_RATE : ZOOM_WHEEL_RATE;
    var current = normalizeScale(state.ui.scale[state.ui.active]);
    if (wheelZoomTarget === null || (!wheelZoomRaf && Math.abs(wheelZoomTarget - current) > 20)) {
      wheelZoomTarget = current;
    }
    wheelZoomTarget = Math.max(SCALE_MIN, Math.min(SCALE_MAX, wheelZoomTarget * Math.exp(-delta * rate)));
    wheelZoomAnchor = { x: event.clientX, y: event.clientY };
    if (!wheelZoomRaf) wheelZoomRaf = requestAnimationFrame(applyWheelZoom);

    if (wheelZoomIdleTimer) clearTimeout(wheelZoomIdleTimer);
    wheelZoomIdleTimer = setTimeout(function () {
      wheelZoomIdleTimer = null;
      wheelZoomTarget = null;
      wheelZoomAnchor = null;
    }, 220);
  }

  function resetPageK() {
    var pageIndex = state.ui.pageIndex.leveling;
    var page = state.pages.leveling[pageIndex];
    page.stations.forEach(function (station, stationIndex) {
      var k = defaultK(pageIndex, stationIndex);
      station.kBack = k.kBack;
      station.kFront = k.kFront;
    });
    saveNow(false);
    recompute();
    renderDrawer(true);
    toast("已按交替重置本页尺常数。", "ok");
  }

  /* ------------------------------------------------------------------ *
   * 翻页 / 清空
   * ------------------------------------------------------------------ */

  function addPage() {
    var key = state.ui.active;
    var pages = state.pages[key];
    if (key === "traverseSummary") {
      toast("表四固定一页，页数由表一的数据量决定。", "error");
      return;
    }
    if (key === "angle" && linkageEnabled()) {
      toast("联立期间表三页数由表一与映射决定，请先解除联立。", "error");
      return;
    }
    if (pages.length >= MAX_PAGES) {
      toast("本表最多 " + MAX_PAGES + " 页。", "error");
      return;
    }
    var currentIndex = state.ui.pageIndex[key];
    var current = pages[currentIndex];
    var index = pages.length;
    if (key === "traverseCalc") {
      // 新页接在当前导线的末尾，而不是整份文档的末尾：
      // 当前导线后面可能还有别的导线，插到末尾会接到最后一条上。
      index = calcConductorGroup(currentIndex).end + 1;
    }
    var newPage = blankPage(key, index);
    newPage.meta = Object.assign({}, current.meta);
    if (key === "trigSummary") {
      // 第 2 页起的「起点高程」是从上一页末点自动推算的，不占表头；新页不带这个值。
      delete newPage.meta["start-elev"];
    }
    if (key === "traverseCalc") {
      // 新页默认接在当前导线后面；要另起一条导线，在选项里切到「独立导线」。
      newPage.role = "cont";
    }
    var inheritedOwner = null;
    if (key === "leveling") {
      newPage.remark = "";
      if (levelingOwnerModeActive()) {
        // 新页默认接着当前这页录：同一人同一段可以有多页。
        inheritedOwner = SC.normalizeOwner(current && current.owner);
        newPage.owner = inheritedOwner;
      }
    }
    if (index >= pages.length) pages.push(newPage);
    else pages.splice(index, 0, newPage);
    state.ui.pageIndex[key] = index;
    saveNow(false);
    renderStage();
    updateTabs();
    updatePager();
    dom.stage.scrollTop = 0;
    if (key === "leveling" && levelingOwnerModeActive()) {
      toast(inheritedOwner
        ? "已新增第 " + (index + 1) + " 页，归属沿用当前页（第 " + inheritedOwner.person + " 人 · " +
          SC.LEG_LABELS[inheritedOwner.leg] + "）。要换段请点底栏的归属。"
        : "已新增第 " + (index + 1) + " 页；当前页没有归属，新页也没有归属。", "ok");
    } else if (key === "levelingSummary") {
      var personStart = index * SC.LEVELING_ROWS + 1;
      var personEnd = personStart + SC.LEVELING_ROWS - 1;
      toast("已新增表五第 " + (index + 1) + " 页（第 " + personStart + "–" + personEnd + " 人），表头沿用本页。", "ok");
    } else if (key === "trigSummary") {
      var edgeStart = index * SC.TRIG_ROWS + 1;
      var edgeEnd = edgeStart + SC.TRIG_ROWS - 1;
      toast("已新增表六第 " + (index + 1) + " 页（第 " + edgeStart + "–" + edgeEnd +
        " 条边），表头沿用本页；起点高程仍在第 1 页填。", "ok");
    } else if (key === "traverseCalc") {
      var calcGroup = calcConductorGroup(index);
      var calcStart = index - calcGroup.start;
      var calcFrom = calcStart * TCALC.ROWS + 1;
      toast("已新增表G 第 " + (index + 1) + " 页（接续第 " + (calcGroup.start + 1) +
        " 页开始的导线，第 " + calcFrom + "–" + (calcFrom + TCALC.ROWS - 1) +
        " 站），表头沿用本页；要另起一条导线，在选项里切到「独立导线」。", "ok");
    } else {
      toast("已新增第 " + (index + 1) + " 页，表头沿用本页。", "ok");
    }
  }

  function deletePage() {
    var key = state.ui.active;
    var pages = state.pages[key];
    if (key === "traverseSummary") {
      toast("表四固定一页，不能删除；正文由表一自动推导。", "error");
      return;
    }
    if (pages.length <= 1) return;
    if (key === "angle" && linkageEnabled()) {
      toast("联立期间表三页数与表一联动，不能手动删除页；请先解除联立。", "error");
      return;
    }
    var index = state.ui.pageIndex[key];
    var page = pages[index];
    var hasContent = pageHasData(key, page);
    var linkedTraverse = key === "traverse" && linkageEnabled();
    var message;
    if (key === "levelingSummary") {
      message = hasContent
        ? "本页已有姓名，删除后无法撤销。表二原始数据不受影响。"
        : "本页没有姓名。删除后这个空白页也会被移除，表二原始数据不受影响。";
      if (index < pages.length - 1) message += "\n后面的表五页会前移，对应的人员段落随之重排。";
      if (levelingOwnerModeActive()) message += "\n逐页归属按人员序号生效：删页后后面的人员序号前移，表二页上的归属标签保持原样。";
    } else if (key === "trigSummary") {
      message = "表六正文全部由表一自动推导，删除本页不会动表一数据。";
      if (index === 0) {
        message += "\n删的是第 1 页：起点高程会移到新的第 1 页（原来的第 2 页），本页备注随之删除。";
      } else {
        message += "\n后面的页会前移，边号与跨页高程承接随之重排。";
      }
      if (index < pages.length - 1) message += "\n本页的备注随页删除。";
    } else if (key === "traverseCalc") {
      // 只填了表头的页按「没有数据」处理：表G 的正文只有 11 行读数与来源记录。
      var calcSource = page && page.source ? page.source : {};
      var calcContent = traverseCalcRowsFilled(page) > 0 ||
        hasData(calcSource.capturedAt) || Number(calcSource.sourceCount) > 0;
      var calcIsCont = page.role === "cont";
      message = calcContent
        ? (calcIsCont
          ? "本页是续页，删除后这一页的 11 行数据无法撤销；表一、表六不受影响。"
          : "本页是一条导线的开始页，删除后无法撤销；表一、表六不受影响。")
        : "本页还没有数据。删除后这个空白页也会被移除。";
      if (calcIsCont) {
        if (index < pages.length - 1) message += "\n后面的续页会前移 11 站。";
      } else if (index + 1 < pages.length && pages[index + 1].role === "cont") {
        message += "\n后面的续页会成为新的开始页，首行 X / Y / 方位角需要重新填写。";
      } else if (index < pages.length - 1) {
        message += "\n后面的页会前移。";
      }
    } else {
      message = hasContent
        ? "本页已有数据，删除后无法撤销。表头与全局设置不受影响。"
        : "本页没有数据。删除后这个空白页也会被移除。";
      if (key === "leveling" && levelingOwnerModeActive()) {
        message += "\n本页的归属标签随页一起删除；其它页的归属按页保留，不随页序变化。";
      }
    }
    if (linkedTraverse) {
      message += "\n联立中：本页 4 个测站在表三中由联立写入的数据会一并清理，后面的表一页会前移并重新写入表三。删除前会自动备份当前项目。";
    }
    confirmDialog(
      "删除第 " + (index + 1) + " 页",
      message,
      { confirmLabel: "删除", danger: true }
    ).then(function (ok) {
      if (!ok) return;
      noteDestructive("page-delete");
      if (linkedTraverse) {
        if (!backupLinkage("traverse-delete")) return;
        var info = STORE.getLinkage();
        var meta = LINKAGE.normalizeMeta(info.mapping);
        var dests = [];
        var seen = {};
        Object.keys(meta.last).forEach(function (sourceKey) {
          var parts = sourceKey.split(":");
          if (parseInt(parts[0], 10) !== index) return;
          var dest = meta.last[sourceKey];
          var destId = dest.page + ":" + dest.station;
          if (seen[destId]) return;
          seen[destId] = true;
          dests.push(dest);
        });
        var shifted = LINKAGE.shiftSourcePagesAfterDelete(meta, index);
        if (!saveLinkageState({ mapping: shifted })) return;
        if (dests.length) LINKAGE.clearDestinations(state, dests);
      } else if (key === "angle") {
        var angleInfo = STORE.getLinkage();
        var shiftedDest = LINKAGE.shiftDestinationPagesAfterDelete(angleInfo.mapping, index);
        if (!sameMeta(angleInfo.mapping, shiftedDest) && !saveLinkageState({ mapping: shiftedDest })) return;
      }
      if (key === "trigSummary" && index === 0 && pages.length > 1) {
        // 起点高程属于整条路线，不随第 1 页的纸张一起删掉。
        var keptElev = page.meta ? page.meta["start-elev"] : null;
        if (keptElev != null && keptElev !== "") {
          pages[1].meta["start-elev"] = keptElev;
        }
      }
      var promoteCalc = key === "traverseCalc" &&
        page.role !== "cont" &&
        index < pages.length - 1 &&
        pages[index + 1].role === "cont";
      pages.splice(index, 1);
      // 开始页被删后，紧跟的续页接管成为新的开始页；旧坐标不随纸张搬。
      if (promoteCalc) {
        pages[index].role = "start";
        // 续页首行的 x / y / 方位角可能是切换角色时留下的休眠值，
        // 提升为开始页时不能让它悄悄变成起算数据；来源记录同理，只在真正带入时重写。
        pages[index].source = blankCalcSource();
        if (pages[index].rows && pages[index].rows[0]) {
          pages[index].rows[0].x = "";
          pages[index].rows[0].y = "";
          pages[index].rows[0].az = "";
        }
      }
      state.ui.pageIndex[key] = Math.min(index, pages.length - 1);
      if (linkedTraverse) runLinkageSync({ render: false });
      saveNow(false);
      renderStage();
      updateTabs();
      updatePager();
      toast(promoteCalc
        ? "已删除第 " + (index + 1) + " 页；后面的续页已成为新的开始页，请检查首行 X / Y / 方位角。"
        : "已删除第 " + (index + 1) + " 页。");
    });
  }

  function clearCurrentPage() {
    var key = state.ui.active;
    var index = state.ui.pageIndex[key];
    var page = state.pages[key][index];
    if (key === "traverseSummary") {
      toast("表四正文全部由表一自动推导，没有可清空的数据；表头可直接改。", "error");
      return;
    }
    if (key === "trigSummary") {
      if (!hasData(page.remark)) {
        toast("表六的备注已经是空白。");
        return;
      }
      confirmDialog(
        "清空本页",
        "清空表六第 " + (index + 1) + " 页的备注？表头（含起点高程）与其它页保留，正文仍按表一自动推导。",
        { confirmLabel: "清空", danger: true }
      ).then(function (ok) {
        if (!ok) return;
        noteDestructive("page-clear");
        page.remark = "";
        saveNow(false);
        closeDrawer();
        renderStage();
        updatePager();
        toast("已清空表六第 " + (index + 1) + " 页的备注。", "ok");
      });
      return;
    }
    if (key === "levelingSummary") {
      var hasNames = (page.names || []).some(function (name) { return hasData(name); });
      if (!hasNames) {
        toast("表五的姓名栏已经是空白。");
        return;
      }
      confirmDialog(
        "清空本页",
        "清空表五第 " + (index + 1) + " 页的 8 个姓名？表头保留，正文仍按表二自动推导。",
        { confirmLabel: "清空", danger: true }
      ).then(function (ok) {
        if (!ok) return;
        noteDestructive("page-clear");
        page.names = page.names.map(function () { return ""; });
        saveNow(false);
        closeDrawer();
        renderStage();
        updatePager();
        toast("已清空表五第 " + (index + 1) + " 页的姓名。", "ok");
      });
      return;
    }
    if (key === "angle" && linkageEnabled()) {
      toast("联立期间表三只读，请先解除联立再清空。", "error");
      return;
    }
    if (key === "traverseCalc") {
      // 表头会被保留，只填了表头的页再点清空没有意义；这里只看来源记录与 11 行读数。
      var calcIsCont = page.role === "cont";
      var calcGroup = calcConductorGroup(index);
      var calcPageSource = page && page.source ? page.source : {};
      var calcContent = traverseCalcRowsFilled(page) > 0 ||
        (!calcIsCont && (hasData(calcPageSource.capturedAt) ||
          Number(calcPageSource.sourceCount) > 0));
      if (!calcContent) {
        toast("本页已经是空白。");
        return;
      }
      var calcMessage = calcIsCont
        ? "清空表G 第 " + (index + 1) + " 页（续页）的 11 行数据？开始页、其它续页与表头都不动。"
        : calcGroup.pages.length > 1
          ? "清空表G 第 " + (index + 1) +
            " 页（开始页）的起算数据、来源记录与 11 行数据？表头保留；后面的续页还在，但没有起算数据将无法闭合。"
          : "清空表G 第 " + (index + 1) + " 页的来源记录与 11 行数据？表头保留，表一、表六不受影响。";
      confirmDialog(
        "清空本页",
        calcMessage,
        { confirmLabel: "清空", danger: true }
      ).then(function (ok) {
        if (!ok) return;
        noteDestructive("page-clear");
        var calcMeta = Object.assign({}, page.meta);
        var calcFresh = blankPage("traverseCalc", index);
        calcFresh.meta = calcMeta;
        calcFresh.role = calcIsCont ? "cont" : "start";
        state.pages.traverseCalc[index] = calcFresh;
        saveNow(false);
        closeDrawer();
        renderStage();
        updateTabs();
        updatePager();
        dom.stage.scrollTop = 0;
        toast("已清空表G 第 " + (index + 1) + " 页的数据。", "ok");
      });
      return;
    }
    if (!pageHasData(key, page)) {
      toast("本页已经是空白。");
      return;
    }
    var linkedTraverse = key === "traverse" && linkageEnabled();
    var message = "清空第 " + (index + 1) + " 页的所有数据？表头、尺常数与全局设置会保留。";
    if (linkedTraverse) {
      message += "\n联立中：本页 4 个测站在表三中由联立写入的数据会一并清理。清空前会自动备份当前项目。";
    }
    confirmDialog(
      "清空本页",
      message,
      { confirmLabel: "清空", danger: true }
    ).then(function (ok) {
      if (!ok) return;
      noteDestructive("page-clear");
      if (linkedTraverse && !backupLinkage("traverse-clear")) return;
      var meta = Object.assign({}, page.meta);
      var fresh = blankPage(key, index);
      fresh.meta = meta;
      if (key === "leveling") {
        fresh.remark = "";
        // 清空测站不等于放弃归属；归属是表五的划分信息，继续保留。
        fresh.owner = page.owner;
        fresh.stations.forEach(function (station, stationIndex) {
          station.kBack = page.stations[stationIndex].kBack;
          station.kFront = page.stations[stationIndex].kFront;
        });
      }
      state.pages[key][index] = fresh;
      if (linkedTraverse) runLinkageSync({ render: false });
      saveNow(false);
      closeDrawer();
      renderStage();
      updateTabs();
      updatePager();
      dom.stage.scrollTop = 0;
      toast("已清空第 " + (index + 1) + " 页的数据。", "ok");
    });
  }

  /* ------------------------------------------------------------------ *
   * 导出 / 导入
   * ------------------------------------------------------------------ */

  function safeFilePart(value) {
    return String(value == null ? "" : value)
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "项目";
  }

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = el("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function saveJsonPayload(payload, filename) {
    var text;
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (err) {
      return Promise.reject(err);
    }
    var P = window.JujinPlatform;
    if (P && typeof P.isDesktop === "function" && P.isDesktop()) {
      return P.exportJson(filename, text).then(function (path) {
        return { native: true, path: path };
      });
    }
    downloadText(text, filename);
    return Promise.resolve({ native: false, path: "browser" });
  }

  function projectExportPayload() {
    return {
      app: "survey-sheets-formal",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      // 旧正式版按 mm 整数算表二，导出给它的文件把米制读数换回 mm。
      data: staffReadingsToMm(clone(state))
    };
  }

  function tableExportPayload(table) {
    if (!TABLES[table]) throw new Error("未知的表：" + table);
    var payload = TRANSFER.buildTablePayload(state, table, makeDefaultState, new Date().toISOString());
    payload.tableName = TABLES[table].tab;
    payload.projectName = activeProjectName();
    return payload;
  }

  function exportTableJson() {
    var table = state.ui.active;
    var cfg = TABLES[table];
    if (!cfg) {
      toast("导出失败：当前表无法识别。", "error");
      return;
    }
    var payload;
    try {
      payload = tableExportPayload(table);
    } catch (err) {
      toast("导出失败：" + errorText(err), "error");
      return;
    }
    var pageCount = payload.state.pages[table].length;
    var name = activeProjectName();
    saveJsonPayload(payload, "测量学七表-" + safeFilePart(name) + "-" + cfg.short + "-" + stamp() + ".json")
      .then(function (result) {
        var message = "已导出" + cfg.short + "（" + pageCount + " 页，其余各表为空页）";
        if (result.native) {
          if (!result.path) return;
          toast(message + "到 " + result.path, "ok");
          return;
        }
        toast(message + "。", "ok");
      })
      .catch(function (err) {
        toast("导出失败：" + errorText(err), "error");
      });
  }

  function exportJson() {
    var payload = projectExportPayload();
    var name = activeProjectName();
    saveJsonPayload(payload, "测量学七表-" + safeFilePart(name) + "-" + stamp() + ".json")
      .then(function (result) {
        if (result.native) {
          if (!result.path) return;
          toast("已导出当前项目「" + name + "」到 " + result.path, "ok");
          return;
        }
        toast("已导出当前项目「" + name + "」的三张记录表、三张汇总表与表G 计算表；旧版正式版可直接导入（忽略汇总表与表G）。", "ok");
      })
      .catch(function (err) {
        toast("导出失败：" + errorText(err), "error");
      });
  }

  function exportAllProjects() {
    var envelope = STORE.exportAll();
    if (!envelope) {
      toast("项目库尚未载入，无法导出。", "error");
      return;
    }
    envelope.app = "survey-jujin";
    envelope.exportedAt = new Date().toISOString();
    saveJsonPayload(envelope, "测量学局劲-全部项目-" + stamp() + ".json")
      .then(function (result) {
        if (typeof window.__JUJIN_LITE_ON_EXPORT__ === "function") {
          try { window.__JUJIN_LITE_ON_EXPORT__(); } catch (err) { /* 轻量版计时失败不影响导出 */ }
        }
        if (result.native) {
          if (!result.path) return;
          toast("已导出 " + envelope.projects.length + " 个项目到 " + result.path, "ok");
          return;
        }
        toast("已导出 " + envelope.projects.length + " 个项目（schemaVersion 2）。", "ok");
      })
      .catch(function (err) {
        toast("导出失败：" + errorText(err), "error");
      });
  }

  function normalizeImportName(value, index) {
    var name = String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 40);
    return name || "导入项目 " + (index + 1);
  }

  function importV2(parsed, fileName) {
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
      toast("导入失败：v2 项目库中没有项目。", "error");
      return;
    }
    var seen = {};
    var projects;
    try {
      projects = parsed.projects.map(function (one, index) {
        if (!one || typeof one !== "object") {
          throw new Error("第 " + (index + 1) + " 个项目不是对象。");
        }
        var incoming = normalizeState(one.state, { strict: true });
        var id = typeof one.id === "string" && one.id && !seen[one.id] ? one.id : STORE.newId();
        seen[id] = true;
        var created = typeof one.createdAt === "string" && one.createdAt ? one.createdAt : new Date().toISOString();
        var updated = typeof one.updatedAt === "string" && one.updatedAt ? one.updatedAt : created;
        return {
          id: id,
          name: normalizeImportName(one.name, index),
          createdAt: created,
          updatedAt: updated,
          linkage: one.linkage && typeof one.linkage === "object" && !Array.isArray(one.linkage)
            ? clone(one.linkage) : undefined,
          state: incoming
        };
      });
    } catch (err) {
      toast("导入失败：" + (err && err.message ? err.message : "项目数据结构不符合要求。"), "error");
      return;
    }

    var activeId = typeof parsed.activeProjectId === "string" ? parsed.activeProjectId : "";
    if (!projects.some(function (project) { return project.id === activeId; })) {
      activeId = projects[0].id;
    }
    var pageTotal = 0;
    projects.forEach(function (project) {
      pageTotal += project.state.pages.traverse.length +
        project.state.pages.leveling.length +
        project.state.pages.angle.length;
    });

    confirmDialog(
      "导入全部项目",
      "将从「" + (fileName || "所选文件") + "」导入 " + projects.length + " 个项目（三张记录表共 " + pageTotal + " 页，另含汇总表）。\n" +
        "本机当前的 " + STORE.listProjects().length + " 个项目会被整体替换且无法撤销；建议先「导出全部项目」备份。",
      { confirmLabel: "替换并导入", danger: true }
    ).then(function (ok) {
      if (!ok) return;
      noteDestructive("import-all");
      try {
        STORE.replaceAll(projects, activeId);
        var project = STORE.getActiveProject();
        showProject(project, { forceTable: true });
        toast("已导入 " + projects.length + " 个项目。", "ok");
      } catch (err) {
        toast("导入写入失败：" + (err && err.message ? err.message : "本机项目库不可写。"), "error");
      }
    });
  }

  function importV1(parsed, file) {
    var incoming;
    try {
      incoming = normalizeState(parsed, { strict: true });
    } catch (err) {
      toast("导入失败：" + (err && err.message ? err.message : "数据结构不符合要求。"), "error");
      return;
    }
    var pageCounts = {
      traverse: incoming.pages.traverse.length,
      leveling: incoming.pages.leveling.length,
      angle: incoming.pages.angle.length
    };
    var summaryCount = (incoming.pages.traverseSummary ? 1 : 0) + (incoming.pages.levelingSummary ? 1 : 0);
    var linked = linkageEnabled();
    var message = "将从「" + (file.name || "所选文件") + "」导入到当前项目「" + activeProjectName() + "」：" +
      "表一 " + pageCounts.traverse + " 页、表二 " + pageCounts.leveling + " 页、表三 " + pageCounts.angle + " 页" +
      (summaryCount ? "，另外 " + summaryCount + " 张汇总表（表头/姓名）。" : "。") + "\n" +
      "当前项目的七表数据会被整体替换且无法撤销；建议先「导出」备份。";
    if (linked) {
      message += "\n联立中：导入前会自动备份当前项目；导入后按现有映射表重新联立，只写表一有数据的测站，不会主动清理导入表三中的其他内容。";
    }
    confirmDialog(
      "导入记录",
      message,
      { confirmLabel: "替换并导入", danger: true }
    ).then(function (ok) {
      if (!ok) return;
      noteDestructive("import");
      if (linked) {
        flushLinkageSync();
        if (!backupLinkage("import")) return;
        if (!saveLinkageState({ mapping: linkageWithoutLast(STORE.getLinkage().mapping) })) return;
      }
      state = incoming;
      activeModule = state.ui.active;
      STORE.setActiveModule(activeModule);
      closeDrawer();
      if (linked) runLinkageSync({ render: false });
      renderAll();
      dom.stage.scrollTop = 0;
      saveNow(false);
      toast("已导入记录到项目「" + activeProjectName() + "」。", "ok");
    });
  }

  function importTable(parsed, file) {
    var table = parsed.table;
    var cfg = TABLES[table];
    if (!cfg) {
      toast("导入失败：单表文件里的表名无法识别。", "error");
      return;
    }
    if (linkageEnabled() && (table === "traverse" || table === "angle")) {
      toast("联立中：表一和表三由映射联动，不能单独导入。请先解除联立；表二可直接导入。", "error");
      return;
    }
    var incoming;
    try {
      incoming = normalizeState(parsed.state, { strict: true });
    } catch (err) {
      toast("导入失败：" + (err && err.message ? err.message : "单表数据结构不符合要求。"), "error");
      return;
    }
    var pages = incoming.pages[table];
    var pageCount = pages.length;
    confirmDialog(
      "导入" + cfg.short,
      "将从「" + (file.name || "所选文件") + "」导入" + cfg.short + " " + pageCount + " 页到当前项目「" +
        activeProjectName() + "」。\n" +
        "当前项目的" + cfg.short + "数据与该表设置（限差/等级等）会被整体替换；" +
        "其余各表与项目其他数据不受影响；无法撤销，建议先「导出本表」备份。",
      { confirmLabel: "替换本表并导入", danger: true }
    ).then(function (ok) {
      if (!ok) return;
      noteDestructive("import-table");
      var next = clone(state);
      next.pages[table] = clone(pages);
      next.settings[table] = clone(incoming.settings[table]);
      next.ui.pageIndex[table] = 0;
      next.ui.active = table;
      state = next;
      activeModule = table;
      STORE.setActiveModule(table);
      closeDrawer();
      renderAll();
      dom.stage.scrollTop = 0;
      saveNow(false);
      toast("已导入" + cfg.short + "（" + pageCount + " 页）；其余各表未改动。", "ok");
    });
  }

  function importText(rawText, file) {
    file = file || { name: "所选文件", size: 0 };
    var text = String(rawText == null ? "" : rawText);
    if (!text.trim()) {
      toast("导入失败：文件为空。", "error");
      return;
    }
    var size = Number(file.size) || 0;
    if (size > 32 * 1024 * 1024) {
      toast("JSON 文件超过 32 MB，未导入。", "error");
      return;
    }
    var parsed;
    try {
      text = text.replace(/^﻿/, "");
      parsed = JSON.parse(text);
    } catch (err) {
      toast("JSON 解析失败：文件格式不完整。", "error");
      return;
    }
    var info = TRANSFER.detect(parsed);
    if (info.kind === "unknown") {
      toast("导入失败：这不是可识别的记录 JSON。", "error");
      return;
    }
    if (info.kind === "future") {
      toast("导入失败：项目库版本高于当前软件支持的 schemaVersion 2。", "error");
      return;
    }
    if (info.kind === "all-projects") {
      importV2(parsed, file.name);
      return;
    }
    if (info.kind === "future-table") {
      toast("导入失败：单表文件格式版本高于当前软件支持的 formatVersion 1。", "error");
      return;
    }
    if (info.kind === "bad-table") {
      toast("导入失败：" + info.reason, "error");
      return;
    }
    if (info.kind === "unknown-kind") {
      toast("导入失败：无法识别的文件类型（kind: " + String(info.value) + "）。", "error");
      return;
    }
    if (size > 8 * 1024 * 1024) {
      toast("单个 JSON 文件超过 8 MB，未导入。", "error");
      return;
    }
    if (info.kind === "table") {
      importTable(parsed, file);
      return;
    }
    importV1(parsed, file);
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      toast("JSON 文件超过 32 MB，未导入。", "error");
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      toast("读取文件失败。", "error");
    };
    reader.onload = function () {
      importText(String(reader.result || ""), file);
    };
    reader.readAsText(file, "utf-8");
  }

  /* ------------------------------------------------------------------ *
   * 打印
   * ------------------------------------------------------------------ */

  function hideGuide(paper, cellId) {
    if (!cellId || cellId === "remark") return;
    var node = paper.querySelector('[id="' + cellId + '"]');
    if (node) node.style.display = "none";
  }

  function addPrintTextNode(paper, overlay, key, spec, text, isRemark, band) {
    if (!str(text).trim()) return false;
    var ov = el("div", "ov");
    // 打印跟随「误差色」开关：开着打印就带同样的四色，关掉仍是纯黑记录表。
    if (band === 2) ov.classList.add("band-2");
    if (band === 3) ov.classList.add("band-3");
    if (band === 4) ov.classList.add("band-4");
    if (!spec.meta) ov.classList.add("cover");
    if (!setBox(ov, spec, key)) return false;
    // 打印与屏幕用同一个缩字公式，长文本不会在纸上被截断。
    var scale = textFitScale(spec, key, text);
    ov.style.setProperty("--fs", String(Math.round(spec.font * scale * 100) / 100));
    var node = el("div", isRemark ? "print-remark" : "print-text");
    if (isRemark) {
      // 备注拿自己的排版。
    } else if (spec.wrap) {
      node.classList.add("is-wrap");
      if (spec.align === "left") node.classList.add("is-left");
    } else {
      if (spec.align === "left") node.classList.add("is-left");
      if (spec.top) node.classList.add("is-top");
    }
    node.textContent = text;
    ov.appendChild(node);
    overlay.appendChild(ov);
    if (key === "leveling" && !spec.meta) hideGuide(paper, spec.cellId);
    return true;
  }

  function addPrintSpec(paper, overlay, key, spec, pageRes, isComputed) {
    if (isComputed) {
      var result = null;
      try { result = spec.getResult(pageRes); } catch (err) { result = null; }
      var out = resolveComputed(spec, result, pageRes);
      if (!out.hasValue) return;
      addPrintTextNode(paper, overlay, key, spec, out.text, false,
        bandForSpec(spec, result, pageRes));
      return;
    }
    if (spec.kind === "dms") {
      addPrintTextNode(paper, overlay, key, spec, formatDmsParts(spec.parts), false);
      return;
    }
    var text = spec.printText ? spec.printText() : str(spec.getValue());
    addPrintTextNode(paper, overlay, key, spec, text, spec.kind === "textarea");
  }

  // 打印里的换行格与屏幕一样，写满了就按 0.06 一档收字号；
  // 纸面底尺寸来自几何，不读屏幕上那套 --fit。
  // 量的是文字本身（Range 的行框），不是 scrollHeight：这里是居中排的，
  // 上下两边各溢出一半，scrollHeight 只看得到下面那半。
  function printTextHeight(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    var top = Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < rects.length; i += 1) {
      if (rects[i].width <= 0 && rects[i].height <= 0) continue;
      top = Math.min(top, rects[i].top);
      bottom = Math.max(bottom, rects[i].bottom);
    }
    return bottom > top ? bottom - top : 0;
  }

  function shrinkPrintWrapped(root) {
    if (!root) return;
    var nodes = root.querySelectorAll(".print-text.is-wrap");
    Array.prototype.forEach.call(nodes, function (node) {
      var ov = node.parentElement;
      if (!ov || !node.clientHeight) return;
      var base = parseFloat(ov.style.getPropertyValue("--fs"));
      if (!base) return;
      var fits = function (fs) {
        ov.style.setProperty("--fs", String(fs));
        return printTextHeight(node) <= node.clientHeight + 1;
      };
      if (fits(base)) return;
      // 字号越小只会越矮（换行只减少不增加），所以可以在
      // [下限, 原字号] 之间二分，找出还放得下的最大字号。
      var lo = Math.round(base * FIT_FLOOR * 100) / 100;
      if (!fits(lo)) {
        ov.style.setProperty("--fs", String(lo));
        return;
      }
      var hi = base;
      for (var i = 0; i < 8; i += 1) {
        var mid = Math.round(((lo + hi) / 2) * 100) / 100;
        if (mid <= lo || mid >= hi) break;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      ov.style.setProperty("--fs", String(lo));
    });
  }

  function clearPrintDom() {
    document.body.classList.remove("print-mode");
    if (dom.printRoot) dom.printRoot.textContent = "";
    var style = document.getElementById("survey-print-page-style");
    if (style) style.remove();
  }

  function preparePrint(scope) {
    scope = scope === "all" ? "all" : "page";
    var key = state.ui.active;
    var cfg = TABLES[key];
    var paperCfg = PAPER[key];
    var pages = state.pages[key];
    var pageIndex = state.ui.pageIndex[key];
    var selected = scope === "all"
      ? pages.map(function (_, index) { return index; })
      : [pageIndex];

    flushSave();
    var activeNow = document.activeElement;
    if (activeNow && (/^(INPUT|TEXTAREA)$/.test(activeNow.tagName) || activeNow.isContentEditable)) {
      activeNow.blur();
    }
    clearPrintDom();
    if (printTitleBackup != null) {
      document.title = printTitleBackup;
      printTitleBackup = null;
    }
    printTitleBackup = document.title;

    var printAnalysis = analyseActive();
    selected.forEach(function (index) {
      var page = pages[index];
      var pageRes = printAnalysis.pages[index];
      if (!page || !pageRes) return;
      var specs = buildSpecs(key, page, index);
      var paper = el("div", "paper print-paper");
      paper.dataset.table = key;
      paper.style.width = paperCfg.contentWidthMm + "mm";
      paper.style.aspectRatio = cfg.sheet.width + " / " + cfg.sheet.height;
      paper.style.setProperty("--vbw", String(cfg.sheet.width));
      if (key === "angle") paper.classList.add("font-harmony");
      paper.innerHTML = cleanSvg(cfg.sheet.svg);
      var svg = paper.querySelector("svg");
      if (svg) svg.setAttribute("aria-hidden", "true");
      // 表G 一页一条导线，页脚跟着打印的第 X 页走。
      if (isCalcKey(key)) syncSheetFooter(svg, index + 1);

      var overlay = el("div", "overlay");
      specs.meta.forEach(function (spec) { addPrintSpec(paper, overlay, key, spec, pageRes, false); });
      specs.inputs.forEach(function (spec) { addPrintSpec(paper, overlay, key, spec, pageRes, false); });
      specs.computed.forEach(function (spec) { addPrintSpec(paper, overlay, key, spec, pageRes, true); });
      paper.appendChild(overlay);

      var wrapper = el("div", "print-page");
      wrapper.dataset.paper = cfg.sheet.paper === "landscape" ? "landscape" : "portrait";
      wrapper.appendChild(paper);
      dom.printRoot.appendChild(wrapper);
    });

    var pageStyle = el("style");
    pageStyle.id = "survey-print-page-style";
    pageStyle.textContent = "@page{size:A4 " + (cfg.sheet.paper === "landscape" ? "landscape" : "portrait") + ";margin:0;}";
    document.head.appendChild(pageStyle);
    document.body.classList.add("print-mode");
    // print-mode 打开后 #print-root 才有版面，量到的高度才是真的。
    shrinkPrintWrapped(dom.printRoot);
    document.title = cfg.name + " - " + (scope === "all"
      ? "全部 " + selected.length + " 页"
      : "第 " + (pageIndex + 1) + " 页");
    return true;
  }

  function cleanupPrint() {
    if (printFallback) {
      clearTimeout(printFallback);
      printFallback = null;
    }
    clearPrintDom();
    if (printTitleBackup != null) {
      document.title = printTitleBackup;
      printTitleBackup = null;
    }
    printBusy = false;
  }

  var printFallback = null;

  function printNow(scope) {
    if (printBusy) return;
    printBusy = true;
    if (!preparePrint(scope)) {
      printBusy = false;
      return;
    }
    printFallback = setTimeout(cleanupPrint, 90000);
    try {
      window.print();
    } catch (err) {
      toast("无法打开打印对话框。", "error");
      cleanupPrint();
    }
  }

  function requestPrint() {
    var key = state.ui.active;
    var pages = state.pages[key];
    var pageIndex = state.ui.pageIndex[key];
    if (pages.length <= 1) {
      printNow("page");
      return;
    }
    choiceDialog(
      "打印范围",
      "本表共 " + pages.length + " 页。打印使用 A4 " + (TABLES[key].sheet.paper === "landscape" ? "横向" : "纵向") + "。",
      [
        { value: "page", label: "打印本页（第 " + (pageIndex + 1) + " 页）", kind: "primary" },
        { value: "all", label: "打印全部 " + pages.length + " 页" }
      ]
    ).then(function (value) {
      if (value) printNow(value);
    });
  }

  /* ------------------------------------------------------------------ *
   * DOM / 事件
   * ------------------------------------------------------------------ */

  function cacheDom() {
    dom.app = document.getElementById("app");
    dom.stage = document.getElementById("stage");
    dom.tabs = document.getElementById("tabs");
    dom.aiTab = document.getElementById("ai-tab");
    dom.assistant = document.getElementById("assistant");
    dom.linkageTab = document.getElementById("linkage-tab");
    dom.linkage = document.getElementById("linkage");
    dom.linkageRows = document.getElementById("linkage-rows");
    dom.linkageSummary = document.getElementById("linkage-summary");
    dom.linkageNotice = document.getElementById("linkage-notice");
    dom.linkageResync = document.getElementById("linkage-resync");
    dom.linkageAuto = document.getElementById("linkage-auto");
    dom.linkageRestore = document.getElementById("linkage-restore");
    dom.linkageDisable = document.getElementById("linkage-disable");
    dom.bottombar = document.getElementById("bottombar");
    dom.tableTools = document.getElementById("table-tools");
    dom.moduleNote = document.getElementById("module-note");
    dom.statusChip = document.getElementById("status-chip");
    dom.quick = document.getElementById("quick-options");
    dom.bandsBtn = document.getElementById("bands-btn");
    dom.settingsBtn = document.getElementById("settings-btn");
    dom.exportBtn = document.getElementById("export-btn");
    dom.importBtn = document.getElementById("import-btn");
    dom.printBtn = document.getElementById("print-btn");
    dom.checkPanel = document.getElementById("check-panel");
    dom.checkTabBadge = document.getElementById("check-tab-badge");
    dom.checkSummary = document.getElementById("check-summary");
    dom.checkClose = document.getElementById("check-close");
    dom.checkBody = document.getElementById("check-body");
    dom.checkBtn = document.getElementById("check-btn");
    dom.prevPage = document.getElementById("prev-page");
    dom.nextPage = document.getElementById("next-page");
    dom.pageLabel = document.getElementById("page-label");
    dom.addPage = document.getElementById("add-page");
    dom.deletePage = document.getElementById("delete-page");
    dom.ownerChip = document.getElementById("owner-chip");
    dom.ownerPopover = document.getElementById("owner-popover");
    dom.ownerPopoverBody = document.getElementById("owner-popover-body");
    dom.ownerClose = document.getElementById("owner-close");
    dom.zoomValue = document.getElementById("zoom-value");
    dom.zoomHud = document.getElementById("zoom-hud");
    dom.saveStatus = document.getElementById("save-status");
    dom.saveText = dom.saveStatus ? dom.saveStatus.querySelector(".txt") : null;
    dom.drawer = document.getElementById("drawer");
    dom.drawerBackdrop = document.getElementById("drawer-backdrop");
    dom.drawerTitle = document.getElementById("drawer-title");
    dom.drawerClose = document.getElementById("drawer-close");
    dom.drawerBody = document.getElementById("drawer-body");
    dom.modalBackdrop = document.getElementById("modal-backdrop");
    dom.modalTitle = document.getElementById("modal-title");
    dom.modalMessage = document.getElementById("modal-message");
    dom.modalActions = document.getElementById("modal-actions");
    dom.toast = document.getElementById("toast");
    dom.printRoot = document.getElementById("print-root");
    dom.importFile = document.getElementById("import-file");
  }

  function toggleChecks() {
    if (checksOpen) setChecksOpen(false);
    else openChecks("issues");
  }

  function bindShell() {
    var tabButtons = $all("#tabs .tab");

    function activateTab(button) {
      if (!button || button.hidden) return;
      var module = button.getAttribute("data-module");
      if (module === "assistant" || module === "linkage") setActiveModule(module);
      else setActiveTable(button.getAttribute("data-table"));
    }

    tabButtons.forEach(function (button) {
      button.addEventListener("click", function () { activateTab(button); });
      button.addEventListener("keydown", function (event) {
        var visible = tabButtons.filter(function (one) { return !one.hidden; });
        var index = visible.indexOf(button);
        if (index < 0) return;
        var targetIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          targetIndex = (index + 1) % visible.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          targetIndex = (index - 1 + visible.length) % visible.length;
        } else if (event.key === "Home") {
          targetIndex = 0;
        } else if (event.key === "End") {
          targetIndex = visible.length - 1;
        }
        if (targetIndex === null) return;
        event.preventDefault();
        var target = visible[targetIndex];
        target.focus();
        activateTab(target);
      });
    });

    if (dom.linkageResync) dom.linkageResync.addEventListener("click", resyncLinkage);
    if (dom.linkageAuto) dom.linkageAuto.addEventListener("click", resetLinkageMapping);
    if (dom.linkageRestore) dom.linkageRestore.addEventListener("click", restoreLinkageBackup);
    if (dom.linkageDisable) dom.linkageDisable.addEventListener("click", function () { setLinkageEnabled(false); });

    dom.statusChip.addEventListener("click", toggleChecks);
    dom.checkBtn.addEventListener("click", toggleChecks);
    dom.checkClose.addEventListener("click", function () { setChecksOpen(false); });
    if (dom.bandsBtn) {
      dom.bandsBtn.addEventListener("click", function () { setErrorBands(!bandsOn); });
    }
    dom.settingsBtn.addEventListener("click", openDrawer);
    dom.exportBtn.addEventListener("click", exportTableJson);
    dom.importBtn.addEventListener("click", requestImport);
    dom.printBtn.addEventListener("click", requestPrint);

    dom.prevPage.addEventListener("click", function () {
      gotoPage(state.ui.pageIndex[state.ui.active] - 1);
    });
    dom.nextPage.addEventListener("click", function () {
      gotoPage(state.ui.pageIndex[state.ui.active] + 1);
    });
    dom.addPage.addEventListener("click", addPage);
    dom.deletePage.addEventListener("click", deletePage);
    if (dom.ownerChip) {
      dom.ownerChip.addEventListener("click", function (event) {
        event.stopPropagation();
        if (ownerPopoverOpen) closeOwnerPopover();
        else openOwnerPopover();
      });
    }
    if (dom.ownerClose) dom.ownerClose.addEventListener("click", closeOwnerPopover);
    if (dom.ownerPopover) {
      dom.ownerPopover.addEventListener("click", function (event) { event.stopPropagation(); });
    }
    document.addEventListener("click", function () {
      if (ownerPopoverOpen) closeOwnerPopover();
    });
    if (dom.zoomValue) {
      dom.zoomValue.addEventListener("focus", function () { dom.zoomValue.select(); });
      dom.zoomValue.addEventListener("click", function () { dom.zoomValue.select(); });
      dom.zoomValue.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          commitZoomValue();
          dom.zoomValue.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          updateZoomControls();
          dom.zoomValue.blur();
        }
      });
      dom.zoomValue.addEventListener("blur", commitZoomValue);
    }
    if (dom.stage) {
      dom.stage.addEventListener("wheel", handleStageWheel, { passive: false });
      dom.stage.addEventListener("pointerdown", beginRightZoom);
      dom.stage.addEventListener("contextmenu", function (event) { event.preventDefault(); });
      window.addEventListener("pointerup", endRightZoom);
      window.addEventListener("pointercancel", endRightZoom);
      window.addEventListener("blur", endRightZoom);
    }
    // WebView2 开启捏合后会把触控板手势作为 ctrl + wheel 送达；
    // 这里兜底拦掉整个 WebView 的页面缩放，表格缩放仍由 stage 的 wheel 处理。
    // window 捕获阶段比 document 更早，且非 passive 才能阻止浏览器默认缩放。
    window.addEventListener("keydown", handleZoomKeys, true);
    window.addEventListener("wheel", suppressNativeWheelZoom, { passive: false, capture: true });

    $all("[data-check-tab]", dom.checkPanel).forEach(function (button) {
      button.addEventListener("click", function () {
        checksTab = button.getAttribute("data-check-tab") === "rules" ? "rules" : "issues";
        renderCheck(false);
      });
    });

    dom.drawerClose.addEventListener("click", closeDrawer);
    dom.drawerBackdrop.addEventListener("click", closeDrawer);

    dom.modalBackdrop.addEventListener("click", function (event) {
      if (event.target === dom.modalBackdrop) settleModal(null);
    });

    dom.importFile.addEventListener("change", function () {
      var file = dom.importFile.files && dom.importFile.files[0];
      dom.importFile.value = "";
      if (file) importFile(file);
    });

    window.addEventListener("resize", scheduleFit);
    window.addEventListener("afterprint", cleanupPrint);
    window.addEventListener("beforeunload", flushSave);
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushSave();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (modalResolve) {
        event.preventDefault();
        settleModal(null);
        return;
      }
      if (ownerPopoverOpen) {
        event.preventDefault();
        closeOwnerPopover();
        return;
      }
      if (drawerOpen) {
        event.preventDefault();
        closeDrawer();
      }
    });

    if (window.ResizeObserver && dom.stage) {
      var observer = new ResizeObserver(scheduleFit);
      observer.observe(dom.stage);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        scheduleFit();
        refitTextFields();
        fitAllWrappedFields();
      }).catch(function () { /* ignore */ });
    }
  }

  /* lite:drop:start agent-bridge */
  /* ------------------------------------------------------------------ *
   * 内部 Agent 桥（非调试）：Work 模式读表 / 写表 / 加页
   *
   * 与 __sheetApp 不同，这不是测试入口，而是 agent/ui.js 在 Work 模式下
   * 读写表一、表二的唯一通道。所有方法同步返回 JSON-safe 数据；可预期
   * 错误返回 {ok:false,error:"…"}，意外异常在最外层兜底，不向外抛。
   * ------------------------------------------------------------------ */

  var AGENT_PREVIEW_LIMIT = 20;
  var AGENT_PREVIEW_TTL = 5 * 60 * 1000;
  var AGENT_MAX_EDITS = 40;
  var AGENT_MAX_ISSUES = 20;
  // 一次性预览令牌：key -> {projectId,table,page,editsSig,pageHash,createdAt}
  // 只活在本次页面会话里，不落盘、不进工具结果。
  var agentPreviewTokens = new Map();
  var agentPreviewSeq = 0;

  function agentErrorText(err) {
    if (err && err.message) return String(err.message);
    var text = String(err == null ? "" : err);
    return text || "未知错误";
  }

  function agentFail(message) {
    return { ok: false, error: str(message) || "操作失败" };
  }

  function agentUnexpected(err) {
    return { ok: false, error: agentErrorText(err) };
  }

  function agentTableInfo(table) {
    if (table !== "traverse" && table !== "leveling") return null;
    return TABLES[table] || null;
  }

  function agentProjectId() {
    try {
      return STORE && typeof STORE.getActiveProjectId === "function"
        ? STORE.getActiveProjectId()
        : null;
    } catch (err) {
      return null;
    }
  }

  function agentCapabilities() {
    try {
      if (!state) {
        return {
          ok: false,
          writable: false,
          storage: "failed",
          reason: "项目尚未载入",
          error: "项目尚未载入"
        };
      }
      var info = saveInfo() || {};
      var mode = info.mode;
      var storage;
      if (mode === "memory") {
        storage = "memory";
      } else if (mode === "native" || mode === "local") {
        // 浏览器开发版的 localStorage 也是可持久化的本机存储；对上层只暴露
        // 计划里约定的 native / memory / failed 三种口径。
        storage = (storageOk === false || info.lastError) ? "failed" : "native";
      } else {
        storage = "failed";
      }
      var futureVersion = nativeLoadMeta && nativeLoadMeta.futureVersion;
      var writable = storage === "native" && !futureVersion;
      var reason = "";
      if (!writable) {
        if (futureVersion) {
          reason = "项目库由更新版本创建（v" + futureVersion + "），本版本只读；请升级软件后再写入";
        } else if (storage === "memory") {
          reason = "本机存储不可用（内存模式），不能写盘；请先导出 JSON 备份";
        } else if (storage === "failed") {
          reason = "项目库当前不可写（保存失败或存储异常）；请先导出 JSON 备份";
        } else {
          reason = "项目库不可写；请先导出 JSON 备份";
        }
      }
      return { ok: true, writable: writable, storage: storage, reason: reason };
    } catch (err) {
      return {
        ok: false,
        writable: false,
        storage: "failed",
        reason: agentErrorText(err),
        error: agentErrorText(err)
      };
    }
  }

  // 把 1 起页码换成 0 起下标；缺省用该表当前页。不夹取，越界直接报错。
  function agentPagePosition(table, page) {
    var pages = state.pages[table];
    var index;
    if (page == null || page === "") {
      index = state.ui.pageIndex[table];
    } else {
      var n = Number(page);
      if (!Number.isFinite(n) || Math.floor(n) !== n) {
        return agentFail("页码必须是整数");
      }
      index = n - 1;
    }
    if (index < 0 || index >= MAX_PAGES) {
      return agentFail("页码需在 1 到 " + MAX_PAGES + " 之间");
    }
    if (!pages[index]) {
      return agentFail("第 " + (index + 1) + " 页不存在（本表共 " + pages.length + " 页）");
    }
    return { ok: true, index: index, page: index + 1 };
  }

  function agentSpecCollection(table, pageIndex) {
    var page = state.pages[table][pageIndex];
    var specs = buildSpecs(table, page, pageIndex);
    var writable = [];
    var byCell = {};
    (specs.meta || []).concat(specs.inputs || []).forEach(function (spec) {
      byCell[spec.cellId] = spec;
      if (!spec.readOnly) writable.push(spec);
    });
    return {
      page: page,
      specs: specs,
      writable: writable,
      byCell: byCell
    };
  }

  // 同一格的“规范值”：读表、预览比较、页面指纹、应用后回读都用它。
  // DMS 用 printText()；尺读数统一成 LC.staffMeters 的米；文本按
  // readWrappedText 的折行规则；digits 先补齐 padDigits。
  function agentFoldText(value) {
    return str(value).replace(/\r/g, "").replace(/\n+/g, " ");
  }

  function agentCanonicalValue(spec) {
    if (!spec) return "";
    if (spec.kind === "dms") {
      return spec.printText ? str(spec.printText()) : "";
    }
    if (spec.kind === "staff") {
      return str(LC.staffMeters(str(spec.getValue())));
    }
    if (spec.kind === "textarea") {
      return str(spec.getValue());
    }
    if (spec.kind === "digits") {
      return str(normalizeSimpleValue(spec, str(spec.getValue())));
    }
    if (spec.kind === "text" || spec.kind == null) {
      return agentFoldText(str(spec.getValue()));
    }
    return str(spec.getValue());
  }

  // FNV-1a 32 位：对按 cellId 排序的可写格规范值计算。
  function agentPageHash(table, pageIndex, collection) {
    var col = collection || agentSpecCollection(table, pageIndex);
    var specs = col.writable.slice().sort(function (a, b) {
      if (a.cellId < b.cellId) return -1;
      if (a.cellId > b.cellId) return 1;
      return 0;
    });
    var text = specs.map(function (spec) { return agentCanonicalValue(spec); }).join("\n");
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      // hash *= 16777619（FNV-1a 的 32 位质数），用移位加法避免浮点乘法。
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) +
        (hash << 8) + (hash << 24))) >>> 0;
    }
    return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  // 严格按 spec.kind 校验并规范化一个输入值。返回值里 canonical 是规范值，
  // parts 只给 DMS 写回用；任何一个错误都带中文说明。
  function agentNormalizeEditValue(spec, value) {
    if (typeof value !== "string") {
      return { ok: false, error: "值必须是字符串" };
    }
    var raw = value;

    if (spec.kind === "dms") {
      if (!raw.trim()) return { ok: true, canonical: "", parts: blankDms() };
      // parseDmsText 在 allowMinus=false 时会静默丢掉负号；写表不能把
      // 方向悄悄翻反，所以这里先明确拒绝。
      if (!spec.allowMinus && /^\s*-/.test(raw)) {
        return { ok: false, error: "该角度不接受负号" };
      }
      var parsed = parseDmsText(raw, !!spec.allowMinus);
      if (!parsed) return { ok: false, error: "角度格式应为 d°m′s″" };
      return { ok: true, canonical: formatDmsParts(parsed), parts: parsed };
    }

    if (spec.kind === "digits") {
      var digitsRaw = raw.trim();
      if (!digitsRaw) return { ok: true, canonical: "" };
      if (!/^\d+$/.test(digitsRaw)) return { ok: false, error: "只能填数字" };
      var maxDigits = spec.maxDigits || 0;
      // 超长必须报错，不能像输入框清洁器那样静默截断。
      if (maxDigits && digitsRaw.length > maxDigits) {
        return { ok: false, error: "最多 " + maxDigits + " 位数字" };
      }
      var cleanedDigits = cleanSimpleValue(spec, digitsRaw);
      return { ok: true, canonical: str(normalizeSimpleValue(spec, cleanedDigits)) };
    }

    if (spec.kind === "staff") {
      var staffRaw = raw.trim();
      if (!staffRaw) return { ok: true, canonical: "" };
      // 先拒绝字母等非数字字符，避免 sanitizeStaffInput 把它们悄悄吃掉。
      if (!/^[0-9.,]+$/.test(staffRaw)) {
        return { ok: false, error: "尺读数请按米填（如 1.170）或旧毫米整数（如 1170）" };
      }
      var meters = str(LC.staffMeters(staffRaw));
      if (!/^\d{1,3}\.\d{3}$/.test(meters)) {
        return { ok: false, error: "尺读数请按米填（如 1.170）或旧毫米整数（如 1170）" };
      }
      return { ok: true, canonical: meters };
    }

    if (spec.kind === "decimal" || spec.kind === "packed") {
      var decimalRaw = raw.trim();
      if (!decimalRaw) return { ok: true, canonical: "" };
      var decimalPattern = spec.signed
        ? /^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/
        : /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
      if (!decimalPattern.test(decimalRaw)) {
        return { ok: false, error: spec.signed ? "请填数字（可带负号）" : "请填数字" };
      }
      var cleaned = cleanSimpleValue(spec, decimalRaw);
      var normalized = normalizeSimpleValue(spec, cleaned);
      if (normalized === "" || normalized === "-") {
        return { ok: false, error: "请填数字" };
      }
      return { ok: true, canonical: str(normalized) };
    }

    // 单行/换行文本：CR/LF 折成空格；textarea 保留换行。
    var text = raw;
    if (spec.kind !== "textarea") {
      text = agentFoldText(text);
      if (spec.wrap) text = text.trim();
    }
    if (spec.maxlength && text.length > spec.maxlength) {
      return { ok: false, error: "最多 " + spec.maxlength + " 个字符" };
    }
    return { ok: true, canonical: text };
  }

  // edits 允许两种形态：工具原始 {cell,value}，或预览返回的 {cell,...,after}。
  function agentPrepareEdits(table, pageIndex, edits) {
    if (!Array.isArray(edits) || !edits.length) {
      return agentFail("edits 必须是非空数组");
    }
    if (edits.length > AGENT_MAX_EDITS) {
      return agentFail("一次最多写 " + AGENT_MAX_EDITS + " 格");
    }
    var collection = agentSpecCollection(table, pageIndex);
    var seen = {};
    var entries = [];
    for (var i = 0; i < edits.length; i += 1) {
      var item = edits[i];
      if (!item || typeof item !== "object") {
        return agentFail("edits[" + i + "] 格式不正确");
      }
      var cell = str(item.cell);
      if (!cell) return agentFail("edits[" + i + "] 缺少 cell");
      if (seen[cell]) return agentFail("同一格不能重复提交：" + cell);
      var spec = collection.byCell[cell];
      if (!spec) return agentFail("格不存在：" + cell);
      if (spec.readOnly) return agentFail("只读格不能写入：" + cell);
      var value = Object.prototype.hasOwnProperty.call(item, "value") ? item.value : item.after;
      if (typeof value !== "string") {
        return agentFail("格 " + cell + " 的值必须是字符串");
      }
      var normalized = agentNormalizeEditValue(spec, value);
      if (!normalized.ok) {
        return agentFail((spec.aria || cell) + "：" + normalized.error);
      }
      seen[cell] = true;
      entries.push({
        cell: cell,
        spec: spec,
        kind: spec.kind,
        label: spec.aria || cell,
        before: agentCanonicalValue(spec),
        after: normalized.canonical,
        parts: normalized.parts || null
      });
    }
    var signature = entries.slice().sort(function (a, b) {
      if (a.cell < b.cell) return -1;
      if (a.cell > b.cell) return 1;
      return 0;
    }).map(function (entry) {
      return entry.cell + "\u0000" + entry.after;
    }).join("\u0001");
    return { ok: true, collection: collection, entries: entries, signature: signature };
  }

  function agentPrunePreviewTokens(now) {
    agentPreviewTokens.forEach(function (record, token) {
      if (!record || now - record.createdAt > AGENT_PREVIEW_TTL) {
        agentPreviewTokens.delete(token);
      }
    });
  }

  function agentIssuePreviewToken(binding) {
    var now = Date.now();
    agentPrunePreviewTokens(now);
    while (agentPreviewTokens.size >= AGENT_PREVIEW_LIMIT) {
      var oldest = agentPreviewTokens.keys().next();
      if (oldest.done) break;
      agentPreviewTokens.delete(oldest.value);
    }
    agentPreviewSeq += 1;
    var token = "pv" + now.toString(36) + "-" + agentPreviewSeq.toString(36) +
      "-" + Math.random().toString(36).slice(2, 10);
    agentPreviewTokens.set(token, Object.assign({}, binding, { createdAt: now }));
    return token;
  }

  function agentTakePreviewToken(token) {
    var record = agentPreviewTokens.get(token);
    if (!record) return null;
    if (Date.now() - record.createdAt > AGENT_PREVIEW_TTL) {
      agentPreviewTokens.delete(token);
      return null;
    }
    return record;
  }

  function agentPageVisible(table, pageIndex) {
    return !!state &&
      activeModule === table &&
      state.ui.active === table &&
      !!runtime &&
      runtime.key === table &&
      runtime.pageIndex === pageIndex &&
      !!dom.stage &&
      !dom.stage.inert;
  }

  function agentRollbackApplied(applied) {
    for (var i = applied.length - 1; i >= 0; i -= 1) {
      var item = applied[i];
      try {
        if (item.dms) {
          item.spec.parts.d = item.old.d;
          item.spec.parts.m = item.old.m;
          item.spec.parts.s = item.old.s;
        } else {
          item.spec.setValue(item.old);
        }
      } catch (err) {
        /* 回滚失败时保留后续 attempt 的机会，不掩盖原始错误 */
      }
    }
  }

  // 撤销记录里的 DMS before 来自 formatDmsParts，可能是只有度/只有分秒的
  // 半填状态（例如「123°」「05′12″」），parseDmsText 要求三段齐全，不能用来
  // 还原。这里按 formatDmsParts 自己输出的标记格式拆回三段，保留原样。
  function agentParseDmsParts(text) {
    var raw = str(text).trim();
    if (!raw) return { d: "", m: "", s: "" };
    var rest = raw;
    var d = "";
    var m = "";
    var s = "";
    function cut(marker) {
      var index = rest.indexOf(marker);
      if (index < 0) return "";
      var value = rest.slice(0, index).trim();
      rest = rest.slice(index + marker.length);
      return value;
    }
    if (rest.indexOf("°") >= 0) d = cut("°");
    if (rest.indexOf("′") >= 0) m = cut("′");
    if (rest.indexOf("″") >= 0) s = cut("″");
    if (rest.trim()) {
      // 没有标记时只接受单个纯度值（例如「123」），其余都视为坏记录。
      if (!d && !m && !s && /^-?\d{1,3}$/.test(raw)) d = raw;
      else return null;
    }
    if (d && !/^-?\d{1,3}$/.test(d)) return null;
    if (m && !/^\d{1,2}$/.test(m)) return null;
    if (s && !/^\d{1,2}$/.test(s)) return null;
    return { d: d, m: m, s: s };
  }

  // 撤销写入时把 before 规范值还原回格子。DMS/尺读数要先还原成内部结构。
  function agentRestoreValue(spec, before) {
    if (spec.kind === "dms") {
      var parsed = agentParseDmsParts(before);
      if (!parsed) throw new Error("撤销值不是有效的角度");
      spec.parts.d = parsed.d;
      spec.parts.m = parsed.m;
      spec.parts.s = parsed.s;
      return;
    }
    if (spec.kind === "staff") {
      var meters = str(before).trim() ? str(LC.staffMeters(str(before))) : "";
      if (str(before).trim() && !/^\d{1,3}\.\d{3}$/.test(meters)) {
        throw new Error("撤销值不是有效的尺读数");
      }
      spec.setValue(meters);
      return;
    }
    spec.setValue(str(before));
  }

  // 只更新当前可见页的 DOM，绝不调用 renderStage()。
  function agentSyncDomField(field, spec) {
    if (!field || !field.ov) return;
    spec = spec || field.spec;
    try {
      if (spec.kind === "dms") {
        var keys = ["d", "m", "s"];
        for (var i = 0; i < keys.length; i += 1) {
          if (field.inputs && field.inputs[i]) {
            field.inputs[i].value = str(spec.parts[keys[i]]);
          }
        }
      } else if (field.kind === "wrapped") {
        setWrappedText(field.input, agentCanonicalValue(spec));
        fitWrappedField(field);
      } else if (field.kind === "textarea") {
        field.input.value = str(spec.getValue());
      } else {
        field.input.value = agentCanonicalValue(spec);
      }
      syncFieldValue(spec, field);
      if (field.kind === "simple") {
        applyFitScale(field.spec, field.input, field.key);
      }
    } catch (err) {
      // DOM 更新失败不回滚已经写入的 state；下一次 renderStage 会纠正显示。
    }
  }

  function agentFinishTableWrite(table, pageIndex, entries, capability) {
    if (agentPageVisible(table, pageIndex)) {
      entries.forEach(function (entry) {
        var field = runtime && runtime.fields ? runtime.fields[entry.cell] : null;
        if (field) agentSyncDomField(field, entry.spec);
      });
    }
    var linkageSynced = false;
    if (table === "traverse") {
      var linked = linkageEnabled();
      var syncResult = runLinkageSync({ render: false });
      linkageSynced = !!(linked && syncResult);
    }
    // 只有当前渲染的就是被写/被联动的表时才重算；否则 analysis.runtime 对不上，
    // renderComputed 会拿另一张表的页结果去喂本表的规格（M3 表二写入崩溃）。
    if (runtime && (state.ui.active === table ||
        (linkageSynced && state.ui.active === "traverseSummary"))) {
      recompute();
    }
    saveNow(false);
    var saved = !memoryMode() && storageOk !== false;
    var mode = capability && capability.storage ? capability.storage : "native";
    return {
      saved: saved,
      linkageSynced: linkageSynced,
      storage: saved ? mode : (mode === "memory" ? "memory" : "failed")
    };
  }

  function agentDeepEqual(a, b) {
    if (a === b) return true;
    var aArray = Array.isArray(a);
    var bArray = Array.isArray(b);
    if (aArray || bArray) {
      if (!aArray || !bArray || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i += 1) {
        if (!agentDeepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    var aKeys = Object.keys(a);
    var bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (var k = 0; k < aKeys.length; k += 1) {
      var key = aKeys[k];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!agentDeepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  function agentReadTable(table, page) {
    try {
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var pos = agentPagePosition(table, page);
      if (!pos.ok) return pos;
      var collection = agentSpecCollection(table, pos.index);
      var cells = {};
      collection.writable.forEach(function (spec) {
        // 读表按计划给“落格值”：DMS 用 printText，其余用 getValue。
        // 指纹/预览/应用比较仍统一走 agentCanonicalValue（见 pageHash）。
        cells[spec.cellId] = spec.kind === "dms"
          ? str(spec.printText())
          : str(spec.getValue());
      });
      var computed = {};
      (collection.specs.meta || []).concat(collection.specs.inputs || []).forEach(function (spec) {
        if (spec.readOnly) computed[spec.cellId] = agentCanonicalValue(spec);
      });
      var result = table === "traverse" ? analyseTraverse() : analyseLeveling();
      var pageRes = result.pages[pos.index];
      collection.specs.computed.forEach(function (spec) {
        var item = null;
        try {
          item = spec.getResult(pageRes);
        } catch (err) {
          item = null;
        }
        var out = resolveComputed(spec, item, pageRes);
        // 空白页不返回满屏“待填”，只返回已经算出的值与无效标记。
        if (out.text && !out.placeholder) computed[spec.cellId] = out.text;
      });

      var rawIssues = pageRes && Array.isArray(pageRes.issues) ? pageRes.issues : [];
      var truncated = rawIssues.length > AGENT_MAX_ISSUES;
      var issues = rawIssues.slice(0, AGENT_MAX_ISSUES).map(function (issue) {
        return {
          level: str(issue.level),
          message: str(issue.message),
          cell: str(issue.focusCell ||
            (issue.cellIds && issue.cellIds.length ? issue.cellIds[0] : "")),
          code: str(issue.code)
        };
      });

      // blank 只看测站/备注等录入数据；新页继承来的 meta 不算数据。
      var blank = !pageHasData(table, {
        meta: {},
        stations: collection.page.stations,
        remark: collection.page.remark
      });

      return {
        ok: true,
        table: table,
        tableLabel: TABLES[table].short,
        page: pos.page,
        pageCount: state.pages[table].length,
        blank: blank,
        hash: agentPageHash(table, pos.index, collection),
        cells: cells,
        computed: computed,
        issues: issues,
        truncated: truncated,
        notes: "h/v/s 为 d°m′s″；尺读数按米；空串表示清空"
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentPreviewTableEdits(table, page, edits) {
    try {
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var pos = agentPagePosition(table, page);
      if (!pos.ok) return pos;
      var prepared = agentPrepareEdits(table, pos.index, edits);
      if (!prepared.ok) return prepared;

      var pageHash = agentPageHash(table, pos.index, prepared.collection);
      var changed = [];
      var unchanged = [];
      prepared.entries.forEach(function (entry) {
        if (entry.before === entry.after) unchanged.push(entry.cell);
        else changed.push(entry.cell);
      });
      var previewToken = agentIssuePreviewToken({
        projectId: agentProjectId(),
        table: table,
        page: pos.page,
        editsSig: prepared.signature,
        pageHash: pageHash
      });
      return {
        ok: true,
        previewToken: previewToken,
        table: table,
        tableLabel: TABLES[table].short,
        page: pos.page,
        pageCount: state.pages[table].length,
        pageHash: pageHash,
        linkageSynced: table === "traverse" && linkageEnabled(),
        edits: prepared.entries.map(function (entry) {
          return {
            cell: entry.cell,
            label: entry.label,
            kind: entry.kind,
            before: entry.before,
            after: entry.after
          };
        }),
        changed: changed,
        unchanged: unchanged,
        expected: prepared.entries.map(function (entry) {
          return { cell: entry.cell, value: entry.before };
        })
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentApplyTableEdits(table, page, edits, expected, previewToken) {
    try {
      var capability = agentCapabilities();
      if (!capability.ok || !capability.writable) {
        return agentFail(capability.reason || capability.error || "项目库不可写");
      }
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var pos = agentPagePosition(table, page);
      if (!pos.ok) return pos;
      var prepared = agentPrepareEdits(table, pos.index, edits);
      if (!prepared.ok) return prepared;

      if (typeof previewToken !== "string" || !previewToken) {
        return agentFail("缺少预览令牌，请先预览写入");
      }
      var record = agentTakePreviewToken(previewToken);
      if (!record) return agentFail("预览已过期或不存在，请重新预览");
      if (record.table !== table || record.page !== pos.page ||
          record.projectId !== agentProjectId()) {
        agentPreviewTokens.delete(previewToken);
        return agentFail("预览与当前项目/表/页不一致，请重新预览");
      }
      if (record.editsSig !== prepared.signature) {
        agentPreviewTokens.delete(previewToken);
        return agentFail("写入内容与预览不一致，请重新预览");
      }

      if (!Array.isArray(expected)) {
        return agentFail("缺少 expected，请重新预览");
      }
      var expectedMap = {};
      var expectedCount = 0;
      expected.forEach(function (item) {
        if (!item || item.cell == null) return;
        var cell = str(item.cell);
        if (!cell) return;
        if (!Object.prototype.hasOwnProperty.call(expectedMap, cell)) expectedCount += 1;
        expectedMap[cell] = str(item.value);
      });
      var sameCells = expectedCount === prepared.entries.length &&
        prepared.entries.every(function (entry) {
          return Object.prototype.hasOwnProperty.call(expectedMap, entry.cell);
        });
      if (!sameCells) return agentFail("expected 与 edits 不一致，请重新预览");

      // 令牌一次性：通过绑定校验后就作废，失败路径由 UI 重新预览。
      agentPreviewTokens.delete(previewToken);

      var pageHash = agentPageHash(table, pos.index, prepared.collection);
      var current = [];
      var currentMap = {};
      prepared.entries.forEach(function (entry) {
        var value = agentCanonicalValue(entry.spec);
        currentMap[entry.cell] = value;
        current.push({ cell: entry.cell, value: value });
      });
      var stale = pageHash !== record.pageHash;
      if (!stale) {
        for (var i = 0; i < prepared.entries.length; i += 1) {
          var entry = prepared.entries[i];
          if (currentMap[entry.cell] !== expectedMap[entry.cell]) {
            stale = true;
            break;
          }
        }
      }
      if (stale) {
        return {
          ok: false,
          stale: true,
          error: "预览已过期或表格已变化，请重新预览",
          current: current,
          pageHash: pageHash
        };
      }

      var visible = agentPageVisible(table, pos.index);
      if (visible) {
        for (var f = 0; f < prepared.entries.length; f += 1) {
          var focusEntry = prepared.entries[f];
          var focusField = runtime.fields ? runtime.fields[focusEntry.cell] : null;
          if (focusField && focusField.ov && focusField.ov.contains(document.activeElement)) {
            return agentFail("「" + focusEntry.label + "」正在编辑，请先移开焦点");
          }
        }
      }

      var applied = [];
      try {
        prepared.entries.forEach(function (item) {
          if (item.spec.kind === "dms") {
            applied.push({
              spec: item.spec,
              dms: true,
              old: {
                d: item.spec.parts.d,
                m: item.spec.parts.m,
                s: item.spec.parts.s
              }
            });
            item.spec.parts.d = item.parts.d;
            item.spec.parts.m = item.parts.m;
            item.spec.parts.s = item.parts.s;
          } else {
            applied.push({ spec: item.spec, dms: false, old: item.spec.getValue() });
            item.spec.setValue(item.after);
          }
        });
      } catch (err) {
        agentRollbackApplied(applied);
        return agentFail("写入失败，已回滚：" + agentErrorText(err));
      }

      // 回读校验：用新生成的 specs 逐格核对规范值。
      var verifyCollection = agentSpecCollection(table, pos.index);
      var badCells = [];
      prepared.entries.forEach(function (item) {
        var spec = verifyCollection.byCell[item.cell];
        if (!spec || agentCanonicalValue(spec) !== item.after) badCells.push(item.cell);
      });
      if (badCells.length) {
        agentRollbackApplied(applied);
        return agentFail("写入后校验失败，已回滚：" + badCells.join("、"));
      }

      var finished = agentFinishTableWrite(table, pos.index, prepared.entries, capability);
      var changedCount = prepared.entries.filter(function (item) {
        return item.before !== item.after;
      }).length;
      var newHash = agentPageHash(table, pos.index, verifyCollection);
      return {
        ok: true,
        changed: changedCount,
        unchanged: prepared.entries.length - changedCount,
        saved: finished.saved,
        storage: finished.storage,
        linkageSynced: finished.linkageSynced,
        undo: {
          table: table,
          tableLabel: TABLES[table].short,
          page: pos.page,
          pageHash: newHash,
          // 只记真正变了的格：undo 记录有容量上限，未变的格不该占名额。
          cells: prepared.entries.filter(function (item) {
            return item.before !== item.after;
          }).map(function (item) {
            return {
              cell: item.cell,
              label: item.label,
              before: item.before,
              after: item.after
            };
          })
        }
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentUndoTableEdits(table, page, pageHash, cells) {
    try {
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var pos = agentPagePosition(table, page);
      if (!pos.ok) return pos;
      if (!Array.isArray(cells) || !cells.length) {
        return agentFail("撤销记录为空");
      }
      if (cells.length > AGENT_MAX_EDITS) {
        return agentFail("撤销记录超过 " + AGENT_MAX_EDITS + " 格");
      }
      var collection = agentSpecCollection(table, pos.index);
      var seen = {};
      var entries = [];
      for (var i = 0; i < cells.length; i += 1) {
        var item = cells[i];
        if (!item || typeof item !== "object") {
          return agentFail("撤销记录第 " + (i + 1) + " 项格式不正确");
        }
        var cell = str(item.cell);
        if (!cell) return agentFail("撤销记录第 " + (i + 1) + " 项缺少 cell");
        if (seen[cell]) return agentFail("撤销记录同一格重复：" + cell);
        var spec = collection.byCell[cell];
        if (!spec) return agentFail("格不存在：" + cell);
        if (spec.readOnly) return agentFail("只读格不能撤销写入：" + cell);
        if (typeof item.before !== "string" || typeof item.after !== "string") {
          return agentFail("撤销记录 " + cell + " 缺少 before/after");
        }
        seen[cell] = true;
        entries.push({
          cell: cell,
          spec: spec,
          label: spec.aria || cell,
          before: item.before,
          after: item.after
        });
      }

      var current = entries.map(function (entry) {
        return { cell: entry.cell, value: agentCanonicalValue(entry.spec) };
      });
      // pageHash 只作为调用方持有的页面版本信息；撤销是否安全以逐格 after
      // 核对为准（计划要求：任一目标格被改过就整批拒绝，其它格改动不影响）。
      if (pageHash != null && typeof pageHash !== "string") {
        return agentFail("pageHash 必须是字符串");
      }

      var conflicts = [];
      entries.forEach(function (entry) {
        var value = agentCanonicalValue(entry.spec);
        if (value !== entry.after) {
          conflicts.push({ cell: entry.cell, current: value, after: entry.after });
        }
      });
      if (conflicts.length) {
        return {
          ok: false,
          error: "表格已改动，无法撤销",
          conflicts: conflicts,
          current: current
        };
      }

      var visible = agentPageVisible(table, pos.index);
      if (visible) {
        for (var f = 0; f < entries.length; f += 1) {
          var focusField = runtime.fields ? runtime.fields[entries[f].cell] : null;
          if (focusField && focusField.ov && focusField.ov.contains(document.activeElement)) {
            return agentFail("「" + entries[f].label + "」正在编辑，请先移开焦点");
          }
        }
      }

      var applied = [];
      try {
        entries.forEach(function (entry) {
          if (entry.spec.kind === "dms") {
            applied.push({
              spec: entry.spec,
              dms: true,
              old: {
                d: entry.spec.parts.d,
                m: entry.spec.parts.m,
                s: entry.spec.parts.s
              }
            });
          } else {
            applied.push({ spec: entry.spec, dms: false, old: entry.spec.getValue() });
          }
          agentRestoreValue(entry.spec, entry.before);
        });
      } catch (err) {
        agentRollbackApplied(applied);
        return agentFail("撤销失败，已回滚：" + agentErrorText(err));
      }

      var verifyCollection = agentSpecCollection(table, pos.index);
      var badCells = [];
      entries.forEach(function (entry) {
        var spec = verifyCollection.byCell[entry.cell];
        if (!spec || agentCanonicalValue(spec) !== entry.before) badCells.push(entry.cell);
      });
      if (badCells.length) {
        agentRollbackApplied(applied);
        return agentFail("撤销后校验失败，已回滚：" + badCells.join("、"));
      }

      var capability = agentCapabilities();
      var finished = agentFinishTableWrite(table, pos.index, entries, capability);
      return {
        ok: true,
        changed: entries.length,
        saved: finished.saved,
        storage: finished.storage,
        linkageSynced: finished.linkageSynced,
        pageHash: agentPageHash(table, pos.index, verifyCollection)
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentAppendTablePage(table) {
    try {
      var capability = agentCapabilities();
      if (!capability.ok || !capability.writable) {
        return agentFail(capability.reason || capability.error || "项目库不可写");
      }
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var pages = state.pages[table];
      if (pages.length >= MAX_PAGES) {
        return agentFail("本表最多 " + MAX_PAGES + " 页");
      }
      // 不复用 addPage()：它会切页并重绘。这里只在表尾追加。
      var index = pages.length;
      var last = index > 0 ? pages[index - 1] : null;
      var newPage = blankPage(table, index);
      newPage.meta = last && last.meta ? clone(last.meta) : {};
      if (table === "leveling") {
        newPage.remark = "";
        if (levelingOwnerModeActive()) {
          newPage.owner = SC.normalizeOwner(last && last.owner);
        }
      }
      pages.push(newPage);
      saveNow(false);
      if (activeModule === table) {
        updateTabs();
        updatePager();
      }
      var collection = agentSpecCollection(table, index);
      return {
        ok: true,
        table: table,
        tableLabel: TABLES[table].short,
        page: index + 1,
        pageCount: pages.length,
        pageHash: agentPageHash(table, index, collection),
        baseline: clone(newPage)
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentUndoAppendTablePage(table, pageIndex, baseline) {
    try {
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var n = Number(pageIndex);
      if (!Number.isFinite(n) || Math.floor(n) !== n || n < 1 || n > MAX_PAGES) {
        return agentFail("页码必须是 1 到 " + MAX_PAGES + " 的整数");
      }
      if (!baseline || typeof baseline !== "object") {
        return agentFail("缺少整页 baseline，无法撤销新增");
      }
      var pages = state.pages[table];
      var index = n - 1;
      var target = pages[index];
      if (!target) return agentFail("第 " + n + " 页不存在");
      if (!agentDeepEqual(target, baseline)) {
        return { ok: false, error: "该页内容已变化，无法撤销新增", conflict: true };
      }
      if (pages.length <= 1) {
        return agentFail("本表至少保留一页，无法撤销新增");
      }
      var oldCurrent = state.ui.pageIndex[table];
      pages.splice(index, 1);
      var needsRender = oldCurrent === index || oldCurrent > index;
      if (oldCurrent === index) {
        state.ui.pageIndex[table] = Math.max(0, Math.min(index, pages.length - 1));
      } else if (oldCurrent > index) {
        state.ui.pageIndex[table] = oldCurrent - 1;
      }
      saveNow(false);
      if (activeModule === table) {
        if (needsRender) renderStage();
        updateTabs();
        updatePager();
      }
      return {
        ok: true,
        removed: true,
        table: table,
        tableLabel: TABLES[table].short,
        pageCount: pages.length
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentRevealTable(table, page) {
    try {
      if (!agentTableInfo(table)) return agentFail("只支持表一（traverse）与表二（leveling）");
      if (!state) return agentFail("项目尚未载入");
      var pos = agentPagePosition(table, page);
      if (!pos.ok) return pos;
      // 先切表（会按当前页重建 stage），再翻到目标页。
      if (!setActiveTable(table)) return agentFail("无法切换到" + TABLES[table].short);
      if (state.ui.pageIndex[table] !== pos.index) gotoPage(pos.index);
      return {
        ok: true,
        table: table,
        tableLabel: TABLES[table].short,
        page: pos.page,
        pageCount: state.pages[table].length
      };
    } catch (err) {
      return agentUnexpected(err);
    }
  }

  function agentWorkspaceDigest() {
    try {
      if (!state) return "";
      function stationCount(key) {
        var count = 0;
        state.pages[key].forEach(function (page) {
          (page.stations || []).forEach(function (station) {
            if (stationHasData(key, station)) count += 1;
          });
        });
        return count;
      }
      var parts = [
        "表一 " + state.pages.traverse.length + " 页",
        "表二 " + state.pages.leveling.length + " 页",
        "共 " + (stationCount("traverse") + stationCount("leveling")) + " 个有数据的测站"
      ];
      if (activeModule === "assistant") {
        parts.push("当前 对话页");
      } else if (activeModule === "linkage") {
        parts.push("当前 联立页");
      } else if (TABLES[state.ui.active]) {
        parts.push("当前 " + TABLES[state.ui.active].short + " 第 " +
          (state.ui.pageIndex[state.ui.active] + 1) + " 页");
      }
      return parts.join("；");
    } catch (err) {
      return "";
    }
  }

  function installAgentBridge() {
    window.JujinSheetAgent = {
      version: 1,
      agentCapabilities: agentCapabilities,
      agentReadTable: agentReadTable,
      agentPreviewTableEdits: agentPreviewTableEdits,
      agentApplyTableEdits: agentApplyTableEdits,
      agentAppendTablePage: agentAppendTablePage,
      agentUndoTableEdits: agentUndoTableEdits,
      agentUndoAppendTablePage: agentUndoAppendTablePage,
      agentRevealTable: agentRevealTable,
      agentWorkspaceDigest: agentWorkspaceDigest
    };
  }
  /* lite:drop:end agent-bridge */

  function installDebugApi() {
    window.__sheetApp = {
      version: 1,
      getState: function () { return clone(state); },
      getModule: function () { return activeModule; },
      getSummary: function () {
        return {
          active: state.ui.active,
          pageIndex: state.ui.pageIndex[state.ui.active],
          pages: {
            traverse: state.pages.traverse.length,
            leveling: state.pages.leveling.length,
            angle: state.pages.angle.length,
            traverseSummary: state.pages.traverseSummary.length,
            levelingSummary: state.pages.levelingSummary.length,
            trigSummary: state.pages.trigSummary.length,
            traverseCalc: state.pages.traverseCalc.length
          },
          counts: clone(analysis ? analysis.counts : {}),
          hasMeasurements: analysis ? analysis.hasMeasurements : false,
          startedAny: analysis ? analysis.startedAny : false,
          legPages: state.settings.levelingSummary.legPages,
          ownerMode: levelingOwnerModeActive()
        };
      },
      getSummaryResult: function (key, pageIndex) {
        key = key || state.ui.active;
        if (key === "traverseSummary") {
          return clone(SC.traverseRows(state.pages.traverse, state.settings.traverse));
        }
        if (key === "trigSummary") {
          var trigPage = state.pages.trigSummary[0];
          return clone(SC.trigRows(state.pages.traverse, state.settings.traverse, {
            sideFormula: state.settings.trigSummary.sideFormula,
            sideLimit: state.settings.trigSummary.sideLimit,
            sideLinear: state.settings.trigSummary.sideLinear,
            closureLimit: state.settings.trigSummary.closureLimit,
            closed: state.settings.trigSummary.closed !== false,
            pageCount: state.pages.trigSummary.length,
            startElev: trigPage && trigPage.meta ? trigPage.meta["start-elev"] : ""
          }));
        }
        if (key === "levelingSummary") {
          var pages = state.pages.levelingSummary;
          var index = pageIndex == null
            ? (state.ui.active === "levelingSummary" ? state.ui.pageIndex.levelingSummary : 0)
            : Math.floor(Number(pageIndex));
          if (!Number.isFinite(index)) index = 0;
          index = clamp(index, 0, pages.length - 1);
          return clone(SC.levelingRows(state.pages.leveling, state.settings.leveling, {
            mode: levelingOwnerModeActive() ? "owners" : "blocks",
            legPages: state.settings.levelingSummary.legPages,
            names: pages[index].names,
            pageIndex: index,
            pageCount: pages.length
          }));
        }
        return null;
      },
      setSummaryLegPages: function (value) {
        state.settings.levelingSummary.legPages = SC.normalizeLegPages(value);
        saveNow(false);
        renderStage();
        updatePager();
        if (drawerOpen) renderDrawer(true);
        return state.settings.levelingSummary.legPages;
      },
      getPageOwner: function (index) {
        var pages = state.pages.leveling;
        var i = index == null ? state.ui.pageIndex.leveling : Math.floor(Number(index));
        if (!Number.isFinite(i)) i = 0;
        i = clamp(i, 0, pages.length - 1);
        return clone(SC.normalizeOwner(pages[i] && pages[i].owner));
      },
      setPageOwner: function (owner, index) {
        var pages = state.pages.leveling;
        var i = index == null ? state.ui.pageIndex.leveling : Math.floor(Number(index));
        if (!Number.isFinite(i)) i = 0;
        i = clamp(i, 0, pages.length - 1);
        materializeLevelingOwners();
        pages[i].owner = SC.normalizeOwner(owner);
        saveNow(false);
        recompute();
        updatePager();
        if (drawerOpen) renderDrawer(true);
        return clone(pages[i].owner);
      },
      setLevelingOwnerMode: function (value) {
        // "blocks" 强制页块；true 强制逐页归属；false 交给自动判断（有标签就用标签）。
        state.settings.levelingSummary.ownerMode = value === "blocks" ? "blocks" : value === true;
        saveNow(false);
        recompute();
        updatePager();
        if (drawerOpen) renderDrawer(true);
        return state.settings.levelingSummary.ownerMode;
      },
      materializeLevelingOwners: function () {
        var before = state.settings.levelingSummary.ownerMode;
        materializeLevelingOwners();
        saveNow(false);
        recompute();
        updatePager();
        if (drawerOpen) renderDrawer(true);
        return { before: before, ownerMode: state.settings.levelingSummary.ownerMode };
      },
      setActiveTable: setActiveTable,
      setActiveModule: setActiveModule,
      getModule: function () { return activeModule; },
      isLinkageEnabled: linkageEnabled,
      getLinkage: function () { return STORE.getLinkage(); },
      getLinkagePlan: function () {
        if (!LINKAGE) return null;
        return LINKAGE.plan(state.pages.traverse, STORE.getLinkage().mapping, {
          anglePageCount: state.pages.angle.length,
          maxPages: MAX_PAGES
        });
      },
      setLinkageEnabled: setLinkageEnabled,
      syncLinkage: function (options) {
        return runLinkageSync(options || { render: false });
      },
      setLinkageMapping: function (key, override) {
        setLinkageMapping(key, override, null);
        return STORE.getLinkage();
      },
      backupLinkage: backupLinkage,
      restoreLinkageBackup: restoreLinkageBackup,
      getProjects: projectList,
      listProjects: projectList,
      getActiveProjectId: STORE.getActiveProjectId,
      getActiveProjectName: activeProjectName,
      switchProject: switchProject,
      createProject: createProject,
      duplicateProject: duplicateProject,
      renameProject: renameProject,
      deleteProject: deleteProject,
      exportAllProjects: exportAllProjects,
      exportJson: exportJson,
      exportTableJson: exportTableJson,
      getProjectExportPayload: projectExportPayload,
      getTableExportPayload: function (table) {
        return tableExportPayload(table || state.ui.active);
      },
      importText: importText,
      requestImport: requestImport,
      preparePrint: preparePrint,
      cleanupPrint: cleanupPrint,
      openBackupDir: openBackupDirectory,
      getStorageInfo: function () {
        return {
          mode: saveInfo() ? saveInfo().mode : null,
          save: saveInfo(),
          paths: storagePaths ? clone(storagePaths) : null,
          load: nativeLoadMeta
        };
      },
      newBlankState: makeDefaultState,
      flush: flushSave,
      toast: toast,
      confirm: confirmDialog,
      gotoPage: gotoPage,
      addPage: addPage,
      deletePage: deletePage,
      openChecks: openChecks,
      closeChecks: function () { setChecksOpen(false); },
      setChecksTab: function (tab) {
        checksTab = tab === "rules" ? "rules" : "issues";
        renderCheck(false);
      },
      getErrorBands: function () { return bandsOn; },
      setErrorBands: function (on) { return setErrorBands(on); },
      getTrigRoute: function () { return state.settings.trigSummary.closed !== false ? "closed" : "open"; },
      setTrigRoute: function (value) {
        setTrigRoute(value === "open" || value === false ? "open" : "closed");
        return state.settings.trigSummary.closed !== false ? "closed" : "open";
      },
      getCalcCoords: function () {
        return {
          coords: clone(state.settings.traverseCalc.coords),
          prompt: state.settings.traverseCalc.coordsPrompt,
          connDir: state.settings.traverseCalc.connDir,
          preview: coordsPreview()
        };
      },
      setCalcCoords: function (coords) {
        var target = state.settings.traverseCalc.coords;
        ["pn", "pe", "tn", "te"].forEach(function (key) {
          if (coords && coords[key] != null) target[key] = str(coords[key]);
        });
        if (coordsFilled()) {
          state.settings.traverseCalc.coordsPrompt = "filled";
        } else if (state.settings.traverseCalc.coordsPrompt === "filled") {
          state.settings.traverseCalc.coordsPrompt = "pending";
        }
        saveNow(false);
        recompute();
        renderQuickOptions();
        if (drawerOpen) renderDrawer(true);
        return { coords: clone(target), prompt: state.settings.traverseCalc.coordsPrompt, preview: coordsPreview() };
      },
      getCalcConnection: function () {
        return clone(calcConnectionPreview());
      },
      fillCalcStart: function () { return fillCalcStart(); },
      setCalcConnDir: function (value) {
        setCalcConnDir(value);
        return state.settings.traverseCalc.connDir;
      },
      getTraverseCalcResult: function (pageIndex) {
        var pages = state.pages.traverseCalc;
        var index = pageIndex == null
          ? (state.ui.active === "traverseCalc" ? state.ui.pageIndex.traverseCalc : 0)
          : Math.floor(Number(pageIndex));
        if (!Number.isFinite(index)) index = 0;
        index = clamp(index, 0, pages.length - 1);
        var group = calcConductorGroup(index);
        var computed = TCALC.computePages(group.pages, state.settings.traverseCalc);
        return {
          page: clone(pages[index]),
          role: pages[index].role === "cont" ? "cont" : "start",
          calc: clone(computed.pages[index - group.start].calc),
          conductor: {
            start: group.start,
            end: group.end,
            pageCount: group.pages.length,
            n: computed.n,
            used: computed.used,
            state: computed.state,
            source: clone(group.pages[0].source)
          }
        };
      },
      setCalcPageRole: function (pageIndex, role) {
        var pages = state.pages.traverseCalc;
        var index = Math.floor(Number(pageIndex));
        if (!Number.isFinite(index)) return null;
        index = clamp(index, 0, pages.length - 1);
        state.ui.pageIndex.traverseCalc = index;
        setCalcPageRole(role === "cont" ? "cont" : "start");
        return pages[index].role === "cont" ? "cont" : "start";
      },
      setTraverseCalcDir: function (value) {
        setCalcAngleDir(value === "ccw" ? "ccw" : "cw");
        return state.settings.traverseCalc.angleDir;
      },
      importTraverseCalc: function (withHeights) {
        return applyCalcMapping(!!withHeights);
      },
      preparePrint: preparePrint,
      cleanupPrint: cleanupPrint,
      fit: function () { fitSheet(); },
      setScale: function (value) {
        setScale(value);
        return state.ui.scale[state.ui.active];
      },
      focusCell: function (cellId) {
        if (!runtime || !runtime.focusMethods[cellId]) return false;
        var node = runtime.nodes[cellId];
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "center", inline: "nearest" });
        runtime.focusMethods[cellId]();
        return true;
      },
      openDrawer: openDrawer,
      closeDrawer: closeDrawer,
      replaceState: function (raw) {
        var next = normalizeState(raw, { strict: true });
        state = next;
        activeModule = next.ui.active;
        STORE.setActiveModule(activeModule);
        closeDrawer();
        renderAll();
        saveNow(false);
        return true;
      }
    };
  }

  function startApp(storage) {
    nativeLoadMeta = storage && storage.meta ? storage.meta : null;
    var loaded = loadInitialState(storage && storage.options ? storage.options : { mode: "local" });
    state = loaded.state;
    storageOk = loaded.storageOk;
    var savedModule = STORE.getActiveModule();
    if (savedModule === "assistant" && !LITE) {
      activeModule = "assistant";
    } else if (savedModule === "linkage" && linkageEnabled()) {
      activeModule = "linkage";
    } else {
      activeModule = state.ui.active;
    }
    if (activeModule !== "assistant" && activeModule !== "linkage" && !TABLES[activeModule]) {
      activeModule = state.ui.active;
    }
    if (activeModule !== "assistant" && activeModule !== "linkage" && !TABLES[activeModule]) {
      activeModule = "traverse";
    }
    STORE.setActiveModule(activeModule);
    bindShell();
    bindSaveStatus();
    var platform = window.JujinPlatform;
    if (platform && typeof platform.onFlushRequested === "function") {
      platform.onFlushRequested(handleCloseRequest).catch(function (err) {
        if (window.console && console.error) console.error("[app] close flush listener", err);
      });
    }
    if (window.location.search) {
      var params = new URLSearchParams(window.location.search);
      if (params.has("debug")) document.body.classList.add("debug");
    }
    if (linkageEnabled()) runLinkageSync({ render: false });
    dom.settingsBtn.setAttribute("aria-expanded", "false");
    dom.statusChip.setAttribute("aria-expanded", "false");
    dom.checkBtn.setAttribute("aria-expanded", "false");
    renderAll();

    var meta = nativeLoadMeta || {};
    var desktop = !!meta.desktop;
    var startupNotice = false;
    if (meta.futureVersion) {
      setSaveStatus("项目库版本过新（未写入本机）", true);
      startupNotice = true;
      toast(
        "项目库由更新版本创建（v" + meta.futureVersion + "），本版本不会覆盖它；" +
        "当前为只读内存模式，请升级软件后再使用。",
        "error"
      );
    } else if (!storageOk) {
      setSaveStatus(
        desktop ? "本机存储不可用（请导出 JSON 备份）" : "本地保存不可用（请导出 JSON 备份）",
        true
      );
      if (desktop) {
        startupNotice = true;
        toast(
          "无法使用本机存储：" + (meta.error || "原因未知") +
          "。本次改动只在内存中，请及时「导出 JSON」备份。",
          "error"
        );
      }
    } else if (loaded.corrupt) {
      setSaveStatus(desktop ? "项目库已重建（损坏文件已另存）" : "项目库已重建（损坏数据已备份）", false);
    } else if (meta.migratedLocal) {
      setSaveStatus("已迁移浏览器旧数据至本机文件", false);
    } else if (loaded.migrated) {
      setSaveStatus("已迁移为项目「" + loaded.projectName + "」", false);
    } else if (loaded.scaleRevisionMissing) {
      saveNow(true);
      setSaveStatus("各表大小已设为新的 100% 基准", false);
    } else if (loaded.loaded) {
      setSaveStatus("已载入「" + loaded.projectName + "」", false);
    } else {
      setSaveStatus("新空白记录", false);
      saveNow(true);
    }

    if (loaded.corrupt) {
      startupNotice = true;
      toast(
        desktop
          ? "本机项目库无法解析，已改名为 store.corrupt-*.json 并新建空白库。"
          : "本机项目库无法解析，已另存为备份键并新建空白库。",
        "error"
      );
    } else if (meta.migratedLocal) {
      startupNotice = true;
      toast("已将浏览器旧数据迁移到本机文件。", "ok");
    } else if (loaded.migrated) {
      startupNotice = true;
      saveNow(true);
      toast("已将旧版正式版记录迁移为项目「" + loaded.projectName + "」。", "ok");
    }
    startupReady = true;
    if (!startupNotice) maybeOfferCoordsHint();
    installDebugApi();
    installAgentBridge(); /* lite:drop-line */
    notifyProjectsChanged();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    cacheDom();
    setSaveStatus("正在载入项目库…", false);
    initStorage().then(startApp).catch(function (err) {
      var desktop = !!(window.JujinPlatform &&
        typeof window.JujinPlatform.isDesktop === "function" &&
        window.JujinPlatform.isDesktop());
      nativeLoadMeta = { desktop: desktop, error: errorText(err) };
      startApp({
        options: { mode: desktop ? "memory" : "local" },
        meta: nativeLoadMeta
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
