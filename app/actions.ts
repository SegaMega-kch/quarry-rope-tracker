"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { canManageLocations, canManageRequests, canWriteOff, login, logout, requireUser } from "@/lib/auth";
import { ropeTypeSpecs } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { addToStock, removeFromStock } from "@/lib/stock";
import {
  allowedValue,
  locationCategories,
  positiveInteger,
  requestStatuses,
  ropePlacements,
  toothConditions
} from "@/lib/validation";

const intField = (formData: FormData, key: string) => Number(formData.get(key));
const textField = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const craneLocationName = "Вешала под 30т краном";
const toothGroundBinName = "Земля под 30т краном";
const optionalIntField = (formData: FormData, key: string) => {
  const value = Number(formData.get(key));
  return value || null;
};
const positiveIntField = (formData: FormData, key: string) => {
  return positiveInteger(formData.get(key));
};

type UndoStockKey = {
  ropeTypeId: number;
  diameter: string;
  length: number;
  locationId: number;
  placement: string;
  status: string;
  turntableId?: number | null;
};

async function removeFromStockKey(tx: Prisma.TransactionClient, key: UndoStockKey, quantity: number, userLogin: string) {
  const stock = await tx.ropeStock.findFirst({
    where: {
      ropeTypeId: key.ropeTypeId,
      diameter: key.diameter,
      length: key.length,
      locationId: key.locationId,
      placement: key.placement,
      status: key.status,
      turntableId: key.placement === "TURNTABLE" ? key.turntableId ?? null : null,
      quantity: { gt: 0 }
    },
    orderBy: { updatedAt: "desc" }
  });
  if (!stock || stock.quantity < quantity) throw new Error("Не хватает канатов для отката");
  return removeFromStock(tx, stock.id, quantity, userLogin);
}

function movementKey(movement: {
  ropeTypeId: number | null;
  diameter: string | null;
  length: number | null;
}, locationId: number | null, placement: string | null, status: string | null, turntableId?: number | null): UndoStockKey {
  if (!movement.ropeTypeId || !movement.diameter || !movement.length || !locationId || !placement || !status) {
    throw new Error("В этой записи истории недостаточно данных для отката");
  }
  return {
    ropeTypeId: movement.ropeTypeId,
    diameter: movement.diameter,
    length: movement.length,
    locationId,
    placement,
    status,
    turntableId
  };
}

function getLength(formData: FormData) {
  const custom = textField(formData, "customLength");
  return custom ? Number(custom) : intField(formData, "length");
}

function getDiameter(formData: FormData) {
  return textField(formData, "customDiameter") || textField(formData, "diameter");
}

async function getNormalizedRopeInput(formData: FormData) {
  const selectedRopeTypeId = intField(formData, "ropeTypeId");
  const selectedRopeType = selectedRopeTypeId
    ? await prisma.ropeType.findUnique({ where: { id: selectedRopeTypeId } })
    : null;
  const spec = selectedRopeType ? ropeTypeSpecs[selectedRopeType.name] : null;
  if (spec) {
    return {
      ropeTypeId: selectedRopeTypeId,
      diameter: spec.diameter,
      length: spec.length
    };
  }
  if (selectedRopeType?.defaultDiameter) {
    return {
      ropeTypeId: selectedRopeTypeId,
      diameter: selectedRopeType.defaultDiameter,
      length: selectedRopeType.standardLength
    };
  }

  const length = getLength(formData);
  const needsEkg12Lift = length === 82 || selectedRopeType?.name === "Подъём ЭКГ-12К";
  const ekg12Lift = needsEkg12Lift ? await prisma.ropeType.findUnique({ where: { name: "Подъём ЭКГ-12К" } }) : null;

  return {
    ropeTypeId: ekg12Lift?.id ?? selectedRopeTypeId,
    diameter: ekg12Lift ? "52 мм" : getDiameter(formData),
    length: ekg12Lift ? 82 : length
  };
}

