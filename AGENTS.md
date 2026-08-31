# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Backend error handling

The global Fastify error handler in `backend/src/server.ts` sanitizes unexpected failures: any unhandled 5xx-class error is logged server-side via `request.log.error` and returned to the client as a generic `{ error: "Internal server error" }`, so absolute source paths, stack traces, and ORM internals never leak.
Two behaviors are preserved deliberately: the friendly "database not running" message for `Can't reach database server`, and any error carrying a 4xx `statusCode` (Fastify schema validation, or an error a route raised with an explicit status) passes through with its own message and status - real 4xx responses are never collapsed into 500s.
Even with this net, route handlers must still map expected "resource not found / not owned" cases explicitly, e.g. `findFirst` + `if (!row) return reply.status(404).send({ error: "..." })`, so clients get a meaningful 404 rather than a generic 500.
Do not use `findUniqueOrThrow` for request-scoped lookups: its `P2025` is a 5xx and would now surface only as the generic message.

## Workspaces and dependency hygiene

The root `workspaces` array is `["backend","frontend","mcp-server"]` and the root `build` script compiles all three (`mcp-server` is package `grocery-mcp`, built with `tsc`).
Workspace members do not carry their own `package-lock.json`: the single root lockfile governs every workspace, so do not commit a nested lock inside `backend/`, `frontend/`, or `mcp-server/`.

`npm audit` intentionally still reports the dev-only `vite` / `vitest` / `vite-node` / `@vitest/mocker` / `esbuild` chain (currently 3 moderate + 1 high + 1 critical rolled-up).
These are cleared only by the breaking `vitest@4` upgrade, which is a deliberately separate task - do NOT run `npm audit fix --force` to silence them, as that bumps vitest/vite/esbuild and can break the test setup.
Plain `npm audit fix` (non-breaking) is fine and already cleared the `shell-quote` (critical, via `concurrently`) and `@babel/core` (high) advisories.

## Frontend bundle size (Three.js / Vanta)

Three.js + Vanta.js are heavy (~625 kB combined) and power only the visual-only fog in `frontend/src/components/VantaBackground.tsx`.
They MUST be pulled in via dynamic `import()` inside the component's effect, never as static top-level imports.
Static imports pull Three into the main entry chunk (~924 kB, over Vite's 500 kB advisory); the dynamic import keeps the entry chunk ~298 kB and emits Three/Vanta as separate async chunks that load after first paint.
The remaining Vite size warning refers only to the deferred `three.module` vendor chunk, which is inherent to Three.js and not the blocking entry chunk.

## Deployment and the MCP server

The app is deployed with Docker Compose; the `frontend` nginx container publishes `${APP_PORT:-8080}:80` and proxies `/api` to the `backend` container, which is `expose`-only and never reachable directly from outside.
So the only externally useful port is `APP_PORT`, and `GET /api/health/db` is the quickest end-to-end check that nginx, Fastify, and Postgres are all healthy.
There is no login screen: the app runs in single-user mode keyed off `SINGLE_USER_EMAIL`, so any host-level credentials are for the server, not the app.

`mcp-server/` is registered with MCP clients as a stdio server pointed at `mcp-server/dist/index.js`, with `GROCERY_API_URL` naming a running instance and `FLIPP_POSTAL_CODE` required by the `flipp_*` tools (they silently search an empty postal code without it).
It runs the compiled output and `mcp-server/dist/` is gitignored, so editing `src/index.ts` alone changes nothing: rebuild with `npm run build --workspace mcp-server` and restart the MCP client.

## Item naming and categories

Item `name` and `category` are free-text, and nothing in the API trims or canonicalizes them.
Trailing spaces and near-miss categories therefore accumulate silently and fragment category grouping and name matching - a real occurrence was `"Dariy "`, `"meat"` vs `"Meat"`, and `"Drink"` vs `"Drinks"` all coexisting.
The canonical category set is: `Produce`, `Meat`, `Dairy`, `Pantry`, `Frozen`, `Drinks`, `Household`, `Spirits`.
When adding an item-writing path, trim whitespace and map onto that set rather than letting a new variant in.

Items imported from a provider land in a category derived from the provider payload, which can be junk (a Walmart import once produced the literal category `"Imported"`) - map imported items onto the canonical set at import time.

## Bulk price lookup (`POST /api/bulk-find-prices`)

This runs as a **background job**, not a synchronous request: `POST` returns `202 {jobId}` immediately and `GET /api/bulk-find-prices/:jobId` reports progress and the final summary.
Jobs are held in memory (single-user app; an interrupted run is re-run, not resumed) and only the last 10 are kept.
Do not convert it back to a blocking request: it walks every list item against every provider with a 300ms pause between upstream calls, so it runs for minutes, and holding the response open meant a proxy timeout abandoned the client while the backend kept writing prices unseen - the UI said failed while the data changed anyway.

`nginx.conf` still carries a raised `proxy_read_timeout` on `location /api/` (600s) as a backstop; the job is what actually fixes it.

A provider that returns empty results five times in a row is marked **degraded** and its remaining items are skipped.
This exists because the Walmart scraper answers `200 {"count":0,"results":[]}` when it hits Walmart's bot wall, which is indistinguishable from a genuine no-match on any single call but unmistakable across a run.
Without it, a blocked provider burned the whole `MAX_CALLS = 80` budget on phantom "no match" results and starved the providers that were working.
Do not try to evade the bot wall; back off and report it.

The per-run `MAX_CALLS = 80` ceiling is still real. When it is hit, `limitReached` is set and the remaining items come back `status: "skipped"` - surface that rather than presenting a partial run as complete.

Two data hazards to respect when touching this path:

`upsertPrice` writes imported entries with `confidence: "confirmed"` and a current `recordedAt`, so an imported price outranks a manual one in the comparison for the same item and store.
A single bad match silently replaces a correct hand-entered figure - a verified $173.14 list once reported $614.76 this way.
Manual entries are not destroyed (upsert keys on `source` + `externalProductId`), just shadowed, so deactivating the imported rows restores the previous state.

`upsertPrice` updates matching rows **in place**, overwriting the previous price with no history.
For those rows a "just undo the run" cleanup cannot restore the old value - it is already gone.

Product matching must stay gated on package fit (`pickBestProduct`'s `need` argument).
Title overlap alone once matched a 10 lb need to a 1 lb package, which `packagesNeeded` ceilinged into a $138 line for an $8.72 bag.
