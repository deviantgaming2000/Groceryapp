import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";

const itemSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  quantityNeeded: z.coerce.number().positive(),
  unitType: z.enum(["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"]),
  notes: z.string().optional().nullable(),
  preferredBrand: z.string().optional().nullable(),
  upc: z.string().optional().nullable(),
  eachEquivQuantity: z.coerce.number().positive().optional().nullable(),
  eachEquivUnit: z.enum(["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"]).optional().nullable(),
  minPurchaseQuantity: z.coerce.number().positive().optional().nullable(),
  minPurchaseUnit: z.enum(["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"]).optional().nullable(),
  commonlyUsed: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export async function itemRoutes(app: FastifyInstance) {
  app.get("/items", async (request) => {
    const userId = await getDefaultUserId();
    const query = request.query as { search?: string; category?: string; active?: string };
    return prisma.groceryItem.findMany({
      where: {
        userId,
        ...(query.active ? { isActive: query.active === "true" } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { notes: { contains: query.search, mode: "insensitive" } }, { preferredBrand: { contains: query.search, mode: "insensitive" } }] } : {})
      },
      orderBy: { name: "asc" }
    });
  });

  app.get("/items/similar", async (request) => {
    const userId = await getDefaultUserId();
    const { name } = request.query as { name: string };
    if (!name) return [];
    return prisma.groceryItem.findMany({
      where: { userId, name: { contains: name, mode: "insensitive" } },
      take: 10
    });
  });

  app.post("/items", async (request, reply) => {
    const userId = await getDefaultUserId();
    const data = itemSchema.parse(request.body);
    const similar = await prisma.groceryItem.findMany({ where: { userId, name: { contains: data.name, mode: "insensitive" } }, take: 5 });
    const item = await prisma.groceryItem.create({ data: { ...data, userId } });
    reply.code(201);
    return { item, duplicateWarnings: similar.map((row) => row.name) };
  });

  app.patch("/items/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const data = itemSchema.partial().parse(request.body);
    return prisma.groceryItem.update({ where: { id, userId }, data });
  });

  // Merge one item into another: move its prices, list memberships, and coupons to the
  // target item, then delete the now-empty source. Used to consolidate API-imported
  // branded products (e.g. "Fry's Whole Milk") under a generic comparable item.
  app.post("/items/:id/merge", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const { targetItemId } = z.object({ targetItemId: z.string().min(1) }).parse(request.body);
    if (id === targetItemId) return reply.code(400).send({ error: "Choose a different target item." });

    const [source, target] = await Promise.all([
      prisma.groceryItem.findFirst({ where: { id, userId } }),
      prisma.groceryItem.findFirst({ where: { id: targetItemId, userId } })
    ]);
    if (!source || !target) return reply.code(404).send({ error: "Item not found." });

    const movedPrices = await prisma.priceEntry.updateMany({
      where: { userId, groceryItemId: id },
      data: { groceryItemId: targetItemId }
    });

    // Reassign list memberships, respecting the unique (list, item) constraint.
    const listItems = await prisma.groceryListItem.findMany({ where: { groceryItemId: id } });
    let movedListItems = 0;
    for (const li of listItems) {
      const clash = await prisma.groceryListItem.findFirst({
        where: { groceryListId: li.groceryListId, groceryItemId: targetItemId }
      });
      if (clash) await prisma.groceryListItem.delete({ where: { id: li.id } });
      else {
        await prisma.groceryListItem.update({ where: { id: li.id }, data: { groceryItemId: targetItemId } });
        movedListItems++;
      }
    }

    await prisma.coupon.updateMany({ where: { userId, groceryItemId: id }, data: { groceryItemId: targetItemId } });
    await prisma.groceryItem.delete({ where: { id } });

    return { merged: true, target, movedPrices: movedPrices.count, movedListItems };
  });

  app.delete("/items/:id", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const priceCount = await prisma.priceEntry.count({ where: { groceryItemId: id } });
    if (priceCount > 0) return reply.code(409).send({ error: "Item is used in price history. Mark inactive instead.", priceCount });
    return prisma.groceryItem.delete({ where: { id, userId } });
  });
}

