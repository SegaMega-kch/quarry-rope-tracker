/** Enterprise work periods. Dispatch times in report-schedule.ts are independent. */
export const workTimeZone = "Asia/Yekaterinburg";
export const workShiftHours = 12;
const dayMs = 86_400_000;
const anchor = Date.UTC(2026, 8, 29);
export type WorkPeriod = { key: string; date: string; kind: "day" | "night"; crew: number; start: string; end: string };

export function workPeriod(date: string, kind: "day" | "night"): WorkPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["day", "night"].includes(kind)) throw new Error("Выберите дату и день или ночь");
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date || date < "2000-01-01" || date > "2100-12-31") throw new Error("Некорректная дата смены");
  const offset = Math.round((midnight - anchor) / dayMs);
  // On 29 September day crew 2; on 30 September night crew 2 (day -> next night).
  const crew = ((1 + offset - (kind === "night" ? 1 : 0)) % 4 + 4) % 4 + 1;
  const start = midnight + (kind === "day" ? 3 : 15) * 3_600_000;
  return { key: `${date}/${kind}`, date, kind, crew, start: new Date(start).toISOString(), end: new Date(start + workShiftHours * 3_600_000).toISOString() };
}

export function currentWorkPeriod(now = new Date()) {
  const local = new Date(now.getTime() + 5 * 3_600_000);
  const hour = local.getUTCHours();
  if (hour < 8) local.setUTCDate(local.getUTCDate() - 1);
  return workPeriod(local.toISOString().slice(0, 10), hour >= 8 && hour < 20 ? "day" : "night");
}

export function periodLabel(period: WorkPeriod) {
  const format = (date: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: workTimeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date));
  return period.kind === "day" ? `${format(period.start)} · День · ${period.crew} смена` : `Ночь с ${format(period.start)} на ${format(period.end)} · ${period.crew} смена`;
}
