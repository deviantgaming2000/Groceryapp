# Auto price refresh, Safeway provider, and automatic coupon lookup

Date: 2026-08-31
Status: approved (design), pending implementation

## Goal

Prices that can be fetched live should keep themselves current, and coupons should be found without the user hunting for them.
Concretely:

1. Wire the existing Safeway scraper service into the app as a full provider.
2. Auto-refresh every provider-linked price entry nightly, plus refresh stale rows when the price page is viewed.
3. Look up coupons automatically from three sources: Kroger/Fry's promo pricing, Flipp weekly-ad deals, and Safeway Just4U digital coupons.

Each part is independently shippable, in the order listed.

## Background

- The provider layer (`backend/src/services/providers/`) already normalizes Kroger, Walmart (SerpApi), and walmart-scraper into one product shape, with per-price refresh routes and a polled bulk-lookup background job with pacing and degraded-provider backoff.
- The Safeway scraper already exists as a standalone HTTP service in the walmart-scraper repo (`src/safeway/`).
  It attaches to the user's real Chrome over CDP to get past Imperva and returns the same response shape as the Walmart scraper, including authoritative unit-price fields.
- The provider registry contains a comment reserving Safeway's slot.
- A Coupon table and CRUD routes exist (`dollar_off`, `percent_off`, `bogo`, ..., `digital_coupon`; scoped to item, store, list, or order total).
- Flipp deals providers exist, including Safeway weekly-ad flyers by ZIP, with a deterministic token matcher (`deals/match.ts`) from deals to grocery items.
- Kroger promo/loyalty pricing is already captured on refresh as `couponEligible` and `couponData` on the price entry.
- There is no scheduler of any kind in the backend today.

## Part 1: Safeway provider

New `backend/src/services/providers/safeway.ts`, mirroring `walmart-scraper.ts`:

