import Link from "next/link";
import { canViewStatistics } from "@/lib/permissions";

const modules = [["rope", "Канат"], ["tooth", "Зуб"], ["assembly", "Сборки"], ["yakno", "ЯКНО"], ["pp", "П/П"], ["safety", "СИЗ"], ["summary", "Сводка"], ["shift-production", "Отчёт за смену"], ["statistics", "Статистика"]];
export function AppNavigation({ active, role }: { active: string; role: string }) {
  const visible = modules.filter(([key]) => key !== "shift-production" || role === "admin")
    .filter(([key]) => key !== "statistics" || canViewStatistics(role));
  return <nav className="module-tabs" aria-label="Разделы учета">{visible.map(([key, label]) => <Link key={key} className={active === key ? "active" : ""} aria-current={active === key ? "page" : undefined} href={`/${key}`}>{label}</Link>)}</nav>;
}
