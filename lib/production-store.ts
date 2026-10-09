import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { currentWorkPeriod, workPeriod, type WorkPeriod } from "./shift-calendar";
import { currentRows, currentSettings, currentSnapshot, defaultRows, emptySettings, InputError, validateRows, validateSettings, type Settings, type Snapshot, type ProductionRow, type Version, type ReportKind } from "./production-domain";

type Tx = Prisma.TransactionClient;
export type Actor = { id: number; login: string; role: string };
export type OpenReport = { snapshot: Snapshot; draftRevision: number; latestId: string | null; latest: Version | null; finalId: string | null; draftStale: boolean; staleDraft: Snapshot | null; savedAt: string | null };
type PeriodRow = { key: string; period: string; latest: string | null; final: string | null; counter: number };
type DraftRow = { snapshot: string; revision: number; base_id: string | null; at: string };
type StoredVersion = { id: string; period_key: string; number: number; kind: ReportKind; correction: number; source_id: string | null; previous_id: string | null; author: string; at: string; snapshot: string; operation: string; fingerprint: string };
export class ConflictError extends Error {}
export const canUseProduction = (role: string) => ["shift", "boss", "admin"].includes(role);
export function assertProductionActor(actor: Actor) { if (!canUseProduction(actor.role)) throw new Error("Этот раздел доступен мастерам и руководителю"); }
async function query<T>(db: Tx, sql: Prisma.Sql): Promise<T[]> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>(sql);
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])) as T);
}
function unpack(v: StoredVersion): Version { return { id: v.id, periodKey: v.period_key, number: v.number, kind: v.kind, correction: Boolean(v.correction), sourceId: v.source_id, previousId: v.previous_id, author: v.author, at: v.at, snapshot: currentSnapshot(JSON.parse(v.snapshot)), delivery: "not_configured" }; }
function opId(value: string) { if (typeof value !== "string" || !/^[\w-]{16,100}$/.test(value)) throw new Error("Некорректный идентификатор операции"); return value; }

/** Separate SQLite database; never runs the inventory Prisma schema/seed here. */
export async function openProductionStore(filename: string) {
  if (!isAbsolute(filename) || /[?#]/.test(filename)) throw new Error("Для базы отчётов нужен абсолютный путь к файлу");
  const path = resolve(filename);
  const inventoryUrl = process.env.DATABASE_URL || "file:./dev.db";
  if (inventoryUrl.startsWith("file:")) {
    const inventory = resolve(process.cwd(), "prisma", inventoryUrl.slice(5));
    const canonical = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p)).toLowerCase();
    if (canonical(path) === canonical(inventory)) throw new Error("База отчётов должна быть отдельной от базы сайта");
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.replaceAll("\\", "/")}` } } });
  try {
    const tables = await query<{ name: string }>(db, Prisma.sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
    const allowed = new Set(["sp_meta", "sp_settings", "sp_audit", "sp_periods", "sp_drafts", "sp_versions", "sp_delivery_requests", "sp_deliveries"]);
    if (tables.some(t => !allowed.has(t.name)) || (tables.length && !tables.some(t => t.name === "sp_meta"))) throw new Error("Файл принадлежит другой базе. Изменения отменены");
    if (tables.length) {
      const [meta] = await query<{ version: number; identity: string }>(db, Prisma.sql`SELECT version, identity FROM sp_meta WHERE id=1`);
      if (!meta || meta.version !== 1 || meta.identity !== "rapmas-shift-production") throw new Error("Неизвестная версия базы отчётов");
      if (tables.length !== allowed.size) throw new Error("Схема базы отчётов неполна");
    } else {
      await db.$transaction(async tx => {
        await tx.$executeRaw`CREATE TABLE sp_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, identity TEXT NOT NULL)`;
        await tx.$executeRaw`INSERT INTO sp_meta VALUES (1, 1, 'rapmas-shift-production')`;
        await tx.$executeRaw`CREATE TABLE sp_settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`;
        await tx.$executeRaw`INSERT INTO sp_settings VALUES (1, ${JSON.stringify(emptySettings())})`;
        await tx.$executeRaw`CREATE TABLE sp_audit (id TEXT PRIMARY KEY, author_id INTEGER NOT NULL, author TEXT NOT NULL, at TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL)`;
        await tx.$executeRaw`CREATE TABLE sp_periods (key TEXT PRIMARY KEY, period TEXT NOT NULL, latest TEXT, final TEXT, counter INTEGER NOT NULL DEFAULT 0)`;
        await tx.$executeRaw`CREATE TABLE sp_drafts (period_key TEXT PRIMARY KEY REFERENCES sp_periods(key), snapshot TEXT NOT NULL, revision INTEGER NOT NULL, base_id TEXT, author TEXT NOT NULL, at TEXT NOT NULL)`;
        await tx.$executeRaw`CREATE TABLE sp_versions (id TEXT PRIMARY KEY, period_key TEXT NOT NULL REFERENCES sp_periods(key), number INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('preliminary','final')), correction INTEGER NOT NULL, source_id TEXT, previous_id TEXT, author_id INTEGER NOT NULL, author TEXT NOT NULL, at TEXT NOT NULL, snapshot TEXT NOT NULL, operation TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, UNIQUE(period_key, number))`;
        await tx.$executeRaw`CREATE TABLE sp_delivery_requests (operation TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES sp_versions(id), author TEXT NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL)`;
        await tx.$executeRaw`CREATE TABLE sp_deliveries (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES sp_versions(id), recipient TEXT NOT NULL, recipient_label TEXT NOT NULL, part INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed','unknown')), message_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, at TEXT, error TEXT, UNIQUE(version_id, recipient, part))`;
      });
    }
    await db.$executeRaw`PRAGMA synchronous = FULL`;
    return new ProductionStore(db);
  } catch (e) { await db.$disconnect(); throw e; }
}

