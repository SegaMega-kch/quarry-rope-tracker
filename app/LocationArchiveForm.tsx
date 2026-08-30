"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { archiveLocationAction, previewLocationArchiveAction } from "./location-actions";
import type { archivePreview } from "@/lib/location-archive";
import { locationLabel } from "@/lib/labels";

type Place = { id: number; name: string; category: string };
export function LocationArchiveForm({ locations, excavator }: { locations: Place[]; excavator: boolean }) {
  const options = locations.filter((place) => (place.category === "excavator") === excavator && place.name !== "Вешала под 30т краном");
  const [id, setId] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof archivePreview> | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  function check(value: string) {
    setPreview(null);
    setStatus("");
    if (!value) return;
    startTransition(async () => {
      try {
        const result = await previewLocationArchiveAction(Number(value));
        if (result.preview) setPreview(result.preview);
        else setStatus(result.error || "Не удалось проверить имущество");
      } catch { setStatus("Нет связи. Повторите проверку."); }
    });
  }
  if (!options.length) return <p>Нет {excavator ? "экскаваторов" : "мест"}, доступных для удаления.</p>;
  return <form className="form" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    if (pending || !preview || preview.blocked) return;
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await archiveLocationAction(data);
        if (result.error) { setStatus(result.error); setPreview(null); }
        else { setStatus("Убрано в архив. История сохранена."); setPreview(null); setId(""); }
      } catch { setStatus("Нет связи. Проверьте список перед повторной попыткой."); setPreview(null); }
    });
  }}>
    <fieldset className="management-fields" disabled={pending}>
      <label>{excavator ? "Экскаватор" : "Место"}<select name="id" value={id} required onChange={(event) => { setId(event.target.value); check(event.target.value); }}>
        <option value="">Выберите {excavator ? "экскаватор" : "место"}</option>
        {options.map((place) => <option key={place.id} value={place.id}>{locationLabel(place.name)}</option>)}
      </select></label>
      {id ? <button type="button" className="archive-refresh" onClick={() => check(id)}><RefreshCw size={17} aria-hidden="true" />Обновить проверку</button> : null}
      {preview ? <>
        <input type="hidden" name="token" value={preview.token} />
        {preview.excavator ? <ul className="archive-effects">{preview.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul> : null}
        {preview.blocked ? <><p role="alert" className="management-error">{preview.blocked}</p><ul className="archive-effects">{preview.occupancy.map((item) => <li key={item}>{item}</li>)}</ul></> : <>
          {([{ key: "ropeDestination", label: "Канаты на земле", count: preview.ropeCount }, { key: "toothDestination", label: "Зубья на земле", count: preview.toothCount }]).filter((item) => item.count > 0).map((item) => <label key={item.key}>{item.label}: {item.count} шт<select name={item.key} defaultValue="">
            <option value="">Оставить на месте</option>{locations.filter((place) => place.id !== preview.id).map((place) => <option key={place.id} value={place.id}>{locationLabel(place.name)}</option>)}
          </select></label>)}
          <button type="submit" className="danger">{excavator ? "Удалить экскаватор" : "Удалить место"}</button>
        </>}
      </> : null}
    </fieldset>
    {pending || status ? <p role="status">{pending ? "Проверяю и сохраняю..." : status}</p> : null}
  </form>;
}
