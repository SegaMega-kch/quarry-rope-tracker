"use client";

import { useState } from "react";
import { moveRopeAction } from "@/app/actions";

type StockOption = {
  id: number;
  label: string;
  sortOrder: number;
  location: string;
  placement: string;
  turntableId: number | null;
  turntableName: string;
  quantity: number;
};

type Props = {
  turntableId: number;
  targetLocationId?: number | null;
  load: number;
  stocks: StockOption[];
};

export function TurntableAddRopeMenu({ turntableId, targetLocationId, load, stocks }: Props) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const remaining = Math.max(0, 2 - load);
  const availableStocks = stocks
    .filter((stock) => stock.turntableId !== turntableId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.location.localeCompare(b.location, "ru") || a.placement.localeCompare(b.placement, "ru"));

  return (
    <div className="turntable-add-wrap">
      <button className="turntable-add-button" type="button" onClick={() => setOpen((value) => !value)} disabled={!targetLocationId || remaining < 1}>
        Добавить канат
      </button>
      {open ? (
        <div className="turntable-add-menu">
          <div className="quick-menu-head">
            <strong>Добавить канат</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          {!targetLocationId ? <p className="muted">У вертушки не указано место.</p> : null}
          {targetLocationId && remaining < 1 ? <p className="muted">Вертушка заполнена.</p> : null}
          {targetLocationId && remaining > 0 && availableStocks.length < 1 ? <p className="muted">Нет доступных канатов.</p> : null}
          {targetLocationId && remaining > 0
            ? availableStocks.map((stock) => {
                const maxQuantity = Math.min(stock.quantity, remaining);
                const selectedQuantity = Math.min(maxQuantity, quantities[stock.id] ?? 1);
                return (
                  <form action={moveRopeAction} className="turntable-add-row" key={stock.id}>
                    <input type="hidden" name="stockId" value={stock.id} />
                    <input type="hidden" name="toLocationId" value={targetLocationId} />
                    <input type="hidden" name="toPlacement" value="TURNTABLE" />
                    <input type="hidden" name="turntableId" value={turntableId} />
                    <input type="hidden" name="comment" value="добавлен на выбранную вертушку" />
                    <input type="hidden" name="quantity" value={selectedQuantity} />
                    <div>
                      <b>{stock.label}</b>
                      <span>{stock.location}, {stock.placement}{stock.turntableName ? `, ${stock.turntableName}` : ""}</span>
                    </div>
                    <div className="turntable-add-stepper" aria-label="Количество">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => setQuantities((current) => ({ ...current, [stock.id]: Math.min(maxQuantity, selectedQuantity + 1) }))}
                        disabled={selectedQuantity >= maxQuantity}
                      >
                        +
                      </button>
                      <strong>{selectedQuantity}</strong>
                      <button
                        type="button"
                        className="quick-minus"
                        onClick={() => setQuantities((current) => ({ ...current, [stock.id]: Math.max(1, selectedQuantity - 1) }))}
                        disabled={selectedQuantity <= 1}
                      >
                        -
                      </button>
                    </div>
                    <button className="turntable-add-submit" type="submit" aria-label="Переместить">⇄</button>
                  </form>
                );
              })
            : null}
        </div>
      ) : null}
    </div>
  );
}
