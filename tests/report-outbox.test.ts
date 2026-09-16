import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test, TestContext } from "node:test";
import { PrismaClient } from "@prisma/client";
import { MaxApiError, MaxRecipient } from "../lib/max-api";
import { openReportOutbox, PreparedReport, ReportDestination, shiftMilliseconds } from "../lib/report-outbox";
import { captureDueReport, deliverNextPart } from "../lib/report-worker";
import { latestCompletedShift, prepareShiftReport } from "../lib/shift-report";

const destination: ReportDestination = { botId: "123", botUsername: "test_report_bot", chatId: "-456", chatTitle: "Test quarry" };
const activatedAt = new Date("2026-09-16T07:59:00+05:00");
const boundary = new Date("2026-09-16T08:00:00+05:00");
const report = (end = boundary, messages = ["Frozen shift report"]): PreparedReport => ({
  version: 1, period: { start: new Date(end.getTime() - shiftMilliseconds).toISOString(), end: end.toISOString() },
  capturedAt: end.toISOString(), messages
});

async function fixture(t: TestContext) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, "raport-outbox-test-"));
  const path = join(directory, "outbox.db");
  const connections: Array<{ close(): Promise<void> }> = [];
  t.after(async () => {
    for (const connection of connections) await connection.close();
    if (dirname(resolve(directory)) !== root || !basename(directory).startsWith("raport-outbox-test-")) throw new Error("Unsafe cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  const open = async (create = false, identity = destination) => {
    const db = await openReportOutbox(path, identity, create);
    connections.push(db);
    return db;
  };
  const outbox = await open(true);
  return { outbox, open, path, directory };
}

function fakeClient() {
  const posted: Array<{ recipient: MaxRecipient; text: string }> = [];
  let reads = 0;
  const client = {
    async getBotInfo() { reads++; return { id: destination.botId, username: destination.botUsername, name: "Test" }; },
    async getChatInfo() { reads++; return { id: destination.chatId, title: destination.chatTitle, type: "chat", status: "active", participants: 2 }; },
    async getBotMembership() { reads++; return { botId: destination.botId, isAdmin: false }; },
    async sendText(recipient: MaxRecipient, text: string) { posted.push({ recipient, text }); return { messageId: `test-mid-${posted.length}` }; }
  };
  return { client, posted, reads: () => reads };
}

test("new outbox is disabled and does not even contact MAX; activation starts at the next 08/20 boundary", async (t) => {
  const { outbox } = await fixture(t);
  const fake = fakeClient();
  assert.equal(await outbox.due(boundary), null);
  assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "idle");
  assert.equal(fake.reads(), 0);
  assert.equal(await outbox.activate(activatedAt), boundary.getTime());
  assert.equal(await outbox.due(activatedAt), null);
  assert.deepEqual(await outbox.due(boundary), latestCompletedShift(boundary));
  assert.equal(await outbox.activate(new Date("2026-09-20T00:00:00Z")), boundary.getTime());
  await outbox.pause();
  assert.equal(await outbox.save(report()), false);
  assert.equal(await outbox.due(boundary), null);
});

test("activation at an exact boundary starts with the following shift, with no historical backfill", async (t) => {
  const { outbox } = await fixture(t);
  assert.equal(await outbox.activate(boundary), new Date("2026-09-16T20:00:00+05:00").getTime());
  assert.equal(await outbox.due(boundary), null);
});

