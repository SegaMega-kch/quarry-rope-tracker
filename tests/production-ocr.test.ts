import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { canUseProductionOcr, limitedBody, maximumPhotoBytes, ocrConfiguration, OcrError, parseYandexOcr, preparePhoto, recognizeYandexPhoto } from "../lib/production-ocr";
import { ocrWarnings, previewTableRows } from "../lib/production-ocr-contract";
import type { OcrResult, OcrTable } from "../lib/production-ocr-contract";
import { applyProductionOcr, parseProductionOcr, productionOcrImportPreview } from "../lib/production-ocr-import";
import { defaultRows, emptySettings, type Settings } from "../lib/production-domain";
import { isMobilePhotoRequest } from "../lib/production-mobile-photo";
import { productionPhotoRequestError, readProductionOcrResponse } from "../lib/production-photo-client";

test("OCR inherits the current shift-report access policy", () => {
  assert.equal(canUseProductionOcr({ id: 1, login: "test", role: "shift" }), false);
  assert.equal(canUseProductionOcr({ id: 2, login: "test", role: "boss" }), false);
  assert.equal(canUseProductionOcr({ id: 3, login: "test", role: "admin" }), true);
  assert.equal(canUseProductionOcr({ id: 4, login: "test", role: "storekeeper" }), false);
  assert.equal(canUseProductionOcr({ id: 5, login: "4 смена", role: "shift" }), true);
  assert.equal(canUseProductionOcr({ id: 6, login: "3 смена", role: "shift" }), false);
});

