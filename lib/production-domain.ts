import type { WorkPeriod } from "./shift-calendar";

export const excavatorTypes = ["ЭКГ-10", "ЭКГ-12", "ЭКГ-12К", "ЭКГ-15", "ЭКГ-20", "P&H"] as const;
export const truckTypes = [90, 130, 240] as const;
export type Parts = [string, string];
export type TimeFormat = "decimal" | "decimalMinutes" | "ms" | "hm";
export type Direction = "rail" | "truck";
export type RowState = "working" | "repair" | "no_crew";
export type ReportKind = "preliminary" | "final";
export type Excavator = { id: string; number: string; type: string; direction: Direction; truck: number; active: boolean };
export type Reason = { id: string; name: string; active: boolean };
export type Settings = { revision: number; railLoadingUnit?: "minutes"; excavators: Excavator[]; reasons: Reason[]; norms: Record<string, Parts> };
export type Loading = { truck: number | null; time: Parts; norm: number | null };
export type ProductionRow = { railLoadingUnit?: "minutes"; excavator: Excavator; norms: Record<string, number | null>; plan: string; fact: string; waiting: Parts; loading: Loading[]; state: RowState; reasons: Array<{ id: string; name: string }>; note: string };
export type Snapshot = { period: WorkPeriod; rows: ProductionRow[] };
export type Version = { id: string; periodKey: string; number: number; kind: ReportKind; correction: boolean; sourceId: string | null; previousId: string | null; author: string; at: string; snapshot: Snapshot; delivery: "not_configured" };
export type FieldIssue = { path: string; message: string };
export class InputError extends Error {
  constructor(public issues: FieldIssue[]) { super(issues[0]?.message || "Проверьте введённые данные"); }
}
export const emptySettings = (): Settings => ({ revision: 0, railLoadingUnit: "minutes", excavators: [], reasons: [{ id: "emergency-repair", name: "Аварийный ремонт", active: true }], norms: {} });
export const normKey = (type: string, direction: Direction, truck: number | null = null) => `${type}|${direction}|${direction === "rail" ? "dumpcar" : truck}`;

