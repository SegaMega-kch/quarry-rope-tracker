import { clearAllTeethAction, deleteToothBinAction, deleteToothTypeAction, saveToothBinAction, saveToothTypeAction, scrapToothBinAction, undoToothMovementAction } from "@/app/actions";
import { compareLocations, locationLabel, toothActionLabels, toothConditionLabels } from "@/lib/labels";
import { ConfirmSubmitForm } from "./ConfirmSubmitForm";
import { ToothBinMoveMenu } from "./ToothBinMoveMenu";
import { ToothGroundQuickAdd } from "./ToothGroundQuickAdd";
import { ToothInstallMenu } from "./ToothInstallMenu";
import { ToothLoadToBinMenu } from "./ToothLoadToBinMenu";
import { ToothBinUnloadMenu } from "./ToothBinUnloadMenu";
import { ToothGroundStockMenu } from "./ToothGroundStockMenu";
import { LazyDetails } from "./LazyDetails";
import { ManagementDialog, ManagementForm, ManagementSection } from "./Management";

type LocationOption = {
  id: number;
  name: string;
  category: string;
  isActive?: boolean;
};

type ToothTypeOption = {
  id: number;
  name: string;
};

type ToothStockView = {
  id: number;
  toothTypeId: number;
  condition: string;
  quantity: number;
  toothType: ToothTypeOption;
};

type ToothBinView = {
  id: number;
  name: string;
  currentLocationId: number | null;
  customLocation: string | null;
  kind: string;
  lastChangedAt: Date;
  lastChangedBy: string | null;
  currentLocation: LocationOption | null;
  stocks: ToothStockView[];
};

type ToothMovementView = {
  id: number;
  createdAt: Date;
  action: string;
  condition: string | null;
  quantity: number | null;
  fromLocationText: string | null;
  toLocationText: string | null;
  comment: string | null;
  binId: number;
  userId: number;
  user: { login: string };
  bin: { name: string };
  toothType: { name: string } | null;
  excavatorLocation: { name: string } | null;
};

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
const toothGroundBinName = "Земля под 30т краном";

function toothLocationLabel(name?: string | null) {
  if (!name) return "";
  return name === "Вешала под 30т краном" ? "30т кран" : locationLabel(name);
}

function binLocation(bin: ToothBinView) {
  return bin.customLocation || toothLocationLabel(bin.currentLocation?.name) || "Место не указано";
}

function stockQuantity(bin: ToothBinView, toothTypeId: number, condition: string) {
  return bin.stocks
    .filter((stock) => stock.toothTypeId === toothTypeId && stock.condition === condition)
    .reduce((sum, stock) => sum + stock.quantity, 0);
}

function totalByType(bins: ToothBinView[], toothTypeId: number, condition: string) {
  return bins.reduce((sum, bin) => sum + stockQuantity(bin, toothTypeId, condition), 0);
}

function LocationFields({ locations, defaultLocationId }: { locations: LocationOption[]; defaultLocationId?: number | null }) {
  return (
    <>
      <label>
        Место
        <select name="locationId" defaultValue={defaultLocationId ?? ""}>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{toothLocationLabel(location.name)}</option>
          ))}
          <option value="custom">Другое место</option>
        </select>
      </label>
      <label>
        Другое место
        <input name="customLocation" placeholder="Заполнить, если выбрано другое место" />
      </label>
    </>
  );
}

