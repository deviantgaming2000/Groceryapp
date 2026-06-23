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
