import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";

const storeSchema = z.object({
  name: z.string().min(1),
  storeType: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  membershipRequired: z.boolean().optional(),
  favorite: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export async function storeRoutes(app: FastifyInstance) {
  app.get("/stores", async (request) => {
    const userId = await getDefaultUserId();
    const query = request.query as { search?: string; favorite?: string };
    return prisma.store.findMany({
      where: {
        userId,
        isActive: true,
        ...(query.favorite ? { favorite: query.favorite === "true" } : {}),
        ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { storeType: { contains: query.search, mode: "insensitive" } }, { notes: { contains: query.search, mode: "insensitive" } }] } : {})
      },
      orderBy: [{ favorite: "desc" }, { name: "asc" }]
    });
  });

  app.post("/stores", async (request, reply) => {
    const userId = await getDefaultUserId();
    const data = storeSchema.parse(request.body);
    const store = await prisma.store.create({ data: { ...data, userId } });
    reply.code(201);
    return store;
  });

  app.patch("/stores/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const data = storeSchema.partial().parse(request.body);
    return prisma.store.update({ where: { id, userId }, data });
  });

  app.delete("/stores/:id", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const priceCount = await prisma.priceEntry.count({ where: { storeId: id } });
    if (priceCount > 0) return reply.code(409).send({ error: "Store is used in price history. Mark inactive instead.", priceCount });
    return prisma.store.delete({ where: { id, userId } });
  });
}

