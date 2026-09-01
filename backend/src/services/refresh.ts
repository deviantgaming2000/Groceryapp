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
  upsert?: typeof upsertPrice;
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
  const upsert = deps.upsert ?? upsertPrice;
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

        await upsert(userId, entry.groceryItemId, entry.storeId, match, entry.id);
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