export async function loginAction(_: unknown, formData: FormData) {
  const ok = await login(textField(formData, "login"), textField(formData, "password"));
  if (!ok) return { error: "Неверный логин или пароль" };
  redirect("/rope");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function clearAllRopesAction() {
  const user = await requireUser();
  if (user.role !== "storekeeper") throw new Error("Очистка доступна только кладовщику");

  await prisma.$transaction(async (tx) => {
    await tx.ropeStock.deleteMany({});
    await tx.ropeMovement.deleteMany({});
  });

  revalidatePath("/rope");
}

export async function clearAllTeethAction() {
  const user = await requireUser();
  if (user.role !== "storekeeper") throw new Error("Очистка доступна только кладовщику");

  await prisma.$transaction(async (tx) => {
    await tx.toothStock.deleteMany({});
    await tx.toothMovement.deleteMany({});
  });

  revalidatePath("/tooth");
}

export async function addRopeAction(formData: FormData) {
  const user = await requireUser();
  const { ropeTypeId, diameter, length } = await getNormalizedRopeInput(formData);
  const quantity = positiveIntField(formData, "quantity");
  const locationId = intField(formData, "locationId");
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  const requestedPlacement = allowedValue(formData.get("placement"), ropePlacements, "Размещение");
  const placement = location?.name.startsWith("ЭКГ") || location?.name.startsWith("ПП") ? "TURNTABLE" : requestedPlacement;
  const turntableId = placement === "TURNTABLE" ? optionalIntField(formData, "turntableId") : null;
  const comment = textField(formData, "comment");

  if (!quantity || quantity < 1) throw new Error("Укажите количество");

  await prisma.$transaction(async (tx) => {
    await addToStock(
      tx,
      { ropeTypeId, diameter, length, locationId, placement, status: "AVAILABLE", turntableId },
      quantity,
      user.login
    );
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "ADD",
        ropeTypeId,
        diameter,
        length,
        quantity,
        toLocationId: locationId,
        toPlacement: placement,
        toStatus: "AVAILABLE",
        toTurntableId: turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function adjustCraneStockAction(formData: FormData) {
  const user = await requireUser();
  const { ropeTypeId, diameter, length } = await getNormalizedRopeInput(formData);
  const locationId = intField(formData, "locationId");
  const placement = allowedValue(formData.get("placement"), ropePlacements, "Размещение");
  const turntableId = placement === "TURNTABLE" ? optionalIntField(formData, "turntableId") : null;
  const delta = intField(formData, "delta");
  const comment = delta > 0 ? "быстрая корректировка +1 под 20т краном" : "быстрая корректировка -1 под 20т краном";

  if (!["HANGERS", "TURNTABLE", "GROUND"].includes(placement)) throw new Error("Неверное размещение");
  if (![1, -1].includes(delta)) throw new Error("Неверная корректировка");

  await prisma.$transaction(async (tx) => {
    if (delta > 0) {
      await addToStock(tx, { ropeTypeId, diameter, length, locationId, placement, status: "AVAILABLE", turntableId }, 1, user.login);
    } else {
      const stock = await tx.ropeStock.findFirst({
        where: {
          ropeTypeId,
          diameter,
          length,
          locationId,
          placement,
          status: "AVAILABLE",
          quantity: { gt: 0 },
          ...(turntableId ? { turntableId } : {})
        },
        orderBy: { updatedAt: "asc" }
      });
      if (!stock || stock.quantity < 1) throw new Error("Канатов нет для уменьшения");
      await removeFromStock(tx, stock.id, 1, user.login);
    }

    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "ADJUST",
        ropeTypeId,
        diameter,
        length,
        quantity: 1,
        fromLocationId: locationId,
        toLocationId: locationId,
        fromPlacement: placement,
        toPlacement: placement,
        fromStatus: "AVAILABLE",
        toStatus: "AVAILABLE",
        fromTurntableId: turntableId,
        toTurntableId: turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function addCraneTurntableStockAction(formData: FormData) {
  const user = await requireUser();
  const { ropeTypeId, diameter, length } = await getNormalizedRopeInput(formData);
  const quantity = positiveIntField(formData, "quantity");
  const locationId = intField(formData, "locationId");
  const turntableId = optionalIntField(formData, "turntableId");
  const comment = "добавлен на вертушку под 20т краном";

  if (!quantity || quantity < 1) throw new Error("Укажите количество");
  if (!turntableId) throw new Error("Выберите вертушку");

  await prisma.$transaction(async (tx) => {
    await addToStock(tx, { ropeTypeId, diameter, length, locationId, placement: "TURNTABLE", status: "AVAILABLE", turntableId }, quantity, user.login);
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "ADD",
        ropeTypeId,
        diameter,
        length,
        quantity,
        toLocationId: locationId,
        toPlacement: "TURNTABLE",
        toStatus: "AVAILABLE",
        toTurntableId: turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function moveRopeAction(formData: FormData) {
  const user = await requireUser();
  const stockId = intField(formData, "stockId");
  const quantity = positiveIntField(formData, "quantity");
  const toLocationId = intField(formData, "toLocationId");
  const toLocation = await prisma.location.findUnique({ where: { id: toLocationId } });
  const requestedPlacement = textField(formData, "toPlacement");
  const requestedTurntableId = optionalIntField(formData, "turntableId");
  const toPlacement =
    toLocation?.name === "Вешала под 30т краном" && ["HANGERS", "TURNTABLE", "GROUND"].includes(requestedPlacement)
      ? requestedPlacement
      : toLocation?.category === "excavator" || toLocation?.category === "transfer_point"
      ? "TURNTABLE"
      : toLocation?.name === "Вешала под 30т краном"
        ? "HANGERS"
        : "GROUND";
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    const stockBeforeMove = await tx.ropeStock.findUnique({ where: { id: stockId } });
    if (!stockBeforeMove || stockBeforeMove.quantity < quantity) throw new Error("Недостаточно канатов в выбранном остатке");

    if (stockBeforeMove.placement === "TURNTABLE" && stockBeforeMove.turntableId && toPlacement === "TURNTABLE" && !requestedTurntableId) {
      const turntableLoad = await tx.ropeStock.aggregate({
        where: { turntableId: stockBeforeMove.turntableId, status: { not: "WRITTEN_OFF" }, quantity: { gt: 0 } },
        _sum: { quantity: true }
      });
      if ((turntableLoad._sum.quantity ?? 0) !== quantity) {
        throw new Error("Эта вертушка загружена несколькими канатами. Перемещайте ее через блок Вертушки");
      }
    }

    const oldStock = await removeFromStock(tx, stockId, quantity, user.login);
    const turntableId = toPlacement === "TURNTABLE" ? requestedTurntableId ?? oldStock.turntableId : null;
    await addToStock(
      tx,
      {
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        locationId: toLocationId,
        placement: toPlacement,
        status: oldStock.status,
        turntableId
      },
      quantity,
      user.login
    );
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "MOVE",
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        quantity,
        fromLocationId: oldStock.locationId,
        toLocationId,
        fromPlacement: oldStock.placement,
        toPlacement,
        fromStatus: oldStock.status,
        toStatus: oldStock.status,
        fromTurntableId: oldStock.turntableId,
        toTurntableId: turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function moveTurntableAction(formData: FormData) {
  const user = await requireUser();
  const turntableId = intField(formData, "turntableId");
  const toLocationId = intField(formData, "toLocationId");
  const operationId = randomUUID();
  const comment = textField(formData, "comment") || "перемещена вертушка";

  await prisma.$transaction(async (tx) => {
    const turntable = await tx.turntable.findUnique({
      where: { id: turntableId },
      include: {
        stocks: {
          where: { quantity: { gt: 0 }, status: { not: "WRITTEN_OFF" } }
        }
      }
    });
    if (!turntable) throw new Error("Вертушка не найдена");

    const fromLocationId = turntable.currentLocationId;
    if (!fromLocationId) throw new Error("У вертушки не указано текущее место");
    await tx.turntable.update({ where: { id: turntableId }, data: { currentLocationId: toLocationId } });

    const createdAt = new Date();
    if (turntable.stocks.length < 1) {
      await tx.ropeMovement.create({
        data: {
          operationId,
          userId: user.id,
          action: "MOVE_TURNTABLE",
          quantity: 0,
          fromLocationId,
          toLocationId,
          fromPlacement: "TURNTABLE",
          toPlacement: "TURNTABLE",
          fromTurntableId: turntableId,
          toTurntableId: turntableId,
          createdAt,
          comment
        }
      });
      return;
    }

    for (const stock of turntable.stocks) {
      await tx.ropeStock.update({
        where: { id: stock.id },
        data: {
          locationId: toLocationId,
          lastChangedAt: new Date(),
          lastChangedBy: user.login
        }
      });
      await tx.ropeMovement.create({
        data: {
          operationId,
          userId: user.id,
          action: "MOVE",
          ropeTypeId: stock.ropeTypeId,
          diameter: stock.diameter,
          length: stock.length,
          quantity: stock.quantity,
          fromLocationId,
          toLocationId,
          fromPlacement: "TURNTABLE",
          toPlacement: "TURNTABLE",
          fromStatus: stock.status,
          toStatus: stock.status,
          fromTurntableId: turntableId,
          toTurntableId: turntableId,
          createdAt,
          comment
        }
      });
    }
  });

  revalidatePath("/rope");
}

export async function undoMovementAction(formData: FormData) {
  const user = await requireUser();
  const operationId = textField(formData, "operationId");
  const undoableActions = new Set(["ADD", "ADJUST", "MOVE", "INSTALL", "ADD_USED", "WRITE_OFF", "MOVE_TURNTABLE"]);
  const operationKey = (movement: { id: number; operationId: string | null }) => movement.operationId ?? `legacy-${movement.id}`;

  await prisma.$transaction(async (tx) => {
    const recentMovements = await tx.ropeMovement.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 120
    });

    const recentOperationIds: string[] = [];
    for (const movement of recentMovements) {
      if (!undoableActions.has(movement.action)) continue;
      const key = operationKey(movement);
      if (!recentOperationIds.includes(key)) recentOperationIds.push(key);
      if (recentOperationIds.length === 3) break;
    }

    if (!operationId || !recentOperationIds.includes(operationId)) {
      throw new Error("Откат доступен только для последних 3 действий текущего пользователя");
    }

    const operationMovements = await tx.ropeMovement.findMany({
      where: operationId.startsWith("legacy-")
        ? { id: Number(operationId.replace("legacy-", "")), userId: user.id }
        : { operationId, userId: user.id },
      orderBy: { id: "desc" }
    });
    if (!operationMovements.length) throw new Error("Запись истории не найдена");

    const firstMovement = operationMovements[0];
    const isTurntableMove =
      operationMovements.every(
        (movement) =>
          movement.action === "MOVE" &&
          movement.fromTurntableId &&
          movement.fromTurntableId === movement.toTurntableId &&
          movement.fromTurntableId === firstMovement.fromTurntableId &&
          movement.fromLocationId === firstMovement.fromLocationId &&
          movement.toLocationId === firstMovement.toLocationId
      ) ||
      operationMovements.every(
        (movement) =>
          movement.action === "MOVE_TURNTABLE" &&
          movement.fromTurntableId &&
          movement.fromTurntableId === movement.toTurntableId &&
          movement.fromTurntableId === firstMovement.fromTurntableId &&
          movement.fromLocationId === firstMovement.fromLocationId &&
          movement.toLocationId === firstMovement.toLocationId
      );

    if (isTurntableMove) {
      const undoTurntableId = firstMovement.fromTurntableId!;
      const undoFromLocationId = firstMovement.fromLocationId!;
      const stocks = await tx.ropeStock.findMany({
        where: {
          turntableId: undoTurntableId,
          locationId: firstMovement.toLocationId ?? undefined,
          quantity: { gt: 0 },
          status: { not: "WRITTEN_OFF" }
        }
      });
      for (const stock of stocks) {
        await tx.ropeStock.update({
          where: { id: stock.id },
          data: {
            locationId: undoFromLocationId,
            lastChangedAt: new Date(),
            lastChangedBy: user.login
          }
        });
      }
      await tx.turntable.update({
        where: { id: undoTurntableId },
        data: { currentLocationId: undoFromLocationId }
      });
      await tx.ropeMovement.deleteMany({
        where: operationId.startsWith("legacy-")
          ? { id: { in: operationMovements.map((movement) => movement.id) }, userId: user.id }
          : { operationId, userId: user.id }
      });
      return;
    }

    for (const movement of operationMovements) {
      if (!undoableActions.has(movement.action)) {
        throw new Error("Это действие нельзя откатить автоматически");
      }

      if (movement.action === "ADD") {
        await removeFromStockKey(
          tx,
          movementKey(movement, movement.toLocationId, movement.toPlacement, movement.toStatus, movement.toTurntableId),
          movement.quantity,
          user.login
        );
      } else if (movement.action === "ADJUST") {
        const wasDecrease = movement.comment?.includes("-1");
        if (wasDecrease) {
          await addToStock(
            tx,
            movementKey(movement, movement.fromLocationId, movement.fromPlacement, movement.fromStatus, movement.fromTurntableId),
            movement.quantity,
            user.login
          );
        } else {
          await removeFromStockKey(
            tx,
            movementKey(movement, movement.toLocationId, movement.toPlacement, movement.toStatus, movement.toTurntableId),
            movement.quantity,
            user.login
          );
        }
      } else if (movement.action === "MOVE") {
        await removeFromStockKey(
          tx,
          movementKey(movement, movement.toLocationId, movement.toPlacement, movement.toStatus, movement.toTurntableId),
          movement.quantity,
          user.login
        );
        await addToStock(
          tx,
          movementKey(movement, movement.fromLocationId, movement.fromPlacement, movement.fromStatus, movement.fromTurntableId),
          movement.quantity,
          user.login
        );
      } else if (movement.action === "INSTALL") {
        await removeFromStockKey(
          tx,
          movementKey(movement, movement.toLocationId, movement.toPlacement, movement.toStatus, movement.toTurntableId),
          movement.quantity,
          user.login
        );
        await addToStock(
          tx,
          movementKey(movement, movement.fromLocationId, movement.fromPlacement, movement.fromStatus, movement.fromTurntableId),
          movement.quantity,
          user.login
        );
      } else if (movement.action === "ADD_USED") {
        await removeFromStockKey(
          tx,
          movementKey(movement, movement.toLocationId, movement.toPlacement, movement.toStatus, movement.toTurntableId),
          movement.quantity,
          user.login
        );
      } else if (movement.action === "WRITE_OFF") {
        await removeFromStockKey(
          tx,
          movementKey(movement, movement.toLocationId, movement.toPlacement, movement.toStatus, movement.toTurntableId),
          movement.quantity,
          user.login
        );
        await addToStock(
          tx,
          movementKey(movement, movement.fromLocationId, movement.fromPlacement, movement.fromStatus, movement.fromTurntableId),
          movement.quantity,
          user.login
        );
      } else {
        throw new Error("Это действие нельзя откатить автоматически");
      }
    }

    await tx.ropeMovement.deleteMany({
      where: operationId.startsWith("legacy-")
        ? { id: { in: operationMovements.map((movement) => movement.id) }, userId: user.id }
        : { operationId, userId: user.id }
    });
  });

  revalidatePath("/rope");
}

export async function installRopeAction(formData: FormData) {
  const user = await requireUser();
  const stockId = intField(formData, "stockId");
  const quantity = positiveIntField(formData, "quantity");
  const excavatorId = intField(formData, "excavatorId");
  const rawComment = textField(formData, "comment");
  const comment = rawComment ? `замена выполнена, б/у оставлен под экскаватором; ${rawComment}` : "замена выполнена, б/у оставлен под экскаватором";

  await prisma.$transaction(async (tx) => {
    const oldStock = await removeFromStock(tx, stockId, quantity, user.login);
    const fromLocation = await tx.location.findUnique({ where: { id: oldStock.locationId } });
    if (fromLocation?.category !== "excavator" || oldStock.placement !== "TURNTABLE" || oldStock.status !== "AVAILABLE") {
      throw new Error("Устанавливать можно только канаты у экскаватора на вертушке");
    }
    await addToStock(
      tx,
      {
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        locationId: excavatorId,
        placement: "GROUND",
        status: "USED_NEAR_EXCAVATOR"
      },
      quantity,
      user.login
    );
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "INSTALL",
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        quantity,
        fromLocationId: oldStock.locationId,
        toLocationId: excavatorId,
        fromPlacement: oldStock.placement,
        toPlacement: "GROUND",
        fromStatus: oldStock.status,
        toStatus: "USED_NEAR_EXCAVATOR",
        fromTurntableId: oldStock.turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function addUsedRopeAction(formData: FormData) {
  const user = await requireUser();
  const { ropeTypeId, diameter, length } = await getNormalizedRopeInput(formData);
  const quantity = positiveIntField(formData, "quantity");
  const locationId = intField(formData, "locationId");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    await addToStock(
      tx,
      { ropeTypeId, diameter, length, locationId, placement: "GROUND", status: "USED_NEAR_EXCAVATOR" },
      quantity,
      user.login
    );
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "ADD_USED",
        ropeTypeId,
        diameter,
        length,
        quantity,
        toLocationId: locationId,
        toPlacement: "GROUND",
        toStatus: "USED_NEAR_EXCAVATOR",
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function writeOffRopeAction(formData: FormData) {
  const user = await requireUser();
  if (!canWriteOff(user.role)) throw new Error("Недостаточно прав");
  const stockId = intField(formData, "stockId");
  const quantity = positiveIntField(formData, "quantity");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    const oldStock = await removeFromStock(tx, stockId, quantity, user.login);
    if (oldStock.status !== "USED_NEAR_EXCAVATOR") throw new Error("Списывать можно только б/у канаты");
    await addToStock(
      tx,
      {
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        locationId: oldStock.locationId,
        placement: oldStock.placement,
        status: "WRITTEN_OFF"
      },
      quantity,
      user.login
    );
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "WRITE_OFF",
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        quantity,
        fromLocationId: oldStock.locationId,
        toLocationId: oldStock.locationId,
        fromPlacement: oldStock.placement,
        toPlacement: oldStock.placement,
        fromStatus: "USED_NEAR_EXCAVATOR",
        toStatus: "WRITTEN_OFF",
        fromTurntableId: oldStock.turntableId,
        toTurntableId: oldStock.turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function evacuateUsedRopeAction(formData: FormData) {
  const user = await requireUser();
  if (!canWriteOff(user.role)) throw new Error("Недостаточно прав");
  const stockId = intField(formData, "stockId");
  const quantity = positiveIntField(formData, "quantity");
  const comment = "вывезен из-под экскаватора";

  await prisma.$transaction(async (tx) => {
    const oldStock = await removeFromStock(tx, stockId, quantity, user.login);
    const location = await tx.location.findUnique({ where: { id: oldStock.locationId } });
    if (oldStock.status !== "USED_NEAR_EXCAVATOR" || location?.category !== "excavator") {
      throw new Error("Вывезти можно только б/у канат из-под экскаватора");
    }
    await addToStock(
      tx,
      {
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        locationId: oldStock.locationId,
        placement: oldStock.placement,
        status: "WRITTEN_OFF"
      },
      quantity,
      user.login
    );
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "WRITE_OFF",
        ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter,
        length: oldStock.length,
        quantity,
        fromLocationId: oldStock.locationId,
        toLocationId: oldStock.locationId,
        fromPlacement: oldStock.placement,
        toPlacement: oldStock.placement,
        fromStatus: "USED_NEAR_EXCAVATOR",
        toStatus: "WRITTEN_OFF",
        fromTurntableId: oldStock.turntableId,
        toTurntableId: oldStock.turntableId,
        comment
      }
    });
  });

  revalidatePath("/rope");
}

export async function saveLocationAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  const name = textField(formData, "name");
  const category = allowedValue(formData.get("category"), locationCategories, "Категория");

  if (id) {
    await prisma.location.update({ where: { id }, data: { name, category } });
  } else {
    await prisma.location.create({ data: { name, category } });
  }
  revalidatePath("/rope");
}

export async function saveRopeTypeAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const name = textField(formData, "name");
  const standardLength = positiveIntField(formData, "standardLength");
  const defaultDiameter = textField(formData, "defaultDiameter");
  if (!name) throw new Error("Нужно указать название типа каната");
  if (!defaultDiameter) throw new Error("Нужно указать диаметр");

  await prisma.ropeType.create({
    data: { name, standardLength, defaultDiameter }
  });
  revalidatePath("/rope");
}

export async function deleteRopeTypeAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  if (!id) throw new Error("Тип каната не выбран");

  const ropeType = await prisma.ropeType.findUnique({ where: { id } });
  if (!ropeType) throw new Error("Тип каната не найден");

  await prisma.ropeType.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/rope");
}

export async function deleteLocationAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  if (!id) throw new Error("Место не выбрано");

  const location = await prisma.location.findUnique({ where: { id } });
  if (!location) throw new Error("Место не найдено");
  if (location.name === "Вешала под 30т краном") {
    throw new Error("Основное место под краном удалить нельзя");
  }

  await prisma.location.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/rope");
}

export async function createRequestAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageRequests(user.role)) throw new Error("Недостаточно прав");
  const { ropeTypeId, diameter, length } = await getNormalizedRopeInput(formData);
  const quantity = positiveIntField(formData, "quantity");
  const fromLocationId = intField(formData, "fromLocationId");
  const toLocationId = intField(formData, "toLocationId");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    await tx.mechanicRequest.create({
      data: { ropeTypeId, diameter, length, quantity, fromLocationId, toLocationId, comment, createdById: user.id }
    });
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "CREATE_REQUEST",
        ropeTypeId,
        diameter,
        length,
        quantity,
        fromLocationId,
        toLocationId,
        comment
      }
    });
  });
  revalidatePath("/rope");
}

