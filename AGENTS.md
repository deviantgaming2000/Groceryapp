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

## Walmart scraper auto-start

The Walmart scraper is a SEPARATE sibling repo (`../walmart-scraper`), not part of this repo - never modify it from here.
It exposes `npm run api` (port 8090) and ships its own `Dockerfile` + `/health` healthcheck; the backend reaches it over HTTP via `WALMART_SCRAPER_URL` (default `http://localhost:8090`, see `backend/src/services/providers/walmart-scraper.ts`).

It auto-starts with the app in BOTH run paths:
- Local: `npm run dev` includes `npm run scraper`, which runs the guard wrapper `scripts/start-scraper.mjs`. The wrapper resolves `WALMART_SCRAPER_DIR` (default `../walmart-scraper`), and if the dir or its `node_modules` is missing it prints a `[scraper] skipped: ...` warning and exits 0 so backend/frontend keep running. It deliberately does NOT run `npm install` (one-time `setup:scraper` does that). Do not add a `concurrently --kill-others*` flag - it would let a scraper exit take down the dev group.
- Docker: the `walmart-scraper` compose service builds from `${WALMART_SCRAPER_CONTEXT:-../walmart-scraper}`; `backend` `depends_on` it with `condition: service_healthy` and gets `WALMART_SCRAPER_URL=http://walmart-scraper:8090`.

The scraper is an optional auto-started dependency: manual price entry and app boot must never hard-require it.

## Frontend bundle size (Three.js / Vanta)

Three.js + Vanta.js are heavy (~625 kB combined) and power only the visual-only fog in `frontend/src/components/VantaBackground.tsx`.
They MUST be pulled in via dynamic `import()` inside the component's effect, never as static top-level imports.
Static imports pull Three into the main entry chunk (~924 kB, over Vite's 500 kB advisory); the dynamic import keeps the entry chunk ~298 kB and emits Three/Vanta as separate async chunks that load after first paint.
The remaining Vite size warning refers only to the deferred `three.module` vendor chunk, which is inherent to Three.js and not the blocking entry chunk.
