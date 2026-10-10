import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProductionDeliveryConfiguration, productionDeliveryStatus } from "../lib/production-delivery-config";

test("production MAX configuration is ready only for the approved group", () => {
  const directory = mkdtempSync(join(tmpdir(), "rapmas-production-max-"));
  const tokenFile = join(directory, "token.txt"), configFile = join(directory, "max.json");
  const previous = process.env.SHIFT_PRODUCTION_MAX_CONFIG;
  try {
    writeFileSync(tokenFile, "test-token");
    writeFileSync(configFile, JSON.stringify({ tokenFile, botId: "123", botUsername: "report_bot", chatId: "-456", chatTitle: "Рапорт мастера" }));
    process.env.SHIFT_PRODUCTION_MAX_CONFIG = configFile;
    assert.equal(productionDeliveryStatus().ready, true);
    assert.equal(loadProductionDeliveryConfiguration().chatTitle, "Рапорт мастера");

    writeFileSync(configFile, JSON.stringify({ tokenFile, botId: "123", botUsername: "report_bot", chatId: "-456", chatTitle: "Другая группа" }));
    assert.equal(productionDeliveryStatus().ready, false);
    assert.throws(loadProductionDeliveryConfiguration, /группа MAX/);
  } finally {
    if (previous === undefined) delete process.env.SHIFT_PRODUCTION_MAX_CONFIG;
    else process.env.SHIFT_PRODUCTION_MAX_CONFIG = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
