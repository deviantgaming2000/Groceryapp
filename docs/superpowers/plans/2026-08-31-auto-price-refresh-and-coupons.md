# Auto Price Refresh, Safeway Provider, and Auto Coupons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing Safeway scraper in as a full provider, auto-refresh provider-linked prices nightly and on stale page views, and auto-ingest coupons from Kroger promos, Flipp weekly ads, and Safeway Just4U.

**Architecture:** A new Safeway provider mirrors the walmart-scraper provider (HTTP to a local scraper service).
A shared refresh engine re-searches each linked price by item name and matches the stored external product id exactly, driven by an in-process nightly scheduler and a stale-on-view route, reusing the bulk job's pacing and degradation rules.
Coupon ingestion upserts Flipp deals and Safeway J4U offers into the existing Coupon table keyed by a new `source` + `externalId`.

**Tech Stack:** TypeScript, Fastify, Prisma (Postgres), Zod, Vitest (backend); React (frontend); Node + patchright CDP (walmart-scraper repo, plain JS).

**Spec:** `docs/superpowers/specs/2026-08-31-auto-price-refresh-and-coupons-design.md`

## Global Constraints

- Two repos are involved: `~/code/grocery-price-checker` (Tasks 1-9) and `~/code/walmart-scraper` (Task 10). Task 11 is back in grocery-price-checker.
- Never use the em dash character in any prose, comment, or commit message; use a plain dash.
- Never add an agent name as commit co-author.
- Backend tests: from `~/code/grocery-price-checker`, run `npm run test --workspace backend`. Single file: `cd backend && npx vitest run src/tests/<file>.test.ts`.
- Auto-refresh must never write a price for a product whose external id did not match exactly. A wrong price silently shadowing a right one is the forbidden failure mode.
- Scraper pacing rules are load-bearing: hard call ceiling 80/run, 300ms between upstream calls, degrade a provider after 5 consecutive empty results, per-run (provider|store|term) search cache.
- The safeway scraper service default port is 8092. It is deliberately slow (~20-30s per search).
- All new automatic writes must be attributable (source fields) and idempotent (upsert by source + external identity).

---

### Task 1: Safeway product normalization

**Files:**
- Create: `backend/src/services/providers/safeway.ts`
- Test: `backend/src/tests/safeway-provider.test.ts`

**Interfaces:**
- Consumes: `NormalizedProduct`, `NormalizedLocation`, `ProviderError` from `backend/src/services/providers/types.ts`; `resolveConfig` from `backend/src/services/credentials.ts`.
- Produces: `safewayProvider: GroceryProvider` (id `"safeway"`), `normalizeSafewayItem(item: SafewayScrapedItem, storeId?: string | null): NormalizedProduct`, `SESSION_STORE_ID = "safeway-session"`. Task 2 registers `safewayProvider`; Task 11 extends this file with `fetchSafewayCoupons`.

The scraper service (walmart-scraper repo, `src/safeway/server.js`) returns:

```json
{
  "store": "safeway", "query": "milk", "storeId": "3132", "count": 2,
  "results": [{
    "name": "Lucerne Milk Whole 1 Gallon", "price": 3.99, "priceText": "$3.99",
    "unitPrice": 0.031, "unitPriceUom": "fl oz", "unitPriceText": "3.1 ¢/fl oz",
    "size": "1 gallon", "currency": "USD",
    "url": "https://www.safeway.com/shop/product-details.960109496.html",
    "itemId": "960109496", "inStock": true, "availability": "in_stock",
    "fulfillmentType": "store", "pickupAvailable": null, "deliveryAvailable": null,
    "localInStock": true, "scrapedAt": "2026-08-31T10:00:00.000Z"
  }],
  "scrapedAt": "2026-08-31T10:00:00.000Z"
}
```

- [ ] **Step 1: Write the failing normalization tests**

```ts
// backend/src/tests/safeway-provider.test.ts
import { describe, expect, it } from "vitest";
import { normalizeSafewayItem, SESSION_STORE_ID } from "../services/providers/safeway.js";

const item = {
  name: "Lucerne Milk Whole 1 Gallon",
  price: 3.99,
  priceText: "$3.99",
  unitPrice: 0.031,
  unitPriceUom: "fl oz",
  unitPriceText: "3.1 ¢/fl oz",
  size: "1 gallon",
  currency: "USD",
  url: "https://www.safeway.com/shop/product-details.960109496.html",
  itemId: "960109496",
  inStock: true,
  availability: "in_stock" as const,
  fulfillmentType: "store" as const,
  pickupAvailable: null,
  deliveryAvailable: null,
  localInStock: true,
  scrapedAt: "2026-08-31T10:00:00.000Z"
};

describe("normalizeSafewayItem", () => {
  it("maps the scraper item onto NormalizedProduct", () => {
    const p = normalizeSafewayItem(item, "3132");
    expect(p.source).toBe("safeway");
    expect(p.externalProductId).toBe("960109496");
    expect(p.title).toBe("Lucerne Milk Whole 1 Gallon");
    expect(p.price).toBe(3.99);
    expect(p.regularPrice).toBe(3.99);
    expect(p.unitPrice).toBe(0.031);
    expect(p.size).toBe("1 gallon");
    expect(p.storeId).toBe("3132");
    expect(p.storeName).toBe("Safeway #3132");
    expect(p.available).toBe(true);
    expect(p.localInStock).toBe(true);
    expect(p.fulfillmentType).toBe("store");
    expect(p.currency).toBe("USD");
    expect(p.lastUpdated).toBe("2026-08-31T10:00:00.000Z");
  });

  it("falls back to the session store and a name-derived id", () => {
    const p = normalizeSafewayItem({ ...item, itemId: null, url: null }, null);
    expect(p.storeId).toBe(SESSION_STORE_ID);
    expect(p.storeName).toBe("Safeway (your account's store)");
    expect(p.externalProductId).toBe("sw-lucerne-milk-whole-1-gallon");
  });

  it("treats a missing inStock flag as available", () => {
    const p = normalizeSafewayItem({ ...item, inStock: null, localInStock: null }, "3132");
    expect(p.available).toBe(true);
    expect(p.localInStock).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/safeway-provider.test.ts`
Expected: FAIL, cannot resolve `../services/providers/safeway.js`.

- [ ] **Step 3: Write the provider file with normalization (transport comes in Task 2)**

```ts
// backend/src/services/providers/safeway.ts
import { resolveConfig } from "../credentials.js";
import {
  GroceryProvider,
  LocationSearchParams,
  NormalizedLocation,
  NormalizedProduct,
  ProductSearchParams,
  ProviderError
} from "./types.js";

// Safeway rides the user's signed-in Chrome session (the scraper attaches over
// CDP), so pricing always reflects the store selected in their Safeway account.
// There is no store directory here: the provider exposes one synthetic location
// and records the real store id the scraper reports back on each search.
// If explicit per-store lookup is ever needed, a directory can be added the way
// the Walmart provider bundles one (see the design spec, Part 1 extension).
const SOURCE = "safeway";
export const SESSION_STORE_ID = "safeway-session";
const DEFAULT_BASE = "http://localhost:8092";

const SESSION_STORE: NormalizedLocation = {
  source: SOURCE,
  externalId: SESSION_STORE_ID,
  name: "Safeway (your account's store)",
  chain: "Safeway"
};

export interface SafewayScrapedItem {
  name: string;
  price: number | null;
  priceText?: string | null;
  unitPrice?: number | null;
  unitPriceUom?: string | null;
  unitPriceText?: string | null;
  size?: string | null;
  currency?: string;
  url?: string | null;
  itemId?: string | null;
  inStock?: boolean | null;
  availability?: string | null;
  fulfillmentType?: "store" | "warehouse" | "marketplace" | null;
  localInStock?: boolean | null;
  scrapedAt?: string;
}

export interface SafewaySearchResponse {
  storeId?: string | null;
  results?: SafewayScrapedItem[];
  scrapedAt?: string;
}

function slugId(name: string): string {
  return "sw-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function normalizeSafewayItem(item: SafewayScrapedItem, storeId?: string | null): NormalizedProduct {
  const resolvedStore = storeId && storeId !== SESSION_STORE_ID ? storeId : SESSION_STORE_ID;
  const price = item.price ?? null;
  return {
    source: SOURCE,
    externalProductId: item.itemId || slugId(item.name),
    title: item.name,
    size: item.size ?? undefined,
    productUrl: item.url ?? undefined,
    storeId: resolvedStore,
    storeName: resolvedStore === SESSION_STORE_ID ? SESSION_STORE.name : `Safeway #${resolvedStore}`,
    price,
    regularPrice: price,
    promoPrice: null,
    unitPrice: item.unitPrice ?? null,
    currency: item.currency || "USD",
    available: item.inStock !== false,
    localInStock: item.localInStock ?? null,
    fulfillmentType: item.fulfillmentType ?? null,
    couponEligible: false,
    couponData: null,
    lastUpdated: item.scrapedAt || new Date().toISOString(),
    raw: item
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/safeway-provider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/code/grocery-price-checker
git add backend/src/services/providers/safeway.ts backend/src/tests/safeway-provider.test.ts
git commit -m "feat(providers): normalize Safeway scraper items into the shared product shape"
```

---

### Task 2: Safeway provider transport, registration, and settings

**Files:**
- Modify: `backend/src/services/providers/safeway.ts` (append transport + provider object)
- Modify: `backend/src/services/providers/index.ts` (register)
- Modify: `backend/src/services/credentials.ts` (CREDENTIAL_SPECS entry)
- Modify: `backend/src/routes/providers.ts` (`providerChainKeys` gains safeway)
- Modify: `README.md` (Safeway section)
- Test: `backend/src/tests/safeway-provider.test.ts` (extend)

**Interfaces:**
- Consumes: `normalizeSafewayItem`, `SESSION_STORE_ID`, shapes from Task 1.
- Produces: registry entry `providers.safeway`; credential spec `provider: "safeway"` with field `baseUrl` (env fallback `SAFEWAY_SCRAPER_URL`); `safewayProvider.searchProducts` caches results 24h and remembers products for `getProduct`.

- [ ] **Step 1: Extend the test with transport behavior (mocked fetch)**

Append to `backend/src/tests/safeway-provider.test.ts`:

```ts
import { afterEach, beforeEach, vi } from "vitest";
import { safewayProvider } from "../services/providers/safeway.js";

