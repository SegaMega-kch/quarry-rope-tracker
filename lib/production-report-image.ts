import sharp from "sharp";
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
const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 12, stroke = "none") =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const text = (value: string, x: number, y: number, size: number, weight = 400, fill = palette.text, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
function tone(tone: ProductionReportTone) {
  if (tone === "danger" || tone === "missing") return { background: palette.dangerSoft, foreground: palette.danger };
  if (tone === "success") return { background: palette.successSoft, foreground: palette.success };
  return { background: palette.neutral, foreground: palette.text };
}
function metricSvg(item: ProductionReportMetric, x: number, y: number, width: number) {
  const color = tone(item.tone);
  const details = item.detail ? wrapProductionReportText(item.detail, 28).slice(0, 2) : [];
  return [rect(x, y, width, 100, color.background, 10), text(item.label, x + 14, y + 26, 20, 600, palette.muted),
    text(item.value, x + 14, y + 60, 29, 700, color.foreground), ...details.map((line, index) => text(line, x + 14, y + 81 + index * 16, 15, 400, item.tone === "danger" || item.tone === "missing" ? palette.danger : palette.muted))].join("");
}
function pageSvg(document: ProductionReportDocument, pageIndex: number) {
  const page = document.pages[pageIndex], width = productionReportImageWidth, margin = 36, inner = width - margin * 2;
  const output: string[] = [];
  output.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${page.height}" viewBox="0 0 ${width} ${page.height}">`);
  output.push(`<!-- THESIS: phone-readable report grouped by excavator; cards never split between images. -->`);
  output.push(rect(0, 0, width, page.height, palette.page, 0), rect(0, 0, width, 12, palette.orange, 0));
  output.push(text(document.title.toLocaleUpperCase("ru-RU"), margin, 54, 34, 700));
  output.push(text(document.period, margin, 89, 26, 600));
  output.push(text(`Главный карьер · Мастер: ${document.author}`, margin, 121, 21, 400, palette.muted));
  output.push(text(`Стр. ${pageIndex + 1} из ${document.pages.length}`, width - margin, 54, 20, 600, palette.muted, "end"));
  if (document.incomplete) {
    output.push(rect(margin, 138, inner, 48, palette.dangerSoft, 9, "#efb8ae"));
    output.push(text(`Незаполненные показатели: ${document.incomplete}. Они отмечены красным.`, margin + 14, 170, 21, 600, palette.danger));
  } else {
    output.push(rect(margin, 138, inner, 48, palette.successSoft, 9));
    output.push(text("Все обязательные показатели заполнены", margin + 14, 170, 21, 600, palette.success));
  }
  const summaryGap = 10, summaryWidth = (inner - summaryGap) / 2;
  document.totals.forEach((item, index) => {
    const x = margin + (index % 2) * (summaryWidth + summaryGap), y = 198 + Math.floor(index / 2) * 70, colors = tone(item.tone);
    output.push(rect(x, y, summaryWidth, 60, colors.background, 10));
    output.push(text(item.label, x + 12, y + 22, 18, 600, palette.muted));
    output.push(text(item.value, x + 12, y + 50, 25, 700, colors.foreground));
  });
  let y = 344;
  for (const card of page.cards) {
    output.push(rect(margin, y, inner, card.height, palette.card, 14, palette.line));
    output.push(rect(margin, y, inner, 68, palette.dark, 14));
    output.push(rect(margin, y + 56, inner, 12, palette.dark, 0));
    output.push(text(card.title, margin + 20, y + 44, 28, 700, "#ffffff"));
    output.push(text(card.direction, width - margin - 20, y + 28, 18, 600, "#f8d8b3", "end"));
    output.push(text(card.state, width - margin - 20, y + 53, 17, 600, "#f8d8b3", "end"));
    const metricGap = 10, metricWidth = (inner - 40 - metricGap) / 2;
    let metricY = y + 80;
    card.metrics.forEach((item, index) => {
      if (index > 0 && index % 2 === 0) metricY += 106;
      const x = margin + 20 + (index % 2) * (metricWidth + metricGap);
      output.push(metricSvg(item, x, metricY, metricWidth));
    });
    const rows = Math.ceil(card.metrics.length / 2), reasonY = y + 80 + rows * 106;
    output.push(text("Причины и пояснение", margin + 20, reasonY + 24, 21, 700, card.reasonMissing ? palette.danger : palette.muted));
    output.push(rect(margin + 20, reasonY + 32, inner - 40, Math.max(52, card.reasonLines.length * 31 + 16), card.reasonMissing ? palette.dangerSoft : "#faf8f4", 10));
    card.reasonLines.forEach((line, index) => output.push(text(line || " ", margin + 34, reasonY + 59 + index * 31, 24, card.reasonMissing ? 700 : 400, card.reasonMissing ? palette.danger : palette.text)));
    y += card.height + 10;
  }
  if (!page.cards.length) {
    output.push(rect(margin, y, inner, 210, palette.card, 14, palette.line));
    output.push(text("Нет заполненных строк по экскаваторам", width / 2, y + 90, 28, 700, palette.danger, "middle"));
    output.push(text("Вернитесь к отчёту, заполните показатели и сформируйте новую итоговую версию.", width / 2, y + 135, 19, 400, palette.muted, "middle"));
  }
  output.push(text(`rapmas.ru · итоговая версия ${document.version}`, margin, page.height - 22, 18, 600, palette.muted));
  output.push("</svg>");
  return output.join("");
}

export function productionReportSvgPages(version: Readonly<Version>) {
  const document = createProductionReportDocument(version);
  return document.pages.map((_, index) => pageSvg(document, index));
}

export async function renderProductionReportImages(version: Readonly<Version>) {
  return Promise.all(productionReportSvgPages(version).map(svg => sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toBuffer()));
}
