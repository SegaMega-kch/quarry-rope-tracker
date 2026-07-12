"use client";

import { useState } from "react";
import { moveRopeAction } from "@/app/actions";
import { compareLocations, locationLabel } from "@/lib/labels";

type LocationOption = {
  id: number;
  name: string;
  category?: string;
};

export function CardMoveMenu({ stockId, quantity, locations }: { stockId: number; quantity: number; locations: LocationOption[] }) {
  const [open, setOpen] = useState(false);
  const targetLocations = [...locations].sort(compareLocations);

  return (
    <div className="card-move-wrap">
      <button type="button" className="card-move-button" onClick={() => setOpen((value) => !value)} aria-label="Переместить канат" title="Переместить">
        ⇄
      </button>
      {open ? (
        <div className="card-move-menu">
          <div className="quick-menu-head">
            <strong>Куда переместить</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {targetLocations.map((location) => (
            <form action={moveRopeAction} key={location.id} className="card-move-row">
              <input type="hidden" name="stockId" value={stockId} />
              <input type="hidden" name="toLocationId" value={location.id} />
              <input type="hidden" name="comment" value="быстрое перемещение с карточки" />
              <input name="quantity" type="number" inputMode="numeric" min="1" max={quantity} defaultValue="1" aria-label={`Количество для ${locationLabel(location.name)}`} />
              <button type="submit">{locationLabel(location.name)}</button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
