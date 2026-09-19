import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type User = { id: number; login: string };
export type YaknoSnapshot = {
  boxes: Array<{ id: number; excavatorLocationId: number | null; horizonId: number | null; isPowered: boolean;
    status: string; isActive: boolean; comment: string | null }>;
  states: Array<{ excavatorLocationId: number; horizonId: number | null }>;
};

export async function yaknoSnapshot(tx: Tx, boxIds: number[], excavatorIds: number[]): Promise<YaknoSnapshot> {
  const boxes = await tx.yaknoBox.findMany({ where: { id: { in: Array.from(new Set(boxIds)) } }, orderBy: { id: "asc" } });
  const ids = Array.from(new Set(excavatorIds)).sort((a, b) => a - b);
  const states = await tx.yaknoExcavatorState.findMany({ where: { excavatorLocationId: { in: ids } } });
  return {
    boxes: boxes.map(({ id, excavatorLocationId, horizonId, isPowered, status, isActive, comment }) =>
      ({ id, excavatorLocationId, horizonId, isPowered, status, isActive, comment })),
    states: ids.map((excavatorLocationId) => ({ excavatorLocationId,
      horizonId: states.find((state) => state.excavatorLocationId === excavatorLocationId)?.horizonId ?? null }))
  };
}

export async function restoreYaknoSnapshot(tx: Tx, snapshot: YaknoSnapshot, userLogin: string) {
  for (const box of snapshot.boxes) {
    const { id, excavatorLocationId, horizonId, isPowered, status, isActive, comment } = box;
    await tx.yaknoBox.update({ where: { id }, data: { excavatorLocationId, horizonId, isPowered, status, isActive, comment,
      lastChangedAt: new Date(), lastChangedBy: userLogin } });
  }
  for (const state of snapshot.states) {
    await tx.yaknoExcavatorState.upsert({ where: { excavatorLocationId: state.excavatorLocationId },
      update: { horizonId: state.horizonId, lastChangedAt: new Date(), lastChangedBy: userLogin },
      create: { ...state, lastChangedBy: userLogin } });
  }
}

export async function assertYaknoUndoCurrent(tx: Tx, before: YaknoSnapshot, after: YaknoSnapshot) {
  const current = await yaknoSnapshot(tx, after.boxes.map((box) => box.id), after.states.map((state) => state.excavatorLocationId));
  const canonical = (value: YaknoSnapshot) => JSON.stringify({
    boxes: [...value.boxes].sort((a, b) => a.id - b.id).map(({ id, excavatorLocationId, horizonId, isPowered, status, isActive, comment }) =>
      ({ id, excavatorLocationId, horizonId, isPowered, status, isActive, comment })),
    states: [...value.states].sort((a, b) => a.excavatorLocationId - b.excavatorLocationId)
  });
  if (canonical(current) !== canonical(after)) throw new Error("После этого действия данные изменились. Откат недоступен");
  for (const box of before.boxes.filter((item) => item.isPowered && item.excavatorLocationId)) {
    const occupied = await tx.yaknoBox.findFirst({ where: { isActive: true, isPowered: true,
      excavatorLocationId: box.excavatorLocationId, id: { notIn: before.boxes.map((item) => item.id) } } });
    if (occupied) throw new Error("Экскаватор уже запитан от другого ЯКНО. Откат недоступен");
  }
}

export async function setYaknoPower(tx: Tx, input: { excavatorLocationId: number; horizonId: number | null;
  poweredBoxId: number | null; expectedPoweredBoxId: number | null; expectedHorizonId: number | null; comment: string }, user: User) {
  const { excavatorLocationId, horizonId, poweredBoxId } = input;
  await tx.$executeRaw`UPDATE YaknoBox SET id = id WHERE id = ${poweredBoxId ?? 0}`;
  const excavator = await tx.location.findUnique({ where: { id: excavatorLocationId } });
  if (!excavator?.isActive || excavator.category !== "excavator") throw new Error("Выберите действующий экскаватор");
  const horizon = horizonId ? await tx.assemblyHorizon.findUnique({ where: { id: horizonId } }) : null;
  if (horizonId && !horizon?.isActive) throw new Error("Горизонт не найден");
  if (poweredBoxId && !horizon) throw new Error("Выберите горизонт экскаватора");
  const state = await tx.yaknoExcavatorState.findUnique({ where: { excavatorLocationId } });
  const current = await tx.yaknoBox.findMany({ where: { excavatorLocationId, isActive: true, isPowered: true } });
  if (current.length > 1 || (current[0]?.id ?? null) !== input.expectedPoweredBoxId || (state?.horizonId ?? null) !== input.expectedHorizonId) {
    throw new Error("Подключение или горизонт уже изменены. Обновите страницу");
  }
  const selected = poweredBoxId ? await tx.yaknoBox.findUnique({ where: { id: poweredBoxId } }) : null;
  if (poweredBoxId && (!selected?.isActive || selected.status === "REPAIR")) throw new Error("ЯКНО недоступен или в ремонте");
  if (selected?.isPowered && selected.excavatorLocationId !== excavatorLocationId) throw new Error("ЯКНО уже запитан. Сначала отключите его");
  const ids = Array.from(new Set([...current.map((box) => box.id), ...(selected ? [selected.id] : [])]));
  const before = await yaknoSnapshot(tx, ids, [excavatorLocationId]);
  if (input.expectedPoweredBoxId === poweredBoxId && input.expectedHorizonId === horizonId && !input.comment &&
    (!selected || selected.horizonId === horizonId)) return;
  await tx.yaknoExcavatorState.upsert({ where: { excavatorLocationId },
    update: { horizonId, lastChangedAt: new Date(), lastChangedBy: user.login },
    create: { excavatorLocationId, horizonId, lastChangedBy: user.login } });
  for (const box of current.filter((box) => box.id !== poweredBoxId)) {
    await tx.yaknoBox.update({ where: { id: box.id }, data: { isPowered: false, excavatorLocationId: null,
      lastChangedAt: new Date(), lastChangedBy: user.login } });
  }
  if (selected) await tx.yaknoBox.update({ where: { id: selected.id }, data: { isPowered: true,
    excavatorLocationId, horizonId, ...(input.comment ? { comment: input.comment } : {}),
    lastChangedAt: new Date(), lastChangedBy: user.login } });
  const after = await yaknoSnapshot(tx, ids, [excavatorLocationId]);
  await tx.yaknoMovement.create({ data: { userId: user.id, action: "SET_EXCAVATOR", excavatorLocationId,
    fromHorizonId: state?.horizonId, toHorizonId: horizonId,
    beforeState: JSON.stringify(before), afterState: JSON.stringify(after), comment: input.comment } });
}
