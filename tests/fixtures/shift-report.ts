import { latestCompletedShift, type ShiftReportInput, type WorkEvent, type PowerEvent, type ReportGroup } from "../../lib/shift-report";

export const period = latestCompletedShift(new Date("2026-09-16T20:00:00+05:00"));
export const at = (minutes: number) => new Date(period.start.getTime() + minutes * 60000);
export const exc = (id: number): ReportGroup => ({ key: `exc:${id}`, name: `ЭКГ-10 №${id}` });
export const containers = { key: "containers", name: "Вертушки и пены" };
export function work(id: number, line: WorkEvent["line"], extra: Partial<WorkEvent> = {}): WorkEvent {
  return { kind: "work", id: `test:${id}`, at: at(id), group: exc(9), line, ...extra };
}
export function power(id: number, box: number, before: boolean, after: boolean): PowerEvent {
  return { kind: "power", id: `power:${id}`, at: at(id), group: exc(18), source: { key: `yakno:${box}`, name: `ЯКНО №${box}` }, before, after };
}
export function emptyReport(): ShiftReportInput {
  return { period: { start: new Date(period.start), end: new Date(period.end) }, capturedAt: new Date(period.end), events: [], points: [
    { id: 3, name: "ПП №3", excavator: "ЭКГ-12К №75", unloadingSectorId: 32, sectors: [
      { id: 31, name: "1", quantity: 3, material: "OVERBURDEN" },
      { id: 32, name: "2", quantity: 0, material: "ORE" },
      { id: 33, name: "3", quantity: 2, material: "OVERBURDEN" }
    ] },
    { id: 4, name: "ПП №4", excavator: null, unloadingSectorId: null, sectors: [
      { id: 41, name: "1", quantity: 1, material: "OVERBURDEN" }, { id: 42, name: "2", quantity: 0, material: "ORE" }
    ] },
    { id: 5, name: "ПП №5", excavator: "ЭКГ-10 №9", unloadingSectorId: null, sectors: [
      { id: 51, name: "1", quantity: 0, material: "OVERBURDEN" }, { id: 52, name: "2", quantity: 0, material: "ORE" }
    ] },
    { id: 6, name: "ПП №6", excavator: null, unloadingSectorId: null, sectors: [{ id: 61, name: "1", quantity: 0, material: "ORE" }] }
  ] };
}
export function ropeChain(quantity = 1): WorkEvent[] {
  return [
    work(1, { before: "Вертушка №3: погружен напорный канат 41 м, ", quantity, after: " шт." }, { group: containers, transient: true, flows: [{ item: "rope:41", quantity, to: "table:3@1" }] }),
    work(2, { before: "Вертушка №3: 20т кран → ЭКГ-10 №9; канат 41 м, ", quantity, after: " шт." }, { group: containers, transient: true, flows: [{ item: "rope:41", quantity, from: "table:3@1", to: "table:3@9" }] }),
    work(3, "Установлен напорный канат 41 м.", { flows: [{ item: "rope:41", quantity: 1, from: "table:3@9" }] })
  ];
}
export function ordinaryReport(): ShiftReportInput {
  const input = emptyReport();
  input.events = [
    ...ropeChain(),
    work(4, "Вывезен б/у канат 41 м, 1 шт."),
    work(5, "Вертушка №3 (пустая): ЭКГ-10 №9 → 20т кран.", { group: containers }),
    work(6, { before: "Пена №2: погружено ", quantity: 5, after: " новых зубьев." }, { group: containers, transient: true, flows: [{ item: "tooth:NEW", quantity: 5, to: "bin:2@1" }] }),
    work(7, "Пена №2: 30т кран → ЭКГ-10 №4.", { group: containers, transient: true, flows: [{ item: "tooth:NEW", quantity: 5, from: "bin:2@1", to: "bin:2@4" }] }),
    work(8, "Установлено 5 зубьев (Пена №2).", { group: exc(4), flows: [{ item: "tooth:NEW", quantity: 5, from: "bin:2@4" }] }),
    { kind: "power", id: "assembly:9", at: at(9), group: exc(4), source: { key: "assembly:2", name: "Сборка №2" }, before: false, after: true },
    power(10, 7, true, false), power(11, 8, false, true), power(12, 8, true, false), power(13, 12, false, true),
    work(14, "Выдан в долг (Северный): канат 110 м, 1 шт.; вместе с вертушкой №5.", { group: { key: "loans", name: "Канаты в долг" } }),
    work(15, "Вывезено 5 б/у зубьев с земли.", { group: exc(4) })
  ];
  return input;
}
export function repeatedReport(): ShiftReportInput {
  const input = emptyReport();
  input.events = [
    ...ropeChain(2),
    work(4, "Установлен напорный канат 41 м.", { flows: [{ item: "rope:41", quantity: 1, from: "table:3@9" }] }),
    work(5, "Вертушка №3 (пустая): ЭКГ-10 №9 → 20т кран.", { group: containers }),
    work(10, "Пена №2: погружено 5 зубьев.", { group: containers, transient: true, flows: [{ item: "teeth:NEW", quantity: 5, to: "bin:2@1" }] }),
    work(11, "Пена №2: доставлена к ЭКГ-10 №4.", { group: containers, transient: true, flows: [{ item: "teeth:NEW", quantity: 5, from: "bin:2@1", to: "bin:2@4" }] }),
    work(12, "Установлено 5 зубьев (Пена №2).", { group: exc(4), flows: [{ item: "teeth:NEW", quantity: 5, from: "bin:2@4" }] }),
    work(15, "Пена №2: погружено 5 новых зубьев.", { group: containers, transient: true, flows: [{ item: "teeth:NEW", quantity: 5, to: "bin:2@1" }] }),
    work(16, "Пена №2: доставлена к ЭКГ-10 №9.", { group: containers, transient: true, flows: [{ item: "teeth:NEW", quantity: 5, from: "bin:2@1", to: "bin:2@9" }] }),
    work(17, "Установлено 5 зубьев (Пена №2).", { flows: [{ item: "teeth:NEW", quantity: 5, from: "bin:2@9" }] })
  ];
  return input;
}