export async function updateRequestStatusAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageRequests(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  const status = allowedValue(formData.get("status"), requestStatuses, "Статус заявки");
  const request = await prisma.mechanicRequest.update({ where: { id }, data: { status } });
  if (status === "DONE") {
    await prisma.ropeMovement.create({
      data: {
        operationId: randomUUID(),
        userId: user.id,
        action: "COMPLETE_REQUEST",
        ropeTypeId: request.ropeTypeId,
        diameter: request.diameter,
        length: request.length,
        quantity: request.quantity,
        fromLocationId: request.fromLocationId,
        toLocationId: request.toLocationId,
        comment: request.comment
      }
    });
  }
  revalidatePath("/rope");
}

function toothLocationText(location?: { name: string } | null, customLocation?: string | null) {
  return customLocation || location?.name || "";
}

async function changeToothStock(
  tx: Prisma.TransactionClient,
  binId: number,
  toothTypeId: number,
  condition: string,
  delta: number,
  userLogin: string
) {
  const stock = await tx.toothStock.findFirst({
    where: { binId, toothTypeId, condition }
  });
  if (delta < 0 && (!stock || stock.quantity < Math.abs(delta))) {
    throw new Error(condition === "NEW" ? "Недостаточно новых зубьев" : "Недостаточно зубьев Б/У");
  }
  if (stock) {
    return tx.toothStock.update({
      where: { id: stock.id },
      data: {
        quantity: stock.quantity + delta,
        lastChangedAt: new Date(),
        lastChangedBy: userLogin
      }
    });
  }
  if (delta < 0) throw new Error("Недостаточно зубьев");
  return tx.toothStock.create({
    data: {
      binId,
      toothTypeId,
      condition,
      quantity: delta,
      lastChangedBy: userLogin
    }
  });
}

