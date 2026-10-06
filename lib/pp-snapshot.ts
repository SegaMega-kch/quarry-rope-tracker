import type { Prisma } from "@prisma/client";
import { formatPpSnapshot } from "./shift-report";
import { locationLabel } from "./labels";

export async function collectPpSnapshot(tx: Prisma.TransactionClient) {
  const capturedAt = new Date();
  // One SELECT gives a consistent SQLite snapshot without a writer transaction on the read-only connection.
  const rows = await tx.$queryRaw<Array<{
    pointId: number | bigint; pointName: string; equipment: string | null;
    unloading: number | bigint | null; position: number | bigint | null;
    sectorId: number | bigint | null; sectorName: string | null; quantity: number | bigint | null; material: string | null;
  }>>`SELECT p.id AS pointId, p.name AS pointName, e.name AS equipment,
    p.unloadingSectorId AS unloading, p.equipmentSectorId AS position,
    s.id AS sectorId, s.name AS sectorName, s.quantity, s.material
    FROM PpPoint p
    LEFT JOIN Location e ON e.id = p.equipmentLocationId AND e.isActive = 1
    LEFT JOIN PpSector s ON s.ppPointId = p.id AND s.isActive = 1
    WHERE p.isActive = 1 ORDER BY p.id, s.id`;
  const points = new Map<number, Parameters<typeof formatPpSnapshot>[0][number]>();
  for (const row of rows) {
    const id = Number(row.pointId);
    const point = points.get(id) ?? {
      id, name: row.pointName, excavator: row.equipment ? locationLabel(row.equipment) : null,
      unloadingSectorId: row.unloading === null ? null : Number(row.unloading),
      equipmentSectorId: row.position === null ? null : Number(row.position), sectors: []
    };
    if (row.sectorId !== null) point.sectors.push({
      id: Number(row.sectorId), name: row.sectorName!, quantity: Number(row.quantity), material: row.material!
    });
    points.set(id, point);
  }
  return { capturedAt, messages: formatPpSnapshot(Array.from(points.values()), capturedAt) };
}
