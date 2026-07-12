"use client";

import { useMemo, useState } from "react";
import { moveRopeAction } from "@/app/actions";
import { compareLocations, locationLabel, placementLabels, ropeTypeLabel, statusLabels } from "@/lib/labels";

type StockOption = {
  id: number;
  ropeType: { name: string };
  diameter: string;
  length: number;
  quantity: number;
  location: { name: string };
  placement: string;
  status: string;
};

type LocationOption = {
  id: number;
  name: string;
  category?: string;
};

export function MoveRopeForm({ stocks, locations }: { stocks: StockOption[]; locations: LocationOption[] }) {
  const [stockId, setStockId] = useState(String(stocks[0]?.id ?? ""));
  const sortedLocations = useMemo(() => [...locations].sort(compareLocations), [locations]);
  const selectedStock = useMemo(() => stocks.find((stock) => String(stock.id) === stockId), [stockId, stocks]);
  const maxQuantity = selectedStock?.quantity ?? 1;

  return (
    <form action={moveRopeAction} className="form">
      <label>
        Что перемещаем
        <select name="stockId" value={stockId} onChange={(event) => setStockId(event.target.value)} required>
          {stocks.map((stock) => (
            <option key={stock.id} value={stock.id}>
              {ropeTypeLabel(stock.ropeType.name)}, {stock.quantity} шт - {locationLabel(stock.location.name)}, {placementLabels[stock.placement]}
            </option>
          ))}
        </select>
      </label>
      {selectedStock ? (
        <p className="rule-note">
          Доступно: {selectedStock.quantity} шт, {selectedStock.diameter}, {selectedStock.length} м, {statusLabels[selectedStock.status]}.
        </p>
      ) : null}
      <label>
        Количество
        <input name="quantity" type="number" inputMode="numeric" min="1" max={maxQuantity} defaultValue="1" required />
      </label>
      <label>
        Новое место
        <select name="toLocationId">
          {sortedLocations.map((location) => (
            <option key={location.id} value={location.id}>{locationLabel(location.name)}</option>
          ))}
        </select>
      </label>
      <label>
        Комментарий
        <textarea name="comment" />
      </label>
      <button className="primary big" disabled={!selectedStock}>Переместить</button>
    </form>
  );
}
