import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { collectShiftReport } from "../lib/shift-report-source";
import { formatShiftReport } from "../lib/shift-report";
import { createReportCompactionFixture } from "./fixtures/report-compaction";

const root = resolve("prisma");
const directory = mkdtempSync(join(root, "raport-compact-test-"));
const db = new PrismaClient({ datasources: { db: { url: `file:${join(directory, "test.db").replaceAll("\\", "/")}` } } });
const range = (day: number) => ({ start: new Date(`2026-09-${String(day).padStart(2, "0")}T06:30:00+05:00`), end: new Date(`2026-09-${String(day).padStart(2, "0")}T19:30:00+05:00`) });
const period = range(7);
let f: Awaited<ReturnType<typeof createReportCompactionFixture>>;
before(async () => {
  writeFileSync(join(directory, "test.db"), "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(directory)}/test.db` }, stdio: "pipe"
  });
  f = await createReportCompactionFixture(db, period);
});
after(async () => {
  await db.$disconnect();
  if (dirname(resolve(directory)) !== root || !basename(directory).startsWith("raport-compact-test-")) throw new Error("Unsafe cleanup");
  rmSync(directory, { recursive: true, force: true });
});
const read = async (p = period) => {
  const report = await db.$transaction(tx => collectShiftReport(tx, p));
  return formatShiftReport({ ...report, capturedAt: p.end }).join("\n");
};
const inventory = async () => ({ assemblies: await db.assembly.findMany(), boxes: await db.yaknoBox.findMany(),
  assemblyHistory: await db.assemblyMovement.findMany(), yaknoHistory: await db.yaknoMovement.findMany() });
const snapshot = (boxes: unknown[] = [], states: unknown[] = []) => JSON.stringify({ boxes, states });

test("screenshot history becomes five meaningful lines, without changing stored history or current inventory", async () => {
  const before = await inventory();
  const body = await read();
  assert.equal(body.split("\n").filter(line => line.startsWith("• ")).length, 5, body);
  for (const line of ["Запитан: ЯКНО №28.", "Запитан: Сборка №3.", "Сборка №2: Ремонт.", "Сборка №4: гор. +280м.", "ЯКНО №32: ЭКГ-10 №10 → гор. не указан."]) assert(body.includes(line), line);
  for (const absent of ["длина", "220", "+355", "+130", "Горизонт Горизонт", "не запитано", "ЯКНО №28:"]) assert(!body.includes(absent), absent);
  assert.deepEqual(await inventory(), before);
});

test("excavator horizons and free Yakno locations reduce independently using initial and final values", async () => {
  const p = range(8);
  let i = 0;
  for (const [a, b] of [[null, f.h355.id], [f.h355.id, null], [null, f.h280.id]]) {
    await db.yaknoMovement.create({ data: { userId: f.user.id, action: "SET_EXCAVATOR", createdAt: new Date(p.start.getTime() + i++),
      beforeState: snapshot([], [{ excavatorLocationId: f.exc9.id, horizonId: a }]), afterState: snapshot([], [{ excavatorLocationId: f.exc9.id, horizonId: b }]) } });
  }
  for (const [a, b] of [[f.h130.id, f.h355.id], [f.h355.id, f.h130.id]]) {
    await db.yaknoMovement.create({ data: { userId: f.user.id, action: "FREE_HORIZON", boxId: f.box32.id, createdAt: new Date(p.start.getTime() + i++), fromHorizonId: a, toHorizonId: b } });
  }
  const body = await read(p);
  assert(body.includes("ЭКГ-10 №9\n• гор. +280м."));
  assert(!body.includes("ЯКНО №32") && !body.includes("+355") && !body.includes("+130"));
});

test("Yakno repair cycles collapse while a real final repair remains", async () => {
  const p = range(9);
  const state = (id: number, status: string) => ({ id, horizonId: f.h130.id, excavatorLocationId: null, isPowered: false, status });
  let i = 0;
  for (const [box, actions] of [[f.box28, ["REPAIR", "RESTORE"]], [f.box32, ["REPAIR", "RESTORE", "REPAIR"]]] as const) {
    let status = "ACTIVE";
    for (const action of actions) {
      const next = action === "REPAIR" ? "REPAIR" : "ACTIVE";
      await db.yaknoMovement.create({ data: { userId: f.user.id, action, boxId: box.id, createdAt: new Date(p.start.getTime() + i++),
        beforeState: snapshot([state(box.id, status)]), afterState: snapshot([state(box.id, next)]) } });
      status = next;
    }
  }
  const body = await read(p);
  assert(!body.includes("ЯКНО №28"));
  assert.equal((body.match(/ЯКНО №32:/g) ?? []).length, 1);
  assert(body.includes("ЯКНО №32: гор. +130м → Ремонт."));
});

