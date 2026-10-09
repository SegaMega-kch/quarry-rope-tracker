"use server";
import { requireUser } from "@/lib/auth";
import { productionStore, assertProductionActor, ConflictError } from "@/lib/production-store";
import { InputError, type Settings, type FieldIssue } from "@/lib/production-domain";
import type { ProductionStore } from "@/lib/production-store";

type Result<T> = { ok: true; value: T } | { ok: false; message: string; conflict: boolean; issues: FieldIssue[] };
async function run<T>(work: (store: ProductionStore, user: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> {
  const user = await requireUser();
  try { assertProductionActor(user); return { ok: true, value: await work(await productionStore(), user) }; }
  catch (error) {
    const known = error instanceof InputError || error instanceof ConflictError;
    const message = error instanceof Error ? error.message : "Не удалось выполнить действие";
    console.error("production-action", known ? message : error);
    return { ok: false, message: message.includes("prisma") || message.includes("Invalid `") ? "Не удалось сохранить данные. Попробуйте ещё раз; ваш ввод остаётся в форме" : message, conflict: error instanceof ConflictError, issues: error instanceof InputError ? error.issues : [] };
  }
}
export async function openProduction(date: string, kind: "day" | "night") { return run(store => store.open(date, kind)); }
export async function loadSettings() { return run(store => store.settings()); }
export async function saveProductionSettings(input: Settings) { return run((store, actor) => store.saveSettings(input, actor)); }
export async function settingsAudit() { return run(store => store.settingsAudit()); }
export async function saveProductionDraft(input: Parameters<ProductionStore["draft"]>[0]) { return run((store, actor) => store.draft(input, actor)); }
export async function saveProduction(input: Parameters<ProductionStore["save"]>[0]) { return run((store, actor) => store.save(input, actor)); }
export async function deliverProduction(id: string, operation: string) { return run((store, actor) => store.requestDelivery(id, operation, actor)); }
export async function productionHistory(date?: string, crew?: number) { return run(store => store.history(date, crew)); }
export async function productionVersions(key: string) { return run(store => store.versions(key)); }
