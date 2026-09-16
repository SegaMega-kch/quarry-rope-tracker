import type { Prisma } from "@prisma/client";

export type AssemblyPowerSnapshot = {
  kind: "assembly-power-v1";
  before: { id: number; name: string } | null;
  after: { id: number; name: string } | null;
};

export async function setAssemblyPower(tx: Prisma.TransactionClient, assemblyId: number, excavatorId: number | null, user: { id: number; login: string }) {
  const assembly = await tx.assembly.findUnique({ where: { id: assemblyId }, include: { excavatorLocation: true } });
  if (!assembly) throw new Error("Сборка не найдена");
  const excavator = excavatorId === null ? null : await tx.location.findUnique({ where: { id: excavatorId } });
  if (excavatorId !== null) {
    if (assembly.status === "REPAIR") throw new Error("Сборка в ремонте");
    if (!assembly.horizonId) throw new Error("Сначала перенесите сборку на горизонт");
    if (!excavator?.isActive || excavator.category !== "excavator") throw new Error("Выберите действующий экскаватор");
  }
  const before = assembly.isPowered && assembly.excavatorLocation ? { id: assembly.excavatorLocation.id, name: assembly.excavatorLocation.name } : null;
  const after = excavator ? { id: excavator.id, name: excavator.name } : null;
  if (before?.id === after?.id && assembly.isPowered === Boolean(after) && assembly.excavatorLocationId === (after?.id ?? null)) return;
  const snapshot: AssemblyPowerSnapshot = { kind: "assembly-power-v1", before, after };
  await tx.assembly.update({ where: { id: assemblyId }, data: {
    isPowered: Boolean(after), excavatorLocationId: after?.id ?? null, lastChangedAt: new Date(), lastChangedBy: user.login
  } });
  await tx.assemblyMovement.create({ data: {
    userId: user.id, action: "POWER", assemblyId,
    fromPlaceText: before?.name ?? "Не запитана", toPlaceText: after?.name ?? "Не запитана", comment: JSON.stringify(snapshot)
  } });
}
