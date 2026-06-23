import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { getProvider, NormalizedLocation, NormalizedProduct, ProviderError } from "../services/providers/index.js";

function resolveProvider(reply: FastifyReply, providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) {
    reply.code(404).send({ error: `Unknown provider "${providerId}".` });
    return null;
  }
  return provider;
}

/** Runs a provider call and maps ProviderError to clean HTTP responses (never leaks secrets). */
async function guard<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProviderError) {
      reply.code(error.status).send({ error: error.message, code: error.code });
      return undefined;
    }
    reply.code(502).send({ error: "Unexpected error talking to the grocery provider.", code: "upstream" });
    return undefined;
  }
}

/** Ensure a local Store row exists for a provider location; returns it. */
async function ensureLocalStore(userId: string, providerId: string, loc: NormalizedLocation) {
  const existing = await prisma.store.findFirst({
    where: { userId, provider: providerId, externalId: loc.externalId }
  });
  if (existing) return existing;
  return prisma.store.create({
    data: {
      userId,
      provider: providerId,
      externalId: loc.externalId,
      name: loc.name || loc.chain || "Kroger store",
      storeType: loc.chain || "Kroger",
      address: loc.address || "",
      city: loc.city || "",
      state: loc.state || "",
      zip: loc.zip || "",
      phone: loc.phone ?? null,
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null
    }
  });
}

async function getSavedKrogerLocationId(userId: string): Promise<string | null> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  return settings?.krogerLocationId ?? null;
}

export async function providerRoutes(app: FastifyInstance) {
  // Status: is the provider configured, and is a store selected?
  app.get("/:provider/status", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    return {
      provider: provider.id,
      label: provider.label,
      hasStores: provider.hasStores,
      configured: await provider.isConfigured(),
      selectedStore:
        provider.id === "kroger" && settings?.krogerLocationId
          ? { locationId: settings.krogerLocationId, name: settings.krogerLocationName }
          : null
    };
  });

  // Search store locations (ZIP / lat-lon / chain term).
  app.get("/:provider/locations", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const q = request.query as Record<string, string>;
    return guard(reply, () =>
      provider.searchLocations({
        zip: q.zip,
        term: q.term,
        lat: q.lat ? Number(q.lat) : undefined,
        lon: q.lon ? Number(q.lon) : undefined,
        radiusInMiles: q.radius ? Number(q.radius) : undefined,
        limit: q.limit ? Number(q.limit) : undefined
      })
    );
  });

  // Select / save the active store for this provider.
  app.post("/:provider/store", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const { locationId } = z.object({ locationId: z.string().min(1) }).parse(request.body);
    const loc = await guard(reply, () => provider.getLocation(locationId));
    if (loc === undefined) return; // error already sent
    if (!loc) return reply.code(404).send({ error: "Store location not found.", code: "not_found" });

    const store = await ensureLocalStore(userId, provider.id, loc);
    if (provider.id === "kroger") {
      await prisma.userSettings.update({
        where: { userId },
        data: {
          krogerLocationId: loc.externalId,
          krogerLocationName: [loc.name, loc.city].filter(Boolean).join(" — ")
        }
      });
    }
    return { location: loc, store };
  });

  // Product search (normalized). Falls back to the saved store when locationId is omitted.
  app.get("/:provider/products/search", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const q = request.query as Record<string, string>;
    const locationId = q.locationId || (provider.id === "kroger" ? await getSavedKrogerLocationId(userId) : null) || undefined;
    return guard(reply, () =>
      provider.searchProducts({
        term: q.term ?? "",
        brand: q.brand,
        locationId,
        limit: q.limit ? Number(q.limit) : undefined,
        start: q.start ? Number(q.start) : undefined
      })
    );
  });

  // Single product details (normalized).
  app.get("/:provider/products/:productId", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const { productId } = request.params as { productId: string };
    const q = request.query as Record<string, string>;
    const locationId = q.locationId || (provider.id === "kroger" ? await getSavedKrogerLocationId(userId) : null) || undefined;
    const product = await guard(reply, () => provider.getProduct(productId, locationId));
    if (product === undefined) return;
    if (!product) return reply.code(404).send({ error: "Product not found.", code: "not_found" });
    return product;
  });

  // Import a product into the app's catalog (GroceryItem) + a PriceEntry at the store.
  app.post("/:provider/import", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const body = z
      .object({ productId: z.string().min(1), locationId: z.string().optional() })
      .parse(request.body);

    const locationId =
      body.locationId ||
      (provider.id === "kroger" ? await getSavedKrogerLocationId(userId) : null) ||
      provider.defaultLocationId?.();
    if (!locationId) {
      return reply.code(400).send({ error: "No store selected. Choose a store first.", code: "no_store" });
    }

    const loc = await guard(reply, () => provider.getLocation(locationId));
    if (loc === undefined) return;
    if (!loc) return reply.code(404).send({ error: "Store location not found.", code: "not_found" });
    const store = await ensureLocalStore(userId, provider.id, loc);

    const product = await guard(reply, () => provider.getProduct(body.productId, locationId));
    if (product === undefined) return;
    if (!product) return reply.code(404).send({ error: "Product not found.", code: "not_found" });

    const item = await upsertItem(userId, product);
    const price = await upsertPrice(userId, item.id, store.id, product);
    reply.code(201);
    return { item, price, store };
  });

  // Refresh price + availability for a linked PriceEntry.
  app.post("/:provider/prices/:priceId/refresh", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const { priceId } = request.params as { priceId: string };
    const entry = await prisma.priceEntry.findFirst({ where: { id: priceId, userId }, include: { store: true } });
    if (!entry) return reply.code(404).send({ error: "Price entry not found.", code: "not_found" });
    if (!entry.externalProductId || !entry.store.externalId) {
      return reply.code(400).send({ error: "This price is not linked to a provider product.", code: "not_linked" });
    }

    const product = await guard(reply, () => provider.getProduct(entry.externalProductId!, entry.store.externalId!));
    if (product === undefined) return;
    if (!product) return reply.code(404).send({ error: "Product no longer found at the store.", code: "not_found" });

    return upsertPrice(userId, entry.groceryItemId, entry.storeId, product, entry.id);
  });
}

