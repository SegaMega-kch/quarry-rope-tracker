import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

const craneName = "Вешала под 30т краном";
const groundName = "Земля под 30т краном";
type Actor = { id: number; login: string };
export class LocationChangeError extends Error {}

export async function locationInventory(tx: Prisma.TransactionClient, id: number) {
  const location = await tx.location.findUnique({
    where: { id }, include: {
      stocks: { where: { quantity: { gt: 0 }, status: { not: "WRITTEN_OFF" } }, orderBy: { id: "asc" } },
      turntables: { orderBy: { id: "asc" } },
      toothBins: { where: { isActive: true }, include: { stocks: { where: { quantity: { gt: 0 } }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } },
      yaknoBoxes: { where: { isActive: true }, orderBy: { id: "asc" } },
      yaknoStates: true, poweredAssemblies: { orderBy: { id: "asc" } }, ppEquipment: { orderBy: { id: "asc" } },
      requestsFrom: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } },
      requestsTo: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } }
    }
  });
  if (!location) throw new LocationChangeError("Место не найдено");
  return location;
}

type Inventory = Awaited<ReturnType<typeof locationInventory>>;
const groundBin = (bin: Inventory["toothBins"][number]) => bin.kind === "GROUND" || bin.name === groundName;
const looseRope = (stock: Inventory["stocks"][number]) => !stock.turntableId && stock.status !== "INSTALLED" && stock.status !== "ON_LOAN" && stock.placement !== "INSTALLED";

export function archivePreview(location: Inventory) {
  const excavator = location.category === "excavator";
  const ropes = location.stocks.filter(looseRope);
  const ground = location.toothBins.filter(groundBin);
  const bins = location.toothBins.filter((bin) => !groundBin(bin));
  const occupancy: string[] = [];
  const effects: string[] = [];
  if (location.stocks.length) occupancy.push(`Канаты: ${location.stocks.reduce((n, stock) => n + stock.quantity, 0)} шт (включая установленные и выданные в долг)`);
  if (location.turntables.length) occupancy.push(`Вертушки: ${location.turntables.map((item) => item.name).join(", ")}`);
  if (bins.length) occupancy.push(`Пены: ${bins.map((item) => item.name).join(", ")}`);
  const toothCount = ground.reduce((n, bin) => n + bin.stocks.reduce((s, stock) => s + stock.quantity, 0), 0);
  if (toothCount) occupancy.push(`Зубья на земле: ${toothCount} шт`);
  if (location.yaknoBoxes.length) occupancy.push(`ЯКНО: ${location.yaknoBoxes.map((item) => item.number).join(", ")}`);
  if (location.poweredAssemblies.length) occupancy.push(`Сборки: ${location.poweredAssemblies.map((item) => item.name).join(", ")}`);
  if (location.ppEquipment.length) occupancy.push(`Техника П/П: ${location.ppEquipment.map((item) => item.name).join(", ")}`);
  const requests = location.requestsFrom.length + location.requestsTo.length;
  const unsupportedStock = location.stocks.some((stock) => looseRope(stock) && stock.placement !== "GROUND");
  if (requests) occupancy.push(`Незавершённые заявки: ${requests}`);
  if (excavator) {
    effects.push("Экскаватор исчезнет из активных списков. Установленные канаты и данные СИЗ сохранятся в архиве.");
    if (location.turntables.length) effects.push(`Под кран с канатами: ${location.turntables.map((item) => item.name).join(", ")}.`);
    if (bins.length) effects.push(`Под кран с зубьями: ${bins.map((item) => item.name).join(", ")}.`);
    if (location.yaknoBoxes.length) effects.push("ЯКНО отключатся от экскаватора и останутся на своём горизонте.");
    if (location.poweredAssemblies.length) effects.push("Сборки отключатся от экскаватора и останутся на своём месте.");
    if (location.ppEquipment.length) effects.push("В П/П будет «Без техники». Секторы и выбранная стрелка сохранятся.");
    if (location.stocks.some((stock) => stock.status === "ON_LOAN")) effects.push("Канаты в долг останутся в учёте до возврата.");
  }
  return {
    id: location.id, name: location.name, excavator,
    token: createHash("sha256").update(JSON.stringify(location)).digest("hex"),
    ropeCount: ropes.reduce((n, stock) => n + stock.quantity, 0), toothCount, occupancy, effects,
    blocked: !location.isActive ? "Место уже в архиве" : location.name === craneName ? "Основное место под краном удалить нельзя" : requests ? "Сначала завершите связанные заявки" : excavator && unsupportedStock ? "Есть канат с нестандартным размещением. Сначала переместите его на землю или на вертушку." : !excavator && occupancy.length ? "Сначала переместите имущество. Удалить можно только пустое место." : null
  };
}

