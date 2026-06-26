import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import {
  DealsSearchParams,
  ProviderError,
  dealsProviders,
  getDealsProvider,
  matchDealsToGroceryList,
  NormalizedDeal
} from "../services/deals/index.js";
import { fetchFlyers, fetchFlyerItems } from "../services/deals/flipp.js";
import { isVisionConfigured, readDealFromImage } from "../services/vision.js";

async function guard<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProviderError) {
      reply.code(error.status).send({ error: error.message, code: error.code });
      return undefined;
    }
    reply.code(502).send({ error: "Unexpected error finding deals.", code: "upstream" });
    return undefined;
  }
}

// Fill in ZIP / Kroger store from saved settings when the caller omits them.
async function withDefaults(userId: string, q: Record<string, string>, providerId: string): Promise<DealsSearchParams> {
  const settings = (await prisma.userSettings.findUnique({ where: { userId } })) as Record<string, any> | null;
  return {
    query: q.q || q.query,
    zip: q.zip || settings?.homeZip || undefined,
    storeId: q.storeId || (providerId === "kroger" ? settings?.krogerLocationId ?? undefined : undefined),
    location: q.location || settings?.homeCity || undefined,
    userId,
    limit: q.limit ? Number(q.limit) : undefined
  };
}

export async function dealRoutes(app: FastifyInstance) {
  // List providers with availability — drives the source picker.
  app.get("/deals/providers", async () => {
    const out = [];
    for (const p of Object.values(dealsProviders)) {
      out.push({ id: p.id, label: p.label, needsConfig: p.needsConfig, configured: await p.isConfigured() });
    }
    return out;
  });

  // searchGroceryDeals({ source, query, zip, storeId }) → NormalizedDeal[]
  app.get("/deals/search", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const provider = getDealsProvider(q.source || "flipp");
    if (!provider) return reply.code(404).send({ error: `Unknown deal source "${q.source}".` });
    const userId = await getDefaultUserId();
    const params = await withDefaults(userId, q, provider.id);
    return guard(reply, () => provider.searchDeals(params));
  });

  // getWeeklyAds({ source, zip }) → NormalizedDeal[]
  app.get("/deals/weekly-ad", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const provider = getDealsProvider(q.source || "flipp");
    if (!provider) return reply.code(404).send({ error: `Unknown deal source "${q.source}".` });
    const userId = await getDefaultUserId();
    const params = await withDefaults(userId, q, provider.id);
    const fn = provider.getWeeklyAd ?? provider.searchDeals;
    return guard(reply, () => fn.call(provider, params));
  });

  // Coupons (defaults to the user's own coupons via the manual provider).
  app.get("/deals/coupons", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const provider = getDealsProvider(q.source || "manual");
    if (!provider) return reply.code(404).send({ error: `Unknown deal source "${q.source}".` });
    const userId = await getDefaultUserId();
    const params = await withDefaults(userId, q, provider.id);
    const fn = provider.getCoupons ?? provider.searchDeals;
    return guard(reply, () => fn.call(provider, params));
  });

  // List the full weekly-ad flyers for a postal code (Flipp).
  app.get("/deals/flyers", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const userId = await getDefaultUserId();
    const settings = (await prisma.userSettings.findUnique({ where: { userId } })) as Record<string, any> | null;
    const zip = q.zip || settings?.homeZip;
    if (!zip) return reply.code(400).send({ error: "Enter a ZIP code to load flyers.", code: "bad_request" });
    return guard(reply, () => fetchFlyers(zip));
  });

  // Every item in one flyer — the full ad (richer than keyword search).
  // Merges any cached vision reads (still within their sale window) so previously
  // read image-only items show their price instantly without re-OCR.
  app.get("/deals/flyers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as Record<string, string>;
    const userId = await getDefaultUserId();
    const settings = (await prisma.userSettings.findUnique({ where: { userId } })) as Record<string, any> | null;
    const zip = q.zip || settings?.homeZip;
    if (!zip) return reply.code(400).send({ error: "Enter a ZIP code to load this flyer.", code: "bad_request" });

    const items = await guard(reply, () => fetchFlyerItems(id, zip, q.merchant));
    if (items === undefined) return; // error already sent

    const now = new Date();
    // Drop reads whose sale has ended (forces a fresh read on next week's flyer).
    await prisma.flyerItemRead.deleteMany({ where: { userId, validTo: { lt: now } } });
    const urls = items.map((i) => i.imageUrl).filter(Boolean) as string[];
    if (urls.length) {
      const cached = await prisma.flyerItemRead.findMany({ where: { userId, cacheKey: { in: urls } } });
      const byUrl = new Map(cached.map((c) => [c.cacheKey, c]));
      for (const it of items) {
        if (it.salePrice == null && it.imageUrl && byUrl.has(it.imageUrl)) {
          const c = byUrl.get(it.imageUrl)!;
          if (c.price != null) it.salePrice = Number(c.price);
          if (c.dealText) it.dealText = c.dealText;
        }
      }
    }
    return items;
  });

  // Whether the local vision OCR (Ollama) is configured — drives the "Read price" button.
  app.get("/deals/vision-status", async () => {
    return { configured: await isVisionConfigured() };
  });

  // Read a price/deal off a flyer clipping image using the local vision model,
  // and cache the result until the sale's end (validTo) so it isn't re-read.
  app.post("/deals/read-image", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { imageUrl, productName, validTo } = z
      .object({ imageUrl: z.string().url(), productName: z.string().optional(), validTo: z.string().optional().nullable() })
      .parse(request.body);
    const result = await guard(reply, () => readDealFromImage(imageUrl, productName));
    if (result === undefined) return; // error already sent
    const validToDate = validTo ? new Date(validTo) : null;
    await prisma.flyerItemRead.upsert({
      where: { userId_cacheKey: { userId, cacheKey: imageUrl } },
      create: { userId, cacheKey: imageUrl, price: result.price ?? null, dealText: result.dealText ?? null, validTo: validToDate },
      update: { price: result.price ?? null, dealText: result.dealText ?? null, validTo: validToDate, readAt: new Date() }
    });
    return result;
  });

  // matchDealsToGroceryList({ deals }) → deals annotated with matchedItemIds
  app.post("/deals/match-list", async (request, reply) => {
    const userId = await getDefaultUserId();
    const body = z.object({ deals: z.array(z.any()) }).parse(request.body);
    const items = await prisma.groceryItem.findMany({ where: { userId, isActive: true }, select: { id: true, name: true } });
    return matchDealsToGroceryList({ deals: body.deals as NormalizedDeal[], groceryItems: items });
  });

  // save-coupon: convert a NormalizedDeal into a Coupon row, auto-matching store/item.
  app.post("/deals/save-coupon", async (request, reply) => {
    const userId = await getDefaultUserId();
    const dealSchema = z.object({
      source: z.string(),
      storeName: z.string().optional().nullable(),
      productName: z.string(),
      brand: z.string().optional().nullable(),
      salePrice: z.number().nullable(),
      regularPrice: z.number().nullable(),
      discountAmount: z.number().nullable(),
      digitalCoupon: z.boolean(),
      loyaltyRequired: z.boolean(),
      description: z.string().optional().nullable(),
      validTo: z.string().optional().nullable(),
    });
    const deal = dealSchema.parse(request.body);

    // Try to match a store by name
    let storeId: string | null = null;
    if (deal.storeName) {
      const store = await prisma.store.findFirst({
        where: { userId, isActive: true, name: { contains: deal.storeName.split(" ")[0], mode: "insensitive" } }
      });
      storeId = store?.id ?? null;
    }

    // Try to match an item by first word of product name
    let groceryItemId: string | null = null;
    const firstWord = deal.productName.split(" ").find(w => w.length > 3) ?? deal.productName.split(" ")[0];
    const item = await prisma.groceryItem.findFirst({
      where: { userId, isActive: true, name: { contains: firstWord, mode: "insensitive" } }
    });
    groceryItemId = item?.id ?? null;

    // Determine coupon type from description/story
    const story = (deal.description ?? "").toLowerCase();
    let couponType: string = "dollar_off";
    if (deal.digitalCoupon) couponType = "digital_coupon";
    if (/buy\s+\d+\s+get\s+\d+/i.test(story)) couponType = "buy_x_get_y_free";
    else if (/\d+%\s*off/i.test(story)) couponType = "percent_off";

    const amountOff = deal.discountAmount ??
      (deal.regularPrice != null && deal.salePrice != null && deal.regularPrice > deal.salePrice
        ? Number((deal.regularPrice - deal.salePrice).toFixed(2))
        : null);
    const percentOff = couponType === "percent_off"
      ? Number((/(\d+)%/.exec(story)?.[1] ?? "0"))
      : null;

    const coupon = await prisma.coupon.create({
      data: {
        userId,
        storeId,
        groceryItemId,
        name: [deal.brand, deal.productName].filter(Boolean).join(" "),
        couponType: couponType as any,
        scope: groceryItemId ? "item" : storeId ? "store" : "order_total",
        amountOff: couponType !== "percent_off" ? amountOff : null,
        percentOff,
        description: deal.description ?? null,
        expiresAt: deal.validTo ? new Date(deal.validTo) : null,
        isActive: true,
        notes: `Imported from ${deal.source}`,
      }
    });

    reply.code(201);
    return { coupon, storeMatched: !!storeId, itemMatched: !!groceryItemId };
  });
}
