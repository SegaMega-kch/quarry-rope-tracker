import assert from "node:assert/strict";
import { test } from "node:test";
import { compactReportStates, type ReportStateChange, type ReportStateValue } from "../lib/report-state";

const empty: ReportStateValue = { key: "none", label: "место не указано", empty: true };
const a = { key: "a", label: "гор. +100м" }, b = { key: "b", label: "гор. +200м" }, c = { key: "c", label: "гор. +355м" };
const move = (id: number, before: ReportStateValue, after: ReportStateValue, extra: Partial<ReportStateChange> = {}): ReportStateChange => ({
  id: `move:${id}`, at: new Date(1000 * id), key: "assembly:1", group: { key: "assemblies", name: "Сборки" }, prefix: "Сборка №1: ", before, after, ...extra
});

test("state changes keep first and last values without mutating or depending on input order", () => {
  const input = [move(3, b, c), move(1, empty, a), move(2, a, b)];
  const original = JSON.stringify(input);
  assert.deepEqual(compactReportStates(input).map(e => e.line), ["Сборка №1: гор. +355м."]);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(compactReportStates([move(1, a, b), move(2, b, c)]).map(e => e.line), ["Сборка №1: гор. +100м → гор. +355м."]);
});

test("no-op edits and a return to the starting value leave no report line", () => {
  assert.deepEqual(compactReportStates([move(1, empty, a), move(2, a, empty), move(3, empty, empty)]), []);
  assert.deepEqual(compactReportStates([move(1, a, b), move(2, b, a)]), []);
  assert.deepEqual(compactReportStates([move(1, a, a)]), []);
});

test("different objects and loan-separated movement segments never collapse together", () => {
  const result = compactReportStates([move(1, a, b), move(2, b, a, { key: "assembly:2" }), move(3, b, a, { key: "assembly:1:after-loan" })]);
  assert.equal(result.length, 3);
});

test("missing links are kept separate rather than hiding an unproven return to origin", () => {
  assert.equal(compactReportStates([move(1, a, b), move(2, c, a)]).length, 2);
});

test("later observations update real final placement without creating extra standalone work", () => {
  assert.deepEqual(compactReportStates([move(1, a, b, { observationOnly: true })]), []);
  assert.deepEqual(compactReportStates([move(1, a, b), move(2, b, c, { observationOnly: true })]).map(e => e.line), ["Сборка №1: гор. +100м → гор. +355м."]);
  assert.deepEqual(compactReportStates([move(1, a, b), move(2, b, c, { visible: false })]), []);
});

test("equal timestamps use numeric audit IDs, not lexical ordering", () => {
  assert.deepEqual(compactReportStates([move(10, b, c, { at: new Date(0) }), move(9, a, b, { at: new Date(0) })]).map(e => e.line), ["Сборка №1: гор. +100м → гор. +355м."]);
});
