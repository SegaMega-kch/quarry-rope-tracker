import { Prisma, PrismaClient } from "@prisma/client";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export type StatisticsMaterial = "ORE" | "OVERBURDEN" | "UNKNOWN";
export type StatisticsSector = { name: string; quantity: number; material: StatisticsMaterial };
export type StatisticsPoint = { name: string; excavator: string | null; sectors: StatisticsSector[] };
export type StatisticsReport = {
  at: string;
  date: string;
  time: "06:30" | "19:30";
  points: StatisticsPoint[];
};

type PreparedSnapshot = {
  version: 1;
  period: { start: string; end: string };
  capturedAt: string;
  messages: string[];
};

const natural = new Intl.Collator("ru", { numeric: true });
const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Yekaterinburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function reportBoundary(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(localParts.formatToParts(date).map((part) => [part.type, part.value]));
  const time = `${parts.hour}:${parts.minute}`;
  if (time !== "06:30" && time !== "19:30") return null;
  return { at: date.toISOString(), date: `${parts.year}-${parts.month}-${parts.day}`, time } as const;
}

function snapshot(value: unknown): PreparedSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<PreparedSnapshot>;
  if (report.version !== 1 || !report.period || typeof report.period.end !== "string" ||
      typeof report.capturedAt !== "string" || !Array.isArray(report.messages) ||
      report.messages.some((message) => typeof message !== "string")) return null;
  return report as PreparedSnapshot;
}

function messageBodies(messages: string[]) {
  return messages.map((message) => {
    const lines = message.replaceAll("\r", "").split("\n");
    lines.shift();
    if (/^Часть \d+ из \d+$/.test(lines[0] ?? "")) lines.shift();
    while (!lines[0]?.trim()) lines.shift();
    return lines.join("\n").trim();
  }).filter(Boolean);
}

function parseSector(line: string): StatisticsSector | null {
  const match = line.match(/^Сектор\s+(.+?):\s*(\d+)\s*([РВ?])(?:\s*🟢)?$/);
  if (!match) return null;
  const quantity = Number(match[2]);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null;
  return { name: match[1].trim(), quantity,
    material: match[3] === "Р" ? "ORE" : match[3] === "В" ? "OVERBURDEN" : "UNKNOWN" };
}

function parsePoint(block: string): StatisticsPoint | null {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines.shift()?.match(/^(.+?)\s+·\s+(.+)$/);
  if (!title) return null;
  const sectors = lines.map(parseSector).filter((sector): sector is StatisticsSector => Boolean(sector));
  if (!sectors.length && !lines.includes("Земли нет")) return null;
  return { name: title[1].trim(), excavator: title[2] === "Без экскаватора" ? null : title[2].trim(), sectors };
}

export function parseStatisticsSnapshot(value: unknown): StatisticsReport | null {
  const report = snapshot(value);
  if (!report) return null;
  const boundary = reportBoundary(report.period.end);
  if (!boundary) return null;
  const points: StatisticsPoint[] = [];
  let inPpSection = false;
  for (const body of messageBodies(report.messages)) {
    for (const rawBlock of body.split(/\n\s*\n/)) {
      let block = rawBlock.trim();
      if (!block) continue;
      if (block.startsWith("ЗЕМЛЯ НА П/П")) {
        inPpSection = true;
        block = block.split("\n").filter((line) => !line.startsWith("ЗЕМЛЯ НА П/П") && !line.startsWith("Состояние на ")).join("\n").trim();
        if (!block) continue;
      }
      if (block.startsWith("ИЗМЕНЕНИЯ")) { inPpSection = false; continue; }
      if (!inPpSection) continue;
      const point = parsePoint(block);
      if (point) points.push(point);
    }
  }
  points.sort((a, b) => natural.compare(a.name, b.name));
  return { ...boundary, points };
}

function plainAbsoluteFile(path: string) {
  if (!isAbsolute(path) || /[?#]/.test(path)) throw new Error("PP statistics source must be an absolute, plain filename");
  const realPath = realpathSync(path);
  if (!statSync(realPath).isFile()) throw new Error("PP statistics source must be a regular file");
  return realPath.replaceAll("\\", "/");
}

export async function readPpStatistics(path = process.env.PP_STATISTICS_DATABASE_PATH) {
  if (!path) throw new Error("PP_STATISTICS_DATABASE_PATH is not configured");
  const db = new PrismaClient({ datasources: { db: { url: `file:${plainAbsoluteFile(path)}?mode=ro` } } });
  try {
    const tables = await db.$queryRaw<Array<{ name: string }>>(Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
    if (tables.map((table) => table.name).join(",") !== "report_parts,report_settings,report_snapshots") {
      throw new Error("Configured database is not a report outbox");
    }
    const settings = await db.$queryRaw<Array<{ version: bigint | number }>>(Prisma.sql`SELECT version FROM report_settings WHERE id = 1`);
    if (!settings[0] || ![1, 2].includes(Number(settings[0].version))) throw new Error("Unsupported report outbox version");
    const rows = await db.$queryRaw<Array<{ snapshot: string }>>(Prisma.sql`SELECT snapshot FROM report_snapshots ORDER BY shift_end`);
    return rows.map((row) => {
      try { return parseStatisticsSnapshot(JSON.parse(row.snapshot)); }
      catch { return null; }
    }).filter((report): report is StatisticsReport => Boolean(report));
  } finally {
    await db.$disconnect();
  }
}
