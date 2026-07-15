export const roleLabels: Record<string, string> = {
  shift: "Смена",
  boss: "Начальник",
  storekeeper: "Кладовщик",
  admin: "Администратор"
};

export const categoryLabels: Record<string, string> = {
  storage: "Склад",
  excavator: "Экскаватор",
  transfer_point: "Перегрузочный пункт",
  loader: "Погрузчик"
};

export const placementLabels: Record<string, string> = {
  HANGERS: "На вешалах",
  TURNTABLE: "На вертушке",
  GROUND: "На земле",
  INSTALLED: "Установлен"
};

export const statusLabels: Record<string, string> = {
  AVAILABLE: "В наличии",
  INSTALLED: "Установлен",
  USED_NEAR_EXCAVATOR: "Б/у лежит у экскаватора",
  WRITTEN_OFF: "Списан"
};

export const actionLabels: Record<string, string> = {
  ADD: "Добавление",
  MOVE: "Перемещение",
  MOVE_TURNTABLE: "Перемещение вертушки",
  INSTALL: "Установка",
  ADD_USED: "Добавление б/у каната",
  WRITE_OFF: "Списание",
  CREATE_REQUEST: "Создание заявки механикам",
  COMPLETE_REQUEST: "Выполнение заявки",
  ADJUST: "Корректировка остатка"
};

export const requestStatusLabels: Record<string, string> = {
  NEW: "Новая",
  IN_PROGRESS: "В работе",
  DONE: "Выполнена",
  CANCELLED: "Отменена"
};

export const toothConditionLabels: Record<string, string> = {
  NEW: "Новый",
  USED: "Б/У"
};

export const toothActionLabels: Record<string, string> = {
  ADD: "Добавление",
  MOVE: "Перемещение",
  INSTALL: "Установка",
  WRITE_OFF: "Списание",
  SCRAP: "В лом",
  ADJUST: "Корректировка"
};

export const assemblyActionLabels: Record<string, string> = {
  ADD: "Добавление",
  MOVE: "Перенос",
  LENGTH: "Изменение длины"
};

export const yaknoActionLabels: Record<string, string> = {
  ADD: "Добавление ЯКНО",
  DELETE: "Удаление ЯКНО",
  SET_EXCAVATOR: "Изменение экскаватора",
  FREE_HORIZON: "Горизонт свободного ЯКНО",
  REPAIR: "В ремонт",
  RESTORE: "Вернули из ремонта"
};

export const ppActionLabels: Record<string, string> = {
  ADD_POINT: "Добавление П/П",
  DELETE_POINT: "Удаление П/П",
  SET_EQUIPMENT: "Смена техники",
  ADJUST_SECTOR: "Изменение сектора",
  ADD_SECTOR: "Добавление сектора",
  DELETE_SECTOR: "Удаление сектора",
  SET_MATERIAL: "Смена материала"
};

export const ppMaterialLabels: Record<string, string> = {
  ORE: "Руда",
  OVERBURDEN: "Вскрыша"
};

export const ppMaterialLetters: Record<string, string> = {
  ORE: "Р",
  OVERBURDEN: "В"
};

export const diameterOptions = ["45 мм", "52 мм"];

export const ropeTypeShortLabels: Record<string, string> = {
  "Напор ЭКГ-10": "41м (ø45)",
  "Подъём ЭКГ-10": "110м (ø45)",
  "Напор ЭКГ-12К": "40м (ø52)",
  "Подъём ЭКГ-12К": "82м (ø52)"
};

export const ropeTypeOrder: Record<string, number> = {
  "Напор ЭКГ-10": 0,
  "Подъём ЭКГ-10": 1,
  "Напор ЭКГ-12К": 2,
  "Подъём ЭКГ-12К": 3
};

export function ropeTypeSortValue(name?: string | null) {
  return name ? ropeTypeOrder[name] ?? 99 : 99;
}

export function ropeTypeLabel(name?: string | null) {
  if (!name) return "";
  return ropeTypeShortLabels[name] ?? name;
}

export function locationLabel(name?: string | null) {
  if (!name) return "";
  return name === "Вешала под 30т краном" ? "20т кран" : name;
}

export function yaknoLabel(number?: string | null) {
  if (!number) return "";
  return number.trim().toLowerCase().startsWith("я") ? number.trim() : `Я${number.trim()}`;
}

export function shortHorizonLabel(name?: string | null) {
  if (!name) return "гор. не указан";
  return `гор. ${name.replace("Горизонт ", "")}`;
}

function locationNumber(name: string) {
  return Number(name.match(/№\s*(\d+)/)?.[1] ?? 9999);
}

export function locationSortValue(location: { name: string; category?: string | null }) {
  if (location.name === "Вешала под 30т краном") return 0;
  if (location.category === "excavator" || location.name.startsWith("ЭКГ")) return 1000 + locationNumber(location.name);
  if (location.category === "loader" || location.name.startsWith("CAT")) return 1500 + locationNumber(location.name);
  if (location.category === "transfer_point" || location.name.startsWith("ПП")) return 2000 + locationNumber(location.name);
  return 3000 + location.name.localeCompare("Я", "ru");
}

export function compareLocations(
  a: { name: string; category?: string | null },
  b: { name: string; category?: string | null }
) {
  const byGroup = locationSortValue(a) - locationSortValue(b);
  return byGroup || a.name.localeCompare(b.name, "ru");
}

export const ropeTypeSpecs: Record<string, { length: number; diameter: string }> = {
  "Напор ЭКГ-10": { length: 41, diameter: "45,5 мм" },
  "Подъём ЭКГ-10": { length: 110, diameter: "45,5 мм" },
  "Напор ЭКГ-12К": { length: 40, diameter: "52 мм" },
  "Подъём ЭКГ-12К": { length: 82, diameter: "52 мм" }
};
