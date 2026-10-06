import {
  deletePpPointAction,
  deletePpSectorAction,
  savePpPointAction,
  savePpSectorAction
} from "@/app/actions";
import { compareLocations, locationLabel, ppActionLabels } from "@/lib/labels";
import { LazyDetails } from "./LazyDetails";
import { ManagementDialog, ManagementForm, ManagementSection } from "./Management";
import { PpCardControls, PpControlsProvider, PpSendButton } from "./PpControls";

type LocationOption = {
  id: number;
  name: string;
  category: string;
};

type PpSectorView = {
  id: number;
  name: string;
  quantity: number;
  material: string;
  isActive: boolean;
  lastChangedAt: Date;
  lastChangedBy: string | null;
};

type PpPointView = {
  id: number;
  name: string;
  isActive: boolean;
  equipmentLocationId: number | null;
  unloadingSectorId: number | null;
  equipmentSectorId: number | null;
  lastChangedAt: Date;
  lastChangedBy: string | null;
  equipmentLocation: LocationOption | null;
  sectors: PpSectorView[];
};

type PpMovementView = {
  id: number;
  createdAt: Date;
  action: string;
  fromText: string | null;
  toText: string | null;
  oldQuantity: number | null;
  newQuantity: number | null;
  user: { login: string };
  ppPoint: { name: string };
  sector: { name: string } | null;
  equipmentLocation: { name: string } | null;
};

const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

function ppNumber(name: string) {
  return Number(name.match(/№\s*(\d+)/)?.[1] ?? 9999);
}

function sectorSortValue(name: string) {
  return Number(name.match(/\d+/)?.[0] ?? 9999);
}

function sortedSectors(sectors: PpSectorView[]) {
  return sectors
    .filter((sector) => sector.isActive)
    .sort((a, b) => sectorSortValue(a.name) - sectorSortValue(b.name) || a.name.localeCompare(b.name, "ru"));
}

function equipmentName(location?: LocationOption | null) {
  return location ? locationLabel(location.name) : "Без техники";
}

export function PpSection({
  points,
  equipmentOptions,
  movements,
  canManageDictionaries,
  historyOpen
}: {
  points: PpPointView[];
  equipmentOptions: LocationOption[];
  movements: PpMovementView[];
  canManageDictionaries: boolean;
  historyOpen: boolean;
}) {
  const sortedPoints = [...points].sort((a, b) => ppNumber(a.name) - ppNumber(b.name) || a.name.localeCompare(b.name, "ru"));
  const sortedEquipment = [...equipmentOptions].sort(compareLocations);

  return (
    <section className="pp-section">
      <section className="panel">
        <PpControlsProvider>
        <div className="pp-heading"><h2>П/П</h2><PpSendButton /></div>
        {process.env.RAPMAS_PP_REVIEW === "1" ? <p className="pp-review-note">Локальная проверка · учебные данные · рабочая группа MAX не подключена</p> : null}
        <div className="pp-grid">
          {sortedPoints.map((point) => {
            const sectors = sortedSectors(point.sectors);
            return (
              <article className="pp-card" key={point.id}>
                <div className="pp-card-head">
                  <strong>{point.name}</strong>
                  <span>{equipmentName(point.equipmentLocation)}</span>
                </div>

                <PpCardControls point={point} sectors={sectors} equipment={sortedEquipment.map((location) => ({ id: location.id, label: locationLabel(location.name) }))} />

                <small>
                  Изм.: {dtf.format(point.lastChangedAt)}{point.lastChangedBy ? ` - ${point.lastChangedBy}` : ""}
                </small>
              </article>
            );
          })}
        </div>
        </PpControlsProvider>
      </section>


      <section className="panel">
        <LazyDetails label="История П/П" queryKey="history" open={historyOpen}>
          <div className="timeline">
            {movements.map((movement) => (
              <article key={movement.id}>
                <b>{ppActionLabels[movement.action] ?? movement.action}</b>
                <span>{dtf.format(movement.createdAt)} - {movement.user.login}</span>
                <p>{movement.ppPoint.name}{movement.sector ? `, сектор ${movement.sector.name}` : ""}</p>
                <small>
                  {movement.fromText || "-"} {" -> "} {movement.toText || "-"}
                  {movement.equipmentLocation ? `; ${locationLabel(movement.equipmentLocation.name)}` : ""}
                </small>
              </article>
            ))}
          </div>
        </LazyDetails>
      </section>
      {canManageDictionaries ? (
        <ManagementSection>
          <ManagementDialog title="Добавить П/П" kind="add">

            <ManagementForm action={savePpPointAction}>
              <label>
                Номер П/П
                <input name="name" placeholder="Например: ПП №9" required />
              </label>
              <label>
                Техника
                <select name="equipmentLocationId" defaultValue="">
                  <option value="">Без техники</option>
                  {sortedEquipment.map((location) => (
                    <option key={location.id} value={location.id}>{locationLabel(location.name)}</option>
                  ))}
                </select>
              </label>
              <label>
                Сектора
                <input name="sectors" placeholder="Например: 1, 2, 3" />
              </label>
              <button className="primary big" type="submit">Добавить П/П</button>
            </ManagementForm>
          </ManagementDialog>

            <ManagementDialog title="Сектора">
              <div className="pp-admin-list">
                {sortedPoints.map((point) => (
                  <div className="pp-admin-card" key={point.id}>
                    <b>{point.name}</b>
                    <ManagementForm action={savePpSectorAction} className="pp-admin-row">
                      <input type="hidden" name="pointId" value={point.id} />
                      <input name="name" aria-label={`Новый сектор ${point.name}`} placeholder="Сектор" required />
                      <button type="submit">Добавить</button>
                    </ManagementForm>
                    {sortedSectors(point.sectors).map((sector) => (
                      <div className="pp-admin-row" key={sector.id}>
                        <span>Сектор {sector.name}</span>
                        <ManagementForm action={deletePpSectorAction} message="Удалить сектор?">
                          <input type="hidden" name="sectorId" value={sector.id} />
                          <button className="danger" type="submit" disabled={sector.quantity > 0}>Удалить</button>
                        </ManagementForm>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ManagementDialog>

          <ManagementDialog title="Убрать П/П" kind="delete">
            <ManagementForm action={deletePpPointAction} message="Убрать П/П из учета?">
              <label>
                Убрать П/П
                <select name="pointId">
                  {sortedPoints.map((point) => (
                    <option key={point.id} value={point.id}>{point.name}</option>
                  ))}
                </select>
              </label>
              <button className="danger" type="submit">Убрать П/П</button>
            </ManagementForm>
          </ManagementDialog>
        </ManagementSection>
      ) : null}
    </section>
  );
}
