import assert from "node:assert/strict";
import test from "node:test";
import { parseStatisticsSnapshot } from "../lib/pp-statistics";

function snapshot(end: string, messages: string[]) {
  return { version: 1, period: { start: new Date(new Date(end).getTime() - 12 * 60 * 60 * 1000).toISOString(), end }, capturedAt: end, messages };
}

test("extracts exact P/P readings from a saved report", () => {
  const report = parseStatisticsSnapshot(snapshot("2026-10-08T14:30:00.000Z", [
    "08.10.2026 · 06:30-19:30\n\nЗЕМЛЯ НА П/П\n\nПП №1 · ЭКГ №4\nСектор 1: 3Р\nСектор 2: 2В 🟢\n\nИЗМЕНЕНИЯ\n\nЗа смену изменений не было."
  ]));
  assert.deepEqual(report, {
    at: "2026-10-08T14:30:00.000Z", date: "2026-10-08", time: "19:30",
    points: [{ name: "ПП №1", excavator: "ЭКГ №4", sectors: [
      { name: "1", quantity: 3, material: "ORE" },
      { name: "2", quantity: 2, material: "OVERBURDEN" }
    ] }]
  });
});

test("keeps parsing P/P blocks split across report messages", () => {
  const report = parseStatisticsSnapshot(snapshot("2026-10-09T01:30:00.000Z", [
    "08.10.2026, 19:30 - 09.10.2026, 06:30\nЧасть 1 из 3\n\nЗЕМЛЯ НА П/П\n\nПП №1 · Без экскаватора\nЗемли нет",
    "08.10.2026, 19:30 - 09.10.2026, 06:30\nЧасть 2 из 3\n\nПП №2 · ЭКГ №8\nСектор Север: 5Р",
    "08.10.2026, 19:30 - 09.10.2026, 06:30\nЧасть 3 из 3\n\nИЗМЕНЕНИЯ\n\nЗа смену изменений не было."
  ]));
  assert.equal(report?.time, "06:30");
  assert.deepEqual(report?.points.map((point) => [point.name, point.excavator]), [["ПП №1", null], ["ПП №2", "ЭКГ №8"]]);
});

test("ignores snapshots outside the approved 06:30 and 19:30 boundaries", () => {
  assert.equal(parseStatisticsSnapshot(snapshot("2026-10-08T15:00:00.000Z", ["header\n\nЗЕМЛЯ НА П/П\n\nНет П/П с землёй или экскаватором."])), null);
});

test("rejects malformed saved values without inventing readings", () => {
  assert.equal(parseStatisticsSnapshot({ version: 1, period: {}, messages: [] }), null);
  const report = parseStatisticsSnapshot(snapshot("2026-10-08T14:30:00.000Z", ["header\n\nЗЕМЛЯ НА П/П\n\nПП №1 · ЭКГ №4\nСектор 1: много Р"]));
  assert.deepEqual(report?.points, []);
});
