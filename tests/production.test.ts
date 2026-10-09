import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { currentWorkPeriod, workPeriod, periodLabel } from "../lib/shift-calendar";
import { appendReasonText, applyPdfLoadingNorms, commentText, currentRows, currentSettings, defaultRows, displayDuration, duration, emptySettings, getNorm, normKey, pdfLoadingNorms, percentage, productionTotals, rowResult, truckTypes, validateRows, volume, weightedLoading, versionChanges, type Settings } from "../lib/production-domain";
import { ConflictError, openProductionStore, type ProductionStore } from "../lib/production-store";

const actor = { id: 1, login: "администратор", role: "admin" };
function configuration(): Settings {
  const settings = emptySettings();
  settings.excavators = [{ id: "rail", number: "ТЕСТ-ЖД", type: "ЭКГ-10", direction: "rail", truck: 130, active: true }, { id: "truck", number: "ТЕСТ-АВТО", type: "ЭКГ-20", direction: "truck", truck: 130, active: true }];
  settings.norms = { [normKey("ЭКГ-10", "rail")]: ["1", "05"], [normKey("ЭКГ-20", "truck", 130)]: ["2", "5"], [normKey("ЭКГ-20", "truck", 240)]: ["3", "0"] };
  return settings;
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const path = join(mkdtempSync(join(tmpdir(), "rapmas-production-")), "reports.db");
  const store = await openProductionStore(path); t.after(() => store.close());
  await store.saveSettings(configuration(), actor);
  return { store, path };
}
async function input(store: ProductionStore, kind: "preliminary" | "final" = "final", date = "2026-09-29") {
  const open = await store.open(date, "day");
  return { date, periodKind: "day" as const, rows: open.snapshot.rows, kind, latestId: open.latestId, draftRevision: open.draftRevision, operation: randomUUID() };
}

