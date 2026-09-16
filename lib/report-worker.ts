import { createMaxClient, MaxApiError } from "./max-api";
import { PreparedReport, ReportOutbox, sendLeaseMilliseconds } from "./report-outbox";
import { ShiftPeriod } from "./shift-report";

type Client = Pick<ReturnType<typeof createMaxClient>, "getBotInfo" | "getChatInfo" | "getBotMembership" | "sendText">;
export type Collector = (period: ShiftPeriod) => Promise<{ report: PreparedReport; warnings: string[] }>;

export async function captureDueReport(outbox: ReportOutbox, collect: Collector, now = new Date()) {
  const period = await outbox.due(now);
  if (!period) return false;
  const { report, warnings } = await collect(period);
  if (report.period.end !== period.end.toISOString() || report.period.start !== period.start.toISOString()) throw new Error("Collector returned a different shift");
  return outbox.save(report, warnings);
}

export async function deliverNextPart(outbox: ReportOutbox, client: Client, clock: () => Date = () => new Date()) {
  if (!await outbox.ready(clock())) return "idle" as const;
  const destination = outbox.destination;
  // All preflight failures happen before the persistent POST attempt; a network retry is safe here.
  try {
    const bot = await client.getBotInfo();
    if (bot.id !== destination.botId || bot.username !== destination.botUsername) return "identity-mismatch" as const;
    const chat = await client.getChatInfo(destination.chatId);
    if (chat.id !== destination.chatId || chat.type !== "chat" || chat.status !== "active" || chat.title !== destination.chatTitle) return "identity-mismatch" as const;
    const member = await client.getBotMembership(destination.chatId);
    if (member.botId !== destination.botId) return "identity-mismatch" as const;
  } catch { return "preflight-unavailable" as const; }

  const part = await outbox.claim(clock());
  if (!part) return "idle" as const;
  if (clock().getTime() - part.started_at >= sendLeaseMilliseconds) {
    await outbox.finish(part, { state: "pending", code: "expired-before-post" }, clock());
    return "retry" as const;
  }
  let messageId: string;
  try {
    messageId = (await client.sendText({ kind: "chat", id: destination.chatId }, part.text)).messageId;
    if (!messageId) throw new MaxApiError("Missing confirmation", "unknown");
  } catch (error) {
    const definite = error instanceof MaxApiError && error.delivery === "not-sent";
    const throttled = definite && error.status === 429;
    const state = throttled ? "pending" : definite ? "blocked" : "review";
    // Persist only fixed codes. Provider payloads and arbitrary exception messages may contain secrets.
    const code = throttled ? "rate-limit" : definite ? "rejected" : "delivery-unknown";
    const delay = Math.min(15 * 60000, 10000 * 2 ** Math.min(part.attempts - 1, 7));
    await outbox.finish(part, { state, code, retryAt: throttled ? clock().getTime() + delay : undefined }, clock());
    return throttled ? "retry" as const : "needs-review" as const;
  }
  // A database failure after a successful POST must leave the lease uncertain, never retry the POST.
  const saved = await outbox.finish(part, { state: "sent", messageId }, clock());
  if (!saved) throw new Error("Delivery confirmation could not be recorded");
  return "sent" as const;
}
