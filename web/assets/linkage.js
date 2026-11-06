/* 表一 → 表三 联立引擎（纯函数，不碰 DOM、不读写 localStorage）
   全局站号 g = 4 * 表一页 + 站内序号；表三页 = floor(g / 6)，站 = g % 6 + 1。
   表一行序 ①L、①R、②L、②R → 表三行序 L①、L②、R①、R②。
   只抄水平度盘读数与斜距；竖盘读数（含负值）从不进入表三。 */
(function (root) {
  "use strict";

  var VERSION = 1;
  var MAX_PAGES = 100;
  var TRAVERSE_CAPACITY = 4;
  var ANGLE_CAPACITY = 6;
  var STATION_MAX = 8;
  var TARGET_MAX = 20;
  var DIST_REL_LIMIT = 1 / 10000;

  function str(value) { return value == null ? "" : String(value); }
  function trim(value) { return str(value).trim(); }
  function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function pad2(n) { return String(n).padStart(2, "0"); }

  function normalizeParts(raw) {
    raw = isObject(raw) ? raw : {};
    return { d: str(raw.d), m: str(raw.m), s: str(raw.s) };
  }

  function partsAny(parts) {
    return !!(trim(parts.d) || trim(parts.m) || trim(parts.s));
  }

  function partsFull(parts) {
    parts = normalizeParts(parts);
    return !!(trim(parts.d) && trim(parts.m) && trim(parts.s));
  }

  function sameParts(a, b) {
    a = normalizeParts(a);
    b = normalizeParts(b);
    return a.d === b.d && a.m === b.m && a.s === b.s;
  }

  function charCount(value) { return Array.from(str(value)).length; }

  function truncate(value, max) {
    var chars = Array.from(str(value));
    return chars.length > max ? chars.slice(0, max).join("") : str(value);
  }

  function sourceKey(pageIndex, stationIndex) {
    return pageIndex + ":" + stationIndex;
  }

  function parseSourceKey(key) {
    var match = /^(\d+):(\d+)$/.exec(str(key));
    if (!match) return null;
    var page = parseInt(match[1], 10);
    var station = parseInt(match[2], 10);
    if (!Number.isFinite(page) || !Number.isFinite(station)) return null;
    if (page < 0 || page >= MAX_PAGES) return null;
    if (station < 0 || station >= TRAVERSE_CAPACITY) return null;
    return { page: page, station: station };
  }

  function destKey(dest) {
    return dest.page + ":" + dest.station;
  }

  function autoDest(globalIndex) {
    return {
      page: Math.floor(globalIndex / ANGLE_CAPACITY),
      station: globalIndex % ANGLE_CAPACITY
    };
  }

  function autoPageCount(traversePageCount) {
    var count = Number(traversePageCount) || 0;
    return Math.max(1, Math.ceil(count * TRAVERSE_CAPACITY / ANGLE_CAPACITY));
  }

  function normalizeDest(raw) {
    if (!isObject(raw)) return null;
    var page = Number(raw.page);
    var station = Number(raw.station);
    if (!Number.isInteger(page) || page < 0 || page >= MAX_PAGES) return null;
    if (!Number.isInteger(station) || station < 0 || station >= ANGLE_CAPACITY) return null;
    return { page: page, station: station };
  }

  function normalizeOverride(raw) {
    if (!isObject(raw)) return null;
    var out = {};
    var dest = normalizeDest(raw);
    if (dest) {
      out.page = dest.page;
      out.station = dest.station;
    }
    if (raw.swap === true) out.swap = true;
    return (out.page != null || out.swap) ? out : null;
  }

  function normalizeMeta(raw) {
    var meta = { version: VERSION, stations: {}, last: {} };
    if (!isObject(raw)) return meta;
    var stations = isObject(raw.stations) ? raw.stations : {};
    Object.keys(stations).forEach(function (key) {
      if (!parseSourceKey(key)) return;
      var one = normalizeOverride(stations[key]);
      if (one) meta.stations[key] = one;
    });
    var last = isObject(raw.last) ? raw.last : {};
    Object.keys(last).forEach(function (key) {
      if (!parseSourceKey(key)) return;
      var dest = normalizeDest(last[key]);
      if (dest) meta.last[key] = dest;
    });
    return meta;
  }

  function mappingHasContent(meta) {
    meta = normalizeMeta(meta);
    return Object.keys(meta.stations).length > 0 || Object.keys(meta.last).length > 0;
  }

  /* ------------------------------------------------------------------ *
   * 读表一
   * ------------------------------------------------------------------ */

  function readTarget(raw) {
    raw = isObject(raw) ? raw : {};
    var readings = isObject(raw.readings) ? raw.readings : {};
    function face(name) {
      var reading = isObject(readings[name]) ? readings[name] : {};
      return {
        h: normalizeParts(reading.h),
        v: normalizeParts(reading.v),
        s: str(reading.s)
      };
    }
    return {
      name: str(raw.name),
      prismHeight: str(raw.prismHeight),
      readings: { L: face("L"), R: face("R") }
    };
  }

  function readStation(raw) {
    raw = isObject(raw) ? raw : {};
    var targets = Array.isArray(raw.targets) ? raw.targets : [];
    return {
      name: str(raw.name),
      instrumentHeight: str(raw.instrumentHeight),
      targets: [readTarget(targets[0]), readTarget(targets[1])]
    };
  }

  function stationHasLinkableData(raw) {
    var station = readStation(raw);
    if (trim(station.name)) return true;
    return station.targets.some(function (target) {
      if (trim(target.name)) return true;
      return ["L", "R"].some(function (face) {
        var reading = target.readings[face];
        return partsAny(reading.h) || partsAny(reading.v) || !!trim(reading.s);
      });
    });
  }

  function angleStationHasData(raw) {
    if (!isObject(raw)) return false;
    if (trim(raw.station)) return true;
    var rows = Array.isArray(raw.rows) ? raw.rows : [];
    return rows.some(function (row) {
      if (!isObject(row)) return false;
      return !!trim(row.target) || !!trim(row.distance) || partsAny(normalizeParts(row.reading));
    });
  }

  function anglePageHasData(raw) {
    if (!isObject(raw)) return false;
    var meta = isObject(raw.meta) ? raw.meta : {};
    if (Object.keys(meta).some(function (key) { return !!trim(meta[key]); })) return true;
    var stations = Array.isArray(raw.stations) ? raw.stations : [];
    return stations.some(angleStationHasData);
  }

  /* ------------------------------------------------------------------ *
   * 映射计划
   * ------------------------------------------------------------------ */

  function sourceRowsFor(station, swap) {
    var pair = swap ? [1, 0] : [0, 1];
    var layout = [
      { rowIndex: 0, face: "L", targetIndex: pair[0] },
      { rowIndex: 1, face: "L", targetIndex: pair[1] },
      { rowIndex: 2, face: "R", targetIndex: pair[0] },
      { rowIndex: 3, face: "R", targetIndex: pair[1] }
    ];
    return layout.map(function (slot) {
      var target = station.targets[slot.targetIndex];
      var reading = target.readings[slot.face];
      return {
        rowIndex: slot.rowIndex,
        face: slot.face,
        targetIndex: slot.targetIndex,
        targetName: target.name,
        targetOut: truncate(target.name, TARGET_MAX),
        reading: { d: reading.h.d, m: reading.h.m, s: reading.h.s },
        distance: reading.s,
        vertical: { d: reading.v.d, m: reading.v.m, s: reading.v.s }
      };
    });
  }

  function numberOf(text) {
    var value = Number(trim(text));
    return Number.isFinite(value) ? value : null;
  }

  function buildWarnings(station, sourceRows, stationOut) {
    var warnings = [];
    if (charCount(station.name) > STATION_MAX) {
      warnings.push({ code: "station-truncated", text: "站名超过 " + STATION_MAX + " 字，表三只写前 " + STATION_MAX + " 字" });
    }
    var targetTruncated = 0;
    station.targets.forEach(function (target) {
      if (charCount(target.name) > TARGET_MAX) targetTruncated += 1;
    });
    if (targetTruncated) {
      warnings.push({ code: "target-truncated", text: "目标名超过 " + TARGET_MAX + " 字，表三只写前 " + TARGET_MAX + " 字" });
    }
    if (!trim(station.name)) {
      warnings.push({ code: "missing-station", text: "表一未填站名，表三站号留空" });
    }
    var partial = 0;
    var missingDistance = 0;
    sourceRows.forEach(function (row) {
      if (partsAny(row.reading) && !partsFull(row.reading)) partial += 1;
      if (partsAny(row.reading) && !trim(row.distance)) missingDistance += 1;
    });
    if (partial) {
      warnings.push({ code: "partial-reading", text: partial + " 行水平读数未填全，原样抄入" });
    }
    if (missingDistance) {
      warnings.push({ code: "missing-distance", text: missingDistance + " 行缺斜距" });
    }
    var mismatch = false;
    station.targets.forEach(function (target) {
      var left = trim(target.readings.L.s);
      var right = trim(target.readings.R.s);
      if (!left || !right) return;
      var a = numberOf(left);
      var b = numberOf(right);
      if (a == null || b == null || a < 0 || b < 0) return;
      var mean = (a + b) / 2;
      if (mean > 0 && Math.abs(a - b) / mean > DIST_REL_LIMIT) mismatch = true;
    });
    if (mismatch) {
      warnings.push({ code: "slant-mismatch", text: "两盘斜距相对较差超过 1/10000" });
    }
    return warnings;
  }

  function plan(traversePages, rawMeta, options) {
    options = options || {};
    var pages = Array.isArray(traversePages) ? traversePages : [];
    var meta = normalizeMeta(rawMeta);
    var maxPages = Math.max(1, Math.min(MAX_PAGES, Number(options.maxPages) || MAX_PAGES));
    var anglePageCount = Math.max(0, Number(options.anglePageCount) || 0);
    var rows = [];

    pages.forEach(function (page, pageIndex) {
      for (var stationIndex = 0; stationIndex < TRAVERSE_CAPACITY; stationIndex += 1) {
        var rawStation = isObject(page) && Array.isArray(page.stations) ? page.stations[stationIndex] : null;
        var station = readStation(rawStation);
        var key = sourceKey(pageIndex, stationIndex);
        var auto = autoDest(pageIndex * TRAVERSE_CAPACITY + stationIndex);
        var override = meta.stations[key] || {};
        var dest = override.page != null
          ? { page: override.page, station: override.station }
          : { page: auto.page, station: auto.station };
        if (dest.page >= maxPages) dest = { page: auto.page, station: auto.station };
        var swap = !!override.swap;
        var sourceRows = sourceRowsFor(station, swap);
        var hasData = stationHasLinkableData(rawStation);
        var last = meta.last[key] || null;
        var stationOut = truncate(station.name, STATION_MAX);
        rows.push({
          key: key,
          sourcePage: pageIndex,
          sourceStation: stationIndex,
          globalIndex: pageIndex * TRAVERSE_CAPACITY + stationIndex,
          stationName: station.name,
          stationOut: stationOut,
          targetNames: [station.targets[0].name, station.targets[1].name],
          sourceRows: sourceRows,
          autoDest: auto,
          dest: dest,
          destIsAuto: dest.page === auto.page && dest.station === auto.station,
          swap: swap,
          manual: !!(override.page != null || override.swap),
          hasData: hasData,
          wasLinked: !!last,
          conflict: false,
          conflictCount: 0,
          warnings: hasData ? buildWarnings(station, sourceRows, stationOut) : [],
          status: hasData ? "synced" : (last ? "cleared" : "blank")
        });
      }
    });

    var byDest = {};
    rows.forEach(function (row) {
      if (!row.hasData) return;
      var key = destKey(row.dest);
      if (!byDest[key]) byDest[key] = [];
      byDest[key].push(row);
    });
    Object.keys(byDest).forEach(function (key) {
      var list = byDest[key];
      if (list.length < 2) return;
      list.forEach(function (row) {
        row.conflict = true;
        row.conflictCount = list.length;
        row.warnings.push({
          code: "conflict",
          text: "表三同一格被 " + list.length + " 个表一站占用，已暂停写入"
        });
      });
    });

    rows.forEach(function (row) {
      if (row.conflict) row.status = "conflict";
      else if (!row.hasData) row.status = row.wasLinked ? "cleared" : "blank";
      else if (row.warnings.some(function (warning) {
        return warning.code === "partial-reading" || warning.code === "missing-distance";
      })) row.status = "partial";
      else row.status = "synced";
    });

    var anyData = rows.some(function (row) { return row.hasData; });
    var neededPages = 0;
    if (anyData) {
      neededPages = autoPageCount(pages.length);
      rows.forEach(function (row) {
        if (row.hasData) neededPages = Math.max(neededPages, row.dest.page + 1);
      });
      neededPages = Math.min(neededPages, maxPages);
    }

    var summary = {
      total: rows.length,
      data: 0,
      synced: 0,
      partial: 0,
      blank: 0,
      cleared: 0,
      conflicts: 0,
      manual: 0
    };
    rows.forEach(function (row) {
      if (row.hasData) summary.data += 1;
      if (row.conflict) summary.conflicts += 1;
      else if (row.status === "synced") summary.synced += 1;
      else if (row.status === "partial") summary.partial += 1;
      else if (row.status === "cleared") summary.cleared += 1;
      else summary.blank += 1;
      if (row.manual) summary.manual += 1;
    });

    return {
      rows: rows,
      meta: meta,
      anyData: anyData,
      anglePageCount: anglePageCount,
      neededPages: neededPages,
      willCreatePages: Math.max(0, neededPages - anglePageCount),
      maxPages: maxPages,
      summary: summary
    };
  }

  /* ------------------------------------------------------------------ *
   * 写入表三
   * ------------------------------------------------------------------ */

  function defaultAngleStation() {
    var rows = [];
    for (var i = 0; i < 4; i += 1) {
      rows.push({ target: "", reading: { d: "", m: "", s: "" }, distance: "" });
    }
    return { station: "", rows: rows };
  }

  function defaultAnglePage() {
    var stations = [];
    for (var i = 0; i < ANGLE_CAPACITY; i += 1) stations.push(defaultAngleStation());
    return {
      meta: { date: "", instrument: "", observer: "", weather: "", group: "", recorder: "" },
      stations: stations
    };
  }

  function ensureStation(page, stationIndex, makeStation) {
    if (!Array.isArray(page.stations)) page.stations = [];
    while (page.stations.length <= stationIndex) {
      page.stations.push(makeStation());
    }
    var station = page.stations[stationIndex];
    if (!isObject(station)) {
      station = makeStation();
      page.stations[stationIndex] = station;
    }
    if (!Array.isArray(station.rows)) station.rows = [];
    while (station.rows.length < 4) {
      station.rows.push({ target: "", reading: { d: "", m: "", s: "" }, distance: "" });
    }
    return station;
  }

  function writeStation(station, row) {
    var changed = false;
    if (station.station !== row.stationOut) {
      station.station = row.stationOut;
      changed = true;
    }
    row.sourceRows.forEach(function (source) {
      var targetRow = station.rows[source.rowIndex];
      if (targetRow.target !== source.targetOut) {
        targetRow.target = source.targetOut;
        changed = true;
      }
      if (!sameParts(targetRow.reading, source.reading)) {
        targetRow.reading = { d: source.reading.d, m: source.reading.m, s: source.reading.s };
        changed = true;
      }
      if (targetRow.distance !== source.distance) {
        targetRow.distance = source.distance;
        changed = true;
      }
    });
    return changed;
  }

  function clearStation(station) {
    var changed = false;
    if (station.station !== "") {
      station.station = "";
      changed = true;
    }
    if (!Array.isArray(station.rows)) station.rows = [];
    for (var i = 0; i < 4; i += 1) {
      if (!isObject(station.rows[i])) {
        station.rows[i] = { target: "", reading: { d: "", m: "", s: "" }, distance: "" };
        changed = true;
        continue;
      }
      var row = station.rows[i];
      if (row.target !== "") { row.target = ""; changed = true; }
      if (!sameParts(row.reading, { d: "", m: "", s: "" })) {
        row.reading = { d: "", m: "", s: "" };
        changed = true;
      }
      if (row.distance !== "") { row.distance = ""; changed = true; }
    }
    return changed;
  }

  function clearAt(anglePages, dest) {
    if (!Array.isArray(anglePages)) return false;
    var page = anglePages[dest.page];
    if (!isObject(page) || !Array.isArray(page.stations)) return false;
    var station = page.stations[dest.station];
    if (!isObject(station)) return false;
    return clearStation(station);
  }

  function clearDestinations(state, dests) {
    if (!state || !isObject(state.pages) || !Array.isArray(dests)) return 0;
    if (!Array.isArray(state.pages.angle)) return 0;
    var changed = 0;
    dests.forEach(function (dest) {
      if (!isObject(dest)) return;
      if (clearAt(state.pages.angle, dest)) changed += 1;
    });
    return changed;
  }

  function dateText(meta) {
    var year = trim(meta.year);
    var month = trim(meta.month);
    var day = trim(meta.day);
    if (!year || !month || !day) return "";
    if (/^\d+$/.test(year)) year = year.length <= 2 ? "20" + pad2(parseInt(year, 10)) : year;
    if (/^\d+$/.test(month)) month = pad2(parseInt(month, 10));
    if (/^\d+$/.test(day)) day = pad2(parseInt(day, 10));
    return year + "-" + month + "-" + day;
  }

  function metaFromTraverse(meta) {
    meta = isObject(meta) ? meta : {};
    return {
      date: dateText(meta),
      observer: trim(meta.observer),
      recorder: trim(meta.recorder),
      group: trim(meta.group)
    };
  }

  function fillMeta(page, sourceMeta) {
    var changed = 0;
    if (!isObject(page.meta)) page.meta = {};
    var source = metaFromTraverse(sourceMeta);
    Object.keys(source).forEach(function (key) {
      if (!trim(source[key])) return;
      if (trim(page.meta[key])) return;
      page.meta[key] = source[key];
      changed += 1;
    });
    return changed;
  }

  function sync(state, rawMeta, options) {
    options = options || {};
    var meta = normalizeMeta(rawMeta);
    if (!state || !isObject(state.pages)) {
      return {
        meta: meta, rows: [], changed: false, dataChanged: false,
        created: 0, wrote: 0, cleared: 0, metaFilled: 0, summary: null
      };
    }
    var traversePages = Array.isArray(state.pages.traverse) ? state.pages.traverse : [];
    if (!Array.isArray(state.pages.angle)) state.pages.angle = [];
    var anglePages = state.pages.angle;
    var maxPages = Math.max(1, Math.min(MAX_PAGES, Number(options.maxPages) || MAX_PAGES));
    var info = plan(traversePages, meta, { anglePageCount: anglePages.length, maxPages: maxPages });
    var makePage = typeof options.makeAnglePage === "function" ? options.makeAnglePage : defaultAnglePage;
    var makeStation = typeof options.makeAngleStation === "function" ? options.makeAngleStation : defaultAngleStation;
    var changed = false;
    var dataChanged = false;
    var created = 0;
    var wrote = 0;
    var cleared = 0;
    var metaFilled = 0;

    while (anglePages.length < info.neededPages && anglePages.length < maxPages) {
      anglePages.push(makePage(anglePages.length));
      created += 1;
      changed = true;
      dataChanged = true;
    }

    // 只有这次真的会写数据的行才“占用”目标格；空行不能挡住旧目标的清理。
    var claimed = {};
    info.rows.forEach(function (row) {
      if (row.hasData && !row.conflict) claimed[destKey(row.dest)] = true;
    });

    // 上一次写过、但这次已不在同一格的数据：若没有别的表一站占用，清掉。
    Object.keys(meta.last).forEach(function (key) {
      var lastDest = meta.last[key];
      var row = null;
      for (var i = 0; i < info.rows.length; i += 1) {
        if (info.rows[i].key === key) { row = info.rows[i]; break; }
      }
      var keep = row && row.dest.page === lastDest.page && row.dest.station === lastDest.station;
      if (keep) return;
      if (!claimed[destKey(lastDest)] && clearAt(anglePages, lastDest)) {
        cleared += 1;
        changed = true;
        dataChanged = true;
      }
      delete meta.last[key];
      changed = true;
    });

    info.rows.forEach(function (row) {
      if (row.conflict) return;
      if (!row.hasData) {
        if (meta.last[row.key]) {
          if (clearAt(anglePages, row.dest)) {
            cleared += 1;
            changed = true;
            dataChanged = true;
          }
          delete meta.last[row.key];
          changed = true;
        }
        return;
      }
      var page = anglePages[row.dest.page];
      if (!isObject(page)) return;
      var station = ensureStation(page, row.dest.station, makeStation);
      if (writeStation(station, row)) {
        changed = true;
        dataChanged = true;
      }
      wrote += 1;
      var previous = meta.last[row.key];
      if (!previous || previous.page !== row.dest.page || previous.station !== row.dest.station) {
        meta.last[row.key] = { page: row.dest.page, station: row.dest.station };
        changed = true;
      }
    });

    // 表三每页的表头：只填空值，取第一个向该页供数的表一页。
    var firstSource = {};
    info.rows.forEach(function (row) {
      if (!row.hasData || row.conflict) return;
      var pageIndex = row.dest.page;
      if (firstSource[pageIndex] == null || row.sourcePage < firstSource[pageIndex]) {
        firstSource[pageIndex] = row.sourcePage;
      }
    });
    Object.keys(firstSource).forEach(function (pageIndex) {
      var page = anglePages[Number(pageIndex)];
      if (!isObject(page)) return;
      var source = traversePages[firstSource[pageIndex]];
      if (!isObject(source)) return;
      var filled = fillMeta(page, source.meta);
      if (filled) {
        metaFilled += filled;
        changed = true;
        dataChanged = true;
      }
    });

    return {
      meta: meta,
      rows: info.rows,
      changed: changed,
      dataChanged: dataChanged,
      created: created,
      wrote: wrote,
      cleared: cleared,
      metaFilled: metaFilled,
      summary: info.summary
    };
  }

  /* ------------------------------------------------------------------ *
   * 页删除后的键位移
   * ------------------------------------------------------------------ */

  function shiftSourcePagesAfterDelete(rawMeta, pageIndex) {
    var meta = normalizeMeta(rawMeta);
    var next = { version: VERSION, stations: {}, last: {} };
    ["stations", "last"].forEach(function (bucket) {
      Object.keys(meta[bucket]).forEach(function (key) {
        var parsed = parseSourceKey(key);
        if (!parsed || parsed.page === pageIndex) return;
        var page = parsed.page > pageIndex ? parsed.page - 1 : parsed.page;
        next[bucket][sourceKey(page, parsed.station)] = meta[bucket][key];
      });
    });
    return next;
  }

  function shiftDestinationPagesAfterDelete(rawMeta, pageIndex) {
    var meta = normalizeMeta(rawMeta);
    var next = { version: VERSION, stations: {}, last: {} };
    Object.keys(meta.stations).forEach(function (key) {
      var override = meta.stations[key];
      var copy = {};
      if (override.swap) copy.swap = true;
      if (override.page != null) {
        if (override.page > pageIndex) {
          copy.page = override.page - 1;
          copy.station = override.station;
        } else if (override.page < pageIndex) {
          copy.page = override.page;
          copy.station = override.station;
        }
        // 目标页本身被删：退回自动排布，只保留目标交换。
      }
      if (copy.page != null || copy.swap) next.stations[key] = copy;
    });
    Object.keys(meta.last).forEach(function (key) {
      var dest = meta.last[key];
      if (dest.page === pageIndex) return;
      next.last[key] = {
        page: dest.page > pageIndex ? dest.page - 1 : dest.page,
        station: dest.station
      };
    });
    return next;
  }

  root.JujinLinkage = {
    VERSION: VERSION,
    MAX_PAGES: MAX_PAGES,
    TRAVERSE_CAPACITY: TRAVERSE_CAPACITY,
    ANGLE_CAPACITY: ANGLE_CAPACITY,
    STATION_MAX: STATION_MAX,
    TARGET_MAX: TARGET_MAX,
    DIST_REL_LIMIT: DIST_REL_LIMIT,
    normalizeMeta: normalizeMeta,
    mappingHasContent: mappingHasContent,
    plan: plan,
    sync: sync,
    clearDestinations: clearDestinations,
    autoDest: autoDest,
    autoPageCount: autoPageCount,
    shiftSourcePagesAfterDelete: shiftSourcePagesAfterDelete,
    shiftDestinationPagesAfterDelete: shiftDestinationPagesAfterDelete,
    stationHasLinkableData: stationHasLinkableData,
    angleStationHasData: angleStationHasData,
    anglePageHasData: anglePageHasData,
    truncate: truncate,
    clone: clone
  };
})(typeof window !== "undefined" ? window : globalThis);
