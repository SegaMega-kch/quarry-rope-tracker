"use client";

import { useState } from "react";
import { installToothAction } from "@/app/actions";
import { PendingButton } from "./PendingButton";

type InstallItem = {
  type: {
    id: number;
    name: string;
  };
  quantity: number;
};

type Props = {
  binId: number;
  excavatorLocationId?: number | null;
  items: InstallItem[];
  disabled?: boolean;
};

export function ToothInstallMenu({ binId, excavatorLocationId, items, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const isDisabled = disabled || !excavatorLocationId || items.length < 1;

  return (
    <div className="turntable-add-wrap tooth-install-wrap">
      <button
        className="tooth-action-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={isDisabled}
      >
        Установить
      </button>
      {open && !isDisabled ? (
        <div className="turntable-add-menu tooth-install-popup">
          <div className="quick-menu-head">
            <strong>Установить зубья</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {items.map((item) => {
            const selectedQuantity = Math.min(item.quantity, quantities[item.type.id] ?? 1);
            return (
              <form action={installToothAction} className="turntable-add-row tooth-load-add-row" key={item.type.id}>
                <input type="hidden" name="binId" value={binId} />
                <input type="hidden" name="excavatorLocationId" value={excavatorLocationId ?? ""} />
                <input type="hidden" name="toothTypeId" value={item.type.id} />
                <input type="hidden" name="quantity" value={selectedQuantity} />
                <input type="hidden" name="comment" value="установлено из пены" />
                <div>
                  <b>{item.type.name.replace("Зуб ", "")}</b>
                  <span>В пене: {item.quantity} шт</span>
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
                <PendingButton className="turntable-add-submit" type="submit" aria-label="Установить" pendingText="...">⇄</PendingButton>
              </form>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
