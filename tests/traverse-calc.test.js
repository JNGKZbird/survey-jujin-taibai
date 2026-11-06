"use strict";

/*
 * 表G「导线计算表」的纯计算测试。
 *
 * 口径：首行是已知点（x / y / 方位角手填），每行是内角 + 到下一站的边长，
 * 最后一行回到首行；顺时针（内部值 ccw）α_next = α_prev + 180° − β，
 * 逆时针（内部值 cw）加 β。角度改正按原值等分（不取整），
 * 坐标改正按边长比例（余数给最长边）。
 */

const assert = require("assert");
require("../web/assets/calc-traverse.js");
require("../web/assets/calc-leveling.js");
require("../web/assets/calc-summary.js");
const TC = require("../web/assets/calc-traverse-calc.js");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log("ok " + passed + " - " + name);
}

const BLANK = { id: "", ang: "", len: "", h: "", x: "", y: "", az: "" };

function row(data) {
  return Object.assign({}, BLANK, data || {});
}

function page(list, source) {
  const rows = [];
  for (let i = 0; i < 11; i += 1) rows.push(row((list || [])[i]));
  return { meta: {}, source: source || {}, rows: rows };
}

const SETTINGS = { angleDir: "cw", fBetaCoef: 40, kDen: 4000 };

function square(over) {
  const base = [
    { id: "A", ang: "90.0000", len: "10.000", x: "0.000", y: "0.000", az: "90.0000" },
    { id: "B", ang: "90.0000", len: "10.000" },
    { id: "C", ang: "90.0000", len: "10.000" },
    { id: "D", ang: "90.0000", len: "10.000" }
  ];
  return page(base.map(function (item, index) {
    return Object.assign({}, item, over && over[index]);
  }));
}

function packed(list) {
  return list.map(function (item) { return item && item.packed; });
}

test("逆时针正方形闭合（cw：α = α前 + 180° + β）", function () {
  const out = TC.compute(square(), SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.n, 4);
  assert.strictEqual(out.used, 4);
  assert.strictEqual(out.fBetaSec, 0);
  assert.strictEqual(out.angleOk, true);
  assert.strictEqual(out.sumBetaPacked, "360.0000");
  assert.deepStrictEqual(packed(out.az.slice(0, 4)),
    ["90.0000", "0.0000", "270.0000", "180.0000"]);
  assert.deepStrictEqual(out.dxMm.slice(0, 4), [0, 10000, 0, -10000]);
  assert.deepStrictEqual(out.dyMm.slice(0, 4), [10000, 0, -10000, 0]);
  assert.deepStrictEqual(out.dxAdjMm.slice(0, 4), [0, 10000, 0, -10000]);
  assert.deepStrictEqual(out.dyAdjMm.slice(0, 4), [10000, 0, -10000, 0]);
  assert.deepStrictEqual(out.xMm.slice(0, 4), [0, 0, 10000, 10000]);
  assert.deepStrictEqual(out.yMm.slice(0, 4), [0, 10000, 10000, 0]);
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fyMm, 0);
  assert.strictEqual(out.fMm, 0);
  assert.strictEqual(out.kOk, true);
  assert.strictEqual(out.kDenActual, Infinity);
  assert.strictEqual(out.sumD, 40);
  assert.strictEqual(out.issues.length, 0);
  assert.deepStrictEqual(out.angles.slice(0, 4).map(function (item) {
    return item.adjPacked;
  }), ["90.0000", "90.0000", "90.0000", "90.0000"]);
});

test("顺时针正方形闭合（ccw：α = α前 + 180° − β）", function () {
  const out = TC.compute(square([{ az: "0.0000" }]), {
    angleDir: "ccw", fBetaCoef: 40, kDen: 4000
  });
  assert.strictEqual(out.state, "ok");
  assert.deepStrictEqual(packed(out.az.slice(0, 4)),
    ["0.0000", "90.0000", "180.0000", "270.0000"]);
  assert.deepStrictEqual(out.dxMm.slice(0, 4), [10000, 0, -10000, 0]);
  assert.deepStrictEqual(out.dyMm.slice(0, 4), [0, 10000, 0, -10000]);
  assert.deepStrictEqual(out.xMm.slice(0, 4), [0, 10000, 10000, 0]);
  assert.deepStrictEqual(out.yMm.slice(0, 4), [0, 0, 10000, 10000]);
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fyMm, 0);
  assert.strictEqual(out.kOk, true);
});

