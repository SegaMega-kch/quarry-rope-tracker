import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createMaxClient } from "../lib/max-api";
import { openReportOutbox, ReportDestination } from "../lib/report-outbox";
import { captureDueReport, deliverNextPart } from "../lib/report-worker";
import { prepareShiftReport } from "../lib/shift-report";
import { collectShiftReport } from "../lib/shift-report-source";

type Configuration = ReportDestination & { sourceDatabase: string; outboxDatabase: string; tokenFile: string };
const modes = ["init", "status", "inspect", "introduction", "activate", "pause", "run", "resolve-sent", "resolve-retry"];

function configuration(path: string): Configuration {
  if (!isAbsolute(path)) throw new Error("Use an absolute private configuration path");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid configuration");
  const record = value as Record<string, unknown>;
  const keys = ["sourceDatabase", "outboxDatabase", "tokenFile", "botId", "botUsername", "chatId", "chatTitle"];
  if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => typeof record[key] !== "string" || !String(record[key]).trim())) {
    throw new Error("Configuration must contain only database/token paths and the approved destination identity");
  }
  const config = record as Configuration;
  for (const file of [config.sourceDatabase, config.outboxDatabase, config.tokenFile]) {
    if (!isAbsolute(file) || /[?#]/.test(file)) throw new Error("Use absolute plain file paths");
  }
  const source = statSync(config.sourceDatabase);
  if (!source.isFile() || !source.size) throw new Error("The existing inventory database is required");
  if (resolve(config.sourceDatabase) === resolve(config.outboxDatabase)) throw new Error("Inventory and outbox must be separate files");
  if (existsSync(config.outboxDatabase)) {
    const outbox = statSync(config.outboxDatabase);
    if (realpathSync(config.sourceDatabase) === realpathSync(config.outboxDatabase) || (source.dev === outbox.dev && source.ino === outbox.ino)) {
      throw new Error("Outbox resolves to the inventory database");
    }
  }
  return config;
}

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    config: { type: "string" }, mode: { type: "string", default: "status" }, send: { type: "boolean", default: false },
    "shift-end": { type: "string" }, part: { type: "string" }, "message-id": { type: "string" },
    "text-file": { type: "string" },
    "confirm-not-delivered": { type: "boolean", default: false }
  } });
  if (!values.config || !modes.includes(values.mode!)) throw new Error("Specify --config and a supported --mode");
  if (values.send && values.mode !== "run") throw new Error("--send is only valid for run mode");
  if (values.mode === "run" && !values.send) throw new Error("run requires explicit --send approval; use preview-shift-report.ts for local previews");
  const config = configuration(values.config);
  const outbox = await openReportOutbox(config.outboxDatabase, config, values.mode === "init");
  let db: PrismaClient | undefined;
  try {
    if (values.mode === "activate") {
      console.log(JSON.stringify({ enabled: true, nextShiftEnd: new Date(await outbox.activate()).toISOString(), messagesSent: 0 }));
    } else if (values.mode === "pause") {
      await outbox.pause();
      console.log("Report collection and new sends paused. An already in-flight request may finish.");
    } else if (["inspect", "introduction", "resolve-sent", "resolve-retry"].includes(values.mode!)) {
      if (!values["shift-end"] || !/(?:Z|[+-]\d{2}:\d{2})$/.test(values["shift-end"])) throw new Error("Specify --shift-end with its time zone");
      const end = new Date(values["shift-end"]).getTime();
      if (!Number.isSafeInteger(end)) throw new Error("Invalid shift end");
      if (values.mode === "introduction") {
        if (!values["text-file"] || !isAbsolute(values["text-file"])) throw new Error("Specify an absolute --text-file with the approved introduction");
        await outbox.setIntroduction(readFileSync(values["text-file"], "utf8").trim(), new Date(end));
        console.log(JSON.stringify({ introductionEnd: new Date(end).toISOString(), messagesSent: 0 }));
      } else if (values.mode === "inspect") console.log(JSON.stringify(await outbox.inspect(end), null, 2));
      else {
        const part = Number(values.part);
        if (values.mode === "resolve-sent") {
          if (!values["message-id"]) throw new Error("Specify the verified --message-id");
          await outbox.resolve(end, part, { deliveredMessageId: values["message-id"] });
        } else {
          if (!values["confirm-not-delivered"]) throw new Error("Confirm absence in the group with --confirm-not-delivered before allowing a retry");
          await outbox.resolve(end, part, { confirmedNotDelivered: true });
        }
        console.log("Part resolved. Delivery remains paused; no message was sent.");
      }
    } else if (values.mode === "run") {
      if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS validation must remain enabled");
      if (!(await outbox.status()).enabled) throw new Error("Schedule is disabled; explicit activation is required");
      const client = createMaxClient(readFileSync(config.tokenFile, "utf8").trim());
      const sourcePath = realpathSync(config.sourceDatabase).replaceAll("\\", "/");
      db = new PrismaClient({ datasources: { db: { url: `file:${sourcePath}` } } });
      const source = db;
      let stopping = false;
      const controller = new AbortController();
      const stop = () => { stopping = true; controller.abort(); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      let nextDeliveryCheck = 0;
      let lastState = "";
      const reportState = (state: string) => {
        if (state !== lastState) console.log(JSON.stringify({ at: new Date().toISOString(), state }));
        lastState = state;
      };
      try {
        while (!stopping) {
          if (!(await outbox.status()).enabled) { reportState("paused"); break; }
          // Always freeze due shifts before doing network work. The inventory is only read.
          const captured = await captureDueReport(outbox, async (period) => {
            const input = await source.$transaction((tx) => collectShiftReport(tx, period), { timeout: 60000 });
            return { report: prepareShiftReport(input), warnings: input.warnings };
          });
          if (captured) reportState("report-saved");
          if (stopping) break;
          if (Date.now() >= nextDeliveryCheck) {
            const result = await deliverNextPart(outbox, client);
            const status = await outbox.status();
            reportState(status.attention.length ? "needs-review" : result === "idle" ? "waiting" : result);
            nextDeliveryCheck = Date.now() + (["preflight-unavailable", "identity-mismatch"].includes(result) ? 60000 : 1000);
          }
          await sleep(captured ? 100 : 1000, undefined, { signal: controller.signal }).catch((error: Error) => {
            if (error.name !== "AbortError") throw error;
          });
        }
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    } else console.log(JSON.stringify(await outbox.status(), null, 2));
  } finally { await db?.$disconnect(); await outbox.close(); }
}

// Do not log arbitrary exceptions: filesystem/HTTP errors can contain private paths or payloads.
main().catch(() => {
  console.error("MAX report worker stopped. Check private configuration, outbox status and database access. No automatic resend of uncertain parts.");
  process.exitCode = 1;
});
