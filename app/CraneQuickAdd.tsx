"use client";

import { useState } from "react";
import { addCraneTurntableStockAction, adjustCraneStockAction } from "@/app/actions";
import { ropeTypeLabel, ropeTypeSortValue, ropeTypeSpecs } from "@/lib/labels";
import { PendingButton } from "./PendingButton";

type RopeTypeOption = {
  id: number;
  name: string;
  standardLength: number;
  defaultDiameter?: string | null;
};

type TurntableOption = {
  id: number;
  name: string;
  currentLocationId?: number | null;
  location: string;
  load: number;
};

type Props = {
  label: string;
  items: string[];
  quantities: Record<number, number>;
  placement: "HANGERS" | "TURNTABLE" | "GROUND";
  locationId?: number;
  ropeTypes: RopeTypeOption[];
  turntables: TurntableOption[];
};

export function CraneQuickAdd({ label, items, quantities, placement, locationId, ropeTypes, turntables }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedTurntables, setSelectedTurntables] = useState<Record<number, string>>({});
  const [selectedQuantities, setSelectedQuantities] = useState<Record<number, number>>({});
  const placementText = placement === "TURNTABLE" ? "На Вертушку" : placement === "GROUND" ? "На землю" : "На Вешела";
  const quickTypes = ropeTypes
    .filter((type) => ropeTypeSpecs[type.name] || type.defaultDiameter)
    .sort((a, b) => ropeTypeSortValue(a.name) - ropeTypeSortValue(b.name));
  const availableTurntables = turntables.filter(
    (turntable) => turntable.load < 2 && (!turntable.currentLocationId || turntable.currentLocationId === locationId || turntable.load === 0)
  );
  const firstTurntableId = availableTurntables[0]?.id ? String(availableTurntables[0].id) : "";

  return (
    <div className="quick-add-wrap">
      <button className="metric metric-action" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="quick-place">{label}</span>
        <span className="quick-count">
          {items.length ? items.map((item) => <span key={item}>{item}</span>) : "Нет канатов"}
        </span>
        <small>Добавить канат</small>
      </button>
      {open ? (
        <div className="quick-menu">
          <div className="quick-menu-head">
            <strong>{placementText}</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {locationId ? (
            quickTypes.map((type) => {
              const spec = ropeTypeSpecs[type.name] ?? { length: type.standardLength, diameter: type.defaultDiameter ?? "" };
              const quantity = quantities[type.id] ?? 0;
              const selectedTurntableId = selectedTurntables[type.id] ?? firstTurntableId;
              const selectedQuantity = selectedQuantities[type.id] ?? 1;
              const selectedTurntable = availableTurntables.find((turntable) => String(turntable.id) === selectedTurntableId);
              const maxTurntableQuantity = Math.max(1, 2 - (selectedTurntable?.load ?? 0));
              return (
                <div className={`quick-row${placement === "TURNTABLE" ? " with-turntable" : ""}`} key={type.id}>
                  <span>{ropeTypeLabel(type.name)}</span>
                  <input type="number" inputMode="numeric" value={quantity} readOnly aria-label="Фактическое наличие" />
                  {placement === "TURNTABLE" ? (
                    <select
                      value={selectedTurntableId}
                      onChange={(event) => setSelectedTurntables((current) => ({ ...current, [type.id]: event.target.value }))}
                      aria-label="Вертушка"
                    >
                      {availableTurntables.map((turntable) => (
                        <option key={turntable.id} value={turntable.id}>
                          {turntable.name} ({turntable.load}/2, {turntable.location})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {placement === "TURNTABLE" ? (
                    <form action={addCraneTurntableStockAction} className="quick-turntable-move">
                      <input type="hidden" name="ropeTypeId" value={type.id} />
                      <input type="hidden" name="length" value={spec.length} />
                      <input type="hidden" name="diameter" value={spec.diameter} />
                      <input type="hidden" name="locationId" value={locationId} />
                      <input type="hidden" name="turntableId" value={selectedTurntableId} />
                      <input type="hidden" name="quantity" value={selectedQuantity} />
                      <div className="quick-horizontal-stepper">
                        <button
                          className="quick-minus"
                          type="button"
                          onClick={() => setSelectedQuantities((current) => ({ ...current, [type.id]: Math.max(1, selectedQuantity - 1) }))}
                          disabled={selectedQuantity <= 1}
                        >
                          -
                        </button>
                        <strong>{selectedQuantity}</strong>
                        <button
                          className="primary"
                          type="button"
                          onClick={() => setSelectedQuantities((current) => ({ ...current, [type.id]: Math.min(maxTurntableQuantity, selectedQuantity + 1) }))}
                          disabled={selectedQuantity >= maxTurntableQuantity}
                        >
                          +
                        </button>
                      </div>
                      <PendingButton className="quick-move-button" type="submit" disabled={!selectedTurntableId || maxTurntableQuantity < 1} pendingText="...">Переместить</PendingButton>
                    </form>
                  ) : (
                    <div className="quick-stepper">
                      <form action={adjustCraneStockAction}>
                        <input type="hidden" name="ropeTypeId" value={type.id} />
                        <input type="hidden" name="length" value={spec.length} />
                        <input type="hidden" name="diameter" value={spec.diameter} />
                        <input type="hidden" name="locationId" value={locationId} />
                        <input type="hidden" name="placement" value={placement} />
                        <input type="hidden" name="delta" value="1" />
                        <PendingButton className="primary" type="submit" pendingText="...">+</PendingButton>
                      </form>
                      <form action={adjustCraneStockAction}>
                        <input type="hidden" name="ropeTypeId" value={type.id} />
                        <input type="hidden" name="length" value={spec.length} />
                        <input type="hidden" name="diameter" value={spec.diameter} />
                        <input type="hidden" name="locationId" value={locationId} />
                        <input type="hidden" name="placement" value={placement} />
                        <input type="hidden" name="delta" value="-1" />
                        <PendingButton className="quick-minus" type="submit" disabled={quantity < 1} pendingText="...">-</PendingButton>
                      </form>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="muted">Место под 20т краном не найдено.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
