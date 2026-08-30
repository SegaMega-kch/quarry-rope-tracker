import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const { backupDatabase, verifyDatabase } = require("../scripts/deployment-data.cjs");

test("deployment backup preserves existing values across additive schema changes and rejects any data changes", async () => {
  const root = resolve("prisma");
  const directory = mkdtempSync(join(root, "raport-deploy-"));
  const file = join(directory, "test.db");
  const backup = join(directory, "backup");
  writeFileSync(file, "", { flag: "wx" });
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  try {
    await db.$executeRawUnsafe('CREATE TABLE "Stock" (id INTEGER PRIMARY KEY, quantity INTEGER, locationId INTEGER, status TEXT, date DATETIME)');
    await db.$executeRawUnsafe("INSERT INTO Stock VALUES (1, 3, 9, 'AVAILABLE', 1700000000000), (2, 5, 4, 'USED', NULL)");
    await backupDatabase(file, backup);
    await assert.rejects(backupDatabase(file, backup), /already exists/);
    await db.$executeRawUnsafe('ALTER TABLE "Stock" ADD COLUMN loanId INTEGER');
    await db.$executeRawUnsafe('CREATE TABLE "Loan" (id INTEGER PRIMARY KEY)');
    assert.equal(await verifyDatabase(file, backup), 1);
    for (const statement of [
      "UPDATE Stock SET locationId = 10 WHERE id = 1",
      "UPDATE Stock SET quantity = 4 WHERE id = 1",
      "UPDATE Stock SET status = 'USED' WHERE id = 1",
      "UPDATE Stock SET date = NULL WHERE id = 1",
      "DELETE FROM Stock WHERE id = 1",
      "INSERT INTO Stock (id, quantity) VALUES (3, 1)"
    ]) {
      await db.$executeRawUnsafe(statement);
      await assert.rejects(verifyDatabase(file, backup), /Data changed: Stock/);
      await db.$executeRawUnsafe('DELETE FROM Stock');
      await db.$executeRawUnsafe("INSERT INTO Stock (id, quantity, locationId, status, date) VALUES (1, 3, 9, 'AVAILABLE', 1700000000000), (2, 5, 4, 'USED', NULL)");
    }
    const missing = join(directory, "missing.db");
    await assert.rejects(backupDatabase(missing, join(directory, "bad")));
    assert.equal(existsSync(missing), false);
    writeFileSync(join(backup, "database.db"), "tampered");
    await assert.rejects(verifyDatabase(file, backup), /Backup file changed/);
  } finally {
    await db.$disconnect();
    if (dirname(resolve(directory)) !== root || !basename(directory).startsWith("raport-deploy-")) throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
