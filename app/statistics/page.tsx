import { requireUser } from "@/lib/auth";
import { roleLabels } from "@/lib/labels";
import { canViewStatistics } from "@/lib/permissions";
import { readPpStatistics } from "@/lib/pp-statistics";
import { AppNavigation } from "../AppNavigation";
import { logoutAction } from "../actions";
import { StatisticsBoard } from "./StatisticsBoard";
import "./statistics.css";

export const dynamic = "force-dynamic";

export default async function StatisticsPage() {
  const user = await requireUser();
  if (!canViewStatistics(user.role)) return <main className="app-shell statistics-shell">
    <AppNavigation active="statistics" role={user.role} />
    <section className="statistics-empty">
      <h1>Статистика</h1>
      <p>Раздел доступен начальнику, кладовщику и администратору.</p>
    </section>
  </main>;

  let reports = [] as Awaited<ReturnType<typeof readPpStatistics>>;
  let sourceAvailable = true;
  try { reports = await readPpStatistics(); }
  catch (error) {
    sourceAvailable = false;
    console.error("Statistics source is unavailable", error);
  }

  return <main className="app-shell statistics-shell">
    <header className="topbar">
      <div><h1>Рапорт мастера</h1><p>{user.login} · {roleLabels[user.role] ?? user.role} · Главный карьер</p></div>
      <form action={logoutAction}><button className="ghost">Выход</button></form>
    </header>
    <AppNavigation active="statistics" role={user.role} />
    <StatisticsBoard reports={reports} sourceAvailable={sourceAvailable} />
  </main>;
}
