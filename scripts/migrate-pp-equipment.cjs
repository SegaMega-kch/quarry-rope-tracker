const { PrismaClient } = require("@prisma/client");
const { realpathSync, statSync } = require("node:fs");
const { backupDatabase, verifyDatabase } = require("./deployment-data.cjs");

async function migratePp(database, backupDirectory, apply = false) {
  const real = realpathSync(database);
  if (!statSync(real).isFile() || !statSync(real).size) throw new Error("Existing inventory database required");
  const db = new PrismaClient({ datasources: { db: { url: `file:${real.replaceAll("\\", "/")}` } } });
  try {
    const columns = await db.$queryRawUnsafe("PRAGMA table_info(PpPoint)");
    for (const name of ["id", "name", "isActive", "equipmentLocationId", "unloadingSectorId"]) {
      if (!columns.some((column) => column.name === name)) throw new Error("Not the expected inventory schema");
    }
    const existing = columns.find((column) => column.name === "equipmentSectorId");
    if (existing) {
      if (existing.type !== "INTEGER" || Number(existing.notnull) !== 0 || existing.dflt_value !== null) throw new Error("Unexpected PP column definition");
      return { changed: false, ready: true };
    }
    if (!apply) return { changed: false, ready: false };
    if (!backupDirectory) throw new Error("A new backup directory is required");
    await backupDatabase(real, backupDirectory);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "PpPoint" ADD COLUMN "equipmentSectorId" INTEGER');
    });
    await verifyDatabase(real, backupDirectory);
    return { changed: true, ready: true };
  } finally { await db.$disconnect(); }
}
module.exports = { migratePp };
if (require.main === module) {
  const [database, mode, backup] = process.argv.slice(2);
  if (!database || !["--check", "--apply"].includes(mode)) {
    console.error("Usage: node scripts/migrate-pp-equipment.cjs DATABASE --check | --apply NEW_BACKUP_DIRECTORY");
    process.exitCode = 1;
  } else migratePp(database, backup, mode === "--apply")
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