test("approved morning introduction is saved once as part zero, precedes the report and survives restart", async (t) => {
  const { outbox, open } = await fixture(t);
  await outbox.setIntroduction("Approved welcome", boundary, activatedAt);
  await outbox.setIntroduction("Approved welcome", boundary, activatedAt);
  await assert.rejects(outbox.setIntroduction("Different text", boundary, activatedAt), /already been approved/);
  await outbox.activate(activatedAt);
  await assert.rejects(outbox.setIntroduction("Approved welcome", boundary, activatedAt), /before first activation/);
  assert.equal(await outbox.ready(activatedAt), false);
  await outbox.save(report());
  const restarted = await open();
  const fake = fakeClient();
  assert.equal((await restarted.inspect(boundary.getTime()))?.parts[0].part, 0);
  assert.equal(await deliverNextPart(restarted, fake.client, () => boundary), "sent");
  assert.equal(await deliverNextPart(restarted, fake.client, () => new Date(boundary.getTime() + 1000)), "sent");
  assert.deepEqual(fake.posted.map((post) => post.text), ["Approved welcome", "Frozen shift report"]);
  const evening = new Date(boundary.getTime() + shiftMilliseconds);
  await restarted.save(report(evening));
  assert.equal((await restarted.inspect(evening.getTime()))?.parts.length, 1);
  assert.equal((await restarted.inspect(evening.getTime()))?.parts[0].part, 1);
});

test("introduction requires a future morning and missed activation does not silently skip it", async (t) => {
  const { outbox } = await fixture(t);
  await assert.rejects(outbox.setIntroduction("text", activatedAt, activatedAt));
  await assert.rejects(outbox.setIntroduction("text", new Date(boundary.getTime() + shiftMilliseconds), activatedAt));
  await assert.rejects(outbox.setIntroduction("x".repeat(4001), boundary, activatedAt));
  await outbox.setIntroduction("text", boundary, activatedAt);
  await assert.rejects(outbox.activate(boundary), /time has passed/);
  assert.equal((await outbox.status()).enabled, false);
});

test("an uncertain introduction blocks the report and can be reconciled as part zero", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.setIntroduction("text", boundary, activatedAt);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  const part = await outbox.claim(boundary);
  assert.equal(part?.part, 0);
  await outbox.finish(part!, { state: "review", code: "delivery-unknown" }, boundary);
  assert.equal(await outbox.claim(new Date(boundary.getTime() + 1000)), null);
  await outbox.pause();
  await outbox.resolve(boundary.getTime(), 0, { deliveredMessageId: "welcome-mid" });
  await outbox.activate(boundary);
  assert.equal((await outbox.claim(new Date(boundary.getTime() + 1000)))?.part, 1);
});

test("snapshots and all parts commit once with the cursor, remain frozen across restart and cannot be replaced", async (t) => {
  const { outbox, open } = await fixture(t);
  await outbox.activate(activatedAt);
  const second = await open();
  const original = report(boundary, ["Part one", "Part two"]);
  const results = await Promise.all([outbox.save(original, ["legacy-warning"]), second.save(original, ["legacy-warning"])]);
  assert.deepEqual(results.sort(), [false, true]);
  original.messages[0] = "Changed after saving";
  const frozen = await second.inspect(boundary.getTime());
  assert.deepEqual(frozen?.report.messages, ["Part one", "Part two"]);
  assert.deepEqual(frozen?.warnings, ["legacy-warning"]);
  assert.equal(frozen?.parts.length, 2);
  assert.equal((await outbox.status()).nextEnd, boundary.getTime() + shiftMilliseconds);
  await outbox.close();
  const restarted = await open();
  assert.deepEqual(await restarted.inspect(boundary.getTime()), frozen);
  assert.equal(await restarted.save(original), false);
  await assert.rejects(restarted.save(report(new Date(boundary.getTime() + shiftMilliseconds), ["x".repeat(4001)])));
  assert.equal((await restarted.status()).nextEnd, boundary.getTime() + shiftMilliseconds);
});

test("identity mismatch and inventory databases are rejected without changing their data", async (t) => {
  const { path, open, directory } = await fixture(t);
  await assert.rejects(open(false, { ...destination, chatId: "-789" }), /destination/);
  await assert.rejects(openReportOutbox(path, destination, true), /EEXIST/);
  const inventory = join(directory, "inventory.db");
  const db = new PrismaClient({ datasources: { db: { url: `file:${inventory.replaceAll("\\", "/")}` } } });
  try {
    await db.$executeRaw`CREATE TABLE stock (id INTEGER PRIMARY KEY, quantity INTEGER NOT NULL)`;
    await db.$executeRaw`INSERT INTO stock (id, quantity) VALUES (1, 27)`;
  } finally { await db.$disconnect(); }
  const hash = () => createHash("sha256").update(readFileSync(inventory)).digest("hex");
  const before = hash();
  await assert.rejects(openReportOutbox(inventory, destination), /Not a report outbox/);
  assert.equal(hash(), before);
});

