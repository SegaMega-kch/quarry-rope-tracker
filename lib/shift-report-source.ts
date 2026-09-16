import type { Prisma, ToothMovement } from "@prisma/client";
import { locationLabel } from "./labels";
import { toothCraneGround, toothCraneLocation } from "./tooth-policy";
import { validatePeriod, type CargoFlow, type ReportGroup, type ShiftEvent, type ShiftPeriod, type ShiftReportInput } from "./shift-report";
import type { AssemblyPowerSnapshot } from "./assembly-power";

type Place = { id: number; name: string; category: string };
type ToothDelta = { binId: number; item: string; quantity: number };
const containers = { key: "containers", name: "Вертушки и пены" };
const ropeGroup = { key: "ropes", name: "Канаты" };
const toothGroup = { key: "teeth", name: "Зубья" };
const groupFor = (place: Place | null | undefined, fallback: ReportGroup) => place?.category === "excavator" ? { key: `exc:${place.id}`, name: place.name } : fallback;
const numberedYakno = (name: string) => `ЯКНО №${name.replace(/^(?:ЯКНО\s*№?\s*|Я)/i, "").trim()}`;
const binName = (name: string) => name.replace(/^Пена\s+(\d+)$/, "Пена №$1");
const endpoint = (holder: string, place: string | number | null | undefined) => `${holder}@${place ?? "unknown"}`;
const withQuantity = (before: string, quantity: number, after = " шт.") => ({ before, quantity, after });

function toothDeltas(row: ToothMovement, legacyGroundId?: number): ToothDelta[] | null {
  if (row.quantity === null || !row.toothTypeId) return [];
  const item = `${row.toothTypeId}:${row.condition ?? "NEW"}`;
  const change = (binId: number, quantity: number, key = item) => ({ binId, item: key, quantity });
  const q = row.quantity;
  switch (row.action) {
    case "ADD": return [change(row.binId, q)];
    case "INSTALL": case "INSTALL_GROUND":
      return [change(row.binId, -q, `${row.toothTypeId}:NEW`), change(row.binId, q, `${row.toothTypeId}:USED`)];
    case "WRITE_OFF": case "SCRAP": case "RECONCILE_SCRAP": case "EVACUATE_GROUND": return [change(row.binId, -q)];
    case "MOVE": {
      const source = row.fromBinId ?? legacyGroundId;
      return source ? [change(source, -q), change(row.toBinId ?? row.binId, q)] : null;
    }
    case "LOAD_GROUND": case "UNLOAD_GROUND": case "TRANSFER_GROUND":
      return row.fromBinId && row.toBinId ? [change(row.fromBinId, -q), change(row.toBinId, q)] : null;
    default: return null;
  }
}

/** Rewind from current stock, including post-shift movements, to recover cargo at each bin move. */
export function toothCargoTimeline(rows: ToothMovement[], stocks: Array<{ binId: number; toothTypeId: number; condition: string; quantity: number }>, legacyGroundId?: number) {
  const balances = new Map<number, Map<string, number>>();
  const uncertain = new Set<number>();
  const add = ({ binId, item, quantity }: ToothDelta, sign = 1) => {
    const stock = balances.get(binId) ?? new Map<string, number>();
    stock.set(item, (stock.get(item) ?? 0) + quantity * sign);
    balances.set(binId, stock);
  };
  for (const stock of stocks) add({ binId: stock.binId, item: `${stock.toothTypeId}:${stock.condition}`, quantity: stock.quantity });
  const changes = new Map<number, ToothDelta[] | null>();
  for (const row of rows) {
    const delta = toothDeltas(row, legacyGroundId);
    changes.set(row.id, delta);
    if (delta === null) for (const id of [row.binId, row.fromBinId, row.toBinId]) if (id) uncertain.add(id);
  }
  for (const row of [...rows].reverse()) for (const delta of changes.get(row.id) ?? []) add(delta, -1);
  for (const [id, stock] of Array.from(balances)) if (Array.from(stock.values()).some((q) => q < 0)) uncertain.add(id);
  const cargo = new Map<number, Array<{ item: string; quantity: number }> | null>();
  for (const row of rows) {
    if ((row.action === "MOVE" || row.action === "ARCHIVE_TRANSFER") && row.quantity === null) {
      cargo.set(row.id, uncertain.has(row.binId) ? null : Array.from(balances.get(row.binId) ?? []).filter(([, q]) => q > 0).map(([item, quantity]) => ({ item, quantity })));
    }
    for (const delta of changes.get(row.id) ?? []) add(delta);
  }
  return cargo;
}

