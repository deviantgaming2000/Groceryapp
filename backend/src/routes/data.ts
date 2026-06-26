import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";

// Data-management tools: see what's stored (including hidden/soft-deleted rows)
// and reactivate, hide, or permanently purge it. Everything is scoped to the
// single app user.
export async function dataRoutes(app: FastifyInstance) {
  // Overview: active vs. hidden counts, with a per-store price breakdown.
  app.get("/data/summary", async () => {
    const userId = await getDefaultUserId();
    const [stores, itemsActive, itemsInactive, pricesActive, pricesInactive, lists, couponsActive, couponsInactive, perStore] =
      await Promise.all([
        prisma.store.count({ where: { userId } }),
        prisma.groceryItem.count({ where: { userId, isActive: true } }),
        prisma.groceryItem.count({ where: { userId, isActive: false } }),
        prisma.priceEntry.count({ where: { userId, isActive: true } }),
        prisma.priceEntry.count({ where: { userId, isActive: false } }),
        prisma.groceryList.count({ where: { userId } }),
        prisma.coupon.count({ where: { userId, isActive: true } }),
        prisma.coupon.count({ where: { userId, isActive: false } }),
        prisma.store.findMany({
          where: { userId },
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: { select: { priceEntries: true } }
          },
          orderBy: { name: "asc" }
        })
      ]);

    // Per-store active/inactive price counts.
    const storeBreakdown = await Promise.all(
      perStore.map(async (s) => {
        const [active, inactive] = await Promise.all([
          prisma.priceEntry.count({ where: { userId, storeId: s.id, isActive: true } }),
          prisma.priceEntry.count({ where: { userId, storeId: s.id, isActive: false } })
        ]);
        return { id: s.id, name: s.name, storeActive: s.isActive, pricesActive: active, pricesInactive: inactive };
      })
    );

    return {
      stores,
      items: { active: itemsActive, inactive: itemsInactive },
      prices: { active: pricesActive, inactive: pricesInactive },
      lists,
      coupons: { active: couponsActive, inactive: couponsInactive },
      perStore: storeBreakdown
    };
  });

  const scope = z.object({ storeId: z.string().optional() });

  // Un-hide prices (optionally for one store) so they show in entry + comparison.
  app.post("/data/prices/reactivate", async (request) => {
    const userId = await getDefaultUserId();
    const { storeId } = scope.parse(request.body ?? {});
    const result = await prisma.priceEntry.updateMany({
      where: { userId, isActive: false, ...(storeId ? { storeId } : {}) },
      data: { isActive: true }
    });
    return { reactivated: result.count };
  });

  // Hide active prices (soft-delete) without removing them.
  app.post("/data/prices/hide", async (request) => {
    const userId = await getDefaultUserId();
    const { storeId } = scope.parse(request.body ?? {});
    const result = await prisma.priceEntry.updateMany({
      where: { userId, isActive: true, ...(storeId ? { storeId } : {}) },
      data: { isActive: false }
    });
    return { hidden: result.count };
  });

  // Permanently delete hidden prices (optionally for one store). Irreversible.
  app.post("/data/prices/purge-inactive", async (request) => {
    const userId = await getDefaultUserId();
    const { storeId } = scope.parse(request.body ?? {});
    const result = await prisma.priceEntry.deleteMany({
      where: { userId, isActive: false, ...(storeId ? { storeId } : {}) }
    });
    return { purged: result.count };
  });
}
