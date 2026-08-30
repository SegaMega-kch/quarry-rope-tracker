import {
  createRequestAction,
  logoutAction,
  moveRopeAction,
  undoAssemblyMovementAction,
  undoMovementAction,
  undoToothMovementAction,
  undoYaknoMovementAction,
  updateRequestStatusAction,
  writeOffRopeAction
} from "@/app/actions";
import { canManageLocations, canManageRequests, canWriteOff, requireUser } from "@/lib/auth";
import {
  actionLabels,
  compareLocations,
  placementLabels,
  requestStatusLabels,
  locationLabel,
  ropeTypeLabel,
  ropeTypeSortValue,
  ropeTypeShortLabels,
  roleLabels,
  statusLabels
} from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { syncSafetyItems } from "@/lib/safety";
import Link from "next/link";
import { RopeMeasure, RopeTypeMeasure } from "./RopeMeasure";
import { AssemblySection } from "./AssemblySection";
import { CardMoveMenu } from "./CardMoveMenu";
import { CardPlacementButton } from "./CardPlacementButton";
import { CraneQuickAdd } from "./CraneQuickAdd";
import { ExcavatorTurntableMoveMenu } from "./ExcavatorTurntableMoveMenu";
import { LoadGroundRopeMenu } from "./LoadGroundRopeMenu";
import { LazyDetails } from "./LazyDetails";
import { PpSection } from "./PpSection";
import { SafetySection } from "./SafetySection";
import { RopeFields } from "./RopeFields";
import { SummarySection } from "./SummarySection";
import { ToothSection } from "./ToothSection";
import { TurntableAddRopeMenu } from "./TurntableAddRopeMenu";
import { TurntableInstallMenu } from "./TurntableInstallMenu";
import { EvacuateUsedRopeMenu } from "./EvacuateUsedRopeMenu";
import { TurntableMoveMenu } from "./TurntableMoveMenu";
import { TurntableUnloadMenu } from "./TurntableUnloadMenu";
import { RopeLoanMenu } from "./RopeLoanMenu";
import { RopeLoanReturnMenu } from "./RopeLoanReturnMenu";
import { YaknoSection } from "./YaknoSection";
import { RopeManagement } from "./RopeManagement";
import { ArchivedGroundRopeMenu } from "./ArchivedGroundRopeMenu";
import { canManageLocationArchive, canManageYakno } from "@/lib/permissions";

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

export type Search = { [key: string]: string | string[] | undefined };
export type TrackerModule = "rope" | "tooth" | "assembly" | "yakno" | "pp" | "summary" | "safety";

function value(searchParams: Search, key: string) {
  const raw = searchParams[key];
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}

function FieldSelect({
  name,
  children,
  defaultValue
}: {
  name: string;
  children: React.ReactNode;
  defaultValue?: string | number;
}) {
  return (
    <label>
      <span>{name}</span>
      <select name={name} defaultValue={defaultValue}>
        {children}
      </select>
    </label>
  );
}

