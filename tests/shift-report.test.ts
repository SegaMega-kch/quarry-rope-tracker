import assert from "node:assert/strict";
import { test } from "node:test";
import { formatShiftReport, latestCompletedShift, prepareShiftReport, summarizeShift, type ShiftEvent } from "../lib/shift-report";
import { at, containers, emptyReport, exc, ordinaryReport, period, power, repeatedReport, ropeChain, work } from "./fixtures/shift-report";

test("shift boundaries cover day, night, year rollover and reject invalid dates", () => {
  for (const [now, start, end] of [
    ["2026-09-05T20:00:00+05:00", "2026-09-05T03:00:00.000Z", "2026-09-05T15:00:00.000Z"],
    ["2026-09-05T08:00:00+05:00", "2026-09-04T15:00:00.000Z", "2026-09-05T03:00:00.000Z"],
    ["2026-09-05T07:59:59+05:00", "2026-09-04T03:00:00.000Z", "2026-09-04T15:00:00.000Z"],
    ["2027-01-01T08:05:00+05:00", "2026-12-31T15:00:00.000Z", "2027-01-01T03:00:00.000Z"]
  ]) {
    const p = latestCompletedShift(new Date(now));
    assert.equal(p.start.toISOString(), start);
    assert.equal(p.end.toISOString(), end);
    assert.equal(latestCompletedShift(p.start).end.getTime(), p.start.getTime());
  }
  assert.throws(() => latestCompletedShift(new Date("invalid")));
});

test("PP inclusion is ground OR excavator; zero material readings and exactly one active marker remain", () => {
  const text = formatShiftReport(emptyReport()).join("\n");
  assert.match(text, /ПП №3 · ЭКГ-12К №75/);
  assert.match(text, /Сектор 2: 0Р 🟢/);
  assert.match(text, /ПП №4 · Без экскаватора/);
  assert.match(text, /ПП №5 · ЭКГ-10 №9\nЗемли нет\nСектор 1: 0В\nСектор 2: 0Р/);
  assert(!text.includes("ПП №6"));
  assert.equal((text.match(/🟢/g) ?? []).length, 1);
  assert.match(text, /ОСТАЛЬНОЕ\n\nЗа смену изменений не было/);
});

test("completed work hides its loading and delivery, but not evacuation or the empty return", () => {
  const input = ordinaryReport();
  const before = JSON.stringify(input);
  const text = formatShiftReport(input).join("\n");
  assert(!text.includes("погружено") && !text.includes("погружен"));
  assert(!text.includes("Пена №2: 30т кран"));
  assert.match(text, /Установлен напорный канат 41 м/);
  assert.match(text, /Вывезен б\/у канат 41 м, 1 шт/);
  assert.match(text, /Вертушка №3 \(пустая\)/);
  assert.match(text, /Установлено 5 зубьев/);
  assert.match(text, /Вывезено 5 б\/у зубьев/);
  assert.match(text, /Сборка №2/);
  assert.equal(JSON.stringify(input), before);
});

test("partial rope installation retains only the outstanding delivered quantity", () => {
  const text = summarizeShift(ropeChain(2)).flatMap((g) => g.lines).join("\n");
  assert(!text.includes("погружен"));
  assert.match(text, /канат 41 м, 1 шт/);
  assert(!text.includes("2 шт"));
  assert.match(text, /Установлен/);
});

test("separate installation cycles and repeated completed jobs are never deduplicated", () => {
  const text = formatShiftReport(repeatedReport()).join("\n");
  assert.equal((text.match(/Установлен напорный канат/g) ?? []).length, 2);
  assert.equal((text.match(/Установлено 5 зубьев/g) ?? []).length, 2);
  assert(!text.includes("погружено") && !text.includes("доставлена"));
});

test("different cargo types and places do not consume one another", () => {
  const events = ropeChain(2);
  events.push(work(4, "Other rope installed", { flows: [{ item: "rope:110", quantity: 1, from: "table:3@9" }] }));
  events.push(work(5, "Same rope elsewhere", { flows: [{ item: "rope:41", quantity: 1, from: "table:3@4" }] }));
  assert.match(summarizeShift(events).flatMap((g) => g.lines).join("\n"), /канат 41 м, 1 шт/);
});

test("ground unload, load and installation form a chain without losing used-tooth evacuation", () => {
  const events = [
    work(1, { before: "Unload ", quantity: 5, after: " teeth" }, { transient: true, flows: [{ item: "NEW", quantity: 5, from: "bin:2@9", to: "bin:ground@9" }] }),
    work(2, { before: "Load ", quantity: 5, after: " teeth" }, { transient: true, flows: [{ item: "NEW", quantity: 5, from: "bin:ground@9", to: "bin:3@9" }] }),
    work(3, "Installed 3", { flows: [{ item: "NEW", quantity: 3, from: "bin:3@9" }] }),
    work(4, "Evacuated used teeth", { flows: [{ item: "USED", quantity: 5, from: "bin:ground@9" }] })
  ];
  const lines = summarizeShift(events).flatMap((g) => g.lines);
  assert.deepEqual(lines, ["Load 2 teeth", "Installed 3", "Evacuated used teeth"]);
});

