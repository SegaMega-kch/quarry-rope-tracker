import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { defaultRows, emptySettings, normKey, type Version } from "../lib/production-domain";
import { createProductionReportDocument, hasProductionReportData, productionReportImageMaximumHeight, productionReportImageWidth, wrapProductionReportText } from "../lib/production-report-model";
import { productionReportSvgPages, renderProductionReportImages } from "../lib/production-report-image";
import { workPeriod } from "../lib/shift-calendar";

function fixture(): Version {
  const settings = emptySettings();
  settings.excavators = [
    { id: "75", number: "75", type: "ЭКГ-12", direction: "rail", truck: 130, active: true },
    { id: "60", number: "60", type: "ЭКГ-20", direction: "truck", truck: 240, active: true },
    { id: "unused", number: "99", type: "ЭКГ-10", direction: "truck", truck: 130, active: true },
  ];
  settings.norms[normKey("ЭКГ-12", "rail")] = ["3", "84"];
  settings.norms[normKey("ЭКГ-20", "truck", 240)] = ["3", "77"];
  const rows = defaultRows(settings);
  Object.assign(rows[0], { plan: "1500", fact: "1200", waiting: ["1", "5"], note: "Ожидание железнодорожного состава. Аварийный ремонт в течение двух часов." });
  rows[0].loading[0].time = ["4", "2"];
  Object.assign(rows[1], { plan: "2000", fact: "2150", oversizePercent: "1,03", waiting: ["0", "45"], note: "Работа без замечаний" });
  rows[1].loading[0].time = ["4", "50"];
  return { id: "11111111-1111-4111-8111-111111111111", periodKey: "2026-10-10/day", number: 3, kind: "final", correction: false,
    sourceId: null, previousId: null, author: "4 смена", at: "2026-10-10T12:00:00.000Z", snapshot: { period: workPeriod("2026-10-10", "day"), rows }, delivery: "not_configured" };
}

test("image report includes only entered excavators, full reasons and mobile groups", () => {
  const version = fixture();
  assert.equal(hasProductionReportData(version.snapshot.rows[2]), false);
  const document = createProductionReportDocument(version);
  assert.equal(document.pages.flatMap(page => page.cards).length, 2);
  assert.match(document.pages[0].cards[0].reason, /Аварийный ремонт/);
  assert.ok(document.pages.every(page => page.cards.every(card => card.height < page.height)));
  const svg = productionReportSvgPages(version).join("\n");
  assert.match(svg, /Б75313 · 240 т/);
  assert.match(svg, /выше на/);
  assert.doesNotMatch(svg, /№99/);
  assert.doesNotMatch(svg, /Загрузка, %/);
});

test("a normal report page holds up to three complete excavator groups", () => {
  const version = fixture();
  Object.assign(version.snapshot.rows[2], { plan: "900", fact: "910", note: "Работа без замечаний" });
  const document = createProductionReportDocument(version);
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].cards.length, 3);
  assert.ok(document.pages[0].height <= productionReportImageMaximumHeight);
});

test("missing values use explicit dashes and red treatment without blocking the final image", () => {
  const version = fixture();
  version.snapshot.rows[0].waiting = ["", ""];
  version.snapshot.rows[0].note = "";
  const document = createProductionReportDocument(version);
  assert.ok(document.incomplete >= 2);
  const svg = productionReportSvgPages(version)[0];
  assert.match(svg, /Не заполнено/);
  assert.match(svg, /#fff0ec/);
});

test("very long reason tokens wrap without truncating content", () => {
  const token = "А".repeat(105);
  const lines = wrapProductionReportText(token);
  assert.ok(lines.every(line => line.length <= 20));
  assert.equal(lines.join(""), token);
});

test("renderer produces bounded PNG pages and never splits an excavator card", async () => {
  const version = fixture();
  version.snapshot.rows[0].note = "Длительное пояснение ".repeat(120);
  const document = createProductionReportDocument(version);
  const images = await renderProductionReportImages(version);
  assert.equal(images.length, document.pages.length);
  for (let index = 0; index < images.length; index++) {
    const metadata = await sharp(images[index]).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, productionReportImageWidth);
    assert.ok((metadata.height ?? 0) <= 7680);
    assert.ok(document.pages[index].cards.every(card => card.height < document.pages[index].height));
  }
});
