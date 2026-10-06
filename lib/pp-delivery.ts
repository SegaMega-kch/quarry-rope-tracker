import { PrismaClient, type Prisma } from "@prisma/client";
import { closeSync, openSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { referenceIdentity, type ReferenceDestination } from "./max-reference-config";
import { MaxApiError, type createMaxClient } from "./max-api";

type Tx = Prisma.TransactionClient;
type Client = Pick<ReturnType<typeof createMaxClient>, "getBotInfo" | "getChatInfo" | "getBotMembership" | "sendText">;
type Batch = { id: string; state: string; created: bigint | number; finished: bigint | number | null };
export type PpSendResult = { state: "sent" | "failed" | "sending" | "review" | "cooldown" | "closed"; message: string; retryAfterMs?: number };
const cooldownMs = 30000;
const uncertainAfterMs = 120000;
const requestPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function result(row: Batch, now: number): PpSendResult {
  if (row.state === "sent") return { state: "sent", message: "Земля отправлена в группу «Рапорт мастера»." };
  if (row.state === "failed") return { state: "failed", message: "Не отправлено. Проверьте подключение и настройки MAX." };
  if (row.state === "closed") return { state: "closed", message: "Отправка проверена оператором. Можно передать новую сводку." };
  if (row.state === "sending" && now - Number(row.created) < uncertainAfterMs) {
    return { state: "sending", message: "Предыдущая отправка ещё выполняется. Проверьте результат немного позже." };
  }
  return { state: "review", message: "Результат предыдущей отправки не подтверждён. Проверьте группу и обратитесь к администратору. Автоматического повтора не будет." };
}

export async function openPpDeliveryState(path: string, destination: ReferenceDestination, create = false) {
  if (!isAbsolute(path) || /[?#]/.test(path)) throw new Error("Use an absolute PP state path");
  const identity = referenceIdentity(destination);
  if (create) closeSync(openSync(path, "wx", 0o600));
  const real = realpathSync(path);
  if (!statSync(real).isFile()) throw new Error("PP state must be a regular file");
  const db = new PrismaClient({ datasources: { db: { url: `file:${real.replaceAll("\\", "/")}?connection_limit=1` } } });
  try {
    if (create) await db.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE TABLE pp_manual_settings (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, destination TEXT NOT NULL)`;
      await tx.$executeRaw`CREATE TABLE pp_manual_batches (id TEXT PRIMARY KEY, actor INTEGER NOT NULL, state TEXT NOT NULL, created BIGINT NOT NULL, finished BIGINT)`;
      await tx.$executeRaw`CREATE TABLE pp_manual_parts (batch TEXT NOT NULL REFERENCES pp_manual_batches(id), part INTEGER NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, message_id TEXT, PRIMARY KEY (batch, part))`;
      await tx.$executeRaw`INSERT INTO pp_manual_settings VALUES (1, 1, ${identity})`;
    });
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`;
    if (tables.map((item) => item.name).join(",") !== "pp_manual_batches,pp_manual_parts,pp_manual_settings") throw new Error("Not a PP delivery database");
    const [settings] = await db.$queryRaw<{ version: number; destination: string }[]>`SELECT version, destination FROM pp_manual_settings WHERE id = 1`;
    if (!settings || Number(settings.version) !== 1 || settings.destination !== identity) throw new Error("PP delivery destination mismatch");
    await db.$executeRaw`PRAGMA synchronous = FULL`;
    return new PpDeliveryState(db, destination);
  } catch (error) { await db.$disconnect(); throw error; }
}

export class PpDeliveryState {
  constructor(private readonly db: PrismaClient, readonly destination: ReferenceDestination) {}
  close() { return this.db.$disconnect(); }
  private locked<T>(work: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE pp_manual_settings SET id = id WHERE id = 1`;
      return work(tx);
    }, { maxWait: 5000, timeout: 5000 });
  }
  async begin(id: string, actor: number, messages: string[], now = Date.now()): Promise<PpSendResult | null> {
    if (!requestPattern.test(id) || !Number.isSafeInteger(actor) || actor < 1) throw new Error("Invalid PP request");
    if (!messages.length || messages.some((text) => !text.trim() || text.length > 4000)) throw new Error("Invalid PP message");
    return this.locked(async (tx) => {
      const [same] = await tx.$queryRaw<Batch[]>`SELECT * FROM pp_manual_batches WHERE id = ${id}`;
      if (same) return result(same, now);
      const [unresolved] = await tx.$queryRaw<Batch[]>`SELECT * FROM pp_manual_batches WHERE state IN ('sending', 'review') ORDER BY created LIMIT 1`;
      if (unresolved) return result(unresolved, now);
      const [last] = await tx.$queryRaw<Batch[]>`SELECT * FROM pp_manual_batches ORDER BY created DESC LIMIT 1`;
      const retryAfterMs = last ? Math.max(0, Number(last.finished ?? last.created) + cooldownMs - now) : 0;
      if (retryAfterMs) return { state: "cooldown", message: "Сводку уже передавали недавно. Повторная отправка доступна через 30 секунд.", retryAfterMs };
      await tx.$executeRaw`INSERT INTO pp_manual_batches (id, actor, state, created) VALUES (${id}, ${actor}, 'sending', ${now})`;
      for (let part = 0; part < messages.length; part++) {
        await tx.$executeRaw`INSERT INTO pp_manual_parts (batch, part, text, state) VALUES (${id}, ${part}, ${messages[part]}, 'new')`;
      }
      return null;
    });
  }
  async parts(id: string) {
    return this.db.$queryRaw<{ part: number; text: string; state: string; message_id: string | null }[]>`SELECT part, text, state, message_id FROM pp_manual_parts WHERE batch = ${id} ORDER BY part`;
  }
  async beforePost(id: string, part: number) {
    // Commit uncertainty BEFORE the external side effect. A crash can never replay this part.
    const count = await this.db.$executeRaw`UPDATE pp_manual_parts SET state = 'review' WHERE batch = ${id} AND part = ${part} AND state = 'new'
      AND EXISTS (SELECT 1 FROM pp_manual_batches WHERE id = ${id} AND state = 'sending')`;
    if (count !== 1) throw new Error("PP part already attempted");
  }
  async confirm(id: string, part: number, messageId: string) {
    if (!messageId.trim() || messageId.length > 1024 || /[\x00-\x1f\x7f]/.test(messageId)) throw new Error("Invalid PP message ID");
    const count = await this.db.$executeRaw`UPDATE pp_manual_parts SET state = 'sent', message_id = ${messageId} WHERE batch = ${id} AND part = ${part} AND state = 'review'`;
    if (count !== 1) throw new Error("PP confirmation could not be recorded");
  }
  async finish(id: string, state: "sent" | "failed" | "review", now = Date.now()) {
    await this.locked(async (tx) => {
      if (state === "sent") {
        const [remaining] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM pp_manual_parts WHERE batch = ${id} AND state <> 'sent'`;
        if (Number(remaining.count)) throw new Error("PP message parts not confirmed");
      }
      await tx.$executeRaw`UPDATE pp_manual_batches SET state = ${state}, finished = ${now} WHERE id = ${id} AND state = 'sending'`;
    });
    return result({ id, state, created: now, finished: now }, now);
  }
  async status(now = Date.now()) {
    const rows = await this.db.$queryRaw<Batch[]>`SELECT * FROM pp_manual_batches ORDER BY created DESC LIMIT 10`;
    return rows.map((row) => ({ id: row.id, createdAt: new Date(Number(row.created)).toISOString(), ...result(row, now) }));
  }
  async acknowledge(id: string, now = Date.now()) {
    if (!requestPattern.test(id)) throw new Error("Invalid PP request");
    await this.locked(async (tx) => {
      const [row] = await tx.$queryRaw<Batch[]>`SELECT * FROM pp_manual_batches WHERE id = ${id}`;
      if (!row || !["sending", "review"].includes(row.state) || now - Number(row.created) < uncertainAfterMs) {
        throw new Error("Wait for any in-flight operation and inspect the group first");
      }
      await tx.$executeRaw`UPDATE pp_manual_batches SET state = 'closed', finished = ${now} WHERE id = ${id}`;
    });
  }
}