test("+20″ 角度闭合差按角数等分反号", function () {
  const out = TC.compute(square([{ ang: "90.0020" }]), SETTINGS);
  assert.strictEqual(out.fBetaSec, 20);
  assert.strictEqual(out.fBetaAllowSec, 80);
  assert.strictEqual(out.angleOk, true);
  assert.strictEqual(out.sumBetaPacked, "360.0020");
  assert.deepStrictEqual(out.angles.slice(0, 4).map(function (item) {
    return item.corrCs;
  }), [-500, -500, -500, -500]);
  assert.deepStrictEqual(out.angles.slice(0, 4).map(function (item) {
    return item.adjPacked;
  }), ["90.0015", "89.5955", "89.5955", "89.5955"]);
  assert.ok(!out.issues.some(function (item) { return item.code === "fbeta-over"; }));
});

test("角度改正按原值等分，不取整也不把余数给首行", function () {
  const out = TC.compute(square([{ ang: "90.0002" }]), SETTINGS);
  assert.strictEqual(out.fBetaSec, 2);
  assert.strictEqual(out.sumBetaPacked, "360.0002");
  assert.deepStrictEqual(out.angles.slice(0, 4).map(function (item) {
    return item.corrCs;
  }), [-50, -50, -50, -50]);
  assert.deepStrictEqual(out.angles.slice(0, 4).map(function (item) {
    return item.adjPacked;
  }), ["90.0002", "90.0000", "90.0000", "90.0000"]);
  assert.strictEqual(out.angles.slice(0, 4).reduce(function (sum, item) {
    return sum + item.corrCs;
  }, 0), -200);

  // 17 角、fβ = +96″：每个改正数都是 −96/17 ≈ −5.647″，首行不是 0。
  const list = [];
  for (let i = 0; i < 17; i += 1) {
    list.push({ id: "R" + (i + 1), ang: i === 16 ? "172.0136" : "158.0000", len: "10.000" });
  }
  list[0].x = "0.000";
  list[0].y = "0.000";
  list[0].az = "0.0000";
  const many = TC.computePages(pagesOf(list), SETTINGS);
  assert.strictEqual(many.fBetaSec, 96);
  const each = -9600 / 17;
  assert.ok(many.angles.slice(0, 16).every(function (item) {
    return Math.abs(item.corrCs - each) < 1e-9;
  }));
  assert.ok(Math.abs(many.angles.reduce(function (sum, item) {
    return sum + item.corrCs;
  }, 0) + 9600) < 1e-9);
});

test("坐标闭合差按边长比例分配，余数给最长边", function () {
  const rows = [
    { id: "A", ang: "90.0000", len: "10.000", x: "0.000", y: "0.000", az: "90.0000" },
    { id: "B", ang: "90.0000", len: "10.002" },
    { id: "C", ang: "90.0000", len: "10.000" },
    { id: "D", ang: "90.0000", len: "10.000" }
  ];
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.fxMm, 2);
  assert.strictEqual(out.fyMm, 0);
  assert.strictEqual(out.fMm, 2);
  assert.strictEqual(out.sumD, 40.002);
  assert.strictEqual(Math.round(out.kDenActual), 20001);
  assert.strictEqual(out.kOk, true);
  assert.deepStrictEqual(out.dxMm.slice(0, 4), [0, 10002, 0, -10000]);
  assert.deepStrictEqual(out.dxAdjMm.slice(0, 4), [0, 10000, 0, -10000]);
  assert.strictEqual(out.dxAdjMm.slice(0, 4).reduce(function (sum, value) {
    return sum + value;
  }, 0), 0);
  assert.deepStrictEqual(out.xMm.slice(0, 4), [0, 0, 10000, 10000]);
  assert.deepStrictEqual(out.yMm.slice(0, 4), [0, 10000, 10000, 0]);
});

