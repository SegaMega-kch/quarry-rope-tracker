import {
  createRequestAction,
  deleteLocationAction,
  deleteRopeTypeAction,
  evacuateUsedRopeAction,
  logoutAction,
  moveRopeAction,
  undoMovementAction,
  saveLocationAction,
  saveRopeTypeAction,
  updateRequestStatusAction,
  writeOffRopeAction
} from "@/app/actions";
import { canExport, canManageLocations, canManageRequests, canWriteOff, requireUser } from "@/lib/auth";
import {
  actionLabels,
  categoryLabels,
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
import { CardMoveMenu } from "./CardMoveMenu";
import { CardPlacementButton } from "./CardPlacementButton";
import { ClearAllRopesButton } from "./ClearAllRopesButton";
import { ConfirmSubmitForm } from "./ConfirmSubmitForm";
import { CraneQuickAdd } from "./CraneQuickAdd";
import { ExcavatorTurntableMoveMenu } from "./ExcavatorTurntableMoveMenu";
import { LoadGroundRopeMenu } from "./LoadGroundRopeMenu";
import { RopeFields } from "./RopeFields";
import { ToothSection } from "./ToothSection";
import { TurntableAddRopeMenu } from "./TurntableAddRopeMenu";
import { TurntableInstallMenu } from "./TurntableInstallMenu";
import { TurntableMoveMenu } from "./TurntableMoveMenu";

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

type Search = { [key: string]: string | string[] | undefined };

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

export default async function Home({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const activeModule = value(searchParams, "module") === "tooth" ? "tooth" : "rope";
  const locations = await prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const [ropeTypes, stocks, movements, requests, turntables] = activeModule === "rope"
    ? await Promise.all([
        prisma.ropeType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        prisma.ropeStock.findMany({
          where: { quantity: { gt: 0 }, status: { not: "WRITTEN_OFF" } },
          include: { ropeType: true, location: true, turntable: true },
          orderBy: [{ lastChangedAt: "desc" }]
        }),
        prisma.ropeMovement.findMany({
          take: 80,
          include: { user: true, ropeType: true, fromLocation: true, toLocation: true },
          orderBy: { createdAt: "desc" }
        }),
        prisma.mechanicRequest.findMany({
          include: { ropeType: true, fromLocation: true, toLocation: true, createdBy: true },
          orderBy: { createdAt: "desc" }
        }),
        prisma.turntable.findMany({
          include: {
            currentLocation: true,
            stocks: {
              where: { quantity: { gt: 0 }, status: { not: "WRITTEN_OFF" } },
              include: { ropeType: true, location: true },
              orderBy: { lastChangedAt: "desc" }
            }
          },
          orderBy: { name: "asc" }
        })
      ])
    : [[], [], [], [], []];
  const [toothTypes, toothBins, toothMovements] = activeModule === "tooth"
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
        prisma.toothMovement.findMany({
          take: 100,
          include: { user: true, bin: true, toothType: true, excavatorLocation: true },
          orderBy: { createdAt: "desc" }
        })
      ])
    : [[], [], []];

  const sortedLocations = [...locations].sort(compareLocations);
  const excavators = sortedLocations.filter((location) => location.category === "excavator");
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
      total: type
        ? stocks
            .filter((stock) => stock.ropeTypeId === type.id && stock.status !== "WRITTEN_OFF")
            .reduce((sum, stock) => sum + stock.quantity, 0)
        : 0
    };
  });
  const craneLocation = locations.find((location) => location.name === "Вешала под 30т краном");
  const underCrane = {
    hangers: craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === "HANGERS" && stock.status !== "WRITTEN_OFF")
          .reduce((sum, stock) => sum + stock.quantity, 0)
      : 0,
    turntables: craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === "TURNTABLE" && stock.status !== "WRITTEN_OFF")
          .reduce((sum, stock) => sum + stock.quantity, 0)
      : 0,
    ground: craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === "GROUND" && stock.status !== "WRITTEN_OFF")
          .reduce((sum, stock) => sum + stock.quantity, 0)
      : 0
  };
  const underCraneItems = (placement: string) =>
    craneLocation
      ? stocks
          .filter((stock) => stock.locationId === craneLocation.id && stock.placement === placement && stock.status !== "WRITTEN_OFF")
          .sort((a, b) => ropeTypeSortValue(a.ropeType.name) - ropeTypeSortValue(b.ropeType.name))
          .map((stock) => `${ropeTypeLabel(stock.ropeType.name)} - ${stock.quantity}`)
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
  const usedStocks = stocks.filter((stock) => stock.status === "USED_NEAR_EXCAVATOR");
  const undoableActions = new Set(["ADD", "ADJUST", "MOVE", "INSTALL", "ADD_USED", "WRITE_OFF", "MOVE_TURNTABLE"]);
  const operationKey = (movement: { id: number; operationId: string | null }) => movement.operationId ?? `legacy-${movement.id}`;
  const undoableOperationIds = new Set<string>();
  for (const movement of movements) {
    if (movement.userId !== user.id || !undoableActions.has(movement.action)) continue;
    undoableOperationIds.add(operationKey(movement));
    if (undoableOperationIds.size === 3) break;
  }
  const latestUndoOperationId = Array.from(undoableOperationIds)[0];
  const shownUndoOperationIds = new Set<string>();
  const movementRows = movements.map((movement) => {
    const key = operationKey(movement);
    const showUndo = undoableOperationIds.has(key) && !shownUndoOperationIds.has(key);
    if (showUndo) shownUndoOperationIds.add(key);
    return { movement, operationId: key, showUndo };
  });
  const turntableSummaries = turntables.map((turntable) => {
    const load = turntable.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
    return {
      id: turntable.id,
      name: turntable.name,
      currentLocationId: turntable.currentLocationId,
      location: locationLabel(turntable.currentLocation?.name) || "Место не указано",
      locationCategory: turntable.currentLocation?.category,
      load,
      items: turntable.stocks.map((stock) => `${ropeTypeLabel(stock.ropeType.name)} - ${stock.quantity}`),
      installStocks: turntable.stocks.map((stock) => ({
        id: stock.id,
        label: ropeTypeLabel(stock.ropeType.name),
        quantity: stock.quantity
      }))
    };
  });
  const turntableOptions = turntableSummaries.map(({ id, name, currentLocationId, location, load }) => ({ id, name, currentLocationId, location, load }));
  const turntableStockOptions = stocks
    .filter((stock) => stock.status === "AVAILABLE" && ["HANGERS", "GROUND", "TURNTABLE"].includes(stock.placement))
    .map((stock) => ({
      id: stock.id,
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
          <h1>Учёт канатов</h1>
          <p>{user.login} - {roleLabels[user.role]}</p>
        </div>
        <div className="topbar-actions">
          {latestUndoOperationId ? (
            <form action={undoMovementAction}>
              <input type="hidden" name="operationId" value={latestUndoOperationId} />
              <button className="top-undo-button" type="submit">Откатить</button>
            </form>
          ) : null}
          <form action={logoutAction}>
            <button className="ghost">Выход</button>
          </form>
        </div>
      </header>

      <nav className="module-tabs" aria-label="Разделы учета">
        <a className={activeModule === "rope" ? "active" : ""} href="?module=rope">Канат</a>
        <a className={activeModule === "tooth" ? "active" : ""} href="?module=tooth">Зуб</a>
      </nav>

      {activeModule === "tooth" ? (
        <ToothSection bins={toothBins} toothTypes={toothTypes} locations={sortedLocations} movements={toothMovements} canManageDictionaries={canManageLocations(user.role)} />
      ) : (
        <>
      <section id="Остатки" className="panel">
        <h3 className="summary-title">Под 20т краном</h3>
        <div className="summary-grid compact">
          <CraneQuickAdd label="На вешелах" items={underCraneItems("HANGERS")} quantities={underCraneQuantities("HANGERS")} placement="HANGERS" locationId={craneLocation?.id} ropeTypes={ropeTypes} turntables={turntableOptions} />
          <CraneQuickAdd label="На земле" items={underCraneItems("GROUND")} quantities={underCraneQuantities("GROUND")} placement="GROUND" locationId={craneLocation?.id} ropeTypes={ropeTypes} turntables={turntableOptions} />
        </div>

        <h3 className="summary-title">Вертушки</h3>
        <div className="turntable-grid">
          {turntableSummaries.map((turntable) => (
            <div className="turntable-card" key={turntable.id}>
              <div className="turntable-card-main">
                <strong>{turntable.items.length ? turntable.items.map((item) => <span key={item}>{item}</span>) : "Нет канатов"}</strong>
                <span className="turntable-location">{turntable.location}</span>
              </div>
              <p className="turntable-card-meta">{turntable.name} • {turntable.load ? `${turntable.load}/2` : "пустая"}</p>
              <TurntableAddRopeMenu
                turntableId={turntable.id}
                targetLocationId={turntable.currentLocationId}
                load={turntable.load}
                stocks={turntableStockOptions}
              />
              {turntable.locationCategory === "excavator" && turntable.load > 0 && turntable.currentLocationId ? (
                <TurntableInstallMenu excavatorId={turntable.currentLocationId} stocks={turntable.installStocks} />
              ) : null}
              <TurntableMoveMenu
                turntableId={turntable.id}
                currentLocationId={turntable.currentLocationId}
                load={turntable.load}
                locations={sortedLocations}
              />
            </div>
          ))}
        </div>

        {usedStocks.length ? (
          <>
            <h3 className="summary-title">Б/у вывезти</h3>
            <div className="used-evacuation-grid">
              {usedStocks.map((stock) => (
                <article className="stock-card used-evacuation-card" key={stock.id}>
                  <div className="card-head"><h3>{locationLabel(stock.location.name)}</h3><strong>{stock.quantity} шт</strong></div>
                  <p>{ropeTypeLabel(stock.ropeType.name)}</p>
                  <div className="stock-meta-line">
                    <span>{placementLabels[stock.placement]}</span>
                    <strong>{statusLabels[stock.status]}</strong>
                  </div>
                  <form action={evacuateUsedRopeAction} className="card-evacuate-form">
                    <input type="hidden" name="stockId" value={stock.id} />
                    <input type="hidden" name="quantity" value={stock.quantity} />
                    <button type="submit">Вывезти</button>
                  </form>
                  <small>Изм.: {dtf.format(stock.lastChangedAt)} - {stock.lastChangedBy}</small>
                </article>
              ))}
            </div>
          </>
        ) : null}

        <h3 className="summary-title">Сводка</h3>
        <div className="summary-grid">
          {summaryByType.map((item) => (
            <div className="metric summary-type-card" key={item.name}><span>{item.name}</span><b>{item.total} шт</b></div>
          ))}
        </div>

        <details className="history-details stock-details">
          <summary><span>Все остатки</span></summary>
          <div className="cards">
            {filteredStocks.filter((stock) => stock.status !== "USED_NEAR_EXCAVATOR").map((stock) => (
              <article className="stock-card" key={stock.id}>
                <div className="card-head"><h3>{locationLabel(stock.location.name)}</h3><strong>{stock.quantity} шт</strong></div>
                <p>{ropeTypeLabel(stock.ropeType.name)}{stock.turntable ? `, ${stock.turntable.name}` : ""}</p>
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

      <section id="История" className="panel"><details className="history-details"><summary><span>История</span></summary><div className="timeline">{movementRows.map(({ movement: m, operationId, showUndo }) => <article key={m.id}><b>{actionLabels[m.action]}</b><span>{dtf.format(m.createdAt)} - {m.user.login}</span><p>{ropeTypeLabel(m.ropeType?.name)} {m.diameter ?? ""} {m.length ? `${m.length} м` : ""}, {m.quantity} шт</p><small>{locationLabel(m.fromLocation?.name) || "-"} {" -> "} {locationLabel(m.toLocation?.name) || "-"} {m.comment ? `; ${m.comment}` : ""}</small>{showUndo ? <form action={undoMovementAction} className="undo-form"><input type="hidden" name="operationId" value={operationId} /><button type="submit">Откатить</button></form> : null}</article>)}</div></details></section>

      <section id="Места" className="panel">
        <details className="history-details">
          <summary><span>Справочник мест</span></summary>
          {canManageLocations(user.role) ? (
            <form action={saveLocationAction} className="form">
              <label>Название<input name="name" required /></label>
              <label>Категория<select name="category">{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <button className="primary big">Добавить место</button>
            </form>
          ) : <p className="muted">Редактирование мест доступно кладовщику.</p>}
          {canManageLocations(user.role) ? (
            <details className="location-delete-details">
              <summary>Удалить место</summary>
              <ConfirmSubmitForm action={deleteLocationAction} className="form delete-location-picker" message="Действительно удалить выбранное место?">
                <label>
                  Место
                  <select name="id" required>
                    {sortedLocations
                      .filter((l) => l.name !== "Вешала под 30т краном")
                      .map((l) => <option key={l.id} value={l.id}>{locationLabel(l.name)} - {categoryLabels[l.category]}</option>)}
                  </select>
                </label>
                <p className="danger-note">Место исчезнет из списков, но старая история сохранится.</p>
                <button className="danger big" type="submit">Да, удалить место</button>
              </ConfirmSubmitForm>
            </details>
          ) : null}
          <div className="list">
            {sortedLocations.map((l) => canManageLocations(user.role) ? (
              <form action={saveLocationAction} className="edit-location" key={l.id}>
                <input type="hidden" name="id" value={l.id} />
                <input name="name" defaultValue={l.name} />
                <select name="category" defaultValue={l.category}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                <button>Сохранить</button>
              </form>
            ) : <div key={l.id}><b>{locationLabel(l.name)}</b><span>{categoryLabels[l.category]}</span></div>)}
          </div>
        </details>
      </section>

      <section id="СправочникКанатов" className="panel">
        <details className="history-details">
          <summary><span>Справочник канатов</span></summary>
          {canManageLocations(user.role) ? (
            <>
              <details className="location-delete-details rope-type-details">
                <summary>Добавить тип каната</summary>
                <form action={saveRopeTypeAction} className="form delete-location-picker">
                  <label>Название<input name="name" placeholder="Например: Подъём ЭКГ-15" required /></label>
                  <label>Стандартная длина, м<input name="standardLength" type="number" min="1" required /></label>
                  <label>Диаметр<input name="defaultDiameter" placeholder="Например: 45 мм" required /></label>
                  <button className="primary big" type="submit">Добавить тип</button>
                </form>
              </details>

              <details className="location-delete-details rope-type-details">
                <summary>Удалить тип каната</summary>
                <ConfirmSubmitForm action={deleteRopeTypeAction} className="form delete-location-picker" message="Удалить выбранный тип каната?">
                  <label>
                    Тип каната
                    <select name="id" required>
                      {ropeTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {ropeTypeLabel(type.name)}, {type.standardLength} м{type.defaultDiameter ? `, ${type.defaultDiameter}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="danger-note">Тип исчезнет из списков добавления, но старая история и остатки сохранятся.</p>
                  <button className="danger big" type="submit">Удалить тип</button>
                </ConfirmSubmitForm>
              </details>
            </>
          ) : <p className="muted">Редактирование типов каната доступно кладовщику.</p>}
        </details>
      </section>

      <section id="Списать" className="panel">
        <details className="history-details">
          <summary><span>Списать б/у канат</span></summary>
          {canWriteOff(user.role) ? (
            <form action={writeOffRopeAction} className="form">
              <label>Б/у канат<select name="stockId">{usedStocks.map((s) => <option key={s.id} value={s.id}>{ropeTypeLabel(s.ropeType.name)}, {s.diameter}, {s.length} м, {s.quantity} шт - {locationLabel(s.location.name)}</option>)}</select></label>
              <label>Количество<input name="quantity" type="number" min="1" defaultValue="1" required /></label>
              <label>Комментарий<textarea name="comment" /></label>
              <button className="danger big">Списать</button>
            </form>
          ) : <p className="muted">Списание доступно начальнику и кладовщику.</p>}
        </details>
      </section>

      <section id="Заявки" className="panel"><h2>Заявки механикам</h2>{canManageRequests(user.role) ? <form action={createRequestAction} className="form"><RopeFields ropeTypes={ropeTypes} /><label>Откуда<select name="fromLocationId">{sortedLocations.map((l) => <option key={l.id} value={l.id}>{locationLabel(l.name)}</option>)}</select></label><label>Куда<select name="toLocationId">{sortedLocations.map((l) => <option key={l.id} value={l.id}>{locationLabel(l.name)}</option>)}</select></label><label>Комментарий<textarea name="comment" /></label><button className="primary big">Создать заявку</button></form> : <p className="muted">Создание заявок доступно начальнику.</p>}<div className="cards">{requests.map((r) => <article className="stock-card" key={r.id}><div className="card-head"><h3>{ropeTypeLabel(r.ropeType.name)}</h3><strong>{requestStatusLabels[r.status]}</strong></div><p>{r.diameter}, {r.length} м, {r.quantity} шт</p><p>{locationLabel(r.fromLocation.name)} {" -> "} {locationLabel(r.toLocation.name)}</p><small>{r.comment}</small><form action={updateRequestStatusAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><select name="status" defaultValue={r.status}>{Object.entries(requestStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button>Обновить</button></form></article>)}</div></section>

      <section id="Excel" className="panel"><h2>Excel-отчёты</h2>{canExport(user.role) ? <div className="export-box"><a className="primary big link-button" href="/reports/current">Текущий остаток .xlsx</a><form action="/reports/month" method="get" className="form"><label>Месяц<input name="month" type="month" defaultValue={new Date().toISOString().slice(0, 7)} /></label><button className="primary big">Движение за месяц .xlsx</button></form></div> : <p className="muted">Excel доступен начальнику и кладовщику.</p>}</section>

      {user.role === "storekeeper" ? (
        <section className="panel danger-zone">
          <details className="history-details">
            <summary><span>Очистка данных</span></summary>
            <div className="form">
              <p className="danger-note">Будут удалены все канаты и вся история. Пользователи, места, типы канатов, вертушки и заявки останутся.</p>
              <ClearAllRopesButton />
            </div>
          </details>
        </section>
      ) : null}
        </>
      )}
    </main>
  );
}
