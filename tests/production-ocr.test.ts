import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { canUseProductionOcr, limitedBody, maximumPhotoBytes, ocrConfiguration, OcrError, parseYandexOcr, preparePhoto, recognizeYandexPhoto } from "../lib/production-ocr";
import { ocrWarnings, previewTableRows } from "../lib/production-ocr-contract";
import { isMobilePhotoRequest } from "../lib/production-mobile-photo";

test("OCR is available to every account that can use the shift report", () => {
  assert.equal(canUseProductionOcr({ id: 1, login: "test", role: "shift" }), true);
  assert.equal(canUseProductionOcr({ id: 2, login: "test", role: "boss" }), true);
  assert.equal(canUseProductionOcr({ id: 3, login: "test", role: "admin" }), true);
  assert.equal(canUseProductionOcr({ id: 4, login: "test", role: "storekeeper" }), false);
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
