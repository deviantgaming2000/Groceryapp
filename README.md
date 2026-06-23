# Grocery Price Checker

A manual-first grocery price comparison app. It does not scrape grocery websites, does not invent prices, and does not pretend to know store pricing. Every grocery price is entered by you unless a real API integration is added later.

The app answers:

> Where should I buy this grocery list once I factor in item prices, distance, and gas cost?

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Fastify
- Database: PostgreSQL
- ORM: Prisma
- Optional maps: Google Distance Matrix API
- Auth mode: single-user local mode by default

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

Prices are manual. No scraping is performed.

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

Walmart uses the same provider/normalization layer and the same `/api/walmart/*` routes
(`status`, `products/search`, `products/:id`, `import`, `prices/:id/refresh`) as Kroger.

## Managing API Keys

All integration keys (Kroger, Walmart/SerpApi, Google Maps) can be entered and updated in the
web app under **Settings → API Keys** — no `.env` editing or restart required.

- Keys are stored in the database (`api_credentials`) and **take precedence over `.env`**.
- The API never returns saved secrets — only a masked hint (e.g. `••••1234`) and a configured
  flag. Secrets are sent to the backend only when you save them.
- `.env` values still work as a fallback and are shown as "from .env" in the UI.

Endpoints: `GET /api/credentials`, `PUT /api/credentials/:provider`, `DELETE /api/credentials/:provider`.

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

Tests cover unit price math, bulk leftovers, driving cost, stale prices, coupon application, incomplete store totals, and adjusted totals.

## Privacy

The app stores data locally in PostgreSQL. It does not scrape stores and does not send personal data to third parties except store/home addresses when you explicitly calculate distance with Google Maps enabled.
