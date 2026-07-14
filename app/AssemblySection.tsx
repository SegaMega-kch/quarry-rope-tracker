import {
  deleteAssemblyHorizonAction,
  moveAssemblyAction,
  powerAssemblyAction,
  restoreAssemblyFromRepairAction,
  saveAssemblyAction,
  saveAssemblyHorizonAction,
  undoAssemblyMovementAction,
  unpowerAssemblyAction,
  updateAssemblyLengthAction
} from "@/app/actions";
import { assemblyActionLabels, locationLabel } from "@/lib/labels";
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

type AssemblyView = {
  id: number;
  name: string;
  horizonId: number | null;
  status: string;
  isPowered: boolean;
  excavatorLocationId: number | null;
  length: number | null;
  comment: string | null;
  lastChangedAt: Date;
  lastChangedBy: string | null;
  horizon: HorizonView | null;
  excavatorLocation: LocationView | null;
};

type AssemblyMovementView = {
  id: number;
  createdAt: Date;
  userId: number;
  action: string;
  fromPlaceText: string | null;
  toPlaceText: string | null;
  oldLength: number | null;
  newLength: number | null;
  comment: string | null;
  user: { login: string };
  assembly: { name: string };
};

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

function assemblyPlace(assembly: AssemblyView) {
  if (assembly.status === "REPAIR") return "Ремонт";
  return assembly.horizon?.name ?? "Горизонт не указан";
}

function assemblyStatus(assembly: AssemblyView) {
  if (assembly.status === "REPAIR") return "В ремонте";
  if (assembly.isPowered) return `Запитана: ${locationLabel(assembly.excavatorLocation?.name)}`;
  return "Не запитана";
}

function shortHorizonName(name: string) {
  return name.replace("Горизонт ", "");
}

function shortAssemblyComment(comment: string | null) {
  if (!comment) return "";
  return comment.length > 20 ? `${comment.slice(0, 20)}...` : comment;
}

