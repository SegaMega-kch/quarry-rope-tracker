import assert from "node:assert/strict";
import { test } from "node:test";
import { createMaxClient, maxId, MaxApiError } from "../lib/max-api";

const token = "test-private-token";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("checking the token only reads bot information at the fixed official origin", async () => {
  let calls = 0;
  const client = createMaxClient(token, async (url, init) => {
    calls++;
    assert.equal(String(url), "https://platform-api2.max.ru/me");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), token);
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert(init?.signal);
    return json({ user_id: 123, first_name: "Report", is_bot: true, username: "report_bot", extra: "private" });
  });
  assert.deepEqual(await client.getBotInfo(), { id: "123", name: "Report", username: "report_bot" });
  assert.equal(calls, 1);
  assert(!JSON.stringify(client).includes(token));
});

test("sending uses one explicit recipient and plain text, without exposing the token in the URL", async () => {
  const client = createMaxClient(token, async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://platform-api2.max.ru");
    assert.equal(parsed.pathname, "/messages");
    assert.equal(parsed.searchParams.get("chat_id"), "-9223372036854775808");
    assert.equal(parsed.searchParams.has("user_id"), false);
    assert.equal(parsed.searchParams.get("disable_link_preview"), "true");
    assert(!String(url).includes(token));
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { text: "<b>literal</b>", notify: true });
    return json({ message: { body: { mid: "message-123" } } });
  });
  assert.deepEqual(await client.sendText({ kind: "chat", id: "-9223372036854775808" }, "<b>literal</b>"), { messageId: "message-123" });
});

test("local group discovery reads only bot-added events and leaves existing webhooks untouched", async () => {
  const paths: string[] = [];
  const client = createMaxClient(token, async (url, init) => {
    const path = new URL(String(url));
    paths.push(path.pathname);
    assert.equal(init?.method, "GET");
    if (path.pathname === "/subscriptions") return json({ subscriptions: [] });
    assert.equal(path.searchParams.get("types"), "bot_added");
    assert.equal(path.searchParams.get("timeout"), "0");
    assert.equal(path.searchParams.has("marker"), false);
    return json({ updates: [
      { update_type: "bot_added", chat_id: -123, user: { private: token } },
      { update_type: "bot_added", chat_id: -123 },
      { update_type: "bot_added", chat_id: -456, is_channel: true },
      { update_type: "message_created", chat_id: -789, text: token }
    ], marker: 1234 });
  });
  assert.deepEqual(await client.inspectLatestGroupConnections(), { blockedByWebhook: false, chatIds: ["-123"] });
  assert.deepEqual(paths, ["/subscriptions", "/updates"]);
  const active = createMaxClient(token, async (url) => {
    assert.equal(new URL(String(url)).pathname, "/subscriptions");
    return json({ subscriptions: [{ url: "https://private.example" }] });
  });
  assert.deepEqual(await active.inspectLatestGroupConnections(), { blockedByWebhook: true, chatIds: [] });
});

test("chat and own-membership checks return only destination metadata, never pinned messages or user details", async () => {
  const client = createMaxClient(token, async (url, init) => {
    assert.equal(init?.method, "GET");
    const path = new URL(String(url)).pathname;
    if (path === "/chats/-123/members/me") return json({ user_id: 321, is_bot: true, is_admin: true, private: token });
    assert.equal(path, "/chats/-123");
    return json({ chat_id: -123, type: "chat", status: "active", title: "Главный карьер", participants_count: 10, pinned_message: { text: token }, owner_id: 42 });
  });
  assert.deepEqual(await client.getChatInfo("-123"), { id: "-123", type: "chat", status: "active", title: "Главный карьер", participants: 10 });
  assert.deepEqual(await client.getBotMembership("-123"), { botId: "321", isAdmin: true });
  await assert.rejects(client.getChatInfo("1/../../messages"));
  await assert.rejects(client.getBotMembership("bad"));
});

test("unsafe IDs, missing tokens and invalid messages are rejected before networking", async () => {
  assert.throws(() => createMaxClient(""));
  assert.throws(() => createMaxClient("token\r\ninjected"));
  for (const id of [0, "01", "12x", "9223372036854775808", "-9223372036854775809", 9007199254740992, null]) {
    assert.throws(() => maxId(id));
  }
  assert.equal(maxId("9223372036854775807"), "9223372036854775807");
  const client = createMaxClient(token, async () => { assert.fail("Must not call MAX"); });
  await assert.rejects(client.sendText({ kind: "chat", id: "bad" }, "test"));
  await assert.rejects(client.sendText({ kind: "user", id: "-1" }, "test"));
  for (const text of [" ", "x".repeat(4001)]) await assert.rejects(client.sendText({ kind: "chat", id: "-1" }, text));
});

test("ambiguous POST failures are not retried and sensitive errors are redacted", async () => {
  for (const result of ["network", "invalid-json", "missing-id", 408, 500, 401, 429] as const) {
    let calls = 0;
    const client = createMaxClient(token, async () => {
      calls++;
      if (result === "network") throw new Error(`Leaked ${token}`);
      if (result === "invalid-json") return new Response(token);
      if (result === "missing-id") return json({ secret: token });
      return json({ error: token }, result);
    });
    await assert.rejects(client.sendText({ kind: "chat", id: "-1" }, "test"), (error: unknown) => {
      assert(error instanceof MaxApiError);
      assert.equal(error.delivery, result === 401 || result === 429 ? "not-sent" : "unknown");
      assert(!String(error).includes(token));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("webhook subscription is limited to bot connection events and requires HTTPS plus a secret", async () => {
  let calls = 0;
  const secret = "s".repeat(32);
  const client = createMaxClient(token, async (url, init) => {
    calls++;
    assert.equal(String(url), "https://platform-api2.max.ru/subscriptions");
    assert.deepEqual(JSON.parse(String(init?.body)), { url: "https://example.com/api/max/webhook", secret, update_types: ["bot_added", "bot_started"] });
    return json({ success: true });
  });
  for (const url of ["http://example.com", "https://example.com:8443", "https://user:pass@example.com", "https://example.com/?secret=bad"]) {
    await assert.rejects(client.subscribe(url, secret));
  }
  await assert.rejects(client.subscribe("https://example.com/api/max/webhook", "short"));
  assert.equal(calls, 0);
  await client.subscribe("https://example.com/api/max/webhook", secret);
  assert.equal(calls, 1);
});
