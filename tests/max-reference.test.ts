import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createMaxClient, MaxApiError } from "../lib/max-api";
import { collectPowerReference, formatPowerReference, powerReference, referenceBuilders } from "../lib/max-reference";
import { loadReferenceConfig, openReferenceSource, type ReferenceConfig } from "../lib/max-reference-config";
import { openReferenceState, referenceLeaseMs, type ReferenceState } from "../lib/max-reference-state";
import { handleReferenceWebhook, parseReferenceCallback } from "../lib/max-reference-webhook";
import { refreshReference, verifyReferenceDestination } from "../lib/max-reference-worker";
import { POST } from "../app/api/max/reference/route";
import { hasPoweredAssembly } from "../lib/yakno-view";

const root = resolve("prisma"), dir = mkdtempSync(join(root, "raport-reference-test-"));
const sourcePath = join(dir, "inventory.db");
const db = new PrismaClient({ datasources: { db: { url: `file:${sourcePath.replaceAll("\\", "/")}` } } });
const destination = { botId: "123", botUsername: "report_bot", chatId: "-456", chatTitle: "Рапорт мастера" };
const now = new Date("2026-09-27T08:30:00+05:00").getTime();
const secret = "s".repeat(48);
const dottedMessageId = "mid.0123456789abcdef0123456789abcdef";
const states: ReferenceState[] = [];
let index = 0;
before(() => {
  writeFileSync(sourcePath, "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(dir)}/inventory.db` }, stdio: "pipe"
  });
});
after(async () => {
  for (const state of states) await state.close();
  await db.$disconnect();
  if (dirname(resolve(dir)) !== root || !basename(dir).startsWith("raport-reference-test-")) throw new Error("Unsafe cleanup");
  rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  const path = join(dir, `reference-${++index}.db`);
  const state = await openReferenceState(path, destination, true);
  states.push(state);
  return { path, state };
}
async function active() {
  const f = await fixture();
  await f.state.beginPublication("reference");
  await f.state.confirmPublication("reference", "mid");
  await f.state.activate();
  return f;
}
function callback() {
  return { update_type: "message_callback", timestamp: now,
    callback: { timestamp: now, callback_id: "click-1", payload: powerReference.payload as string, user: { user_id: 999, is_bot: false } },
    message: { sender: { user_id: 123, is_bot: true }, recipient: { chat_id: -456, chat_type: "chat" }, body: { mid: "mid" } } };
}
function request(body: unknown = callback(), key = secret) {
  return new Request("https://example.test/api/max/reference", { method: "POST", headers: {
    "Content-Type": "application/json", "X-Max-Bot-Api-Secret": key
  }, body: JSON.stringify(body) });
}
const message = () => formatPowerReference([{ name: "ЭКГ-10 №4", yakno: ["117"], horizon: "+100", assembly: true }], new Date(now));
const hash = () => createHash("sha256").update(readFileSync(sourcePath)).digest("hex");

test("reference formatting has readable blocks, independent assembly marker, no unknown-horizon placeholder", () => {
  const result = formatPowerReference([
    { name: "ЭКГ-10 №4", yakno: ["Я117"], horizon: "Горизонт +100", assembly: true },
    { name: "ЭКГ-10 №9", yakno: ["28"], horizon: null, assembly: false },
    { name: "ЭКГ-8И №42", yakno: [], horizon: null, assembly: true }
  ], new Date(now));
  assert.equal(result.text, "<b>Питание экскаваторов</b>\n\n<b>ЭКГ-10 №4 (в сборку)</b>\nЯ-117 · гор. +100м\n\n<b>ЭКГ-10 №9</b>\nЯ-28\n\n<b>ЭКГ-8И №42 (в сборку)</b>\nЯКНО не подключено\n\nОбновлено: 27.09.2026, 08:30");
  assert.equal(result.notify, false);
  assert.deepEqual(result.attachments[0].payload.buttons, [[{ type: "callback", text: powerReference.label, payload: powerReference.payload }]]);
});

test("reference escapes data markup, handles empty inventory and refuses silent truncation", () => {
  const result = formatPowerReference([{ name: '<b>"&</b>', yakno: ["<117>"], horizon: "<100>", assembly: false }], new Date(now));
  assert(result.text.includes("&lt;b&gt;&quot;&amp;&lt;/b&gt;"));
  assert(result.text.includes("Я-&lt;117&gt;"));
  assert(!result.text.includes("<100>"));
  assert.match(formatPowerReference([], new Date(now)).text, /Нет действующих экскаваторов/);
  assert.throws(() => formatPowerReference([{ name: "x".repeat(4000), yakno: [], horizon: null, assembly: false }]));
});

test("collector reads actual connections only; read-only source cannot modify inventory or history", async () => {
  const high = await db.assemblyHorizon.create({ data: { name: "Горизонт +100", sortOrder: 100 } });
  const excavators = [];
  for (const number of [42, 9, 4, 18]) excavators.push(await db.location.create({ data: { name: `ЭКГ-10 №${number}`, category: "excavator" } }));
  const [none, boxOnly, both, assemblyOnly] = excavators;
  await db.location.create({ data: { name: "ЭКГ-10 №1", category: "excavator", isActive: false } });
  await db.location.create({ data: { name: "Склад", category: "storage" } });
  await db.yaknoExcavatorState.create({ data: { excavatorLocationId: both.id, horizonId: high.id } });
  for (const [excavator, number] of [[both, "117"], [boxOnly, "28"]] as const) {
    await db.yaknoBox.create({ data: { number, excavatorLocationId: excavator.id, isPowered: true } });
  }
  await db.yaknoBox.create({ data: { number: "free-nearby", excavatorLocationId: both.id, horizonId: high.id } });
  await db.yaknoBox.create({ data: { number: "archived", excavatorLocationId: both.id, isPowered: true, isActive: false } });
  await db.yaknoBox.create({ data: { number: "repair", excavatorLocationId: both.id, isPowered: true, status: "REPAIR" } });
  for (const excavator of [both, assemblyOnly]) await db.assembly.create({ data: { name: `Assembly-${excavator.id}`, excavatorLocationId: excavator.id, isPowered: true, comment: "private-comment" } });
  await db.assembly.create({ data: { name: "Nearby", excavatorLocationId: boxOnly.id } });
  await db.assembly.create({ data: { name: "Repair", excavatorLocationId: none.id, isPowered: true, status: "REPAIR" } });
  await db.assembly.create({ data: { name: "Loan", excavatorLocationId: none.id, isPowered: true, status: "ON_LOAN" } });
  const before = hash();
  const source = await openReferenceSource(sourcePath);
  try {
    const rows = await collectPowerReference(source);
    assert.deepEqual(rows.map((row) => row.name), [both.name, boxOnly.name, assemblyOnly.name, none.name]);
    assert.deepEqual(rows.map((row) => row.assembly), [true, false, true, false]);
    assert.deepEqual(rows.map((row) => row.yakno), [["117"], ["28"], [], []]);
    assert.deepEqual(rows.map((row) => row.horizon), [high.name, null, null, null]);
    const assemblies = await source.assembly.findMany();
    for (const excavator of excavators) {
      assert.equal(hasPoweredAssembly(assemblies, excavator.id), rows.find((row) => row.name === excavator.name)?.assembly);
    }
    assert(!JSON.stringify(rows).includes("private-comment"));
    await assert.rejects(source.location.update({ where: { id: both.id }, data: { name: "must-not-write" } }));
    assert.equal(await source.yaknoMovement.count(), 0);
  } finally { await source.$disconnect(); }
  assert.equal(hash(), before);
});

test("state initialization is exclusive and refuses inventory, wrong destination and existing files", async () => {
  const { path, state } = await fixture();
  assert.equal((await state.status()).enabled, false);
  await assert.rejects(state.activate());
  await assert.rejects(openReferenceState(path, destination, true));
  await assert.rejects(openReferenceState(path, { ...destination, chatId: "-999" }));
  const before = hash();
  await assert.rejects(openReferenceState(sourcePath, destination));
  await assert.rejects(openReferenceState(sourcePath, destination, true));
  assert.equal(hash(), before);
});

test("configuration rejects source/state aliases including hard links and unknown settings", () => {
  const path = join(dir, "config.json"), statePath = join(dir, "alias.db");
  const config: ReferenceConfig = { ...destination, sourceDatabase: sourcePath, stateDatabase: join(dir, "config-state.db"),
    tokenFile: join(dir, "token.txt"), webhookSecretFile: join(dir, "secret.txt"), webhookUrl: "https://example.test/api/max/reference" };
  const check = (value: unknown) => { writeFileSync(path, JSON.stringify(value)); return () => loadReferenceConfig(path); };
  assert.deepEqual(check(config)(), config);
  assert.throws(check({ ...config, stateDatabase: sourcePath }));
  linkSync(sourcePath, statePath);
  assert.throws(check({ ...config, stateDatabase: statePath }));
  assert.throws(check({ ...config, extra: true }));
  assert.throws(check({ ...config, webhookUrl: "http://example.test/api/max/reference" }));
  assert.throws(check({ ...config, webhookUrl: "https://example.test/api/max/reference?secret=value" }));
});

test("uncertain publications cannot resend after a restart; announcement is separately one-time", async () => {
  const { path, state } = await fixture();
  await state.beginPublication("reference");
  const other = await openReferenceState(path, destination); states.push(other);
  await assert.rejects(other.beginPublication("reference"));
  await assert.rejects(other.beginPublication("announcement"));
  await other.confirmPublication("reference", "mid");
  await other.activate();
  await other.beginPublication("announcement");
  await assert.rejects(state.beginPublication("announcement"));
  await other.confirmPublication("announcement", "notice");
  await assert.rejects(state.beginPublication("announcement"));
  await assert.rejects(state.resetUnsentPublication("reference"));
});

test("only an explicitly verified unsent publication can be reset while paused", async () => {
  const { state } = await fixture();
  await state.beginPublication("reference");
  await state.resetUnsentPublication("reference");
  await state.beginPublication("reference");
  await state.confirmPublication("reference", "mid");
  await state.activate();
  await state.beginPublication("announcement");
  await assert.rejects(state.resetUnsentPublication("announcement"));
  await state.pause();
  await state.resetUnsentPublication("announcement");
  assert.equal((await state.status()).announcement, "new");
});

test("callback parser rejects other groups, private chats, unknown buttons, foreign bots, stale/unsafe events", () => {
  assert.deepEqual(parseReferenceCallback(callback(), destination, now), { messageId: "mid", callbackId: "click-1", payload: powerReference.payload });
  const mutations = [
    (v: ReturnType<typeof callback>) => { v.message.recipient.chat_id = -999; },
    (v: ReturnType<typeof callback>) => { v.message.recipient.chat_type = "dialog"; },
    (v: ReturnType<typeof callback>) => { v.message.sender.user_id = 456; },
    (v: ReturnType<typeof callback>) => { v.callback.user.is_bot = true; },
    (v: ReturnType<typeof callback>) => { v.callback.payload = "__proto__"; },
    (v: ReturnType<typeof callback>) => { v.callback.payload = "reference:private"; },
    (v: ReturnType<typeof callback>) => { v.callback.timestamp = now - 49 * 3600000; },
    (v: ReturnType<typeof callback>) => { v.callback.timestamp = now + 600000; },
    (v: ReturnType<typeof callback>) => { v.message.recipient.chat_id = Number.MAX_SAFE_INTEGER + 1; },
    (v: ReturnType<typeof callback>) => { v.update_type = "message_created"; }
  ];
  for (const mutate of mutations) { const value = callback(); mutate(value); assert.equal(parseReferenceCallback(value, destination, now), null); }
  for (const value of [null, [], {}, { ...callback(), message: null }]) assert.equal(parseReferenceCallback(value, destination, now), null);
});

test("webhook authenticates before reading/queuing and returns retryable 503 on state failure", async () => {
  let calls = 0;
  const open = async () => { calls++; throw new Error("private database path"); };
  assert.equal((await handleReferenceWebhook(request(callback(), "wrong"), secret, destination, open, now)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await handleReferenceWebhook(request({ update_type: "message_created", text: "private" }), secret, destination, open, now)).status, 200);
  assert.equal(calls, 0);
  const result = await handleReferenceWebhook(request(), secret, destination, open, now);
  assert.equal(result.status, 503); assert.equal(await result.text(), ""); assert.equal(calls, 1);
  assert.equal((await handleReferenceWebhook(request("x".repeat(66000)), secret, destination, open, now)).status, 400);
  assert.equal(calls, 1);
});

test("webhook persists one request per callback and ignores a copied keyboard from another message", async () => {
  const { state } = await active();
  const open = async () => ({ enqueue: state.enqueue.bind(state), close: async () => undefined });
  for (let i = 0; i < 2; i++) assert.equal((await handleReferenceWebhook(request(), secret, destination, open, now)).status, 200);
  const copied = callback(); copied.message.body.mid = "forwarded-message"; copied.callback.callback_id = "click-2";
  assert.equal((await handleReferenceWebhook(request(copied), secret, destination, open, now)).status, 200);
  const claim = await state.claim(now); assert(claim);
  assert.equal(claim.version, 1);
  await state.finish(claim, now);
  assert.equal((await state.status()).pending, false);
});

test("burst clicks coalesce; a later click during refresh remains pending and edits are spaced", async () => {
  const { state } = await active();
  for (let i = 0; i < 10; i++) await state.enqueue("mid", `click-${i}`, powerReference.payload, now);
  const first = await state.claim(now); assert(first); assert.equal(first.version, 10);
  assert.equal(await state.claim(now), null);
  await state.enqueue("mid", "click-later", powerReference.payload, now + 1);
  await state.finish(first, now + 2);
  assert.equal(await state.claim(now + 3), null);
  const next = await state.claim(now + 1002); assert(next); assert.equal(next.version, 11);
  assert.equal(next.callbackId, "click-later");
});

test("two workers cannot claim the same edit; restart recovers expired work without reusing old callback", async () => {
  const { path, state } = await active();
  const other = await openReferenceState(path, destination); states.push(other);
  await state.enqueue("mid", "click", powerReference.payload, now);
  const first = await state.claim(now); assert(first);
  assert.equal(await other.claim(now + 1), null);
  const next = await other.claim(now + referenceLeaseMs); assert(next); assert.equal(next.callbackId, null);
  assert.equal(await state.isCurrent(first, now + referenceLeaseMs), false);
  await state.finish(first, now + referenceLeaseMs);
  assert.equal((await other.status()).pending, true);
  await other.finish(next, now + referenceLeaseMs);
  assert.equal((await state.status()).pending, false);
});

test("failed callback retries a fresh snapshot by editing the original message, never sends a new one", async () => {
  const { state } = await active();
  await state.enqueue("mid", "click", powerReference.payload, now);
  let clock = now, version = 0;
  const calls: string[] = [];
  const client = {
    answerReference: async () => { calls.push("answer"); throw new MaxApiError("Expired callback", "not-sent", 400); },
    editReference: async (mid: string, body: { text: string }) => { calls.push(mid); assert.match(body.text, /version-2/); }
  };
  const build = async () => ({ ...message(), text: `version-${++version}` });
  assert.equal(await refreshReference(state, client, build, () => clock), "api-unavailable");
  assert.equal(await refreshReference(state, client, build, () => clock), "idle");
  clock += 30000;
  assert.equal(await refreshReference(state, client, build, () => clock), "updated");
  assert.deepEqual(calls, ["answer", "mid"]);
  assert.equal((await state.status()).pending, false);
});

test("snapshot failure leaves the old message; repeated failures pause for review without touching inventory", async () => {
  const { state } = await active();
  await state.enqueue("mid", "click", powerReference.payload, now);
  const client = { answerReference: async () => assert.fail("No API call"), editReference: async () => assert.fail("No API call") };
  for (let i = 0; i < 5; i++) assert.equal(await refreshReference(state, client, async () => { throw new Error("source failure"); }, () => now + i * 30000), "source-unavailable");
  assert.equal((await state.status()).enabled, false);
  assert.equal((await state.status()).pending, true);
});

test("pause during snapshot capture prevents any MAX call", async () => {
  const { state } = await active();
  await state.enqueue("mid", "click", powerReference.payload, now);
  const client = { answerReference: async () => assert.fail("No edit"), editReference: async () => assert.fail("No edit") };
  assert.equal(await refreshReference(state, client, async () => { await state.pause(); return message(); }, () => now), "lease-expired");
});

test("a deleted reference pauses after callback fallback; it never publishes a replacement", async () => {
  const { state } = await active();
  await state.enqueue("mid", "click", powerReference.payload, now);
  const client = { answerReference: async () => { throw new MaxApiError("gone", "not-sent", 404); },
    editReference: async () => { throw new MaxApiError("gone", "not-sent", 404); } };
  assert.equal(await refreshReference(state, client, async () => message(), () => now), "api-unavailable");
  assert.equal(await refreshReference(state, client, async () => message(), () => now + 30000), "needs-review");
  assert.equal((await state.status()).enabled, false);
});

test("API reference methods preserve HTML/button on answer and edit; they do not request private dialogs", async () => {
  const calls: { path: string; method: string }[] = [];
  const client = createMaxClient("test-token", async (url, init) => {
    const parsed = new URL(String(url)), body = JSON.parse(String(init?.body));
    calls.push({ path: parsed.pathname, method: String(init?.method) });
    assert.equal(parsed.origin, "https://platform-api2.max.ru");
    assert.equal(parsed.searchParams.has("user_id"), false);
    assert.deepEqual(parsed.pathname === "/answers" ? body.message : body, message());
    if (init?.method === "POST" && parsed.pathname === "/messages") {
      assert.equal(parsed.searchParams.get("chat_id"), "-456");
      return Response.json({ message: { body: { mid: "mid" } } });
    }
    assert.equal(parsed.searchParams.get(parsed.pathname === "/answers" ? "callback_id" : "message_id"), parsed.pathname === "/answers" ? "click" : "mid");
    return Response.json({ success: true });
  });
  await client.sendReference(destination.chatId, message());
  await client.answerReference("click", message());
  await client.editReference("mid", message());
  assert.deepEqual(calls, [{ path: "/messages", method: "POST" }, { path: "/answers", method: "POST" }, { path: "/messages", method: "PUT" }]);
});

test("reference API errors are redacted and uncertain publication is not automatically retried", async () => {
  let calls = 0;
  const client = createMaxClient("test-token", async () => { calls++; throw new Error("secret payload"); });
  await assert.rejects(client.sendReference(destination.chatId, message()), (error: unknown) => {
    assert(error instanceof MaxApiError); assert.equal(error.delivery, "unknown"); assert(!String(error).includes("secret payload")); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(client.editReference("", message()));
  for (const id of [".", "..", "../me", "mid/other", "mid\\other", "mid?extra=1", "mid#fragment", "mid%2Fother", "mid.%2e%2e", "mid.\n", "mid.one,mid.two", "mid&chat_id=-999"]) {
    await assert.rejects(client.getMessageIdentity(id));
  }
  await assert.rejects(client.answerReference("click", { ...message(), text: "x".repeat(4001) }));
  assert.equal(calls, 1);
});

test("reference subscription is callback-only; identity preflight rejects a renamed or wrong group", async () => {
  const client = createMaxClient("test-token", async (_, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { url: "https://example.test/api/max/reference", secret, update_types: ["message_callback"] });
    return Response.json({ success: true });
  });
  await client.subscribe("https://example.test/api/max/reference", secret, "reference");
  const mock = { getBotInfo: async () => ({ id: "123", name: "Report", username: "report_bot" }),
    getChatInfo: async () => ({ id: "-456", title: "Рапорт мастера", type: "chat", status: "active", participants: 11 }),
    getBotMembership: async () => ({ botId: "123", isAdmin: false }) };
  assert.deepEqual(await verifyReferenceDestination(mock, destination), { isAdmin: false });
  await assert.rejects(verifyReferenceDestination(mock, { ...destination, chatTitle: "Главный карьер" }));
  assert.deepEqual(Object.keys(referenceBuilders), [powerReference.payload]);
});

test("concurrent database connections accept one duplicate callback and grant one update claim", async () => {
  const { path, state } = await active();
  const other = await openReferenceState(path, destination); states.push(other);
  const accepted = await Promise.all([state.enqueue("mid", "same", powerReference.payload, now), other.enqueue("mid", "same", powerReference.payload, now)]);
  assert.equal(accepted.filter(Boolean).length, 1);
  const claims = await Promise.all([state.claim(now), other.claim(now)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean)?.version, 1);
});

test("actual route, private config, durable queue and read-only collector refresh one message end to end", async () => {
  const { path, state } = await active();
  const configPath = join(dir, "route-config.json"), secretPath = join(dir, "route-secret.txt");
  writeFileSync(secretPath, secret);
  writeFileSync(configPath, JSON.stringify({ ...destination, sourceDatabase: sourcePath, stateDatabase: path,
    tokenFile: join(dir, "unused-token"), webhookSecretFile: secretPath, webhookUrl: "https://example.test/api/max/reference" }));
  const previous = process.env.MAX_REFERENCE_CONFIG;
  const before = hash();
  const source = await openReferenceSource(sourcePath);
  try {
    delete process.env.MAX_REFERENCE_CONFIG;
    assert.equal((await POST(request())).status, 404);
    process.env.MAX_REFERENCE_CONFIG = configPath;
    const value = callback(); value.timestamp = Date.now(); value.callback.timestamp = Date.now();
    assert.equal((await POST(request(value, "wrong"))).status, 401);
    assert.equal((await POST(request(value))).status, 200);
    assert.equal((await state.status()).pending, true);
    let edits = 0;
    const client = { answerReference: async (id: string, body: { text: string }) => {
      assert.equal(id, "click-1"); assert.match(body.text, /ЭКГ-10 №4 \(в сборку\)/); assert.match(body.text, /Я-117 · гор\. \+100м/); edits++;
    }, editReference: async () => assert.fail("First callback should be answered") };
    assert.equal(await refreshReference(state, client, (_, at) => referenceBuilders[powerReference.payload](source, at)), "updated");
    assert.equal((await POST(request(value))).status, 200);
    assert.equal((await state.status()).pending, false);
    assert.equal(edits, 1);
    assert.equal(hash(), before);
  } finally {
    await source.$disconnect();
    if (previous === undefined) delete process.env.MAX_REFERENCE_CONFIG; else process.env.MAX_REFERENCE_CONFIG = previous;
  }
});

test("CLI preview and initialization require no token or network and cannot start sending implicitly", () => {
  const path = join(dir, "cli-config.json"), statePath = join(dir, "cli-state.db");
  writeFileSync(path, JSON.stringify({ ...destination, sourceDatabase: sourcePath, stateDatabase: statePath,
    tokenFile: join(dir, "nonexistent-token"), webhookSecretFile: join(dir, "nonexistent-secret"), webhookUrl: "https://example.test/api/max/reference" }));
  const cli = (mode: string, ...args: string[]) => execFileSync(process.execPath, [require.resolve("tsx/cli"), "scripts/run-max-reference.ts",
    "--config", path, "--mode", mode, ...args], { encoding: "utf8", stdio: "pipe", timeout: 30000 });
  const before = hash();
  assert.match(cli("preview"), /Я-117 · гор\. \+100м/);
  assert.equal(existsSync(statePath), false);
  assert.equal(JSON.parse(cli("init")).enabled, false);
  assert.equal(JSON.parse(cli("status")).messageId, null);
  for (const mode of ["publish", "subscribe", "announce", "run"]) assert.throws(() => cli(mode));
  assert.throws(() => cli("init"));
  assert.equal(hash(), before);
});

test("MAX message verification reads only the requested bot message and strips unrelated fields", async () => {
  for (const id of ["mid", dottedMessageId, "mid.token_123-abc"]) {
    const client = createMaxClient("test-token", async (url, init) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, "https://platform-api2.max.ru");
      assert.equal(parsed.pathname, "/messages"); assert.equal(init?.method, "GET");
      assert.deepEqual([...parsed.searchParams], [["message_ids", id]]);
      return Response.json({ messages: [{ sender: { is_bot: true, user_id: 123, first_name: "private" }, recipient: { chat_type: "chat", chat_id: -456 },
        body: { mid: id, text: "reference", attachments: message().attachments }, unrelated: "private" }] });
    });
    assert.deepEqual(await client.getMessageIdentity(id), { messageId: id, botId: "123", chatId: "-456", text: "reference", attachments: message().attachments });
  }
});