export function AssemblySection({
  assemblies,
  horizons,
  excavators,
  movements,
  currentUserId,
  canManageDictionaries,
  historyOpen
}: {
  assemblies: AssemblyView[];
  horizons: HorizonView[];
  excavators: LocationView[];
  movements: AssemblyMovementView[];
  currentUserId: number;
  canManageDictionaries: boolean;
  historyOpen: boolean;
}) {
  const activeHorizons = [...horizons].sort((a, b) => a.sortOrder - b.sortOrder);
  const recentUndoIds = new Set(
    movements
      .filter((movement) => movement.userId === currentUserId && ["MOVE", "LENGTH"].includes(movement.action))
      .slice(0, 3)
      .map((movement) => movement.id)
  );

  return (
    <section className="assembly-section">
      <section className="panel">
        <h2>Сборки</h2>
        <div className="assembly-grid">
          {assemblies.map((assembly) => {
            const inRepair = assembly.status === "REPAIR";
            const canMove = !assembly.isPowered && !inRepair;
            const canPower = !assembly.isPowered && !inRepair && Boolean(assembly.horizonId);
            return (
              <article className={inRepair ? "assembly-card in-repair" : "assembly-card"} key={assembly.id}>
                <div className="assembly-card-head">
                  <div>
                    <h3>{assembly.name}</h3>
                    <strong>{assemblyPlace(assembly)}</strong>
                  </div>
                  <span>{assembly.length ? `${assembly.length} м` : "длина ?"}</span>
                </div>
                <p className={assembly.isPowered ? "assembly-powered active" : "assembly-powered"}>{assemblyStatus(assembly)}</p>
                {assembly.comment ? <p className="assembly-comment" title={assembly.comment}>{shortAssemblyComment(assembly.comment)}</p> : null}
                <small>Изм.: {dtf.format(assembly.lastChangedAt)}{assembly.lastChangedBy ? ` - ${assembly.lastChangedBy}` : ""}</small>

                <div className="assembly-actions">
                  {inRepair ? (
                    <form action={restoreAssemblyFromRepairAction}>
                      <input type="hidden" name="assemblyId" value={assembly.id} />
                      <button className="assembly-icon-button" type="submit" title="Вернуть из ремонта">🔧</button>
                    </form>
                  ) : null}

                  <details className="assembly-menu-wrap">
                    <summary className="assembly-action-button" aria-disabled={!canMove}>Перенести</summary>
                    {canMove ? (
                      <div className="assembly-menu">
                        <div className="quick-menu-head">
                          <strong>Куда перенести</strong>
                          <CloseDetailsButton />
                        </div>
                        {activeHorizons
                          .filter((horizon) => horizon.id !== assembly.horizonId)
                          .map((horizon) => (
                            <form action={moveAssemblyAction} className="turntable-move-row" key={horizon.id}>
                              <input type="hidden" name="assemblyId" value={assembly.id} />
                              <input type="hidden" name="target" value={horizon.id} />
                              <button type="submit">{shortHorizonName(horizon.name)}</button>
                            </form>
                          ))}
                        <form action={moveAssemblyAction} className="turntable-move-row">
                          <input type="hidden" name="assemblyId" value={assembly.id} />
                          <input type="hidden" name="target" value="repair" />
                          <button type="submit">Ремонт</button>
                        </form>
                      </div>
                    ) : null}
                  </details>

                  {assembly.isPowered ? (
                    <ConfirmSubmitForm action={unpowerAssemblyAction} message="Отключить экскаватор от сборки?">
                      <input type="hidden" name="assemblyId" value={assembly.id} />
                      <button className="assembly-action-button" type="submit">Отключить</button>
                    </ConfirmSubmitForm>
                  ) : (
                    <details className="assembly-menu-wrap">
                      <summary className="assembly-action-button power" aria-disabled={!canPower}>Запитать</summary>
                      {canPower ? (
                        <div className="assembly-menu">
                          <div className="quick-menu-head">
                            <strong>Экскаватор</strong>
                            <CloseDetailsButton />
                          </div>
                          {excavators.map((excavator) => (
                            <form action={powerAssemblyAction} className="turntable-move-row" key={excavator.id}>
                              <input type="hidden" name="assemblyId" value={assembly.id} />
                              <input type="hidden" name="excavatorLocationId" value={excavator.id} />
                              <button type="submit">{locationLabel(excavator.name)}</button>
                            </form>
                          ))}
                        </div>
                      ) : null}
                    </details>
                  )}

                  <details className="assembly-menu-wrap length">
                    <summary className="assembly-icon-button" title="Изменить длину">↔</summary>
                    <form action={updateAssemblyLengthAction} className="assembly-length-menu">
                      <div className="quick-menu-head">
                        <strong>Длина</strong>
                        <CloseDetailsButton />
                      </div>
                      <input type="hidden" name="assemblyId" value={assembly.id} />
                      <label>
                        Метров
                        <input name="length" type="number" min="1" defaultValue={assembly.length ?? ""} placeholder="Неизвестно" />
                      </label>
                      <label>
                        Комментарий
                        <input name="comment" placeholder="Если нужно" />
                      </label>
                      <button className="primary" type="submit">Сохранить</button>
                    </form>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {canManageDictionaries ? (
        <section className="panel">
          <details className="history-details">
            <summary><span>Добавить сборку</span></summary>
            <form action={saveAssemblyAction} className="form delete-location-picker">
              <label>
                Название
                <input name="name" placeholder="Например: Сборка №6" required />
              </label>
              <label>
                Горизонт
                <select name="horizonId" defaultValue="">
                  <option value="">Не указан</option>
                  {activeHorizons.map((horizon) => (
                    <option key={horizon.id} value={horizon.id}>{horizon.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Длина, метров
                <input name="length" type="number" min="1" placeholder="Неизвестно" />
              </label>
              <label>
                Комментарий
                <input name="comment" maxLength={80} placeholder="Если нужно" />
              </label>
              <button className="primary big" type="submit">Добавить сборку</button>
            </form>
          </details>

          <details className="history-details">
            <summary><span>Справочник горизонтов</span></summary>
            <form action={saveAssemblyHorizonAction} className="form delete-location-picker">
              <label>
                Горизонт
                <input name="value" placeholder="Например: +415 или -65" required />
              </label>
              <button className="primary big" type="submit">Добавить горизонт</button>
            </form>
            <details className="location-delete-details">
              <summary>Удалить горизонт</summary>
              <ConfirmSubmitForm action={deleteAssemblyHorizonAction} className="form delete-location-picker" message="Удалить выбранный горизонт?">
                <label>
                  Горизонт
                  <select name="id" required>
                    {activeHorizons.map((horizon) => (
                      <option key={horizon.id} value={horizon.id}>{horizon.name}</option>
                    ))}
                  </select>
                </label>
                <p className="danger-note">Удалить можно только пустой горизонт.</p>
                <button className="danger big" type="submit">Удалить горизонт</button>
              </ConfirmSubmitForm>
            </details>
          </details>
        </section>
      ) : null}

      <section className="panel">
        <LazyDetails label="История сборок" queryKey="history" open={historyOpen}>
          <div className="timeline">
            {movements.map((movement) => (
              <article key={movement.id}>
                <b>{assemblyActionLabels[movement.action] ?? movement.action}</b>
                <span>{dtf.format(movement.createdAt)} - {movement.user.login}</span>
                <p>{movement.assembly.name}</p>
                <small>
                  {movement.action === "LENGTH"
                    ? `${movement.oldLength ?? "?"} м -> ${movement.newLength ?? "?"} м`
                    : `${movement.fromPlaceText || "-"} -> ${movement.toPlaceText || "-"}`}
                  {movement.comment ? `; ${movement.comment}` : ""}
                </small>
                {recentUndoIds.has(movement.id) ? (
                  <form action={undoAssemblyMovementAction} className="undo-form">
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
