"use client";
import { displayDuration, duration, weightedLoading, type ProductionRow } from "@/lib/production-domain";
export function ProductionMetrics({ rows }: { rows: ProductionRow[] }) {
  try {
    const mixed = rows.filter(r => r.state === "working" && r.excavator.direction === "truck" && r.loading.filter(l => duration(l.time, r.truckLoadingUnit === "decimalMinutes" ? "decimalMinutes" : "ms") !== null).length > 1);
    return <div className="sp-metrics">{mixed.length > 0 && <p className="sp-muted">В среднее время погрузки не входят: {mixed.map(r => `№ ${r.excavator.number}`).join(", ")}. Заполнено несколько видов самосвалов, а распределение объёма неизвестно. План и факт учитываются.</p>}<details><summary>Среднее время погрузки и охват данных</summary><p>Среднее взвешено по объёму отгрузки. Это показатель по данным формы, а не точное среднее по всем рейсам. Производственная аналитика использует только последние сохранённые итоговые версии.</p>{(["rail", "truck"] as const).map(direction => { const metric = weightedLoading(rows, direction); return <p key={direction}><strong>{direction === "rail" ? "ЖД" : "Авто"}: {metric.value === null ? "Не рассчитывается" : displayDuration(Math.round(metric.value), "decimalMinutes")}</strong><small>Учтено {metric.counted} из {metric.expected} записей «экскаватор × период»</small></p>; })}</details></div>;
  } catch { return null; }
}
