import { currentRows, type Loading, type ProductionRow } from "./production-domain";
import type { OcrImportPreview, OcrResult, OcrTable } from "./production-ocr-contract";
import { periodLabel, workPeriod } from "./shift-calendar";

export const productionOcrParserSchema = "rapmas-production-table-v1" as const;

type SourceField = {
  key: string;
  label: string;
  category: string;
  metric: string;
  offset: number;
  plan?: boolean;
  fact?: boolean;
};

export const productionOcrFields: readonly SourceField[] = [
  { key: "ore.plan", label: "Руда · план, тыс. м³", category: "ore", metric: "plan", offset: 1, plan: true },
  { key: "ore.fact", label: "Руда · факт, м³", category: "ore", metric: "fact", offset: 2, fact: true },
  { key: "ore.deviation", label: "Руда · отклонение, тыс. м³", category: "ore", metric: "deviation", offset: 3 },
  { key: "ore.fe", label: "Fe руда, %", category: "ore", metric: "fe", offset: 4 },
  { key: "ore.fe_magnetic", label: "Fe магнитный, %", category: "ore", metric: "fe_magnetic", offset: 5 },
  { key: "ore.v2o5", label: "V2O5 руда, %", category: "ore", metric: "v2o5", offset: 6 },
  { key: "concentrate.fe", label: "Fe концентрат, %", category: "concentrate", metric: "fe", offset: 7 },
  { key: "concentrate.v2o5", label: "V2O5 концентрат, %", category: "concentrate", metric: "v2o5", offset: 8 },
  { key: "tailings.fe", label: "Fe хвосты, %", category: "tailings", metric: "fe", offset: 9 },
  { key: "overburden_gpm.plan", label: "Вскрыша с ГПМ · план, тыс. м³", category: "overburden_gpm", metric: "plan", offset: 10, plan: true },
  { key: "overburden_gpm.fact", label: "Вскрыша с ГПМ · факт, м³", category: "overburden_gpm", metric: "fact", offset: 11, fact: true },
  { key: "overburden_auto.plan", label: "Вскрыша авто · план, тыс. м³", category: "overburden_auto", metric: "plan", offset: 12, plan: true },
  { key: "overburden_auto.fact", label: "Вскрыша авто · факт, м³", category: "overburden_auto", metric: "fact", offset: 13, fact: true },
  { key: "ore_auto.plan", label: "Руда авто · план, тыс. м³", category: "ore_auto", metric: "plan", offset: 14, plan: true },
  { key: "ore_auto.fact", label: "Руда авто · факт, м³", category: "ore_auto", metric: "fact", offset: 15, fact: true },
  { key: "transfer_ore.plan", label: "Перевалка руды · план, тыс. м³", category: "transfer_ore", metric: "plan", offset: 16, plan: true },
  { key: "transfer_ore.fact", label: "Перевалка руды · факт, м³", category: "transfer_ore", metric: "fact", offset: 17, fact: true },
  { key: "transfer_overburden.plan", label: "Перевалка вскрыши · план, тыс. м³", category: "transfer_overburden", metric: "plan", offset: 18, plan: true },
  { key: "transfer_overburden.fact", label: "Перевалка вскрыши · факт, м³", category: "transfer_overburden", metric: "fact", offset: 19, fact: true },
  { key: "loading.dumpcar", label: "Среднее время погрузки думпкара, мин.", category: "loading", metric: "dumpcar", offset: 20 },
  { key: "loading.b75313", label: "Время погрузки Б75313 (240 т), мин.", category: "loading", metric: "b75313", offset: 21 },
  { key: "loading.b75131", label: "Время погрузки Б75131 (130 т), мин.", category: "loading", metric: "b75131", offset: 22 },
  { key: "oversize", label: "Выход негабарита, %", category: "oversize", metric: "percent", offset: 23 },
] as const;

export type ProductionOcrValue = {
  key: string;
  label: string;
  category: string;
  metric: string;
  sourceColumn: number;
  raw: string;
  normalized: string | null;
  numeric: number | null;
  status: "value" | "empty" | "unreadable";
};

export type ProductionOcrSourceRow = {
  sourceRow: number;
  kind: "equipment" | "fact" | "order";
  excavatorText: string;
  excavatorNumber: string | null;
  values: ProductionOcrValue[];
};

