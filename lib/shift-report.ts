import { validReportPeriod } from "./report-schedule";

export const shiftTimeZone = "Asia/Yekaterinburg";
export const reportSections = { safety: false, extinguishers: false } as const;
const shiftLength = 12 * 60 * 60 * 1000;
const boundaryAnchor = Date.UTC(2000, 0, 1, 3);
const dateTime = new Intl.DateTimeFormat("ru-RU", { timeZone: shiftTimeZone, dateStyle: "short", timeStyle: "short" });
const date = new Intl.DateTimeFormat("ru-RU", { timeZone: shiftTimeZone, dateStyle: "short" });
const time = new Intl.DateTimeFormat("ru-RU", { timeZone: shiftTimeZone, hour: "2-digit", minute: "2-digit" });
const natural = new Intl.Collator("ru", { numeric: true });

export type ShiftPeriod = { start: Date; end: Date };
export type ReportGroup = { key: string; name: string };
export type CargoFlow = { item: string; quantity: number; from?: string; to?: string };
export type QuantityLine = { before: string; quantity: number; after: string };
export type WorkEvent = {
  kind: "work"; id: string; at: Date; group: ReportGroup;
  line: string | QuantityLine; transient?: boolean; flows?: CargoFlow[];
  combine?: { key: string; prefix: string };
};
export type PowerEvent = {
  kind: "power"; id: string; at: Date; group: ReportGroup;
  source: { key: string; name: string }; before: boolean; after: boolean;
};
export type BarrierEvent = { kind: "barrier"; id: string; at: Date; holders: string[] };
export type ShiftEvent = WorkEvent | PowerEvent | BarrierEvent;
export type PpReading = {
  id: number; name: string; excavator: string | null; unloadingSectorId: number | null;
  sectors: Array<{ id: number; name: string; quantity: number; material: string }>;
};
export type ShiftReportInput = {
  period: ShiftPeriod; events: ShiftEvent[]; points: PpReading[]; capturedAt: Date;
};

export function latestCompletedShift(now = new Date()): ShiftPeriod {
  if (!Number.isFinite(now.getTime())) throw new Error("Некорректное время отчёта");
  const end = boundaryAnchor + Math.floor((now.getTime() - boundaryAnchor) / shiftLength) * shiftLength;
  return { start: new Date(end - shiftLength), end: new Date(end) };
}

export function validatePeriod(period: ShiftPeriod) {
  if (!validReportPeriod(period.start, period.end)) {
    throw new Error("Период должен соответствовать границам отправки отчётов");
  }
}

export const cleanReportText = (value: string) => value.replace(/[\r\n\t\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g, " ").trim();

/** Live batches reference intermediate actions, never completed jobs. */
export function summarizeShift(events: ShiftEvent[]): Array<{ group: ReportGroup; lines: string[] }> {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || natural.compare(a.id, b.id));
  const remaining = new Map<string, number[]>();
  const batches: Array<{ item: string; endpoint: string; quantity: number; eventId: string; flowIndex: number }> = [];
  const power = new Map<string, { group: ReportGroup; sources: Map<string, { name: string; before: boolean; after: boolean }> }>();
  const seen = new Set<string>();
  for (const event of sorted) {
    if (seen.has(event.id)) throw new Error("Повтор идентификатора события отчёта");
    seen.add(event.id);
    if (event.kind === "barrier") {
      for (let i = batches.length - 1; i >= 0; i--) {
        if (event.holders.some((holder) => batches[i].endpoint.startsWith(`${holder}@`))) batches.splice(i, 1);
      }
      continue;
    }
    if (event.kind === "power") {
      if (event.before === event.after) continue;
      const family = event.source.key.startsWith("assembly:") ? "assembly" : "yakno";
      const key = `${event.group.key}:${family}`;
      const state = power.get(key) ?? { group: event.group, sources: new Map() };
      const source = state.sources.get(event.source.key);
      state.sources.set(event.source.key, { name: event.source.name, before: source?.before ?? event.before, after: event.after });
      power.set(key, state);
      continue;
    }
    const flows = event.flows ?? [];
    remaining.set(event.id, flows.map((flow) => flow.quantity));
    for (let index = 0; index < flows.length; index++) {
      const flow = flows[index];
      if (!Number.isSafeInteger(flow.quantity) || flow.quantity < 1) throw new Error("Некорректное количество в цепочке отчёта");
      let needed = flow.quantity;
      if (flow.from) {
        for (const batch of batches) {
          if (!needed) break;
          if (batch.endpoint !== flow.from || batch.item !== flow.item || batch.quantity < 1) continue;
          const consumed = Math.min(batch.quantity, needed);
          batch.quantity -= consumed;
          needed -= consumed;
          remaining.get(batch.eventId)![batch.flowIndex] -= consumed;
        }
      }
      if (event.transient && flow.to) {
        batches.push({ item: flow.item, endpoint: flow.to, quantity: flow.quantity, eventId: event.id, flowIndex: index });
      }
    }
  }

  const groups = new Map<string, { group: ReportGroup; lines: string[] }>();
  const combined = new Map<string, { group: ReportGroup; index: number; prefix: string; parts: QuantityLine[] }>();
  const add = (group: ReportGroup, line: string) => {
    const entry = groups.get(group.key) ?? { group: { ...group }, lines: [] };
    entry.lines.push(cleanReportText(line));
    groups.set(group.key, entry);
  };
  for (const event of sorted) {
    if (event.kind !== "work") continue;
    const residue = remaining.get(event.id)!;
    const quantity = residue.reduce((sum, n) => sum + n, 0);
    if (event.transient && residue.length && quantity === 0) continue;
    const displayedQuantity = typeof event.line === "string" ? 0 : event.transient && residue.length ? quantity : event.line.quantity;
    if (event.combine && typeof event.line !== "string") {
      const key = `${event.group.key}:${event.combine.key}`;
      let movement = combined.get(key);
      if (!movement) {
        add(event.group, "");
        movement = { group: event.group, index: groups.get(event.group.key)!.lines.length - 1, prefix: event.combine.prefix, parts: [] };
        combined.set(key, movement);
      }
      const details = event.line;
      const same = movement.parts.find((part) => part.before === details.before && part.after === details.after);
      if (same) same.quantity += displayedQuantity;
      else movement.parts.push({ ...event.line, quantity: displayedQuantity });
      continue;
    }
    const line = typeof event.line === "string" ? event.line : `${event.line.before}${displayedQuantity}${event.line.after}`;
    add(event.group, line);
  }
  for (const movement of Array.from(combined.values())) {
    groups.get(movement.group.key)!.lines[movement.index] = cleanReportText(movement.prefix + movement.parts.map((part) => `${part.before}${part.quantity}${part.after}`).join("; "));
  }
  for (const { group, sources } of Array.from(power.values())) {
    const states = Array.from(sources.values());
    const before = states.filter((source) => source.before).map((source) => source.name).sort(natural.compare);
    const after = states.filter((source) => source.after).map((source) => source.name).sort(natural.compare);
    if (before.join("|") === after.join("|")) continue;
    add(group, before.length && after.length ? `Перезапитан: ${before.join(", ")} → ${after.join(", ")}.` :
      after.length ? `Запитан: ${after.join(", ")}.` : `Отключён от ${before.join(", ")}.`);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const aExc = a.group.key.startsWith("exc:") ? 0 : 1;
    const bExc = b.group.key.startsWith("exc:") ? 0 : 1;
    return aExc - bExc || natural.compare(a.group.name, b.group.name);
  });
}

