import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { get } from "node:http";
import { join, dirname, basename, resolve } from "node:path";
import { startMaxSetup, saveBlankTokenFile } from "../lib/max-setup";
import { MaxApiError } from "../lib/max-api";

const page = readFileSync("scripts/max-setup.html", "utf8");
const bot = { id: "123", name: "Рапорт мастера", username: "se14353661_bot" };
const token = "local-test-not-a-real-token";
async function access(origin: string) {
  const response = await fetch(origin);
  const text = await response.text();
  const nonce = /script nonce="([a-f0-9]+)"/.exec(text)![1];
  return { response, text, headers: { Origin: origin, "Content-Type": "application/json", "X-Setup-Nonce": nonce } };
}

test("local token setup blocks cross-origin requests and wrong Host without inspecting secrets", async (t) => {
  let calls = 0;
  const server = await startMaxSetup({ expectedUsername: bot.username, page, verify: async () => { calls++; return bot; }, persist: () => assert.fail() });
  t.after(() => server.close());
  const { response, text, headers } = await access(server.origin);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.match(text, /type="password"/);
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(server.origin, { headers: { Host: "attacker.invalid" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(foreignHostStatus, 403);
  for (const unsafe of [{ ...headers, Origin: "https://attacker.invalid" }, { ...headers, "X-Setup-Nonce": "wrong" }, { "Content-Type": "application/json" }]) {
    assert.equal((await fetch(server.origin + "/token", { method: "POST", headers: unsafe, body: JSON.stringify({ token }) })).status, 403);
  }
  assert.equal(calls, 0);
  assert.equal((await fetch(server.origin + "/max-bot.token")).status, 404);
});

test("setup verifies the expected bot, saves once, never reflects tokens, and never sends messages", async (t) => {
  const saved: string[] = [];
  let expected = false;
  const server = await startMaxSetup({ expectedUsername: bot.username, page, verify: async () => ({ ...bot, username: expected ? bot.username : "wrong_bot" }), persist: (value) => saved.push(value) });
  t.after(() => server.close());
  const { headers } = await access(server.origin);
  const send = () => fetch(server.origin + "/token", { method: "POST", headers, body: JSON.stringify({ token }) });
  assert.equal((await send()).status, 400);
  assert.deepEqual(saved, []);
  expected = true;
  const response = await send();
  assert.equal(response.status, 200);
  const body = await response.text();
  assert(!body.includes(token));
  assert.match(body, /Сообщения не отправлялись/);
  assert.deepEqual(saved, [token]);
  assert.equal((await send()).status, 409);
  assert.deepEqual(saved, [token]);
});

test("setup handles invalid input, API errors and failed storage without exposing provider errors", async (t) => {
  let state = "api";
  const server = await startMaxSetup({ expectedUsername: bot.username, page, verify: async () => {
    if (state === "api") throw new MaxApiError(token, "not-sent", 401);
    return bot;
  }, persist: () => { throw new Error(token); } });
  t.after(() => server.close());
  const { headers } = await access(server.origin);
  const send = (body: string) => fetch(server.origin + "/token", { method: "POST", headers, body });
  for (const value of [null, "", "two lines\n", 123, "x".repeat(4100)]) assert.equal((await send(JSON.stringify({ token: value }))).status, 400);
  assert.equal((await send("invalid-json")).status, 400);
  const denied = await send(JSON.stringify({ token }));
  assert.equal(denied.status, 400);
  assert(!(await denied.text()).includes(token));
  state = "storage";
  const failed = await send(JSON.stringify({ token }));
  assert.equal(failed.status, 500);
  assert(!(await failed.text()).includes(token));
});

test("setup prevents concurrent checks from overwriting a successful token", async (t) => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const server = await startMaxSetup({ expectedUsername: bot.username, page, verify: async () => { started(); await gate; return bot; }, persist: () => { writes++; } });
  t.after(() => server.close());
  const { headers } = await access(server.origin);
  const send = () => fetch(server.origin + "/token", { method: "POST", headers, body: JSON.stringify({ token }) });
  const first = send();
  await entered;
  assert.equal((await send()).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(writes, 1);
});

test("credential storage preserves the existing file and refuses replacement of a filled token", () => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, "raport-token-test-"));
  try {
    const path = join(directory, "token");
    assert.throws(() => saveBlankTokenFile(path, token));
    writeFileSync(path, "\n");
    saveBlankTokenFile(path, token);
    assert.equal(readFileSync(path, "utf8"), token + "\n");
    assert.throws(() => saveBlankTokenFile(path, "replacement"));
    assert.equal(readFileSync(path, "utf8"), token + "\n");
  } finally {
    if (dirname(directory) !== root || !basename(directory).startsWith("raport-token-test-")) throw new Error("Unsafe test path");
    rmSync(directory, { recursive: true, force: true });
  }
});