test("periods use supplied brigade anchor, Yekaterinburg and fixed 12-hour boundaries", () => {
  assert.equal(workPeriod("2026-09-29", "day").crew, 2);
  assert.equal(workPeriod("2026-09-30", "day").crew, 3);
  assert.equal(workPeriod("2026-09-30", "night").crew, 2);
  assert.equal(currentWorkPeriod(new Date("2026-09-30T07:59:59+05:00")).key, "2026-09-29/night");
  assert.equal(currentWorkPeriod(new Date("2026-09-30T08:00:00+05:00")).key, "2026-09-30/day");
  assert.equal(currentWorkPeriod(new Date("2026-09-30T20:00:00+05:00")).key, "2026-09-30/night");
  assert.match(periodLabel(workPeriod("2026-12-31", "night")), /31.12.2026.*01.01.2027/);
  assert.throws(() => workPeriod("2026-02-30", "day"));
});
test("duration preserves decimal digits, explicit zeros and partial fields exactly", () => {
  assert.equal(duration(["", ""], "decimal"), null);
  assert.equal(duration(["0", ""], "decimal"), 0);
  assert.equal(duration(["1", "5"], "decimal"), 5_400_000_000);
  assert.equal(duration(["1", "05"], "decimal"), 3_780_000_000);
  assert.equal(duration(["1", "85"], "decimal"), 6_660_000_000);
  assert.equal(duration(["", "000001"], "decimal"), 3600);
  assert.equal(duration(["2", "30"], "ms"), 150_000_000);
  assert.equal(duration(["2", "30"], "hm"), 9_000_000_000);
  assert.equal(duration(["", "30"], "ms"), 30_000_000);
  assert.throws(() => duration(["2", "60"], "ms"));
  assert.throws(() => duration(["2:30", ""], "ms"));
  assert.equal(duration(["185", ""], "decimal"), 185 * 3_600_000_000);
  assert.equal(volume(""), null); assert.equal(volume("0"), 0); assert.equal(volume("12,5"), 12.5);
  assert.throws(() => volume("oops")); assert.throws(() => volume("-1"));
});
test("loading uses decimal minutes while waiting retains direction-specific units", () => {
  assert.equal(duration(["2", "5"], "decimalMinutes"), 150_000_000);
  assert.equal(duration(["2", "05"], "decimalMinutes"), 123_000_000);
  assert.equal(duration(["", "000001"], "decimalMinutes"), 60);
  assert.equal(duration(["", ""], "decimalMinutes"), null);
  assert.equal(duration(["0", ""], "decimalMinutes"), 0);
  assert.equal(displayDuration(150_000_000, "decimalMinutes"), "2,5 мин");
  const rows = defaultRows(configuration()); rows[0].loading[0].time = ["2", "5"]; rows[0].waiting = ["2", "5"]; rows[0].fact = "100";
  assert.equal(weightedLoading(rows, "rail").value, 150_000_000);
  assert.equal(duration(rows[0].waiting, "decimal"), 9_000_000_000);
  rows[1].loading[0].time = ["8", "72"];
  assert.equal(duration(rows[1].loading[0].time, "decimalMinutes"), 523_200_000);
});
test("manual percentages preserve blank and zero and enforce agreed limits", () => {
  assert.equal(percentage("", 100, "Выход негабарита"), null);
  assert.equal(percentage("0", 100, "Выход негабарита"), 0);
  assert.equal(percentage("106,25", 999.99, "Загрузка"), 106.25);
  assert.throws(() => percentage("1000", 999.99, "Загрузка"), /от 0 до 999,99/);
  assert.throws(() => percentage("1,234", 100, "Выход негабарита"), /двух знаков/);
  assert.throws(() => percentage("100,01", 100, "Выход негабарита"), /от 0 до 100/);

  const rows = defaultRows(configuration());
  rows[0].loadPercent = "106";
  rows[1].loadPercent = "99,5";
  rows[1].oversizePercent = "1,03";
  assert.deepEqual(validateRows(rows), []);
  rows[0].oversizePercent = "0";
  assert.ok(validateRows(rows).some(issue => issue.path === "rows.0.oversizePercent"));
});
test("PDF norm seed adds 220 t and refuses to overwrite a conflict", () => {
  assert.deepEqual(truckTypes, [90, 130, 220, 240]);
  const seeded = applyPdfLoadingNorms(emptySettings());
  assert.equal(seeded.added.length, 15);
  assert.deepEqual(seeded.conflicts, []);
  assert.deepEqual(seeded.settings.norms[normKey("ЭКГ-10", "rail")], ["5", "30"]);
  assert.deepEqual(seeded.settings.norms[normKey("ЭКГ-10", "truck", 220)], ["8", "35"]);
  assert.deepEqual(seeded.settings.norms[normKey("ЭКГ-20", "truck", 240)], ["3", "77"]);
  assert.equal(Object.keys(pdfLoadingNorms()).length, 15);

  const conflictSettings = emptySettings();
  conflictSettings.norms[normKey("ЭКГ-10", "truck", 220)] = ["8", "36"];
  const conflict = applyPdfLoadingNorms(conflictSettings);
  assert.deepEqual(conflict.conflicts, [normKey("ЭКГ-10", "truck", 220)]);
});
test("legacy loading inputs and norms convert once without changing physical durations", () => {
  const legacy = configuration(); delete legacy.railLoadingUnit; delete legacy.truckLoadingUnit;
  legacy.norms[normKey("ЭКГ-20", "truck", 130)] = ["2", "30"];
  const settings = currentSettings(legacy);
  assert.deepEqual(settings.norms[normKey("ЭКГ-10", "rail")], ["63", "0"]);
  assert.deepEqual(settings.norms[normKey("ЭКГ-20", "truck", 130)], ["2", "5"]);
  assert.equal(getNorm(settings, settings.excavators[0]), getNorm(legacy, legacy.excavators[0]));
  assert.equal(getNorm(settings, settings.excavators[1]), getNorm(legacy, legacy.excavators[1]));
  const rows = defaultRows(legacy); delete rows[0].railLoadingUnit; delete rows[0].truckLoadingUnit; delete rows[1].truckLoadingUnit;
  rows[0].loading[0].time = ["1", "05"]; rows[0].waiting = ["1", "05"]; rows[0].fact = "100";
  rows[1].loading[0].time = ["2", "30"]; rows[1].fact = "100";
  const converted = currentRows(rows);
  assert.deepEqual(converted[0].loading[0].time, ["63", "0"]);
  assert.deepEqual(converted[1].loading[0].time, ["2", "5"]);
  assert.deepEqual(converted[0].waiting, ["1", "05"]);
  assert.equal(weightedLoading(converted, "rail").value, weightedLoading(rows, "rail").value);
  assert.equal(weightedLoading(converted, "truck").value, weightedLoading(rows, "truck").value);
  assert.deepEqual(currentRows(converted), converted);
  assert.deepEqual(rows[0].loading[0].time, ["1", "05"]);
  assert.deepEqual(rows[1].loading[0].time, ["2", "30"]);
  const withoutIndicators = JSON.parse(JSON.stringify(converted));
  delete withoutIndicators[0].loadPercent; delete withoutIndicators[0].oversizePercent;
  assert.equal(currentRows(withoutIndicators)[0].loadPercent, "");
  assert.equal(currentRows(withoutIndicators)[0].oversizePercent, "");
});
test("reason templates append editable text without overwriting prose or duplicating a line", () => {
  const note = "Простой с 10:00 до 11:00";
  const appended = appendReasonText(note, "Аварийный ремонт");
  assert.equal(appended, `${note}\nАварийный ремонт`);
  assert.equal(appendReasonText(appended, "Аварийный ремонт"), appended);
  assert.equal(appendReasonText("", "Аварийный ремонт"), "Аварийный ремонт");
  const row = defaultRows(configuration())[0]; row.reasons = [{ id: "emergency-repair", name: "Аварийный ремонт" }]; row.note = note;
  assert.equal(commentText(row), `Аварийный ремонт\n${note}`);
});
test("paired totals and exclusions do not invent zero or average row percentages", () => {
  const rows = defaultRows(configuration());
  rows[0].plan = "3700"; rows[0].fact = "1500"; rows[0].reasons = [{ id: "emergency-repair", name: "Аварийный ремонт" }];
  assert.equal(rowResult(rows[0]).comment, "Наряд не выполнен");
  assert.ok(Math.abs(rowResult(rows[0]).percent! - 40.54054) < .001);
  rows[1].plan = "100";
  assert.deepEqual(productionTotals(rows), { plan: 3700, fact: 1500, percent: 1500 / 3700 * 100, filled: 1, expected: 2 });
  rows[1].state = "repair"; assert.equal(productionTotals(rows).expected, 1);
  rows[0].state = "no_crew"; assert.equal(productionTotals(rows).percent, null);
  rows[0].state = "working"; rows[0].plan = "0"; rows[0].fact = "50"; assert.equal(rowResult(rows[0]).percent, null);
  rows[0].plan = "10"; assert.equal(rowResult(rows[0]).percent, 500);
  rows[0].fact = ""; assert.equal(rowResult(rows[0]).comment, "");
});
test("truck weights use one filled category only and never duplicate volume", () => {
  const rows = defaultRows(configuration()).filter(r => r.excavator.direction === "truck");
  const row = rows[0]; row.plan = "1000"; row.fact = "900";
  row.loading.push({ truck: 240, time: ["2", "5"], norm: null });
  assert.equal(weightedLoading(rows, "truck").value, 150_000_000);
  row.loading[0].time = ["3", "0"];
  assert.equal(weightedLoading(rows, "truck").value, null);
  assert.equal(weightedLoading(rows, "truck", 240).counted, 0);
  assert.equal(productionTotals(rows).fact, 900);
  row.loading[0].time = ["", ""]; row.loading[1].time = ["0", "0"];
  assert.equal(weightedLoading(rows, "truck").value, 0);
  row.fact = "0"; assert.equal(weightedLoading(rows, "truck").value, null);
});
test("invalid fields return targeted errors, optional data are allowed", () => {
  const rows = defaultRows(configuration()); assert.deepEqual(validateRows(rows), []);
  rows[1].loading[0].time = ["2", "1234567"]; rows[0].plan = "oops";
  assert.ok(validateRows(rows).some(e => e.path === "rows.1.loading.0.time"));
  assert.ok(validateRows(rows).some(e => e.path === "rows.0.plan"));
});
test("last final is independent from last version and MAX result", async t => {
  const { store } = await fixture(t);
  const pre = await store.save(await input(store, "preliminary"), actor);
  assert.equal((await store.finalVersions()).length, 0);
  const request = await input(store); request.rows[0].plan = "3700"; request.rows[0].fact = "1500"; request.rows[0].loadPercent = "106"; request.rows[1].oversizePercent = "1,03";
  const final = await store.save(request, actor);
  assert.equal(final.snapshot.rows[0].loadPercent, "106");
  assert.equal(final.snapshot.rows[1].oversizePercent, "1,03");
  assert.equal(final.correction, false);
  await store.save(await input(store, "preliminary"), actor);
  assert.equal((await store.finalVersions())[0].id, final.id);
  assert.equal((await store.versions(pre.periodKey)).length, 3);
  assert.equal((await store.requestDelivery(final.id, randomUUID(), actor)).status, "not_configured");
  assert.equal((await store.finalVersions())[0].id, final.id);
});
test("idempotency and optimistic concurrency protect saved reports", async t => {
  const { store } = await fixture(t);
  const a = await input(store), stale = await input(store);
  const first = await store.save(a, actor);
  assert.equal((await store.save(a, actor)).id, first.id);
  await assert.rejects(store.save(stale, actor), ConflictError);
  a.rows[0].fact = "1"; await assert.rejects(store.save(a, actor), ConflictError);
  assert.equal((await store.versions(first.periodKey)).length, 1);
});
test("draft conflicts, reset and preliminary save cannot erase the final", async t => {
  const { store } = await fixture(t);
  const saved = await store.save(await input(store), actor);
  const open = await store.open("2026-09-29", "day");
  const draft = { date: "2026-09-29", kind: "day" as const, rows: open.snapshot.rows, latestId: open.latestId, draftRevision: open.draftRevision };
  draft.rows[0].fact = "22";
  const fresh = await store.draft(draft, actor);
  await assert.rejects(store.draft(draft, actor), ConflictError);
  const cleared = await store.draft({ ...draft, draftRevision: fresh.draftRevision, reset: true }, actor);
  assert.equal(cleared.snapshot.rows[0].fact, "");
  await store.save(await input(store, "preliminary"), actor);
  assert.equal((await store.finalVersions())[0].id, saved.id);
  assert.equal((await store.version(saved.id)).snapshot.rows[0].fact, "");
});
test("correction preserves historical catalog and norms; no implicit delivery", async t => {
  const { store, path } = await fixture(t);
  const saved = await store.save(await input(store), actor);
  const changed = await store.settings(); changed.excavators[0].number = "НОВЫЙ"; changed.excavators[0].direction = "truck";
  changed.norms[normKey("ЭКГ-20", "truck", 240)] = ["9", "00"];
  await store.saveSettings(changed, actor);
  const revision = await input(store);
  const corrected = await store.save({ ...revision, sourceId: saved.id, rows: saved.snapshot.rows.map((r, i) => i ? { ...r, loading: [{ truck: 240, time: ["3", "30"], norm: 123 }] } : { ...r, fact: "100" }) }, { ...actor, id: 2, login: "2 смена" });
  assert.equal(corrected.correction, true); assert.equal(corrected.snapshot.rows[0].excavator.number, "ТЕСТ-ЖД");
  assert.equal(corrected.snapshot.rows[1].loading[0].norm, 180_000_000);
  assert.equal((await store.finalVersions())[0].id, corrected.id);
  assert.equal((await store.version(saved.id)).snapshot.rows[0].fact, "");
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  try { const results = await db.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM sp_delivery_requests"); assert.equal(Number(results[0].n), 0); } finally { await db.$disconnect(); }
  assert.ok(versionChanges(saved.snapshot, corrected.snapshot).some(c => c.label.includes("Факт")));
});
test("night history matches both dates including year boundary", async t => {
  const { store } = await fixture(t);
  const o = await store.open("2026-12-31", "night");
  await store.save({ date: "2026-12-31", periodKind: "night", rows: o.snapshot.rows, kind: "final", latestId: null, draftRevision: 0, operation: randomUUID() }, actor);
  assert.equal((await store.history("2026-12-31")).length, 1);
  assert.equal((await store.history("2027-01-01")).length, 1);
  assert.equal((await store.history("2027-01-02")).length, 0);
});
test("dictionary audit, archive protection, roles and concurrent settings", async t => {
  const { store } = await fixture(t);
  const a = await store.settings(), stale = await store.settings(); a.excavators[0].active = false;
  await store.saveSettings(a, actor);
  await assert.rejects(store.saveSettings(stale, actor), ConflictError);
  const current = await store.settings(); current.excavators.pop(); await assert.rejects(store.saveSettings(current, actor), /архивирование/);
  await assert.rejects(store.save(await input(store), { ...actor, role: "storekeeper" }), /доступен/);
  assert.equal((await store.settingsAudit()).length, 2);
});
test("unrelated database is refused without schema changes; reopen retains versions", async t => {
  const path = join(mkdtempSync(join(tmpdir(), "rapmas-unrelated-")), "inventory.db");
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  await db.$executeRawUnsafe("CREATE TABLE important_inventory (id INTEGER PRIMARY KEY)");
  await db.$disconnect(); await assert.rejects(openProductionStore(path), /другой базе/);
  const f = await fixture(t); const version = await f.store.save(await input(f.store), actor);
  await f.store.close(); const reopened = await openProductionStore(f.path); t.after(() => reopened.close());
  assert.equal((await reopened.version(version.id)).number, 1);
});
test("opening and correcting legacy SQLite snapshots leaves stored history untouched", async t => {
  const { store, path } = await fixture(t);
  const saved = await store.save(await input(store), actor);
  const legacy = structuredClone(saved.snapshot);
  delete legacy.rows[0].railLoadingUnit; delete legacy.rows[0].truckLoadingUnit; delete legacy.rows[1].truckLoadingUnit;
  legacy.rows[0].loading[0].time = ["1", "05"]; legacy.rows[0].waiting = ["1", "5"];
  legacy.rows[1].loading[0].time = ["2", "30"];
  const serialized = JSON.stringify(legacy);
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  try {
    await db.$executeRaw`UPDATE sp_versions SET snapshot=${serialized} WHERE id=${saved.id}`;
    await db.$executeRaw`UPDATE sp_drafts SET snapshot=${serialized} WHERE period_key=${saved.periodKey}`;
    const loaded = await store.version(saved.id);
    assert.deepEqual(loaded.snapshot.rows[0].loading[0].time, ["63", "0"]);
    assert.deepEqual(loaded.snapshot.rows[1].loading[0].time, ["2", "5"]);
    assert.deepEqual((await store.open("2026-09-29", "day")).snapshot.rows[0].waiting, ["1", "5"]);
    const request = await input(store); request.rows[0].loading[0].time = ["2", "5"];
    const correction = await store.save({ ...request, sourceId: saved.id }, actor);
    assert.equal(duration(correction.snapshot.rows[0].loading[0].time, "decimalMinutes"), 150_000_000);
    const [raw] = await db.$queryRaw<Array<{ snapshot: string }>>`SELECT snapshot FROM sp_versions WHERE id=${saved.id}`;
    assert.equal(raw.snapshot, serialized);
  } finally { await db.$disconnect(); }
});
