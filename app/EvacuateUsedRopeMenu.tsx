"use client";

import { useState } from "react";
import { evacuateUsedRopeAction } from "@/app/actions";
import { PendingButton } from "./PendingButton";

type Props = {
  stockId: number;
  availableQuantity: number;
};

export function EvacuateUsedRopeMenu({ stockId, availableQuantity }: Props) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);

  return (
    <div className="card-evacuate-wrap">
      <button className="card-evacuate-button" type="button" onClick={() => setOpen((value) => !value)}>
        Вывезти
      </button>
      {open ? (
        <form action={evacuateUsedRopeAction} className="card-evacuate-menu">
          <div className="quick-menu-head">
            <strong>Сколько вывезти</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          <input type="hidden" name="stockId" value={stockId} />
          <input type="hidden" name="quantity" value={quantity} />
          <div className="card-evacuate-stepper" aria-label="Количество вывозимых канатов">
            <button type="button" className="primary" onClick={() => setQuantity((value) => Math.min(availableQuantity, value + 1))} disabled={quantity >= availableQuantity}>+</button>
            <strong>{quantity} из {availableQuantity}</strong>
            <button type="button" className="quick-minus" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}>-</button>
          </div>
          <PendingButton className="danger" type="submit" pendingText="Вывозим...">Вывезти</PendingButton>
        </form>
      ) : null}
    </div>
  );
}