export async function deliverPpSnapshot(state: PpDeliveryState, client: Client, id: string, actor: number,
  messages: string[], clock = Date.now, pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const existing = await state.begin(id, actor, messages, clock());
  if (existing) return existing;
  const destination = state.destination;
  try {
    const bot = await client.getBotInfo();
    const chat = await client.getChatInfo(destination.chatId);
    const member = await client.getBotMembership(destination.chatId);
    if (bot.id !== destination.botId || bot.username !== destination.botUsername || chat.id !== destination.chatId ||
      chat.type !== "chat" || chat.status !== "active" || chat.title !== destination.chatTitle || member.botId !== destination.botId) throw new Error("Identity mismatch");
  } catch { return state.finish(id, "failed", clock()); }
  let confirmed = 0;
  for (let part = 0; part < messages.length; part++) {
    if (part) await pause(1000);
    await state.beforePost(id, part);
    let messageId: string;
    try {
      messageId = (await client.sendText({ kind: "chat", id: destination.chatId }, messages[part])).messageId;
      if (!messageId) throw new MaxApiError("No PP confirmation", "unknown");
    } catch (error) {
      const definite = error instanceof MaxApiError && error.delivery === "not-sent";
      return state.finish(id, definite && confirmed === 0 ? "failed" : "review", clock());
    }
    // Keep a lost database confirmation uncertain; never catch it as a rejected POST.
    await state.confirm(id, part, messageId);
    confirmed++;
  }
  return state.finish(id, "sent", clock());
}