test("K 恰好等于 1/3999 算合格，1/4000 才算超限", function () {
  const rows = [
    { id: "A", ang: "90.0000", len: "1.000", x: "0.000", y: "0.000", az: "0.0000" },
    { id: "B", ang: "90.0000", len: "1.000" },
    { id: "C", ang: "90.0000", len: "0.999" },
    { id: "D", ang: "90.0000", len: "1.000" }
  ];
  const at = TC.compute(page(rows), { angleDir: "cw", fBetaCoef: 40, kDen: 3999 });
  assert.strictEqual(at.fxMm, 1);
  assert.strictEqual(at.fyMm, 0);
  assert.strictEqual(Math.round(at.kDenActual), 3999);
  assert.strictEqual(at.kOk, true);
  assert.ok(!at.issues.some(function (item) { return item.code === "k-over"; }));
  assert.strictEqual(at.dxAdjMm[0], 999);

  const over = TC.compute(page(rows), { angleDir: "cw", fBetaCoef: 40, kDen: 4000 });
  assert.strictEqual(over.kOk, false);
  assert.ok(over.issues.some(function (item) { return item.code === "k-over"; }));
});

test("fβ 恰好等于允许值算合格，超一点才算超限", function () {
  const okRows = [
    { id: "A", ang: "90.0120", len: "10.000", x: "0.000", y: "0.000", az: "90.0000" },
    { id: "B", ang: "90.0000", len: "10.000" },
    { id: "C", ang: "90.0000", len: "10.000" },
    { id: "D", ang: "90.0000", len: "10.000" }
  ];
  const ok = TC.compute(page(okRows), SETTINGS);
  assert.strictEqual(ok.fBetaSec, 80);
  assert.strictEqual(ok.fBetaAllowSec, 80);
  assert.strictEqual(ok.angleOk, true);
  assert.ok(!ok.issues.some(function (item) { return item.code === "fbeta-over"; }));
  assert.strictEqual(ok.angles[0].adjPacked, "90.0100");

  const overRows = okRows.map(function (item, index) {
    return index === 0 ? Object.assign({}, item, { ang: "90.0121" }) : item;
  });
  const over = TC.compute(page(overRows), SETTINGS);
  assert.strictEqual(over.fBetaSec, 81);
  assert.strictEqual(over.angleOk, false);
  assert.ok(over.issues.some(function (item) { return item.code === "fbeta-over"; }));
});

test("缺首行方位角：角度仍改正，方位角与增量留空", function () {
  const out = TC.compute(square([{ az: "" }]), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.fBetaSec, 0);
  assert.ok(out.angles.slice(0, 4).every(function (item) {
    return item.adjPacked === "90.0000";
  }));
  assert.ok(out.az.every(function (item) { return item === null; }));
  assert.ok(out.dxMm.every(function (item) { return item === null; }));
  assert.ok(out.dxAdjMm.every(function (item) { return item === null; }));
  assert.strictEqual(out.xMm[0], 0);
  assert.strictEqual(out.xMm[1], null);
  assert.ok(out.issues.some(function (item) {
    return item.code === "az-missing" && item.focus === "s1-az";
  }));
});

test("缺首行坐标：增量与闭合差仍算，坐标留空", function () {
  const out = TC.compute(square([{ x: "", y: "" }]), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.az[0].packed, "90.0000");
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fMm, 0);
  assert.strictEqual(out.kOk, true);
  assert.ok(out.xMm.every(function (item) { return item === null; }));
  assert.ok(out.yMm.every(function (item) { return item === null; }));
  assert.ok(out.issues.some(function (item) {
    return item.code === "xy-missing" && item.focus === "s1-x";
  }));
});

test("行不完整时链停在该行", function () {
  const rows = [
    { id: "A", ang: "90.0000", len: "10.000", x: "0.000", y: "0.000", az: "90.0000" },
    { id: "B", ang: "90.0000", len: "10.000" },
    { id: "C", ang: "90.0000", len: "" }
  ];
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.used, 3);
  assert.strictEqual(out.n, 0);
  assert.ok(out.angles.every(function (item) { return item === null; }));
  assert.ok(out.issues.some(function (item) {
    return item.code === "len-missing-3" && item.focus === "s3-len";
  }));
});

