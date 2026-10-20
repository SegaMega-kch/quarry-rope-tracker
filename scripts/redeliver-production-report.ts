import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { createMaxClient } from "../lib/max-api";
import { loadProductionDeliveryConfiguration, readProductionDeliveryToken } from "../lib/production-delivery-config";
import { renderProductionReportImages } from "../lib/production-report-image";
import { openProductionStore } from "../lib/production-store";

const values = parseArgs({ options: {
  database: { type: "string" }, version: { type: "string" },
  "expected-message": { type: "string" }, receipt: { type: "string" },
  "confirm-font-repair": { type: "boolean" },
} }).values;

function required(name: "database" | "version" | "expected-message" | "receipt") {
  const value = values[name]?.trim();
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function main() {
  const database = required("database"), versionId = required("version");
  const expectedMessage = required("expected-message"), receipt = required("receipt");
  if (!values["confirm-font-repair"]) throw new Error("Missing --confirm-font-repair");
  if (![database, receipt].every(path => isAbsolute(path) && !/[?#]/.test(path))) throw new Error("Database and receipt paths must be absolute");
  if (!/^[0-9a-f-]{36}$/i.test(versionId) || !/^[\w.-]{1,200}$/.test(expectedMessage)) throw new Error("Invalid version or prior message ID");
  if (existsSync(receipt)) throw new Error("This repair redelivery was already attempted; inspect the receipt and MAX group");

  const store = await openProductionStore(database);
  let locked = false;
  try {
    const config = loadProductionDeliveryConfiguration();
    const version = await store.version(versionId);
    const prior = await store.delivery(versionId, config.chatId);
    if (version.kind !== "final" || prior?.state !== "sent" || prior.message_id !== expectedMessage) {
      throw new Error("The saved final version or its confirmed prior delivery does not match");
    }
    const client = createMaxClient(readProductionDeliveryToken(config));
    const [bot, chat, membership] = await Promise.all([client.getBotInfo(), client.getChatInfo(config.chatId), client.getBotMembership(config.chatId)]);
    if (bot.id !== config.botId || bot.username !== config.botUsername || chat.id !== config.chatId || chat.type !== "chat" || chat.status !== "active" || chat.title?.trim() !== config.chatTitle.trim() || membership.botId !== config.botId) {
      throw new Error("The verified MAX bot or group does not match the configuration");
    }
    const images = await renderProductionReportImages(version);
    if (!images.length || images.length > 12) throw new Error("Invalid image count");

    writeFileSync(receipt, JSON.stringify({ format: 1, versionId, priorMessageId: expectedMessage, state: "started", at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    locked = true;
    const tokens: string[] = [];
    for (let index = 0; index < images.length; index++) tokens.push((await client.uploadImage(images[index], `shift-report-${versionId}-font-repair-${index + 1}.png`)).token);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const sent = await client.sendImages({ kind: "chat", id: config.chatId }, tokens);
    writeFileSync(receipt, JSON.stringify({ format: 1, versionId, priorMessageId: expectedMessage, state: "sent", messageId: sent.messageId, images: images.length, at: new Date().toISOString() }), { mode: 0o600 });
    console.log(JSON.stringify({ status: "sent", versionId, messageId: sent.messageId, images: images.length }));
  } catch (error) {
    if (locked) writeFileSync(receipt, JSON.stringify({ format: 1, versionId, priorMessageId: expectedMessage, state: "stopped", at: new Date().toISOString() }), { mode: 0o600 });
    throw error;
  } finally {
    await store.close();
  }
}

main().catch(() => {
  console.error("Repair redelivery stopped. Inspect the receipt and MAX group; do not retry automatically.");
  process.exitCode = 1;
});
