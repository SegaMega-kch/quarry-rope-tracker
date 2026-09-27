import type { ReferenceMessage } from "./max-reference";

const apiOrigin = "https://platform-api2.max.ru";

type Fetch = typeof fetch;
export type MaxRecipient = { kind: "chat" | "user"; id: string };

export class MaxApiError extends Error {
  constructor(message: string, readonly delivery: "not-sent" | "unknown", readonly status?: number) {
    super(message);
    this.name = "MaxApiError";
  }
}

export function maxId(value: unknown): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("MAX returned an unsafe numeric ID");
  if ((typeof value !== "number" && typeof value !== "string") || !/^-?[1-9]\d{0,18}$/.test(String(value))) {
    throw new Error("Invalid MAX ID");
  }
  const id = BigInt(value);
  if (id < BigInt("-9223372036854775808") || id > BigInt("9223372036854775807")) throw new Error("MAX ID is outside int64 range");
  return id.toString();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createMaxClient(token: string, fetcher: Fetch = fetch) {
  if (!token || token.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(token)) throw new Error("Invalid MAX_BOT_TOKEN");

  async function request(path: string, body?: Record<string, unknown>, method?: "PUT"): Promise<Record<string, unknown>> {
    const mutating = body !== undefined;
    const outcome = mutating ? "unknown" : "not-sent";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(new URL(path, apiOrigin), {
        method: method ?? (mutating ? "POST" : "GET"),
        headers: { Authorization: token, ...(mutating ? { "Content-Type": "application/json" } : {}) },
        body: mutating ? JSON.stringify(body) : undefined,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        // A timeout or server failure can happen after a POST has been accepted.
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
        throw new MaxApiError(`MAX API returned HTTP ${response.status}`, rejected ? "not-sent" : outcome, response.status);
      }
      return record(await response.json());
    } catch (error) {
      if (error instanceof MaxApiError) throw error;
      // Do not expose provider responses, fetch errors or credentials in logs.
      throw new MaxApiError("MAX API connection or response failed", outcome);
    } finally { clearTimeout(timer); }
  }

  return {
    async getBotInfo() {
      const result = await request("/me");
      if (result.is_bot !== true || typeof result.first_name !== "string") throw new MaxApiError("Invalid MAX bot response", "not-sent");
      return { id: maxId(result.user_id), name: result.first_name, username: typeof result.username === "string" ? result.username : null };
    },

    async inspectLatestGroupConnections() {
      const subscriptions = await request("/subscriptions");
      if (!Array.isArray(subscriptions.subscriptions)) throw new MaxApiError("Invalid MAX subscription response", "not-sent");
      if (subscriptions.subscriptions.length) return { blockedByWebhook: true, chatIds: [] as string[] };
      // One development-time read only: no message events, cursor advancement or polling loop.
      const result = await request("/updates?types=bot_added&limit=100&timeout=0");
      if (!Array.isArray(result.updates)) throw new MaxApiError("Invalid MAX connection response", "not-sent");
      const ids = result.updates.map(record).filter((update) => update.update_type === "bot_added" && update.is_channel !== true).map((update) => maxId(update.chat_id));
      return { blockedByWebhook: false, chatIds: Array.from(new Set(ids)) };
    },

    async getChatInfo(chatId: string) {
      const id = maxId(chatId);
      const result = await request(`/chats/${id}`);
      if (maxId(result.chat_id) !== id || !["chat", "channel", "dialog"].includes(String(result.type)) || !["active", "removed", "left", "closed"].includes(String(result.status))) {
        throw new MaxApiError("Invalid MAX chat response", "not-sent");
      }
      return { id, type: String(result.type), status: String(result.status), title: typeof result.title === "string" ? result.title : null,
        participants: Number.isSafeInteger(result.participants_count) ? result.participants_count as number : null };
    },

    async getBotMembership(chatId: string) {
      const result = await request(`/chats/${maxId(chatId)}/members/me`);
      if (result.is_bot !== true || typeof result.is_admin !== "boolean") throw new MaxApiError("Invalid MAX membership response", "not-sent");
      return { botId: maxId(result.user_id), isAdmin: result.is_admin };
    },

    async sendText(recipient: MaxRecipient, text: string) {
      if (recipient.kind !== "chat" && recipient.kind !== "user") throw new Error("Choose one MAX recipient");
      const id = maxId(recipient.id);
      if (recipient.kind === "user" && id.startsWith("-")) throw new Error("MAX user ID must be positive");
      if (!text.trim() || text.length > 4000) throw new Error("MAX message must contain 1-4000 characters");
      const params = new URLSearchParams({ [`${recipient.kind}_id`]: id, disable_link_preview: "true" });
      const result = await request(`/messages?${params}`, { text, notify: true });
      const mid = record(record(result.message).body).mid;
      if (typeof mid !== "string" || !mid) throw new MaxApiError("MAX did not confirm a message ID; do not resend automatically", "unknown");
      return { messageId: mid };
    },

    async sendReference(chatId: string, message: ReferenceMessage) {
      validateReference(message);
      const params = new URLSearchParams({ chat_id: maxId(chatId), disable_link_preview: "true" });
      const result = await request(`/messages?${params}`, message);
      const mid = record(record(result.message).body).mid;
      if (typeof mid !== "string" || !mid) throw new MaxApiError("Reference publication needs manual verification", "unknown");
      return { messageId: mid };
    },

    async editReference(messageId: string, message: ReferenceMessage) {
      validateReference(message);
      validateOpaqueId(messageId);
      const params = new URLSearchParams({ message_id: messageId, disable_link_preview: "true" });
      const result = await request(`/messages?${params}`, message, "PUT");
      if (result.success !== true) throw new MaxApiError("MAX did not confirm the reference update", "unknown");
    },

    async answerReference(callbackId: string, message: ReferenceMessage) {
      validateReference(message);
      validateOpaqueId(callbackId);
      const params = new URLSearchParams({ callback_id: callbackId, disable_link_preview: "true" });
      const result = await request(`/answers?${params}`, { message });
      if (result.success !== true) throw new MaxApiError("MAX did not confirm the callback answer", "unknown");
    },

    async getMessageIdentity(messageId: string) {
      validateOpaqueId(messageId);
      // Permit MAX's mid. prefix, but never a comma-separated set of IDs.
      if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(messageId)) throw new Error("Invalid MAX message ID");
      const params = new URLSearchParams({ message_ids: messageId });
      const result = await request(`/messages?${params}`);
      if (!Array.isArray(result.messages) || result.messages.length !== 1) throw new MaxApiError("Invalid MAX message lookup response", "not-sent");
      const message = record(result.messages[0]);
      const sender = record(message.sender), recipient = record(message.recipient), body = record(message.body);
      if (body.mid !== messageId || sender.is_bot !== true || recipient.chat_type !== "chat") throw new MaxApiError("Invalid bot group message", "not-sent");
      return { messageId, botId: maxId(sender.user_id), chatId: maxId(recipient.chat_id), text: body.text,
        attachments: body.attachments };
    },

    async getSubscriptions() {
      const result = await request("/subscriptions");
      if (!Array.isArray(result.subscriptions)) throw new MaxApiError("Invalid MAX subscription response", "not-sent");
      return result.subscriptions.map((item) => {
        const value = record(item);
        if (typeof value.url !== "string" || !Array.isArray(value.update_types)) throw new MaxApiError("Invalid MAX subscription", "not-sent");
        return { url: value.url, updateTypes: value.update_types };
      });
    },

    async subscribe(webhookUrl: string, secret: string, kind: "connections" | "reference" = "connections") {
      const url = new URL(webhookUrl);
      if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.search) {
        throw new Error("MAX webhook requires a plain HTTPS URL on port 443");
      }
      if (!/^[a-zA-Z0-9_-]{32,256}$/.test(secret)) throw new Error("Use a random MAX webhook secret of at least 32 characters");
      const result = await request("/subscriptions", { url: url.href, secret,
        update_types: kind === "reference" ? ["message_callback"] : ["bot_added", "bot_started"] });
      if (result.success !== true) throw new MaxApiError("MAX did not confirm the webhook subscription", "unknown");
    }
  };
}

function validateOpaqueId(value: string) {
  if (!value.trim() || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid MAX message or callback ID");
}

function validateReference(message: ReferenceMessage) {
  if (!message.text.trim() || message.text.length > 4000 || message.format !== "html" || message.notify !== false) throw new Error("Invalid MAX reference body");
}