test("非法度分秒让链停在该行", function () {
  const out = TC.compute(square([null, { ang: "90.6000" }]), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.used, 4);
  assert.ok(out.issues.some(function (item) {
    return item.code === "ang-invalid-2" && item.focus === "s2-ang";
  }));
  assert.ok(out.angles.every(function (item) { return item === null; }));
});

test("少于 3 行不做闭合", function () {
  const rows = [
    { id: "A", ang: "90.0000", len: "10.000", x: "0.000", y: "0.000", az: "90.0000" },
    { id: "B", ang: "90.0000", len: "10.000" }
  ];
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.n, 2);
  assert.strictEqual(out.fBetaSec, null);
  assert.ok(out.issues.some(function (item) { return item.code === "too-few-rows"; }));
});

test("空行夹数据：停在空行并警告，后面的数据不参与", function () {
  const rows = [
    { id: "A", ang: "60.0000", len: "1.000", x: "0.000", y: "0.000", az: "0.0000" },
    { id: "B", ang: "60.0000", len: "1.000" },
    { id: "C", ang: "60.0000", len: "1.000" },
    null,
    { id: "D", ang: "60.0000", len: "1.000" }
  ];
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.used, 3);
  assert.strictEqual(out.n, 3);
  assert.strictEqual(out.state, "ok");
  assert.ok(out.issues.some(function (item) {
    return item.code === "row-gap" && item.focus === "s4-id";
  }));
  assert.strictEqual(out.fBetaSec, 0);
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fyMm, 0);
  assert.strictEqual(out.xMm[2], 500);
  assert.strictEqual(out.yMm[2], -866);
});

test("首行空、后面有数据时只报断行", function () {
  const rows = [null, { id: "B", ang: "90.0000", len: "10.000" }];
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.used, 0);
  assert.ok(out.issues.some(function (item) {
    return item.code === "row-gap" && item.focus === "s1-id";
  }));
  assert.ok(!out.issues.some(function (item) { return item.code === "too-few-rows"; }));
});

test("源导线超过 11 站：只带入前 11 行并抑制闭合", function () {
  const rows = [];
  for (let i = 0; i < 11; i += 1) {
    rows.push({ id: "P" + (i + 1), ang: "90.0000", len: "10.000" });
  }
  rows[0].x = "0.000";
  rows[0].y = "0.000";
  rows[0].az = "90.0000";
  const out = TC.compute(page(rows, { sourceCount: 12, overflow: 1 }), SETTINGS);
  assert.strictEqual(out.state, "partial");
  assert.strictEqual(out.used, 11);
  assert.ok(out.angles.every(function (item) { return item === null; }));
  assert.strictEqual(out.fBetaSec, null);
  const issue = out.issues.find(function (item) { return item.code === "source-overflow"; });
  assert.ok(issue);
  assert.ok(issue.message.indexOf("12") >= 0);
});

test("11 行全部参与（不截断）", function () {
  const rows = [];
  for (let i = 0; i < 11; i += 1) {
    rows.push({ id: "P" + (i + 1), ang: "90.0000", len: "10.000" });
  }
  rows[0].x = "0.000";
  rows[0].y = "0.000";
  rows[0].az = "0.0000";
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.used, 11);
  assert.strictEqual(out.n, 11);
  assert.strictEqual(out.angles.length, 11);
  assert.strictEqual(out.az.length, 11);
  assert.strictEqual(out.dxMm.length, 11);
  assert.ok(out.angles[10] && out.angles[10].adjPacked !== "");
  assert.ok(out.issues.some(function (item) { return item.code === "fbeta-over"; }));
});

test("高程只记录，不影响闭合", function () {
  const out = TC.compute(square([
    { h: "12.345" }, { h: "" }, { h: "12.346" }, { h: "bad" }
  ]), SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.deepStrictEqual(out.heights.slice(0, 4), [12.345, null, 12.346, null]);
  assert.ok(out.issues.some(function (item) {
    return item.code === "h-invalid-4" && item.focus === "s4-h";
  }));
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fyMm, 0);
});

