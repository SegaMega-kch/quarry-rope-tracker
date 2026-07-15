import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const seedPassword = (name: string) => process.env[name] ?? process.env.SEED_DEFAULT_PASSWORD ?? "change-me";

const users: Array<{ login: string; role: string; password: string }> = [
  { login: "1 смена", role: "shift", password: seedPassword("SEED_SHIFT_1_PASSWORD") },
  { login: "2 смена", role: "shift", password: seedPassword("SEED_SHIFT_2_PASSWORD") },
  { login: "3 смена", role: "shift", password: seedPassword("SEED_SHIFT_3_PASSWORD") },
  { login: "4 смена", role: "shift", password: seedPassword("SEED_SHIFT_4_PASSWORD") },
  { login: "начальник", role: "boss", password: seedPassword("SEED_BOSS_PASSWORD") },
  { login: "кладовщик", role: "storekeeper", password: seedPassword("SEED_STOREKEEPER_PASSWORD") },
  { login: "администратор", role: "admin", password: seedPassword("SEED_ADMIN_PASSWORD") }
];

const ropeTypes = [
  { name: "Подъём ЭКГ-10", standardLength: 110, defaultDiameter: "45,5 мм" },
  { name: "Напор ЭКГ-10", standardLength: 41, defaultDiameter: "45,5 мм" },
  { name: "Подъём ЭКГ-12К", standardLength: 82, defaultDiameter: "52 мм" },
  { name: "Напор ЭКГ-12К", standardLength: 41, defaultDiameter: "52 мм" }
];

const locationCategory = (name: string): string => {
  if (name.startsWith("ЭКГ")) return "excavator";
  if (name.startsWith("CAT")) return "loader";
  if (name.startsWith("ПП")) return "transfer_point";
  return "storage";
};

const locations = [
  "Вешала под 30т краном",
  "ЭКГ-10 №4",
  "ЭКГ-10 №10",
  "ЭКГ-8И №42",
  "ЭКГ-8И №46",
  "ЭКГ-8И №54",
  "ЭКГ-8И №58",
  "ЭКГ-12К №74",
  "ЭКГ-12К №75",
  "CAT №72",
  "ПП №1",
  "ПП №3",
  "ПП №4",
  "ПП №5",
  "ПП №7",
  "ПП №8"
];

const turntables = ["Вертушка №1", "Вертушка №2", "Вертушка №3", "Вертушка №4", "Вертушка №5", "Вертушка №6"];
const toothTypes = ["Зуб ЭКГ-10", "Зуб ЭКГ-20"];
const toothBins = ["Пена 1", "Пена 2", "Земля под 30т краном"];
const assemblies = ["Сборка №1", "Сборка №2", "Сборка №3", "Сборка №4", "Сборка №5"];
const assemblyHorizons = Array.from({ length: 31 }, (_, index) => -50 + index * 15).map((value) => ({
  name: `Горизонт ${value > 0 ? `+${value}` : value}`,
  sortOrder: value
}));
const yaknoNumbers = ["122", "14/1", "32", "30", "28", "41", "117", "153", "6", "31", "144", "152", "121", "159", "156", "123"];
const yaknoInitialPlacements: Record<string, string[]> = {
  "ЭКГ-10 №4": ["122"],
  "ЭКГ-10 №10": ["14/1", "32"],
  "ЭКГ-8И №42": ["30", "28", "41"],
  "ЭКГ-8И №46": ["117"],
  "ЭКГ-8И №54": ["153", "6"],
  "ЭКГ-8И №58": ["31", "144"],
  "ЭКГ-12К №74": ["152", "121"],
  "ЭКГ-12К №75": ["159", "156", "123"]
};
const ppInitialData = [
  { name: "ПП №3", equipment: "ЭКГ-12К №75", sectors: ["1", "2", "3"] },
  { name: "ПП №4", equipment: "ЭКГ-8И №54", sectors: ["1", "2", "3"] },
  { name: "ПП №5", equipment: "ЭКГ-8И №58", sectors: ["1", "2"] },
  { name: "ПП №7", equipment: "ЭКГ-12К №75", sectors: ["1", "2", "3"] },
  { name: "ПП №8", equipment: "ЭКГ-8И №46", sectors: ["1", "2"] }
];

async function main() {
  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await prisma.user.upsert({
      where: { login: user.login },
      update: { role: user.role, passwordHash },
      create: { login: user.login, role: user.role, passwordHash }
    });
  }

  for (const ropeType of ropeTypes) {
    await prisma.ropeType.upsert({
      where: { name: ropeType.name },
      update: { standardLength: ropeType.standardLength, defaultDiameter: ropeType.defaultDiameter, isActive: true },
      create: ropeType
    });
  }

  for (const name of locations) {
    await prisma.location.upsert({
      where: { name },
      update: { category: locationCategory(name), isActive: true },
      create: { name, category: locationCategory(name) }
    });
  }

  const craneLocation = await prisma.location.findUnique({ where: { name: "Вешала под 30т краном" } });
  for (const name of turntables) {
    await prisma.turntable.upsert({
      where: { name },
      update: {},
      create: { name, currentLocationId: craneLocation?.id }
    });
  }

  for (const name of toothTypes) {
    await prisma.toothType.upsert({
      where: { name },
      update: { isActive: true },
      create: { name }
    });
  }

  for (const name of toothBins) {
    await prisma.toothBin.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, currentLocationId: craneLocation?.id, lastChangedBy: "система" }
    });
  }

  for (const horizon of assemblyHorizons) {
    await prisma.assemblyHorizon.upsert({
      where: { name: horizon.name },
      update: { sortOrder: horizon.sortOrder, isActive: true },
      create: horizon
    });
  }

  for (const name of assemblies) {
    await prisma.assembly.upsert({
      where: { name },
      update: {},
      create: { name, lastChangedBy: "система" }
    });
  }

  for (const number of yaknoNumbers) {
    await prisma.yaknoBox.upsert({
      where: { number },
      update: { isActive: true },
      create: { number, lastChangedBy: "система" }
    });
  }

  for (const [excavatorName, boxNumbers] of Object.entries(yaknoInitialPlacements)) {
    const excavator = await prisma.location.findUnique({ where: { name: excavatorName } });
    if (!excavator) continue;

    await prisma.yaknoExcavatorState.upsert({
      where: { excavatorLocationId: excavator.id },
      update: {},
      create: { excavatorLocationId: excavator.id, lastChangedBy: "система" }
    });

    for (let index = 0; index < boxNumbers.length; index += 1) {
      const number = boxNumbers[index];
      const box = await prisma.yaknoBox.findUnique({ where: { number } });
      if (!box || box.excavatorLocationId) continue;
      await prisma.yaknoBox.update({
        where: { id: box.id },
        data: {
          excavatorLocationId: excavator.id,
          isPowered: index === 0,
          status: "ACTIVE",
          isActive: true,
          lastChangedBy: "система"
        }
      });
    }
  }

  for (const item of ppInitialData) {
    const equipment = await prisma.location.findUnique({ where: { name: item.equipment } });
    const point = await prisma.ppPoint.upsert({
      where: { name: item.name },
      update: { isActive: true, equipmentLocationId: equipment?.id },
      create: { name: item.name, equipmentLocationId: equipment?.id, lastChangedBy: "система" }
    });

    for (const sectorName of item.sectors) {
      await prisma.ppSector.upsert({
        where: { ppPointId_name: { ppPointId: point.id, name: sectorName } },
        update: { isActive: true },
        create: { ppPointId: point.id, name: sectorName, lastChangedBy: "система" }
      });
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
