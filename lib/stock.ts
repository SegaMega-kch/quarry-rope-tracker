import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type StockKey = {
  ropeTypeId: number;
  diameter: string;
  length: number;
  locationId: number;
  placement: string;
  status: string;
  turntableId?: number | null;
};

export async function addToStock(tx: Prisma.TransactionClient, key: StockKey, quantity: number, userLogin: string) {
  const turntableId = key.placement === "TURNTABLE" ? key.turntableId : null;

  if (key.placement === "TURNTABLE") {
    if (!turntableId) throw new Error("Выберите вертушку");
    const turntable = await tx.turntable.findUnique({
      where: { id: turntableId },
      include: { stocks: { where: { status: { not: "WRITTEN_OFF" }, quantity: { gt: 0 } } } }
    });
    if (!turntable) throw new Error("Вертушка не найдена");

    const load = turntable.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
    if (load + quantity > 2) {
      throw new Error("На одной вертушке можно разместить не более двух канатов");
    }
    if (load > 0 && turntable.currentLocationId && turntable.currentLocationId !== key.locationId) {
      throw new Error("Занятая вертушка находится в другом месте");
    }
    await tx.turntable.update({ where: { id: turntableId }, data: { currentLocationId: key.locationId } });
  }

  const existing = await tx.ropeStock.findFirst({
    where: {
      ropeTypeId: key.ropeTypeId,
      diameter: key.diameter,
      length: key.length,
      locationId: key.locationId,
      placement: key.placement,
      status: key.status,
      turntableId
    }
  });

  if (existing) {
    await tx.ropeStock.update({
      where: { id: existing.id },
      data: {
        quantity: { increment: quantity },
        lastChangedAt: new Date(),
        lastChangedBy: userLogin
      }
    });
  } else {
    await tx.ropeStock.create({
      data: {
        ...key,
        turntableId,
        quantity,
        lastChangedBy: userLogin
      }
    });
  }
}

export async function getTurntableOptions(tx: Prisma.TransactionClient, targetLocationId?: number) {
  const turntables = await tx.turntable.findMany({
    include: {
      currentLocation: true,
      stocks: {
        where: { status: { not: "WRITTEN_OFF" }, quantity: { gt: 0 } },
        include: { ropeType: true }
      }
    },
    orderBy: { name: "asc" }
  });

  return turntables.filter((turntable) => {
    const load = turntable.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
    return load < 2 && (!targetLocationId || !turntable.currentLocationId || turntable.currentLocationId === targetLocationId || load === 0);
  });
}

export async function assertTurntableCanAccept(
  tx: Prisma.TransactionClient,
  turntableId: number | null | undefined,
  quantity: number,
  targetLocationId: number
) {
  if (!turntableId) throw new Error("Выберите вертушку");
  const turntable = await tx.turntable.findUnique({
    where: { id: turntableId },
    include: { stocks: { where: { status: { not: "WRITTEN_OFF" }, quantity: { gt: 0 } } } }
  });
  if (!turntable) throw new Error("Вертушка не найдена");

  const load = turntable.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
  if (load + quantity > 2) throw new Error("На одной вертушке можно разместить не более двух канатов");
  if (load > 0 && turntable.currentLocationId && turntable.currentLocationId !== targetLocationId) {
    throw new Error("Занятая вертушка находится в другом месте");
  }
}

export async function removeFromStock(tx: Prisma.TransactionClient, stockId: number, quantity: number, userLogin: string) {
  const stock = await tx.ropeStock.findUnique({ where: { id: stockId } });
  if (!stock || stock.quantity < quantity) {
    throw new Error("Недостаточно канатов в выбранном остатке");
  }

  await tx.ropeStock.update({
    where: { id: stockId },
    data: {
      quantity: { decrement: quantity },
      lastChangedAt: new Date(),
      lastChangedBy: userLogin
    }
  });

  return stock;
}
