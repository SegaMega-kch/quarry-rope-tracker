import { commentText, displayDuration, duration, productionTotals, rowResult, volume, type ProductionRow, type Snapshot, type Version } from "./production-domain";
import { periodLabel } from "./shift-calendar";

export const productionReportImageWidth = 900;
export const productionReportImageMaximumHeight = 2250;
export const productionReportCardsPerPage = 3;

export type ProductionReportTone = "normal" | "danger" | "missing" | "success";
export type ProductionReportMetric = { label: string; value: string; detail: string; tone: ProductionReportTone };
export type ProductionReportCard = {
  id: string; title: string; direction: string; state: string; metrics: ProductionReportMetric[];
  reason: string; reasonLines: string[]; reasonMissing: boolean; height: number;
};
export type ProductionReportPage = { cards: ProductionReportCard[]; height: number };
export type ProductionReportDocument = {
  title: string; period: string; author: string; version: number; incomplete: number;
  totals: Array<{ label: string; value: string; tone: ProductionReportTone }>;
  pages: ProductionReportPage[];
};

const stateLabels = { working: "Работает", repair: "Ремонт всю смену", no_crew: "Без бригады всю смену" } as const;
const pageTop = 344, pageBottom = 48, cardGap = 10;
const metricColumns = 2, metricPitch = 106, reasonLineHeight = 31;

function nonempty(parts: [string, string]) { return parts.some(part => part.trim() !== ""); }
export function hasProductionReportData(row: ProductionRow) {
  return row.state !== "working" || Boolean(row.plan.trim() || row.fact.trim() || row.loadPercent?.trim() || row.oversizePercent?.trim() ||
    nonempty(row.waiting) || row.loading.some(loading => nonempty(loading.time)) || row.reasons.length || row.note.trim());
}

function decimal(value: number, digits = 1) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}
function volumeValue(raw: string) {
  try { const value = volume(raw); return value === null ? null : `${decimal(value, 2)} м³`; } catch { return null; }
}
function timeValue(row: ProductionRow, parts: [string, string], kind: "loading" | "waiting") {
  try {
    const format = kind === "loading"
      ? row.excavator.direction === "rail" ? row.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : row.truckLoadingUnit === "decimalMinutes" ? "decimalMinutes" : "ms"
      : row.excavator.direction === "rail" ? "decimal" : "hm";
    const value = duration(parts, format);
    return { value, text: value === null ? null : displayDuration(value, format) };
  } catch { return { value: null, text: null }; }
}
function metric(label: string, value: string | null, detail = "", tone: ProductionReportTone = "normal"): ProductionReportMetric {
  return value === null ? { label, value: "—", detail: "Не заполнено", tone: "missing" } : { label, value, detail, tone };
}
function truckLabel(truck: number | null) {
  if (truck === 240) return "Б75313 · 240 т";
  if (truck === 130) return "Б75131 · 130 т";
  return truck === null ? "Думпкар" : `БЕЛАЗ · ${truck} т`;
}
// The default remains deliberately conservative for callers that do not provide their rendered text width.
export function wrapProductionReportText(text: string, maximum = 20) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean).flatMap(word => {
      if (word.length <= maximum) return [word];
      const parts: string[] = [];
      for (let offset = 0; offset < word.length; offset += maximum) parts.push(word.slice(offset, offset + maximum));
      return parts;
    });
    if (!words.length) { if (lines.length) lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      if (!line) { line = word; continue; }
      if (`${line} ${word}`.length <= maximum) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["—"];
}

