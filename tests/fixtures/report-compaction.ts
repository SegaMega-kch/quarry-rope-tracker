import type { PrismaClient } from "@prisma/client";
import type { ShiftPeriod } from "../../lib/shift-report";

// Synthetic reproduction of the noisy report, not a production database copy.
export async function createReportCompactionFixture(db: PrismaClient, period: ShiftPeriod) {
  const user = await db.user.create({ data: { login: "report-review", passwordHash: "unused", role: "shift" } });
  const h355 = await db.assemblyHorizon.create({ data: { name: "Горизонт +355", sortOrder: 355 } });
  const h280 = await db.assemblyHorizon.create({ data: { name: "Горизонт +280", sortOrder: 280 } });
  const h130 = await db.assemblyHorizon.create({ data: { name: "Горизонт +130", sortOrder: 130 } });
  const exc9 = await db.location.create({ data: { name: "ЭКГ-10 №9", category: "excavator" } });
  const exc42 = await db.location.create({ data: { name: "ЭКГ-8И №42", category: "excavator" } });
  const exc10 = await db.location.create({ data: { name: "ЭКГ-10 №10", category: "excavator" } });
  const box28 = await db.yaknoBox.create({ data: { number: "28" } });
  const box32 = await db.yaknoBox.create({ data: { number: "32" } });
  const assembly2 = await db.assembly.create({ data: { name: "Сборка №2" } });
  const assembly3 = await db.assembly.create({ data: { name: "Сборка №3" } });
  const assembly4 = await db.assembly.create({ data: { name: "Сборка №4" } });
  let n = 0;
  const at = () => new Date(period.start.getTime() + (++n) * 60000);
  const snapshot = (boxes: unknown[], horizonId: number | null) => JSON.stringify({ boxes, states: [{ excavatorLocationId: exc9.id, horizonId }] });
  for (const [from, to] of [[null, h355.id], [h355.id, null], [null, h355.id], [h355.id, null]]) {
    await db.yaknoMovement.create({ data: { userId: user.id, action: "SET_EXCAVATOR", createdAt: at(), excavatorLocationId: exc9.id,
      beforeState: snapshot([], from), afterState: snapshot([], to) } });
  }
  const box = (id: number, excavatorLocationId: number | null, horizonId: number | null, isPowered = false) => ({ id, excavatorLocationId, horizonId, isPowered, status: "ACTIVE" });
  for (const [a, b] of [
    [box(box28.id, exc42.id, null), box(box28.id, null, null)],
    [box(box28.id, null, null), box(box28.id, exc9.id, null)],
    [box(box28.id, exc9.id, null), box(box28.id, exc9.id, null, true)],
    [box(box32.id, exc10.id, null), box(box32.id, null, null)]
  ]) await db.yaknoMovement.create({ data: { userId: user.id, action: "SET_EXCAVATOR", createdAt: at(),
    beforeState: snapshot([a], null), afterState: snapshot([b], null) } });
  for (const [fromHorizonId, toHorizonId] of [[null, h130.id], [h130.id, null], [null, null], [null, null], [null, null]]) {
    await db.yaknoMovement.create({ data: { userId: user.id, action: "FREE_HORIZON", boxId: box32.id, createdAt: at(), fromHorizonId, toHorizonId } });
  }
  for (const [assembly, oldLength, newLength] of [[assembly3, null, 220], [assembly3, 220, 220], [assembly3, 220, 220], [assembly2, null, null], [assembly4, null, null]] as const) {
    await db.assemblyMovement.create({ data: { userId: user.id, assemblyId: assembly.id, action: "LENGTH", oldLength, newLength, createdAt: at() } });
  }
  for (const [action, fromPlaceText, toPlaceText] of [["MOVE", "Место не указано", "Ремонт"], ["RESTORE", "Ремонт", "Место не указано"], ["MOVE", "Место не указано", "Ремонт"]]) {
    await db.assemblyMovement.create({ data: { userId: user.id, assemblyId: assembly2.id, action, fromPlaceText, toPlaceText, createdAt: at() } });
  }
  await db.assemblyMovement.create({ data: { userId: user.id, assemblyId: assembly4.id, action: "MOVE", createdAt: at(),
    fromPlaceText: "Место не указано", toHorizonId: h280.id, toPlaceText: h280.name } });
  await db.assemblyMovement.create({ data: { userId: user.id, assemblyId: assembly3.id, action: "POWER", createdAt: at(),
    comment: JSON.stringify({ kind: "assembly-power-v1", before: null, after: { id: exc9.id, name: exc9.name } }) } });
  return { user, h355, h280, h130, exc9, exc42, exc10, box28, box32, assembly2, assembly3, assembly4 };
}