export type ParsedProductionOcr = {
  parserSchema: typeof productionOcrParserSchema;
  sourceDate: string | null;
  sourceShift: 1 | 2 | null;
  reportDate: string | null;
  periodKind: "day" | "night" | null;
  periodKey: string | null;
  period: string | null;
  table: OcrTable | null;
  idColumn: number | null;
  rows: ProductionOcrSourceRow[];
  warnings: string[];
  ready: boolean;
};

export type ProductionOcrApplied = {
  rows: ProductionRow[];
  matchedExcavators: number;
  changedFields: number;
  changedPaths: string[];
  warnings: string[];
};

function clean(value: string) { return value.replace(/\r/g, "").trim(); }
function rowText(table: OcrTable, row: number) {
  return table.cells.filter(cell => cell.row === row).sort((a, b) => a.column - b.column).map(cell => clean(cell.text)).filter(Boolean).join(" ");
}
function cellText(table: OcrTable, row: number, column: number) {
  return clean(table.cells.find(cell => cell.row === row && cell.column === column)?.text ?? "");
}
function numeric(raw: string) {
  const normalized = clean(raw).replace(/[−–—]/g, "-").replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return { normalized: null, numeric: null, status: "empty" as const };
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return { normalized: null, numeric: null, status: "unreadable" as const };
  const value = Number(normalized);
  return Number.isFinite(value) ? { normalized, numeric: value, status: "value" as const } : { normalized: null, numeric: null, status: "unreadable" as const };
}
function validDate(value: string) {
  const [day, month, year] = value.split(".");
  const iso = `${year}-${month}-${day}`;
  const time = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}
function previousDate(date: string) { return new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10); }

export function validateProductionOcrResult(input: unknown): OcrResult {
  const result = input as OcrResult | null;
  if (!result || result.schema !== "rapmas-ocr-preview-v1" || !["local", "yandex"].includes(result.provider) ||
    typeof result.text !== "string" || result.text.length > 250_000 || !/^[a-f0-9]{64}$/.test(result.sha256) ||
    !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1 ||
    !Array.isArray(result.tables) || result.tables.length > 5 || !Array.isArray(result.warnings) || result.warnings.some(item => typeof item !== "string" || item.length > 500)) {
    throw new Error("Результат распознавания повреждён. Распознайте фотографию ещё раз");
  }
  let cells = 0;
  for (const table of result.tables) {
    if (!Number.isInteger(table.rows) || !Number.isInteger(table.columns) || table.rows < 1 || table.columns < 1 || table.rows > 200 || table.columns > 100 || !Array.isArray(table.cells)) throw new Error("Некорректная таблица распознавания");
    cells += table.cells.length;
    for (const cell of table.cells) if (!Number.isInteger(cell.row) || !Number.isInteger(cell.column) || !Number.isInteger(cell.rowSpan) || !Number.isInteger(cell.columnSpan) ||
      cell.row < 0 || cell.column < 0 || cell.rowSpan < 1 || cell.columnSpan < 1 || cell.row + cell.rowSpan > table.rows || cell.column + cell.columnSpan > table.columns || typeof cell.text !== "string" || cell.text.length > 10_000) throw new Error("Некорректная ячейка распознавания");
  }
  if (cells > 10_000) throw new Error("Распознанная таблица слишком большая");
  return result;
}

