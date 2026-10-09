/** Creates only an isolated preview under this checkout's .data directory. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { emptySettings, normKey } from "../lib/production-domain";
import { openProductionStore } from "../lib/production-store";

async function main() {
  const root = process.cwd();
  const dbPath = resolve(root, ".data/site-preview.db");
  if (existsSync(dbPath)) throw new Error("Preview DB already exists; no reset or replacement performed");
  mkdirSync(resolve(root, ".data"), { recursive: true });
  // Prisma 5's Windows schema engine expects the SQLite file to exist first.
  writeFileSync(dbPath, "", { flag: "wx" });
  const database = `file:${dbPath.replaceAll("\\", "/")}`;
  const password = `Local-${randomBytes(6).toString("hex")}`;
  const env = { ...process.env, DATABASE_URL: database };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { cwd: root, env, stdio: "inherit" });
  const prisma = new PrismaClient({ datasources: { db: { url: database } } });
  await prisma.user.create({ data: { login: "1 смена", role: "shift", passwordHash: await bcrypt.hash(password, 10) } });
  await prisma.$disconnect();
  const prodPath = resolve(root, ".data/shift-production.db").replaceAll("\\", "/");
  writeFileSync(resolve(root, ".env.local"), `DATABASE_URL="${database}"\nAUTH_SECRET="${randomBytes(32).toString("hex")}"\nAUTH_COOKIE_SECURE="false"\nSHIFT_PRODUCTION_DATABASE_PATH="${prodPath}"\n`, { flag: "wx" });
  mkdirSync(resolve(root, ".tmp"), { recursive: true });
  writeFileSync(resolve(root, ".tmp/preview-login.json"), JSON.stringify({ login: "1 смена", password }), { flag: "wx" });
  const normal = await openProductionStore(prodPath); await normal.close();
  const review = await openProductionStore(resolve(root, ".data/shift-production-review.db"));
  const settings = emptySettings();
  settings.excavators = [{ id: "review-rail", number: "ТЕСТ-ЖД", type: "ЭКГ-10", direction: "rail", truck: 130, active: true }, { id: "review-truck", number: "ТЕСТ-АВТО", type: "ЭКГ-20", direction: "truck", truck: 130, active: true }];
  settings.norms = { [normKey("ЭКГ-10", "rail")]: ["1", "05"], [normKey("ЭКГ-20", "truck", 130)]: ["2", "30"], [normKey("ЭКГ-20", "truck", 240)]: ["3", "00"] };
  await review.saveSettings(settings, { id: 1, login: "Проверка локального интерфейса", role: "admin" }); await review.close();
  console.log("Created isolated inventory login and two separate production databases: empty working preview and clearly labelled review fixtures. Login saved under .tmp/preview-login.json");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
