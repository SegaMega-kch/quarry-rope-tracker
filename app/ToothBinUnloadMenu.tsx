"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { useState } from "react";
import { unloadToothToGroundAction } from "./operational-actions";
import { PendingButton } from "./PendingButton";

type Stock = { id: number; toothTypeId: number; condition: string; quantity: number; toothType: { name: string } };

export function ToothBinUnloadMenu({ binId, stocks, atCrane, disabled }: { binId: number; stocks: Stock[]; atCrane: boolean; disabled?: boolean }) {
  const [open, setOpen] = useExclusiveMenu();
  const [stockId, setStockId] = useState(stocks[0]?.id ?? 0);
  const [quantity, setQuantity] = useState(1);
  const stock = stocks.find((item) => item.id === stockId) ?? stocks[0];
  const scrap = atCrane && stock?.condition === "USED";
  return <div className="operation-menu-wrap">
    <button className="tooth-action-button" type="button" disabled={disabled || !stocks.length} aria-expanded={open} onClick={() => setOpen((value) => !value)}>Разгрузить тут</button>
    {stock ? <MenuPanel open={open}>{<form action={unloadToothToGroundAction} className="operation-menu">
      <div className="quick-menu-head"><strong>{scrap ? "Разгрузить в лом" : "Разгрузить на землю"}</strong><button type="button" onClick={() => setOpen(false)}>Закрыть</button></div>
      <label>Зубья<select value={stockId} onChange={(event) => { setStockId(Number(event.target.value)); setQuantity(1); }}>{stocks.map((item) => <option key={item.id} value={item.id}>{item.toothType.name.replace("Зуб ", "")} · {item.condition === "NEW" ? "Новые" : "Б/У"} · {item.quantity}</option>)}</select></label>
      <input type="hidden" name="binId" value={binId} /><input type="hidden" name="toothTypeId" value={stock.toothTypeId} /><input type="hidden" name="condition" value={stock.condition} /><input type="hidden" name="quantity" value={quantity} />
      <div className="quantity-stepper"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}>−</button><strong>{quantity} из {stock.quantity}</strong><button type="button" onClick={() => setQuantity((value) => Math.min(stock.quantity, value + 1))} disabled={quantity >= stock.quantity}>+</button></div>
      <PendingButton className={scrap ? "danger" : "primary"} type="submit" pendingText="Разгружаю...">{scrap ? "Разгрузить и списать" : "Разгрузить"}</PendingButton>
    </form>}</MenuPanel> : null}
  </div>;
}