async function upsertItem(userId: string, product: NormalizedProduct) {
  const existing = await prisma.groceryItem.findFirst({
    where: { userId, source: product.source, externalProductId: product.externalProductId }
  });
  const data = {
    name: product.title,
    category: product.category || "Imported",
    preferredBrand: product.brand ?? null,
    upc: product.externalProductId,
    source: product.source,
    externalProductId: product.externalProductId,
    imageUrl: product.imageUrl ?? null,
    productUrl: product.productUrl ?? null
  };
  if (existing) {
    return prisma.groceryItem.update({ where: { id: existing.id }, data });
  }
  return prisma.groceryItem.create({
    data: { userId, quantityNeeded: 1, unitType: "each", ...data }
  });
}

async function upsertPrice(
  userId: string,
  groceryItemId: string,
  storeId: string,
  product: NormalizedProduct,
  priceEntryId?: string
) {
  const data = {
    price: product.price ?? 0,
    brand: product.brand ?? null,
    source: product.source,
    externalProductId: product.externalProductId,
    regularPrice: product.regularPrice ?? null,
    promoPrice: product.promoPrice ?? null,
    imageUrl: product.imageUrl ?? null,
    productUrl: product.productUrl ?? null,
    available: product.available,
    couponEligible: product.couponEligible,
    couponData: (product.couponData ?? undefined) as any,
    rawApiData: (product.raw ?? undefined) as any,
    salePrice: product.promoPrice != null,
    lastSyncedAt: new Date(),
    recordedAt: new Date(),
    confidence: "confirmed" as const
  };

  const existing =
    (priceEntryId && (await prisma.priceEntry.findUnique({ where: { id: priceEntryId } }))) ||
    (await prisma.priceEntry.findFirst({
      where: { userId, groceryItemId, storeId, source: product.source, externalProductId: product.externalProductId }
    }));

  if (existing) {
    return prisma.priceEntry.update({ where: { id: existing.id }, data });
  }
  return prisma.priceEntry.create({
    data: { userId, groceryItemId, storeId, packageQuantity: 1, packageUnit: "each", ...data }
  });
}
