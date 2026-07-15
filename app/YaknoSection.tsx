import {
  deleteYaknoBoxAction,
  repairYaknoBoxAction,
  restoreYaknoBoxAction,
  saveFreeYaknoHorizonAction,
  saveYaknoBoxAction,
  saveYaknoExcavatorAction,
  undoYaknoMovementAction
} from "@/app/actions";
import { locationLabel, shortHorizonLabel, yaknoActionLabels, yaknoLabel } from "@/lib/labels";
import { CloseDetailsButton } from "./CloseDetailsButton";
import { ConfirmSubmitForm } from "./ConfirmSubmitForm";
import { LazyDetails } from "./LazyDetails";

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
};

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

function yaknoNumberValue(number: string) {
  return Number(number.match(/\d+/)?.[0] ?? 9999);
}

function compareYakno(a: YaknoBoxView, b: YaknoBoxView) {
  return yaknoNumberValue(a.number) - yaknoNumberValue(b.number) || a.number.localeCompare(b.number, "ru");
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
  historyOpen
}: {
  excavators: LocationView[];
  boxes: YaknoBoxView[];
  states: YaknoStateView[];
  horizons: HorizonView[];
  movements: YaknoMovementView[];
  currentUserId: number;
  canManageDictionaries: boolean;
  historyOpen: boolean;
}) {
  const activeHorizons = [...horizons].sort((a, b) => a.sortOrder - b.sortOrder);
  const activeBoxes = boxes.filter((box) => box.isActive);
  const usableBoxes = activeBoxes.filter((box) => box.status !== "REPAIR");
  const freeBoxes = usableBoxes.filter((box) => !box.excavatorLocationId).sort(compareYakno);
  const repairBoxes = activeBoxes.filter((box) => box.status === "REPAIR").sort(compareYakno);
  const recentUndoIds = new Set(
    movements
      .filter((movement) => movement.userId === currentUserId)
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
            const assignedBoxes = activeBoxes
              .filter((box) => box.excavatorLocationId === excavator.id && box.status !== "REPAIR")
              .sort((a, b) => Number(b.isPowered) - Number(a.isPowered) || compareYakno(a, b));
            const poweredBox = assignedBoxes.find((box) => box.isPowered);
            const selectableBoxes = usableBoxes
              .filter((box) => !box.excavatorLocationId || box.excavatorLocationId === excavator.id)
              .sort(compareYakno);
            const changedAt = assignedBoxes[0]?.lastChangedAt ?? state?.lastChangedAt;
            const changedBy = assignedBoxes[0]?.lastChangedBy ?? state?.lastChangedBy;

            return (
              <article className="yakno-excavator-card" key={excavator.id}>
                <div className="yakno-main-line">
                  <strong>{shortExcavatorName(excavator.name)}</strong>
                  <span>{shortHorizonLabel(state?.horizon?.name)}</span>
                  <div className="yakno-box-stack">
                    {poweredBox ? yaknoBoxLine(poweredBox, true) : <b>не запитан</b>}
                    {assignedBoxes
                      .filter((box) => !box.isPowered)
                      .map((box) => yaknoBoxLine(box))}
                  </div>
                </div>

                <small>
                  Изм.: {changedAt ? dtf.format(changedAt) : "-"}{changedBy ? ` - ${changedBy}` : ""}
                </small>

                <details className="yakno-edit-wrap">
                  <summary>Изменить</summary>
                  <form action={saveYaknoExcavatorAction} className="yakno-edit-menu">
                    <div className="quick-menu-head">
                      <strong>{shortExcavatorName(excavator.name)}</strong>
                      <CloseDetailsButton />
                    </div>
                    <input type="hidden" name="excavatorLocationId" value={excavator.id} />
                    <label>
                      Горизонт
                      <select name="horizonId" defaultValue={state?.horizonId ?? ""}>
                        <option value="">Не указан</option>
                        {activeHorizons.map((horizon) => (
                          <option key={horizon.id} value={horizon.id}>{horizon.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Запитанный ЯКНО
                      <select name="poweredBoxId" defaultValue={poweredBox?.id ?? ""}>
                        <option value="">Не запитан</option>
                        {selectableBoxes.map((box) => (
                          <option key={box.id} value={box.id}>{yaknoLabel(box.number)}</option>
                        ))}
                      </select>
                    </label>
                    <div className="yakno-checkbox-list">
                      <span>ЯКНО на этом горизонте</span>
                      {selectableBoxes.map((box) => (
                        <label key={box.id}>
                          <input
                            type="checkbox"
                            name="boxIds"
                            value={box.id}
                            defaultChecked={box.excavatorLocationId === excavator.id}
                          />
                          {yaknoLabel(box.number)}
                        </label>
                      ))}
                    </div>
                    <label>
                      Комментарий
                      <input name="comment" placeholder="Если нужно" maxLength={80} />
                    </label>
                    <button className="primary big" type="submit">Сохранить</button>
                  </form>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Свободные ЯКНО</h2>
        <div className="yakno-box-grid">
          {freeBoxes.length ? freeBoxes.map((box) => (
            <article className="yakno-box-card" key={box.id}>
              <strong>{yaknoLabel(box.number)}</strong>
              <span>{shortHorizonLabel(box.horizon?.name)}</span>
              <details className="yakno-edit-wrap">
                <summary>Горизонт</summary>
                <form action={saveFreeYaknoHorizonAction} className="yakno-edit-menu">
                  <div className="quick-menu-head">
                    <strong>{yaknoLabel(box.number)}</strong>
                    <CloseDetailsButton />
                  </div>
                  <input type="hidden" name="boxId" value={box.id} />
                  <label>
                    Горизонт
                    <select name="horizonId" defaultValue={box.horizonId ?? ""}>
                      <option value="">Не указан</option>
                      {activeHorizons.map((horizon) => (
                        <option key={horizon.id} value={horizon.id}>{horizon.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary big" type="submit">Сохранить</button>
                </form>
              </details>
            </article>
          )) : <p className="muted">Свободных ЯКНО нет.</p>}
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

      {canManageDictionaries ? (
        <section className="panel">
          <details className="history-details">
            <summary><span>Справочник ЯКНО</span></summary>
            <form action={saveYaknoBoxAction} className="form delete-location-picker">
              <label>
                Номер ЯКНО
                <input name="number" placeholder="Например: 122 или 14/1" required />
              </label>
              <button className="primary big" type="submit">Добавить ЯКНО</button>
            </form>

            <details className="location-delete-details">
              <summary>В ремонт / удалить</summary>
              <div className="yakno-admin-list">
                {usableBoxes.map((box) => (
                  <div className="yakno-admin-row" key={box.id}>
                    <b>{yaknoLabel(box.number)}</b>
                    <form action={repairYaknoBoxAction}>
                      <input type="hidden" name="boxId" value={box.id} />
                      <button type="submit">В ремонт</button>
                    </form>
                    {!box.excavatorLocationId ? (
                      <ConfirmSubmitForm action={deleteYaknoBoxAction} message="Удалить ЯКНО из справочника?">
                        <input type="hidden" name="boxId" value={box.id} />
                        <button className="danger" type="submit">Удалить</button>
                      </ConfirmSubmitForm>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          </details>
        </section>
      ) : null}

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
                <small>
                  {movement.fromHorizon ? shortHorizonLabel(movement.fromHorizon.name) : ""}
                  {movement.toHorizon ? ` -> ${shortHorizonLabel(movement.toHorizon.name)}` : ""}
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
    </section>
  );
}