function toothTargetLocation(formData: FormData) {
  const locationValue = textField(formData, "locationId") || textField(formData, "toLocationId");
  const customLocation = textField(formData, "customLocation");
  const locationId = locationValue === "custom" ? null : Number(locationValue) || null;
  if (!locationId && !customLocation) throw new Error("Нужно выбрать место");
  return { locationId, customLocation: locationId ? null : customLocation };
}

function toothTypeMatchesExcavator(toothTypeName: string, excavatorName: string) {
  if (toothTypeName.includes("ЭКГ-20")) return excavatorName.includes("ЭКГ-20");
  return !excavatorName.includes("ЭКГ-20");
}

export async function saveToothBinAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  const name = textField(formData, "name");
  const { locationId, customLocation } = toothTargetLocation(formData);
  if (!name) throw new Error("Нужно указать название пены");

  if (id) {
    await prisma.toothBin.update({
      where: { id },
      data: {
        name,
        currentLocationId: locationId,
        customLocation,
        isActive: true,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
  } else {
    await prisma.toothBin.create({
      data: {
        name,
        currentLocationId: locationId,
        customLocation,
        lastChangedBy: user.login
      }
    });
  }

  revalidatePath("/tooth");
}

export async function deleteToothBinAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  if (!id) throw new Error("Пена не выбрана");

  const bin = await prisma.toothBin.findUnique({
    where: { id },
    include: { stocks: { where: { quantity: { gt: 0 } } } }
  });
  if (!bin) throw new Error("Пена не найдена");
  if (bin.name === toothGroundBinName) throw new Error("Землю под 30т краном удалить нельзя");
  if (bin.stocks.length) throw new Error("Удалить можно только пустую пену");

  await prisma.toothBin.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/tooth");
}

export async function saveToothTypeAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const name = textField(formData, "name");
  if (!name) throw new Error("Нужно указать вид зубьев");

  await prisma.toothType.create({ data: { name } });
  revalidatePath("/tooth");
}

export async function deleteToothTypeAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const id = intField(formData, "id");
  if (!id) throw new Error("Вид зубьев не выбран");

  const toothType = await prisma.toothType.findUnique({
    where: { id },
    include: { stocks: { where: { quantity: { gt: 0 } } } }
  });
  if (!toothType) throw new Error("Вид зубьев не найден");
  if (toothType.stocks.length) throw new Error("Удалить можно только вид зубьев без остатков");

  await prisma.toothType.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/tooth");
}

