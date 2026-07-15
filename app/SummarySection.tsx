import { compareLocations, locationLabel, ppMaterialLetters, ropeTypeLabel, ropeTypeSortValue, shortHorizonLabel, yaknoLabel } from "@/lib/labels";
import { SummaryShareButton } from "./SummaryShareButton";

type LocationView = {
  id: number;
  name: string;
  category: string;
};

type RopeStockView = {
  id: number;
  ropeTypeId: number;
  diameter: string;
  length: number;
  quantity: number;
  locationId: number;
  placement: string;
  status: string;
  turntableId: number | null;
  ropeType: { name: string };
  location: LocationView;
  turntable: { name: string } | null;
};

type TurntableView = {
  id: number;
  name: string;
  currentLocationId: number | null;
  currentLocation: LocationView | null;
};

type ToothBinView = {
  id: number;
  name: string;
  currentLocation: LocationView | null;
  customLocation: string | null;
  stocks: {
    id: number;
    condition: string;
    quantity: number;
    toothType: { name: string };
  }[];
};

type AssemblyView = {
  id: number;
  name: string;
  status: string;
  isPowered: boolean;
  length: number | null;
  comment: string | null;
  horizon: { name: string } | null;
  excavatorLocation: LocationView | null;
};

type PpPointView = {
  id: number;
  name: string;
  equipmentLocation: LocationView | null;
  sectors: {
    id: number;
    name: string;
    quantity: number;
    material: string;
    isActive: boolean;
  }[];
};

type YaknoBoxView = {
  id: number;
  number: string;
  isActive: boolean;
  status: string;
  comment: string | null;
  excavatorLocationId: number | null;
  isPowered: boolean;
  horizon: { name: string } | null;
  excavatorLocation: LocationView | null;
};

type YaknoStateView = {
  id: number;
  excavatorLocationId: number;
  horizon: { name: string } | null;
};

function locationNumber(name: string) {
  return Number(name.match(/(?:№\s*)?(\d+)/)?.[1] ?? 9999);
}

function ppNumber(name: string) {
  return Number(name.match(/№\s*(\d+)/)?.[1] ?? 9999);
}

function yaknoNumberValue(number: string) {
  return Number(number.match(/\d+/)?.[0] ?? 9999);
}

function sectorSortValue(name: string) {
  return Number(name.match(/\d+/)?.[0] ?? 9999);
}

function compactItems(items: string[]) {
  return items.length ? items.join(", ") : "нет";
}

function shortComment(comment?: string | null) {
  if (!comment) return "";
  return comment.length > 20 ? `${comment.slice(0, 20)}...` : comment;
}

function stockText(stock: RopeStockView) {
  return `${ropeTypeLabel(stock.ropeType.name)} - ${stock.quantity}`;
}

function toothLocation(bin: ToothBinView) {
  return bin.currentLocation ? locationLabel(bin.currentLocation.name) : bin.customLocation || "место не указано";
}

function toothStockText(bin: ToothBinView) {
  const parts = bin.stocks
    .filter((stock) => stock.quantity > 0)
    .map((stock) => `${stock.toothType.name} ${stock.condition === "USED" ? "Б/У" : "новые"} ${stock.quantity}`);

  return parts.length ? parts.join(", ") : "пустая";
}

function assemblyText(assembly: AssemblyView) {
  if (assembly.status === "REPAIR") return `${assembly.name}: ремонт`;

  const place = assembly.horizon?.name?.replace("Горизонт ", "") ?? "гор. не указан";
  const length = assembly.length ? `${assembly.length}м` : "длина ?";
  const powered = assembly.isPowered && assembly.excavatorLocation ? locationLabel(assembly.excavatorLocation.name) : "не запитана";
  const comment = shortComment(assembly.comment);

  return `${assembly.name}: ${place}, ${length}, ${powered}${comment ? `, ${comment}` : ""}`;
}

function ppText(point: PpPointView) {
  const equipment = point.equipmentLocation ? locationLabel(point.equipmentLocation.name) : "без техники";
  const sectors = point.sectors
    .filter((sector) => sector.isActive)
    .sort((a, b) => sectorSortValue(a.name) - sectorSortValue(b.name) || a.name.localeCompare(b.name, "ru"))
    .map((sector) => `${sector.name}-${sector.quantity}${ppMaterialLetters[sector.material] ?? "В"}`);

  return `${point.name} ${equipment}: ${compactItems(sectors)}`;
}

function stateFor(states: YaknoStateView[], excavatorId: number) {
  return states.find((state) => state.excavatorLocationId === excavatorId) ?? null;
}

function yaknoLine(box: YaknoBoxView, powered = false) {
  const comment = shortComment(box.comment);
  return `${yaknoLabel(box.number)}${powered ? " зап" : ""}${comment ? ` (${comment})` : ""}`;
}