- Talks HTTP to the Safeway scraper service; base URL configurable in Settings (default `http://localhost:8092`, the service's default port), optional `x-api-key`.
- `isConfigured()` means the service's `/health` answers.
- Long timeouts (the scraper is deliberately slow), 24h search cache per (store, query), recent-product cache for the search-to-import flow, same as the Walmart scraper provider.
- Error text mentioning block or challenge conditions maps to `rate_limited` so the bulk job's backoff logic treats it as degraded.

Store handling: the scraper rides the signed-in Chrome session, so pricing always reflects the store selected in the user's Safeway account.

- The provider exposes a single synthetic location ("Safeway (your account's store)").
- The scraper reports the actual `storeid` it intercepted; the provider records it on results so an entry is always attributable to a real store.
- Extension (only if needed later): if per-store lookup by explicit store id turns out to be required, add a Safeway store directory (full store list lookup) and pass `storeid` explicitly, the way the Walmart provider uses its bundled directory.
  This is out of scope for the first pass because the session's own store is the store the user actually shops.

Registered in `providers/index.ts`; Safeway rows then get the source badge, per-row Refresh, bulk lookup, and auto-refresh with no further wiring.

## Part 2: Auto-refresh (nightly + stale-on-view)

### Scheduler

A small in-process scheduler in the Fastify backend (no external cron):

- Runs nightly at a configurable hour (default 03:00 local) with random jitter of up to 30 minutes so scrapers never see a fixed-time burst.
- Kicks off a refresh job over every provider-linked PriceEntry (rows with `externalProductId` and a store with `externalId`).
- Reuses the bulk job's discipline: hard per-run call ceiling, delay between upstream calls, per-run (provider, term) cache, and the empty-streak degradation rule so one blocked scraper does not eat the budget of working providers.
- Writes a run summary (per provider: refreshed, unchanged, failed, skipped-degraded) retrievable from a status endpoint, so the UI can show "last auto-update: when, what happened".

### Stale-on-view

- Opening the price page fires `POST /prices/refresh-stale`, which starts (or joins) a background job refreshing rows whose recorded date is older than a threshold (default 24h).
- Same polled-job shape as bulk lookup: the page renders instantly from stored prices and rows update as results land.
- A job already running is joined, never duplicated; a nightly run and a stale-on-view run cannot overlap (single refresh job at a time, keyed globally).

### Refreshing scraper-linked rows after a restart

`getProduct` for scraper providers currently resolves only from an in-memory recent-search cache, so a refresh after a backend restart reports not found.
Auto-refresh fixes this honestly:

- The refresh job re-searches the provider by the grocery item's name and matches the stored `externalProductId` exactly within the results.
- On an exact id match, the price is upserted as usual.
- On no match, the row is marked "couldn't verify" (surfaced in the run summary and on the row) rather than guessed at by name similarity.
  A wrong price silently shadowing a right one is the failure mode this system must never have.

## Part 3: Automatic coupons from reliable sources

### Kroger/Fry's promo pricing

Already captured on every refresh (`couponEligible`, `couponData`, Promo badge).
The nightly job makes this automatic; no new code beyond Part 2.

### Flipp weekly-ad deals

A nightly step after the price refresh:

- For each store the user tracks, fetch Flipp deals by the store's ZIP (existing deals providers).
- Match deals to grocery items with the existing `matchDealsToGroceryList` token matcher.
- Upsert matched deals into the existing Coupon table: scope `item`, type derived from the deal (`dollar_off` / `percent_off` / `bogo` where derivable, otherwise a description-only coupon), `expiresAt` from the flyer validity window, linked to the store and item.
- Auto-created coupons carry provenance in a new `source` column on Coupon (`manual` default, `flipp`, `safeway-j4u`), mirroring how PriceEntry records its source, plus an `externalId` for upsert identity.
  Re-runs update their own rows and never touch user-entered coupons.
- Coupons whose flyer window has passed are auto-deactivated.

## Part 4: Safeway Just4U digital coupons (isolated)

The fragile piece, kept at arm's length from everything else:

- The Safeway scraper service (walmart-scraper repo) gains `GET /coupons?[query=]`: using the same CDP session, navigate the signed-in Chrome to the Just4U offers page and intercept the offers API response, returning normalized coupons (description, discount text, expiry, applicable product hints).
- Lookup only. The service never clips coupons; clipping is a write to the user's account and stays manual.
- The backend ingests these as `digital_coupon` rows scoped to the Safeway store, same upsert-by-source discipline as Flipp coupons.
- Failure isolation: if Safeway changes the page or the session is signed out, this step logs and skips.
  Prices and other coupon sources are unaffected.

## Error handling summary

- Provider failures during auto-refresh degrade per provider (empty-streak rule) and are reported in the run summary; they never abort the run for other providers.
- Scraper-unreachable (`network`) and bot-blocked (`rate_limited`) conditions are already distinguished by the provider layer; the job backs off the provider for the rest of the run in both cases.
- No silent writes: every automatic price or coupon write is attributable (source field, run summary) and idempotent (upsert keyed by source + external identity).

## Testing

- Provider unit tests for Safeway normalization (fixture of a captured pgmsearch response through the service's parse, provider-level normalization, unit-price fields).
- Scheduler tests with injected clock: fires at the configured hour with jitter bounds, never overlaps runs, honors call ceiling and degradation.
- Refresh-by-research tests: exact-id match upserts; missing id marks "couldn't verify" and never upserts a lookalike.
- Flipp coupon ingestion tests: dedupe on re-run, expiry deactivation, user-entered coupons untouched.
- J4U ingestion behind a fixture; a service-down test proves the nightly run completes without it.

## Out of scope

- Auto-clipping Just4U coupons (write to the user's account; stays manual).
- A Safeway store directory / explicit store-id lookup (noted extension in Part 1, only if the session-store approach proves insufficient).
- Coupon application math in list totals beyond what the existing Coupon model already does.