export class ProductionStore {
  constructor(private db: PrismaClient) {}
  close() { return this.db.$disconnect(); }
  private locked<T>(run: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(async tx => { await tx.$executeRaw`UPDATE sp_meta SET id=id WHERE id=1`; return run(tx); }, { timeout: 15000, maxWait: 15000 });
  }
  async settings(db: Tx = this.db): Promise<Settings> {
    const [row] = await query<{ data: string }>(db, Prisma.sql`SELECT data FROM sp_settings WHERE id=1`);
    return currentSettings(JSON.parse(row.data) as Settings);
  }
  async saveSettings(input: Settings, actor: Actor) {
    assertProductionActor(actor); const settings = currentSettings(validateSettings(input));
    return this.locked(async tx => {
      const previous = await this.settings(tx);
      if (previous.revision !== settings.revision) throw new ConflictError("Справочники изменены другим мастером. Откройте настройки заново");
      if (previous.excavators.some(e => !settings.excavators.some(x => x.id === e.id)) || previous.reasons.some(r => !settings.reasons.some(x => x.id === r.id))) throw new Error("Используйте архивирование вместо удаления справочных записей");
      const next = { ...settings, revision: previous.revision + 1 };
      await tx.$executeRaw`UPDATE sp_settings SET data=${JSON.stringify(next)} WHERE id=1`;
      await tx.$executeRaw`INSERT INTO sp_audit VALUES (${randomUUID()},${actor.id},${actor.login},${new Date().toISOString()},${JSON.stringify(previous)},${JSON.stringify(next)})`;
      return next;
    });
  }
  async settingsAudit() { return query<{ id: string; author: string; at: string; before_json: string; after_json: string }>(this.db, Prisma.sql`SELECT id, author, at, before_json, after_json FROM sp_audit ORDER BY at DESC LIMIT 30`); }
  private async period(period: WorkPeriod, tx: Tx): Promise<PeriodRow | undefined> {
    return (await query<PeriodRow>(tx, Prisma.sql`SELECT key,period,latest,final,counter FROM sp_periods WHERE key=${period.key}`))[0];
  }
  async version(id: string, db: Tx = this.db): Promise<Version> {
    const [v] = await query<StoredVersion>(db, Prisma.sql`SELECT * FROM sp_versions WHERE id=${id}`);
    if (!v) throw new Error("Версия отчёта не найдена");
    return unpack(v);
  }
  async open(date: string, kind: "day" | "night", db: Tx = this.db): Promise<OpenReport> {
    const requested = workPeriod(date, kind);
    const p = await this.period(requested, db);
    const period: WorkPeriod = p ? JSON.parse(p.period) : requested;
    const [draft] = await query<DraftRow>(db, Prisma.sql`SELECT snapshot,revision,base_id,at FROM sp_drafts WHERE period_key=${period.key}`);
    const latest = p?.latest ? await this.version(p.latest, db) : null;
    const stale = Boolean(draft && draft.base_id !== (p?.latest ?? null));
    return { snapshot: draft && !stale ? currentSnapshot(JSON.parse(draft.snapshot)) : latest?.snapshot ?? { period, rows: defaultRows(await this.settings(db)) }, draftRevision: draft?.revision ?? 0, latestId: p?.latest ?? null, latest, finalId: p?.final ?? null, draftStale: stale, staleDraft: stale && draft ? currentSnapshot(JSON.parse(draft.snapshot)) : null, savedAt: draft?.at ?? null };
  }
  private async canonical(rows: ProductionRow[], basis: Snapshot, settings: Settings) {
    const issues = validateRows(rows); if (issues.length) throw new InputError(issues);
    rows = currentRows(rows);
    if (rows.length !== basis.rows.length || rows.some(r => !basis.rows.some(b => b.excavator.id === r.excavator.id))) throw new ConflictError("Список техники изменился. Обновите форму через сброс параметров");
    const canonical = rows.map(row => {
      const old = basis.rows.find(b => b.excavator.id === row.excavator.id)!;
      const reasons = row.reasons.map(r => {
        const found = old.reasons.find(x => x.id === r.id) || settings.reasons.find(x => x.id === r.id && x.active);
        if (!found) throw new Error("Причина больше не доступна. Откройте справочник");
        return { id: found.id, name: found.name };
      });
      return { railLoadingUnit: "minutes" as const, truckLoadingUnit: "decimalMinutes" as const, excavator: old.excavator, norms: old.norms, plan: row.plan.trim(), fact: row.fact.trim(), loadPercent: row.loadPercent?.trim() ?? "", oversizePercent: row.excavator.direction === "truck" ? row.oversizePercent?.trim() ?? "" : "", waiting: row.waiting, state: row.state, note: row.note.trim(), reasons,
        loading: row.loading.map(l => ({ truck: l.truck, time: l.time, norm: old.loading.find(x => x.truck === l.truck)?.norm ?? old.norms[String(l.truck)] ?? null })) };
    });
    const canonicalIssues = validateRows(canonical); if (canonicalIssues.length) throw new InputError(canonicalIssues);
    return canonical;
  }
  private async ensurePeriod(tx: Tx, period: WorkPeriod) { await tx.$executeRaw`INSERT OR IGNORE INTO sp_periods (key,period) VALUES (${period.key},${JSON.stringify(period)})`; }
  private check(open: OpenReport, latestId: string | null, revision?: number) {
    if (open.latestId !== latestId || (revision !== undefined && open.draftRevision !== revision)) throw new ConflictError("Этот отчёт уже изменён в другой вкладке или другим мастером. Ваш ввод сохранён в браузере. Откройте свежую версию перед сохранением");
  }
  async draft(input: { date: string; kind: "day" | "night"; rows: ProductionRow[]; latestId: string | null; draftRevision: number; reset?: boolean }, actor: Actor) {
    assertProductionActor(actor);
    return this.locked(async tx => {
      const open = await this.open(input.date, input.kind, tx); this.check(open, input.latestId, input.draftRevision);
      const settings = await this.settings(tx);
      const snapshot = { period: open.snapshot.period, rows: input.reset ? defaultRows(settings) : await this.canonical(input.rows, open.snapshot, settings) };
      await this.ensurePeriod(tx, snapshot.period);
      const at = new Date().toISOString();
      await tx.$executeRaw`INSERT INTO sp_drafts (period_key,snapshot,revision,base_id,author,at) VALUES (${snapshot.period.key},${JSON.stringify(snapshot)},${open.draftRevision + 1},${open.latestId},${actor.login},${at}) ON CONFLICT(period_key) DO UPDATE SET snapshot=excluded.snapshot,revision=excluded.revision,base_id=excluded.base_id,author=excluded.author,at=excluded.at`;
      return { ...open, snapshot, draftRevision: open.draftRevision + 1, savedAt: at, draftStale: false, staleDraft: null };
    });
  }
  async save(input: { date: string; periodKind: "day" | "night"; rows: ProductionRow[]; kind: ReportKind; latestId: string | null; draftRevision: number; sourceId?: string; operation: string }, actor: Actor) {
    assertProductionActor(actor); opId(input.operation);
    if (!["preliminary", "final"].includes(input.kind)) throw new Error("Выберите вид отчёта");
    const fingerprint = createHash("sha256").update(JSON.stringify({ input, actor: actor.id })).digest("hex");
    return this.locked(async tx => {
      const [existing] = await query<StoredVersion>(tx, Prisma.sql`SELECT * FROM sp_versions WHERE operation=${input.operation}`);
      if (existing) { if (existing.fingerprint !== fingerprint) throw new ConflictError("Идентификатор операции уже использован с другими данными"); return unpack(existing); }
      const open = await this.open(input.date, input.periodKind, tx);
      this.check(open, input.latestId, input.sourceId ? undefined : input.draftRevision);
      const source = input.sourceId ? await this.version(input.sourceId, tx) : null;
      if (source && source.periodKey !== open.snapshot.period.key) throw new Error("Исправление относится к другому периоду");
      const basis = source?.snapshot ?? open.snapshot;
      const rows = await this.canonical(input.rows, basis, await this.settings(tx));
      const snapshot = { period: basis.period, rows };
      await this.ensurePeriod(tx, snapshot.period);
      const p = (await this.period(snapshot.period, tx))!;
      const version: Version = { id: randomUUID(), periodKey: p.key, number: p.counter + 1, kind: input.kind, correction: Boolean(source) || Boolean(p.final && input.kind === "final"), sourceId: source?.id ?? null, previousId: p.latest, author: actor.login, at: new Date().toISOString(), snapshot, delivery: "not_configured" };
      await tx.$executeRaw`INSERT INTO sp_versions (id,period_key,number,kind,correction,source_id,previous_id,author_id,author,at,snapshot,operation,fingerprint) VALUES (${version.id},${p.key},${version.number},${version.kind},${version.correction ? 1 : 0},${version.sourceId},${version.previousId},${actor.id},${actor.login},${version.at},${JSON.stringify(snapshot)},${input.operation},${fingerprint})`;
      await tx.$executeRaw`UPDATE sp_periods SET latest=${version.id}, final=${version.kind === "final" ? version.id : p.final},counter=${version.number} WHERE key=${p.key}`;
      // A correction deliberately leaves any other working draft intact (and visibly stale).
      if (!source) await tx.$executeRaw`INSERT INTO sp_drafts (period_key,snapshot,revision,base_id,author,at) VALUES (${p.key},${JSON.stringify(snapshot)},${open.draftRevision + 1},${version.id},${actor.login},${version.at}) ON CONFLICT(period_key) DO UPDATE SET snapshot=excluded.snapshot,revision=excluded.revision,base_id=excluded.base_id,author=excluded.author,at=excluded.at`;
      return version;
    });
  }
  async history(date?: string, crew?: number) {
    if (date) workPeriod(date, "day");
    if (crew !== undefined && ![1, 2, 3, 4].includes(crew)) throw new Error("Некорректная смена");
    const all = await query<StoredVersion>(this.db, Prisma.sql`SELECT v.* FROM sp_versions v JOIN sp_periods p ON p.latest=v.id ORDER BY json_extract(p.period,'$.start') DESC`);
    return all.map(unpack).filter(v => (!date || v.snapshot.period.date === date || (v.snapshot.period.kind === "night" && new Date(Date.parse(v.snapshot.period.end) + 5 * 3_600_000).toISOString().slice(0, 10) === date)) && (!crew || v.snapshot.period.crew === crew)).slice(0, 100);
  }
  async versions(periodKey: string) {
    const rows = await query<StoredVersion>(this.db, Prisma.sql`SELECT * FROM sp_versions WHERE period_key=${periodKey} ORDER BY number DESC`);
    return rows.map(unpack);
  }
  async finalVersions() { return (await query<StoredVersion>(this.db, Prisma.sql`SELECT v.* FROM sp_versions v JOIN sp_periods p ON p.final=v.id ORDER BY json_extract(p.period,'$.start')`)).map(unpack); }
  async requestDelivery(versionId: string, operation: string, actor: Actor) {
    assertProductionActor(actor); opId(operation);
    return this.locked(async tx => {
      await this.version(versionId, tx);
      const [prior] = await query<{ version_id: string }>(tx, Prisma.sql`SELECT version_id FROM sp_delivery_requests WHERE operation=${operation}`);
      if (prior && prior.version_id !== versionId) throw new ConflictError("Операция отправки уже относится к другой версии");
      await tx.$executeRaw`INSERT OR IGNORE INTO sp_delivery_requests VALUES (${operation},${versionId},${actor.login},${new Date().toISOString()},'not_configured')`;
      return { status: "not_configured" as const, message: "Версия сохранена. Отправка в MAX не настроена", recipients: [] };
    });
  }
}

const scope = globalThis as unknown as { productionStore?: Promise<ProductionStore> };
export function productionStore() {
  if (!scope.productionStore) {
    const filename = process.env.SHIFT_PRODUCTION_DATABASE_PATH;
    if (!filename && process.env.NODE_ENV === "production") throw new Error("Задайте SHIFT_PRODUCTION_DATABASE_PATH для отдельной базы отчётов");
    scope.productionStore = openProductionStore(filename || resolve(process.cwd(), ".data/shift-production.db")).catch(e => { scope.productionStore = undefined; throw e; });
  }
  return scope.productionStore;
}
export { currentWorkPeriod };
