"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { useState } from "react";
import { evacuateGroundToothAction, installGroundToothAction, loadGroundToToothBinAction } from "./operational-actions";
import { PendingButton } from "./PendingButton";
import { transferGroundTeethAction } from "./location-actions";
import { locationLabel } from "@/lib/labels";

type Props = {
  groundBinId: number;
  toothTypeId: number;
  condition: string;
  quantity: number;
  canInstall: boolean;
  bins: { id: number; name: string }[];
  locations: { id: number; name: string }[];
};

export function ToothGroundStockMenu({ groundBinId, toothTypeId, condition, quantity: available, canInstall, bins, locations }: Props) {
  const [open, setOpen] = useExclusiveMenu();
  const [action, setAction] = useState(canInstall && condition === "NEW" ? "INSTALL" : bins.length ? "LOAD" : locations.length ? "TRANSFER" : "EVACUATE");
  const [quantity, setQuantity] = useState(1);
  const formAction = action === "INSTALL" ? installGroundToothAction : action === "LOAD" ? loadGroundToToothBinAction : action === "TRANSFER" ? transferGroundTeethAction : evacuateGroundToothAction;

  return <div className="operation-menu-wrap ground-stock-actions">
    <button className="operation-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Действия</button>
    {<MenuPanel open={open}>{<form action={formAction} className="operation-menu">
      <div className="quick-menu-head"><strong>Что сделать</strong><button type="button" onClick={() => setOpen(false)}>Закрыть</button></div>
      <label>Действие<select value={action} onChange={(event) => setAction(event.target.value)}>
        {canInstall && condition === "NEW" ? <option value="INSTALL">Установить</option> : null}
        {bins.length ? <option value="LOAD">Загрузить в пену</option> : null}
        {locations.length ? <option value="TRANSFER">Переместить</option> : null}
        <option value="EVACUATE">Вывезти</option>
      </select></label>
      {action === "LOAD" ? <label>Пена<select name="targetBinId">{bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.name}</option>)}</select></label> : null}
      {action === "TRANSFER" ? <label>Куда<select name="toLocationId" required>{locations.map((place) => <option key={place.id} value={place.id}>{locationLabel(place.name)}</option>)}</select></label> : null}
      <input type="hidden" name="groundBinId" value={groundBinId} />
      <input type="hidden" name="toothTypeId" value={toothTypeId} />
      <input type="hidden" name="condition" value={condition} />
      <input type="hidden" name="quantity" value={quantity} />
      <div className="quantity-stepper"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}>−</button><strong>{quantity} из {available}</strong><button type="button" onClick={() => setQuantity((value) => Math.min(available, value + 1))} disabled={quantity >= available}>+</button></div>
      <PendingButton className={action === "EVACUATE" ? "danger" : "primary"} type="submit" pendingText="Сохраняю...">{action === "INSTALL" ? "Установить" : action === "LOAD" ? "Загрузить" : action === "TRANSFER" ? "Переместить" : "Вывезти"}</PendingButton>
    </form>}</MenuPanel>}
  </div>;
}
