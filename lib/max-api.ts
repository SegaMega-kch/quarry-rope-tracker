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

  async function request(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const mutating = body !== undefined;
    const outcome = mutating ? "unknown" : "not-sent";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(new URL(path, apiOrigin), {
        method: mutating ? "POST" : "GET",
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

    async subscribe(webhookUrl: string, secret: string) {
      const url = new URL(webhookUrl);
      if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.search) {
        throw new Error("MAX webhook requires a plain HTTPS URL on port 443");
      }
      if (!/^[a-zA-Z0-9_-]{32,256}$/.test(secret)) throw new Error("Use a random MAX webhook secret of at least 32 characters");
      const result = await request("/subscriptions", { url: url.href, secret, update_types: ["bot_added", "bot_started"] });
      if (result.success !== true) throw new MaxApiError("MAX did not confirm the webhook subscription", "unknown");
    }
  };
}
