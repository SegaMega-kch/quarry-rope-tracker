"use client";

import { updateSafetyDateAction } from "@/app/actions";
import { useFormStatus } from "react-dom";

function isValidSafetyDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return false;

  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function AutoSaveDate({ name, value }: { name: string; value: string }) {
  const { pending } = useFormStatus();

  function saveCompletedDate(input: HTMLInputElement) {
    if (input.validity.badInput || !isValidSafetyDate(input.value)) {
      input.setCustomValidity("Введите корректную дату с годом от 2000 до 2100");
      input.reportValidity();
      return;
    }

    input.setCustomValidity("");
    input.form?.requestSubmit();
  }

  return (
    <input
      aria-label={`Дата окончания: ${name}`}
      aria-busy={pending}
      disabled={pending}
      min="2000-01-01"
      max="2100-12-31"
      name="expiryDate"
      type="date"
      defaultValue={value}
      onInput={(event) => event.currentTarget.setCustomValidity("")}
      onBlur={(event) => saveCompletedDate(event.currentTarget)}
    />
  );
}

export function SafetyDateForm({
  itemId,
  name,
  value,
  statusClass,
  statusLabel
}: {
  itemId: number;
  name: string;
  value: string;
  statusClass: string;
  statusLabel: string;
}) {
  return (
    <form action={updateSafetyDateAction} className={`safety-item ${statusClass}`}>
      <input type="hidden" name="itemId" value={itemId} />
      <div className="safety-item-copy">
        <strong>{name}</strong>
        <span className="safety-status">{statusLabel}</span>
      </div>
      <AutoSaveDate name={name} value={value} />
    </form>
  );
}
