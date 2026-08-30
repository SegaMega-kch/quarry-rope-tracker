import { ropeTypeSpecs } from "@/lib/labels";

export function RopeMeasure({ length, diameter }: { length: number; diameter?: string | null }) {
  return <span className="rope-measure"><b>{length} м</b>{diameter ? <small>⌀ {diameter}</small> : null}</span>;
}

export function RopeTypeMeasure({ name }: { name: string }) {
  const spec = ropeTypeSpecs[name];
  return spec ? <RopeMeasure {...spec} /> : <span>{name}</span>;
}