test("MAX ID lookup rejects missing, ambiguous or foreign messages without reading the group", async () => {
  const valid = { sender: { is_bot: true, user_id: 123 }, recipient: { chat_type: "chat", chat_id: -456 }, body: { mid: dottedMessageId } };
  const responses = [null, {}, { messages: null }, { message: valid }, { messages: [] }, { messages: [null] },
    { messages: [valid, valid] }, { messages: [{ ...valid, body: { mid: "mid.other" } }] },
    { messages: [{ ...valid, sender: { is_bot: false, user_id: 123 } }] },
    { messages: [{ ...valid, recipient: { chat_type: "dialog", chat_id: -456 } }] }];
  for (const response of responses) {
    const calls: { method: string | undefined; url: string }[] = [];
    const client = createMaxClient("test-token", async (url, init) => {
      calls.push({ method: init?.method, url: String(url) });
      return Response.json(response);
    });
    await assert.rejects(client.getMessageIdentity(dottedMessageId), MaxApiError);
    assert.deepEqual(calls, [{ method: "GET", url: `https://platform-api2.max.ru/messages?message_ids=${dottedMessageId}` }]);
  }
});

test("published dotted message IDs survive verification, activation and callback refresh without republication", async () => {
  const { path, state } = await fixture();
  const calls: string[] = [];
  const client = createMaxClient("test-token", async (url, init) => {
    const parsed = new URL(String(url));
    const call = `${init?.method} ${parsed.pathname}`;
    calls.push(call);
    if (call === "POST /messages") return Response.json({ message: { body: { mid: dottedMessageId } } });
    if (call === `GET /messages/${dottedMessageId}`) return Response.json({ message: "Not found" }, { status: 404 });
    if (call === "GET /messages") {
      assert.deepEqual([...parsed.searchParams], [["message_ids", dottedMessageId]]);
      return Response.json({ messages: [{ sender: { is_bot: true, user_id: 123 },
        recipient: { chat_type: "chat", chat_id: -456 }, body: { mid: dottedMessageId, attachments: message().attachments } }] });
    }
    assert.equal(call, "POST /answers");
    assert.equal(parsed.searchParams.get("callback_id"), "click-1");
    assert.deepEqual(JSON.parse(String(init?.body)), { message: message() });
    return Response.json({ success: true });
  });
  await state.beginPublication("reference");
  const sent = await client.sendReference(destination.chatId, message());
  await state.confirmPublication("reference", sent.messageId);
  const resumed = await openReferenceState(path, destination); states.push(resumed);
  const status = await resumed.status();
  assert.equal(status.messageId, dottedMessageId);
  assert.equal(status.publication, "sent");
  assert.equal(status.enabled, false);
  const identity = await client.getMessageIdentity(status.messageId!);
  assert.equal(identity.botId, destination.botId);
  assert.equal(identity.chatId, destination.chatId);
  await resumed.activate();
  const value = callback(); value.message.body.mid = dottedMessageId;
  const open = async () => ({ enqueue: resumed.enqueue.bind(resumed), close: async () => undefined });
  assert.equal((await handleReferenceWebhook(request(value), secret, destination, open, now)).status, 200);
  assert.equal(await refreshReference(resumed, client, async () => message(), () => now), "updated");
  assert.equal((await resumed.status()).pending, false);
  await assert.rejects(resumed.beginPublication("reference"));
  assert.deepEqual(calls, ["POST /messages", "GET /messages", "POST /answers"]);
});

