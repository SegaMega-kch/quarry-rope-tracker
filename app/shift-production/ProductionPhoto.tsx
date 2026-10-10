"use client";
import { useEffect, useRef, useState } from "react";
import type { OcrConfiguration, OcrResult } from "@/lib/production-ocr-contract";
import { previewTableRows } from "@/lib/production-ocr-contract";

export function ProductionPhoto({ config, forceMobileReview = false }: { config: OcrConfiguration; forceMobileReview?: boolean }) {
  const [mobile, setMobile] = useState(false);
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<OcrResult | null>(null);
  const lock = useRef(false), abort = useRef<AbortController | null>(null);
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
    setError(""); setResult(null);
    if (next && (!/^image\/(jpeg|png|webp)$/.test(next.type) || next.size > 10 * 1024 * 1024)) {
      setFile(null); setError("Выберите JPEG, PNG или WebP размером до 10 МБ. HEIC можно сохранить на телефоне как JPEG."); return;
    }
    setFile(next);
  }
  async function recognize() {
    if (lock.current || !file || !config.ready) return;
    lock.current = true; setBusy(true); setError(""); setResult(null);
    const controller = new AbortController(); abort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 105_000);
    try {
      const form = new FormData(); form.append("photo", file);
      const response = await fetch("/api/production/ocr", { method: "POST", body: form, signal: controller.signal, headers: { "X-Rapmas-Mobile-Photo": "1" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не удалось распознать фотографию");
      setResult(data as OcrResult);
    } catch (e) { setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Нет ответа распознавателя. Фото осталось в форме; повторите проверку."); }
    finally { window.clearTimeout(timeout); lock.current = false; setBusy(false); abort.current = null; }
  }
  if (!mobile) return null;
  return <details className="sp-photo">
    <summary>Проверить распознавание фото <span>Пробный режим</span></summary>
    <div className="sp-photo-body">
      <h3>Фото производственной таблицы</h3>
      <p>Сфотографируйте крупно только блок «Главный карьер». Заголовки, дата, номера экскаваторов и цифры должны быть резкими и полностью попадать в кадр.</p>
      <p className="sp-photo-policy">{config.message} Фото не сохраняется в архиве rapmas. Результат этой проверки не меняет отчёт.</p>
      <div className="sp-photo-controls">
        <label>Сделать фото<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || !config.ready} onChange={e => choose(e.target.files?.[0] ?? null)} /></label>
        <label>Прикрепить из галереи<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !config.ready} onChange={e => choose(e.target.files?.[0] ?? null)} /></label>
      </div>
      {file && <div className="sp-photo-selected"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ</span></div>}
      {preview && <a className="sp-photo-preview" href={preview} target="_blank" rel="noreferrer" aria-label="Открыть выбранное фото крупно"><img src={preview} alt="Выбранная производственная таблица" /></a>}
      <button type="button" className="primary" disabled={busy || !file || !config.ready} onClick={recognize}>{busy ? "Распознаём…" : config.provider === "yandex" ? "Отправить в Яндекс и распознать" : "Проверить фото на сервере"}</button>
      {busy && <p role="status">Обычно проверка занимает несколько десятков секунд. Дождитесь результата.</p>}
      {error && <p className="sp-error" role="alert">{error}</p>}
      {result && <div className="sp-photo-result" aria-live="polite">
        <h4>Результат пробного распознавания</h4>
        <p>{result.provider === "local" ? "Сервер rapmas" : "Yandex Vision OCR"} · {result.seconds.toLocaleString("ru-RU")} с · найдено таблиц: {result.tables.length}</p>
        <ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        <details><summary>Посмотреть прочитанный текст</summary><pre>{result.text || "Текст не найден. Переснимите таблицу ближе и без размытия."}</pre></details>
        {result.tables.map((table, index) => <details key={index}><summary>Таблица {index + 1} · {table.rows} строк, {table.columns} столбцов</summary><div className="sp-photo-table" tabIndex={0} role="region" aria-label={`Распознанная таблица ${index + 1}`}><table><caption>Сырые результаты. Прочерк не подтверждает, что ячейка исходного фото пуста.</caption><tbody>{previewTableRows(table).map((cells, row) => <tr key={row}>{cells.map(cell => <td key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.columnSpan}>{cell.missing ? "Не прочитано" : cell.text || "—"}</td>)}</tr>)}</tbody></table></div></details>)}
        <p className="sp-muted">Автозаполнение откроем после проверки точности на реальных фото. Сейчас показатели вносите в отчёт вручную.</p>
      </div>}
    </div>
  </details>;
}