function reportCard(row: ProductionRow): ProductionReportCard {
  const metrics: ProductionReportMetric[] = [];
  const plan = volumeValue(row.plan), fact = volumeValue(row.fact);
  metrics.push(metric("План", plan));
  metrics.push(metric("Факт", fact));
  let deviation: number | null = null;
  try { const p = volume(row.plan), f = volume(row.fact); if (p !== null && f !== null) deviation = f - p; } catch {}
  metrics.push(metric("Отклонение", deviation === null ? null : `${deviation > 0 ? "+" : ""}${decimal(deviation, 2)} м³`, "Факт − план", deviation !== null && deviation < 0 ? "danger" : deviation !== null && deviation > 0 ? "success" : "normal"));
  for (const loading of row.loading) {
    const actual = timeValue(row, loading.time, "loading");
    const norm = loading.norm;
    const above = actual.value !== null && norm !== null && actual.value > norm;
    const detail = norm === null ? "Норма не настроена" : `Норма ${displayDuration(norm, "decimalMinutes")}${above ? ` · выше на ${displayDuration(actual.value! - norm, "decimalMinutes")}` : ""}`;
    metrics.push(metric(`Погрузка · ${truckLabel(loading.truck)}`, actual.text, detail, above ? "danger" : "normal"));
  }
  const waiting = timeValue(row, row.waiting, "waiting");
  metrics.push(metric(row.excavator.direction === "rail" ? "Ожидание порожняка" : "Ожидание самосвалов", waiting.text,
    row.excavator.direction === "rail" ? "Десятичные часы" : "Часы и минуты"));
  if (row.excavator.direction === "truck") metrics.push(metric("Выход негабарита", row.oversizePercent.trim() ? `${row.oversizePercent.replace(".", ",")} %` : null, "Только автотранспорт"));

  const result = rowResult(row), text = commentText(row).trim();
  const reasonRequired = row.state === "working" && Boolean(result.comment);
  const reasonMissing = reasonRequired && !text;
  const reason = text || (reasonMissing ? "—" : result.comment || "Причины отклонений не указаны");
  const reasonLines = wrapProductionReportText(reason, 28);
  const metricRows = Math.ceil(metrics.length / metricColumns);
  const reasonBoxHeight = Math.max(52, Math.max(1, reasonLines.length) * reasonLineHeight + 16);
  const height = 126 + metricRows * metricPitch + reasonBoxHeight;
  return {
    id: row.excavator.id,
    title: `${row.excavator.type} №${row.excavator.number}`,
    direction: row.excavator.direction === "rail" ? "Железнодорожный транспорт" : "Автотранспорт",
    state: stateLabels[row.state], metrics, reason, reasonLines, reasonMissing, height
  };
}

export function productionReportMissing(snapshot: Snapshot) {
  return snapshot.rows.filter(hasProductionReportData).reduce((count, row) => {
    const card = reportCard(row);
    return count + card.metrics.filter(item => item.tone === "missing").length + (card.reasonMissing ? 1 : 0);
  }, 0);
}

export function createProductionReportDocument(version: Readonly<Version>): ProductionReportDocument {
  const rows = version.snapshot.rows.filter(hasProductionReportData);
  const cards = rows.map(reportCard);
  const totals = productionTotals(rows);
  const deviation = totals.filled ? totals.fact - totals.plan : null;
  const summary: ProductionReportDocument["totals"] = [
    { label: "План", value: totals.filled ? `${decimal(totals.plan, 2)} м³` : "—", tone: totals.filled ? "normal" : "missing" },
    { label: "Факт", value: totals.filled ? `${decimal(totals.fact, 2)} м³` : "—", tone: totals.filled ? "normal" : "missing" },
    { label: "Отклонение", value: deviation === null ? "—" : `${deviation > 0 ? "+" : ""}${decimal(deviation, 2)} м³`, tone: deviation === null ? "missing" : deviation < 0 ? "danger" : deviation > 0 ? "success" : "normal" },
    { label: "Выполнение", value: totals.percent === null ? "—" : `${decimal(totals.percent)} %`, tone: totals.percent === null ? "missing" : totals.percent < 100 ? "danger" : "success" },
  ];
  const pages: ProductionReportPage[] = [];
  let current: ProductionReportCard[] = [], used = pageTop;
  const finish = () => {
    const content = current.reduce((sum, card) => sum + card.height, 0) + Math.max(0, current.length - 1) * cardGap;
    pages.push({ cards: current, height: Math.max(900, Math.min(7680, pageTop + content + pageBottom)) });
    current = []; used = pageTop;
  };
  for (const card of cards) {
    const next = card.height + (current.length ? cardGap : 0);
    if (current.length && (current.length >= productionReportCardsPerPage || used + next + pageBottom > productionReportImageMaximumHeight)) finish();
    current.push(card); used += next;
  }
  if (current.length || !pages.length) finish();
  return { title: "Итоговый отчёт за смену", period: periodLabel(version.snapshot.period), author: version.author, version: version.number,
    incomplete: productionReportMissing(version.snapshot) + (cards.length ? 0 : 1), totals: summary, pages };
}
