import { moveYaknoExcavatorAction, saveYaknoExcavatorAction } from "./actions";
import { CloseDetailsButton } from "./CloseDetailsButton";
import { ManagementForm } from "./Management";
import { locationLabel, shortHorizonLabel, yaknoLabel } from "@/lib/labels";

type Horizon = { id: number; name: string };
type Box = { id: number; number: string };
type Assembly = { id?: number; name?: string };

export function YaknoExcavatorMenus({
  excavator,
  horizonId,
  poweredBox,
  poweredAssemblies,
  horizons,
  freeBoxes
}: {
  excavator: { id: number; name: string };
  horizonId: number | null;
  poweredBox: Box | null;
  poweredAssemblies: Assembly[];
  horizons: Horizon[];
  freeBoxes: Box[];
}) {
  const excavatorName = locationLabel(excavator.name);
  const disconnected = [
    ...(poweredBox ? [yaknoLabel(poweredBox.number)] : []),
    ...poweredAssemblies.map((assembly) => assembly.name ?? `Сборка #${assembly.id}`)
  ];
  const moveMessage = (destination: string) =>
    `Перегнать ${excavatorName} на ${destination}?${disconnected.length ? ` Будут выпитаны: ${disconnected.join(", ")}.` : ""}`;

  return <div className="yakno-card-actions">
    <details className="yakno-edit-wrap yakno-excavator-menu">
      <summary>Изм. горизонт</summary>
      <div className="yakno-edit-menu">
        <div className="quick-menu-head">
          <strong>{excavatorName}: горизонт</strong>
          <CloseDetailsButton />
        </div>
        <div className="yakno-option-list">
          {horizons.map((horizon) => (
            <ManagementForm key={horizon.id} action={moveYaknoExcavatorAction} closeOnSuccess
              className="yakno-option-form" message={moveMessage(shortHorizonLabel(horizon.name))}>
              <input type="hidden" name="excavatorLocationId" value={excavator.id} />
              <input type="hidden" name="expectedHorizonId" value={horizonId ?? ""} />
              <input type="hidden" name="horizonId" value={horizon.id} />
              <button type="submit" disabled={horizon.id === horizonId}
                aria-label={`Перегнать ${excavatorName} на ${shortHorizonLabel(horizon.name)}`}>
                {shortHorizonLabel(horizon.name)}
              </button>
            </ManagementForm>
          ))}
          <ManagementForm action={moveYaknoExcavatorAction} closeOnSuccess className="yakno-option-form"
            message={moveMessage("положение «В перегоне»")}>
            <input type="hidden" name="excavatorLocationId" value={excavator.id} />
            <input type="hidden" name="expectedHorizonId" value={horizonId ?? ""} />
            <input type="hidden" name="horizonId" value="" />
            <button type="submit" disabled={horizonId === null} aria-label={`Отметить ${excavatorName}: в перегоне`}>В перегоне</button>
          </ManagementForm>
        </div>
      </div>
    </details>

    <details className="yakno-edit-wrap yakno-excavator-menu">
      <summary>ЯКНО</summary>
      <div className="yakno-edit-menu">
        <div className="quick-menu-head">
          <strong>{excavatorName}: ЯКНО</strong>
          <CloseDetailsButton />
        </div>
        {poweredBox ? (
          <div className="yakno-current-connection">
            <span>Запитано: <b>{yaknoLabel(poweredBox.number)}</b></span>
            <ManagementForm action={saveYaknoExcavatorAction} closeOnSuccess className="yakno-option-form">
              <input type="hidden" name="excavatorLocationId" value={excavator.id} />
              <input type="hidden" name="expectedPoweredBoxId" value={poweredBox.id} />
              <input type="hidden" name="expectedHorizonId" value={horizonId ?? ""} />
              <input type="hidden" name="poweredBoxId" value="" />
              <button type="submit" className="danger-soft"
                aria-label={`Выпитать ${yaknoLabel(poweredBox.number)} от ${excavatorName}`}>Выпитать</button>
            </ManagementForm>
          </div>
        ) : <p className="muted yakno-current-empty">ЭКГ не запитан</p>}
        <div className="yakno-option-list">
          {freeBoxes.length ? freeBoxes.map((box) => (
            <ManagementForm key={box.id} action={saveYaknoExcavatorAction} closeOnSuccess className="yakno-option-form">
              <input type="hidden" name="excavatorLocationId" value={excavator.id} />
              <input type="hidden" name="expectedPoweredBoxId" value={poweredBox?.id ?? ""} />
              <input type="hidden" name="expectedHorizonId" value={horizonId ?? ""} />
              <input type="hidden" name="poweredBoxId" value={box.id} />
              <button type="submit" aria-label={`Запитать ${excavatorName} от ${yaknoLabel(box.number)}`}>
                {yaknoLabel(box.number)}
              </button>
            </ManagementForm>
          )) : <p className="muted">Нет свободных ЯКНО</p>}
        </div>
      </div>
    </details>
  </div>;
}
