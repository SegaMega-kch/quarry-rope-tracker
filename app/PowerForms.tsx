"use client";

import { useState } from "react";
import { powerAssemblyAction, saveYaknoExcavatorAction } from "./actions";
import { ManagementForm } from "./Management";
import { locationLabel, shortHorizonLabel, yaknoLabel } from "@/lib/labels";

type Horizon = { id: number; name: string };
export function AssemblyPowerForm({ assemblyId, horizonId, excavators, horizons }: {
  assemblyId: number; horizonId: number | null; horizons: Horizon[];
  excavators: Array<{ id: number; name: string; horizonId: number | null }>;
}) {
  const [excavatorId, setExcavatorId] = useState("");
  const selected = excavators.find((excavator) => String(excavator.id) === excavatorId);
  const knownHorizon = horizons.find((horizon) => horizon.id === selected?.horizonId);
  return <ManagementForm action={powerAssemblyAction} closeOnSuccess>
    <input type="hidden" name="assemblyId" value={assemblyId} />
    <label>Экскаватор
      <select name="excavatorLocationId" required value={excavatorId} onChange={(event) => setExcavatorId(event.target.value)}>
        <option value="">Выберите экскаватор</option>
        {excavators.map((excavator) => <option key={excavator.id} value={excavator.id}>{locationLabel(excavator.name)}</option>)}
      </select>
    </label>
    {knownHorizon ? <p className="power-horizon">{shortHorizonLabel(knownHorizon.name)}</p> : <label>Горизонт сборки
      <select name="horizonId" required defaultValue={horizonId ?? ""}>
        <option value="">Выберите горизонт</option>
        {horizons.map((horizon) => <option key={horizon.id} value={horizon.id}>{horizon.name}</option>)}
      </select>
    </label>}
    <button className="primary big" type="submit" disabled={!selected}>Запитать</button>
  </ManagementForm>;
}

export function YaknoPowerForm({ excavatorId, horizonId, poweredBoxId, horizons, boxes }: {
  excavatorId: number; horizonId: number | null; poweredBoxId: number | null; horizons: Horizon[];
  boxes: Array<{ id: number; number: string; horizonId: number | null; isPowered: boolean; excavatorLocationId: number | null }>;
}) {
  const [horizon, setHorizon] = useState(String(horizonId ?? ""));
  const [power, setPower] = useState(String(poweredBoxId ?? ""));
  const selectable = boxes.filter((box) => !box.isPowered || box.excavatorLocationId === excavatorId);
  const onHorizon = horizon ? boxes.filter((box) => String(box.horizonId) === horizon) : [];
  return <ManagementForm action={saveYaknoExcavatorAction} closeOnSuccess>
    <input type="hidden" name="excavatorLocationId" value={excavatorId} />
    <input type="hidden" name="expectedPoweredBoxId" value={poweredBoxId ?? ""} />
    <input type="hidden" name="expectedHorizonId" value={horizonId ?? ""} />
    <label>Горизонт экскаватора
      <select name="horizonId" required={Boolean(power)} value={horizon} onChange={(event) => setHorizon(event.target.value)}>
        <option value="">Не указан</option>
        {horizons.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label>Запитанный ЯКНО
      <select name="poweredBoxId" value={power} onChange={(event) => setPower(event.target.value)}>
        <option value="">Не запитан</option>
        {selectable.map((box) => <option key={box.id} value={box.id}>{yaknoLabel(box.number)} · {shortHorizonLabel(horizons.find((item) => item.id === box.horizonId)?.name)}</option>)}
      </select>
    </label>
    <div className="yakno-horizon-info">
      <strong>ЯКНО на этом горизонте</strong>
      {onHorizon.length ? <ul>{onHorizon.map((box) => <li key={box.id}>{yaknoLabel(box.number)}{box.isPowered ? " · запитан" : ""}</li>)}</ul> : <p>{horizon ? "Нет ЯКНО" : "Горизонт не указан"}</p>}
    </div>
    <label>Комментарий<input name="comment" maxLength={80} placeholder="Если нужно" /></label>
    <button className="primary big" type="submit">Сохранить</button>
  </ManagementForm>;
}
