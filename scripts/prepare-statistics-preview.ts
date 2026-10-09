/** Creates a disposable statistics source beside the existing isolated local preview. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type PreviewLogin = { login: string; password: string };

const fixtures = [
  ["2026-10-01T01:30:00.000Z", "ЭКГ №4", [["1", 1, "В"], ["2", 2, "В"]]],
  ["2026-10-01T14:30:00.000Z", "ЭКГ №4", [["1", 2, "В"], ["2", 2, "В"]]],
  ["2026-10-02T01:30:00.000Z", "ЭКГ №4", [["1", 3, "Р"], ["2", 2, "В"]]],
  ["2026-10-02T14:30:00.000Z", "ЭКГ №4", [["1", 2, "Р"], ["2", 1, "В"]]],
  ["2026-10-03T01:30:00.000Z", "ЭКГ №4", [["1", 1, "Р"], ["2", 1, "В"]]],
  ["2026-10-03T14:30:00.000Z", "ЭКГ №6", [["1", 1, "Р"], ["2", 2, "В"]]],
  ["2026-10-04T01:30:00.000Z", "ЭКГ №6", [["1", 4, "Р"], ["2", 2, "В"]]],
  ["2026-10-04T14:30:00.000Z", "ЭКГ №6", [["1", 4, "Р"], ["2", 1, "В"]]]
] as const;

async function main() {
  const root = process.cwd();
  const sourcePath = resolve(root, ".data/statistics-review.db");
  if (existsSync(sourcePath)) throw new Error("Statistics preview DB already exists; no reset or replacement performed");
  mkdirSync(resolve(root, ".data"), { recursive: true });
  closeSync(openSync(sourcePath, "wx", 0o600));
  const source = new PrismaClient({ datasources: { db: { url: `file:${sourcePath.replaceAll("\\", "/")}` } } });
  await source.$executeRawUnsafe("CREATE TABLE report_settings (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)");
  await source.$executeRawUnsafe("CREATE TABLE report_snapshots (shift_end BIGINT NOT NULL PRIMARY KEY, snapshot TEXT NOT NULL, warnings TEXT NOT NULL)");
  await source.$executeRawUnsafe("CREATE TABLE report_parts (shift_end BIGINT NOT NULL, part INTEGER NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (shift_end, part))");
  await source.$executeRawUnsafe("INSERT INTO report_settings (id, version) VALUES (1, 2)");
  for (const [end, excavator, sectors] of fixtures) {
    const endDate = new Date(end);
    const rows = sectors.map(([name, quantity, material]) => `Сектор ${name}: ${quantity}${material}`).join("\n");
    const report = { version: 1, period: { start: new Date(endDate.getTime() - 12 * 60 * 60 * 1000).toISOString(), end }, capturedAt: end,
      messages: [`Учебный локальный отчёт\n\nЗЕМЛЯ НА П/П\n\nПП №1 · ${excavator}\n${rows}\n\nПП №2 · ЭКГ №8\nСектор 1: 2В\n\nИЗМЕНЕНИЯ\n\nЗа смену изменений не было.`] };
    await source.$executeRawUnsafe("INSERT INTO report_snapshots (shift_end, snapshot, warnings) VALUES (?, ?, '[]')", endDate.getTime(), JSON.stringify(report));
  }
  await source.$disconnect();

  const inventoryPath = resolve(root, ".data/site-preview.db");
  const login = JSON.parse(readFileSync(resolve(root, ".tmp/preview-login.json"), "utf8")) as PreviewLogin;
  const inventory = new PrismaClient({ datasources: { db: { url: `file:${inventoryPath.replaceAll("\\", "/")}` } } });
  const template = await inventory.user.findUniqueOrThrow({ where: { login: login.login } });
  await inventory.user.create({ data: { login: "preview-boss", role: "boss", passwordHash: template.passwordHash } });
  await inventory.$disconnect();
  writeFileSync(resolve(root, ".tmp/statistics-preview-login.json"), JSON.stringify({ login: "preview-boss", password: login.password }), { flag: "wx" });
  console.log(`Created isolated statistics preview at ${sourcePath}. Login saved under .tmp/statistics-preview-login.json`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
