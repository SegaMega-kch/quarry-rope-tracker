import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { openProductionStore } from "../lib/production-store";

async function main() {
  loadEnvConfig(process.cwd());
  const origin = "http://127.0.0.1:3100";
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || "local-dev-session-secret-change-on-server";
  const cookie = (id: number) => `rope_user=${id}.${createHmac("sha256", secret).update(String(id)).digest("base64url")}`;
  const endpoint = `${origin}/api/production/ocr`;
  const expectedProvider = process.env.PRODUCTION_OCR_PROVIDER === "yandex" ? "yandex" : "local";
  const unauth = await fetch(endpoint, { method: "POST" }); assert.equal(unauth.status, 401);
  const excluded = await fetch(endpoint, { method: "POST", headers: { Cookie: cookie(2), Origin: origin } }); assert.equal(excluded.status, 403);
  const wrongOrigin = await fetch(endpoint, { method: "POST", headers: { Cookie: cookie(1), Origin: "https://example.com" } }); assert.equal(wrongOrigin.status, 403);
  const desktop = await fetch(endpoint, { method: "POST", headers: { Cookie: cookie(1), Origin: origin, "X-Rapmas-Mobile-Photo": "1", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Sec-CH-UA-Mobile": "?0" } }); assert.equal(desktop.status, 403);
  const mobileHeaders = { Cookie: cookie(1), Origin: origin, "X-Rapmas-Mobile-Photo": "1", "User-Agent": "Mozilla/5.0 (Linux; Android 15; Mobile)", "Sec-CH-UA-Mobile": "?1" };
  const wrongType = await fetch(endpoint, { method: "POST", headers: mobileHeaders, body: "test" }); assert.equal(wrongType.status, 400);
  const allowedPage = await fetch(`${origin}/shift-production`, { headers: { Cookie: cookie(1) } });
  assert.equal(allowedPage.status, 200); assert.ok(!(await allowedPage.text()).includes("Проверить распознавание фото"));
  const excludedPage = await fetch(`${origin}/shift-production`, { headers: { Cookie: cookie(2) } });
  assert.equal(excludedPage.status, 200); assert.ok(!(await excludedPage.text()).includes("Проверить распознавание фото"));
  const store = await openProductionStore(process.env.SHIFT_PRODUCTION_DATABASE_PATH || resolve(".data/shift-production.db"));
  const before = await store.history();
  try {
    await mkdir("outputs/production-ocr", { recursive: true });
    for (const [index, path] of process.argv.slice(2).entries()) {
      const bytes = await readFile(path), form = new FormData(); form.append("photo", new Blob([bytes], { type: "image/png" }), "table.png");
      const response = await fetch(endpoint, { method: "POST", headers: mobileHeaders, body: form });
      const result = await response.json(); assert.equal(response.status, 200, result.message);
      assert.equal(result.provider, expectedProvider); assert.equal(result.schema, "rapmas-ocr-preview-v1");
      assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.ok(result.warnings.some((warning: string) => warning.includes("не перенесены")));
      await writeFile(`outputs/production-ocr/yandex-${index + 1}.json`, JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ path, provider: result.provider, confidence: result.confidence, seconds: result.seconds, tables: result.tables.length, warnings: result.warnings }));
    }
    assert.deepEqual(await store.history(), before);
    console.log("HTTP checks passed: 401, role 403, origin 403, desktop 403, invalid format 400, mobile photo requests; report history unchanged.");
  } finally { await store.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