export function ToothSection({
  bins,
  toothTypes,
  locations,
  movements,
  currentUserId,
  canManageDictionaries,
  canDispose,
  historyOpen,
  undoAfter
}: {
  bins: ToothBinView[];
  toothTypes: ToothTypeOption[];
  locations: LocationOption[];
  movements: ToothMovementView[];
  currentUserId: number;
  canManageDictionaries: boolean;
  canDispose: boolean;
  historyOpen: boolean;
  undoAfter?: Date;
}) {
  const sortedLocations = [...locations].sort(compareLocations);
  const excavators = sortedLocations.filter((location) => location.category === "excavator");
  const groundBins = bins.filter((bin) => bin.kind === "GROUND" || bin.name === toothGroundBinName);
  const groundBin = groundBins.find((bin) => bin.name === toothGroundBinName);
  const locationGroundBins = groundBins.filter((bin) => bin.stocks.some((stock) => stock.quantity > 0) && (bin.name !== toothGroundBinName || bin.stocks.some((stock) => stock.condition === "USED")));
  const visibleBins = bins.filter((bin) => bin.kind !== "GROUND" && bin.name !== toothGroundBinName);
  const groundItems = toothTypes
    .map((type) => ({ type, quantity: groundBin ? stockQuantity(groundBin, type.id, "NEW") : 0 }))
    .filter((item) => item.quantity > 0);
  const recentUndoIds = new Set(
    movements
      .filter((movement) => movement.userId === currentUserId && (!undoAfter || movement.createdAt > undoAfter) && ["ADD", "ADJUST", "MOVE", "INSTALL", "WRITE_OFF", "SCRAP", "UNLOAD_GROUND", "LOAD_GROUND", "INSTALL_GROUND", "EVACUATE_GROUND"].includes(movement.action))
      .slice(0, 3)
      .map((movement) => movement.id)
  );

  return (
    <section className="tooth-section">
      <section className="panel tooth-crane-panel">
        <h3 className="summary-title">Под 30т краном</h3>
        <ToothGroundQuickAdd items={groundItems} toothTypes={toothTypes} />
      </section>

      <div className="tooth-bin-grid">
        {visibleBins.map((bin) => {
          const total = bin.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
          const newTotal = bin.stocks.filter((stock) => stock.condition === "NEW").reduce((sum, stock) => sum + stock.quantity, 0);
          const usedTotal = bin.stocks.filter((stock) => stock.condition === "USED").reduce((sum, stock) => sum + stock.quantity, 0);
          const canInstall = bin.currentLocation?.category === "excavator" && newTotal > 0;
          const canScrap = canDispose && bin.currentLocation?.name === "Вешала под 30т краном" && usedTotal > 0;
          const stockTypes = Array.from(new Map(bin.stocks.map((stock) => [stock.toothTypeId, stock.toothType])).values());
          const installItems = stockTypes
            .map((type) => ({ type, quantity: stockQuantity(bin, type.id, "NEW") }))
            .filter((item) => item.quantity > 0);

          return (
            <article className={`panel tooth-bin-card ${total > 0 ? "cargo-loaded" : "cargo-empty"}`} key={bin.id}>
              <div className="turntable-card-main tooth-bin-card-main">
                <span className="turntable-location">{binLocation(bin)}</span>
                <div className="cargo-contents">
                {stockTypes.length ? stockTypes.map((type) => {
                  const fresh = stockQuantity(bin, type.id, "NEW");
                  const used = stockQuantity(bin, type.id, "USED");
                  return (
                    <span className="tooth-bin-load-line" key={type.id}>
                      <b>{type.name.replace("Зуб ", "")}</b>
                      <span className="tooth-new-count">{fresh} - новых</span>
                      <span className="tooth-used-count">{used} - б/у</span>
                    </span>
                  );
                }) : "Нет зубьев"}
                </div>
              </div>
              <p className="turntable-card-meta">{bin.name}</p>
              <small>Изм.: {dtf.format(bin.lastChangedAt)}{bin.lastChangedBy ? ` - ${bin.lastChangedBy}` : ""}</small>

              <div className="tooth-actions">
                <ToothLoadToBinMenu binId={bin.id} items={groundItems} />
                <ToothInstallMenu binId={bin.id} excavatorLocationId={bin.currentLocationId} items={installItems} disabled={!canInstall} />
                <ToothBinUnloadMenu binId={bin.id} stocks={bin.stocks} atCrane={bin.currentLocation?.name === "Вешала под 30т краном"} disabled={!bin.currentLocationId || total < 1} />
                <ToothBinMoveMenu binId={bin.id} locations={sortedLocations} />
                {canScrap ? (
                  <ConfirmSubmitForm action={scrapToothBinAction} message="Разгрузить Б/У зубья в металлолом?">
                    <input type="hidden" name="binId" value={bin.id} />
                    <button className="danger big" type="submit">В лом</button>
                  </ConfirmSubmitForm>
                ) : null}

              </div>
            </article>
          );
        })}
      </div>

      {locationGroundBins.length ? (
        <section className="tooth-ground-section" aria-labelledby="ground-teeth-title">
          <h3 id="ground-teeth-title" className="summary-title">Зубья на земле</h3>
          <div className="tooth-ground-grid">
            {locationGroundBins.map((ground) => (
              <article className="tooth-ground-card used-evacuation-card" key={ground.id}>
                <div className="tooth-ground-head"><div><strong>{binLocation(ground)}</strong><span>{ground.currentLocation?.isActive === false ? "Экскаватор в архиве" : "На земле"}</span></div><b>{ground.stocks.reduce((sum, stock) => sum + stock.quantity, 0)} шт</b></div>
                <div className="tooth-ground-stock-list">
                  {ground.stocks.map((stock) => (
                    <div className="tooth-ground-stock-row" key={stock.id}>
                      <div><strong>{stock.toothType.name.replace("Зуб ", "")}</strong><span className={stock.condition === "NEW" ? "tooth-new-count" : "tooth-used-count"}>{stock.quantity} - {stock.condition === "NEW" ? "новых" : "б/у"}</span></div>
                      <ToothGroundStockMenu
                        groundBinId={ground.id}
                        toothTypeId={stock.toothTypeId}
                        condition={stock.condition}
                        quantity={stock.quantity}
                        canInstall={ground.currentLocation?.category === "excavator" && ground.currentLocation.isActive !== false}
                        locations={sortedLocations.filter((place) => place.id !== ground.currentLocationId)}
                        bins={visibleBins.filter((bin) => bin.currentLocationId === ground.currentLocationId).map((bin) => ({ id: bin.id, name: bin.name }))}
                      />
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="panel tooth-summary">
        <h2>Зуб</h2>
        <div className="tooth-summary-grid">
          {toothTypes.map((type) => {
            const fresh = totalByType(bins, type.id, "NEW");
            const used = totalByType(bins, type.id, "USED");
            return (
              <div className="tooth-summary-card" key={type.id}>
                <strong>{type.name.replace("Зуб ", "")}</strong>
                <span>Новые: {fresh}</span>
                <span>Б/У: {used}</span>
                <b>Всего: {fresh + used}</b>
              </div>
            );
          })}
        </div>
      </div>


      <section className="panel">
        <LazyDetails label="Общая история зубьев" queryKey="history" open={historyOpen}>
          <div className="timeline">
            {movements.map((movement) => (
              <article key={movement.id}>
                <b>{toothActionLabels[movement.action] ?? movement.action}</b>
                <span>{dtf.format(movement.createdAt)} - {movement.user.login}</span>
                <p>{movement.bin.name}. {movement.toothType?.name ?? ""} {movement.condition ? toothConditionLabels[movement.condition] : ""} {movement.quantity ? `${movement.quantity} шт` : ""}</p>
                <small>{movement.fromLocationText || "-"} {" -> "} {movement.toLocationText || "-"}{movement.excavatorLocation ? `; ${locationLabel(movement.excavatorLocation.name)}` : ""}{movement.comment ? `; ${movement.comment}` : ""}</small>
                {recentUndoIds.has(movement.id) ? (
                  <form action={undoToothMovementAction} className="undo-form">
                    <input type="hidden" name="movementId" value={movement.id} />
                    <button type="submit">Откатить</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </LazyDetails>
      </section>
      {canManageDictionaries ? (
        <ManagementSection>

            <ManagementDialog title="Добавить пену" kind="add">
              <ManagementForm action={saveToothBinAction}>
                <label>Название<input name="name" placeholder="Например: Пена 3" required /></label>
                <LocationFields locations={sortedLocations} defaultLocationId={sortedLocations[0]?.id} />
                <button className="primary big" type="submit">Добавить пену</button>
              </ManagementForm>
            </ManagementDialog>

            <ManagementDialog title="Редактировать пены">
              <div className="list">
                {visibleBins.map((bin) => (
                  <ManagementForm action={saveToothBinAction} className="edit-location" key={bin.id}>
                    <input type="hidden" name="id" value={bin.id} />
                    <input name="name" aria-label={`Название ${bin.name}`} defaultValue={bin.name} />
                    <LocationFields locations={sortedLocations} defaultLocationId={bin.currentLocationId} />
                    <button>Сохранить</button>
                  </ManagementForm>
                ))}
              </div>
            </ManagementDialog>

            <ManagementDialog title="Удалить пену" kind="delete">
              <ManagementForm action={deleteToothBinAction} message="Удалить выбранную пену?">
                <label>
                  Пена
                  <select name="id" required>
                    {visibleBins.map((bin) => (
                      <option key={bin.id} value={bin.id}>{bin.name} - {binLocation(bin)}</option>
                    ))}
                  </select>
                </label>
                <p className="danger-note">Удалить можно только пустую пену. История сохраняется.</p>
                <button className="danger big" type="submit">Удалить пену</button>
              </ManagementForm>
            </ManagementDialog>

            <ManagementDialog title="Добавить вид зубьев" kind="add">
              <ManagementForm action={saveToothTypeAction}>
                <label>Название<input name="name" placeholder="Например: Зуб ЭКГ-12К" required /></label>
                <button className="primary big" type="submit">Добавить вид</button>
              </ManagementForm>
            </ManagementDialog>

            <ManagementDialog title="Удалить вид зубьев" kind="delete">
              <ManagementForm action={deleteToothTypeAction} message="Удалить выбранный вид зубьев?">
                <label>
                  Вид зубьев
                  <select name="id" required>
                    {toothTypes.map((type) => (
                      <option key={type.id} value={type.id}>{type.name}</option>
                    ))}
                  </select>
                </label>
                <p className="danger-note">Вид исчезнет из списков добавления, но старая история и остатки сохранятся.</p>
                <button className="danger big" type="submit">Удалить вид</button>
              </ManagementForm>
            </ManagementDialog>

            <ManagementDialog title="Очистить все зубья" kind="delete">
              <ManagementForm action={clearAllTeethAction} message="Удалить все зубья и всю историю зубьев?">
                <p className="danger-note">Будут удалены все остатки зубьев и вся история зубьев. Пены, места и виды зубьев останутся.</p>
                <button className="danger big" type="submit">Очистить все зубья</button>
              </ManagementForm>
            </ManagementDialog>
        </ManagementSection>
      ) : null}
    </section>
  );
}
