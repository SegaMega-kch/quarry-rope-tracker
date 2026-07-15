export function positiveInteger(value: FormDataEntryValue | null | number, field = "Количество") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${field} должно быть положительным целым числом`);
  }
  return number;
}

export const locationCategories = ["storage", "excavator", "transfer_point", "loader"] as const;
export const requestStatuses = ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export const ropePlacements = ["HANGERS", "TURNTABLE", "GROUND", "INSTALLED"] as const;
export const toothConditions = ["NEW", "USED"] as const;

export function allowedValue<const T extends readonly string[]>(
  value: FormDataEntryValue | null | string,
  allowed: T,
  field: string
): T[number] {
  const text = String(value ?? "").trim();
  if (!allowed.includes(text)) {
    throw new Error(`Недопустимое значение поля «${field}»`);
  }
  return text as T[number];
}
