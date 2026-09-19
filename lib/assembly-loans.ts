import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Actor = { id: number; login: string };
export const assemblyLoanRecipients = ["Северный", "СКМ", "Западный", "Отвал"] as const;
export const assemblyUndoActions = ["MOVE", "LENGTH", "LOAN", "RETURN_LOAN"];

export async function assertAssemblyAtQuarry(tx: Tx, assembly: { id: number; status: string }) {
  if (assembly.status === "ON_LOAN" || await tx.assemblyLoan.findFirst({ where: { assemblyId: assembly.id, returnedAt: null } })) {
    throw new Error("Сборка в долгу. Сначала оформите возврат");
  }
}

export async function lendAssembly(tx: Tx, input: { assemblyId: number; recipient: string; expectedChangedAt: string }, user: Actor) {
  if (!(assemblyLoanRecipients as readonly string[]).includes(input.recipient)) throw new Error("Выберите, кому отдать сборку");
  await tx.$executeRaw`UPDATE Assembly SET id = id WHERE id = ${input.assemblyId}`;
  const assembly = await tx.assembly.findUnique({ where: { id: input.assemblyId }, include: { horizon: true } });
  if (!assembly) throw new Error("Сборка не найдена");
  await assertAssemblyAtQuarry(tx, assembly);
  if (assembly.isPowered || assembly.excavatorLocationId) throw new Error("Сначала отключите сборку от экскаватора");
  if (assembly.status !== "WORKING") throw new Error("Сборка в ремонте. Сначала верните её из ремонта");
  if (assembly.lastChangedAt.toISOString() !== input.expectedChangedAt) throw new Error("Сборка уже изменена. Обновите страницу");
  const now = new Date();
  const loan = await tx.assemblyLoan.create({ data: { assemblyId: assembly.id, recipient: input.recipient, createdById: user.id, loanedAt: now } });
  await tx.assembly.update({ where: { id: assembly.id }, data: { status: "ON_LOAN", horizonId: null,
    isPowered: false, excavatorLocationId: null, lastChangedAt: now, lastChangedBy: user.login } });
  await tx.assemblyMovement.create({ data: { assemblyId: assembly.id, loanId: loan.id, userId: user.id, action: "LOAN",
    fromHorizonId: assembly.horizonId, fromPlaceText: assembly.horizon?.name ?? "Горизонт не указан",
    toPlaceText: input.recipient, oldLength: assembly.length, newLength: assembly.length } });
  return loan;
}

export async function returnAssembly(tx: Tx, input: { loanId: number; horizonId: number }, user: Actor) {
  // Lock before reading the loan so two returns cannot both change its destination.
  await tx.$executeRaw`UPDATE AssemblyLoan SET id = id WHERE id = ${input.loanId}`;
  const loan = await tx.assemblyLoan.findUnique({ where: { id: input.loanId }, include: { assembly: true } });
  if (!loan || loan.returnedAt) throw new Error("Этот долг уже закрыт. Обновите страницу");
  if (loan.assembly.status !== "ON_LOAN" || loan.assembly.isPowered) throw new Error("Состояние сборки изменено. Обновите страницу");
  const horizon = await tx.assemblyHorizon.findUnique({ where: { id: input.horizonId } });
  if (!horizon?.isActive) throw new Error("Выберите действующий горизонт возврата");
  const now = new Date();
  await tx.assemblyLoan.update({ where: { id: loan.id }, data: { returnedAt: now, returnedById: user.id } });
  await tx.assembly.update({ where: { id: loan.assemblyId }, data: { status: "WORKING", horizonId: horizon.id,
    isPowered: false, excavatorLocationId: null, lastChangedAt: now, lastChangedBy: user.login } });
  await tx.assemblyMovement.create({ data: { assemblyId: loan.assemblyId, loanId: loan.id, userId: user.id, action: "RETURN_LOAN",
    fromPlaceText: loan.recipient, toPlaceText: horizon.name, toHorizonId: horizon.id,
    oldLength: loan.assembly.length, newLength: loan.assembly.length } });
}

