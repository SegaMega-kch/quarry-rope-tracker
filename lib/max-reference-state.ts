import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { referenceIdentity, type ReferenceDestination } from "./max-reference-config";
import { referenceBuilders } from "./max-reference";

type Tx = Prisma.TransactionClient;
type Settings = { version: number; destination: string; enabled: number; message_id: string | null;
  publication: string; announcement: string; requested: number; completed: number;
  payload: string | null; callback_id: string | null; attempt: string | null; lease_until: number;
  due_at: number; failures: number; code: string | null };
export type ReferenceClaim = { attempt: string; version: number; messageId: string; callbackId: string | null; payload: string };
export const referenceLeaseMs = 120000;

async function settings(db: Tx): Promise<Settings> {
  const [row] = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM reference_settings WHERE id = 1`;
  if (!row) throw new Error("Missing reference settings");
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== "bigint") return [key, value];
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error("Invalid reference integer");
    return [key, number];
  })) as Settings;
}

export async function openReferenceState(path: string, destination: ReferenceDestination, create = false) {
  if (!isAbsolute(path) || /[?#]/.test(path)) throw new Error("Use an absolute reference state filename");
  const identity = referenceIdentity(destination);
  if (create) closeSync(openSync(path, "wx", 0o600));
  const real = realpathSync(path);
  if (!statSync(real).isFile()) throw new Error("Reference state must be a regular file");
  const db = new PrismaClient({ datasources: { db: { url: `file:${real.replaceAll("\\", "/")}` } } });
  try {
    if (create) await db.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE TABLE reference_settings (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL,
        destination TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, message_id TEXT,
        publication TEXT NOT NULL DEFAULT 'new', announcement TEXT NOT NULL DEFAULT 'new',
        requested BIGINT NOT NULL DEFAULT 0, completed BIGINT NOT NULL DEFAULT 0, payload TEXT, callback_id TEXT,
        attempt TEXT, lease_until BIGINT NOT NULL DEFAULT 0, due_at BIGINT NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0, code TEXT)`;
      await tx.$executeRaw`CREATE TABLE reference_callbacks (key TEXT PRIMARY KEY, expires BIGINT NOT NULL)`;
      await tx.$executeRaw`INSERT INTO reference_settings (id, version, destination) VALUES (1, 1, ${identity})`;
    });
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`;
    if (tables.map((row) => row.name).join(",") !== "reference_callbacks,reference_settings") throw new Error("Not a reference state database; refusing changes");
    const row = await settings(db);
    if (row.version !== 1 || row.destination !== identity) throw new Error("Reference version or destination mismatch");
    await db.$executeRaw`PRAGMA synchronous = FULL`;
    return new ReferenceState(db, destination);
  } catch (error) { await db.$disconnect(); throw error; }
}

export class ReferenceState {
  constructor(private readonly db: PrismaClient, readonly destination: ReferenceDestination) {}
  close() { return this.db.$disconnect(); }
  private locked<T>(work: (tx: Tx, row: Settings) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE reference_settings SET id = id WHERE id = 1`;
      return work(tx, await settings(tx));
    }, { maxWait: 5000, timeout: 5000 });
  }
  async status() {
    const row = await settings(this.db);
    return { enabled: Boolean(row.enabled), messageId: row.message_id, publication: row.publication, announcement: row.announcement,
      pending: row.requested > row.completed, failures: row.failures, code: row.code };
  }
  async beginPublication(kind: "reference" | "announcement") {
    return this.locked(async (tx, row) => {
      const status = kind === "reference" ? row.publication : row.announcement;
      if (status !== "new" || (kind === "announcement" && (!row.enabled || !row.message_id))) throw new Error("Publication already attempted or reference not active; verify the group manually");
      // Uncertain sends stay in review across crashes. Never automatically create a duplicate.
      if (kind === "reference") await tx.$executeRaw`UPDATE reference_settings SET publication = 'review' WHERE id = 1`;
      else await tx.$executeRaw`UPDATE reference_settings SET announcement = 'review' WHERE id = 1`;
    });
  }
  async confirmPublication(kind: "reference" | "announcement", messageId: string) {
    if (!messageId.trim() || messageId.length > 1024 || /[\x00-\x1f\x7f]/.test(messageId)) throw new Error("Invalid reference message ID");
    await this.locked(async (tx, row) => {
      if (kind === "reference") {
        if (row.publication !== "review" || row.message_id) throw new Error("Reference is already bound or was never sent");
        await tx.$executeRaw`UPDATE reference_settings SET publication = 'sent', message_id = ${messageId} WHERE id = 1`;
      } else {
        if (row.announcement !== "review") throw new Error("Announcement was not attempted");
        await tx.$executeRaw`UPDATE reference_settings SET announcement = 'sent' WHERE id = 1`;
      }
    });
  }
  async resetUnsentPublication(kind: "reference" | "announcement") {
    await this.locked(async (tx, row) => {
      if (row.enabled || row.attempt) throw new Error("Pause and stop the worker before resolving a send");
      if (kind === "reference") {
        if (row.publication !== "review" || row.message_id) throw new Error("Only an unconfirmed publication can be resolved");
        await tx.$executeRaw`UPDATE reference_settings SET publication = 'new' WHERE id = 1`;
      } else {
        if (row.announcement !== "review") throw new Error("Only an unconfirmed announcement can be resolved");
        await tx.$executeRaw`UPDATE reference_settings SET announcement = 'new' WHERE id = 1`;
      }
    });
  }
  async activate() {
    await this.locked(async (tx, row) => {
      if (row.publication !== "sent" || !row.message_id) throw new Error("Publish and verify the reference first");
      await tx.$executeRaw`UPDATE reference_settings SET enabled = 1, failures = 0, code = NULL WHERE id = 1`;
    });
  }
  async pause() { await this.locked(async (tx) => { await tx.$executeRaw`UPDATE reference_settings SET enabled = 0 WHERE id = 1`; }); }
  async enqueue(messageId: string, callbackId: string, payload: string, now = Date.now()) {
    if (!Object.hasOwn(referenceBuilders, payload)) return false;
    const key = createHash("sha256").update(callbackId).digest("hex");
    return this.locked(async (tx, row) => {
      if (!row.enabled || row.message_id !== messageId) return false;
      await tx.$executeRaw`DELETE FROM reference_callbacks WHERE expires < ${now}`;
      const inserted = await tx.$executeRaw`INSERT OR IGNORE INTO reference_callbacks (key, expires) VALUES (${key}, ${now + 48 * 3600000})`;
      if (!inserted) return false;
      await tx.$executeRaw`UPDATE reference_settings SET requested = requested + 1, payload = ${payload}, callback_id = ${callbackId} WHERE id = 1`;
      return true;
    });
  }
  async claim(now = Date.now()): Promise<ReferenceClaim | null> {
    return this.locked(async (tx, row) => {
      if (!row.enabled || !row.message_id || !row.payload || row.requested <= row.completed || row.due_at > now || row.lease_until > now) return null;
      const attempt = randomUUID();
      await tx.$executeRaw`UPDATE reference_settings SET attempt = ${attempt}, lease_until = ${now + referenceLeaseMs} WHERE id = 1`;
      return { attempt, version: row.requested, messageId: row.message_id, callbackId: row.attempt ? null : row.callback_id, payload: row.payload };
    });
  }
  async isCurrent(claim: ReferenceClaim, now = Date.now()) {
    const row = await settings(this.db);
    return Boolean(row.enabled && row.attempt === claim.attempt && row.lease_until > now && row.message_id === claim.messageId);
  }
  async finish(claim: ReferenceClaim, now = Date.now()) {
    await this.locked(async (tx, row) => {
      if (row.attempt !== claim.attempt) return;
      await tx.$executeRaw`UPDATE reference_settings SET completed = ${claim.version}, attempt = NULL, lease_until = 0,
        due_at = ${now + 1000}, failures = 0, code = NULL,
        callback_id = CASE WHEN requested = ${claim.version} THEN NULL ELSE callback_id END WHERE id = 1`;
    });
  }
  async fail(claim: ReferenceClaim, code: "api-unavailable" | "source-unavailable" | "identity-mismatch" | "needs-review", fatal = false, now = Date.now()) {
    await this.locked(async (tx, row) => {
      if (row.attempt !== claim.attempt) return;
      await tx.$executeRaw`UPDATE reference_settings SET attempt = NULL, lease_until = 0, due_at = ${now + 30000},
        callback_id = NULL, failures = failures + 1, code = ${code}, enabled = ${fatal || row.failures >= 4 ? 0 : row.enabled} WHERE id = 1`;
    });
  }
}
