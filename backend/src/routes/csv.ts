import { FastifyInstance } from "fastify";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { parseCsv, toCsv } from "../services/csv.js";

export async function csvRoutes(app: FastifyInstance) {
  app.get("/export/items.csv", async (_, reply) => {
    const userId = await getDefaultUserId();
    const rows = await prisma.groceryItem.findMany({ where: { userId }, orderBy: { name: "asc" } });
    reply.header("content-type", "text/csv");
    return toCsv(rows.map((row) => ({ name: row.name, category: row.category, quantityNeeded: row.quantityNeeded, unitType: row.unitType, preferredBrand: row.preferredBrand ?? "", upc: row.upc ?? "", notes: row.notes ?? "" })));
  });

  app.get("/export/stores.csv", async (_, reply) => {
    const userId = await getDefaultUserId();
    const rows = await prisma.store.findMany({ where: { userId }, orderBy: { name: "asc" } });
    reply.header("content-type", "text/csv");
    return toCsv(rows.map((row) => ({ name: row.name, storeType: row.storeType, address: row.address, city: row.city, state: row.state, zip: row.zip, membershipRequired: row.membershipRequired, favorite: row.favorite, notes: row.notes ?? "" })));
  });

  app.get("/export/prices.csv", async (_, reply) => {
    const userId = await getDefaultUserId();
    const rows = await prisma.priceEntry.findMany({ where: { userId }, include: { groceryItem: true, store: true }, orderBy: { recordedAt: "desc" } });
    reply.header("content-type", "text/csv");
    return toCsv(rows.map((row) => ({ itemName: row.groceryItem.name, storeName: row.store.name, price: row.price, packageQuantity: row.packageQuantity, packageUnit: row.packageUnit, brand: row.brand ?? "", recordedAt: row.recordedAt.toISOString(), confidence: row.confidence, notes: row.notes ?? "" })));
  });

  app.post("/import/items", async (request) => {
    const userId = await getDefaultUserId();
    const rows = parseCsv(String(request.body ?? ""));
    const created = [];
    for (const row of rows) {
      created.push(await prisma.groceryItem.create({ data: { userId, name: row.name, category: row.category || "Uncategorized", quantityNeeded: Number(row.quantityNeeded || 1), unitType: (row.unitType || "each") as any, preferredBrand: row.preferredBrand || null, upc: row.upc || null, notes: row.notes || null } }));
    }
    return { created: created.length };
  });

  app.post("/import/prices", async (request) => {
    const userId = await getDefaultUserId();
    const rows = parseCsv(String(request.body ?? ""));
    let created = 0;
    for (const row of rows) {
      const item = await prisma.groceryItem.findFirst({ where: { userId, name: row.itemName } });
      const store = await prisma.store.findFirst({ where: { userId, name: row.storeName } });
      if (!item || !store) continue;
      await prisma.priceEntry.create({ data: { userId, groceryItemId: item.id, storeId: store.id, price: Number(row.price), packageQuantity: Number(row.packageQuantity || 1), packageUnit: (row.packageUnit || "each") as any, brand: row.brand || null, recordedAt: row.recordedAt ? new Date(row.recordedAt) : new Date(), confidence: (row.confidence || "confirmed") as any, notes: row.notes || null } });
      created += 1;
    }
    return { created, skipped: rows.length - created };
  });
}

