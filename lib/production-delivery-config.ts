import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { maxId } from "./max-api";

export type ProductionDeliveryConfiguration = {
  tokenFile: string; botId: string; botUsername: string; chatId: string; chatTitle: string;
};

export function productionDeliveryStatus() {
  try {
    loadProductionDeliveryConfiguration();
    return { ready: true, message: "Итоговый отчёт будет отправлен изображением в группу MAX «Рапорт мастера»." };
  } catch {
    return { ready: false, message: "Локальный просмотр готов. Отправка в MAX включается корректной серверной настройкой." };
  }
}

export function loadProductionDeliveryConfiguration(): ProductionDeliveryConfiguration {
  const path = process.env.SHIFT_PRODUCTION_MAX_CONFIG?.trim();
  if (!path || !isAbsolute(path) || /[?#]/.test(path)) throw new Error("Отправка итогового отчёта в MAX ещё не настроена");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная настройка MAX");
  const source = value as Record<string, unknown>;
  const required = ["tokenFile", "botId", "botUsername", "chatId", "chatTitle"];
  const allowed = new Set([...required, "sourceDatabase", "outboxDatabase"]);
  if (Object.keys(source).some(key => !allowed.has(key)) || required.some(key => typeof source[key] !== "string" || !String(source[key]).trim())) {
    throw new Error("В настройке MAX не хватает проверенной учётной записи или группы");
  }
  const config = source as ProductionDeliveryConfiguration;
  if (!isAbsolute(config.tokenFile) || /[?#]/.test(config.tokenFile)) throw new Error("Для токена MAX нужен абсолютный путь");
  const token = statSync(config.tokenFile);
  if (!token.isFile() || !token.size || token.size > 4097) throw new Error("Файл токена MAX недоступен");
  if (!/^[a-zA-Z0-9_]{3,128}$/.test(config.botUsername) || config.chatTitle.trim() !== "Рапорт мастера") throw new Error("Некорректная учётная запись или группа MAX");
  return { ...config, chatTitle: "Рапорт мастера", botId: maxId(config.botId), chatId: maxId(config.chatId) };
}

export function readProductionDeliveryToken(config: ProductionDeliveryConfiguration) {
  const token = readFileSync(config.tokenFile, "utf8").trim();
  if (!token || token.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(token)) throw new Error("Некорректный токен MAX");
  return token;
}