test("two workers serialize claims; parts send in order and no faster than the persistent rate limit", async (t) => {
  const { outbox, open } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report(boundary, ["one", "two"]));
  const second = await open();
  const claims = await Promise.all([outbox.claim(boundary), second.claim(boundary)]);
  const part = claims.find(Boolean)!;
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(part.part, 1);
  assert.equal(await second.claim(new Date(boundary.getTime() + 1000)), null);
  await outbox.finish(part, { state: "sent", messageId: "mid-one" }, boundary);
  assert.equal(await second.claim(new Date(boundary.getTime() + 749)), null);
  const next = await second.claim(new Date(boundary.getTime() + 750));
  assert.equal(next?.part, 2);
  assert.equal(next?.text, "two");
});

test("network outage before POST preserves the frozen report, then recovery sends the original content", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  const fake = fakeClient();
  const online = fake.client.getBotInfo;
  fake.client.getBotInfo = async () => { throw new Error("PRIVATE_NETWORK_DETAIL"); };
  assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "preflight-unavailable");
  assert.equal(fake.posted.length, 0);
  assert.equal((await outbox.inspect(boundary.getTime()))?.parts[0].attempts, 0);
  fake.client.getBotInfo = online;
  const later = new Date(boundary.getTime() + 60000);
  assert.equal(await deliverNextPart(outbox, fake.client, () => later), "sent");
  assert.deepEqual(fake.posted, [{ recipient: { kind: "chat", id: "-456" }, text: "Frozen shift report" }]);
  assert.equal(await deliverNextPart(outbox, fake.client, () => later), "idle");
});

test("wrong bot, renamed or removed group and wrong membership prevent all POSTs", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  for (const mismatch of ["bot", "group", "status", "membership"]) {
    const fake = fakeClient();
    if (mismatch === "bot") fake.client.getBotInfo = async () => ({ id: "999", name: "Wrong", username: destination.botUsername });
    if (mismatch === "group" || mismatch === "status") fake.client.getChatInfo = async () => ({ id: destination.chatId, title: mismatch === "group" ? "Renamed" : destination.chatTitle,
      type: "chat", status: mismatch === "status" ? "removed" : "active", participants: 2 });
    if (mismatch === "membership") fake.client.getBotMembership = async () => ({ botId: "999", isAdmin: false });
    assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "identity-mismatch");
    assert.equal(fake.posted.length, 0);
  }
  assert.equal((await outbox.inspect(boundary.getTime()))?.parts[0].attempts, 0);
});

test("confirmed 429 retries after backoff; permanent rejection stops delivery without leaking errors", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  const fake = fakeClient();
  fake.client.sendText = async () => { throw new MaxApiError("SECRET_PROVIDER_BODY", "not-sent", 429); };
  assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "retry");
  assert.equal(await outbox.ready(new Date(boundary.getTime() + 9999)), false);
  const later = new Date(boundary.getTime() + 10000);
  assert.equal(await outbox.ready(later), true);
  fake.client.sendText = async () => { throw new MaxApiError("SECRET_PROVIDER_BODY", "not-sent", 403); };
  assert.equal(await deliverNextPart(outbox, fake.client, () => later), "needs-review");
  const saved = await outbox.inspect(boundary.getTime());
  assert.equal(saved?.parts[0].state, "blocked");
  assert(!JSON.stringify(saved).includes("SECRET"));
  assert.equal(await outbox.ready(new Date(later.getTime() + 999999)), false);
});

