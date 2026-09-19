import {
  deleteYaknoBoxAction,
  repairYaknoBoxAction,
  restoreYaknoBoxAction,
  saveYaknoBoxAction,
  undoYaknoMovementAction
} from "@/app/actions";
import { locationLabel, shortHorizonLabel, yaknoActionLabels, yaknoLabel } from "@/lib/labels";
import { CloseDetailsButton } from "./CloseDetailsButton";
import { LazyDetails } from "./LazyDetails";
import { ManagementDialog, ManagementForm, ManagementSection } from "./Management";
import { YaknoPowerForm } from "./PowerForms";
import { YaknoHorizonMenu } from "./YaknoHorizonMenu";
import { compareYaknoNumbers, freeYaknoOnHorizon, yaknoWithoutExcavator } from "@/lib/yakno-view";

type HorizonView = {
  id: number;
  name: string;
  sortOrder: number;
};

type LocationView = {
  id: number;
  name: string;
  category: string;
};

type YaknoBoxView = {
  id: number;
  number: string;
  isActive: boolean;
  status: string;
  comment: string | null;
  excavatorLocationId: number | null;
  horizonId: number | null;
  isPowered: boolean;
  lastChangedAt: Date;
  lastChangedBy: string | null;
  horizon: HorizonView | null;
  excavatorLocation: LocationView | null;
};

type YaknoStateView = {
  id: number;
  excavatorLocationId: number;
  horizonId: number | null;
  lastChangedAt: Date;
  lastChangedBy: string | null;
  horizon: HorizonView | null;
};

type YaknoMovementView = {
  id: number;
  createdAt: Date;
  userId: number;
  action: string;
  comment: string | null;
  user: { login: string };
  box: { number: string } | null;
  excavatorLocation: { name: string } | null;
  fromHorizon: { name: string } | null;
  toHorizon: { name: string } | null;
  beforeState: string | null;
  afterState: string | null;
};

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

function connectionHistory(movement: YaknoMovementView, boxes: YaknoBoxView[], horizons: HorizonView[]) {
  const describe = (raw: string | null) => {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as { boxes: Array<{ id: number; isPowered: boolean }> };
      const names = data.boxes.filter((box) => box.isPowered).map((box) =>
        yaknoLabel(boxes.find((item) => item.id === box.id)?.number) || `ЯКНО #${box.id}`);
      return names.join(", ") || "Не запитан";
    } catch { return null; }
  };
  const before = describe(movement.beforeState), after = describe(movement.afterState);
  const lines = before && after && before !== after ? [`${before} → ${after}`] : [];
  try {
    type BoxState = { id: number; horizonId: number | null };
    const a = JSON.parse(movement.beforeState ?? "{}") as { boxes?: BoxState[] };
    const b = JSON.parse(movement.afterState ?? "{}") as { boxes?: BoxState[] };
    for (const box of b.boxes ?? []) {
      const prior = a.boxes?.find((item) => item.id === box.id);
      if (!prior || prior.horizonId === box.horizonId) continue;
      const label = (id: number | null) => shortHorizonLabel(horizons.find((item) => item.id === id)?.name ?? (id ? `#${id}` : null));
      lines.push(`${yaknoLabel(boxes.find((item) => item.id === box.id)?.number)}: ${label(prior.horizonId)} → ${label(box.horizonId)}`);
    }
  } catch { /* Legacy records without structured snapshots keep their existing history text. */ }
  return lines.join("; ");
}

function stateFor(states: YaknoStateView[], excavatorId: number) {
  return states.find((state) => state.excavatorLocationId === excavatorId) ?? null;
}

function shortExcavatorName(name: string) {
  return locationLabel(name);
}

function shortYaknoComment(comment: string | null) {
  if (!comment) return "";
  return comment.length > 20 ? `${comment.slice(0, 20)}...` : comment;
}

function yaknoBoxLine(box: YaknoBoxView, powered = false) {
  const comment = shortYaknoComment(box.comment);

  return (
    <span className={powered ? "yakno-box-line powered" : "yakno-box-line"} key={box.id}>
      <b>{yaknoLabel(box.number)}{powered ? " зап" : ""}</b>
      {comment ? <em title={box.comment ?? ""}>{comment}</em> : null}
    </span>
  );
}

