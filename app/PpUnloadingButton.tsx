"use client";

import { ArrowLeft } from "lucide-react";
import { useState, useTransition } from "react";
import { setPpUnloadingSectorAction } from "./actions";

export function PpUnloadingButton({ sectorId, sectorName, active }: { sectorId: number; sectorName: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const label = `${active ? "Остановить разгрузку" : "Разгружать"}: сектор ${sectorName}`;
  return <div className="pp-unloading-control">
    <button type="button" className={`pp-unloading-button${active ? " active" : ""}`} title={label} aria-label={label} aria-pressed={active} disabled={pending}
      onClick={() => {
        setError(false);
        const data = new FormData();
        data.set("sectorId", String(sectorId));
        data.set("active", String(!active));
        startTransition(async () => {
          try { await setPpUnloadingSectorAction(data); } catch { setError(true); }
        });
      }}><ArrowLeft size={28} strokeWidth={3.5} aria-hidden="true" /></button>
    {error ? <span role="alert" className="pp-unloading-error">Не сохранено</span> : null}
  </div>;
}
