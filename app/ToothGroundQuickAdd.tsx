"use client";

import { useActionState, useState } from "react";
import { adjustToothGroundStockFormAction } from "@/app/actions";
import { PendingButton } from "./PendingButton";

type ToothTypeOption = {
  id: number;
  name: string;
};

type GroundItem = {
  type: ToothTypeOption;
  quantity: number;
};

type Props = {
  items: GroundItem[];
  toothTypes: ToothTypeOption[];
};

function shortToothName(name: string) {
  return name.replace("Зуб ", "");
}

export function ToothGroundQuickAdd({ items, toothTypes }: Props) {
  const [open, setOpen] = useState(false);
  const [adjustState, adjustAction] = useActionState(adjustToothGroundStockFormAction, { error: null });
  const quantities = new Map(items.map((item) => [item.type.id, item.quantity]));

  return (
    <div className="quick-add-wrap tooth-ground-add">
      <button className="metric metric-action" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="quick-place">На земле</span>
        <span className="quick-count">
          {items.length ? items.map((item) => <span key={item.type.id}>{shortToothName(item.type.name)} - {item.quantity}</span>) : "Нет зубьев"}
        </span>
        <small>Добавить зуб</small>
      </button>
      {open ? (
        <div className="quick-menu">
          <div className="quick-menu-head">
            <strong>На земле</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {toothTypes.map((type) => {
            const quantity = quantities.get(type.id) ?? 0;
            return (
              <div className="quick-row" key={type.id}>
                <span>{shortToothName(type.name)}</span>
                <input type="number" inputMode="numeric" value={quantity} readOnly aria-label="Фактическое наличие" />
                <div className="quick-stepper">
                  <form action={adjustAction}>
                    <input type="hidden" name="toothTypeId" value={type.id} />
                    <input type="hidden" name="delta" value="1" />
                    <PendingButton className="primary" type="submit" pendingText="...">+</PendingButton>
                  </form>
                  <form action={adjustAction}>
                    <input type="hidden" name="toothTypeId" value={type.id} />
                    <input type="hidden" name="delta" value="-1" />
                    <PendingButton className="quick-minus" type="submit" disabled={quantity < 1} pendingText="...">-</PendingButton>
                  </form>
                </div>
              </div>
            );
          })}
          {adjustState.error ? <p className="form-error" role="alert">{adjustState.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
