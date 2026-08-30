"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { useState } from "react";
import { createRopeLoanAction } from "./operational-actions";
import { PendingButton } from "./PendingButton";
import { RopeStockSelect } from "./RopeStockSelect";

type Stock = { id: number; label: string; length: number; diameter: string; quantity: number; turntableId: number | null };

export function RopeLoanMenu({ stocks }: { stocks: Stock[] }) {
  const [open, setOpen] = useExclusiveMenu();
  const [stockId, setStockId] = useState(stocks[0]?.id ?? 0);
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState("ROPE");
  const stock = stocks.find((item) => item.id === stockId) ?? stocks[0];
  const withTurntable = mode === "TURNTABLE";

  return (
    <div className="operation-menu-wrap">
      <button className="operation-button loan-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} disabled={!stocks.length}>В долг</button>
      {stock ? <MenuPanel open={open}>{(
        <form action={createRopeLoanAction} className="operation-menu">
          <div className="quick-menu-head"><strong>Выдать в долг</strong><button type="button" onClick={() => setOpen(false)}>Закрыть</button></div>
          <RopeStockSelect stocks={stocks} value={stock.id} onChange={(id) => { setStockId(id); setQuantity(1); setMode("ROPE"); }} />
          <fieldset className="segmented-control"><legend>Что отдать</legend><label><input type="radio" name="mode" value="ROPE" checked={!withTurntable} onChange={() => setMode("ROPE")} /><span>Только канат</span></label><label className={!stock.turntableId ? "disabled" : ""}><input type="radio" name="mode" value="TURNTABLE" checked={withTurntable} disabled={!stock.turntableId} onChange={() => setMode("TURNTABLE")} /><span>С вертушкой</span></label></fieldset>
          <label>Кому<select name="recipient" defaultValue=""><option value="">Не указано</option><option>Западный</option><option>Северный</option><option>СКМ</option><option>Отвал</option></select></label>
          <input type="hidden" name="stockId" value={stock.id} />
          <input type="hidden" name="quantity" value={withTurntable ? stock.quantity : quantity} />
          {!withTurntable ? <div className="quantity-stepper"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}>−</button><strong>{quantity} из {stock.quantity}</strong><button type="button" onClick={() => setQuantity((value) => Math.min(stock.quantity, value + 1))} disabled={quantity >= stock.quantity}>+</button></div> : <p className="menu-note">Уйдёт вертушка со всеми канатами на ней.</p>}
          <PendingButton className="primary" type="submit" pendingText="Сохраняю...">Выдать</PendingButton>
        </form>
      )}</MenuPanel> : null}
    </div>
  );
}
