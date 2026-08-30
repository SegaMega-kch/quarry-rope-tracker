"use client";

import { useId } from "react";
import { RopeMeasure } from "./RopeMeasure";

export function RopeStockSelect({ stocks, value, onChange }: {
  stocks: { id: number; length: number; diameter: string; quantity: number }[];
  value: number;
  onChange: (id: number) => void;
}) {
  const name = useId();
  return <fieldset className="rope-stock-select"><legend>Канат</legend>
    {stocks.map((stock) => <label key={stock.id}>
      <input type="radio" name={name} checked={stock.id === value} onChange={() => onChange(stock.id)} />
      <RopeMeasure length={stock.length} diameter={stock.diameter} />
      <span>{stock.quantity} шт</span>
    </label>)}
  </fieldset>;
}
