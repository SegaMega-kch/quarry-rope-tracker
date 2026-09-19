const day = 24 * 60 * 60 * 1000;
const hour = 60 * 60 * 1000;

// Yekaterinburg is UTC+05:00: 06:30/19:30 local are 01:30/14:30 UTC.
export function nextReportBoundary(after: Date): Date {
  const at = after.getTime();
  if (!Number.isFinite(at)) throw new Error("Invalid report boundary");
  const midnight = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate());
  for (const offset of [1.5, 14.5, 25.5]) {
    const candidate = midnight + offset * hour;
    if (candidate > at) return new Date(candidate);
  }
  throw new Error("Invalid report boundary");
}

export function validReportPeriod(start: Date, end: Date) {
  const a = start.getTime(), b = end.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > day) return false;
  const minute = (value: Date) => value.getUTCHours() * 60 + value.getUTCMinutes();
  if (start.getUTCSeconds() || end.getUTCSeconds() || start.getUTCMilliseconds() || end.getUTCMilliseconds()) return false;
  const from = minute(start), to = minute(end);
  const legacy = (from === 180 || from === 900) && (to === 180 || to === 900) && b - a === 12 * hour;
  const current = (from === 90 || from === 870) && nextReportBoundary(start).getTime() === b;
  const transition = from === 900 && to === 90 && b - a === 10.5 * hour;
  return legacy || current || transition;
}
