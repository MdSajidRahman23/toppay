const test = require("node:test"), assert = require("node:assert");
const T = require("../../public/js/statement-core.js");

test("name matching: titles, order, spelling, Bangla, initials", () => {
  assert.equal(T.nameMatch("MD. FOKRUL HASAN", "Fokrul Hasan").level, "match");
  assert.equal(T.nameMatch("Hasan Fokrul", "MD FOKRUL HASAN").level, "match");
  assert.equal(T.nameMatch("Mohammad Rahman", "Muhammad Rahaman").level, "match");
  assert.equal(T.nameMatch("মোঃ করিম", "Karim").level, "match");
  assert.equal(T.nameMatch("Rahim Uddin", "Karim Hossain").level, "mismatch");
  assert.equal(T.nameMatch("F. Hasan", "Fokrul Hasan").level, "partial"); // initial only = partial, reviewer decides
  assert.equal(T.nameMatch("", "X").ok, false);
});

test("amounts and dates", () => {
  assert.equal(T.parseAmount("1,234.50"), 1234.5);
  assert.equal(T.parseAmount("abc"), null);
  assert.equal(T.findDate("05/08/2026 10:30 AM Cash In").date, "2026-08-05");
  assert.equal(T.findDate("2026-08-05 x").date, "2026-08-05");
  assert.equal(T.findDate("5 Aug 2026 x").date, "2026-08-05");
  assert.equal(T.findDate("31/02/2026"), null);
});

const LINES = [
  "bKash Account Statement", "Account Name: MD. FOKRUL HASAN",
  "05/08/2026  Cash In from agent  3,000.00  4,000.00",
  "20/08/2026  Send Money to 01711  1,000.00  3,000.00",
  "03/09/2026  Cash In Salary  2,500.00  5,500.00",
  "18/09/2026  Payment shop  500.00  5,000.00",
  "02/10/2026  Cash In deposit  1,950.00  6,950.00",
  "15/10/2026  Cash Out agent  800.00  6,150.00",
  "12/11/2026  Cash In late  9,000.00  15,150.00",
];

test("rows, direction from balance, SOP month rule + 7-day exclusion", () => {
  const { rows } = T.parseRows(LINES);
  assert.equal(rows.length, 7);
  const s = T.sopCheck(rows, "2026-11-15");
  assert.deepEqual(s.months.map((m) => m.month), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(s.months[0].in, 3000);
  assert.equal(s.best, 3000);            // best single direction, NOT in+out
  assert.equal(s.total3, 3000 + 1000 + 2500 + 500 + 1950 + 800);
  assert.ok(s.passMin); assert.ok(!s.passFast);
  assert.equal(s.covered, 3);
});

test("tolerance: 1,940 passes, 1,900 fails; fast-track with tolerance", () => {
  const mk = (v) => [{ date: "2026-09-01", in: v, out: 0, balance: null }];
  assert.ok(T.sopCheck(mk(1940), "2026-11-15").passMin);
  assert.ok(!T.sopCheck(mk(1900), "2026-11-15").passMin);
  assert.ok(T.sopCheck(mk(5940), "2026-11-15").passFast);
  assert.ok(!T.sopCheck(mk(5900), "2026-11-15").passFast);
});

test("last 7 days before application are ignored", () => {
  const rows = [{ date: "2026-10-28", in: 5000, out: 0, balance: null }, { date: "2026-10-20", in: 100, out: 0, balance: null }];
  // application 2026-11-03 -> cutoff 2026-10-27, so the 28th is ignored
  assert.equal(T.sopCheck(rows, "2026-11-03").best, 100);
});

test("balance arithmetic detects an altered balance", () => {
  const ok = T.balanceCheck(T.parseRows(LINES).rows);
  assert.equal(ok.broken, 0);
  const bad = LINES.slice(); bad[5] = "18/09/2026  Payment shop  500.00  5,777.00";
  const b = T.balanceCheck(T.parseRows(bad).rows);
  assert.ok(b.broken >= 1);
});

test("authenticity signals", () => {
  const s = T.signals({ producer: "Sejda PDF Editor", creationDate: "D:20261001100000", modDate: "D:20261005100000", revisions: 2 }, [], null);
  assert.ok(s.filter((x) => x.level === "warn").length >= 3);
  const g = T.signals({ producer: "iText bKash", revisions: 1 }, [], null);
  assert.equal(g.filter((x) => x.level === "warn").length, 0);
});

test("analyze end to end + holder name", () => {
  const a = T.analyze({ lines: LINES, meta: {}, customerName: "Fokrul Hasan", appDate: "2026-11-15" });
  assert.equal(a.holder, "MD. FOKRUL HASAN");
  assert.equal(a.name.level, "match");
  assert.equal(a.provider.id, "bkash");
  assert.equal(a.provider.verified, false);
});