export async function TrackerPage({
  activeModule,
  searchParams
}: {
  activeModule: TrackerModule;
  searchParams: Search;
}) {
  const user = await requireUser();
  const historyOpen = value(searchParams, "history") === "1";
  const requestsOpen = value(searchParams, "requests") === "1";
  if (activeModule === "safety") await syncSafetyItems(prisma);
  const locations = await prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const archivedLocations = activeModule === "rope" ? await prisma.location.findMany({ where: { isActive: false }, orderBy: { name: "asc" } }) : [];
  const archiveBoundary = await prisma.ropeMovement.findFirst({ where: { action: { in: ["ARCHIVE_LOCATION", "RESTORE_LOCATION"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const undoDate = archiveBoundary ? { gt: archiveBoundary.createdAt } : undefined;
  const [ropeTypes, stocks, movements, requests, turntables] = activeModule === "rope" || activeModule === "summary"
    ? await Promise.all([
        prisma.ropeType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        prisma.ropeStock.findMany({
          where: { quantity: { gt: 0 }, status: { notIn: ["WRITTEN_OFF", "ON_LOAN"] }, OR: [{ location: { isActive: true } }, { placement: "GROUND", status: { in: ["AVAILABLE", "USED_NEAR_EXCAVATOR"] } }] },
          include: { ropeType: true, location: true, turntable: true },
          orderBy: [{ lastChangedAt: "desc" }]
        }),
        historyOpen ? prisma.ropeMovement.findMany({
          take: 80,
          include: { user: true, ropeType: true, fromLocation: true, toLocation: true },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([]),
        requestsOpen ? prisma.mechanicRequest.findMany({
          take: 50,
          include: { ropeType: true, fromLocation: true, toLocation: true, createdBy: true },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([]),
        prisma.turntable.findMany({
          include: { currentLocation: true },
          orderBy: { name: "asc" }
        })
      ])
    : [[], [], [], [], []];
  const activeLoans = activeModule === "rope"
    ? await prisma.ropeLoan.findMany({
        where: { returnedAt: null },
        include: {
          createdBy: true,
          turntable: true,
          stocks: {
            where: { status: "ON_LOAN", quantity: { gt: 0 } },
            include: { ropeType: true }
          }
        },
        orderBy: { loanedAt: "desc" }
      })
    : [];
  const [toothTypes, toothBins, toothMovements] = activeModule === "tooth" || activeModule === "summary"
    ? await Promise.all([
        prisma.toothType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        prisma.toothBin.findMany({
          where: { isActive: true },
          include: {
            currentLocation: true,
            stocks: {
              include: { toothType: true },
              where: { quantity: { gt: 0 } },
              orderBy: [{ toothType: { name: "asc" } }, { condition: "asc" }]
            }
          },
          orderBy: { name: "asc" }
        }),
        historyOpen ? prisma.toothMovement.findMany({
          take: 100,
          include: { user: true, bin: true, toothType: true, excavatorLocation: true },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([])
      ])
    : [[], [], []];
  const [assemblies, assemblyHorizons, assemblyMovements] = activeModule === "assembly" || activeModule === "yakno" || activeModule === "summary"
    ? await Promise.all([
        prisma.assembly.findMany({
          include: { horizon: true, excavatorLocation: true },
          orderBy: { name: "asc" }
        }),
        prisma.assemblyHorizon.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: "asc" }
        }),
        activeModule === "assembly" && historyOpen ? prisma.assemblyMovement.findMany({
          take: 100,
          include: { user: true, assembly: true },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([])
      ])
    : [[], [], []];
  const [yaknoBoxes, yaknoStates, yaknoMovements] = activeModule === "yakno" || activeModule === "summary"
    ? await Promise.all([
        prisma.yaknoBox.findMany({
          include: { horizon: true, excavatorLocation: true },
          orderBy: { number: "asc" }
        }),
        prisma.yaknoExcavatorState.findMany({
          include: { horizon: true },
          orderBy: { excavatorLocationId: "asc" }
        }),
        historyOpen ? prisma.yaknoMovement.findMany({
          take: 100,
          include: { user: true, box: true, excavatorLocation: true, fromHorizon: true, toHorizon: true },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([])
      ])
    : [[], [], []];
  const [ppPoints, ppMovements] = activeModule === "pp" || activeModule === "summary"
    ? await Promise.all([
        prisma.ppPoint.findMany({
          where: { isActive: true },
          include: {
            equipmentLocation: true,
            sectors: { orderBy: { name: "asc" } }
          },
          orderBy: { name: "asc" }
        }),
        historyOpen ? prisma.ppMovement.findMany({
          take: 100,
          include: { user: true, ppPoint: true, sector: true, equipmentLocation: true },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([])
      ])
    : [[], []];
  const [safetyItems, safetyHistory] = activeModule === "safety"
    ? await Promise.all([
        prisma.safetyItem.findMany({
          include: { location: true },
          orderBy: [{ location: { name: "asc" } }, { category: "asc" }, { sortOrder: "asc" }]
        }),
        historyOpen ? prisma.safetyHistory.findMany({
          take: 150,
          include: { user: true, item: { include: { location: true } } },
          orderBy: { createdAt: "desc" }
        }) : Promise.resolve([])
      ])
    : [[], []];

  const sortedLocations = [...locations].sort(compareLocations);
  const excavators = sortedLocations.filter((location) => location.category === "excavator");
  const ppEquipmentOptions = sortedLocations.filter((location) => ["excavator", "loader"].includes(location.category));
  const query = value(searchParams, "q").toLowerCase();
  const filters = {
    ropeType: value(searchParams, "ropeType"),
    diameter: value(searchParams, "diameter"),
    length: value(searchParams, "length"),
    location: value(searchParams, "location"),
    placement: value(searchParams, "placement"),
    status: value(searchParams, "status")
  };

  const filteredStocks = stocks.filter((stock) => {
    const haystack = [
      stock.ropeType.name,
      ropeTypeLabel(stock.ropeType.name),
      stock.length,
      stock.diameter,
      stock.location.name,
      placementLabels[stock.placement],
      statusLabels[stock.status]
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!query || haystack.includes(query)) &&
      (!filters.ropeType || String(stock.ropeTypeId) === filters.ropeType) &&
      (!filters.diameter || stock.diameter === filters.diameter) &&
      (!filters.length || String(stock.length) === filters.length) &&
      (!filters.location || String(stock.locationId) === filters.location) &&
      (!filters.placement || stock.placement === filters.placement) &&
      (!filters.status || stock.status === filters.status)
    );
  });

  const summaryByType = Object.entries(ropeTypeShortLabels).map(([typeName, label]) => {
    const type = ropeTypes.find((item) => item.name === typeName);
    return {
      name: label,
      typeName,
      total: type
        ? stocks
            .filter((stock) => stock.ropeTypeId === type.id && stock.status === "AVAILABLE")
            .reduce((sum, stock) => sum + stock.quantity, 0)
        : 0
    };
  });
  const craneLocation = locations.find((location) => location.name === "Вешала под 30т краном");
  const underCrane = {
    hangers: craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === "HANGERS" && stock.status === "AVAILABLE")
          .reduce((sum, stock) => sum + stock.quantity, 0)
      : 0,
    turntables: craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === "TURNTABLE" && stock.status === "AVAILABLE")
          .reduce((sum, stock) => sum + stock.quantity, 0)
      : 0,
    ground: craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === "GROUND" && stock.status === "AVAILABLE")
          .reduce((sum, stock) => sum + stock.quantity, 0)
      : 0
  };
  const underCraneItems = (placement: string) =>
    craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === placement && stock.status === "AVAILABLE")
          .sort((a, b) => ropeTypeSortValue(a.ropeType.name) - ropeTypeSortValue(b.ropeType.name))
          .map((stock) => ({ id: stock.id, length: stock.length, diameter: stock.diameter, quantity: stock.quantity }))
      : [];
  const underCraneQuantities = (placement: string) =>
    craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === placement && stock.status === "AVAILABLE")
          .reduce<Record<number, number>>((totals, stock) => {
            totals[stock.ropeTypeId] = (totals[stock.ropeTypeId] ?? 0) + stock.quantity;
            return totals;
          }, {})
      : {};
  const availableStocks = stocks.filter((stock) => stock.status !== "WRITTEN_OFF");
  const usedStocks = stocks.filter((stock) => stock.status === "USED_NEAR_EXCAVATOR" && stock.location.isActive);
  const archivedGroundStocks = stocks.filter((stock) => !stock.location.isActive && stock.placement === "GROUND");
  const undoableActions = new Set(["ADD", "ADJUST", "MOVE", "INSTALL", "ADD_USED", "WRITE_OFF", "MOVE_TURNTABLE", "LOAN", "RETURN_LOAN"]);
  const operationKey = (movement: { id: number; operationId: string | null }) => movement.operationId ?? `legacy-${movement.id}`;
  const undoableOperationIds = new Set<string>();
  for (const movement of movements) {
    if (movement.userId !== user.id || !undoableActions.has(movement.action) || (archiveBoundary && movement.createdAt <= archiveBoundary.createdAt)) continue;
    undoableOperationIds.add(operationKey(movement));
    if (undoableOperationIds.size === 3) break;
  }
  const latestUndoMovement = activeModule === "rope"
    ? await prisma.ropeMovement.findFirst({
        where: { userId: user.id, createdAt: undoDate, action: { in: ["ADD", "ADJUST", "MOVE", "INSTALL", "ADD_USED", "WRITE_OFF", "MOVE_TURNTABLE", "LOAN", "RETURN_LOAN"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, operationId: true }
      })
    : null;
  const latestToothUndoMovement = activeModule === "tooth"
    ? await prisma.toothMovement.findFirst({
        where: { userId: user.id, createdAt: undoDate, action: { in: ["ADD", "ADJUST", "MOVE", "INSTALL", "WRITE_OFF", "SCRAP", "UNLOAD_GROUND", "LOAD_GROUND", "INSTALL_GROUND", "EVACUATE_GROUND"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      })
    : null;
  const latestAssemblyUndoMovement = activeModule === "assembly"
    ? await prisma.assemblyMovement.findFirst({
        where: { userId: user.id, createdAt: undoDate, action: { in: ["MOVE", "LENGTH"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      })
    : null;
  const latestYaknoUndoMovement = activeModule === "yakno"
    ? await prisma.yaknoMovement.findFirst({
        where: { userId: user.id, createdAt: undoDate, action: { not: "ARCHIVE_DETACH" } },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      })
    : null;
  const latestUndoOperationId = latestUndoMovement
    ? latestUndoMovement.operationId ?? `legacy-${latestUndoMovement.id}`
    : undefined;
  const latestToothUndoId = latestToothUndoMovement?.id;
  const latestAssemblyUndoId = latestAssemblyUndoMovement?.id;
  const latestYaknoUndoId = latestYaknoUndoMovement?.id;
  const shownUndoOperationIds = new Set<string>();
  const movementRows = movements.map((movement) => {
    const key = operationKey(movement);
    const showUndo = undoableOperationIds.has(key) && !shownUndoOperationIds.has(key);
    if (showUndo) shownUndoOperationIds.add(key);
    return { movement, operationId: key, showUndo };
  });
  const activeLoanTurntableIds = new Set(activeLoans.map((loan) => loan.turntableId).filter(Boolean));
  const turntableSummaries = turntables.filter((turntable) => !activeLoanTurntableIds.has(turntable.id)).map((turntable) => {
    const turntableStocks = stocks.filter((stock) => stock.turntableId === turntable.id);
    const load = turntableStocks.reduce((sum, stock) => sum + stock.quantity, 0);
    return {
      id: turntable.id,
      name: turntable.name,
      currentLocationId: turntable.currentLocationId,
      location: locationLabel(turntable.currentLocation?.name) || "Место не указано",
      locationCategory: turntable.currentLocation?.category,
      load,
      items: turntableStocks.map((stock) => ({
        id: stock.id,
        length: stock.length,
        diameter: stock.diameter,
        quantity: stock.quantity,
        label: ropeTypeLabel(stock.ropeType.name)
      })),
      installStocks: turntableStocks.map((stock) => ({
        id: stock.id,
        length: stock.length,
        diameter: stock.diameter,
        label: ropeTypeLabel(stock.ropeType.name),
        quantity: stock.quantity
      }))
    };
  });
  const loadedTurntables = turntableSummaries.filter((turntable) => turntable.load > 0);
  const emptyTurntables = turntableSummaries.filter((turntable) => turntable.load < 1);
  const turntableOptions = turntableSummaries.map(({ id, name, currentLocationId, location, load }) => ({ id, name, currentLocationId, location, load }));
  const turntableStockOptions = stocks
    .filter((stock) => stock.status === "AVAILABLE" && ["HANGERS", "GROUND", "TURNTABLE"].includes(stock.placement))
    .map((stock) => ({
      id: stock.id,
      length: stock.length,
      diameter: stock.diameter,
      label: ropeTypeLabel(stock.ropeType.name),
      sortOrder: ropeTypeSortValue(stock.ropeType.name),
      location: locationLabel(stock.location.name),
      placement: placementLabels[stock.placement],
      turntableId: stock.turntableId,
      turntableName: stock.turntable?.name ?? "",
      quantity: stock.quantity
    }));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Рапорт мастера</h1>
          <p>{user.login} - {roleLabels[user.role]}</p>
        </div>
        <div className="topbar-actions">
          {latestUndoOperationId ? (
            <form action={undoMovementAction}>
              <input type="hidden" name="operationId" value={latestUndoOperationId} />
              <button className="top-undo-button" type="submit">Откатить</button>
            </form>
          ) : null}
          {activeModule === "tooth" && latestToothUndoId ? (
            <form action={undoToothMovementAction}>
              <input type="hidden" name="movementId" value={latestToothUndoId} />
              <button className="top-undo-button" type="submit">Откатить</button>
            </form>
          ) : null}
          {activeModule === "assembly" && latestAssemblyUndoId ? (
            <form action={undoAssemblyMovementAction}>
              <input type="hidden" name="movementId" value={latestAssemblyUndoId} />
              <button className="top-undo-button" type="submit">Откатить</button>
            </form>
          ) : null}
          {activeModule === "yakno" && latestYaknoUndoId ? (
            <form action={undoYaknoMovementAction}>
              <input type="hidden" name="movementId" value={latestYaknoUndoId} />
              <button className="top-undo-button" type="submit">Откатить</button>
            </form>
          ) : null}
          <form action={logoutAction}>
            <button className="ghost">Выход</button>
          </form>
        </div>
      </header>

      <nav className="module-tabs" aria-label="Разделы учета">
        <Link className={activeModule === "rope" ? "active" : ""} href="/rope">Канат</Link>
        <Link className={activeModule === "tooth" ? "active" : ""} href="/tooth">Зуб</Link>
        <Link className={activeModule === "assembly" ? "active" : ""} href="/assembly">Сборки</Link>
        <Link className={activeModule === "yakno" ? "active" : ""} href="/yakno">ЯКНО</Link>
        <Link className={activeModule === "pp" ? "active" : ""} href="/pp">П/П</Link>
        <Link className={activeModule === "safety" ? "active" : ""} href="/safety">СИЗ</Link>
        <Link className={activeModule === "summary" ? "active" : ""} href="/summary">Сводка</Link>
      </nav>

      {activeModule === "tooth" ? (
        <ToothSection bins={toothBins} toothTypes={toothTypes} locations={sortedLocations} movements={toothMovements} currentUserId={user.id} canManageDictionaries={canManageLocations(user.role)} canDispose={canWriteOff(user.role)} historyOpen={historyOpen} undoAfter={archiveBoundary?.createdAt} />
      ) : activeModule === "assembly" ? (
        <AssemblySection assemblies={assemblies} horizons={assemblyHorizons} excavators={excavators} movements={assemblyMovements} currentUserId={user.id} canManageDictionaries={canManageLocations(user.role)} historyOpen={historyOpen} undoAfter={archiveBoundary?.createdAt} />
      ) : activeModule === "yakno" ? (
        <YaknoSection
          excavators={excavators}
          boxes={yaknoBoxes}
          states={yaknoStates}
          horizons={assemblyHorizons}
          movements={yaknoMovements}
          currentUserId={user.id}
          canManageDictionaries={canManageLocations(user.role)}
          canManageBoxes={canManageYakno(user.role)}
          undoAfter={archiveBoundary?.createdAt}
          historyOpen={historyOpen}
        />
      ) : activeModule === "summary" ? (
        <SummarySection
          stocks={stocks}
          turntables={turntables}
          toothBins={toothBins}
          assemblies={assemblies}
          ppPoints={ppPoints}
          excavators={excavators}
          yaknoBoxes={yaknoBoxes}
          yaknoStates={yaknoStates}
        />
      ) : activeModule === "pp" ? (
        <PpSection
          points={ppPoints}
          equipmentOptions={ppEquipmentOptions}
          movements={ppMovements}
          canManageDictionaries={canManageLocations(user.role)}
          historyOpen={historyOpen}
        />
      ) : activeModule === "safety" ? (
        <SafetySection
          items={safetyItems}
          history={safetyHistory}
          historyOpen={historyOpen}
          canRestore={canManageLocationArchive(user.role)}
        />
      ) : (
        <>
      <section id="Остатки" className="panel">
        <h3 className="summary-title">Под 20т краном</h3>
        <div className="summary-grid compact">
          <CraneQuickAdd label="На вешелах" items={underCraneItems("HANGERS")} quantities={underCraneQuantities("HANGERS")} placement="HANGERS" locationId={craneLocation?.id} ropeTypes={ropeTypes} turntables={turntableOptions} />
          <CraneQuickAdd label="На земле" items={underCraneItems("GROUND")} quantities={underCraneQuantities("GROUND")} placement="GROUND" locationId={craneLocation?.id} ropeTypes={ropeTypes} turntables={turntableOptions} />
        </div>

        {activeLoans.length ? <>
          <h3 className="summary-title">Канаты в долг</h3>
          <div className="loan-grid">
            {activeLoans.map((loan) => <article className="loan-card" key={loan.id}>
              <div className="loan-card-head"><div><strong>{loan.recipient || "Получатель не указан"}</strong><span>{dtf.format(loan.loanedAt)} · {loan.createdBy.login}</span></div><b>{loan.stocks.reduce((sum, stock) => sum + stock.quantity, 0)} шт</b></div>
              <div className="loan-stock-list">{loan.stocks.map((stock) => <span key={stock.id}><RopeMeasure length={stock.length} diameter={stock.diameter} /> · {stock.quantity} шт</span>)}</div>
              {loan.includesTurntable && loan.turntable ? <p className="loan-turntable">С вертушкой: {loan.turntable.name}</p> : null}
              <RopeLoanReturnMenu loanId={loan.id} includesTurntable={loan.includesTurntable} locations={sortedLocations.map((location) => ({ id: location.id, name: locationLabel(location.name) }))} craneLocationId={craneLocation?.id ?? null} />
            </article>)}
          </div>
        </> : null}

        <h3 className="summary-title">Гружёные вертушки</h3>
        <div className="turntable-grid">
          {loadedTurntables.map((turntable) => (
            <div className="turntable-card cargo-loaded" key={turntable.id}>
              <div className="turntable-card-main">
                <span className="turntable-location">{turntable.location}</span>
                <div className="cargo-contents">{turntable.items.flatMap((item) => Array.from({ length: item.quantity }, (_, index) => <RopeMeasure key={`${item.id}-${index}`} length={item.length} diameter={item.diameter} />))}</div>
              </div>
              <p className="turntable-card-meta">{turntable.name}</p>
              <div className="turntable-actions">
              <TurntableAddRopeMenu
                turntableId={turntable.id}
                targetLocationId={turntable.currentLocationId}
                load={turntable.load}
                stocks={turntableStockOptions}
              />
              {turntable.locationCategory === "excavator" && turntable.load > 0 && turntable.currentLocationId ? (
                <TurntableInstallMenu excavatorId={turntable.currentLocationId} stocks={turntable.installStocks} />
              ) : null}
              <TurntableUnloadMenu stocks={turntable.installStocks} currentLocationId={turntable.currentLocationId} craneLocationId={craneLocation?.id ?? null} locations={sortedLocations} />
              <RopeLoanMenu stocks={turntable.installStocks.map((stock) => ({ ...stock, turntableId: turntable.id }))} />
              <TurntableMoveMenu
                turntableId={turntable.id}
                currentLocationId={turntable.currentLocationId}
                load={turntable.load}
                locations={sortedLocations}
              />
              </div>
            </div>
          ))}
        </div>

        <h3 className="summary-title">Пустые вертушки</h3>
        <div className="turntable-grid empty-turntable-grid">
          {emptyTurntables.map((turntable) => <div className="turntable-card empty-turntable-card" key={turntable.id}>
            <div className="turntable-card-main"><span className="turntable-location">{turntable.location}</span><strong>Нет канатов</strong></div>
            <p className="turntable-card-meta">{turntable.name}</p>
            <div className="turntable-actions">
              <TurntableAddRopeMenu turntableId={turntable.id} targetLocationId={turntable.currentLocationId} load={0} stocks={turntableStockOptions} />
              <TurntableMoveMenu turntableId={turntable.id} currentLocationId={turntable.currentLocationId} load={0} locations={sortedLocations} />
            </div>
          </div>)}
        </div>

        {usedStocks.length ? (
          <>
            <h3 className="summary-title">Б/у вывезти</h3>
            <div className="used-evacuation-grid">
              {usedStocks.map((stock) => (
                <article className="stock-card used-evacuation-card" key={stock.id}>
                  <div className="card-head"><h3>{locationLabel(stock.location.name)}</h3><strong>{stock.quantity} шт</strong></div>
                  <p><RopeMeasure length={stock.length} diameter={stock.diameter} /></p>
                  <div className="stock-meta-line">
                    <span>{placementLabels[stock.placement]}</span>
                    <strong>{statusLabels[stock.status]}</strong>
                  </div>
                  <EvacuateUsedRopeMenu stockId={stock.id} availableQuantity={stock.quantity} />
                  <small>Изм.: {dtf.format(stock.lastChangedAt)} - {stock.lastChangedBy}</small>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {archivedGroundStocks.length ? <>
          <h3 className="summary-title">Канаты на земле</h3>
          <div className="used-evacuation-grid">{archivedGroundStocks.map((stock) => <article className="stock-card" key={stock.id}>
            <div className="card-head"><h3>{stock.location.name}</h3><strong>{stock.quantity} шт</strong></div>
            <small>Экскаватор в архиве</small>
            <p><RopeMeasure length={stock.length} diameter={stock.diameter} /></p>
            <p>{stock.status === "USED_NEAR_EXCAVATOR" ? "Б/у" : "Новый"}</p>
            <ArchivedGroundRopeMenu stockId={stock.id} quantity={stock.quantity} locations={sortedLocations} />
            {stock.status === "USED_NEAR_EXCAVATOR" ? <EvacuateUsedRopeMenu stockId={stock.id} availableQuantity={stock.quantity} /> : null}
          </article>)}</div>
        </> : null}
        <h3 className="summary-title">Сводка</h3>
        <div className="summary-grid">
          {summaryByType.map((item) => (
            <div className="metric summary-type-card" key={item.name}><RopeTypeMeasure name={item.typeName} /><b>{item.total} шт</b></div>
          ))}
        </div>

        <details className="history-details stock-details">
          <summary><span>Все остатки</span></summary>
          <div className="cards">
            {filteredStocks.filter((stock) => stock.status !== "USED_NEAR_EXCAVATOR" && stock.location.isActive).map((stock) => (
              <article className="stock-card" key={stock.id}>
                <div className="card-head"><h3>{locationLabel(stock.location.name)}</h3><strong>{stock.quantity} шт</strong></div>
                <p><RopeMeasure length={stock.length} diameter={stock.diameter} />{stock.turntable ? `, ${stock.turntable.name}` : ""}</p>
                <div className="stock-meta-line">
                  <span>{placementLabels[stock.placement]}</span>
                  {stock.status !== "AVAILABLE" ? <strong>{statusLabels[stock.status]}</strong> : null}
                </div>
                {stock.status === "AVAILABLE" && stock.placement === "TURNTABLE" && (stock.location.category === "excavator" || stock.location.category === "transfer_point") ? (
                  <ExcavatorTurntableMoveMenu
                    stockId={stock.id}
                    quantity={stock.quantity}
                    currentLocationId={stock.locationId}
                    locations={sortedLocations}
                    alignRight={stock.location.category === "transfer_point"}
                  />
                ) : null}
                {stock.status === "AVAILABLE" && stock.placement === "TURNTABLE" && stock.location.name === "Вешала под 30т краном" ? (
                  <CardMoveMenu stockId={stock.id} quantity={stock.quantity} locations={sortedLocations.filter((location) => location.id !== stock.locationId)} />
                ) : null}
                {stock.status === "AVAILABLE" && stock.placement === "GROUND" && stock.location.name === "Вешала под 30т краном" ? (
                  <LoadGroundRopeMenu
                    stockId={stock.id}
                    quantity={stock.quantity}
                    craneLocationId={stock.locationId}
                    turntables={turntableOptions.filter((turntable) => turntable.load < 2 && (!turntable.currentLocationId || turntable.currentLocationId === stock.locationId || turntable.load === 0))}
                  />
                ) : null}
                {stock.status === "AVAILABLE" && stock.placement === "HANGERS" && stock.location.name === "Вешала под 30т краном" ? (
                  <CardPlacementButton
                    stockId={stock.id}
                    quantity={stock.quantity}
                    locationId={stock.locationId}
                    placement="TURNTABLE"
                    label="Вертушка"
                    comment="перемещен на вертушку под 20т краном"
                    turntables={turntableOptions.filter((turntable) => turntable.load < 2 && (!turntable.currentLocationId || turntable.currentLocationId === stock.locationId || turntable.load === 0))}
                  />
                ) : null}
                <small>Изм.: {dtf.format(stock.lastChangedAt)} - {stock.lastChangedBy}</small>
              </article>
            ))}
          </div>
        </details>
      </section>

      <section id="История" className="panel">
        <LazyDetails label="История" queryKey="history" open={historyOpen}>
          <div className="timeline">
            {movementRows.map(({ movement: m, operationId, showUndo }) => (
              <article key={m.id}>
                <b>{actionLabels[m.action] ?? m.action}</b>
                <span>{dtf.format(m.createdAt)} - {m.user.login}</span>
                {m.quantity > 0 ? <p>{m.length ? <RopeMeasure length={m.length} diameter={m.diameter} /> : m.ropeType?.name} · {m.quantity} шт</p> : null}
                <small>{locationLabel(m.fromLocation?.name) || "-"} {" -> "} {locationLabel(m.toLocation?.name) || "-"} {m.comment ? `; ${m.comment}` : ""}</small>
                {showUndo ? <form action={undoMovementAction} className="undo-form"><input type="hidden" name="operationId" value={operationId} /><button type="submit">Откатить</button></form> : null}
              </article>
            ))}
          </div>
        </LazyDetails>
      </section>

      <RopeManagement role={user.role} locations={sortedLocations} archivedLocations={archivedLocations} ropeTypes={ropeTypes}
        occupiedTypeIds={Array.from(new Set([...stocks.map((stock) => stock.ropeTypeId), ...activeLoans.flatMap((loan) => loan.stocks.map((stock) => stock.ropeTypeId))]))} />
        </>
      )}
    </main>
  );
}
