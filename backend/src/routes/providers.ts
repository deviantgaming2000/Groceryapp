import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { packagesNeeded } from "../services/units.js";
import { getProvider, providers as providerRegistry, GroceryProvider, NormalizedLocation, NormalizedProduct, ProviderError } from "../services/providers/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(["the", "and", "with", "for", "size", "each", "pack", "count", "value", "brand", "oz", "lb", "ct"]);
function tokenize(s: string): string[] {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
/**
 * A match must be able to actually satisfy what the list asks for. Name overlap
 * alone once matched a 10 lb need to a 1 lb package, which packagesNeeded()
 * then ceilinged to 10+ packages and reported as a ~$138 line for an $8.72 bag.
 * So a candidate is rejected when its package cannot serve the need at all
 * (incompatible units) or would need an implausible number of packages.
 */
const MAX_PACKAGES_PER_ITEM = 6;

function packageFits(product: NormalizedProduct, need: { quantity: number; unit: UnitType }): boolean {
  const pkg = derivePackage(product);
  const needed = packagesNeeded(need.quantity, need.unit, pkg.quantity, pkg.unit);
  return needed !== null && needed.packageCount <= MAX_PACKAGES_PER_ITEM;
}

/** Pick the product whose title best overlaps the search term (must have a price). */
export function pickBestProduct(
  term: string,
  products: NormalizedProduct[],
  need?: { quantity: number; unit: UnitType }
): NormalizedProduct | null {
  const want = new Set(tokenize(term));
  if (!want.size) return null;
  const candidates = need ? products.filter((p) => packageFits(p, need)) : products;
  let best: NormalizedProduct | null = null;
  let bestScore = 0;
  let bestExtra = Infinity;
  for (const p of candidates) {
    if (p.price == null) continue;
    const toks = tokenize(p.title);
    if (!toks.length) continue;
    const overlap = toks.filter((t) => want.has(t)).length / want.size;
    // Words in the title that the search term did not ask for. A plain
    // "Chicken Leg Quarters" should beat "Private Selection Classic Seasoned
    // Roasted Chicken Leg Quarters Cold", which scores the same on overlap
    // but is a different product entirely.
    const extra = toks.filter((t) => !want.has(t)).length;
    const better =
      overlap > bestScore ||
      (overlap === bestScore && extra < bestExtra) ||
      (overlap === bestScore && extra === bestExtra && best !== null && (p.price ?? Infinity) < (best.price ?? Infinity));
    if (better) {
      bestScore = overlap;
      bestExtra = extra;
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
  if (providerId === "safeway") return ["safeway", "albertsons"];
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
    // A provider that answers "no results" over and over is not finding nothing -
    // it is degraded (the Walmart scraper returns an empty 200 when it hits a bot
    // wall). Stop asking after this many in a row so the call budget is left for
    // providers that are actually working, and say so in the summary.
    const EMPTY_STREAK_LIMIT = 5;

    const job: BulkJob = {
      id: randomUUID(),
      status: "running",
      startedAt: new Date().toISOString(),
      list: list.name,
      totalItems: list.items.length,
      processed: 0,
      apiCalls: 0,
      stores: [],
      limitReached: false
    };
    rememberJob(job);

    // Run detached: the caller polls GET /bulk-find-prices/:jobId for progress.
    void (async () => {
      try {
        let calls = 0;
        for (const entry of active) {
          const loc = await entry.provider.getLocation(entry.locationId).catch(() => null);
          if (!loc) {
            job.stores.push({ provider: entry.id, error: "Selected store not found." });
            continue;
          }
          const store = await ensureLocalStore(userId, entry.id, loc);
          const cache = new Map<string, NormalizedProduct[]>();
          const itemResults: any[] = [];
          let emptyStreak = 0;
          let degraded: string | null = null;

          for (const li of list.items) {
            const term = li.groceryItem.name;
            if (degraded) {
              itemResults.push({ item: term, status: "skipped", reason: degraded });
              continue;
            }
            if (calls >= MAX_CALLS) {
              job.limitReached = true;
              itemResults.push({ item: term, status: "skipped", reason: "call limit reached" });
              continue;
            }
            const cacheKey = term.toLowerCase();
            let products = cache.get(cacheKey);
            if (!products) {
              try {
                calls++;
                job.apiCalls = calls;
                products = await entry.provider.searchProducts({ term, limit: 5, locationId: entry.locationId });
                cache.set(cacheKey, products);
                await sleep(DELAY_MS);
              } catch (e) {
                itemResults.push({ item: term, status: "error", reason: e instanceof ProviderError ? e.message : "search failed" });
                continue;
              } finally {
                job.processed++;
              }
              emptyStreak = products.length ? 0 : emptyStreak + 1;
              if (emptyStreak >= EMPTY_STREAK_LIMIT) {
                degraded = `${entry.id} returned no results ${emptyStreak} times in a row - it looks blocked or unavailable, so the rest were skipped.`;
                itemResults.push({ item: term, status: "skipped", reason: degraded });
                continue;
              }
            } else {
              job.processed++;
            }
            const localProducts = products.filter((p) => p.localInStock !== false);
            const best = pickBestProduct(term, localProducts, {
              quantity: Number(li.quantityNeeded),
              unit: li.unitType as UnitType
            });
            if (!best) {
              itemResults.push({ item: term, status: "not_found" });
              continue;
            }
            const price = await upsertPrice(userId, li.groceryItemId, store.id, best);
            itemResults.push({ item: term, status: "added", product: best.title, price: best.price, priceId: price.id });
          }

          job.stores.push({
            provider: entry.id,
            store: store.name,
            added: itemResults.filter((r) => r.status === "added").length,
            notFound: itemResults.filter((r) => r.status === "not_found").length,
            skipped: itemResults.filter((r) => r.status === "skipped").length,
            errors: itemResults.filter((r) => r.status === "error").length,
            degraded,
            items: itemResults
          });
        }
        job.status = "done";
      } catch (e) {
        job.status = "error";
        job.error = e instanceof Error ? e.message : "Bulk lookup failed";
        request.log.error(e);
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    })();

    return reply.code(202).send({ jobId: job.id, status: job.status, totalItems: job.totalItems, list: job.list });
  });

  // Poll a bulk run. Returns the same shape while running and when finished.
  app.get("/bulk-find-prices/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = bulkJobs.get(jobId);
    if (!job) return reply.code(404).send({ error: "That lookup is no longer available. Start a new one.", code: "not_found" });
    return job;
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

/** Derive the package size for a price entry. For weight items where the store gives
 *  a per-unit price, the true package weight is price ÷ unit price — accurate even when
 *  the size string is a range (e.g. "12.3 - 28 lb") so the $/lb matches the store. */
function derivePackage(product: NormalizedProduct): { quantity: number; unit: UnitType } {
  const sized = parseSize(product.size);
  const isWeight = sized.unit === "lb" || sized.unit === "oz";
  if (isWeight && product.unitPrice && product.unitPrice > 0 && product.price && product.price > 0) {
    const qty = product.price / product.unitPrice;
    if (Number.isFinite(qty) && qty > 0) return { quantity: Number(qty.toFixed(2)), unit: sized.unit };
  }
  return sized;
}


/**
 * Bulk lookups run for minutes (every list item, every store, paced to stay gentle
 * on the upstreams). Holding an HTTP request open that long is fragile - a proxy
 * timeout used to abandon the response while the run kept writing prices unseen.
 * So the POST starts a job and returns immediately; callers poll for progress.
 * In-memory is sufficient: this is a single-user app and an interrupted run is
 * meant to be re-run, not resumed.
 */
interface BulkJob {
  id: string;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  list: string;
  totalItems: number;
  processed: number;
  apiCalls: number;
  stores: any[];
  limitReached: boolean;
  error?: string;
}
const bulkJobs = new Map<string, BulkJob>();
const BULK_JOB_KEEP = 10;

function rememberJob(job: BulkJob) {
  bulkJobs.set(job.id, job);
  // Keep only the most recent handful so a long-lived process does not grow.
  const stale = [...bulkJobs.values()]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(0, Math.max(0, bulkJobs.size - BULK_JOB_KEEP));
  for (const s of stale) bulkJobs.delete(s.id);
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
  const sized = derivePackage(product);
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
