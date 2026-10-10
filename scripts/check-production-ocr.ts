import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error("Укажите пути к фотографиям. Обработка только на этом компьютере.");
  const langPath = resolve(".data/ocr-models");
  await mkdir(langPath, { recursive: true });
  await Promise.all(["rus", "eng"].map(code => copyFile(join(dirname(require.resolve(`@tesseract.js-data/${code}`)), "4.0.0_best_int", `${code}.traineddata.gz`), join(langPath, `${code}.traineddata.gz`))));
  const worker = await createWorker("rus+eng", 1, { langPath, cacheMethod: "none", gzip: true });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    await mkdir("outputs/production-ocr", { recursive: true });
    for (const [index, path] of paths.entries()) {
      const start = Date.now();
      const base = await sharp(await readFile(path), { limitInputPixels: 20_000_000 }).rotate().resize({ width: 1800 }).greyscale().median(3).normalize().png().toBuffer();
      const image = await sharp(base).resize({ width: 3000 }).threshold(125).png().toBuffer();
      await writeFile(`outputs/production-ocr/${index + 1}.png`, image);
      const { data } = await worker.recognize(image, {}, { text: true, tsv: true });
      await writeFile(`outputs/production-ocr/${index + 1}.txt`, data.text);
      await writeFile(`outputs/production-ocr/${index + 1}.tsv`, data.tsv || "");
      console.log(JSON.stringify({ path, confidence: data.confidence, seconds: (Date.now() - start) / 1000, text: data.text }));
      if (index === 0) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "0123456789.,-" });
        // Diagnostic rectangles for the reference image, never used by the site importer.
        for (const [label, x, y, width, height] of [["1047", 185, 835, 110, 23], ["16,26", 361, 835, 48, 24], ["4,72", 1680, 718, 65, 22], ["8,72", 1608, 750, 65, 24], ["10,57", 1608, 783, 65, 24]] as const) {
          const metadata = await sharp(await readFile(path)).metadata(); const factor = metadata.width! / 1824;
          const cell = await sharp(await readFile(path)).extract({ left: Math.round(x * factor), top: Math.round(y * factor), width: Math.round(width * factor), height: Math.round(height * factor) }).greyscale().median(3).normalize().resize({ height: 64 }).extend({ top: 12, bottom: 12, left: 12, right: 12, background: "white" }).png().toBuffer();
          const result = await worker.recognize(cell); console.log(JSON.stringify({ expected: label, got: result.data.text.trim(), confidence: result.data.confidence }));
        }
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, tessedit_char_whitelist: "" });
      }
    }
  } finally { await worker.terminate(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
