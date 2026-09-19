import { saveFreeYaknoHorizonAction } from "./actions";
import { yaknoLabel } from "@/lib/labels";
import { CloseDetailsButton } from "./CloseDetailsButton";
import { ManagementForm } from "./Management";
import { YaknoHorizonFields } from "./PowerForms";

export function YaknoHorizonMenu({ box, horizons, compact = false }: {
  box: { id: number; number: string; horizonId: number | null };
  horizons: Array<{ id: number; name: string }>;
  compact?: boolean;
}) {
  return <details className={`yakno-edit-wrap${compact ? " yakno-free-menu" : ""}`}>
    <summary title={`Перенести ${yaknoLabel(box.number)}`}>{compact ? yaknoLabel(box.number) : "Горизонт"}</summary>
    <div className="yakno-edit-menu">
      <div className="quick-menu-head">
        <strong>{yaknoLabel(box.number)}</strong>
        <CloseDetailsButton />
      </div>
      <ManagementForm action={saveFreeYaknoHorizonAction} closeOnSuccess>
        <input type="hidden" name="boxId" value={box.id} />
        <input type="hidden" name="expectedHorizonId" value={box.horizonId ?? ""} />
        <YaknoHorizonFields key={box.horizonId ?? "unknown"} horizonId={box.horizonId} horizons={horizons} />
      </ManagementForm>
    </div>
  </details>;
}
