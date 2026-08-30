"use client";

import { useExclusiveMenu, MenuPanel } from "./OperationMenus";
import { transferArchivedRopeAction } from "./location-actions";
import { PendingButton } from "./PendingButton";
import { locationLabel } from "@/lib/labels";

export function ArchivedGroundRopeMenu({ stockId, quantity, locations }: { stockId: number; quantity: number; locations: { id: number; name: string }[] }) {
  const [open, setOpen] = useExclusiveMenu();
  return <div className="operation-menu-wrap">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Переместить</button>
    <MenuPanel open={open}><form action={transferArchivedRopeAction} className="operation-menu">
      <input type="hidden" name="stockId" value={stockId} />
      <label>Куда<select name="toLocationId" required>{locations.map((place) => <option key={place.id} value={place.id}>{locationLabel(place.name)}</option>)}</select></label>
      <label>Количество, шт<input name="quantity" type="number" min="1" max={quantity} defaultValue="1" required /></label>
      <PendingButton type="submit" pendingText="Перемещаю...">Переместить</PendingButton>
    </form></MenuPanel>
  </div>;
}
