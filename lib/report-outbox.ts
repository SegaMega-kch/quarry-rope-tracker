import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { maxId } from "./max-api";
import { latestCompletedShift, prepareShiftReport, validatePeriod } from "./shift-report";

export type ReportDestination = { botId: string; botUsername: string; chatId: string; chatTitle: string };
export type PreparedReport = ReturnType<typeof prepareShiftReport>;
export const shiftMilliseconds = 12 * 60 * 60 * 1000;
export const sendLeaseMilliseconds = 120000;
const sendSpacing = 750;

type Settings = { version: number; destination: string; enabled: number; first_end: number | null; next_end: number | null; send_after: number;
  introduction: string | null; introduction_end: number | null };
export type ReportPart = { shift_end: number; part: number; text: string; state: "pending" | "sending" | "sent" | "review" | "blocked";
  attempt: string | null; attempts: number; due_at: number; started_at: number | null; message_id: string | null; code: string | null };
type Tx = Prisma.TransactionClient;

async function rows<T>(db: Tx, query: Prisma.Sql): Promise<T[]> {
  const result = await db.$queryRaw<Array<Record<string, unknown>>>(query);
  // SQLite raw INTEGER columns arrive as bigint, including millisecond timestamps.
  return result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== "bigint") return [key, value];
    const integer = Number(value);
    if (!Number.isSafeInteger(integer)) throw new Error("Outbox integer is outside safe range");
    return [key, integer];
  })) as T);
}

function destinationText(destination: ReportDestination) {
  if (!destination.botUsername.trim() || !destination.chatTitle.trim()) throw new Error("Specify the approved MAX identity and group");
  return JSON.stringify({ botId: maxId(destination.botId), botUsername: destination.botUsername,
    chatId: maxId(destination.chatId), chatTitle: destination.chatTitle });
}

function timestamp(now: Date) {
  if (!Number.isSafeInteger(now.getTime())) throw new Error("Invalid outbox time");
  return now.getTime();
}

export async function openReportOutbox(path: string, destination: ReportDestination, create = false) {
  if (!isAbsolute(path) || /[?#]/.test(path)) throw new Error("Use an absolute, plain outbox filename");
  const identity = destinationText(destination);
  // Creation is explicit and exclusive. Never initialize an existing inventory database.
  if (create) closeSync(openSync(path, "wx", 0o600));
  const realPath = realpathSync(path);
  if (!statSync(realPath).isFile()) throw new Error("Outbox must be a regular file");
  const db = new PrismaClient({ datasources: { db: { url: `file:${realPath.replaceAll("\\", "/")}` } } });
  try {
    if (create) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`CREATE TABLE report_settings (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL,
          destination TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, first_end BIGINT, next_end BIGINT, send_after BIGINT NOT NULL DEFAULT 0,
          introduction TEXT, introduction_end BIGINT)`;
        await tx.$executeRaw`CREATE TABLE report_snapshots (shift_end BIGINT NOT NULL PRIMARY KEY, snapshot TEXT NOT NULL, warnings TEXT NOT NULL)`;
        await tx.$executeRaw`CREATE TABLE report_parts (shift_end BIGINT NOT NULL REFERENCES report_snapshots(shift_end), part INTEGER NOT NULL,
          text TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'review', 'blocked')),
          attempt TEXT, attempts INTEGER NOT NULL DEFAULT 0, due_at BIGINT NOT NULL DEFAULT 0, started_at BIGINT,
          message_id TEXT, code TEXT, PRIMARY KEY (shift_end, part))`;
        await tx.$executeRaw`INSERT INTO report_settings (id, version, destination) VALUES (1, 1, ${identity})`;
      });
    }
    const tables = await rows<{ name: string }>(db, Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
    if (tables.map((table) => table.name).join(",") !== "report_parts,report_settings,report_snapshots") throw new Error("Not a report outbox; refusing database changes");
    const [settings] = await rows<Settings>(db, Prisma.sql`SELECT * FROM report_settings WHERE id = 1`);
    if (!settings || settings.version !== 1 || settings.destination !== identity) throw new Error("Outbox version or approved destination does not match");
    await db.$executeRaw`PRAGMA synchronous = FULL`;
    return new ReportOutbox(db, Object.freeze(JSON.parse(identity) as ReportDestination));
  } catch (error) { await db.$disconnect(); throw error; }
}

export class ReportOutbox {
  constructor(private readonly db: PrismaClient, readonly destination: ReportDestination) {}
  close() { return this.db.$disconnect(); }

