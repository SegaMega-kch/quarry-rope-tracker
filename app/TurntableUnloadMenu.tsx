"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { useState } from "react";
import { unloadTurntableRopeAction } from "./operational-actions";
import { PendingButton } from "./PendingButton";
import { RopeStockSelect } from "./RopeStockSelect";

type Stock = { id: number; label: string; length: number; diameter: string; quantity: number };
type Location = { id: number; name: string };

export function TurntableUnloadMenu({ stocks, currentLocationId, craneLocationId, locations }: {
  stocks: Stock[];
  currentLocationId: number | null;
  craneLocationId: number | null;
  locations: Location[];
}) {
  const [open, setOpen] = useExclusiveMenu();
  const [stockId, setStockId] = useState(stocks[0]?.id ?? 0);
  const [quantity, setQuantity] = useState(1);
  const [destination, setDestination] = useState("CRANE_HANGERS");
  const stock = stocks.find((item) => item.id === stockId) ?? stocks[0];
  const currentLocation = locations.find((item) => item.id === currentLocationId);
  const toLocationId = destination === "HERE" ? currentLocationId : craneLocationId;
  const toPlacement = destination === "CRANE_HANGERS" ? "HANGERS" : "GROUND";

  return (
    <div className="operation-menu-wrap">
      <button className="operation-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} disabled={!stocks.length}>Разгрузить</button>
      {stock ? <MenuPanel open={open}>{(
        <form action={unloadTurntableRopeAction} className="operation-menu">
          <div className="quick-menu-head"><strong>Разгрузить канат</strong><button type="button" onClick={() => setOpen(false)}>Закрыть</button></div>
          <RopeStockSelect stocks={stocks} value={stock.id} onChange={(id) => { setStockId(id); setQuantity(1); }} />
          <label>Куда<select value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="CRANE_HANGERS">На вешала под 20т краном</option>
            <option value="CRANE_GROUND">На землю под 20т краном</option>
            {currentLocationId && currentLocationId !== craneLocationId ? <option value="HERE">На землю здесь: {currentLocation?.name}</option> : null}
          </select></label>
          <input type="hidden" name="stockId" value={stock.id} />
          <input type="hidden" name="quantity" value={quantity} />
          <input type="hidden" name="toLocationId" value={toLocationId ?? ""} />
          <input type="hidden" name="toPlacement" value={toPlacement} />
          <div className="quantity-stepper"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}>−</button><strong>{quantity} из {stock.quantity}</strong><button type="button" onClick={() => setQuantity((value) => Math.min(stock.quantity, value + 1))} disabled={quantity >= stock.quantity}>+</button></div>
          <PendingButton className="primary" type="submit" pendingText="Разгружаю...">Разгрузить</PendingButton>
        </form>
      )}</MenuPanel> : null}
    </div>
  );
}
