"use client";

import { useState } from "react";
import { moveToothBinAction } from "@/app/actions";
import { locationLabel } from "@/lib/labels";

type LocationOption = {
  id: number;
  name: string;
  category: string;
};

type Props = {
  binId: number;
  locations: LocationOption[];
};

function toothLocationLabel(name: string) {
  return name === "Вешала под 30т краном" ? "30т кран" : locationLabel(name);
}

export function ToothBinMoveMenu({ binId, locations }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="turntable-move-wrap tooth-bin-move-wrap">
      <button className="tooth-action-button" type="button" onClick={() => setOpen((value) => !value)}>
        Переместить
      </button>
      {open ? (
        <div className="turntable-move-menu tooth-bin-move-menu">
          <div className="quick-menu-head">
            <strong>Куда переместить</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {locations.map((location) => (
            <form action={moveToothBinAction} className="turntable-move-row" key={location.id}>
              <input type="hidden" name="binId" value={binId} />
              <input type="hidden" name="locationId" value={location.id} />
              <input type="hidden" name="comment" value="перемещение пены" />
              <button type="submit">{toothLocationLabel(location.name)}</button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