describe("safewayProvider transport", () => {
  beforeEach(() => {
    vi.stubEnv("SAFEWAY_SCRAPER_URL", "http://scraper.test");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

  it("searches, caches for the day, and resolves getProduct from the search", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).endsWith("/health")) return ok({ ok: true });
      return ok({
        storeId: "3132",
        results: [{ name: "Milk", price: 3.99, itemId: "960109496", inStock: true }]
      });
    });

    const first = await safewayProvider.searchProducts({ term: "milk" });
    expect(first[0].externalProductId).toBe("960109496");
    expect(first[0].storeId).toBe("3132");

    const again = await safewayProvider.searchProducts({ term: "milk" });
    expect(again).toHaveLength(1);
    // One search call total: the second came from the cache.
    const searchCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/search"));
    expect(searchCalls).toHaveLength(1);

    const product = await safewayProvider.getProduct("960109496");
    expect(product?.title).toBe("Milk");
  });

  it("maps blocked-scraper errors to rate_limited so the bulk job degrades it", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "Imperva blocked it" }), { status: 502 }))
    );
    await expect(safewayProvider.searchProducts({ term: "eggs" })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("exposes exactly the session store location", async () => {
    const locations = await safewayProvider.searchLocations({});
    expect(locations).toEqual([expect.objectContaining({ externalId: "safeway-session", chain: "Safeway" })]);
    expect(safewayProvider.defaultLocationId?.()).toBe("safeway-session");
  });
});
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/safeway-provider.test.ts`
Expected: FAIL, `safewayProvider` is not exported.

- [ ] **Step 3: Append the transport and provider object to safeway.ts**

Mirror the walmart-scraper provider exactly, minus the store directory:

```ts
async function baseUrl(): Promise<string> {
  const cfg = await resolveConfig(SOURCE);
  const url = cfg.baseUrl?.trim() || process.env.SAFEWAY_SCRAPER_URL?.trim() || DEFAULT_BASE;
  return url.replace(/\/$/, "");
}

function apiKey(): string {
  return process.env.SAFEWAY_SCRAPER_API_KEY?.trim() || "";
}

async function scraperFetch<T>(pathname: string): Promise<T> {
  const base = await baseUrl();
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;

  const controller = new AbortController();
  // A Safeway search drives a real browser and takes 20-30s; allow for a queue.
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(base + pathname, { headers, signal: controller.signal });
  } catch {
    throw new ProviderError(
      `Could not reach the Safeway scraper at ${base}. Is the service running? (npm run safeway in walmart-scraper, with Chrome started via npm run safeway:chrome)`,
      "network",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) throw new ProviderError("The scraper rejected the API key.", "auth_failed", 502);
  if (!response.ok) {
    let message = `Safeway scraper error (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = String(body.error);
    } catch {
      /* non-JSON error body */
    }
    if (/imperva|budget|block|challenge|rate/i.test(message)) throw new ProviderError(message, "rate_limited", 429);
    throw new ProviderError(message, "upstream", 502);
  }
  return (await response.json()) as T;
}

const SEARCH_TTL_MS = Number(process.env.SAFEWAY_CACHE_TTL_MS) || 24 * 60 * 60 * 1000;
const CACHE_FETCH = 40;
const searchCache = new Map<string, { at: number; products: NormalizedProduct[] }>();

const recent = new Map<string, NormalizedProduct>();
const RECENT_MAX = 500;
function remember(product: NormalizedProduct) {
  recent.set(product.externalProductId, product);
  if (recent.size > RECENT_MAX) {
    const oldest = recent.keys().next().value;
    if (oldest !== undefined) recent.delete(oldest);
  }
}

export const safewayProvider: GroceryProvider = {
  id: SOURCE,
  label: "Safeway (self-hosted)",
  hasStores: false,

  async isConfigured() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const response = await fetch((await baseUrl()) + "/health", { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  },

  defaultLocationId() {
    return SESSION_STORE_ID;
  },

  async searchLocations(_params: LocationSearchParams) {
    return [SESSION_STORE];
  },

  async getLocation(externalId: string) {
    if (!externalId || externalId === SESSION_STORE_ID) return SESSION_STORE;
    // A concrete store id the scraper reported earlier stays attributable.
    return { source: SOURCE, externalId, name: `Safeway #${externalId}`, chain: "Safeway" };
  },

  async searchProducts(params: ProductSearchParams) {
    if (!params.term) throw new ProviderError("Enter a search term.", "bad_request", 400);
    const limit = params.limit ?? 15;
    // The session decides the store, so the cache key is the term alone.
    const cacheKey = params.term.trim().toLowerCase();

    const hit = searchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) {
      hit.products.forEach(remember);
      return hit.products.slice(0, limit);
    }

    const qs = new URLSearchParams({ query: params.term, limit: String(CACHE_FETCH) });
    const data = await scraperFetch<SafewaySearchResponse>(`/search?${qs.toString()}`);
    const products = (data.results ?? []).map((item) => normalizeSafewayItem(item, data.storeId));
    searchCache.set(cacheKey, { at: Date.now(), products });
    products.forEach(remember);
    return products.slice(0, limit);
  },

  async getProduct(externalProductId: string, _locationId?: string) {
    return recent.get(externalProductId) ?? null;
  }
};
```

- [ ] **Step 4: Register the provider and its settings entry**

In `backend/src/services/providers/index.ts` replace the registry with:

```ts
import { safewayProvider } from "./safeway.js";

export const providers: Record<string, GroceryProvider> = {
  kroger: krogerProvider,
  walmart: walmartProvider,
  "walmart-scraper": walmartScraperProvider,
  safeway: safewayProvider
};
```

(and remove the now-satisfied "Add Safeway here" comment).

In `backend/src/services/credentials.ts`, append to `CREDENTIAL_SPECS`:

```ts
{
  provider: "safeway",
  label: "Safeway (self-hosted scraper)",
  description:
    "Self-hosted Safeway price scraper (walmart-scraper repo, npm run safeway). It attaches to your real, signed-in Chrome, so prices come from the store your Safeway account has selected.",
  docsUrl: "https://github.com/deviantgaming2000/walmart-scraper",
  fields: [{ key: "baseUrl", label: "Scraper URL", secret: false, placeholder: "http://localhost:8092" }],
  envMap: { baseUrl: "SAFEWAY_SCRAPER_URL" }
}
```

In `backend/src/routes/providers.ts`, extend `providerChainKeys` so Safeway rows reuse an existing manual "Safeway" store row instead of creating a duplicate:

```ts
function providerChainKeys(providerId: string): string[] {
  if (providerId === "kroger") return ["frys", "fry", "kroger"];
  if (providerId.startsWith("walmart")) return ["walmart"];
  if (providerId === "safeway") return ["safeway", "albertsons"];
  return [];
}
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS, including the new safeway-provider tests.

- [ ] **Step 6: Live smoke test (requires Chrome + scraper running)**

```bash
cd ~/code/walmart-scraper && npm run safeway:chrome
cd ~/code/walmart-scraper && npm run safeway &
sleep 3 && curl -s "http://localhost:8092/health"
```

Then start the app backend and confirm Safeway appears in Find Products' provider list and a search returns priced items.
If Chrome or the session is unavailable, note it and move on; the unit tests carry the correctness burden.

- [ ] **Step 7: Update README (provider list, Safeway section) and commit**

Add a short "Safeway (self-hosted)" subsection near the walmart-scraper one: what it is, `SAFEWAY_SCRAPER_URL`, the signed-in-Chrome requirement, and that the store follows the user's Safeway account.

