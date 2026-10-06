import type { Prisma } from "@prisma/client";
import { locationLabel } from "./labels";

type Tx = Prisma.TransactionClient;
type Actor = { id: number; login: string };
export class PpChangeError extends Error {}

export async function lockPpEquipment(tx: Tx) {
  // Acquire SQLite's writer lock before reading assignments, including across web processes.
  await tx.$executeRaw`UPDATE PpPoint SET id = id WHERE id = -1`;
}

export async function availablePpEquipment(tx: Tx, equipmentId: number | null, pointId?: number) {
  if (equipmentId === null) return null;
  const equipment = await tx.location.findUnique({ where: { id: equipmentId } });
  if (!equipment?.isActive || !["excavator", "loader"].includes(equipment.category)) {
    throw new PpChangeError("Выберите действующую технику.");
  }
  const occupied = await tx.ppPoint.findFirst({
    where: { isActive: true, equipmentLocationId: equipmentId, ...(pointId ? { id: { not: pointId } } : {}) },
    orderBy: { id: "asc" }
  });
  if (occupied) throw new PpChangeError(`${locationLabel(equipment.name)} уже находится на ${occupied.name}. Сначала уберите технику с ${occupied.name}.`);
  return equipment;
}

export async function changePpEquipment(tx: Tx, pointId: number, equipmentId: number | null, expectedEquipmentId: number | null, actor: Actor) {
  await lockPpEquipment(tx);
  const point = await tx.ppPoint.findUnique({ where: { id: pointId }, include: { equipmentLocation: true } });
  if (!point?.isActive) throw new PpChangeError("П/П не найден.");
  if (point.equipmentLocationId !== expectedEquipmentId) throw new PpChangeError("Техника уже изменена другим пользователем. Обновите страницу.");
  if (point.equipmentLocationId === equipmentId) return;
  const equipment = await availablePpEquipment(tx, equipmentId, pointId);
  await tx.ppPoint.update({ where: { id: pointId }, data: {
    equipmentLocationId: equipmentId, equipmentSectorId: null,
    lastChangedAt: new Date(), lastChangedBy: actor.login
  } });
  await tx.ppMovement.create({ data: {
    userId: actor.id, action: "SET_EQUIPMENT", ppPointId: pointId, equipmentLocationId: equipmentId,
    fromText: point.equipmentLocation?.name ?? "Без техники", toText: equipment?.name ?? "Без техники"
  } });
}

export async function changePpEquipmentSector(tx: Tx, pointId: number, sectorId: number | null,
  expectedEquipmentId: number | null, expectedSectorId: number | null, actor: Actor) {
  await lockPpEquipment(tx);
  const point = await tx.ppPoint.findUnique({ where: { id: pointId }, include: { equipmentLocation: true } });
  if (!point?.isActive) throw new PpChangeError("П/П не найден.");
  if (point.equipmentLocationId !== expectedEquipmentId || point.equipmentSectorId !== expectedSectorId) {
    throw new PpChangeError("Положение техники уже изменено. Обновите страницу.");
  }
  if (!point.equipmentLocation?.isActive) throw new PpChangeError("Сначала выберите технику на П/П.");
  if (point.equipmentSectorId === sectorId) return;
  const sector = sectorId === null ? null : await tx.ppSector.findUnique({ where: { id: sectorId } });
  if (sectorId !== null && (!sector?.isActive || sector.ppPointId !== pointId)) throw new PpChangeError("Сектор не найден на этом П/П.");
  const before = point.equipmentSectorId ? await tx.ppSector.findUnique({ where: { id: point.equipmentSectorId } }) : null;
  await tx.ppPoint.update({ where: { id: pointId }, data: {
    equipmentSectorId: sectorId, lastChangedAt: new Date(), lastChangedBy: actor.login
  } });
  await tx.ppMovement.create({ data: {
    userId: actor.id, action: "SET_EQUIPMENT_SECTOR", ppPointId: pointId, sectorId,
    equipmentLocationId: point.equipmentLocationId,
    fromText: before ? `Сектор ${before.name}` : "Вне секторов",
    toText: sector ? `Сектор ${sector.name}` : "Вне секторов"
  } });
}