export function YaknoSection({
  excavators,
  boxes,
  states,
  horizons,
  movements,
  currentUserId,
  canManageDictionaries,
  canManageBoxes,
  historyOpen,
  undoAfter
}: {
  excavators: LocationView[];
  boxes: YaknoBoxView[];
  states: YaknoStateView[];
  horizons: HorizonView[];
  movements: YaknoMovementView[];
  currentUserId: number;
  canManageDictionaries: boolean;
  canManageBoxes: boolean;
  historyOpen: boolean;
  undoAfter?: Date;
}) {
  const activeHorizons = [...horizons].sort((a, b) => a.sortOrder - b.sortOrder);
  const activeBoxes = boxes.filter((box) => box.isActive);
  const usableBoxes = activeBoxes.filter((box) => box.status !== "REPAIR");
  const freeBoxes = yaknoWithoutExcavator(usableBoxes, excavators.map((excavator) => stateFor(states, excavator.id)?.horizonId ?? null));
  const repairBoxes = activeBoxes.filter((box) => box.status === "REPAIR").sort(compareYaknoNumbers);
  const recentUndoIds = new Set(
    movements
      .filter((movement) => movement.userId === currentUserId && movement.action !== "ARCHIVE_DETACH" && (!undoAfter || movement.createdAt > undoAfter))
      .slice(0, 3)
      .map((movement) => movement.id)
  );

  return (
    <section className="yakno-section">
      <section className="panel">
        <h2>ЯКНО</h2>
        <div className="yakno-excavator-list">
          {excavators.map((excavator) => {
            const state = stateFor(states, excavator.id);
            const poweredBox = usableBoxes.find((box) => box.isPowered && box.excavatorLocationId === excavator.id);
            const nearbyBoxes = freeYaknoOnHorizon(usableBoxes, state?.horizonId ?? null);
            const changed = [state, poweredBox, ...nearbyBoxes].filter((item) => item != null)
              .sort((a, b) => b.lastChangedAt.getTime() - a.lastChangedAt.getTime())[0];
            const changedAt = changed?.lastChangedAt;
            const changedBy = changed?.lastChangedBy;

            return (
              <article className="yakno-excavator-card" key={excavator.id}>
                <div className="yakno-main-line">
                  <div className="yakno-excavator-heading">
                    <strong>{shortExcavatorName(excavator.name)}</strong>
                    <p className="yakno-horizon">{shortHorizonLabel(state?.horizon?.name)}</p>
                  </div>
                  <div className="yakno-box-stack">
                    {poweredBox ? yaknoBoxLine(poweredBox, true) : <b>не запитан</b>}
                    {nearbyBoxes.map((box) => <div className="yakno-box-line" key={box.id}>
                      <YaknoHorizonMenu box={box} horizons={activeHorizons} compact />
                      {box.comment ? <em title={box.comment}>{shortYaknoComment(box.comment)}</em> : null}
                    </div>)}
                  </div>
                </div>

                <small>
                  Изм.: {changedAt ? dtf.format(changedAt) : "-"}{changedBy ? ` - ${changedBy}` : ""}
                </small>

                <details className="yakno-edit-wrap">
                  <summary>Изменить</summary>
                  <div className="yakno-edit-menu">
                    <div className="quick-menu-head">
                      <strong>{shortExcavatorName(excavator.name)}</strong>
                      <CloseDetailsButton />
                    </div>
                    <YaknoPowerForm key={`${state?.horizonId}:${poweredBox?.id}:${changedAt?.getTime()}`}
                      excavatorId={excavator.id} horizonId={state?.horizonId ?? null} poweredBoxId={poweredBox?.id ?? null}
                      horizons={activeHorizons} boxes={usableBoxes.map(({ id, number, horizonId, isPowered, excavatorLocationId }) =>
                        ({ id, number, horizonId, isPowered, excavatorLocationId }))} />
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>ЯКНО без экскаватора</h2>
        <div className="yakno-box-grid">
          {freeBoxes.length ? freeBoxes.map((box) => (
            <article className="yakno-box-card" key={box.id}>
              <strong>{yaknoLabel(box.number)}</strong>
              <p className="yakno-horizon">{shortHorizonLabel(box.horizon?.name)}</p>
              <YaknoHorizonMenu box={box} horizons={activeHorizons} />
            </article>
          )) : <p className="muted">Нет ЯКНО без экскаватора.</p>}
        </div>
      </section>

      <section className="panel">
        <h2>ЯКНО в ремонте</h2>
        <div className="yakno-box-grid">
          {repairBoxes.length ? repairBoxes.map((box) => (
            <article className="yakno-box-card repair" key={box.id}>
              <strong>{yaknoLabel(box.number)}</strong>
              <span>ремонт</span>
              {canManageDictionaries ? (
                <form action={restoreYaknoBoxAction}>
                  <input type="hidden" name="boxId" value={box.id} />
                  <button type="submit">Вернуть</button>
                </form>
              ) : null}
            </article>
          )) : <p className="muted">В ремонте нет ЯКНО.</p>}
        </div>
      </section>


      <section className="panel">
        <LazyDetails label="История ЯКНО" queryKey="history" open={historyOpen}>
          <div className="timeline">
            {movements.map((movement) => (
              <article key={movement.id}>
                <b>{yaknoActionLabels[movement.action] ?? movement.action}</b>
                <span>{dtf.format(movement.createdAt)} - {movement.user.login}</span>
                <p>
                  {movement.excavatorLocation ? shortExcavatorName(movement.excavatorLocation.name) : ""}
                  {movement.box ? ` ${yaknoLabel(movement.box.number)}` : ""}
                </p>
                {movement.action === "SET_EXCAVATOR" && connectionHistory(movement, boxes, horizons) ? <p>{connectionHistory(movement, boxes, horizons)}</p> : null}
                <small>
                  {movement.fromHorizon?.name !== movement.toHorizon?.name ? `${shortHorizonLabel(movement.fromHorizon?.name)} → ${shortHorizonLabel(movement.toHorizon?.name)}` : ""}
                  {movement.comment ? `; ${movement.comment}` : ""}
                </small>
                {recentUndoIds.has(movement.id) ? (
                  <form action={undoYaknoMovementAction} className="undo-form">
                    <input type="hidden" name="movementId" value={movement.id} />
                    <button type="submit">Откатить</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </LazyDetails>
      </section>
      {canManageBoxes ? (
        <ManagementSection>
          <ManagementDialog title="Добавить ЯКНО" kind="add">
            <ManagementForm action={saveYaknoBoxAction}>
              <label>
                Номер ЯКНО
                <input name="number" placeholder="Например: 122 или 14/1" required />
              </label>
              <button className="primary big" type="submit">Добавить ЯКНО</button>
            </ManagementForm>
          </ManagementDialog>

          <ManagementDialog title="Удалить ЯКНО" kind="delete">
              <div className="yakno-admin-list">
                {boxes.filter((box) => box.isActive).map((box) => (
                  <div className="yakno-admin-row" key={box.id}>
                    <b>{yaknoLabel(box.number)}</b>
                      <ManagementForm action={deleteYaknoBoxAction} message="Убрать ЯКНО из списка? История сохранится.">
                        <input type="hidden" name="boxId" value={box.id} />
                        <button className="danger" type="submit" disabled={box.isPowered}>{box.isPowered ? "На экскаваторе" : "Удалить"}</button>
                      </ManagementForm>
                  </div>
                ))}
              </div>
          </ManagementDialog>
          {canManageDictionaries ? <ManagementDialog title="Отправить ЯКНО в ремонт">
            <div className="yakno-admin-list">{usableBoxes.map((box) => <div className="yakno-admin-row" key={box.id}>
              <b>{yaknoLabel(box.number)}</b>
              <ManagementForm action={repairYaknoBoxAction}>
                <input type="hidden" name="boxId" value={box.id} /><button type="submit">В ремонт</button>
              </ManagementForm>
            </div>)}</div>
          </ManagementDialog> : null}
        </ManagementSection>
      ) : null}
    </section>
  );
}