/** Exact integer microseconds, with up to 6 fractional decimal digits. */
export function duration(parts: Parts, format: TimeFormat): number | null {
  if (!Array.isArray(parts) || parts.length !== 2 || parts.some(x => typeof x !== "string")) throw new Error("Введите две части времени");
  const [a, b] = parts.map(x => x.trim());
  if (!a && !b) return null;
  const decimal = format === "decimal" || format === "decimalMinutes";
  if ((a && !(format === "decimalMinutes" ? /^\d{1,8}$/ : /^\d{1,6}$/).test(a)) || (b && !/^\d{1,6}$/.test(b))) throw new Error("Введите только цифры; дробная часть — до 6 знаков");
  if (!decimal && Number(b || 0) > 59) throw new Error(format === "ms" ? "Секунды должны быть от 0 до 59" : "Минуты должны быть от 0 до 59");
  const unit = format === "decimalMinutes" ? 60_000_000 : 3_600_000_000;
  const result = decimal ? Number(a || 0) * unit + Number(b || 0) * unit / 10 ** b.length
    : (Number(a || 0) * 60 + Number(b || 0)) * (format === "ms" ? 1_000_000 : 60_000_000);
  if (!Number.isSafeInteger(result)) throw new Error("Слишком большое значение времени");
  return result;
}
export function volume(raw: string): number | null {
  if (typeof raw !== "string") throw new Error("Введите объём числом");
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{1,10}([.,]\d{1,6})?$/.test(text)) throw new Error("Введите неотрицательный объём: например, 3700 или 3700,5");
  return Number(text.replace(",", "."));
}
export function displayDuration(value: number | null, format: TimeFormat) {
  if (value === null) return "Не настроен";
  if (format === "decimal" || format === "decimalMinutes") return `${Number((value / (format === "decimal" ? 3_600_000_000 : 60_000_000)).toFixed(6)).toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${format === "decimal" ? "ч" : "мин"}`;
  const units = Math.round(value / (format === "ms" ? 1_000_000 : 60_000_000));
  return `${Math.floor(units / 60)}:${String(units % 60).padStart(2, "0")} ${format === "ms" ? "мин:сек" : "ч:мин"}`;
}
// Old snapshots/drafts have no unit marker. Convert on read without rewriting history.
export function hoursToMinutes(parts: Parts): Parts {
  const value = duration(parts, "decimal");
  if (value === null) return ["", ""];
  return [String(Math.floor(value / 60_000_000)), String((value % 60_000_000) / 60).padStart(6, "0").replace(/0+$/, "") || "0"];
}
export function currentRows(rows: ProductionRow[]): ProductionRow[] {
  return rows.map(row => row.railLoadingUnit === "minutes" ? row : { ...row, railLoadingUnit: "minutes", loading: row.loading.map(l => row.excavator.direction === "rail" ? { ...l, time: hoursToMinutes(l.time) } : l) });
}
export function currentSnapshot(snapshot: Snapshot): Snapshot { return { ...snapshot, rows: currentRows(snapshot.rows) }; }
export function currentSettings(settings: Settings): Settings {
  return settings.railLoadingUnit === "minutes" ? settings : { ...settings, railLoadingUnit: "minutes", norms: Object.fromEntries(Object.entries(settings.norms).map(([key, parts]) => [key, key.includes("|rail|") ? hoursToMinutes(parts) : parts])) };
}
export function commentText(row: ProductionRow) {
  return [...row.reasons.map(r => r.name), row.note].filter(Boolean).join("\n");
}
export function appendReasonText(text: string, reason: string) {
  if (text.split(/\r?\n/).some(line => line.trim() === reason.trim())) return text;
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${reason}`;
}
export function defaultRows(settings: Settings): ProductionRow[] {
  return settings.excavators.filter(x => x.active).map(excavator => ({ railLoadingUnit: "minutes", excavator: { ...excavator }, norms: Object.fromEntries(truckTypes.map(t => [String(t), getNorm(settings, excavator, t)])), plan: "", fact: "", waiting: ["", ""], state: "working", reasons: [], note: "", loading: [{ truck: excavator.direction === "truck" ? excavator.truck : null, time: ["", ""], norm: getNorm(settings, excavator) }] }));
}
export function getNorm(settings: Settings, excavator: Excavator, truck = excavator.truck) {
  const parts = settings.norms[normKey(excavator.type, excavator.direction, truck)];
  return parts ? duration(parts, excavator.direction === "rail" ? settings.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : "ms") : null;
}
export function validateSettings(value: Settings): Settings {
  const issues: FieldIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  if (!value || !Array.isArray(value.excavators) || !Array.isArray(value.reasons) || !value.norms || typeof value.norms !== "object" || Array.isArray(value.norms)) throw new InputError([{ path: "settings", message: "Некорректные справочники" }]);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || value.excavators.length > 300 || value.reasons.length > 100) fail("settings", "Слишком большой или некорректный справочник");
  const ids = new Set<string>(), numbers = new Set<string>();
  value.excavators.forEach((e, i) => {
    if (!e || typeof e.id !== "string" || !/^[\w-]{1,80}$/.test(e.id) || ids.has(e.id)) { fail(`excavators.${i}`, "Некорректный идентификатор экскаватора"); return; }
    ids.add(e.id);
    if (typeof e.number !== "string" || !e.number.trim() || e.number.length > 30 || !excavatorTypes.includes(e.type as typeof excavatorTypes[number]) || !["rail", "truck"].includes(e.direction) || !truckTypes.includes(e.truck as typeof truckTypes[number]) || typeof e.active !== "boolean") fail(`excavators.${i}`, "Проверьте номер, тип и направление экскаватора");
    const number = String(e.number).trim().toLocaleLowerCase("ru");
    if (e.active && numbers.has(number)) fail(`excavators.${i}`, "Этот номер экскаватора уже есть в списке");
    if (e.active) numbers.add(number);
  });
  ids.clear();
  value.reasons.forEach((r, i) => {
    if (!r || typeof r.id !== "string" || !/^[\w-]{1,80}$/.test(r.id) || ids.has(r.id) || typeof r.name !== "string" || !r.name.trim() || r.name.length > 150 || typeof r.active !== "boolean") fail(`reasons.${i}`, "Проверьте причину невыполнения");
    else ids.add(r.id);
  });
  const keys = new Set(excavatorTypes.flatMap(type => [normKey(type, "rail"), ...truckTypes.map(truck => normKey(type, "truck", truck))]));
  Object.entries(value.norms).forEach(([key, parts]) => { try { if (!keys.has(key)) throw new Error("Неизвестная категория норматива"); duration(parts, key.includes("|rail|") ? value.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : "ms"); } catch (e) { fail(`norms.${key}`, (e as Error).message); } });
  if (issues.length) throw new InputError(issues);
  return JSON.parse(JSON.stringify(value)) as Settings;
}

export function validateRows(rows: ProductionRow[]) {
  const issues: FieldIssue[] = [];
  if (!Array.isArray(rows) || rows.length > 300) throw new InputError([{ path: "rows", message: "Некорректный список техники" }]);
  const ids = new Set<string>();
  rows.forEach((r, i) => {
    const check = (field: string, fn: () => unknown) => { try { fn(); } catch (error) { issues.push({ path: `rows.${i}.${field}`, message: (error as Error).message }); } };
    if (!r?.excavator || !["rail", "truck"].includes(r.excavator.direction) || ids.has(r.excavator.id)) { issues.push({ path: `rows.${i}`, message: "Некорректная или повторяющаяся техника" }); return; }
    ids.add(r.excavator.id);
    check("plan", () => volume(r.plan)); check("fact", () => volume(r.fact));
    check("waiting", () => duration(r.waiting, r.excavator.direction === "rail" ? "decimal" : "hm"));
    check("state", () => { if (!["working", "repair", "no_crew"].includes(r.state)) throw new Error("Выберите состояние техники"); });
    check("note", () => { if (typeof r.note !== "string" || r.note.length > 2000) throw new Error("Пояснение — не более 2000 знаков"); });
    check("reasons", () => { if (!Array.isArray(r.reasons) || r.reasons.length > 100 || r.reasons.some(x => typeof x?.id !== "string" || typeof x.name !== "string")) throw new Error("Проверьте причины"); });
    check("loading", () => {
      if (!Array.isArray(r.loading) || r.loading.length > 3 || new Set(r.loading.map(x => x.truck)).size !== r.loading.length || (r.excavator.direction === "rail" && (r.loading.length !== 1 || r.loading[0].truck !== null))) throw new Error("Проверьте виды транспорта");
      r.loading.forEach((l, j) => {
        if (r.excavator.direction === "truck" && !truckTypes.includes(l.truck as typeof truckTypes[number])) throw new Error("Неизвестный вид самосвала");
        check(`loading.${j}.time`, () => duration(l.time, r.excavator.direction === "rail" ? r.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : "ms"));
      });
    });
  });
  return issues;
}

export function rowResult(row: ProductionRow) {
  if (row.state !== "working") return { percent: null, comment: row.state === "repair" ? "Ремонт всю смену" : "Без бригады всю смену" };
  const plan = volume(row.plan), fact = volume(row.fact);
  return { percent: plan !== null && plan > 0 && fact !== null ? fact / plan * 100 : null, comment: plan !== null && fact !== null && fact < plan ? "Наряд не выполнен" : "" };
}
export function productionTotals(rows: ProductionRow[]) {
  const working = rows.filter(r => r.state === "working");
  const pairs = working.map(r => ({ plan: volume(r.plan), fact: volume(r.fact) })).filter((r): r is { plan: number; fact: number } => r.plan !== null && r.fact !== null);
  const plan = pairs.reduce((sum, r) => sum + r.plan, 0), fact = pairs.reduce((sum, r) => sum + r.fact, 0);
  return { plan, fact, percent: pairs.length && plan > 0 ? fact / plan * 100 : null, filled: pairs.length, expected: working.length };
}
export function weightedLoading(rows: ProductionRow[], direction: Direction, truck?: number) {
  const expected = rows.filter(r => r.state === "working" && r.excavator.direction === direction && (truck === undefined || r.loading.some(l => l.truck === truck)));
  let sum = 0, weight = 0, counted = 0;
  for (const row of expected) {
    const fact = volume(row.fact);
    const filled = row.loading.map(l => ({ ...l, value: duration(l.time, direction === "rail" ? row.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : "ms") })).filter(l => l.value !== null);
    if (fact === null || fact <= 0 || filled.length !== 1 || (truck !== undefined && filled[0].truck !== truck)) continue;
    sum += filled[0].value! * fact; weight += fact; counted++;
  }
  return { value: weight > 0 ? sum / weight : null, counted, expected: expected.length, coverageUnit: "экскаватор × период" };
}

export function versionChanges(before: Snapshot | null, after: Snapshot) {
  if (!before) return [{ label: "Отчёт", before: "Не было", after: "Создан" }];
  const changes: Array<{ label: string; before: string; after: string }> = [];
  for (const row of after.rows) {
    const old = before.rows.find(x => x.excavator.id === row.excavator.id);
    const label = `№ ${row.excavator.number}`;
    if (!old) { changes.push({ label, before: "Нет строки", after: "Добавлен" }); continue; }
    const fields: Array<[keyof ProductionRow, string]> = [["plan", "План"], ["fact", "Факт"], ["waiting", "Ожидание"], ["loading", "Погрузка"], ["state", "Состояние"], ["reasons", "Причины"], ["note", "Пояснение"], ["excavator", "Техника"]];
    for (const [field, name] of fields) if (JSON.stringify(old[field]) !== JSON.stringify(row[field])) changes.push({ label: `${label} · ${name}`, before: changeText(old, field), after: changeText(row, field) });
  }
  for (const row of before.rows) if (!after.rows.some(x => x.excavator.id === row.excavator.id)) changes.push({ label: `№ ${row.excavator.number}`, before: "Был в отчёте", after: "Нет строки" });
  return changes;
}
function changeText(row: ProductionRow, key: keyof ProductionRow) {
  if (key === "state") return { working: "Работает", repair: "Ремонт", no_crew: "Без бригады" }[row.state];
  if (key === "excavator") return `№ ${row.excavator.number}, ${row.excavator.type}, ${row.excavator.direction === "rail" ? "ЖД" : "Авто"}`;
  if (key === "reasons") return row.reasons.map(r => r.name).join(", ") || "Не выбраны";
  if (key === "waiting") { const value = duration(row.waiting, row.excavator.direction === "rail" ? "decimal" : "hm"); return value === null ? "Не заполнено" : displayDuration(value, row.excavator.direction === "rail" ? "decimal" : "hm"); }
  if (key === "loading") return row.loading.map(l => { const format = row.excavator.direction === "rail" ? row.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : "ms"; const v = duration(l.time, format); return `${l.truck ? `${l.truck} т` : "Думпкар"}: ${v === null ? "не заполнено" : displayDuration(v, format)}`; }).join("; ") || "Не заполнено";
  return String(row[key]) || "Не заполнено";
}
