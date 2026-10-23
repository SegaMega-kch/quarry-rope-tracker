"use client";
import { useId } from "react";
import { appendReasonText, commentText, displayDuration, duration, excavatorTypes, getNorm, materialLabels, rowResult, truckTypes, withMaterialTotals, type FieldIssue, type MaterialKind, type Parts, type ProductionRow, type Settings, type TimeFormat } from "@/lib/production-domain";

const removeMaterialLabels: Record<MaterialKind, string> = { ore: "Убрать руду", overburden: "Убрать вскрышу" };

export function TimeFields({ value, onChange, format, label, readOnly = false, error }: { value: Parts; onChange: (parts: Parts) => void; format: TimeFormat; label: string; readOnly?: boolean; error?: string }) {
  const labels = format === "decimal" ? ["целые часы", "дробная часть часа"] : format === "decimalMinutes" ? ["целые минуты", "дробная часть минуты"] : format === "ms" ? ["минуты", "секунды"] : ["часы", "минуты"];
  const units = format === "decimal" ? ["часы", "доля часа"] : format === "decimalMinutes" ? ["минуты", "доля минуты"] : format === "ms" ? ["мин", "сек"] : ["ч", "мин"];
  if (readOnly) { let text = "Не заполнено"; try { const v = duration(value, format); if (v !== null) text = displayDuration(v, format); } catch { text = "Ошибка ввода"; } return <span className="sp-reading">{text}</span>; }
  return <div className="sp-time-wrap"><div className="sp-time" role="group" aria-label={label}>{value.map((part, i) => <span key={i} className="sp-time-part">{i === 1 && <b aria-hidden="true">{(format === "decimal" || format === "decimalMinutes") ? "," : ":"}</b>}<label><input aria-label={`${label}: ${labels[i]}`} aria-invalid={Boolean(error)} inputMode="numeric" value={part} maxLength={format === "decimalMinutes" && i === 0 ? 8 : 6} placeholder="—" onChange={e => onChange(i === 0 ? [e.target.value, value[1]] : [value[0], e.target.value])} /><small>{units[i]}</small></label></span>)}</div>{error && <small className="sp-error">{error}</small>}</div>;
}

function PercentField({ value, onChange, label, readOnly = false, error, highlighted = false }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean; error?: string; highlighted?: boolean }) {
  if (readOnly) return <span className="sp-reading">{value ? `${value.replace(".", ",")} %` : "Не заполнено"}</span>;
  return <div className={`sp-indicator-field ${highlighted ? "sp-ocr-filled" : ""}`}><div className="sp-percent-control"><input aria-label={label} aria-invalid={Boolean(error)} inputMode="decimal" maxLength={6} value={value} placeholder="—" onChange={event => onChange(event.target.value)} /><span aria-hidden="true">%</span></div>{error && <small className="sp-error">{error}</small>}</div>;
}

