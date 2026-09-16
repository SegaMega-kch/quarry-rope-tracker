import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareShiftReport } from "../lib/shift-report";
import { emptyReport, ordinaryReport, repeatedReport, ropeChain } from "../tests/fixtures/shift-report";

const { values } = parseArgs({ options: { "output-dir": { type: "string" } }, strict: true });
if (!values["output-dir"]) throw new Error("Укажите --output-dir для локальных примеров");
const directory = resolve(values["output-dir"]);
mkdirSync(directory, { recursive: true });
const partial = emptyReport();
partial.events = ropeChain(2);
const cases = [
  { name: "01-ordinary", title: "Обычная смена", input: ordinaryReport(), note: "Показаны результаты установок, вывоз б/у, пустая вертушка, долг и начальное/конечное ЯКНО. Промежуточные погрузки и доставки скрыты." },
  { name: "02-no-changes", title: "Смена без событий", input: emptyReport(), note: "Состояние П/П остаётся. Нулевые секторы сохраняют материал, у активного сектора зелёная отметка." },
  { name: "03-repeated-jobs", title: "Несколько работ одной пеной или вертушкой", input: repeatedReport(), note: "Две установки с одной вертушки и две работы одной пены не заменяют друг друга. Повторные установки оставлены отдельными строками." },
  { name: "04-partial", title: "Частичная установка", input: partial, note: "Доставили два каната, установили один. Отчёт показывает установку и один оставшийся доставленный канат." }
];
const review = ["# Локальные примеры отчёта MAX", "Все данные условные. Сообщения не отправлены, рабочий сервер не изменён."];
for (const scenario of cases) {
  const prepared = prepareShiftReport(scenario.input);
  const message = prepared.messages.join("\n\n==========\n\n");
  writeFileSync(join(directory, `${scenario.name}.txt`), message + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(join(directory, `${scenario.name}.json`), JSON.stringify(prepared, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  review.push(`## ${scenario.title}`, scenario.note, "```text\n" + message + "\n```");
}
writeFileSync(join(directory, "REVIEW.md"), review.join("\n\n") + "\n", { flag: "wx", mode: 0o600 });
console.log(`Подготовлено ${cases.length} примера. Отправка не выполнялась.`);
