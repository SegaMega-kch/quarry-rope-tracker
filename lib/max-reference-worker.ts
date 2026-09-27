import { MaxApiError, type createMaxClient } from "./max-api";
import type { ReferenceDestination } from "./max-reference-config";
import type { ReferenceState } from "./max-reference-state";
import type { ReferenceMessage } from "./max-reference";

type Client = ReturnType<typeof createMaxClient>;
export async function verifyReferenceDestination(client: Pick<Client, "getBotInfo" | "getChatInfo" | "getBotMembership">, destination: ReferenceDestination) {
  const bot = await client.getBotInfo();
  const chat = await client.getChatInfo(destination.chatId);
  const member = await client.getBotMembership(destination.chatId);
  if (bot.id !== destination.botId || bot.username !== destination.botUsername || member.botId !== destination.botId ||
    chat.id !== destination.chatId || chat.title !== destination.chatTitle || chat.type !== "chat" || chat.status !== "active") throw new Error("Reference identity mismatch");
  return { isAdmin: member.isAdmin };
}

export async function refreshReference(state: ReferenceState, client: Pick<Client, "answerReference" | "editReference">,
  build: (payload: string, now: Date) => Promise<ReferenceMessage>, clock = () => Date.now()) {
  const claim = await state.claim(clock());
  if (!claim) return "idle";
  let message: ReferenceMessage;
  try { message = await build(claim.payload, new Date(clock())); }
  catch { await state.fail(claim, "source-unavailable", false, clock()); return "source-unavailable"; }
  if (!await state.isCurrent(claim, clock())) return "lease-expired";
  try {
    if (claim.callbackId) await client.answerReference(claim.callbackId, message);
    else await client.editReference(claim.messageId, message);
    await state.finish(claim, clock());
    return "updated";
  } catch (error) {
    // A callback can expire. Subsequent attempts edit the same stored message, never publish a replacement.
    const fatal = error instanceof MaxApiError && (error.status === 401 || error.status === 403 || (!claim.callbackId && error.status === 404));
    await state.fail(claim, fatal ? "needs-review" : "api-unavailable", fatal, clock());
    return fatal ? "needs-review" : "api-unavailable";
  }
}
