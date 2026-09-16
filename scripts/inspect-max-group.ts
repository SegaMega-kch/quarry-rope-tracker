import { readFileSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createMaxClient, MaxApiError } from "../lib/max-api";

async function main() {
  const { values } = parseArgs({ options: {
    "token-file": { type: "string" }, "expected-username": { type: "string" }, "expected-bot-id": { type: "string" },
    "group-name": { type: "string" }, output: { type: "string" }
  }, strict: true });
  if (!values["token-file"] || !values["expected-username"] || !values["expected-bot-id"] || !values["group-name"]) throw new Error("Missing explicit bot identity or group name");
  const file = statSync(values["token-file"]);
  if (!file.isFile() || !file.size || file.size > 4097) throw new Error("Invalid credential file");
  const client = createMaxClient(readFileSync(values["token-file"], "utf8").trim());
  const bot = await client.getBotInfo();
  if (bot.id !== values["expected-bot-id"] || bot.username !== values["expected-username"]) throw new Error("Unexpected bot identity");
  const discovery = await client.inspectLatestGroupConnections();
  const candidates = [];
  for (const id of discovery.chatIds) {
    const chat = await client.getChatInfo(id);
    if (chat.type !== "chat" || chat.status !== "active" || chat.title?.trim() !== values["group-name"].trim()) continue;
    const membership = await client.getBotMembership(id);
    if (membership.botId !== bot.id) throw new Error("Unexpected membership identity");
    candidates.push({ ...chat, isAdmin: membership.isAdmin });
  }
  const result = { checkedAt: new Date().toISOString(), bot, expectedGroup: values["group-name"], candidateOnly: true,
    blockedByWebhook: discovery.blockedByWebhook, candidates, messagesSent: 0, scheduleEnabled: false };
  if (values.output) writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof MaxApiError ? error.message : "MAX group check could not complete; credentials are not logged.");
  process.exitCode = 1;
});
