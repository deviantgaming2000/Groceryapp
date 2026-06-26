import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { getProvider, providers as providerRegistry, GroceryProvider, NormalizedLocation, NormalizedProduct, ProviderError } from "../services/providers/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(["the", "and", "with", "for", "size", "each", "pack", "count", "value", "brand", "oz", "lb", "ct"]);
function tokenize(s: string): string[] {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
/** Pick the product whose title best overlaps the search term (must have a price). */
function pickBestProduct(term: string, products: NormalizedProduct[]): NormalizedProduct | null {
  const want = new Set(tokenize(term));
  if (!want.size) return null;
  let best: NormalizedProduct | null = null;
  let bestScore = 0;
  for (const p of products) {
    if (p.price == null) continue;
    const toks = tokenize(p.title);
    if (!toks.length) continue;
    const overlap = toks.filter((t) => want.has(t)).length / want.size;
    // Prefer better name overlap; break ties on lower price.
    if (overlap > bestScore || (overlap === bestScore && best && (p.price ?? Infinity) < (best.price ?? Infinity))) {
      bestScore = overlap;
      best = p;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Chain keys used to match a provider's stores to an existing local store row. */
function providerChainKeys(providerId: string): string[] {
  if (providerId === "kroger") return ["frys", "fry", "kroger"];
  if (providerId.startsWith("walmart")) return ["walmart"];
  return [];
}

const UNIT_TYPES = ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"] as const;
type UnitType = (typeof UNIT_TYPES)[number];

/** Best-effort parse of a provider size string ("1 gal", "12 oz") into quantity + unit. */
function parseSize(size?: string): { quantity: number; unit: UnitType } {
  if (!size) return { quantity: 1, unit: "each" };
  const s = size.toLowerCase();
  const num = parseFloat(s.replace(/[^0-9.]/g, " ").trim().split(/\s+/)[0]);
  const quantity = Number.isFinite(num) && num > 0 ? num : 1;
  let unit: UnitType = "each";
  if (/fl\.?\s*oz|fluid/.test(s)) unit = "fl_oz";
  else if (/\bgal|gallon/.test(s)) unit = "gallon";
  else if (/\bqt|quart/.test(s)) unit = "quart";
  else if (/\bpt|pint/.test(s)) unit = "pint";
  else if (/\boz|ounce/.test(s)) unit = "oz";
  else if (/\blb|pound/.test(s)) unit = "lb";
  else if (/\bpk|pack/.test(s)) unit = "pack";
  else if (/\bct|count|ea\b|each/.test(s)) unit = "count";
  return { quantity, unit };
}

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

/** Ensure a local Store row exists for a provider location; returns it.
 *  To avoid duplicate rows (e.g. a manual "Walmart" plus a provider "Walmart — …"),
 *  this reuses an existing store for the same chain and points it at the selected
 *  branch, rather than creating a parallel store. */
async function ensureLocalStore(userId: string, providerId: string, loc: NormalizedLocation) {
  // 1. Exact provider + branch match.
  const exact = await prisma.store.findFirst({
    where: { userId, provider: providerId, externalId: loc.externalId }
  });
  if (exact) return exact;

  // 2. Reuse an existing store for the same chain (matches manual or other-provider rows).
  const keys = providerChainKeys(providerId);
  if (keys.length) {
    const candidates = await prisma.store.findMany({ where: { userId } });
    const match = candidates.find((s) => {
      const st = norm(s.storeType);
      const nm = norm(s.name);
      return keys.some((k) => st === k || nm === k || st.includes(k) || nm.includes(k));
    });
    if (match) {
      // Keep this single store pointed at the currently-selected branch.
      if (match.provider !== providerId || match.externalId !== loc.externalId || !match.isActive) {
        return prisma.store.update({
          where: { id: match.id },
          data: { provider: providerId, externalId: loc.externalId, isActive: true }
        });
      }
      return match;
    }
  }

  // 3. No existing chain store — create a new one.
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

// Maps a provider to the UserSettings columns that hold its selected store.
function savedStoreColumns(providerId: string): { id: string; name: string } | null {
  if (providerId === "kroger") return { id: "krogerLocationId", name: "krogerLocationName" };
  // Both Walmart providers share the same physical stores, so they share the saved store.
  if (providerId === "walmart" || providerId === "walmart-scraper")
    return { id: "walmartStoreId", name: "walmartStoreName" };
  return null;
}

async function getSavedLocationId(userId: string, providerId: string): Promise<string | null> {
  const cols = savedStoreColumns(providerId);
  if (!cols) return null;
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  return ((settings as Record<string, any> | null)?.[cols.id] as string | undefined) ?? null;
}

export async function providerRoutes(app: FastifyInstance) {
  // Status: is the provider configured, and is a store selected?
  app.get("/:provider/status", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const userId = await getDefaultUserId();
    const settings = (await prisma.userSettings.findUnique({ where: { userId } })) as Record<string, any> | null;
    const cols = savedStoreColumns(provider.id);
    const selectedStore =
      cols && settings?.[cols.id] ? { locationId: settings[cols.id] as string, name: settings[cols.name] as string | null } : null;
    return {
      provider: provider.id,
      label: provider.label,
      hasStores: provider.hasStores,
      hasDirectory: provider.hasDirectory ?? false,
      configured: await provider.isConfigured(),
      selectedStore
    };
  });

  // Directory: list states that have stores (providers with a bundled directory).
  app.get("/:provider/states", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    if (!provider.listStates) return [];
    return guard(reply, () => provider.listStates!());
  });

  // Directory: list cities within a state.
  app.get("/:provider/cities", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const { state } = request.query as { state?: string };
    if (!provider.listCities || !state) return [];
    return guard(reply, () => provider.listCities!(state));
  });

  // Search store locations (ZIP / lat-lon / chain term / state+city directory browse).
  app.get("/:provider/locations", async (request, reply) => {
    const provider = resolveProvider(reply, (request.params as any).provider);
    if (!provider) return;
    const q = request.query as Record<string, string>;
    return guard(reply, () =>
      provider.searchLocations({
        zip: q.zip,
        term: q.term,
        state: q.state,
        city: q.city,
        q: q.q,
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
    const cols = savedStoreColumns(provider.id);
    if (cols) {
      await prisma.userSettings.update({
        where: { userId },
        data: {
          [cols.id]: loc.externalId,
          [cols.name]: [loc.name, loc.city].filter(Boolean).join(" — ")
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
    const locationId = q.locationId || await getSavedLocationId(userId, provider.id) || undefined;
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
    const locationId = q.locationId || await getSavedLocationId(userId, provider.id) || undefined;
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
      .object({
        productId: z.string().min(1),
        locationId: z.string().optional(),
        // Attach the price to an existing comparable item…
        groceryItemId: z.string().optional(),
        // …or create a new generic item to compare under.
        newItem: z
          .object({
            name: z.string().min(1),
            category: z.string().min(1),
            unitType: z.enum(UNIT_TYPES).optional()
          })
          .optional()
      })
      .parse(request.body);

    const locationId =
      body.locationId ||
      await getSavedLocationId(userId, provider.id) ||
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

    // Resolve the comparable item: link to an existing one, create a generic one,
    // or (legacy fallback) create one from the product itself.
    let item;
    if (body.groceryItemId) {
      item = await prisma.groceryItem.findFirst({ where: { id: body.groceryItemId, userId } });
      if (!item) return reply.code(404).send({ error: "Item not found.", code: "not_found" });
    } else if (body.newItem) {
      const sized = parseSize(product.size);
      item = await prisma.groceryItem.create({
        data: {
          userId,
          name: body.newItem.name,
          category: body.newItem.category,
          quantityNeeded: 1,
          unitType: body.newItem.unitType ?? sized.unit
        }
      });
    } else {
      item = await upsertItem(userId, product);
    }

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

  // Bulk: take a grocery list and look up each item's price at every configured
  // store, separating results per store. Rate-limited (capped calls + delay between
  // requests + per-run cache) to stay gentle on the upstream providers.
  app.post("/bulk-find-prices", async (request, reply) => {
    const userId = await getDefaultUserId();
    const { listId, providers: requested } = z
      .object({ listId: z.string().min(1), providers: z.array(z.string()).optional() })
      .parse(request.body);

    const list = await prisma.groceryList.findFirst({
      where: { id: listId, userId },
      include: { items: { include: { groceryItem: true } } }
    });
    if (!list) return reply.code(404).send({ error: "List not found.", code: "not_found" });
    if (!list.items.length) return reply.code(400).send({ error: "This list has no items.", code: "empty_list" });

    // Candidate providers: configured AND have a selected store.
    const ids = requested?.length ? requested : Object.keys(providerRegistry);
    let active: { id: string; provider: GroceryProvider; locationId: string }[] = [];
    for (const id of ids) {
      const provider = getProvider(id);
      if (!provider) continue;
      if (!(await provider.isConfigured())) continue;
      const locationId = (await getSavedLocationId(userId, id)) || provider.defaultLocationId?.();
      if (!locationId) continue;
      active.push({ id, provider, locationId });
    }
    // Collapse providers that resolve to the same physical store (e.g. both Walmart providers).
    const seen = new Set<string>();
    active = active.filter((e) => {
      const cols = savedStoreColumns(e.id);
      const key = `${cols?.id ?? e.id}|${e.locationId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!active.length) {
      return reply
        .code(400)
        .send({ error: "No stores are set up for live lookup. Pick a store per provider in Find Products first.", code: "no_providers" });
    }

    const MAX_CALLS = 80; // hard ceiling per run across all stores
    const DELAY_MS = 300; // pause between upstream calls
    let calls = 0;
    const summary: any[] = [];

    for (const entry of active) {
      const loc = await entry.provider.getLocation(entry.locationId).catch(() => null);
      if (!loc) {
        summary.push({ provider: entry.id, error: "Selected store not found." });
        continue;
      }
      const store = await ensureLocalStore(userId, entry.id, loc);
      const cache = new Map<string, NormalizedProduct[]>();
      const itemResults: any[] = [];

      for (const li of list.items) {
        const term = li.groceryItem.name;
        if (calls >= MAX_CALLS) {
          itemResults.push({ item: term, status: "skipped", reason: "call limit reached" });
          continue;
        }
        const cacheKey = term.toLowerCase();
        let products = cache.get(cacheKey);
        if (!products) {
          try {
            calls++;
            products = await entry.provider.searchProducts({ term, limit: 5, locationId: entry.locationId });
            cache.set(cacheKey, products);
            await sleep(DELAY_MS);
          } catch (e) {
            itemResults.push({ item: term, status: "error", reason: e instanceof ProviderError ? e.message : "search failed" });
            continue;
          }
        }
        const best = pickBestProduct(term, products);
        if (!best) {
          itemResults.push({ item: term, status: "not_found" });
          continue;
        }
        const price = await upsertPrice(userId, li.groceryItemId, store.id, best);
        itemResults.push({ item: term, status: "added", product: best.title, price: best.price, priceId: price.id });
      }

      summary.push({
        provider: entry.id,
        store: store.name,
        added: itemResults.filter((r) => r.status === "added").length,
        items: itemResults
      });
    }

    return { list: list.name, totalItems: list.items.length, apiCalls: calls, stores: summary };
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
  // On first import, derive package size from the product and keep the full
  // product description in notes so it stays visible on the price entry.
  const sized = parseSize(product.size);
  return prisma.priceEntry.create({
    data: {
      userId,
      groceryItemId,
      storeId,
      packageQuantity: sized.quantity,
      packageUnit: sized.unit,
      notes: [product.title, product.size].filter(Boolean).join(" · ") || null,
      ...data
    }
  });
}
