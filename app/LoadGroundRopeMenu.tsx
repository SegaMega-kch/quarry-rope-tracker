"use client";

import { useState } from "react";
import { moveRopeAction } from "@/app/actions";

type TurntableOption = {
  id: number;
  name: string;
  location: string;
  load: number;
};

export function LoadGroundRopeMenu({
  stockId,
  quantity,
  craneLocationId,
  turntables
}: {
  stockId: number;
  quantity: number;
  craneLocationId: number;
  turntables: TurntableOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card-load-wrap">
      <button type="button" className="card-load-button" onClick={() => setOpen((value) => !value)}>
        Погрузить
      </button>
      {open ? (
        <div className="card-load-menu">
          <div className="quick-menu-head">
            <strong>Куда погрузить</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          <form action={moveRopeAction} className="card-load-row with-turntable">
            <input type="hidden" name="stockId" value={stockId} />
            <input type="hidden" name="toLocationId" value={craneLocationId} />
            <input type="hidden" name="toPlacement" value="HANGERS" />
            <input type="hidden" name="comment" value="погружен на вешела под 20т краном" />
            <input name="quantity" type="number" inputMode="numeric" min="1" max={quantity} defaultValue="1" aria-label="Количество на вешела" />
            <button type="submit">На вешела под 20т краном</button>
          </form>
          <form action={moveRopeAction} className="card-load-row">
            <input type="hidden" name="stockId" value={stockId} />
            <input type="hidden" name="toLocationId" value={craneLocationId} />
            <input type="hidden" name="toPlacement" value="TURNTABLE" />
            <input type="hidden" name="comment" value="погружен на вертушку под 20т краном" />
            <input name="quantity" type="number" inputMode="numeric" min="1" max={quantity} defaultValue="1" aria-label="Количество на вертушку" />
            <select name="turntableId" required aria-label="Вертушка">
              {turntables.map((turntable) => (
                <option key={turntable.id} value={turntable.id}>
                  {turntable.name} ({turntable.load}/2)
                </option>
              ))}
            </select>
            <button type="submit">На вертушку под 20т краном</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
