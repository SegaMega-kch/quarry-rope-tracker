import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertAssemblyAtQuarry, lendAssembly, returnAssembly, undoAssemblyChange, updateAssemblyDetails } from "../lib/assembly-loans";
import { setAssemblyPower } from "../lib/assembly-power";
import { moveFreeYakno } from "../lib/yakno-power";
import { collectShiftReport } from "../lib/shift-report-source";
import { formatShiftReport } from "../lib/shift-report";

const root = resolve("prisma");
const dir = mkdtempSync(join(root, "raport-assembly-loan-test-"));
const db = new PrismaClient({ datasources: { db: { url: `file:${join(dir, "test.db").replaceAll("\\", "/")}` } } });
before(() => {
  writeFileSync(join(dir, "test.db"), "", { flag: "wx" });
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:./${basename(dir)}/test.db` }, stdio: "pipe"
  });
});
after(async () => {
  await db.$disconnect();
  if (dirname(resolve(dir)) !== root || !basename(dir).startsWith("raport-assembly-loan-test-")) throw new Error("Unsafe cleanup");
  rmSync(dir, { recursive: true, force: true });
});
let index = 0;
async function fixture() {
  const key = ++index;
  const user = await db.user.create({ data: { login: `loan-${key}`, passwordHash: "test", role: "shift" } });
  const low = await db.assemblyHorizon.create({ data: { name: `Горизонт +${key}00`, sortOrder: key } });
  const high = await db.assemblyHorizon.create({ data: { name: `Горизонт +${key}50`, sortOrder: key + 100 } });
  const exc = await db.location.create({ data: { name: `ЭКГ-10 №${key}`, category: "excavator" } });
  await db.yaknoExcavatorState.create({ data: { excavatorLocationId: exc.id, horizonId: low.id } });
  await db.yaknoBox.create({ data: { number: `L${key}`, horizonId: low.id, excavatorLocationId: exc.id, isPowered: true } });
  const assembly = await db.assembly.create({ data: { name: `Сборка №${key}`, horizonId: low.id, length: 150, comment: "PRIVATE_COMMENT" } });
  const input = { assemblyId: assembly.id, recipient: "Северный", expectedChangedAt: assembly.lastChangedAt.toISOString() };
  return { key, user, low, high, exc, assembly, input };
}

test("loan and selected-horizon return preserve assembly identity, length, comments and every Yakno value", async () => {
  const f = await fixture();
  const yakno = { boxes: await db.yaknoBox.findMany(), states: await db.yaknoExcavatorState.findMany() };
  const loan = await db.$transaction(tx => lendAssembly(tx, f.input, f.user));
  const away = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  assert.equal(away.status, "ON_LOAN"); assert.equal(away.horizonId, null); assert.equal(away.isPowered, false);
  await db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user));
  const returned = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  assert.equal(returned.horizonId, f.high.id); assert.equal(returned.status, "WORKING"); assert.equal(returned.isPowered, false);
  assert.equal(returned.name, f.assembly.name); assert.equal(returned.length, 150); assert.equal(returned.comment, "PRIVATE_COMMENT");
  assert.deepEqual({ boxes: await db.yaknoBox.findMany(), states: await db.yaknoExcavatorState.findMany() }, yakno);
  assert((await db.assemblyLoan.findUniqueOrThrow({ where: { id: loan.id } })).returnedAt);
  assert.deepEqual((await db.assemblyMovement.findMany({ where: { assemblyId: f.assembly.id }, orderBy: { id: "asc" } })).map(m => m.action), ["LOAN", "RETURN_LOAN"]);
});

test("powered, repair, invalid recipient and stale assembly forms cannot lend", async () => {
  const f = await fixture();
  await assert.rejects(db.$transaction(tx => lendAssembly(tx, { ...f.input, recipient: "unexpected" }, f.user)), /Выберите/);
  await db.$transaction(tx => setAssemblyPower(tx, f.assembly.id, f.exc.id, f.user));
  await assert.rejects(db.$transaction(tx => lendAssembly(tx, f.input, f.user)), /отключите/);
  await db.$transaction(tx => setAssemblyPower(tx, f.assembly.id, null, f.user));
  await assert.rejects(db.$transaction(tx => lendAssembly(tx, f.input, f.user)), /уже изменена/);
  await db.assembly.update({ where: { id: f.assembly.id }, data: { status: "REPAIR" } });
  await assert.rejects(db.$transaction(tx => lendAssembly(tx, f.input, f.user)), /ремонта/);
  assert.equal(await db.assemblyLoan.count({ where: { assemblyId: f.assembly.id } }), 0);
});

test("in-loan assembly rejects power, detail edits, ordinary moves and repeat lending", async () => {
  const f = await fixture();
  await db.$transaction(tx => lendAssembly(tx, f.input, f.user));
  await assert.rejects(db.$transaction(tx => lendAssembly(tx, f.input, f.user)), /в долгу/);
  await assert.rejects(db.$transaction(tx => setAssemblyPower(tx, f.assembly.id, f.exc.id, f.user)), /в долгу/);
  await assert.rejects(db.$transaction(tx => updateAssemblyDetails(tx, { assemblyId: f.assembly.id, length: 99, comment: "bad", expectedChangedAt: f.input.expectedChangedAt }, f.user)), /в долгу/);
  const assembly = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  await assert.rejects(db.$transaction(tx => assertAssemblyAtQuarry(tx, assembly)), /в долгу/);
  assert.equal(assembly.length, 150);
});

test("one loan survives concurrent lending; old return cannot close a newer loan", async () => {
  const f = await fixture();
  const results = await Promise.allSettled(["Северный", "СКМ"].map(recipient => db.$transaction(tx => lendAssembly(tx, { ...f.input, recipient }, f.user), { maxWait: 10000, timeout: 20000 })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const loan = await db.assemblyLoan.findFirstOrThrow({ where: { assemblyId: f.assembly.id } });
  await db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user));
  const assembly = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  const next = await db.$transaction(tx => lendAssembly(tx, { ...f.input, recipient: "Отвал", expectedChangedAt: assembly.lastChangedAt.toISOString() }, f.user));
  await assert.rejects(db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.low.id }, f.user)), /закрыт/);
  assert.equal((await db.assemblyLoan.findUniqueOrThrow({ where: { id: next.id } })).returnedAt, null);
});

test("return validates its horizon; failures roll back state, audit and loan together", async () => {
  const f = await fixture();
  await assert.rejects(db.$transaction(async tx => { await lendAssembly(tx, f.input, f.user); throw new Error("rollback"); }));
  assert.deepEqual(await db.assembly.findUnique({ where: { id: f.assembly.id } }), f.assembly);
  assert.equal(await db.assemblyLoan.count({ where: { assemblyId: f.assembly.id } }), 0);
  const loan = await db.$transaction(tx => lendAssembly(tx, f.input, f.user));
  await db.assemblyHorizon.update({ where: { id: f.high.id }, data: { isActive: false } });
  await assert.rejects(db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user)), /действующий/);
  await assert.rejects(db.$transaction(async tx => { await returnAssembly(tx, { loanId: loan.id, horizonId: f.low.id }, f.user); throw new Error("rollback"); }));
  assert.equal((await db.assemblyLoan.findUniqueOrThrow({ where: { id: loan.id } })).returnedAt, null);
  assert.equal(await db.assemblyMovement.count({ where: { assemblyId: f.assembly.id } }), 1);
});

test("concurrent returns keep one destination and one return audit record", async () => {
  const f = await fixture();
  const loan = await db.$transaction(tx => lendAssembly(tx, f.input, f.user));
  const results = await Promise.allSettled([f.low.id, f.high.id].map(horizonId => db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId }, f.user), { maxWait: 10000, timeout: 20000 })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const movements = await db.assemblyMovement.findMany({ where: { loanId: loan.id, action: "RETURN_LOAN" } });
  assert.equal(movements.length, 1);
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } })).horizonId, movements[0].toHorizonId);
});

test("undo cannot disconnect a later power action or restore a deleted horizon", async () => {
  const f = await fixture();
  const loan = await db.$transaction(tx => lendAssembly(tx, f.input, f.user));
  const issued = await db.assemblyMovement.findFirstOrThrow({ where: { loanId: loan.id } });
  await db.assemblyHorizon.update({ where: { id: f.low.id }, data: { isActive: false } });
  await assert.rejects(db.$transaction(tx => undoAssemblyChange(tx, issued.id, f.user)), /горизонт удалён/);
  await db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user));
  const returned = await db.assemblyMovement.findFirstOrThrow({ where: { loanId: loan.id, action: "RETURN_LOAN" } });
  await db.yaknoExcavatorState.update({ where: { excavatorLocationId: f.exc.id }, data: { horizonId: f.high.id } });
  await db.$transaction(tx => setAssemblyPower(tx, f.assembly.id, f.exc.id, f.user));
  await assert.rejects(db.$transaction(tx => undoAssemblyChange(tx, returned.id, f.user)), /раннее/);
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } })).isPowered, true);
});

test("all four recipients are accepted and stale detail edits do not alter returned assemblies", async () => {
  const f = await fixture();
  for (const recipient of ["Северный", "СКМ", "Западный", "Отвал"]) {
    const assembly = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
    const loan = await db.$transaction(tx => lendAssembly(tx, { ...f.input, recipient, expectedChangedAt: assembly.lastChangedAt.toISOString() }, f.user));
    await db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user));
  }
  await assert.rejects(db.$transaction(tx => updateAssemblyDetails(tx, { assemblyId: f.assembly.id, length: 99, comment: "stale", expectedChangedAt: f.input.expectedChangedAt }, f.user)), /уже изменена/);
  const assembly = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  assert.equal(assembly.length, 150); assert.equal(assembly.comment, "PRIVATE_COMMENT");
});

test("undo follows the latest assembly action, restores loan state and cannot overwrite later work", async () => {
  const f = await fixture();
  const loan = await db.$transaction(tx => lendAssembly(tx, f.input, f.user));
  const issued = await db.assemblyMovement.findFirstOrThrow({ where: { loanId: loan.id } });
  await db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user));
  const returned = await db.assemblyMovement.findFirstOrThrow({ where: { loanId: loan.id, action: "RETURN_LOAN" } });
  await assert.rejects(db.$transaction(tx => undoAssemblyChange(tx, issued.id, f.user)), /раннее/);
  await db.$transaction(tx => undoAssemblyChange(tx, returned.id, f.user));
  assert.equal((await db.assemblyLoan.findUniqueOrThrow({ where: { id: loan.id } })).returnedAt, null);
  await db.$transaction(tx => undoAssemblyChange(tx, issued.id, f.user));
  assert.equal((await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } })).horizonId, f.low.id);
  assert.equal(await db.assemblyLoan.count({ where: { id: loan.id } }), 0);
  assert.equal(await db.assemblyMovement.count({ where: { assemblyId: f.assembly.id } }), 0);
});

test("report keeps both loan events and repeated cycles, excludes comment-only edits and uses historical length", async () => {
  const f = await fixture();
  const period = { start: new Date("2026-09-01T06:30:00+05:00"), end: new Date("2026-09-01T19:30:00+05:00") };
  for (const recipient of ["Северный", "Западный"]) {
    const current = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
    const loan = await db.$transaction(tx => lendAssembly(tx, { ...f.input, recipient, expectedChangedAt: current.lastChangedAt.toISOString() }, f.user));
    await db.$transaction(tx => returnAssembly(tx, { loanId: loan.id, horizonId: f.high.id }, f.user));
  }
  const current = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  await db.$transaction(tx => updateAssemblyDetails(tx, { assemblyId: current.id, length: 150, comment: "SECRET_ONLY_CARD", expectedChangedAt: current.lastChangedAt.toISOString() }, f.user));
  await db.assemblyMovement.create({ data: { userId: f.user.id, assemblyId: current.id, action: "LENGTH", oldLength: 150, newLength: 150, comment: "LEGACY_ONLY_COMMENT" } });
  const rows = await db.assemblyMovement.findMany({ where: { assemblyId: f.assembly.id }, orderBy: { id: "asc" } });
  for (const [i, row] of Array.from(rows.entries())) await db.assemblyMovement.update({ where: { id: row.id }, data: { createdAt: new Date(period.start.getTime() + (i + 1) * 60000) } });
  await db.assembly.update({ where: { id: f.assembly.id }, data: { length: 999 } });
  const report = await db.$transaction(tx => collectShiftReport(tx, period));
  const body = formatShiftReport(report).join("\n");
  assert.equal(report.events.filter(e => e.kind === "work" && e.group.key === "assembly-loans").length, 4);
  assert.equal((body.match(/выдана в долг/g) ?? []).length, 2);
  assert.equal((body.match(/возвращена из долга/g) ?? []).length, 2);
  assert(body.includes("Северный") && body.includes("Западный") && body.includes("150 м"));
  assert(!/999|SECRET_ONLY_CARD|LEGACY_ONLY_COMMENT|длина 150/.test(body));
  const nextPeriod = { start: period.end, end: new Date("2026-09-02T06:30:00+05:00") };
  await db.assemblyMovement.update({ where: { id: rows[3].id }, data: { createdAt: nextPeriod.start } });
  const nextReport = await db.$transaction(tx => collectShiftReport(tx, nextPeriod));
  const nextBody = formatShiftReport(nextReport).join("\n");
  assert(!nextBody.includes("выдана в долг"));
  assert(nextBody.includes("возвращена из долга (Западный)"));
});

test("comment and actual length edits stay in app history but do not create report events or an empty assembly block", async () => {
  const f = await fixture();
  await db.$transaction(tx => updateAssemblyDetails(tx, { assemblyId: f.assembly.id, length: 150, comment: "card-note", expectedChangedAt: f.input.expectedChangedAt }, f.user));
  const current = await db.assembly.findUniqueOrThrow({ where: { id: f.assembly.id } });
  await db.$transaction(tx => updateAssemblyDetails(tx, { assemblyId: current.id, length: 180, comment: "card-note", expectedChangedAt: current.lastChangedAt.toISOString() }, f.user));
  const period = { start: new Date("2026-09-03T06:30:00+05:00"), end: new Date("2026-09-03T19:30:00+05:00") };
  await db.assemblyMovement.updateMany({ where: { assemblyId: f.assembly.id }, data: { createdAt: period.start } });
  assert.deepEqual((await db.assemblyMovement.findMany({ where: { assemblyId: f.assembly.id }, orderBy: { id: "asc" } })).map(r => r.action), ["COMMENT", "LENGTH"]);
  const report = await db.$transaction(tx => collectShiftReport(tx, period));
  const body = formatShiftReport(report).join("\n");
  assert(!body.includes("длина")); assert(!body.includes("card-note"));
  assert(!body.includes("\nСборки\n"));
  assert(body.includes("За смену изменений не было."));
  assert.equal(report.events.length, 0);
  assert.equal(await db.assemblyMovement.count({ where: { assemblyId: current.id } }), 2);
  const saved = await db.assembly.findUniqueOrThrow({ where: { id: current.id } });
  assert.equal(saved.length, 180); assert.equal(saved.comment, "card-note");
});

test("report excludes every legacy assembly length variant from the screenshot without deleting history or hiding a move", async () => {
  const f = await fixture();
  const period = { start: new Date("2026-09-05T06:30:00+05:00"), end: new Date("2026-09-05T19:30:00+05:00") };
  const lengths: Array<[number | null, number | null]> = [[null, null], [null, 220], [220, 220], [220, null], [220, 180], [null, null], [220, 220]];
  for (const [oldLength, newLength] of lengths) await db.assemblyMovement.create({ data: {
    assemblyId: f.assembly.id, userId: f.user.id, createdAt: period.start, action: "LENGTH", oldLength, newLength, comment: "legacy-note"
  } });
  await db.assemblyMovement.create({ data: { assemblyId: f.assembly.id, userId: f.user.id, createdAt: period.start,
    action: "MOVE", fromHorizonId: f.low.id, fromPlaceText: f.low.name, toPlaceText: "Ремонт" } });
  const before = await db.assemblyMovement.findMany({ where: { assemblyId: f.assembly.id }, orderBy: { id: "asc" } });
  const report = await db.$transaction(tx => collectShiftReport(tx, period));
  const body = formatShiftReport(report).join("\n");
  assert(!/длина|legacy-note|220|180/.test(body));
  assert(body.includes(`${f.assembly.name}: гор. +${f.key}00м → Ремонт.`));
  assert.equal(report.events.length, 1);
  assert.deepEqual(await db.assemblyMovement.findMany({ where: { assemblyId: f.assembly.id }, orderBy: { id: "asc" } }), before);
  assert.deepEqual(await db.assembly.findUnique({ where: { id: f.assembly.id } }), f.assembly);
});

test("free Yakno horizon move already appears in report and remains independent of assembly loans", async () => {
  const f = await fixture();
  const box = await db.yaknoBox.create({ data: { number: "report-free", horizonId: f.low.id } });
  await db.$transaction(tx => moveFreeYakno(tx, { boxId: box.id, horizonId: f.high.id, expectedHorizonId: f.low.id }, f.user));
  const period = { start: new Date("2026-09-04T06:30:00+05:00"), end: new Date("2026-09-04T19:30:00+05:00") };
  await db.yaknoMovement.updateMany({ where: { boxId: box.id }, data: { createdAt: period.start } });
  const body = formatShiftReport(await db.$transaction(tx => collectShiftReport(tx, period))).join("\n");
  assert(body.includes("ЯКНО №report-free")); assert(body.includes(`гор. +${f.key}50м`));
});
