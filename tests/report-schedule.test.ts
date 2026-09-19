import assert from "node:assert/strict";
import { test } from "node:test";
import { nextReportBoundary, validReportPeriod } from "../lib/report-schedule";
import { summarizeShift } from "../lib/shift-report";
import { power } from "./fixtures/shift-report";

test("new boundaries handle exact times, midnight and year rollover", () => {
  for (const [from, expected] of [
    ["2026-09-19T20:00:00+05:00", "2026-09-20T06:30:00+05:00"],
    ["2026-09-20T06:29:59+05:00", "2026-09-20T06:30:00+05:00"],
    ["2026-09-20T06:30:00+05:00", "2026-09-20T19:30:00+05:00"],
    ["2026-12-31T19:30:00+05:00", "2027-01-01T06:30:00+05:00"]
  ]) assert.equal(nextReportBoundary(new Date(from)).getTime(), new Date(expected).getTime());
  const start = new Date("2026-09-19T20:00:00+05:00");
  assert(validReportPeriod(start, nextReportBoundary(start)));
  assert(!validReportPeriod(start, new Date("2026-09-20T19:30:00+05:00")));
  assert(!validReportPeriod(new Date("invalid"), start));
});

test("assembly and Yakno remain independent in the compact report, never a false source replacement", () => {
  const off = power(1, 7, true, false);
  const on = { ...power(2, 2, false, true), source: { key: "assembly:2", name: "Сборка №2" } };
  const lines = summarizeShift([off, on]).flatMap((group) => group.lines);
  assert.deepEqual(lines, ["Отключён от ЯКНО №7.", "Запитан: Сборка №2."]);
  assert(!lines.join("").includes("Перезапитан"));
});
