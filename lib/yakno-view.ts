type PositionedYakno = { number: string; horizonId: number | null; isPowered: boolean };

export function compareYaknoNumbers(a: { number: string }, b: { number: string }) {
  return a.number.localeCompare(b.number, "ru", { numeric: true });
}

// Callers provide active, serviceable boxes. An unknown horizon never groups equipment together.
export function freeYaknoOnHorizon<T extends PositionedYakno>(boxes: readonly T[], horizonId: number | null) {
  return horizonId === null ? [] : boxes.filter((box) => !box.isPowered && box.horizonId === horizonId).sort(compareYaknoNumbers);
}

function elevation(name?: string | null) {
  const value = name?.replace(/^Горизонт\s*/i, "").replace("−", "-").trim().match(/^([+-]?\d+(?:[.,]\d+)?)\s*м?$/i);
  return value ? Number(value[1].replace(",", ".")) : null;
}

export function yaknoWithoutExcavator<T extends PositionedYakno & { horizon: { name: string } | null }>(
  boxes: readonly T[], excavatorHorizons: readonly (number | null)[]
) {
  const occupied = new Set(excavatorHorizons.filter((id) => id !== null));
  return boxes.filter((box) => !box.isPowered && (box.horizonId === null || !occupied.has(box.horizonId)))
    .sort((a, b) => {
      if (a.horizonId === null && b.horizonId !== null) return 1;
      if (b.horizonId === null && a.horizonId !== null) return -1;
      const high = elevation(a.horizon?.name), low = elevation(b.horizon?.name);
      if (high !== low) return (high ?? -Infinity) > (low ?? -Infinity) ? -1 : 1;
      return (a.horizon?.name ?? "").localeCompare(b.horizon?.name ?? "", "ru") || compareYaknoNumbers(a, b);
    });
}
