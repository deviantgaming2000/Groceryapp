# Grocery Price Checker

A manual-first grocery price comparison app.
It never invents prices and never pretends to know store pricing: every price is either entered by you or pulled from a named, inspectable source that is recorded on the price entry.

Manual entry is always the baseline and always works.
On top of that, optional integrations can fetch real prices: the Kroger/Fry's API, Walmart via SerpApi, a best-effort self-hosted Walmart store scraper, a self-hosted Safeway scraper, and weekly flyer deals via Flipp.
Each is opt-in, each requires a key or explicit action, and none of them run unless you configure them.

The app answers:

> Where should I buy this grocery list once I factor in item prices, distance, and gas cost?

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Fastify
- Database: PostgreSQL
- ORM: Prisma
- Optional maps: Google Distance Matrix API
- Auth mode: single-user local mode by default
- Optional MCP server for conversational control (`mcp-server/`)

## Interface

The app ships with a premium dark-mode visual system. It is a presentation layer only — all
pricing, comparison, and savings logic is unchanged.

- Deep-black canvas with an animated [Vanta.js](https://www.vantajs.com/) fog background,
  retinted to the app's violet/cyan palette. The effect is bundled locally (no CDN) and is
  click-safe (`pointer-events: none`, with mouse reactivity bound to `window`).
- Glassmorphic panels, cards, and tables with blur, soft glows, and rounded corners.
- Ghost-style buttons: filled by default, dissolving into a frosted-glass outline on hover.
- Animated savings counters and loading shimmer states on the Comparison screen.
- Mobile layout with a thumb-friendly bottom navigation bar and larger tap targets.
- Honors `prefers-reduced-motion`.

Most styling is centralized in `frontend/src/styles/app.css` via semantic class names and CSS
variables, so the theme can be adjusted in one place.

## Run In Docker On A Server

This is the recommended deployment path. It runs:

- `postgres`: persistent PostgreSQL database
- `migrate`: one-shot Prisma migration and seed job
- `backend`: compiled Fastify API
- `frontend`: nginx serving the React app and proxying `/api` to the backend

```bash
cp .env.example .env
```

Edit `.env` before first boot:

```bash
POSTGRES_PASSWORD=use_a_real_password_here
APP_PORT=8080
SINGLE_USER_EMAIL=you@example.com
```

Start the app:

```bash
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:8080
```

Check status:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs migrate
```

Stop the app:

```bash
docker compose down
```

Keep the database volume:

```bash
docker compose down
```

Delete all app data, including grocery prices:

```bash
docker compose down -v
```

Back up the database:

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > grocery_backup.sql
```

Restore a backup into a fresh database:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" < grocery_backup.sql
```

### Reverse Proxy

If you already use Caddy, nginx, Traefik, Cloudflare Tunnel, or another reverse proxy, point it to:

```text
http://127.0.0.1:8080
```

Change `APP_PORT` in `.env` if port `8080` is already taken.

## Run Locally Without Containers

```bash
cp .env.example .env
npm install
npm run setup:db
npm run dev
```

If you prefer the individual commands:

```bash
docker compose up -d postgres
npx prisma generate
npx prisma migrate dev
npm run seed
npm run dev
```

Open:

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/health

For local development, `docker compose up -d postgres` exposes Postgres on `127.0.0.1:5432`, and `DATABASE_URL` in `.env.example` is already pointed at that local port.

## Manual Workflow

1. Add stores in **Stores**.
2. Add grocery items in **Items**.
3. Create a grocery list in **Grocery Lists** and add items with quantities.
4. Enter prices manually in **Price Entry**.
5. Enter gas price, MPG, and optional manual distances in **Settings**.
6. Use **Comparison** to see cheapest stores, missing data, stale data, bulk leftovers, and driving-adjusted totals.

## Price Rules

Prices are manual by default.
Every price entry records its `source` (`manual`, `kroger`, `walmart`, or a deals provider), so an imported price is always distinguishable from one you typed in.

The optional Walmart scraper (`backend/src/services/providers/walmart-scraper.ts`) is best-effort and rate-limited, caches search results for roughly a day to stay clear of bot detection, and is expected to fail sometimes.
Treat it as a convenience, not a source of truth.

Each price entry includes item, store, price, package quantity/unit, brand, sale/coupon flags, tax flag, recorded date, optional expiration, confidence level, and notes.

Prices older than the configured stale threshold are marked old. Prices older than the very-stale threshold are marked very old.

## Bulk Logic

The comparison engine distinguishes actual checkout cost, consumed value, and leftover quantity/value.

Example: if you need `1 lb` but Costco sells `5 lb` for `$15`, checkout cost is `$15`, effective consumed value is `$3`, and leftover is `4 lb`.

## Distance And Gas

Settings include home/base address, vehicle MPG, gas price per gallon, round-trip toggle, and optional cost-per-mile override.

```text
round_trip_miles = one_way_miles * 2
gallons_used = round_trip_miles / mpg
driving_cost = gallons_used * gas_price
adjusted_total = grocery_total + driving_cost
```

The app works without Google Maps. Enter one-way distance manually under **Settings**.

## Google Maps

Optional distance calculation uses the Google Distance Matrix API.

1. Create a Google Maps API key with Distance Matrix enabled.
2. Add it to `.env`:

```bash
GOOGLE_MAPS_API_KEY=your_key_here
```

Only addresses are sent to Google when calculating distance. Results are cached in `distance_cache`.

## Kroger / Fry's API Integration

The app can search live Kroger/Fry's product data in addition to manual price entry. Manual entry
always works; the API is optional. Keys are used **only on the backend** and are never exposed to
the frontend.

### Setup

1. Create a developer account and an app at [developer.kroger.com](https://developer.kroger.com),
   with access to the **Products** and **Locations** APIs.
2. Add the credentials to `.env`:

```bash
KROGER_CLIENT_ID=your_client_id
KROGER_CLIENT_SECRET=your_client_secret
# Optional overrides:
# KROGER_API_BASE=https://api.kroger.com
# KROGER_OAUTH_SCOPE=product.compact
```

3. Restart the backend (credentials load at startup).

### Usage

1. Open **Find Products**.
2. Choose a store (search by ZIP — prefilled from your saved home ZIP when available). The selected
   store is saved to settings and reused for future searches.
3. Search for a product, then **Add from Kroger** to import it into your Items and Price Entry.
4. Imported prices show a **Kroger** badge and a **Refresh** button to re-fetch price/availability.

### How it works

A provider layer (`backend/src/services/providers/`) normalizes Kroger responses into a single
internal product shape, fronted by secure `/api/kroger/*` routes that handle OAuth, token caching,
and error handling. Imported products become normal `GroceryItem` + `PriceEntry` rows, so the
comparison engine treats them like any other price. The structure is provider-agnostic, so Walmart
and Safeway can be added later without a rewrite.

### Coupons

The Kroger Products API exposes regular vs. promo (loyalty) pricing rather than a separate coupons
feed. The app captures promo pricing as a coupon signal (`couponEligible`, `couponData`) and shows
a **Promo** badge. The data model is built so a richer coupon source can be added later.

### Endpoints

- `GET /api/kroger/status` — configuration and selected store
- `GET /api/kroger/locations?zip=` — search store locations
- `POST /api/kroger/store` — select/save the active store
- `GET /api/kroger/products/search?term=` — normalized product search
- `GET /api/kroger/products/:id` — normalized product details
- `POST /api/kroger/import` — import a product into items + prices
- `POST /api/kroger/prices/:id/refresh` — refresh a linked price entry

## Walmart (via SerpApi)

Walmart has no public product API, so Walmart search runs through
[SerpApi's Walmart engine](https://serpapi.com/walmart-product-api). It returns national
Walmart.com pricing (not per-store), so Walmart is modeled as a single online store.

1. Get a key at [serpapi.com](https://serpapi.com/walmart-product-api).
2. Add it under **Settings → API Keys** (or set `SERPAPI_KEY` in `.env`).
3. In **Find Products**, switch to the **Walmart** tab and search.

### Store selection (store-specific pricing)

SerpApi's Walmart engine accepts a `store_id` to return pricing for a specific store. In the
Walmart **Store** panel you can:

- **Enter a store ID directly** (recommended) — find it in a store's URL on walmart.com
  (e.g. `walmart.com/store/2280-...` → `2280`). This is reliable and gives store-specific pricing.
- **Search by ZIP** — best-effort via Walmart's public store finder. Walmart often blocks
  server-side requests, so if it fails, use direct ID entry (the app says so).
- **Walmart.com (national pricing)** — the default when no store is selected.

The selected store is saved and passed as `store_id` on every search/import/refresh.

Walmart uses the same provider/normalization layer and the same `/api/walmart/*` routes
(`status`, `locations`, `store`, `products/search`, `products/:id`, `import`, `prices/:id/refresh`)
as Kroger.

## Safeway (self-hosted)

A free, self-hosted Safeway price scraper (`backend/src/services/providers/safeway.ts`), living in the
same `walmart-scraper` repo as the Walmart scraper above. Safeway's storefront requires a signed-in
account to show correct pricing, so this provider attaches to your **real, signed-in Chrome** over CDP
instead of running headless. There is no store picker - the store you get prices for is whichever one
your Safeway account already has selected, so switching stores means switching stores in your Safeway
account itself.

1. In the `walmart-scraper` repo: `npm run safeway:chrome` launches a Chrome instance for you to sign
   into Safeway with, then `npm run safeway` starts the scraper API (default `http://localhost:8092`).
2. Add the scraper URL under **Settings → API Keys → Safeway (self-hosted scraper)** (or set
   `SAFEWAY_SCRAPER_URL` in `.env`).
3. In **Find Products**, switch to the **Safeway** tab and search.

Like the Walmart scraper, this is best-effort and rate-limited: results are cached for roughly a day,
and a blocked/challenged response from the scraper is treated as a temporary rate limit rather than a
hard failure.

Safeway uses the same provider/normalization layer and the same `/api/safeway/*` routes as Kroger and
Walmart.

## Managing API Keys

All integration keys (Kroger, Walmart/SerpApi, Google Maps) can be entered and updated in the
web app under **Settings → API Keys** — no `.env` editing or restart required.

- Keys are stored in the database (`api_credentials`) and **take precedence over `.env`**.
- The API never returns saved secrets — only a masked hint (e.g. `••••1234`) and a configured
  flag. Secrets are sent to the backend only when you save them.
- `.env` values still work as a fallback and are shown as "from .env" in the UI.

Endpoints: `GET /api/credentials`, `PUT /api/credentials/:provider`, `DELETE /api/credentials/:provider`.

## Weekly Deals And Flyers

Beyond per-product lookups, the app can pull weekly ad and flyer deals and match them against a grocery list.

Deals come from a provider registry (`backend/src/services/deals/`), so sources are pluggable:

- `flipp` - weekly flyers via Flipp, keyed by postal code. No API key required.
- `kroger` - promo/loyalty pricing from the Kroger Products API. Uses your Kroger credentials.
- `safeway` - Safeway weekly ad.
- `manual` - deals you enter yourself.

Open **Deals** to search across providers, or **Flyers** to browse a specific store's flyer page by page.
`POST /api/deals/match-list` scores the current deals against a grocery list so you can see which of the things you actually buy are on sale this week.
A matched deal can be saved as a coupon with `POST /api/deals/save-coupon`, after which the comparison engine applies it like any other coupon.

Endpoints: `GET /api/deals/providers`, `/deals/search`, `/deals/weekly-ad`, `/deals/coupons`, `/deals/flyers`, `/deals/flyers/:id`.

### Flyer Vision OCR (optional, fully local)

Many flyer items are images with the price baked into the picture, so there is no text to read.
For those, the app can hand the image to a **local** vision model and ask it to read off the price and deal text.

- Configure it under **Settings -> API Keys -> Local Vision OCR (Ollama)** with your Ollama base URL (default model `llama3.2-vision`).
- Both Ollama-style and OpenAI-style vision endpoints are supported; the style is auto-detected from the base URL.
- Images go only to the server you configure. Nothing is sent to a third party.
- Endpoints: `GET /api/deals/vision-status`, `POST /api/deals/read-image`. Results are cached per flyer item in `flyer_item_reads`.

## MCP Server

`mcp-server/` (package `grocery-mcp`) exposes the app to Claude and other MCP clients as 22 tools, so you can manage the whole thing conversationally: "add milk at $3.49 to Fry's", "compare my weekly list", "what's on sale at Safeway".

It is a thin stdio client over this app's own REST API - it holds no database connection and no credentials of its own.

Build it, then register it with your MCP client:

```bash
npm run build --workspace mcp-server
```

```json
{
  "grocery": {
    "type": "stdio",
    "command": "node",
    "args": ["/absolute/path/to/grocery-price-checker/mcp-server/dist/index.js"],
    "env": {
      "GROCERY_API_URL": "http://YOUR_SERVER:8080",
      "FLIPP_POSTAL_CODE": "85194"
    }
  }
}
```

`GROCERY_API_URL` points at a running instance (Docker or local dev).
`FLIPP_POSTAL_CODE` is required by the three `flipp_*` tools; without it they search with an empty postal code and return nothing useful.

It runs the compiled `dist/`, which is gitignored - after editing `mcp-server/src/index.ts` you must rebuild **and** restart the MCP client before changes take effect.

Tool groups: stores/items, prices, lists, coupons, and compare/dashboard/Flipp.

## CSV Import / Export

Templates:

- `csv_templates/items_template.csv`
- `csv_templates/stores_template.csv`
- `csv_templates/prices_template.csv`

Endpoints:

- `GET /api/export/items.csv`
- `GET /api/export/stores.csv`
- `GET /api/export/prices.csv`
- `POST /api/import/items`
- `POST /api/import/prices`

## API Overview

- `GET/POST/PATCH/DELETE /api/items`
- `GET/POST/PATCH/DELETE /api/stores`
- `GET/POST/PATCH/DELETE /api/lists`
- `POST/PATCH/DELETE /api/lists/:id/items`
- `GET/POST/PATCH/DELETE /api/prices`
- `GET/POST/PATCH/DELETE /api/coupons`
- `GET/PATCH /api/settings`
- `POST /api/settings/gas-price`
- `GET /api/distances`
- `POST /api/distances/manual`
- `POST /api/distances/calculate/:storeId`
- `GET /api/compare/:listId`

## Tests

```bash
npm run test --workspace backend
```

Tests cover unit price math, bulk leftovers, driving cost, incomplete store totals, and the gas/driving-adjusted store total (its own focused test). Stale prices and coupon application are exercised together in one combined test. The compare route is also covered: an unknown or unowned list returns a clean 404 (no leaked paths or ORM internals), and a missing user-settings row falls back to defaults.

## Privacy

The app stores data locally in PostgreSQL.

Data leaves your machine only when you explicitly use an optional integration:

- Store and home addresses go to Google when you calculate distance with Google Maps enabled.
- Search terms go to Kroger, SerpApi, or Flipp when you use those product/deal searches.
- Flyer images go to your own local Ollama instance when you use vision OCR - not to a third party.

No personal data is sent anywhere else, and every one of these requires you to configure a key or press a button.
