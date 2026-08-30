"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { canManageLocationArchive } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { archiveLocation, archivePreview, locationInventory, LocationChangeError, moveGroundTeeth, restoreLocation } from "@/lib/location-archive";
import { positiveInteger, allowedValue, toothConditions } from "@/lib/validation";

function refreshLocations() { revalidatePath("/", "layout"); }
function errorMessage(error: unknown) { return error instanceof LocationChangeError ? error.message : "Не удалось сохранить. Обновите страницу и повторите попытку."; }

export async function previewLocationArchiveAction(id: number) {
  const user = await requireUser();
  if (!canManageLocationArchive(user.role)) return { error: "Недостаточно прав" };
  try { return { preview: await prisma.$transaction(async (tx) => archivePreview(await locationInventory(tx, positiveInteger(id)))) }; }
  catch (error) { return { error: errorMessage(error) }; }
}

export async function archiveLocationAction(data: FormData) {
  const user = await requireUser();
  if (!canManageLocationArchive(user.role)) return { error: "Недостаточно прав" };
  try {
    const id = positiveInteger(data.get("id"));
    const token = String(data.get("token") ?? "");
    const destination = (key: string) => data.get(key) ? positiveInteger(data.get(key)) : null;
    await prisma.$transaction((tx) => archiveLocation(tx, id, token, destination("ropeDestination"), destination("toothDestination"), user));
    refreshLocations();
    return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function restoreLocationAction(data: FormData) {
  const user = await requireUser();
  if (!canManageLocationArchive(user.role)) return { error: "Недостаточно прав" };
  try {
    await prisma.$transaction((tx) => restoreLocation(tx, positiveInteger(data.get("id")), user));
    refreshLocations();
    return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function transferGroundTeethAction(data: FormData) {
  const user = await requireUser();
  const condition = allowedValue(data.get("condition"), toothConditions, "Состояние зубьев");
  await prisma.$transaction((tx) => moveGroundTeeth(tx, positiveInteger(data.get("groundBinId")), positiveInteger(data.get("toothTypeId")), condition, positiveInteger(data.get("quantity")), positiveInteger(data.get("toLocationId")), user));
  refreshLocations();
}

export async function transferArchivedRopeAction(data: FormData) {
  const user = await requireUser();
  const quantity = positiveInteger(data.get("quantity"));
  const toLocationId = positiveInteger(data.get("toLocationId"));
  await prisma.$transaction(async (tx) => {
    const stock = await tx.ropeStock.findUnique({ where: { id: positiveInteger(data.get("stockId")) }, include: { location: true } });
    const target = await tx.location.findUnique({ where: { id: toLocationId } });
    if (!stock || stock.location.isActive || stock.turntableId || !["AVAILABLE", "USED_NEAR_EXCAVATOR"].includes(stock.status) || stock.placement !== "GROUND" || quantity > stock.quantity || !target?.isActive) throw new Error("Остаток или место изменились. Обновите страницу.");
    await tx.ropeStock.update({ where: { id: stock.id }, data: { quantity: { decrement: quantity }, lastChangedAt: new Date(), lastChangedBy: user.login } });
    await tx.ropeStock.create({ data: { ropeTypeId: stock.ropeTypeId, length: stock.length, diameter: stock.diameter, quantity, placement: "GROUND", status: stock.status, locationId: toLocationId, lastChangedBy: user.login } });
    await tx.ropeMovement.create({ data: { operationId: randomUUID(), userId: user.id, action: "ARCHIVE_TRANSFER", quantity, ropeTypeId: stock.ropeTypeId, length: stock.length, diameter: stock.diameter, fromLocationId: stock.locationId, toLocationId, fromPlacement: "GROUND", toPlacement: "GROUND", fromStatus: stock.status, toStatus: stock.status, comment: "Вывезено с места архивного экскаватора без списания" } });
  });
  refreshLocations();
}
