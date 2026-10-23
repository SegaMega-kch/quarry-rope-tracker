"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentSnapshot, materialLabels, productionMaterialTotals, productionTotals, validateRows, versionChanges, type FieldIssue, type ProductionRow, type ReportKind, type Settings, type Version } from "@/lib/production-domain";
import type { OpenReport } from "@/lib/production-store";
import { periodLabel, workPeriod } from "@/lib/shift-calendar";
import { deliverProduction, importProductionOcr, loadSettings, openProduction, productionHistory, productionVersions, saveProduction, saveProductionDraft } from "./actions";
import { ProductionTable } from "./ProductionTable";
import { ProductionMetrics } from "./ProductionMetrics";
import { ProductionSettings } from "./ProductionSettings";
import { ProductionPhoto } from "./ProductionPhoto";
import { ProductionReportPreview } from "./ProductionReportPreview";
import type { OcrConfiguration, OcrResult } from "@/lib/production-ocr-contract";
import { hasProductionReportData, productionReportMissing } from "@/lib/production-report-model";

type Editor = { open: OpenReport; dirty: boolean; source: Version | null };
const timestamp = (at: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", dateStyle: "short", timeStyle: "short" }).format(new Date(at));
const kindLabel = (kind: ReportKind) => kind === "final" ? "Итоговый" : "Предварительный";
const initialEditor = (open: OpenReport): Editor => ({ open, dirty: false, source: null });
const excavatorCountLabel = (count: number) => {
  const lastTwo = count % 100, last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} экскаваторов`;
  if (last === 1) return `${count} экскаватор`;
  if (last >= 2 && last <= 4) return `${count} экскаватора`;
  return `${count} экскаваторов`;
};

export function ProductionBoard({ initial, initialSettings, userId, draftNamespace = "", ocrConfig = null, deliveryConfig, forceMobileReview = false }: { initial: OpenReport; initialSettings: Settings; userId: number; draftNamespace?: string; ocrConfig?: OcrConfiguration | null; deliveryConfig: { ready: boolean; message: string }; forceMobileReview?: boolean }) {
  const [settings, setSettings] = useState(initialSettings);
  const [view, setView] = useState<"report" | "history" | "settings">("report");
  const [edit, setEdit] = useState<Editor>(initialEditor(initial));
  const [parked, setParked] = useState<Editor | null>(null);
  const [date, setDate] = useState(initial.snapshot.period.date), [periodKind, setPeriodKind] = useState(initial.snapshot.period.kind);
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [message, setMessage] = useState(""), [error, setError] = useState(false), [conflict, setConflict] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [restore, setRestore] = useState<Editor | null>(null), [localFailed, setLocalFailed] = useState(false);
  const [historyDate, setHistoryDate] = useState(""), [historyCrew, setHistoryCrew] = useState("");
  const [history, setHistory] = useState<Version[]>([]), [versions, setVersions] = useState<Version[]>([]), [selected, setSelected] = useState<Version | null>(null);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null), reportRef = useRef<HTMLDivElement | null>(null);
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const deliveryAttempt = useRef<{ version: string; id: string } | null>(null);
  const autoSaveBusy = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false), [highlighted, setHighlighted] = useState<string[]>([]), [sentVersionId, setSentVersionId] = useState<string | null>(null);
  const snapshot = edit.open.snapshot;
  const localKey = `rapmas:production:v1:${draftNamespace ? `${draftNamespace}:` : ""}${userId}:${snapshot.period.key}:${edit.source ? `correction:${edit.source.id}` : "draft"}`;
  const loadedLocalKey = useRef("");
  const notify = (text: string, isError = false) => { setMessage(text); setError(isError); };
  const clearLocal = useCallback(() => { try { localStorage.removeItem(localKey); } catch {} }, [localKey]);
  useEffect(() => {
    if (loadedLocalKey.current === localKey) return;
    loadedLocalKey.current = localKey;
    try {
      const raw = localStorage.getItem(localKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Editor;
      if (!saved?.open?.snapshot?.rows || saved.open.snapshot.period.key !== snapshot.period.key) return;
      saved.open.snapshot = currentSnapshot(saved.open.snapshot);
      if (saved.open.latestId === edit.open.latestId && saved.open.draftRevision === edit.open.draftRevision) { setEdit(saved); notify("Восстановлен ваш черновик из этого браузера"); }
      else { setRestore(saved); notify("Есть ваш черновик от предыдущей версии. Проверьте его перед восстановлением", true); }
    } catch { setLocalFailed(true); }
  }, [localKey, snapshot.period.key, edit.open.latestId, edit.open.draftRevision]);
  useEffect(() => {
    if (edit.dirty) { try { localStorage.setItem(localKey, JSON.stringify(edit)); setLocalFailed(false); } catch { setLocalFailed(true); } }
  }, [edit, localKey]);
  useEffect(() => {
    if (!edit.dirty || edit.source || busy || autoSaveBusy.current) return;
    const captured = edit, capturedRows = JSON.stringify(edit.open.snapshot.rows);
    const timer = window.setTimeout(async () => {
      autoSaveBusy.current = true; setSavingDraft(true);
      try {
        const result = await saveProductionDraft({ date: captured.open.snapshot.period.date, kind: captured.open.snapshot.period.kind, rows: captured.open.snapshot.rows, latestId: captured.open.latestId, draftRevision: captured.open.draftRevision });
        if (!result.ok) { if (result.conflict) setConflict(true); notify(result.message, true); return; }
        setEdit(current => {
          if (current.open.snapshot.period.key !== captured.open.snapshot.period.key) return current;
          const unchanged = JSON.stringify(current.open.snapshot.rows) === capturedRows;
          const open = unchanged ? result.value : { ...result.value, snapshot: current.open.snapshot };
          if (unchanged) clearLocal();
          return { ...current, open, dirty: !unchanged };
        });
      } catch { notify("Нет ответа сервера. Рабочая копия остаётся в этом браузере", true); }
      finally { autoSaveBusy.current = false; setSavingDraft(false); }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [edit, busy, savingDraft, clearLocal]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (edit.dirty && localFailed) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [edit.dirty, localFailed]);
  useEffect(() => { if (previewVersion) window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }, [previewVersion]);

  function rowsChanged(rows: ProductionRow[]) { setPreviewVersion(null); setSentVersionId(null); setHighlighted([]); setEdit(e => ({ ...e, dirty: true, open: { ...e.open, snapshot: { ...e.open.snapshot, rows } } })); setIssues([]); setMessage(""); }
  async function task(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fn(); } catch { notify("Нет ответа сервера. Ввод остаётся в форме; повторите действие после восстановления связи", true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function failed(result: { message: string; conflict: boolean; issues: FieldIssue[] }) { notify(result.message, true); setConflict(result.conflict); setIssues(result.issues); }
  async function switchPeriod(carry: boolean) {
    await task(async () => {
      const result = await openProduction(date, periodKind); if (!result.ok) return failed(result);
      let next = result.value;
      if (carry && (next.latestId || next.savedAt) && !window.confirm("У выбранной смены уже есть данные. Заменить значения формы показателями из текущей смены? Сохранённые версии останутся в истории.")) return;
      if (carry) next = { ...next, snapshot: { ...next.snapshot, rows: next.snapshot.rows.map(row => {
        const old = snapshot.rows.find(r => r.excavator.id === row.excavator.id && r.excavator.direction === row.excavator.direction);
        return old ? { ...row, plan: old.plan, fact: old.fact, materials: old.materials, loadPercent: old.loadPercent, oversizePercent: old.oversizePercent, waiting: old.waiting, state: old.state, reasons: old.reasons.filter(r => settings.reasons.some(s => s.id === r.id && s.active)), note: old.note, loading: old.loading.map(l => ({ ...l, norm: l.truck === null ? row.loading[0]?.norm ?? null : row.norms[String(l.truck)] ?? null })) } : row;
      }) } };
      setPreviewVersion(null); setSentVersionId(null); setHighlighted([]); setEdit({ ...initialEditor(next), dirty: carry }); setParked(null); setRestore(null); setIssues([]); setConflict(false); setView("report");
      notify(carry ? "Значения перенесены в форму выбранной смены. Итоговость и отправка не перенесены" : "Открыт выбранный период");
    });
  }
  async function reset() {
    if (!window.confirm("Очистить показатели, причины и отметки текущей формы? Сохранённые отчёты останутся в истории.")) return;
    if (edit.source) {
      rowsChanged(snapshot.rows.map(r => ({ ...r, plan: "", fact: "", materials: r.materials === undefined ? undefined : [], loadPercent: "", oversizePercent: "", waiting: ["", ""], state: "working", reasons: [], note: "", loading: [{ truck: r.excavator.direction === "rail" ? null : r.excavator.truck, time: ["", ""], norm: r.excavator.direction === "rail" ? r.loading[0]?.norm ?? null : r.norms[String(r.excavator.truck)] ?? null }] })));
      return;
    }
    await task(async () => {
      const result = await saveProductionDraft({ date: snapshot.period.date, kind: snapshot.period.kind, rows: [], latestId: edit.open.latestId, draftRevision: edit.open.draftRevision, reset: true });
      if (!result.ok) return failed(result);
      clearLocal(); setPreviewVersion(null); setSentVersionId(null); setHighlighted([]); setEdit(initialEditor(result.value)); setIssues([]); setConflict(false); notify("Форма очищена. Техника и нормативы подставлены из настроек. Архив не изменён");
    });
  }
  async function transferOcr(results: OcrResult[], operation: string) {
    let transferred = false;
    await task(async () => {
      const imported = await importProductionOcr({ results, operation });
      if (!imported.ok) return failed(imported);
      const value = imported.value;
      clearLocal(); setPreviewVersion(null); setParked(null); setRestore(null); setConflict(false); setIssues([]); setSentVersionId(null);
      setDate(value.open.snapshot.period.date); setPeriodKind(value.open.snapshot.period.kind); setEdit(initialEditor(value.open)); setHighlighted(value.changedPaths); setView("report");
      const skipped = value.warnings.filter(warning => /не прочитан|пропущен|отсутствует|не совпал/i.test(warning)).length;
      notify(`Данные перенесены: ${excavatorCountLabel(value.matchedExcavators)}, ${value.changedFields} полей.${skipped ? ` Требуют ручной проверки: ${skipped}.` : ""} Проверьте таблицу и при необходимости исправьте цифры.`);
      transferred = true;
      window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    });
    return transferred;
  }
  async function sendFinal() {
    const found = validateRows(snapshot.rows); setIssues(found);
    if (found.length) { notify("Проверьте выделенные поля. Пустые значения разрешены", true); return; }
    const missing = productionReportMissing(snapshot) + (snapshot.rows.some(hasProductionReportData) ? 0 : 1);
    if (missing > 0 && !window.confirm(`В отчёте есть незаполненные показатели: ${missing}. Всё равно сформировать картинку и отправить её в MAX?`)) return;
    await task(async () => {
      const sameAsLatest = edit.open.latest?.kind === "final" && JSON.stringify(edit.open.latest.snapshot.rows) === JSON.stringify(snapshot.rows);
      let version = sameAsLatest ? edit.open.latest! : null;
      if (!version) {
        const data = { date: snapshot.period.date, periodKind: snapshot.period.kind, rows: snapshot.rows, kind: "final" as const, latestId: edit.open.latestId, draftRevision: edit.open.draftRevision, sourceId: edit.source?.id };
        const text = JSON.stringify(data);
        if (!attempt.current || attempt.current.text !== text) attempt.current = { text, id: crypto.randomUUID() };
        const saved = await saveProduction({ ...data, operation: attempt.current.id });
        if (!saved.ok) return failed(saved);
        version = saved.value;
        const newOpen = { ...edit.open, snapshot: version.snapshot, latestId: version.id, latest: version, finalId: version.id, draftRevision: edit.open.draftRevision + (edit.source ? 0 : 1), savedAt: version.at, draftStale: false, staleDraft: null };
        setEdit({ ...edit, open: newOpen, dirty: false, source: edit.source ? version : null });
      }
      clearLocal(); setConflict(false); setRestore(null);
      if (!deliveryAttempt.current || deliveryAttempt.current.version !== version.id) deliveryAttempt.current = { version: version.id, id: crypto.randomUUID() };
      const delivered = await deliverProduction(version.id, deliveryAttempt.current.id);
      if (!delivered.ok) { notify(`Итоговая версия ${version.number} сохранена, но отправить её в MAX не удалось: ${delivered.message}`, true); return; }
      const sent = delivered.value.status === "sent";
      if (sent) setSentVersionId(version.id);
      notify(delivered.value.message, !sent);
    });
  }
  async function sendPreview() {
    if (!previewVersion) return;
    await task(async () => {
      const result = await deliverProduction(previewVersion.id, crypto.randomUUID());
      if (!result.ok) return failed(result);
      notify(result.value.message, result.value.status !== "sent");
    });
  }
  async function refresh() {
    await task(async () => {
      const result = await openProduction(snapshot.period.date, snapshot.period.kind); if (!result.ok) return failed(result);
      if (edit.dirty) setRestore(edit);
      setEdit(initialEditor(result.value)); setSentVersionId(null); setHighlighted([]); setConflict(false); setIssues([]); notify("Открыта последняя сохранённая форма. Ваш прежний ввод можно восстановить отдельно");
    });
  }
  async function showHistory() { await task(async () => { const result = await productionHistory(historyDate || undefined, historyCrew ? Number(historyCrew) : undefined); if (!result.ok) return failed(result); setHistory(result.value); setSelected(null); setVersions([]); setPreviewVersion(null); setView("history"); setMessage(""); }); }
  async function showVersions(version: Version) { await task(async () => { const result = await productionVersions(version.periodKey); if (!result.ok) return failed(result); setVersions(result.value); setSelected(version); }); }
  async function correct(version: Version) { await task(async () => {
    const result = await openProduction(version.snapshot.period.date, version.snapshot.period.kind); if (!result.ok) return failed(result);
    if (!parked) setParked(edit);
    setEdit({ open: { ...result.value, snapshot: structuredClone(version.snapshot) }, source: version, dirty: false }); setPreviewVersion(null); setSentVersionId(null); setHighlighted([]); setView("report"); setIssues([]); setConflict(false); setRestore(null); notify("Режим исправления. После проверки отправьте новую версию в MAX");
  }); }
  function endCorrection() { if (parked) { setPreviewVersion(null); setSentVersionId(null); setHighlighted([]); setEdit(parked); setParked(null); setRestore(null); setIssues([]); setConflict(false); setMessage(""); } }
  let totals: ReturnType<typeof productionTotals> | null = null;
  let materialTotals: Array<{ label: string; value: ReturnType<typeof productionMaterialTotals> }> = [];
  try { totals = productionTotals(snapshot.rows); } catch {}
  try { materialTotals = (["ore", "overburden"] as const).map(kind => ({ label: materialLabels[kind], value: productionMaterialTotals(snapshot.rows, kind) })); } catch {}
  const selectedFinal = versions.find(v => v.kind === "final");
  const prior = selected ? versions.find(v => v.id === (selected.sourceId || selected.previousId)) ?? null : null;

  return <div className="sp-board">
    <div className="sp-titlebar"><div><h2>Отчёт за смену</h2><p>Показатели работы экскаваторов</p></div><div className="sp-tools"><button className={view === "report" ? "sp-tool active" : "sp-tool"} disabled={view === "settings" || busy} onClick={() => setView("report")}>Ввод отчёта</button><button className={view === "history" ? "sp-tool active" : "sp-tool"} disabled={busy || view === "settings"} onClick={showHistory}>История</button><button className={view === "settings" ? "sp-tool active" : "sp-tool"} disabled={busy || view === "settings"} onClick={() => task(async () => { const result = await loadSettings(); if (!result.ok) return failed(result); setSettings(result.value); setView("settings"); setMessage(""); })}>Настройки</button></div></div>
    {message && <div className={`sp-alert ${error ? "sp-alert-error" : ""}`} role={error ? "alert" : "status"}>{message}{conflict && <button className="ghost" disabled={busy} onClick={refresh}>Открыть свежую форму</button>}</div>}
    {view === "settings" ? <ProductionSettings initial={settings} onSaved={setSettings} onBack={() => setView("report")} /> : view === "history" ? <section className="sp-history"><div className="sp-subheading"><h3>История отчётов</h3><div className="sp-period-picker"><label>Дата<input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} /></label><label>Смена<select value={historyCrew} onChange={e => setHistoryCrew(e.target.value)}><option value="">Все смены</option>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} смена</option>)}</select></label><button className="ghost" disabled={busy} onClick={showHistory}>Найти</button></div></div><p className="sp-muted">Ночную смену можно найти по любой из двух дат. Показано до 100 последних периодов.</p>
      {!history.length ? <div className="sp-empty"><h3>Отчётов пока нет</h3><p>Сохранённые предварительные и итоговые версии появятся здесь.</p></div> : <div className="sp-history-list">{history.map(version => <button className={`sp-history-item ${selected?.periodKey === version.periodKey ? "active" : ""}`} key={version.id} disabled={busy} onClick={() => showVersions(version)}><strong>{periodLabel(version.snapshot.period)}</strong><span>{kindLabel(version.kind)} · версия {version.number}{version.correction ? " · Исправлен" : ""}</span><small>{version.author} · {timestamp(version.at)} · MAX не отправлен</small></button>)}</div>}
      {selected && <section className="sp-archive-detail"><div className="sp-subheading"><div><h3>{periodLabel(selected.snapshot.period)}</h3><p>{selectedFinal ? `Для итогов: версия ${selectedFinal.number}` : "Итоговый отчёт ещё не сформирован"}</p></div><div className="sp-archive-actions">{selected.kind === "final" && <button className="primary" disabled={busy} onClick={() => setPreviewVersion(selected)}>Показать картинку</button>}<button className="ghost" disabled={busy} onClick={() => correct(selected)}>Исправить</button></div></div><label className="sp-version-select">Версия<select value={selected.id} onChange={e => { const version = versions.find(v => v.id === e.target.value) || null; setSelected(version); setPreviewVersion(null); }}>{versions.map(v => <option key={v.id} value={v.id}>№ {v.number} · {kindLabel(v.kind)}{v.correction ? " · Исправлен" : ""} · {v.author} · {timestamp(v.at)}</option>)}</select></label><p>{selected.correction ? "Исправлен · " : ""}{selected.author} · {timestamp(selected.at)} · отправляется только после просмотра картинки</p><ProductionTable rows={selected.snapshot.rows} settings={settings} onChange={() => {}} readOnly /><details className="sp-changes"><summary>Что изменилось в этой версии</summary><table><thead><tr><th>Показатель</th><th>Было</th><th>Стало</th></tr></thead><tbody>{versionChanges(prior?.snapshot ?? null, selected.snapshot).map((c, i) => <tr key={i}><th>{c.label}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></details></section>}
      {previewVersion && <div ref={previewRef}><ProductionReportPreview version={previewVersion} delivery={deliveryConfig} busy={busy} onSend={sendPreview} onClose={() => setPreviewVersion(null)} /></div>}
    </section> : <>
      {edit.source ? <div className="sp-correction"><div><strong>Исправление сохранённого отчёта</strong><p>{periodLabel(snapshot.period)} · исходная версия {edit.source.number}</p></div><button className="ghost" onClick={endCorrection} disabled={busy}>Вернуться к текущему вводу</button></div> : <div className="sp-period-bar"><div className="sp-period-heading"><strong>{periodLabel(snapshot.period)}</strong><span>{snapshot.period.kind === "day" ? "08:00–20:00" : "20:00–08:00"}</span></div><div className="sp-period-picker"><label>Дата начала<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>Период<select value={periodKind} onChange={e => setPeriodKind(e.target.value as "day" | "night")}><option value="day">День</option><option value="night">Ночь</option></select></label><button className="ghost" disabled={busy || !date || `${date}/${periodKind}` === snapshot.period.key} onClick={() => switchPeriod(false)}>Открыть период</button></div>{date && `${date}/${periodKind}` !== snapshot.period.key && <div className="sp-next-period"><p>Текущая форма остаётся за прежней сменой, пока вы не откроете выбранный период.</p><button className="ghost" disabled={busy} onClick={() => switchPeriod(true)}>Перенести значения в выбранный период</button></div>}</div>}
      {restore && <details className="sp-recovery"><summary>Ваш черновик от предыдущей версии</summary><ProductionTable rows={restore.open.snapshot.rows} settings={settings} onChange={() => {}} readOnly /><button className="ghost" onClick={() => { if (window.confirm("Заменить значения открытой формы вашим прежним вводом? Это не изменит архив до сохранения новой версии.")) { const rows = snapshot.rows.map(r => { const old = restore.open.snapshot.rows.find(x => x.excavator.id === r.excavator.id && x.excavator.direction === r.excavator.direction); return old ? { ...old, excavator: r.excavator, norms: r.norms, loading: old.loading.map(l => ({ ...l, norm: r.loading.find(x => x.truck === l.truck)?.norm ?? r.norms[String(l.truck)] ?? null })) } : r; }); rowsChanged(rows); setRestore(null); } }}>Восстановить мой ввод</button></details>}
      <div className="sp-statebar"><span className="sp-status">{savingDraft ? "Сохраняем…" : edit.dirty ? "Есть изменения" : edit.open.latest ? `${kindLabel(edit.open.latest.kind)} · версия ${edit.open.latest.number}` : "Рабочая копия"}</span><span>{edit.dirty ? localFailed ? "Не удалось сохранить копию в браузере" : "Автосохранение через несколько секунд" : edit.open.savedAt ? `Сохранено на сервере · ${timestamp(edit.open.savedAt)}` : "Можно заполнять частично"}</span><span className="sp-delivery">MAX: {deliveryConfig.ready ? "готов к отправке" : "отправка не настроена"}</span></div>
      {edit.open.draftStale && edit.open.staleDraft && <details className="sp-recovery"><summary>Черновик, сохранённый до последнего исправления</summary><p>Текущая форма содержит последнюю версию. Прежний черновик доступен ниже для сравнения.</p><ProductionTable rows={edit.open.staleDraft.rows} settings={settings} onChange={() => {}} readOnly /></details>}
      {ocrConfig && <ProductionPhoto key={snapshot.period.key} config={ocrConfig} forceMobileReview={forceMobileReview} onTransfer={transferOcr} />}
      <div ref={reportRef}>{!snapshot.rows.length ? <div className="sp-empty"><h3>Добавьте экскаваторы для первого отчёта</h3><p>Укажите технику Главного карьера и нормативы в настройках, затем нажмите «Сбросить параметры», чтобы подставить новый список.</p><button className="primary" onClick={() => setView("settings")}>Настроить экскаваторы</button></div> : <fieldset disabled={busy} className="sp-editor-fields"><ProductionTable rows={snapshot.rows} settings={settings} onChange={rowsChanged} issues={issues} highlighted={highlighted} /></fieldset>}</div>
      <div className="sp-summary"><div className="sp-summary-totals">{materialTotals.map(item => <span key={item.label}><small>{item.label}</small><b>{item.value.filled ? `${item.value.fact.toLocaleString("ru-RU")} / ${item.value.plan.toLocaleString("ru-RU")} м³` : "—"}</b></span>)}<span><small>Всего · выполнение</small><strong>{totals?.percent === null || !totals ? "Не рассчитывается" : `${totals.percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</strong></span></div><p>{totals ? totals.filled < totals.expected ? `Данные неполные: заполнено ${totals.filled} из ${totals.expected}` : `Заполнено ${totals.filled} из ${totals.expected} работающих экскаваторов` : "Исправьте формат объёмов для расчёта"}<small>В строках категорий показано: факт / план. Ремонт и отсутствие бригады на всю смену исключены.</small></p></div>
      <ProductionMetrics rows={snapshot.rows} /><footer className="sp-actions sp-send-bar"><div className="sp-secondary-actions"><button className="ghost" disabled={busy || savingDraft} onClick={reset}>Сбросить параметры</button></div><div className="sp-main-actions"><button className="primary sp-send-max" disabled={busy || savingDraft || !deliveryConfig.ready || sentVersionId !== null} onClick={sendFinal}>{sentVersionId ? "Отправлено в MAX" : busy ? "Отправляем…" : "Отправить в MAX"}</button></div></footer><p className="sp-footnote">Рабочая копия сохраняется автоматически. Кнопка создаёт итоговую версию, формирует картинку и отправляет её в MAX.</p>
      {previewVersion && <div ref={previewRef}><ProductionReportPreview version={previewVersion} delivery={deliveryConfig} busy={busy} onSend={sendPreview} onClose={() => setPreviewVersion(null)} /></div>}
    </>}
  </div>;
}
