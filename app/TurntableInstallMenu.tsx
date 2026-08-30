"use client";

import { MenuPanel, useExclusiveMenu } from "./OperationMenus";

import { installRopeAction } from "@/app/actions";
import { PendingButton } from "./PendingButton";
import { RopeMeasure } from "./RopeMeasure";

type TurntableInstallStock = {
  length: number;
  diameter: string;
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
  const [open, setOpen] = useExclusiveMenu();

  return (
    <div className="turntable-install-wrap">
      <button type="button" className="turntable-install-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Установить
      </button>
      {<MenuPanel open={open}>{(
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
              <RopeMeasure length={stock.length} diameter={stock.diameter} />
              <small>{stock.quantity} шт</small>
              <PendingButton type="submit" pendingText="Устанавливаю...">Установить 1</PendingButton>
            </form>
          ))}
        </div>
      )}</MenuPanel>}
    </div>
  );
}