export function SummarySection({
  stocks,
  turntables,
  toothBins,
  assemblies,
  ppPoints,
  excavators,
  yaknoBoxes,
  yaknoStates
}: {
  stocks: RopeStockView[];
  turntables: TurntableView[];
  toothBins: ToothBinView[];
  assemblies: AssemblyView[];
  ppPoints: PpPointView[];
  excavators: LocationView[];
  yaknoBoxes: YaknoBoxView[];
  yaknoStates: YaknoStateView[];
}) {
  const crane = stocks.find((stock) => locationLabel(stock.location.name) === "20т кран")?.location;
  const availableStocks = stocks.filter((stock) => stock.status === "AVAILABLE");
  const craneStocks = crane ? availableStocks.filter((stock) => stock.locationId === crane.id && !stock.turntableId) : [];
  const quarryStocks = availableStocks.filter((stock) => (!crane || stock.locationId !== crane.id) && !stock.turntableId);
  const ropeGroups = [
    ...craneStocks
      .sort((a, b) => ropeTypeSortValue(a.ropeType.name) - ropeTypeSortValue(b.ropeType.name))
      .map((stock) => `20т кран ${stock.placement === "HANGERS" ? "веш." : "зем."}: ${stockText(stock)}`),
    ...quarryStocks
      .sort((a, b) => compareLocations(a.location, b.location) || ropeTypeSortValue(a.ropeType.name) - ropeTypeSortValue(b.ropeType.name))
      .map((stock) => `${locationLabel(stock.location.name)}: ${stockText(stock)}`)
  ];

  const turntableRows = turntables.map((turntable) => {
    const load = availableStocks
      .filter((stock) => stock.turntableId === turntable.id)
      .sort((a, b) => ropeTypeSortValue(a.ropeType.name) - ropeTypeSortValue(b.ropeType.name))
      .map(stockText);
    return `${turntable.name} ${locationLabel(turntable.currentLocation?.name) || "место не указано"}: ${compactItems(load)}`;
  });

  const toothRows = toothBins
    .sort((a, b) => locationNumber(a.name) - locationNumber(b.name) || a.name.localeCompare(b.name, "ru"))
    .map((bin) => `${bin.name} ${toothLocation(bin)}: ${toothStockText(bin)}`);

  const assemblyRows = assemblies
    .sort((a, b) => locationNumber(a.name) - locationNumber(b.name) || a.name.localeCompare(b.name, "ru"))
    .map(assemblyText);

  const ppRows = ppPoints
    .sort((a, b) => ppNumber(a.name) - ppNumber(b.name) || a.name.localeCompare(b.name, "ru"))
    .map(ppText);

  const activeYaknoBoxes = yaknoBoxes.filter((box) => box.isActive);
  const usableYaknoBoxes = activeYaknoBoxes.filter((box) => box.status !== "REPAIR");
  const freeYaknoBoxes = usableYaknoBoxes
    .filter((box) => !box.excavatorLocationId)
    .sort((a, b) => yaknoNumberValue(a.number) - yaknoNumberValue(b.number) || a.number.localeCompare(b.number, "ru"));
  const repairYaknoBoxes = activeYaknoBoxes
    .filter((box) => box.status === "REPAIR")
    .sort((a, b) => yaknoNumberValue(a.number) - yaknoNumberValue(b.number) || a.number.localeCompare(b.number, "ru"));
  const yaknoRows = excavators.map((excavator) => {
    const state = stateFor(yaknoStates, excavator.id);
    const assigned = usableYaknoBoxes
      .filter((box) => box.excavatorLocationId === excavator.id)
      .sort((a, b) => Number(b.isPowered) - Number(a.isPowered) || yaknoNumberValue(a.number) - yaknoNumberValue(b.number));
    const powered = assigned.find((box) => box.isPowered);
    const rest = assigned.filter((box) => !box.isPowered).map((box) => yaknoLine(box));
    const boxes = powered ? [yaknoLine(powered, true), ...rest] : rest;
    return `${locationLabel(excavator.name)} ${shortHorizonLabel(state?.horizon?.name)}: ${compactItems(boxes)}`;
  });
  const shareText = [
    "Сводка",
    "",
    "Канат:",
    ...(ropeGroups.length ? ropeGroups : ["Канатов нет"]),
    ...turntableRows,
    "",
    "Зуб:",
    ...(toothRows.length ? toothRows : ["Зубьев нет"]),
    "",
    "Сборки:",
    ...(assemblyRows.length ? assemblyRows : ["Сборок нет"]),
    "",
    "П/П:",
    ...(ppRows.length ? ppRows : ["П/П нет"]),
    "",
    "ЯКНО:",
    ...yaknoRows,
    ...(freeYaknoBoxes.length ? [`Свободные: ${freeYaknoBoxes.map((box) => yaknoLine(box)).join(", ")}`] : []),
    ...(repairYaknoBoxes.length ? [`Ремонт: ${repairYaknoBoxes.map((box) => yaknoLine(box)).join(", ")}`] : [])
  ].join("\n");

  return (
    <section className="summary-section">
      <article className="summary-screen">
        <div className="summary-screen-head">
          <h2>Сводка</h2>
          <SummaryShareButton text={shareText} />
        </div>

        <div className="summary-block">
          <h3>Канат</h3>
          {ropeGroups.length ? ropeGroups.map((row) => <p key={row}>{row}</p>) : <p>Канатов нет</p>}
          {turntableRows.map((row) => <p key={row}>{row}</p>)}
        </div>

        <div className="summary-block">
          <h3>Зуб</h3>
          {toothRows.length ? toothRows.map((row) => <p key={row}>{row}</p>) : <p>Зубьев нет</p>}
        </div>

        <div className="summary-block">
          <h3>Сборки</h3>
          {assemblyRows.length ? assemblyRows.map((row) => <p key={row}>{row}</p>) : <p>Сборок нет</p>}
        </div>

        <div className="summary-block">
          <h3>П/П</h3>
          {ppRows.length ? ppRows.map((row) => <p key={row}>{row}</p>) : <p>П/П нет</p>}
        </div>
      </article>

      <article className="summary-screen yakno-summary-screen">
        <h2>Сводка ЯКНО</h2>
        <div className="summary-block">
          {yaknoRows.map((row) => <p key={row}>{row}</p>)}
          {freeYaknoBoxes.length ? <p>Свободные: {freeYaknoBoxes.map((box) => yaknoLine(box)).join(", ")}</p> : null}
          {repairYaknoBoxes.length ? <p>Ремонт: {repairYaknoBoxes.map((box) => yaknoLine(box)).join(", ")}</p> : null}
        </div>
      </article>
    </section>
  );
}