type PowerSnapshot = { boxes: Array<{ id: number; excavatorLocationId: number | null; isPowered: boolean }>; states: Array<{ excavatorLocationId: number; horizonId: number | null }> };
function parsePowerSnapshot(raw: string, id: number): PowerSnapshot {
  try {
    const data = JSON.parse(raw) as PowerSnapshot;
    if (!Array.isArray(data.boxes) || !Array.isArray(data.states) || data.boxes.some((box) => !Number.isInteger(box.id) || typeof box.isPowered !== "boolean" || (box.excavatorLocationId !== null && !Number.isInteger(box.excavatorLocationId)))) throw new Error();
    return data;
  } catch { throw new Error(`Некорректный снимок истории ЯКНО, запись ${id}`); }
}

export async function collectShiftReport(db: Prisma.TransactionClient, period: ShiftPeriod): Promise<ShiftReportInput & { warnings: string[] }> {
  validatePeriod(period);
  const where = { createdAt: { gte: period.start, lt: period.end } };
  const orderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const capturedAt = new Date();
  const points = await db.ppPoint.findMany({ where: { isActive: true }, include: { equipmentLocation: { select: { name: true } }, sectors: { where: { isActive: true } } } });
  const [ropes, teeth, assemblies, yaknos, locations, turntables, bins, toothStocks, boxes, horizons] = await Promise.all([
    db.ropeMovement.findMany({ where, orderBy, include: { ropeType: { select: { name: true } } } }),
    db.toothMovement.findMany({ where: { createdAt: { gte: period.start } }, orderBy }),
    db.assemblyMovement.findMany({ where, orderBy, include: { assembly: { select: { name: true } } } }),
    db.yaknoMovement.findMany({ where, orderBy }),
    db.location.findMany({ select: { id: true, name: true, category: true } }),
    db.turntable.findMany({ select: { id: true, name: true } }),
    db.toothBin.findMany({ select: { id: true, name: true, kind: true, currentLocationId: true, customLocation: true } }),
    db.toothStock.findMany({ select: { binId: true, toothTypeId: true, condition: true, quantity: true } }),
    db.yaknoBox.findMany({ select: { id: true, number: true } }),
    db.assemblyHorizon.findMany({ select: { id: true, name: true } })
  ]);
  const places = new Map(locations.map((place) => [place.id, place]));
  const tables = new Map(turntables.map((table) => [table.id, table.name]));
  const binsById = new Map(bins.map((bin) => [bin.id, bin]));
  const boxNames = new Map(boxes.map((box) => [box.id, numberedYakno(box.number)]));
  const horizonNames = new Map(horizons.map((horizon) => [horizon.id, horizon.name]));
  const legacyGround = bins.find((bin) => bin.name === toothCraneGround)?.id;
  const cargo = toothCargoTimeline(teeth, toothStocks, legacyGround);
  const warnings: string[] = [];
  const events: ShiftEvent[] = [];
  const placeName = (id: number | null, teethMode = false, text?: string | null) => {
    const name = id ? places.get(id)?.name : null;
    return name === toothCraneLocation ? (teethMode ? "30т кран" : "20т кран") : name ? locationLabel(name) : text || "место не указано";
  };
  const excGroup = (id: number, name?: string) => ({ key: `exc:${id}`, name: name ?? places.get(id)?.name ?? `Экскаватор (запись ${id})` });
  const tableName = (id: number | null) => id ? tables.get(id) ?? `Вертушка (запись ${id})` : "Вертушка";
  const loanIds = Array.from(new Set(ropes.flatMap((row) => /^loan:(\d+)/.exec(row.comment ?? "")?.slice(1).map(Number) ?? [])));
  const loans = loanIds.length ? await db.ropeLoan.findMany({ where: { id: { in: loanIds } }, select: { id: true, recipient: true, includesTurntable: true, turntableId: true } }) : [];
  const loanMap = new Map(loans.map((loan) => [loan.id, loan]));
  for (const row of ropes) {
    const id = `rope:${row.id}`;
    const at = row.createdAt;
    const from = row.fromLocationId ? places.get(row.fromLocationId) : null;
    const to = row.toLocationId ? places.get(row.toLocationId) : null;
    const purpose = /^Напор(?:\s|$)/i.test(row.ropeType?.name ?? "") ? "напорный канат" : /^Под[ъь]ём(?:\s|$)/i.test(row.ropeType?.name ?? "") ? "подъёмный канат" : "канат";
    const rope = `${purpose}${row.length !== null ? ` ${row.length} м` : ""}`;
    const stockPoint = (loc: number | null, placement: string | null, table: number | null) => loc === null ? undefined :
      endpoint(placement === "TURNTABLE" && table ? `table:${table}` : `rope-ground:${loc}`, placement === "TURNTABLE" ? loc : placement);
    const item = `rope:${row.ropeTypeId}:${row.length}:${row.diameter}:${row.fromStatus ?? row.toStatus ?? "AVAILABLE"}`;
    const flow: CargoFlow = { item, quantity: row.quantity,
      from: stockPoint(row.fromLocationId, row.fromPlacement, row.fromTurntableId),
      to: stockPoint(row.toLocationId, row.toPlacement, row.toTurntableId) };
    const base = { kind: "work" as const, id, at };
    if (row.action === "INSTALL") {
      events.push({ ...base, group: groupFor(to, ropeGroup), line: `Установлен ${rope}${row.quantity > 1 ? `, ${row.quantity} шт.` : "."}`, flows: [{ ...flow, to: undefined }] });
    } else if (row.action === "WRITE_OFF") {
      const evacuated = row.comment === "вывезен из-под экскаватора";
      events.push({ ...base, group: groupFor(from, ropeGroup), line: `${evacuated ? "Вывезен" : "Списан"} б/у ${rope}, ${row.quantity} шт.`, flows: row.quantity > 0 ? [{ ...flow, to: undefined }] : [] });
    } else if (row.action === "LOAN" || row.action === "RETURN_LOAN") {
      const match = /^loan:(\d+)(?:;\s*(.*))?$/.exec(row.comment ?? "");
      const loan = match ? loanMap.get(Number(match[1])) : undefined;
      const recipient = match?.[2] || loan?.recipient;
      const withTable = loan?.includesTurntable || (row.action === "LOAN" && row.toTurntableId) || (row.action === "RETURN_LOAN" && row.toPlacement === "TURNTABLE");
      const table = withTable ? `; с вертушкой: ${tableName(loan?.turntableId ?? row.toTurntableId)}` : "";
      events.push({ ...base, group: { key: "loans", name: "Канаты в долг" }, line: row.action === "LOAN"
        ? `Выдан в долг${recipient ? ` (${recipient})` : ""}: ${rope}, ${row.quantity} шт.${table ? `${table}.` : ""}`
        : `Возвращён из долга${recipient ? ` (${recipient})` : ""}: ${rope}, ${row.quantity} шт.${table}; ${placeName(row.toLocationId)}.`,
        flows: row.action === "LOAN" ? [{ ...flow, to: undefined }] : [] });
    } else if (row.action === "MOVE_TURNTABLE" || (row.action === "ARCHIVE_TRANSFER" && row.quantity === 0 && row.fromTurntableId)) {
      events.push({ ...base, group: containers, line: `${tableName(row.fromTurntableId)} (пустая): ${placeName(row.fromLocationId)} → ${placeName(row.toLocationId)}.` });
    } else if (["ADD", "MOVE", "ADD_USED", "ARCHIVE_TRANSFER"].includes(row.action) && row.quantity > 0) {
      const carries = row.fromTurntableId && row.fromTurntableId === row.toTurntableId && row.fromLocationId !== row.toLocationId;
      const toTable = row.toPlacement === "TURNTABLE" && row.toTurntableId;
      const source = placeName(row.fromLocationId);
      const target = placeName(row.toLocationId);
      const targetPlacement = row.toPlacement === "HANGERS" ? "на вешала" : "на землю";
      let before: string;
      if (carries) before = `${tableName(row.toTurntableId)}: ${source} → ${target}; ${rope}, `;
      else if (toTable) before = `${tableName(row.toTurntableId)}: погружен ${rope}, `;
      else if (row.fromTurntableId) before = `${tableName(row.fromTurntableId)}: разгружен ${rope} ${targetPlacement} (${target}), `;
      else before = `${row.action === "ADD_USED" ? "Добавлен б/у" : row.action === "ADD" ? "Добавлен" : "Перемещён"} ${rope} (${row.action === "MOVE" ? `${source} → ` : ""}${target}), `;
      const combine = carries && row.operationId ? {
        key: `rope-move:${row.operationId}:${row.toTurntableId}:${row.fromLocationId}:${row.toLocationId}`,
        prefix: `${tableName(row.toTurntableId)}: ${source} → ${target}; `
      } : undefined;
      events.push({ ...base, group: carries || toTable || row.fromTurntableId ? containers : groupFor(to ?? from, ropeGroup), line: withQuantity(combine ? `${rope}, ` : before, row.quantity), combine, transient: true, flows: [flow] });
    } else if (row.action === "ADJUST") {
      events.push({ kind: "barrier", id, at, holders: [`table:${row.fromTurntableId}`, `table:${row.toTurntableId}`, `rope-ground:${row.fromLocationId}`, `rope-ground:${row.toLocationId}`] });
    }
  }

  for (const row of teeth) {
    if (row.createdAt >= period.end) continue;
    const bin = binsById.get(row.binId);
    const name = binName(bin?.name ?? `Пена (запись ${row.binId})`);
    const id = `tooth:${row.id}`;
    const at = row.createdAt;
    const group = groupFor(places.get(row.excavatorLocationId ?? row.toLocationId ?? row.fromLocationId ?? 0), toothGroup);
    const fromPlace = row.fromLocationId ?? (row.action === "INSTALL_GROUND" ? row.excavatorLocationId : null) ?? row.fromLocationText;
    const toPlace = row.toLocationId ?? row.toLocationText;
    const fromBin = row.fromBinId ?? (row.action === "MOVE" && row.quantity !== null ? legacyGround : row.binId);
    const toBin = row.toBinId ?? row.binId;
    const item = `${row.toothTypeId}:${row.condition ?? "NEW"}`;
    const condition = row.condition === "USED" ? "б/у" : "новых";
    const base = { kind: "work" as const, id, at, group };
    const flow: CargoFlow = { item, quantity: row.quantity ?? 0,
      from: fromBin ? endpoint(`bin:${fromBin}`, fromPlace) : undefined,
      to: endpoint(`bin:${toBin}`, toPlace) };
    if (["INSTALL", "INSTALL_GROUND"].includes(row.action) && row.quantity) {
      events.push({ ...base, line: `Установлено ${row.quantity} зубьев${row.action === "INSTALL_GROUND" ? " с земли" : ` (${name})`}.`, flows: [{ ...flow, item: `${row.toothTypeId}:NEW`, to: undefined }] });
    } else if ((row.action === "MOVE" || row.action === "ARCHIVE_TRANSFER") && row.quantity === null) {
      const contents = cargo.get(row.id);
      const flows = contents?.map(({ item: cargoItem, quantity }) => ({ item: cargoItem, quantity, from: endpoint(`bin:${row.binId}`, fromPlace), to: endpoint(`bin:${row.binId}`, toPlace) })) ?? [];
      if (contents === null) {
        events.push({ kind: "barrier", id: `${id}:barrier`, at, holders: [`bin:${row.binId}`] });
        warnings.push(`Груз пены не восстановлен однозначно: запись ${row.id}. Перевозка не скрывается.`);
      }
      events.push({ ...base, group: containers, line: `${name}${contents?.length === 0 ? " (пустая)" : ""}: ${placeName(row.fromLocationId, true, row.fromLocationText)} → ${placeName(row.toLocationId, true, row.toLocationText)}.`, transient: Boolean(contents?.length), flows });
    } else if (["MOVE", "LOAD_GROUND", "ADD", "UNLOAD_GROUND", "TRANSFER_GROUND"].includes(row.action) && row.quantity) {
      const ground = bin?.kind === "GROUND" || bin?.name === toothCraneGround;
      const load = row.action === "LOAD_GROUND" || row.action === "MOVE" || (row.action === "ADD" && !ground);
      const before = load ? `${name}: погружено ` : row.action === "UNLOAD_GROUND" ? `${name}: разгружено на землю ` : row.action === "TRANSFER_GROUND" ? "Перемещено с земли " : "Добавлено на землю ";
      const after = ` ${condition} зубьев (${placeName(row.toLocationId, true, row.toLocationText)}).`;
      if (row.action === "ADD") flow.from = undefined;
      events.push({ ...base, group: ground ? group : containers, line: withQuantity(before, row.quantity, after), transient: true, flows: [flow] });
    } else if (["EVACUATE_GROUND", "WRITE_OFF", "SCRAP"].includes(row.action) && row.quantity) {
      events.push({ ...base, line: `${row.action === "EVACUATE_GROUND" ? "Вывезено" : "Списано"} ${row.quantity} ${condition} зубьев${row.action === "SCRAP" ? ` (${name})` : " с земли"}.`, flows: [{ ...flow, to: undefined }] });
    } else if (row.action === "ADJUST" || row.action === "RECONCILE_SCRAP") {
      events.push({ kind: "barrier", id, at, holders: [`bin:${row.binId}`] });
    }
  }

  for (const row of assemblies) {
    if (row.action === "POWER") {
      let snapshot: AssemblyPowerSnapshot;
      try {
        snapshot = JSON.parse(row.comment ?? "") as AssemblyPowerSnapshot;
        if (snapshot.kind !== "assembly-power-v1" || [snapshot.before, snapshot.after].some((state) => state !== null && (!Number.isInteger(state?.id) || typeof state?.name !== "string"))) throw new Error();
      } catch { throw new Error(`Некорректная запись подключения сборки ${row.id}`); }
      const source = { key: `assembly:${row.assemblyId}`, name: row.assembly.name };
      for (const state of [snapshot.before, snapshot.after]) {
        if (!state || (snapshot.before?.id === snapshot.after?.id)) continue;
        events.push({ kind: "power", id: `assembly:${row.id}:${state.id}`, at: row.createdAt, group: excGroup(state.id, state.name), source, before: snapshot.before?.id === state.id, after: snapshot.after?.id === state.id });
      }
    } else if (["MOVE", "LENGTH"].includes(row.action)) {
      events.push({ kind: "work", id: `assembly:${row.id}`, at: row.createdAt, group: { key: "assemblies", name: "Сборки" }, line: row.action === "LENGTH"
        ? `${row.assembly.name}: длина ${row.oldLength ?? "не указана"} → ${row.newLength ?? "не указана"} м.`
        : `${row.assembly.name}: ${row.fromPlaceText ?? "место не указано"} → ${row.toPlaceText ?? "место не указано"}.` });
    }
  }

  for (const row of yaknos) {
    if (!["SET_EXCAVATOR", "FREE_HORIZON", "REPAIR", "RESTORE", "ARCHIVE_DETACH"].includes(row.action)) continue;
    const beforeRaw = row.beforeState ?? (row.fromText?.trim().startsWith("{") ? row.fromText : null);
    const afterRaw = row.afterState ?? (row.toText?.trim().startsWith("{") ? row.toText : null);
    if (Boolean(beforeRaw) !== Boolean(afterRaw)) throw new Error(`Неполный снимок истории ЯКНО, запись ${row.id}`);
    if (beforeRaw && afterRaw) {
      const before = parsePowerSnapshot(beforeRaw, row.id);
      const after = parsePowerSnapshot(afterRaw, row.id);
      const ids = Array.from(new Set([...before.boxes, ...after.boxes].map((box) => box.id)));
      for (const boxId of ids) {
        const a = before.boxes.find((box) => box.id === boxId);
        const b = after.boxes.find((box) => box.id === boxId);
        const source = { key: `yakno:${boxId}`, name: boxNames.get(boxId) ?? `ЯКНО (запись ${boxId})` };
        const excavators = Array.from(new Set([a?.excavatorLocationId, b?.excavatorLocationId].filter((id): id is number => typeof id === "number")));
        for (const exc of excavators) {
          events.push({ kind: "power", id: `yakno:${row.id}:${boxId}:${exc}`, at: row.createdAt, group: excGroup(exc), source,
            before: Boolean(a?.isPowered && a.excavatorLocationId === exc), after: Boolean(b?.isPowered && b.excavatorLocationId === exc) });
        }
        if (!a?.isPowered && !b?.isPowered && a?.excavatorLocationId !== b?.excavatorLocationId) {
          events.push({ kind: "work", id: `yakno:${row.id}:${boxId}:place`, at: row.createdAt, group: { key: "yakno", name: "ЯКНО" },
            line: `${source.name}: ${placeName(a?.excavatorLocationId ?? null)} → ${placeName(b?.excavatorLocationId ?? null)} (не запитано).` });
        }
      }
      for (const b of after.states) {
        const a = before.states.find((state) => state.excavatorLocationId === b.excavatorLocationId);
        if (a?.horizonId !== b.horizonId && (a?.horizonId || b.horizonId)) events.push({ kind: "work", id: `yakno:${row.id}:horizon:${b.excavatorLocationId}`, at: row.createdAt, group: excGroup(b.excavatorLocationId),
          line: `Горизонт: ${a?.horizonId ? horizonNames.get(a.horizonId) ?? "неизвестен" : "не указан"} → ${b.horizonId ? horizonNames.get(b.horizonId) ?? "неизвестен" : "не указан"}.` });
      }
    } else if (row.action === "SET_EXCAVATOR") {
      events.push({ kind: "work", id: `yakno:${row.id}:legacy`, at: row.createdAt, group: row.excavatorLocationId ? excGroup(row.excavatorLocationId) : { key: "yakno", name: "ЯКНО" }, line: `Изменение подключения: ${row.fromText ?? "не указано"} → ${row.toText ?? "не указано"}.` });
    }
    if (["FREE_HORIZON", "REPAIR", "RESTORE"].includes(row.action)) {
      const label = row.action === "REPAIR" ? "отправлено в ремонт" : row.action === "RESTORE" ? "возвращено из ремонта" : `горизонт ${row.toHorizonId ? horizonNames.get(row.toHorizonId) ?? "неизвестен" : "не указан"}`;
      events.push({ kind: "work", id: `yakno:${row.id}:state`, at: row.createdAt, group: { key: "yakno", name: "ЯКНО" }, line: `${row.boxId ? boxNames.get(row.boxId) ?? "ЯКНО" : "ЯКНО"}: ${label}.` });
    }
  }
  return { period, capturedAt, events, warnings, points: points.map((point) => ({ id: point.id, name: point.name, excavator: point.equipmentLocation?.name ?? null, unloadingSectorId: point.unloadingSectorId, sectors: point.sectors.map(({ id, name, quantity, material }) => ({ id, name, quantity, material })) })) };
}
