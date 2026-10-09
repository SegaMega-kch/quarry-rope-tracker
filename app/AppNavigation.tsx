import Link from "next/link";
const modules = [["rope", "Канат"], ["tooth", "Зуб"], ["assembly", "Сборки"], ["yakno", "ЯКНО"], ["pp", "П/П"], ["safety", "СИЗ"], ["summary", "Сводка"], ["shift-production", "Отчёт за смену"], ["statistics", "Статистика"]];
export function AppNavigation({ active }: { active: string }) {
  return <nav className="module-tabs" aria-label="Разделы учета">{modules.map(([key, label]) => <Link key={key} className={active === key ? "active" : ""} aria-current={active === key ? "page" : undefined} href={`/${key}`}>{label}</Link>)}</nav>;
}
