import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { closeSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";
import { MaxApiError } from "./max-api";

type Bot = { id: string; name: string; username: string | null };
type SetupOptions = {
  expectedUsername: string;
  verify: (token: string) => Promise<Bot>;
  persist: (token: string) => void;
  page: string;
  assets?: Map<string, { type: string; data: Buffer }>;
  onComplete?: (bot: Bot) => void;
  lifetimeMs?: number;
};

/** Reuse the protected placeholder in place, preserving its Windows ACL. */
export function saveBlankTokenFile(path: string, token: string) {
  const fd = openSync(path, "r+");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 || readFileSync(fd, "utf8").trim()) throw new Error("Credential file is not empty");
    const contents = Buffer.from(token + "\n", "utf8");
    let offset = 0;
    while (offset < contents.length) offset += writeSync(fd, contents, offset, contents.length - offset, offset);
    ftruncateSync(fd, contents.length);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

export async function startMaxSetup(options: SetupOptions) {
  const nonce = randomBytes(32).toString("hex");
  let origin = "";
  let completed = false;
  let busy = false;
  let attempts = 0;
  const expiresAt = new Date(Date.now() + (options.lifetimeMs ?? 30 * 60 * 1000));
  const json = (res: ServerResponse, status: number, message: string) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: status === 200, message }));
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`);
    if (req.headers.host !== new URL(origin).host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
      return json(res, 403, "Недопустимый адрес подключения.");
    }
    if (Date.now() >= expiresAt.getTime()) return json(res, 410, "Время подключения истекло. Попросите открыть окно заново.");
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(options.page.replaceAll("__NONCE__", nonce));
    }
    const asset = req.method === "GET" ? options.assets?.get(req.url ?? "") : undefined;
    if (asset) { res.writeHead(200, { "Content-Type": asset.type }); return res.end(asset.data); }
    if (req.method !== "POST" || req.url !== "/token") return json(res, 404, "Адрес не найден.");
    if (req.headers.origin !== origin || req.headers["x-setup-nonce"] !== nonce || req.headers["content-type"] !== "application/json") {
      return json(res, 403, "Проверка доступа не пройдена. Обновите страницу.");
    }
    if (completed) return json(res, 409, "Токен уже проверен и сохранён. Повторный ввод не требуется.");
    if (busy) return json(res, 409, "Проверка уже выполняется.");
    if (attempts >= 10) return json(res, 429, "Слишком много попыток. Попросите открыть окно заново.");
    attempts++;
    busy = true;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { json(res, 413, "Токен слишком длинный."); return; }
        chunks.push(Buffer.from(chunk));
      }
      let token: unknown;
      try { token = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { token?: unknown }).token; }
      catch { return json(res, 400, "Не удалось прочитать токен. Повторите ввод."); }
      if (typeof token !== "string" || !token.trim() || token.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(token)) {
        return json(res, 400, "Вставьте только токен, без пробелов и переноса строки.");
      }
      let bot: Bot;
      try { bot = await options.verify(token); }
      catch (error) {
        return json(res, 400, error instanceof MaxApiError && [401, 403].includes(error.status ?? 0)
          ? "MAX не принял токен. Проверьте его в настройках бота."
          : "Не удалось связаться с MAX. Токен не сохранён. Попробуйте ещё раз.");
      }
      if (bot.username?.replace(/^@/, "").toLowerCase() !== options.expectedUsername.toLowerCase()) {
        return json(res, 400, "Это токен другого бота. Нужен токен «Рапорт мастера».");
      }
      try { options.persist(token); }
      catch { return json(res, 500, "Не удалось сохранить токен. Сообщите об этой ошибке, сам токен не присылайте."); }
      completed = true;
      json(res, 200, "Бот «Рапорт мастера» проверен. Токен сохранён. Сообщения не отправлялись.");
      options.onComplete?.(bot);
    } finally { busy = false; }
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, "Не удалось завершить проверку. Повторите попытку.");
      else res.end();
    });
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local listener did not start");
  origin = `http://127.0.0.1:${address.port}`;
  const close = () => new Promise<void>((resolve, reject) => {
    clearTimeout(expiry);
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  const expiry = setTimeout(() => { void close(); }, Math.max(1, expiresAt.getTime() - Date.now()));
  expiry.unref();
  return { origin, expiresAt, close };
}
