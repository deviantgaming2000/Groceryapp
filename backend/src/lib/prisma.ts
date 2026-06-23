import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function getDefaultUserId() {
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
  return user.id;
}

