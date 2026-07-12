"use client";

import { useEffect, useMemo, useState } from "react";
import { diameterOptions, ropeTypeLabel, ropeTypeSpecs } from "@/lib/labels";

type RopeTypeOption = {
  id: number;
  name: string;
  standardLength: number;
  defaultDiameter?: string | null;
};

export function RopeFields({ ropeTypes, compact = false }: { ropeTypes: RopeTypeOption[]; compact?: boolean }) {
  const ekg12Lift = useMemo(() => ropeTypes.find((type) => type.name === "Подъём ЭКГ-12К"), [ropeTypes]);
  const [ropeTypeId, setRopeTypeId] = useState(String(ropeTypes[0]?.id ?? ""));
  const [length, setLength] = useState(String(ropeTypes[0]?.standardLength ?? ""));
  const [customLength, setCustomLength] = useState("");
  const [diameter, setDiameter] = useState(diameterOptions[0]);
  const [customDiameter, setCustomDiameter] = useState("");

  const selectedType = ropeTypes.find((type) => String(type.id) === ropeTypeId);
  const selectedSpec = selectedType ? ropeTypeSpecs[selectedType.name] ?? (selectedType.defaultDiameter ? { length: selectedType.standardLength, diameter: selectedType.defaultDiameter } : null) : null;
  const effectiveLength = customLength || length;
  const compactLength = selectedSpec?.length ?? Number(effectiveLength);
  const compactDiameter = selectedSpec?.diameter ?? diameter;
  const handleRopeTypeChange = (nextId: string) => {
    setRopeTypeId(nextId);
    const selectedType = ropeTypes.find((type) => String(type.id) === nextId);
    const spec = selectedType ? ropeTypeSpecs[selectedType.name] ?? (selectedType.defaultDiameter ? { length: selectedType.standardLength, diameter: selectedType.defaultDiameter } : null) : null;
    if (spec) {
      setLength(String(spec.length));
      setDiameter(spec.diameter);
      setCustomDiameter("");
      setCustomLength("");
    }
  };

  useEffect(() => {
    if (effectiveLength === "82" && ekg12Lift) {
      setRopeTypeId(String(ekg12Lift.id));
      setDiameter("52 мм");
      setCustomDiameter("");
    }
  }, [effectiveLength, ekg12Lift]);

  const uniqueLengths = Array.from(new Set(ropeTypes.map((type) => type.standardLength)));
  const isEkg12Lift82 = effectiveLength === "82";

  return (
    <>
      <div className={compact ? "rope-main-row" : undefined}>
        <label>
          Тип каната
          <select name="ropeTypeId" required value={ropeTypeId} onChange={(event) => handleRopeTypeChange(event.target.value)}>
            {ropeTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {ropeTypeLabel(type.name)}
              </option>
            ))}
          </select>
        </label>
        {compact ? (
          <label>
            Кол-во
            <input name="quantity" type="number" inputMode="numeric" min="1" defaultValue="1" required />
          </label>
        ) : null}
      </div>
      {compact ? (
        <>
          <input type="hidden" name="length" value={compactLength} />
          <input type="hidden" name="diameter" value={compactDiameter} />
        </>
      ) : null}
      {!compact ? (
        <>
      <div className="split">
        <label>
          Длина
          <select name="length" value={length} onChange={(event) => setLength(event.target.value)}>
            {uniqueLengths.map((item) => (
              <option key={item} value={item}>
                {item} м
              </option>
            ))}
          </select>
        </label>
        <label>
          Своя длина
          <input
            name="customLength"
            inputMode="numeric"
            placeholder="м"
            value={customLength}
            onChange={(event) => setCustomLength(event.target.value.trim())}
          />
        </label>
      </div>
      <div className="split">
        <label>
          Диаметр
          <select name="diameter" value={diameter} disabled={isEkg12Lift82} onChange={(event) => setDiameter(event.target.value)}>
            {diameterOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          {isEkg12Lift82 ? <input type="hidden" name="diameter" value="52 мм" /> : null}
        </label>
        <label>
          Свой диаметр
          <input
            name="customDiameter"
            placeholder="мм"
            value={customDiameter}
            disabled={isEkg12Lift82}
            onChange={(event) => setCustomDiameter(event.target.value)}
          />
        </label>
      </div>
      {isEkg12Lift82 ? <p className="rule-note">82 м - только Подъём ЭКГ-12К, диаметр 52 мм.</p> : null}
        </>
      ) : null}
      {!compact ? (
        <label>
          Количество, шт
          <input name="quantity" type="number" inputMode="numeric" min="1" defaultValue="1" required />
        </label>
      ) : null}
    </>
  );
}
