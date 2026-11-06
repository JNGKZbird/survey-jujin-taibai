/* ------------------------------------------------------------------ *
 * 单表信封：识别与构建
 *
 * 纯函数，不碰 DOM。桌面包与浏览器开发版共用。
 * 单表信封故意不带顶层 version / data / schemaVersion：
 * 旧「正式版」的 normalizeState 会因缺少 version:1 而拒绝，
 * 不会把单表文件当成项目数据导入、清空其余各表。
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var TABLE_KEYS = ["traverse", "leveling", "angle", "traverseSummary", "levelingSummary", "trigSummary", "traverseCalc"];
  var FORMAT_VERSION = 1;

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /*
   * 返回：
   *   {kind:"project"}                 旧 v1 信封或裸 state，走 importV1
   *   {kind:"all-projects"}            v2 全部项目，走 importV2
   *   {kind:"table", table}            单表信封，走 importTable
   *   {kind:"future", version}         schemaVersion > 2
   *   {kind:"future-table", version}   单表 formatVersion > 1
   *   {kind:"bad-table", reason}       单表信封结构不完整
   *   {kind:"unknown-kind", value}     kind 存在但不是 table
   *   {kind:"unknown"}                 不是对象
   *
   * 顺序固定：先看 schemaVersion，再看 kind，最后才当旧 v1。
   */
  function detect(parsed) {
    if (!isObject(parsed)) return { kind: "unknown" };

    var schemaVersion = Number(parsed.schemaVersion);
    if (Number.isFinite(schemaVersion) && schemaVersion > 2) {
      return { kind: "future", version: schemaVersion };
    }
    if (schemaVersion === 2) return { kind: "all-projects" };

    if (parsed.kind === "table") {
      var formatVersion = Number(parsed.formatVersion);
      if (Number.isFinite(formatVersion) && formatVersion > FORMAT_VERSION) {
        return { kind: "future-table", version: formatVersion };
      }
      if (formatVersion !== FORMAT_VERSION) {
        return { kind: "bad-table", reason: "单表文件缺少有效的 formatVersion（需要 1）。" };
      }
      if (TABLE_KEYS.indexOf(parsed.table) === -1) {
        return { kind: "bad-table", reason: "单表文件里的表名无法识别。" };
      }
      if (!isObject(parsed.state)) {
        return { kind: "bad-table", reason: "单表文件缺少有效的 state 数据。" };
      }
      return { kind: "table", table: parsed.table };
    }

    if (parsed.kind != null && parsed.kind !== "") {
      return { kind: "unknown-kind", value: parsed.kind };
    }

    return { kind: "project" };
  }

  /*
   * 生成单表信封。目标表放真实页与设置，其余各表用 makeDefaultState()
   * 的空白页与默认设置；不修改传入的 state。
   */
  function buildTablePayload(state, table, makeDefaultState, exportedAt) {
    if (TABLE_KEYS.indexOf(table) === -1) {
      throw new Error("未知的表：" + table);
    }
    if (!isObject(state) || !isObject(state.pages) ||
        !Array.isArray(state.pages[table]) || state.pages[table].length === 0) {
      throw new Error("当前表没有可导出的页面数据。");
    }
    if (typeof makeDefaultState !== "function") {
      throw new Error("缺少默认状态构造函数。");
    }

    var out = makeDefaultState();
    if (!isObject(out) || !isObject(out.pages) || !isObject(out.settings) || !isObject(out.ui)) {
      throw new Error("默认状态结构不可用。");
    }

    out.pages[table] = clone(state.pages[table]);
    out.settings[table] = clone(
      isObject(state.settings) && isObject(state.settings[table])
        ? state.settings[table]
        : out.settings[table]
    );
    out.ui.active = table;
    if (isObject(out.ui.pageIndex)) out.ui.pageIndex[table] = 0;

    return {
      app: "survey-jujin",
      kind: "table",
      formatVersion: FORMAT_VERSION,
      table: table,
      exportedAt: exportedAt || new Date().toISOString(),
      state: out
    };
  }

  var api = {
    TABLE_KEYS: TABLE_KEYS.slice(),
    FORMAT_VERSION: FORMAT_VERSION,
    detect: detect,
    buildTablePayload: buildTablePayload
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JujinTransfer = api;
})(typeof window !== "undefined" ? window : globalThis);