export async function groundAt(tx: Prisma.TransactionClient, locationId: number, login: string) {
  const location = await tx.location.findUnique({ where: { id: locationId } });
  if (!location?.isActive) throw new LocationChangeError("Место назначения уже удалено. Выберите другое.");
  const existing = await tx.toothBin.findFirst({ where: { currentLocationId: locationId, OR: [{ kind: "GROUND" }, { name: groundName }] } });
  if (existing) return tx.toothBin.update({ where: { id: existing.id }, data: { isActive: true, kind: "GROUND" } });
  return tx.toothBin.create({ data: { name: location.name === craneName ? groundName : `Земля #${location.id}: ${location.name}`, kind: "GROUND", currentLocationId: locationId, lastChangedBy: login } });
}

export async function moveGroundTeeth(tx: Prisma.TransactionClient, sourceBinId: number, toothTypeId: number, condition: string, quantity: number, toLocationId: number, actor: Actor, action = "TRANSFER_GROUND", operationId = randomUUID()) {
  const source = await tx.toothBin.findUnique({ where: { id: sourceBinId }, include: { currentLocation: true } });
  if (!source || !(source.kind === "GROUND" || source.name === groundName)) throw new LocationChangeError("Зубья на земле не найдены");
  if (source.currentLocationId === toLocationId) throw new LocationChangeError("Выберите другое место");
  const target = await groundAt(tx, toLocationId, actor.login);
  const changed = await tx.toothStock.updateMany({ where: { binId: sourceBinId, toothTypeId, condition, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity }, lastChangedAt: new Date(), lastChangedBy: actor.login } });
  if (!changed.count) throw new LocationChangeError("Количество зубьев изменилось. Обновите страницу.");
  await tx.toothStock.upsert({ where: { binId_toothTypeId_condition: { binId: target.id, toothTypeId, condition } },
    update: { quantity: { increment: quantity }, lastChangedAt: new Date(), lastChangedBy: actor.login },
    create: { binId: target.id, toothTypeId, condition, quantity, lastChangedBy: actor.login }
  });
  const destination = await tx.location.findUniqueOrThrow({ where: { id: toLocationId } });
  await tx.toothMovement.create({ data: { userId: actor.id, action, operationId, binId: sourceBinId, fromBinId: sourceBinId, toBinId: target.id, toothTypeId, condition, quantity, fromLocationId: source.currentLocationId, toLocationId, fromLocationText: source.currentLocation?.name, toLocationText: destination.name } });
}

