import { cleanReportText, type ReportGroup, type WorkEvent } from "./shift-report";

export type ReportStateValue = { key: string; label: string; empty?: boolean };
export type ReportStateChange = {
  id: string; at: Date; group: ReportGroup; key: string; prefix: string;
  before: ReportStateValue; after: ReportStateValue;
  visible?: boolean;
  observationOnly?: boolean;
};

export function compactReportStates(changes: ReportStateChange[]): WorkEvent[] {
  const ordered = [...changes].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id, "ru", { numeric: true }));
  const chains: Array<{ first: ReportStateChange; last: ReportStateChange; reportable: boolean }> = [];
  const latest = new Map<string, (typeof chains)[number]>();
  for (const change of ordered) {
    let chain = latest.get(change.key);
    // Incomplete history must not join unrelated moves and hide a real change.
    if (!chain || chain.last.after.key !== change.before.key) {
      chain = { first: change, last: change, reportable: false };
      chains.push(chain);
      latest.set(change.key, chain);
    }
    chain.last = change;
    chain.reportable ||= !change.observationOnly;
  }
  return chains.filter(({ first, last, reportable }) => reportable && last.visible !== false && first.before.key !== last.after.key)
    .map(({ first, last }) => ({
      kind: "work", id: last.id, at: last.at, group: last.group,
      line: cleanReportText(`${last.prefix}${first.before.empty ? "" : `${first.before.label} → `}${last.after.label}.`)
    }));
}
