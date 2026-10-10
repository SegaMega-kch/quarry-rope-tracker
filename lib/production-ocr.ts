import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import sharp, { type Metadata } from "sharp";
import { canUseProduction, type Actor } from "./production-store";
import { ocrWarnings, type OcrConfiguration, type OcrTable, type OcrResult } from "./production-ocr-contract";

export class OcrError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export const maximumPhotoBytes = 10 * 1024 * 1024;
const maximumResponseBytes = 4 * 1024 * 1024;

export function canUseProductionOcr(actor: Actor) {
  return canUseProduction(actor.role);
}
export function ocrConfiguration(): OcrConfiguration {
  const mode = process.env.PRODUCTION_OCR_PROVIDER ?? "local";
  if (mode === "local") return { provider: "local", ready: true, message: "Локальная проверка. Фотография обрабатывается на сервере rapmas; сторонним сервисам не передаётся." };
  if (mode === "yandex") {
    const ready = Boolean(process.env.YANDEX_OCR_API_KEY?.trim() && process.env.YANDEX_OCR_FOLDER_ID?.trim());
    return { provider: "yandex", ready, message: ready ? "Фотография будет передана в Yandex Vision OCR для распознавания таблицы." : "Подключение Yandex Vision OCR подготовлено. Для проверки требуется настройка доступа администратором." };
  }
  throw new OcrError("Неизвестная настройка распознавателя", 503);
}

export async function preparePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > maximumPhotoBytes) throw new OcrError("Выберите фотографию размером до 10 МБ", 413);
  let metadata: Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata(); }
  catch { throw new OcrError("Файл не удалось открыть как фотографию. Используйте JPEG, PNG или WebP."); }
  if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages ?? 1) !== 1) throw new OcrError("Поддерживается одна фотография JPEG, PNG или WebP");
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) throw new OcrError("Слишком большое разрешение фотографии: максимум 20 мегапикселей");
  if (metadata.width < 1000 || metadata.height < 600) throw new OcrError("Слишком маленькое фото для этой таблицы. Прикрепите оригинал, на котором различимы цифры.");
  // Decode, orient, and strip EXIF (including GPS). Original bytes are never written to disk.
  const { data, info } = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate().flatten({ background: "white" }).jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
  return { image: data, width: info.width, height: info.height, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function localRecognize(image: Buffer): Promise<{ text: string; confidence: number; tables: OcrTable[] }> {
  const configured = process.env.PRODUCTION_OCR_MODEL_PATH;
  if (configured && !isAbsolute(configured)) throw new OcrError("Для моделей OCR нужен абсолютный путь", 503);
  const modelPath = configured || resolve(".data/ocr-models");
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve("scripts/production-ocr-worker.cjs")], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
    });
    let output = "", ended = false;
    const finish = (error?: OcrError) => {
      if (ended) return; ended = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else { try { accept(JSON.parse(output)); } catch { reject(new OcrError("Некорректный ответ локального распознавателя. Повторите проверку.", 503)); } }
    };
    const timer = setTimeout(() => finish(new OcrError("Распознавание заняло больше 90 секунд. Попробуйте более чёткое фото.", 504)), 90_000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > maximumResponseBytes) finish(new OcrError("Слишком большой ответ распознавателя", 503));
    });
    child.stderr.on("data", () => {}); // Do not put photographed production values in application logs.
    child.on("error", () => finish(new OcrError("Локальный распознаватель не запустился", 503)));
    child.on("close", code => finish(code === 0 ? undefined : new OcrError("Не удалось распознать фото локально. Повторите проверку.", 503)));
    child.stdin.on("error", () => finish(new OcrError("Локальный распознаватель остановился", 503)));
    child.stdin.end(JSON.stringify({ image: image.toString("base64"), modelPath }));
  });
}