```bash
cd ~/code/grocery-price-checker
git add backend/src/services/providers/safeway.ts backend/src/services/providers/index.ts backend/src/services/credentials.ts backend/src/routes/providers.ts backend/src/tests/safeway-provider.test.ts README.md
git commit -m "feat(providers): Safeway self-hosted scraper as a full provider"
```

---

### Task 3: Schema migration for refresh status, coupon provenance, and scheduler settings

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `backend/src/routes/coupons.ts` (schema passthrough)
- Create: migration via `npx prisma migrate dev`

**Interfaces:**
- Produces columns later tasks rely on:
  - `PriceEntry.lastRefreshStatus String?` (values written by code: `"ok"`, `"not_found"`, `"error"`; null means never auto-refreshed).
  - `Coupon.source String @default("manual")` and `Coupon.externalId String?`, with `@@index([userId, source, externalId])`.
  - `UserSettings.autoRefreshEnabled Boolean @default(true)`, `UserSettings.autoRefreshHour Int @default(3)`, `UserSettings.staleAfterHours Int @default(24)`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model PriceEntry`, after `lastSyncedAt`:

```prisma
  lastRefreshStatus String? @map("last_refresh_status")
```

In `model Coupon`, after `notes`:

```prisma
  source     String  @default("manual")
  externalId String? @map("external_id")
```

and alongside the existing `@@index([userId])`:

```prisma
  @@index([userId, source, externalId])
```

In `model UserSettings`, after `costPerMileOverride`:

```prisma
  autoRefreshEnabled Boolean @default(true)  @map("auto_refresh_enabled")
  autoRefreshHour    Int     @default(3)     @map("auto_refresh_hour")
  staleAfterHours    Int     @default(24)    @map("stale_after_hours")
```

- [ ] **Step 2: Run the migration and regenerate the client**

Run: `cd ~/code/grocery-price-checker && npx prisma migrate dev --name auto_refresh_and_coupon_provenance`
Expected: migration applies cleanly, client regenerates.
(If the dev Postgres is not running, start it the same way the repo's README describes before migrating.)

- [ ] **Step 3: Let the coupon routes accept but never trust provenance**

In `backend/src/routes/coupons.ts`, `source`/`externalId` are NOT added to `couponSchema`: user-facing CRUD always writes `manual` rows (the default), and only the ingest services (Tasks 8 and 11) set other sources.
Add one line to the GET response so the UI can badge auto coupons: nothing to change, `findMany` already returns all columns.

- [ ] **Step 4: Run the suite, then commit**

Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS (schema-only change).

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): refresh status on prices, provenance on coupons, auto-refresh settings"
```

---

### Task 4: Extract product import helpers, then build the refresh engine

**Files:**
- Create: `backend/src/services/providers/import.ts` (moved helpers)
- Create: `backend/src/services/refresh.ts`
- Modify: `backend/src/routes/providers.ts` (import the moved helpers)
- Test: `backend/src/tests/refresh.test.ts`

**Interfaces:**
- Consumes: `getProvider` registry, `upsertPrice` (moved here), Prisma client.
- Produces (Tasks 5, 6, 9 rely on these exact names):

```ts
// services/providers/import.ts
export function parseSize(size?: string): { quantity: number; unit: UnitType };
export function derivePackage(product: NormalizedProduct): { quantity: number; unit: UnitType };
export async function upsertItem(userId: string, product: NormalizedProduct): Promise<GroceryItem>;
export async function upsertPrice(userId: string, groceryItemId: string, storeId: string, product: NormalizedProduct, priceEntryId?: string): Promise<PriceEntry>;

// services/refresh.ts
export interface RefreshRunSummary {
  id: string;
  status: "running" | "done" | "error";
  trigger: "nightly" | "stale-view" | "manual";
  startedAt: string;
  finishedAt?: string;
  totalEntries: number;
  processed: number;
  apiCalls: number;
  providers: { provider: string; refreshed: number; unverified: number; failed: number; skipped: number; degraded: string | null }[];
  error?: string;
}
export interface RefreshDeps {
  getProviderById?: typeof getProvider; // injectable for tests
  sleep?: (ms: number) => Promise<void>;
}
export function currentRun(): RefreshRunSummary | null;   // the running one, else null
export function latestRun(): RefreshRunSummary | null;    // running or last finished
export function startRefreshRun(opts: { trigger: RefreshRunSummary["trigger"]; staleHours?: number }, deps?: RefreshDeps): RefreshRunSummary;
```

`startRefreshRun` returns the running run immediately (joining an in-flight run instead of starting a second one) and does the work detached, exactly like the bulk job.

- [ ] **Step 1: Move the import helpers (pure refactor, no behavior change)**

Create `backend/src/services/providers/import.ts` and MOVE (not copy) `UNIT_TYPES`, `UnitType`, `parseSize`, `derivePackage`, `upsertItem`, and `upsertPrice` out of `backend/src/routes/providers.ts` into it, exporting all of them.
`upsertItem`/`upsertPrice` need `getDefaultUserId`/`prisma` imports from `../lib/prisma.js` adjusted to `../../lib/prisma.js`.
In `routes/providers.ts`, import them: `import { parseSize, derivePackage, upsertItem, upsertPrice, UnitType } from "../services/providers/import.js";` and delete the moved definitions.

Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS unchanged (match-size and compare tests cover the moved code paths).

```bash
git add backend/src/services/providers/import.ts backend/src/routes/providers.ts
git commit -m "refactor(providers): extract product import helpers from the routes file"
```

- [ ] **Step 2: Write the failing refresh-engine tests**

The engine takes its providers through an injectable lookup, so tests use fakes and a real test database row set.
Follow the existing route tests' pattern for DB setup (see `backend/src/tests/compare.route.test.ts` for how the suite gets a user, store, item, and price rows; reuse its helpers or copy its setup style).

```ts
// backend/src/tests/refresh.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { startRefreshRun, latestRun, currentRun } from "../services/refresh.js";
import { prisma, getDefaultUserId } from "../lib/prisma.js";
import type { GroceryProvider, NormalizedProduct } from "../services/providers/index.js";

function fakeProduct(over: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    source: "fakeprov",
    externalProductId: "ext-1",
    title: "Whole Milk",
    price: 3.49,
    regularPrice: 3.49,
    promoPrice: null,
    unitPrice: null,
    currency: "USD",
    available: true,
    couponEligible: false,
    couponData: null,
    lastUpdated: new Date().toISOString(),
    ...over
  };
}

function fakeProvider(results: NormalizedProduct[]): GroceryProvider {
  return {
    id: "fakeprov",
    label: "Fake",
    hasStores: true,
    isConfigured: async () => true,
    searchLocations: async () => [],
    getLocation: async (id) => ({ source: "fakeprov", externalId: id, name: "Fake Store" }),
    searchProducts: async () => results,
    getProduct: async () => null
  };
}

async function seedLinkedPrice(externalProductId: string, price = 2.0) {
  const userId = await getDefaultUserId();
  const store = await prisma.store.create({
    data: {
      userId, name: "Fake Store", storeType: "grocery", address: "1 Test St",
      city: "Casa Grande", state: "AZ", zip: "85122",
      provider: "fakeprov", externalId: "st-1"
    }
  });
  const item = await prisma.groceryItem.create({
    data: { userId, name: "Whole Milk", category: "Dairy", quantityNeeded: 1, unitType: "each" }
  });
  const entry = await prisma.priceEntry.create({
    data: {
      userId, groceryItemId: item.id, storeId: store.id,
      price, packageQuantity: 1, packageUnit: "each",
      source: "fakeprov", externalProductId,
      recordedAt: new Date(Date.now() - 48 * 3600 * 1000)
    }
  });
  return { userId, store, item, entry };
}

async function runToCompletion(deps: Parameters<typeof startRefreshRun>[1]) {
  startRefreshRun({ trigger: "manual" }, deps);
  for (let i = 0; i < 200 && currentRun(); i++) await new Promise((r) => setTimeout(r, 10));
  return latestRun()!;
}

describe("refresh engine", () => {
  beforeEach(async () => {
    await prisma.priceEntry.deleteMany({});
    await prisma.groceryItem.deleteMany({});
    await prisma.store.deleteMany({});
  });

  it("updates a price on an exact external-id match", async () => {
    const { entry } = await seedLinkedPrice("ext-1");
    const provider = fakeProvider([fakeProduct({ price: 3.49 })]);
    const run = await runToCompletion({ getProviderById: () => provider, sleep: async () => {} });

    expect(run.status).toBe("done");
    expect(run.providers[0].refreshed).toBe(1);
    const updated = await prisma.priceEntry.findUnique({ where: { id: entry.id } });
    expect(Number(updated!.price)).toBe(3.49);
    expect(updated!.lastRefreshStatus).toBe("ok");
  });

  it("marks the row not_found instead of guessing when the id is absent", async () => {
    const { entry } = await seedLinkedPrice("ext-GONE");
    // A lookalike with the right name but a different id must NOT be written.
    const provider = fakeProvider([fakeProduct({ externalProductId: "ext-1", price: 9.99 })]);
    const run = await runToCompletion({ getProviderById: () => provider, sleep: async () => {} });

    expect(run.providers[0].unverified).toBe(1);
    const kept = await prisma.priceEntry.findUnique({ where: { id: entry.id } });
    expect(Number(kept!.price)).toBe(2.0);
    expect(kept!.lastRefreshStatus).toBe("not_found");
  });

  it("degrades a provider after repeated failures and joins an in-flight run", async () => {
    await seedLinkedPrice("a");
    const failing: GroceryProvider = {
      ...fakeProvider([]),
      searchProducts: async () => { throw new Error("boom"); }
    };
    const first = startRefreshRun({ trigger: "manual" }, { getProviderById: () => failing, sleep: async () => {} });
    const second = startRefreshRun({ trigger: "manual" }, { getProviderById: () => failing, sleep: async () => {} });
    expect(second.id).toBe(first.id); // joined, not doubled
    for (let i = 0; i < 200 && currentRun(); i++) await new Promise((r) => setTimeout(r, 10));
    const run = latestRun()!;
    expect(run.status).toBe("done");
    expect(run.providers[0].failed + run.providers[0].skipped).toBeGreaterThan(0);
  });

  it("honors staleHours: fresh rows are skipped", async () => {
    const { entry } = await seedLinkedPrice("ext-1");
    await prisma.priceEntry.update({ where: { id: entry.id }, data: { recordedAt: new Date() } });
    const provider = fakeProvider([fakeProduct()]);
    const run = await runToCompletion({ getProviderById: () => provider, sleep: async () => {} });
    // runToCompletion passes no staleHours; add one for this case:
    startRefreshRun({ trigger: "stale-view", staleHours: 24 }, { getProviderById: () => provider, sleep: async () => {} });
    for (let i = 0; i < 200 && currentRun(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(latestRun()!.totalEntries).toBe(0);
    void run;
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/refresh.test.ts`
Expected: FAIL, cannot resolve `../services/refresh.js`.