export function ProductionTable({ rows, settings, onChange, readOnly = false, issues = [], highlighted = [] }: { rows: ProductionRow[]; settings: Settings; onChange: (rows: ProductionRow[]) => void; readOnly?: boolean; issues?: FieldIssue[]; highlighted?: string[] }) {
  const tableId = useId();
  const update = (i: number, patch: Partial<ProductionRow>) => onChange(rows.map((r, index) => index === i ? { ...r, ...patch } : r));
  const replace = (i: number, row: ProductionRow) => onChange(rows.map((current, index) => index === i ? row : current));
  const changeMaterial = (i: number, kind: MaterialKind, field: "plan" | "fact", value: string) => {
    const row = rows[i], materials = (row.materials ?? []).map(item => item.kind === kind ? { ...item, [field]: value } : item);
    replace(i, withMaterialTotals({ ...row, materials }));
  };
  const addMaterial = (i: number, kind: MaterialKind) => {
    const row = rows[i];
    if (row.materials?.some(item => item.kind === kind)) return;
    const inherited = row.materials === undefined ? { plan: row.plan, fact: row.fact } : { plan: "", fact: "" };
    replace(i, withMaterialTotals({ ...row, materials: [...(row.materials ?? []), { kind, ...inherited }] }));
  };
  const removeMaterial = (i: number, kind: MaterialKind) => {
    const row = rows[i];
    const materials = (row.materials ?? []).filter(item => item.kind !== kind);
    replace(i, materials.length ? withMaterialTotals({ ...row, materials }) : { ...row, materials, plan: "", fact: "" });
  };
  const resolveExcavator = (i: number, patch: Partial<ProductionRow["excavator"]>) => {
    const row = rows[i], excavator = { ...row.excavator, ...patch };
    excavator.normType = excavator.type === "ЭКГ-8И" ? "ЭКГ-10" : excavator.type;
    const norms = Object.fromEntries(truckTypes.map(truck => [String(truck), getNorm(settings, excavator, truck)]));
    const loading = excavator.direction === "rail"
      ? [{ truck: null, time: row.excavator.direction === "rail" ? row.loading[0]?.time ?? ["", ""] as Parts : ["", ""] as Parts, norm: getNorm(settings, excavator) }]
      : row.excavator.direction === "truck" ? row.loading.map(item => ({ ...item, truck: item.truck ?? excavator.truck, norm: getNorm(settings, excavator, item.truck ?? excavator.truck) }))
        : [{ truck: excavator.truck, time: ["", ""] as Parts, norm: getNorm(settings, excavator) }];
    replace(i, { ...row, excavator, norms, loading, oversizePercent: excavator.direction === "rail" ? "" : row.oversizePercent });
  };
  const error = (i: number, field: string) => issues.find(x => x.path === `rows.${i}.${field}`)?.message;
  return <div className="sp-sections">{(["rail", "truck"] as const).map(direction => {
    const selected = rows.map((row, i) => ({ row, i })).filter(x => x.row.excavator.direction === direction);
    const count = selected.length;
    const noun = count % 10 === 1 && count % 100 !== 11 ? "экскаватор" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "экскаватора" : "экскаваторов";
    return <section key={direction} className="sp-section" aria-labelledby={`${tableId}-${direction}`}><div className="sp-section-title"><h3 id={`${tableId}-${direction}`}>{direction === "rail" ? "Железнодорожный транспорт" : "Автотранспорт"}</h3><span>{count} {noun}</span></div>
      {selected.length === 0 ? <p className="sp-empty-section">Техника этого направления пока не добавлена.</p> : <div className="sp-table-scroll sp-report-scroll" role="region" aria-label={direction === "rail" ? "Таблица ЖД" : "Таблица авто"} tabIndex={0}><table className={`sp-table sp-table-${direction}`}><thead><tr><th scope="col" className="sp-col-excavator">Экскаватор</th><th scope="col" className="sp-col-volume">План, м³</th><th scope="col" className="sp-col-volume">Факт, м³</th><th scope="col" className="sp-col-loading sp-loading-heading">Погрузка<small>{direction === "rail" ? "На думпкар · десятичные минуты" : "На самосвал · десятичные минуты"}</small><span className="sp-loading-legend"><span>Норматив</span><span>Факт</span></span></th><th scope="col" className="sp-col-indicator">Загрузка, %<small>Общая за смену</small></th>{direction === "truck" && <th scope="col" className="sp-col-indicator">Выход н/г, %<small>Только автотранспорт</small></th>}<th scope="col" className="sp-col-waiting">{direction === "rail" ? "Ожидание порожняка" : "Ожидание самосвалов"}<small>{direction === "rail" ? "За смену · часы" : "За смену · ч:мин"}</small></th><th scope="col" className="sp-col-comment">Комментарий<small>Причины невыполнения</small></th></tr></thead><tbody>{selected.map(({ row, i }) => {
        let result = { percent: null as number | null, comment: "" }; try { result = rowResult(row); } catch {}
        const label = `Экскаватор ${row.excavator.number}`;
        const note = commentText(row);
        const loadingFormat: TimeFormat = direction === "rail" ? row.railLoadingUnit === "minutes" ? "decimalMinutes" : "decimal" : row.truckLoadingUnit === "decimalMinutes" ? "decimalMinutes" : "ms";
        const total = withMaterialTotals(row), materials = row.materials;
        return <tr key={row.excavator.id} className={`${row.state !== "working" ? "sp-excluded " : ""}${row.excavator.typeResolved === false || row.excavator.directionResolved === false ? "sp-needs-resolution" : ""}`}><th scope="row"><strong>{row.excavator.type || "Тип не выбран"} №{row.excavator.number}</strong>{row.excavator.temporary && <small className="sp-photo-equipment">Добавлен с фотографии</small>}
          {!readOnly && row.excavator.typeResolved === false && <label className="sp-resolution-field">Тип<select value="" aria-label={`${label}: выбрать тип`} onChange={event => event.target.value && resolveExcavator(i, { type: event.target.value, typeResolved: true })}><option value="">Выберите тип</option>{excavatorTypes.map(type => <option key={type}>{type}</option>)}</select></label>}
          {!readOnly && row.excavator.directionResolved === false && <label className="sp-resolution-field">Направление<select value="" aria-label={`${label}: выбрать направление`} onChange={event => event.target.value && resolveExcavator(i, { direction: event.target.value as "rail" | "truck", directionResolved: true })}><option value="">Выберите направление</option><option value="rail">ЖД</option><option value="truck">Авто</option></select></label>}
          {error(i, "excavator") && <small className="sp-error">{error(i, "excavator")}</small>}
          {readOnly ? <small>{{ working: "Работает", repair: "Ремонт", no_crew: "Без бригады" }[row.state]}</small> : <><fieldset className="sp-row-state"><legend>На всю смену</legend>{(["working", "repair", "no_crew"] as const).map(state => { const text = { working: "Работает", repair: "Ремонт", no_crew: "Без бригады" }[state]; return <label key={state}><input type="radio" name={`${tableId}-${row.excavator.id}-state`} value={state} checked={row.state === state} aria-label={`${label}: ${text.toLocaleLowerCase("ru-RU")} всю смену`} onChange={() => update(i, { state })} />{text}</label>; })}</fieldset><div className="sp-material-actions">{materials?.map(item => <button type="button" className="sp-remove" key={`remove-${item.kind}`} aria-label={`${label}: убрать категорию ${materialLabels[item.kind]}`} onClick={() => removeMaterial(i, item.kind)}>{removeMaterialLabels[item.kind]}</button>)}{(["ore", "overburden"] as const).filter(kind => !materials?.some(item => item.kind === kind)).map(kind => <button type="button" className="ghost" key={`add-${kind}`} onClick={() => addMaterial(i, kind)}>+ {materialLabels[kind]}</button>)}</div></>}</th>
          {(["plan", "fact"] as const).map(field => <td key={field}>{materials !== undefined ? <div className="sp-material-values">{materials.map((item, materialIndex) => <label key={item.kind}><span>{materialLabels[item.kind]}</span>{readOnly ? <b>{item[field] || "—"}</b> : <input className={`sp-volume ${highlighted.includes(`rows.${i}.materials.${materialIndex}.${field}`) ? "sp-ocr-filled" : ""}`} aria-label={`${label}: ${materialLabels[item.kind]}, ${field === "plan" ? "план" : "факт"}, м³`} aria-invalid={Boolean(error(i, `materials.${materialIndex}.${field}`))} inputMode="decimal" maxLength={17} value={item[field]} placeholder="—" onChange={event => changeMaterial(i, item.kind, field, event.target.value)} />}{error(i, `materials.${materialIndex}.${field}`) && <small className="sp-error">{error(i, `materials.${materialIndex}.${field}`)}</small>}</label>)}<div className="sp-material-total"><span>Всего</span><strong>{total[field] || "—"}</strong></div></div> : readOnly ? <span className="sp-reading">{row[field] === "" ? "Не заполнено" : row[field]}</span> : <><input className={`sp-volume ${highlighted.includes(`rows.${i}.${field}`) ? "sp-ocr-filled" : ""}`} aria-label={`${label}: ${field === "plan" ? "план" : "факт"}, м³`} aria-invalid={Boolean(error(i, field))} inputMode="decimal" maxLength={17} value={row[field]} placeholder="—" onChange={e => update(i, { [field]: e.target.value })}/>{error(i, field) && <small className="sp-error">{error(i, field)}</small>}</>}{field === "fact" && <>{result.percent !== null && <span className="sp-percent">{result.percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</span>}{result.comment && <small className={`sp-row-result ${row.state === "working" ? "sp-shortfall" : ""}`}>{result.comment}</small>}</>}</td>)}
          <td><div className="sp-loadings">{row.loading.map((loading, j) => <div className={`sp-loading ${highlighted.includes(`rows.${i}.loading.${j}.time`) ? "sp-ocr-filled" : ""}`} key={loading.truck ?? "rail"}>{direction === "truck" && <div className="sp-truck-label"><strong>БЕЛАЗ {loading.truck} т</strong>{!readOnly && <button className="sp-remove" aria-label={`${label}: убрать ${loading.truck} т`} onClick={() => update(i, { loading: row.loading.filter((_, idx) => idx !== j) })}>Убрать</button>}</div>}<div className="sp-loading-values"><span className="sp-norm" aria-label={`${label}: норматив${loading.truck ? ` ${loading.truck} т` : ""}`}>{displayDuration(loading.norm, loadingFormat)}</span><TimeFields label={`${label}${loading.truck ? `, ${loading.truck} т` : ""}: погрузка`} format={loadingFormat} value={loading.time} readOnly={readOnly} error={error(i, `loading.${j}.time`)} onChange={time => update(i, { loading: row.loading.map((l, idx) => idx === j ? { ...l, time } : l) })} /></div></div>)}
            {direction === "truck" && !readOnly && row.loading.length < truckTypes.length && <label className="sp-add-truck"><span className="sp-sr-only">{label}: добавить другой самосвал</span><select value="" aria-label={`${label}: другой самосвал`} onChange={e => { if (e.target.value) { const truck = Number(e.target.value); update(i, { loading: [...row.loading, { truck, time: ["", ""], norm: row.norms[String(truck)] ?? null }] }); } }}><option value="">+ Другой самосвал</option>{truckTypes.filter(t => !row.loading.some(l => l.truck === t)).map(t => <option value={t} key={t}>БЕЛАЗ {t} т</option>)}</select></label>}{error(i, "loading") && <small className="sp-error">{error(i, "loading")}</small>}</div></td>
          <td><PercentField value={row.loadPercent ?? ""} label={`${label}: загрузка, %`} readOnly={readOnly} error={error(i, "loadPercent")} highlighted={highlighted.includes(`rows.${i}.loadPercent`)} onChange={loadPercent => update(i, { loadPercent })} /></td>
          {direction === "truck" && <td><PercentField value={row.oversizePercent ?? ""} label={`${label}: выход негабарита, %`} readOnly={readOnly} error={error(i, "oversizePercent")} highlighted={highlighted.includes(`rows.${i}.oversizePercent`)} onChange={oversizePercent => update(i, { oversizePercent })} /></td>}
          <td><TimeFields value={row.waiting} label={`${label}: ожидание`} format={direction === "rail" ? "decimal" : "hm"} readOnly={readOnly} error={error(i, "waiting")} onChange={waiting => update(i, { waiting })} /></td>
          <td>{readOnly ? <div className="sp-reason-reading">{note || <span className="sp-muted">Не указан</span>}</div> : <div className="sp-comment">
            <textarea aria-label={`${label}: комментарий`} rows={3} maxLength={2000} placeholder="Напишите комментарий" value={note} onChange={e => update(i, { note: e.target.value, reasons: [] })} />
            <select value="" aria-label={`${label}: добавить причину в комментарий`} onChange={e => { const reason = settings.reasons.find(r => r.id === e.target.value && r.active); if (reason) update(i, { note: appendReasonText(note, reason.name), reasons: [] }); }}>
              <option value="">+ Готовая причина</option>{settings.reasons.filter(r => r.active).map(reason => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>{error(i, "note") && <small className="sp-error">{error(i, "note")}</small>}
          </div>}</td>
        </tr>;
      })}</tbody></table></div>}
    </section>;
  })}</div>;
}
