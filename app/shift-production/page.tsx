import { requireUser } from "@/lib/auth";
import { canUseProduction, productionStore } from "@/lib/production-store";
import { currentWorkPeriod } from "@/lib/shift-calendar";
import { redirect } from "next/navigation";
import { AppNavigation } from "../AppNavigation";
import { logoutAction } from "../actions";
import { ProductionBoard } from "./ProductionBoard";
import "./production.css";
import { canUseProductionOcr, ocrConfiguration } from "@/lib/production-ocr";
import { productionDeliveryStatus } from "@/lib/production-delivery-config";

export const dynamic = "force-dynamic";
export default async function ShiftProductionPage() {
  const user = await requireUser();
  if (!canUseProduction(user.role)) redirect("/rope");
  const store = await productionStore();
  const period = currentWorkPeriod();
  const [settings, initial] = await Promise.all([store.settings(), store.open(period.date, period.kind)]);
  return <main className="app-shell production-shell">
    <header className="topbar"><div><h1>Рапорт мастера</h1><p>{user.login} · Главный карьер</p></div><form action={logoutAction}><button className="ghost">Выход</button></form></header>
    <AppNavigation active="shift-production" role={user.role} />
    {process.env.RAPMAS_LOCAL_REVIEW === "1" && <p className="sp-alert">Локальный макет · техника, нормативы и показатели приведены для примера.</p>}
    <ProductionBoard initial={initial} initialSettings={settings} userId={user.id} draftNamespace={process.env.RAPMAS_LOCAL_REVIEW === "1" ? process.env.RAPMAS_PREVIEW_REVISION ?? "" : ""} ocrConfig={canUseProductionOcr(user) ? ocrConfiguration() : null} deliveryConfig={productionDeliveryStatus()} forceMobileReview={process.env.RAPMAS_LOCAL_REVIEW === "1"} />
  </main>;
}
