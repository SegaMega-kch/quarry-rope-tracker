import { restoreSafetyExcavatorAction } from "@/app/actions";
import { safetyStatus, safetyStatusLabels, type SafetyStatus } from "@/lib/safety";
import { compareLocations } from "@/lib/labels";
import { LazyDetails } from "./LazyDetails";
import { SafetyDateForm } from "./SafetyDateForm";

type SafetyItemRow = {
  id: number;
  category: string;
  name: string;
  expiryDate: Date | null;
  sortOrder: number;
  location: { id: number; name: string; isActive: boolean };
};

type SafetyHistoryRow = {
  id: number;
  createdAt: Date;
  oldExpiryDate: Date | null;
  newExpiryDate: Date | null;
  user: { login: string };
  item: { name: string; category: string; location: { name: string } };
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" });
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

function dateValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function shownDate(date: Date | null) {
  return date ? dateFormatter.format(date) : "Дата не указана";
}

function Summary({ items }: { items: SafetyItemRow[] }) {
  const totals: Record<SafetyStatus, number> = { OVERDUE: 0, EXPIRING: 0, ACTIVE: 0, NO_DATE: 0 };
  for (const item of items) totals[safetyStatus(item.expiryDate)] += 1;
  return (
    <div className="safety-summary" aria-label="Сводка сроков">
      <div className="safety-metric overdue"><b>{totals.OVERDUE}</b><span>Просрочено</span></div>
      <div className="safety-metric expiring"><b>{totals.EXPIRING}</b><span>Истекает в месяц</span></div>
      <div className="safety-metric active"><b>{totals.ACTIVE}</b><span>Действующие</span></div>
      <div className="safety-metric no-date"><b>{totals.NO_DATE}</b><span>Дата не указана</span></div>
    </div>
  );
}

function EquipmentGroup({
  title,
  category,
  items
}: {
  title: string;
  category: string;
  items: SafetyItemRow[];
}) {
  const byExcavator = new Map<number, SafetyItemRow[]>();
  for (const item of items.filter((row) => row.category === category)) {
    const rows = byExcavator.get(item.location.id) ?? [];
    rows.push(item);
    byExcavator.set(item.location.id, rows);
  }
  const groups = Array.from(byExcavator.values()).sort((a, b) => compareLocations(a[0].location, b[0].location));

  return (
    <details className="safety-section" open>
      <summary>{title}</summary>
      <div className="safety-excavators">
        {groups.map((rows) => (
          <section className="safety-excavator" key={rows[0].location.id}>
            <h3>{rows[0].location.name}</h3>
            <div className="safety-items">
              {rows.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => {
                const status = safetyStatus(item.expiryDate);
                return (
                  <SafetyDateForm
                    key={item.id}
                    itemId={item.id}
                    name={item.name}
                    value={dateValue(item.expiryDate)}
                    statusClass={status.toLowerCase()}
                    statusLabel={safetyStatusLabels[status]}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

export function SafetySection({
  items,
  history,
  historyOpen,
  canRestore
}: {
  items: SafetyItemRow[];
  history: SafetyHistoryRow[];
  historyOpen: boolean;
  canRestore: boolean;
}) {
  const activeItems = items.filter((item) => item.location.isActive);
  const archivedItems = items.filter((item) => !item.location.isActive);
  const archivedLocations = Array.from(new Map(archivedItems.map((item) => [item.location.id, item.location])).values());

  return (
    <>
      <section className="panel safety-panel">
        <h2>СИЗ</h2>
        <Summary items={activeItems} />
        <EquipmentGroup title="СИЗ и страховочное оборудование" category="PPE" items={activeItems} />
        <EquipmentGroup title="Огнетушители" category="EXTINGUISHER" items={activeItems} />
      </section>

      <section className="panel">
        <LazyDetails label="История изменений" queryKey="history" open={historyOpen}>
          <div className="timeline safety-history">
            {history.map((row) => (
              <article key={row.id}>
                <b>{row.item.location.name}: {row.item.name}</b>
                <span>{dateTimeFormatter.format(row.createdAt)} - {row.user.login}</span>
                <p>{shownDate(row.oldExpiryDate)} {" -> "} {shownDate(row.newExpiryDate)}</p>
              </article>
            ))}
            {!history.length ? <p className="muted">Изменений пока нет.</p> : null}
          </div>
        </LazyDetails>
      </section>

      <section className="panel">
        <details className="history-details safety-archive">
          <summary><span>Архив экскаваторов</span></summary>
          {!archivedLocations.length ? <p className="muted">Архив пуст.</p> : null}
          {archivedLocations.map((location) => (
            <div className="safety-archive-row" key={location.id}>
              <strong>{location.name}</strong>
              <div className="safety-archive-items">
                {archivedItems
                  .filter((item) => item.location.id === location.id)
                  .sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder)
                  .map((item) => (
                    <span key={item.id}>{item.name}: {shownDate(item.expiryDate)}</span>
                  ))}
              </div>
              {canRestore ? (
                <form action={restoreSafetyExcavatorAction}>
                  <input type="hidden" name="locationId" value={location.id} />
                  <button type="submit">Вернуть в работу</button>
                </form>
              ) : null}
            </div>
          ))}
        </details>
      </section>
    </>
  );
}