test("ambiguous POST is never automatically repeated and blocks later parts, but future shifts still freeze", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report(boundary, ["first", "second"]));
  const fake = fakeClient();
  let sends = 0;
  fake.client.sendText = async () => { sends++; throw new MaxApiError("secret", "unknown", 500); };
  assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "needs-review");
  const next = new Date(boundary.getTime() + shiftMilliseconds);
  assert.equal(await outbox.save(report(next)), true);
  assert.equal(await deliverNextPart(outbox, fake.client, () => next), "idle");
  assert.equal(sends, 1);
  assert.deepEqual((await outbox.status()).counts, [{ state: "pending", count: 2 }, { state: "review", count: 1 }]);
});

test("a crash after claim or after POST leaves an uncertain lease; restart cannot resend it", async (t) => {
  const { outbox, open } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  const part = await outbox.claim(boundary);
  assert(part);
  await outbox.close();
  const restarted = await open();
  assert.equal(await restarted.ready(new Date(boundary.getTime() + 119999)), false);
  assert.equal(await restarted.claim(new Date(boundary.getTime() + 120000)), null);
  assert.equal((await restarted.inspect(boundary.getTime()))?.parts[0].code, "interrupted-send");
  await assert.rejects(restarted.resolve(boundary.getTime(), 1, { confirmedNotDelivered: true }), /Pause/);
  await restarted.pause();
  await restarted.resolve(boundary.getTime(), 1, { deliveredMessageId: "verified-mid" });
  assert.equal(await restarted.finish(part, { state: "pending" }, new Date()), false);
  await restarted.activate(new Date());
  assert.equal(await restarted.ready(new Date()), false);
  assert.equal((await restarted.inspect(boundary.getTime()))?.parts[0].message_id, "verified-mid");
});

test("only a manual not-delivered confirmation while paused permits retry, and sent parts are retained", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report(boundary, ["one", "two"]));
  const fake = fakeClient();
  assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "sent");
  const secondAt = new Date(boundary.getTime() + 1000);
  const part = await outbox.claim(secondAt);
  assert(part);
  await outbox.finish(part, { state: "review", code: "delivery-unknown" }, secondAt);
  await outbox.pause();
  await assert.rejects(outbox.resolve(boundary.getTime(), 1, { confirmedNotDelivered: true }), /not waiting/);
  await outbox.resolve(boundary.getTime(), 2, { confirmedNotDelivered: true });
  assert.equal((await outbox.status()).enabled, false);
  await outbox.activate(secondAt);
  assert.equal(await deliverNextPart(outbox, fake.client, () => new Date(boundary.getTime() + 2000)), "sent");
  assert.deepEqual(fake.posted.map((item) => item.text), ["one", "two"]);
});

test("catch-up starts at activation and labels late PP honestly without regenerating existing shifts", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  const now = new Date(boundary.getTime() + shiftMilliseconds + 60000);
  let collected = 0;
  const collect = async (period: { start: Date; end: Date }) => {
    collected++;
    return { report: prepareShiftReport({ period, capturedAt: now, points: [], events: [] }), warnings: [] };
  };
  assert.equal(await captureDueReport(outbox, collect, now), true);
  assert.match((await outbox.inspect(boundary.getTime()))!.report.messages[0], /не на конец прошлой смены/);
  assert.equal(await captureDueReport(outbox, collect, now), true);
  assert.equal(await captureDueReport(outbox, collect, now), false);
  assert.equal(collected, 2);
  assert.equal((await outbox.status()).nextEnd, boundary.getTime() + 2 * shiftMilliseconds);
});

test("collector failure does not advance the cursor or prevent a safe later retry", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await assert.rejects(captureDueReport(outbox, async () => { throw new Error("DB unavailable"); }, boundary));
  assert.equal((await outbox.status()).nextEnd, boundary.getTime());
  assert.equal(await outbox.inspect(boundary.getTime()), null);
  await assert.rejects(captureDueReport(outbox, async () => ({ report: report(new Date(boundary.getTime() + shiftMilliseconds)), warnings: [] }), boundary), /different shift/);
  assert.equal(await captureDueReport(outbox, async () => ({ report: report(), warnings: [] }), boundary), true);
});