type YandexCell = { rowIndex?: string; columnIndex?: string; rowSpan?: string; columnSpan?: string; text?: string };
type YandexAnnotation = { fullText?: string; tables?: Array<{ rowCount?: string; columnCount?: string; cells?: YandexCell[] }> };
export function parseYandexOcr(input: unknown): { text: string; confidence: null; tables: OcrTable[] } {
  const data = input as { textAnnotation?: YandexAnnotation; result?: { textAnnotation?: YandexAnnotation } } | null;
  const annotation = data?.textAnnotation ?? data?.result?.textAnnotation;
  if (!annotation || typeof annotation.fullText !== "string" || annotation.fullText.length > 500_000) throw new OcrError("Сервис не вернул распознанный текст", 502);
  if (annotation.tables && !Array.isArray(annotation.tables)) throw new OcrError("Некорректная структура таблиц в ответе сервиса", 502);
  const tables = (annotation.tables ?? []).map(table => {
    const rows = Number(table.rowCount), columns = Number(table.columnCount);
    if (!Number.isInteger(rows) || rows < 1 || rows > 300 || !Number.isInteger(columns) || columns < 1 || columns > 100 || !Array.isArray(table.cells) || table.cells.length > 30_000) throw new OcrError("Некорректные размеры распознанной таблицы", 502);
    const parsedCells = table.cells.map(cell => {
      const row = Number(cell.rowIndex), column = Number(cell.columnIndex), rowSpan = Number(cell.rowSpan ?? 1), columnSpan = Number(cell.columnSpan ?? 1);
      if (![row, column, rowSpan, columnSpan].every(Number.isInteger) || row < 0 || column < 0 || rowSpan < 1 || columnSpan < 1 || row + rowSpan > rows || column + columnSpan > columns || typeof cell.text !== "string" || cell.text.length > 10_000) throw new OcrError("Некорректная ячейка в ответе сервиса", 502);
      return { row, column, rowSpan, columnSpan, text: cell.text };
    });
    // Vision may emit an empty 1x1 placeholder underneath a meaningful merged cell.
    // Drop only that harmless duplicate. Never choose between two values.
    const cells = parsedCells.filter((cell, index) => !(cell.rowSpan === 1 && cell.columnSpan === 1 && !cell.text.trim() && parsedCells.some((other, otherIndex) =>
      otherIndex !== index && Boolean(other.text.trim()) && cell.row >= other.row && cell.row < other.row + other.rowSpan && cell.column >= other.column && cell.column < other.column + other.columnSpan
    )));
    const occupied = new Set<string>();
    for (const cell of cells) {
      const { row, column, rowSpan, columnSpan } = cell;
      for (let y = row; y < row + rowSpan; y++) for (let x = column; x < column + columnSpan; x++) {
        const key = `${y}/${x}`;
        if (occupied.has(key)) throw new OcrError("Сервис вернул пересекающиеся ячейки. Повторите распознавание.", 502);
        occupied.add(key);
      }
    }
    return { rows, columns, cells };
  });
  return { text: annotation.fullText, confidence: null, tables };
}

export async function recognizeYandexPhoto(image: Buffer, fetcher: typeof fetch = fetch) {
  const config = ocrConfiguration();
  if (config.provider !== "yandex" || !config.ready) throw new OcrError("Для Yandex Vision OCR ещё не настроен доступ", 503);
  let response: Response;
  try {
    response = await fetcher("https://ai.api.cloud.yandex.net/ocr/v1/recognizeText", {
      method: "POST", signal: AbortSignal.timeout(60_000), redirect: "error",
      headers: { "Content-Type": "application/json", "Authorization": `Api-Key ${process.env.YANDEX_OCR_API_KEY!.trim()}`, "x-folder-id": process.env.YANDEX_OCR_FOLDER_ID!.trim(), "x-data-logging-enabled": "false" },
      body: JSON.stringify({ mimeType: "JPEG", languageCodes: ["ru", "en"], model: "table", content: image.toString("base64") }),
    });
  } catch { throw new OcrError("Нет ответа Yandex Vision OCR. Фото не перенесено в отчёт; повторите позже.", 503); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new OcrError(response.status === 401 || response.status === 403 ? "Сервис отклонил доступ. Администратору нужно проверить ключ и права OCR." : response.status === 429 ? "Достигнут лимит распознавания. Повторите позже." : "Сервис не смог распознать фото. Повторите позже.", 503);
  }
  return parseYandexOcr(JSON.parse((await limitedBody(response, maximumResponseBytes)).toString("utf8")));
}

export async function limitedBody(input: { body: ReadableStream<Uint8Array> | null }, limit: number) {
  if (!input.body) throw new OcrError("Пустой запрос", 400);
  const reader = input.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new OcrError("Превышен допустимый размер данных", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

const scope = globalThis as unknown as { productionOcrBusy?: boolean };
export async function recognizeProductionPhoto(bytes: Buffer): Promise<OcrResult> {
  if (scope.productionOcrBusy) throw new OcrError("Распознаватель занят другим фото. Повторите через минуту.", 429);
  const config = ocrConfiguration();
  if (!config.ready) throw new OcrError(config.message, 503);
  scope.productionOcrBusy = true;
  const start = Date.now();
  try {
    const photo = await preparePhoto(bytes);
    const result = await (config.provider === "local" ? localRecognize(photo.image) : recognizeYandexPhoto(photo.image));
    return { ...result, provider: config.provider, schema: "rapmas-ocr-preview-v1", sha256: photo.sha256, width: photo.width, height: photo.height, seconds: Math.round((Date.now() - start) / 100) / 10, warnings: ocrWarnings(result.text, result.tables, config.provider) };
  } finally { scope.productionOcrBusy = false; }
}
