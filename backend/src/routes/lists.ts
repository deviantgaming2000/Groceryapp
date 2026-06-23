import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";

const listSchema = z.object({ name: z.string().min(1), notes: z.string().optional().nullable(), isActive: z.boolean().optional() });
const listItemSchema = z.object({
  groceryItemId: z.string(),
  quantityNeeded: z.coerce.number().positive(),
  unitType: z.enum(["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"]),
  checkedOff: z.boolean().optional(),
  notes: z.string().optional().nullable()
});

export async function listRoutes(app: FastifyInstance) {
  app.get("/lists", async () => {
    const userId = await getDefaultUserId();
    return prisma.groceryList.findMany({ where: { userId }, include: { items: { include: { groceryItem: true } } }, orderBy: { updatedAt: "desc" } });
  });

  app.get("/lists/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    return prisma.groceryList.findUniqueOrThrow({ where: { id, userId }, include: { items: { include: { groceryItem: true } } } });
  });

  app.post("/lists", async (request, reply) => {
    const userId = await getDefaultUserId();
    const data = listSchema.parse(request.body);
    const list = await prisma.groceryList.create({ data: { ...data, userId } });
    reply.code(201);
    return list;
  });

  app.post("/lists/:id/duplicate", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const source = await prisma.groceryList.findUniqueOrThrow({ where: { id, userId }, include: { items: true } });
    const copy = await prisma.groceryList.create({
      data: {
        userId,
        name: `${source.name} copy`,
        notes: source.notes,
        items: { create: source.items.map((item) => ({ groceryItemId: item.groceryItemId, quantityNeeded: item.quantityNeeded, unitType: item.unitType, notes: item.notes })) }
      },
      include: { items: true }
    });
    reply.code(201);
    return copy;
  });

  app.patch("/lists/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const data = listSchema.partial().parse(request.body);
    return prisma.groceryList.update({ where: { id, userId }, data });
  });

  app.delete("/lists/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    return prisma.groceryList.delete({ where: { id, userId } });
  });

  app.post("/lists/:id/items", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = listItemSchema.parse(request.body);
    const item = await prisma.groceryListItem.create({ data: { ...data, groceryListId: id } });
    reply.code(201);
    return item;
  });

  app.patch("/lists/:listId/items/:id", async (request) => {
    const { id } = request.params as { id: string; listId: string };
    const data = listItemSchema.partial().parse(request.body);
    return prisma.groceryListItem.update({ where: { id }, data });
  });

  app.delete("/lists/:listId/items/:id", async (request) => {
    const { id } = request.params as { id: string; listId: string };
    return prisma.groceryListItem.delete({ where: { id } });
  });
}

