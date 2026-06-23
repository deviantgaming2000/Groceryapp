import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const categories = ["Produce", "Meat", "Dairy", "Bakery", "Pantry", "Frozen", "Household", "Beverages"];
  const storeTypes = ["Walmart", "Fry's", "Costco", "Safeway", "Local butcher", "Asian market", "Farmers market"];

  for (const value of categories) {
    await prisma.referenceOption.upsert({
      where: { kind_value: { kind: "category", value } },
      create: { kind: "category", value },
      update: {}
    });
  }

  for (const value of storeTypes) {
    await prisma.referenceOption.upsert({
      where: { kind_value: { kind: "store_type", value } },
      create: { kind: "store_type", value },
      update: {}
    });
  }

  const email = process.env.SINGLE_USER_EMAIL ?? "local@example.com";
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: "Local user" },
    update: {}
  });

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, vehicleMpg: 22, gasPricePerGallon: 0 },
    update: {}
  });
}

main().finally(async () => prisma.$disconnect());
