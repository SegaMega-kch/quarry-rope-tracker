"use client";

import { useState } from "react";
import { installRopeAction } from "@/app/actions";

export function CardInstallMenu({ stockId, quantity, excavatorId }: { stockId: number; quantity: number; excavatorId: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card-install-wrap">
      <button type="button" className="card-install-button" onClick={() => setOpen((value) => !value)} aria-label="Установить канат на экскаватор" title="Установить">
        УСТ
      </button>
      {open ? (
        <form action={installRopeAction} className="card-install-menu">
          <div className="quick-menu-head">
            <strong>Установка</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          <input type="hidden" name="stockId" value={stockId} />
          <input type="hidden" name="excavatorId" value={excavatorId} />
          <input type="hidden" name="comment" value="установлен с карточки" />
          <label>
            Количество
            <input name="quantity" type="number" inputMode="numeric" min="1" max={quantity} defaultValue="1" required />
          </label>
          <button className="primary" type="submit">Установить</button>
        </form>
      ) : null}
    </div>
  );
}
