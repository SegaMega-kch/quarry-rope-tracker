import { Prisma } from "@prisma/client";

export async function archiveRopeType(tx: Prisma.TransactionClient, id: number) {
  const type = await tx.ropeType.findUnique({ where: { id } });
  if (!type || !type.isActive) throw new Error("Тип каната не найден");
  const stock = await tx.ropeStock.findFirst({
    where: { ropeTypeId: id, quantity: { gt: 0 }, status: { not: "WRITTEN_OFF" } }
  });
  if (stock) throw new Error("Есть канаты этого типа в учёте, включая выданные в долг");
  await tx.ropeType.update({ where: { id }, data: { isActive: false } });
}

export async function setUnloadingSector(tx: Prisma.TransactionClient, sectorId: number, active: boolean) {
  const sector = await tx.ppSector.findUnique({ where: { id: sectorId }, include: { ppPoint: true } });
  if (!sector || !sector.isActive || !sector.ppPoint.isActive) throw new Error("Сектор не найден");
  // One nullable pointer per point makes two active sectors impossible. A stale
  // off request must not clear a different sector selected by another worker.
  await tx.ppPoint.updateMany({
    where: { id: sector.ppPointId, ...(active ? {} : { unloadingSectorId: sectorId }) },
    data: { unloadingSectorId: active ? sectorId : null }
  });
}
