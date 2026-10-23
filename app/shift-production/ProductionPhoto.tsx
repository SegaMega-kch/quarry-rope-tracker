"use client";
import { useEffect, useRef, useState } from "react";
import type { OcrConfiguration, OcrResult } from "@/lib/production-ocr-contract";
import { productionPhotoRequestError, readProductionOcrResponse } from "@/lib/production-photo-client";
import { productionOcrAttemptDecision } from "@/lib/production-ocr-import";

export function ProductionPhoto({ config, forceMobileReview = false, onTransfer }: { config: OcrConfiguration; forceMobileReview?: boolean; onTransfer: (results: OcrResult[], operation: string) => Promise<boolean> }) {
  const [mobile, setMobile] = useState(false), [opened, setOpened] = useState(true);
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false), [transferring, setTransferring] = useState(false);
  const [error, setError] = useState(""), [attempts, setAttempts] = useState<OcrResult[]>([]);
  const lock = useRef(false), abort = useRef<AbortController | null>(null), operation = useRef("");
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const handheld = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ||
      (forceMobileReview && window.matchMedia("(max-width: 800px)").matches);
    setMobile(handheld);
  }, [forceMobileReview]);
  function choose(next: File | null) {
    setError(""); setOpened(true);
    if (next && (!/^image\/(jpeg|png|webp)$/.test(next.type) || next.size > 10 * 1024 * 1024)) {
      setFile(null); setError("Выберите JPEG, PNG или WebP размером до 10 МБ. HEIC можно сохранить на телефоне как JPEG."); return;
    }
    setFile(next);
  }
  async function recognize() {
    if (lock.current || !file || !config.ready) return;
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController(); abort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 105_000);
    try {
      const form = new FormData(); form.append("photo", file);
      const response = await fetch("/api/production/ocr", { method: "POST", body: form, signal: controller.signal, headers: { "Accept": "application/json", "X-Rapmas-Mobile-Photo": "1" } });
      const next = await readProductionOcrResponse(response);
      setAttempts(current => [...current, next].slice(0, 3));
      if (!operation.current) operation.current = crypto.randomUUID();
    } catch (e) { setError(productionPhotoRequestError(e)); }
    finally { window.clearTimeout(timeout); lock.current = false; setBusy(false); abort.current = null; }
  }
  async function transfer() {
    if (!attempts.length || !decision.ready || transferring) return;
    setTransferring(true); setError("");
    try {
      if (await onTransfer(attempts, operation.current || crypto.randomUUID())) { setFile(null); setAttempts([]); operation.current = ""; setOpened(false); }
    } catch { setError("Не удалось перенести данные. Фото осталось выбранным; повторите попытку."); }
    finally { setTransferring(false); }
  }
  function startAgain() { setFile(null); setAttempts([]); setError(""); operation.current = ""; }
  if (!mobile) return null;
  let decision = { ready: false, needThird: false, needsRetake: false, preview: null as ReturnType<typeof productionOcrAttemptDecision>["preview"] | null };
  try { if (attempts.length) decision = productionOcrAttemptDecision(attempts); } catch { decision = { ready: false, needThird: attempts.length === 2, needsRetake: true, preview: attempts[attempts.length - 1]?.importPreview ?? null }; }
  const recognized = decision.preview;
  return <details className="sp-photo" open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Фото производственной таблицы</summary>
    <div className="sp-photo-body">
      <p>Сфотографируйте крупно только блок «Главный карьер». После переноса проверьте цифры прямо в таблице отчёта.</p>
      <p className="sp-photo-policy">Удачное одиночное фото удаляется после переноса. Снимки с ошибками и пересъёмки временно сохраняются без геометок в закрытом хранилище для улучшения распознавания.</p>
      <div className="sp-photo-controls">
        <label>Сделать фото<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || transferring || !config.ready} onChange={e => choose(e.target.files?.[0] ?? null)} /></label>
        <label>Выбрать из галереи<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || transferring || !config.ready} onChange={e => choose(e.target.files?.[0] ?? null)} /></label>
      </div>
      {file && <div className="sp-photo-selected"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ</span></div>}
      {preview && <a className="sp-photo-preview" href={preview} target="_blank" rel="noreferrer" aria-label="Открыть выбранное фото крупно"><img src={preview} alt="Выбранная производственная таблица" /></a>}
      <button type="button" className="primary" disabled={busy || transferring || !file || !config.ready || attempts.length >= 3 || decision.ready} onClick={recognize}>{busy ? "Распознаём…" : attempts.length ? `Распознать фото ${attempts.length + 1}` : "Распознать"}</button>
      {busy && <p role="status">Распознаём таблицу. Обычно это занимает несколько секунд.</p>}
      {!config.ready && <p className="sp-error" role="alert">Распознавание сейчас недоступно. Обратитесь к администратору.</p>}
      {error && <p className="sp-error" role="alert">{error}</p>}
      {attempts.length > 0 && <div className={`sp-photo-result ${decision.ready ? "sp-photo-ready" : "sp-photo-problem"}`} aria-live="polite">
        <h4>{decision.ready ? attempts.length > 1 ? "Результат подтверждён" : "Фото распознано" : decision.needThird ? "Нужно третье фото" : "Нужно переснять фото"}</h4>
        <p>Проверено фотографий: {attempts.length} из {decision.needThird ? 3 : attempts.length === 1 && !decision.ready ? 2 : attempts.length}.</p>
        {recognized?.period && <p><strong>{recognized.period}</strong></p>}
        {recognized && <p>Уверенно прочитано экскаваторов: {recognized.recognizedExcavators} из {recognized.sourceRows}.</p>}
        {recognized?.warnings.length ? <ul>{recognized.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p>Данные готовы к переносу.</p>}
        {decision.ready && <button type="button" className="primary sp-photo-transfer" disabled={transferring} onClick={transfer}>{transferring ? "Переносим…" : "Перенести в отчёт"}</button>}
        {!decision.ready && attempts.length < 3 && <p className="sp-photo-next">Выберите или сделайте новое фото этой же таблицы и нажмите «Распознать фото {attempts.length + 1}».</p>}
        {!decision.ready && attempts.length >= 3 && <button type="button" className="ghost sp-photo-transfer" onClick={startAgain}>Начать заново</button>}
      </div>}
    </div>
  </details>;
}