test("failure while inserting a later part rolls back the snapshot, every part and the scheduling cursor", async (t) => {
  const { outbox, path } = await fixture(t);
  await outbox.activate(activatedAt);
  const raw = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  try {
    await raw.$executeRaw`CREATE TRIGGER test_failure BEFORE INSERT ON report_parts WHEN NEW.part = 2
      BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END`;
    await assert.rejects(outbox.save(report(boundary, ["one", "two"])));
    assert.equal(await outbox.inspect(boundary.getTime()), null);
    assert.equal((await outbox.status()).nextEnd, boundary.getTime());
    assert.deepEqual((await outbox.status()).counts, []);
    await raw.$executeRaw`DROP TRIGGER test_failure`;
    assert.equal(await outbox.save(report(boundary, ["one", "two"])), true);
  } finally { await raw.$disconnect(); }
});

test("failure recording successful POST never turns into an automatic retry", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  const fake = fakeClient();
  const finish = outbox.finish;
  outbox.finish = async () => { throw new Error("Storage unavailable after send"); };
  await assert.rejects(deliverNextPart(outbox, fake.client, () => boundary), /Storage unavailable/);
  assert.equal(fake.posted.length, 1);
  outbox.finish = finish;
  const later = new Date(boundary.getTime() + 120000);
  assert.equal(await deliverNextPart(outbox, fake.client, () => later), "idle");
  assert.equal(fake.posted.length, 1);
  assert.equal((await outbox.status()).attention[0].code, "interrupted-send");
});

test("pausing during preflight prevents claim; an expired pre-POST lease does not send", async (t) => {
  const { outbox } = await fixture(t);
  await outbox.activate(activatedAt);
  await outbox.save(report());
  const fake = fakeClient();
  fake.client.getBotMembership = async () => { await outbox.pause(); return { botId: destination.botId, isAdmin: false }; };
  assert.equal(await deliverNextPart(outbox, fake.client, () => boundary), "idle");
  assert.equal(fake.posted.length, 0);
  await outbox.activate(activatedAt);
  fake.client.getBotMembership = async () => ({ botId: destination.botId, isAdmin: false });
  let clocks = 0;
  const clock = () => new Date(boundary.getTime() + (++clocks >= 3 ? 120000 : 0));
  assert.equal(await deliverNextPart(outbox, fake.client, clock), "retry");
  assert.equal(fake.posted.length, 0);
  assert.equal((await outbox.inspect(boundary.getTime()))?.parts[0].state, "pending");
});

test("CLI initialization, status, activation and pause do not need a token or send; run is opt-in and rejects inventory as outbox", async (t) => {
  const { directory, path } = await fixture(t);
  const configPath = join(directory, "configuration.json");
  const config = { ...destination, sourceDatabase: path, outboxDatabase: join(directory, "second-outbox.db"), tokenFile: join(directory, "missing-token") };
  writeFileSync(configPath, JSON.stringify(config), { flag: "wx" });
  const args = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/run-max-reports.ts"), "--config", configPath];
  const run = (mode: string) => execFileSync(process.execPath, [...args, "--mode", mode], { encoding: "utf8", timeout: 20000 });
  assert.equal(JSON.parse(run("init")).enabled, false);
  assert.equal(JSON.parse(run("status")).enabled, false);
  assert.equal(spawnSync(process.execPath, [...args, "--mode", "run"], { timeout: 20000 }).status, 1);
  assert.equal(spawnSync(process.execPath, [...args, "--mode", "run", "--send"], { timeout: 20000 }).status, 1);
  assert.equal(JSON.parse(run("activate")).messagesSent, 0);
  // Even after activation a missing token fails closed, without creating or modifying credentials.
  assert.equal(spawnSync(process.execPath, [...args, "--mode", "run", "--send"], { timeout: 20000 }).status, 1);
  assert.match(run("pause"), /paused/);
  assert.equal(JSON.parse(run("status")).enabled, false);
  const before = createHash("sha256").update(readFileSync(path)).digest("hex");
  writeFileSync(configPath, JSON.stringify({ ...config, outboxDatabase: path }));
  assert.equal(spawnSync(process.execPath, [...args, "--mode", "init"], { timeout: 20000 }).status, 1);
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), before);
});