test("空页返回 empty", function () {
  const out = TC.compute(page([]), SETTINGS);
  assert.strictEqual(out.state, "empty");
  assert.strictEqual(out.used, 0);
  assert.strictEqual(out.n, 0);
  assert.deepStrictEqual(out.issues, []);
  assert.ok(out.angles.every(function (item) { return item === null; }));
  assert.strictEqual(TC.compute(null, SETTINGS).state, "empty");
});

test("首行方位角 360.0000 折叠成 0", function () {
  const out = TC.compute(square([{ az: "360.0000" }]), SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.az[0].packed, "0.0000");
  assert.strictEqual(out.az[1].packed, "270.0000");
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fyMm, 0);
});

test("度分秒解析与格式化", function () {
  const value = TC.parseDms("123.4536");
  assert.ok(value);
  assert.strictEqual(value.cs, 44553600);
  assert.strictEqual(value.packed, "123.4536");
  assert.strictEqual(TC.parseDms("123.45").packed, "123.4500");
  assert.strictEqual(TC.parseDms("90.6000"), null);
  assert.strictEqual(TC.parseDms("90.0060"), null);
  assert.strictEqual(TC.parseDms("360.0000"), null);
  assert.strictEqual(TC.parseDms("360.0000", { azimuth: true }).cs, 0);
  assert.strictEqual(TC.parseDms(""), null);
  assert.strictEqual(TC.parseDms("abc"), null);
  assert.strictEqual(TC.parseDms("-1.0000"), null);
  assert.strictEqual(TC.packedTextFromCs(44553600), "123.4536");
  assert.strictEqual(TC.packedTextFromCs(0), "0.0000");
  assert.strictEqual(TC.packedTextFromCs(129600000), "0.0000");
  assert.strictEqual(TC.packedTextFromCs(129600000, true), "360.0000");
  assert.strictEqual(TC.packedTextFromCs(1620 * 360000, true), "1620.0000");
  assert.strictEqual(TC.packedTextFromCs(32399900), "89.5959");
  assert.strictEqual(TC.packedTextFromCs(359 * 360000 + 59 * 6000 + 5950), "0.0000");
  // 亚秒进位：四位小数是整秒，1.50″ 应写 2″，不能因浮点写成 1″。
  assert.strictEqual(TC.packedTextFromCs(150), "0.0002");
  assert.strictEqual(TC.packedTextFromCs(149), "0.0001");
  assert.strictEqual(TC.packedTextFromCs(50), "0.0001");
  assert.strictEqual(TC.packedTextFromCs(49), "0.0000");
  assert.strictEqual(TC.packedTextFromCs(5949), "0.0059");
  assert.strictEqual(TC.packedTextFromCs(5950), "0.0100");
  assert.strictEqual(TC.parseDms("0.00015").cs, 150);
  assert.strictEqual(TC.parseDms("0.00015").packed, "0.0002");
});

test("计算口径的默认值与夹取", function () {
  const fallback = TC.compute(square(), { angleDir: "sideways", fBetaCoef: 0, kDen: -2 });
  assert.deepStrictEqual(fallback.settings, { angleDir: "ccw", fBetaCoef: 40, kDen: 4000 });
  const custom = TC.compute(square(), { angleDir: "ccw", fBetaCoef: 20, kDen: 5000 });
  assert.deepStrictEqual(custom.settings, { angleDir: "ccw", fBetaCoef: 20, kDen: 5000 });
});

test("毫米取整：0.5 mm 远离 0", function () {
  const posRows = [
    { id: "A", ang: "60.0000", len: "0.0005", x: "0.000", y: "0.000", az: "0.0000" },
    { id: "B", ang: "60.0000", len: "1.000" },
    { id: "C", ang: "60.0000", len: "1.000" }
  ];
  const pos = TC.compute(page(posRows), SETTINGS);
  assert.strictEqual(pos.dxMm[0], 1);

  const negRows = posRows.map(function (item, index) {
    return index === 0 ? Object.assign({}, item, { az: "180.0000" }) : item;
  });
  const neg = TC.compute(page(negRows), SETTINGS);
  assert.strictEqual(neg.dxMm[0], -1);
});

/* ---------------- 一条导线跨页 ---------------- */

