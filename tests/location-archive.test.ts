import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { archiveLocation, archivePreview, assertAfterArchive, locationInventory, moveGroundTeeth, restoreLocation } from "../lib/location-archive";
import { canManageLocationArchive } from "../lib/permissions";
import { syncSafetyItems } from "../lib/safety";

const root = resolve("prisma");
const directory = mkdtempSync(join(root, "raport-archive-"));
const db = new PrismaClient({ datasources: { db: { url: `file:${join(directory, "test.db").replaceAll("\\", "/")}` } } });
before(() => {
  writeFileSync(join(directory, "test.db"), "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: `file:./${basename(directory)}/test.db` }, stdio: "pipe" });
});
after(async () => {
  await db.$disconnect();
  if (dirname(resolve(directory)) !== root || !basename(directory).startsWith("raport-archive-")) throw new Error("Unsafe cleanup");
  rmSync(directory, { recursive: true, force: true });
});
let counter = 0;
async function fixture() {
  const n = ++counter;
  const actor = await db.user.create({ data: { login: `archive-${n}`, passwordHash: "unused", role: "shift" } });
  const crane = await db.location.upsert({ where: { name: "Вешала под 30т краном" }, update: {}, create: { name: "Вешала под 30т краном", category: "storage" } });
  const excavator = await db.location.create({ data: { name: `Archive excavator ${n}`, category: "excavator" } });
  const warehouse = await db.location.create({ data: { name: `Warehouse ${n}`, category: "storage" } });
  const type = await db.ropeType.create({ data: { name: `Rope ${n}`, standardLength: 41 } });
  const toothType = await db.toothType.create({ data: { name: `Tooth ${n}` } });
  const table = await db.turntable.create({ data: { name: `Table ${n}`, currentLocationId: excavator.id } });
  const stock = (placement: string, status: string, quantity: number, turntableId: number | null = null) => db.ropeStock.create({ data: { ropeTypeId: type.id, diameter: "45", length: 41, locationId: excavator.id, placement, status, quantity, turntableId, lastChangedBy: actor.login } });
  const installed = await stock("INSTALLED", "INSTALLED", 2);
  const loaded = await stock("TURNTABLE", "AVAILABLE", 2, table.id);
  const used = await stock("GROUND", "USED_NEAR_EXCAVATOR", 2);
  const fresh = await stock("GROUND", "AVAILABLE", 3);
  const loan = await db.ropeLoan.create({ data: { createdById: actor.id } });
  const loanStock = await db.ropeStock.create({ data: { ropeTypeId: type.id, diameter: "45", length: 41, locationId: excavator.id, placement: "LOAN", status: "ON_LOAN", quantity: 1, loanId: loan.id, lastChangedBy: actor.login } });
  const bin = await db.toothBin.create({ data: { name: `Bin ${n}`, currentLocationId: excavator.id, stocks: { create: [{ toothTypeId: toothType.id, condition: "NEW", quantity: 4, lastChangedBy: actor.login }, { toothTypeId: toothType.id, condition: "USED", quantity: 5, lastChangedBy: actor.login }] } } });
  const ground = await db.toothBin.create({ data: { name: `Ground ${n}`, kind: "GROUND", currentLocationId: excavator.id, stocks: { create: [{ toothTypeId: toothType.id, condition: "NEW", quantity: 3, lastChangedBy: actor.login }, { toothTypeId: toothType.id, condition: "USED", quantity: 5, lastChangedBy: actor.login }] } } });
  const horizon = await db.assemblyHorizon.create({ data: { name: `Horizon ${n}`, sortOrder: n } });
  await db.yaknoExcavatorState.create({ data: { excavatorLocationId: excavator.id, horizonId: horizon.id } });
  const yakno = await db.yaknoBox.create({ data: { number: `Archive-${n}`, excavatorLocationId: excavator.id, isPowered: true } });
  const assembly = await db.assembly.create({ data: { name: `Assembly ${n}`, horizonId: horizon.id, excavatorLocationId: excavator.id, isPowered: true } });
  const pp = await db.ppPoint.create({ data: { name: `PP ${n}`, equipmentLocationId: excavator.id, sectors: { create: { name: "1", quantity: 22 } } }, include: { sectors: true } });
  await db.ppPoint.update({ where: { id: pp.id }, data: { unloadingSectorId: pp.sectors[0].id } });
  const ppe = await db.safetyItem.create({ data: { locationId: excavator.id, category: "PPE", name: "Д/эл боты", sortOrder: 30, expiryDate: new Date("2030-02-03T12:00:00Z") } });
  const history = await db.ropeMovement.create({ data: { userId: actor.id, action: "ADD", quantity: 5, ropeTypeId: type.id, toLocationId: excavator.id } });
  const safetyHistory = await db.safetyHistory.create({ data: { itemId: ppe.id, userId: actor.id, oldExpiryDate: null, newExpiryDate: ppe.expiryDate } });
  return { actor, crane, excavator, warehouse, table, installed, loaded, used, fresh, bin, ground, horizon, yakno, assembly, pp, ppe, history, safetyHistory, toothType, loanStock };
}
async function preview(id: number) { return db.$transaction(async (tx) => archivePreview(await locationInventory(tx, id))); }

test("archive preserves installed ropes, PPE, history and loans; restoration does not bring relocated property back", async () => {
  const f = await fixture();
  const p = await preview(f.excavator.id);
  assert.equal(p.ropeCount, 5); assert.equal(p.toothCount, 8); assert.equal(p.blocked, null);
  await db.$transaction((tx) => archiveLocation(tx, f.excavator.id, p.token, null, null, f.actor));
  assert.equal((await db.location.findUniqueOrThrow({ where: { id: f.excavator.id } })).isActive, false);
  for (const stock of [f.installed, f.used, f.fresh, f.loanStock]) assert.deepEqual(await db.ropeStock.findUnique({ where: { id: stock.id } }), stock);
  assert.equal((await db.ropeStock.findUniqueOrThrow({ where: { id: f.loaded.id } })).locationId, f.crane.id);
  assert.equal((await db.turntable.findUniqueOrThrow({ where: { id: f.table.id } })).currentLocationId, f.crane.id);
  assert.equal((await db.toothBin.findUniqueOrThrow({ where: { id: f.bin.id } })).currentLocationId, f.crane.id);
  assert.equal((await db.toothStock.aggregate({ where: { binId: f.bin.id }, _sum: { quantity: true } }))._sum.quantity, 9);
  const box = await db.yaknoBox.findUniqueOrThrow({ where: { id: f.yakno.id } });
  assert.equal(box.excavatorLocationId, null); assert.equal(box.isPowered, false); assert.equal(box.horizonId, f.horizon.id);
  const assembly = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  assert.equal(assembly.excavatorLocationId, null); assert.equal(assembly.isPowered, false); assert.equal(assembly.horizonId, f.horizon.id);
  const pp = await db.ppPoint.findUniqueOrThrow({ where: { id: f.pp.id } });
  assert.equal(pp.equipmentLocationId, null); assert.equal(pp.unloadingSectorId, f.pp.sectors[0].id);
  assert.deepEqual(await db.ppSector.findMany({ where: { ppPointId: pp.id } }), f.pp.sectors);
  assert.deepEqual(await db.safetyItem.findUnique({ where: { id: f.ppe.id } }), f.ppe);
  assert.deepEqual(await db.safetyHistory.findUnique({ where: { id: f.safetyHistory.id } }), f.safetyHistory);
  assert.deepEqual(await db.ropeMovement.findUnique({ where: { id: f.history.id } }), f.history);
  await assert.rejects(db.$transaction((tx) => assertAfterArchive(tx, f.history.createdAt)), /архив/);
  await db.$transaction((tx) => restoreLocation(tx, f.excavator.id, f.actor));
  await syncSafetyItems(db);
  assert.equal((await db.location.findUniqueOrThrow({ where: { id: f.excavator.id } })).isActive, true);
  assert.deepEqual(await db.safetyItem.findUnique({ where: { id: f.ppe.id } }), f.ppe);
  assert.equal((await db.turntable.findUniqueOrThrow({ where: { id: f.table.id } })).currentLocationId, f.crane.id);
  assert.equal((await db.yaknoBox.findUniqueOrThrow({ where: { id: f.yakno.id } })).excavatorLocationId, null);
  assert.equal(await db.ropeMovement.count({ where: { action: "ARCHIVE_LOCATION", userId: f.actor.id } }), 1);
  assert.equal(await db.toothMovement.count({ where: { action: "ARCHIVE_TRANSFER", userId: f.actor.id } }), 1);
  assert.equal(await db.yaknoMovement.count({ where: { action: "ARCHIVE_DETACH", userId: f.actor.id } }), 1);
});

test("separate destinations preserve quantities and used teeth are not scrapped when moved to crane", async () => {
  const f = await fixture();
  const before = await db.toothStock.aggregate({ _sum: { quantity: true } });
  const p = await preview(f.excavator.id);
  await db.$transaction((tx) => archiveLocation(tx, f.excavator.id, p.token, f.warehouse.id, f.crane.id, f.actor));
  assert.equal((await db.ropeStock.findUniqueOrThrow({ where: { id: f.used.id } })).locationId, f.warehouse.id);
  assert.equal((await db.ropeStock.findUniqueOrThrow({ where: { id: f.used.id } })).status, "USED_NEAR_EXCAVATOR");
  const target = await db.toothBin.findFirstOrThrow({ where: { currentLocationId: f.crane.id, kind: "GROUND" } });
  assert.equal((await db.toothStock.findUniqueOrThrow({ where: { binId_toothTypeId_condition: { binId: target.id, toothTypeId: f.toothType.id, condition: "USED" } } })).quantity, 5);
  assert.deepEqual(await db.toothStock.aggregate({ _sum: { quantity: true } }), before);
  assert.equal(await db.toothMovement.count({ where: { userId: f.actor.id, action: "SCRAP" } }), 0);
});

test("occupied places/main crane protected; stale preview and failures cannot partially archive", async () => {
  const f = await fixture();
  let p = await preview(f.excavator.id);
  await db.ropeStock.update({ where: { id: f.fresh.id }, data: { quantity: 4 } });
  await assert.rejects(db.$transaction((tx) => archiveLocation(tx, f.excavator.id, p.token, null, null, f.actor)), /изменилось/);
  p = await preview(f.excavator.id);
  await assert.rejects(db.$transaction(async (tx) => { await archiveLocation(tx, f.excavator.id, p.token, null, null, f.actor); throw new Error("rollback probe"); }), /rollback probe/);
  assert.equal((await db.location.findUniqueOrThrow({ where: { id: f.excavator.id } })).isActive, true);
  assert.equal((await db.turntable.findUniqueOrThrow({ where: { id: f.table.id } })).currentLocationId, f.excavator.id);
  assert.equal(await db.ropeMovement.count({ where: { userId: f.actor.id, action: "ARCHIVE_LOCATION" } }), 0);
  await db.turntable.update({ where: { id: f.table.id }, data: { currentLocationId: f.warehouse.id } });
  assert.match((await preview(f.warehouse.id)).blocked!, /переместите/);
  assert.match((await preview(f.crane.id)).blocked!, /краном/);
  await db.turntable.update({ where: { id: f.table.id }, data: { currentLocationId: f.excavator.id } });
  p = await preview(f.warehouse.id);
  await db.$transaction((tx) => archiveLocation(tx, f.warehouse.id, p.token, null, null, f.actor));
  await db.$transaction((tx) => restoreLocation(tx, f.warehouse.id, f.actor));
});

test("ground left behind can be moved later without deleting archived location/history", async () => {
  const f = await fixture();
  const p = await preview(f.excavator.id);
  await db.$transaction((tx) => archiveLocation(tx, f.excavator.id, p.token, f.crane.id, null, f.actor));
  for (const [condition, quantity] of [["NEW", 3], ["USED", 5]] as const) await db.$transaction((tx) => moveGroundTeeth(tx, f.ground.id, f.toothType.id, condition, quantity, f.warehouse.id, f.actor));
  assert.equal((await db.toothStock.aggregate({ where: { binId: f.ground.id }, _sum: { quantity: true } }))._sum.quantity, 0);
  assert.equal((await db.location.findUniqueOrThrow({ where: { id: f.excavator.id } })).isActive, false);
  assert.deepEqual(await db.ropeMovement.findUnique({ where: { id: f.history.id } }), f.history);
});

test("master has scoped archive permissions", () => {
  for (const role of ["shift", "storekeeper", "admin"]) assert.equal(canManageLocationArchive(role), true);
  for (const role of ["boss", "unknown", ""]) assert.equal(canManageLocationArchive(role), false);
});
