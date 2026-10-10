import { readFile, mkdir, writeFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { preparePhoto } from "../lib/production-ocr";

async function main() {
  loadEnvConfig(process.cwd());
  const source = process.argv[2];
  const label = process.argv[3] ?? "capture";
  if (!source) throw new Error("Укажите путь к одному согласованному тестовому фото");
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Некорректная метка результата");
  const key = process.env.YANDEX_OCR_API_KEY?.trim();
  const folder = process.env.YANDEX_OCR_FOLDER_ID?.trim();
  if (!key || !folder) throw new Error("Yandex OCR не настроен");
  const photo = await preparePhoto(await readFile(source));
  const response = await fetch("https://ai.api.cloud.yandex.net/ocr/v1/recognizeText", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Api-Key ${key}`,
      "x-folder-id": folder,
      "x-data-logging-enabled": "false",
    },
    body: JSON.stringify({ mimeType: "JPEG", languageCodes: ["ru", "en"], model: "table", content: photo.image.toString("base64") }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Yandex OCR вернул HTTP ${response.status}`);
  await mkdir("outputs/production-ocr", { recursive: true });
  await writeFile(`outputs/production-ocr/yandex-${label}.json`, body);
  const parsed = JSON.parse(body);
  const annotation = parsed?.result?.textAnnotation ?? parsed?.textAnnotation;
  console.log(JSON.stringify({ status: response.status, textLength: annotation?.fullText?.length ?? 0, tables: annotation?.tables?.length ?? 0 }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Ошибка проверки Yandex OCR"); process.exitCode = 1; });