function pagesOf(list) {
  const pages = [];
  for (let p = 0; p * 11 < list.length; p += 1) {
    pages.push(page(list.slice(p * 11, p * 11 + 11)));
  }
  if (!pages.length) pages.push(page([]));
  return pages;
}

function polygon12() {
  const list = [];
  for (let i = 0; i < 12; i += 1) {
    list.push({ id: "P" + (i + 1), ang: "150.0000", len: "10.000" });
  }
  list[0].x = "0.000";
  list[0].y = "0.000";
  list[0].az = "0.0000";
  return list;
}

test("跨页：12 站分两页，整条导线闭合", function () {
  const out = TC.computePages(pagesOf(polygon12()), SETTINGS);
  assert.strictEqual(out.pageCount, 2);
  assert.strictEqual(out.n, 12);
  assert.strictEqual(out.used, 12);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.fBetaSec, 0);
  assert.strictEqual(out.fMm, 0);
  assert.strictEqual(out.kDenActual, Infinity);
  assert.strictEqual(out.pages[0].calc.az.length, 11);
  assert.strictEqual(out.pages[1].calc.az.length, 11);
  // 第 2 页首行是导线第 12 行：方位角 = 0 + 11×(−30°) ≡ 30°。
  assert.strictEqual(out.pages[1].calc.az[0].packed, "30.0000");
  assert.strictEqual(out.pages[1].calc.xMm[0], out.xMm[11]);
  assert.strictEqual(out.pages[1].calc.yMm[0], out.yMm[11]);
  assert.strictEqual(out.pages[1].calc.pageUsed, 1);
});

test("续页首行不读本页的 x / y / 方位角", function () {
  const pages = pagesOf(polygon12());
  pages[1].rows[0].az = "123.0000";
  pages[1].rows[0].x = "999.000";
  pages[1].rows[0].y = "999.000";
  const out = TC.computePages(pages, SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.pages[1].calc.az[0].packed, "30.0000");
  assert.strictEqual(out.pages[1].calc.xMm[0], out.xMm[11]);
  assert.notStrictEqual(out.pages[1].calc.xMm[0], 999000);
});

test("续页首行只残留 X/Y/方位角不算行数据", function () {
  const pages = pagesOf(polygon12());
  pages[1].rows[0] = row({ x: "999.000", y: "999.000", az: "123.0000" });
  const out = TC.computePages(pages, SETTINGS);
  assert.strictEqual(out.used, 11);
  assert.strictEqual(out.n, 11);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.pages[1].calc.pageUsed, 0);
});

test("只填高程的空行不拉长导线", function () {
  const list = [
    { id: "A", ang: "90.0000", len: "10.000", x: "0.000", y: "0.000", az: "90.0000" },
    { id: "B", ang: "90.0000", len: "10.000" },
    { id: "C", ang: "90.0000", len: "10.000" },
    { id: "D", ang: "90.0000", len: "10.000" }
  ];
  list[4] = { h: "12.345" };
  const out = TC.compute(page(list), SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.used, 4);
  assert.strictEqual(out.n, 4);
});

test("开始页首行只有起算坐标也算已开始", function () {
  const out = TC.compute(page([{ x: "0.000", y: "0.000", az: "90.0000" }]), SETTINGS);
  assert.strictEqual(out.used, 1);
  assert.strictEqual(out.state, "partial");
});

test("22 行导线跨两页：两页各 11 行都参与", function () {
  const list = [];
  for (let i = 0; i < 22; i += 1) {
    list.push({ id: "Q" + (i + 1), ang: "90.0000", len: "10.000" });
  }
  list[0].x = "0.000";
  list[0].y = "0.000";
  list[0].az = "90.0000";
  const out = TC.computePages(pagesOf(list), SETTINGS);
  assert.strictEqual(out.pageCount, 2);
  assert.strictEqual(out.used, 22);
  assert.strictEqual(out.n, 22);
  assert.strictEqual(out.angles.length, 22);
  assert.strictEqual(out.pages[0].calc.angles.length, 11);
  assert.strictEqual(out.pages[1].calc.angles.length, 11);
  assert.strictEqual(out.pages[0].calc.pageUsed, 11);
  assert.strictEqual(out.pages[1].calc.pageUsed, 11);
  assert.strictEqual(out.pages[1].calc.az[10].packed, out.az[21].packed);
  assert.strictEqual(out.pages[1].calc.xMm[10], out.xMm[21]);
  assert.ok(out.issues.some(function (item) { return item.code === "fbeta-over"; }));
});