  private locked<T>(work: (tx: Tx, settings: Settings) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      // Take the SQLite writer lock before any read/modify/write decision, across workers too.
      await tx.$executeRaw`UPDATE report_settings SET id = id WHERE id = 1`;
      const [settings] = await rows<Settings>(tx, Prisma.sql`SELECT * FROM report_settings WHERE id = 1`);
      return work(tx, settings);
    }, { maxWait: 10000, timeout: 10000 });
  }

  async activate(now = new Date()) {
    const first = latestCompletedShift(now).end.getTime() + shiftMilliseconds;
    return this.locked(async (tx, settings) => {
      if (settings.first_end === null && settings.introduction_end !== null && settings.introduction_end < first) {
        throw new Error("The approved introduction time has passed; review activation before proceeding");
      }
      // Restart/resume retains the cursor. First activation never backfills old history.
      await tx.$executeRaw`UPDATE report_settings SET enabled = 1, first_end = COALESCE(first_end, ${first}),
        next_end = COALESCE(next_end, ${first}) WHERE id = 1`;
      return settings.next_end ?? first;
    });
  }

  async pause() { await this.locked(async (tx) => { await tx.$executeRaw`UPDATE report_settings SET enabled = 0 WHERE id = 1`; }); }

  async setIntroduction(text: string, end: Date, now = new Date()) {
    const at = timestamp(end);
    validatePeriod({ start: new Date(at - shiftMilliseconds), end });
    if (end.getUTCHours() !== 3 || at <= timestamp(now) || !text.trim() || text.length > 4000) {
      throw new Error("Introduction requires a future 08:00 Yekaterinburg shift and 1-4000 characters");
    }
    await this.locked(async (tx, settings) => {
      if (settings.first_end !== null || settings.enabled) throw new Error("Configure the introduction before first activation");
      if (settings.introduction !== null && (settings.introduction !== text || settings.introduction_end !== at)) {
        throw new Error("An introduction has already been approved for this outbox");
      }
      await tx.$executeRaw`UPDATE report_settings SET introduction = ${text}, introduction_end = ${at} WHERE id = 1`;
    });
  }

  async due(now = new Date()) {
    const [settings] = await rows<Settings>(this.db, Prisma.sql`SELECT * FROM report_settings WHERE id = 1`);
    return settings.enabled && settings.next_end !== null && settings.next_end <= timestamp(now)
      ? { start: new Date(settings.next_end - shiftMilliseconds), end: new Date(settings.next_end) } : null;
  }

  async save(report: PreparedReport, warnings: string[] = []) {
    const start = new Date(report.period.start), end = new Date(report.period.end), captured = new Date(report.capturedAt);
    validatePeriod({ start, end });
    if (report.version !== 1 || !Number.isFinite(captured.getTime()) || captured < end || !report.messages.length ||
      report.messages.some((text) => typeof text !== "string" || !text.trim() || text.length > 4000)) throw new Error("Invalid prepared report");
    const key = end.getTime();
    // Serialization before awaiting also prevents the caller from changing the saved snapshot.
    const frozen = JSON.stringify(report), frozenWarnings = JSON.stringify(warnings), messages = [...report.messages];
    return this.locked(async (tx, settings) => {
      if (!settings.enabled || settings.next_end !== key) return false;
      await tx.$executeRaw`INSERT INTO report_snapshots (shift_end, snapshot, warnings) VALUES (${key}, ${frozen}, ${frozenWarnings})`;
      if (settings.introduction_end === key && settings.introduction) {
        await tx.$executeRaw`INSERT INTO report_parts (shift_end, part, text, state) VALUES (${key}, 0, ${settings.introduction}, 'pending')`;
      }
      for (let part = 0; part < messages.length; part++) {
        await tx.$executeRaw`INSERT INTO report_parts (shift_end, part, text, state) VALUES (${key}, ${part + 1}, ${messages[part]}, 'pending')`;
      }
      await tx.$executeRaw`UPDATE report_settings SET next_end = ${key + shiftMilliseconds} WHERE id = 1`;
      return true;
    });
  }

  private async recover(tx: Tx, now: number) {
    await tx.$executeRaw`UPDATE report_parts SET state = 'review', code = 'interrupted-send'
      WHERE state = 'sending' AND started_at <= ${now - sendLeaseMilliseconds}`;
  }

  private async available(tx: Tx, settings: Settings, now: number) {
    await this.recover(tx, now);
    if (!settings.enabled || settings.send_after > now) return null;
    const [obstacle] = await rows<{ count: number }>(tx, Prisma.sql`SELECT COUNT(*) AS count FROM report_parts WHERE state IN ('sending', 'review', 'blocked')`);
    if (obstacle.count) return null;
    const [part] = await rows<ReportPart>(tx, Prisma.sql`SELECT * FROM report_parts WHERE state != 'sent' ORDER BY shift_end, part LIMIT 1`);
    return part?.state === "pending" && part.due_at <= now ? part : null;
  }

  async ready(now = new Date()) {
    return this.locked(async (tx, settings) => Boolean(await this.available(tx, settings, timestamp(now))));
  }

  async claim(now = new Date()) {
    const at = timestamp(now);
    return this.locked(async (tx, settings) => {
      const part = await this.available(tx, settings, at);
      if (!part) return null;
      const attempt = randomUUID();
      await tx.$executeRaw`UPDATE report_parts SET state = 'sending', attempt = ${attempt}, attempts = attempts + 1,
        started_at = ${at}, code = NULL WHERE shift_end = ${part.shift_end} AND part = ${part.part}`;
      return { ...part, state: "sending" as const, attempt, attempts: part.attempts + 1, started_at: at };
    });
  }

  async finish(part: ReportPart, result: { state: "sent" | "pending" | "review" | "blocked"; messageId?: string; code?: string; retryAt?: number }, now = new Date()) {
    const at = timestamp(now);
    if (!part.attempt || (result.state === "sent" && !result.messageId)) throw new Error("Missing delivery confirmation");
    return this.locked(async (tx) => {
      // Late confirmation can settle its own expired lease, but cannot overwrite a manual resolution.
      const changed = await tx.$executeRaw`UPDATE report_parts SET state = ${result.state}, message_id = ${result.messageId ?? null},
        code = ${result.code ?? null}, due_at = ${result.retryAt ?? 0}
        WHERE shift_end = ${part.shift_end} AND part = ${part.part} AND attempt = ${part.attempt} AND state IN ('sending', 'review')`;
      if (changed) await tx.$executeRaw`UPDATE report_settings SET send_after = MAX(send_after, ${at + sendSpacing}) WHERE id = 1`;
      return Boolean(changed);
    });
  }

  async resolve(end: number, part: number, decision: { deliveredMessageId: string } | { confirmedNotDelivered: true }, now = new Date()) {
    if (!Number.isSafeInteger(end) || !Number.isSafeInteger(part) || part < 0) throw new Error("Invalid report part");
    if ("deliveredMessageId" in decision && !decision.deliveredMessageId.trim()) throw new Error("Specify the confirmed MAX message ID");
    return this.locked(async (tx, settings) => {
      if (settings.enabled) throw new Error("Pause delivery before manually resolving a part");
      await this.recover(tx, timestamp(now));
      const sent = "deliveredMessageId" in decision;
      const changed = await tx.$executeRaw`UPDATE report_parts SET state = ${sent ? "sent" : "pending"}, attempt = NULL,
        message_id = ${sent ? decision.deliveredMessageId : null}, code = ${sent ? "manually-confirmed" : "manually-confirmed-not-delivered"}, due_at = 0
        WHERE shift_end = ${end} AND part = ${part} AND state IN ('review', 'blocked')`;
      if (!changed) throw new Error("Part is not waiting for manual review");
    });
  }

  async inspect(end: number) {
    const [saved] = await rows<{ snapshot: string; warnings: string }>(this.db, Prisma.sql`SELECT snapshot, warnings FROM report_snapshots WHERE shift_end = ${end}`);
    if (!saved) return null;
    return { report: JSON.parse(saved.snapshot) as PreparedReport, warnings: JSON.parse(saved.warnings) as string[],
      parts: await rows<ReportPart>(this.db, Prisma.sql`SELECT * FROM report_parts WHERE shift_end = ${end} ORDER BY part`) };
  }

  async status() {
    const [settings] = await rows<Settings>(this.db, Prisma.sql`SELECT * FROM report_settings WHERE id = 1`);
    const counts = await rows<{ state: string; count: number }>(this.db, Prisma.sql`SELECT state, COUNT(*) AS count FROM report_parts GROUP BY state ORDER BY state`);
    const attention = await rows<{ shift_end: number; part: number; state: string; code: string | null }>(this.db,
      Prisma.sql`SELECT shift_end, part, state, code FROM report_parts WHERE state IN ('review', 'blocked') ORDER BY shift_end, part`);
    return { enabled: Boolean(settings.enabled), firstEnd: settings.first_end, nextEnd: settings.next_end,
      introductionEnd: settings.introduction_end, counts, attention };
  }
}
