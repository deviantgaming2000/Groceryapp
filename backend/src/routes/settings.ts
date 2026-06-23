import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";

const settingsSchema = z.object({
  homeAddress: z.string().optional().nullable(),
  homeCity: z.string().optional().nullable(),
  homeState: z.string().optional().nullable(),
  homeZip: z.string().optional().nullable(),
  homeLatitude: z.coerce.number().optional().nullable(),
  homeLongitude: z.coerce.number().optional().nullable(),
  vehicleMpg: z.coerce.number().positive().optional(),
  gasPricePerGallon: z.coerce.number().nonnegative().optional(),
  roundTrip: z.boolean().optional(),
  costPerMileOverride: z.coerce.number().nonnegative().optional().nullable(),
  staleDays: z.coerce.number().int().positive().optional(),
  veryStaleDays: z.coerce.number().int().positive().optional(),
  googleMapsEnabled: z.boolean().optional()
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings", async () => {
    const userId = await getDefaultUserId();
    return prisma.userSettings.findUniqueOrThrow({ where: { userId } });
  });

  app.patch("/settings", async (request) => {
    const userId = await getDefaultUserId();
    const data = settingsSchema.parse(request.body);
    return prisma.userSettings.update({ where: { userId }, data });
  });

  app.post("/settings/gas-price", async (request) => {
    const userId = await getDefaultUserId();
    const data = z.object({ gasPricePerGallon: z.coerce.number().nonnegative() }).parse(request.body);
    return prisma.userSettings.update({ where: { userId }, data });
  });
}