test("跨页断行：第 2 页第 1 行空，后面的数据不参与", function () {
  const list = [];
  for (let i = 0; i < 12; i += 1) {
    list.push({ id: "P" + (i + 1), ang: "150.0000", len: "10.000" });
  }
  list[0].x = "0.000";
  list[0].y = "0.000";
  list[0].az = "0.0000";
  const pages = pagesOf(list);
  // 第 2 页 row0 是导线第 12 行；row1 空、row2 再放一行。
  pages[1].rows[2] = row({ id: "X", ang: "150.0000", len: "10.000" });
  const out = TC.computePages(pages, SETTINGS);
  assert.strictEqual(out.used, 12);
  const gap = out.issues.find(function (item) { return item.code === "row-gap"; });
  assert.ok(gap);
  assert.strictEqual(gap.row, 12);
  assert.strictEqual(gap.pageIndex, 1);
  assert.deepStrictEqual(gap.cells, ["s2-id"]);
  assert.strictEqual(out.pages[1].calc.issues[0].code, "row-gap");
  assert.strictEqual(out.pages[0].calc.issues.length, 0);
});

test("缺点号只警告，角度与坐标照算", function () {
  const out = TC.compute(square([{ id: "" }]), SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.n, 4);
  assert.strictEqual(out.fBetaSec, 0);
  assert.strictEqual(out.xMm[2], 10000);
  const idIssue = out.issues.find(function (item) { return item.code === "id-missing-1"; });
  assert.ok(idIssue);
  assert.strictEqual(idIssue.level, "warning");
  assert.strictEqual(idIssue.row, 0);
  assert.deepStrictEqual(idIssue.cells, ["s1-id"]);
});

test("页切片：数组恒为 11，标量共用，续页 source 不参与", function () {
  const list = [];
  for (let i = 0; i < 22; i += 1) {
    list.push({ id: "Q" + (i + 1), ang: "90.0000", len: "10.000" });
  }
  list[0].x = "0.000";
  list[0].y = "0.000";
  list[0].az = "90.0000";
  const pages = pagesOf(list);
  pages[1].source = { sourceCount: 22, overflow: 11 };
  const out = TC.computePages(pages, SETTINGS);
  assert.strictEqual(out.pages[0].calc.n, out.pages[1].calc.n);
  assert.strictEqual(out.pages[0].calc.state, out.pages[1].calc.state);
  assert.strictEqual(out.pages[1].calc.angles.length, 11);
  assert.strictEqual(out.pages[1].calc.dxMm.length, 11);
  assert.ok(!out.issues.some(function (item) { return item.code === "source-overflow"; }));
});

/* ---------------- 连接解算：P/T + 表四 β1 / β2 / d ---------------- */

function conn(over) {
  return Object.assign({
    pn: "0", pe: "0", tn: "0", te: "10",
    b1: "0.0000", b2: "0.0000", d: "1", dir: "left"
  }, over || {});
}

test("连接解算：α_PT 与 P–T 距离", function () {
  const out = TC.solveConnection(conn());
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.azPT.deg, 90);
  assert.strictEqual(out.azPT.packed, "90.0000");
  assert.strictEqual(out.distPT, 10);
  assert.strictEqual(out.azP1.packed, "90.0000");
  assert.strictEqual(out.x1, 0);
  assert.strictEqual(out.y1, 1);
  assert.strictEqual(out.az12.packed, "270.0000");
});

