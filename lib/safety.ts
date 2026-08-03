import type { Prisma, PrismaClient } from "@prisma/client";

type SafetyTemplate = {
  category: "PPE" | "EXTINGUISHER";
  name: string;
  sortOrder: number;
  expiryDate?: Date;
};

const ppeNames = [
  "1 пара д/эл перчаток",
  "2 пара д/эл перчаток",
  "Д/эл боты",
  "Д/эл штанга",
  "Высоковольтный указатель",
  "Низковольтный указатель"
] as const;

const personalSafetyTemplates: SafetyTemplate[] = [
  { category: "PPE", name: "Страховочная привязь №1", sortOrder: 100 },
  { category: "PPE", name: "Страховочная привязь №2", sortOrder: 110 },
  { category: "PPE", name: "Строп №1", sortOrder: 120 },
  { category: "PPE", name: "Строп №2", sortOrder: 130 }
];

const sourceDates: Record<string, string[]> = {
  "ЭКГ-10 №4": ["2027-01-01", "2027-02-01", "2028-03-01", "2028-03-01", "2028-03-01", "2028-03-01"],
  "ЭКГ-10 №10": ["2026-07-01", "2027-02-01", "2028-01-01", "2028-03-01", "2028-03-01", "2028-03-01"],
  "ЭКГ-8И №42": ["2027-02-01", "2028-03-01", "2027-02-01", "2027-03-01", "2027-02-01", "2026-07-01"],
  "ЭКГ-8И №46": ["2027-03-01", "2028-03-01", "2026-07-01", "2027-01-01", "2028-05-01", "2028-05-01"],
  "ЭКГ-8И №54": ["2027-01-01", "2026-07-01", "2028-03-01", "2027-02-01", "2027-02-01", "2028-06-12"],
  "ЭКГ-8И №58": ["2028-03-01", "2028-01-01", "2028-03-01", "2026-07-01", "2028-01-01", "2028-03-01"],
  "ЭКГ-12К №74": ["2027-02-01", "2026-12-01", "2026-12-01", "2026-12-01", "2027-02-01", "2026-12-01"],
  "ЭКГ-12К №75": ["2027-01-01", "2028-01-01", "2028-01-01", "2028-03-01", "2028-01-01", "2026-12-01"]
};

const extinguisherNumbers: Record<string, string[]> = {
  "ЭКГ-10 №4": ["41", "42", "43", "44", "45", "46"],
  "ЭКГ-10 №10": ["101", "102", "103", "104", "105", "106"],
  "ЭКГ-8И №42": ["421", "422", "423", "424", "425", "426"],
  "ЭКГ-8И №46": ["461", "462", "463", "464", "465", "466"],
  "ЭКГ-8И №54": ["541", "542", "543", "544", "545", "546"],
  "ЭКГ-8И №58": ["581", "582", "583", "584", "585", "586"],
  "ЭКГ-12К №74": ["741", "742", "743", "744", "745", "746", "747"],
  "ЭКГ-12К №75": ["751", "752", "753", "754", "755", "756"]
};

const extinguisherDates: Record<string, string[]> = {
  ...sourceDates,
  "ЭКГ-12К №74": ["2027-02-01", "2026-12-01", "2026-12-01", "2026-12-01", "2027-02-01", "2026-12-01", "2028-05-01"]
};

function sourceDate(value?: string) {
  return value ? new Date(`${value}T12:00:00.000Z`) : undefined;
}

export function safetyTemplatesFor(locationName: string): SafetyTemplate[] {
  const dates = sourceDates[locationName] ?? [];
  const ppe = ppeNames.map((name, index) => ({
    category: "PPE" as const,
    name,
    sortOrder: 10 + index * 10,
    expiryDate: sourceDate(dates[index])
  }));
  const extinguishers = (extinguisherNumbers[locationName] ?? []).map((number, index) => ({
    category: "EXTINGUISHER" as const,
    name: `Огнетушитель №${number}`,
    sortOrder: 200 + index * 10,
    expiryDate: sourceDate(extinguisherDates[locationName]?.[index])
  }));
  return [...ppe, ...personalSafetyTemplates, ...extinguishers];
}

type SafetyClient = PrismaClient | Prisma.TransactionClient;

export async function syncSafetyItems(client: SafetyClient) {
  await client.safetyItem.updateMany({
    where: { name: "Низговольтный указатель" },
    data: { name: "Низковольтный указатель" }
  });

  await client.location.upsert({
    where: { name: "ЭКГ-10 №9" },
    update: {},
    create: { name: "ЭКГ-10 №9", category: "excavator" }
  });
  const excavators = await client.location.findMany({
    where: { category: "excavator" },
    select: { id: true, name: true }
  });
  const existing = await client.safetyItem.findMany({
    where: { locationId: { in: excavators.map((item) => item.id) } },
    select: { locationId: true, category: true, name: true }
  });
  const existingKeys = new Set(existing.map((item) => `${item.locationId}|${item.category}|${item.name}`));
  const missing = excavators.flatMap((excavator) => safetyTemplatesFor(excavator.name)
    .filter((template) => !existingKeys.has(`${excavator.id}|${template.category}|${template.name}`))
    .map((template) => ({
      locationId: excavator.id,
      category: template.category,
      name: template.name,
      sortOrder: template.sortOrder,
      expiryDate: template.expiryDate ?? null
    })));

  if (missing.length) await client.safetyItem.createMany({ data: missing });
}

export type SafetyStatus = "OVERDUE" | "EXPIRING" | "ACTIVE" | "NO_DATE";

function dateKeyInYekaterinburg(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarMonth(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return `${targetMonth.getUTCFullYear()}-${String(targetMonth.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function safetyStatus(expiryDate: Date | null, now = new Date()): SafetyStatus {
  if (!expiryDate) return "NO_DATE";
  const today = dateKeyInYekaterinburg(now);
  const expiry = expiryDate.toISOString().slice(0, 10);
  if (expiry <= today) return "OVERDUE";
  return expiry <= addCalendarMonth(today) ? "EXPIRING" : "ACTIVE";
}

export const safetyStatusLabels: Record<SafetyStatus, string> = {
  OVERDUE: "Просрочено",
  EXPIRING: "Срок скоро истекает",
  ACTIVE: "Действует",
  NO_DATE: "Дата не указана"
};