export function parseProductionOcr(input: unknown): ParsedProductionOcr {
  const result = validateProductionOcrResult(input);
  const dateMatch = result.text.match(/(?:Дата\s*[-:]?\s*)?(\d{2}[.]\d{2}[.]\d{4})/i);
  const sourceDate = dateMatch ? validDate(dateMatch[1]) : null;
  const shiftMatch = result.text.match(/Смена\s*([12])\b/i);
  const sourceShift = shiftMatch ? Number(shiftMatch[1]) as 1 | 2 : null;
  const reportDate = sourceDate && sourceShift ? sourceShift === 1 ? previousDate(sourceDate) : sourceDate : null;
  const periodKind = sourceShift ? sourceShift === 1 ? "night" as const : "day" as const : null;
  let periodKey: string | null = null, period: string | null = null;
  if (reportDate && periodKind) {
    const detected = workPeriod(reportDate, periodKind);
    periodKey = detected.key; period = periodLabel(detected);
  }

  let table: OcrTable | null = null, mainRow = -1, endRow = -1;
  for (const candidate of result.tables) {
    const start = Array.from({ length: candidate.rows }, (_, row) => row).find(row => /главн[а-яё]*\s+карьер/i.test(rowText(candidate, row)));
    if (start !== undefined) { table = candidate; mainRow = start; break; }
  }
  if (table) {
    endRow = Array.from({ length: table.rows - mainRow - 1 }, (_, index) => mainRow + index + 1)
      .find(row => /(западн[а-яё]*|северн[а-яё]*)\s+карьер/i.test(rowText(table!, row))) ?? table.rows;
  }

  let idColumn: number | null = null;
  if (table) {
    const maximum = Math.min(6, table.columns);
    const scores = Array.from({ length: maximum }, (_, column) => ({ column, score: Array.from({ length: Math.max(0, endRow - mainRow - 1) }, (_, index) => mainRow + index + 1).reduce((score, row) => {
      const value = cellText(table!, row, column);
      return score + (/^(?:\d{1,3}|Факт|Наряд)$/i.test(value) ? 2 : /\d/.test(value) ? 1 : 0);
    }, 0) }));
    scores.sort((a, b) => b.score - a.score || a.column - b.column);
    if (scores[0]?.score) idColumn = scores[0].column;
  }

  const rows: ProductionOcrSourceRow[] = [];
  if (table && idColumn !== null) for (let sourceRow = mainRow + 1; sourceRow < endRow; sourceRow++) {
    const excavatorText = cellText(table, sourceRow, idColumn);
    const kind = /^факт$/i.test(excavatorText) ? "fact" as const : /^наряд$/i.test(excavatorText) ? "order" as const : "equipment" as const;
    const values = productionOcrFields.map(field => {
      const raw = cellText(table!, sourceRow, idColumn! + field.offset);
      return { key: field.key, label: field.label, category: field.category, metric: field.metric, sourceColumn: idColumn! + field.offset, raw, ...numeric(raw) };
    });
    if (!excavatorText && values.every(value => value.status === "empty")) continue;
    const excavatorNumber = kind === "equipment" && /^\d{1,3}$/.test(excavatorText) ? excavatorText : null;
    rows.push({ sourceRow, kind, excavatorText, excavatorNumber, values });
  }

  const warnings: string[] = [];
  if (!sourceDate) warnings.push("Дата таблицы не прочитана. Переснимите верхнюю часть документа.");
  if (!sourceShift) warnings.push("Номер дневного или ночного периода не прочитан.");
  if (!table) warnings.push("Раздел «Главный карьер» не найден.");
  if (table && idColumn === null) warnings.push("Столбец с номерами экскаваторов не распознан.");
  const equipment = rows.filter(row => row.kind === "equipment");
  const recognized = equipment.filter(row => row.excavatorNumber);
  const unidentified = equipment.length - recognized.length;
  if (unidentified) warnings.push(`Не прочитаны номера строк экскаваторов: ${unidentified}. Эти строки останутся для ручной проверки.`);
  const duplicates = recognized.map(row => row.excavatorNumber!).filter((number, index, all) => all.indexOf(number) !== index);
  if (duplicates.length) warnings.push(`Повторяются номера экскаваторов: ${[...new Set(duplicates)].join(", ")}. Повторные строки не переносятся.`);
  if (!recognized.length) warnings.push("Ни один номер экскаватора не прочитан уверенно.");
  const ready = Boolean(reportDate && periodKind && table && idColumn !== null && recognized.length);
  return { parserSchema: productionOcrParserSchema, sourceDate, sourceShift, reportDate, periodKind, periodKey, period, table, idColumn, rows, warnings, ready };
}

export function productionOcrImportPreview(input: unknown): OcrImportPreview {
  const parsed = parseProductionOcr(input);
  return { ready: parsed.ready, sourceDate: parsed.sourceDate, sourceShift: parsed.sourceShift, reportDate: parsed.reportDate, periodKind: parsed.periodKind,
    period: parsed.period, recognizedExcavators: new Set(parsed.rows.map(row => row.excavatorNumber).filter(Boolean)).size,
    sourceRows: parsed.rows.filter(row => row.kind === "equipment").length, warnings: parsed.warnings };
}

