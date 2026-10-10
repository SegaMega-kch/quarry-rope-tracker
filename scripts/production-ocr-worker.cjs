/* An isolated local OCR process. Image/model bytes never go to a network service. */
const { createWorker, PSM } = require("tesseract.js");
const { mkdir, copyFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");
const sharp = require("sharp");

async function main() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error("Image too large");
    chunks.push(chunk);
  }
  const { image, modelPath } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  await mkdir(modelPath, { recursive: true });
  await Promise.all(["rus", "eng"].map(code => copyFile(
    join(dirname(require.resolve(`@tesseract.js-data/${code}`)), "4.0.0_best_int", `${code}.traineddata.gz`),
    join(modelPath, `${code}.traineddata.gz`)
  )));
  const worker = await createWorker("rus+eng", 1, {
    langPath: modelPath, cacheMethod: "none", gzip: true,
    workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const original = Buffer.from(image, "base64");
    const base = await sharp(original).resize({ width: 1800 }).greyscale().median(3).normalize().png().toBuffer();
    const processed = await sharp(base).resize({ width: 3000 }).threshold(125).png().toBuffer();
    const { data } = await worker.recognize(processed);
    process.stdout.write(JSON.stringify({ text: data.text, confidence: data.confidence, tables: [] }));
  } finally { await worker.terminate(); }
}
main().catch(() => { process.stderr.write("Local OCR failed\n"); process.exitCode = 1; });
