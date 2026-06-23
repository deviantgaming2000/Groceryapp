import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { fetchGoogleDistanceMiles, originHash } from "../services/maps.js";

const manualDistanceSchema = z.object({
  storeId: z.string(),
  oneWayMiles: z.coerce.number().nonnegative(),
  oneWayMinutes: z.coerce.number().int().nonnegative().optional().nullable()
});

function address(settings: any) {
  return [settings.homeAddress, settings.homeCity, settings.homeState, settings.homeZip].filter(Boolean).join(", ");
}

function storeAddress(store: any) {
  return [store.address, store.city, store.state, store.zip].filter(Boolean).join(", ");
}

export async function distanceRoutes(app: FastifyInstance) {
  app.get("/distances", async () => {
    const userId = await getDefaultUserId();
    return prisma.distanceCache.findMany({ where: { userId }, include: { store: true } });
  });

  app.post("/distances/manual", async (request, reply) => {
    const userId = await getDefaultUserId();
    const data = manualDistanceSchema.parse(request.body);
    const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    const key = originHash(address(settings) || "manual-origin");
    const row = await prisma.distanceCache.upsert({
      where: { userId_storeId_originHash: { userId, storeId: data.storeId, originHash: key } },
      create: { userId, storeId: data.storeId, originHash: key, oneWayMiles: data.oneWayMiles, oneWayMinutes: data.oneWayMinutes, source: "manual" },
      update: { oneWayMiles: data.oneWayMiles, oneWayMinutes: data.oneWayMinutes, source: "manual" }
    });
    reply.code(201);
    return row;
  });

  app.post("/distances/calculate/:storeId", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { storeId } = request.params as { storeId: string };
    const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId, userId } });
    const origin = address(settings);
    if (!origin) return reply.code(400).send({ error: "Home/base address is required before calculating distance" });
    const calculated = await fetchGoogleDistanceMiles(origin, storeAddress(store));
    if (!calculated) return reply.code(400).send({ error: "Google Maps API key not configured. Enter distance manually." });
    return prisma.distanceCache.upsert({
      where: { userId_storeId_originHash: { userId, storeId, originHash: originHash(origin) } },
      create: { userId, storeId, originHash: originHash(origin), oneWayMiles: calculated.oneWayMiles, oneWayMinutes: calculated.oneWayMinutes, source: calculated.source },
      update: { oneWayMiles: calculated.oneWayMiles, oneWayMinutes: calculated.oneWayMinutes, source: calculated.source }
    });
  });
}