function field(row: ProductionOcrSourceRow, key: string) { return row.values.find(value => value.key === key); }
function decimalParts(value: ProductionOcrValue) {
  if (value.status !== "value" || value.numeric === null || value.numeric < 0 || value.numeric > 60 || value.normalized === null) return null;
  const [whole, fraction = "0"] = value.normalized.split(".");
  return [whole, fraction] as [string, string];
}
function displayNumber(value: number) { return value.toFixed(6).replace(/(?:[.]0+|([.]\d+?)0+)$/, "$1"); }

export function applyProductionOcr(parsed: ParsedProductionOcr, inputRows: ProductionRow[]): ProductionOcrApplied {
  if (!parsed.ready) throw new Error(parsed.warnings[0] || "Фото нельзя перенести в отчёт");
  const rows = currentRows(structuredClone(inputRows));
  const warnings = [...parsed.warnings], changedPaths: string[] = [];
  const sourceNumbers = parsed.rows.filter(row => row.kind === "equipment" && row.excavatorNumber);
  const duplicates = new Set(sourceNumbers.map(row => row.excavatorNumber!).filter((number, index, all) => all.indexOf(number) !== index));
  const byNumber = new Map(sourceNumbers.filter(row => !duplicates.has(row.excavatorNumber!)).map(row => [row.excavatorNumber!, row]));
  let matchedExcavators = 0;
  const setPath = (path: string) => { if (!changedPaths.includes(path)) changedPaths.push(path); };

  rows.forEach((target, index) => {
    const source = byNumber.get(target.excavator.number.trim());
    if (!source) return;
    matchedExcavators++;
    const plans = productionOcrFields.filter(item => item.plan).map(item => field(source, item.key)!).filter(value => value.status === "value" && value.numeric !== null && value.numeric >= 0 && value.numeric <= 1000);
    const facts = productionOcrFields.filter(item => item.fact).map(item => field(source, item.key)!).filter(value => value.status === "value" && value.numeric !== null && value.numeric >= 0 && value.numeric <= 1_000_000_000);
    if (plans.length) { target.plan = displayNumber(plans.reduce((sum, value) => sum + value.numeric!, 0) * 1000); setPath(`rows.${index}.plan`); }
    if (facts.length) { target.fact = displayNumber(facts.reduce((sum, value) => sum + value.numeric!, 0)); setPath(`rows.${index}.fact`); }

    const replaceLoading = (truck: number | null, value: ProductionOcrValue | undefined, expected: "rail" | "truck") => {
      if (!value || value.status === "empty") return;
      const parts = decimalParts(value);
      if (!parts) { warnings.push(`ЭКГ №${target.excavator.number}: время «${value.raw}» пропущено как сомнительное.`); return; }
      if (target.excavator.direction !== expected) { warnings.push(`ЭКГ №${target.excavator.number}: вид транспорта на фото не совпал с настройкой.`); return; }
      const loadingIndex = target.loading.findIndex(item => item.truck === truck);
      if (loadingIndex >= 0) target.loading[loadingIndex] = { ...target.loading[loadingIndex], time: parts };
      else target.loading.push({ truck, time: parts, norm: truck === null ? target.loading[0]?.norm ?? null : target.norms[String(truck)] ?? null } as Loading);
      const nextIndex = target.loading.findIndex(item => item.truck === truck);
      setPath(`rows.${index}.loading.${nextIndex}.time`);
    };
    replaceLoading(null, field(source, "loading.dumpcar"), "rail");
    replaceLoading(240, field(source, "loading.b75313"), "truck");
    replaceLoading(130, field(source, "loading.b75131"), "truck");
    const oversize = field(source, "oversize");
    if (oversize?.status === "value") {
      if (target.excavator.direction === "truck" && oversize.numeric !== null && oversize.numeric >= 0 && oversize.numeric <= 100 && oversize.normalized !== null) {
        target.oversizePercent = oversize.normalized; setPath(`rows.${index}.oversizePercent`);
      } else warnings.push(`ЭКГ №${target.excavator.number}: выход негабарита «${oversize.raw}» пропущен.`);
    }
  });

  for (const number of byNumber.keys()) if (!rows.some(row => row.excavator.number.trim() === number)) warnings.push(`ЭКГ №${number} отсутствует в настройках отчёта и не перенесён.`);
  if (!matchedExcavators) throw new Error("Распознанные номера экскаваторов отсутствуют в настройках отчёта");
  return { rows, matchedExcavators, changedFields: changedPaths.length, changedPaths, warnings: [...new Set(warnings)] };
}