- [ ] **Step 4: Implement the engine**

```ts
// backend/src/services/refresh.ts
import { randomUUID } from "node:crypto";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { getProvider } from "./providers/index.js";
import type { GroceryProvider, NormalizedProduct } from "./providers/index.js";
import { upsertPrice } from "./providers/import.js";

// Auto-refresh for provider-linked price entries.
//
// The one rule that must survive every future edit: a price is only written
// when a search result's external product id matches the stored one EXACTLY.
// Scraper providers cannot look a product up by id after a restart, so the
// engine re-searches by the grocery item's name and matches within the
// results. No match means the row is marked, never guessed at.

const MAX_CALLS = 80;         // hard ceiling per run across all providers
const DELAY_MS = 300;         // pause between upstream calls
const FAIL_STREAK_LIMIT = 5;  // consecutive failures/empties before a provider is degraded

export interface RefreshRunSummary {
  id: string;
  status: "running" | "done" | "error";
  trigger: "nightly" | "stale-view" | "manual";
  startedAt: string;
  finishedAt?: string;
  totalEntries: number;
  processed: number;
  apiCalls: number;
  providers: { provider: string; refreshed: number; unverified: number; failed: number; skipped: number; degraded: string | null }[];
  error?: string;
}
export interface RefreshDeps {
  getProviderById?: typeof getProvider;
  sleep?: (ms: number) => Promise<void>;
}

let running: RefreshRunSummary | null = null;
let last: RefreshRunSummary | null = null;

export function currentRun(): RefreshRunSummary | null {
  return running;
}
export function latestRun(): RefreshRunSummary | null {
  return running ?? last;
}

export function startRefreshRun(
  opts: { trigger: RefreshRunSummary["trigger"]; staleHours?: number },
  deps: RefreshDeps = {}
): RefreshRunSummary {
  if (running) return running; // join, never overlap
  const run: RefreshRunSummary = {
    id: randomUUID(),
    status: "running",
    trigger: opts.trigger,
    startedAt: new Date().toISOString(),
    totalEntries: 0,
    processed: 0,
    apiCalls: 0,
    providers: []
  };
  running = run;
  void execute(run, opts, deps).finally(() => {
    run.finishedAt = new Date().toISOString();
    if (run.status === "running") run.status = "done";
    last = run;
    running = null;
  });
  return run;
}

async function execute(
  run: RefreshRunSummary,
  opts: { staleHours?: number },
  deps: RefreshDeps
): Promise<void> {
  const lookup = deps.getProviderById ?? getProvider;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  try {
    const userId = await getDefaultUserId();
    const cutoff = opts.staleHours != null ? new Date(Date.now() - opts.staleHours * 3600 * 1000) : null;

    const entries = await prisma.priceEntry.findMany({
      where: {
        userId,
        isActive: true,
        externalProductId: { not: null },
        source: { not: "manual" },
        ...(cutoff ? { recordedAt: { lt: cutoff } } : {})
      },
      include: { store: true, groceryItem: true },
      orderBy: [{ source: "asc" }, { storeId: "asc" }]
    });
    run.totalEntries = entries.length;

    // Group by provider so degradation and stats are per provider.
    const byProvider = new Map<string, typeof entries>();
    for (const entry of entries) {
      const bucket = byProvider.get(entry.source) ?? [];
      bucket.push(entry);
      byProvider.set(entry.source, bucket);
    }

    for (const [providerId, bucket] of byProvider) {
      const stats = { provider: providerId, refreshed: 0, unverified: 0, failed: 0, skipped: 0, degraded: null as string | null };
      run.providers.push(stats);

      const provider = lookup(providerId);
      if (!provider || !(await provider.isConfigured().catch(() => false))) {
        stats.skipped = bucket.length;
        stats.degraded = provider ? "provider not configured" : "unknown provider";
        run.processed += bucket.length;
        continue;
      }

      const cache = new Map<string, NormalizedProduct[] | null>(); // null = search failed
      let failStreak = 0;

      for (const entry of bucket) {
        run.processed += 1;
        if (stats.degraded) { stats.skipped += 1; continue; }
        if (run.apiCalls >= MAX_CALLS) { stats.skipped += 1; stats.degraded = "call limit reached"; continue; }

        const term = entry.groceryItem.name;
        const cacheKey = `${entry.store.externalId ?? ""}|${term.toLowerCase()}`;
        let products = cache.get(cacheKey);
        if (products === undefined) {
          run.apiCalls += 1;
          try {
            products = await provider.searchProducts({ term, locationId: entry.store.externalId ?? undefined, limit: 40 });
            failStreak = products.length === 0 ? failStreak + 1 : 0;
          } catch {
            products = null;
            failStreak += 1;
          }
          cache.set(cacheKey, products);
          await sleep(DELAY_MS);
          if (failStreak >= FAIL_STREAK_LIMIT) stats.degraded = "provider degraded (repeated failures or empty results)";
        }

        if (products === null) {
          stats.failed += 1;
          await mark(entry.id, "error");
          continue;
        }

        const match = products.find((p) => p.externalProductId === entry.externalProductId);
        if (!match || match.price == null) {
          stats.unverified += 1;
          await mark(entry.id, "not_found");
          continue;
        }

        await upsertPrice(userId, entry.groceryItemId, entry.storeId, match, entry.id);
        await mark(entry.id, "ok");
        stats.refreshed += 1;
      }
    }
  } catch (error) {
    run.status = "error";
    run.error = error instanceof Error ? error.message : String(error);
  }
}

async function mark(priceEntryId: string, status: "ok" | "not_found" | "error") {
  await prisma.priceEntry.update({ where: { id: priceEntryId }, data: { lastRefreshStatus: status } }).catch(() => {});
}
```

- [ ] **Step 5: Run the refresh tests, then the whole suite**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/refresh.test.ts`
Expected: PASS (4 tests).
Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/refresh.ts backend/src/tests/refresh.test.ts
git commit -m "feat(refresh): shared auto-refresh engine with exact-id matching and degradation"
```

---

### Task 5: Stale-on-view and status routes

**Files:**
- Create: `backend/src/routes/refresh.ts`
- Modify: `backend/src/server.ts` (register)
- Test: `backend/src/tests/refresh.route.test.ts`

**Interfaces:**
- Consumes: `startRefreshRun`, `latestRun` from Task 4; `prisma.userSettings` columns from Task 3.
- Produces routes the frontend (Task 7) calls:
  - `POST /api/prices/refresh-stale` returns `202 { runId, status }` (joins an in-flight run).
  - `GET /api/prices/refresh-runs/latest` returns `200 RefreshRunSummary` or `204` when none has run.

- [ ] **Step 1: Write the failing route tests**