test("连接解算：左角 α_P1 = α_PT − β1、α_12 = α_P1 + 180° − β2", function () {
  const out = TC.solveConnection(conn({ b1: "30.0000", b2: "45.0000", d: "10" }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.azP1.packed, "60.0000");
  assert.strictEqual(out.x1, 5);
  assert.strictEqual(out.y1, 8.66);
  assert.strictEqual(out.az12.packed, "195.0000");
});

test("连接解算：右角两处都取加号", function () {
  const out = TC.solveConnection(conn({ b1: "30.0000", b2: "45.0000", d: "10", dir: "right" }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.azP1.packed, "120.0000");
  assert.strictEqual(out.x1, -5);
  assert.strictEqual(out.y1, 8.66);
  assert.strictEqual(out.az12.packed, "345.0000");
});

test("连接解算：方位角跨 0°/360° 规范", function () {
  const out = TC.solveConnection(conn({ b1: "350.0000" }));
  assert.strictEqual(out.azP1.packed, "100.0000");
  assert.strictEqual(out.az12.packed, "280.0000");
});

test("连接解算：P 与 T 重合时拒绝", function () {
  const out = TC.solveConnection(conn({ tn: "0", te: "0" }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.azPT, null);
  assert.ok(out.issues.some(function (item) { return item.code === "pt-same"; }));
});

test("连接解算：连接边 d ≤ 0 时拒绝", function () {
  const out = TC.solveConnection(conn({ d: "0" }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.azP1.packed, "90.0000");
  assert.strictEqual(out.x1, null);
  assert.ok(out.issues.some(function (item) { return item.code === "d-invalid"; }));
});

test("连接解算：β 的分/秒 ≥60 时拒绝", function () {
  const out = TC.solveConnection(conn({ b1: "30.6000" }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.azP1, null);
  assert.ok(out.issues.some(function (item) { return item.code === "b1-invalid"; }));
});

test("连接解算：缺 T 时只给 α_PT，缺项逐条列出", function () {
  const out = TC.solveConnection(conn({ tn: "", te: "", b1: "30.0000", b2: "45.0000", d: "10" }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.azPT, null);
  assert.strictEqual(out.azP1, null);
  assert.strictEqual(out.x1, null);
  assert.strictEqual(out.az12, null);
  assert.strictEqual(out.issues.filter(function (item) {
    return item.code === "coord-missing";
  }).length, 2);
});

test("解算结果填首行后，正方形导线闭合并 K = 0", function () {
  // 左角、β1 = 0、β2 = 180°：α_P1 = α_PT = 90°，α_12 = 90° + 180° − 180° = 90°。
  const solved = TC.solveConnection(conn({ b2: "180.0000", d: "10" }));
  assert.strictEqual(solved.ok, true);
  assert.strictEqual(solved.x1, 0);
  assert.strictEqual(solved.y1, 10);
  assert.strictEqual(solved.az12.packed, "90.0000");

  const rows = [
    { id: "A", ang: "90.0000", len: "10.000", x: solved.x1.toFixed(3), y: solved.y1.toFixed(3), az: solved.az12.packed },
    { id: "B", ang: "90.0000", len: "10.000" },
    { id: "C", ang: "90.0000", len: "10.000" },
    { id: "D", ang: "90.0000", len: "10.000" }
  ];
  const out = TC.compute(page(rows), SETTINGS);
  assert.strictEqual(out.state, "ok");
  assert.strictEqual(out.fxMm, 0);
  assert.strictEqual(out.fyMm, 0);
  assert.strictEqual(out.kDenActual, Infinity);
  assert.strictEqual(out.az[0].packed, "90.0000");
});

test("取整：.5 边界半值远离零，二进制尾巴不改变结果", function () {
  assert.strictEqual(TC.roundHalfAway(0.5), 1);
  assert.strictEqual(TC.roundHalfAway(-0.5), -1);
  assert.strictEqual(TC.roundHalfAway(98770.5), 98771);
  assert.strictEqual(TC.roundHalfAway(-98770.5), -98771);
  assert.strictEqual(TC.roundHalfAway(98770.49999999999), 98771);
  assert.strictEqual(TC.roundHalfAway(98770.4), 98770);
  assert.strictEqual(TC.roundHalfAway(0), 0);
  assert.strictEqual(TC.roundTo(98.7705, 3), 98.771);
  assert.strictEqual(TC.roundTo(-98.7705, 3), -98.771);
  assert.strictEqual(TC.roundTo(70.58335, 4), 70.5834);
});

console.log("\n" + passed + " assertions passed (traverse calc).");
