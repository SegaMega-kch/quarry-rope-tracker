"use client";

import { useState } from "react";
import { moveRopeAction } from "@/app/actions";

type TurntableOption = {
  id: number;
  name: string;
  location: string;
  load: number;
};

export function CardPlacementButton({
  stockId,
  quantity,
  locationId,
  placement,
  label,
  comment,
  turntables
}: {
  stockId: number;
  quantity: number;
  locationId: number;
  placement: "HANGERS" | "TURNTABLE" | "GROUND";
  label: string;
  comment: string;
  turntables: TurntableOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card-placement-wrap">
      <button type="button" className="card-placement-button" onClick={() => setOpen((value) => !value)}>
        {label}
      </button>
      {open ? (
        <form action={moveRopeAction} className="card-placement-menu">
          <div className="quick-menu-head">
            <strong>{label}</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          <input type="hidden" name="stockId" value={stockId} />
          <input type="hidden" name="toLocationId" value={locationId} />
          <input type="hidden" name="toPlacement" value={placement} />
          <input type="hidden" name="comment" value={comment} />
          {placement === "TURNTABLE" ? (
            <label>
              Вертушка
              <select name="turntableId" required>
                {turntables.map((turntable) => (
                  <option key={turntable.id} value={turntable.id}>
                    {turntable.name} ({turntable.load}/2)
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Количество
            <input name="quantity" type="number" inputMode="numeric" min="1" max={quantity} defaultValue="1" required />
          </label>
          <button className="primary" type="submit">Переместить</button>
        </form>
      ) : null}
    </div>
  );
}
