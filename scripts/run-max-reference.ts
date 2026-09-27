import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createMaxClient, MaxApiError } from "../lib/max-api";
import { loadReferenceConfig, openReferenceSource, readReferenceSecret } from "../lib/max-reference-config";
import { openReferenceState } from "../lib/max-reference-state";
import { powerReference, referenceAnnouncement, referenceBuilders } from "../lib/max-reference";
import { refreshReference, verifyReferenceDestination } from "../lib/max-reference-worker";

const modes = ["init", "status", "preview", "publish", "subscribe", "activate", "pause", "run", "announce", "resolve-sent", "resolve-unsent"];
async function main() {
  const { values } = parseArgs({ strict: true, options: { config: { type: "string" }, mode: { type: "string", default: "status" },
    send: { type: "boolean", default: false }, "message-id": { type: "string" }, kind: { type: "string", default: "reference" },
    "confirm-not-delivered": { type: "boolean", default: false }, "confirm-pinned": { type: "boolean", default: false },
    "confirm-tested": { type: "boolean", default: false } } });
  if (!values.config || !modes.includes(values.mode!)) throw new Error("Specify the private config and supported mode");
  const sends = ["publish", "subscribe", "run", "announce"].includes(values.mode!);
  if (sends !== values.send) throw new Error("Use --send only for explicitly approved publication/subscription/run/announcement");
  if (values.kind !== "reference" && values.kind !== "announcement") throw new Error("Unsupported publication kind");
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification must remain enabled");
  const config = loadReferenceConfig(values.config);
  if (values.mode === "preview") {
    const source = await openReferenceSource(config.sourceDatabase);
    try {
      const message = await referenceBuilders[powerReference.payload](source, new Date());
      console.log(message.text);
    } finally { await source.$disconnect(); }
    return;
  }
  const state = await openReferenceState(config.stateDatabase, config, values.mode === "init");
  let source: Awaited<ReturnType<typeof openReferenceSource>> | undefined;
  try {
    if (values.mode === "init" || values.mode === "status") { console.log(JSON.stringify(await state.status())); return; }
    if (values.mode === "pause") { await state.pause(); console.log("Reference paused; an in-flight edit may finish."); return; }
    if (values.mode === "resolve-unsent") {
      if (!values["confirm-not-delivered"]) throw new Error("Verify absence in the group before permitting a new send");
      await state.resetUnsentPublication(values.kind);
      console.log("Unconfirmed send reset. Nothing sent; reference remains paused."); return;
    }
    const client = createMaxClient(readFileSync(config.tokenFile, "utf8").trim());
    const membership = await verifyReferenceDestination(client, config);
    if (values.mode === "activate") {
      const status = await state.status();
      if (!status.messageId) throw new Error("Publish first");
      const message = await client.getMessageIdentity(status.messageId);
      if (message.botId !== config.botId || message.chatId !== config.chatId) throw new Error("Reference belongs to another group");
      await state.activate();
      console.log(JSON.stringify({ enabled: true, isAdmin: membership.isAdmin, messagesSent: 0 })); return;
    }
    if (values.mode === "subscribe") {
      const subscriptions = await client.getSubscriptions();
      if (subscriptions.some((subscription) => subscription.url !== config.webhookUrl || subscription.updateTypes.some((type) => type !== "message_callback"))) throw new Error("Review existing subscriptions before changing them");
      await client.subscribe(config.webhookUrl, readReferenceSecret(config), "reference");
      console.log("Callback-only webhook configured. No chat-message subscription or test message sent."); return;
    }
    if (values.mode === "resolve-sent") {
      if (!values["message-id"]) throw new Error("Specify the verified bot message ID");
      const message = await client.getMessageIdentity(values["message-id"]);
      if (message.botId !== config.botId || message.chatId !== config.chatId) throw new Error("Message belongs to another destination");
      if (values.kind === "reference") {
        const attachments = message.attachments as { type?: string; payload?: { buttons?: { type?: string; payload?: string }[][] } }[] | undefined;
        if (!Array.isArray(attachments) || !attachments.some((attachment) => attachment.type === "inline_keyboard" &&
          attachment.payload?.buttons?.some((row) => row.some((button) => button.type === "callback" && button.payload === powerReference.payload)))) throw new Error("Not the expected reference message");
      } else if (message.text !== referenceAnnouncement) throw new Error("Not the approved announcement");
      await state.confirmPublication(values.kind, message.messageId);
      console.log("Publication verified. No message sent."); return;
    }
    if (values.mode === "announce") {
      if (!values["confirm-pinned"] || !values["confirm-tested"]) throw new Error("Pin the reference and verify a live callback before announcing");
      await state.beginPublication("announcement");
      const sent = await client.sendText({ kind: "chat", id: config.chatId }, referenceAnnouncement);
      await state.confirmPublication("announcement", sent.messageId);
      console.log("Announcement confirmed."); return;
    }
    source = await openReferenceSource(config.sourceDatabase);
    const db = source;
    const build = (payload: string, now: Date) => {
      if (!Object.hasOwn(referenceBuilders, payload)) throw new Error("Unknown reference");
      return referenceBuilders[payload as keyof typeof referenceBuilders](db, now);
    };
    if (values.mode === "publish") {
      const message = await build(powerReference.payload, new Date());
      await state.beginPublication("reference");
      const sent = await client.sendReference(config.chatId, message);
      await state.confirmPublication("reference", sent.messageId);
      console.log(JSON.stringify({ messageId: sent.messageId, enabled: false, messagesSent: 1 })); return;
    }
    if (!(await state.status()).enabled) throw new Error("Explicit activation is required");
    let stopping = false, nextIdentityCheck = Date.now() + 600000, lastResult = "";
    const controller = new AbortController();
    const stop = () => { stopping = true; controller.abort(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      while (!stopping && (await state.status()).enabled) {
        if (Date.now() >= nextIdentityCheck) {
          try { await verifyReferenceDestination(client, config); nextIdentityCheck = Date.now() + 600000; }
          catch (error) {
            if (!(error instanceof MaxApiError)) { await state.pause(); throw error; }
            await sleep(30000, undefined, { signal: controller.signal }).catch(() => undefined);
            continue;
          }
        }
        const result = await refreshReference(state, client, build);
        if (result !== lastResult) console.log(JSON.stringify({ at: new Date().toISOString(), state: result }));
        lastResult = result;
        await sleep(1000, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  } finally { await source?.$disconnect(); await state.close(); }
}

main().catch(() => {
  console.error("MAX reference stopped. Check private configuration and reference status. Uncertain publications require manual review; no automatic resend.");
  process.exitCode = 1;
});
