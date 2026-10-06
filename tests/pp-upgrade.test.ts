import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { availablePpEquipment, changePpEquipment, changePpEquipmentSector, lockPpEquipment } from "../lib/pp-equipment";
import { collectPpSnapshot } from "../lib/pp-snapshot";
import { formatPpSnapshot, formatShiftReport, type PpReading } from "../lib/shift-report";
import { collectShiftReport } from "../lib/shift-report-source";
import { deliverPpSnapshot, openPpDeliveryState, type PpDeliveryState } from "../lib/pp-delivery";
import { MaxApiError } from "../lib/max-api";
import { openReferenceSource } from "../lib/max-reference-config";

const root = resolve("prisma"), dir = mkdtempSync(join(root, "raport-pp-test-"));
const database = join(dir, "inventory.db");
const db = new PrismaClient({ datasources: { db: { url: `file:${database.replaceAll("\\", "/")}` } } });
const destination = { botId: "123", botUsername: "report_bot", chatId: "-456", chatTitle: "Рапорт мастера" };
const states: PpDeliveryState[] = [];
const now = new Date("2026-10-06T10:15:00+05:00").getTime();
let number = 0;
before(() => {
  writeFileSync(database, "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(dir)}/inventory.db` }, stdio: "pipe"
  });
});
after(async () => {
  for (const state of states) await state.close();
  await db.$disconnect();
  if (dirname(resolve(dir)) !== root || !basename(dir).startsWith("raport-pp-test-")) throw new Error("Unsafe test cleanup");
  rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  const n = ++number;
  const actor = await db.user.create({ data: { login: `pp-test-${n}`, role: "storekeeper", passwordHash: "unused" } });
  const equipment = await db.location.create({ data: { name: `ЭКГ-10 №${n}`, category: "excavator" } });
  const otherEquipment = await db.location.create({ data: { name: `CAT №${n}`, category: "loader" } });
  const point = await db.ppPoint.create({ data: { name: `ПП №${n * 10}`, equipmentLocationId: equipment.id,
    sectors: { create: [{ name: "1", quantity: 2 }, { name: "2", material: "ORE" }] } }, include: { sectors: true } });
  const otherPoint = await db.ppPoint.create({ data: { name: `ПП №${n * 10 + 1}`, sectors: { create: [{ name: "1" }] } }, include: { sectors: true } });
  await db.ppPoint.update({ where: { id: point.id }, data: { unloadingSectorId: point.sectors[1].id } });
  return { actor, equipment, otherEquipment, point, otherPoint };
}
async function deliveryFixture() {
  const path = join(dir, `delivery-${++number}.db`);
  const state = await openPpDeliveryState(path, destination, true);
  states.push(state);
  const sent: string[] = [];
  const client = {
    getBotInfo: async () => ({ id: destination.botId, name: "Bot", username: destination.botUsername }),
    getChatInfo: async (id: string) => ({ id, type: "chat", status: "active", title: destination.chatTitle, participants: 10 }),
    getBotMembership: async () => ({ botId: destination.botId, isAdmin: false }),
    sendText: async (_recipient: unknown, text: string) => { sent.push(text); return { messageId: `mid.${sent.length}` }; }
  };
  return { path, state, sent, client };
}
test("equipment occupies zero or one sector; unloading, quantities and materials stay independent", async () => {
  const { actor, point, equipment } = await fixture();
  const [one, two] = point.sectors;
  await db.$transaction((tx) => changePpEquipmentSector(tx, point.id, one.id, equipment.id, null, actor));
  await db.$transaction((tx) => changePpEquipmentSector(tx, point.id, two.id, equipment.id, one.id, actor));
  assert.equal((await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } })).equipmentSectorId, two.id);
  await db.$transaction((tx) => changePpEquipmentSector(tx, point.id, null, equipment.id, two.id, actor));
  const saved = await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } });
  assert.equal(saved.equipmentSectorId, null);
  assert.equal(saved.unloadingSectorId, two.id);
  assert.deepEqual(await db.ppSector.findMany({ where: { ppPointId: point.id }, orderBy: { id: "asc" } }), point.sectors);
  assert.equal(await db.ppMovement.count({ where: { ppPointId: point.id, action: "SET_EQUIPMENT_SECTOR" } }), 3);
});
test("changing or removing equipment clears its sector, but saving the same equipment is a no-op", async () => {
  const { actor, point, equipment, otherEquipment } = await fixture();
  await db.$transaction((tx) => changePpEquipmentSector(tx, point.id, point.sectors[0].id, equipment.id, null, actor));
  const before = await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } });
  await db.$transaction((tx) => changePpEquipment(tx, point.id, equipment.id, equipment.id, actor));
  assert.deepEqual(await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } }), before);
  await db.$transaction((tx) => changePpEquipment(tx, point.id, otherEquipment.id, equipment.id, actor));
  assert.equal((await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } })).equipmentSectorId, null);
  await db.$transaction((tx) => changePpEquipmentSector(tx, point.id, point.sectors[1].id, otherEquipment.id, null, actor));
  await db.$transaction((tx) => changePpEquipment(tx, point.id, null, otherEquipment.id, actor));
  const after = await db.ppPoint.findUniqueOrThrow({ where: { id: point.id } });
  assert.equal(after.equipmentSectorId, null); assert.equal(after.unloadingSectorId, point.sectors[1].id);
});
test("occupied equipment is rejected with its PP name; old assignments and history are unchanged", async () => {
  const { actor, point, equipment, otherPoint } = await fixture();
  const before = await db.ppPoint.findMany();
  const history = await db.ppMovement.count();
  await assert.rejects(db.$transaction((tx) => changePpEquipment(tx, otherPoint.id, equipment.id, null, actor)),
    (error: unknown) => error instanceof Error && error.message.includes(`Сначала уберите технику с ${point.name}`));
  assert.deepEqual(await db.ppPoint.findMany(), before);
  assert.equal(await db.ppMovement.count(), history);
  await assert.rejects(db.$transaction(async (tx) => {
    await lockPpEquipment(tx); await availablePpEquipment(tx, equipment.id);
  }), /уже находится/);
});
test("two clients cannot concurrently assign one equipment to two points", async () => {
  const { actor, equipment, point, otherPoint } = await fixture();
  await db.$transaction((tx) => changePpEquipment(tx, point.id, null, equipment.id, actor));
  const second = new PrismaClient({ datasources: { db: { url: `file:${database.replaceAll("\\", "/")}` } } });
  try {
    const outcomes = await Promise.allSettled([
      db.$transaction((tx) => changePpEquipment(tx, point.id, equipment.id, null, actor)),
      second.$transaction((tx) => changePpEquipment(tx, otherPoint.id, equipment.id, null, actor))
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(await db.ppPoint.count({ where: { equipmentLocationId: equipment.id, isActive: true } }), 1);
  } finally { await second.$disconnect(); }
});
test("no equipment, foreign/inactive sectors and stale browser selections are rejected", async () => {
  const { actor, equipment, otherEquipment, point, otherPoint } = await fixture();
  await assert.rejects(db.$transaction((tx) => changePpEquipmentSector(tx, otherPoint.id, otherPoint.sectors[0].id, null, null, actor)), /Сначала выберите/);
  await assert.rejects(db.$transaction((tx) => changePpEquipmentSector(tx, point.id, otherPoint.sectors[0].id, equipment.id, null, actor)), /Сектор/);
  await db.ppSector.update({ where: { id: point.sectors[0].id }, data: { isActive: false } });
  await assert.rejects(db.$transaction((tx) => changePpEquipmentSector(tx, point.id, point.sectors[0].id, equipment.id, null, actor)), /Сектор/);
  await db.$transaction((tx) => changePpEquipment(tx, point.id, otherEquipment.id, equipment.id, actor));
  await assert.rejects(db.$transaction((tx) => changePpEquipmentSector(tx, point.id, point.sectors[1].id, equipment.id, null, actor)), /изменено/);
  await assert.rejects(db.$transaction((tx) => changePpEquipment(tx, point.id, null, equipment.id, actor)), /изменена/);
});
test("manual snapshot includes empty PPs and ЭКГ; scheduled report preserves its filter and changes", () => {
  const points: PpReading[] = [
    { id: 1, name: "ПП №4", excavator: "ЭКГ-8И №54", equipmentSectorId: 1, unloadingSectorId: 2,
      sectors: [{ id: 1, name: "1", quantity: 1, material: "OVERBURDEN" }, { id: 2, name: "2", quantity: 8, material: "ORE" }] },
    { id: 2, name: "ПП №3", excavator: null, equipmentSectorId: 3, unloadingSectorId: null,
      sectors: [{ id: 3, name: "1", quantity: 0, material: "OVERBURDEN" }] }
  ];
  const manual = formatPpSnapshot(points, new Date(now)).join("\n");
  assert.match(manual, /06.10.2026, 10:15/);
  assert.match(manual, /Сектор 1: 1В · ЭКГ/);
  assert.match(manual, /Сектор 2: 8Р 🟢/);
  assert.match(manual, /ПП №3 · Без экскаватора\nЗемли нет\nСектор 1: 0В/);
  assert(!manual.includes("0В · ЭКГ")); assert(!manual.includes("ИЗМЕНЕНИЯ"));
  const scheduled = formatShiftReport({ period: { start: new Date("2026-10-05T19:30:00+05:00"), end: new Date("2026-10-06T06:30:00+05:00") },
    capturedAt: new Date("2026-10-06T06:30:00+05:00"), points, events: [] }).join("\n");
  assert.match(scheduled, /Сектор 1: 1В · ЭКГ/); assert.match(scheduled, /ИЗМЕНЕНИЯ/);
  assert(!scheduled.includes("ПП №3"));
});
test("long manual reports are split without losing PPs; empty inventory is explicit", () => {
  const points = Array.from({ length: 160 }, (_, id) => ({ id, name: `ПП №${id}`, excavator: null, unloadingSectorId: null,
    sectors: [{ id: id * 2, name: "1", quantity: 0, material: "OVERBURDEN" }] }));
  const messages = formatPpSnapshot(points, new Date(now));
  assert(messages.length > 1); assert(messages.every((message) => message.length <= 4000));
  for (const point of points) assert(messages.join("\n").includes(`${point.name} ·`));
  assert.match(formatPpSnapshot([], new Date(now))[0], /Действующих П\/П нет/);
});
test("source snapshot is read-only, contains the selected sector, and scheduled collector receives it", async () => {
  const { actor, point, equipment } = await fixture();
  await db.$transaction((tx) => changePpEquipmentSector(tx, point.id, point.sectors[0].id, equipment.id, null, actor));
  const source = await openReferenceSource(database);
  try {
    const snapshot = await collectPpSnapshot(source);
    assert(snapshot.messages.join("\n").includes("2В · ЭКГ"));
    await assert.rejects(source.ppPoint.update({ where: { id: point.id }, data: { equipmentSectorId: null } }));
    const report = await db.$transaction((tx) => collectShiftReport(tx, {
      start: new Date("2026-10-05T19:30:00+05:00"), end: new Date("2026-10-06T06:30:00+05:00")
    }));
    assert.equal(report.points.find((item) => item.id === point.id)?.equipmentSectorId, point.sectors[0].id);
  } finally { await source.$disconnect(); }
});
test("storekeeper can send; replaying the same request never sends again, including after restart", async () => {
  const { state, client, sent, path } = await deliveryFixture();
  const id = randomUUID();
  assert.equal((await deliverPpSnapshot(state, client, id, 7, ["ЗЕМЛЯ"], () => now)).state, "sent");
  await state.close();
  const reopened = await openPpDeliveryState(path, destination); states.push(reopened);
  assert.equal((await deliverPpSnapshot(reopened, client, id, 7, ["ДРУГИЕ ДАННЫЕ"], () => now + 60000)).state, "sent");
  assert.deepEqual(sent, ["ЗЕМЛЯ"]);
});
test("cross-user simultaneous sends and cooldown prevent double sends", async () => {
  const { state, client, sent, path } = await deliveryFixture();
  const other = await openPpDeliveryState(path, destination); states.push(other);
  const outcomes = await Promise.all([
    deliverPpSnapshot(state, client, randomUUID(), 1, ["snapshot"], () => now),
    deliverPpSnapshot(other, client, randomUUID(), 2, ["snapshot"], () => now)
  ]);
  assert.equal(sent.length, 1); assert.equal(outcomes.filter((item) => item.state === "sent").length, 1);
  assert.equal((await deliverPpSnapshot(state, client, randomUUID(), 2, ["again"], () => now + 1000)).state, "cooldown");
  assert.equal((await deliverPpSnapshot(state, client, randomUUID(), 2, ["again"], () => now + 31000)).state, "sent");
});
test("wrong group or bot is never sent a manual report", async () => {
  const { state, client, sent } = await deliveryFixture();
  client.getChatInfo = async (id) => ({ id, type: "chat", status: "active", title: "Главный карьер", participants: 10 });
  assert.equal((await deliverPpSnapshot(state, client, randomUUID(), 1, ["snapshot"], () => now)).state, "failed");
  assert.equal(sent.length, 0);
});
test("uncertain delivery remains blocked across requests until explicitly reviewed, with no retry", async () => {
  const { state, client, sent } = await deliveryFixture();
  client.sendText = async () => { sent.push("attempt"); throw new MaxApiError("timeout", "unknown"); };
  const id = randomUUID();
  assert.equal((await deliverPpSnapshot(state, client, id, 1, ["snapshot"], () => now)).state, "review");
  assert.equal((await deliverPpSnapshot(state, client, randomUUID(), 1, ["snapshot"], () => now + 60000)).state, "review");
  assert.equal(sent.length, 1);
  await assert.rejects(state.acknowledge(id, now + 1000));
  await state.acknowledge(id, now + 180000);
  assert.equal((await state.status(now + 180000))[0].state, "closed");
  assert.equal(sent.length, 1);
});
test("crash after persistent claim does not replay the old request", async () => {
  const { state, client, sent } = await deliveryFixture();
  const id = randomUUID();
  assert.equal(await state.begin(id, 1, ["snapshot"], now), null);
  await state.beforePost(id, 0);
  assert.equal((await deliverPpSnapshot(state, client, id, 1, ["snapshot"], () => now + 121000)).state, "review");
  assert.equal(sent.length, 0);
});
test("multi-part partial failure retains confirmations and blocks new sends", async () => {
  const { state, client, sent } = await deliveryFixture();
  client.sendText = async (_recipient, text) => {
    sent.push(text);
    if (sent.length === 2) throw new MaxApiError("rate limit", "not-sent", 429);
    return { messageId: "mid.first" };
  };
  const id = randomUUID();
  assert.equal((await deliverPpSnapshot(state, client, id, 1, ["one", "two"], () => now, async () => {})).state, "review");
  assert.equal((await state.parts(id))[0].message_id, "mid.first");
  await deliverPpSnapshot(state, client, randomUUID(), 1, ["three"], () => now + 60000);
  assert.deepEqual(sent, ["one", "two"]);
});
test("preflight failure and definite first-POST rejection do not claim successful delivery", async () => {
  const { state, client, sent } = await deliveryFixture();
  client.sendText = async () => { throw new MaxApiError("rejected", "not-sent", 403); };
  assert.equal((await deliverPpSnapshot(state, client, randomUUID(), 1, ["one"], () => now)).state, "failed");
  client.getBotInfo = async () => { throw new Error("network"); };
  assert.equal((await deliverPpSnapshot(state, client, randomUUID(), 1, ["two"], () => now + 60000)).state, "failed");
  assert.equal(sent.length, 0);
});
test("delivery refuses inventory database, wrong destination and overwriting an existing state", async () => {
  const { state, path } = await deliveryFixture();
  await assert.rejects(openPpDeliveryState(database, destination));
  await assert.rejects(openPpDeliveryState(path, { ...destination, chatId: "-999" }));
  await assert.rejects(openPpDeliveryState(path, destination, true));
  await assert.rejects(state.begin("invalid", 1, ["one"], now));
  await assert.rejects(state.begin(randomUUID(), 1, ["x".repeat(4001)], now));
});
test("additive migration preserves every old value and is idempotent", async () => {
  const path = join(dir, "legacy.db");
  writeFileSync(path, "", { flag: "wx" });
  const legacy = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  try {
    await legacy.$executeRawUnsafe("CREATE TABLE PpPoint (id INTEGER PRIMARY KEY, name TEXT, isActive BOOLEAN, equipmentLocationId INTEGER, unloadingSectorId INTEGER)");
    await legacy.$executeRawUnsafe("INSERT INTO PpPoint VALUES (1, 'PP test', 1, 7, 12)");
    const before = await legacy.$queryRawUnsafe("SELECT * FROM PpPoint");
    const { migratePp } = require("../scripts/migrate-pp-equipment.cjs");
    assert.deepEqual(await migratePp(path, undefined, false), { changed: false, ready: false });
    assert.deepEqual(await migratePp(path, join(dir, "migration-backup"), true), { changed: true, ready: true });
    assert.deepEqual(await legacy.$queryRawUnsafe("SELECT id, name, isActive, equipmentLocationId, unloadingSectorId FROM PpPoint"), before);
    assert.deepEqual(await migratePp(path, undefined, true), { changed: false, ready: true });
  } finally { await legacy.$disconnect(); }
});
