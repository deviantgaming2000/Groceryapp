import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";

const couponSchema = z.object({
  storeId: z.string().optional().nullable(),
  groceryItemId: z.string().optional().nullable(),
  groceryListId: z.string().optional().nullable(),
  name: z.string().min(1),
  couponType: z.enum(["dollar_off", "percent_off", "bogo", "buy_x_get_y_free", "buy_x_save_z", "membership_discount", "digital_coupon"]),
  scope: z.enum(["item", "store", "grocery_list", "order_total"]),
  amountOff: z.coerce.number().nonnegative().optional().nullable(),
  percentOff: z.coerce.number().min(0).max(100).optional().nullable(),
  buyQuantity: z.coerce.number().int().positive().optional().nullable(),
  freeQuantity: z.coerce.number().int().positive().optional().nullable(),
  limitPerTransaction: z.coerce.number().int().positive().optional().nullable(),
  description: z.string().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  allowExpired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable()
});

export async function couponRoutes(app: FastifyInstance) {
  app.get("/coupons", async () => {
    const userId = await getDefaultUserId();
    return prisma.coupon.findMany({ where: { userId }, include: { store: true, groceryItem: true, groceryList: true }, orderBy: { updatedAt: "desc" } });
  });

  app.post("/coupons", async (request, reply) => {
    const userId = await getDefaultUserId();
    const data = couponSchema.parse(request.body);
    const coupon = await prisma.coupon.create({ data: { ...data, userId } });
    reply.code(201);
    return coupon;
  });

  app.patch("/coupons/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    const data = couponSchema.partial().parse(request.body);
    return prisma.coupon.update({ where: { id, userId }, data });
  });

  app.delete("/coupons/:id", async (request) => {
    const userId = await getDefaultUserId();
    const { id } = request.params as { id: string };
    return prisma.coupon.update({ where: { id, userId }, data: { isActive: false } });
  });
}
