"use server";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addToStock, removeFromStock } from "@/lib/stock";
import { allowedValue, loanModes, loanRecipients, positiveInteger, toothConditions } from "@/lib/validation";
import { shouldScrapUnloadedTeeth } from "@/lib/tooth-policy";

const craneLocationName = "Вешала под 30т краном";
const legacyGroundBinName = "Земля под 30т краном";
const intField = (formData: FormData, key: string) => Number(formData.get(key));
const textField = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

async function changeToothStock(
  tx: Prisma.TransactionClient,
  binId: number,
  toothTypeId: number,
  condition: string,
  delta: number,
  userLogin: string
) {
  const stock = await tx.toothStock.findFirst({ where: { binId, toothTypeId, condition } });
  if (delta < 0 && (!stock || stock.quantity < Math.abs(delta))) {
    throw new Error(condition === "NEW" ? "Недостаточно новых зубьев" : "Недостаточно зубьев Б/У");
  }
  if (stock) {
    return tx.toothStock.update({
      where: { id: stock.id },
      data: { quantity: stock.quantity + delta, lastChangedAt: new Date(), lastChangedBy: userLogin }
    });
  }
  if (delta < 0) throw new Error("Недостаточно зубьев");
  return tx.toothStock.create({ data: { binId, toothTypeId, condition, quantity: delta, lastChangedBy: userLogin } });
}

async function groundBinAt(tx: Prisma.TransactionClient, locationId: number, userLogin: string) {
  const location = await tx.location.findUnique({ where: { id: locationId } });
  if (!location?.isActive) throw new Error("Место не найдено или уже в архиве");
  const name = location.name === craneLocationName ? legacyGroundBinName : `Земля #${location.id}: ${location.name}`;
  return tx.toothBin.upsert({
    where: { name },
    update: {
      kind: "GROUND",
      isActive: true,
      currentLocationId: location.id,
      customLocation: null,
      lastChangedAt: new Date(),
      lastChangedBy: userLogin
    },
    create: {
      name,
      kind: "GROUND",
      currentLocationId: location.id,
      lastChangedBy: userLogin
    },
    include: { currentLocation: true }
  });
}

export async function unloadTurntableRopeAction(formData: FormData) {
  const user = await requireUser();
  const stockId = intField(formData, "stockId");
  const quantity = positiveInteger(formData.get("quantity"));
  const toLocationId = intField(formData, "toLocationId");
  const toPlacement = textField(formData, "toPlacement");
  if (!["HANGERS", "GROUND"].includes(toPlacement)) throw new Error("Выберите место разгрузки");

  await prisma.$transaction(async (tx) => {
    const source = await tx.ropeStock.findUnique({ where: { id: stockId } });
    if (!source || source.placement !== "TURNTABLE" || !source.turntableId || source.status !== "AVAILABLE") {
      throw new Error("Канат на вертушке не найден");
    }
    const destination = await tx.location.findUnique({ where: { id: toLocationId } });
    if (!destination?.isActive) throw new Error("Место разгрузки не найдено или уже в архиве");
    if (toPlacement === "HANGERS" && destination.name !== craneLocationName) {
      throw new Error("На вешала можно разгрузить только под 20т краном");
    }

    const oldStock = await removeFromStock(tx, stockId, quantity, user.login);
    await addToStock(tx, {
      ropeTypeId: oldStock.ropeTypeId,
      diameter: oldStock.diameter,
      length: oldStock.length,
      locationId: toLocationId,
      placement: toPlacement,
      status: "AVAILABLE"
    }, quantity, user.login);
    await tx.ropeMovement.create({
      data: {
        operationId: randomUUID(), userId: user.id, action: "MOVE", ropeTypeId: oldStock.ropeTypeId,
        diameter: oldStock.diameter, length: oldStock.length, quantity,
        fromLocationId: oldStock.locationId, toLocationId, fromPlacement: "TURNTABLE", toPlacement,
        fromStatus: "AVAILABLE", toStatus: "AVAILABLE", fromTurntableId: oldStock.turntableId,
        comment: "разгружен с вертушки"
      }
    });
  });
  revalidatePath("/rope");
}

