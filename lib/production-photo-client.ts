import type { OcrResult } from "./production-ocr-contract";

const fallbackMessage = "Сервер вернул неожиданный ответ. Фото осталось выбранным; повторите попытку или сообщите администратору.";

class ProductionPhotoError extends Error {}

function statusMessage(status: number) {
  if (status === 401) return "Сеанс входа закончился. Обновите страницу, войдите снова и повторите распознавание.";
  if (status === 403) return "Для этой учётной записи распознавание фото недоступно. Обновите страницу или обратитесь к администратору.";
  if (status === 413) return "Сервер не принял размер фотографии. Выберите фото до 10 МБ; если оно уже меньше, сообщите администратору.";
  if (status === 429) return "Распознаватель занят другим фото. Фото осталось выбранным; повторите через минуту.";
  if ([502, 503, 504].includes(status)) return "Сервис распознавания временно не ответил. Фото осталось выбранным; повторите позже.";
  return fallbackMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readProductionOcrResponse(response: Response): Promise<OcrResult> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw new ProductionPhotoError(statusMessage(response.status));
  }

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A reverse proxy can return an HTML 413/502/504 page before Next.js is reached.
    throw new ProductionPhotoError(statusMessage(response.status));
  }

  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === "string" && data.message.trim()
      ? data.message.trim()
      : statusMessage(response.status);
    throw new ProductionPhotoError(message);
  }
  if (!isRecord(data) || data.schema !== "rapmas-ocr-preview-v1" || !Array.isArray(data.tables) || !Array.isArray(data.warnings)) {
    throw new ProductionPhotoError(fallbackMessage);
  }
  return data as OcrResult;
}

export function productionPhotoRequestError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Нет ответа распознавателя. Фото осталось выбранным; повторите проверку.";
  }
  if (error instanceof ProductionPhotoError) {
    return error.message;
  }
  return "Не удалось связаться с сервером распознавания. Фото осталось выбранным; проверьте связь и повторите попытку.";
}