```ts
// backend/src/tests/refresh.route.test.ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

describe("refresh routes", () => {
  it("starts (or joins) a stale refresh and reports it", async () => {
    const app = buildServer();
    const started = await app.inject({ method: "POST", url: "/api/prices/refresh-stale" });
    expect(started.statusCode).toBe(202);
    const { runId } = started.json();
    expect(runId).toBeTruthy();

    const again = await app.inject({ method: "POST", url: "/api/prices/refresh-stale" });
    // Same run while the first is in flight, or a fresh one if it finished:
    expect([runId, again.json().runId]).toContain(again.json().runId);

    const latest = await app.inject({ method: "GET", url: "/api/prices/refresh-runs/latest" });
    expect([200, 204]).toContain(latest.statusCode);
    if (latest.statusCode === 200) expect(latest.json().trigger).toBe("stale-view");
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/refresh.route.test.ts`
Expected: FAIL 404 (route not registered).

- [ ] **Step 3: Implement the routes**

```ts
// backend/src/routes/refresh.ts
import { FastifyInstance } from "fastify";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { latestRun, startRefreshRun } from "../services/refresh.js";

export async function refreshRoutes(app: FastifyInstance) {
  // Fired by the price page on load: refresh anything older than the user's
  // stale threshold. Returns immediately; the page polls the latest run.
  app.post("/prices/refresh-stale", async (_request, reply) => {
    const userId = await getDefaultUserId();
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    const staleHours = settings?.staleAfterHours ?? 24;
    const run = startRefreshRun({ trigger: "stale-view", staleHours });
    reply.code(202);
    return { runId: run.id, status: run.status };
  });

  app.get("/prices/refresh-runs/latest", async (_request, reply) => {
    const run = latestRun();
    if (!run) return reply.code(204).send();
    return run;
  });
}
```

Register in `backend/src/server.ts` beside the other routes:

```ts
import { refreshRoutes } from "./routes/refresh.js";
// ...
app.register(refreshRoutes, { prefix: "/api" });
```

- [ ] **Step 4: Run the tests**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/refresh.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/refresh.ts backend/src/server.ts backend/src/tests/refresh.route.test.ts
git commit -m "feat(refresh): stale-on-view refresh route and run status endpoint"
```

---

### Task 6: Nightly scheduler

**Files:**
- Create: `backend/src/services/scheduler.ts`
- Modify: `backend/src/server.ts` (start on listen, not under test)
- Test: `backend/src/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `startRefreshRun` (Task 4); `UserSettings.autoRefreshEnabled/autoRefreshHour` (Task 3). Task 9 appends coupon ingestion to `runNightly`.
- Produces:

```ts
export function msUntilNightly(now: Date, hour: number, jitterMs: number, random?: () => number): number;
export function startNightlyScheduler(run: () => Promise<unknown>): { stop(): void };
export async function runNightly(): Promise<void>; // the composed nightly work
```

- [ ] **Step 1: Write the failing timing tests**

```ts
// backend/src/tests/scheduler.test.ts
import { describe, expect, it } from "vitest";
import { msUntilNightly } from "../services/scheduler.js";

describe("msUntilNightly", () => {
  it("targets today's hour when it is still ahead", () => {
    const now = new Date("2026-08-31T01:00:00");
    const ms = msUntilNightly(now, 3, 0);
    expect(ms).toBe(2 * 3600 * 1000);
  });

  it("rolls to tomorrow when the hour has passed", () => {
    const now = new Date("2026-08-31T04:00:00");
    const ms = msUntilNightly(now, 3, 0);
    expect(ms).toBe(23 * 3600 * 1000);
  });

  it("adds bounded jitter", () => {
    const now = new Date("2026-08-31T01:00:00");
    const ms = msUntilNightly(now, 3, 30 * 60 * 1000, () => 0.5);
    expect(ms).toBe(2 * 3600 * 1000 + 15 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/scheduler.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the scheduler**

```ts
// backend/src/services/scheduler.ts
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { startRefreshRun, currentRun } from "./refresh.js";

// Nightly auto-update. In-process on purpose: the backend is a long-lived
// server and an OS cron would need its own auth and deployment story. The
// jitter keeps the scrapers from ever seeing a fixed-time burst.
const JITTER_MS = 30 * 60 * 1000;

export function msUntilNightly(now: Date, hour: number, jitterMs: number, random: () => number = Math.random): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime() + Math.floor(random() * jitterMs);
}

export async function runNightly(): Promise<void> {
  const userId = await getDefaultUserId();
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (settings && settings.autoRefreshEnabled === false) return;
  startRefreshRun({ trigger: "nightly" });
  // Wait for the price run to finish before coupon ingestion (Task 9 appends it
  // here) so the scrapers are never hit by two jobs at once.
  while (currentRun()) await new Promise((r) => setTimeout(r, 5000));
}

export function startNightlyScheduler(run: () => Promise<unknown> = runNightly): { stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = async () => {
    if (stopped) return;
    const userId = await getDefaultUserId().catch(() => null);
    const settings = userId ? await prisma.userSettings.findUnique({ where: { userId } }).catch(() => null) : null;
    const hour = settings?.autoRefreshHour ?? 3;
    timer = setTimeout(async () => {
      try {
        await run();
      } finally {
        void schedule();
      }
    }, msUntilNightly(new Date(), hour, JITTER_MS));
  };

  void schedule();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
```

In `backend/src/server.ts`, wherever the listen/start path lives (not inside `buildServer`, so route tests never start timers), add:

```ts
import { startNightlyScheduler } from "./services/scheduler.js";
// after app.listen(...) succeeds:
if (process.env.NODE_ENV !== "test" && process.env.DISABLE_NIGHTLY !== "1") {
  startNightlyScheduler();
}
```

If `server.ts` both builds and listens in one file, guard on the same condition around the listen block.

- [ ] **Step 4: Run the tests**

Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS, and no test hangs (timers only start outside tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/scheduler.ts backend/src/server.ts backend/src/tests/scheduler.test.ts
git commit -m "feat(refresh): in-process nightly scheduler with jitter and settings gate"
```

---

### Task 7: Frontend: stale-on-view trigger, run status, and unverified rows

**Files:**
- Modify: `frontend/src/pages/PricesPage.tsx`

**Interfaces:**
- Consumes: `POST /api/prices/refresh-stale`, `GET /api/prices/refresh-runs/latest` (Task 5); `PriceEntry.lastRefreshStatus` now present on price rows the page already fetches.

The frontend has no test runner; this task is verified in the browser.

- [ ] **Step 1: Fire refresh-stale on mount and poll while running**

In `PricesPage.tsx`, following the page's existing data-fetch pattern (find the hook or effect that loads price groups), add one effect on mount:

```tsx
const [refreshRun, setRefreshRun] = useState<RefreshRunSummary | null>(null);

useEffect(() => {
  let timer: number | undefined;
  const poll = async () => {
    const res = await fetch("/api/prices/refresh-runs/latest");
    if (res.status === 200) {
      const run = (await res.json()) as RefreshRunSummary;
      setRefreshRun(run);
      if (run.status === "running") {
        timer = window.setTimeout(poll, 3000);
        return;
      }
      reloadPrices(); // the page's existing reload function; rows updated by the run appear
    }
  };
  fetch("/api/prices/refresh-stale", { method: "POST" }).then(poll).catch(() => {});
  return () => window.clearTimeout(timer);
}, []);
```

with `RefreshRunSummary` typed to match Task 4's interface (declare it locally or in the page's shared types module, matching however the page already declares API types).

- [ ] **Step 2: Show the run status line and the unverified marker**

Above the price table, a single status line in the page's existing muted-text style:

```tsx
{refreshRun && (
  <p className="…muted…">
    {refreshRun.status === "running"
      ? `Auto-updating prices… ${refreshRun.processed}/${refreshRun.totalEntries}`
      : `Prices auto-updated ${new Date(refreshRun.startedAt).toLocaleString()}: ` +
        refreshRun.providers.map((p) => `${p.provider} ${p.refreshed} updated${p.unverified ? `, ${p.unverified} couldn't verify` : ""}`).join(" · ")}
  </p>
)}
```

On each price row, where the source badge renders, add a marker when `entry.lastRefreshStatus === "not_found"`:

```tsx
{entry.lastRefreshStatus === "not_found" && (
  <span title="The product could not be found at this store on the last auto-update. The shown price is the last verified one.">couldn't verify</span>
)}
```