export async function updateAssemblyDetails(tx: Tx, input: { assemblyId: number; length: number | null; comment: string; expectedChangedAt: string }, user: Actor) {
  if (input.length !== null && (!Number.isSafeInteger(input.length) || input.length < 1)) throw new Error("Длина должна быть положительным числом");
  if (input.comment.length > 80) throw new Error("Комментарий не длиннее 80 символов");
  await tx.$executeRaw`UPDATE Assembly SET id = id WHERE id = ${input.assemblyId}`;
  const assembly = await tx.assembly.findUnique({ where: { id: input.assemblyId } });
  if (!assembly) throw new Error("Сборка не найдена");
  await assertAssemblyAtQuarry(tx, assembly);
  if (assembly.lastChangedAt.toISOString() !== input.expectedChangedAt) throw new Error("Сборка уже изменена. Обновите страницу");
  const comment = input.comment.trim() || null;
  if (assembly.length === input.length && assembly.comment === comment) return;
  await tx.assembly.update({ where: { id: assembly.id }, data: { length: input.length, comment, lastChangedAt: new Date(), lastChangedBy: user.login } });
  await tx.assemblyMovement.create({ data: { assemblyId: assembly.id, userId: user.id,
    action: assembly.length === input.length ? "COMMENT" : "LENGTH", oldLength: assembly.length, newLength: input.length, comment } });
}

export async function undoAssemblyChange(tx: Tx, movementId: number, user: Actor) {
  await tx.$executeRaw`UPDATE AssemblyMovement SET id = id WHERE id = ${movementId}`;
  const movement = await tx.assemblyMovement.findUnique({ where: { id: movementId }, include: { assembly: true } });
  if (!movement || movement.userId !== user.id || !assemblyUndoActions.includes(movement.action)) throw new Error("Действие недоступно для отмены");
  const latest = await tx.assemblyMovement.findFirst({ where: { assemblyId: movement.assemblyId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (latest?.id !== movement.id) throw new Error("Сборка уже изменена. Нельзя отменить более раннее действие");
  const assembly = movement.assembly;
  const stamp = { lastChangedAt: new Date(), lastChangedBy: user.login };
  if (["LOAN", "RETURN_LOAN"].includes(movement.action)) {
    const loan = movement.loanId ? await tx.assemblyLoan.findUnique({ where: { id: movement.loanId } }) : null;
    if (!loan || loan.assemblyId !== assembly.id) throw new Error("Запись долга не найдена");
    if (movement.action === "LOAN") {
      if (loan.returnedAt || assembly.status !== "ON_LOAN" || assembly.isPowered) throw new Error("Долг уже изменён");
      if (movement.fromHorizonId && !(await tx.assemblyHorizon.findUnique({ where: { id: movement.fromHorizonId } }))?.isActive) throw new Error("Прежний горизонт удалён. Используйте возврат");
      await tx.assembly.update({ where: { id: assembly.id }, data: { status: "WORKING", horizonId: movement.fromHorizonId, ...stamp } });
      await tx.assemblyMovement.delete({ where: { id: movement.id } });
      await tx.assemblyLoan.delete({ where: { id: loan.id } });
      return;
    }
    await assertAssemblyAtQuarry(tx, assembly);
    if (!loan.returnedAt || assembly.isPowered || assembly.status !== "WORKING" || assembly.horizonId !== movement.toHorizonId) throw new Error("Возвращённая сборка уже изменена");
    await tx.assemblyLoan.update({ where: { id: loan.id }, data: { returnedAt: null, returnedById: null } });
    await tx.assembly.update({ where: { id: assembly.id }, data: { status: "ON_LOAN", horizonId: null, excavatorLocationId: null, ...stamp } });
  } else {
    await assertAssemblyAtQuarry(tx, assembly);
    if (movement.action === "MOVE") {
      if (assembly.isPowered || assembly.horizonId !== movement.toHorizonId) throw new Error("Сборка уже перемещена или запитана");
      if (movement.fromHorizonId && !(await tx.assemblyHorizon.findUnique({ where: { id: movement.fromHorizonId } }))?.isActive) throw new Error("Прежний горизонт удалён");
      await tx.assembly.update({ where: { id: assembly.id }, data: { horizonId: movement.fromHorizonId,
        status: movement.fromPlaceText === "Ремонт" ? "REPAIR" : "WORKING", ...stamp } });
    } else {
      if (assembly.length !== movement.newLength) throw new Error("Длина сборки уже изменена");
      await tx.assembly.update({ where: { id: assembly.id }, data: { length: movement.oldLength, ...stamp } });
    }
  }
  await tx.assemblyMovement.delete({ where: { id: movement.id } });
}