function splitBlocks(header: string, blocks: string[]): string[] {
  const bodies: string[] = [];
  let current = "";
  for (const block of blocks) {
    let rest = block;
    while (rest) {
      const separator = current ? "\n\n" : "";
      if (current.length + separator.length + rest.length <= 3500) { current += separator + rest; break; }
      if (current) { bodies.push(current); current = ""; continue; }
      let boundary = rest.lastIndexOf("\n", 3500);
      if (boundary < 1) boundary = 3500;
      if (rest.charCodeAt(boundary - 1) >= 0xd800 && rest.charCodeAt(boundary - 1) <= 0xdbff) boundary--;
      bodies.push(rest.slice(0, boundary));
      rest = rest.slice(boundary);
    }
  }
  if (current) bodies.push(current);
  return bodies.map((body, index) => `${header}${bodies.length > 1 ? `\nЧасть ${index + 1} из ${bodies.length}` : ""}\n\n${body}`);
}

export function formatShiftReport(input: ShiftReportInput): string[] {
  const { period, capturedAt } = input;
  validatePeriod(period);
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt < period.end) throw new Error("Смена ещё не завершилась или время снимка некорректно");
  if (input.events.some((event) => !Number.isFinite(event.at.getTime()) || event.at < period.start || event.at >= period.end)) throw new Error("Запись выходит за границы смены");
  const range = date.format(period.start) === date.format(period.end)
    ? `${date.format(period.start)} · ${time.format(period.start)}-${time.format(period.end)}`
    : `${dateTime.format(period.start)} - ${dateTime.format(period.end)}`;
  const header = range;
  const ppBlocks: string[] = [];
  for (const point of [...input.points].sort((a, b) => natural.compare(a.name, b.name))) {
    if (point.sectors.some((sector) => !Number.isSafeInteger(sector.quantity) || sector.quantity < 0)) throw new Error("Некорректный остаток П/П");
    const hasGround = point.sectors.some((sector) => sector.quantity > 0);
    if (!hasGround && !point.excavator) continue;
    const rows = [`${cleanReportText(point.name)} · ${point.excavator ? cleanReportText(point.excavator) : "Без экскаватора"}`];
    if (!hasGround) rows.push("Земли нет");
    for (const sector of [...point.sectors].sort((a, b) => natural.compare(a.name, b.name))) {
      const material = sector.material === "ORE" ? "Р" : sector.material === "OVERBURDEN" ? "В" : "?";
      rows.push(`Сектор ${cleanReportText(sector.name)}: ${sector.quantity}${material}${sector.id === point.unloadingSectorId ? " 🟢" : ""}`);
    }
    ppBlocks.push(rows.join("\n"));
  }
  const late = capturedAt.getTime() - period.end.getTime() > 60000;
  const ppHeading = `ЗЕМЛЯ НА П/П${late ? `\nСостояние на ${dateTime.format(capturedAt)} (не на конец прошлой смены)` : ""}`;
  const other = summarizeShift(input.events).map(({ group, lines }) => `${cleanReportText(group.name)}\n${lines.map((line) => `• ${line}`).join("\n")}`);
  return splitBlocks(header, [
    `${ppHeading}\n\n${ppBlocks.shift() ?? "Нет П/П с землёй или экскаватором."}`, ...ppBlocks,
    `ИЗМЕНЕНИЯ\n\n${other.shift() ?? "За смену изменений не было."}`, ...other
  ]);
}

export function prepareShiftReport(input: ShiftReportInput) {
  return { version: 1 as const,
    period: { start: input.period.start.toISOString(), end: input.period.end.toISOString() },
    capturedAt: input.capturedAt.toISOString(), messages: formatShiftReport(input)
  };
}
