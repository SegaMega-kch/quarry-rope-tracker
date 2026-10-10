export type OcrProvider = "local" | "yandex";
export type OcrCell = { row: number; column: number; rowSpan: number; columnSpan: number; text: string };
export type OcrTable = { rows: number; columns: number; cells: OcrCell[] };
export type OcrResult = {
  provider: OcrProvider; schema: "rapmas-ocr-preview-v1"; sha256: string;
  width: number; height: number; seconds: number; confidence: number | null;
  text: string; tables: OcrTable[]; warnings: string[];
};
export type OcrConfiguration = { provider: OcrProvider; ready: boolean; message: string };

/** Keep sparse/merged cell coordinates; never slide values into an adjacent column. */
export function previewTableRows(table: OcrTable) {
  const anchors = new Map(table.cells.map(cell => [`${cell.row}/${cell.column}`, cell]));
  const covered = new Set<string>();
  for (const cell of table.cells) for (let y = cell.row; y < cell.row + cell.rowSpan; y++) for (let x = cell.column; x < cell.column + cell.columnSpan; x++) {
    if (y !== cell.row || x !== cell.column) covered.add(`${y}/${x}`);
  }
  return Array.from({ length: table.rows }, (_, row) => Array.from({ length: table.columns }, (_, column) => {
    const key = `${row}/${column}`;
    if (covered.has(key)) return null;
    const cell = anchors.get(key);
    return cell ? { ...cell, missing: false } : { row, column, rowSpan: 1, columnSpan: 1, text: "", missing: true };
  }).filter((cell): cell is OcrCell & { missing: boolean } => cell !== null));
}

/** OCR is evidence for review, never an automatically approved production record. */
export function ocrWarnings(text: string, tables: OcrTable[], provider: OcrProvider): string[] {
  const warnings: string[] = [];
  if (!/главный\s+карьер/i.test(text)) warnings.push("Заголовок «Главный карьер» не прочитан. Принадлежность строк пока не подтверждена.");
  if (!tables.length) warnings.push("Границы ячеек не распознаны. Распознанный текст нельзя автоматически распределить по показателям.");
  if (!/\b\d{2}[.]\d{2}[.]\d{4}\b/.test(text)) warnings.push("Дата исходной таблицы не прочитана.");
  if (!/смена\s*[12]\b/i.test(text)) warnings.push("Дневной или ночной период исходной таблицы не прочитан.");
  if (provider === "local") warnings.push("Локальное распознавание экспериментальное: на контрольном фото теряются цифры и десятичные запятые.");
  warnings.push("Проверка качества: цифры не перенесены в отчёт и не включены в статистику.");
  return warnings;
}
