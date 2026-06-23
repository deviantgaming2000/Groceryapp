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

  app.delete("/items/:id", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const priceCount = await prisma.priceEntry.count({ where: { groceryItemId: id } });
    if (priceCount > 0) return reply.code(409).send({ error: "Item is used in price history. Mark inactive instead.", priceCount });
    return prisma.groceryItem.delete({ where: { id, userId } });
  });
}

