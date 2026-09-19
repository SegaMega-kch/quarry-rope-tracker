import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { setAssemblyPower } from "../lib/assembly-power";
import { moveFreeYakno, setYaknoPower, undoYaknoSnapshot, yaknoSnapshot, restoreYaknoSnapshot, assertYaknoUndoCurrent, type YaknoSnapshot } from "../lib/yakno-power";
import { collectShiftReport } from "../lib/shift-report-source";

const root = resolve("prisma");
const dir = mkdtempSync(join(root, "raport-power-test-"));
const db = new PrismaClient({ datasources: { db: { url: `file:${join(dir, "test.db").replaceAll("\\", "/")}` } } });
before(() => {
  writeFileSync(join(dir, "test.db"), "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(dir)}/test.db` }, stdio: "pipe"
  });
});
after(async () => {
  await db.$disconnect();
  if (dirname(resolve(dir)) !== root || !basename(dir).startsWith("raport-power-test-")) throw new Error("Unsafe cleanup");
  rmSync(dir, { recursive: true, force: true });
});
let index = 0;
async function fixture() {
  const key = ++index;
  const user = await db.user.create({ data: { login: `worker-${key}`, passwordHash: "test", role: "shift" } });
  const one = await db.location.create({ data: { name: `Excavator-${key}-1`, category: "excavator" } });
  const two = await db.location.create({ data: { name: `Excavator-${key}-2`, category: "excavator" } });
  const low = await db.assemblyHorizon.create({ data: { name: `Low-${key}`, sortOrder: key } });
  const high = await db.assemblyHorizon.create({ data: { name: `High-${key}`, sortOrder: key + 100 } });
  await db.yaknoExcavatorState.create({ data: { excavatorLocationId: one.id, horizonId: high.id } });
  await db.yaknoExcavatorState.create({ data: { excavatorLocationId: two.id, horizonId: low.id } });
  const box = await db.yaknoBox.create({ data: { number: `free-${key}`, horizonId: low.id, excavatorLocationId: two.id } });
  const assembly = await db.assembly.create({ data: { name: `Assembly-${key}`, horizonId: low.id } });
  const input = { excavatorLocationId: one.id, horizonId: high.id, poweredBoxId: box.id,
    expectedPoweredBoxId: null as number | null, expectedHorizonId: high.id, comment: "" };
  return { user, one, two, low, high, box, assembly, input };
}

test("legacy unpowered Yakno moves across horizons; assembly power and unpower leave every Yakno value unchanged", async () => {
  const f = await fixture();
  await db.$transaction((tx) => setYaknoPower(tx, f.input, f.user));
  const box = await db.yaknoBox.findUniqueOrThrow({ where: { id: f.box.id } });
  assert.equal(box.horizonId, f.high.id);
  assert.equal(box.excavatorLocationId, f.one.id);
  assert.equal(box.isPowered, true);
  const before = { boxes: await db.yaknoBox.findMany(), states: await db.yaknoExcavatorState.findMany(), history: await db.yaknoMovement.findMany() };
  await db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, f.one.id, f.user));
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } })).horizonId, f.high.id);
  await db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, null, f.user));
  assert.deepEqual({ boxes: await db.yaknoBox.findMany(), states: await db.yaknoExcavatorState.findMany(), history: await db.yaknoMovement.findMany() }, before);
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } })).horizonId, f.high.id);
});

test("occupied, repaired and archived Yakno are rejected; stale selection cannot steal a connection", async () => {
  const f = await fixture();
  await db.$transaction((tx) => setYaknoPower(tx, f.input, f.user));
  await assert.rejects(db.$transaction((tx) => setYaknoPower(tx, { ...f.input, excavatorLocationId: f.two.id, horizonId: f.low.id, expectedHorizonId: f.low.id }, f.user)), /уже запитан/);
  await assert.rejects(db.$transaction((tx) => setYaknoPower(tx, { ...f.input, poweredBoxId: null }, f.user)), /уже изменены/);
  for (const state of [{ isActive: false }, { isActive: true, status: "REPAIR" }]) {
    const other = await db.yaknoBox.create({ data: { number: `blocked-${f.user.id}-${state.isActive}`, ...state } });
    await assert.rejects(db.$transaction((tx) => setYaknoPower(tx, { ...f.input, poweredBoxId: other.id, expectedPoweredBoxId: f.box.id }, f.user)), /недоступен/);
  }
});

