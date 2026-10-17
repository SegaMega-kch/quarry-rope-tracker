import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { applyPdfLoadingNorms, emptySettings, type Excavator } from "../lib/production-domain";
import { openProductionStore } from "../lib/production-store";

async function main() {
  const root = process.cwd();
  const sitePath = resolve(root, ".data/site-autofill-review.db");
  const reportPath = resolve(root, ".data/shift-production-autofill-review.db");
  const loginPath = resolve(root, ".tmp/autofill-review-login.json");
  if ([sitePath, reportPath, loginPath].some(existsSync)) throw new Error("Макет автозаполнения уже существует; данные не заменены");
  mkdirSync(resolve(root, ".data"), { recursive: true });
  mkdirSync(resolve(root, ".tmp"), { recursive: true });
  writeFileSync(sitePath, "", { flag: "wx" });
  const database = `file:${sitePath.replaceAll("\\", "/")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { cwd: root, env: { ...process.env, DATABASE_URL: database }, stdio: "inherit" });
  const password = `Local-${randomBytes(6).toString("hex")}`;
  const prisma = new PrismaClient({ datasources: { db: { url: database } } });
  await prisma.user.create({ data: { login: "администратор", role: "admin", passwordHash: await bcrypt.hash(password, 10) } });
  await prisma.$disconnect();

  const store = await openProductionStore(reportPath);
  try {
    let settings = emptySettings();
    const examples: Array<[string, string, Excavator["direction"], number]> = [
      ["9", "ЭКГ-10", "truck", 130], ["10", "ЭКГ-10", "truck", 130], ["42", "ЭКГ-10", "truck", 130],
      ["46", "ЭКГ-10", "rail", 130], ["54", "ЭКГ-10", "rail", 130], ["74", "ЭКГ-12К", "truck", 130], ["75", "ЭКГ-12К", "rail", 130],
    ];
    settings.excavators = examples.map(([number, type, direction, truck]) => ({ id: `review-${direction}-${number}`, number, type, direction, truck, active: true }));
    settings = applyPdfLoadingNorms(settings).settings;
    await store.saveSettings(settings, { id: 1, login: "Локальная проверка", role: "admin" });
  } finally { await store.close(); }
  writeFileSync(loginPath, JSON.stringify({ login: "администратор", password, sitePath, reportPath }, null, 2), { flag: "wx" });
  console.log("Создан изолированный локальный макет автозаполнения; рабочие базы и MAX не затронуты.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
