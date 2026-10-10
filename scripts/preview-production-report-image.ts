import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyPdfLoadingNorms, defaultRows, emptySettings, type Excavator, type Version } from "../lib/production-domain";
import { renderProductionReportImages } from "../lib/production-report-image";
import { workPeriod } from "../lib/shift-calendar";

async function main() {
  let settings = emptySettings();
  const equipment: Array<[string, string, Excavator["direction"], number]> = [
    ["75", "ЭКГ-12", "rail", 130], ["52", "ЭКГ-10", "rail", 130], ["9", "ЭКГ-10", "truck", 130], ["60", "ЭКГ-20", "truck", 240],
  ];
  settings.excavators = equipment.map(([number, type, direction, truck]) => ({ id: `${direction}-${number}`, number, type, direction, truck, active: true }));
  settings = applyPdfLoadingNorms(settings).settings;
  const rows = defaultRows(settings);
  Object.assign(rows[0], { plan: "1500", fact: "1200", waiting: ["1", "5"], note: "Ожидание железнодорожного состава. Аварийный ремонт с 11:10 до 13:20. Работы завершены, экскаватор введён в работу." });
  rows[0].loading[0].time = ["4", "20"];
  Object.assign(rows[1], { plan: "1300", fact: "1517", waiting: ["0", "7"], note: "Работа без отклонений" }); rows[1].loading[0].time = ["4", "40"];
  Object.assign(rows[2], { plan: "2000", fact: "1651", oversizePercent: "1,03", waiting: ["0", "25"], note: "Не грузил в начале смены. Ожидание автотранспорта." }); rows[2].loading[0].time = ["5", "12"];
  Object.assign(rows[3], { plan: "2600", fact: "2531", oversizePercent: "", waiting: ["", ""], note: "" }); rows[3].loading[0].time = ["4", "72"];
  rows[3].loading.push({ truck: 130, time: ["3", "30"], norm: rows[3].norms["130"] ?? null });
  const version: Version = { id: "11111111-1111-4111-8111-111111111111", periodKey: "2026-10-10/day", number: 4, kind: "final", correction: false,
    sourceId: null, previousId: null, author: "4 смена", at: new Date().toISOString(), snapshot: { period: workPeriod("2026-10-10", "day"), rows }, delivery: "not_configured" };
  const directory = resolve("outputs/production-report-image");
  await mkdir(directory, { recursive: true });
  const images = await renderProductionReportImages(version);
  for (let index = 0; index < images.length; index++) await writeFile(resolve(directory, `report-${index + 1}.png`), images[index]);
  console.log(JSON.stringify({ directory, images: images.length, messagesSent: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
