import {
  deleteAssemblyHorizonAction,
  moveAssemblyAction,
  restoreAssemblyFromRepairAction,
  saveAssemblyAction,
  saveAssemblyHorizonAction,
  undoAssemblyMovementAction,
  unpowerAssemblyAction,
  updateAssemblyLengthAction
} from "@/app/actions";
import { assemblyActionLabels, locationLabel, shortHorizonLabel } from "@/lib/labels";
import { MoveHorizontal, Wrench } from "lucide-react";
import { AssemblyPowerForm } from "./PowerForms";
import { CloseDetailsButton } from "./CloseDetailsButton";
import { LazyDetails } from "./LazyDetails";
import { ManagementDialog, ManagementForm, ManagementSection } from "./Management";

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
  fromHorizon: { name: string } | null;
  toHorizon: { name: string } | null;
};

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

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
  historyOpen,
  undoAfter
}: {
  assemblies: AssemblyView[];
  horizons: HorizonView[];
  excavators: Array<LocationView & { horizonId: number | null }>;
  movements: AssemblyMovementView[];
  currentUserId: number;
  canManageDictionaries: boolean;
  historyOpen: boolean;
  undoAfter?: Date;
}) {
  const activeHorizons = [...horizons].sort((a, b) => a.sortOrder - b.sortOrder);
  const recentUndoIds = new Set(
    movements
      .filter((movement) => movement.userId === currentUserId && (!undoAfter || movement.createdAt > undoAfter) && ["MOVE", "LENGTH"].includes(movement.action))
      .slice(0, 3)
      .map((movement) => movement.id)
  );

  return (
    <section className="assembly-section">
      {[true, false].map((powered) => <section className="panel" key={String(powered)}>
        <h2>{powered ? "Запитанные сборки" : "Незапитанные сборки"}</h2>
        <div className="assembly-grid">
          {assemblies.filter((assembly) => assembly.isPowered === powered).map((assembly) => {
            const inRepair = assembly.status === "REPAIR";
            const canMove = !assembly.isPowered && !inRepair;
            const canPower = !assembly.isPowered && !inRepair;
            return (
              <article className={`assembly-card${powered ? " cargo-loaded" : " cargo-empty"}${inRepair ? " in-repair" : ""}`} key={assembly.id}>
                <div className="assembly-card-head">
                  <div>
                    <h3>{powered ? locationLabel(assembly.excavatorLocation?.name) || "Экскаватор не указан" : assembly.name}</h3>
                    <p className="assembly-horizon">{shortHorizonLabel(assembly.horizon?.name)}</p>
                  </div>
                </div>
                <p className="assembly-meta">{powered ? `${assembly.name} · ` : ""}{assembly.length ? `${assembly.length} м` : "Длина не указана"}{inRepair ? " · В ремонте" : ""}</p>
                {assembly.comment ? <p className="assembly-comment" title={assembly.comment}>{shortAssemblyComment(assembly.comment)}</p> : null}
                <small>Изм.: {dtf.format(assembly.lastChangedAt)}{assembly.lastChangedBy ? ` - ${assembly.lastChangedBy}` : ""}</small>

                <div className="assembly-actions">
                  {inRepair ? (
                    <form action={restoreAssemblyFromRepairAction}>
                      <input type="hidden" name="assemblyId" value={assembly.id} />
                      <button className="assembly-icon-button" type="submit" title="Вернуть из ремонта" aria-label="Вернуть из ремонта"><Wrench size={20} /></button>
                    </form>
                  ) : null}

                  <details className="assembly-menu-wrap" hidden={inRepair}>
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
                    <ManagementForm action={unpowerAssemblyAction} className="assembly-disconnect" message="Отключить экскаватор от сборки?">
                      <input type="hidden" name="assemblyId" value={assembly.id} />
                      <input type="hidden" name="expectedExcavatorId" value={assembly.excavatorLocationId ?? ""} />
                      <button className="assembly-action-button" type="submit">Отключить</button>
                    </ManagementForm>
                  ) : (
                    <details className="assembly-menu-wrap" hidden={inRepair}>
                      <summary className="assembly-action-button power" aria-disabled={!canPower}>Запитать</summary>
                      {canPower ? (
                        <div className="assembly-menu">
                          <div className="quick-menu-head">
                            <strong>Экскаватор</strong>
                            <CloseDetailsButton />
                          </div>
                          <AssemblyPowerForm assemblyId={assembly.id} horizonId={assembly.horizonId} excavators={excavators} horizons={activeHorizons} />
                        </div>
                      ) : null}
                    </details>
                  )}

                  <details className="assembly-menu-wrap length">
                    <summary className="assembly-icon-button" title="Изменить длину" aria-label="Изменить длину"><MoveHorizontal size={20} /></summary>
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
        {!assemblies.some((assembly) => assembly.isPowered === powered) ? <p className="muted">{powered ? "Запитанных сборок нет." : "Незапитанных сборок нет."}</p> : null}
      </section>)}


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
                  {movement.comment && movement.action !== "POWER" ? `; ${movement.comment}` : ""}
                  {movement.action === "POWER" && movement.fromHorizon?.name !== movement.toHorizon?.name ? `; ${shortHorizonLabel(movement.fromHorizon?.name)} → ${shortHorizonLabel(movement.toHorizon?.name)}` : ""}
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
      {canManageDictionaries ? (
        <ManagementSection>
          <ManagementDialog title="Добавить сборку" kind="add">
            <ManagementForm action={saveAssemblyAction}>
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
            </ManagementForm>
          </ManagementDialog>

          <ManagementDialog title="Добавить горизонт" kind="add">
            <ManagementForm action={saveAssemblyHorizonAction}>
              <label>
                Горизонт
                <input name="value" placeholder="Например: +415 или -65" required />
              </label>
              <button className="primary big" type="submit">Добавить горизонт</button>
            </ManagementForm>
          </ManagementDialog>
          <ManagementDialog title="Удалить горизонт" kind="delete">
              <ManagementForm action={deleteAssemblyHorizonAction} message="Удалить выбранный горизонт?">
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
              </ManagementForm>
          </ManagementDialog>
        </ManagementSection>
      ) : null}
    </section>
  );
}
