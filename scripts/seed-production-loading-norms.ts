import { isAbsolute, resolve } from "node:path";
import { applyPdfLoadingNorms } from "../lib/production-domain";
import { openProductionStore } from "../lib/production-store";

function databaseArgument() {
  const index = process.argv.indexOf("--database");
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) throw new Error("Укажите абсолютный путь: --database C:\\path\\shift-production.db");
  if (!isAbsolute(value)) throw new Error("Путь к базе нормативов должен быть абсолютным");
  return resolve(value);
}

async function main() {
  const store = await openProductionStore(databaseArgument());
  try {
    const current = await store.settings();
    const seeded = applyPdfLoadingNorms(current);
    if (seeded.conflicts.length) throw new Error(`Нормативы не записаны: найдены отличающиеся заполненные значения (${seeded.conflicts.join(", ")})`);
    if (!seeded.added.length) {
      console.log("Все нормативы из PDF уже заполнены, изменений нет.");
      return;
    }
    await store.saveSettings(seeded.settings, { id: 0, login: "перенос нормативов PDF", role: "admin" });
    console.log(`Заполнено нормативов: ${seeded.added.length}. Существующие значения не перезаписывались.`);
  } finally {
    await store.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
