import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { recognizeProductionPhoto } from "../lib/production-ocr";
import { parseProductionOcr } from "../lib/production-ocr-import";

async function main() {
  loadEnvConfig(process.cwd());
  const source = process.argv[2];
  if (!source) throw new Error("Укажите путь к одному согласованному тестовому фото");
  const result = await recognizeProductionPhoto(await readFile(source));
  const parsed = parseProductionOcr(result);
  console.log(JSON.stringify({
    provider: result.provider,
    seconds: result.seconds,
    period: result.importPreview?.period,
    ready: parsed.ready,
    recognizedExcavators: parsed.rows.filter(row => row.kind === "equipment" && row.excavatorNumber).map(row => row.excavatorNumber),
    sourceRows: parsed.rows.filter(row => row.kind === "equipment").length,
    warnings: parsed.warnings,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Ошибка проверки импорта OCR");
  process.exitCode = 1;
});
