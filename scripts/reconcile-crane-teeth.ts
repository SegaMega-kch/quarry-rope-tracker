import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { toothCraneGround, toothCraneLocation } from "../lib/tooth-policy";

// Read-only unless --apply is supplied. DATABASE_URL must be explicit to prevent using another database.
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL explicitly before reconciliation");
const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const login = process.argv.find((arg) => arg.startsWith("--login="))?.slice(8);

async function main() {
  await db.$transaction(async (tx) => {
    const rows = await tx.toothStock.findMany({
      where: {
        condition: "USED", quantity: { gt: 0 },
        bin: { name: toothCraneGround, currentLocation: { name: toothCraneLocation } }
      },
      include: { bin: true, toothType: true }
    });
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", stocks: rows.map((row) => ({ id: row.id, type: row.toothType.name, quantity: row.quantity })) }));
    if (!apply || !rows.length) return;
    if (!login) throw new Error("Supply --login=<existing operator> to attribute the correction");
    const user = await tx.user.findUnique({ where: { login } });
    if (!user) throw new Error("Operator not found");
    for (const row of rows) {
      await tx.toothStock.update({ where: { id: row.id }, data: { quantity: 0, lastChangedAt: new Date(), lastChangedBy: user.login } });
      await tx.toothMovement.create({ data: {
        operationId: randomUUID(), userId: user.id, action: "RECONCILE_SCRAP",
        binId: row.binId, fromBinId: row.binId, toothTypeId: row.toothTypeId,
        condition: "USED", quantity: row.quantity, fromLocationId: row.bin.currentLocationId,
        fromLocationText: row.bin.name, toLocationText: "Списано под 30т краном",
        comment: "Списание ранее разгруженных б/у зубьев. Предыдущие записи истории сохранены."
      } });
    }
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
