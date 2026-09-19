import type { Prisma } from "@prisma/client";
import { assertAssemblyAtQuarry } from "./assembly-loans";

export type AssemblyPowerSnapshot = {
  kind: "assembly-power-v1";
  before: { id: number; name: string } | null;
  after: { id: number; name: string } | null;
  horizonBefore?: number | null;
  horizonAfter?: number | null;
};

export async function setAssemblyPower(tx: Prisma.TransactionClient, assemblyId: number, excavatorId: number | null, user: { id: number; login: string }, selectedHorizonId?: number | null, expectedExcavatorId?: number | null) {
  // Serialize the availability check with the connection and its audit record.
  await tx.$executeRaw`UPDATE Assembly SET id = id WHERE id = ${assemblyId}`;
  const assembly = await tx.assembly.findUnique({ where: { id: assemblyId }, include: { excavatorLocation: true } });
  if (!assembly) throw new Error("Сборка не найдена");
  await assertAssemblyAtQuarry(tx, assembly);
  if (excavatorId === null && expectedExcavatorId !== undefined && assembly.excavatorLocationId !== expectedExcavatorId) {
    throw new Error("Подключение сборки уже изменено. Обновите страницу");
  }
  const excavator = excavatorId === null ? null : await tx.location.findUnique({ where: { id: excavatorId } });
  if (excavatorId !== null) {
    if (assembly.status === "REPAIR") throw new Error("Сборка в ремонте");
    if (!excavator?.isActive || excavator.category !== "excavator") throw new Error("Выберите действующий экскаватор");
    if (assembly.isPowered && assembly.excavatorLocationId !== excavatorId) throw new Error("Сборка уже запитана. Сначала отключите её");
  }
  const before = assembly.isPowered && assembly.excavatorLocation ? { id: assembly.excavatorLocation.id, name: assembly.excavatorLocation.name } : null;
  const after = excavator ? { id: excavator.id, name: excavator.name } : null;
  if (before?.id === after?.id && assembly.isPowered === Boolean(after) && assembly.excavatorLocationId === (after?.id ?? null)) return;
  let horizonId = assembly.horizonId;
  if (excavator) {
    const state = await tx.yaknoExcavatorState.findUnique({ where: { excavatorLocationId: excavator.id } });
    horizonId = state?.horizonId ?? selectedHorizonId ?? null;
    const horizon = horizonId ? await tx.assemblyHorizon.findUnique({ where: { id: horizonId } }) : null;
    if (!horizon?.isActive) throw new Error("Выберите горизонт для подключения сборки");
  }
  const snapshot: AssemblyPowerSnapshot = { kind: "assembly-power-v1", before, after, horizonBefore: assembly.horizonId, horizonAfter: horizonId };
  await tx.assembly.update({ where: { id: assemblyId }, data: {
    isPowered: Boolean(after), excavatorLocationId: after?.id ?? null, horizonId, lastChangedAt: new Date(), lastChangedBy: user.login
  } });
  await tx.assemblyMovement.create({ data: {
    userId: user.id, action: "POWER", assemblyId,
    fromPlaceText: before?.name ?? "Не запитана", toPlaceText: after?.name ?? "Не запитана",
    fromHorizonId: assembly.horizonId, toHorizonId: horizonId, comment: JSON.stringify(snapshot)
  } });
}