test("uncertain stock adjustments stop chain matching instead of hiding potentially unrelated work", () => {
  const events: ShiftEvent[] = ropeChain();
  events.splice(2, 0, { kind: "barrier", id: "barrier", at: at(2.5), holders: ["table:3"] });
  const text = summarizeShift(events).flatMap((g) => g.lines).join("\n");
  assert.match(text, /Вертушка №3: 20т кран/);
  assert.match(text, /Установлен/);
});

test("one physical turntable move stays one line while preserving partial quantities and independent trips", () => {
  const combine = { key: "trip-1", prefix: "Вертушка №3: кран → экскаватор; " };
  const move = (id: number, item: string, length: number) => work(id, { before: `канат ${length} м, `, quantity: 1, after: " шт." }, {
    group: containers, transient: true, combine, flows: [{ item, quantity: 1, from: "table:3@crane", to: "table:3@exc" }]
  });
  const a = move(1, "41-small", 41);
  const b = move(2, "41-large", 41);
  assert.deepEqual(summarizeShift([a, b])[0].lines, ["Вертушка №3: кран → экскаватор; канат 41 м, 2 шт."]);
  const install = work(3, "Установлен канат 41 м.", { flows: [{ item: "41-small", quantity: 1, from: "table:3@exc" }] });
  assert.equal(summarizeShift([a, b, install]).flatMap((g) => g.lines).filter((line) => line.includes("Вертушка"))[0], "Вертушка №3: кран → экскаватор; канат 41 м, 1 шт.");
  const c = move(4, "110", 110);
  assert.equal(summarizeShift([a, c])[0].lines.length, 1);
  assert.match(summarizeShift([a, c])[0].lines[0], /41 м.*110 м/);
  c.combine = { ...combine, key: "trip-2" };
  assert.equal(summarizeShift([a, c])[0].lines.length, 2);
});

test("power reports the initial and final sources and independent disconnects", () => {
  const events = [power(1, 7, true, false), power(2, 8, false, true), power(3, 8, true, false), power(4, 12, false, true)];
  const lines = summarizeShift(events).flatMap((g) => g.lines);
  assert.deepEqual(lines, ["Перезапитан: ЯКНО №7 → ЯКНО №12."]);
  assert.deepEqual(summarizeShift([power(1, 7, true, false)])[0].lines, ["Отключён от ЯКНО №7."]);
  assert.deepEqual(summarizeShift([power(1, 7, true, false), power(2, 7, false, true)]), []);
});

test("power can transition between Yakno and assembly without losing the old source", () => {
  const events: ShiftEvent[] = [power(1, 7, true, false), { kind: "power", id: "assembly:2", at: at(2), group: exc(18), source: { key: "assembly:2", name: "Сборка №2" }, before: false, after: true }];
  assert.deepEqual(summarizeShift(events)[0].lines, ["Перезапитан: ЯКНО №7 → Сборка №2."]);
});

test("frozen messages and period survive input changes and a later sending date", () => {
  const input = ordinaryReport();
  const prepared = prepareShiftReport(input);
  const frozen = JSON.stringify(prepared);
  input.points[0].sectors[0].quantity = 999;
  input.events.length = 0;
  input.period.start.setFullYear(2030);
  assert.equal(JSON.stringify(prepared), frozen);
  assert.equal(JSON.parse(frozen).period.end, period.end.toISOString());
});

test("a fresh snapshot of an old shift is explicitly dated and never claimed as its end state", () => {
  const input = emptyReport();
  input.capturedAt = new Date(period.end.getTime() + 3600000);
  assert.match(formatShiftReport(input)[0], /Состояние на .*не на конец прошлой смены/);
});

test("long reports preserve Unicode and text, split under MAX limits, and retain the original period", () => {
  const input = emptyReport();
  const details = "Ж".repeat(3499) + "🟢" + "Я".repeat(4200);
  input.events = [work(1, details, { group: containers })];
  const parts = formatShiftReport(input);
  assert(parts.length > 1);
  for (const part of parts) {
    assert(part.length <= 4000);
    assert(part.includes("16.09.2026") && part.includes("Екатеринбург"));
    assert.equal(Buffer.from(part).toString("utf8"), part);
  }
  const bodies = parts.map((part) => part.slice(part.indexOf("\n\n") + 2)).join("");
  assert(bodies.includes(details));
});

test("invalid bounds, future snapshots, duplicate IDs and negative PP quantities are rejected", () => {
  const input = emptyReport();
  input.events = [work(1, "outside", { at: period.end })];
  assert.throws(() => formatShiftReport(input));
  input.events = [];
  input.capturedAt = at(1);
  assert.throws(() => formatShiftReport(input));
  assert.throws(() => summarizeShift([work(1, "a"), work(1, "b")]));
  assert.throws(() => summarizeShift([work(1, "a", { flows: [{ item: "x", quantity: -1 }] })]));
  input.capturedAt = new Date(period.end);
  input.points[0].sectors[0].quantity = -1;
  assert.throws(() => formatShiftReport(input));
});
