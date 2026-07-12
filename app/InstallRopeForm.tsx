"use client";

import { useMemo, useState } from "react";
import { installRopeAction } from "@/app/actions";
import { locationLabel, ropeTypeLabel } from "@/lib/labels";

type StockOption = {
  id: number;
  ropeType: { name: string };
  quantity: number;
  location: { id: number; name: string };
};

type LocationOption = {
  id: number;
  name: string;
};

export function InstallRopeForm({ stocks, excavators }: { stocks: StockOption[]; excavators: LocationOption[] }) {
  const [stockId, setStockId] = useState(String(stocks[0]?.id ?? ""));
  const selectedStock = useMemo(() => stocks.find((stock) => String(stock.id) === stockId), [stockId, stocks]);
  const maxQuantity = selectedStock?.quantity ?? 1;

  return (
    <form action={installRopeAction} className="form">
      <label>
        Канат
        <select name="stockId" value={stockId} onChange={(event) => setStockId(event.target.value)} required>
          {stocks.map((stock) => (
            <option key={stock.id} value={stock.id}>
              {ropeTypeLabel(stock.ropeType.name)}, {stock.quantity} шт - {locationLabel(stock.location.name)}, На вертушке
            </option>
          ))}
        </select>
      </label>
      {selectedStock ? <p className="rule-note">Доступно к установке: {selectedStock.quantity} шт у {locationLabel(selectedStock.location.name)}.</p> : <p className="muted">Нет канатов у экскаваторов на вертушке.</p>}
      <label>
        Количество
        <input name="quantity" type="number" inputMode="numeric" min="1" max={maxQuantity} defaultValue="1" required />
      </label>
      <label>
        Экскаватор
        <select name="excavatorId" defaultValue={selectedStock?.location.id}>
          {excavators.map((location) => (
            <option key={location.id} value={location.id}>{locationLabel(location.name)}</option>
          ))}
        </select>
      </label>
      <label>
        Комментарий
        <textarea name="comment" />
      </label>
      <button className="primary big" disabled={!selectedStock}>Установить</button>
    </form>
  );
}
