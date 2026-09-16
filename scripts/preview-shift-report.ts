import { PrismaClient } from "@prisma/client";
import { realpathSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { prepareShiftReport, latestCompletedShift } from "../lib/shift-report";
import { collectShiftReport } from "../lib/shift-report-source";

async function main() {
  const { values } = parseArgs({ options: { database: { type: "string" }, at: { type: "string" }, output: { type: "string" }, snapshot: { type: "string" } }, strict: true });
  if (!values.database) throw new Error("Укажите --database с путём существующей SQLite-базы");
  if (values.at && !/(?:Z|[+-]\d{2}:\d{2})$/.test(values.at)) throw new Error("Для --at укажите ISO-время с часовым поясом, например 2026-09-05T20:00:00+05:00");
  const path = realpathSync(values.database);
  if (!statSync(path).isFile() || !statSync(path).size) throw new Error("Пустая или некорректная база");
  const period = latestCompletedShift(values.at ? new Date(values.at) : new Date());
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  try {
    const source = await db.$transaction((tx) => collectShiftReport(tx, period), { timeout: 60000 });
    const prepared = prepareShiftReport(source);
    const messages = prepared.messages;
    const text = messages.join("\n\n====================\n\n") + "\n";
    if (values.output) {
      writeFileSync(values.output, text, { flag: "wx", mode: 0o600 });
      console.log(`Отчёт подготовлен: ${messages.length} частей. Отправка не выполнялась.`);
    } else console.log(text);
    if (values.snapshot) writeFileSync(values.snapshot, JSON.stringify(prepared, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    source.warnings.forEach((warning) => console.warn(warning));
  } finally { await db.$disconnect(); }
}

main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
