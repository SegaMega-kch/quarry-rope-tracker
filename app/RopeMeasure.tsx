import { ropeTypeSpecs } from "@/lib/labels";

export function RopeMeasure({ length, diameter }: { length: number; diameter?: string | null }) {
  return <span className="rope-measure"><b>{length} м</b>{diameter ? <small>⌀ {diameter}</small> : null}</span>;
}

export function RopeAmount({
  length,
  diameter,
  quantity
}: {
  length: number;
  diameter?: string | null;
  quantity: number;
}) {
  return (
    <span className="rope-amount">
      <span className="rope-amount-main">
        <b>{length} м</b>
        <span aria-hidden="true">-</span>
        <strong>{quantity} шт</strong>
      </span>
      {diameter ? <small>⌀ {diameter}</small> : null}
    </span>
  );
}

export function RopeTypeMeasure({ name }: { name: string }) {
  const spec = ropeTypeSpecs[name];
  return spec ? <RopeMeasure {...spec} /> : <span>{name}</span>;
}

export function RopeTypeAmount({ name, quantity }: { name: string; quantity: number }) {
  const spec = ropeTypeSpecs[name];
  return spec ? <RopeAmount {...spec} quantity={quantity} /> : <span>{name} - {quantity} шт</span>;
}