export async function addToothAction(formData: FormData) {
  const user = await requireUser();
  const binId = intField(formData, "binId");
  const toothTypeId = intField(formData, "toothTypeId");
  const condition = allowedValue(formData.get("condition"), toothConditions, "Состояние зубьев");
  const quantity = positiveIntField(formData, "quantity");
  const comment = textField(formData, "comment");
  const { locationId, customLocation } = toothTargetLocation(formData);

  if (!["NEW", "USED"].includes(condition)) throw new Error("Неверное состояние зубьев");

  await prisma.$transaction(async (tx) => {
    const bin = await tx.toothBin.findUnique({ where: { id: binId }, include: { currentLocation: true } });
    if (!bin) throw new Error("Пена не найдена");
    const toLocation = locationId ? await tx.location.findUnique({ where: { id: locationId } }) : null;

    await changeToothStock(tx, binId, toothTypeId, condition, quantity, user.login);
    await tx.toothBin.update({
      where: { id: binId },
      data: {
        currentLocationId: locationId,
        customLocation,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.toothMovement.create({
      data: {
        userId: user.id,
        action: "ADD",
        binId,
        toothTypeId,
        condition,
        quantity,
        fromLocationId: bin.currentLocationId,
        toLocationId: locationId,
        fromLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
        toLocationText: toothLocationText(toLocation, customLocation),
        comment
      }
    });
  });

  revalidatePath("/tooth");
}

export async function adjustToothGroundStockAction(formData: FormData) {
  const user = await requireUser();
  const toothTypeId = intField(formData, "toothTypeId");
  const delta = intField(formData, "delta");
  if (![-1, 1].includes(delta)) throw new Error("Неверное изменение количества");

  await prisma.$transaction(async (tx) => {
    const craneLocation = await tx.location.upsert({
      where: { name: craneLocationName },
      update: { category: "storage", isActive: true },
      create: { name: craneLocationName, category: "storage" }
    });
    const bin = await tx.toothBin.upsert({
      where: { name: toothGroundBinName },
      update: {
        currentLocationId: craneLocation.id,
        customLocation: null,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      },
      create: {
        name: toothGroundBinName,
        currentLocationId: craneLocation.id,
        lastChangedBy: user.login
      },
      include: { currentLocation: true }
    });

    await changeToothStock(tx, bin.id, toothTypeId, "NEW", delta, user.login);
    await tx.toothMovement.create({
      data: {
        userId: user.id,
        action: "ADJUST",
        binId: bin.id,
        toothTypeId,
        condition: "NEW",
        quantity: Math.abs(delta),
        fromLocationId: craneLocation.id,
        toLocationId: craneLocation.id,
        fromLocationText: "Под 30т краном, на земле",
        toLocationText: "Под 30т краном, на земле",
        comment: delta > 0 ? "быстрое добавление зубьев на землю под 30т краном" : "быстрое уменьшение зубьев на земле под 30т краном"
      }
    });
  });

  revalidatePath("/tooth");
}

export async function loadToothBinFromGroundAction(formData: FormData) {
  const user = await requireUser();
  const binId = intField(formData, "binId");
  const toothTypeId = intField(formData, "toothTypeId");
  const quantity = positiveIntField(formData, "quantity");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    const groundBin = await tx.toothBin.findUnique({
      where: { name: toothGroundBinName },
      include: { currentLocation: true }
    });
    if (!groundBin) throw new Error("На земле нет зубьев");

    const targetBin = await tx.toothBin.findUnique({
      where: { id: binId },
      include: { currentLocation: true }
    });
    if (!targetBin) throw new Error("Пена не найдена");
    if (targetBin.name === toothGroundBinName) throw new Error("Нельзя загрузить зубья в землю");

    await changeToothStock(tx, groundBin.id, toothTypeId, "NEW", -quantity, user.login);
    await changeToothStock(tx, targetBin.id, toothTypeId, "NEW", quantity, user.login);
    await tx.toothBin.update({
      where: { id: targetBin.id },
      data: { lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.toothMovement.create({
      data: {
        userId: user.id,
        action: "MOVE",
        binId: targetBin.id,
        toothTypeId,
        condition: "NEW",
        quantity,
        fromLocationId: groundBin.currentLocationId,
        toLocationId: targetBin.currentLocationId,
        fromLocationText: "Под 30т краном, на земле",
        toLocationText: toothLocationText(targetBin.currentLocation, targetBin.customLocation),
        comment: comment || "загружено в Пену с земли"
      }
    });
  });

  revalidatePath("/tooth");
}

export async function moveToothBinAction(formData: FormData) {
  const user = await requireUser();
  const binId = intField(formData, "binId");
  const comment = textField(formData, "comment");
  const { locationId, customLocation } = toothTargetLocation(formData);

  await prisma.$transaction(async (tx) => {
    const bin = await tx.toothBin.findUnique({ where: { id: binId }, include: { currentLocation: true } });
    if (!bin) throw new Error("Пена не найдена");
    const toLocation = locationId ? await tx.location.findUnique({ where: { id: locationId } }) : null;

    await tx.toothBin.update({
      where: { id: binId },
      data: {
        currentLocationId: locationId,
        customLocation,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.toothMovement.create({
      data: {
        userId: user.id,
        action: "MOVE",
        binId,
        fromLocationId: bin.currentLocationId,
        toLocationId: locationId,
        fromLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
        toLocationText: toothLocationText(toLocation, customLocation),
        comment
      }
    });
  });

  revalidatePath("/tooth");
}

export async function installToothAction(formData: FormData) {
  const user = await requireUser();
  const binId = intField(formData, "binId");
  const toothTypeId = intField(formData, "toothTypeId");
  const excavatorLocationId = intField(formData, "excavatorLocationId");
  const quantity = positiveIntField(formData, "quantity");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    const bin = await tx.toothBin.findUnique({ where: { id: binId }, include: { currentLocation: true } });
    if (!bin) throw new Error("Пена не найдена");
    if (!bin.currentLocationId || bin.currentLocationId !== excavatorLocationId || bin.currentLocation?.category !== "excavator") {
      throw new Error("Установка доступна только когда Пена находится под выбранным экскаватором");
    }
    const toothType = await tx.toothType.findUnique({ where: { id: toothTypeId } });
    if (!toothType) throw new Error("Вид зубьев не найден");
    if (!toothTypeMatchesExcavator(toothType.name, bin.currentLocation.name)) {
      throw new Error("Вид зубьев не соответствует выбранному экскаватору");
    }

    await changeToothStock(tx, binId, toothTypeId, "NEW", -quantity, user.login);
    await changeToothStock(tx, binId, toothTypeId, "USED", quantity, user.login);
    await tx.toothBin.update({
      where: { id: binId },
      data: { lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.toothMovement.create({
      data: {
        userId: user.id,
        action: "INSTALL",
        binId,
        toothTypeId,
        condition: "NEW",
        quantity,
        fromLocationId: bin.currentLocationId,
        toLocationId: bin.currentLocationId,
        fromLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
        toLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
        excavatorLocationId,
        comment: comment || `Установлено ${quantity} шт, возвращено ${quantity} шт Б/У`
      }
    });
  });

  revalidatePath("/tooth");
}

export async function scrapToothBinAction(formData: FormData) {
  const user = await requireUser();
  if (!canWriteOff(user.role)) throw new Error("Недостаточно прав");
  const binId = intField(formData, "binId");

  await prisma.$transaction(async (tx) => {
    const bin = await tx.toothBin.findUnique({
      where: { id: binId },
      include: {
        currentLocation: true,
        stocks: {
          where: { condition: "USED", quantity: { gt: 0 } },
          include: { toothType: true }
        }
      }
    });
    if (!bin) throw new Error("Пена не найдена");
    if (bin.currentLocation?.name !== "Вешала под 30т краном") {
      throw new Error("Разгрузка в лом доступна только под 30т краном");
    }
    if (!bin.stocks.length) throw new Error("В пене нет Б/У зубьев");

    for (const stock of bin.stocks) {
      await changeToothStock(tx, binId, stock.toothTypeId, "USED", -stock.quantity, user.login);
      await tx.toothMovement.create({
        data: {
          userId: user.id,
          action: "SCRAP",
          binId,
          toothTypeId: stock.toothTypeId,
          condition: "USED",
          quantity: stock.quantity,
          fromLocationId: bin.currentLocationId,
          toLocationId: bin.currentLocationId,
          fromLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
          toLocationText: "металлолом",
          comment: "разгружены в металлолом"
        }
      });
    }

    await tx.toothBin.update({
      where: { id: binId },
      data: { lastChangedAt: new Date(), lastChangedBy: user.login }
    });
  });

  revalidatePath("/tooth");
}

export async function writeOffToothAction(formData: FormData) {
  const user = await requireUser();
  if (!canWriteOff(user.role)) throw new Error("Недостаточно прав");
  const binId = intField(formData, "binId");
  const toothTypeId = intField(formData, "toothTypeId");
  const quantity = positiveIntField(formData, "quantity");
  const reason = textField(formData, "reason");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    const bin = await tx.toothBin.findUnique({ where: { id: binId }, include: { currentLocation: true } });
    if (!bin) throw new Error("Пена не найдена");
    await changeToothStock(tx, binId, toothTypeId, "USED", -quantity, user.login);
    await tx.toothBin.update({
      where: { id: binId },
      data: { lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.toothMovement.create({
      data: {
        userId: user.id,
        action: "WRITE_OFF",
        binId,
        toothTypeId,
        condition: "USED",
        quantity,
        fromLocationId: bin.currentLocationId,
        toLocationId: bin.currentLocationId,
        fromLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
        toLocationText: toothLocationText(bin.currentLocation, bin.customLocation),
        comment: [reason, comment].filter(Boolean).join("; ")
      }
    });
  });

  revalidatePath("/tooth");
}

function assemblyPlaceText(horizon?: { name: string } | null, status?: string | null) {
  if (status === "REPAIR") return "Ремонт";
  return horizon?.name || "Место не указано";
}

export async function saveAssemblyHorizonAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Редактирование горизонтов доступно кладовщику");
  const rawValue = textField(formData, "value").replace("+", "");
  const value = Number(rawValue);
  if (!Number.isInteger(value)) throw new Error("Горизонт должен быть целым числом");
  const name = `Горизонт ${value > 0 ? `+${value}` : value}`;

  await prisma.assemblyHorizon.upsert({
    where: { name },
    update: { sortOrder: value, isActive: true },
    create: { name, sortOrder: value }
  });
  revalidatePath("/assembly");
}

export async function deleteAssemblyHorizonAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Редактирование горизонтов доступно кладовщику");
  const id = intField(formData, "id");
  const horizon = await prisma.assemblyHorizon.findUnique({
    where: { id },
    include: { assemblies: true }
  });
  if (!horizon) throw new Error("Горизонт не найден");
  if (horizon.assemblies.length) throw new Error("Нельзя удалить горизонт, на котором есть сборки");

  await prisma.assemblyHorizon.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/assembly");
}

export async function saveAssemblyAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Добавление сборок доступно кладовщику");
  const name = textField(formData, "name");
  const horizonId = optionalIntField(formData, "horizonId");
  const length = optionalIntField(formData, "length");
  const comment = textField(formData, "comment");
  if (!name) throw new Error("Введите название сборки");
  if (length !== null && (!Number.isInteger(length) || length < 1)) throw new Error("Длина должна быть положительным числом");

  await prisma.$transaction(async (tx) => {
    const horizon = horizonId ? await tx.assemblyHorizon.findUnique({ where: { id: horizonId } }) : null;
    if (horizonId && (!horizon || !horizon.isActive)) throw new Error("Горизонт не найден");
    const assembly = await tx.assembly.create({
      data: {
        name,
        horizonId,
        length,
        comment: comment || null,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.assemblyMovement.create({
      data: {
        userId: user.id,
        action: "ADD",
        assemblyId: assembly.id,
        toHorizonId: horizonId,
        toPlaceText: assemblyPlaceText(horizon, "WORKING"),
        newLength: length,
        comment
      }
    });
  });

  revalidatePath("/assembly");
}

export async function moveAssemblyAction(formData: FormData) {
  const user = await requireUser();
  const assemblyId = intField(formData, "assemblyId");
  const target = textField(formData, "target");
  const comment = textField(formData, "comment");

  await prisma.$transaction(async (tx) => {
    const assembly = await tx.assembly.findUnique({
      where: { id: assemblyId },
      include: { horizon: true }
    });
    if (!assembly) throw new Error("Сборка не найдена");
    if (assembly.isPowered) throw new Error("Запитанную сборку нельзя перемещать. Сначала отключите экскаватор");
    if (assembly.status === "REPAIR") throw new Error("Сборка в ремонте. Сначала верните ее из ремонта");

    const toRepair = target === "repair";
    const toHorizonId = toRepair ? null : Number(target);
    if (!toRepair && !toHorizonId) throw new Error("Выберите горизонт");
    const toHorizon = toHorizonId ? await tx.assemblyHorizon.findUnique({ where: { id: toHorizonId } }) : null;
    if (!toRepair && (!toHorizon || !toHorizon.isActive)) throw new Error("Горизонт не найден");

    await tx.assembly.update({
      where: { id: assemblyId },
      data: {
        horizonId: toHorizonId,
        status: toRepair ? "REPAIR" : "WORKING",
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.assemblyMovement.create({
      data: {
        userId: user.id,
        action: "MOVE",
        assemblyId,
        fromHorizonId: assembly.horizonId,
        toHorizonId,
        fromPlaceText: assemblyPlaceText(assembly.horizon, assembly.status),
        toPlaceText: toRepair ? "Ремонт" : assemblyPlaceText(toHorizon, "WORKING"),
        comment
      }
    });
  });

  revalidatePath("/assembly");
}

export async function restoreAssemblyFromRepairAction(formData: FormData) {
  const user = await requireUser();
  const assemblyId = intField(formData, "assemblyId");

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: {
      status: "WORKING",
      lastChangedAt: new Date(),
      lastChangedBy: user.login
    }
  });
  revalidatePath("/assembly");
}

export async function powerAssemblyAction(formData: FormData) {
  const user = await requireUser();
  const assemblyId = intField(formData, "assemblyId");
  const excavatorLocationId = intField(formData, "excavatorLocationId");

  await prisma.$transaction(async (tx) => {
    const assembly = await tx.assembly.findUnique({ where: { id: assemblyId } });
    if (!assembly) throw new Error("Сборка не найдена");
    if (assembly.status === "REPAIR") throw new Error("Сборка в ремонте");
    if (!assembly.horizonId) throw new Error("Сначала перенесите сборку на горизонт");
    const excavator = await tx.location.findUnique({ where: { id: excavatorLocationId } });
    if (!excavator || excavator.category !== "excavator") throw new Error("Выберите экскаватор");

    await tx.assembly.update({
      where: { id: assemblyId },
      data: {
        isPowered: true,
        excavatorLocationId,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
  });

  revalidatePath("/assembly");
}

export async function unpowerAssemblyAction(formData: FormData) {
  const user = await requireUser();
  const assemblyId = intField(formData, "assemblyId");

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: {
      isPowered: false,
      excavatorLocationId: null,
      lastChangedAt: new Date(),
      lastChangedBy: user.login
    }
  });
  revalidatePath("/assembly");
}

export async function updateAssemblyLengthAction(formData: FormData) {
  const user = await requireUser();
  const assemblyId = intField(formData, "assemblyId");
  const length = optionalIntField(formData, "length");
  const comment = textField(formData, "comment");
  if (length !== null && (!Number.isInteger(length) || length < 1)) throw new Error("Длина должна быть положительным числом");

  await prisma.$transaction(async (tx) => {
    const assembly = await tx.assembly.findUnique({ where: { id: assemblyId } });
    if (!assembly) throw new Error("Сборка не найдена");
    await tx.assembly.update({
      where: { id: assemblyId },
      data: {
        length,
        comment: comment || null,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.assemblyMovement.create({
      data: {
        userId: user.id,
        action: "LENGTH",
        assemblyId,
        oldLength: assembly.length,
        newLength: length,
        comment
      }
    });
  });

  revalidatePath("/assembly");
}

export async function undoAssemblyMovementAction(formData: FormData) {
  const user = await requireUser();
  const movementId = intField(formData, "movementId");

  await prisma.$transaction(async (tx) => {
    const recent = await tx.assemblyMovement.findMany({
      where: { userId: user.id, action: { in: ["MOVE", "LENGTH"] } },
      orderBy: { createdAt: "desc" },
      take: 3
    });
    if (!recent.some((movement) => movement.id === movementId)) {
      throw new Error("Откат доступен только для последних 3 действий текущего пользователя");
    }
    const movement = await tx.assemblyMovement.findUnique({ where: { id: movementId } });
    if (!movement || movement.userId !== user.id) throw new Error("Запись истории не найдена");

    if (movement.action === "MOVE") {
      const assembly = await tx.assembly.findUnique({ where: { id: movement.assemblyId } });
      if (!assembly) throw new Error("Сборка не найдена");
      if (assembly.isPowered) throw new Error("Нельзя откатить перенос запитанной сборки");
      await tx.assembly.update({
        where: { id: movement.assemblyId },
        data: {
          horizonId: movement.fromHorizonId,
          status: movement.fromHorizonId ? "WORKING" : movement.fromPlaceText === "Ремонт" ? "REPAIR" : "WORKING",
          lastChangedAt: new Date(),
          lastChangedBy: user.login
        }
      });
    } else if (movement.action === "LENGTH") {
      await tx.assembly.update({
        where: { id: movement.assemblyId },
        data: {
          length: movement.oldLength,
          lastChangedAt: new Date(),
          lastChangedBy: user.login
        }
      });
    } else {
      throw new Error("Это действие нельзя откатить");
    }

    await tx.assemblyMovement.delete({ where: { id: movement.id } });
  });

  revalidatePath("/assembly");
}

export async function undoToothMovementAction(formData: FormData) {
  const user = await requireUser();
  const movementId = intField(formData, "movementId");

  await prisma.$transaction(async (tx) => {
    const recent = await tx.toothMovement.findMany({
      where: { userId: user.id, action: { in: ["ADD", "ADJUST", "MOVE", "INSTALL", "WRITE_OFF", "SCRAP"] } },
      orderBy: { createdAt: "desc" },
      take: 3
    });
    if (!recent.some((movement) => movement.id === movementId)) {
      throw new Error("Откат доступен только для последних 3 действий текущего пользователя");
    }
    const movement = await tx.toothMovement.findUnique({ where: { id: movementId } });
    if (!movement || movement.userId !== user.id) throw new Error("Запись истории не найдена");

    if (movement.action === "ADD") {
      if (!movement.toothTypeId || !movement.condition || !movement.quantity) throw new Error("Недостаточно данных для отката");
      await changeToothStock(tx, movement.binId, movement.toothTypeId, movement.condition, -movement.quantity, user.login);
      await tx.toothBin.update({
        where: { id: movement.binId },
        data: { currentLocationId: movement.fromLocationId, customLocation: null, lastChangedAt: new Date(), lastChangedBy: user.login }
      });
    } else if (movement.action === "ADJUST") {
      if (!movement.toothTypeId || !movement.condition || !movement.quantity) throw new Error("Недостаточно данных для отката");
      const wasDecrease = movement.comment?.toLowerCase().includes("уменьш") || movement.comment?.includes("-1");
      await changeToothStock(tx, movement.binId, movement.toothTypeId, movement.condition, wasDecrease ? movement.quantity : -movement.quantity, user.login);
    } else if (movement.action === "MOVE" && movement.toothTypeId && movement.condition && movement.quantity) {
      const groundBin = await tx.toothBin.findUnique({ where: { name: toothGroundBinName } });
      if (!groundBin) throw new Error("Земля под 30т краном не найдена");
      await changeToothStock(tx, movement.binId, movement.toothTypeId, movement.condition, -movement.quantity, user.login);
      await changeToothStock(tx, groundBin.id, movement.toothTypeId, movement.condition, movement.quantity, user.login);
    } else if (movement.action === "MOVE") {
      await tx.toothBin.update({
        where: { id: movement.binId },
        data: { currentLocationId: movement.fromLocationId, customLocation: movement.fromLocationId ? null : movement.fromLocationText, lastChangedAt: new Date(), lastChangedBy: user.login }
      });
    } else if (movement.action === "INSTALL") {
      if (!movement.toothTypeId || !movement.quantity) throw new Error("Недостаточно данных для отката");
      await changeToothStock(tx, movement.binId, movement.toothTypeId, "USED", -movement.quantity, user.login);
      await changeToothStock(tx, movement.binId, movement.toothTypeId, "NEW", movement.quantity, user.login);
    } else if (movement.action === "WRITE_OFF" || movement.action === "SCRAP") {
      if (!movement.toothTypeId || !movement.condition || !movement.quantity) throw new Error("Недостаточно данных для отката");
      await changeToothStock(tx, movement.binId, movement.toothTypeId, movement.condition, movement.quantity, user.login);
    } else {
      throw new Error("Это действие нельзя откатить");
    }

    await tx.toothMovement.delete({ where: { id: movement.id } });
  });

  revalidatePath("/tooth");
}

export type ToothGroundAdjustState = {
  error: string | null;
};

export async function adjustToothGroundStockFormAction(
  _previousState: ToothGroundAdjustState,
  formData: FormData
): Promise<ToothGroundAdjustState> {
  try {
    await adjustToothGroundStockAction(formData);
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Не удалось изменить количество зубьев"
    };
  }
}

type YaknoSnapshot = {
  boxes: Array<{
    id: number;
    excavatorLocationId: number | null;
    horizonId: number | null;
    isPowered: boolean;
    status: string;
    isActive: boolean;
    comment: string | null;
  }>;
  states: Array<{
    excavatorLocationId: number;
    horizonId: number | null;
  }>;
};

function normalizeYaknoNumber(value: string) {
  return value.trim().replace(/^я/i, "").trim();
}

async function yaknoSnapshot(
  tx: Prisma.TransactionClient,
  boxIds: number[],
  excavatorLocationIds: number[]
): Promise<YaknoSnapshot> {
  const uniqueBoxIds = Array.from(new Set(boxIds.filter(Boolean)));
  const uniqueExcavatorIds = Array.from(new Set(excavatorLocationIds.filter(Boolean)));
  const [boxes, states] = await Promise.all([
    uniqueBoxIds.length ? tx.yaknoBox.findMany({ where: { id: { in: uniqueBoxIds } } }) : Promise.resolve([]),
    uniqueExcavatorIds.length
      ? tx.yaknoExcavatorState.findMany({ where: { excavatorLocationId: { in: uniqueExcavatorIds } } })
      : Promise.resolve([])
  ]);

  return {
    boxes: boxes.map((box) => ({
      id: box.id,
      excavatorLocationId: box.excavatorLocationId,
      horizonId: box.horizonId,
      isPowered: box.isPowered,
      status: box.status,
      isActive: box.isActive,
      comment: box.comment
    })),
    states: states.map((state) => ({
      excavatorLocationId: state.excavatorLocationId,
      horizonId: state.horizonId
    }))
  };
}

async function restoreYaknoSnapshot(tx: Prisma.TransactionClient, snapshot: YaknoSnapshot, userLogin: string) {
  for (const box of snapshot.boxes) {
    await tx.yaknoBox.update({
      where: { id: box.id },
      data: {
        excavatorLocationId: box.excavatorLocationId,
        horizonId: box.horizonId,
        isPowered: box.isPowered,
        status: box.status,
        isActive: box.isActive,
        comment: box.comment,
        lastChangedAt: new Date(),
        lastChangedBy: userLogin
      }
    });
  }

  for (const state of snapshot.states) {
    await tx.yaknoExcavatorState.upsert({
      where: { excavatorLocationId: state.excavatorLocationId },
      update: { horizonId: state.horizonId, lastChangedAt: new Date(), lastChangedBy: userLogin },
      create: { excavatorLocationId: state.excavatorLocationId, horizonId: state.horizonId, lastChangedBy: userLogin }
    });
  }
}

export async function saveYaknoExcavatorAction(formData: FormData) {
  const user = await requireUser();
  const excavatorLocationId = intField(formData, "excavatorLocationId");
  const horizonId = optionalIntField(formData, "horizonId");
  const poweredBoxId = optionalIntField(formData, "poweredBoxId");
  const comment = textField(formData, "comment");
  const selectedBoxIds = formData
    .getAll("boxIds")
    .map((item) => Number(item))
    .filter(Boolean);
  if (poweredBoxId && !selectedBoxIds.includes(poweredBoxId)) selectedBoxIds.unshift(poweredBoxId);

  await prisma.$transaction(async (tx) => {
    const excavator = await tx.location.findUnique({ where: { id: excavatorLocationId } });
    if (!excavator || excavator.category !== "excavator") throw new Error("Выберите экскаватор");
    const horizon = horizonId ? await tx.assemblyHorizon.findUnique({ where: { id: horizonId } }) : null;
    if (horizonId && (!horizon || !horizon.isActive)) throw new Error("Горизонт не найден");

    const currentBoxes = await tx.yaknoBox.findMany({ where: { excavatorLocationId, isActive: true } });
    const selectedBoxes = selectedBoxIds.length
      ? await tx.yaknoBox.findMany({ where: { id: { in: selectedBoxIds }, isActive: true } })
      : [];
    if (selectedBoxes.length !== selectedBoxIds.length) throw new Error("ЯКНО не найден");
    if (selectedBoxes.some((box) => box.status === "REPAIR")) throw new Error("ЯКНО в ремонте нельзя выбрать");

    const involvedBoxIds = Array.from(new Set([...currentBoxes.map((box) => box.id), ...selectedBoxIds]));
    const involvedExcavatorIds = Array.from(
      new Set([
        excavatorLocationId,
        ...currentBoxes.map((box) => box.excavatorLocationId).filter(Boolean) as number[],
        ...selectedBoxes.map((box) => box.excavatorLocationId).filter(Boolean) as number[]
      ])
    );
    const before = await yaknoSnapshot(tx, involvedBoxIds, involvedExcavatorIds);

    await tx.yaknoExcavatorState.upsert({
      where: { excavatorLocationId },
      update: { horizonId, lastChangedAt: new Date(), lastChangedBy: user.login },
      create: { excavatorLocationId, horizonId, lastChangedBy: user.login }
    });

    for (const box of currentBoxes) {
      if (!selectedBoxIds.includes(box.id)) {
        await tx.yaknoBox.update({
          where: { id: box.id },
          data: {
            excavatorLocationId: null,
            horizonId,
            isPowered: false,
            lastChangedAt: new Date(),
            lastChangedBy: user.login
          }
        });
      }
    }

    for (const boxId of selectedBoxIds) {
      await tx.yaknoBox.update({
        where: { id: boxId },
        data: {
          excavatorLocationId,
          horizonId,
          isPowered: poweredBoxId === boxId,
          status: "ACTIVE",
          ...(comment ? { comment } : {}),
          lastChangedAt: new Date(),
          lastChangedBy: user.login
        }
      });
    }

    const after = await yaknoSnapshot(tx, involvedBoxIds, involvedExcavatorIds);
    await tx.yaknoMovement.create({
      data: {
        userId: user.id,
        action: "SET_EXCAVATOR",
        excavatorLocationId,
        toHorizonId: horizonId,
        fromText: JSON.stringify(before),
        toText: JSON.stringify(after),
        beforeState: JSON.stringify(before),
        afterState: JSON.stringify(after),
        comment
      }
    });
  });

  revalidatePath("/yakno");
}

export async function saveFreeYaknoHorizonAction(formData: FormData) {
  const user = await requireUser();
  const boxId = intField(formData, "boxId");
  const horizonId = optionalIntField(formData, "horizonId");

  await prisma.$transaction(async (tx) => {
    const box = await tx.yaknoBox.findUnique({ where: { id: boxId } });
    if (!box || !box.isActive) throw new Error("ЯКНО не найден");
    if (box.status === "REPAIR") throw new Error("ЯКНО в ремонте");
    const before = await yaknoSnapshot(tx, [boxId], box.excavatorLocationId ? [box.excavatorLocationId] : []);
    await tx.yaknoBox.update({
      where: { id: boxId },
      data: {
        excavatorLocationId: null,
        horizonId,
        isPowered: false,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    const after = await yaknoSnapshot(tx, [boxId], []);
    await tx.yaknoMovement.create({
      data: {
        userId: user.id,
        action: "FREE_HORIZON",
        boxId,
        fromHorizonId: box.horizonId,
        toHorizonId: horizonId,
        beforeState: JSON.stringify(before),
        afterState: JSON.stringify(after)
      }
    });
  });

  revalidatePath("/yakno");
}

export async function saveYaknoBoxAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Добавление ЯКНО доступно кладовщику");
  const number = normalizeYaknoNumber(textField(formData, "number"));
  if (!number) throw new Error("Введите номер ЯКНО");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.yaknoBox.findUnique({ where: { number } });
    const box = await tx.yaknoBox.upsert({
      where: { number },
      update: { isActive: true, status: "ACTIVE", lastChangedAt: new Date(), lastChangedBy: user.login },
      create: { number, lastChangedBy: user.login }
    });
    const after = await yaknoSnapshot(tx, [box.id], []);
    await tx.yaknoMovement.create({
      data: {
        userId: user.id,
        action: "ADD",
        boxId: box.id,
        beforeState: JSON.stringify({ boxes: existing ? [existing] : [], states: [] }),
        afterState: JSON.stringify(after),
        comment: textField(formData, "comment")
      }
    });
  });

  revalidatePath("/yakno");
}

export async function deleteYaknoBoxAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Удаление ЯКНО доступно кладовщику");
  const boxId = intField(formData, "boxId");

  await prisma.$transaction(async (tx) => {
    const box = await tx.yaknoBox.findUnique({ where: { id: boxId } });
    if (!box || !box.isActive) throw new Error("ЯКНО не найден");
    if (box.excavatorLocationId) throw new Error("Сначала уберите ЯКНО от экскаватора");
    const before = await yaknoSnapshot(tx, [boxId], []);
    await tx.yaknoBox.update({
      where: { id: boxId },
      data: { isActive: false, isPowered: false, lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    const after = await yaknoSnapshot(tx, [boxId], []);
    await tx.yaknoMovement.create({
      data: {
        userId: user.id,
        action: "DELETE",
        boxId,
        beforeState: JSON.stringify(before),
        afterState: JSON.stringify(after)
      }
    });
  });

  revalidatePath("/yakno");
}

export async function repairYaknoBoxAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Ремонт ЯКНО доступен кладовщику");
  const boxId = intField(formData, "boxId");

  await prisma.$transaction(async (tx) => {
    const box = await tx.yaknoBox.findUnique({ where: { id: boxId } });
    if (!box || !box.isActive) throw new Error("ЯКНО не найден");
    const before = await yaknoSnapshot(tx, [boxId], box.excavatorLocationId ? [box.excavatorLocationId] : []);
    await tx.yaknoBox.update({
      where: { id: boxId },
      data: {
        status: "REPAIR",
        excavatorLocationId: null,
        isPowered: false,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    const after = await yaknoSnapshot(tx, [boxId], []);
    await tx.yaknoMovement.create({
      data: {
        userId: user.id,
        action: "REPAIR",
        boxId,
        beforeState: JSON.stringify(before),
        afterState: JSON.stringify(after)
      }
    });
  });

  revalidatePath("/yakno");
}

export async function restoreYaknoBoxAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Ремонт ЯКНО доступен кладовщику");
  const boxId = intField(formData, "boxId");

  await prisma.$transaction(async (tx) => {
    const box = await tx.yaknoBox.findUnique({ where: { id: boxId } });
    if (!box || !box.isActive) throw new Error("ЯКНО не найден");
    const before = await yaknoSnapshot(tx, [boxId], []);
    await tx.yaknoBox.update({
      where: { id: boxId },
      data: { status: "ACTIVE", lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    const after = await yaknoSnapshot(tx, [boxId], []);
    await tx.yaknoMovement.create({
      data: {
        userId: user.id,
        action: "RESTORE",
        boxId,
        beforeState: JSON.stringify(before),
        afterState: JSON.stringify(after)
      }
    });
  });

  revalidatePath("/yakno");
}

export async function undoYaknoMovementAction(formData: FormData) {
  const user = await requireUser();
  const movementId = intField(formData, "movementId");

  await prisma.$transaction(async (tx) => {
    const recent = await tx.yaknoMovement.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 3
    });
    if (!recent.some((movement) => movement.id === movementId)) {
      throw new Error("Откат доступен только для последних 3 действий текущего пользователя");
    }
    const movement = await tx.yaknoMovement.findUnique({ where: { id: movementId } });
    if (!movement || movement.userId !== user.id || !movement.beforeState) throw new Error("Запись истории не найдена");

    await restoreYaknoSnapshot(tx, JSON.parse(movement.beforeState) as YaknoSnapshot, user.login);
    if (movement.action === "ADD" && movement.boxId) {
      const before = JSON.parse(movement.beforeState) as YaknoSnapshot;
      if (!before.boxes.some((box) => box.id === movement.boxId)) {
        await tx.yaknoBox.update({
          where: { id: movement.boxId },
          data: { isActive: false, lastChangedAt: new Date(), lastChangedBy: user.login }
        });
      }
    }
    await tx.yaknoMovement.delete({ where: { id: movement.id } });
  });

  revalidatePath("/yakno");
}

function ppSectorNames(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function savePpEquipmentAction(formData: FormData) {
  const user = await requireUser();
  const pointId = intField(formData, "pointId");
  const equipmentLocationId = optionalIntField(formData, "equipmentLocationId");

  await prisma.$transaction(async (tx) => {
    const point = await tx.ppPoint.findUnique({ where: { id: pointId }, include: { equipmentLocation: true } });
    if (!point || !point.isActive) throw new Error("П/П не найден");
    const equipment = equipmentLocationId ? await tx.location.findUnique({ where: { id: equipmentLocationId } }) : null;
    if (equipmentLocationId && (!equipment || !equipment.isActive || !["excavator", "loader"].includes(equipment.category))) {
      throw new Error("Выберите технику");
    }

    await tx.ppPoint.update({
      where: { id: pointId },
      data: {
        equipmentLocationId,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.ppMovement.create({
      data: {
        userId: user.id,
        action: "SET_EQUIPMENT",
        ppPointId: pointId,
        equipmentLocationId,
        fromText: point.equipmentLocation?.name ?? "Без техники",
        toText: equipment?.name ?? "Без техники"
      }
    });
  });

  revalidatePath("/pp");
}

export async function adjustPpSectorAction(formData: FormData) {
  const user = await requireUser();
  const sectorId = intField(formData, "sectorId");
  const delta = intField(formData, "delta");
  if (![1, -1].includes(delta)) throw new Error("Некорректное изменение");

  await prisma.$transaction(async (tx) => {
    const sector = await tx.ppSector.findUnique({ where: { id: sectorId }, include: { ppPoint: true } });
    if (!sector || !sector.isActive || !sector.ppPoint.isActive) throw new Error("Сектор не найден");
    const nextQuantity = sector.quantity + delta;
    if (nextQuantity < 0) throw new Error("Количество не может быть меньше нуля");

    await tx.ppSector.update({
      where: { id: sectorId },
      data: {
        quantity: nextQuantity,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.ppPoint.update({
      where: { id: sector.ppPointId },
      data: { lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.ppMovement.create({
      data: {
        userId: user.id,
        action: "ADJUST_SECTOR",
        ppPointId: sector.ppPointId,
        sectorId,
        oldQuantity: sector.quantity,
        newQuantity: nextQuantity,
        fromText: `${sector.name} - ${sector.quantity}`,
        toText: `${sector.name} - ${nextQuantity}`
      }
    });
  });

  revalidatePath("/pp");
}

export async function setPpSectorMaterialAction(formData: FormData) {
  const user = await requireUser();
  const sectorId = intField(formData, "sectorId");
  const material = textField(formData, "material");
  if (!["ORE", "OVERBURDEN"].includes(material)) throw new Error("Выберите руду или вскрышу");

  await prisma.$transaction(async (tx) => {
    const sector = await tx.ppSector.findUnique({ where: { id: sectorId }, include: { ppPoint: true } });
    if (!sector || !sector.isActive || !sector.ppPoint.isActive) throw new Error("Сектор не найден");
    if (sector.material === material) return;

    await tx.ppSector.update({
      where: { id: sectorId },
      data: {
        material,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      }
    });
    await tx.ppPoint.update({
      where: { id: sector.ppPointId },
      data: { lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.ppMovement.create({
      data: {
        userId: user.id,
        action: "SET_MATERIAL",
        ppPointId: sector.ppPointId,
        sectorId,
        fromText: sector.material,
        toText: material
      }
    });
  });

  revalidatePath("/pp");
}

export async function savePpPointAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Редактирование П/П доступно кладовщику");
  const name = textField(formData, "name");
  const sectorNames = ppSectorNames(textField(formData, "sectors"));
  const equipmentLocationId = optionalIntField(formData, "equipmentLocationId");
  if (!name) throw new Error("Введите номер П/П");

  await prisma.$transaction(async (tx) => {
    const equipment = equipmentLocationId ? await tx.location.findUnique({ where: { id: equipmentLocationId } }) : null;
    if (equipmentLocationId && (!equipment || !equipment.isActive || !["excavator", "loader"].includes(equipment.category))) {
      throw new Error("Выберите технику");
    }
    await tx.location.upsert({
      where: { name },
      update: { category: "transfer_point", isActive: true },
      create: { name, category: "transfer_point" }
    });
    const point = await tx.ppPoint.upsert({
      where: { name },
      update: {
        isActive: true,
        equipmentLocationId,
        lastChangedAt: new Date(),
        lastChangedBy: user.login
      },
      create: { name, equipmentLocationId, lastChangedBy: user.login }
    });

    for (const sectorName of sectorNames) {
      await tx.ppSector.upsert({
        where: { ppPointId_name: { ppPointId: point.id, name: sectorName } },
        update: { isActive: true },
        create: { ppPointId: point.id, name: sectorName, lastChangedBy: user.login }
      });
    }

    await tx.ppMovement.create({
      data: {
        userId: user.id,
        action: "ADD_POINT",
        ppPointId: point.id,
        equipmentLocationId,
        toText: `${name}; сектора ${sectorNames.join(", ") || "-"}`
      }
    });
  });

  revalidatePath("/pp");
}

export async function deletePpPointAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Редактирование П/П доступно кладовщику");
  const pointId = intField(formData, "pointId");

  await prisma.$transaction(async (tx) => {
    const point = await tx.ppPoint.findUnique({ where: { id: pointId } });
    if (!point || !point.isActive) throw new Error("П/П не найден");
    await tx.ppPoint.update({
      where: { id: pointId },
      data: { isActive: false, lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.ppMovement.create({
      data: { userId: user.id, action: "DELETE_POINT", ppPointId: pointId, fromText: point.name }
    });
  });

  revalidatePath("/pp");
}

export async function savePpSectorAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Редактирование П/П доступно кладовщику");
  const pointId = intField(formData, "pointId");
  const name = textField(formData, "name");
  if (!name) throw new Error("Введите сектор");

  await prisma.$transaction(async (tx) => {
    const point = await tx.ppPoint.findUnique({ where: { id: pointId } });
    if (!point || !point.isActive) throw new Error("П/П не найден");
    const sector = await tx.ppSector.upsert({
      where: { ppPointId_name: { ppPointId: pointId, name } },
      update: { isActive: true, lastChangedAt: new Date(), lastChangedBy: user.login },
      create: { ppPointId: pointId, name, lastChangedBy: user.login }
    });
    await tx.ppMovement.create({
      data: { userId: user.id, action: "ADD_SECTOR", ppPointId: pointId, sectorId: sector.id, toText: name }
    });
  });

  revalidatePath("/pp");
}

export async function deletePpSectorAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Редактирование П/П доступно кладовщику");
  const sectorId = intField(formData, "sectorId");

  await prisma.$transaction(async (tx) => {
    const sector = await tx.ppSector.findUnique({ where: { id: sectorId } });
    if (!sector || !sector.isActive) throw new Error("Сектор не найден");
    if (sector.quantity > 0) throw new Error("Сначала обнулите сектор");
    await tx.ppSector.update({
      where: { id: sectorId },
      data: { isActive: false, lastChangedAt: new Date(), lastChangedBy: user.login }
    });
    await tx.ppMovement.create({
      data: { userId: user.id, action: "DELETE_SECTOR", ppPointId: sector.ppPointId, sectorId, fromText: sector.name }
    });
  });

  revalidatePath("/pp");
}

export async function updateSafetyDateAction(formData: FormData) {
  const user = await requireUser();
  const itemId = positiveIntField(formData, "itemId");
  const rawDate = textField(formData, "expiryDate");
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return;

  const year = rawDate ? Number(rawDate.slice(0, 4)) : null;
  if (year !== null && (year < 2000 || year > 2100)) return;

  const newExpiryDate = rawDate ? new Date(`${rawDate}T12:00:00.000Z`) : null;
  if (
    newExpiryDate &&
    (Number.isNaN(newExpiryDate.getTime()) || newExpiryDate.toISOString().slice(0, 10) !== rawDate)
  ) return;

  await prisma.$transaction(async (tx) => {
    const item = await tx.safetyItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("Позиция СИЗ не найдена");

    await tx.safetyItem.update({ where: { id: itemId }, data: { expiryDate: newExpiryDate } });
    await tx.safetyHistory.create({
      data: {
        itemId,
        userId: user.id,
        oldExpiryDate: item.expiryDate,
        newExpiryDate
      }
    });
  });

  revalidatePath("/safety");
}

export async function restoreSafetyExcavatorAction(formData: FormData) {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("Недостаточно прав");
  const locationId = positiveIntField(formData, "locationId");
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location || location.category !== "excavator") throw new Error("Экскаватор не найден");
  await prisma.location.update({ where: { id: locationId }, data: { isActive: true } });
  revalidatePath("/safety");
  revalidatePath("/rope");
}
