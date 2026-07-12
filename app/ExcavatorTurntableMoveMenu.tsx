"use client";

import { useState } from "react";
import { moveRopeAction } from "@/app/actions";
import { compareLocations, locationLabel } from "@/lib/labels";

type LocationOption = {
  id: number;
  name: string;
  category: string;
};

export function ExcavatorTurntableMoveMenu({
  stockId,
  quantity,
  currentLocationId,
  locations,
  alignRight = false
}: {
  stockId: number;
  quantity: number;
  currentLocationId: number;
  locations: LocationOption[];
  alignRight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const targetLocations = locations
    .filter((location) => location.id !== currentLocationId && (location.name === "Вешала под 30т краном" || location.category === "excavator" || location.category === "transfer_point"))
    .sort(compareLocations);

  return (
    <div className={`card-excavator-move-wrap${alignRight ? " single" : ""}`}>
      <button type="button" className="card-excavator-move-button" onClick={() => setOpen((value) => !value)} aria-label="Переместить канат" title="Переместить">
        ⇄
      </button>
      {open ? (
        <div className="card-excavator-move-menu">
          <div className="quick-menu-head">
            <strong>Куда переместить</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {targetLocations.map((location) => (
            <form action={moveRopeAction} className="card-load-row" key={location.id}>
              <input type="hidden" name="stockId" value={stockId} />
              <input type="hidden" name="toLocationId" value={location.id} />
              <input type="hidden" name="toPlacement" value="TURNTABLE" />
              <input type="hidden" name="comment" value="перемещен с вертушки у экскаватора" />
              <input name="quantity" type="number" inputMode="numeric" min="1" max={quantity} defaultValue="1" aria-label={`Количество для ${locationLabel(location.name)}`} />
              <button type="submit">{locationLabel(location.name)}</button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
