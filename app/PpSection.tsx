import {
  adjustPpSectorAction,
  deletePpPointAction,
  deletePpSectorAction,
  savePpEquipmentAction,
  savePpPointAction,
  savePpSectorAction,
  setPpSectorMaterialAction
} from "@/app/actions";
import { compareLocations, locationLabel, ppActionLabels, ppMaterialLetters } from "@/lib/labels";
import { ConfirmSubmitForm } from "./ConfirmSubmitForm";
import { LazyDetails } from "./LazyDetails";

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

function SectorAdjustButton({ sectorId, delta, disabled }: { sectorId: number; delta: 1 | -1; disabled?: boolean }) {
  return (
    <form action={adjustPpSectorAction}>
      <input type="hidden" name="sectorId" value={sectorId} />
      <input type="hidden" name="delta" value={delta} />
      <button className={delta > 0 ? "pp-plus" : "pp-minus"} type="submit" disabled={disabled}>
        {delta > 0 ? "+" : "-"}
      </button>
    </form>
  );
}

function SectorMaterialButton({ sectorId, material, active }: { sectorId: number; material: "ORE" | "OVERBURDEN"; active: boolean }) {
  return (
    <form action={setPpSectorMaterialAction}>
      <input type="hidden" name="sectorId" value={sectorId} />
      <input type="hidden" name="material" value={material} />
      <button
        className={`pp-material-button ${material === "ORE" ? "ore" : "overburden"}${active ? " active" : ""}`}
        type="submit"
        aria-label={material === "ORE" ? "Руда" : "Вскрыша"}
      >
        {material === "ORE" ? "Р" : "В"}
      </button>
    </form>
  );
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
        <h2>П/П</h2>
        <div className="pp-grid">
          {sortedPoints.map((point) => {
            const sectors = sortedSectors(point.sectors);
            return (
              <article className="pp-card" key={point.id}>
                <div className="pp-card-head">
                  <strong>{point.name}</strong>
                  <span>{equipmentName(point.equipmentLocation)}</span>
                </div>

                <form action={savePpEquipmentAction} className="pp-equipment-form">
                  <input type="hidden" name="pointId" value={point.id} />
                  <select name="equipmentLocationId" defaultValue={point.equipmentLocationId ?? ""}>
                    <option value="">Без техники</option>
                    {sortedEquipment.map((location) => (
                      <option key={location.id} value={location.id}>{locationLabel(location.name)}</option>
                    ))}
                  </select>
                  <button type="submit">ОК</button>
                </form>

                <div className="pp-sector-list">
                  {sectors.map((sector) => (
                    <div className="pp-sector-row" key={sector.id}>
                      <span>{sector.name} -</span>
                      <b className={sector.material === "ORE" ? "ore" : "overburden"}>
                        {sector.quantity}{ppMaterialLetters[sector.material] ?? "В"}
                      </b>
                      <SectorMaterialButton sectorId={sector.id} material="ORE" active={sector.material === "ORE"} />
                      <SectorMaterialButton sectorId={sector.id} material="OVERBURDEN" active={sector.material !== "ORE"} />
                      <SectorAdjustButton sectorId={sector.id} delta={1} />
                      <SectorAdjustButton sectorId={sector.id} delta={-1} disabled={sector.quantity < 1} />
                    </div>
                  ))}
                </div>

                <small>
                  Изм.: {dtf.format(point.lastChangedAt)}{point.lastChangedBy ? ` - ${point.lastChangedBy}` : ""}
                </small>
              </article>
            );
          })}
        </div>
      </section>

      {canManageDictionaries ? (
        <section className="panel">
          <details className="history-details">
            <summary><span>Справочник П/П</span></summary>

            <form action={savePpPointAction} className="form delete-location-picker">
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
            </form>

            <details className="location-delete-details">
              <summary>Сектора</summary>
              <div className="pp-admin-list">
                {sortedPoints.map((point) => (
                  <div className="pp-admin-card" key={point.id}>
                    <b>{point.name}</b>
                    <form action={savePpSectorAction} className="pp-admin-row">
                      <input type="hidden" name="pointId" value={point.id} />
                      <input name="name" placeholder="Сектор" required />
                      <button type="submit">Добавить</button>
                    </form>
                    {sortedSectors(point.sectors).map((sector) => (
                      <div className="pp-admin-row" key={sector.id}>
                        <span>Сектор {sector.name}</span>
                        <ConfirmSubmitForm action={deletePpSectorAction} message="Удалить сектор?">
                          <input type="hidden" name="sectorId" value={sector.id} />
                          <button className="danger" type="submit" disabled={sector.quantity > 0}>Удалить</button>
                        </ConfirmSubmitForm>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>

            <ConfirmSubmitForm action={deletePpPointAction} className="form delete-location-picker" message="Убрать П/П из учета?">
              <label>
                Убрать П/П
                <select name="pointId">
                  {sortedPoints.map((point) => (
                    <option key={point.id} value={point.id}>{point.name}</option>
                  ))}
                </select>
              </label>
              <button className="danger" type="submit">Убрать П/П</button>
            </ConfirmSubmitForm>
          </details>
        </section>
      ) : null}

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
    </section>
  );
}
