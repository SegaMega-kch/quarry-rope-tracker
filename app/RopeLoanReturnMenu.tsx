"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { returnRopeLoanAction } from "./operational-actions";
import { PendingButton } from "./PendingButton";

export function RopeLoanReturnMenu({ loanId, includesTurntable, locations, craneLocationId }: {
  loanId: number;
  includesTurntable: boolean;
  locations: { id: number; name: string }[];
  craneLocationId: number | null;
}) {
  const [open, setOpen] = useExclusiveMenu();
  return <div className="operation-menu-wrap">
    <button className="operation-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Вернуть</button>
    {<MenuPanel open={open}>{<form action={returnRopeLoanAction} className="operation-menu loan-return-menu">
      <div className="quick-menu-head"><strong>Куда вернуть</strong><button type="button" onClick={() => setOpen(false)}>Закрыть</button></div>
      <input type="hidden" name="loanId" value={loanId} />
      <label>Место<select name="toLocationId" defaultValue={craneLocationId ?? locations[0]?.id}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      {!includesTurntable ? <label>Размещение<select name="toPlacement"><option value="HANGERS">На вешала под 20т краном</option><option value="GROUND">На землю</option></select></label> : <input type="hidden" name="toPlacement" value="TURNTABLE" />}
      <PendingButton className="primary" type="submit" pendingText="Возвращаю...">Вернуть</PendingButton>
    </form>}</MenuPanel>}
  </div>;
}