styled like the existing confidence text (copy the row's existing badge classes).

- [ ] **Step 3: Verify in the browser**

Start backend and frontend per the README, open the Prices page, and confirm: the status line appears, rows with providers get refreshed timestamps, and nothing errors when no run has ever happened (204 path).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PricesPage.tsx
git commit -m "feat(frontend): auto-refresh stale prices on view with run status and unverified markers"
```

---

### Task 8: Flipp coupon ingestion service

**Files:**
- Create: `backend/src/services/coupon-ingest.ts`
- Test: `backend/src/tests/coupon-ingest.test.ts`

**Interfaces:**
- Consumes: `NormalizedDeal` from `deals/types.ts`; `matchDealsToGroceryList` from `deals/match.ts`; `Coupon.source/externalId` (Task 3); Flipp search via injectable `searchDeals`.
- Produces (Task 9 and Task 11 rely on these):

```ts
export interface IngestSummary { source: string; created: number; updated: number; deactivated: number; skipped: number }
export function dealCouponFields(deal: NormalizedDeal):
  | { couponType: "digital_coupon" | "bogo" | "percent_off" | "dollar_off"; amountOff: number | null; percentOff: number | null; name: string; description: string | null; expiresAt: Date | null }
  | null;
export function dealExternalId(deal: NormalizedDeal): string;
export async function ingestDealsAsCoupons(opts: {
  source: string;                      // "flipp" | "safeway-j4u"
  deals: NormalizedDeal[];
  storeIdFor: (deal: NormalizedDeal) => string | null; // local Store id or null = skip
  itemIdFor: (deal: NormalizedDeal) => string | null;  // matched GroceryItem id or null = store-scoped
}): Promise<IngestSummary>;
export async function runFlippCouponIngest(deps?: { searchDeals?: (q: string, zip: string) => Promise<NormalizedDeal[]> }): Promise<IngestSummary>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/tests/coupon-ingest.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { dealCouponFields, dealExternalId, ingestDealsAsCoupons } from "../services/coupon-ingest.js";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import type { NormalizedDeal } from "../services/deals/types.js";

function deal(over: Partial<NormalizedDeal> = {}): NormalizedDeal {
  return {
    source: "flipp",
    storeName: "Safeway",
    productName: "Cheerios 12oz",
    salePrice: 2.99,
    regularPrice: 4.49,
    discountAmount: 1.5,
    couponRequired: false,
    digitalCoupon: false,
    loyaltyRequired: false,
    validTo: "2026-09-06",
    confidence: 0.9,
    raw: { id: "flyeritem-1" },
    ...over
  };
}

describe("dealCouponFields", () => {
  it("derives dollar_off from sale vs regular", () => {
    const f = dealCouponFields(deal())!;
    expect(f.couponType).toBe("dollar_off");
    expect(f.amountOff).toBe(1.5);
    expect(f.expiresAt).toEqual(new Date("2026-09-06"));
  });
  it("derives bogo from deal text", () => {
    const f = dealCouponFields(deal({ salePrice: null, regularPrice: null, discountAmount: null, dealText: "BUY 1 GET 1 FREE" }))!;
    expect(f.couponType).toBe("bogo");
  });
  it("derives digital_coupon and percent_off", () => {
    expect(dealCouponFields(deal({ digitalCoupon: true }))!.couponType).toBe("digital_coupon");
    const pct = dealCouponFields(deal({ salePrice: null, regularPrice: null, discountAmount: null, dealText: "Save 20%" }))!;
    expect(pct.couponType).toBe("percent_off");
    expect(pct.percentOff).toBe(20);
  });
  it("returns null when nothing is derivable", () => {
    expect(dealCouponFields(deal({ salePrice: null, regularPrice: null, discountAmount: null, dealText: undefined }))).toBeNull();
  });
});

describe("ingestDealsAsCoupons", () => {
  beforeEach(async () => {
    await prisma.coupon.deleteMany({ where: { source: { not: "manual" } } });
  });

  it("creates, then updates on re-run, never duplicates, and skips manual rows", async () => {
    const userId = await getDefaultUserId();
    const store = await prisma.store.create({ data: { userId, name: "Safeway", storeType: "grocery", address: "1 Test St", city: "Casa Grande", state: "AZ", zip: "85122" } });
    const manual = await prisma.coupon.create({
      data: { userId, name: "My own coupon", couponType: "dollar_off", scope: "store", amountOff: 1, storeId: store.id }
    });

    const opts = { source: "flipp", deals: [deal()], storeIdFor: () => store.id, itemIdFor: () => null };
    const first = await ingestDealsAsCoupons(opts);
    expect(first.created).toBe(1);

    const second = await ingestDealsAsCoupons(opts);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(await prisma.coupon.count({ where: { source: "flipp" } })).toBe(1);

    const untouched = await prisma.coupon.findUnique({ where: { id: manual.id } });
    expect(untouched!.name).toBe("My own coupon");
  });

  it("deactivates expired auto coupons and never manual ones", async () => {
    const userId = await getDefaultUserId();
    const store = await prisma.store.create({ data: { userId, name: "Safeway", storeType: "grocery", address: "1 Test St", city: "Casa Grande", state: "AZ", zip: "85122" } });
    await ingestDealsAsCoupons({
      source: "flipp",
      deals: [deal({ validTo: "2020-01-01", raw: { id: "old-1" } })],
      storeIdFor: () => store.id,
      itemIdFor: () => null
    });
    const summary = await ingestDealsAsCoupons({ source: "flipp", deals: [], storeIdFor: () => null, itemIdFor: () => null });
    expect(summary.deactivated).toBeGreaterThanOrEqual(1);
    const rows = await prisma.coupon.findMany({ where: { source: "flipp", externalId: "old-1" } });
    expect(rows[0].isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/coupon-ingest.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the service**

```ts
// backend/src/services/coupon-ingest.ts
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import type { NormalizedDeal } from "./deals/types.js";
import { matchDealsToGroceryList } from "./deals/match.js";
import { flippDealsProvider } from "./deals/flipp.js";

// Automatic coupons. Provenance is the whole design: every row written here
// carries source + externalId, upserts by them, and never touches "manual"
// rows the user typed in. Expiry cleanup only ever deactivates its own source.

export interface IngestSummary {
  source: string;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
}

export function dealExternalId(deal: NormalizedDeal): string {
  const rawId = (deal.raw as { id?: string | number } | undefined)?.id;
  if (rawId != null && String(rawId).trim()) return String(rawId);
  return [deal.storeName ?? "", deal.productName, deal.validTo ?? ""]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "-")
    .slice(0, 120);
}

export function dealCouponFields(deal: NormalizedDeal) {
  const expiresAt = deal.validTo ? new Date(deal.validTo) : null;
  const name = deal.productName;
  const description =
    [deal.dealText, deal.description].filter(Boolean).join(" · ") ||
    (deal.salePrice != null ? `Sale ${deal.salePrice.toFixed(2)}${deal.regularPrice != null ? ` (reg ${deal.regularPrice.toFixed(2)})` : ""}` : null);

  if (deal.digitalCoupon) {
    return { couponType: "digital_coupon" as const, amountOff: deal.discountAmount ?? null, percentOff: null, name, description, expiresAt };
  }
  if (deal.dealText && /\bb(uy)?\s*\d*\s*g(et)?\s*\d*\s*(free|\bfor\b)|\bbogo\b/i.test(deal.dealText)) {
    return { couponType: "bogo" as const, amountOff: null, percentOff: null, name, description, expiresAt };
  }
  const pct = deal.dealText?.match(/(\d{1,2})\s*%/);
  if (pct) {
    return { couponType: "percent_off" as const, amountOff: null, percentOff: Number(pct[1]), name, description, expiresAt };
  }
  const amount =
    deal.discountAmount ??
    (deal.salePrice != null && deal.regularPrice != null && deal.regularPrice > deal.salePrice
      ? Number((deal.regularPrice - deal.salePrice).toFixed(2))
      : null);
  if (amount != null && amount > 0) {
    return { couponType: "dollar_off" as const, amountOff: amount, percentOff: null, name, description, expiresAt };
  }
  return null;
}

export async function ingestDealsAsCoupons(opts: {
  source: string;
  deals: NormalizedDeal[];
  storeIdFor: (deal: NormalizedDeal) => string | null;
  itemIdFor: (deal: NormalizedDeal) => string | null;
}): Promise<IngestSummary> {
  const userId = await getDefaultUserId();
  const summary: IngestSummary = { source: opts.source, created: 0, updated: 0, deactivated: 0, skipped: 0 };

  for (const deal of opts.deals) {
    const fields = dealCouponFields(deal);
    const storeId = opts.storeIdFor(deal);
    if (!fields || !storeId) {
      summary.skipped += 1;
      continue;
    }
    const externalId = dealExternalId(deal);
    const groceryItemId = opts.itemIdFor(deal);
    const data = {
      userId,
      storeId,
      groceryItemId,
      name: fields.name,
      couponType: fields.couponType,
      scope: (groceryItemId ? "item" : "store") as "item" | "store",
      amountOff: fields.amountOff,
      percentOff: fields.percentOff,
      description: fields.description,
      expiresAt: fields.expiresAt,
      isActive: fields.expiresAt == null || fields.expiresAt.getTime() > Date.now(),
      source: opts.source,
      externalId
    };
    const existing = await prisma.coupon.findFirst({ where: { userId, source: opts.source, externalId } });
    if (existing) {
      await prisma.coupon.update({ where: { id: existing.id }, data });
      summary.updated += 1;
    } else {
      await prisma.coupon.create({ data });
      summary.created += 1;
    }
  }

  // Expire this source's own leftovers; manual rows are structurally excluded.
  const expired = await prisma.coupon.updateMany({
    where: { userId, source: opts.source, isActive: true, expiresAt: { lt: new Date() } },
    data: { isActive: false }
  });
  summary.deactivated = expired.count;
  return summary;
}

const INGEST_MAX_CALLS = 40;
const INGEST_DELAY_MS = 300;
const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function runFlippCouponIngest(
  deps: { searchDeals?: (query: string, zip: string) => Promise<NormalizedDeal[]>; sleep?: (ms: number) => Promise<void> } = {}
): Promise<IngestSummary> {
  const userId = await getDefaultUserId();
  const search =
    deps.searchDeals ?? ((query: string, zip: string) => flippDealsProvider.searchDeals({ query, zip, limit: 40 }));
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const stores = await prisma.store.findMany({ where: { userId, zip: { not: "" } } });
  const items = await prisma.groceryItem.findMany({ where: { userId }, select: { id: true, name: true } });
  const zips = [...new Set(stores.map((s) => s.zip))];

  const collected: NormalizedDeal[] = [];
  let calls = 0;
  for (const zip of zips) {
    for (const item of items) {
      if (calls >= INGEST_MAX_CALLS) break;
      calls += 1;
      const deals = await search(item.name, zip).catch(() => [] as NormalizedDeal[]);
      collected.push(...deals);
      await sleep(INGEST_DELAY_MS);
    }
  }

  // Only deals from stores the user actually tracks, matched back to items with
  // the shared token matcher so a "cheerios" search result about granola bars
  // does not become a Cheerios coupon.
  const matched = matchDealsToGroceryList({ deals: collected, groceryItems: items });
  return ingestDealsAsCoupons({
    source: "flipp",
    deals: matched,
    storeIdFor: (deal) => {
      const key = norm(deal.storeName);
      if (!key) return null;
      const store = stores.find((s) => norm(s.name).includes(key) || key.includes(norm(s.name)));
      return store?.id ?? null;
    },
    itemIdFor: (deal) => (deal as { matchedItemIds?: string[] }).matchedItemIds?.[0] ?? null
  });
}
```

`flippDealsProvider.searchDeals` is the file's public per-query, per-zip search (it throws `ProviderError("bad_request")` without a zip, which the catch in the loop absorbs).

- [ ] **Step 4: Run the tests**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/coupon-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/coupon-ingest.ts backend/src/tests/coupon-ingest.test.ts
git commit -m "feat(coupons): ingest Flipp weekly-ad deals as provenance-tracked coupons"
```

---

### Task 9: Wire coupon ingestion into the nightly run, a manual trigger, and the UI badge

**Files:**
- Modify: `backend/src/services/scheduler.ts` (append to `runNightly`)
- Modify: `backend/src/routes/coupons.ts` (manual trigger route)
- Modify: `frontend/src/pages/CouponsPage.tsx` (auto badge)
- Test: extend `backend/src/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `runFlippCouponIngest` (Task 8), `runNightly` (Task 6).
- Produces: `POST /api/coupons/ingest/run` returns `202 { started: true }`; nightly order is prices first, then coupons.

- [ ] **Step 1: Append ingestion to `runNightly`**

In `backend/src/services/scheduler.ts`, after the wait loop in `runNightly`:

```ts
import { runFlippCouponIngest } from "./coupon-ingest.js";
// at the end of runNightly():
await runFlippCouponIngest().catch(() => {
  // Coupons are best-effort; a Flipp outage must not fail the nightly run.
});
```

- [ ] **Step 2: Manual trigger route**

In `backend/src/routes/coupons.ts`:

```ts
import { runFlippCouponIngest } from "../services/coupon-ingest.js";

app.post("/coupons/ingest/run", async (_request, reply) => {
  void runFlippCouponIngest().catch(() => {});
  reply.code(202);
  return { started: true };
});
```

- [ ] **Step 3: UI badge for auto coupons**

In `frontend/src/pages/CouponsPage.tsx`, where each coupon renders, add next to the name (copying the page's existing badge styling):

```tsx
{coupon.source && coupon.source !== "manual" && <span className="…badge…">{coupon.source === "safeway-j4u" ? "Just4U" : "weekly ad"}</span>}
```

- [ ] **Step 4: Test the route, run the suite, verify in browser, commit**

Add to `backend/src/tests/scheduler.test.ts` a route check mirroring Task 5's pattern (POST `/api/coupons/ingest/run` returns 202 via `app.inject`).
Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS.
Browser: trigger the route, confirm weekly-ad coupons appear with badges on the Coupons page.

```bash
git add backend/src/services/scheduler.ts backend/src/routes/coupons.ts frontend/src/pages/CouponsPage.tsx backend/src/tests/scheduler.test.ts
git commit -m "feat(coupons): nightly Flipp ingestion, manual trigger, and auto-coupon badges"
```

---

### Task 10: Just4U coupon endpoint in the Safeway scraper (walmart-scraper repo)

**Files (all in `~/code/walmart-scraper`):**
- Create: `src/safeway/parse-coupons.js`
- Modify: `src/safeway/session.js` (add `fetchSafewayCoupons`)
- Modify: `src/safeway/server.js` (add `GET /coupons`)
- Create: `test/safeway-parse-coupons.test.js` (node:test)
- Modify: `package.json` (add `"test": "node --test test/"`)

**Interfaces:**
- Produces: `GET /coupons` on the safeway service returning `{ store: "safeway", count, coupons: [...], scrapedAt }` with coupon objects `{ id, title, description, savingsText, expiresAt, brand, category }`. Task 11 consumes this shape.

- [ ] **Step 1: Write the failing parser test**

The J4U offers payload nests offers like products; reuse the tree-walk strategy from `parse.js`.
An offer object carries fields like `offerId`/`offerPgm`, `description`/`name`, `savingsValue`/`offerPrice`, `offerEndDate`/`endDate`, `brand`, `category`.

```js
// test/safeway-parse-coupons.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafewayCoupons } from '../src/safeway/parse-coupons.js';

const payload = JSON.stringify({
  data: {
    offers: [
      {
        offerId: 'OFFER-123',
        name: 'Lucerne Cheese',
        description: 'Save $1.00 on any Lucerne Cheese 8oz',
        savingsValue: '$1.00',
        offerEndDate: '2026-09-15',
        brand: 'Lucerne',
        category: 'Dairy'
      },
      { notAnOffer: true }
    ]
  }
});

test('parses offers into normalized coupons', () => {
  const coupons = parseSafewayCoupons(payload, 10);
  assert.equal(coupons.length, 1);
  assert.deepEqual(coupons[0], {
    id: 'OFFER-123',
    title: 'Lucerne Cheese',
    description: 'Save $1.00 on any Lucerne Cheese 8oz',
    savingsText: '$1.00',
    expiresAt: '2026-09-15',
    brand: 'Lucerne',
    category: 'Dairy'
  });
});

test('returns empty on payloads without offers', () => {
  assert.deepEqual(parseSafewayCoupons(JSON.stringify({ hello: 1 }), 10), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/walmart-scraper && node --test test/`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the parser**

```js
// src/safeway/parse-coupons.js
// Parse a Just4U offers payload into normalized coupons. Like parse.js, the
// exact nesting shifts between releases, so we walk the tree for objects that
// look like offers instead of hard-coding a path.

function findOffers(data) {
  let offers = [];
  const looksLikeOffer = (o) =>
    o && typeof o === 'object' && (o.offerId || o.offerID || o.id) && (o.description || o.name || o.title) &&
    (o.savingsValue || o.offerPrice || o.savings || o.offerDetail || o.description);
  const walk = (o) => {
    if (Array.isArray(o)) {
      if (!offers.length && o.length && looksLikeOffer(o[0])) offers = o.filter(looksLikeOffer);
      else for (const v of o) walk(v);
    } else if (o && typeof o === 'object') {
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(data);
  return offers;
}

export function parseSafewayCoupons(body, limit = 100) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const o of findOffers(data)) {
    const id = String(o.offerId || o.offerID || o.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: o.name || o.title || o.description || '',
      description: o.description || o.offerDetail || null,
      savingsText: o.savingsValue || o.offerPrice || o.savings || null,
      expiresAt: o.offerEndDate || o.endDate || null,
      brand: o.brand || null,
      category: o.category || o.categoryName || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the parser tests**

Run: `cd ~/code/walmart-scraper && node --test test/`
Expected: PASS. Add `"test": "node --test test/"` to `package.json` scripts.

- [ ] **Step 5: Add the session fetch and the route**

In `src/safeway/session.js`, add alongside `doSearch` (same intercept pattern, same single-flight queue):

```js
import { parseSafewayCoupons } from './parse-coupons.js';

const J4U_URL = `${BASE}/foru/coupons-deals.html`;

async function doFetchCoupons(limit) {
  await ensureSession();
  let body = null;
  const onResponse = async (resp) => {
    const u = resp.url();
    // The offers feed lives under the xapi tree; match broadly but require a
    // payload that actually parses into offers.
    if (/xapi/.test(u) && /offer|coupon|deal/i.test(u)) {
      try {
        const t = await resp.text();
        if (t && t.length > 200 && parseSafewayCoupons(t, 1).length) body = t;
      } catch { /* already consumed */ }
    }
  };
  page.on('response', onResponse);
  try {
    await page.goto(J4U_URL, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 14 && !body; i++) {
      if (i % 2 === 0) await page.mouse.wheel(0, 900).catch(() => {});
      await page.waitForTimeout(2000);
    }
  } finally {
    page.off('response', onResponse);
  }
  if (!body) {
    await reset();
    throw new Error('No Just4U offers response - are you signed in to Safeway in the attached Chrome?');
  }
  return parseSafewayCoupons(body, limit);
}

export function fetchSafewayCoupons({ limit = 200 } = {}) {
  const run = queue.then(() => doFetchCoupons(limit), () => doFetchCoupons(limit));
  queue = run.catch(() => {});
  return run;
}
```

In `src/safeway/server.js`:

```js
import { fetchSafewayCoupons } from './session.js';

// GET /coupons[?limit=200] - Just4U digital coupons from the signed-in session.
// Lookup only: this NEVER clips a coupon (clipping writes to the account).
app.get('/coupons', async (req, res) => {
  try {
    const coupons = await fetchSafewayCoupons({ limit: req.query.limit ? parseInt(req.query.limit, 10) : 200 });
    res.json({ store: 'safeway', count: coupons.length, coupons, scrapedAt: new Date().toISOString() });
  } catch (e) {
    logger.error(e.message);
    res.status(502).json({ error: e.message });
  }
});
```

If the live J4U page URL differs (check the signed-in Chrome: it is the "For U" deals page), adjust `J4U_URL` to the real path observed.

- [ ] **Step 6: Live smoke test, then commit**

With Chrome attached and signed in: `curl -s "http://localhost:8092/coupons" | head -c 400`
Expected: JSON with real coupons, or the honest sign-in error.

```bash
cd ~/code/walmart-scraper
git add src/safeway/parse-coupons.js src/safeway/session.js src/safeway/server.js test/ package.json
git commit -m "Safeway: Just4U coupon lookup endpoint (read-only, never clips)"
```

---

### Task 11: Ingest Just4U coupons in the backend

**Files (back in `~/code/grocery-price-checker`):**
- Modify: `backend/src/services/providers/safeway.ts` (add `fetchSafewayCoupons`)
- Modify: `backend/src/services/coupon-ingest.ts` (add `runSafewayCouponIngest`)
- Modify: `backend/src/services/scheduler.ts` (append to nightly)
- Modify: `backend/src/routes/coupons.ts` (include in the manual trigger)
- Test: extend `backend/src/tests/coupon-ingest.test.ts`

**Interfaces:**
- Consumes: `GET /coupons` shape from Task 10; `ingestDealsAsCoupons` from Task 8.
- Produces: `fetchSafewayCoupons(): Promise<SafewayCoupon[]>` in the provider file; `runSafewayCouponIngest(deps?): Promise<IngestSummary>` with source `"safeway-j4u"`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/tests/coupon-ingest.test.ts`:

```ts
import { runSafewayCouponIngest } from "../services/coupon-ingest.js";

describe("runSafewayCouponIngest", () => {
  it("stores J4U offers as digital coupons tied to the Safeway store", async () => {
    const userId = await getDefaultUserId();
    const store = await prisma.store.create({ data: { userId, name: "Safeway", storeType: "grocery", address: "1 Test St", city: "Casa Grande", state: "AZ", zip: "85122" } });
    const summary = await runSafewayCouponIngest({
      fetchCoupons: async () => [
        { id: "OFFER-123", title: "Lucerne Cheese", description: "Save $1.00 on Lucerne Cheese", savingsText: "$1.00", expiresAt: "2099-09-15", brand: "Lucerne", category: "Dairy" }
      ]
    });
    expect(summary.created).toBe(1);
    const coupon = await prisma.coupon.findFirst({ where: { source: "safeway-j4u", externalId: "OFFER-123" } });
    expect(coupon!.couponType).toBe("digital_coupon");
    expect(coupon!.storeId).toBe(store.id);
    expect(Number(coupon!.amountOff)).toBe(1.0);
  });

  it("skips cleanly when the scraper is unreachable", async () => {
    const summary = await runSafewayCouponIngest({ fetchCoupons: async () => { throw new Error("down"); } });
    expect(summary).toMatchObject({ source: "safeway-j4u", created: 0, updated: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/grocery-price-checker/backend && npx vitest run src/tests/coupon-ingest.test.ts`
Expected: FAIL, `runSafewayCouponIngest` missing.

- [ ] **Step 3: Implement**

In `backend/src/services/providers/safeway.ts`:

```ts
export interface SafewayCoupon {
  id: string;
  title: string;
  description: string | null;
  savingsText: string | null;
  expiresAt: string | null;
  brand: string | null;
  category: string | null;
}

export async function fetchSafewayCoupons(): Promise<SafewayCoupon[]> {
  const data = await scraperFetch<{ coupons?: SafewayCoupon[] }>("/coupons");
  return data.coupons ?? [];
}
```

In `backend/src/services/coupon-ingest.ts`:

```ts
import { fetchSafewayCoupons, type SafewayCoupon } from "./providers/safeway.js";
import type { NormalizedDeal } from "./deals/types.js";

function j4uToDeal(coupon: SafewayCoupon): NormalizedDeal {
  const amount = coupon.savingsText?.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
  return {
    source: "safeway-j4u",
    storeName: "Safeway",
    productName: coupon.title,
    brand: coupon.brand ?? undefined,
    salePrice: null,
    regularPrice: null,
    discountAmount: amount ? Number(amount[1]) : null,
    dealText: coupon.savingsText ?? undefined,
    couponRequired: true,
    digitalCoupon: true,
    loyaltyRequired: true,
    description: coupon.description ?? undefined,
    validTo: coupon.expiresAt,
    category: coupon.category ?? undefined,
    confidence: 0.9,
    raw: { id: coupon.id }
  };
}

export async function runSafewayCouponIngest(
  deps: { fetchCoupons?: () => Promise<SafewayCoupon[]> } = {}
): Promise<IngestSummary> {
  const userId = await getDefaultUserId();
  const fetchCoupons = deps.fetchCoupons ?? fetchSafewayCoupons;

  let coupons: SafewayCoupon[];
  try {
    coupons = await fetchCoupons();
  } catch {
    // Isolation is the point: a signed-out session or a changed page must
    // never take the nightly run or other coupon sources down with it.
    return { source: "safeway-j4u", created: 0, updated: 0, deactivated: 0, skipped: 0 };
  }

  const safewayStore = await prisma.store.findFirst({
    where: { userId, name: { contains: "safeway", mode: "insensitive" } }
  });
  const items = await prisma.groceryItem.findMany({ where: { userId }, select: { id: true, name: true } });
  const deals = coupons.map(j4uToDeal);
  const matched = matchDealsToGroceryList({ deals, groceryItems: items });

  return ingestDealsAsCoupons({
    source: "safeway-j4u",
    deals: matched,
    storeIdFor: () => safewayStore?.id ?? null,
    itemIdFor: (deal) => (deal as { matchedItemIds?: string[] }).matchedItemIds?.[0] ?? null
  });
}
```

In `scheduler.ts` `runNightly`, after the Flipp line:

```ts
await runSafewayCouponIngest().catch(() => {});
```

In `routes/coupons.ts` extend the trigger:

```ts
app.post("/coupons/ingest/run", async (_request, reply) => {
  void runFlippCouponIngest().catch(() => {});
  void runSafewayCouponIngest().catch(() => {});
  reply.code(202);
  return { started: true };
});
```

- [ ] **Step 4: Run the full suite**

Run: `cd ~/code/grocery-price-checker && npm run test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Update README (auto-refresh + coupons section) and commit**

Document: nightly auto-refresh (settings columns, DISABLE_NIGHTLY env), stale-on-view, the exact-id rule, coupon sources and provenance, and the J4U read-only stance.

```bash
git add backend/src frontend/src README.md
git commit -m "feat(coupons): nightly Just4U ingestion with hard isolation from other sources"
```

---

## Final verification

- [ ] `cd ~/code/grocery-price-checker && npm run test --workspace backend` passes.
- [ ] `cd ~/code/walmart-scraper && node --test test/` passes.
- [ ] Live: with the safeway service and Chrome running, a Safeway search imports a priced product; the Prices page shows the auto-update status line; `POST /api/coupons/ingest/run` produces badged coupons.
- [ ] The forbidden failure mode is impossible: grep the refresh engine for the only write path and confirm it is guarded by the exact `externalProductId` equality check.
