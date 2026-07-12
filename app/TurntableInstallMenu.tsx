"use client";

import { useState } from "react";
import { installRopeAction } from "@/app/actions";

type TurntableInstallStock = {
  id: number;
  label: string;
  quantity: number;
};

export function TurntableInstallMenu({
  excavatorId,
  stocks
}: {
  excavatorId: number;
  stocks: TurntableInstallStock[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="turntable-install-wrap">
      <button type="button" className="turntable-install-button" onClick={() => setOpen((value) => !value)}>
        Установить
      </button>
      {open ? (
        <div className="turntable-install-menu">
          <div className="quick-menu-head">
            <strong>Установить канат</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {stocks.map((stock) => (
            <form action={installRopeAction} className="turntable-install-row" key={stock.id}>
              <input type="hidden" name="stockId" value={stock.id} />
              <input type="hidden" name="excavatorId" value={excavatorId} />
              <input type="hidden" name="quantity" value="1" />
              <input type="hidden" name="comment" value="установлен с вертушки" />
              <span>{stock.label}</span>
              <small>{stock.quantity} шт</small>
              <button type="submit">Установить 1</button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
