import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OcrResult } from "./production-ocr-contract";

type AttemptMeta = {
  id: string; actorId: number; createdAt: string; sha256: string; width: number; height: number;
  status: "pending" | "retained";
};

function storageRoot() {
  return resolve(process.env.PRODUCTION_OCR_FAILURES_PATH?.trim() || ".data/ocr-failures");
}
function validId(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
async function ensureRoot() { const root = storageRoot(); await mkdir(root, { recursive: true, mode: 0o700 }); return root; }

export async function saveProductionOcrAttempt(image: Buffer, actorId: number, result: Pick<OcrResult, "sha256" | "width" | "height">) {
  const root = await ensureRoot(), id = randomUUID();
  const meta: AttemptMeta = { id, actorId, createdAt: new Date().toISOString(), sha256: result.sha256, width: result.width, height: result.height, status: "pending" };
  await writeFile(resolve(root, `${id}.jpg`), image, { flag: "wx", mode: 0o600 });
  try { await writeFile(resolve(root, `${id}.json`), JSON.stringify(meta), { flag: "wx", mode: 0o600 }); }
  catch (error) { await unlink(resolve(root, `${id}.jpg`)).catch(() => {}); throw error; }
  return id;
}

export async function finalizeProductionOcrAttempts(results: OcrResult[], actorId: number) {
  const ids = [...new Set(results.map(result => result.attemptId).filter((id): id is string => Boolean(id && validId(id))))];
  if (!ids.length) return;
  const root = await ensureRoot(), retain = results.length > 1;
  for (const id of ids) {
    const metaPath = resolve(root, `${id}.json`), imagePath = resolve(root, `${id}.jpg`);
    let meta: AttemptMeta;
    try { meta = JSON.parse(await readFile(metaPath, "utf8")) as AttemptMeta; } catch { continue; }
    if (meta.id !== id || meta.actorId !== actorId) continue;
    if (retain) await writeFile(metaPath, JSON.stringify({ ...meta, status: "retained" satisfies AttemptMeta["status"] }), { mode: 0o600 });
    else { await unlink(imagePath).catch(() => {}); await unlink(metaPath).catch(() => {}); }
  }
}