test("assembly connection updates the final horizon of an earlier move without conflating power sources", async () => {
  const p = range(10);
  await db.assemblyMovement.create({ data: { userId: f.user.id, assemblyId: f.assembly4.id, action: "MOVE", createdAt: p.start,
    fromHorizonId: f.h130.id, fromPlaceText: f.h130.name, toHorizonId: f.h280.id, toPlaceText: f.h280.name } });
  await db.assemblyMovement.create({ data: { userId: f.user.id, assemblyId: f.assembly4.id, action: "POWER", createdAt: new Date(p.start.getTime() + 1),
    comment: JSON.stringify({ kind: "assembly-power-v1", before: null, after: { id: f.exc9.id, name: f.exc9.name }, horizonBefore: f.h280.id, horizonAfter: f.h355.id }) } });
  const body = await read(p);
  assert(body.includes("Сборка №4: гор. +130м → гор. +355м."));
  assert(body.includes("Запитан: Сборка №4."));
  assert(!body.includes("+280") && !body.includes("ЯКНО"));
});

test("loan and return keep separate work events and split ordinary assembly movement chains", async () => {
  const p = range(11);
  const base = { userId: f.user.id, assemblyId: f.assembly4.id };
  for (const [i, data] of [
    { action: "MOVE", fromHorizonId: f.h130.id, fromPlaceText: f.h130.name, toHorizonId: f.h280.id, toPlaceText: f.h280.name },
    { action: "LOAN", fromHorizonId: f.h280.id, fromPlaceText: f.h280.name, toPlaceText: "Северный", newLength: 150 },
    { action: "RETURN_LOAN", fromPlaceText: "Северный", toHorizonId: f.h130.id, toPlaceText: f.h130.name, newLength: 150 },
    { action: "MOVE", fromHorizonId: f.h130.id, fromPlaceText: f.h130.name, toHorizonId: f.h280.id, toPlaceText: f.h280.name }
  ].map((data, i) => [i, data] as const)) await db.assemblyMovement.create({ data: { ...base, ...data, createdAt: new Date(p.start.getTime() + i) } });
  const body = await read(p);
  assert.equal((body.match(/Сборка №4: гор. \+130м → гор. \+280м./g) ?? []).length, 2);
  assert(body.includes("выдана в долг (Северный)") && body.includes("возвращена из долга (Северный)"));
});

test("state compaction never crosses the report boundary", async () => {
  const p = range(12), next = { start: p.end, end: new Date("2026-09-13T06:30:00+05:00") };
  for (const [createdAt, a, b] of [[p.start, f.h130, f.h280], [p.end, f.h280, f.h130]] as const) {
    await db.assemblyMovement.create({ data: { userId: f.user.id, assemblyId: f.assembly4.id, action: "MOVE", createdAt,
      fromHorizonId: a.id, toHorizonId: b.id, fromPlaceText: a.name, toPlaceText: b.name } });
  }
  assert((await read(p)).includes("Сборка №4: гор. +130м → гор. +280м."));
  assert((await read(next)).includes("Сборка №4: гор. +280м → гор. +130м."));
});

test("older snapshots without horizon fields still use audit columns and ignore captured unrelated excavator states", async () => {
  const p = range(13);
  const box = { id: f.box32.id, excavatorLocationId: null, isPowered: false };
  await db.yaknoMovement.create({ data: { userId: f.user.id, action: "FREE_HORIZON", boxId: f.box32.id,
    createdAt: p.start, fromHorizonId: f.h130.id, toHorizonId: f.h280.id,
    beforeState: snapshot([box], [{ excavatorLocationId: f.exc9.id, horizonId: f.h130.id }]),
    afterState: snapshot([box], [{ excavatorLocationId: f.exc9.id, horizonId: f.h355.id }]) } });
  const body = await read(p);
  assert(body.includes("ЯКНО №32: гор. +130м → гор. +280м."));
  assert(!body.includes("ЭКГ-10 №9") && !body.includes("+355"));
});
