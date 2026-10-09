"use client";

import { useMemo, useState } from "react";
import type { StatisticsPoint, StatisticsReport } from "@/lib/pp-statistics";

type Mode = "total" | "sectors";
type ChartRow = { report: StatisticsReport; point: StatisticsPoint | null };
type HoverValue = { label: string; excavator: string; ore: number; overburden: number };

const natural = new Intl.Collator("ru", { numeric: true });
const materialLetter = { ORE: "Р", OVERBURDEN: "В", UNKNOWN: "?" } as const;

function totals(point: StatisticsPoint | null, sector?: string) {
  const values = point?.sectors.filter((item) => sector === undefined || item.name === sector) ?? [];
  return {
    ore: values.filter((item) => item.material === "ORE").reduce((sum, item) => sum + item.quantity, 0),
    overburden: values.filter((item) => item.material === "OVERBURDEN").reduce((sum, item) => sum + item.quantity, 0)
  };
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}.${month}`;
}

function lineSegments(rows: ChartRow[], value: (row: ChartRow) => number | null, x: (index: number) => number, y: (number: number) => number) {
  const segments: string[] = [];
  let current = "";
  rows.forEach((row, index) => {
    const amount = value(row);
    if (amount === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? " L" : "M"}${x(index)} ${y(amount)}`;
  });
  if (current) segments.push(current);
  return segments;
}

function MovementChart({ rows, sector, compact = false }: { rows: ChartRow[]; sector?: string; compact?: boolean }) {
  const [hover, setHover] = useState<HoverValue | null>(null);
  const width = 1000, height = compact ? 285 : 360;
  const margin = { top: 62, right: 30, bottom: 56, left: 54 };
  const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  const values = rows.flatMap((row) => row.point ? Object.values(totals(row.point, sector)) : []);
  const maximum = Math.max(1, ...values);
  const ceiling = Math.max(2, Math.ceil(maximum / 2) * 2);
  const x = (index: number) => margin.left + (rows.length === 1 ? plotWidth / 2 : index * plotWidth / (rows.length - 1));
  const y = (value: number) => margin.top + plotHeight - value / ceiling * plotHeight;
  const amount = (kind: "ore" | "overburden") => (row: ChartRow) => row.point ? totals(row.point, sector)[kind] : null;
  const orePaths = lineSegments(rows, amount("ore"), x, y);
  const overburdenPaths = lineSegments(rows, amount("overburden"), x, y);
  const tickCount = Math.min(ceiling, 5) + 1;
  const ticks = Array.from({ length: tickCount }, (_, index) => Math.round(ceiling * index / (tickCount - 1)));
  const labelStep = Math.max(1, Math.ceil(rows.length / (compact ? 6 : 9)));

  const bands: Array<{ start: number; end: number; name: string }> = [];
  rows.forEach((row, index) => {
    if (!row.point) return;
    const name = row.point.excavator ?? "Без экскаватора";
    const previous = bands.at(-1);
    if (previous && previous.end === index - 1 && previous.name === name) previous.end = index;
    else bands.push({ start: index, end: index, name });
  });

  return <div className="statistics-chart-wrap">
    <div className="statistics-chart-status" aria-live="polite">
      {hover ? <><strong>{hover.label}</strong><span>{hover.excavator}</span><span className="ore-text">Руда: {hover.ore}</span><span className="overburden-text">Вскрыша: {hover.overburden}</span></> : <span>Наведите на точку или выберите её клавишей Tab</span>}
    </div>
    <svg className="statistics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${sector ? `Сектор ${sector}` : "Всего по П/П"}: руда и вскрыша в локомотивосоставах`}>
      {bands.map((band, index) => {
        const left = band.start === 0 ? margin.left : (x(band.start - 1) + x(band.start)) / 2;
        const right = band.end === rows.length - 1 ? width - margin.right : (x(band.end) + x(band.end + 1)) / 2;
        return <g key={`${band.start}-${band.name}`}>
          <rect className={`statistics-band statistics-band-${index % 2}`} x={left} y={margin.top - 34} width={Math.max(1, right - left)} height={plotHeight + 34} />
          <line className="statistics-band-line" x1={left} x2={left} y1={margin.top - 34} y2={margin.top + plotHeight} />
          <text className="statistics-band-label" x={(left + right) / 2} y={margin.top - 13}>{band.name.length > 20 ? `${band.name.slice(0, 19)}…` : band.name}</text>
        </g>;
      })}
      {ticks.map((tick) => <g key={tick}>
        <line className="statistics-grid-line" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
        <text className="statistics-axis-label" x={margin.left - 12} y={y(tick) + 5} textAnchor="end">{tick}</text>
      </g>)}
      <line className="statistics-axis" x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} />
      <line className="statistics-axis" x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} />
      {rows.map((row, index) => index % labelStep === 0 || index === rows.length - 1 ? <text key={row.report.at} className="statistics-axis-label" x={x(index)} y={height - 28} textAnchor="middle">
        <tspan x={x(index)}>{shortDate(row.report.date)}</tspan><tspan x={x(index)} dy="16">{row.report.time}</tspan>
      </text> : null)}
      {overburdenPaths.map((path, index) => <path key={`v-${index}`} className="statistics-line statistics-line-overburden" d={path} />)}
      {orePaths.map((path, index) => <path key={`r-${index}`} className="statistics-line statistics-line-ore" d={path} />)}
      {rows.flatMap((row, index) => {
        if (!row.point) return [];
        const value = totals(row.point, sector);
        const common = { tabIndex: 0, onBlur: () => setHover(null), onMouseLeave: () => setHover(null) };
        const show = () => setHover({ label: `${shortDate(row.report.date)} · ${row.report.time}`, excavator: row.point?.excavator ?? "Без экскаватора", ...value });
        return [
          <circle {...common} key={`v-${row.report.at}`} className="statistics-point statistics-point-overburden" cx={x(index)} cy={y(value.overburden)} r="5" onFocus={show} onMouseEnter={show}><title>Вскрыша: {value.overburden}</title></circle>,
          <circle {...common} key={`r-${row.report.at}`} className="statistics-point statistics-point-ore" cx={x(index)} cy={y(value.ore)} r="5" onFocus={show} onMouseEnter={show}><title>Руда: {value.ore}</title></circle>
        ];
      })}
    </svg>
  </div>;
}

