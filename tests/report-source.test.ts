import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { collectShiftReport } from "../lib/shift-report-source";
import { formatShiftReport, latestCompletedShift } from "../lib/shift-report";
import { setAssemblyPower } from "../lib/assembly-power";

const root = resolve("prisma");
const directory = mkdtempSync(join(root, "raport-report-test-"));
const url = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
const db = new PrismaClient({ datasources: { db: { url } } });
const period = latestCompletedShift(new Date("2026-08-30T20:00:00+05:00"));
const at = (minute: number) => new Date(period.start.getTime() + minute * 60000);
before(() => {
  writeFileSync(join(directory, "test.db"), "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(directory)}/test.db` }, stdio: "pipe", encoding: "utf8"
  });
});
after(async () => {
  await db.$disconnect();
  if (dirname(resolve(directory)) !== root || !basename(directory).startsWith("raport-report-test-")) throw new Error("Unsafe test cleanup path");
  rmSync(directory, { recursive: true, force: true });
});

test("real database collector compacts historical chains without reading PPE or leaking raw snapshots, actors or diameters", async () => {
  const user = await db.user.create({ data: { login: "PRIVATE_ACTOR", passwordHash: "PRIVATE_HASH", role: "shift" } });
  const crane = await db.location.create({ data: { name: "Вешала под 30т краном", category: "storage" } });
  const excavator = await db.location.create({ data: { name: "ЭКГ-10 №9", category: "excavator" } });
  const other = await db.location.create({ data: { name: "ЭКГ-10 №4", category: "excavator" } });
  const rope = await db.ropeType.create({ data: { name: "Напор ЭКГ-10", standardLength: 41 } });
  const table = await db.turntable.create({ data: { name: "Вертушка №3", currentLocationId: crane.id } });
  const base = { userId: user.id, ropeTypeId: rope.id, length: 41, diameter: "PRIVATE_DIAMETER", quantity: 1 };
  await db.ropeMovement.createMany({ data: [
    { ...base, action: "ADD", createdAt: at(1), toLocationId: crane.id, toPlacement: "TURNTABLE", toTurntableId: table.id, toStatus: "AVAILABLE" },
    { ...base, action: "MOVE", createdAt: at(2), fromLocationId: crane.id, toLocationId: excavator.id, fromPlacement: "TURNTABLE", toPlacement: "TURNTABLE", fromTurntableId: table.id, toTurntableId: table.id, fromStatus: "AVAILABLE", toStatus: "AVAILABLE" },
    { ...base, action: "INSTALL", createdAt: at(3), fromLocationId: excavator.id, toLocationId: excavator.id, fromPlacement: "TURNTABLE", fromTurntableId: table.id, fromStatus: "AVAILABLE", toStatus: "USED_NEAR_EXCAVATOR", toPlacement: "GROUND" },
    { ...base, action: "WRITE_OFF", createdAt: at(4), fromLocationId: excavator.id, toLocationId: excavator.id, fromStatus: "USED_NEAR_EXCAVATOR", toStatus: "WRITTEN_OFF", fromPlacement: "GROUND", comment: "вывезен из-под экскаватора" },
    { userId: user.id, action: "MOVE_TURNTABLE", quantity: 0, createdAt: at(5), fromLocationId: excavator.id, toLocationId: crane.id, fromTurntableId: table.id, toTurntableId: table.id },
    { userId: user.id, action: "ADD_LOCATION", quantity: 0, createdAt: at(6), toLocationId: crane.id, comment: "DICTIONARY_NOISE" },
    { ...base, action: "INSTALL", createdAt: period.end, toLocationId: other.id, comment: "NEXT_SHIFT" }
  ] });
  const loan = await db.ropeLoan.create({ data: { recipient: "Северный", includesTurntable: true, turntableId: table.id, createdById: user.id } });
  await db.ropeMovement.createMany({ data: [
    { ...base, action: "LOAN", createdAt: at(7), comment: `loan:${loan.id}; Северный`, fromTurntableId: table.id, toTurntableId: table.id },
    { ...base, action: "RETURN_LOAN", createdAt: at(8), comment: `loan:${loan.id}`, toTurntableId: table.id, toLocationId: crane.id, toPlacement: "TURNTABLE" }
  ] });
  const secondTable = await db.turntable.create({ data: { name: "Вертушка №6", currentLocationId: other.id } });
  await db.ropeMovement.createMany({ data: [41, 110].map((length) => ({ ...base, length, action: "MOVE", operationId: "compound-trip", createdAt: at(30), fromLocationId: crane.id, toLocationId: other.id,
    fromPlacement: "TURNTABLE", toPlacement: "TURNTABLE", fromTurntableId: secondTable.id, toTurntableId: secondTable.id, fromStatus: "AVAILABLE", toStatus: "AVAILABLE" })) });

  const tooth = await db.toothType.create({ data: { name: "ЭКГ-10" } });
  const ground = await db.toothBin.create({ data: { name: "Земля под 30т краном", kind: "GROUND", currentLocationId: crane.id } });
  const bin = await db.toothBin.create({ data: { name: "Пена 2", currentLocationId: excavator.id } });
  await db.toothStock.createMany({ data: [
    { binId: bin.id, toothTypeId: tooth.id, condition: "NEW", quantity: 3, lastChangedBy: user.login },
    { binId: bin.id, toothTypeId: tooth.id, condition: "USED", quantity: 5, lastChangedBy: user.login },
    { binId: ground.id, toothTypeId: tooth.id, condition: "NEW", quantity: 0, lastChangedBy: user.login }
  ] });
  const tb = { userId: user.id, binId: bin.id };
  await db.toothMovement.createMany({ data: [
    { ...tb, action: "MOVE", createdAt: at(10), toothTypeId: tooth.id, condition: "NEW", quantity: 5, fromLocationId: crane.id, toLocationId: crane.id },
    { ...tb, action: "MOVE", createdAt: at(11), fromLocationId: crane.id, toLocationId: excavator.id },
    { ...tb, action: "INSTALL", createdAt: at(12), toothTypeId: tooth.id, condition: "NEW", quantity: 5, fromLocationId: excavator.id, toLocationId: excavator.id, excavatorLocationId: excavator.id },
    { ...tb, action: "MOVE", createdAt: new Date(period.end.getTime() + 60000), toothTypeId: tooth.id, condition: "NEW", quantity: 3, fromLocationId: crane.id, toLocationId: excavator.id }
  ] });

  const pp = await db.ppPoint.create({ data: { name: "ПП №3", equipmentLocationId: excavator.id, sectors: { create: [
    { name: "1", quantity: 0, material: "ORE" }, { name: "2", quantity: 0, material: "OVERBURDEN" }, { name: "99", quantity: 99, material: "ORE", isActive: false }
  ] } }, include: { sectors: true } });
  await db.ppPoint.update({ where: { id: pp.id }, data: { unloadingSectorId: pp.sectors.find((sector) => sector.name === "1")!.id } });
  await db.ppPoint.create({ data: { name: "ARCHIVED_PP", isActive: false, equipmentLocationId: other.id } });
  await db.ppPoint.create({ data: { name: "EMPTY_PP" } });
  const item = await db.safetyItem.create({ data: { locationId: excavator.id, category: "PPE", name: "PPE_NOISE", sortOrder: 1 } });
  await db.safetyHistory.create({ data: { itemId: item.id, userId: user.id, createdAt: at(15), oldExpiryDate: null, newExpiryDate: at(15) } });

  const boxes = await Promise.all(["7", "8", "12"].map((number) => db.yaknoBox.create({ data: { number, lastChangedBy: user.login } })));
  const state = (ids: number[], powered: number | null) => JSON.stringify({ boxes: ids.map((id) => ({ id, excavatorLocationId: id === powered ? excavator.id : null, horizonId: null, isPowered: id === powered })), states: [] });
  await db.yaknoMovement.createMany({ data: [
    { userId: user.id, action: "SET_EXCAVATOR", createdAt: at(20), excavatorLocationId: excavator.id, fromText: state([boxes[0].id, boxes[1].id], boxes[0].id), toText: state([boxes[0].id, boxes[1].id], boxes[1].id) },
    { userId: user.id, action: "SET_EXCAVATOR", createdAt: at(21), excavatorLocationId: excavator.id, beforeState: state([boxes[1].id, boxes[2].id], boxes[1].id), afterState: state([boxes[1].id, boxes[2].id], boxes[2].id) }
  ] });
  const assembly = await db.assembly.create({ data: { name: "Сборка №2", lastChangedBy: user.login } });
  await db.assemblyMovement.create({ data: { userId: user.id, assemblyId: assembly.id, action: "POWER", createdAt: at(22), fromPlaceText: "Не запитана", toPlaceText: other.name,
    comment: JSON.stringify({ kind: "assembly-power-v1", before: null, after: { id: other.id, name: other.name } }) } });

  const before = await db.toothStock.findMany();
  const source = await db.$transaction((tx) => collectShiftReport(tx, period));
  const text = formatShiftReport(source).join("\n");
  assert.equal(source.warnings.length, 0);
  for (const forbidden of ["PRIVATE", "DICTIONARY_NOISE", "PPE_NOISE", "ARCHIVED_PP", "EMPTY_PP", "Сектор 99", "погружен", "Пена №2:", "ЯКНО №8", "assembly-power-v1"]) assert(!text.includes(forbidden), forbidden);
  assert.match(text, /Сектор 1: 0Р 🟢/);
  assert.match(text, /Сектор 2: 0В/);
  assert.match(text, /Установлен напорный канат 41 м/);
  assert.equal((text.match(/Установлен напорный/g) ?? []).length, 1);
  assert.match(text, /Вывезен б\/у/);
  assert.match(text, /Вертушка №3 \(пустая\)/);
  assert.match(text, /Установлено 5 зубьев \(Пена №2\)/);
  assert.match(text, /ЯКНО №7 → ЯКНО №12/);
  assert.match(text, /ЭКГ-10 №4\n• Запитан: Сборка №2/);
  assert.match(text, /Выдан в долг \(Северный\)/);
  assert.match(text, /Возвращён из долга \(Северный\)/);
  assert.equal((text.match(/Вертушка №6:/g) ?? []).length, 1);
  assert.match(text, /Вертушка №6: .*41 м, 1 шт.; .*110 м, 1 шт./);
  assert(!text.includes("шт.."));
  assert.deepEqual(await db.toothStock.findMany(), before);
});

