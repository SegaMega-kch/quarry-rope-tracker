import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { archiveRopeType, setUnloadingSector } from "../lib/management";

const testRoot = resolve("prisma");
const directory = mkdtempSync(join(testRoot, "raport-management-"));
const url = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
const db = new PrismaClient({ datasources: { db: { url } } });
before(() => {
  writeFileSync(join(directory, "test.db"), "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(directory)}/test.db` }, stdio: "pipe", encoding: "utf8"
  });
});
after(async () => {
  await db.$disconnect();
  if (dirname(resolve(directory)) !== testRoot || !basename(directory).startsWith("raport-management-")) throw new Error("Unsafe test cleanup path");
  rmSync(directory, { recursive: true, force: true });
});

test("a point has zero or one unloading sector, without movement history", async () => {
  const point = await db.ppPoint.create({ data: { name: "Test point", sectors: { create: [{ name: "1" }, { name: "2" }] } }, include: { sectors: true } });
  const other = await db.ppPoint.create({ data: { name: "Other point", sectors: { create: [{ name: "1" }] } }, include: { sectors: true } });
  const [first, second] = point.sectors;
  await db.$transaction((tx) => setUnloadingSector(tx, first.id, true));
  await db.$transaction((tx) => setUnloadingSector(tx, second.id, true));
  await db.$transaction((tx) => setUnloadingSector(tx, other.sectors[0].id, true));
  assert.equal((await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } })).unloadingSectorId, second.id);
  await db.$transaction((tx) => setUnloadingSector(tx, first.id, false));
  assert.equal((await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } })).unloadingSectorId, second.id);
  await db.$transaction((tx) => setUnloadingSector(tx, second.id, false));
  const after = await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } });
  assert.equal(after.unloadingSectorId, null);
  assert.equal(after.lastChangedAt.toISOString(), point.lastChangedAt.toISOString());
  assert.equal((await db.ppPoint.findUniqueOrThrow({ where: { id: other.id } })).unloadingSectorId, other.sectors[0].id);
  assert.equal(await db.ppMovement.count(), 0);
  assert.deepEqual(await db.ppSector.findMany({ where: { ppPointId: point.id }, orderBy: { id: "asc" } }), point.sectors);
  await db.ppSector.update({ where: { id: first.id }, data: { isActive: false } });
  await assert.rejects(db.$transaction((tx) => setUnloadingSector(tx, first.id, true)), /Сектор/);
  await db.ppPoint.update({ where: { id: point.id }, data: { isActive: false } });
  await assert.rejects(db.$transaction((tx) => setUnloadingSector(tx, second.id, true)), /Сектор/);
});

test("rope type removal protects every live stock including loans and preserves history", async () => {
  const type = await db.ropeType.create({ data: { name: "Test rope", standardLength: 41 } });
  const location = await db.location.create({ data: { name: "Test excavator", category: "excavator" } });
  const user = await db.user.create({ data: { login: "test", passwordHash: "unused", role: "shift" } });
  const movement = await db.ropeMovement.create({ data: { userId: user.id, action: "ADD", ropeTypeId: type.id, quantity: 1 } });
  const stock = await db.ropeStock.create({ data: { ropeTypeId: type.id, locationId: location.id, quantity: 1, status: "NEW", placement: "GROUND", length: 41, diameter: "45", lastChangedBy: "test" } });
  for (const status of ["NEW", "USED", "INSTALLED", "ON_LOAN"]) {
    await db.ropeStock.update({ where: { id: stock.id }, data: { status } });
    await assert.rejects(db.$transaction((tx) => archiveRopeType(tx, type.id)), /учёте/);
    assert.equal((await db.ropeType.findUniqueOrThrow({ where: { id: type.id } })).isActive, true);
  }
  await db.ropeStock.update({ where: { id: stock.id }, data: { status: "WRITTEN_OFF" } });
  await db.$transaction((tx) => archiveRopeType(tx, type.id));
  assert.equal((await db.ropeType.findUniqueOrThrow({ where: { id: type.id } })).isActive, false);
  assert.deepEqual(await db.ropeMovement.findUnique({ where: { id: movement.id } }), movement);
  assert.equal(await db.ropeStock.count(), 1);
});