export async function createRopeLoanAction(formData: FormData) {
  const user = await requireUser();
  const stockId = intField(formData, "stockId");
  const quantity = positiveInteger(formData.get("quantity"));
  const mode = allowedValue(formData.get("mode"), loanModes, "Способ выдачи");
  const recipient = allowedValue(formData.get("recipient"), loanRecipients, "Получатель") || null;
  const operationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const selected = await tx.ropeStock.findUnique({ where: { id: stockId } });
    if (!selected || selected.status !== "AVAILABLE" || selected.quantity < quantity) throw new Error("Канат не найден");
    if (mode === "TURNTABLE" && !selected.turntableId) throw new Error("Этот канат находится не на вертушке");

    if (mode === "TURNTABLE") {
      const activeLoan = await tx.ropeLoan.findFirst({ where: { turntableId: selected.turntableId, returnedAt: null } });
      if (activeLoan) throw new Error("Эта вертушка уже выдана в долг");
    }
    const loan = await tx.ropeLoan.create({
      data: {
        recipient,
        includesTurntable: mode === "TURNTABLE",
        turntableId: mode === "TURNTABLE" ? selected.turntableId : null,
        createdById: user.id
      }
    });
    const sources = mode === "TURNTABLE"
      ? await tx.ropeStock.findMany({
          where: { turntableId: selected.turntableId, status: "AVAILABLE", quantity: { gt: 0 } }
        })
      : [selected];

    for (const source of sources) {
      const movedQuantity = mode === "TURNTABLE" ? source.quantity : quantity;
      await removeFromStock(tx, source.id, movedQuantity, user.login);
      await tx.ropeStock.create({
        data: {
          ropeTypeId: source.ropeTypeId, diameter: source.diameter, length: source.length,
          quantity: movedQuantity, locationId: source.locationId, placement: "LOAN", status: "ON_LOAN",
          turntableId: mode === "TURNTABLE" ? source.turntableId : null, loanId: loan.id,
          lastChangedBy: user.login
        }
      });
      await tx.ropeMovement.create({
        data: {
          operationId, userId: user.id, action: "LOAN", ropeTypeId: source.ropeTypeId,
          diameter: source.diameter, length: source.length, quantity: movedQuantity,
          fromLocationId: source.locationId, fromPlacement: source.placement, fromStatus: "AVAILABLE",
          fromTurntableId: source.turntableId, toStatus: "ON_LOAN",
          toTurntableId: mode === "TURNTABLE" ? source.turntableId : null,
          comment: `loan:${loan.id}${recipient ? `; ${recipient}` : ""}`
        }
      });
    }
    if (mode === "TURNTABLE" && selected.turntableId) {
      await tx.turntable.update({ where: { id: selected.turntableId }, data: { currentLocationId: null } });
    }
  });
  revalidatePath("/rope");
}

export async function returnRopeLoanAction(formData: FormData) {
  const user = await requireUser();
  const loanId = intField(formData, "loanId");
  const toLocationId = intField(formData, "toLocationId");
  const requestedPlacement = textField(formData, "toPlacement");
  const operationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const loan = await tx.ropeLoan.findUnique({
      where: { id: loanId },
      include: { stocks: { where: { status: "ON_LOAN", quantity: { gt: 0 } } } }
    });
    if (!loan || loan.returnedAt) throw new Error("Этот долг уже закрыт");
    const location = await tx.location.findUnique({ where: { id: toLocationId } });
    if (!location?.isActive) throw new Error("Место возврата не найдено или уже в архиве");
    const placement = loan.includesTurntable
      ? "TURNTABLE"
      : requestedPlacement === "HANGERS" && location.name === craneLocationName ? "HANGERS" : "GROUND";

    for (const stock of loan.stocks) {
      await removeFromStock(tx, stock.id, stock.quantity, user.login);
      await addToStock(tx, {
        ropeTypeId: stock.ropeTypeId, diameter: stock.diameter, length: stock.length,
        locationId: toLocationId, placement, status: "AVAILABLE",
        turntableId: loan.includesTurntable ? loan.turntableId : null
      }, stock.quantity, user.login);
      await tx.ropeMovement.create({
        data: {
          operationId, userId: user.id, action: "RETURN_LOAN", ropeTypeId: stock.ropeTypeId,
          diameter: stock.diameter, length: stock.length, quantity: stock.quantity,
          toLocationId, toPlacement: placement, fromStatus: "ON_LOAN", toStatus: "AVAILABLE",
          toTurntableId: loan.includesTurntable ? loan.turntableId : null,
          comment: `loan:${loan.id}`
        }
      });
    }
    if (loan.includesTurntable && loan.turntableId) {
      await tx.turntable.update({ where: { id: loan.turntableId }, data: { currentLocationId: toLocationId } });
    }
    await tx.ropeLoan.update({ where: { id: loan.id }, data: { returnedAt: new Date(), returnedById: user.id } });
  });
  revalidatePath("/rope");
}

export async function unloadToothToGroundAction(formData: FormData) {
  const user = await requireUser();
  const binId = intField(formData, "binId");
  const toothTypeId = intField(formData, "toothTypeId");
  const condition = allowedValue(formData.get("condition"), toothConditions, "Состояние зубьев");
  const quantity = positiveInteger(formData.get("quantity"));

  await prisma.$transaction(async (tx) => {
    const bin = await tx.toothBin.findUnique({ where: { id: binId }, include: { currentLocation: true } });
    if (!bin || bin.kind === "GROUND" || !bin.currentLocationId) throw new Error("У пены не указано место");
    const scrap = shouldScrapUnloadedTeeth(condition, bin.currentLocation?.name);
    const ground = scrap ? null : await groundBinAt(tx, bin.currentLocationId, user.login);
    await changeToothStock(tx, bin.id, toothTypeId, condition, -quantity, user.login);
    if (ground) await changeToothStock(tx, ground.id, toothTypeId, condition, quantity, user.login);
    await tx.toothBin.update({ where: { id: bin.id }, data: { lastChangedAt: new Date(), lastChangedBy: user.login } });
    await tx.toothMovement.create({ data: {
      operationId: randomUUID(), userId: user.id, action: scrap ? "SCRAP" : "UNLOAD_GROUND", binId: bin.id,
      fromBinId: bin.id, toBinId: ground?.id, toothTypeId, condition, quantity,
      fromLocationId: bin.currentLocationId, toLocationId: bin.currentLocationId,
      fromLocationText: `${bin.name}: ${bin.currentLocation?.name ?? ""}`,
      toLocationText: scrap ? "Списано под 30т краном" : `На земле: ${bin.currentLocation?.name ?? ""}`
    }});
  });
  revalidatePath("/tooth");
}

