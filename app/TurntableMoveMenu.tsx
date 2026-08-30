"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { moveTurntableAction } from "@/app/actions";
import { compareLocations, locationLabel } from "@/lib/labels";
import { PendingButton } from "./PendingButton";

type LocationOption = {
  id: number;
  name: string;
  category: string;
};

type Props = {
  turntableId: number;
  currentLocationId?: number | null;
  load: number;
  locations: LocationOption[];
};

export function TurntableMoveMenu({ turntableId, currentLocationId, load, locations }: Props) {
  const [open, setOpen] = useExclusiveMenu();
  const targetLocations = locations
    .filter((location) => location.id !== currentLocationId)
    .sort(compareLocations);

  return (
    <div className="turntable-move-wrap">
      <button className="turntable-move-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Переместить
      </button>
      {<MenuPanel open={open}>{(
        <div className="turntable-move-menu">
          <div className="quick-menu-head">
            <strong>Куда переместить</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {targetLocations.map((location) => (
            <form action={moveTurntableAction} key={location.id} className="turntable-move-row">
              <input type="hidden" name="turntableId" value={turntableId} />
              <input type="hidden" name="toLocationId" value={location.id} />
              <input type="hidden" name="comment" value={load > 0 ? "перемещена загруженная вертушка" : "перемещена пустая вертушка"} />
              <PendingButton type="submit" pendingText="Перемещаю...">{locationLabel(location.name)}</PendingButton>
            </form>
          ))}
        </div>
      )}</MenuPanel>}
    </div>
  );
}
