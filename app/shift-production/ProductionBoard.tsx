"use client";
import { useEffect, useRef, useState } from "react";
import { currentSnapshot, defaultRows, getNorm, productionTotals, validateRows, versionChanges, type FieldIssue, type ProductionRow, type ReportKind, type Settings, type Version } from "@/lib/production-domain";
import type { OpenReport } from "@/lib/production-store";
import { periodLabel, workPeriod } from "@/lib/shift-calendar";
import { deliverProduction, loadSettings, openProduction, productionHistory, productionVersions, saveProduction, saveProductionDraft } from "./actions";
import { ProductionTable } from "./ProductionTable";
import { ProductionMetrics } from "./ProductionMetrics";
import { ProductionSettings } from "./ProductionSettings";

type Editor = { open: OpenReport; dirty: boolean; source: Version | null; correctionKind: ReportKind };
const timestamp = (at: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", dateStyle: "short", timeStyle: "short" }).format(new Date(at));
const kindLabel = (kind: ReportKind) => kind === "final" ? "Итоговый" : "Предварительный";
const initialEditor = (open: OpenReport): Editor => ({ open, dirty: false, source: null, correctionKind: "final" });

export function ProductionBoard({ initial, initialSettings, userId, draftNamespace = "" }: { initial: OpenReport; initialSettings: Settings; userId: number; draftNamespace?: string }) {
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
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const snapshot = edit.open.snapshot;
  const localKey = `rapmas:production:v1:${draftNamespace ? `${draftNamespace}:` : ""}${userId}:${snapshot.period.key}:${edit.source ? `correction:${edit.source.id}` : "draft"}`;
  const loadedLocalKey = useRef("");
  const notify = (text: string, isError = false) => { setMessage(text); setError(isError); };
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
    const warn = (event: BeforeUnloadEvent) => { if (edit.dirty && localFailed) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [edit.dirty, localFailed]);

  function clearLocal() { try { localStorage.removeItem(localKey); } catch {} }
  function rowsChanged(rows: ProductionRow[]) { setEdit(e => ({ ...e, dirty: true, open: { ...e.open, snapshot: { ...e.open.snapshot, rows } } })); setIssues([]); setMessage(""); }
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
        return old ? { ...row, plan: old.plan, fact: old.fact, loadPercent: old.loadPercent, oversizePercent: old.oversizePercent, waiting: old.waiting, state: old.state, reasons: old.reasons.filter(r => settings.reasons.some(s => s.id === r.id && s.active)), note: old.note, loading: old.loading.map(l => ({ ...l, norm: l.truck === null ? row.loading[0]?.norm ?? null : row.norms[String(l.truck)] ?? null })) } : row;
      }) } };
      setEdit({ ...initialEditor(next), dirty: carry }); setParked(null); setRestore(null); setIssues([]); setConflict(false); setView("report");
      notify(carry ? "Значения перенесены в форму выбранной смены. Итоговость и отправка не перенесены" : "Открыт выбранный период");
    });
  }
  async function reset() {
    if (!window.confirm("Очистить показатели, причины и отметки текущей формы? Сохранённые отчёты останутся в истории.")) return;
    if (edit.source) {
      rowsChanged(snapshot.rows.map(r => ({ ...r, plan: "", fact: "", loadPercent: "", oversizePercent: "", waiting: ["", ""], state: "working", reasons: [], note: "", loading: [{ truck: r.excavator.direction === "rail" ? null : r.excavator.truck, time: ["", ""], norm: r.excavator.direction === "rail" ? r.loading[0]?.norm ?? null : r.norms[String(r.excavator.truck)] ?? null }] })));
      return;
    }
    await task(async () => {
      const result = await saveProductionDraft({ date: snapshot.period.date, kind: snapshot.period.kind, rows: [], latestId: edit.open.latestId, draftRevision: edit.open.draftRevision, reset: true });
      if (!result.ok) return failed(result);
      clearLocal(); setEdit(initialEditor(result.value)); setIssues([]); setConflict(false); notify("Форма очищена. Техника и нормативы подставлены из настроек. Архив не изменён");
    });
  }
  async function draft() {
    await task(async () => {
      const result = await saveProductionDraft({ date: snapshot.period.date, kind: snapshot.period.kind, rows: snapshot.rows, latestId: edit.open.latestId, draftRevision: edit.open.draftRevision });
      if (!result.ok) return failed(result);
      clearLocal(); setEdit(initialEditor(result.value)); setConflict(false); notify("Черновик сохранён на сервере. В производственные итоги он не включён");
    });
  }
  async function submit(kind: ReportKind) {
    const found = validateRows(snapshot.rows); setIssues(found);
    if (found.length) { notify("Проверьте выделенные поля. Пустые значения разрешены", true); return; }
    await task(async () => {
      const data = { date: snapshot.period.date, periodKind: snapshot.period.kind, rows: snapshot.rows, kind, latestId: edit.open.latestId, draftRevision: edit.open.draftRevision, sourceId: edit.source?.id };
      const text = JSON.stringify(data);
      if (!attempt.current || attempt.current.text !== text) attempt.current = { text, id: crypto.randomUUID() };
      const result = await saveProduction({ ...data, operation: attempt.current.id });
      if (!result.ok) return failed(result);
      const version = result.value;
      clearLocal(); setConflict(false); setRestore(null);
      const newOpen = { ...edit.open, snapshot: version.snapshot, latestId: version.id, latest: version, finalId: kind === "final" ? version.id : edit.open.finalId, draftRevision: edit.open.draftRevision + (edit.source ? 0 : 1), savedAt: version.at, draftStale: false, staleDraft: null };
      setEdit({ ...edit, open: newOpen, dirty: false, source: edit.source ? version : null });
      if (edit.source) { notify(`Исправление сохранено: версия ${version.number}. В MAX не отправлено`); return; }
      notify(`Сохранён ${kind === "final" ? "итоговый" : "предварительный"} отчёт, версия ${version.number}. Проверяем отправку…`);
      try {
        const sent = await deliverProduction(version.id, crypto.randomUUID());
        notify(sent.ok ? `${kindLabel(kind)} отчёт сохранён, версия ${version.number}. Отправка в MAX не настроена` : `Версия ${version.number} сохранена. ${sent.message}`, !sent.ok);
      } catch { notify(`Версия ${version.number} сохранена. Не удалось получить результат подготовки отправки`, true); }
    });
  }
  async function refresh() {
    await task(async () => {
      const result = await openProduction(snapshot.period.date, snapshot.period.kind); if (!result.ok) return failed(result);
      if (edit.dirty) setRestore(edit);
      setEdit(initialEditor(result.value)); setConflict(false); setIssues([]); notify("Открыта последняя сохранённая форма. Ваш прежний ввод можно восстановить отдельно");
    });
  }
  async function showHistory() { await task(async () => { const result = await productionHistory(historyDate || undefined, historyCrew ? Number(historyCrew) : undefined); if (!result.ok) return failed(result); setHistory(result.value); setSelected(null); setVersions([]); setView("history"); setMessage(""); }); }
  async function showVersions(version: Version) { await task(async () => { const result = await productionVersions(version.periodKey); if (!result.ok) return failed(result); setVersions(result.value); setSelected(version); }); }
  async function correct(version: Version) { await task(async () => {
    const result = await openProduction(version.snapshot.period.date, version.snapshot.period.kind); if (!result.ok) return failed(result);
    if (!parked) setParked(edit);
    setEdit({ open: { ...result.value, snapshot: structuredClone(version.snapshot) }, source: version, correctionKind: version.kind, dirty: false }); setView("report"); setIssues([]); setConflict(false); setRestore(null); notify("Режим исправления. Сохранение не запускает отправку в MAX");
  }); }
  function endCorrection() { if (parked) { setEdit(parked); setParked(null); setRestore(null); setIssues([]); setConflict(false); setMessage(""); } }
  let totals: ReturnType<typeof productionTotals> | null = null;
  try { totals = productionTotals(snapshot.rows); } catch {}
  const selectedFinal = versions.find(v => v.kind === "final");
  const prior = selected ? versions.find(v => v.id === (selected.sourceId || selected.previousId)) ?? null : null;

  return <div className="sp-board">
    <div className="sp-titlebar"><div><h2>Отчёт за смену</h2><p>Показатели работы экскаваторов</p></div><div className="sp-tools"><button className={view === "report" ? "sp-tool active" : "sp-tool"} disabled={view === "settings" || busy} onClick={() => setView("report")}>Ввод отчёта</button><button className={view === "history" ? "sp-tool active" : "sp-tool"} disabled={busy || view === "settings"} onClick={showHistory}>История</button><button className={view === "settings" ? "sp-tool active" : "sp-tool"} disabled={busy || view === "settings"} onClick={() => task(async () => { const result = await loadSettings(); if (!result.ok) return failed(result); setSettings(result.value); setView("settings"); setMessage(""); })}>Настройки</button></div></div>
    {message && <div className={`sp-alert ${error ? "sp-alert-error" : ""}`} role={error ? "alert" : "status"}>{message}{conflict && <button className="ghost" disabled={busy} onClick={refresh}>Открыть свежую форму</button>}</div>}
    {view === "settings" ? <ProductionSettings initial={settings} onSaved={setSettings} onBack={() => setView("report")} /> : view === "history" ? <section className="sp-history"><div className="sp-subheading"><h3>История отчётов</h3><div className="sp-period-picker"><label>Дата<input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} /></label><label>Смена<select value={historyCrew} onChange={e => setHistoryCrew(e.target.value)}><option value="">Все смены</option>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} смена</option>)}</select></label><button className="ghost" disabled={busy} onClick={showHistory}>Найти</button></div></div><p className="sp-muted">Ночную смену можно найти по любой из двух дат. Показано до 100 последних периодов.</p>
      {!history.length ? <div className="sp-empty"><h3>Отчётов пока нет</h3><p>Сохранённые предварительные и итоговые версии появятся здесь.</p></div> : <div className="sp-history-list">{history.map(version => <button className={`sp-history-item ${selected?.periodKey === version.periodKey ? "active" : ""}`} key={version.id} disabled={busy} onClick={() => showVersions(version)}><strong>{periodLabel(version.snapshot.period)}</strong><span>{kindLabel(version.kind)} · версия {version.number}{version.correction ? " · Исправлен" : ""}</span><small>{version.author} · {timestamp(version.at)} · MAX не отправлен</small></button>)}</div>}
      {selected && <section className="sp-archive-detail"><div className="sp-subheading"><div><h3>{periodLabel(selected.snapshot.period)}</h3><p>{selectedFinal ? `Для итогов: версия ${selectedFinal.number}` : "Итоговый отчёт ещё не сформирован"}</p></div><button className="ghost" disabled={busy} onClick={() => correct(selected)}>Исправить</button></div><label className="sp-version-select">Версия<select value={selected.id} onChange={e => setSelected(versions.find(v => v.id === e.target.value) || null)}>{versions.map(v => <option key={v.id} value={v.id}>№ {v.number} · {kindLabel(v.kind)}{v.correction ? " · Исправлен" : ""} · {v.author} · {timestamp(v.at)}</option>)}</select></label><p>{selected.correction ? "Исправлен · " : ""}{selected.author} · {timestamp(selected.at)} · В MAX не отправлен</p><ProductionTable rows={selected.snapshot.rows} settings={settings} onChange={() => {}} readOnly /><details className="sp-changes"><summary>Что изменилось в этой версии</summary><table><thead><tr><th>Показатель</th><th>Было</th><th>Стало</th></tr></thead><tbody>{versionChanges(prior?.snapshot ?? null, selected.snapshot).map((c, i) => <tr key={i}><th>{c.label}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></details></section>}
    </section> : <>
      {edit.source ? <div className="sp-correction"><div><strong>Исправление сохранённого отчёта</strong><p>{periodLabel(snapshot.period)} · исходная версия {edit.source.number}</p></div><button className="ghost" onClick={endCorrection} disabled={busy}>Вернуться к текущему вводу</button></div> : <div className="sp-period-bar"><div className="sp-period-heading"><strong>{periodLabel(snapshot.period)}</strong><span>{snapshot.period.kind === "day" ? "08:00–20:00" : "20:00–08:00"}</span></div><div className="sp-period-picker"><label>Дата начала<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>Период<select value={periodKind} onChange={e => setPeriodKind(e.target.value as "day" | "night")}><option value="day">День</option><option value="night">Ночь</option></select></label><button className="ghost" disabled={busy || !date || `${date}/${periodKind}` === snapshot.period.key} onClick={() => switchPeriod(false)}>Открыть период</button></div>{date && `${date}/${periodKind}` !== snapshot.period.key && <div className="sp-next-period"><p>Текущая форма остаётся за прежней сменой, пока вы не откроете выбранный период.</p><button className="ghost" disabled={busy} onClick={() => switchPeriod(true)}>Перенести значения в выбранный период</button></div>}</div>}
      {restore && <details className="sp-recovery"><summary>Ваш черновик от предыдущей версии</summary><ProductionTable rows={restore.open.snapshot.rows} settings={settings} onChange={() => {}} readOnly /><button className="ghost" onClick={() => { if (window.confirm("Заменить значения открытой формы вашим прежним вводом? Это не изменит архив до сохранения новой версии.")) { const rows = snapshot.rows.map(r => { const old = restore.open.snapshot.rows.find(x => x.excavator.id === r.excavator.id && x.excavator.direction === r.excavator.direction); return old ? { ...old, excavator: r.excavator, norms: r.norms, loading: old.loading.map(l => ({ ...l, norm: r.loading.find(x => x.truck === l.truck)?.norm ?? r.norms[String(l.truck)] ?? null })) } : r; }); rowsChanged(rows); setRestore(null); } }}>Восстановить мой ввод</button></details>}
      <div className="sp-statebar"><span className="sp-status">{edit.dirty ? "Есть изменения" : edit.open.latest ? `${kindLabel(edit.open.latest.kind)} · версия ${edit.open.latest.number}` : "Черновик"}</span><span>{edit.dirty ? localFailed ? "Не удалось сохранить копию в браузере" : "Черновик сохранён в этом браузере" : edit.open.savedAt ? `Черновик на сервере · ${timestamp(edit.open.savedAt)}` : "Можно заполнять частично"}</span><span className="sp-delivery">MAX: отправка не настроена</span></div>
      {edit.open.draftStale && edit.open.staleDraft && <details className="sp-recovery"><summary>Черновик, сохранённый до последнего исправления</summary><p>Текущая форма содержит последнюю версию. Прежний черновик доступен ниже для сравнения.</p><ProductionTable rows={edit.open.staleDraft.rows} settings={settings} onChange={() => {}} readOnly /></details>}
      {!snapshot.rows.length ? <div className="sp-empty"><h3>Добавьте экскаваторы для первого отчёта</h3><p>Укажите технику Главного карьера и нормативы в настройках, затем нажмите «Сбросить параметры», чтобы подставить новый список.</p><button className="primary" onClick={() => setView("settings")}>Настроить экскаваторы</button></div> : <fieldset disabled={busy} className="sp-editor-fields"><ProductionTable rows={snapshot.rows} settings={settings} onChange={rowsChanged} issues={issues} /></fieldset>}
      <div className="sp-summary"><div><span>Выполнение наряда</span><strong>{totals?.percent === null || !totals ? "Не рассчитывается" : `${totals.percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</strong></div><p>{totals ? totals.filled < totals.expected ? `Данные неполные: заполнено ${totals.filled} из ${totals.expected}` : `Заполнено ${totals.filled} из ${totals.expected} работающих экскаваторов` : "Исправьте формат объёмов для расчёта"}<small>План и факт — по одним и тем же строкам. Ремонт и отсутствие бригады на всю смену исключены.</small></p></div>
      <ProductionMetrics rows={snapshot.rows} /><footer className="sp-actions"><div className="sp-secondary-actions"><button className="ghost" disabled={busy} onClick={reset}>Сбросить параметры</button>{!edit.source && <button className="sp-tool" disabled={busy} onClick={draft}>Сохранить черновик</button>}</div><div className="sp-main-actions">{edit.source ? <><label>Вид версии<select value={edit.correctionKind} onChange={e => setEdit(s => ({ ...s, correctionKind: e.target.value as ReportKind }))}><option value="preliminary">Предварительный</option><option value="final">Итоговый</option></select></label><button className="primary" disabled={busy} onClick={() => submit(edit.correctionKind)}>Сохранить исправление</button><button className="ghost" disabled={busy || edit.dirty || !edit.open.latest?.correction} onClick={() => task(async () => { const result = await deliverProduction(edit.open.latestId!, crypto.randomUUID()); if (result.ok) notify(result.value.message); else failed(result); })}>Отправить сохранённую версию</button></> : <><button className="ghost" disabled={busy} onClick={() => submit("preliminary")}>Отправить предварительный</button><button className="primary" disabled={busy} onClick={() => submit("final")}>Отправить итоговый</button></>}</div>{busy && <span role="status">Сохраняем…</span>}</footer><p className="sp-footnote">{edit.source ? "Исправление сохраняется без рассылки. Для отправки сохранённой версии предусмотрена отдельная кнопка." : "Обе кнопки отправки сначала сохраняют версию отчёта. До настройки MAX сообщение в группу не отправляется."}</p>
    </>}
  </div>;
}
