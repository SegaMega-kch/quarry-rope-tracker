"use client";

import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { adjustPpSectorAction, savePpEquipmentAction, savePpEquipmentSectorAction, setPpSectorMaterialAction, setPpUnloadingSectorAction } from "./actions";
import { sendPpSnapshotAction } from "./pp-send-actions";
import type { PpSendResult } from "@/lib/pp-delivery";

const Controls = createContext<{ busy: boolean; run: (work: () => Promise<void>) => void }>({ busy: false, run: () => {} });
export function PpControlsProvider({ children }: { children: ReactNode }) {
  const [busy, startTransition] = useTransition();
  const locked = useRef(false);
  const run = (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    startTransition(async () => { try { await work(); } finally { locked.current = false; } });
  };
  return <Controls.Provider value={{ busy, run }}>{children}</Controls.Provider>;
}

type Point = {
  id: number; name: string; equipmentLocationId: number | null; equipmentSectorId: number | null; unloadingSectorId: number | null;
};
type Sector = { id: number; name: string; quantity: number; material: string };
type MutationResult = { ok: true } | { ok: false; error: string } | void;
function form(values: Record<string, number | string | boolean | null>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value === null ? "" : String(value));
  return data;
}

export function PpCardControls({ point, sectors, equipment }: {
  point: Point; sectors: Sector[]; equipment: Array<{ id: number; label: string }>;
}) {
  const { busy, run } = useContext(Controls);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const mutate = (work: () => Promise<MutationResult>) => {
    setFeedback(null);
    run(async () => {
      try {
        const result = await work();
        setFeedback(result && !result.ok ? { error: true, text: result.error } : { error: false, text: "Сохранено" });
      } catch { setFeedback({ error: true, text: "Изменение не сохранено. Обновите страницу и повторите." }); }
      finally { setChoice(null); }
    });
  };
  return <>
    <div className="pp-equipment-form">
      <select aria-label={`Техника на ${point.name}`} value={choice ?? String(point.equipmentLocationId ?? "")} disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          setChoice(value);
          mutate(() => savePpEquipmentAction(form({ pointId: point.id, equipmentLocationId: value, expectedEquipmentId: point.equipmentLocationId })));
        }}>
        <option value="">Без техники</option>
        {equipment.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>
    <div className="pp-sector-list">
      {sectors.map((sector) => {
        const selected = point.equipmentLocationId !== null && point.equipmentSectorId === sector.id;
        const unloading = point.unloadingSectorId === sector.id;
        const positionLabel = `${selected ? "Убрать технику из сектора" : "Техника в секторе"} ${sector.name}`;
        const unloadingLabel = `${unloading ? "Остановить разгрузку" : "Разгружать"}: сектор ${sector.name}`;
        return <div className="pp-sector-row" key={sector.id}>
          <button type="button" className={`pp-sector-reading pp-equipment-sector${selected ? " selected" : ""}`}
            title={point.equipmentLocationId === null ? "Сначала выберите технику на П/П" : positionLabel}
            aria-label={positionLabel} aria-pressed={selected} disabled={busy || point.equipmentLocationId === null}
            onClick={() => mutate(() => savePpEquipmentSectorAction(form({
              pointId: point.id, sectorId: selected ? null : sector.id,
              expectedEquipmentId: point.equipmentLocationId, expectedSectorId: point.equipmentSectorId
            })))}>
            <span>{sector.name} -</span>{" "}<b className={sector.material === "ORE" ? "ore" : "overburden"}>{sector.quantity}{sector.material === "ORE" ? "Р" : "В"}</b>
          </button>
          <button type="button" className={`pp-unloading-button${unloading ? " active" : ""}`} title={unloadingLabel} aria-label={unloadingLabel}
            aria-pressed={unloading} disabled={busy}
            onClick={() => mutate(() => setPpUnloadingSectorAction(form({ sectorId: sector.id, active: !unloading })))}>
            <ArrowLeft size={28} strokeWidth={3.5} aria-hidden="true" />
          </button>
          {(["ORE", "OVERBURDEN"] as const).map((material) => <button key={material} type="button"
            className={`pp-material-button ${material === "ORE" ? "ore" : "overburden"}${sector.material === material ? " active" : ""}`}
            aria-label={`${material === "ORE" ? "Руда" : "Вскрыша"}: сектор ${sector.name}`} aria-pressed={sector.material === material} disabled={busy}
            onClick={() => mutate(() => setPpSectorMaterialAction(form({ sectorId: sector.id, material })))}>
            {material === "ORE" ? "Р" : "В"}
          </button>)}
          <button type="button" className="pp-plus" aria-label={`Добавить землю: сектор ${sector.name}`} disabled={busy}
            onClick={() => mutate(() => adjustPpSectorAction(form({ sectorId: sector.id, delta: 1 })))}>+</button>
          <button type="button" className="pp-minus" aria-label={`Убавить землю: сектор ${sector.name}`} disabled={busy || sector.quantity < 1}
            onClick={() => mutate(() => adjustPpSectorAction(form({ sectorId: sector.id, delta: -1 })))}>-</button>
        </div>;
      })}
    </div>
    <div className="pp-feedback" aria-live="polite">
      {feedback ? <span className={feedback.error ? "pp-error" : "pp-saved"} role={feedback.error ? "alert" : "status"}>{feedback.text}</span> : null}
    </div>
  </>;
}

const storageKey = "rapmas-pp-pending-send";
export function PpSendButton() {
  const { busy, run } = useContext(Controls);
  const [sending, setSending] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PpSendResult | null>(null);
  const [cooldown, setCooldown] = useState(false);
  useEffect(() => { try { setPendingId(sessionStorage.getItem(storageKey)); } catch { /* In-memory ID still protects a retry in this tab. */ } }, []);
  useEffect(() => {
    const ms = outcome?.state === "sent" ? 30000 : outcome?.retryAfterMs ?? 0;
    if (!ms) return;
    setCooldown(true);
    const timer = setTimeout(() => setCooldown(false), ms);
    return () => clearTimeout(timer);
  }, [outcome]);
  return <div className="pp-send">
    <button type="button" className="primary pp-send-button" disabled={busy || cooldown} onClick={() => {
      const id = pendingId ?? crypto.randomUUID();
      setPendingId(id);
      try { sessionStorage.setItem(storageKey, id); } catch { /* No secrets or payload are stored here. */ }
      setSending(true);
      setOutcome(null);
      run(async () => {
        try {
          const result = await sendPpSnapshotAction(id);
          setOutcome(result);
          if (["sent", "failed", "closed", "cooldown"].includes(result.state)) {
            setPendingId(null);
            try { sessionStorage.removeItem(storageKey); } catch { /* Keep the server journal authoritative. */ }
          }
        } catch {
          setOutcome({ state: "review", message: "Ответ сервера не получен. Нажмите «Проверить отправку» для проверки того же запроса." });
        } finally { setSending(false); }
      });
    }}><Image src="/max-mark-white.png" width={20} height={20} alt="" aria-hidden="true" unoptimized /><span>{sending ? "Отправка..." : pendingId ? "Проверить отправку" : "Передать землю"}</span></button>
    {outcome ? <p className={`pp-send-result ${outcome.state === "sent" ? "pp-saved" : "pp-error"}`} role="status">{outcome.message}</p> : null}
  </div>;
}
