import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createProductionReportDocument, productionReportImageWidth, wrapProductionReportText, type ProductionReportDocument, type ProductionReportMetric, type ProductionReportTone } from "./production-report-model";
import type { Version } from "./production-domain";

/*
THESIS: one phone-readable operational sheet grouped by excavator; it refuses the wide desktop table.
OWN-WORLD: warm paper, white equipment sections, charcoal headers, orange wayfinding, explicit red exception fields.
STORY: identify the shift, scan totals, then inspect every entered excavator and its complete reason without opening data views.
FIRST VIEWPORT: shift identity and totals lead; equipment sections follow intact and may move only as whole units between images.
FORM: established rapmas visual world extended as a mobile report image.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/

const palette = {
  page: "#f4f1eb", card: "#ffffff", text: "#24211d", muted: "#66615a", line: "#d7d0c6",
  orange: "#9a4308", orangeSoft: "#fff0dc", dark: "#2a2824", danger: "#a12a27", dangerSoft: "#fff0ec",
  success: "#226437", successSoft: "#e8f3e8", neutral: "#f1eee8"
};
const reportFontFiles = ["Regular", "SemiBold", "Bold"].map(weight => resolve(process.cwd(), `public/fonts/IBMPlexSans-${weight}.ttf`));
let sharpModule: Promise<typeof import("sharp")> | null = null;

export function productionReportFontAssets() {
  return { fonts: [...reportFontFiles] };
}

function assertProductionReportFonts() {
  const missing = reportFontFiles.filter(path => !existsSync(path));
  if (missing.length) throw new Error("Не найдены встроенные шрифты для итогового отчёта");
}

async function reportSharp() {
  assertProductionReportFonts();
  sharpModule ??= import("sharp");
  return (await sharpModule).default;
}

const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 12, stroke = "none") =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
type ReportTextLayer = { value: string; x: number; y: number; size: number; weight: number; fill: string; anchor: string };
type ReportText = (value: string, x: number, y: number, size: number, weight?: number, fill?: string, anchor?: string) => string;
const textSvg: ReportText = (value, x, y, size, weight = 400, fill = palette.text, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="IBM Plex Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
function tone(tone: ProductionReportTone) {
  if (tone === "danger" || tone === "missing") return { background: palette.dangerSoft, foreground: palette.danger };
  if (tone === "success") return { background: palette.successSoft, foreground: palette.success };
  return { background: palette.neutral, foreground: palette.text };
}
function metricSvg(item: ProductionReportMetric, x: number, y: number, width: number, drawText: ReportText) {
  const color = tone(item.tone);
  const details = item.detail ? wrapProductionReportText(item.detail, 28).slice(0, 2) : [];
  return [rect(x, y, width, 100, color.background, 10), drawText(item.label, x + 14, y + 26, 20, 600, palette.muted),
    drawText(item.value, x + 14, y + 60, 29, 700, color.foreground), ...details.map((line, index) => drawText(line, x + 14, y + 81 + index * 16, 15, 400, item.tone === "danger" || item.tone === "missing" ? palette.danger : palette.muted))].join("");
}
function pageSvg(document: ProductionReportDocument, pageIndex: number, textLayers?: ReportTextLayer[]) {
  const page = document.pages[pageIndex], width = productionReportImageWidth, margin = 36, inner = width - margin * 2;
  const output: string[] = [];
  const drawText: ReportText = textLayers ? (value, x, y, size, weight = 400, fill = palette.text, anchor = "start") => {
    textLayers.push({ value, x, y, size, weight, fill, anchor });
    return "";
  } : textSvg;
  output.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${page.height}" viewBox="0 0 ${width} ${page.height}">`);
  output.push(`<!-- THESIS: phone-readable report grouped by excavator; cards never split between images. -->`);
  output.push(rect(0, 0, width, page.height, palette.page, 0), rect(0, 0, width, 12, palette.orange, 0));
  output.push(drawText(document.title.toLocaleUpperCase("ru-RU"), margin, 54, 34, 700));
  output.push(drawText(document.period, margin, 89, 26, 600));
  output.push(drawText(`Главный карьер · Мастер: ${document.author}`, margin, 121, 21, 400, palette.muted));
  output.push(drawText(`Стр. ${pageIndex + 1} из ${document.pages.length}`, width - margin, 54, 20, 600, palette.muted, "end"));
  if (document.incomplete) {
    output.push(rect(margin, 138, inner, 48, palette.dangerSoft, 9, "#efb8ae"));
    output.push(drawText(`Незаполненные показатели: ${document.incomplete}. Они отмечены красным.`, margin + 14, 170, 21, 600, palette.danger));
  } else {
    output.push(rect(margin, 138, inner, 48, palette.successSoft, 9));
    output.push(drawText("Все обязательные показатели заполнены", margin + 14, 170, 21, 600, palette.success));
  }
  const summaryGap = 10, summaryWidth = (inner - summaryGap) / 2;
  document.totals.forEach((item, index) => {
    const x = margin + (index % 2) * (summaryWidth + summaryGap), y = 198 + Math.floor(index / 2) * 70, colors = tone(item.tone);
    output.push(rect(x, y, summaryWidth, 60, colors.background, 10));
    output.push(drawText(item.label, x + 12, y + 22, 18, 600, palette.muted));
    output.push(drawText(item.value, x + 12, y + 50, 25, 700, colors.foreground));
  });
  let y = 344;
  for (const card of page.cards) {
    output.push(rect(margin, y, inner, card.height, palette.card, 14, palette.line));
    output.push(rect(margin, y, inner, 68, palette.dark, 14));
    output.push(rect(margin, y + 56, inner, 12, palette.dark, 0));
    output.push(drawText(card.title, margin + 20, y + 44, 28, 700, "#ffffff"));
    output.push(drawText(card.direction, width - margin - 20, y + 28, 18, 600, "#f8d8b3", "end"));
    output.push(drawText(card.state, width - margin - 20, y + 53, 17, 600, "#f8d8b3", "end"));
    const metricGap = 10, metricWidth = (inner - 40 - metricGap) / 2;
    let metricY = y + 80;
    card.metrics.forEach((item, index) => {
      if (index > 0 && index % 2 === 0) metricY += 106;
      const x = margin + 20 + (index % 2) * (metricWidth + metricGap);
      output.push(metricSvg(item, x, metricY, metricWidth, drawText));
    });
    const rows = Math.ceil(card.metrics.length / 2), reasonY = y + 80 + rows * 106;
    output.push(drawText("Причины и пояснение", margin + 20, reasonY + 24, 21, 700, card.reasonMissing ? palette.danger : palette.muted));
    output.push(rect(margin + 20, reasonY + 32, inner - 40, Math.max(52, card.reasonLines.length * 31 + 16), card.reasonMissing ? palette.dangerSoft : "#faf8f4", 10));
    card.reasonLines.forEach((line, index) => output.push(drawText(line || " ", margin + 34, reasonY + 59 + index * 31, 24, card.reasonMissing ? 700 : 400, card.reasonMissing ? palette.danger : palette.text)));
    y += card.height + 10;
  }
  if (!page.cards.length) {
    output.push(rect(margin, y, inner, 210, palette.card, 14, palette.line));
    output.push(drawText("Нет заполненных строк по экскаваторам", width / 2, y + 90, 28, 700, palette.danger, "middle"));
    output.push(drawText("Вернитесь к отчёту, заполните показатели и сформируйте новую итоговую версию.", width / 2, y + 135, 19, 400, palette.muted, "middle"));
  }
  output.push(drawText(`rapmas.ru · итоговая версия ${document.version}`, margin, page.height - 22, 18, 600, palette.muted));
  output.push("</svg>");
  return output.join("");
}

export function productionReportSvgPages(version: Readonly<Version>) {
  const document = createProductionReportDocument(version);
  return document.pages.map((_, index) => pageSvg(document, index));
}

export async function renderProductionReportImages(version: Readonly<Version>) {
  const sharp = await reportSharp();
  const document = createProductionReportDocument(version);
  return Promise.all(document.pages.map(async (_, index) => {
    const layers: ReportTextLayer[] = [];
    const background = pageSvg(document, index, layers);
    const textImages = await Promise.all(layers.map(async layer => {
      const fontfile = reportFontFiles[layer.weight >= 700 ? 2 : layer.weight >= 600 ? 1 : 0];
      const rendered = await sharp({ text: { text: `<span foreground="${layer.fill}" font_weight="${layer.weight}">${esc(layer.value)}</span>`, font: `IBM Plex Sans ${layer.size}`, fontfile, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
      const width = rendered.info.width;
      const left = layer.anchor === "end" ? layer.x - width : layer.anchor === "middle" ? layer.x - width / 2 : layer.x;
      return { input: rendered.data, left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(layer.y - rendered.info.height * 0.82)) };
    }));
    return sharp(Buffer.from(background), { density: 72 }).composite(textImages).png({ compressionLevel: 9 }).toBuffer();
  }));
}