test("assembly power audit is transactional, idempotent and preserves prior state on failures", async () => {
  const user = await db.user.findFirstOrThrow();
  const [one, two] = await db.location.findMany({ where: { category: "excavator" }, orderBy: { id: "asc" } });
  const horizon = await db.assemblyHorizon.create({ data: { name: "Test horizon", sortOrder: 1 } });
  const assembly = await db.assembly.create({ data: { name: "Audit assembly", horizonId: horizon.id, lastChangedBy: user.login } });
  const count = () => db.assemblyMovement.count({ where: { assemblyId: assembly.id } });
  await db.$transaction((tx) => setAssemblyPower(tx, assembly.id, one.id, user));
  await db.$transaction((tx) => setAssemblyPower(tx, assembly.id, one.id, user));
  assert.equal(await count(), 1);
  await assert.rejects(db.$transaction(async (tx) => { await setAssemblyPower(tx, assembly.id, two.id, user); throw new Error("rollback"); }));
  assert.equal(await count(), 1);
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: assembly.id } })).excavatorLocationId, one.id);
  await db.$transaction((tx) => setAssemblyPower(tx, assembly.id, two.id, user));
  await db.$transaction((tx) => setAssemblyPower(tx, assembly.id, null, user));
  await db.$transaction((tx) => setAssemblyPower(tx, assembly.id, null, user));
  assert.equal(await count(), 3);
  const rows = await db.assemblyMovement.findMany({ where: { assemblyId: assembly.id }, orderBy: { id: "asc" } });
  assert.deepEqual(JSON.parse(rows[1].comment!), { kind: "assembly-power-v1", before: { id: one.id, name: one.name }, after: { id: two.id, name: two.name } });
  assert.equal(rows[1].fromPlaceText, one.name);
  assert.equal(rows[1].toPlaceText, two.name);
  await db.assembly.update({ where: { id: assembly.id }, data: { status: "REPAIR" } });
  await assert.rejects(db.$transaction((tx) => setAssemblyPower(tx, assembly.id, one.id, user)), /ремонт/);
  assert.equal(await count(), 3);
});
