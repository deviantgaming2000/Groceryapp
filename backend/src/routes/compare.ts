import { FastifyInstance } from "fastify";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { compareGroceryList } from "../services/comparison.js";
import { originHash } from "../services/maps.js";

function numberify<T>(value: T): any {
  if (value == null) return value;
  if (typeof value === "object" && "toNumber" in (value as any)) return (value as any).toNumber();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(numberify);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as any).map(([key, val]) => [key, numberify(val)]));
  return value;
}

function address(settings: any) {
  return [settings.homeAddress, settings.homeCity, settings.homeState, settings.homeZip].filter(Boolean).join(", ");
}

// Mirrors the Prisma UserSettings defaults so a user without a settings row
// still gets a valid comparison instead of a 500.
const DEFAULT_SETTINGS = {
  vehicleMpg: 22,
  gasPricePerGallon: 0,
  roundTrip: true,
  costPerMileOverride: null,
  staleDays: 14,
  veryStaleDays: 30
};

export async function compareRoutes(app: FastifyInstance) {
  app.get("/compare/:listId", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { listId } = request.params as { listId: string };
    const [list, stores, priceEntries, coupons, storedSettings] = await Promise.all([
      prisma.groceryList.findFirst({ where: { id: listId, userId }, include: { items: { include: { groceryItem: true } } } }),
      prisma.store.findMany({ where: { userId, isActive: true } }),
      prisma.priceEntry.findMany({ where: { userId, isActive: true } }),
      prisma.coupon.findMany({ where: { userId, isActive: true } }),
      prisma.userSettings.findUnique({ where: { userId } })
    ]);
    if (!list) {
      return reply.status(404).send({ error: "List not found" });
    }
    const settings = storedSettings ?? DEFAULT_SETTINGS;
    const key = originHash(address(settings) || "manual-origin");
    const distances = await prisma.distanceCache.findMany({ where: { userId, originHash: key } });
    return compareGroceryList({
      list: numberify(list),
      stores: numberify(stores),
      priceEntries: numberify(priceEntries),
      coupons: numberify(coupons),
      distances: numberify(distances),
      settings: numberify(settings)
    });
  });
}

