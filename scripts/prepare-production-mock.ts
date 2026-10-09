import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { currentWorkPeriod } from "../lib/shift-calendar";
import { emptySettings, normKey, type Excavator } from "../lib/production-domain";
import { openProductionStore } from "../lib/production-store";

// A separate local mock; never resets or overwrites an existing database.
async function main() {
  const path = resolve(".data/shift-production-review-v2.db");
  if (existsSync(path)) throw new Error("Макет уже существует; данные не заменены");
  const store = await openProductionStore(path);
  try {
    const settings = emptySettings();
    const examples: Array<[string, string, Excavator["direction"], number]> = [
      ["75", "ЭКГ-12", "rail", 130], ["52", "ЭКГ-10", "rail", 130],
      ["41", "ЭКГ-15", "rail", 130], ["76", "ЭКГ-12", "rail", 130],
      ["9", "ЭКГ-10", "truck", 130], ["12", "ЭКГ-10", "truck", 90],
      ["38", "ЭКГ-12", "truck", 130], ["60", "ЭКГ-20", "truck", 240],
    ];
    settings.excavators = examples.map(([number, type, direction, truck]) => ({ id: `mock-${direction}-${number}`, number, type, direction, truck, active: true }));
    for (const type of new Set(examples.map(e => e[1]))) {
      settings.norms[normKey(type, "rail")] = ["2", "5"];
      settings.norms[normKey(type, "truck", 90)] = ["2", "00"];
      settings.norms[normKey(type, "truck", 130)] = ["2", "30"];
      settings.norms[normKey(type, "truck", 240)] = ["3", "00"];
    }
    const actor = { id: 1, login: "Локальный макет", role: "admin" };
    await store.saveSettings(settings, actor);
    const period = currentWorkPeriod();
    const open = await store.open(period.date, period.kind);
    const rows = open.snapshot.rows;
    Object.assign(rows[0], { plan: "3700", fact: "1500", waiting: ["1", "5"], note: "Аварийный ремонт" });
    rows[0].loading[0].time = ["2", "5"];
    Object.assign(rows[4], { plan: "3200", fact: "3000", waiting: ["1", "15"] });
    rows[4].loading[0].time = ["2", "30"];
    await store.draft({ date: period.date, kind: period.kind, rows, latestId: null, draftRevision: 0 }, actor);
    console.log(`Created local 4+4 mock for ${period.key}: ${path}`);
  } finally { await store.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