export async function archiveLocation(tx: Prisma.TransactionClient, id: number, token: string, ropeDestination: number | null, toothDestination: number | null, actor: Actor) {
  const inventory = await locationInventory(tx, id);
  const preview = archivePreview(inventory);
  if (preview.blocked) throw new LocationChangeError(preview.blocked);
  if (preview.token !== token) throw new LocationChangeError("Имущество изменилось. Обновите проверку перед удалением.");
  for (const targetId of [ropeDestination, toothDestination]) {
    if (targetId && (targetId === id || !(await tx.location.findUnique({ where: { id: targetId } }))?.isActive)) throw new LocationChangeError("Выберите действующее место назначения");
  }
  const operationId = randomUUID();
  const changed = { lastChangedAt: new Date(), lastChangedBy: actor.login };
  if (preview.excavator) {
    const crane = await tx.location.findUnique({ where: { name: craneName } });
    const bins = inventory.toothBins.filter((bin) => !groundBin(bin));
    if ((inventory.turntables.length || bins.length) && !crane?.isActive) throw new LocationChangeError("Не найдено действующее место под краном");
    for (const table of inventory.turntables) {
      if (await tx.ropeLoan.findFirst({ where: { turntableId: table.id, returnedAt: null } })) throw new LocationChangeError("Вертушка выдана в долг. Сначала проверьте её местоположение.");
      await tx.turntable.update({ where: { id: table.id }, data: { currentLocationId: crane!.id } });
      const stocks = await tx.ropeStock.findMany({ where: { turntableId: table.id, quantity: { gt: 0 }, status: { notIn: ["WRITTEN_OFF", "ON_LOAN"] } } });
      for (const stock of stocks) {
        await tx.ropeStock.update({ where: { id: stock.id }, data: { locationId: crane!.id, ...changed } });
        await tx.ropeMovement.create({ data: { operationId, userId: actor.id, action: "ARCHIVE_TRANSFER", quantity: stock.quantity, ropeTypeId: stock.ropeTypeId, length: stock.length, diameter: stock.diameter, fromLocationId: stock.locationId, toLocationId: crane!.id, fromTurntableId: table.id, toTurntableId: table.id, fromPlacement: stock.placement, toPlacement: stock.placement, fromStatus: stock.status, toStatus: stock.status, comment: `${table.name}: при удалении ${inventory.name}` } });
      }
      if (!stocks.length) await tx.ropeMovement.create({ data: { operationId, userId: actor.id, action: "ARCHIVE_TRANSFER", quantity: 0, fromLocationId: id, toLocationId: crane!.id, fromTurntableId: table.id, toTurntableId: table.id, comment: `${table.name}: пустая вертушка` } });
    }
    for (const stock of inventory.stocks.filter(looseRope)) {
      if (!ropeDestination) continue;
      await tx.ropeStock.update({ where: { id: stock.id }, data: { locationId: ropeDestination, placement: "GROUND", ...changed } });
      await tx.ropeMovement.create({ data: { operationId, userId: actor.id, action: "ARCHIVE_TRANSFER", quantity: stock.quantity, ropeTypeId: stock.ropeTypeId, length: stock.length, diameter: stock.diameter, fromLocationId: id, toLocationId: ropeDestination, fromPlacement: stock.placement, toPlacement: "GROUND", fromStatus: stock.status, toStatus: stock.status, comment: `С земли: при удалении ${inventory.name}` } });
    }
    for (const bin of bins) {
      await tx.toothBin.update({ where: { id: bin.id }, data: { currentLocationId: crane!.id, customLocation: null, ...changed } });
      await tx.toothMovement.create({ data: { operationId, userId: actor.id, action: "ARCHIVE_TRANSFER", binId: bin.id, fromLocationId: id, toLocationId: crane!.id, fromLocationText: inventory.name, toLocationText: "30т кран", comment: "Перемещена с содержимым при удалении экскаватора" } });
    }
    if (toothDestination) for (const bin of inventory.toothBins.filter(groundBin)) for (const stock of bin.stocks) {
      await moveGroundTeeth(tx, bin.id, stock.toothTypeId, stock.condition, stock.quantity, toothDestination, actor, "ARCHIVE_TRANSFER", operationId);
    }
    for (const box of inventory.yaknoBoxes) {
      const horizonId = box.horizonId ?? inventory.yaknoStates[0]?.horizonId ?? null;
      await tx.yaknoBox.update({ where: { id: box.id }, data: { excavatorLocationId: null, isPowered: false, horizonId, ...changed } });
      await tx.yaknoMovement.create({ data: { userId: actor.id, action: "ARCHIVE_DETACH", boxId: box.id, excavatorLocationId: id, fromHorizonId: horizonId, toHorizonId: horizonId, fromText: inventory.name, toText: "На горизонте, без экскаватора", comment: "Экскаватор убран в архив" } });
    }
    for (const assembly of inventory.poweredAssemblies) {
      await tx.assembly.update({ where: { id: assembly.id }, data: { excavatorLocationId: null, isPowered: false, ...changed } });
      await tx.assemblyMovement.create({ data: { userId: actor.id, action: "ARCHIVE_DETACH", assemblyId: assembly.id, fromHorizonId: assembly.horizonId, toHorizonId: assembly.horizonId, fromPlaceText: inventory.name, toPlaceText: "Без экскаватора", comment: "Местоположение сборки сохранено" } });
    }
  }
  for (const point of inventory.ppEquipment) {
    await tx.ppPoint.update({ where: { id: point.id }, data: { equipmentLocationId: null, ...changed } });
    await tx.ppMovement.create({ data: { userId: actor.id, action: "SET_EQUIPMENT", ppPointId: point.id, fromText: inventory.name, toText: "Без техники", comment: "Экскаватор убран в архив" } });
  }
  await tx.location.update({ where: { id }, data: { isActive: false } });
  const remaining = [!ropeDestination && preview.ropeCount ? `канаты на земле: ${preview.ropeCount} шт` : "", !toothDestination && preview.toothCount ? `зубья на земле: ${preview.toothCount} шт` : ""].filter(Boolean);
  await tx.ropeMovement.create({ data: { operationId, userId: actor.id, action: "ARCHIVE_LOCATION", quantity: 0, fromLocationId: id, comment: `${inventory.name}. История и сохранённые данные остаются в архиве.${remaining.length ? ` Оставлено на месте: ${remaining.join(", ")}.` : ""}` } });
}

export async function restoreLocation(tx: Prisma.TransactionClient, id: number, actor: Actor) {
  const location = await tx.location.findUnique({ where: { id } });
  if (!location || location.isActive) throw new LocationChangeError("Место не найдено в архиве");
  await tx.location.update({ where: { id }, data: { isActive: true } });
  await tx.ropeMovement.create({ data: { operationId: randomUUID(), userId: actor.id, action: "RESTORE_LOCATION", quantity: 0, toLocationId: id, comment: `${location.name}. Перемещённое имущество не возвращалось.` } });
}

// Historical undo snapshots must not reattach property after an archive/restore.
export async function assertAfterArchive(tx: Prisma.TransactionClient, createdAt: Date) {
  const later = await tx.ropeMovement.findFirst({ where: { action: { in: ["ARCHIVE_LOCATION", "RESTORE_LOCATION"] }, createdAt: { gte: createdAt } } });
  if (later) throw new LocationChangeError("После этого действия изменился архив мест. Для сохранности имущества используйте новое перемещение вместо отката.");
}