export async function loadGroundToToothBinAction(formData: FormData) {
  const user = await requireUser();
  const groundBinId = intField(formData, "groundBinId");
  const targetBinId = intField(formData, "targetBinId");
  const toothTypeId = intField(formData, "toothTypeId");
  const condition = allowedValue(formData.get("condition"), toothConditions, "Состояние зубьев");
  const quantity = positiveInteger(formData.get("quantity"));

  await prisma.$transaction(async (tx) => {
    const [ground, target] = await Promise.all([
      tx.toothBin.findUnique({ where: { id: groundBinId }, include: { currentLocation: true } }),
      tx.toothBin.findUnique({ where: { id: targetBinId } })
    ]);
    if (!ground || ground.kind !== "GROUND") throw new Error("Зубья на земле не найдены");
    if (!target || target.kind === "GROUND") throw new Error("Пена не найдена");
    if (target.currentLocationId !== ground.currentLocationId) throw new Error("Сюда можно выбрать только пену, которая находится в этом месте");
    await changeToothStock(tx, ground.id, toothTypeId, condition, -quantity, user.login);
    await changeToothStock(tx, target.id, toothTypeId, condition, quantity, user.login);
    await tx.toothBin.update({ where: { id: target.id }, data: { lastChangedAt: new Date(), lastChangedBy: user.login } });
    await tx.toothMovement.create({ data: {
      operationId: randomUUID(), userId: user.id, action: "LOAD_GROUND", binId: target.id,
      fromBinId: ground.id, toBinId: target.id, toothTypeId, condition, quantity,
      fromLocationId: ground.currentLocationId, toLocationId: ground.currentLocationId,
      fromLocationText: `На земле: ${ground.currentLocation?.name ?? ""}`, toLocationText: target.name
    }});
  });
  revalidatePath("/tooth");
}

export async function installGroundToothAction(formData: FormData) {
  const user = await requireUser();
  const groundBinId = intField(formData, "groundBinId");
  const toothTypeId = intField(formData, "toothTypeId");
  const quantity = positiveInteger(formData.get("quantity"));
  await prisma.$transaction(async (tx) => {
    const ground = await tx.toothBin.findUnique({ where: { id: groundBinId }, include: { currentLocation: true } });
    if (!ground || ground.kind !== "GROUND" || ground.currentLocation?.category !== "excavator" || !ground.currentLocation.isActive) {
      throw new Error("Устанавливать с земли можно только у экскаватора");
    }
    await changeToothStock(tx, ground.id, toothTypeId, "NEW", -quantity, user.login);
    await changeToothStock(tx, ground.id, toothTypeId, "USED", quantity, user.login);
    await tx.toothMovement.create({ data: {
      operationId: randomUUID(), userId: user.id, action: "INSTALL_GROUND", binId: ground.id,
      fromBinId: ground.id, toBinId: ground.id, toothTypeId, condition: "NEW", quantity,
      excavatorLocationId: ground.currentLocationId,
      fromLocationText: "Новые на земле", toLocationText: "Б/У на земле"
    }});
  });
  revalidatePath("/tooth");
}

export async function evacuateGroundToothAction(formData: FormData) {
  const user = await requireUser();
  const groundBinId = intField(formData, "groundBinId");
  const toothTypeId = intField(formData, "toothTypeId");
  const condition = allowedValue(formData.get("condition"), toothConditions, "Состояние зубьев");
  const quantity = positiveInteger(formData.get("quantity"));
  await prisma.$transaction(async (tx) => {
    const ground = await tx.toothBin.findUnique({ where: { id: groundBinId }, include: { currentLocation: true } });
    if (!ground || ground.kind !== "GROUND") throw new Error("Зубья на земле не найдены");
    await changeToothStock(tx, ground.id, toothTypeId, condition, -quantity, user.login);
    await tx.toothMovement.create({ data: {
      operationId: randomUUID(), userId: user.id, action: "EVACUATE_GROUND", binId: ground.id,
      fromBinId: ground.id, toothTypeId, condition, quantity, fromLocationId: ground.currentLocationId,
      fromLocationText: `На земле: ${ground.currentLocation?.name ?? ""}`, toLocationText: "Вывезено"
    }});
  });
  revalidatePath("/tooth");
}