test("photo upload requires the mobile UI marker and a phone or tablet browser", () => {
  const request = (agent: string, marker = "1", hint?: string) => new Request("https://rapmas.test/api/production/ocr", { headers: {
    "User-Agent": agent, "X-Rapmas-Mobile-Photo": marker, ...(hint ? { "Sec-CH-UA-Mobile": hint } : {})
  } });
  assert.equal(isMobilePhotoRequest(request("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")), true);
  assert.equal(isMobilePhotoRequest(request("Mozilla/5.0 (Linux; Android 15; Tablet)")), true);
  assert.equal(isMobilePhotoRequest(request("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "1", "?0")), false);
  assert.equal(isMobilePhotoRequest(request("Mozilla/5.0 (Linux; Android 15)", "0", "?1")), false);
});

test("mobile photo UI converts proxy HTML and browser parsing errors into useful Russian messages", async () => {
  await assert.rejects(
    readProductionOcrResponse(new Response("<html><h1>Request Entity Too Large</h1></html>", { status: 413, headers: { "Content-Type": "text/html" } })),
    /до 10 МБ/
  );
  await assert.rejects(
    readProductionOcrResponse(new Response("<html><h1>Bad Gateway</h1></html>", { status: 502, headers: { "Content-Type": "text/html" } })),
    /временно не ответил/
  );
  await assert.rejects(
    readProductionOcrResponse(new Response("", { status: 200 })),
    /неожиданный ответ/
  );
  assert.match(productionPhotoRequestError(new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")), /связаться с сервером/);
  assert.match(productionPhotoRequestError(new DOMException("The string did not match the expected pattern.")), /связаться с сервером/);
});

test("mobile photo UI preserves safe JSON API messages and accepts the OCR contract", async () => {
  await assert.rejects(
    readProductionOcrResponse(Response.json({ message: "Распознаватель занят другим фото. Повторите через минуту." }, { status: 429 })),
    /занят другим фото/
  );
  const result = await readProductionOcrResponse(Response.json({
    schema: "rapmas-ocr-preview-v1", provider: "yandex", sha256: "a".repeat(64), width: 1200, height: 800,
    seconds: 1.2, confidence: null, text: "Главный карьер", warnings: [], tables: [],
  }));
  assert.equal(result.provider, "yandex");
});

test("Russian cloud OCR keeps decimal commas and empty strings, validates merged cells", () => {
  const result = parseYandexOcr({ textAnnotation: { fullText: "Главный карьер 09.10.2026 Смена 2", tables: [{ rowCount: "2", columnCount: "3", cells: [
    { rowIndex: "0", columnIndex: "0", rowSpan: "1", columnSpan: "2", text: "Б75313" },
    { rowIndex: "1", columnIndex: "0", text: "8,72" },
    { rowIndex: "1", columnIndex: "1", text: "0" },
    { rowIndex: "1", columnIndex: "2", text: "" },
  ] }] } });
  assert.deepEqual(result.tables[0].cells.slice(1).map(c => c.text), ["8,72", "0", ""]);
  assert.equal(result.confidence, null); // Never invent a confidence score for this API.
  assert.throws(() => parseYandexOcr({ textAnnotation: { fullText: "test", tables: [{ rowCount: "1", columnCount: "1", cells: [{ rowIndex: "0", columnIndex: "0", columnSpan: "2", text: "bad" }] }] } }), OcrError);
  assert.throws(() => parseYandexOcr({ error: "secret provider detail" }), /не вернул/);
});

test("cloud mode is opt-in, missing credentials cause no request and no fallback", async () => {
  const keys = ["PRODUCTION_OCR_PROVIDER", "YANDEX_OCR_API_KEY", "YANDEX_OCR_FOLDER_ID"] as const;
  const previous = keys.map(key => process.env[key]);
  let calls = 0;
  try {
    delete process.env.PRODUCTION_OCR_PROVIDER;
    assert.equal(ocrConfiguration().provider, "local");
    process.env.PRODUCTION_OCR_PROVIDER = "yandex";
    delete process.env.YANDEX_OCR_API_KEY; delete process.env.YANDEX_OCR_FOLDER_ID;
    assert.equal(ocrConfiguration().ready, false);
    const mock: typeof fetch = async () => { calls++; return Response.json({}); };
    await assert.rejects(recognizeYandexPhoto(Buffer.from("test"), mock), /не настроен/);
    assert.equal(calls, 0);
    process.env.YANDEX_OCR_API_KEY = "test-key"; process.env.YANDEX_OCR_FOLDER_ID = "test-folder";
    await recognizeYandexPhoto(Buffer.from("test"), async (url, init) => {
      assert.equal(url, "https://ai.api.cloud.yandex.net/ocr/v1/recognizeText");
      assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-data-logging-enabled"), "false");
      assert.equal(headers.get("Authorization"), "Api-Key test-key");
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, "table"); assert.deepEqual(body.languageCodes, ["ru", "en"]);
      return Response.json({ textAnnotation: { fullText: "Тестовая таблица", tables: [] } });
    });
    await assert.rejects(recognizeYandexPhoto(Buffer.from("test"), async () => new Response("confidential response", { status: 403 })), error => error instanceof Error && !error.message.includes("confidential"));
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});

test("uploads are decoded, EXIF removed, resolution and actual formats checked", async () => {
  await assert.rejects(preparePhoto(Buffer.alloc(maximumPhotoBytes + 1)), /10 МБ/);
  await assert.rejects(preparePhoto(Buffer.from("not a jpeg")), /не удалось открыть/);
  const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(preparePhoto(tiny), /маленькое фото/);
  const original = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "white" } }).withMetadata().jpeg().toBuffer();
  const result = await preparePhoto(original);
  assert.equal(result.width, 1200); assert.equal(result.height, 800);
  assert.equal((await sharp(result.image).metadata()).exif, undefined);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("streamed requests are capped without trusting Content-Length", async () => {
  await assert.rejects(limitedBody(new Response("123456"), 5), /размер/);
  assert.equal((await limitedBody(new Response("12345"), 5)).toString(), "12345");
});

test("preview never claims approved figures or maps unstructured OCR to categories", () => {
  const warnings = ocrWarnings("Смена 2 09.10.2026", [], "local");
  assert.ok(warnings.some(w => w.includes("Главный карьер")));
  assert.ok(warnings.some(w => w.includes("Границы ячеек")));
  assert.ok(warnings.some(w => w.includes("не перенесены")));
});

test("sparse preview preserves column gaps and positions occupied by merged cells", () => {
  const rows = previewTableRows({ rows: 2, columns: 3, cells: [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: "left" },
    { row: 0, column: 2, rowSpan: 2, columnSpan: 1, text: "right merged" },
    { row: 1, column: 0, rowSpan: 1, columnSpan: 2, text: "bottom merged" },
  ] });
  assert.deepEqual(rows[0].map(c => [c.column, c.text, c.missing]), [[0, "left", false], [1, "", true], [2, "right merged", false]]);
  assert.deepEqual(rows[1].map(c => c.column), [0]);
  assert.throws(() => parseYandexOcr({ textAnnotation: { fullText: "test", tables: [{ rowCount: "1", columnCount: "2", cells: [
    { rowIndex: "0", columnIndex: "0", columnSpan: "2", text: "merged" }, { rowIndex: "0", columnIndex: "1", text: "overlap" },
  ] }] } }), /пересекающиеся/);
  const normalized = parseYandexOcr({ textAnnotation: { fullText: "test", tables: [{ rowCount: "2", columnCount: "2", cells: [
    { rowIndex: "0", columnIndex: "0", text: "" },
    { rowIndex: "0", columnIndex: "0", rowSpan: "2", columnSpan: "1", text: "№ экск" },
    { rowIndex: "1", columnIndex: "0", text: "" },
    { rowIndex: "0", columnIndex: "1", text: "58" },
  ] }] } });
  assert.deepEqual(normalized.tables[0].cells.map(cell => cell.text), ["№ экск", "58"]);
});

function productionResult(rows: Array<Array<string | undefined>>): OcrResult {
  const table: OcrTable = { rows: rows.length, columns: 24, cells: [] };
  rows.forEach((row, rowIndex) => row.forEach((text, columnIndex) => {
    if (text !== undefined) table.cells.push({ row: rowIndex, column: columnIndex, rowSpan: 1, columnSpan: 1, text });
  }));
  return {
    schema: "rapmas-ocr-preview-v1", provider: "yandex", sha256: "b".repeat(64), width: 2560, height: 1920,
    seconds: 3.4, confidence: null, text: "Справка о работе карьеров за смену Дата - 17.10.2026 Смена 1 Карьеры ГПМ",
    warnings: [], tables: [table],
  };
}

function realisticProductionResult() {
  const row = (id: string | undefined, values: Record<number, string>) => {
    const cells: Array<string | undefined> = Array(24); cells[0] = id;
    for (const [column, value] of Object.entries(values)) cells[Number(column)] = value;
    return cells;
  };
  return productionResult([
    ["Главный карьер"],
    row("9", { 18: "2,7", 19: "2953", 21: "9,45", 23: "0,42" }),
    row("75", { 1: "0,3", 2: "721", 10: "2,5", 11: "2132", 20: "4,40" }),
    row(undefined, { 18: "1,1", 19: "1073", 21: "14,16", 23: "0,50" }),
    row("Факт", { 2: "721", 11: "7568", 19: "8607", 20: "4,85", 21: "11,10", 22: "6,16", 23: "0,41" }),
    row("Наряд", { 1: "0,3", 10: "7,3", 18: "8,3" }),
    [undefined],
    ["Западный карьер"],
  ]);
}

function importSettings(): Settings {
  const settings = emptySettings();
  settings.excavators = [
    { id: "9", number: "9", type: "ЭКГ-10", direction: "truck", truck: 130, active: true },
    { id: "75", number: "75", type: "ЭКГ-10", direction: "rail", truck: 130, active: true },
  ];
  return settings;
}

test("production table maps source shift 1 to the previous night and keeps Main quarry rows", () => {
  const result = realisticProductionResult();
  const parsed = parseProductionOcr(result);
  assert.equal(parsed.sourceDate, "2026-10-17");
  assert.equal(parsed.sourceShift, 1);
  assert.equal(parsed.reportDate, "2026-10-16");
  assert.equal(parsed.periodKind, "night");
  assert.equal(parsed.periodKey, "2026-10-16/night");
  assert.equal(parsed.ready, true);
  assert.deepEqual(parsed.rows.map(row => [row.kind, row.excavatorNumber]), [["equipment", "9"], ["equipment", "75"], ["equipment", null], ["fact", null], ["order", null]]);
  assert.ok(parsed.warnings.some(warning => warning.includes("Не прочитаны номера")));
  const preview = productionOcrImportPreview(result);
  assert.equal(preview.recognizedExcavators, 2);
  assert.equal(preview.sourceRows, 3);
  assert.match(preview.period ?? "", /16\.10\.2026.*17\.10\.2026/);
});

test("OCR overwrites only recognized report fields and preserves manual fields", () => {
  const rows = defaultRows(importSettings());
  rows[0].plan = "1"; rows[0].fact = "2"; rows[0].loadPercent = "106"; rows[0].waiting = ["1", "5"]; rows[0].note = "Проверить вручную";
  rows[0].loading[0].time = ["6", "0"];
  const applied = applyProductionOcr(parseProductionOcr(realisticProductionResult()), rows);
  const truck = applied.rows[0], rail = applied.rows[1];
  assert.equal(truck.plan, "2700"); assert.equal(truck.fact, "2953"); assert.equal(truck.oversizePercent, "0.42");
  assert.deepEqual(truck.loading.find(item => item.truck === 240)?.time, ["9", "45"]);
  assert.deepEqual(truck.loading.find(item => item.truck === 130)?.time, ["6", "0"]);
  assert.equal(truck.loadPercent, "106"); assert.deepEqual(truck.waiting, ["1", "5"]); assert.equal(truck.note, "Проверить вручную");
  assert.equal(rail.plan, "2800"); assert.equal(rail.fact, "2853"); assert.deepEqual(rail.loading[0].time, ["4", "40"]);
  assert.equal(applied.matchedExcavators, 2);
  assert.ok(applied.changedPaths.includes("rows.0.loading.1.time"));
});

test("suspicious loading values and direction-mismatched columns are skipped", () => {
  const result = realisticProductionResult();
  const row9 = result.tables[0].cells.find(cell => cell.row === 1 && cell.column === 21)!;
  row9.text = "94,5";
  result.tables[0].cells.push({ row: 1, column: 20, rowSpan: 1, columnSpan: 1, text: "4,20" });
  const applied = applyProductionOcr(parseProductionOcr(result), defaultRows(importSettings()));
  assert.equal(applied.rows[0].loading.length, 1);
  assert.ok(applied.warnings.some(warning => warning.includes("сомнительное")));
  assert.ok(applied.warnings.some(warning => warning.includes("не совпал")));
});
