import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { unitPrice } from "../services/units.js";

const priceSchema = z.object({
  groceryItemId: z.string(),
  storeId: z.string(),
  price: z.coerce.number().nonnegative(),
  packageQuantity: z.coerce.number().positive(),
  packageUnit: z.enum(["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"]),
  brand: z.string().optional().nullable(),
  salePrice: z.boolean().optional(),
  couponApplied: z.boolean().optional(),
  couponDetails: z.string().optional().nullable(),
  taxApplicable: z.boolean().optional(),
  recordedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  confidence: z.enum(["confirmed", "estimated", "old", "unknown"]).optional(),
  isActive: z.boolean().optional()
});

export async function priceRoutes(app: FastifyInstance) {
  app.get("/prices", async (request) => {
    const userId = await getDefaultUserId();
    const query = request.query as { storeId?: string; groceryItemId?: string; stale?: string };
    return prisma.priceEntry.findMany({
      where: { userId, isActive: true, ...(query.storeId ? { storeId: query.storeId } : {}), ...(query.groceryItemId ? { groceryItemId: query.groceryItemId } : {}) },
      include: { store: true, groceryItem: true },
      orderBy: { recordedAt: "desc" }
    });
  });

  app.post("/prices", async (request, reply) => {
    const userId = await getDefaultUserId();
    const data = priceSchema.parse(request.body);
    unitPrice(data.price, data.packageQuantity, data.packageUnit);
    const price = await prisma.priceEntry.create({ data: { ...data, userId } });
    reply.code(201);
    return price;
  });

  app.patch("/prices/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const data = priceSchema.partial().parse(request.body);
    const existing = await prisma.priceEntry.findUniqueOrThrow({ where: { id, userId } });
    unitPrice(
      data.price ?? existing.price.toNumber(),
      data.packageQuantity ?? existing.packageQuantity.toNumber(),
      data.packageUnit ?? existing.packageUnit
    );
    return prisma.priceEntry.update({ where: { id, userId }, data });
  });

  app.delete("/prices/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    return prisma.priceEntry.update({ where: { id, userId }, data: { isActive: false } });
  });
}