test("Yakno replacement leaves old box and unrelated legacy boxes on their horizons; assembly stays connected", async () => {
  const f = await fixture();
  await db.$transaction((tx) => setYaknoPower(tx, f.input, f.user));
  await db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, f.one.id, f.user));
  const assembly = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  const spare = await db.yaknoBox.create({ data: { number: `legacy-${f.user.id}`, horizonId: f.high.id, excavatorLocationId: f.one.id } });
  const next = await db.yaknoBox.create({ data: { number: `next-${f.user.id}`, horizonId: f.low.id } });
  await db.$transaction((tx) => setYaknoPower(tx, { ...f.input, poweredBoxId: next.id, expectedPoweredBoxId: f.box.id, horizonId: f.low.id }, f.user));
  const old = await db.yaknoBox.findUniqueOrThrow({ where: { id: f.box.id } });
  assert.equal(old.horizonId, f.high.id); assert.equal(old.isPowered, false);
  assert.deepEqual(await db.yaknoBox.findUnique({ where: { id: spare.id } }), spare);
  assert.deepEqual(await db.assembly.findUnique({ where: { id: assembly.id } }), assembly);
});

test("connection plus move and history roll back together; undo refuses later changes", async () => {
  const f = await fixture();
  const before = await db.$transaction((tx) => yaknoSnapshot(tx, [f.box.id], [f.one.id]));
  await assert.rejects(db.$transaction(async (tx) => { await setYaknoPower(tx, f.input, f.user); throw new Error("rollback"); }));
  assert.deepEqual(await db.$transaction((tx) => yaknoSnapshot(tx, [f.box.id], [f.one.id])), before);
  await db.$transaction((tx) => setYaknoPower(tx, f.input, f.user));
  const history = await db.yaknoMovement.findFirstOrThrow({ where: { userId: f.user.id } });
  const a = JSON.parse(history.beforeState!) as YaknoSnapshot, b = JSON.parse(history.afterState!) as YaknoSnapshot;
  await db.$transaction(async (tx) => { await assertYaknoUndoCurrent(tx, a, b); await restoreYaknoSnapshot(tx, a, f.user.login); });
  assert.deepEqual(await db.$transaction((tx) => yaknoSnapshot(tx, [f.box.id], [f.one.id])), before);
  await assert.rejects(db.$transaction((tx) => assertYaknoUndoCurrent(tx, a, b)), /изменились/);
});

test("new report windows include the start and exclude the end exactly", async () => {
  const f = await fixture();
  const period = { start: new Date("2026-09-19T20:00:00+05:00"), end: new Date("2026-09-20T06:30:00+05:00") };
  for (const createdAt of [period.start, period.end]) await db.assemblyMovement.create({ data: {
    userId: f.user.id, assemblyId: f.assembly.id, action: "MOVE", fromPlaceText: "Горизонт +100", toPlaceText: "Ремонт", createdAt
  } });
  const report = await db.$transaction((tx) => collectShiftReport(tx, period));
  assert.equal(report.events.filter((event) => event.kind === "work" && event.group.key === "assemblies").length, 1);
  const currentMove = report.events.find((event) => event.kind === "work" && event.group.key === "assemblies")!;
  assert.equal(currentMove.at.getTime(), period.start.getTime());
  const next = await db.$transaction((tx) => collectShiftReport(tx, { start: period.end, end: new Date("2026-09-20T19:30:00+05:00") }));
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].at.getTime(), period.end.getTime());
  assert.notEqual(next.events[0].id, currentMove.id);
});

test("stale assembly disconnect cannot disconnect a later connection", async () => {
  const f = await fixture();
  await db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, f.one.id, f.user));
  await db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, null, f.user));
  await db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, f.two.id, f.user));
  await assert.rejects(db.$transaction((tx) => setAssemblyPower(tx, f.assembly.id, null, f.user, undefined, f.one.id)), /уже изменено/);
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } })).excavatorLocationId, f.two.id);
});

test("concurrent requests cannot assign one Yakno to two excavators", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    db.$transaction((tx) => setYaknoPower(tx, f.input, f.user), { maxWait: 10000, timeout: 20000 }),
    db.$transaction((tx) => setYaknoPower(tx, { ...f.input, excavatorLocationId: f.two.id, horizonId: f.low.id, expectedHorizonId: f.low.id }, f.user), { maxWait: 10000, timeout: 20000 })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await db.yaknoMovement.count({ where: { userId: f.user.id } }), 1);
  assert.equal((await db.yaknoBox.findUniqueOrThrow({ where: { id: f.box.id } })).isPowered, true);
});

