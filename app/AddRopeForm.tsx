"use client";

import { useMemo, useState } from "react";
import { addRopeAction } from "@/app/actions";
import { compareLocations, locationLabel } from "@/lib/labels";
import { RopeFields } from "./RopeFields";

type RopeTypeOption = {
  id: number;
  name: string;
  standardLength: number;
};

type LocationOption = {
  id: number;
  name: string;
  category?: string;
};

function isTurntableOnlyLocation(name?: string) {
  return Boolean(name?.startsWith("ЭКГ") || name?.startsWith("ПП"));
}

export function AddRopeForm({
  ropeTypes,
  locations,
  quickAddPlacement,
  addLocationDefault,
  addPlacementDefault,
  hasCraneLocation
}: {
  ropeTypes: RopeTypeOption[];
  locations: LocationOption[];
  quickAddPlacement: string;
  addLocationDefault?: number;
  addPlacementDefault?: string;
  hasCraneLocation: boolean;
}) {
  const sortedLocations = useMemo(() => [...locations].sort(compareLocations), [locations]);
  const initialLocationId = String(addLocationDefault ?? sortedLocations[0]?.id ?? "");
  const initialLocation = sortedLocations.find((location) => String(location.id) === initialLocationId);
  const [locationId, setLocationId] = useState(initialLocationId);
  const [placement, setPlacement] = useState(addPlacementDefault ?? (isTurntableOnlyLocation(initialLocation?.name) ? "TURNTABLE" : "HANGERS"));
  const selectedLocation = useMemo(() => sortedLocations.find((location) => String(location.id) === locationId), [locationId, sortedLocations]);
  const turntableOnly = isTurntableOnlyLocation(selectedLocation?.name);
  const effectivePlacement = turntableOnly ? "TURNTABLE" : placement;

  const handleLocationChange = (nextLocationId: string) => {
    setLocationId(nextLocationId);
    const nextLocation = sortedLocations.find((location) => String(location.id) === nextLocationId);
    if (isTurntableOnlyLocation(nextLocation?.name)) {
      setPlacement("TURNTABLE");
    }
  };

  return (
    <form action={addRopeAction} className="form add-rope-form">
      <RopeFields ropeTypes={ropeTypes} compact />
      {quickAddPlacement && hasCraneLocation ? (
        <p className="rule-note">
          Добавление под 20т кран: {addPlacementDefault === "TURNTABLE" ? "На Вертушку" : addPlacementDefault === "GROUND" ? "На землю" : "На Вешела"}.
        </p>
      ) : null}
      <div className="add-rope-place">
        <label>
          Место
          <select name="locationId" value={locationId} onChange={(event) => handleLocationChange(event.target.value)}>
            {sortedLocations.map((location) => (
              <option key={location.id} value={location.id}>{locationLabel(location.name)}</option>
            ))}
          </select>
        </label>
        <label>
          Размещение
          <select name="placement" value={effectivePlacement} disabled={turntableOnly} onChange={(event) => setPlacement(event.target.value)}>
            <option value="HANGERS">На вешалах</option>
            <option value="TURNTABLE">На вертушке</option>
            <option value="GROUND">На земле</option>
          </select>
          {turntableOnly ? <input type="hidden" name="placement" value="TURNTABLE" /> : null}
        </label>
      </div>
      {turntableOnly ? <p className="rule-note">Для ЭКГ и ПП размещение только на вертушке.</p> : null}
      <label>
        Комментарий
        <textarea name="comment" />
      </label>
      <button className="primary big">Добавить</button>
    </form>
  );
}
