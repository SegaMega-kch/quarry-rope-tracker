import { PrismaClient } from "@prisma/client";
import { closeSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";

async function main() {
  if (process.env.DATABASE_URL !== "file:./pp-review.db" || process.env.RAPMAS_PP_REVIEW !== "1") throw new Error("Use the isolated PP review environment");
  const path = resolve("prisma/pp-review.db");
  closeSync(openSync(path, "wx"));
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], { stdio: "inherit" });
  const db = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash("pp-test-2026", 10);
    for (const [login, role] of [["1 смена", "shift"], ["начальник", "boss"], ["кладовщик", "storekeeper"]]) {
      await db.user.create({ data: { login, role, passwordHash } });
    }
    const equipment = await db.location.create({ data: { name: "ЭКГ-8И №54", category: "excavator" } });
    await db.location.createMany({ data: [{ name: "ЭКГ-10 №4", category: "excavator" }, { name: "ЭКГ-10 №9", category: "excavator" }, { name: "CAT №72", category: "loader" }] });
    await db.ppPoint.create({ data: { name: "ПП №3", lastChangedBy: "4 смена", sectors: { create: [
      { name: "1", quantity: 0 }, { name: "2", quantity: 0 }, { name: "3", quantity: 8 }
    ] } } });
    const pp4 = await db.ppPoint.create({ data: { name: "ПП №4", equipmentLocationId: equipment.id, lastChangedBy: "3 смена", sectors: { create: [
      { name: "1", quantity: 1 }, { name: "2", quantity: 8 }, { name: "3", quantity: 2 }
    ] } }, include: { sectors: true } });
    await db.ppPoint.update({ where: { id: pp4.id }, data: { equipmentSectorId: pp4.sectors[0].id, unloadingSectorId: pp4.sectors[0].id } });
    await db.ppPoint.create({ data: { name: "ПП №7", sectors: { create: [{ name: "1" }, { name: "2" }] } } });
    console.log("Isolated PP review database created. No MAX credentials or production data.");
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