test("moving free Yakno records one movement, leaves excavators and assemblies untouched, and rejects a stale form", async () => {
  const f = await fixture();
  const states = await db.yaknoExcavatorState.findMany();
  const assemblies = await db.assembly.findMany();
  const input = { boxId: f.box.id, horizonId: f.high.id, expectedHorizonId: f.low.id };
  await db.$transaction((tx) => moveFreeYakno(tx, input, f.user));
  const moved = await db.yaknoBox.findUniqueOrThrow({ where: { id: f.box.id } });
  assert.equal(moved.horizonId, f.high.id); assert.equal(moved.isPowered, false); assert.equal(moved.excavatorLocationId, null);
  assert.deepEqual(await db.yaknoExcavatorState.findMany(), states);
  assert.deepEqual(await db.assembly.findMany(), assemblies);
  await assert.rejects(db.$transaction((tx) => moveFreeYakno(tx, { ...input, horizonId: null }, f.user)), /уже перемещён/);
  await db.$transaction((tx) => moveFreeYakno(tx, { ...input, expectedHorizonId: f.high.id }, f.user));
  assert.equal(await db.yaknoMovement.count({ where: { userId: f.user.id } }), 1);
  const history = await db.yaknoMovement.findFirstOrThrow({ where: { userId: f.user.id } });
  assert.equal(history.action, "FREE_HORIZON"); assert.equal(history.fromHorizonId, f.low.id); assert.equal(history.toHorizonId, f.high.id);
});

test("free movement cannot move powered, repaired or archived boxes or use an invalid horizon", async () => {
  const f = await fixture();
  const input = { boxId: f.box.id, horizonId: f.high.id, expectedHorizonId: f.low.id };
  for (const data of [{ isPowered: true }, { isPowered: false, status: "REPAIR" }, { status: "ACTIVE", isActive: false }]) {
    await db.yaknoBox.update({ where: { id: f.box.id }, data });
    await assert.rejects(db.$transaction((tx) => moveFreeYakno(tx, input, f.user)));
  }
  await db.yaknoBox.update({ where: { id: f.box.id }, data: { isActive: true } });
  await assert.rejects(db.$transaction((tx) => moveFreeYakno(tx, { ...input, horizonId: -1 }, f.user)), /Горизонт не найден/);
  assert.equal(await db.yaknoMovement.count({ where: { userId: f.user.id } }), 0);
});

test("undo of free movement restores the box but never rewrites a later excavator horizon", async () => {
  const f = await fixture();
  await db.$transaction((tx) => moveFreeYakno(tx, { boxId: f.box.id, horizonId: f.high.id, expectedHorizonId: f.low.id }, f.user));
  const history = await db.yaknoMovement.findFirstOrThrow({ where: { userId: f.user.id } });
  const a = JSON.parse(history.beforeState!) as YaknoSnapshot, b = JSON.parse(history.afterState!) as YaknoSnapshot;
  assert.deepEqual(a.states, []); assert.deepEqual(b.states, []);
  await db.yaknoExcavatorState.update({ where: { excavatorLocationId: f.two.id }, data: { horizonId: f.high.id } });
  const state = await db.yaknoExcavatorState.findUniqueOrThrow({ where: { excavatorLocationId: f.two.id } });
  await db.$transaction(async (tx) => { await assertYaknoUndoCurrent(tx, a, b); await restoreYaknoSnapshot(tx, a, f.user.login); });
  assert.equal((await db.yaknoBox.findUniqueOrThrow({ where: { id: f.box.id } })).horizonId, f.low.id);
  assert.deepEqual(await db.yaknoExcavatorState.findUnique({ where: { excavatorLocationId: f.two.id } }), state);
});

test("free movement and history roll back atomically", async () => {
  const f = await fixture();
  await assert.rejects(db.$transaction(async (tx) => {
    await moveFreeYakno(tx, { boxId: f.box.id, horizonId: null, expectedHorizonId: f.low.id }, f.user);
    throw new Error("rollback");
  }));
  assert.deepEqual(await db.yaknoBox.findUnique({ where: { id: f.box.id } }), f.box);
  assert.equal(await db.yaknoMovement.count({ where: { userId: f.user.id } }), 0);
});

test("legacy free-movement undo ignores captured excavator state that the original operation never changed", async () => {
  const f = await fixture();
  const before = await db.$transaction((tx) => yaknoSnapshot(tx, [f.box.id], [f.two.id]));
  await db.$transaction((tx) => moveFreeYakno(tx, { boxId: f.box.id, horizonId: f.high.id, expectedHorizonId: f.low.id }, f.user));
  const after = await db.$transaction((tx) => yaknoSnapshot(tx, [f.box.id], []));
  await db.yaknoExcavatorState.update({ where: { excavatorLocationId: f.two.id }, data: { horizonId: f.high.id } });
  const laterState = await db.yaknoExcavatorState.findUniqueOrThrow({ where: { excavatorLocationId: f.two.id } });
  await db.$transaction((tx) => undoYaknoSnapshot(tx, before, after, "FREE_HORIZON", f.user.login));
  assert.equal((await db.yaknoBox.findUniqueOrThrow({ where: { id: f.box.id } })).horizonId, f.low.id);
  assert.deepEqual(await db.yaknoExcavatorState.findUnique({ where: { excavatorLocationId: f.two.id } }), laterState);
});
