import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const horizons = [
  { name: "Горизонт +270 м ПП", sortOrder: 270 },
  { name: "Горизонт +306 м ПП", sortOrder: 306 }
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL explicitly");
  for (const horizon of horizons) {
    await prisma.assemblyHorizon.upsert({
      where: { name: horizon.name },
      update: { sortOrder: horizon.sortOrder, isActive: true },
      create: horizon
    });
  }
  console.log(JSON.stringify({ ready: true, horizons: horizons.map((horizon) => horizon.name) }));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