export function StatisticsBoard({ reports, sourceAvailable }: { reports: StatisticsReport[]; sourceAvailable: boolean }) {
  const pointNames = useMemo(() => Array.from(new Set(reports.flatMap((report) => report.points.map((point) => point.name)))).sort(natural.compare), [reports]);
  const [pointName, setPointName] = useState(pointNames[0] ?? "");
  const [from, setFrom] = useState(reports[0]?.date ?? "");
  const [to, setTo] = useState(reports.at(-1)?.date ?? "");
  const [mode, setMode] = useState<Mode>("total");
  const invalidPeriod = Boolean(from && to && from > to);
  const selected = reports.filter((report) => (!from || report.date >= from) && (!to || report.date <= to));
  const rows = selected.map((report) => ({ report, point: report.points.find((point) => point.name === pointName) ?? null }));
  const exactRows = rows.filter((row): row is { report: StatisticsReport; point: StatisticsPoint } => Boolean(row.point));
  const sectorNames = Array.from(new Set(exactRows.flatMap((row) => row.point.sectors.map((sector) => sector.name)))).sort(natural.compare);

  if (!sourceAvailable) return <section className="statistics-empty" role="alert">
    <h2>Источник статистики пока не подключён</h2>
    <p>Укажите на сервере путь к базе отправленных отчётов П/П. Текущие остатки склада не используются и не подменяют историю.</p>
  </section>;
  if (!reports.length) return <section className="statistics-empty">
    <h2>Сохранённых отчётов пока нет</h2>
    <p>График появится после сохранения отчётов П/П на 06:30 или 19:30.</p>
  </section>;

  return <section className="statistics-board">
    <div className="statistics-heading">
      <div><h2>Движение горной массы на П/П</h2><p>Точные остатки из сохранённых отчётов на 06:30 и 19:30</p></div>
      <div className="statistics-legend" aria-label="Обозначения графика"><span><i className="legend-ore" />Руда</span><span><i className="legend-overburden" />Вскрыша</span></div>
    </div>

    <div className="statistics-controls">
      <label>Перегрузочный пункт<select value={pointName} onChange={(event) => setPointName(event.target.value)}>{pointNames.map((name) => <option key={name}>{name}</option>)}</select></label>
      <div className="statistics-period">
        <label>С<input type="date" value={from} min={reports[0].date} max={reports.at(-1)?.date} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>По<input type="date" value={to} min={reports[0].date} max={reports.at(-1)?.date} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <fieldset className="statistics-mode"><legend>Вид графика</legend><div>
        <label><input type="radio" name="statistics-mode" checked={mode === "total"} onChange={() => setMode("total")} /><span>Всего</span></label>
        <label><input type="radio" name="statistics-mode" checked={mode === "sectors"} onChange={() => setMode("sectors")} /><span>По секторам</span></label>
      </div></fieldset>
    </div>

    {invalidPeriod ? <div className="statistics-error" role="alert">Дата «С» не может быть позже даты «По».</div> : !exactRows.length ? <div className="statistics-empty statistics-empty-inline"><h3>Нет данных за выбранный период</h3><p>Для {pointName} в сохранённых отчётах этого периода нет точного снимка.</p></div> : <>
      {mode === "total" ? <MovementChart rows={rows} /> : <div className="statistics-sector-charts">{sectorNames.map((sector) => <section key={sector}><h3>Сектор {sector}</h3><MovementChart rows={rows} sector={sector} compact /></section>)}</div>}
      <p className="statistics-unit">Количество локомотивосоставов на момент отчёта. Пропуск означает, что точного снимка П/П в отчёте нет.</p>
      <div className="statistics-table-wrap">
        <table className="statistics-table">
          <thead><tr><th>Дата и время</th><th>Экскаватор</th>{sectorNames.map((sector) => <th key={sector}>Сектор {sector}</th>)}<th>Руда</th><th>Вскрыша</th></tr></thead>
          <tbody>{exactRows.map(({ report, point }) => {
            const sum = totals(point);
            return <tr key={report.at}><th>{shortDate(report.date)}<small>{report.time}</small></th><td>{point.excavator ?? "Без экскаватора"}</td>{sectorNames.map((sectorName) => {
              const sector = point.sectors.find((item) => item.name === sectorName);
              return <td key={sectorName}>{sector ? `${sector.quantity} ${materialLetter[sector.material]}` : "—"}</td>;
            })}<td className="ore-text">{sum.ore}</td><td className="overburden-text">{sum.overburden}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
