import type { Prisma } from "@prisma/client";
import { compareLocations, shortHorizonLabel, yaknoLabel } from "./labels";

export const powerReference = { payload: "reference:power:v1", label: "Питание экскаваторов" } as const;
export const referenceAnnouncement = "В закреплённом сообщении появилась кнопка «Питание экскаваторов». Нажмите, чтобы посмотреть подключение каждого экскаватора к ЯКНО и сборке. Справка показывает данные из приложения на момент нажатия.";
export type PowerReferenceRow = { name: string; yakno: string[]; horizon: string | null; assembly: boolean };
export type ReferenceMessage = { text: string; format: "html"; notify: false;
  attachments: { type: "inline_keyboard"; payload: { buttons: { type: "callback"; text: string; payload: string }[][] } }[] };

export async function collectPowerReference(db: Prisma.TransactionClient): Promise<PowerReferenceRow[]> {
  // One SELECT is a consistent SQLite read snapshot. Prisma's interactive BEGIN needs a writer
  // lock and fails under query_only, even when the transaction contains only reads.
  const rows = await db.$queryRaw<{ id: number | bigint; name: string; horizon: string | null; number: string | null; assembly: number | bigint }[]>`
    SELECT l.id, l.name, h.name AS horizon, y.number,
      EXISTS (SELECT 1 FROM Assembly a WHERE a.excavatorLocationId = l.id AND a.isPowered = 1 AND a.status = 'WORKING') AS assembly
    FROM Location l
    LEFT JOIN YaknoExcavatorState s ON s.excavatorLocationId = l.id
    LEFT JOIN AssemblyHorizon h ON h.id = s.horizonId
    LEFT JOIN YaknoBox y ON y.excavatorLocationId = l.id AND y.isActive = 1 AND y.status = 'ACTIVE' AND y.isPowered = 1
    WHERE l.isActive = 1 AND l.category = 'excavator'`;
  const excavators = new Map<string, PowerReferenceRow>();
  for (const row of rows) {
    let excavator = excavators.get(String(row.id));
    if (!excavator) {
      excavator = { name: row.name, yakno: [], horizon: row.horizon, assembly: Boolean(row.assembly) };
      excavators.set(String(row.id), excavator);
    }
    if (row.number !== null) excavator.yakno.push(row.number);
  }
  return Array.from(excavators.values()).sort((a, b) => compareLocations({ ...a, category: "excavator" }, { ...b, category: "excavator" })).map((row) => ({ ...row,
    yakno: row.yakno.sort((a, b) => a.localeCompare(b, "ru", { numeric: true })) }));
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function formatPowerReference(rows: PowerReferenceRow[], now = new Date()): ReferenceMessage {
  const blocks = rows.map((row) => {
    const title = `<b>${escapeHtml(row.name)}${row.assembly ? " (в сборку)" : ""}</b>`;
    const connection = row.yakno.length ? row.yakno.map((number) => escapeHtml(yaknoLabel(number))).join(", ") : "ЯКНО не подключено";
    return `${title}\n${connection}${row.horizon?.trim() ? ` · ${escapeHtml(shortHorizonLabel(row.horizon))}` : ""}`;
  });
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", dateStyle: "short", timeStyle: "short" }).format(now);
  const text = [`<b>${powerReference.label}</b>`, blocks.length ? blocks.join("\n\n") : "Нет действующих экскаваторов.", `Обновлено: ${time}`].join("\n\n");
  // Never silently omit excavators or turn a reference click into a series of new messages.
  if (text.length > 4000) throw new Error("Reference exceeds one MAX message; review its layout before publishing");
  return { text, format: "html", notify: false, attachments: [{ type: "inline_keyboard", payload: {
    buttons: [[{ type: "callback", text: powerReference.label, payload: powerReference.payload }]]
  } }] };
}

// New references must be explicitly registered; unknown payloads cannot dispatch arbitrary commands.
export const referenceBuilders = { [powerReference.payload]: async (db: Prisma.TransactionClient, now: Date) =>
  formatPowerReference(await collectPowerReference(db), now) };