test("PM2 reference configuration is opt-in, portable and has one separately named worker", () => {
  const previousConfig = process.env.MAX_REFERENCE_CONFIG, previousCa = process.env.MAX_REFERENCE_CA_FILE;
  const file = resolve("scripts/max-reference.pm2.cjs");
  try {
    delete process.env.MAX_REFERENCE_CONFIG; delete process.env.MAX_REFERENCE_CA_FILE;
    assert.throws(() => require(file), /Set absolute/);
    process.env.MAX_REFERENCE_CONFIG = join(dir, "private reference.json");
    process.env.MAX_REFERENCE_CA_FILE = join(dir, "ca.pem");
    const { apps } = require(file);
    assert.equal(apps.length, 1); assert.equal(apps[0].name, "raport-max-reference");
    assert.equal(apps[0].instances, 1); assert.equal(apps[0].cwd, process.cwd());
    assert.deepEqual(apps[0].args, ["scripts/run-max-reference.ts", "--config", process.env.MAX_REFERENCE_CONFIG, "--mode", "run", "--send"]);
  } finally {
    delete require.cache[file];
    if (previousConfig === undefined) delete process.env.MAX_REFERENCE_CONFIG; else process.env.MAX_REFERENCE_CONFIG = previousConfig;
    if (previousCa === undefined) delete process.env.MAX_REFERENCE_CA_FILE; else process.env.MAX_REFERENCE_CA_FILE = previousCa;
  }
});
