import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const users: Array<{ login: string; role: string }> = [
  { login: "1 смена", role: "shift" },
  { login: "2 смена", role: "shift" },
  { login: "3 смена", role: "shift" },
  { login: "4 смена", role: "shift" },
  { login: "начальник", role: "boss" },
  { login: "кладовщик", role: "storekeeper" },
  { login: "администратор", role: "admin" }
];

const ropeTypes = [
  { name: "Подъём ЭКГ-10", standardLength: 110, defaultDiameter: "45,5 мм" },
  { name: "Напор ЭКГ-10", standardLength: 41, defaultDiameter: "45,5 мм" },
  { name: "Подъём ЭКГ-12К", standardLength: 82, defaultDiameter: "52 мм" },
  { name: "Напор ЭКГ-12К", standardLength: 41, defaultDiameter: "52 мм" }
];

const locationCategory = (name: string): string => {
  if (name.startsWith("ЭКГ")) return "excavator";
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

async function main() {
  const passwordHash = await bcrypt.hash("123456", 10);

  for (const user of users) {
    await prisma.user.upsert({
      where: { login: user.login },
      update: { role: user.role, passwordHash },
      create: { ...user, passwordHash }
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
