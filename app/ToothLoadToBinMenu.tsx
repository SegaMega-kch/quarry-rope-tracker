"use client";

import { useState } from "react";
import { loadToothBinFromGroundAction } from "@/app/actions";

type GroundItem = {
  type: {
    id: number;
    name: string;
  };
  quantity: number;
};

type Props = {
  binId: number;
  items: GroundItem[];
};

export function ToothLoadToBinMenu({ binId, items }: Props) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  return (
    <div className="turntable-add-wrap tooth-load-wrap">
      <button className="tooth-action-button" type="button" onClick={() => setOpen((value) => !value)}>
        Добавить зубья
      </button>
      {open ? (
        <div className="turntable-add-menu tooth-load-popup">
          <div className="quick-menu-head">
            <strong>Добавить зубья</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {items.length ? items.map((item) => {
            const selectedQuantity = Math.min(item.quantity, quantities[item.type.id] ?? 1);
            return (
              <form action={loadToothBinFromGroundAction} className="turntable-add-row tooth-load-add-row" key={item.type.id}>
                <input type="hidden" name="binId" value={binId} />
                <input type="hidden" name="toothTypeId" value={item.type.id} />
                <input type="hidden" name="quantity" value={selectedQuantity} />
                <div>
                  <b>{item.type.name.replace("Зуб ", "")}</b>
                  <span>На земле: {item.quantity} шт</span>
                </div>
                <div className="turntable-add-stepper" aria-label="Количество">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setQuantities((current) => ({ ...current, [item.type.id]: Math.min(item.quantity, selectedQuantity + 1) }))}
                    disabled={selectedQuantity >= item.quantity}
                  >
                    +
                  </button>
                  <strong>{selectedQuantity}</strong>
                  <button
                    type="button"
                    className="quick-minus"
                    onClick={() => setQuantities((current) => ({ ...current, [item.type.id]: Math.max(1, selectedQuantity - 1) }))}
                    disabled={selectedQuantity <= 1}
                  >
                    -
                  </button>
                </div>
                <button className="turntable-add-submit" type="submit" aria-label="Переместить">⇄</button>
              </form>
            );
          }) : <p className="muted">На земле нет доступных зубьев.</p>}
        </div>
      ) : null}
    </div>
  );
}
