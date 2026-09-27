import { timingSafeEqual } from "node:crypto";
import { maxId } from "./max-api";
import type { ReferenceDestination } from "./max-reference-config";
import type { ReferenceState } from "./max-reference-state";
import { referenceBuilders } from "./max-reference";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function opaqueId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
}
export function parseReferenceCallback(value: unknown, destination: ReferenceDestination, now = Date.now()) {
  const update = object(value), message = object(update.message), callback = object(update.callback);
  const sender = object(message.sender), recipient = object(message.recipient), body = object(message.body), user = object(callback.user);
  const timestamp = callback.timestamp;
  if (update.update_type !== "message_callback" || sender.is_bot !== true || recipient.chat_type !== "chat" || user.is_bot !== false ||
    !opaqueId(body.mid) || !opaqueId(callback.callback_id) || typeof callback.payload !== "string" || !Object.hasOwn(referenceBuilders, callback.payload) ||
    typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < now - 48 * 3600000 || timestamp > now + 300000) return null;
  try {
    if (maxId(sender.user_id) !== maxId(destination.botId) || maxId(recipient.chat_id) !== maxId(destination.chatId) || maxId(user.user_id).startsWith("-")) return null;
  } catch { return null; }
  return { messageId: body.mid, callbackId: callback.callback_id, payload: callback.payload };
}

const response = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
async function boundedJson(request: Request) {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) throw new Error("Body too large");
          chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Body timeout")), 5000); })
    ]);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}

export async function handleReferenceWebhook(request: Request, secret: string, destination: ReferenceDestination,
  open: () => Promise<Pick<ReferenceState, "enqueue" | "close">>, now = Date.now()) {
  const supplied = request.headers.get("X-Max-Bot-Api-Secret") ?? "";
  const expectedBytes = Buffer.from(secret), suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length < 32 || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return response(401);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return response(415);
  let value: unknown;
  try { value = await boundedJson(request); } catch { return response(400); }
  const callback = parseReferenceCallback(value, destination, now);
  if (!callback) return response(200);
  let state: Pick<ReferenceState, "enqueue" | "close"> | undefined;
  try {
    state = await open();
    await state.enqueue(callback.messageId, callback.callbackId, callback.payload, now);
    // MAX can redeliver; a successful durable enqueue (or an ignored duplicate) is enough.
    return response(200);
  } catch { return response(503); }
  finally { await state?.close(); }
}
